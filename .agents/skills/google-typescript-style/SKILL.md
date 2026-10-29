---

name: google-typescript-style
description: Apply the Google TypeScript style guide when creating, editing, or reviewing TypeScript in Rin. Use for semantic code and API decisions beyond Biome formatting and linting.
---

# Google TypeScript Style

Use the upstream [Google TypeScript style guide](https://google.github.io/styleguide/tsguide.html)
as the canonical rulebook. Apply this skill to production and test TypeScript
changes. The guide uses RFC 2119 terms: **must** and **must not** are
requirements; **should**, **prefer**, and **avoid** are strong guidance.

Read the categories that apply to the change before editing or reviewing:

| Change or review area                                                                     | Read                                                                                         |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| File encoding, file order, imports, exports, and modules                                  | [Files and modules](references/files-and-modules.md)                                         |
| Expressions, classes, functions, control flow, errors, decorators, and forbidden features | [Language features](references/language-features.md)                                         |
| Identifiers, inference, nullability, structural types, generics, and unsafe types         | [Naming and type system](references/naming-and-type-system.md)                               |
| JSDoc, compiler suppression, conformance, consistency, deprecation, and generated code    | [Documentation, toolchain, and policies](references/documentation-toolchain-and-policies.md) |

For a broad change or a complete style review, read all four references. They
are category-indexed summaries of every top-level section and subsection in the
upstream guide; use the linked upstream heading when a case needs the guide's
full rationale or examples.

## Work In This Repository

Read the target implementation, colocated tests, `AGENTS.md`, and `biome.json`
before editing. Repository instructions and configured lint rules are more
specific where they differ from the general guide. Preserve established
behavior and public command contracts; do not turn a focused change into an
unrelated style migration.

Biome is authoritative for mechanical rules and must remain enabled. Fix a
diagnostic's cause instead of broadly disabling it. Run `bun run verify` after
TypeScript changes. Run the relevant `bun test` target while developing, and
`bun test` when the change affects behavior beyond one focused test file.

## Repository Exceptions

- This bot's command framework intentionally defines and consumes decorators in
  `src/framework/commands/command.decorator.ts`. Reuse its existing decorators
  when a command needs metadata; do not introduce a new decorator mechanism
  without an explicit architectural need.
- `src/app/utils/cardinal-execution.worker.ts` intentionally evaluates user
  supplied JavaScript inside a Node VM for the `cardinal debug` command. Treat
  this as a tightly scoped behavior requirement, not a general authorization to
  add dynamic evaluation or to treat the VM as a security boundary.
- Tests may use narrowly scoped assertions to construct fixtures because
  Biome's unsafe-assertion rule is disabled only for `src/**/*.test.ts`. Keep
  the fixture honest and do not carry this exception into production code.
