import type { WaIncomingMessageEvent } from 'zapo-js'
import { findCommand } from '../commands/command.decorator.ts'
import type { CommandContext } from '../commands/contracts.ts'
import type { BotConfig } from '../config.ts'
import { BOT_CONFIG } from '../config.ts'
import { Container, Injectable } from '../core/di.ts'
import { parseIncomingMessage } from './message.ts'

export interface MessageResponder {
    reply(event: WaIncomingMessageEvent, text: string): Promise<void>
}

@Injectable([Container, BOT_CONFIG])
export class CommandRouter {
    constructor(
        private readonly container: Container,
        private readonly config: BotConfig,
    ) {}

    async handle(
        event: WaIncomingMessageEvent,
        responder: MessageResponder,
    ): Promise<void> {
        const message = parseIncomingMessage(event)
        const text = message?.text?.trim()
        if (!message || !text?.startsWith(this.config.prefix)) return

        const [rawCommand, ...args] = text
            .slice(this.config.prefix.length)
            .trim()
            .split(/\s+/)
        if (!rawCommand) return

        const definition = findCommand(rawCommand)
        if (!definition) return

        const context: CommandContext = {
            event,
            message,
            prefix: this.config.prefix,
            args,
            reply: (replyText) => responder.reply(event, replyText),
        }

        await this.container.resolve(definition.type).execute(context)
    }
}
