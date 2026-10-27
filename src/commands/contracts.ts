import type { WaIncomingMessageEvent } from 'zapo-js'

export interface CommandContext {
    readonly event: WaIncomingMessageEvent
    readonly prefix: string
    readonly args: readonly string[]
    reply(text: string): Promise<void>
}

export interface BotCommand {
    execute(context: CommandContext): Promise<void>
}
