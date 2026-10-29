import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Worker } from 'node:worker_threads';
import type { WaSendMessageContent } from 'zapo-js';
import type {
  CommandContext,
  GroupCommandActions,
} from '../../framework/commands/contracts.ts';

const executeFile = promisify(execFile);
const SHELL_TIMEOUT_MS = 15_000;
const JAVASCRIPT_TIMEOUT_MS = 3_000;
const MAX_OUTPUT_LENGTH = 3_500;
const MAX_SHELL_OUTPUT_BYTES = 16 * 1024;
const WORKER_ENTRYPOINT = new URL(
  './cardinal-execution.worker.ts',
  import.meta.url,
);

export interface JavaScriptExecutionOptions {
  /**
   * Wall-clock limit for the debug snippet. This includes promises returned
   * by the snippet, unlike the VM's synchronous-only timeout.
   */
  readonly timeoutMs?: number;
}

/**
 * The deliberately small, structured-cloneable part of CommandContext that a
 * debug snippet may inspect. Command operations remain in the main thread and
 * are exposed by the worker through fixed RPC methods.
 */
export interface CardinalDebugContextSnapshot {
  readonly event: {
    readonly key: {
      readonly remoteJid?: string;
      readonly participant?: string;
      readonly id?: string;
      readonly fromMe?: boolean;
      readonly isGroup?: boolean;
    };
  };
  readonly message: {
    readonly kind: string;
    readonly text?: string;
    readonly context: {
      readonly mentionedJids: readonly string[];
      readonly quotedMessageId?: string;
      readonly quotedParticipant?: string;
      readonly quotedChatJid?: string;
      readonly isForwarded: boolean;
      readonly forwardingScore?: number;
      readonly expirationSeconds?: number;
    };
  };
  readonly prefix: string;
  readonly args: readonly string[];
  readonly hasGroupActions: boolean;
}

export type CardinalDebugRpcMethod =
  | 'reply'
  | 'send'
  | 'react'
  | 'group.addParticipants'
  | 'group.removeParticipants'
  | 'group.promoteParticipants'
  | 'group.demoteParticipants'
  | 'group.setSubject'
  | 'group.setDescription'
  | 'group.setSetting'
  | 'group.inviteCode'
  | 'group.revokeInvite'
  | 'group.info';

export interface CardinalDebugWorkerStartMessage {
  readonly kind: 'start';
  readonly source: string;
  readonly context: CardinalDebugContextSnapshot;
  readonly timeoutMs: number;
}

export interface CardinalDebugWorkerResultMessage {
  readonly kind: 'result';
  readonly output: string;
}

export interface CardinalDebugWorkerErrorMessage {
  readonly kind: 'error';
  readonly error: string;
}

export interface CardinalDebugWorkerRpcRequestMessage {
  readonly kind: 'rpc';
  readonly id: number;
  readonly method: CardinalDebugRpcMethod;
  readonly args: readonly unknown[];
}

export interface CardinalDebugWorkerRpcResponseMessage {
  readonly kind: 'rpc-result';
  readonly id: number;
  readonly ok: boolean;
  readonly value?: unknown;
  readonly error?: string;
}

type WorkerExecutionOutcome =
  | {
      readonly kind: 'success';
      readonly output: string;
    }
  | {
      readonly kind: 'failure';
      readonly error: Error;
    };

/** Execution helpers used by the Cardinal command group. */
export async function executeShell(command: string): Promise<string> {
  try {
    const { stdout, stderr } = await executeFile('/bin/sh', ['-lc', command], {
      cwd: process.cwd(),
      timeout: SHELL_TIMEOUT_MS,
      maxBuffer: MAX_SHELL_OUTPUT_BYTES,
      encoding: 'utf8',
    });
    return formatOutput('shell', [stdout, stderr].filter(Boolean).join('\n'));
  } catch (error) {
    const details = isShellExecutionError(error)
      ? [error.stdout, error.stderr, error.message].filter(Boolean).join('\n')
      : errorMessage(error);
    return formatOutput('shell error', details);
  }
}

export async function executeJavaScript(
  source: string,
  ctx: CommandContext,
  options: JavaScriptExecutionOptions = {},
): Promise<string> {
  try {
    const timeoutMs = executionTimeout(options.timeoutMs);
    const output = await executeJavaScriptInWorker(source, ctx, timeoutMs);
    return formatOutput('javascript', output || 'undefined');
  } catch (error) {
    return formatOutput(
      'javascript error',
      error instanceof Error ? (error.stack ?? error.message) : String(error),
    );
  }
}

function executionTimeout(requestedTimeoutMs: number | undefined): number {
  const timeoutMs = requestedTimeoutMs ?? JAVASCRIPT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError('JavaScript execution timeout must be positive.');
  }
  return Math.max(1, Math.floor(timeoutMs));
}

function executeJavaScriptInWorker(
  source: string,
  context: CommandContext,
  timeoutMs: number,
): Promise<string> {
  const snapshot = snapshotContext(context);

  return new Promise((resolve, reject) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let worker: Worker;

    const finish = (outcome: WorkerExecutionOutcome): void => {
      if (settled) return;
      settled = true;
      if (timeout !== undefined) clearTimeout(timeout);
      void worker.terminate().catch(() => undefined);

      if (outcome.kind === 'success') {
        resolve(outcome.output);
      } else {
        reject(outcome.error);
      }
    };

    try {
      worker = new Worker(WORKER_ENTRYPOINT);
    } catch (error) {
      reject(error);
      return;
    }

    worker.on('message', (message: unknown) => {
      if (isRpcRequest(message)) {
        void respondToRpcRequest(worker, context, message, () => settled);
        return;
      }
      if (isWorkerResult(message)) {
        finish({ kind: 'success', output: message.output });
        return;
      }
      if (isWorkerError(message)) {
        finish({ kind: 'failure', error: new Error(message.error) });
      }
    });
    worker.on('error', (error) => {
      finish({ kind: 'failure', error: toError(error) });
    });
    worker.on('messageerror', (error) => {
      finish({ kind: 'failure', error: toError(error) });
    });
    worker.on('exit', (code) => {
      if (!settled) {
        finish({
          kind: 'failure',
          error: new Error(
            `JavaScript execution worker exited unexpectedly with code ${code}.`,
          ),
        });
      }
    });

    timeout = setTimeout(() => {
      finish({
        kind: 'failure',
        error: new Error(
          `JavaScript execution timed out after ${timeoutMs}ms.`,
        ),
      });
    }, timeoutMs);

    try {
      const message: CardinalDebugWorkerStartMessage = {
        kind: 'start',
        source,
        context: snapshot,
        timeoutMs,
      };
      worker.postMessage(message);
    } catch (error) {
      finish({ kind: 'failure', error: toError(error) });
    }
  });
}

async function respondToRpcRequest(
  worker: Worker,
  context: CommandContext,
  request: CardinalDebugWorkerRpcRequestMessage,
  isSettled: () => boolean,
): Promise<void> {
  try {
    const value = await invokeContextMethod(
      context,
      request.method,
      request.args,
    );
    if (!isSettled()) {
      postRpcResponse(worker, {
        kind: 'rpc-result',
        id: request.id,
        ok: true,
        value,
      });
    }
  } catch (error) {
    if (!isSettled()) {
      postRpcResponse(worker, {
        kind: 'rpc-result',
        id: request.id,
        ok: false,
        error: errorMessage(error),
      });
    }
  }
}

function postRpcResponse(
  worker: Worker,
  response: CardinalDebugWorkerRpcResponseMessage,
): void {
  try {
    worker.postMessage(response);
  } catch (error) {
    try {
      worker.postMessage({
        kind: 'rpc-result',
        id: response.id,
        ok: false,
        error: `Unable to return command operation result: ${errorMessage(error)}`,
      } satisfies CardinalDebugWorkerRpcResponseMessage);
    } catch {
      // The worker may have been terminated while an operation completed.
    }
  }
}

async function invokeContextMethod(
  context: CommandContext,
  method: CardinalDebugRpcMethod,
  args: readonly unknown[],
): Promise<unknown> {
  switch (method) {
    case 'reply':
      return context.reply(messageContent(args[0]));
    case 'send':
      return context.send(
        stringArgument(args[0], 'jid'),
        messageContent(args[1]),
      );
    case 'react':
      return context.react(
        stringArgument(args[0], 'emoji'),
        optionalBooleanArgument(args[1], 'removeAfterCommand'),
      );
    case 'group.addParticipants':
      return groupActions(context).addParticipants(stringArray(args[0]));
    case 'group.removeParticipants':
      return groupActions(context).removeParticipants(stringArray(args[0]));
    case 'group.promoteParticipants':
      return groupActions(context).promoteParticipants(stringArray(args[0]));
    case 'group.demoteParticipants':
      return groupActions(context).demoteParticipants(stringArray(args[0]));
    case 'group.setSubject':
      return groupActions(context).setSubject(
        stringArgument(args[0], 'subject'),
      );
    case 'group.setDescription':
      return groupActions(context).setDescription(
        stringOrNullArgument(args[0], 'description'),
      );
    case 'group.setSetting':
      return groupActions(context).setSetting(
        groupSettingArgument(args[0]),
        booleanArgument(args[1], 'enabled'),
      );
    case 'group.inviteCode':
      return groupActions(context).inviteCode();
    case 'group.revokeInvite':
      return groupActions(context).revokeInvite();
    case 'group.info':
      return groupActions(context).info();
  }
}

function snapshotContext(
  context: CommandContext,
): CardinalDebugContextSnapshot {
  const key = context.event.key;
  const messageContext = context.message.context;
  return {
    event: {
      key: {
        remoteJid: optionalString(key.remoteJid),
        participant: optionalString(key.participant),
        id: optionalString(key.id),
        fromMe: optionalBoolean(key.fromMe),
        isGroup: optionalBoolean(key.isGroup),
      },
    },
    message: {
      kind: context.message.kind,
      text: optionalString(context.message.text),
      context: {
        mentionedJids: messageContext.mentionedJids.filter(
          (jid): jid is string => typeof jid === 'string',
        ),
        quotedMessageId: optionalString(messageContext.quotedMessageId),
        quotedParticipant: optionalString(messageContext.quotedParticipant),
        quotedChatJid: optionalString(messageContext.quotedChatJid),
        isForwarded: messageContext.isForwarded,
        forwardingScore: optionalNumber(messageContext.forwardingScore),
        expirationSeconds: optionalNumber(messageContext.expirationSeconds),
      },
    },
    prefix: context.prefix,
    args: [...context.args],
    hasGroupActions: context.group !== undefined,
  };
}

function groupActions(context: CommandContext): GroupCommandActions {
  if (!context.group) {
    throw new Error('Group actions are unavailable outside of a group chat.');
  }
  return context.group;
}

function messageContent(value: unknown): WaSendMessageContent {
  if (!isMessageContent(value)) {
    throw new TypeError('content must be a string or message object.');
  }
  return value;
}

function stringArgument(value: unknown, name: string): string {
  if (typeof value !== 'string') {
    throw new TypeError(`${name} must be a string.`);
  }
  return value;
}

function stringOrNullArgument(value: unknown, name: string): string | null {
  if (typeof value !== 'string' && value !== null) {
    throw new TypeError(`${name} must be a string or null.`);
  }
  return value;
}

function stringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new TypeError('participants must be an array of strings.');
  }
  return value;
}

function booleanArgument(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') {
    throw new TypeError(`${name} must be a boolean.`);
  }
  return value;
}

function optionalBooleanArgument(
  value: unknown,
  name: string,
): boolean | undefined {
  if (value === undefined) return undefined;
  return booleanArgument(value, name);
}

function groupSettingArgument(value: unknown): 'announcement' | 'restrict' {
  if (value !== 'announcement' && value !== 'restrict') {
    throw new TypeError('setting must be "announcement" or "restrict".');
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function isWorkerResult(
  value: unknown,
): value is CardinalDebugWorkerResultMessage {
  return (
    isRecord(value) &&
    value.kind === 'result' &&
    typeof value.output === 'string'
  );
}

function isWorkerError(
  value: unknown,
): value is CardinalDebugWorkerErrorMessage {
  return (
    isRecord(value) && value.kind === 'error' && typeof value.error === 'string'
  );
}

function isRpcRequest(
  value: unknown,
): value is CardinalDebugWorkerRpcRequestMessage {
  return (
    isRecord(value) &&
    value.kind === 'rpc' &&
    typeof value.id === 'number' &&
    isRpcMethod(value.method) &&
    Array.isArray(value.args)
  );
}

function isRpcMethod(value: unknown): value is CardinalDebugRpcMethod {
  return (
    value === 'reply' ||
    value === 'send' ||
    value === 'react' ||
    value === 'group.addParticipants' ||
    value === 'group.removeParticipants' ||
    value === 'group.promoteParticipants' ||
    value === 'group.demoteParticipants' ||
    value === 'group.setSubject' ||
    value === 'group.setDescription' ||
    value === 'group.setSetting' ||
    value === 'group.inviteCode' ||
    value === 'group.revokeInvite' ||
    value === 'group.info'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isMessageContent(value: unknown): value is WaSendMessageContent {
  // Zapo accepts a string, a typed message, or a protobuf message. Both message
  // forms are objects and are validated by Zapo when they are serialized.
  return typeof value === 'string' || isRecord(value);
}

function isShellExecutionError(error: unknown): error is ShellExecutionError {
  return (
    isRecord(error) &&
    typeof error.message === 'string' &&
    (error.stdout === undefined || typeof error.stdout === 'string') &&
    (error.stderr === undefined || typeof error.stderr === 'string')
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? (error.stack ?? error.message)
    : String(error);
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function formatOutput(label: string, output: string): string {
  const truncated =
    output.length > MAX_OUTPUT_LENGTH
      ? `${output.slice(0, MAX_OUTPUT_LENGTH)}\n… output truncated`
      : output || '(no output)';
  return `\`${label}\`\n\`\`\`\n${truncated}\n\`\`\``;
}

interface ShellExecutionError {
  readonly message: string;
  readonly stdout?: string;
  readonly stderr?: string;
}
