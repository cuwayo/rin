import type { LogLevel } from 'zapo-js'
import { createToken } from './core/di.ts'

export interface BotConfig {
    readonly prefix: string
    readonly sessionId: string
    readonly authPath: string
    readonly pairingPhoneNumber?: string
    readonly logLevel: LogLevel
    /** The sole WhatsApp account number permitted to execute every command. */
    readonly superuserId?: string
    /** SQLite database that stores bot moderator assignments. */
    readonly roleDbPath: string
}

export const BOT_CONFIG = createToken<BotConfig>('BOT_CONFIG')

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

function superuserId(
    value: string | undefined,
    variableName: string,
): string | undefined {
    const candidate = value?.trim()
    if (!candidate) return undefined
    if (/^\d{7,15}$/.test(candidate)) {
        return candidate
    }

    throw new Error(
        `${variableName} must contain only a 7–15 digit WhatsApp phone number.`,
    )
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
        superuserId: superuserId(
            environment.BOT_SUPERUSER_ID,
            'BOT_SUPERUSER_ID',
        ),
        roleDbPath: nonEmpty(
            environment.BOT_ROLE_DB_PATH,
            '.auth/roles.sqlite',
        ),
    }
}
