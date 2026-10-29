import { expect, test } from 'bun:test';
import type { Logger, WaIncomingMessageEvent } from 'zapo-js';
import { BadWordFilter, MAX_FILTER_REQUIREMENTS } from './bad-word-filter.ts';
import { GroupModerationStore } from './group-moderation-store.ts';

test('removes a message that matches a custom group filter requirement', async () => {
  const store = new GroupModerationStore({
    prefix: '!',
    sessionId: 'test',
    authPath: ':memory:',
    logLevel: 'info',
    roleDbPath: ':memory:',
    moderationDbPath: ':memory:',
    typeSafeApiKey: 'test-key',
    typeSafeModel: 'jev-1.14.0',
    badWordThreshold: 0.9,
  });
  await store.setBadWordFilterEnabled('first@g.us', true);
  const requirement = await store.addFilterRequirement(
    'first@g.us',
    'No links',
  );
  const filter = new BadWordFilter(storeConfig(), store, silentLogger);
  const requests: unknown[] = [];
  const filterWithClient = filter as unknown as {
    client: {
      systemOne(request: unknown): Promise<{
        readonly model: string;
        readonly answers: Record<string, { readonly noul: number }>;
      }>;
    };
  };
  filterWithClient.client = {
    systemOne: async (request) => {
      requests.push(request);
      return {
        model: 'jev-1.14.0',
        answers: {
          has_bad_word: { noul: 0.01 },
          [`requirement_${requirement.id}`]: { noul: 0.95 },
        },
      };
    },
  };

  expect(await filter.shouldRemove(textEvent('https://example.com'))).toBe(
    true,
  );
  expect(requests).toHaveLength(1);
});

test('atomically limits concurrent custom filter requirement additions', async () => {
  const store = new GroupModerationStore(storeConfig());
  const filter = new BadWordFilter(storeConfig(), store, silentLogger);

  const results = await Promise.allSettled(
    Array.from({ length: MAX_FILTER_REQUIREMENTS + 2 }, (_, index) =>
      filter.addRequirement('first@g.us', `No topic ${index}`),
    ),
  );

  expect(
    results.filter((result) => result.status === 'fulfilled'),
  ).toHaveLength(MAX_FILTER_REQUIREMENTS);
  const rejected = results.filter((result) => result.status === 'rejected');
  expect(rejected).toHaveLength(2);
  for (const result of rejected) {
    if (result.status === 'rejected') {
      expect(result.reason).toMatchObject({
        message: `A group can have at most ${MAX_FILTER_REQUIREMENTS} filter requirements.`,
      });
    }
  }
  expect(await filter.listRequirements('first@g.us')).toHaveLength(
    MAX_FILTER_REQUIREMENTS,
  );
});

test('rejects a concurrent normalized duplicate filter requirement', async () => {
  const store = new GroupModerationStore(storeConfig());
  const filter = new BadWordFilter(storeConfig(), store, silentLogger);

  const results = await Promise.allSettled([
    filter.addRequirement('first@g.us', 'No links'),
    filter.addRequirement('first@g.us', ' no   LINKS '),
  ]);

  expect(
    results.filter((result) => result.status === 'fulfilled'),
  ).toHaveLength(1);
  const rejected = results.filter((result) => result.status === 'rejected');
  expect(rejected).toHaveLength(1);
  if (rejected[0]?.status === 'rejected') {
    expect(rejected[0].reason).toMatchObject({
      message: 'This filter requirement is already configured.',
    });
  }
  expect(
    (await filter.listRequirements('first@g.us')).map((requirement) =>
      requirement.requirement.toLocaleLowerCase(),
    ),
  ).toEqual(['no links']);
});

function storeConfig() {
  return {
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
}

const silentLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
} as unknown as Logger;

function textEvent(text: string): WaIncomingMessageEvent {
  return {
    key: {
      remoteJid: 'first@g.us',
      id: crypto.randomUUID(),
      fromMe: false,
      isGroup: true,
    },
    message: {
      conversation: text,
    },
  } as unknown as WaIncomingMessageEvent;
}
