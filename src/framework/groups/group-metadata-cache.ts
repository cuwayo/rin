import type { WaGroupMetadata } from 'zapo-js'
import { Injectable } from '../core/di.ts'

type MetadataLoader = () => Promise<WaGroupMetadata>

interface CacheEntry {
    readonly metadata?: WaGroupMetadata
    readonly pending?: Promise<WaGroupMetadata>
    readonly token?: object
}

/**
 * Shares in-flight group metadata queries and retains the most recent
 * authoritative roster until a WhatsApp group event or local mutation refreshes it.
 */
@Injectable()
export class GroupMetadataCache {
    private readonly entries = new Map<string, CacheEntry>()

    async get(
        groupJid: string,
        load: MetadataLoader,
    ): Promise<WaGroupMetadata> {
        const entry = this.entries.get(groupJid)
        if (entry?.metadata) return entry.metadata
        if (entry?.pending) return entry.pending
        return this.load(groupJid, load)
    }

    async refresh(
        groupJid: string,
        load: MetadataLoader,
    ): Promise<WaGroupMetadata> {
        return this.load(groupJid, load)
    }

    invalidate(groupJid: string): void {
        this.entries.delete(groupJid)
    }

    private load(
        groupJid: string,
        load: MetadataLoader,
    ): Promise<WaGroupMetadata> {
        const token = {}
        const pending = load()
            .then((metadata) => {
                if (this.entries.get(groupJid)?.token === token) {
                    this.entries.set(groupJid, { metadata })
                }
                return metadata
            })
            .catch((error: unknown) => {
                if (this.entries.get(groupJid)?.token === token) {
                    this.entries.delete(groupJid)
                }
                throw error
            })
        this.entries.set(groupJid, { pending, token })
        return pending
    }
}
