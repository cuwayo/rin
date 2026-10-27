import type { Logger, WaIncomingMessageEvent } from 'zapo-js'
import { findCommand } from '../commands/command.decorator.ts'
import type { CommandContext } from '../commands/contracts.ts'
import type { BotConfig } from '../config.ts'
import { BOT_CONFIG } from '../config.ts'
import { Container, Injectable } from '../core/di.ts'
import { APP_LOGGER } from '../core/logger.ts'
import { parseIncomingMessage } from './message.ts'

export interface MessageResponder {
    reply(event: WaIncomingMessageEvent, text: string): Promise<void>
}

@Injectable([Container, BOT_CONFIG, APP_LOGGER])
export class CommandRouter {
    constructor(
        private readonly container: Container,
        private readonly config: BotConfig,
        private readonly logger: Logger,
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

        const startedAt = performance.now()
        const trace = {
            command: definition.name,
            invokedAs: rawCommand.toLowerCase(),
            chatJid: event.key.remoteJid,
            messageId: event.key.id,
            senderJid: event.key.participant ?? event.key.remoteJid,
        }
        const context: CommandContext = {
            event,
            message,
            prefix: this.config.prefix,
            args,
            reply: (replyText) => responder.reply(event, replyText),
        }

        try {
            await this.container.resolve(definition.type).execute(context)
            this.logger.info('Command execution completed', {
                ...trace,
                event: 'command.execution',
                outcome: 'success',
                durationMs: elapsedMilliseconds(startedAt),
            })
        } catch (error) {
            this.logger.error('Command execution failed', {
                ...trace,
                event: 'command.execution',
                outcome: 'failure',
                durationMs: elapsedMilliseconds(startedAt),
                err: error,
            })
            throw error
        }
    }
}

function elapsedMilliseconds(startedAt: number): number {
    return Math.round((performance.now() - startedAt) * 100) / 100
}
