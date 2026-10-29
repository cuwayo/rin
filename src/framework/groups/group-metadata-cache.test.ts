import { expect, test } from 'bun:test'
import type { WaGroupMetadata } from 'zapo-js'
import { GroupMetadataCache } from './group-metadata-cache.ts'

test('shares metadata until invalidated, then refreshes it', async () => {
    const cache = new GroupMetadataCache()
    let queries = 0
    const load = async (): Promise<WaGroupMetadata> => {
        queries += 1
        return { subject: `Group ${queries}` } as WaGroupMetadata
    }

    expect((await cache.get('first@g.us', load)).subject).toBe('Group 1')
    expect((await cache.get('first@g.us', load)).subject).toBe('Group 1')
    expect(queries).toBe(1)

    cache.invalidate('first@g.us')
    expect((await cache.get('first@g.us', load)).subject).toBe('Group 2')
    expect(queries).toBe(2)
})

test('does not let an older query overwrite a newer refresh', async () => {
    const cache = new GroupMetadataCache()
    const older = deferred<WaGroupMetadata>()
    const newer = deferred<WaGroupMetadata>()

    const olderQuery = cache.get('first@g.us', () => older.promise)
    const newerQuery = cache.refresh('first@g.us', () => newer.promise)

    newer.resolve({ subject: 'Newer group' } as WaGroupMetadata)
    await newerQuery
    older.resolve({ subject: 'Older group' } as WaGroupMetadata)
    await olderQuery

    const metadata = await cache.get('first@g.us', async () => {
        throw new Error('the cached metadata should be used')
    })
    expect(metadata.subject).toBe('Newer group')
})

test('does not let an older query failure remove a newer refresh', async () => {
    const cache = new GroupMetadataCache()
    const older = deferred<WaGroupMetadata>()
    const newer = deferred<WaGroupMetadata>()

    const olderQuery = cache.get('first@g.us', () => older.promise)
    const newerQuery = cache.refresh('first@g.us', () => newer.promise)

    newer.resolve({ subject: 'Newer group' } as WaGroupMetadata)
    await newerQuery
    older.reject(new Error('older query failed'))
    await expect(olderQuery).rejects.toThrow('older query failed')

    const metadata = await cache.get('first@g.us', async () => {
        throw new Error('the cached metadata should be used')
    })
    expect(metadata.subject).toBe('Newer group')
})

function deferred<T>(): {
    readonly promise: Promise<T>
    readonly resolve: (value: T) => void
    readonly reject: (reason?: unknown) => void
} {
    let resolve!: (value: T) => void
    let reject!: (reason?: unknown) => void
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise
        reject = rejectPromise
    })
    return { promise, resolve, reject }
}
