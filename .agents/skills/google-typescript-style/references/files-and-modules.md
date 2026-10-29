# Files and Modules

Source: [Google TS/JS Style Guide: source file basics and structure](https://google.github.io/styleguide/tsguide.html#source-file-basics).

Read this reference whenever a change creates, splits, moves, imports, or exports
a TypeScript module.

## Source File Basics

- Encode files as UTF-8. Outside line terminators, use ordinary ASCII space for
  whitespace.
- Use a character's standard escape sequence where it has one; never use legacy
  octal escapes.
- Write readable printable Unicode directly. Escape non-printable Unicode and
  explain it when the purpose is not apparent.

## Source File Structure

Keep these present sections in this order, with exactly one blank line between
them: copyright information, file-level JSDoc such as `@fileoverview`, imports,
then implementation.

- Put any required copyright or license text in top-level JSDoc.
- An optional `@fileoverview` may describe the file, its use, or dependencies.

## Imports

- Use TypeScript module paths. Prefer relative paths inside the same logical
  project; avoid excessive parent traversals.
- Choose named imports for frequently used or self-explanatory symbols. Use a
  namespace import for many members of a large API or to clarify common names.
- Alias an import only to resolve a collision, clarify a generated/unclear name,
  or otherwise improve readability.
- Default and side-effect imports are only for external code that requires them.
  This repository's stricter rule is named exports and ESM imports only.

## Exports and Module Boundaries

- Use named exports; never add a default export.
- Export only symbols used outside the module. Keep the public API small.
- Do not export mutable bindings (`export let`). Expose an explicit getter when
  externally observable mutable state is required.
- Do not create static-only container classes for namespacing; use module scope
  and individual exports.
- Use modules, not TypeScript namespaces, triple-slash references, or
  `import x = require(...)`.

## Type-Only Imports and Exports

- Use `import type` or an inline `type` import specifier when a symbol is only
  used as a type; use a normal import for runtime values.
- Re-export type-only symbols with `export type`.
- Do not put dynamic `import()` expressions in type annotations. Import the type
  explicitly instead.
