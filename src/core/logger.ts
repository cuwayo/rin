import type { Logger, LogLevel } from 'zapo-js'
import { createPinoLogger } from 'zapo-js'

export const APP_LOGGER = Symbol('APP_LOGGER')

export function createAppLogger(level: LogLevel): Promise<Logger> {
    return createPinoLogger({
        level,
        name: 'rin',
    })
}
