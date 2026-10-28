import { expect, test } from 'bun:test'
import type { CommandContext, GroupCommandActions } from './contracts.ts'
import { GroupCommand } from './group.command.ts'

test('uses WhatsApp mention JIDs instead of rendered mention text', async () => {
    const calls: string[][] = []
    const { context, replies } = groupContext(
        ['add', '@not-the-target'],
        {
            addParticipants: async (participants) => {
                calls.push([...participants])
                return participants.map((jid) => ({
                    jid,
                    status: 'ok' as const,
                    code: 200,
                }))
            },
        },
        ['628111111111@s.whatsapp.net'],
    )

    await new GroupCommand().execute(context)

    expect(calls).toEqual([['628111111111@s.whatsapp.net']])
    expect(replies).toEqual(['Added 1/1 participant.'])
})

test('adds a supplied phone number when no mention is available', async () => {
    const calls: string[][] = []
    const { context, replies } = groupContext(['add', '628111111111'], {
        addParticipants: async (participants) => {
            calls.push([...participants])
            return participants.map((jid) => ({
                jid,
                status: 'ok' as const,
                code: 200,
            }))
        },
    })

    await new GroupCommand().execute(context)

    expect(calls).toEqual([['628111111111@s.whatsapp.net']])
    expect(replies).toEqual(['Added 1/1 participant.'])
})

test('requires a real WhatsApp mention for participant actions', async () => {
    const { context, replies } = groupContext(['promote', '628123456789'], {
        promoteParticipants: async () => {
            throw new Error('a plain text target must not be used')
        },
    })

    await new GroupCommand().execute(context)

    expect(replies).toEqual(['Usage: !group promote <@mention> [...]'])
})

test('updates announcement-only mode', async () => {
    const settings: Array<readonly [string, boolean]> = []
    const { context, replies } = groupContext(['announce', 'on'], {
        setSetting: async (setting, enabled) => {
            settings.push([setting, enabled])
        },
    })

    await new GroupCommand().execute(context)

    expect(settings).toEqual([['announcement', true]])
    expect(replies).toEqual(['Announcement-only messages enabled.'])
})

test('does not expose group operations outside a group', async () => {
    const { context, replies } = groupContext(['info'], undefined)

    await new GroupCommand().execute(context)

    expect(replies).toEqual(['This command can only be used in a group.'])
})

test('reports the actual group-operation error without claiming missing admin rights', async () => {
    const { context, replies } = groupContext(['announce', 'on'], {
        setSetting: async () => {
            throw new Error('group.setSetting: IQ error 403 (not-authorized)')
        },
    })

    await new GroupCommand().execute(context)

    expect(replies).toEqual([
        'WhatsApp rejected the group update: group.setSetting: IQ error 403 (not-authorized)',
    ])
})

function groupContext(
    args: readonly string[],
    overrides: Partial<GroupCommandActions> | undefined,
    mentionedJids: readonly string[] = [],
): { readonly context: CommandContext; readonly replies: string[] } {
    const replies: string[] = []
    const group: GroupCommandActions = {
        addParticipants: async () => [],
        removeParticipants: async () => [],
        promoteParticipants: async () => [],
        demoteParticipants: async () => [],
        setSubject: async () => undefined,
        setDescription: async () => undefined,
        setSetting: async () => undefined,
        inviteCode: async () => 'invite-code',
        revokeInvite: async () => 'new-invite-code',
        info: async () => ({
            subject: 'Test group',
            participantCount: 3,
            announcementOnly: false,
            restrictInfoEdits: false,
        }),
        ...overrides,
    }

    return {
        context: {
            event: {} as CommandContext['event'],
            message: {
                kind: 'text',
                context: {
                    mentionedJids,
                    isForwarded: false,
                },
                raw: {},
            },
            prefix: '!',
            args,
            reply: async (content) => {
                if (typeof content === 'string') replies.push(content)
            },
            send: async () => undefined,
            react: async () => undefined,
            ...(overrides ? { group } : {}),
        },
        replies,
    }
}
