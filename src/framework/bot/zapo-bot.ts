import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createSqliteStore } from '@zapo-js/store-sqlite';
import * as terminalQr from 'qrcode-terminal';
import type { Logger, WaGroupMetadata, WaIncomingMessageEvent } from 'zapo-js';
import { createStore, WaClient } from 'zapo-js';
import type { GroupCommandActions } from '../commands/contracts.ts';
import type { BotConfig } from '../config.ts';
import { BOT_CONFIG } from '../config.ts';
import { Injectable } from '../core/di.ts';
import { normalizeUserJid } from '../core/jid.ts';
import { APP_LOGGER } from '../core/logger.ts';
import { GroupMetadataCache } from '../groups/group-metadata-cache.ts';
import {
  BadWordFilter,
  type GroupFilterWarningStatus,
} from '../moderation/bad-word-filter.ts';
import { CommandRouter } from './command-router.ts';

@Injectable([
  BOT_CONFIG,
  CommandRouter,
  BadWordFilter,
  GroupMetadataCache,
  APP_LOGGER,
])
export class ZapoBot implements AsyncDisposable {
  private client: InstanceType<typeof WaClient> | undefined;

  constructor(
    private readonly config: BotConfig,
    private readonly commandRouter: CommandRouter,
    private readonly badWordFilter: BadWordFilter,
    private readonly groupMetadataCache: GroupMetadataCache,
    private readonly logger: Logger,
  ) {}

  async start(): Promise<void> {
    if (this.client !== undefined) return;

    await mkdir(dirname(this.config.authPath), { recursive: true });

    const store = createStore({
      backends: {
        sqlite: createSqliteStore({
          path: this.config.authPath,
          driver: 'auto',
        }),
      },
      providers: {
        auth: 'sqlite',
        signal: 'sqlite',
        preKey: 'sqlite',
        session: 'sqlite',
        identity: 'sqlite',
        senderKey: 'sqlite',
        appState: 'sqlite',
        privacyToken: 'sqlite',
        messages: 'sqlite',
        threads: 'sqlite',
        contacts: 'sqlite',
      },
    });

    const client = new WaClient(
      {
        store,
        sessionId: this.config.sessionId,
        connectTimeoutMs: 15_000,
        nodeQueryTimeoutMs: 30_000,
      },
      this.logger,
    );
    this.client = client;

    let pairingCodeRequestInFlight = false;
    let displayedPairingCode: string | undefined;

    const displayPairingCode = (code: string): void => {
      if (code === displayedPairingCode) return;

      displayedPairingCode = code;
      const displayCode = code.match(/.{1,4}/g)?.join('-') ?? code;
      this.logger.info('WhatsApp pairing code received', {
        event: 'auth.pairing_code',
        phoneNumber: this.config.pairingPhoneNumber,
        pairingCode: displayCode,
      });
    };

    const requestPairingCode = async (): Promise<void> => {
      const phoneNumber = this.config.pairingPhoneNumber;
      if (!phoneNumber || pairingCodeRequestInFlight || displayedPairingCode)
        return;

      pairingCodeRequestInFlight = true;
      try {
        displayPairingCode(await client.auth.requestPairingCode(phoneNumber));
      } catch (error) {
        this.logger.error('Unable to request a WhatsApp pairing code', {
          event: 'auth.pairing_code_request',
          err: error,
        });
      } finally {
        pairingCodeRequestInFlight = false;
      }
    };

    client.on('auth_qr', ({ qr, ttlMs }) => {
      if (this.config.pairingPhoneNumber) {
        // Zapo permits a code request once the first QR is available.
        void requestPairingCode();
        return;
      }
      this.logger.info('WhatsApp QR code received', {
        event: 'auth.qr',
        expiresInSeconds: Math.ceil(ttlMs / 1000),
      });
      terminalQr.generate(qr, { small: true });
    });

    client.on('auth_pairing_required', () => void requestPairingCode());
    client.on('auth_pairing_code', ({ code }) => displayPairingCode(code));

    client.on('auth_paired', ({ credentials }) => {
      this.logger.info('WhatsApp paired', {
        event: 'auth.paired',
        accountJid: credentials.meJid,
      });
    });

    client.on('connection', ({ status, reason }) => {
      this.logger.info('WhatsApp connection updated', {
        event: 'connection.updated',
        status,
        reason,
      });
    });

    client.on('message', (event) => this.handleIncomingMessage(client, event));
    client.on('group', (event) => {
      const groupJid = event.groupJid ?? event.chatJid;
      if (!groupJid) return;
      void this.refreshGroupMetadata(client, groupJid);
    });

    await client.connect();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    const client = this.client;
    this.client = undefined;
    if (client !== undefined) await client.disconnect();
  }

  private async handleIncomingMessage(
    client: InstanceType<typeof WaClient>,
    event: WaIncomingMessageEvent,
  ): Promise<void> {
    try {
      if (await this.badWordFilter.shouldRemove(event)) {
        await this.handleFilterViolation(client, event);
        return;
      }

      await this.commandRouter.handle(
        event,
        {
          reply: async (incoming, content) => {
            const chatJid = incoming.key.remoteJid;
            if (!chatJid) return;
            await client.message.send(chatJid, content, {
              quote: incoming,
            });
          },
          send: async (jid, content) => {
            await client.message.send(jid, content);
          },
          react: async (incoming, emoji) => {
            const chatJid = incoming.key.remoteJid;
            if (!chatJid) return;
            await client.message.send(chatJid, {
              type: 'reaction',
              emoji,
              target: incoming,
            });
          },
          group: (incoming) => this.groupActionsForMessage(client, incoming),
        },
        (incoming) => this.isSenderGroupAdmin(client, incoming),
        selfJids(client),
      );
    } catch (error) {
      this.logger.error('Unable to process incoming message', {
        event: 'message.processing',
        messageId: event.key.id,
        chatJid: event.key.remoteJid,
        err: error,
      });
    }
  }

  private groupActionsForMessage(
    client: InstanceType<typeof WaClient>,
    event: WaIncomingMessageEvent,
  ): GroupCommandActions | undefined {
    const groupJid = event.key.remoteJid;
    if (!event.key.isGroup || !groupJid) return undefined;

    const metadata = () =>
      this.groupMetadataCache.get(groupJid, () =>
        client.group.queryGroupMetadata(groupJid),
      );
    const refreshMetadata = () => this.refreshGroupMetadata(client, groupJid);
    const afterGroupMutation = async <T>(
      operation: () => Promise<T>,
    ): Promise<T> => {
      const result = await operation();
      await refreshMetadata();
      return result;
    };
    const targetParticipants = async (
      requestedParticipants: readonly string[],
    ): Promise<readonly string[]> =>
      resolveGroupParticipants(await metadata(), requestedParticipants);

    return {
      addParticipants: async (participants) =>
        afterGroupMutation(async () =>
          client.group.addParticipants(
            groupJid,
            await targetParticipants(participants),
          ),
        ),
      removeParticipants: async (participants) =>
        afterGroupMutation(async () =>
          client.group.removeParticipants(
            groupJid,
            await targetParticipants(participants),
          ),
        ),
      promoteParticipants: async (participants) =>
        afterGroupMutation(async () =>
          client.group.promoteParticipants(
            groupJid,
            await targetParticipants(participants),
          ),
        ),
      demoteParticipants: async (participants) =>
        afterGroupMutation(async () =>
          client.group.demoteParticipants(
            groupJid,
            await targetParticipants(participants),
          ),
        ),
      setSubject: async (subject) =>
        afterGroupMutation(() => client.group.setSubject(groupJid, subject)),
      setDescription: async (description) =>
        afterGroupMutation(() =>
          client.group.setDescription(groupJid, description),
        ),
      setSetting: async (setting, enabled) =>
        afterGroupMutation(() =>
          client.group.setSetting(groupJid, setting, enabled),
        ),
      setInviteLinkSharing: async (enabled) =>
        afterGroupMutation(() =>
          client.group.setMemberLinkMode(
            groupJid,
            enabled ? 'all_member_link' : 'admin_link',
          ),
        ),
      setBadWordFilter: async (enabled) => {
        await this.badWordFilter.setEnabled(groupJid, enabled);
        return {
          enabled,
          active: enabled && this.config.typeSafeApiKey !== undefined,
        };
      },
      addFilterRequirement: async (requirement) =>
        this.badWordFilter.addRequirement(groupJid, requirement),
      listFilterRequirements: async () =>
        this.badWordFilter.listRequirements(groupJid),
      removeFilterRequirement: async (requirementId) =>
        this.badWordFilter.removeRequirement(groupJid, requirementId),
      clearFilterRequirements: async () =>
        this.badWordFilter.clearRequirements(groupJid),
      setFilterWarningLimit: async (warningLimit) =>
        this.badWordFilter.setWarningLimit(groupJid, warningLimit),
      getFilterWarningLimit: async () =>
        this.badWordFilter.getWarningLimit(groupJid),
      clearFilterWarnings: async (participants) => {
        for (const participant of await targetParticipants(participants)) {
          await this.badWordFilter.clearWarnings(groupJid, participant);
        }
      },
      inviteCode: async () => client.group.queryInviteCode(groupJid),
      revokeInvite: async () =>
        (await afterGroupMutation(() => client.group.revokeInvite(groupJid)))
          .code,
      info: async () => {
        const currentMetadata = await metadata();
        return {
          subject: currentMetadata.subject,
          description: currentMetadata.desc,
          participantCount: currentMetadata.participants.length,
          announcementOnly: currentMetadata.announce,
          restrictInfoEdits: currentMetadata.restrict,
        };
      },
    };
  }

  private async handleFilterViolation(
    client: InstanceType<typeof WaClient>,
    event: WaIncomingMessageEvent,
  ): Promise<void> {
    const groupJid = event.key.remoteJid;
    if (!event.key.isGroup || !groupJid) return;

    const canModerate = await this.isBotGroupAdmin(client, groupJid);
    let messageRevoked = false;
    if (canModerate) {
      try {
        await client.message.send(groupJid, {
          type: 'revoke',
          target: event,
        });
        messageRevoked = true;
      } catch (error) {
        this.logger.warn(
          'Unable to revoke a message that violated the group filter',
          {
            event: 'moderation.revoke',
            chatJid: groupJid,
            messageId: event.key.id,
            err: error,
          },
        );
      }
    } else {
      this.logger.warn(
        'Filter violation detected but the bot is not a group admin',
        {
          event: 'moderation.permission_denied',
          chatJid: groupJid,
          messageId: event.key.id,
        },
      );
    }

    const participantJid = await this.canonicalParticipantJid(
      client,
      groupJid,
      event,
    );
    const warning = participantJid
      ? await this.badWordFilter.recordWarning(groupJid, participantJid)
      : undefined;
    await client.message.send(
      groupJid,
      filterWarningMessage(warning, canModerate, messageRevoked),
      { quote: event },
    );

    if (!canModerate || !participantJid || !warning?.shouldRemoveParticipant) {
      return;
    }

    try {
      const results = await client.group.removeParticipants(groupJid, [
        participantJid,
      ]);
      const result =
        results.find(
          (candidate) =>
            normalizeUserJid(candidate.jid) ===
            normalizeUserJid(participantJid),
        ) ?? results[0];
      if (result?.status === 'ok') {
        await this.refreshGroupMetadata(client, groupJid);
        return;
      }
      this.logger.warn(
        'Automatic group member removal was rejected by WhatsApp',
        {
          event: 'moderation.remove_participant',
          chatJid: groupJid,
          messageId: event.key.id,
          participantJid,
          result,
        },
      );
    } catch (error) {
      this.logger.warn('Unable to remove a member after filter warnings', {
        event: 'moderation.remove_participant',
        chatJid: groupJid,
        messageId: event.key.id,
        participantJid,
        err: error,
      });
    }
    await this.sendRemovalFailureWarning(client, groupJid, event);
  }

  private async canonicalParticipantJid(
    client: InstanceType<typeof WaClient>,
    groupJid: string,
    event: WaIncomingMessageEvent,
  ): Promise<string | undefined> {
    const candidateJids = [
      event.key.participant,
      event.key.participantAlt,
    ].filter((jid): jid is string => jid !== undefined);
    const fallbackParticipantJid = candidateJids[0];
    if (!fallbackParticipantJid) return undefined;

    try {
      const metadata = await this.groupMetadataCache.get(groupJid, () =>
        client.group.queryGroupMetadata(groupJid),
      );
      return (
        resolveKnownGroupParticipant(metadata, candidateJids) ??
        fallbackParticipantJid
      );
    } catch (error) {
      this.logger.warn(
        'Unable to normalize a group participant for moderation',
        {
          event: 'moderation.participant_resolution',
          chatJid: groupJid,
          messageId: event.key.id,
          err: error,
        },
      );
      return fallbackParticipantJid;
    }
  }

  private async sendRemovalFailureWarning(
    client: InstanceType<typeof WaClient>,
    groupJid: string,
    event: WaIncomingMessageEvent,
  ): Promise<void> {
    try {
      await client.message.send(
        groupJid,
        'Automatic member removal could not be completed. A group admin may need to remove this member manually.',
        { quote: event },
      );
    } catch (error) {
      this.logger.warn(
        'Unable to report a failed automatic group member removal',
        {
          event: 'moderation.remove_participant_warning',
          chatJid: groupJid,
          messageId: event.key.id,
          err: error,
        },
      );
    }
  }

  private async refreshGroupMetadata(
    client: InstanceType<typeof WaClient>,
    groupJid: string,
  ): Promise<void> {
    try {
      await this.groupMetadataCache.refresh(groupJid, () =>
        client.group.queryGroupMetadata(groupJid),
      );
    } catch (error) {
      this.logger.warn('Unable to refresh group metadata cache', {
        event: 'group.metadata_refresh',
        chatJid: groupJid,
        err: error,
      });
    }
  }

  private async isBotGroupAdmin(
    client: InstanceType<typeof WaClient>,
    groupJid: string,
  ): Promise<boolean> {
    try {
      const metadata = await this.groupMetadataCache.get(groupJid, () =>
        client.group.queryGroupMetadata(groupJid),
      );
      return isGroupAdmin(metadata, selfJids(client));
    } catch (error) {
      this.logger.warn(
        'Unable to verify whether the bot is a group admin for moderation',
        {
          event: 'moderation.authorization',
          chatJid: groupJid,
          err: error,
        },
      );
      return false;
    }
  }

  private async isSenderGroupAdmin(
    client: InstanceType<typeof WaClient>,
    event: WaIncomingMessageEvent,
  ): Promise<boolean> {
    const groupJid = event.key.remoteJid;
    const senderJid = event.key.participant;
    if (!event.key.isGroup || !groupJid || !senderJid) return false;

    try {
      const senderJids = new Set(
        [
          normalizeUserJid(senderJid),
          ...(event.key.participantAlt
            ? [normalizeUserJid(event.key.participantAlt)]
            : []),
        ].filter((jid): jid is string => jid !== undefined),
      );
      const metadata = await this.groupMetadataCache.get(groupJid, () =>
        client.group.queryGroupMetadata(groupJid),
      );
      return isGroupAdmin(metadata, senderJids);
    } catch (error) {
      this.logger.warn(
        'Unable to verify whether the command sender is a group admin',
        {
          event: 'command.authorization',
          chatJid: groupJid,
          messageId: event.key.id,
          err: error,
        },
      );
      return false;
    }
  }
}

function selfJids(client: InstanceType<typeof WaClient>): readonly string[] {
  const credentials = client.getCredentials();
  return [credentials?.meJid, credentials?.meLid].filter(
    (jid): jid is string => jid !== undefined,
  );
}

function isGroupAdmin(
  metadata: WaGroupMetadata,
  candidateJids: Iterable<string>,
): boolean {
  const normalizedCandidates = new Set(
    [...candidateJids]
      .map(normalizeUserJid)
      .filter((jid): jid is string => jid !== undefined),
  );
  return metadata.participants.some(
    (participant) =>
      participant.isAdmin &&
      [participant.jid, participant.lid, participant.phoneNumber]
        .filter((jid): jid is string => jid !== undefined)
        .map(normalizeUserJid)
        .some(
          (participantJid) =>
            participantJid !== undefined &&
            normalizedCandidates.has(participantJid),
        ),
  );
}

function resolveGroupParticipants(
  metadata: WaGroupMetadata,
  requestedParticipants: readonly string[],
): readonly string[] {
  return requestedParticipants.map(
    (participant) =>
      resolveKnownGroupParticipant(metadata, [participant]) ?? participant,
  );
}

function resolveKnownGroupParticipant(
  metadata: WaGroupMetadata,
  candidateJids: readonly string[],
): string | undefined {
  const normalizedCandidates = new Set(
    candidateJids
      .map(normalizeUserJid)
      .filter((jid): jid is string => jid !== undefined),
  );
  if (normalizedCandidates.size === 0) return undefined;

  return metadata.participants.find((participant) =>
    [participant.jid, participant.lid, participant.phoneNumber]
      .map((address) => (address ? normalizeUserJid(address) : undefined))
      .some(
        (participantJid) =>
          participantJid !== undefined &&
          normalizedCandidates.has(participantJid),
      ),
  )?.jid;
}

function filterWarningMessage(
  warning: GroupFilterWarningStatus | undefined,
  canModerate: boolean,
  messageRevoked: boolean,
): string {
  const deletionStatus = canModerate
    ? messageRevoked
      ? ''
      : ' The bot could not delete it.'
    : ' The bot is not a group admin, so it could not delete it.';
  if (!warning) {
    return `Warning: this message violated this group’s filter rules.${deletionStatus}`;
  }
  if (warning.shouldRemoveParticipant && canModerate) {
    return `Final warning: this member reached ${warning.count}/${warning.limit} filter warnings.${deletionStatus} The bot will attempt to remove this member.`;
  }
  if (warning.shouldRemoveParticipant) {
    return `Warning ${warning.count}/${warning.limit}: automatic member removal requires the bot to be a group admin.${deletionStatus}`;
  }
  return `Warning ${warning.count}/${warning.limit}: this message violated this group’s filter rules.${deletionStatus}`;
}
