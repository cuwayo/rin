import { Injectable } from '../core/di.ts'
import { Command, listCommands } from './command.decorator.ts'
import type { BotCommand, CommandContext } from './contracts.ts'

@Command({
    name: 'help',
    aliases: ['commands'],
    description: 'Show the available commands.',
})
@Injectable()
export class HelpCommand implements BotCommand {
    async execute(context: CommandContext): Promise<void> {
        const commandList = listCommands()
            .map((command) => {
                const aliases = command.aliases.length
                    ? ` (${command.aliases.join(', ')})`
                    : ''
                return `• ${context.prefix}${command.name}${aliases} — ${command.description}`
            })
            .join('\n')

        await context.reply(`Available commands:\n${commandList}`)
    }
}
