import {
    Command,
    Group,
    GroupAdmin,
} from '../../framework/commands/command.decorator.ts'
import type {
    BotCommand,
    CommandContext,
    GroupCommandActions,
    GroupParticipantActionResult,
} from '../../framework/commands/contracts.ts'
import { Injectable } from '../../framework/core/di.ts'
import { normalizeUserJid } from '../../framework/core/jid.ts'

const usage = [
    'Usage:',
    'group add <phone-number|jid> [...]',
    'group remove|promote|demote <@mention> [...]',
    'group subject <new subject>',
    'group description <text>|clear',
    'group announce on|off',
    'group restrict on|off',
    'group link',
    'group revoke-link',
    'group info',
].join('\n')

@Group({
    name: 'group',
    aliases: ['groupctl', 'gc'],
    description: 'Manage this group (admins only).',
})
@GroupAdmin()
@Injectable()
export class GroupCommand implements BotCommand {
    async execute(context: CommandContext): Promise<void> {
        if (!context.group) {
            await context.reply('This command can only be used in a group.')
            return
        }

        const [rawAction, ...rest] = context.args
        const action = rawAction?.toLowerCase()
        if (!action) {
            await context.reply(prefixUsage(context.prefix))
            return
        }

        const subcommandContext = {
            ...context,
            args: rest,
        }
        switch (action) {
            case 'add':
                await this.add(subcommandContext)
                return
            case 'remove':
            case 'kick':
                await this.remove(subcommandContext)
                return
            case 'promote':
                await this.promote(subcommandContext)
                return
            case 'demote':
                await this.demote(subcommandContext)
                return
            case 'subject':
                await this.subject(subcommandContext)
                return
            case 'description':
            case 'desc':
                await this.description(subcommandContext)
                return
            case 'announce':
                await this.announce(subcommandContext)
                return
            case 'restrict':
                await this.restrict(subcommandContext)
                return
            case 'link':
                await this.link(subcommandContext)
                return
            case 'revoke-link':
            case 'reset-link':
                await this.revokeLink(subcommandContext)
                return
            case 'info':
                await this.info(subcommandContext)
                return
            default:
                await context.reply(prefixUsage(context.prefix))
        }
    }

    @Command({
        name: 'add',
        description: 'Add members by phone number, JID, or mention.',
    })
    async add(context: CommandContext): Promise<void> {
        await this.withGroup(context, (group) =>
            participantAction(
                context,
                'Added',
                'add',
                group.addParticipants.bind(group),
                addParticipantTargets,
                '<phone-number|jid>',
            ),
        )
    }

    @Command({
        name: 'remove',
        aliases: ['kick'],
        description: 'Remove mentioned members from the group.',
    })
    async remove(context: CommandContext): Promise<void> {
        await this.withGroup(context, (group) =>
            participantAction(
                context,
                'Removed',
                'remove',
                group.removeParticipants.bind(group),
            ),
        )
    }

    @Command({
        name: 'promote',
        description: 'Promote mentioned members to group admin.',
    })
    async promote(context: CommandContext): Promise<void> {
        await this.withGroup(context, (group) =>
            participantAction(
                context,
                'Promoted',
                'promote',
                group.promoteParticipants.bind(group),
            ),
        )
    }

    @Command({
        name: 'demote',
        description: 'Demote mentioned group admins.',
    })
    async demote(context: CommandContext): Promise<void> {
        await this.withGroup(context, (group) =>
            participantAction(
                context,
                'Demoted',
                'demote',
                group.demoteParticipants.bind(group),
            ),
        )
    }

    @Command({
        name: 'subject',
        description: 'Change the group subject.',
    })
    async subject(context: CommandContext): Promise<void> {
        await this.withGroup(context, (group) =>
            updateSubject(context, group, context.args.join(' ')),
        )
    }

    @Command({
        name: 'description',
        aliases: ['desc'],
        description: 'Change or clear the group description.',
    })
    async description(context: CommandContext): Promise<void> {
        await this.withGroup(context, (group) =>
            updateDescription(context, group, context.args.join(' ')),
        )
    }

    @Command({
        name: 'announce',
        description: 'Enable or disable announcement-only messages.',
    })
    async announce(context: CommandContext): Promise<void> {
        await this.withGroup(context, (group) =>
            updateSetting(context, group, 'announcement', context.args[0]),
        )
    }

    @Command({
        name: 'restrict',
        description: 'Control who may edit group information.',
    })
    async restrict(context: CommandContext): Promise<void> {
        await this.withGroup(context, (group) =>
            updateSetting(context, group, 'restrict', context.args[0]),
        )
    }

    @Command({
        name: 'link',
        description: 'Show the group invite link.',
    })
    async link(context: CommandContext): Promise<void> {
        await this.withGroup(context, async (group) => {
            await context.reply(
                `Group invite link:\nhttps://chat.whatsapp.com/${await group.inviteCode()}`,
            )
        })
    }

    @Command({
        name: 'revoke-link',
        aliases: ['reset-link'],
        description: 'Revoke the current group invite link.',
    })
    async revokeLink(context: CommandContext): Promise<void> {
        await this.withGroup(context, async (group) => {
            await context.reply(
                `Group invite link revoked. New link:\nhttps://chat.whatsapp.com/${await group.revokeInvite()}`,
            )
        })
    }

    @Command({
        name: 'info',
        description: 'Show this group’s details.',
    })
    async info(context: CommandContext): Promise<void> {
        await this.withGroup(context, (group) => showInfo(context, group))
    }

    private async withGroup(
        context: CommandContext,
        action: (group: GroupCommandActions) => Promise<void>,
    ): Promise<void> {
        const group = context.group
        if (!group) {
            await context.reply('This command can only be used in a group.')
            return
        }

        try {
            await action(group)
        } catch (error) {
            await context.reply(
                `WhatsApp rejected the group update: ${groupErrorMessage(error)}`,
            )
        }
    }
}

async function participantAction(
    context: CommandContext,
    label: string,
    action: string,
    operation: (
        participants: readonly string[],
    ) => Promise<readonly GroupParticipantActionResult[]>,
    targetsFor: (
        context: CommandContext,
    ) => readonly string[] = mentionedParticipantTargets,
    targetUsage = '<@mention>',
): Promise<void> {
    const targets = targetsFor(context)
    if (targets.length === 0) {
        await context.reply(
            `Usage: ${context.prefix}group ${action} ${targetUsage} [...]`,
        )
        return
    }

    const results = await operation(targets)
    const successful = results.filter((result) => result.status === 'ok')
    const failed = results.filter((result) => result.status !== 'ok')
    const summary = `${label} ${successful.length}/${targets.length} participant${targets.length === 1 ? '' : 's'}.`
    const failures = failed.length
        ? `\nFailed: ${failed.map(formatFailure).join(', ')}`
        : ''
    await context.reply(`${summary}${failures}`)
}

async function updateSubject(
    context: CommandContext,
    group: GroupCommandActions,
    subject: string,
): Promise<void> {
    if (!subject) {
        await context.reply(
            `Usage: ${context.prefix}group subject <new subject>`,
        )
        return
    }
    await group.setSubject(subject)
    await context.reply('Group subject updated.')
}

async function updateDescription(
    context: CommandContext,
    group: GroupCommandActions,
    description: string,
): Promise<void> {
    if (!description) {
        await context.reply(
            `Usage: ${context.prefix}group description <text>|clear`,
        )
        return
    }
    await group.setDescription(
        description.toLowerCase() === 'clear' ? null : description,
    )
    await context.reply(
        description.toLowerCase() === 'clear'
            ? 'Group description cleared.'
            : 'Group description updated.',
    )
}

async function updateSetting(
    context: CommandContext,
    group: GroupCommandActions,
    setting: 'announcement' | 'restrict',
    rawValue: string | undefined,
): Promise<void> {
    const enabled = parseToggle(rawValue)
    if (enabled === undefined) {
        const label = setting === 'announcement' ? 'announce' : 'restrict'
        await context.reply(`Usage: ${context.prefix}group ${label} on|off`)
        return
    }
    await group.setSetting(setting, enabled)
    const label =
        setting === 'announcement'
            ? 'Announcement-only messages'
            : 'Group info editing'
    await context.reply(`${label} ${enabled ? 'enabled' : 'disabled'}.`)
}

async function showInfo(
    context: CommandContext,
    group: GroupCommandActions,
): Promise<void> {
    const info = await group.info()
    await context.reply(
        [
            `Group: ${info.subject}`,
            `Participants: ${info.participantCount}`,
            `Announcement-only: ${info.announcementOnly ? 'on' : 'off'}`,
            `Restrict info edits: ${info.restrictInfoEdits ? 'on' : 'off'}`,
            ...(info.description ? [`Description: ${info.description}`] : []),
        ].join('\n'),
    )
}

function addParticipantTargets(context: CommandContext): readonly string[] {
    const suppliedTargets = normalizeParticipantTargets(context.args)
    return suppliedTargets.length > 0
        ? suppliedTargets
        : mentionedParticipantTargets(context)
}

function mentionedParticipantTargets(
    context: CommandContext,
): readonly string[] {
    // WhatsApp supplies the recipient's actual current identity here. Never
    // derive a target from rendered `@number` text because it may not match
    // the LID address that the group currently uses.
    return normalizeParticipantTargets(context.message.context.mentionedJids)
}

function normalizeParticipantTargets(
    candidates: readonly string[],
): readonly string[] {
    return [
        ...new Set(
            candidates
                .map(normalizeUserJid)
                .filter((jid): jid is string => jid !== undefined),
        ),
    ]
}

function parseToggle(value: string | undefined): boolean | undefined {
    switch (value?.toLowerCase()) {
        case 'on':
        case 'enable':
        case 'enabled':
            return true
        case 'off':
        case 'disable':
        case 'disabled':
            return false
        default:
            return undefined
    }
}

function formatFailure(result: GroupParticipantActionResult): string {
    return `${result.jid} (${result.code})`
}

function prefixUsage(prefix: string): string {
    return usage.replaceAll('group', `${prefix}group`)
}

function groupErrorMessage(error: unknown): string {
    const message =
        error instanceof Error ? error.message : 'an unexpected error occurred'
    return message.replace(/\s+/g, ' ').slice(0, 240)
}
