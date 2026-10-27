import { Injectable } from '../core/di.ts'
import { normalizeUserJid } from '../core/jid.ts'
import { RoleStore } from '../roles/role-store.ts'
import { Command, Superuser } from './command.decorator.ts'
import type { BotCommand, CommandContext } from './contracts.ts'

@Command({
    name: 'addmod',
    aliases: ['modadd'],
    description: 'Add a bot moderator by number, JID, or @mention.',
    category: 'Developer',
})
@Superuser()
@Injectable([RoleStore])
export class AddModeratorCommand implements BotCommand {
    constructor(private readonly roleStore: RoleStore) {}

    async execute(context: CommandContext): Promise<void> {
        const target = moderatorTarget(context)
        if (!target) {
            await context.reply(
                `Usage: ${context.prefix}addmod <phone-number|jid|@mention>`,
            )
            return
        }

        const added = await this.roleStore.addModerator(target)
        await context.reply(
            added
                ? `Moderator added: ${target}`
                : `Already a moderator: ${target}`,
        )
    }
}

@Command({
    name: 'delmod',
    aliases: ['moddel', 'removemod'],
    description: 'Remove a bot moderator by number, JID, or @mention.',
    category: 'Developer',
})
@Superuser()
@Injectable([RoleStore])
export class RemoveModeratorCommand implements BotCommand {
    constructor(private readonly roleStore: RoleStore) {}

    async execute(context: CommandContext): Promise<void> {
        const target = moderatorTarget(context)
        if (!target) {
            await context.reply(
                `Usage: ${context.prefix}delmod <phone-number|jid|@mention>`,
            )
            return
        }

        const removed = await this.roleStore.removeModerator(target)
        await context.reply(
            removed
                ? `Moderator removed: ${target}`
                : `Not a moderator: ${target}`,
        )
    }
}

@Command({
    name: 'mods',
    aliases: ['moderators'],
    description: 'List bot moderators.',
    category: 'Developer',
})
@Superuser()
@Injectable([RoleStore])
export class ListModeratorsCommand implements BotCommand {
    constructor(private readonly roleStore: RoleStore) {}

    async execute(context: CommandContext): Promise<void> {
        const moderators = await this.roleStore.listModerators()
        await context.reply(
            moderators.length
                ? `Bot moderators:\n${moderators.map((jid) => `• ${jid}`).join('\n')}`
                : 'No bot moderators are configured.',
        )
    }
}

function moderatorTarget(context: CommandContext): string | undefined {
    const value = context.message.context.mentionedJids[0] ?? context.args[0]
    return value ? normalizeUserJid(value) : undefined
}
