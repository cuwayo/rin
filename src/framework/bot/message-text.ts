import type { WaIncomingMessageEvent } from 'zapo-js'
import { parseIncomingMessage } from './message.ts'

export function extractMessageText(
    event: WaIncomingMessageEvent,
): string | undefined {
    return parseIncomingMessage(event)?.text
}
