import './commands/index.ts'
import { CommandRouter } from './bot/command-router.ts'
import { ZapoBot } from './bot/zapo-bot.ts'
import { BOT_CONFIG, loadConfig } from './config.ts'
import { Container } from './core/di.ts'
import { APP_LOGGER, createAppLogger } from './core/logger.ts'

export async function bootstrap(): Promise<void> {
    const container = new Container()
    const config = loadConfig()
    container.registerValue(Container, container)
    container.registerValue(BOT_CONFIG, config)
    container.registerValue(APP_LOGGER, await createAppLogger(config.logLevel))

    // Resolve the object graph through the decorator-driven container.
    container.resolve(CommandRouter)
    await container.resolve(ZapoBot).start()
}
