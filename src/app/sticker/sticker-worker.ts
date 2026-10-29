import {
  createNativeStickerWorker,
  type NativeStickerSource,
  type NativeStickerTranscodeOptions,
} from '@rin-ts/sticker';
import { Injectable } from '@/framework/core/di.ts';

@Injectable()
export class StickerWorker implements AsyncDisposable {
  private readonly worker = createNativeStickerWorker();

  transcode(
    source: NativeStickerSource,
    options: NativeStickerTranscodeOptions,
  ) {
    return this.worker.transcode(source, options);
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.worker.close();
  }
}
