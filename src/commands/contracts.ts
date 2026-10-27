import type { WaIncomingMessageEvent, WaSendMessageContent } from 'zapo-js'
import type { ParsedMessage } from '../bot/message.ts'

/**
 * Data and safe role resolvers provided to an authorization check.
 *
 * Check functions are evaluated before a command instance is created. They
 * can therefore be reused by any command without requiring a dependency.
 */
export interface CommandAuthorizationContext {
    readonly event: WaIncomingMessageEvent
    readonly message: ParsedMessage
    readonly prefix: string
    readonly args: readonly string[]
    readonly senderJids: readonly string[]
    readonly senderIds: readonly string[]
    readonly isGroup: boolean
    readonly isSuperuser: boolean
    isBotModerator(): Promise<boolean>
    isGroupAdmin(): Promise<boolean>
}

export type CommandCheckResult =
    | boolean
    | {
          readonly allowed: boolean
          /** Recorded in logs when the check denies access. */
          readonly reason?: string
      }

/**
 * A composable, possibly asynchronous command authorization rule.
 *
 * Return true (or `{ allowed: true }`) to permit execution. Returning false
 * denies execution. A thrown error is treated as a denial to fail closed.
 */
export type CommandCheck = (
    context: CommandAuthorizationContext,
) => CommandCheckResult | Promise<CommandCheckResult>

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
