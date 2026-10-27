import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createSqliteStore } from '@zapo-js/store-sqlite'
import * as terminalQr from 'qrcode-terminal'
import type { WaIncomingMessageEvent } from 'zapo-js'
import { createPinoLogger, createStore, WaClient } from 'zapo-js'
import type { BotConfig } from '../config.ts'
import { BOT_CONFIG } from '../config.ts'
import { Injectable } from '../core/di.ts'
import { CommandRouter } from './command-router.ts'

@Injectable([BOT_CONFIG, CommandRouter])
export class ZapoBot {
    constructor(
        private readonly config: BotConfig,
        private readonly commandRouter: CommandRouter,
    ) {}

    async start(): Promise<void> {
        await mkdir(dirname(this.config.authPath), { recursive: true })

        const logger = await createPinoLogger({ level: 'info', pretty: true })
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
            logger,
        )

        let pairingCodeRequestInFlight = false
        let displayedPairingCode: string | undefined

        const displayPairingCode = (code: string): void => {
            if (code === displayedPairingCode) return

            displayedPairingCode = code
            const displayCode = code.match(/.{1,4}/g)?.join('-') ?? code
            console.log(
                `\nOn ${this.config.pairingPhoneNumber}, open Linked devices → Link with phone number instead.`,
            )
            console.log(`Enter this pairing code: ${displayCode}`)
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
                console.error(
                    'Unable to request a WhatsApp pairing code:',
                    error,
                )
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
            console.log(
                `\nScan this WhatsApp QR code within ${Math.ceil(ttlMs / 1000)} seconds:`,
            )
            terminalQr.generate(qr, { small: true })
        })

        client.on('auth_pairing_required', () => void requestPairingCode())
        client.on('auth_pairing_code', ({ code }) => displayPairingCode(code))

        client.on('auth_paired', ({ credentials }) => {
            console.log(`Paired as ${credentials.meJid}`)
        })

        client.on('connection', ({ status, reason }) => {
            console.log(
                `WhatsApp connection: ${status}${reason ? ` (${reason})` : ''}`,
            )
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
            await this.commandRouter.handle(event, {
                reply: async (incoming, text) => {
                    const chatJid = incoming.key.remoteJid
                    if (!chatJid) return
                    await client.message.send(chatJid, text, {
                        quote: incoming,
                    })
                },
            })
        } catch (error) {
            console.error('Unable to process incoming command:', error)
        }
    }
}
