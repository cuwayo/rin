# Rin

Rin is a WhatsApp command service built with [Zapo](https://zapo.to/) and TypeScript. It provides decorator-based command registration, dependency injection, and persistent SQLite session storage.

## Prerequisites

- Bun 1.4 or later
- A WhatsApp account that can be linked as a companion device

## Installation

```bash
bun install
cp .env.example .env
```

Configure the following values in `.env` as needed:

| Variable            | Default              | Description                                                 |
| ------------------- | -------------------- | ----------------------------------------------------------- |
| `BOT_PREFIX`        | `!`                  | Prefix required for command messages.                       |
| `BOT_LOG_LEVEL`     | `info`               | Minimum severity for application logs.                      |
| `BOT_SESSION_ID`    | `rin`                | Identifier for the Zapo session.                            |
| `BOT_AUTH_PATH`     | `.auth/state.sqlite` | SQLite file for credentials and Signal state.               |
| `BOT_PAIRING_PHONE` | _unset_              | Optional international phone number for code-based pairing. |
| `BOT_SUPERUSER_ID`  | _unset_              | Owner phone number only; no `@s.whatsapp.net` or `@lid`.    |
| `BOT_ROLE_DB_PATH`  | `.auth/roles.sqlite` | SQLite database for superuser-managed moderators.           |

## Running the service

```bash
bun run dev
```

On an unpaired session, one of the following methods is used:

- **QR pairing (default):** In WhatsApp, open **Settings → Linked devices → Link a device**, then scan the QR code shown in the terminal.
- **Phone-number pairing:** Set `BOT_PAIRING_PHONE` to a digits-only international phone number, for example `628123456789`. The terminal displays an eight-character code. In WhatsApp, select **Linked devices → Link with phone number instead** and enter the code.

Session credentials are stored at the configured `BOT_AUTH_PATH`. Keep this file private; it is excluded from version control.

## Commands

| Command | Description                              |
| ------- | ---------------------------------------- |
| `!help` | Lists registered commands.               |
| `!ping` | Verifies that the service is responding. |

## Development

```bash
bun run format        # Format project files
bun run format:check  # Validate formatting
bun run lint          # Run static analysis
bun run typecheck     # Type-check without emitting files
bun run verify        # Run type-checking and all Biome checks
```

Biome enforces four-space indentation and the recommended TypeScript lint rules. The GitHub Actions workflow runs `bun run verify` for every push and pull request.

## Extending commands

Create a decorated command class under `src/commands`:

```ts
@Command({ name: 'echo', description: 'Return the supplied text.' })
@Injectable()
export class EchoCommand implements BotCommand {
    async execute({ args, reply }: CommandContext): Promise<void> {
        await reply(args.join(' ') || 'No text was supplied.')
    }
}
```

Import the module in `src/commands/index.ts` so its decorator registers the command. Use `@Injectable([Dependency])` to declare dependencies resolved by the application container.

### Command permissions and custom checks

Permissions are class decorators, separate from command registration:
`@GroupAdmin()`, `@Moderator()`, and `@Superuser()`. Commands without a
permission decorator are public. `@Superuser()` requires the single numeric
`BOT_SUPERUSER_ID`; `@Moderator()` requires an entry in the moderator database
(or the superuser); and `@GroupAdmin()` is available to WhatsApp group admins
only (or the superuser). Group-admin checks fetch current group metadata, and
therefore are denied if WhatsApp cannot be reached to verify the role.

The superuser maintains moderator assignments with `!addmod`, `!delmod`, and
`!mods`. Add and remove commands accept a phone number, a WhatsApp user JID, or
a WhatsApp @mention.

The superuser can also run administrative terminal and debugging commands:

```text
!console <shell command>
!debug <JavaScript expression or statements>
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
import { Command, Require } from './command.decorator.ts'

const InAllowedGroup = (groupJid: string) =>
    Require((authorization) => {
        if (authorization.event.key.remoteJid === groupJid) return true
        return { allowed: false, reason: 'allowed_group_required' }
    })

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

## License

Rin is licensed under the GNU General Public License v3.0 only. See [LICENSE](LICENSE).
