import { Command } from '@/framework/commands/command.decorator.ts';
import type {
  BotCommand,
  CommandContext,
} from '@/framework/commands/contracts.ts';
import { Injectable } from '@/framework/core/di.ts';

@Command({
  name: 'ping',
  description: 'Check whether the bot is responsive.',
  usage: '',
})
@Injectable()
export class PingCommand implements BotCommand {
  async execute(context: CommandContext): Promise<void> {
    await context.reply('pong');
  }
}
