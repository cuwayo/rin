---

name: google-typescript-style
description: Apply the Google TypeScript style guide when creating, editing, or reviewing TypeScript in Rin. Use for semantic code and API decisions beyond Biome formatting and linting.
---

# Google TypeScript Style

Use the upstream [Google TypeScript style guide](https://google.github.io/styleguide/tsguide.html)
as the canonical rulebook. Apply this skill to production and test TypeScript
changes. Follow repository-specific instructions in `AGENTS.md` and `biome.json`
where they are more specific.

## Work In This Repository

Read the target implementation, colocated tests, `AGENTS.md`, and `biome.json`
before editing. Preserve established behavior and public command contracts; do
not turn a focused change into an unrelated style migration.

Biome is authoritative for mechanical rules and must remain enabled. In
particular, it enforces two-space indentation, single quotes, semicolons,
trailing commas, named exports, ESM, `const`/`let`, and many banned constructs.
Fix the cause of a diagnostic instead of broadly disabling a rule.

Run `bun run verify` after TypeScript changes. Run the relevant `bun test`
target while developing, and `bun test` when the change affects behavior beyond
one focused test file.

## Modules And APIs

- Use named exports only. Export the smallest useful API surface and never
  export mutable bindings.
- Use ESM imports and exports, relative imports within this project, and
  `import type` or `export type` when the symbol is type-only.
- Do not add default exports, CommonJS imports, namespaces, or static-only
  container classes.
- Prefer function declarations for named functions. Use an arrow function when
  a callback needs explicit parameter forwarding or lexical `this`.
- Use classes for stateful domain behavior, not as a namespace. Mark class
  fields `readonly` when they are not reassigned after construction.

## Types And Data Boundaries

- Prefer inference for obvious local values. Add annotations at API boundaries,
  for complex expressions, and for structural implementations where an explicit
  contract makes errors appear at the declaration.
- Define object shapes with `interface`; reserve `type` for unions,
  intersections, tuples, and aliases that cannot be interfaces.
- Prefer `unknown` over `any`, then narrow untrusted input with type guards,
  property checks, and validation before using it. Do not bypass a type error
  with `as`, `!`, `@ts-ignore`, or a double assertion.
- A production assertion permitted by a targeted Biome suppression needs a
  local explanation of why runtime narrowing cannot express the invariant.
- Use primitive types (`string`, `number`, `boolean`) rather than wrapper
  objects. Use `T[]` for simple element types and `Array<T>` for complex
  element types.
- Prefer the simplest readable type expression. Avoid mapped or conditional
  types unless their benefit outweighs a direct interface or explicit type.

## Control Flow And Errors

- Declare one local per statement; default to `const`; never use `var`.
- Use braces for non-trivial control-flow bodies. Prefer `for...of` for array
  values and `Object.keys`, `Object.values`, or `Object.entries` over
  `for...in`.
- Use strict equality. Avoid assignment in conditionals unless the extra
  parentheses make the intent unmistakable.
- Throw `Error` instances with `new Error(...)`, keep `try` blocks limited to
  code expected to throw, and handle or rethrow errors with useful context.
- Do not use `eval`, `Function`, prototype mutation, wrapper constructors,
  `const enum`, `debugger`, or automatic-semicolon-insertion-dependent code.

## Names And Documentation

- Use descriptive ASCII identifiers: `UpperCamelCase` for classes, interfaces,
  types, and enums; `lowerCamelCase` for values; `CONSTANT_CASE` only for
  module-level constants intended to remain unchanged.
- Treat abbreviations as words (`loadHttpUrl`, not `loadHTTPURL`). Use
  kebab-case filenames.
- Add JSDoc to new or changed top-level exports and non-obvious members. Explain
  purpose, constraints, and side effects rather than restating names or types.
- Use `//` for implementation comments. Put JSDoc before a decorator.

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
