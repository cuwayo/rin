import { inspect } from 'node:util'
import { runInNewContext } from 'node:vm'
import { parentPort } from 'node:worker_threads'
import type {
    CardinalDebugContextSnapshot,
    CardinalDebugRpcMethod,
    CardinalDebugWorkerErrorMessage,
    CardinalDebugWorkerResultMessage,
    CardinalDebugWorkerRpcRequestMessage,
    CardinalDebugWorkerRpcResponseMessage,
    CardinalDebugWorkerStartMessage,
} from './cardinal-execution.ts'

const MAX_CAPTURED_OUTPUT_LENGTH = 8_000
const INSPECT_OPTIONS = {
    depth: 4,
    maxArrayLength: 100,
    maxStringLength: 1_000,
} as const

const parentMessagePort = parentPort
if (!parentMessagePort) {
    throw new Error(
        'Cardinal JavaScript worker must have a parent message port.',
    )
}
const port = parentMessagePort

port.once('message', (message: unknown) => {
    if (!isStartMessage(message)) {
        postError(new Error('Invalid JavaScript worker request.'))
        return
    }

    void execute(message).then(
        (output) => {
            const response: CardinalDebugWorkerResultMessage = {
                kind: 'result',
                output,
            }
            port.postMessage(response)
        },
        (error) => {
            postError(error)
        },
    )
})

async function execute(
    message: CardinalDebugWorkerStartMessage,
): Promise<string> {
    const { console, logs } = createDebugConsole()
    const ctx = createContextFacade(message.context)
    const result = await runInNewContext(
        message.source,
        { console, ctx },
        { timeout: message.timeoutMs },
    )
    const output = [...logs, inspect(result, INSPECT_OPTIONS)]
        .filter((value) => value !== 'undefined')
        .join('\n')
    return output || 'undefined'
}

function createDebugConsole(): {
    readonly console: {
        readonly log: (...values: unknown[]) => void
        readonly info: (...values: unknown[]) => void
        readonly warn: (...values: unknown[]) => void
        readonly error: (...values: unknown[]) => void
    }
    readonly logs: readonly string[]
} {
    const logs: string[] = []
    let outputLength = 0
    let outputTruncated = false

    const capture = (...values: unknown[]): void => {
        if (outputTruncated) return

        const output = values
            .map((value) => inspect(value, INSPECT_OPTIONS))
            .join(' ')
        const remaining = MAX_CAPTURED_OUTPUT_LENGTH - outputLength
        if (remaining <= 0) {
            outputTruncated = true
            return
        }

        logs.push(output.slice(0, remaining))
        outputLength += Math.min(output.length, remaining)
        if (output.length > remaining) {
            logs.push('… debug output capture truncated')
            outputTruncated = true
        }
    }

    return {
        console: {
            log: capture,
            info: capture,
            warn: capture,
            error: capture,
        },
        logs,
    }
}

function createContextFacade(
    snapshot: CardinalDebugContextSnapshot,
): Readonly<Record<string, unknown>> {
    const group = snapshot.hasGroupActions
        ? Object.freeze({
              addParticipants: (participants: unknown) =>
                  rpc('group.addParticipants', [participants]),
              removeParticipants: (participants: unknown) =>
                  rpc('group.removeParticipants', [participants]),
              promoteParticipants: (participants: unknown) =>
                  rpc('group.promoteParticipants', [participants]),
              demoteParticipants: (participants: unknown) =>
                  rpc('group.demoteParticipants', [participants]),
              setSubject: (subject: unknown) =>
                  rpc('group.setSubject', [subject]),
              setDescription: (description: unknown) =>
                  rpc('group.setDescription', [description]),
              setSetting: (setting: unknown, enabled: unknown) =>
                  rpc('group.setSetting', [setting, enabled]),
              inviteCode: () => rpc('group.inviteCode', []),
              revokeInvite: () => rpc('group.revokeInvite', []),
              info: () => rpc('group.info', []),
          })
        : undefined

    return Object.freeze({
        event: deepFreeze(snapshot.event),
        message: deepFreeze(snapshot.message),
        prefix: snapshot.prefix,
        args: Object.freeze([...snapshot.args]),
        reply: (content: unknown) => rpc('reply', [content]),
        send: (jid: unknown, content: unknown) => rpc('send', [jid, content]),
        react: (emoji: unknown, removeAfterCommand?: unknown) =>
            rpc('react', [emoji, removeAfterCommand]),
        group,
    })
}

let nextRequestId = 1
const pendingRequests = new Map<
    number,
    {
        readonly resolve: (value: unknown) => void
        readonly reject: (reason: unknown) => void
    }
>()

port.on('message', (message: unknown) => {
    if (!isRpcResponse(message)) return
    const request = pendingRequests.get(message.id)
    if (!request) return

    pendingRequests.delete(message.id)
    if (message.ok) {
        request.resolve(message.value)
    } else {
        request.reject(new Error(message.error ?? 'Command operation failed.'))
    }
})

function rpc(
    method: CardinalDebugRpcMethod,
    args: readonly unknown[],
): Promise<unknown> {
    return new Promise((resolve, reject) => {
        const id = nextRequestId
        nextRequestId += 1
        pendingRequests.set(id, { resolve, reject })

        try {
            const request: CardinalDebugWorkerRpcRequestMessage = {
                kind: 'rpc',
                id,
                method,
                args,
            }
            port.postMessage(request)
        } catch (error) {
            pendingRequests.delete(id)
            reject(error)
        }
    })
}

function postError(error: unknown): void {
    const response: CardinalDebugWorkerErrorMessage = {
        kind: 'error',
        error:
            error instanceof Error
                ? (error.stack ?? error.message)
                : String(error),
    }
    port.postMessage(response)
}

function isStartMessage(
    value: unknown,
): value is CardinalDebugWorkerStartMessage {
    return (
        isRecord(value) &&
        value.kind === 'start' &&
        typeof value.source === 'string' &&
        typeof value.timeoutMs === 'number' &&
        isRecord(value.context)
    )
}

function isRpcResponse(
    value: unknown,
): value is CardinalDebugWorkerRpcResponseMessage {
    return (
        isRecord(value) &&
        value.kind === 'rpc-result' &&
        typeof value.id === 'number' &&
        typeof value.ok === 'boolean' &&
        (value.error === undefined || typeof value.error === 'string')
    )
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null
}

function deepFreeze<T>(value: T): T {
    if (typeof value !== 'object' || value === null || Object.isFrozen(value)) {
        return value
    }
    for (const item of Object.values(value)) {
        deepFreeze(item)
    }
    return Object.freeze(value)
}
