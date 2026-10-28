import type { Constructable } from '../core/di.ts'
import type { BotCommand, CommandCheck } from './contracts.ts'

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
    | 'bot-superuser'

export interface CommandDefinition {
    readonly name: string
    readonly aliases: readonly string[]
    readonly description: string
    /** Label used to group this command in help output. */
    readonly category: string
    readonly type: Constructable<BotCommand>
}

export type CommandOptions = Omit<CommandDefinition, 'type' | 'category'> & {
    readonly category?: string
}

const commandsByName = new Map<string, CommandDefinition>()
const permissionsByType = new WeakMap<
    Constructable<BotCommand>,
    CommandPermission
>()
const checksByType = new WeakMap<
    Constructable<BotCommand>,
    readonly CommandCheck[]
>()
const cooldownsByType = new WeakMap<Constructable<BotCommand>, number>()

export function Command(
    options: Omit<CommandOptions, 'aliases'> & {
        readonly aliases?: readonly string[]
    },
) {
    return (
        target: Constructable<BotCommand>,
        _context: ClassDecoratorContext,
    ): void => {
        const definition: CommandDefinition = {
            ...options,
            aliases: options.aliases ?? [],
            category: commandCategory(options.category),
            type: target,
        }

        for (const name of [definition.name, ...definition.aliases]) {
            const normalized = name.toLowerCase()
            if (commandsByName.has(normalized)) {
                throw new Error(
                    `Command "${normalized}" is already registered.`,
                )
            }
            commandsByName.set(normalized, definition)
        }
    }
}

export function findCommand(name: string): CommandDefinition | undefined {
    return commandsByName.get(name.toLowerCase())
}

export function listCommands(): readonly CommandDefinition[] {
    return [...new Set(commandsByName.values())].sort((left, right) =>
        left.name.localeCompare(right.name),
    )
}

/**
 * Sets the built-in role required by a command. A command may have one such
 * role decorator; use `Require` as well when it needs additional rules.
 */
export function Permission(permission: CommandPermission) {
    return (
        target: Constructable<BotCommand>,
        _context: ClassDecoratorContext,
    ): void => {
        const existingPermission = permissionsByType.get(target)
        if (existingPermission && existingPermission !== permission) {
            throw new Error(
                `${target.name} has conflicting permission decorators: ` +
                    `"${existingPermission}" and "${permission}".`,
            )
        }
        permissionsByType.set(target, permission)
    }
}

/** Requires the sender to be an admin of the current WhatsApp group. */
export const GroupAdmin = () => Permission('group-admin')

/** Requires the sender to be a bot moderator. */
export const Moderator = () => Permission('bot-moderator')

/** Requires the configured bot superuser. */
export const Superuser = () => Permission('bot-superuser')

export function commandPermission(
    type: Constructable<BotCommand>,
): CommandPermission {
    return permissionsByType.get(type) ?? 'public'
}

/**
 * Limits each sender to one execution of a command during the given interval.
 * The interval is measured in milliseconds.
 */
export function Cooldown(cooldownMs: number) {
    if (!Number.isFinite(cooldownMs) || cooldownMs <= 0) {
        throw new RangeError(
            'Command cooldown must be a positive number of milliseconds.',
        )
    }

    return (
        target: Constructable<BotCommand>,
        _context: ClassDecoratorContext,
    ): void => {
        if (cooldownsByType.has(target)) {
            throw new Error(`${target.name} has multiple cooldown decorators.`)
        }
        cooldownsByType.set(target, cooldownMs)
    }
}

export function commandCooldown(
    type: Constructable<BotCommand>,
): number | undefined {
    return cooldownsByType.get(type)
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
        target: Constructable<BotCommand>,
        _context: ClassDecoratorContext,
    ): void => {
        const existingChecks = checksByType.get(target) ?? []
        // Class decorators execute from bottom to top. Prepending keeps checks
        // in the same order they appear in source code.
        checksByType.set(target, [...checks, ...existingChecks])
    }
}

/** Alias for `Require`, mirroring the familiar command-check terminology. */
export const Check = Require

export function commandChecks(
    type: Constructable<BotCommand>,
): readonly CommandCheck[] {
    return checksByType.get(type) ?? []
}

function commandCategory(category: string | undefined): string {
    const normalized = category?.trim().replace(/\s+/g, ' ')
    if (!normalized) return 'General'
    if (normalized.length > 48) {
        throw new Error('Command categories must be at most 48 characters.')
    }
    return normalized
}
