import { execFile } from 'node:child_process'
import { inspect, promisify } from 'node:util'
import { runInNewContext } from 'node:vm'
import { Injectable } from '../core/di.ts'
import { Command, Superuser } from './command.decorator.ts'
import type { BotCommand, CommandContext } from './contracts.ts'

const executeFile = promisify(execFile)
const SHELL_TIMEOUT_MS = 15_000
const JAVASCRIPT_TIMEOUT_MS = 3_000
const MAX_OUTPUT_LENGTH = 3_500
const MAX_SHELL_OUTPUT_BYTES = 16 * 1024

@Command({
    name: 'console',
    description: 'Run a superuser terminal command.',
    category: 'Developer',
})
@Superuser()
@Injectable()
export class ConsoleCommand implements BotCommand {
    async execute(context: CommandContext): Promise<void> {
        const command = context.args.join(' ')
        if (!command) {
            await context.reply(`Usage: ${context.prefix}console <command>`)
            return
        }

        await context.reply(await executeShell(command))
    }
}

@Command({
    name: 'debug',
    description: 'Run a superuser JavaScript debugging snippet.',
    category: 'Developer',
})
@Superuser()
@Injectable()
export class DebugCommand implements BotCommand {
    async execute(context: CommandContext): Promise<void> {
        const source = context.args.join(' ')
        if (!source) {
            await context.reply(
                `Usage: ${context.prefix}debug <expression-or-statements>`,
            )
            return
        }

        await context.reply(await executeJavaScript(source, context))
    }
}

async function executeShell(command: string): Promise<string> {
    try {
        const { stdout, stderr } = await executeFile(
            '/bin/sh',
            ['-lc', command],
            {
                cwd: process.cwd(),
                timeout: SHELL_TIMEOUT_MS,
                maxBuffer: MAX_SHELL_OUTPUT_BYTES,
                encoding: 'utf8',
            },
        )
        return formatOutput(
            'shell',
            [stdout, stderr].filter(Boolean).join('\n'),
        )
    } catch (error) {
        const failure = error as ShellExecutionError
        const details = [failure.stdout, failure.stderr, failure.message]
            .filter(Boolean)
            .join('\n')
        return formatOutput('shell error', details)
    }
}

async function executeJavaScript(
    source: string,
    ctx: CommandContext,
): Promise<string> {
    const logs: string[] = []
    const debugConsole = {
        log: (...values: unknown[]): void => {
            logs.push(formatValues(values))
        },
        info: (...values: unknown[]): void => {
            logs.push(formatValues(values))
        },
        warn: (...values: unknown[]): void => {
            logs.push(formatValues(values))
        },
        error: (...values: unknown[]): void => {
            logs.push(formatValues(values))
        },
    }

    try {
        const result = await runInNewContext(
            source,
            { console: debugConsole, ctx },
            {
                timeout: JAVASCRIPT_TIMEOUT_MS,
            },
        )
        const output = [...logs, inspect(result, { depth: 4 })]
            .filter((value) => value !== 'undefined')
            .join('\n')
        return formatOutput('javascript', output || 'undefined')
    } catch (error) {
        return formatOutput(
            'javascript error',
            error instanceof Error
                ? (error.stack ?? error.message)
                : String(error),
        )
    }
}

function formatValues(values: readonly unknown[]): string {
    return values.map((value) => inspect(value, { depth: 4 })).join(' ')
}

function formatOutput(label: string, output: string): string {
    const truncated =
        output.length > MAX_OUTPUT_LENGTH
            ? `${output.slice(0, MAX_OUTPUT_LENGTH)}\n… output truncated`
            : output || '(no output)'
    return `\`${label}\`\n\`\`\`\n${truncated}\n\`\`\``
}

interface ShellExecutionError {
    readonly message: string
    readonly stdout?: string
    readonly stderr?: string
}
