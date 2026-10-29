import type { Readable } from 'node:stream';
import {
  NativeStickerWorkerError,
  NativeStickerWorkerTimeoutError,
  NativeStickerWorkerTransportError,
} from '@rin-ts/sticker';
import { downloadMediaMessage } from 'zapo-js';
import { StickerWorker } from '@/app/sticker/sticker-worker.ts';
import { Command } from '@/framework/commands/command.decorator.ts';
import type {
  BotCommand,
  CommandContext,
} from '@/framework/commands/contracts.ts';
import { Injectable } from '@/framework/core/di.ts';

const maximumSourceBytes = 16 * 1024 * 1024;

@Command({
  name: 'sticker',
  aliases: ['s'],
  description: 'Convert an image or video into a WhatsApp sticker.',
  usage: '[reply-to-image-or-video]',
})
@Injectable([StickerWorker])
export class StickerCommand implements BotCommand {
  constructor(private readonly stickerWorker: StickerWorker) {}

  async execute(context: CommandContext): Promise<void> {
    const source = stickerSource(context);
    if (!source) {
      await context.reply(
        'Send an image or video with `!sticker` as its caption, or reply to one with `!sticker`.',
      );
      return;
    }

    if (
      (context.message.kind === 'image' || context.message.kind === 'video') &&
      context.message.media.fileSize !== undefined &&
      context.message.media.fileSize > maximumSourceBytes
    ) {
      await context.reply('Images and videos must be 16 MiB or smaller.');
      return;
    }

    await context.react('⏳', true);

    try {
      const media = await readMedia(source);
      const options = {
        trim: true,
        alphaThreshold: 4,
      };
      const sticker = await this.stickerWorker.transcode(media, options);
      await context.reply({ type: 'sticker', media: sticker.data });
    } catch (error) {
      if (error instanceof SourceTooLargeError) {
        await context.reply('Images and videos must be 16 MiB or smaller.');
        return;
      }
      if (error instanceof NativeStickerWorkerTimeoutError) {
        await context.reply(
          'Sticker conversion timed out. Try a smaller image or a shorter video.',
        );
        return;
      }
      if (error instanceof NativeStickerWorkerError) {
        await context.reply(
          source.kind === 'video'
            ? 'That video format could not be converted into an animated sticker.'
            : 'That image format could not be converted into a sticker.',
        );
        return;
      }
      if (error instanceof NativeStickerWorkerTransportError) {
        await context.reply(
          'Sticker conversion is unavailable on this server. Contact the bot administrator.',
        );
        return;
      }
      throw error;
    }
  }
}

interface StickerSource {
  readonly kind: 'image' | 'video';
  readonly download: () => Promise<Readable>;
}

function stickerSource(context: CommandContext): StickerSource | undefined {
  const message = context.message;
  if (message.kind === 'image' || message.kind === 'video') {
    const { download, kind } = message;
    return {
      kind,
      download: () =>
        download({
          maxBytes: maximumSourceBytes,
        }),
    };
  }

  const quotedMessage = message.context.quotedMessage;
  const kind = quotedStickerSourceKind(quotedMessage);
  if (!quotedMessage || !kind) return undefined;

  return {
    kind,
    download: () =>
      downloadMediaMessage(quotedMessage, {
        maxBytes: maximumSourceBytes,
      }),
  };
}

function quotedStickerSourceKind(
  message: CommandContext['message']['context']['quotedMessage'],
): StickerSource['kind'] | undefined {
  if (!message) return undefined;

  let current = message;
  for (;;) {
    if (current.imageMessage != null) return 'image';
    if (current.videoMessage != null || current.ptvMessage != null) {
      return 'video';
    }

    const wrapped =
      current.ephemeralMessage?.message ??
      current.viewOnceMessage?.message ??
      current.viewOnceMessageV2?.message ??
      current.viewOnceMessageV2Extension?.message ??
      current.documentWithCaptionMessage?.message ??
      current.editedMessage?.message ??
      current.deviceSentMessage?.message;
    if (wrapped == null) return undefined;
    current = wrapped;
  }
}

async function readMedia(source: StickerSource): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  for await (const chunk of await source.download()) {
    const bytes = toBytes(chunk);
    byteLength += bytes.byteLength;
    if (byteLength > maximumSourceBytes) throw new SourceTooLargeError();
    chunks.push(new Uint8Array(bytes));
  }

  const media = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    media.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return media;
}

function toBytes(chunk: unknown): Uint8Array {
  if (chunk instanceof Uint8Array) return chunk;
  if (chunk instanceof ArrayBuffer) return new Uint8Array(chunk);
  throw new TypeError('Media download produced a non-binary chunk.');
}

class SourceTooLargeError extends Error {
  constructor() {
    super('Media source exceeds the sticker input limit.');
  }
}
