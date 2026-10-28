import { CommandRouter } from '../framework/bot/command-router.ts'
import { ZapoBot } from '../framework/bot/zapo-bot.ts'
import { loadCommands } from '../framework/commands/loader.ts'
import { BOT_CONFIG, loadConfig } from '../framework/config.ts'
import { Container } from '../framework/core/di.ts'
import { APP_LOGGER, createAppLogger } from '../framework/core/logger.ts'

export async function bootstrap(): Promise<void> {
    const container = new Container()
    let removeShutdownHooks: (() => void) | undefined

    try {
        await loadCommands(new URL('./commands/', import.meta.url))
        const config = loadConfig()
        container.registerValue(Container, container)
        container.registerValue(BOT_CONFIG, config)
        container.registerValue(
            APP_LOGGER,
            await createAppLogger(config.logLevel),
        )

        // Resolve the object graph through the decorator-driven container.
        container.resolve(CommandRouter)
        const bot = container.resolve(ZapoBot)
        removeShutdownHooks = installShutdownHooks(container)
        await bot.start()
    } catch (error) {
        try {
            await container.dispose()
        } catch (disposeError) {
            throw new AggregateError(
                [error, disposeError],
                'Application startup and cleanup failed.',
            )
        } finally {
            removeShutdownHooks?.()
        }
        throw error
    }
}

function installShutdownHooks(container: Container): () => void {
    let shuttingDown = false

    const shutdown = async (
        exitCode: number,
        exitWhenDisposed: boolean,
    ): Promise<void> => {
        if (shuttingDown) {
            // A second Ctrl+C means the caller no longer wants to wait for
            // graceful cleanup.
            if (exitWhenDisposed) process.exit(exitCode)
            return
        }
        shuttingDown = true

        try {
            await container.dispose()
            process.exitCode = exitCode
        } catch (error) {
            process.exitCode = 1
            console.error('Application shutdown failed.', error)
        } finally {
            // A signal listener disables the runtime's default termination
            // behavior. Disposal may leave third-party handles behind, so a
            // signal-triggered shutdown must explicitly end the process.
            if (exitWhenDisposed) process.exit(process.exitCode ?? exitCode)
        }
    }

    const onSigint = (): void => void shutdown(130, true)
    const onSigterm = (): void => void shutdown(143, true)
    const onBeforeExit = (): void => void shutdown(0, false)

    process.on('SIGINT', onSigint)
    process.on('SIGTERM', onSigterm)
    process.once('beforeExit', onBeforeExit)

    return (): void => {
        process.off('SIGINT', onSigint)
        process.off('SIGTERM', onSigterm)
        process.off('beforeExit', onBeforeExit)
    }
}
