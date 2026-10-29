# Rin

Rin is a WhatsApp command service built with [Zapo](https://zapo.to/) and
TypeScript. It provides decorator-based command registration, dependency
injection, and persistent SQLite session storage.

## Prerequisites

- Bun 1.4 or later
- A WhatsApp account that can be linked as a companion device
- Linux x64 or ARM64 to use `!sticker`; its native conversion worker is
  distributed for those platforms.

## Installation

```bash
bun install
cp .env.example .env
```

Configure the following values in `.env` as needed:

| Variable                 | Default                   | Description                                                  |
| ------------------------ | ------------------------- | ------------------------------------------------------------ |
| `BOT_PREFIX`             | `!`                       | Prefix required for command messages.                        |
| `BOT_LOG_LEVEL`          | `info`                    | Minimum severity for application logs.                       |
| `BOT_SESSION_ID`         | `rin`                     | Identifier for the Zapo session.                             |
| `BOT_AUTH_PATH`          | `.auth/state.sqlite`      | SQLite file for credentials and Signal state.                |
| `BOT_PAIRING_PHONE`      | _unset_                   | Optional international phone number for code-based pairing.  |
| `BOT_SUPERUSER_ID`       | _unset_                   | Owner phone number only; no `@s.whatsapp.net` or `@lid`.     |
| `BOT_ROLE_DB_PATH`       | `.auth/roles.sqlite`      | SQLite database for superuser-managed moderators.            |
| `BOT_MODERATION_DB_PATH` | `.auth/moderation.sqlite` | SQLite database for per-group moderation settings.           |
| `TYPESAFE_API_KEY`       | _unset_                   | Authorizes Jev requests; groups enable filtering separately. |
| `TYPESAFE_MODEL`         | `jev-1.14.0`              | Jev model used for moderation.                               |
| `BOT_BADWORD_THRESHOLD`  | `0.9`                     | Probability threshold used to flag a rule violation (0–1).   |

## Running the service

```bash
bun run dev
```

On an unpaired session, one of the following methods is used:

-   **QR pairing (default):** In WhatsApp, open **Settings → Linked devices →
    Link a device**, then scan the QR code shown in the terminal.
-   **Phone-number pairing:** Set `BOT_PAIRING_PHONE` to a digits-only
    international phone number, for example `628123456789`. The terminal
    displays an eight-character code. In WhatsApp, select **Linked devices →
    Link with phone number instead** and enter the code.

Session credentials are stored at the configured `BOT_AUTH_PATH`. Keep this file
private; it is excluded from version control.

## Commands

| Command           | Description                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------ |
| `!help`           | Lists registered commands.                                                                 |
| `!ping`           | Verifies that the service is responding.                                                   |
| `!sticker` (`!s`) | Converts a supported image or video attached to, or quoted by, the command (up to 16 MiB). |
| `!group` (`!gc`)  | Lets group admins manage the current group.                                                |

`!group` is available to group admins (and the configured superuser) in the
current group. It supports adding, removing, promoting, and demoting members;
changing the subject or description; controlling announcement-only and
restricted-info modes; viewing or rotating the invite link; and viewing basic
group details. Supply a phone number or WhatsApp JID to add a member; use a
WhatsApp mention for other member actions. Run `!group` without an action to
see its usage.

`!group link-sharing off` restricts forwarding or sharing the group invite link
to admins.

### Group moderation

To use Jev moderation, configure `TYPESAFE_API_KEY`, then have a group admin
run `!group filter on` in each group. The API key only authorizes requests; it
does not activate filtering globally. Built-in moderation flags messages that
contain a profane, obscene, or hateful slur. Group admins can add additional
policy with `!group filter requirement add <rule>`, list rules with `...
requirement list`, remove one with `... requirement remove <id>`, or remove all
custom rules with `... requirement clear`.

TypeSafe receives message text or captions, the text of each configured custom
rule, and eligible image bytes for classification. Eligible images are
non-view-once JPEG or PNG attachments no larger than 8 MiB. Image moderation
uses an experimental capability; tune `BOT_BADWORD_THRESHOLD` on representative
messages before relying on it for high-stakes moderation.

The threshold determines whether Jev flags a violation. Deleting a flagged
message also requires the bot to be a group admin and a successful WhatsApp
revoke operation. If a TypeSafe request fails or times out, the message is
allowed (fail open); do not use this filter as the sole safety control.

For each flagged message, the bot attempts a warning reply. Use `!group filter
warnings <count>` to enable automatic member-removal attempts after that many
warnings; for example, `!group filter warnings 3` attempts removal on a
member's third warning. Automatic removal is disabled by default and can be
turned off with `!group filter warnings off`. Reset a member's warning count
with `!group filter warnings reset <@mention>`. Member removal also requires
bot admin privileges and a successful WhatsApp operation. The bot keeps group
metadata cached, refreshes it after group changes it makes, and refreshes it
when WhatsApp reports a group lifecycle event.

## Development

```bash
bun run format        # Format project files
bun run format:check  # Validate formatting
bun run lint          # Run static analysis
bun run typecheck     # Type-check without emitting files
bun run verify        # Run type-checking and all Biome checks
```

Biome enforces two-space indentation and the recommended TypeScript lint rules.
The GitHub Actions workflow runs `bun run verify` for every push and pull
request.

### Import aliases

Use `@/` for imports from `src/`; for example,
`@/framework/core/di.ts` resolves to `src/framework/core/di.ts`. Keep relative
imports for modules in the same directory.

## Project layout

`src/framework/` contains the reusable bot runtime: the command router,
decorators and contracts, DI container, WhatsApp integration, configuration,
and shared services. `src/app/` is application-owned code: commands, feature
services, and the composition bootstrap.

Commands are autoloaded from `src/app/commands/**/*.command.ts` at startup.
The filename convention deliberately excludes `*.test.ts`, so a new command
only needs its own decorated module—there is no central imports file to edit.

## Extending commands

Create a decorated command class under `src/app/commands`, for example
`src/app/commands/echo.command.ts`:

```ts
import { Command } from '@/framework/commands/command.decorator.ts';
import { Injectable } from '@/framework/core/di.ts';
import type {
  BotCommand,
  CommandContext,
} from '@/framework/commands/contracts.ts';

@Command({
  name: 'echo',
  description: 'Return the supplied text.',
})
@Injectable()
export class EchoCommand implements BotCommand {
  async execute({ args, reply }: CommandContext): Promise<void> {
    await reply(args.join(' ') || 'No text was supplied.');
  }
}
```

The module is registered automatically at startup. Use
`@Injectable([Dependency])` to declare dependencies resolved by the application
container.

### Dependency-injection lifetimes

`@Injectable()` services are singletons by default. The container also supports
typed symbol tokens, factories, transient services, and request/job scopes:

```ts
import { Container, createToken, Injectable } from '@/framework/core/di.ts';

const container = new Container();

interface Clock {
  now(): number;
}

const CLOCK = createToken<Clock>('Clock');
const REQUEST_ID = createToken<string>('RequestId');

@Injectable()
class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
}

@Injectable({
  dependencies: [CLOCK, REQUEST_ID],
  lifetime: 'scoped',
})
class RequestState {
  constructor(
    readonly clock: Clock,
    readonly requestId: string,
  ) {}
}

container
  .registerSingleton(CLOCK, SystemClock)
  .registerFactory(REQUEST_ID, () => crypto.randomUUID(), 'scoped');

const scope = container.createScope();
try {
  const state = scope.resolve(RequestState);
  console.log(state.clock.now(), state.requestId);
} finally {
  await scope.dispose();
}
```

`registerTransient` creates an instance for every resolution; `registerScoped`
shares an instance within a scope. A singleton cannot consume a scoped service,
including through transient services, which prevents leaking request state. All
container-managed lifecycle services are disposed when their owning scope or the
root container is disposed. Values passed to `registerValue` remain
caller-owned.

### Service disposal

Container-managed services can implement standard `AsyncDisposable` to release
resources:

```ts
@Injectable()
export class CacheClient implements AsyncDisposable {
  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }
}
```

The container invokes `[Symbol.asyncDispose]()` (or synchronous
`[Symbol.dispose]()`), once in reverse creation order when an owner is
disposed. `bootstrap()` disposes the container if initialization fails and
handles `SIGINT`, `SIGTERM`, and normal event-loop shutdown through
`beforeExit`. It continues disposing remaining services if an earlier callback
fails.

### Command permissions and custom checks

Permissions are decorators, separate from command registration:
`@GroupAdmin()`, `@Moderator()`, and `@Superuser()`. Apply them to command
classes or command-group subcommand methods. Commands without a permission
decorator are public. `@Superuser()` requires the single numeric
`BOT_SUPERUSER_ID`; `@Moderator()` requires an entry in the moderator database
(or the superuser); and `@GroupAdmin()` is available to WhatsApp group admins
only (or the superuser). Group-admin checks fetch current group metadata, and
therefore are denied if WhatsApp cannot be reached to verify the role.

The superuser maintains moderator assignments with `!cardinal addmod`,
`!cardinal delmod`, and `!cardinal mods`. Add and remove commands accept a phone
number, a WhatsApp user JID, or a WhatsApp @mention.

The superuser can also run administrative terminal and debugging commands:

```text
!cardinal console <shell command>
!cardinal debug <JavaScript expression or statements>
```

```ts
@Command({ name: 'purge', description: 'Remove recent messages.' })
@GroupAdmin()
```

For policies beyond those built-in roles, add `@Require(...)` (or its
`@Check(...)` alias). A check receives the sender, parsed message, arguments,
and lazy role resolvers. It can be synchronous or asynchronous, and can be
packaged into a reusable decorator in the same style as discord.py checks:

```ts
import { Command, Require } from '@/framework/commands/command.decorator.ts';

const InAllowedGroup = (groupJid: string) =>
  Require((authorization) => {
    if (authorization.event.key.remoteJid === groupJid) return true;
    return { allowed: false, reason: 'allowed_group_required' };
  });

@Command({ name: 'announce', description: 'Send an announcement.' })
@Moderator()
@InAllowedGroup('123456789@g.us')
@Injectable()
export class AnnounceCommand implements BotCommand {
  async execute(context: CommandContext): Promise<void> {
    // ...
  }
}
```

Multiple checks are combined with AND semantics and run after the built-in
permission decorator. Checks may call `authorization.isBotModerator()` or
`authorization.isGroupAdmin()` when needed. Returning `false`, returning
`{ allowed: false, reason }`, or throwing denies execution; a thrown error
fails closed and is logged. The configured superuser remains able to run every
command, including commands with custom checks.

### Command groups and subcommands

Use `@Group(...)` on a DI-managed command class, then put `@Command(...)` on
its methods. This follows Discord.Net’s group/module style while keeping the
current TypeScript decorator and OOP model:

```ts
import { Injectable } from '@/framework/core/di.ts';
import {
  Command,
  Group,
  GroupAdmin,
} from '@/framework/commands/command.decorator.ts';
import type {
  BotCommand,
  CommandContext,
} from '@/framework/commands/contracts.ts';

@Group({
  name: 'poll',
  aliases: ['vote'],
  description: 'Manage polls in this group.',
})
@GroupAdmin()
@Injectable()
export class PollCommand implements BotCommand {
  // Called for `!poll` or an unknown subcommand.
  async execute(context: CommandContext): Promise<void> {
    await context.reply(`Usage: ${context.prefix}poll create|close`);
  }

  @Command({
    name: 'create',
    aliases: ['new'],
    description: 'Create a poll.',
  })
  async create(context: CommandContext): Promise<void> {
    // For `!poll create Best snack?`, this is ["Best", "snack?"].
    await context.reply(`Creating a poll: ${context.args.join(' ')}`);
  }

  @Command({
    name: 'close',
    description: 'Close the active poll.',
  })
  async close(context: CommandContext): Promise<void> {
    // ...
  }
}
```

Group permissions and custom checks apply to every subcommand. A permission,
check, or cooldown placed on a subcommand method applies in addition to the
group’s authorization; a subcommand cooldown overrides a group cooldown.
`!help` lists top-level commands and groups without exposing their subcommands.

### Command cooldowns

Use `@Cooldown(milliseconds)` to limit each sender's executions of a command.
Cooldowns are in-memory, begin after authorization succeeds but before the
command runs, and reset if the bot restarts:

```ts
import { Command, Cooldown } from '@/framework/commands/command.decorator.ts';

@Command({ name: 'render', description: 'Render an image.' })
@Cooldown(30_000)
@Injectable()
export class RenderCommand implements BotCommand {
  async execute(context: CommandContext): Promise<void> {
    // ...
  }
}
```

The same sender may still run different commands; a command on cooldown replies
with the remaining wait time.

## License

Rin is licensed under the GNU General Public License v3.0 only. See
[LICENSE](LICENSE).
