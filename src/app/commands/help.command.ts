import {
  Command,
  listCommands,
} from '../../framework/commands/command.decorator.ts';
import type {
  BotCommand,
  CommandContext,
} from '../../framework/commands/contracts.ts';
import { Injectable } from '../../framework/core/di.ts';

@Command({
  name: 'help',
  aliases: ['commands'],
  description: 'Show the available commands.',
})
@Injectable()
export class HelpCommand implements BotCommand {
  async execute(context: CommandContext): Promise<void> {
    const commandList = formatCommandList(listCommands(), context.prefix);

    await context.reply(`Available commands:\n${commandList}`);
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
