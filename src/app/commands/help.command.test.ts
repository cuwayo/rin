import { expect, test } from 'bun:test';
import type { CommandContext } from '../../framework/commands/contracts.ts';
import { CardinalCommand } from './cardinal.command.ts';
import { GroupCommand } from './group.command.ts';
import { HelpCommand } from './help.command.ts';

test('lists command groups without exposing their subcommands', async () => {
  void CardinalCommand;
  void GroupCommand;

  const replies: string[] = [];
  const context: CommandContext = {
    event: {} as CommandContext['event'],
    message: {
      kind: 'text',
      context: {
        mentionedJids: [],
        isForwarded: false,
      },
      raw: {},
    },
    prefix: '!',
    args: [],
    reply: async (content) => {
      if (typeof content === 'string') replies.push(content);
    },
    send: async () => undefined,
    react: async () => undefined,
  };

  await new HelpCommand().execute(context);

  expect(replies).toHaveLength(1);
  expect(replies[0]).toContain(
    '• !cardinal (c) — Run Cardinal administration commands.',
  );
  expect(replies[0]).toContain(
    '• !group (groupctl, gc) — Manage this group (admins only).',
  );
  expect(replies[0]).not.toContain('!cardinal addmod');
  expect(replies[0]).not.toContain('!group announce');
});
