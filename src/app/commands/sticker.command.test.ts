import { expect, test } from 'bun:test';
import { Readable } from 'node:stream';
import { NativeStickerWorkerTransportError } from '@rin-ts/sticker';
import type { StickerWorker } from '@/app/sticker/sticker-worker.ts';
import type { CommandContext } from '@/framework/commands/contracts.ts';
import { StickerCommand } from './sticker.command.ts';

const sticker = {
  data: new Uint8Array([1, 2, 3]),
  width: 512,
  height: 512,
  frameCount: 2,
  durationMs: 100,
  isAnimated: true,
};

test('converts an attached video into an animated sticker', async () => {
  const calls: string[] = [];
  const worker = {
    transcode: async () => {
      calls.push('video');
      return sticker;
    },
  };
  const { context, downloads, replies, reactions } = mediaContext('video', 1);

  await new StickerCommand(worker as unknown as StickerWorker).execute(context);

  expect(calls).toEqual(['video']);
  expect(downloads).toHaveLength(1);
  expect(reactions).toEqual(['⏳']);
  expect(replies).toEqual([{ type: 'sticker', media: sticker.data }]);
});

test('rejects an oversized video before downloading or transcoding it', async () => {
  const worker = {
    transcode: async () => sticker,
  };
  const { context, downloads, replies, reactions } = mediaContext(
    'video',
    16 * 1024 * 1024 + 1,
  );

  await new StickerCommand(worker as unknown as StickerWorker).execute(context);

  expect(downloads).toHaveLength(0);
  expect(reactions).toEqual([]);
  expect(replies).toEqual(['Images and videos must be 16 MiB or smaller.']);
});

test('reports an unavailable native worker without failing the command', async () => {
  const worker = {
    transcode: async () => {
      throw new NativeStickerWorkerTransportError('worker unavailable');
    },
  };
  const { context, replies, reactions } = mediaContext('image', 1);

  await new StickerCommand(worker as unknown as StickerWorker).execute(context);

  expect(reactions).toEqual(['⏳']);
  expect(replies).toEqual([
    'Sticker conversion is unavailable on this server. Contact the bot administrator.',
  ]);
});

function mediaContext(
  kind: 'image' | 'video',
  fileSize: number,
): {
  readonly context: CommandContext;
  readonly downloads: readonly undefined[];
  readonly replies: unknown[];
  readonly reactions: string[];
} {
  const downloads: undefined[] = [];
  const replies: unknown[] = [];
  const reactions: string[] = [];
  const context = {
    event: {},
    message: {
      kind,
      context: {
        mentionedJids: [],
        isForwarded: false,
      },
      raw: {},
      media: {
        fileSize,
        isGif: false,
        isVoiceNote: false,
        isAnimated: false,
        isViewOnce: false,
      },
      download: async () => {
        downloads.push(undefined);
        return Readable.from([new Uint8Array([1])]);
      },
    },
    prefix: '!',
    args: [],
    reply: async (content: unknown) => {
      replies.push(content);
    },
    send: async () => undefined,
    react: async (emoji: string) => {
      reactions.push(emoji);
    },
  } as unknown as CommandContext;
  return { context, downloads, replies, reactions };
}
