import {
  image,
  type NoulQuestion,
  noul,
  TypeSafeClient,
} from '@typesafe-ai/sdk';
import type { Logger, WaIncomingMessageEvent } from 'zapo-js';
import type { ParsedMediaMessage } from '@/framework/bot/message.ts';
import { parseIncomingMessage } from '@/framework/bot/message.ts';
import { BOT_CONFIG, type BotConfig } from '@/framework/config.ts';
import { Injectable } from '@/framework/core/di.ts';
import { APP_LOGGER } from '@/framework/core/logger.ts';
import {
  type GroupFilterRequirement,
  GroupModerationStore,
} from './group-moderation-store.ts';
import { typeSafeFetch } from './typesafe-fetch.ts';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export { MAX_FILTER_REQUIREMENTS } from './group-moderation-store.ts';
export const MAX_FILTER_REQUIREMENT_LENGTH = 500;
export const MAX_FILTER_WARNING_LIMIT = 100;

export interface GroupFilterWarningStatus {
  readonly count: number;
  readonly limit: number;
  readonly shouldRemoveParticipant: boolean;
}

@Injectable([BOT_CONFIG, GroupModerationStore, APP_LOGGER])
export class BadWordFilter {
  private client: TypeSafeClient | undefined;

  constructor(
    private readonly config: BotConfig,
    private readonly store: GroupModerationStore,
    private readonly logger: Logger,
  ) {}

  /**
   * Returns true only when an enabled group has a configured TypeSafe key
   * and Jev classifies the built-in or a group-defined rule above the
   * configured threshold.
   */
  async shouldRemove(event: WaIncomingMessageEvent): Promise<boolean> {
    const groupJid = event.key.remoteJid;
    if (!event.key.isGroup || event.key.fromMe || !groupJid) return false;
    if (!this.config.typeSafeApiKey) return false;
    if (!(await this.store.isBadWordFilterEnabled(groupJid))) return false;
    const requirements = await this.store.listFilterRequirements(groupJid);

    const message = parseIncomingMessage(event);
    if (
      !message ||
      message.kind === 'protocol' ||
      message.kind === 'reaction'
    ) {
      return false;
    }

    try {
      const result = await this.clientForRequests().systemOne(
        await moderationRequest(message, requirements),
      );
      const badWordProbability = result.answers.has_bad_word?.noul ?? 0;
      const matchedRequirements = requirements.filter(
        (requirement) =>
          (result.answers[`requirement_${requirement.id}`]?.noul ?? 0) >=
          this.config.badWordThreshold,
      );
      const shouldRemove =
        badWordProbability >= this.config.badWordThreshold ||
        matchedRequirements.length > 0;
      this.logger.info('Jev bad-word moderation completed', {
        event: 'moderation.bad_word',
        chatJid: groupJid,
        messageId: event.key.id,
        model: result.model,
        badWordProbability,
        matchedRequirementIds: matchedRequirements.map(
          (requirement) => requirement.id,
        ),
        threshold: this.config.badWordThreshold,
        outcome: shouldRemove ? 'remove' : 'allow',
      });
      return shouldRemove;
    } catch (error) {
      // A model outage must not make group messaging unavailable.
      this.logger.warn(
        'Jev bad-word moderation unavailable; allowing message',
        {
          event: 'moderation.bad_word',
          chatJid: groupJid,
          messageId: event.key.id,
          err: error,
        },
      );
      return false;
    }
  }

  async setEnabled(groupJid: string, enabled: boolean): Promise<void> {
    await this.store.setBadWordFilterEnabled(groupJid, enabled);
  }

  async addRequirement(
    groupJid: string,
    rawRequirement: string,
  ): Promise<GroupFilterRequirement> {
    const requirement = rawRequirement.trim().replace(/\s+/g, ' ');
    if (!requirement) throw new Error('A filter requirement is required.');
    if (requirement.length > MAX_FILTER_REQUIREMENT_LENGTH) {
      throw new Error(
        `A filter requirement must be at most ${MAX_FILTER_REQUIREMENT_LENGTH} characters.`,
      );
    }

    return this.store.addFilterRequirement(groupJid, requirement);
  }

  async listRequirements(
    groupJid: string,
  ): Promise<readonly GroupFilterRequirement[]> {
    return this.store.listFilterRequirements(groupJid);
  }

  async removeRequirement(
    groupJid: string,
    requirementId: number,
  ): Promise<boolean> {
    return this.store.removeFilterRequirement(groupJid, requirementId);
  }

  async clearRequirements(groupJid: string): Promise<number> {
    return this.store.clearFilterRequirements(groupJid);
  }

  async setWarningLimit(
    groupJid: string,
    warningLimit: number | undefined,
  ): Promise<void> {
    if (
      warningLimit !== undefined &&
      (warningLimit < 1 || warningLimit > MAX_FILTER_WARNING_LIMIT)
    ) {
      throw new Error(
        `The warning limit must be from 1 to ${MAX_FILTER_WARNING_LIMIT}.`,
      );
    }
    await this.store.setWarningLimit(groupJid, warningLimit);
  }

  async getWarningLimit(groupJid: string): Promise<number | undefined> {
    return this.store.getWarningLimit(groupJid);
  }

  async recordWarning(
    groupJid: string,
    participantJid: string,
  ): Promise<GroupFilterWarningStatus | undefined> {
    const limit = await this.store.getWarningLimit(groupJid);
    if (limit === undefined) return undefined;
    const warning = await this.store.incrementWarning(groupJid, participantJid);
    return {
      count: warning.count,
      limit,
      shouldRemoveParticipant: warning.count >= limit,
    };
  }

  async clearWarnings(groupJid: string, participantJid: string): Promise<void> {
    await this.store.clearWarnings(groupJid, participantJid);
  }

  private clientForRequests(): TypeSafeClient {
    this.client ??= new TypeSafeClient({
      apiKey: this.config.typeSafeApiKey,
      defaultModel: this.config.typeSafeModel,
      defaultHeaders: {
        'TypeSafe-Danger-Zone-Images': 'true',
      },
      timeout: 4_000,
      retry: { maxRetries: 0 },
      fetch: typeSafeFetch,
    });
    return this.client;
  }
}

async function moderationRequest(
  message: ReturnType<typeof parseIncomingMessage>,
  requirements: readonly GroupFilterRequirement[],
) {
  const text = message?.text?.trim();
  const state: { content: string; image?: ReturnType<typeof image> } = {
    content: text || '(No text or caption.)',
  };

  if (
    message?.kind === 'image' &&
    !message.media.isViewOnce &&
    imageIsSupported(message)
  ) {
    const bytes = await readImage(message);
    if (bytes) state.image = image(bytes);
  }

  const subject = state.image
    ? '`content` or the visible text in `image`'
    : '`content`';
  const questions: Record<string, NoulQuestion> = {
    has_bad_word: noul(
      `Does ${subject} contain a profane, obscene, or hateful slur?`,
      {
        true: 'A profane, obscene, or hateful slur, including a deliberate misspelling used to evade moderation.',
        false:
          'Ordinary language, or a neutral discussion that merely quotes or refers to a bad word without using it abusively.',
      },
    ),
  };
  for (const requirement of requirements) {
    questions[`requirement_${requirement.id}`] = noul(
      `Does ${subject} violate this group rule: ${requirement.requirement}`,
      {
        true: `The message violates the group rule: ${requirement.requirement}`,
        false: `The message does not violate the group rule: ${requirement.requirement}`,
      },
    );
  }

  return {
    state,
    questions,
  };
}

function imageIsSupported(message: ParsedMediaMessage): boolean {
  const mimeType = message.media.mimeType?.toLowerCase();
  const size = message.media.fileSize;
  return (
    (mimeType === 'image/jpeg' ||
      mimeType === 'image/jpg' ||
      mimeType === 'image/png') &&
    (size === undefined || size <= MAX_IMAGE_BYTES)
  );
}

async function readImage(
  message: ParsedMediaMessage,
): Promise<Uint8Array | undefined> {
  const chunks: Uint8Array[] = [];
  let length = 0;

  for await (const chunk of await message.download()) {
    const bytes = binaryChunk(chunk);
    length += bytes.byteLength;
    if (length > MAX_IMAGE_BYTES) return undefined;
    chunks.push(bytes);
  }

  const imageBytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    imageBytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return imageBytes;
}

function binaryChunk(chunk: unknown): Uint8Array {
  if (chunk instanceof Uint8Array) return chunk;
  if (chunk instanceof ArrayBuffer) return new Uint8Array(chunk);
  throw new TypeError('Media download produced a non-binary chunk.');
}
