import './commands/index.ts'
import { CommandRouter } from './bot/command-router.ts'
import { ZapoBot } from './bot/zapo-bot.ts'
import { BOT_CONFIG, loadConfig } from './config.ts'
import { Container } from './core/di.ts'

export async function bootstrap(): Promise<void> {
    const container = new Container()
    container.registerValue(Container, container)
    container.registerValue(BOT_CONFIG, loadConfig())

    // Resolve the object graph through the decorator-driven container.
    container.resolve(CommandRouter)
    await container.resolve(ZapoBot).start()
}
