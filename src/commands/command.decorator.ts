import type { Constructable } from '../core/di.ts'
import type { BotCommand } from './contracts.ts'

export interface CommandDefinition {
    readonly name: string
    readonly aliases: readonly string[]
    readonly description: string
    readonly type: Constructable<BotCommand>
}

export type CommandOptions = Omit<CommandDefinition, 'type'>

const commandsByName = new Map<string, CommandDefinition>()

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
