import type { Fetch } from '@typesafe-ai/sdk'

/**
 * Bun marks a Response as consumed when the TypeSafe SDK's response-buffering
 * path obtains a reader for it. Hide that reader from the SDK so it drains its
 * clone and can still parse the original response.
 */
export const typeSafeFetch: Fetch = async (input, init) =>
    typeSafeResponse(await globalThis.fetch(input, init))

export function typeSafeResponse(response: Response): Response {
    return new Proxy(response, {
        get(target, property) {
            if (property === 'body') return undefined
            const value = Reflect.get(target, property, target)
            return typeof value === 'function' ? value.bind(target) : value
        },
    }) as Response
}
