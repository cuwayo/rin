# Language Features

Source: [Google TS/JS Style Guide: language features](https://google.github.io/styleguide/tsguide.html#language-features).

Read this reference when changing executable TypeScript. It covers every
language-feature category in the guide.

## Declarations, Arrays, and Objects

- Declare one local per statement. Use `const` unless reassignment is necessary;
  use `let` then, never `var`, and never use a variable before declaration.
- Do not use `Array()` or `new Array()`. Use literals or `Array.from`; do not
  attach non-index properties to arrays.
- Array destructuring is allowed. Omit unused elements; optional destructured
  array parameters default to `[]`. Prefer named object values when that better
  communicates a multi-value contract.
- Do not use `Object()` or `new Object()`. Do not use unfiltered `for...in`;
  use `Object.keys`, `Object.values`, `Object.entries`, or an own-property
  filter.
- Object spread is shallow: avoid spreading values with non-`Object` prototypes.
  Computed keys are dict-style keys and must not mix with ordinary keys, except
  symbol keys. Object destructuring is allowed.

## Classes

- Use classes for stateful behavior, not a namespace. Declare classes rather
  than class expressions. Do not add fields used only to relay constructor
  arguments.
- Use method syntax, not function-valued methods. Implement `toString` only
  when it is useful. Static members must not rely on dynamic dispatch or static
  `this`; avoid private static methods when a module function suffices.
- Constructors must not return values or perform overridable work. Mark
  immutable fields `readonly`.
- Do not use `#private` fields. Use TypeScript visibility, parameter
  properties, and field initializers deliberately; document parameter
  properties. Do not expose a property merely to preserve a callback's `this`.
- Prefer direct fields to trivial getters/setters. Keep computed properties
  readable. State visibility explicitly when it improves the public contract.
- Do not manipulate prototypes directly.

## Functions and `this`

- Prefer function declarations for named functions. Do not use function
  expressions; use an arrow for callbacks or lexical `this`.
- Keep nested functions local and readable. Use concise arrow bodies only when
  they remain clear.
- Do not rebind `this` with `bind`, `call`, or `apply` as a workaround. Prefer
  an arrow callback where lexical `this` is needed.
- Use arrows for callbacks, normal methods for prototype behavior, and avoid
  arrow-function properties except when their instance-bound behavior is
  intentional. Event handlers need a deliberate receiver/lifecycle choice.
- Use parameter defaults and rest/spread where they clarify intent. Keep
  function signatures and bodies formatted for readability; split overly long
  functions into cohesive units.

## Literals, Coercion, and Control Flow

- Use `this` only with a clear receiver model. Prefer primitive literals.
- Use single-quoted strings; do not use line continuations. Use template
  literals for interpolation or multiline strings, not as a substitute for
  ordinary quoted strings.
- Write numbers clearly. Convert to numbers explicitly and avoid implicit
  coercion.
- Use braces for control-flow bodies. Parenthesize assignments in conditions
  when they are genuinely intended and clear.
- Iterate containers with the appropriate iteration form, normally `for...of`;
  do not use `for...in` for arrays or unfiltered objects.
- Use grouping parentheses only to clarify precedence. Keep `try` blocks
  narrowly scoped.

## Errors, Equality, Assertions, and Decorators

- Construct errors with `new` and throw only `Error` objects. Catch only when
  recovery, translation, or useful context is possible; do not silently swallow
  errors. An `ErrorOptions.cause` must itself be an `Error`.
- Use `switch` deliberately, including fall-through behavior, and use strict
  equality except for the documented `null`/`undefined` idiom.
- Avoid type and non-null assertions. When unavoidable, use `as` rather than
  angle brackets, never double-assert, and do not use assertions to evade
  object-literal checking. Prefer runtime narrowing.
- Use decorators only where the framework requires them and place documentation
  before the decorator.

## Disallowed Features

Do not use wrapper objects for primitives, rely on automatic semicolon
insertion, use `const enum`, leave `debugger` statements, use `with`, evaluate
dynamic code (`eval` or `Function`), depend on non-standard features, or modify
built-in objects. The repository's documented Cardinal VM exception is narrowly
scoped and is not permission for additional dynamic evaluation.
