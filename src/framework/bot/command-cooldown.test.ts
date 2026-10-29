import { expect, test } from 'bun:test';
import { Cooldown, commandCooldown } from '../commands/command.decorator.ts';
import type { BotCommand, CommandContext } from '../commands/contracts.ts';
import { CommandCooldownTracker } from './command-cooldown.ts';

test('allows a sender again once a command cooldown expires', () => {
  let now = 10_000;
  const tracker = new CommandCooldownTracker(() => now);

  expect(tracker.tryAcquire('sticker', '628123@s.whatsapp.net', 1_000)).toEqual(
    { allowed: true },
  );

  now += 250;
  expect(tracker.tryAcquire('sticker', '628123@s.whatsapp.net', 1_000)).toEqual(
    { allowed: false, remainingMs: 750 },
  );

  now += 750;
  expect(tracker.tryAcquire('sticker', '628123@s.whatsapp.net', 1_000)).toEqual(
    { allowed: true },
  );
});

test('keeps cooldowns separate for commands and senders', () => {
  const tracker = new CommandCooldownTracker(() => 0);

  expect(tracker.tryAcquire('sticker', 'first@s.whatsapp.net', 1_000)).toEqual({
    allowed: true,
  });
  expect(tracker.tryAcquire('ping', 'first@s.whatsapp.net', 1_000)).toEqual({
    allowed: true,
  });
  expect(tracker.tryAcquire('sticker', 'second@s.whatsapp.net', 1_000)).toEqual(
    { allowed: true },
  );
});

test('registers a positive cooldown in milliseconds', () => {
  @Cooldown(5_000)
  class RateLimitedCommand implements BotCommand {
    async execute(_context: CommandContext): Promise<void> {}
  }

  expect(commandCooldown(RateLimitedCommand)).toBe(5_000);
  expect(() => Cooldown(0)).toThrow(
    'Command cooldown must be a positive number of milliseconds.',
  );
});
