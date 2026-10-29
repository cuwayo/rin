import { expect, test } from 'bun:test'
import { GroupModerationStore } from './group-moderation-store.ts'

test('persists the bad-word filter setting by group', async () => {
    const store = new GroupModerationStore({
        prefix: '!',
        sessionId: 'test',
        authPath: ':memory:',
        logLevel: 'info',
        roleDbPath: ':memory:',
        moderationDbPath: ':memory:',
        typeSafeModel: 'jev-1.14.0',
        badWordThreshold: 0.9,
    })

    expect(await store.isBadWordFilterEnabled('first@g.us')).toBe(false)

    await store.setBadWordFilterEnabled('first@g.us', true)
    expect(await store.isBadWordFilterEnabled('first@g.us')).toBe(true)
    expect(await store.isBadWordFilterEnabled('second@g.us')).toBe(false)

    await store.setBadWordFilterEnabled('first@g.us', false)
    expect(await store.isBadWordFilterEnabled('first@g.us')).toBe(false)
})

test('persists custom filter requirements by group', async () => {
    const store = new GroupModerationStore({
        prefix: '!',
        sessionId: 'test',
        authPath: ':memory:',
        logLevel: 'info',
        roleDbPath: ':memory:',
        moderationDbPath: ':memory:',
        typeSafeModel: 'jev-1.14.0',
        badWordThreshold: 0.9,
    })

    const first = await store.addFilterRequirement('first@g.us', 'No links')
    const second = await store.addFilterRequirement(
        'first@g.us',
        'No NSFW topics',
    )
    await store.addFilterRequirement('second@g.us', 'No spam')

    expect(await store.listFilterRequirements('first@g.us')).toEqual([
        { id: first.id, requirement: 'No links' },
        { id: second.id, requirement: 'No NSFW topics' },
    ])
    expect(await store.removeFilterRequirement('first@g.us', second.id)).toBe(
        true,
    )
    expect(await store.removeFilterRequirement('first@g.us', second.id)).toBe(
        false,
    )
    expect(await store.listFilterRequirements('second@g.us')).toEqual([
        { id: expect.any(Number), requirement: 'No spam' },
    ])
    expect(await store.clearFilterRequirements('first@g.us')).toBe(1)
    expect(await store.listFilterRequirements('first@g.us')).toEqual([])
})

test('tracks filter warnings only within a group and participant', async () => {
    const store = new GroupModerationStore({
        prefix: '!',
        sessionId: 'test',
        authPath: ':memory:',
        logLevel: 'info',
        roleDbPath: ':memory:',
        moderationDbPath: ':memory:',
        typeSafeModel: 'jev-1.14.0',
        badWordThreshold: 0.9,
    })

    expect(await store.getWarningLimit('first@g.us')).toBeUndefined()
    await store.setWarningLimit('first@g.us', 3)
    expect(await store.getWarningLimit('first@g.us')).toBe(3)
    expect(
        await store.incrementWarning('first@g.us', 'member@s.whatsapp.net'),
    ).toEqual({ count: 1 })
    expect(
        await store.incrementWarning('first@g.us', 'member@s.whatsapp.net'),
    ).toEqual({ count: 2 })
    expect(
        await store.incrementWarning('second@g.us', 'member@s.whatsapp.net'),
    ).toEqual({ count: 1 })

    await store.clearWarnings('first@g.us', 'member@s.whatsapp.net')
    expect(
        await store.incrementWarning('first@g.us', 'member@s.whatsapp.net'),
    ).toEqual({ count: 1 })
    await store.setWarningLimit('first@g.us', undefined)
    expect(await store.getWarningLimit('first@g.us')).toBeUndefined()
})
