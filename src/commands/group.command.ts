import { Injectable } from '../core/di.ts'
import { normalizeUserJid } from '../core/jid.ts'
import { Command, GroupAdmin } from './command.decorator.ts'
import type {
    BotCommand,
    CommandContext,
    GroupParticipantActionResult,
} from './contracts.ts'

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

@Command({
    name: 'group',
    aliases: ['groupctl', 'gc'],
    description: 'Manage this group (admins only).',
    category: 'Group',
})
@GroupAdmin()
@Injectable()
export class GroupCommand implements BotCommand {
    async execute(context: CommandContext): Promise<void> {
        const group = context.group
        if (!group) {
            await context.reply('This command can only be used in a group.')
            return
        }

        const [rawAction, ...rest] = context.args
        const action = rawAction?.toLowerCase()
        if (!action) {
            await context.reply(prefixUsage(context.prefix))
            return
        }

        try {
            switch (action) {
                case 'add':
                    await participantAction(
                        context,
                        'Added',
                        'add',
                        group.addParticipants.bind(group),
                        addParticipantTargets,
                        '<phone-number|jid>',
                    )
                    return
                case 'remove':
                case 'kick':
                    await participantAction(
                        context,
                        'Removed',
                        'remove',
                        group.removeParticipants.bind(group),
                    )
                    return
                case 'promote':
                    await participantAction(
                        context,
                        'Promoted',
                        'promote',
                        group.promoteParticipants.bind(group),
                    )
                    return
                case 'demote':
                    await participantAction(
                        context,
                        'Demoted',
                        'demote',
                        group.demoteParticipants.bind(group),
                    )
                    return
                case 'subject':
                    await updateSubject(context, rest.join(' '))
                    return
                case 'description':
                case 'desc':
                    await updateDescription(context, rest.join(' '))
                    return
                case 'announce':
                    await updateSetting(context, 'announcement', rest[0])
                    return
                case 'restrict':
                    await updateSetting(context, 'restrict', rest[0])
                    return
                case 'link':
                    await context.reply(
                        `Group invite link:\nhttps://chat.whatsapp.com/${await group.inviteCode()}`,
                    )
                    return
                case 'revoke-link':
                case 'reset-link':
                    await context.reply(
                        `Group invite link revoked. New link:\nhttps://chat.whatsapp.com/${await group.revokeInvite()}`,
                    )
                    return
                case 'info':
                    await showInfo(context)
                    return
                default:
                    await context.reply(prefixUsage(context.prefix))
            }
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
    subject: string,
): Promise<void> {
    if (!subject) {
        await context.reply(
            `Usage: ${context.prefix}group subject <new subject>`,
        )
        return
    }
    await context.group?.setSubject(subject)
    await context.reply('Group subject updated.')
}

async function updateDescription(
    context: CommandContext,
    description: string,
): Promise<void> {
    if (!description) {
        await context.reply(
            `Usage: ${context.prefix}group description <text>|clear`,
        )
        return
    }
    await context.group?.setDescription(
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
    setting: 'announcement' | 'restrict',
    rawValue: string | undefined,
): Promise<void> {
    const enabled = parseToggle(rawValue)
    if (enabled === undefined) {
        const label = setting === 'announcement' ? 'announce' : 'restrict'
        await context.reply(`Usage: ${context.prefix}group ${label} on|off`)
        return
    }
    await context.group?.setSetting(setting, enabled)
    const label =
        setting === 'announcement'
            ? 'Announcement-only messages'
            : 'Group info editing'
    await context.reply(`${label} ${enabled ? 'enabled' : 'disabled'}.`)
}

async function showInfo(context: CommandContext): Promise<void> {
    const info = await context.group?.info()
    if (!info) {
        await context.reply('This command can only be used in a group.')
        return
    }
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
    const suppliedTargets = normalizeParticipantTargets(context.args.slice(1))
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
