import type { WaIncomingMessageEvent } from 'zapo-js'
import type { ParsedMessage } from '../bot/message.ts'

export interface CommandContext {
    readonly event: WaIncomingMessageEvent
    /** Normalized message data, including media metadata and context. */
    readonly message: ParsedMessage
    readonly prefix: string
    readonly args: readonly string[]
    reply(text: string): Promise<void>
}

export interface BotCommand {
    execute(context: CommandContext): Promise<void>
}
