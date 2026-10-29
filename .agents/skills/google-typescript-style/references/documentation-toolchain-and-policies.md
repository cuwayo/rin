# Documentation, Toolchain, and Policies

Source: [Google TS/JS Style Guide: toolchain requirements, comments and documentation, and policies](https://google.github.io/styleguide/tsguide.html#toolchain-requirements).

Read this reference when documenting APIs, configuring or suppressing compiler
checks, reviewing generated code, or deciding whether to reformat existing code.

## Toolchain Requirements

- Keep TypeScript compiler checks enabled and fix type errors at their cause.
- Do not use `@ts-ignore`; use a real type, narrowing, or a narrowly justified
  alternative. Do not use a suppression to turn an unknown runtime fact into a
  type-system fact.
- Follow configured conformance and lint rules. Repository configuration can be
  stricter than this guide.

## Comments and Documentation

- Use JSDoc for API documentation and `//` for implementation comments. Prefer
  `//` to multi-line block comments unless the comment is JSDoc.
- Write JSDoc in its standard multi-line form. Use Markdown in descriptions and
  tags only when it adds useful structure. Wrap prose for readability.
- Document every top-level exported symbol. Document classes, methods,
  functions, and parameter properties when their purpose, constraints, return
  contract, side effects, ownership, or failure behavior is not obvious.
- Do not restate names or types. Explain information the signature cannot:
  intent, invariants, units, valid ranges, lifecycle, effects, and rationale.
- Put JSDoc before decorators. Comments at call sites should explain why that
  call is appropriate, not narrate the call itself.

## Policies

- Favor consistency with local code when several guide-compliant forms are
  reasonable. Avoid opportunistic reformatting or style migrations in a focused
  functional change.
- Mark APIs as deprecated with the appropriate JSDoc and provide a replacement
  or migration path where practical. Do not remove or silently repurpose a
  public API without considering its consumers.
- Generated code is mostly exempt from style rules. Do not manually restyle
  generated output; fix its generator or configuration when generated code
  needs to change.
- Apply the guide to improve readability, consistency, and maintainability.
  Examples illustrate rules but are not themselves exhaustive formatting law.
