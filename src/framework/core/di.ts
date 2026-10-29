/**
 * A class that can be constructed by the container.
 *
 * `never[]` intentionally accepts constructors with any parameter list. The
 * parameters are supplied from the explicit `@Injectable` dependency list.
 */
export type Constructable<T> = new (...arguments_: never[]) => T;

declare const tokenType: unique symbol;

/**
 * A typed symbol used to inject values that do not have a runtime class.
 *
 * The type parameter exists only at compile time. Tokens with the same label
 * are still distinct, just like ordinary symbols.
 */
export type SymbolToken<T> = symbol & {
  readonly [tokenType]?: T;
};

/** A class or typed symbol that identifies a dependency. */
export type InjectionToken<T> = Constructable<T> | SymbolToken<T>;

/** Alias for APIs that prefer the shorter DI terminology. */
export type Token<T> = InjectionToken<T>;

type DependencyList = readonly InjectionToken<unknown>[];
type AnyToken = InjectionToken<unknown>;

const dependenciesByType = new WeakMap<
  Constructable<unknown>,
  DependencyList
>();
const lifetimeByType = new WeakMap<Constructable<unknown>, ServiceLifetime>();

/**
 * Creates a symbol token whose generic parameter is checked when registering
 * and resolving a dependency.
 */
export function createToken<T>(description: string): SymbolToken<T> {
  // Symbols cannot retain TypeScript's compile-time generic metadata.
  // biome-ignore lint/nursery/noUnsafeTypeAssertion: The unique-symbol brand is compile-time only.
  return Symbol(description) as SymbolToken<T>;
}

export type ServiceLifetime = 'singleton' | 'scoped' | 'transient';

export interface InjectableOptions {
  /** Constructor dependencies, in parameter order. */
  readonly dependencies?: DependencyList;
  /** Defaults to `singleton`, preserving the original container behavior. */
  readonly lifetime?: ServiceLifetime;
}

type ManagedDisposable = Disposable | AsyncDisposable;

/**
 * The capabilities provided to a factory. Factories receive a resolver rather
 * than the concrete container so they also work correctly inside a scope.
 */
export interface Resolver {
  resolve<T>(token: InjectionToken<T>): T;
}

export type Factory<T> = (resolver: Resolver) => T;

function asAnyToken<T>(token: InjectionToken<T>): AnyToken {
  return token;
}

function asTokenValue<T>(value: unknown): T {
  // The container stores each value under the same generic token used to read it.
  // biome-ignore lint/nursery/noUnsafeTypeAssertion: The token-value relationship is enforced by public APIs.
  return value as T;
}

interface Registration {
  readonly lifetime: ServiceLifetime;
  readonly factory: Factory<unknown>;
}

interface LifetimeOwner {
  track(instance: unknown): void;
}

/** Ensures a disposable instance belongs to exactly one lifecycle owner. */
class DisposalRegistry {
  private readonly services = new WeakSet<ManagedDisposable>();

  claim(service: ManagedDisposable): boolean {
    if (this.services.has(service)) return false;
    this.services.add(service);
    return true;
  }
}

/**
 * Marks a class as container-managed and declares its constructor dependencies.
 *
 * TypeScript does not expose reliable runtime parameter types, so dependencies
 * remain explicit and safe across minification.
 */
export function Injectable(
  dependencies?: DependencyList,
): (target: Constructable<unknown>, context: ClassDecoratorContext) => void;
export function Injectable(
  options?: InjectableOptions,
): (target: Constructable<unknown>, context: ClassDecoratorContext) => void;
export function Injectable(
  dependenciesOrOptions: DependencyList | InjectableOptions = [],
): (target: Constructable<unknown>, context: ClassDecoratorContext) => void {
  const options: InjectableOptions = isDependencyList(dependenciesOrOptions)
    ? { dependencies: dependenciesOrOptions }
    : dependenciesOrOptions;
  const dependencies = options.dependencies ?? [];
  const lifetime = options.lifetime ?? 'singleton';

  return (
    target: Constructable<unknown>,
    _context: ClassDecoratorContext,
  ): void => {
    dependenciesByType.set(target, dependencies);
    lifetimeByType.set(target, lifetime);
  };
}

/**
 * A child lifetime boundary created by `Container.createScope()`.
 *
 * Scoped services are shared within this scope and disposed with it.
 * Singleton services remain owned by the root container.
 */
export class Scope implements Resolver, LifetimeOwner {
  private readonly instances = new Map<AnyToken, unknown>();
  private readonly disposableServices: ManagedDisposable[] = [];
  private disposing = false;
  private disposePromise: Promise<void> | undefined;

  /** @internal Scopes are created only by Container. */
  constructor(
    private readonly container: Container,
    private readonly disposalRegistry: DisposalRegistry,
  ) {}

  resolve<T>(token: InjectionToken<T>): T {
    this.assertActive();
    return this.container.resolveFromScope(token, this, this);
  }

  /**
   * Disposes scoped and transient services created in this scope exactly once.
   * It is safe to call concurrently or repeatedly.
   */
  dispose(): Promise<void> {
    if (this.disposePromise !== undefined) return this.disposePromise;

    this.disposing = true;
    this.disposePromise = this.disposeServices().finally(() => {
      this.container.releaseScope(this);
    });
    return this.disposePromise;
  }

  /** @deprecated Use dispose() or `await using` instead. */
  stop(): Promise<void> {
    return this.dispose();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.dispose();
  }

  /** @internal */
  get<T>(token: InjectionToken<T>): T | undefined {
    const value = this.instances.get(asAnyToken(token));
    return value === undefined ? undefined : asTokenValue<T>(value);
  }

  /** @internal */
  getRequired<T>(token: InjectionToken<T>): T {
    const key = asAnyToken(token);
    if (!this.instances.has(key)) {
      throw new Error(`No scoped instance exists for ${tokenName(key)}.`);
    }
    return asTokenValue<T>(this.instances.get(key));
  }

  /** @internal */
  has(token: InjectionToken<unknown>): boolean {
    return this.instances.has(asAnyToken(token));
  }

  /** @internal */
  set<T>(token: InjectionToken<T>, instance: T): void {
    this.instances.set(asAnyToken(token), instance);
  }

  /** @internal */
  track(instance: unknown): void {
    if (
      isManagedDisposable(instance) &&
      this.disposalRegistry.claim(instance)
    ) {
      this.disposableServices.push(instance);
    }
  }

  /** @internal */
  async disposeServices(): Promise<void> {
    const errors: unknown[] = [];
    for (const service of this.disposableServices.toReversed()) {
      try {
        await disposeService(service);
      } catch (error) {
        errors.push(error);
      }
    }
    throwCollectedErrors(
      errors,
      'Multiple services failed during scope disposal.',
    );
  }

  private assertActive(): void {
    if (this.disposing) {
      throw new Error('Cannot resolve services after scope disposal.');
    }
  }
}

/**
 * A small, synchronous DI container with singleton, scoped, and transient
 * lifetimes. Values and factory results are resolved synchronously; initialize
 * asynchronous resources in an explicit `start` method.
 */
export class Container implements Resolver, LifetimeOwner {
  private readonly values = new Map<AnyToken, unknown>();
  private readonly registrations = new Map<AnyToken, Registration>();
  private readonly singletonInstances = new Map<AnyToken, unknown>();
  private readonly scopedInstances = new Map<AnyToken, unknown>();
  private readonly scopes = new Set<Scope>();
  private readonly disposableServices: ManagedDisposable[] = [];
  private readonly disposalRegistry = new DisposalRegistry();
  private disposing = false;
  private disposePromise: Promise<void> | undefined;

  /**
   * Registers a non-container-owned value. It is never automatically disposed;
   * retain responsibility for values created outside the container.
   */
  registerValue<T>(token: InjectionToken<T>, value: NoInfer<T>): this {
    this.assertActive();
    this.assertTokenIsAvailable(token);
    this.values.set(asAnyToken(token), value);
    return this;
  }

  /**
   * Maps a token to a singleton implementation. Omitting `implementation`
   * registers the class token itself.
   */
  registerSingleton<T>(
    token: Constructable<T>,
    implementation?: Constructable<NoInfer<T>>,
  ): this;
  registerSingleton<T>(
    token: InjectionToken<T>,
    implementation: Constructable<NoInfer<T>>,
  ): this;
  registerSingleton<T>(
    token: InjectionToken<T>,
    implementation?: Constructable<T>,
  ): this {
    return this.registerType(
      token,
      implementation ?? asConstructable(token),
      'singleton',
    );
  }

  /** Maps a token to an implementation created on every resolution. */
  registerTransient<T>(
    token: Constructable<T>,
    implementation?: Constructable<NoInfer<T>>,
  ): this;
  registerTransient<T>(
    token: InjectionToken<T>,
    implementation: Constructable<NoInfer<T>>,
  ): this;
  registerTransient<T>(
    token: InjectionToken<T>,
    implementation?: Constructable<T>,
  ): this {
    return this.registerType(
      token,
      implementation ?? asConstructable(token),
      'transient',
    );
  }

  /** Maps a token to one implementation instance per scope. */
  registerScoped<T>(
    token: Constructable<T>,
    implementation?: Constructable<NoInfer<T>>,
  ): this;
  registerScoped<T>(
    token: InjectionToken<T>,
    implementation: Constructable<NoInfer<T>>,
  ): this;
  registerScoped<T>(
    token: InjectionToken<T>,
    implementation?: Constructable<T>,
  ): this {
    return this.registerType(
      token,
      implementation ?? asConstructable(token),
      'scoped',
    );
  }

  /**
   * Registers a factory with an explicit lifetime. The resolver passed to the
   * factory preserves the current scope and lifecycle ownership.
   */
  registerFactory<T>(
    token: InjectionToken<T>,
    factory: Factory<NoInfer<T>>,
    lifetime: ServiceLifetime = 'singleton',
  ): this {
    this.assertActive();
    this.assertTokenIsAvailable(token);
    this.registrations.set(asAnyToken(token), {
      lifetime,
      factory,
    });
    return this;
  }

  /** Returns whether a token can currently be resolved. */
  isRegistered(token: InjectionToken<unknown>): boolean {
    return (
      this.values.has(token) ||
      this.registrations.has(token) ||
      (typeof token !== 'symbol' && dependenciesByType.has(token))
    );
  }

  /**
   * Creates an independent scoped lifetime boundary.
   *
   * Call `await scope.dispose()` when the request, job, or unit of work ends.
   */
  createScope(): Scope {
    this.assertActive();
    const scope = new Scope(this, this.disposalRegistry);
    this.scopes.add(scope);
    return scope;
  }

  resolve<T>(token: InjectionToken<T>): T {
    this.assertCanResolve();
    return this.resolveFromScope(token, this, this);
  }

  /**
   * Disposes all active scopes, then container-owned singleton/root services.
   * Every service is attempted even when another disposal callback fails.
   */
  dispose(): Promise<void> {
    if (this.disposePromise !== undefined) return this.disposePromise;

    this.disposing = true;
    this.disposePromise = this.disposeServices();
    return this.disposePromise;
  }

  /** @deprecated Use dispose() or `await using` instead. */
  stop(): Promise<void> {
    return this.dispose();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.dispose();
  }

  /** @internal */
  resolveFromScope<T>(
    token: InjectionToken<T>,
    scope: Scope | Container,
    owner: LifetimeOwner,
    path: readonly AnyToken[] = [],
    parentLifetime?: ServiceLifetime,
  ): T {
    this.assertCanResolve();
    const key = asAnyToken(token);

    if (path.includes(key)) {
      const chain = [...path, key].map((item) => tokenName(item)).join(' -> ');
      throw new Error(`Circular dependency detected: ${chain}.`);
    }

    if (this.values.has(key)) {
      return asTokenValue<T>(this.values.get(key));
    }

    const registration = this.getRegistration(token);
    if (parentLifetime === 'singleton' && registration.lifetime === 'scoped') {
      throw new Error(
        `Singleton service cannot depend on scoped service ${tokenName(token)}.`,
      );
    }

    if (registration.lifetime === 'singleton') {
      if (this.singletonInstances.has(key)) {
        return asTokenValue<T>(this.singletonInstances.get(key));
      }

      const instance = asTokenValue<T>(
        registration.factory(
          this.createResolver(this, this, [...path, key], 'singleton'),
        ),
      );
      this.singletonInstances.set(key, instance);
      this.track(instance);
      return instance;
    }

    if (registration.lifetime === 'scoped') {
      if (scope.has(token)) return scope.getRequired(token);

      const instance = asTokenValue<T>(
        registration.factory(
          this.createResolver(scope, scope, [...path, key], 'scoped'),
        ),
      );
      scope.set(token, instance);
      scope.track(instance);
      return instance;
    }

    const instance = asTokenValue<T>(
      registration.factory(
        this.createResolver(
          scope,
          owner,
          [...path, key],
          // A transient constructed for a singleton remains captive to it.
          parentLifetime ?? 'transient',
        ),
      ),
    );
    owner.track(instance);
    return instance;
  }

  /** @internal */
  releaseScope(scope: Scope): void {
    this.scopes.delete(scope);
  }

  /** @internal Root-container scoped-instance cache. */
  get<T>(token: InjectionToken<T>): T | undefined {
    const value = this.scopedInstances.get(asAnyToken(token));
    return value === undefined ? undefined : asTokenValue<T>(value);
  }

  /** @internal Root-container scoped-instance cache. */
  getRequired<T>(token: InjectionToken<T>): T {
    const key = asAnyToken(token);
    if (!this.scopedInstances.has(key)) {
      throw new Error(`No root-scoped instance exists for ${tokenName(key)}.`);
    }
    return asTokenValue<T>(this.scopedInstances.get(key));
  }

  /** @internal Root-container scoped-instance cache. */
  has(token: InjectionToken<unknown>): boolean {
    return this.scopedInstances.has(asAnyToken(token));
  }

  /** @internal Root-container scoped-instance cache. */
  set<T>(token: InjectionToken<T>, instance: T): void {
    this.scopedInstances.set(asAnyToken(token), instance);
  }

  /** @internal */
  track(instance: unknown): void {
    if (
      isManagedDisposable(instance) &&
      this.disposalRegistry.claim(instance)
    ) {
      this.disposableServices.push(instance);
    }
  }

  private registerType<T>(
    token: InjectionToken<T>,
    implementation: Constructable<T>,
    lifetime: ServiceLifetime,
  ): this {
    return this.registerFactory(
      token,
      (resolver) => this.instantiate(implementation, resolver),
      lifetime,
    );
  }

  private instantiate<T>(type: Constructable<T>, resolver: Resolver): T {
    const dependencies = dependenciesByType.get(type);
    if (dependencies === undefined) {
      throw new Error(
        `${type.name} is not injectable. Add @Injectable(...) before registering or resolving it.`,
      );
    }

    return construct(
      type,
      ...dependencies.map((dependency) => resolver.resolve(dependency)),
    );
  }

  private getRegistration<T>(token: InjectionToken<T>): Registration {
    const registered = this.registrations.get(asAnyToken(token));
    if (registered !== undefined) return registered;

    if (typeof token === 'symbol') {
      throw new Error(`No service registered for ${tokenName(token)}.`);
    }

    const dependencies = dependenciesByType.get(token);
    if (dependencies === undefined) {
      throw new Error(
        `${token.name} is not injectable. Add @Injectable(...) or register a provider.`,
      );
    }

    return {
      lifetime: lifetimeByType.get(token) ?? 'singleton',
      factory: (resolver) => this.instantiate(token, resolver),
    };
  }

  private createResolver(
    scope: Scope | Container,
    owner: LifetimeOwner,
    path: readonly AnyToken[],
    parentLifetime: ServiceLifetime,
  ): Resolver {
    return {
      resolve: <T>(token: InjectionToken<T>): T =>
        this.resolveFromScope(token, scope, owner, path, parentLifetime),
    };
  }

  private assertTokenIsAvailable(token: InjectionToken<unknown>): void {
    if (
      this.values.has(token) ||
      this.registrations.has(token) ||
      this.singletonInstances.has(token)
    ) {
      throw new Error(`${tokenName(token)} is already registered.`);
    }
  }

  private assertActive(): void {
    if (this.disposing) {
      throw new Error(
        'Cannot resolve or register services after container disposal.',
      );
    }
  }

  private assertCanResolve(): void {
    if (this.disposing) {
      throw new Error('Cannot resolve services after container disposal.');
    }
  }

  private async disposeServices(): Promise<void> {
    const errors: unknown[] = [];

    for (const scope of [...this.scopes].toReversed()) {
      try {
        await scope.dispose();
      } catch (error) {
        errors.push(error);
      }
    }

    for (const service of this.disposableServices.toReversed()) {
      try {
        await disposeService(service);
      } catch (error) {
        errors.push(error);
      }
    }

    throwCollectedErrors(
      errors,
      'Multiple services failed during container disposal.',
    );
  }
}

function asConstructable<T>(token: InjectionToken<T>): Constructable<T> {
  if (typeof token === 'symbol') {
    throw new Error(
      `An implementation is required when registering ${tokenName(token)}.`,
    );
  }
  return token;
}

function isDependencyList(
  value: DependencyList | InjectableOptions,
): value is DependencyList {
  return Array.isArray(value);
}

function construct<T>(type: Constructable<T>, ...arguments_: unknown[]): T {
  // Injectable dependencies are declared explicitly and resolved above.
  // biome-ignore lint/nursery/noUnsafeTypeAssertion: Constructable uses never[] to accept constructors with typed parameters.
  const injectableType = type as unknown as new (...values: unknown[]) => T;
  return new injectableType(...arguments_);
}

function tokenName(token: InjectionToken<unknown>): string {
  return typeof token === 'symbol'
    ? (token.description ?? 'anonymous token')
    : token.name || 'anonymous type';
}

function throwCollectedErrors(
  errors: readonly unknown[],
  message: string,
): void {
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, message);
}

function isManagedDisposable(value: unknown): value is ManagedDisposable {
  return (
    typeof value === 'object' &&
    value !== null &&
    (isAsyncDisposable(value) || isDisposable(value))
  );
}

function isAsyncDisposable(value: object): value is AsyncDisposable {
  return (
    Symbol.asyncDispose in value &&
    typeof value[Symbol.asyncDispose] === 'function'
  );
}

function isDisposable(value: object): value is Disposable {
  return Symbol.dispose in value && typeof value[Symbol.dispose] === 'function';
}

async function disposeService(service: ManagedDisposable): Promise<void> {
  if (isAsyncDisposable(service)) {
    await service[Symbol.asyncDispose]();
    return;
  }
  service[Symbol.dispose]();
}
