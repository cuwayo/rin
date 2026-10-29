import type { Readable } from 'node:stream';
import type {
  WaDownloadMediaMessageOptions,
  WaIncomingMessageEvent,
} from 'zapo-js';
import { downloadMediaMessage } from 'zapo-js';

export type MessageKind =
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'sticker'
  | 'location'
  | 'live-location'
  | 'contact'
  | 'contacts'
  | 'reaction'
  | 'poll'
  | 'poll-update'
  | 'button-response'
  | 'list-response'
  | 'template-button-response'
  | 'interactive-response'
  | 'group-invite'
  | 'protocol'
  | 'unknown';

export interface ParsedMessageContext {
  readonly mentionedJids: readonly string[];
  readonly quotedMessageId?: string;
  readonly quotedParticipant?: string;
  readonly quotedChatJid?: string;
  readonly quotedMessage?: WaIncomingMessageEvent['message'];
  readonly isForwarded: boolean;
  readonly forwardingScore?: number;
  readonly expirationSeconds?: number;
}

export interface ParsedMessageBase {
  readonly kind: MessageKind;
  readonly text?: string;
  readonly context: ParsedMessageContext;
  /**
   * The original proto payload. It keeps new WhatsApp fields available
   * without forcing the bot to wait for this normalized API to be updated.
   */
  readonly raw: NonNullable<WaIncomingMessageEvent['message']>;
}

export interface ParsedGenericMessage extends ParsedMessageBase {
  readonly kind: 'text' | 'unknown';
}

export interface ParsedMediaMessage extends ParsedMessageBase {
  readonly kind: 'image' | 'video' | 'audio' | 'document' | 'sticker';
  readonly media: {
    readonly mimeType?: string;
    readonly fileName?: string;
    readonly fileSize?: number;
    readonly width?: number;
    readonly height?: number;
    readonly durationSeconds?: number;
    readonly isGif: boolean;
    readonly isVoiceNote: boolean;
    readonly isAnimated: boolean;
    readonly isViewOnce: boolean;
  };
  /**
   * Downloads and decrypts the media only when the command needs it. Do not
   * call this merely to inspect an incoming message.
   */
  download(options?: WaDownloadMediaMessageOptions): Promise<Readable>;
}

export interface ParsedLocationMessage extends ParsedMessageBase {
  readonly kind: 'location' | 'live-location';
  readonly location: {
    readonly latitude?: number;
    readonly longitude?: number;
    readonly name?: string;
    readonly address?: string;
    readonly url?: string;
    readonly accuracyMeters?: number;
    readonly speedMetersPerSecond?: number;
    readonly bearingDegrees?: number;
  };
}

export interface ParsedContactMessage extends ParsedMessageBase {
  readonly kind: 'contact' | 'contacts';
  readonly contacts: readonly {
    readonly displayName?: string;
    readonly vcard?: string;
  }[];
}

export interface ParsedReactionMessage extends ParsedMessageBase {
  readonly kind: 'reaction';
  readonly reaction: {
    readonly emoji?: string;
    readonly messageId?: string;
    readonly chatJid?: string;
    readonly participant?: string;
  };
}

export interface ParsedPollMessage extends ParsedMessageBase {
  readonly kind: 'poll';
  readonly poll: {
    readonly name?: string;
    readonly options: readonly string[];
    readonly selectableOptionsCount?: number;
  };
}

export interface ParsedPollUpdateMessage extends ParsedMessageBase {
  readonly kind: 'poll-update';
  readonly pollUpdate: {
    readonly pollMessageId?: string;
    readonly pollChatJid?: string;
    readonly participant?: string;
  };
}

export interface ParsedInteractiveResponseMessage extends ParsedMessageBase {
  readonly kind:
    | 'button-response'
    | 'list-response'
    | 'template-button-response'
    | 'interactive-response';
  readonly response: {
    readonly id?: string;
    readonly displayText?: string;
    readonly nativeFlowName?: string;
    readonly nativeFlowParamsJson?: string;
  };
}

export interface ParsedGroupInviteMessage extends ParsedMessageBase {
  readonly kind: 'group-invite';
  readonly groupInvite: {
    readonly groupJid?: string;
    readonly groupName?: string;
    readonly inviteCode?: string;
    readonly expiresAtSeconds?: number;
  };
}

export interface ParsedProtocolMessage extends ParsedMessageBase {
  readonly kind: 'protocol';
  readonly protocol: {
    readonly type?: number;
    readonly targetMessageId?: string;
    readonly targetChatJid?: string;
    readonly targetParticipant?: string;
  };
}

export type ParsedMessage =
  | ParsedMediaMessage
  | ParsedLocationMessage
  | ParsedContactMessage
  | ParsedReactionMessage
  | ParsedPollMessage
  | ParsedPollUpdateMessage
  | ParsedInteractiveResponseMessage
  | ParsedGroupInviteMessage
  | ParsedProtocolMessage
  | ParsedGenericMessage;

type Message = NonNullable<WaIncomingMessageEvent['message']>;

interface UnwrappedMessage {
  readonly message: Message;
  readonly isViewOnce: boolean;
}

export function parseIncomingMessage(
  event: WaIncomingMessageEvent,
): ParsedMessage | undefined {
  if (!event.message) return undefined;

  const { message, isViewOnce } = unwrapMessage(event.message);
  const context = parseContext(message, event.expirationSeconds);
  const base = { context, raw: event.message };

  if (message.conversation != null || message.extendedTextMessage != null) {
    return {
      ...base,
      kind: 'text',
      text:
        message.conversation ?? message.extendedTextMessage?.text ?? undefined,
    };
  }

  if (message.imageMessage != null) {
    return parseMediaMessage(
      event,
      base,
      'image',
      message.imageMessage,
      isViewOnce,
    );
  }
  if (message.videoMessage != null || message.ptvMessage != null) {
    const video = message.videoMessage ?? message.ptvMessage;
    if (!video) return { ...base, kind: 'unknown' };
    return parseMediaMessage(event, base, 'video', video, isViewOnce);
  }
  if (message.audioMessage != null) {
    return parseMediaMessage(
      event,
      base,
      'audio',
      message.audioMessage,
      isViewOnce,
    );
  }
  if (message.documentMessage != null) {
    return parseMediaMessage(
      event,
      base,
      'document',
      message.documentMessage,
      isViewOnce,
    );
  }
  if (message.stickerMessage != null) {
    return parseMediaMessage(
      event,
      base,
      'sticker',
      message.stickerMessage,
      isViewOnce,
    );
  }

  if (message.locationMessage != null) {
    const location = message.locationMessage;
    return {
      ...base,
      kind: 'location',
      text: location.comment ?? undefined,
      location: {
        latitude: location.degreesLatitude ?? undefined,
        longitude: location.degreesLongitude ?? undefined,
        name: location.name ?? undefined,
        address: location.address ?? undefined,
        url: location.url ?? undefined,
        accuracyMeters: location.accuracyInMeters ?? undefined,
        speedMetersPerSecond: location.speedInMps ?? undefined,
        bearingDegrees: location.degreesClockwiseFromMagneticNorth ?? undefined,
      },
    };
  }
  if (message.liveLocationMessage != null) {
    const location = message.liveLocationMessage;
    return {
      ...base,
      kind: 'live-location',
      text: location.caption ?? undefined,
      location: {
        latitude: location.degreesLatitude ?? undefined,
        longitude: location.degreesLongitude ?? undefined,
        accuracyMeters: location.accuracyInMeters ?? undefined,
        speedMetersPerSecond: location.speedInMps ?? undefined,
        bearingDegrees: location.degreesClockwiseFromMagneticNorth ?? undefined,
      },
    };
  }

  if (message.contactMessage != null) {
    return {
      ...base,
      kind: 'contact',
      contacts: [toContact(message.contactMessage)],
    };
  }
  if (message.contactsArrayMessage != null) {
    return {
      ...base,
      kind: 'contacts',
      contacts: message.contactsArrayMessage.contacts?.map(toContact) ?? [],
    };
  }

  if (message.reactionMessage != null) {
    const reaction = message.reactionMessage;
    return {
      ...base,
      kind: 'reaction',
      reaction: {
        emoji: reaction.text ?? undefined,
        messageId: reaction.key?.id ?? undefined,
        chatJid: reaction.key?.remoteJid ?? undefined,
        participant: reaction.key?.participant ?? undefined,
      },
    };
  }

  const poll = firstPoll(message);
  if (poll != null) {
    return {
      ...base,
      kind: 'poll',
      poll: {
        name: poll.name ?? undefined,
        options:
          poll.options?.flatMap((option) =>
            option.optionName == null ? [] : [option.optionName],
          ) ?? [],
        selectableOptionsCount: poll.selectableOptionsCount ?? undefined,
      },
    };
  }
  if (message.pollUpdateMessage != null) {
    const pollUpdate = message.pollUpdateMessage;
    return {
      ...base,
      kind: 'poll-update',
      pollUpdate: {
        pollMessageId: pollUpdate.pollCreationMessageKey?.id ?? undefined,
        pollChatJid: pollUpdate.pollCreationMessageKey?.remoteJid ?? undefined,
        participant:
          pollUpdate.pollCreationMessageKey?.participant ?? undefined,
      },
    };
  }

  if (message.buttonsResponseMessage != null) {
    const response = message.buttonsResponseMessage;
    return {
      ...base,
      kind: 'button-response',
      text:
        response.selectedButtonId ?? response.selectedDisplayText ?? undefined,
      response: {
        id: response.selectedButtonId ?? undefined,
        displayText: response.selectedDisplayText ?? undefined,
      },
    };
  }
  if (message.listResponseMessage != null) {
    const response = message.listResponseMessage;
    return {
      ...base,
      kind: 'list-response',
      text:
        response.singleSelectReply?.selectedRowId ??
        response.title ??
        undefined,
      response: {
        id: response.singleSelectReply?.selectedRowId ?? undefined,
        displayText: response.title ?? undefined,
      },
    };
  }
  if (message.templateButtonReplyMessage != null) {
    const response = message.templateButtonReplyMessage;
    return {
      ...base,
      kind: 'template-button-response',
      text: response.selectedId ?? response.selectedDisplayText ?? undefined,
      response: {
        id: response.selectedId ?? undefined,
        displayText: response.selectedDisplayText ?? undefined,
      },
    };
  }
  if (message.interactiveResponseMessage != null) {
    const response = message.interactiveResponseMessage;
    return {
      ...base,
      kind: 'interactive-response',
      text: response.body?.text ?? undefined,
      response: {
        displayText: response.body?.text ?? undefined,
        nativeFlowName: response.nativeFlowResponseMessage?.name ?? undefined,
        nativeFlowParamsJson:
          response.nativeFlowResponseMessage?.paramsJson ?? undefined,
      },
    };
  }

  if (message.groupInviteMessage != null) {
    const invite = message.groupInviteMessage;
    return {
      ...base,
      kind: 'group-invite',
      text: invite.caption ?? undefined,
      groupInvite: {
        groupJid: invite.groupJid ?? undefined,
        groupName: invite.groupName ?? undefined,
        inviteCode: invite.inviteCode ?? undefined,
        expiresAtSeconds: toNumber(invite.inviteExpiration),
      },
    };
  }
  if (message.protocolMessage != null) {
    const protocol = message.protocolMessage;
    return {
      ...base,
      kind: 'protocol',
      protocol: {
        type: protocol.type ?? undefined,
        targetMessageId: protocol.key?.id ?? undefined,
        targetChatJid: protocol.key?.remoteJid ?? undefined,
        targetParticipant: protocol.key?.participant ?? undefined,
      },
    };
  }

  return { ...base, kind: 'unknown' };
}

function parseMediaMessage(
  event: WaIncomingMessageEvent,
  base: Pick<ParsedMessageBase, 'context' | 'raw'>,
  kind: ParsedMediaMessage['kind'],
  media: {
    readonly caption?: string | null;
    readonly mimetype?: string | null;
    readonly fileName?: string | null;
    readonly fileLength?: number | { toNumber(): number } | null;
    readonly width?: number | null;
    readonly height?: number | null;
    readonly seconds?: number | null;
    readonly gifPlayback?: boolean | null;
    readonly ptt?: boolean | null;
    readonly isAnimated?: boolean | null;
    readonly viewOnce?: boolean | null;
  },
  isViewOnce: boolean,
): ParsedMediaMessage {
  return {
    ...base,
    kind,
    text: media.caption ?? undefined,
    media: {
      mimeType: media.mimetype ?? undefined,
      fileName: media.fileName ?? undefined,
      fileSize: toNumber(media.fileLength),
      width: media.width ?? undefined,
      height: media.height ?? undefined,
      durationSeconds: media.seconds ?? undefined,
      isGif: media.gifPlayback === true,
      isVoiceNote: media.ptt === true,
      isAnimated: media.isAnimated === true,
      isViewOnce: isViewOnce || media.viewOnce === true,
    },
    download: (options) => downloadMediaMessage(event, options),
  };
}

function parseContext(
  message: Message,
  expirationSeconds: number | undefined,
): ParsedMessageContext {
  const context = firstContextInfo(message);
  return {
    mentionedJids: context?.mentionedJid ?? [],
    quotedMessageId: context?.stanzaId ?? undefined,
    quotedParticipant: context?.participant ?? undefined,
    quotedChatJid: context?.remoteJid ?? undefined,
    quotedMessage: context?.quotedMessage ?? undefined,
    isForwarded: context?.isForwarded === true,
    forwardingScore: context?.forwardingScore ?? undefined,
    expirationSeconds: context?.expiration ?? expirationSeconds,
  };
}

function firstContextInfo(message: Message) {
  return (
    message.extendedTextMessage?.contextInfo ??
    message.imageMessage?.contextInfo ??
    message.videoMessage?.contextInfo ??
    message.ptvMessage?.contextInfo ??
    message.audioMessage?.contextInfo ??
    message.documentMessage?.contextInfo ??
    message.stickerMessage?.contextInfo ??
    message.locationMessage?.contextInfo ??
    message.liveLocationMessage?.contextInfo ??
    message.contactMessage?.contextInfo ??
    message.contactsArrayMessage?.contextInfo ??
    message.buttonsResponseMessage?.contextInfo ??
    message.listResponseMessage?.contextInfo ??
    message.templateButtonReplyMessage?.contextInfo ??
    message.interactiveResponseMessage?.contextInfo ??
    message.groupInviteMessage?.contextInfo ??
    firstPoll(message)?.contextInfo ??
    undefined
  );
}

function firstPoll(message: Message) {
  return (
    message.pollCreationMessage ??
    message.pollCreationMessageV2 ??
    message.pollCreationMessageV3 ??
    message.pollCreationMessageV5 ??
    message.pollCreationMessageV6 ??
    undefined
  );
}

function unwrapMessage(message: Message): UnwrappedMessage {
  let current = message;
  let isViewOnce = false;

  for (;;) {
    const wrapped =
      current.ephemeralMessage?.message ??
      current.viewOnceMessage?.message ??
      current.viewOnceMessageV2?.message ??
      current.viewOnceMessageV2Extension?.message ??
      current.documentWithCaptionMessage?.message ??
      current.editedMessage?.message ??
      current.deviceSentMessage?.message;
    if (wrapped == null) return { message: current, isViewOnce };

    isViewOnce ||= Boolean(
      current.viewOnceMessage ??
        current.viewOnceMessageV2 ??
        current.viewOnceMessageV2Extension,
    );
    current = wrapped;
  }
}

function toContact(contact: {
  readonly displayName?: string | null;
  readonly vcard?: string | null;
}): { readonly displayName?: string; readonly vcard?: string } {
  return {
    displayName: contact.displayName ?? undefined,
    vcard: contact.vcard ?? undefined,
  };
}

function toNumber(
  value: number | { toNumber(): number } | null | undefined,
): number | undefined {
  if (value == null) return undefined;
  return typeof value === 'number' ? value : value.toNumber();
}
