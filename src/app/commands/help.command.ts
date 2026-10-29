import {
  Command,
  type CommandGroupDefinition,
  commandCooldown,
  commandPermission,
  findCommand,
  findSubcommand,
  isCommandGroup,
  listCommands,
  type RegisteredCommand,
  type SubcommandDefinition,
} from '../../framework/commands/command.decorator.ts';
import type {
  BotCommand,
  CommandContext,
} from '../../framework/commands/contracts.ts';
import { Injectable } from '../../framework/core/di.ts';

@Command({
  name: 'help',
  aliases: ['commands'],
  description: 'Show commands or detailed command help.',
  usage: '[command] [subcommand]',
})
@Injectable()
export class HelpCommand implements BotCommand {
  async execute(context: CommandContext): Promise<void> {
    const [commandName, subcommandName] = context.args;
    if (commandName) {
      await context.reply(
        formatCommandHelp(commandName, subcommandName, context.prefix),
      );
      return;
    }

    const commandList = formatCommandList(listCommands(), context.prefix);

    await context.reply(
      `Available commands:\n${commandList}\n\nUse ${context.prefix}help <command> [subcommand] for details.`,
    );
  }
}

function formatCommandList(
  commands: ReturnType<typeof listCommands>,
  prefix: string,
): string {
  return commands
    .map((command) => {
      const aliases = command.aliases.length
        ? ` (${command.aliases.join(', ')})`
        : '';
      return `• ${prefix}${command.name}${aliases} — ${command.description}`;
    })
    .join('\n');
}

function formatCommandHelp(
  commandName: string,
  subcommandName: string | undefined,
  prefix: string,
): string {
  const command = findCommand(commandName);
  if (!command) {
    return `Unknown command: ${commandName}. Use ${prefix}help to list commands.`;
  }

  if (subcommandName && isCommandGroup(command)) {
    const subcommand = findSubcommand(command, subcommandName);
    if (!subcommand) {
      return `Unknown subcommand: ${command.name} ${subcommandName}. Use ${prefix}help ${command.name} to list its subcommands.`;
    }
    return formatSubcommandHelp(command, subcommand, prefix);
  }

  if (subcommandName) {
    return `${prefix}${command.name} has no subcommands.`;
  }

  return formatTopLevelCommandHelp(command, prefix);
}

function formatTopLevelCommandHelp(
  command: RegisteredCommand,
  prefix: string,
): string {
  const lines = [
    `Command: ${prefix}${command.name}`,
    `Description: ${command.description}`,
    formatAliases(command.aliases),
    ...formatUsage(command.name, command.usage, prefix),
    `Cooldown: ${formatCooldown(commandCooldown(command.type))}`,
    `Permission: ${formatPermission(commandPermission(command.type))}`,
  ];

  if (isCommandGroup(command)) {
    lines.push(
      'Subcommands:',
      ...command.subcommands.map((subcommand) =>
        formatSubcommandListItem(command, subcommand, prefix),
      ),
    );
  }

  return lines.join('\n');
}

function formatSubcommandHelp(
  command: CommandGroupDefinition,
  subcommand: SubcommandDefinition,
  prefix: string,
): string {
  const cooldown =
    commandCooldown(subcommand.handler) ?? commandCooldown(command.type);
  const permission = commandPermission(subcommand.handler);
  const inheritedPermission = commandPermission(command.type);

  return [
    `Command: ${prefix}${command.name} ${subcommand.name}`,
    `Description: ${subcommand.description}`,
    formatAliases(subcommand.aliases),
    ...formatUsage(
      `${command.name} ${subcommand.name}`,
      subcommand.usage,
      prefix,
    ),
    `Cooldown: ${formatCooldown(cooldown)}`,
    `Permission: ${formatPermissions(inheritedPermission, permission)}`,
  ].join('\n');
}

function formatSubcommandListItem(
  command: CommandGroupDefinition,
  subcommand: SubcommandDefinition,
  prefix: string,
): string {
  const aliases = subcommand.aliases.length
    ? ` (${subcommand.aliases.join(', ')})`
    : '';
  return `• ${prefix}${command.name} ${subcommand.name}${aliases} — ${subcommand.description}`;
}

function formatAliases(aliases: readonly string[]): string {
  return aliases.length ? `Aliases: ${aliases.join(', ')}` : 'Aliases: none';
}

function formatUsage(
  commandName: string,
  usage: string | readonly string[] | undefined,
  prefix: string,
): readonly string[] {
  const forms = usage ? (typeof usage === 'string' ? [usage] : usage) : [''];
  return forms.map((form) =>
    form
      ? `Usage: ${prefix}${commandName} ${form}`
      : `Usage: ${prefix}${commandName}`,
  );
}

function formatCooldown(cooldownMs: number | undefined): string {
  if (cooldownMs === undefined) return 'None';

  const seconds = Math.ceil(cooldownMs / 1_000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes === 0) return `${seconds}s`;
  if (remainingSeconds === 0) return `${minutes}m`;
  return `${minutes}m ${remainingSeconds}s`;
}

function formatPermissions(
  ...permissions: readonly (
    | 'public'
    | 'group-admin'
    | 'bot-moderator'
    | 'bot-superuser'
  )[]
): string {
  const values = [...new Set(permissions)]
    .filter((permission) => permission !== 'public')
    .map(formatPermission);
  return values.length ? values.join(', ') : 'Public';
}

function formatPermission(
  permission: 'public' | 'group-admin' | 'bot-moderator' | 'bot-superuser',
): string {
  switch (permission) {
    case 'group-admin':
      return 'Group admin';
    case 'bot-moderator':
      return 'Bot moderator';
    case 'bot-superuser':
      return 'Bot superuser';
    case 'public':
      return 'Public';
  }
}
