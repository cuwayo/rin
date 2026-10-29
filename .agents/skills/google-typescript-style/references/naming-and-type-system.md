# Naming and Type System

Sources: [Google TS/JS Style Guide: naming](https://google.github.io/styleguide/tsguide.html#naming) and [type system](https://google.github.io/styleguide/tsguide.html#type-system).

Read this reference for API design, identifiers, data shapes, inference,
nullability, generics, and untrusted data.

## Naming

- Use descriptive ASCII identifiers. Do not encode types or visibility in names.
- Use `UpperCamelCase` for classes, interfaces, types, enums, and decorators;
  use `lowerCamelCase` for variables, parameters, methods, properties, and
  functions.
- Treat abbreviations as words (`loadHttpUrl`, not `loadHTTPURL`). Do not use
  dollar signs except where a framework convention requires them.
- Type parameters use a single uppercase letter or `UpperCamelCase` name that
  explains their role. Test names describe observable behavior.
- Do not use leading or trailing underscores to signal visibility. Fix import
  name collisions with aliases or namespace imports. Use `CONSTANT_CASE` only
  for immutable module-level constants whose identity is intended to remain
  fixed.
- Keep aliases meaningful; do not shorten names merely to reduce typing.

## Inference and Nullability

- Let TypeScript infer obvious local types. Add annotations at module and API
  boundaries, on complex values, and where an explicit contract improves errors.
  Declare return types when they materially document an exported or complex API.
- Distinguish optional, `undefined`, and `null` deliberately. Do not create
  aliases solely for nullable or undefined forms; write the union where used
  unless a domain concept merits a real alias.

## Structural Types and Collections

- Prefer structural types. Define object shapes with `interface`; reserve
  `type` for unions, intersections, tuples, and aliases an interface cannot
  express.
- Use `T[]` for simple element types and `Array<T>` for complex element types.
- Avoid broad index signatures when a `Map`, `Record`, or explicit object
  contract models the data better.
- Avoid mapped and conditional types unless they provide a clear, substantial
  benefit over an explicit interface or type.
- Use tuples only for small, fixed, meaningfully positional data. Prefer named
  object fields for independently meaningful values.

## Unsafe and Advanced Types

- Never introduce `any` as an easy escape. Specify a narrower type or use
  `unknown` at an untrusted boundary and narrow it before use.
- Do not suppress `any` diagnostics casually. A targeted suppression needs a
  locally documented, unavoidable interoperation reason.
- Do not use `{}` to mean “an arbitrary object”; choose an accurate object,
  `unknown`, or other concrete type.
- Use primitive types (`string`, `number`, `boolean`, `symbol`, `bigint`) rather
  than wrapper types (`String`, `Number`, `Boolean`, `Symbol`, `BigInt`).
- Do not add a generic used only in a return type; make the result type explicit
  or model the relationship with an input type parameter.
