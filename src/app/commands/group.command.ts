import {
  Command,
  Group,
  GroupAdmin,
} from '../../framework/commands/command.decorator.ts';
import type {
  BotCommand,
  CommandContext,
  GroupCommandActions,
  GroupParticipantActionResult,
} from '../../framework/commands/contracts.ts';
import { Injectable } from '../../framework/core/di.ts';
import { normalizeUserJid } from '../../framework/core/jid.ts';
import {
  MAX_FILTER_REQUIREMENT_LENGTH,
  MAX_FILTER_WARNING_LIMIT,
} from '../../framework/moderation/bad-word-filter.ts';

const usage = [
  'Usage:',
  'group add <phone-number|jid> [...]',
  'group remove|promote|demote <@mention> [...]',
  'group subject <new subject>',
  'group description <text>|clear',
  'group announce on|off',
  'group restrict on|off',
  'group link-sharing on|off',
  'group filter on|off',
  'group filter requirement add <rule>',
  'group filter requirement list',
  'group filter requirement remove <id>',
  'group filter requirement clear',
  'group filter warnings <count|off>',
  'group filter warnings reset <@mention> [...]',
  'group link',
  'group revoke-link',
  'group info',
].join('\n');

@Group({
  name: 'group',
  aliases: ['groupctl', 'gc'],
  description: 'Manage this group (admins only).',
  usage: '<subcommand>',
})
@GroupAdmin()
@Injectable()
export class GroupCommand implements BotCommand {
  async execute(context: CommandContext): Promise<void> {
    if (!context.group) {
      await context.reply('This command can only be used in a group.');
      return;
    }

    const [rawAction, ...rest] = context.args;
    const action = rawAction?.toLowerCase();
    if (!action) {
      await context.reply(prefixUsage(context.prefix));
      return;
    }

    const subcommandContext = {
      ...context,
      args: rest,
    };
    switch (action) {
      case 'add':
        await this.add(subcommandContext);
        return;
      case 'remove':
      case 'kick':
        await this.remove(subcommandContext);
        return;
      case 'promote':
        await this.promote(subcommandContext);
        return;
      case 'demote':
        await this.demote(subcommandContext);
        return;
      case 'subject':
        await this.subject(subcommandContext);
        return;
      case 'description':
      case 'desc':
        await this.description(subcommandContext);
        return;
      case 'announce':
        await this.announce(subcommandContext);
        return;
      case 'restrict':
        await this.restrict(subcommandContext);
        return;
      case 'link-sharing':
      case 'link-share':
        await this.linkSharing(subcommandContext);
        return;
      case 'filter':
      case 'badword-filter':
        await this.filter(subcommandContext);
        return;
      case 'link':
        await this.link(subcommandContext);
        return;
      case 'revoke-link':
      case 'reset-link':
        await this.revokeLink(subcommandContext);
        return;
      case 'info':
        await this.info(subcommandContext);
        return;
      default:
        await context.reply(prefixUsage(context.prefix));
    }
  }

  @Command({
    name: 'add',
    description: 'Add members by phone number, JID, or mention.',
    usage: '<phone-number|jid> [...]',
  })
  async add(context: CommandContext): Promise<void> {
    await this.withGroup(context, (group) =>
      participantAction(
        context,
        'Added',
        'add',
        group.addParticipants.bind(group),
        addParticipantTargets,
        '<phone-number|jid>',
      ),
    );
  }

  @Command({
    name: 'remove',
    aliases: ['kick'],
    description: 'Remove mentioned members from the group.',
    usage: '<@mention> [...]',
  })
  async remove(context: CommandContext): Promise<void> {
    await this.withGroup(context, (group) =>
      participantAction(
        context,
        'Removed',
        'remove',
        group.removeParticipants.bind(group),
      ),
    );
  }

  @Command({
    name: 'promote',
    description: 'Promote mentioned members to group admin.',
    usage: '<@mention> [...]',
  })
  async promote(context: CommandContext): Promise<void> {
    await this.withGroup(context, (group) =>
      participantAction(
        context,
        'Promoted',
        'promote',
        group.promoteParticipants.bind(group),
      ),
    );
  }

  @Command({
    name: 'demote',
    description: 'Demote mentioned group admins.',
    usage: '<@mention> [...]',
  })
  async demote(context: CommandContext): Promise<void> {
    await this.withGroup(context, (group) =>
      participantAction(
        context,
        'Demoted',
        'demote',
        group.demoteParticipants.bind(group),
      ),
    );
  }

  @Command({
    name: 'subject',
    description: 'Change the group subject.',
    usage: '<new-subject>',
  })
  async subject(context: CommandContext): Promise<void> {
    await this.withGroup(context, (group) =>
      updateSubject(context, group, context.args.join(' ')),
    );
  }

  @Command({
    name: 'description',
    aliases: ['desc'],
    description: 'Change or clear the group description.',
    usage: '<text>|clear',
  })
  async description(context: CommandContext): Promise<void> {
    await this.withGroup(context, (group) =>
      updateDescription(context, group, context.args.join(' ')),
    );
  }

  @Command({
    name: 'announce',
    description: 'Enable or disable announcement-only messages.',
    usage: 'on|off',
  })
  async announce(context: CommandContext): Promise<void> {
    await this.withGroup(context, (group) =>
      updateSetting(context, group, 'announcement', context.args[0]),
    );
  }

  @Command({
    name: 'restrict',
    description: 'Control who may edit group information.',
    usage: 'on|off',
  })
  async restrict(context: CommandContext): Promise<void> {
    await this.withGroup(context, (group) =>
      updateSetting(context, group, 'restrict', context.args[0]),
    );
  }

  @Command({
    name: 'link-sharing',
    aliases: ['link-share'],
    description: 'Control whether members can share the group invite link.',
    usage: 'on|off',
  })
  async linkSharing(context: CommandContext): Promise<void> {
    await this.withGroup(context, (group) =>
      updateInviteLinkSharing(context, group, context.args[0]),
    );
  }

  @Command({
    name: 'filter',
    aliases: ['badword-filter'],
    description: 'Configure Jev moderation and custom rules in this group.',
    usage: [
      'on|off',
      'requirement add <rule>',
      'requirement list',
      'requirement remove <id>',
      'requirement clear',
      'warnings <count|off>',
      'warnings reset <@mention> [...]',
    ],
  })
  async filter(context: CommandContext): Promise<void> {
    await this.withGroup(context, (group) =>
      updateBadWordFilter(context, group),
    );
  }

  @Command({
    name: 'link',
    description: 'Show the group invite link.',
    usage: '',
  })
  async link(context: CommandContext): Promise<void> {
    await this.withGroup(context, async (group) => {
      await context.reply(
        `Group invite link:\nhttps://chat.whatsapp.com/${await group.inviteCode()}`,
      );
    });
  }

  @Command({
    name: 'revoke-link',
    aliases: ['reset-link'],
    description: 'Revoke the current group invite link.',
    usage: '',
  })
  async revokeLink(context: CommandContext): Promise<void> {
    await this.withGroup(context, async (group) => {
      await context.reply(
        `Group invite link revoked. New link:\nhttps://chat.whatsapp.com/${await group.revokeInvite()}`,
      );
    });
  }

  @Command({
    name: 'info',
    description: 'Show this group’s details.',
    usage: '',
  })
  async info(context: CommandContext): Promise<void> {
    await this.withGroup(context, (group) => showInfo(context, group));
  }

  private async withGroup(
    context: CommandContext,
    action: (group: GroupCommandActions) => Promise<void>,
  ): Promise<void> {
    const group = context.group;
    if (!group) {
      await context.reply('This command can only be used in a group.');
      return;
    }

    try {
      await action(group);
    } catch (error) {
      await context.reply(groupErrorMessage(error));
    }
  }
}

async function participantAction(
  context: CommandContext,
  label: string,
  action: string,
  operation: (
    participants: readonly string[],
  ) => Promise<readonly GroupParticipantActionResult[]>,
  targetsFor: (
    context: CommandContext,
  ) => readonly string[] = mentionedParticipantTargets,
  targetUsage = '<@mention>',
): Promise<void> {
  const targets = targetsFor(context);
  if (targets.length === 0) {
    await context.reply(
      `Usage: ${context.prefix}group ${action} ${targetUsage} [...]`,
    );
    return;
  }

  const results = await operation(targets);
  const successful = results.filter((result) => result.status === 'ok');
  const failed = results.filter((result) => result.status !== 'ok');
  const summary = `${label} ${successful.length}/${targets.length} participant${targets.length === 1 ? '' : 's'}.`;
  const failures = failed.length
    ? `\nFailed: ${failed.map(formatFailure).join(', ')}`
    : '';
  await context.reply(`${summary}${failures}`);
}

async function updateSubject(
  context: CommandContext,
  group: GroupCommandActions,
  subject: string,
): Promise<void> {
  if (!subject) {
    await context.reply(`Usage: ${context.prefix}group subject <new subject>`);
    return;
  }
  await group.setSubject(subject);
  await context.reply('Group subject updated.');
}

async function updateDescription(
  context: CommandContext,
  group: GroupCommandActions,
  description: string,
): Promise<void> {
  if (!description) {
    await context.reply(
      `Usage: ${context.prefix}group description <text>|clear`,
    );
    return;
  }
  await group.setDescription(
    description.toLowerCase() === 'clear' ? null : description,
  );
  await context.reply(
    description.toLowerCase() === 'clear'
      ? 'Group description cleared.'
      : 'Group description updated.',
  );
}

async function updateSetting(
  context: CommandContext,
  group: GroupCommandActions,
  setting: 'announcement' | 'restrict',
  rawValue: string | undefined,
): Promise<void> {
  const enabled = parseToggle(rawValue);
  if (enabled === undefined) {
    const label = setting === 'announcement' ? 'announce' : 'restrict';
    await context.reply(`Usage: ${context.prefix}group ${label} on|off`);
    return;
  }
  await group.setSetting(setting, enabled);
  const label =
    setting === 'announcement'
      ? 'Announcement-only messages'
      : 'Group info editing';
  await context.reply(`${label} ${enabled ? 'enabled' : 'disabled'}.`);
}

async function updateInviteLinkSharing(
  context: CommandContext,
  group: GroupCommandActions,
  rawValue: string | undefined,
): Promise<void> {
  const enabled = parseToggle(rawValue);
  if (enabled === undefined) {
    await context.reply(`Usage: ${context.prefix}group link-sharing on|off`);
    return;
  }
  await group.setInviteLinkSharing(enabled);
  await context.reply(
    enabled
      ? 'Members can now share the group invite link.'
      : 'Only group admins can now share the group invite link.',
  );
}

async function updateBadWordFilter(
  context: CommandContext,
  group: GroupCommandActions,
): Promise<void> {
  const [rawAction, ...rest] = context.args;
  if (
    rawAction?.toLowerCase() === 'requirement' ||
    rawAction?.toLowerCase() === 'requirements' ||
    rawAction?.toLowerCase() === 'rule' ||
    rawAction?.toLowerCase() === 'rules'
  ) {
    await updateFilterRequirement(context, group, rest);
    return;
  }
  if (
    rawAction?.toLowerCase() === 'warning' ||
    rawAction?.toLowerCase() === 'warnings'
  ) {
    await updateFilterWarnings(context, group, rest);
    return;
  }

  const enabled = parseToggle(rawAction);
  if (enabled === undefined) {
    await context.reply(
      [
        `Usage: ${context.prefix}group filter on|off`,
        `${context.prefix}group filter requirement add <rule>`,
        `${context.prefix}group filter requirement list|remove <id>|clear`,
        `${context.prefix}group filter warnings <count|off>`,
      ].join('\n'),
    );
    return;
  }
  const status = await group.setBadWordFilter(enabled);
  if (status.enabled && !status.active) {
    await context.reply(
      'Jev bad-word filtering is enabled for this group but inactive until a TypeSafe API key is configured.',
    );
    return;
  }
  await context.reply(
    `Jev bad-word filtering ${status.enabled ? 'enabled' : 'disabled'} for this group.`,
  );
}

async function updateFilterRequirement(
  context: CommandContext,
  group: GroupCommandActions,
  args: readonly string[],
): Promise<void> {
  const [rawAction, ...rest] = args;
  switch (rawAction?.toLowerCase()) {
    case 'list':
    case 'ls': {
      const requirements = await group.listFilterRequirements();
      await context.reply(
        requirements.length === 0
          ? 'No custom filter requirements are configured for this group.'
          : [
              'Custom filter requirements:',
              ...requirements.map(
                ({ id, requirement }) => `${id}. ${requirement}`,
              ),
            ].join('\n'),
      );
      return;
    }
    case 'remove':
    case 'delete':
    case 'rm': {
      const requirementId = positiveInteger(rest[0]);
      if (requirementId === undefined || rest.length !== 1) {
        await context.reply(
          `Usage: ${context.prefix}group filter requirement remove <id>`,
        );
        return;
      }
      const removed = await group.removeFilterRequirement(requirementId);
      await context.reply(
        removed
          ? `Filter requirement ${requirementId} removed.`
          : `No filter requirement with ID ${requirementId} exists in this group.`,
      );
      return;
    }
    case 'clear': {
      if (rest.length > 0) {
        await context.reply(
          `Usage: ${context.prefix}group filter requirement clear`,
        );
        return;
      }
      const cleared = await group.clearFilterRequirements();
      await context.reply(
        cleared === 0
          ? 'No custom filter requirements were configured for this group.'
          : `Cleared ${cleared} custom filter requirement${cleared === 1 ? '' : 's'}.`,
      );
      return;
    }
    case 'add':
    case 'set':
      await addFilterRequirement(context, group, rest.join(' '));
      return;
    default:
      await context.reply(
        [
          `Usage: ${context.prefix}group filter requirement add <rule>`,
          `${context.prefix}group filter requirement list|remove <id>|clear`,
          `Rules can contain at most ${MAX_FILTER_REQUIREMENT_LENGTH} characters.`,
        ].join('\n'),
      );
  }
}

async function addFilterRequirement(
  context: CommandContext,
  group: GroupCommandActions,
  rawRequirement: string,
): Promise<void> {
  const requirement = rawRequirement.trim();
  if (!requirement) {
    await context.reply(
      `Usage: ${context.prefix}group filter requirement add <rule>`,
    );
    return;
  }
  if (requirement.length > MAX_FILTER_REQUIREMENT_LENGTH) {
    await context.reply(
      `A filter requirement must be at most ${MAX_FILTER_REQUIREMENT_LENGTH} characters.`,
    );
    return;
  }
  const added = await group.addFilterRequirement(requirement);
  await context.reply(`Filter requirement ${added.id} added.`);
}

async function updateFilterWarnings(
  context: CommandContext,
  group: GroupCommandActions,
  args: readonly string[],
): Promise<void> {
  const [rawValue, ...rest] = args;
  if (rawValue?.toLowerCase() === 'reset') {
    const participants = mentionedParticipantTargets(context);
    if (participants.length === 0 || !hasOnlyRenderedMentionArguments(rest)) {
      await context.reply(
        `Usage: ${context.prefix}group filter warnings reset <@mention> [...]`,
      );
      return;
    }
    await group.clearFilterWarnings(participants);
    await context.reply(
      `Filter warnings reset for ${participants.length} member${participants.length === 1 ? '' : 's'}.`,
    );
    return;
  }

  if (rawValue === undefined) {
    const warningLimit = await group.getFilterWarningLimit();
    await context.reply(
      warningLimit === undefined
        ? 'Automatic member removal is disabled. Filter violations are still warned; deletion requires the bot to be a group admin.'
        : `The bot will attempt to remove members after ${warningLimit} filter warning${warningLimit === 1 ? '' : 's'}.`,
    );
    return;
  }

  if (
    rawValue.toLowerCase() === 'off' ||
    rawValue.toLowerCase() === 'disable'
  ) {
    if (rest.length > 0) {
      await context.reply(
        `Usage: ${context.prefix}group filter warnings <count|off>`,
      );
      return;
    }
    await group.setFilterWarningLimit(undefined);
    await context.reply(
      'Automatic member removal disabled. Filter violations are still warned; deletion requires the bot to be a group admin.',
    );
    return;
  }

  const warningLimit = positiveInteger(rawValue);
  if (
    warningLimit === undefined ||
    warningLimit > MAX_FILTER_WARNING_LIMIT ||
    rest.length > 0
  ) {
    await context.reply(
      `Usage: ${context.prefix}group filter warnings <1-${MAX_FILTER_WARNING_LIMIT}|off>`,
    );
    return;
  }
  await group.setFilterWarningLimit(warningLimit);
  await context.reply(
    `The bot will attempt to remove members after ${warningLimit} filter warning${warningLimit === 1 ? '' : 's'}.`,
  );
}

function positiveInteger(value: string | undefined): number | undefined {
  if (!value || !/^[1-9]\d*$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

async function showInfo(
  context: CommandContext,
  group: GroupCommandActions,
): Promise<void> {
  const info = await group.info();
  await context.reply(
    [
      `Group: ${info.subject}`,
      `Participants: ${info.participantCount}`,
      `Announcement-only: ${info.announcementOnly ? 'on' : 'off'}`,
      `Restrict info edits: ${info.restrictInfoEdits ? 'on' : 'off'}`,
      ...(info.description ? [`Description: ${info.description}`] : []),
    ].join('\n'),
  );
}

function addParticipantTargets(context: CommandContext): readonly string[] {
  const suppliedTargets = normalizeParticipantTargets(context.args);
  return suppliedTargets.length > 0
    ? suppliedTargets
    : mentionedParticipantTargets(context);
}

function mentionedParticipantTargets(
  context: CommandContext,
): readonly string[] {
  // WhatsApp supplies the recipient's actual current identity here. Never
  // derive a target from rendered `@number` text because it may not match
  // the LID address that the group currently uses.
  return normalizeParticipantTargets(context.message.context.mentionedJids);
}

function normalizeParticipantTargets(
  candidates: readonly string[],
): readonly string[] {
  return [
    ...new Set(
      candidates
        .map(normalizeUserJid)
        .filter((jid): jid is string => jid !== undefined),
    ),
  ];
}

function hasOnlyRenderedMentionArguments(args: readonly string[]): boolean {
  // The command parser includes the text WhatsApp rendered for each mention.
  // Actual targets still come only from WhatsApp's mention metadata above.
  return args.every((argument) => /^@\S+$/.test(argument));
}

function parseToggle(value: string | undefined): boolean | undefined {
  switch (value?.toLowerCase()) {
    case 'on':
    case 'enable':
    case 'enabled':
      return true;
    case 'off':
    case 'disable':
    case 'disabled':
      return false;
    default:
      return undefined;
  }
}

function formatFailure(result: GroupParticipantActionResult): string {
  return `${result.jid} (${result.code})`;
}

function prefixUsage(prefix: string): string {
  return usage.replaceAll('group', `${prefix}group`);
}

function groupErrorMessage(error: unknown): string {
  const message =
    error instanceof Error ? error.message : 'an unexpected error occurred';
  if (/\b(?:timeout|timed out)\b/i.test(message)) {
    return 'The group request timed out before it completed. Please try again.';
  }
  return `Could not complete the group update: ${message.replace(/\s+/g, ' ').slice(0, 240)}`;
}
