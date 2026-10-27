import type { WaIncomingMessageEvent, WaSendMessageContent } from 'zapo-js'
import type { ParsedMessage } from '../bot/message.ts'

export interface CommandContext {
    readonly event: WaIncomingMessageEvent
    /** Normalized message data, including media metadata and context. */
    readonly message: ParsedMessage
    readonly prefix: string
    readonly args: readonly string[]
    /** Reply with text or any supported WhatsApp content, including media. */
    reply(content: WaSendMessageContent): Promise<void>
    /** Send text or supported WhatsApp content to a specific JID. */
    send(jid: string, content: WaSendMessageContent): Promise<void>
    /**
     * React to the invoking message. Set removeAfterCommand to true to clear
     * the reaction once the command finishes; it defaults to false.
     */
    react(emoji: string, removeAfterCommand?: boolean): Promise<void>
}

export interface BotCommand {
    execute(context: CommandContext): Promise<void>
}
