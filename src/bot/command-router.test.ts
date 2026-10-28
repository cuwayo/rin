import { expect, test } from 'bun:test'
import type { Logger, WaIncomingMessageEvent } from 'zapo-js'
import { Command, Cooldown } from '../commands/command.decorator.ts'
import type { BotCommand, CommandContext } from '../commands/contracts.ts'
import type { BotConfig } from '../config.ts'
import { Container, Injectable } from '../core/di.ts'
import type { RoleStore } from '../roles/role-store.ts'
import { CommandCooldownTracker } from './command-cooldown.ts'
import { CommandRouter, type MessageResponder } from './command-router.ts'

@Command({
    name: 'router-cooldown-test',
    description: 'Test command cooldowns in the router.',
})
@Cooldown(1_000)
@Injectable()
class RouterCooldownCommand implements BotCommand {
    static executions = 0

    async execute(_context: CommandContext): Promise<void> {
        RouterCooldownCommand.executions += 1
    }
}

test('does not execute a command again while its sender cooldown is active', async () => {
    RouterCooldownCommand.executions = 0
    let now = 0
    const router = new CommandRouter(
        new Container(),
        testConfig,
        {} as RoleStore,
        new CommandCooldownTracker(() => now),
        silentLogger,
    )
    const replies: unknown[] = []
    const responder: MessageResponder = {
        reply: async (_event, content) => {
            replies.push(content)
        },
        send: async () => undefined,
        react: async () => undefined,
    }

    await router.handle(commandEvent(), responder, async () => false, [])
    now += 250
    await router.handle(commandEvent(), responder, async () => false, [])

    expect(RouterCooldownCommand.executions).toBe(1)
    expect(replies).toEqual(['This command is on cooldown. Try again in 1s.'])
})

const testConfig: BotConfig = {
    prefix: '!',
    sessionId: 'test',
    authPath: ':memory:',
    logLevel: 'info',
    roleDbPath: ':memory:',
}

const silentLogger = {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
} as unknown as Logger

function commandEvent(): WaIncomingMessageEvent {
    return {
        key: {
            remoteJid: '628123456789@s.whatsapp.net',
            id: crypto.randomUUID(),
            fromMe: false,
            isGroup: false,
        },
        message: {
            conversation: '!router-cooldown-test',
        },
    } as unknown as WaIncomingMessageEvent
}
