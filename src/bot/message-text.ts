import type { WaIncomingMessageEvent } from 'zapo-js'

export function extractMessageText(
    event: WaIncomingMessageEvent,
): string | undefined {
    return (
        event.message?.conversation ??
        event.message?.extendedTextMessage?.text ??
        undefined
    )
}
