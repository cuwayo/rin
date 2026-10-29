import { expect, test } from 'bun:test';
import type { Logger, WaGroupMetadata, WaIncomingMessageEvent } from 'zapo-js';
import type { GroupCommandActions } from '@/framework/commands/contracts.ts';
import { GroupMetadataCache } from '@/framework/groups/group-metadata-cache.ts';
import { BadWordFilter } from '@/framework/moderation/bad-word-filter.ts';
import { GroupModerationStore } from '@/framework/moderation/group-moderation-store.ts';
import { ZapoBot } from './zapo-bot.ts';

test('warns without revoking or removing when the bot is not a group admin', async () => {
  const { bot } = createBot();
  const messages: unknown[] = [];
  const client = {
    getCredentials: () => ({ meJid: BOT_JID }),
    group: {
      queryGroupMetadata: async () => ({
        participants: [
          {
            jid: BOT_JID,
            isAdmin: false,
            isSuperAdmin: false,
          },
        ],
      }),
      removeParticipants: async () => {
        throw new Error('a non-admin bot must not remove participants');
      },
    },
    message: {
      send: async (_jid: string, content: unknown) => {
        messages.push(content);
      },
    },
  };

  await internals(bot).handleFilterViolation(client, groupMessageEvent());

  expect(messages).toEqual([
    'Warning: this message violated this group’s filter rules. The bot is not a group admin, so it could not delete it.',
  ]);
});

test('still sends a warning when revoking a filtered message fails', async () => {
  const { bot } = createBot();
  const messages: unknown[] = [];
  const client = {
    getCredentials: () => ({ meJid: BOT_JID }),
    group: {
      queryGroupMetadata: async () => adminGroupMetadata(),
    },
    message: {
      send: async (_jid: string, content: unknown) => {
        if (isRevokeMessage(content)) {
          throw new Error('WhatsApp rejected the revoke request');
        }
        messages.push(content);
      },
    },
  };

  await internals(bot).handleFilterViolation(client, groupMessageEvent());

  expect(messages).toEqual([
    'Warning: this message violated this group’s filter rules. The bot could not delete it.',
  ]);
});

test('reports a rejected automatic member removal after the final-warning notice', async () => {
  const { bot, filter } = createBot();
  await filter.setWarningLimit(GROUP_JID, 1);

  const messages: unknown[] = [];
  const removalAttempts: string[][] = [];
  const client = {
    getCredentials: () => ({ meJid: BOT_JID }),
    group: {
      queryGroupMetadata: async () => adminGroupMetadata(),
      removeParticipants: async (
        _groupJid: string,
        participants: readonly string[],
      ) => {
        removalAttempts.push([...participants]);
        const participant = participants[0];
        if (!participant) {
          throw new Error('Expected an automatic removal target');
        }
        return [
          {
            jid: participant,
            status: 'error' as const,
            code: 403,
          },
        ];
      },
    },
    message: {
      send: async (_jid: string, content: unknown) => {
        messages.push(content);
      },
    },
  };

  await internals(bot).handleFilterViolation(client, groupMessageEvent());

  expect(removalAttempts).toEqual([[MEMBER_JID]]);
  expect(isRevokeMessage(messages[0])).toBe(true);
  expect(messages.slice(1)).toEqual([
    'Final warning: this member reached 1/1 filter warnings. The bot will attempt to remove this member.',
    'Automatic member removal could not be completed. A group admin may need to remove this member manually.',
  ]);
});

test('uses one canonical PN warning bucket when a LID violation is reset through group actions', async () => {
  const { bot, filter } = createBot();
  await filter.setWarningLimit(GROUP_JID, 5);

  const messages: unknown[] = [];
  const client = {
    getCredentials: () => ({ meJid: BOT_JID }),
    group: {
      queryGroupMetadata: async () =>
        adminGroupMetadata([
          {
            jid: MEMBER_JID,
            lid: MEMBER_LID,
            phoneNumber: MEMBER_JID,
            isAdmin: false,
            isSuperAdmin: false,
          },
        ]),
    },
    message: {
      send: async (_jid: string, content: unknown) => {
        messages.push(content);
      },
    },
  };
  const violation = groupMessageEvent({
    participant: MEMBER_LID,
    participantAlt: MEMBER_JID,
  });

  await internals(bot).handleFilterViolation(client, violation);

  const actions = internals(bot).groupActionsForMessage(
    client,
    groupMessageEvent(),
  );
  if (!actions) throw new Error('Expected group actions for a group message');
  await actions.clearFilterWarnings([MEMBER_LID]);

  await internals(bot).handleFilterViolation(
    client,
    groupMessageEvent({
      participant: MEMBER_LID,
      participantAlt: MEMBER_JID,
    }),
  );

  expect(messages.filter(isString)).toEqual([
    'Warning 1/5: this message violated this group’s filter rules.',
    'Warning 1/5: this message violated this group’s filter rules.',
  ]);
});

test('retains a newer metadata refresh when an older refresh fails', async () => {
  const cache = new GroupMetadataCache();
  const { bot } = createBot(cache);
  const older = deferred<WaGroupMetadata>();
  const newer = deferred<WaGroupMetadata>();
  let queries = 0;
  const client = {
    group: {
      queryGroupMetadata: () => {
        queries += 1;
        return queries === 1 ? older.promise : newer.promise;
      },
    },
  };

  const olderRefresh = internals(bot).refreshGroupMetadata(client, GROUP_JID);
  const newerRefresh = internals(bot).refreshGroupMetadata(client, GROUP_JID);

  newer.resolve({ subject: 'Newer group' } as WaGroupMetadata);
  await newerRefresh;
  older.reject(new Error('Older refresh failed'));
  await olderRefresh;

  const metadata = await cache.get(GROUP_JID, async () => {
    throw new Error('The newer metadata should remain cached');
  });
  expect(metadata.subject).toBe('Newer group');
});

const GROUP_JID = '120363000000000000@g.us';
const BOT_JID = '6280000000000@s.whatsapp.net';
const MEMBER_JID = '628111111111@s.whatsapp.net';
const MEMBER_LID = '1234567890123@lid';

const silentLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
} as unknown as Logger;

function createBot(groupMetadataCache = new GroupMetadataCache()): {
  readonly bot: ZapoBot;
  readonly filter: BadWordFilter;
} {
  const config = {
    prefix: '!',
    sessionId: 'test',
    authPath: ':memory:',
    logLevel: 'info' as const,
    roleDbPath: ':memory:',
    moderationDbPath: ':memory:',
    typeSafeApiKey: 'test-key',
    typeSafeModel: 'jev-1.14.0',
    badWordThreshold: 0.9,
  };
  const store = new GroupModerationStore(config);
  const filter = new BadWordFilter(config, store, silentLogger);
  return {
    bot: new ZapoBot(
      config,
      {} as ConstructorParameters<typeof ZapoBot>[1],
      filter,
      groupMetadataCache,
      silentLogger,
    ),
    filter,
  };
}

function adminGroupMetadata(
  members: readonly object[] = [
    {
      jid: MEMBER_JID,
      isAdmin: false,
      isSuperAdmin: false,
    },
  ],
): object {
  return {
    participants: [
      {
        jid: BOT_JID,
        isAdmin: true,
        isSuperAdmin: true,
      },
      ...members,
    ],
  };
}

function internals(bot: ZapoBot): {
  handleFilterViolation(
    client: unknown,
    event: WaIncomingMessageEvent,
  ): Promise<void>;
  groupActionsForMessage(
    client: unknown,
    event: WaIncomingMessageEvent,
  ): Pick<GroupCommandActions, 'clearFilterWarnings'> | undefined;
  refreshGroupMetadata(client: unknown, groupJid: string): Promise<void>;
} {
  return bot as unknown as {
    handleFilterViolation(
      client: unknown,
      event: WaIncomingMessageEvent,
    ): Promise<void>;
    groupActionsForMessage(
      client: unknown,
      event: WaIncomingMessageEvent,
    ): Pick<GroupCommandActions, 'clearFilterWarnings'> | undefined;
    refreshGroupMetadata(client: unknown, groupJid: string): Promise<void>;
  };
}

function isRevokeMessage(content: unknown): boolean {
  return (
    typeof content === 'object' &&
    content !== null &&
    'type' in content &&
    content.type === 'revoke'
  );
}

function isString(content: unknown): content is string {
  return typeof content === 'string';
}

function groupMessageEvent({
  participant = MEMBER_JID,
  participantAlt,
}: {
  readonly participant?: string;
  readonly participantAlt?: string;
} = {}): WaIncomingMessageEvent {
  return {
    key: {
      remoteJid: GROUP_JID,
      participant,
      participantAlt,
      id: crypto.randomUUID(),
      fromMe: false,
      isGroup: true,
    },
    message: {
      conversation: 'blocked message',
    },
  } as unknown as WaIncomingMessageEvent;
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
