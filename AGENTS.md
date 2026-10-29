# Repository Guidelines

## Project Structure & Module Organization

`src/index.ts` starts the service, and `src/app/bootstrap.ts` loads configuration, discovers commands, and wires dependencies. Application-specific commands and workers live under `src/app/`; reusable bot, command, moderation, group, role, and dependency-injection code lives under `src/framework/`. Tests are colocated with their implementation as `*.test.ts`. Add commands under `src/app/commands/`; the loader discovers `*.command.ts` files recursively, so no central registry is needed.

## Build, Test, and Development Commands

Install dependencies with `bun install` and create local configuration with `cp .env.example .env`.

- `bun run dev` starts the bot with file watching and readable logs.
- `bun run start` starts the bot normally.
- `bun test` runs the test suite.
- `bun run typecheck` checks TypeScript without emitting files.
- `bun run check` runs Biome formatting and lint checks.
- `bun run verify` runs typechecking and Biome checks together.

There is no separate build step; Bun executes the TypeScript entry point directly.

## Coding Style & Naming Conventions

Use TypeScript with strict compiler settings. Follow Biome: four spaces, single quotes, and no required semicolons. Use descriptive kebab-case filenames (for example, `command-router.ts` and `command-router.test.ts`); classes use PascalCase and functions/variables use camelCase. Keep tests alongside the code they cover and prefer behavior-focused test names. Run `bun run verify` before submitting changes.

## Testing Guidelines

Tests use Bun's built-in test runner and assertions. Name test files `*.test.ts` and cases for observable behavior or edge cases. Run all tests with `bun test`; during development, pass a test file, such as `bun test src/framework/bot/command-router.test.ts`. No coverage threshold is configured.

## Commit & Pull Request Guidelines

Recent history uses short Conventional Commit subjects, typically `feat: ...` and `fix ...`; use a lowercase type prefix and concise imperative summary (prefer `fix: ...`). Pull requests should explain the behavior change, note relevant configuration or operational impact, link related issues, and report verification performed. Include logs or screenshots only when they clarify a user-visible change.

## Security & Configuration

Keep `.env`, WhatsApp session credentials, and generated SQLite databases private; never commit secrets or live authentication state. Use `.env.example` for documenting configuration keys, with safe placeholders rather than real credentials. Treat moderation API keys and user-provided message content as sensitive.
