import type { Logger, LogLevel } from 'zapo-js'
import { createPinoLogger } from 'zapo-js'
import { createToken } from './di.ts'

export const APP_LOGGER = createToken<Logger>('APP_LOGGER')

export function createAppLogger(level: LogLevel): Promise<Logger> {
    return createPinoLogger({
        level,
        name: 'rin',
    })
}
