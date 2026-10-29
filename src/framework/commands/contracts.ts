import type { WaIncomingMessageEvent, WaSendMessageContent } from 'zapo-js';
import type { ParsedMessage } from '../bot/message.ts';
import type { GroupFilterRequirement } from '../moderation/group-moderation-store.ts';

/**
 * Data and safe role resolvers provided to an authorization check.
 *
 * Check functions are evaluated before a command instance is created. They
 * can therefore be reused by any command without requiring a dependency.
 */
export interface CommandAuthorizationContext {
  readonly event: WaIncomingMessageEvent;
  readonly message: ParsedMessage;
  readonly prefix: string;
  readonly args: readonly string[];
  readonly senderJids: readonly string[];
  readonly senderIds: readonly string[];
  readonly isGroup: boolean;
  readonly isSuperuser: boolean;
  isBotModerator(): Promise<boolean>;
  isGroupAdmin(): Promise<boolean>;
}

export type CommandCheckResult =
  | boolean
  | {
      readonly allowed: boolean;
      /** Recorded in logs when the check denies access. */
      readonly reason?: string;
    };

/**
 * A composable, possibly asynchronous command authorization rule.
 *
 * Return true (or `{ allowed: true }`) to permit execution. Returning false
 * denies execution. A thrown error is treated as a denial to fail closed.
 */
export type CommandCheck = (
  context: CommandAuthorizationContext,
) => CommandCheckResult | Promise<CommandCheckResult>;

export interface CommandContext {
  readonly event: WaIncomingMessageEvent;
  /** Normalized message data, including media metadata and context. */
  readonly message: ParsedMessage;
  readonly prefix: string;
  readonly args: readonly string[];
  /** Reply with text or any supported WhatsApp content, including media. */
  reply(content: WaSendMessageContent): Promise<void>;
  /** Send text or supported WhatsApp content to a specific JID. */
  send(jid: string, content: WaSendMessageContent): Promise<void>;
  /**
   * React to the invoking message. Set removeAfterCommand to true to clear
   * the reaction once the command finishes; it defaults to false.
   */
  react(emoji: string, removeAfterCommand?: boolean): Promise<void>;
  /**
   * Group-management operations scoped to the chat that invoked the command.
   * This is undefined outside of a group chat.
   */
  readonly group?: GroupCommandActions;
}

export interface BotCommand {
  execute(context: CommandContext): Promise<void>;
}

/** The outcome of an operation affecting one group participant. */
export interface GroupParticipantActionResult {
  readonly jid: string;
  readonly status: 'ok' | 'error';
  readonly code: number;
}

/** The effective state of Jev bad-word moderation for a group. */
export interface GroupBadWordFilterStatus {
  /** Whether moderation is enabled in the group's saved configuration. */
  readonly enabled: boolean;
  /** Whether Jev can currently evaluate messages for the group. */
  readonly active: boolean;
}

/**
 * Safe group-management operations exposed to commands.
 *
 * Implementations always target the invoking group, so a command cannot
 * mutate an arbitrary group by supplying a JID in its arguments.
 */
export interface GroupCommandActions {
  addParticipants(
    participants: readonly string[],
  ): Promise<readonly GroupParticipantActionResult[]>;
  removeParticipants(
    participants: readonly string[],
  ): Promise<readonly GroupParticipantActionResult[]>;
  promoteParticipants(
    participants: readonly string[],
  ): Promise<readonly GroupParticipantActionResult[]>;
  demoteParticipants(
    participants: readonly string[],
  ): Promise<readonly GroupParticipantActionResult[]>;
  setSubject(subject: string): Promise<void>;
  setDescription(description: string | null): Promise<void>;
  setSetting(
    setting: 'announcement' | 'restrict',
    enabled: boolean,
  ): Promise<void>;
  /** When false, only group admins can share or forward the invite link. */
  setInviteLinkSharing(enabled: boolean): Promise<void>;
  /** Saves and returns the effective Jev moderation state for this group. */
  setBadWordFilter(enabled: boolean): Promise<GroupBadWordFilterStatus>;
  /** Adds a Jev moderation rule scoped to the invoking group. */
  addFilterRequirement(requirement: string): Promise<GroupFilterRequirement>;
  listFilterRequirements(): Promise<readonly GroupFilterRequirement[]>;
  removeFilterRequirement(requirementId: number): Promise<boolean>;
  clearFilterRequirements(): Promise<number>;
  setFilterWarningLimit(warningLimit: number | undefined): Promise<void>;
  getFilterWarningLimit(): Promise<number | undefined>;
  clearFilterWarnings(participants: readonly string[]): Promise<void>;
  inviteCode(): Promise<string>;
  revokeInvite(): Promise<string>;
  info(): Promise<GroupCommandInfo>;
}

/** The group details deliberately made available to group commands. */
export interface GroupCommandInfo {
  readonly subject: string;
  readonly description?: string;
  readonly participantCount: number;
  readonly announcementOnly: boolean;
  readonly restrictInfoEdits: boolean;
}
