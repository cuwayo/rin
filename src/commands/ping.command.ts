import { Injectable } from '../core/di.ts'
import { Command } from './command.decorator.ts'
import type { BotCommand, CommandContext } from './contracts.ts'

@Command({
    name: 'ping',
    description: 'Check whether the bot is responsive.',
})
@Injectable()
export class PingCommand implements BotCommand {
    async execute(context: CommandContext): Promise<void> {
        await context.reply('pong')
    }
}
