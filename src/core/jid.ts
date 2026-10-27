/**
 * Normalizes a WhatsApp user address for role comparisons and storage.
 * Group and broadcast JIDs are intentionally rejected.
 */
export function normalizeUserJid(value: string): string | undefined {
    const jid = value.trim().toLowerCase()
    if (/^\d{7,15}$/.test(jid)) return `${jid}@s.whatsapp.net`
    if (!/^\d+(?::\d+)?@(s\.whatsapp\.net|lid)$/.test(jid)) {
        return undefined
    }
    return jid.replace(/:\d+(?=@)/, '')
}

/** Returns the numeric account part before a user JID's @ suffix. */
export function userIdFromJid(value: string): string | undefined {
    return value.trim().match(/^(\d+)(?::\d+)?@/)?.[1]
}
