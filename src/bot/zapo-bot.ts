import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createSqliteStore } from '@zapo-js/store-sqlite'
import * as terminalQr from 'qrcode-terminal'
import type { Logger, WaIncomingMessageEvent } from 'zapo-js'
import { createStore, WaClient } from 'zapo-js'
import type { BotConfig } from '../config.ts'
import { BOT_CONFIG } from '../config.ts'
import { Injectable } from '../core/di.ts'
import { normalizeUserJid } from '../core/jid.ts'
import { APP_LOGGER } from '../core/logger.ts'
import { CommandRouter } from './command-router.ts'

@Injectable([BOT_CONFIG, CommandRouter, APP_LOGGER])
export class ZapoBot {
    constructor(
        private readonly config: BotConfig,
        private readonly commandRouter: CommandRouter,
        private readonly logger: Logger,
    ) {}

    async start(): Promise<void> {
        await mkdir(dirname(this.config.authPath), { recursive: true })

        const store = createStore({
            backends: {
                sqlite: createSqliteStore({
                    path: this.config.authPath,
                    driver: 'auto',
                }),
            },
            providers: {
                auth: 'sqlite',
                signal: 'sqlite',
                preKey: 'sqlite',
                session: 'sqlite',
                identity: 'sqlite',
                senderKey: 'sqlite',
                appState: 'sqlite',
                privacyToken: 'sqlite',
                messages: 'sqlite',
                threads: 'sqlite',
                contacts: 'sqlite',
            },
        })

        const client = new WaClient(
            {
                store,
                sessionId: this.config.sessionId,
                connectTimeoutMs: 15_000,
                nodeQueryTimeoutMs: 30_000,
            },
            this.logger,
        )

        let pairingCodeRequestInFlight = false
        let displayedPairingCode: string | undefined

        const displayPairingCode = (code: string): void => {
            if (code === displayedPairingCode) return

            displayedPairingCode = code
            const displayCode = code.match(/.{1,4}/g)?.join('-') ?? code
            this.logger.info('WhatsApp pairing code received', {
                event: 'auth.pairing_code',
                phoneNumber: this.config.pairingPhoneNumber,
                pairingCode: displayCode,
            })
        }

        const requestPairingCode = async (): Promise<void> => {
            const phoneNumber = this.config.pairingPhoneNumber
            if (
                !phoneNumber ||
                pairingCodeRequestInFlight ||
                displayedPairingCode
            )
                return

            pairingCodeRequestInFlight = true
            try {
                displayPairingCode(
                    await client.auth.requestPairingCode(phoneNumber),
                )
            } catch (error) {
                this.logger.error('Unable to request a WhatsApp pairing code', {
                    event: 'auth.pairing_code_request',
                    err: error,
                })
            } finally {
                pairingCodeRequestInFlight = false
            }
        }

        client.on('auth_qr', ({ qr, ttlMs }) => {
            if (this.config.pairingPhoneNumber) {
                // Zapo permits a code request once the first QR is available.
                void requestPairingCode()
                return
            }
            this.logger.info('WhatsApp QR code received', {
                event: 'auth.qr',
                expiresInSeconds: Math.ceil(ttlMs / 1000),
            })
            terminalQr.generate(qr, { small: true })
        })

        client.on('auth_pairing_required', () => void requestPairingCode())
        client.on('auth_pairing_code', ({ code }) => displayPairingCode(code))

        client.on('auth_paired', ({ credentials }) => {
            this.logger.info('WhatsApp paired', {
                event: 'auth.paired',
                accountJid: credentials.meJid,
            })
        })

        client.on('connection', ({ status, reason }) => {
            this.logger.info('WhatsApp connection updated', {
                event: 'connection.updated',
                status,
                reason,
            })
        })

        client.on('message', (event) =>
            this.handleIncomingMessage(client, event),
        )

        await client.connect()
    }

    private async handleIncomingMessage(
        client: InstanceType<typeof WaClient>,
        event: WaIncomingMessageEvent,
    ): Promise<void> {
        try {
            await this.commandRouter.handle(
                event,
                {
                    reply: async (incoming, content) => {
                        const chatJid = incoming.key.remoteJid
                        if (!chatJid) return
                        await client.message.send(chatJid, content, {
                            quote: incoming,
                        })
                    },
                    send: async (jid, content) => {
                        await client.message.send(jid, content)
                    },
                    react: async (incoming, emoji) => {
                        const chatJid = incoming.key.remoteJid
                        if (!chatJid) return
                        await client.message.send(chatJid, {
                            type: 'reaction',
                            emoji,
                            target: incoming,
                        })
                    },
                    remove: async (incoming) => {
                        const chatJid = incoming.key.remoteJid
                        if (!chatJid) return
                        await client.message.send(chatJid, {
                            type: 'revoke',
                            target: incoming,
                        })
                    },
                },
                (incoming) => this.isSenderGroupAdmin(client, incoming),
                selfJids(client),
            )
        } catch (error) {
            this.logger.error('Unable to process incoming message', {
                event: 'message.processing',
                messageId: event.key.id,
                chatJid: event.key.remoteJid,
                err: error,
            })
        }
    }

    private async isSenderGroupAdmin(
        client: InstanceType<typeof WaClient>,
        event: WaIncomingMessageEvent,
    ): Promise<boolean> {
        const groupJid = event.key.remoteJid
        const senderJid = event.key.participant
        if (!event.key.isGroup || !groupJid || !senderJid) return false

        try {
            const senderJids = new Set(
                [
                    normalizeUserJid(senderJid),
                    ...(event.key.participantAlt
                        ? [normalizeUserJid(event.key.participantAlt)]
                        : []),
                ].filter((jid): jid is string => jid !== undefined),
            )
            const metadata = await client.group.queryGroupMetadata(groupJid)
            return metadata.participants.some(
                (participant) =>
                    participant.isAdmin &&
                    [participant.jid, participant.lid, participant.phoneNumber]
                        .filter((jid): jid is string => jid !== undefined)
                        .map(normalizeUserJid)
                        .some(
                            (participantJid) =>
                                participantJid !== undefined &&
                                senderJids.has(participantJid),
                        ),
            )
        } catch (error) {
            this.logger.warn(
                'Unable to verify whether the command sender is a group admin',
                {
                    event: 'command.authorization',
                    chatJid: groupJid,
                    messageId: event.key.id,
                    err: error,
                },
            )
            return false
        }
    }
}

function selfJids(client: InstanceType<typeof WaClient>): readonly string[] {
    const credentials = client.getCredentials()
    return [credentials?.meJid, credentials?.meLid].filter(
        (jid): jid is string => jid !== undefined,
    )
}
