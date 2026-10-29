import { expect, test } from 'bun:test';
import type { Logger, WaIncomingMessageEvent } from 'zapo-js';
import {
  Command,
  Cooldown,
  Group,
  GroupAdmin,
} from '@/framework/commands/command.decorator.ts';
import type {
  BotCommand,
  CommandContext,
} from '@/framework/commands/contracts.ts';
import type { BotConfig } from '@/framework/config.ts';
import { Container, Injectable } from '@/framework/core/di.ts';
import type { RoleStore } from '@/framework/roles/role-store.ts';
import { CommandCooldownTracker } from './command-cooldown.ts';
import { CommandRouter, type MessageResponder } from './command-router.ts';

@Command({
  name: 'router-cooldown-test',
  description: 'Test command cooldowns in the router.',
})
@Cooldown(1_000)
@Injectable()
class RouterCooldownCommand implements BotCommand {
  static executions = 0;

  async execute(_context: CommandContext): Promise<void> {
    RouterCooldownCommand.executions += 1;
  }
}

@Command({
  name: 'router-failure-test',
  description: 'Test command failures in the router.',
})
@Injectable()
class RouterFailureCommand implements BotCommand {
  async execute(context: CommandContext): Promise<void> {
    await context.react('⏳', true);
    throw new Error('expected test failure');
  }
}
void RouterFailureCommand;

@Group({
  name: 'router-group-test',
  description: 'Test group command routing.',
})
@GroupAdmin()
@Injectable()
class RouterGroupCommand implements BotCommand {
  static receivedArgs: readonly string[] = [];
  static fallbackArgs: readonly string[] = [];

  async execute(context: CommandContext): Promise<void> {
    RouterGroupCommand.fallbackArgs = context.args;
  }

  @Command({
    name: 'echo',
    aliases: ['say'],
    description: 'Record subcommand arguments for testing.',
  })
  async echo(context: CommandContext): Promise<void> {
    RouterGroupCommand.receivedArgs = context.args;
  }
}

test('does not execute a command again while its sender cooldown is active', async () => {
  RouterCooldownCommand.executions = 0;
  let now = 0;
  const router = new CommandRouter(
    new Container(),
    testConfig,
    {} as RoleStore,
    new CommandCooldownTracker(() => now),
    silentLogger,
  );
  const replies: unknown[] = [];
  const responder: MessageResponder = {
    reply: async (_event, content) => {
      replies.push(content);
    },
    send: async () => undefined,
    react: async () => undefined,
  };

  await router.handle(commandEvent(), responder, async () => false, []);
  now += 250;
  await router.handle(commandEvent(), responder, async () => false, []);

  expect(RouterCooldownCommand.executions).toBe(1);
  expect(replies).toEqual(['This command is on cooldown. Try again in 1s.']);
});

test('reports failures and clears reactions marked for removal', async () => {
  const router = new CommandRouter(
    new Container(),
    testConfig,
    {} as RoleStore,
    new CommandCooldownTracker(),
    silentLogger,
  );
  const replies: unknown[] = [];
  const reactions: string[] = [];
  const responder: MessageResponder = {
    reply: async (_event, content) => {
      replies.push(content);
    },
    send: async () => undefined,
    react: async (_event, emoji) => {
      reactions.push(emoji);
    },
  };

  await router.handle(
    commandEvent('!router-failure-test'),
    responder,
    async () => false,
    [],
  );

  expect(replies).toEqual([
    'Something went wrong while running this command. Please try again.',
  ]);
  expect(reactions).toEqual(['⏳', '']);
});

test('routes a group subcommand with inherited permissions and sliced arguments', async () => {
  RouterGroupCommand.receivedArgs = [];
  RouterGroupCommand.fallbackArgs = [];
  const router = new CommandRouter(
    new Container(),
    testConfig,
    {} as RoleStore,
    new CommandCooldownTracker(),
    silentLogger,
  );
  const replies: unknown[] = [];
  const responder: MessageResponder = {
    reply: async (_event, content) => {
      replies.push(content);
    },
    send: async () => undefined,
    react: async () => undefined,
  };
  const event = commandEvent('!router-group-test say first second', true);

  await router.handle(event, responder, async () => false, []);

  expect(RouterGroupCommand.receivedArgs).toEqual([]);
  expect(replies).toEqual(['You do not have permission to use this command.']);

  await router.handle(event, responder, async () => true, []);

  expect(RouterGroupCommand.receivedArgs).toEqual(['first', 'second']);
  expect(RouterGroupCommand.fallbackArgs).toEqual([]);
});

const testConfig: BotConfig = {
  prefix: '!',
  sessionId: 'test',
  authPath: ':memory:',
  logLevel: 'info',
  roleDbPath: ':memory:',
  moderationDbPath: ':memory:',
  typeSafeModel: 'jev-1.14.0',
  badWordThreshold: 0.9,
};

const silentLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
} as unknown as Logger;

function commandEvent(
  text = '!router-cooldown-test',
  isGroup = false,
): WaIncomingMessageEvent {
  return {
    key: {
      remoteJid: isGroup ? '1234567890@g.us' : '628123456789@s.whatsapp.net',
      id: crypto.randomUUID(),
      fromMe: false,
      isGroup,
    },
    message: {
      conversation: text,
    },
  } as unknown as WaIncomingMessageEvent;
}
