export interface BotConfig {
    readonly prefix: string
    readonly sessionId: string
    readonly authPath: string
    readonly pairingPhoneNumber?: string
}

export const BOT_CONFIG = Symbol('BOT_CONFIG')

function nonEmpty(value: string | undefined, fallback: string): string {
    return value?.trim() || fallback
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
    }
}
