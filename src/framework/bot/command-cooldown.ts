import { Injectable } from '@/framework/core/di.ts';

export interface CooldownAttempt {
  readonly allowed: boolean;
  /** Present only when the command remains on cooldown. */
  readonly remainingMs?: number;
}

/**
 * In-memory command cooldowns. They intentionally reset when the bot process
 * restarts; a cooldown protects command capacity rather than storing user data.
 */
@Injectable()
export class CommandCooldownTracker {
  private readonly expiryByKey = new Map<string, number>();
  private nextPruneAt = 0;

  constructor(
    private readonly now: () => number = performance.now.bind(performance),
  ) {}

  tryAcquire(
    commandName: string,
    sender: string,
    cooldownMs: number,
  ): CooldownAttempt {
    const now = this.now();
    this.pruneExpired(now);

    const key = `${commandName}\u0000${sender}`;
    const expiry = this.expiryByKey.get(key);
    if (expiry !== undefined && expiry > now) {
      return {
        allowed: false,
        remainingMs: Math.ceil(expiry - now),
      };
    }

    this.expiryByKey.set(key, now + cooldownMs);
    return { allowed: true };
  }

  private pruneExpired(now: number): void {
    if (now < this.nextPruneAt) return;

    for (const [key, expiry] of this.expiryByKey) {
      if (expiry <= now) this.expiryByKey.delete(key);
    }
    this.nextPruneAt = now + 60_000;
  }
}
