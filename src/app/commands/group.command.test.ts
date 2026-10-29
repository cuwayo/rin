import { expect, test } from 'bun:test';
import type { Logger, WaIncomingMessageEvent } from 'zapo-js';
import { CommandCooldownTracker } from '@/framework/bot/command-cooldown.ts';
import {
  CommandRouter,
  type MessageResponder,
} from '@/framework/bot/command-router.ts';
import type {
  CommandContext,
  GroupCommandActions,
} from '@/framework/commands/contracts.ts';
import type { BotConfig } from '@/framework/config.ts';
import { Container } from '@/framework/core/di.ts';
import type { RoleStore } from '@/framework/roles/role-store.ts';
import { GroupCommand } from './group.command.ts';

test('uses WhatsApp mention JIDs instead of rendered mention text', async () => {
  const calls: string[][] = [];
  const { context, replies } = groupContext(
    ['add', '@not-the-target'],
    {
      addParticipants: async (participants) => {
        calls.push([...participants]);
        return participants.map((jid) => ({
          jid,
          status: 'ok' as const,
          code: 200,
        }));
      },
    },
    ['628111111111@s.whatsapp.net'],
  );

  await new GroupCommand().execute(context);

  expect(calls).toEqual([['628111111111@s.whatsapp.net']]);
  expect(replies).toEqual(['Added 1/1 participant.']);
});

test('adds a supplied phone number when no mention is available', async () => {
  const calls: string[][] = [];
  const { context, replies } = groupContext(['add', '628111111111'], {
    addParticipants: async (participants) => {
      calls.push([...participants]);
      return participants.map((jid) => ({
        jid,
        status: 'ok' as const,
        code: 200,
      }));
    },
  });

  await new GroupCommand().execute(context);

  expect(calls).toEqual([['628111111111@s.whatsapp.net']]);
  expect(replies).toEqual(['Added 1/1 participant.']);
});

test('requires a real WhatsApp mention for participant actions', async () => {
  const { context, replies } = groupContext(['promote', '628123456789'], {
    promoteParticipants: async () => {
      throw new Error('a plain text target must not be used');
    },
  });

  await new GroupCommand().execute(context);

  expect(replies).toEqual(['Usage: !group promote <@mention> [...]']);
});

test('updates announcement-only mode', async () => {
  const settings: Array<readonly [string, boolean]> = [];
  const { context, replies } = groupContext(['announce', 'on'], {
    setSetting: async (setting, enabled) => {
      settings.push([setting, enabled]);
    },
  });

  await new GroupCommand().execute(context);

  expect(settings).toEqual([['announcement', true]]);
  expect(replies).toEqual(['Announcement-only messages enabled.']);
});

test('restricts invite-link sharing to group admins', async () => {
  const calls: boolean[] = [];
  const { context, replies } = groupContext(['link-sharing', 'off'], {
    setInviteLinkSharing: async (enabled) => {
      calls.push(enabled);
    },
  });

  await new GroupCommand().execute(context);

  expect(calls).toEqual([false]);
  expect(replies).toEqual([
    'Only group admins can now share the group invite link.',
  ]);
});

test('enables the Jev bad-word filter for the invoking group', async () => {
  const calls: boolean[] = [];
  const { context, replies } = groupContext(['filter', 'on'], {
    setBadWordFilter: async (enabled) => {
      calls.push(enabled);
      return { enabled, active: true };
    },
  });

  await new GroupCommand().execute(context);

  expect(calls).toEqual([true]);
  expect(replies).toEqual(['Jev bad-word filtering enabled for this group.']);
});

test('keeps the saved filter setting pending when Jev has no API key', async () => {
  const calls: boolean[] = [];
  const { context, replies } = groupContext(['filter', 'on'], {
    setBadWordFilter: async (enabled) => {
      calls.push(enabled);
      return { enabled, active: false };
    },
  });

  await new GroupCommand().execute(context);

  expect(calls).toEqual([true]);
  expect(replies).toEqual([
    'Jev bad-word filtering is enabled for this group but inactive until a TypeSafe API key is configured.',
  ]);
});

test('adds a custom Jev filter requirement for the invoking group', async () => {
  const requirements: string[] = [];
  const { context, replies } = groupContext(
    ['filter', 'requirement', 'add', 'No links or NSFW topics'],
    {
      addFilterRequirement: async (requirement) => {
        requirements.push(requirement);
        return { id: 7, requirement };
      },
    },
  );

  await new GroupCommand().execute(context);

  expect(requirements).toEqual(['No links or NSFW topics']);
  expect(replies).toEqual(['Filter requirement 7 added.']);
});

test('lists and removes custom Jev filter requirements', async () => {
  const removed: number[] = [];
  const listed = groupContext(['filter', 'requirement', 'list'], {
    listFilterRequirements: async () => [
      { id: 4, requirement: 'No links' },
      { id: 9, requirement: 'No NSFW topics' },
    ],
  });

  await new GroupCommand().execute(listed.context);

  expect(listed.replies).toEqual([
    'Custom filter requirements:\n4. No links\n9. No NSFW topics',
  ]);

  const removal = groupContext(['filter', 'requirement', 'remove', '9'], {
    removeFilterRequirement: async (id) => {
      removed.push(id);
      return true;
    },
  });

  await new GroupCommand().execute(removal.context);

  expect(removed).toEqual([9]);
  expect(removal.replies).toEqual(['Filter requirement 9 removed.']);
});

test('configures the warning limit before automatic member removal', async () => {
  const limits: Array<number | undefined> = [];
  const { context, replies } = groupContext(['filter', 'warnings', '3'], {
    setFilterWarningLimit: async (limit) => {
      limits.push(limit);
    },
  });

  await new GroupCommand().execute(context);

  expect(limits).toEqual([3]);
  expect(replies).toEqual([
    'The bot will attempt to remove members after 3 filter warnings.',
  ]);
});

test('resets warnings using WhatsApp mention metadata despite rendered mention arguments', async () => {
  const clearedParticipants: string[][] = [];
  const { context, replies } = groupContext(
    ['filter', 'warnings', 'reset', '@628111111111'],
    {
      clearFilterWarnings: async (participants) => {
        clearedParticipants.push([...participants]);
      },
    },
    ['628111111111@lid'],
  );

  await new GroupCommand().execute(context);

  expect(clearedParticipants).toEqual([['628111111111@lid']]);
  expect(replies).toEqual(['Filter warnings reset for 1 member.']);
});

test('does not clear requirements when clear has trailing arguments', async () => {
  let calls = 0;
  const { context, replies } = groupContext(
    ['filter', 'requirement', 'clear', 'anything'],
    {
      clearFilterRequirements: async () => {
        calls += 1;
        return 1;
      },
    },
  );

  await new GroupCommand().execute(context);

  expect(calls).toBe(0);
  expect(replies).toEqual(['Usage: !group filter requirement clear']);
});

test('does not expose group operations outside a group', async () => {
  const { context, replies } = groupContext(['info'], undefined);

  await new GroupCommand().execute(context);

  expect(replies).toEqual(['This command can only be used in a group.']);
});

test('reports the actual group-operation error without assuming WhatsApp rejected it', async () => {
  const { context, replies } = groupContext(['announce', 'on'], {
    setSetting: async () => {
      throw new Error('group.setSetting: IQ error 403 (not-authorized)');
    },
  });

  await new GroupCommand().execute(context);

  expect(replies).toEqual([
    'Could not complete the group update: group.setSetting: IQ error 403 (not-authorized)',
  ]);
});

test('identifies a timed-out group query without calling it a WhatsApp rejection', async () => {
  const { context, replies } = groupContext(['announce', 'on'], {
    setSetting: async () => {
      throw new Error('queryGroupMetadata timeout');
    },
  });

  await new GroupCommand().execute(context);

  expect(replies).toEqual([
    'The group request timed out before it completed. Please try again.',
  ]);
});

test('routes !group add through CommandRouter and its group responder', async () => {
  const additions: string[][] = [];
  const replies: string[] = [];
  const responder = groupResponder(replies, {
    addParticipants: async (participants) => {
      additions.push([...participants]);
      return participants.map((jid) => ({
        jid,
        status: 'ok' as const,
        code: 200,
      }));
    },
  });

  await groupRouter().handle(
    groupCommandEvent('!group add 628111111111'),
    responder,
    async () => true,
    [],
  );

  expect(additions).toEqual([['628111111111@s.whatsapp.net']]);
  expect(replies).toEqual(['Added 1/1 participant.']);
});

test('routes group aliases with sliced arguments and reports group responder errors', async () => {
  const descriptions: Array<string | null> = [];
  const replies: string[] = [];
  const responder = groupResponder(replies, {
    setDescription: async (description) => {
      descriptions.push(description);
      throw new Error('description update rejected');
    },
  });

  await groupRouter().handle(
    groupCommandEvent('!gc desc updated by router'),
    responder,
    async () => true,
    [],
  );

  expect(descriptions).toEqual(['updated by router']);
  expect(replies).toEqual([
    'Could not complete the group update: description update rejected',
  ]);
});

function groupContext(
  args: readonly string[],
  overrides: Partial<GroupCommandActions> | undefined,
  mentionedJids: readonly string[] = [],
): { readonly context: CommandContext; readonly replies: string[] } {
  const replies: string[] = [];
  const group: GroupCommandActions = {
    addParticipants: async () => [],
    removeParticipants: async () => [],
    promoteParticipants: async () => [],
    demoteParticipants: async () => [],
    setSubject: async () => undefined,
    setDescription: async () => undefined,
    setSetting: async () => undefined,
    setInviteLinkSharing: async () => undefined,
    setBadWordFilter: async (enabled) => ({ enabled, active: true }),
    addFilterRequirement: async (requirement) => ({ id: 1, requirement }),
    listFilterRequirements: async () => [],
    removeFilterRequirement: async () => false,
    clearFilterRequirements: async () => 0,
    setFilterWarningLimit: async () => undefined,
    getFilterWarningLimit: async () => undefined,
    clearFilterWarnings: async () => undefined,
    inviteCode: async () => 'invite-code',
    revokeInvite: async () => 'new-invite-code',
    info: async () => ({
      subject: 'Test group',
      participantCount: 3,
      announcementOnly: false,
      restrictInfoEdits: false,
    }),
    ...overrides,
  };

  return {
    context: {
      event: {} as CommandContext['event'],
      message: {
        kind: 'text',
        context: {
          mentionedJids,
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
      ...(overrides ? { group } : {}),
    },
    replies,
  };
}

const routerConfig: BotConfig = {
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

function groupRouter(): CommandRouter {
  return new CommandRouter(
    new Container(),
    routerConfig,
    {} as RoleStore,
    new CommandCooldownTracker(),
    silentLogger,
  );
}

function groupResponder(
  replies: string[],
  overrides: Partial<GroupCommandActions>,
): MessageResponder {
  const group: GroupCommandActions = {
    addParticipants: async () => [],
    removeParticipants: async () => [],
    promoteParticipants: async () => [],
    demoteParticipants: async () => [],
    setSubject: async () => undefined,
    setDescription: async () => undefined,
    setSetting: async () => undefined,
    setInviteLinkSharing: async () => undefined,
    setBadWordFilter: async (enabled) => ({ enabled, active: true }),
    addFilterRequirement: async (requirement) => ({ id: 1, requirement }),
    listFilterRequirements: async () => [],
    removeFilterRequirement: async () => false,
    clearFilterRequirements: async () => 0,
    setFilterWarningLimit: async () => undefined,
    getFilterWarningLimit: async () => undefined,
    clearFilterWarnings: async () => undefined,
    inviteCode: async () => 'invite-code',
    revokeInvite: async () => 'new-invite-code',
    info: async () => ({
      subject: 'Test group',
      participantCount: 3,
      announcementOnly: false,
      restrictInfoEdits: false,
    }),
    ...overrides,
  };

  return {
    reply: async (_event, content) => {
      if (typeof content === 'string') replies.push(content);
    },
    send: async () => undefined,
    react: async () => undefined,
    group: () => group,
  };
}

function groupCommandEvent(text: string): WaIncomingMessageEvent {
  return {
    key: {
      remoteJid: '1234567890@g.us',
      participant: '628123456789@s.whatsapp.net',
      id: crypto.randomUUID(),
      fromMe: false,
      isGroup: true,
    },
    message: {
      conversation: text,
    },
  } as unknown as WaIncomingMessageEvent;
}
