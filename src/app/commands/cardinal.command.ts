import {
    Command,
    Group,
    Superuser,
} from '../../framework/commands/command.decorator.ts'
import type {
    BotCommand,
    CommandContext,
} from '../../framework/commands/contracts.ts'
import { Injectable } from '../../framework/core/di.ts'
import { normalizeUserJid } from '../../framework/core/jid.ts'
import { RoleStore } from '../../framework/roles/role-store.ts'
import { executeJavaScript, executeShell } from '../utils/cardinal-execution.ts'

@Group({
    name: 'cardinal',
    aliases: ['c'],
    description: 'Run Cardinal administration commands.',
})
@Superuser()
@Injectable([RoleStore])
export class CardinalCommand implements BotCommand {
    constructor(private readonly roleStore: RoleStore) {}

    async execute(context: CommandContext): Promise<void> {
        await context.reply(
            [
                `Usage: ${context.prefix}cardinal <subcommand>`,
                'Subcommands: addmod, delmod, mods, console, debug',
            ].join('\n'),
        )
    }

    @Command({
        name: 'addmod',
        aliases: ['modadd'],
        description: 'Add a bot moderator by number, JID, or @mention.',
    })
    async addmod(context: CommandContext): Promise<void> {
        const target = moderatorTarget(context)
        if (!target) {
            await context.reply(
                `Usage: ${context.prefix}cardinal addmod <phone-number|jid|@mention>`,
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

    @Command({
        name: 'delmod',
        aliases: ['moddel', 'removemod'],
        description: 'Remove a bot moderator by number, JID, or @mention.',
    })
    async delmod(context: CommandContext): Promise<void> {
        const target = moderatorTarget(context)
        if (!target) {
            await context.reply(
                `Usage: ${context.prefix}cardinal delmod <phone-number|jid|@mention>`,
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

    @Command({
        name: 'mods',
        aliases: ['moderators'],
        description: 'List bot moderators.',
    })
    async mods(context: CommandContext): Promise<void> {
        const moderators = await this.roleStore.listModerators()
        await context.reply(
            moderators.length
                ? `Bot moderators:\n${moderators.map((jid) => `• ${jid}`).join('\n')}`
                : 'No bot moderators are configured.',
        )
    }

    @Command({
        name: 'console',
        description: 'Run a terminal command.',
    })
    async console(context: CommandContext): Promise<void> {
        const command = context.args.join(' ')
        if (!command) {
            await context.reply(
                `Usage: ${context.prefix}cardinal console <command>`,
            )
            return
        }

        await context.reply(await executeShell(command))
    }

    @Command({
        name: 'debug',
        description: 'Run a JavaScript debugging snippet.',
    })
    async debug(context: CommandContext): Promise<void> {
        const source = context.args.join(' ')
        if (!source) {
            await context.reply(
                `Usage: ${context.prefix}cardinal debug <expression-or-statements>`,
            )
            return
        }

        await context.reply(await executeJavaScript(source, context))
    }
}

function moderatorTarget(context: CommandContext): string | undefined {
    const value = context.message.context.mentionedJids[0] ?? context.args[0]
    return value ? normalizeUserJid(value) : undefined
}
