import type { Constructable } from '@/framework/core/di.ts';
import type { BotCommand, CommandCheck, CommandContext } from './contracts.ts';

/**
 * The access level required to execute a command.
 *
 * Bot superusers can run every command. Bot moderators can run moderator
 * commands, but do not automatically receive group-admin privileges.
 */
export type CommandPermission =
  | 'public'
  | 'group-admin'
  | 'bot-moderator'
  | 'bot-superuser';

export interface CommandDefinition {
  readonly kind: 'command';
  readonly name: string;
  readonly aliases: readonly string[];
  readonly description: string;
  readonly usage?: CommandUsage;
  readonly type: Constructable<BotCommand>;
}

export interface SubcommandDefinition {
  readonly name: string;
  readonly aliases: readonly string[];
  readonly description: string;
  readonly usage?: CommandUsage;
  readonly handler: CommandHandler;
}

export interface CommandGroupDefinition {
  readonly kind: 'group';
  readonly name: string;
  readonly aliases: readonly string[];
  readonly description: string;
  readonly usage?: CommandUsage;
  readonly type: Constructable<BotCommand>;
  readonly subcommands: readonly SubcommandDefinition[];
}

export type RegisteredCommand = CommandDefinition | CommandGroupDefinition;

export type CommandHandler = (context: CommandContext) => void | Promise<void>;

/** One or more argument forms accepted by a command. */
export type CommandUsage = string | readonly string[];

export type CommandOptions = Omit<
  CommandDefinition,
  'kind' | 'type' | 'aliases'
> & {
  readonly aliases?: readonly string[];
};

export type GroupOptions = CommandOptions;

type CommandAuthorizationTarget = Constructable<BotCommand> | CommandHandler;

interface CommandDecorator {
  (target: Constructable<BotCommand>, context: ClassDecoratorContext): void;
  (target: CommandHandler, context: ClassMethodDecoratorContext): void;
}

const commandsByName = new Map<string, RegisteredCommand>();
const subcommandsByHandler = new WeakMap<
  CommandHandler,
  SubcommandDefinition
>();
const permissionsByType = new WeakMap<
  CommandAuthorizationTarget,
  CommandPermission
>();
const checksByType = new WeakMap<
  CommandAuthorizationTarget,
  readonly CommandCheck[]
>();
const cooldownsByType = new WeakMap<CommandAuthorizationTarget, number>();

/**
 * Registers a top-level command, or a method command inside a `@Group`.
 *
 * Decorate a method with `@Command` only when its containing class has
 * `@Group`.
 */
export function Command(
  options: Omit<CommandOptions, 'aliases'> & {
    readonly aliases?: readonly string[];
  },
): CommandDecorator {
  const command: CommandDecorator = (
    target: Constructable<BotCommand> | CommandHandler,
    context: ClassDecoratorContext | ClassMethodDecoratorContext,
  ): void => {
    if (context.kind === 'method') {
      if (context.static) {
        throw new Error('@Command subcommands must be instance methods.');
      }
      const handler = decoratedMethodHandler(target);
      if (subcommandsByHandler.has(handler)) {
        throw new Error(
          `Method "${String(context.name)}" has multiple command decorators.`,
        );
      }
      subcommandsByHandler.set(handler, {
        name: options.name,
        aliases: options.aliases ?? [],
        description: options.description,
        usage: options.usage,
        handler,
      });
      return;
    }

    if (context.kind !== 'class') {
      throw new Error('@Command can only decorate a class or method.');
    }
    const type = decoratedCommandType(target);
    if (hasSubcommands(type)) {
      throw new Error(
        'A class with @Command methods must use @Group instead of @Command.',
      );
    }

    const definition: CommandDefinition = {
      ...options,
      kind: 'command',
      aliases: options.aliases ?? [],
      type,
    };

    registerCommand(definition);
  };

  return command;
}

/**
 * Registers a command group. Methods decorated with `@Command` become its
 * subcommands, in the same style as a Discord.Net `[Group]` module.
 */
export function Group(options: GroupOptions) {
  return (
    target: Constructable<BotCommand>,
    _context: ClassDecoratorContext,
  ): void => {
    const subcommands = Object.getOwnPropertyNames(target.prototype)
      .map((name) => Object.getOwnPropertyDescriptor(target.prototype, name))
      .flatMap((descriptor) => {
        const handler = commandHandlerFromValue(descriptor?.value);
        if (!handler) return [];
        const definition = subcommandsByHandler.get(handler);
        return definition ? [definition] : [];
      });

    const group: CommandGroupDefinition = {
      ...options,
      kind: 'group',
      aliases: options.aliases ?? [],
      type: target,
      subcommands,
    };

    ensureUniqueSubcommands(group);
    registerCommand(group);
  };
}

export function findCommand(name: string): RegisteredCommand | undefined {
  return commandsByName.get(name.toLowerCase());
}

export function listCommands(): readonly RegisteredCommand[] {
  return [...new Set(commandsByName.values())].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

export function findSubcommand(
  group: CommandGroupDefinition,
  name: string,
): SubcommandDefinition | undefined {
  const normalized = name.toLowerCase();
  return group.subcommands.find(
    (subcommand) =>
      subcommand.name.toLowerCase() === normalized ||
      subcommand.aliases.some((alias) => alias.toLowerCase() === normalized),
  );
}

export function isCommandGroup(
  definition: RegisteredCommand,
): definition is CommandGroupDefinition {
  return definition.kind === 'group';
}

/**
 * Sets the built-in role required by a command. A command may have one such
 * role decorator; use `Require` as well when it needs additional rules.
 */
export function Permission(permission: CommandPermission) {
  return (
    target: CommandAuthorizationTarget,
    context: ClassDecoratorContext | ClassMethodDecoratorContext,
  ): void => {
    if (context.kind !== 'class' && context.kind !== 'method') {
      throw new Error('@Permission can only decorate a class or method.');
    }
    const existingPermission = permissionsByType.get(target);
    if (existingPermission && existingPermission !== permission) {
      throw new Error(
        `${target.name} has conflicting permission decorators: ` +
          `"${existingPermission}" and "${permission}".`,
      );
    }
    permissionsByType.set(target, permission);
  };
}

/** Requires the sender to be an admin of the current WhatsApp group. */
export function GroupAdmin() {
  return Permission('group-admin');
}

/** Requires the sender to be a bot moderator. */
export function Moderator() {
  return Permission('bot-moderator');
}

/** Requires the configured bot superuser. */
export function Superuser() {
  return Permission('bot-superuser');
}

export function commandPermission(
  type: CommandAuthorizationTarget,
): CommandPermission {
  return permissionsByType.get(type) ?? 'public';
}

/**
 * Limits each sender to one execution of a command during the given interval.
 * The interval is measured in milliseconds.
 */
export function Cooldown(cooldownMs: number) {
  if (!Number.isFinite(cooldownMs) || cooldownMs <= 0) {
    throw new RangeError(
      'Command cooldown must be a positive number of milliseconds.',
    );
  }

  return (
    target: CommandAuthorizationTarget,
    context: ClassDecoratorContext | ClassMethodDecoratorContext,
  ): void => {
    if (context.kind !== 'class' && context.kind !== 'method') {
      throw new Error('@Cooldown can only decorate a class or method.');
    }
    if (cooldownsByType.has(target)) {
      throw new Error(`${target.name} has multiple cooldown decorators.`);
    }
    cooldownsByType.set(target, cooldownMs);
  };
}

export function commandCooldown(
  type: CommandAuthorizationTarget,
): number | undefined {
  return cooldownsByType.get(type);
}

/**
 * Adds one or more authorization checks to a command.
 *
 * Checks are evaluated after its built-in permission decorator succeeds. They
 * may be asynchronous and must return `true` to allow execution. Reusable
 * checks can be wrapped in application-specific decorators.
 *
 * @example
 * const InAllowedGroup = () =>
 *     Require((authorization) =>
 *         authorization.event.key.remoteJid === '123@g.us',
 *     )
 *
 * @Command({ name: 'announce', description: 'Send an announcement.' })
 * @InAllowedGroup()
 * class AnnounceCommand implements BotCommand { ... }
 */
export function Require(...checks: readonly CommandCheck[]) {
  return (
    target: CommandAuthorizationTarget,
    context: ClassDecoratorContext | ClassMethodDecoratorContext,
  ): void => {
    if (context.kind !== 'class' && context.kind !== 'method') {
      throw new Error('@Require can only decorate a class or method.');
    }
    const existingChecks = checksByType.get(target) ?? [];
    // Class decorators execute from bottom to top. Prepending keeps checks
    // in the same order they appear in source code.
    checksByType.set(target, [...checks, ...existingChecks]);
  };
}

/** Alias for `Require`, mirroring the familiar command-check terminology. */
export const Check = Require;

export function commandChecks(
  type: CommandAuthorizationTarget,
): readonly CommandCheck[] {
  return checksByType.get(type) ?? [];
}

function registerCommand(definition: RegisteredCommand): void {
  for (const name of [definition.name, ...definition.aliases]) {
    const normalized = name.toLowerCase();
    if (commandsByName.has(normalized)) {
      throw new Error(`Command "${normalized}" is already registered.`);
    }
    commandsByName.set(normalized, definition);
  }
}

function ensureUniqueSubcommands(group: CommandGroupDefinition): void {
  const names = new Set<string>();
  for (const subcommand of group.subcommands) {
    for (const name of [subcommand.name, ...subcommand.aliases]) {
      const normalized = name.toLowerCase();
      if (names.has(normalized)) {
        throw new Error(
          `Group "${group.name}" has duplicate subcommand "${normalized}".`,
        );
      }
      names.add(normalized);
    }
  }
}

function hasSubcommands(type: Constructable<BotCommand>): boolean {
  return Object.getOwnPropertyNames(type.prototype).some((name) => {
    const descriptor = Object.getOwnPropertyDescriptor(type.prototype, name);
    const handler = commandHandlerFromValue(descriptor?.value);
    return handler !== undefined && subcommandsByHandler.has(handler);
  });
}

function decoratedMethodHandler(
  target: CommandAuthorizationTarget,
): CommandHandler {
  // Stage-3 decorators invoke a method decorator with the decorated method.
  // biome-ignore lint/nursery/noUnsafeTypeAssertion: Decorator context establishes the callable contract.
  return target as CommandHandler;
}

function decoratedCommandType(
  target: CommandAuthorizationTarget,
): Constructable<BotCommand> {
  // Stage-3 decorators invoke a class decorator with the decorated constructor.
  // biome-ignore lint/nursery/noUnsafeTypeAssertion: Decorator context establishes the constructor contract.
  return target as Constructable<BotCommand>;
}

function commandHandlerFromValue(value: unknown): CommandHandler | undefined {
  if (typeof value !== 'function') return undefined;
  // JavaScript cannot reflect a function's parameter or return contract.
  // biome-ignore lint/nursery/noUnsafeTypeAssertion: Command registration invokes the handler with CommandContext.
  return value as CommandHandler;
}
