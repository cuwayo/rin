import { expect, test } from 'bun:test';
import {
  Command,
  Cooldown,
} from '../../framework/commands/command.decorator.ts';
import type { CommandContext } from '../../framework/commands/contracts.ts';
import { CardinalCommand } from './cardinal.command.ts';
import { GroupCommand } from './group.command.ts';
import { HelpCommand } from './help.command.ts';

@Command({
  name: 'help-cooldown-test',
  description: 'A command with a cooldown.',
  usage: '<value>',
})
@Cooldown(65_000)
class HelpCooldownTestCommand {
  async execute(_context: CommandContext): Promise<void> {}
}

test('lists command groups without exposing their subcommands', async () => {
  void CardinalCommand;
  void GroupCommand;
  void HelpCooldownTestCommand;

  const replies: string[] = [];
  const context = createContext([], replies);

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
  expect(replies[0]).toContain('Use !help <command> [subcommand] for details.');
});

test('shows command usage, cooldown, and subcommands', async () => {
  const replies: string[] = [];

  await new HelpCommand().execute(createContext(['group'], replies));

  expect(replies).toHaveLength(1);
  expect(replies[0]).toContain('Command: !group');
  expect(replies[0]).toContain('Description: Manage this group (admins only).');
  expect(replies[0]).toContain('Aliases: groupctl, gc');
  expect(replies[0]).toContain('Usage: !group <subcommand>');
  expect(replies[0]).toContain('Cooldown: None');
  expect(replies[0]).toContain('Permission: Group admin');
  expect(replies[0]).toContain('Subcommands:');
  expect(replies[0]).toContain(
    '• !group announce — Enable or disable announcement-only messages.',
  );
});

test('shows detailed subcommand help and command cooldowns', async () => {
  const subcommandReplies: string[] = [];
  const cooldownReplies: string[] = [];

  await new HelpCommand().execute(
    createContext(['gc', 'filter'], subcommandReplies),
  );
  await new HelpCommand().execute(
    createContext(['help-cooldown-test'], cooldownReplies),
  );

  expect(subcommandReplies).toHaveLength(1);
  expect(subcommandReplies[0]).toContain('Command: !group filter');
  expect(subcommandReplies[0]).toContain(
    'Description: Configure Jev moderation and custom rules in this group.',
  );
  expect(subcommandReplies[0]).toContain('Aliases: badword-filter');
  expect(subcommandReplies[0]).toContain('Usage: !group filter on|off');
  expect(subcommandReplies[0]).toContain(
    'Usage: !group filter requirement add <rule>',
  );
  expect(subcommandReplies[0]).toContain(
    'Usage: !group filter warnings reset <@mention> [...]',
  );
  expect(subcommandReplies[0]).toContain('Cooldown: None');
  expect(subcommandReplies[0]).toContain('Permission: Group admin');
  expect(cooldownReplies).toEqual([
    [
      'Command: !help-cooldown-test',
      'Description: A command with a cooldown.',
      'Aliases: none',
      'Usage: !help-cooldown-test <value>',
      'Cooldown: 1m 5s',
      'Permission: Public',
    ].join('\n'),
  ]);
});

function createContext(
  args: readonly string[],
  replies: string[],
): CommandContext {
  return {
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
    args,
    reply: async (content) => {
      if (typeof content === 'string') replies.push(content);
    },
    send: async () => undefined,
    react: async () => undefined,
  };
}
