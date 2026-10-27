import type { LogLevel } from 'zapo-js'

export interface BotConfig {
    readonly prefix: string
    readonly sessionId: string
    readonly authPath: string
    readonly pairingPhoneNumber?: string
    readonly logLevel: LogLevel
}

export const BOT_CONFIG = Symbol('BOT_CONFIG')

function nonEmpty(value: string | undefined, fallback: string): string {
    return value?.trim() || fallback
}

function logLevel(value: string | undefined): LogLevel {
    const level = nonEmpty(value, 'info').toLowerCase()
    if (
        level !== 'trace' &&
        level !== 'debug' &&
        level !== 'info' &&
        level !== 'warn' &&
        level !== 'error'
    ) {
        throw new Error(
            'BOT_LOG_LEVEL must be one of: trace, debug, info, warn, error.',
        )
    }
    return level
}

export function loadConfig(environment = Bun.env): BotConfig {
    const prefix = nonEmpty(environment.BOT_PREFIX, '!')
    if (prefix.length > 3) {
        throw new Error('BOT_PREFIX must be at most 3 characters.')
    }

    const pairingPhoneNumber = environment.BOT_PAIRING_PHONE?.trim()
    if (pairingPhoneNumber && !/^\d{7,15}$/.test(pairingPhoneNumber)) {
        throw new Error(
            'BOT_PAIRING_PHONE must contain 7–15 digits, including the country code.',
        )
    }

    return {
        prefix,
        sessionId: nonEmpty(environment.BOT_SESSION_ID, 'rin'),
        authPath: nonEmpty(environment.BOT_AUTH_PATH, '.auth/state.sqlite'),
        pairingPhoneNumber,
        logLevel: logLevel(environment.BOT_LOG_LEVEL),
    }
}
