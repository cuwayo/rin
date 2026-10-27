import type { Constructable } from '../core/di.ts'
import type { BotCommand } from './contracts.ts'

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
    readonly permission: CommandPermission
    readonly type: Constructable<BotCommand>
}

export type CommandOptions = Omit<CommandDefinition, 'type' | 'permission'> & {
    readonly permission?: CommandPermission
}

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
            permission: options.permission ?? 'public',
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
