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
        const commandList = formatCommandList(listCommands(), context.prefix)

        await context.reply(`Available commands:\n${commandList}`)
    }
}

function formatCommandList(
    commands: ReturnType<typeof listCommands>,
    prefix: string,
): string {
    const commandsByCategory = new Map<
        string,
        Array<(typeof commands)[number]>
    >()
    for (const command of commands) {
        const categoryCommands = commandsByCategory.get(command.category) ?? []
        categoryCommands.push(command)
        commandsByCategory.set(command.category, categoryCommands)
    }

    return [...commandsByCategory.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([category, categoryCommands]) => {
            const commandLines = categoryCommands.map((command) => {
                const aliases = command.aliases.length
                    ? ` (${command.aliases.join(', ')})`
                    : ''
                return `• ${prefix}${command.name}${aliases} — ${command.description}`
            })
            return `*${category}*\n${commandLines.join('\n')}`
        })
        .join('\n\n')
}
