import type {
    Logger,
    WaIncomingMessageEvent,
    WaSendMessageContent,
} from 'zapo-js'
import {
    type CommandPermission,
    commandChecks,
    commandCooldown,
    commandPermission,
    findCommand,
} from '../commands/command.decorator.ts'
import type {
    CommandAuthorizationContext,
    CommandCheck,
    CommandCheckResult,
    CommandContext,
} from '../commands/contracts.ts'
import type { BotConfig } from '../config.ts'
import { BOT_CONFIG } from '../config.ts'
import { Container, Injectable } from '../core/di.ts'
import { normalizeUserJid, userIdFromJid } from '../core/jid.ts'
import { APP_LOGGER } from '../core/logger.ts'
import { RoleStore } from '../roles/role-store.ts'
import { CommandCooldownTracker } from './command-cooldown.ts'
import { parseIncomingMessage } from './message.ts'

export interface MessageResponder {
    reply(
        event: WaIncomingMessageEvent,
        content: WaSendMessageContent,
    ): Promise<void>
    send(jid: string, content: WaSendMessageContent): Promise<void>
    react(event: WaIncomingMessageEvent, emoji: string): Promise<void>
}

export type GroupAdminResolver = (
    event: WaIncomingMessageEvent,
) => Promise<boolean>

export type SelfJids = readonly string[]

interface AuthorizationResult {
    readonly allowed: boolean
    readonly reason?: string
    readonly error?: unknown
}

@Injectable([
    Container,
    BOT_CONFIG,
    RoleStore,
    CommandCooldownTracker,
    APP_LOGGER,
])
export class CommandRouter {
    constructor(
        private readonly container: Container,
        private readonly config: BotConfig,
        private readonly roleStore: RoleStore,
        private readonly cooldownTracker: CommandCooldownTracker,
        private readonly logger: Logger,
    ) {}

    async handle(
        event: WaIncomingMessageEvent,
        responder: MessageResponder,
        isGroupAdmin: GroupAdminResolver,
        selfJids: SelfJids,
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
        const senderAddresses = senderAddressesFor(event, selfJids)
        const senderJids = senderAddresses
            .map(normalizeUserJid)
            .filter((jid): jid is string => jid !== undefined)
        const senderIds = senderAddresses
            .map(userIdFromJid)
            .filter((id): id is string => id !== undefined)
        const trace = {
            command: definition.name,
            invokedAs: rawCommand.toLowerCase(),
            chatJid: event.key.remoteJid,
            messageId: event.key.id,
            fromMe: event.key.fromMe,
            senderJid: senderJids[0],
            senderId: senderIds[0],
        }
        const isSuperuser =
            this.config.superuserId !== undefined &&
            senderIds.includes(this.config.superuserId)
        const authorizationContext: CommandAuthorizationContext = {
            event,
            message,
            prefix: this.config.prefix,
            args,
            senderJids,
            senderIds,
            isGroup: event.key.isGroup,
            isSuperuser,
            isBotModerator: () => hasModeratorRole(this.roleStore, senderJids),
            isGroupAdmin: () =>
                event.key.isGroup
                    ? isGroupAdmin(event)
                    : Promise.resolve(false),
        }
        const permission = commandPermission(definition.type)
        const authorization = await this.authorize(
            permission,
            authorizationContext,
            commandChecks(definition.type),
        )
        if (!authorization.allowed) {
            this.logger.warn('Command execution denied', {
                ...trace,
                event: 'command.authorization',
                outcome: 'denied',
                permission,
                reason: authorization.reason,
                durationMs: elapsedMilliseconds(startedAt),
                err: authorization.error,
            })
            await responder.reply(
                event,
                'You do not have permission to use this command.',
            )
            return
        }

        const cooldownMs = commandCooldown(definition.type)
        const cooldownSender =
            senderJids.find((jid) => jid.endsWith('@s.whatsapp.net')) ??
            senderJids[0] ??
            senderIds[0]
        if (cooldownMs !== undefined && cooldownSender !== undefined) {
            const cooldown = this.cooldownTracker.tryAcquire(
                definition.name,
                cooldownSender,
                cooldownMs,
            )
            if (!cooldown.allowed) {
                const remainingMs = cooldown.remainingMs ?? cooldownMs
                this.logger.warn('Command execution blocked by cooldown', {
                    ...trace,
                    event: 'command.cooldown',
                    outcome: 'denied',
                    cooldownMs,
                    remainingMs,
                })
                await responder.reply(
                    event,
                    `This command is on cooldown. Try again in ${formatCooldown(remainingMs)}.`,
                )
                return
            }
        }

        let removeReactionAfterCommand = false
        const context: CommandContext = {
            event,
            message,
            prefix: this.config.prefix,
            args,
            reply: (content) => responder.reply(event, content),
            send: (jid, content) => responder.send(jid, content),
            react: async (emoji, shouldRemoveAfterCommand = false) => {
                removeReactionAfterCommand ||= shouldRemoveAfterCommand
                await responder.react(event, emoji)
            },
        }

        try {
            await this.container.resolve(definition.type).execute(context)
            if (removeReactionAfterCommand) {
                await responder.react(event, '')
            }
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

    private async authorize(
        permission: CommandPermission,
        context: CommandAuthorizationContext,
        checks: readonly CommandCheck[],
    ): Promise<AuthorizationResult> {
        if (context.senderJids.length === 0 && context.senderIds.length === 0) {
            return { allowed: false, reason: 'missing_sender' }
        }

        // Preserve the documented superuser override for every command,
        // including commands with application-specific checks.
        if (context.isSuperuser) {
            return { allowed: true }
        }

        const builtInAuthorization = await this.authorizePermission(
            permission,
            context,
        )
        if (!builtInAuthorization.allowed) return builtInAuthorization

        for (const check of checks) {
            try {
                const result = normalizeCheckResult(await check(context))
                if (!result.allowed) {
                    return {
                        allowed: false,
                        reason: result.reason ?? 'custom_check_denied',
                    }
                }
            } catch (error) {
                return {
                    allowed: false,
                    reason: 'custom_check_failed',
                    error,
                }
            }
        }

        return { allowed: true }
    }

    private async authorizePermission(
        permission: CommandPermission,
        context: CommandAuthorizationContext,
    ): Promise<AuthorizationResult> {
        switch (permission) {
            case 'public':
                return { allowed: true }
            case 'bot-superuser':
                return { allowed: false, reason: 'superuser_required' }
            case 'bot-moderator':
                return (await context.isBotModerator())
                    ? { allowed: true }
                    : { allowed: false, reason: 'moderator_required' }
            case 'group-admin':
                if (!context.isGroup) {
                    return { allowed: false, reason: 'group_required' }
                }
                return (await context.isGroupAdmin())
                    ? { allowed: true }
                    : { allowed: false, reason: 'group_admin_required' }
        }
    }
}

function senderAddressesFor(
    event: WaIncomingMessageEvent,
    selfJids: SelfJids,
): readonly string[] {
    if (event.key.fromMe) return selfJids

    const primary = event.key.participant ?? event.key.remoteJid
    const alternate = event.key.participant
        ? event.key.participantAlt
        : event.key.remoteJidAlt
    return [primary, alternate].filter(
        (jid): jid is string => jid !== undefined,
    )
}

async function hasModeratorRole(
    roleStore: RoleStore,
    senderJids: readonly string[],
): Promise<boolean> {
    for (const jid of senderJids) {
        if (await roleStore.isModerator(jid)) return true
    }
    return false
}

function normalizeCheckResult(
    result: CommandCheckResult,
): Pick<AuthorizationResult, 'allowed' | 'reason'> {
    return typeof result === 'boolean' ? { allowed: result } : result
}

function elapsedMilliseconds(startedAt: number): number {
    return Math.round((performance.now() - startedAt) * 100) / 100
}

function formatCooldown(remainingMs: number): string {
    const remainingSeconds = Math.max(1, Math.ceil(remainingMs / 1_000))
    const minutes = Math.floor(remainingSeconds / 60)
    const seconds = remainingSeconds % 60
    if (minutes === 0) return `${seconds}s`
    if (seconds === 0) return `${minutes}m`
    return `${minutes}m ${seconds}s`
}
