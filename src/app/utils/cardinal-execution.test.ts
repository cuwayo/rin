import { expect, test } from 'bun:test';
import type { CommandContext } from '../../framework/commands/contracts.ts';
import { executeJavaScript } from './cardinal-execution.ts';

test('evaluates JavaScript in a worker and preserves a safe command snapshot', async () => {
  const replies: string[] = [];

  const output = await executeJavaScript(
    [
      '(async () => {',
      "  await ctx.reply(ctx.prefix + ':' + ctx.args.join(','))",
      '  console.log(ctx.message.context.mentionedJids[0])',
      '  return ctx.event.key.remoteJid',
      '})()',
    ].join('\n'),
    executionContext(replies),
    { timeoutMs: 1_000 },
  );

  expect(replies).toEqual(['!:first,second']);
  expect(output).toContain('628111111111@s.whatsapp.net');
  expect(output).toContain("'1234567890@g.us'");
});

test('enforces a wall-clock timeout for unresolved async JavaScript', async () => {
  const startedAt = performance.now();
  const output = await executeJavaScript(
    'new Promise(() => {})',
    executionContext(),
    { timeoutMs: 100 },
  );

  expect(output).toContain('javascript error');
  expect(output).toContain('timed out after 100ms');
  expect(performance.now() - startedAt).toBeLessThan(2_000);
});

test('enforces a wall-clock timeout for synchronous JavaScript', async () => {
  const startedAt = performance.now();
  const output = await executeJavaScript(
    'while (true) {}',
    executionContext(),
    { timeoutMs: 100 },
  );

  expect(output).toContain('javascript error');
  expect(output).toContain('timed out');
  expect(performance.now() - startedAt).toBeLessThan(2_000);
});

function executionContext(replies: string[] = []): CommandContext {
  return {
    event: {
      key: {
        remoteJid: '1234567890@g.us',
        participant: '628111111111@s.whatsapp.net',
        id: 'message-id',
        fromMe: false,
        isGroup: true,
      },
    } as CommandContext['event'],
    message: {
      kind: 'text',
      text: '!cardinal debug',
      context: {
        mentionedJids: ['628111111111@s.whatsapp.net'],
        isForwarded: false,
      },
      raw: {},
    },
    prefix: '!',
    args: ['first', 'second'],
    reply: async (content) => {
      if (typeof content === 'string') replies.push(content);
    },
    send: async () => undefined,
    react: async () => undefined,
  };
}
