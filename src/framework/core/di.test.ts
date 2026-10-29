import { expect, test } from 'bun:test';
import { Container, createToken, Injectable } from './di.ts';

test('disposes lifecycle services in reverse creation order exactly once', async () => {
  const events: string[] = [];

  @Injectable()
  class FirstService implements Disposable {
    [Symbol.dispose](): void {
      events.push('first');
    }
  }

  @Injectable([FirstService])
  class SecondService implements AsyncDisposable {
    async [Symbol.asyncDispose](): Promise<void> {
      events.push('second');
    }
  }

  const container = new Container();
  container.resolve(SecondService);

  await Promise.all([container.dispose(), container.dispose()]);

  expect(events).toEqual(['second', 'first']);
  expect(() => container.resolve(FirstService)).toThrow(
    'Cannot resolve services after container disposal.',
  );
});

test('prefers asynchronous disposal when a service supports both protocols', async () => {
  const events: string[] = [];

  @Injectable()
  class DualDisposable implements Disposable, AsyncDisposable {
    [Symbol.dispose](): void {
      events.push('sync');
    }

    async [Symbol.asyncDispose](): Promise<void> {
      events.push('async');
    }
  }

  const container = new Container();
  container.resolve(DualDisposable);

  await container.dispose();
  expect(events).toEqual(['async']);
});

test('resolves typed tokens and factory dependencies as singletons', () => {
  interface Clock {
    now(): number;
  }

  const CLOCK = createToken<Clock>('Clock');
  const START_TIME = createToken<number>('StartTime');

  // @ts-expect-error A typed token rejects a value of the wrong type.
  new Container().registerValue(CLOCK, 42);

  @Injectable()
  class FixedClock implements Clock {
    now(): number {
      return 42;
    }
  }

  const container = new Container()
    .registerSingleton(CLOCK, FixedClock)
    .registerFactory(START_TIME, (resolver) => resolver.resolve(CLOCK).now());

  expect(container.resolve(CLOCK)).toBeInstanceOf(FixedClock);
  expect(container.resolve(START_TIME)).toBe(42);
  expect(container.resolve(START_TIME)).toBe(container.resolve(START_TIME));
});

test('honors transient and scoped lifetimes and disposes scoped services', async () => {
  const events: string[] = [];

  @Injectable({ lifetime: 'transient' })
  class TransientService {}

  @Injectable({ lifetime: 'scoped' })
  class ScopedService implements Disposable {
    [Symbol.dispose](): void {
      events.push('scoped');
    }
  }

  const container = new Container();
  expect(container.resolve(TransientService)).not.toBe(
    container.resolve(TransientService),
  );

  const firstScope = container.createScope();
  const secondScope = container.createScope();
  expect(firstScope.resolve(ScopedService)).toBe(
    firstScope.resolve(ScopedService),
  );
  expect(firstScope.resolve(ScopedService)).not.toBe(
    secondScope.resolve(ScopedService),
  );

  await firstScope.dispose();
  expect(events).toEqual(['scoped']);
  expect(() => firstScope.resolve(ScopedService)).toThrow(
    'Cannot resolve services after scope disposal.',
  );

  await container.dispose();
  expect(events).toEqual(['scoped', 'scoped']);
});

test('allows explicitly registered implementations and rejects invalid lifetimes', () => {
  interface MessageWriter {
    write(): string;
  }

  const WRITER = createToken<MessageWriter>('MessageWriter');
  const REQUEST_ID = createToken<string>('RequestId');
  const APPLICATION = createToken<object>('Application');

  @Injectable()
  class ConsoleWriter implements MessageWriter {
    write(): string {
      return 'hello';
    }
  }

  const container = new Container()
    .registerSingleton(WRITER, ConsoleWriter)
    .registerFactory(REQUEST_ID, () => 'request', 'scoped')
    .registerFactory(APPLICATION, (resolver) => ({
      requestId: resolver.resolve(REQUEST_ID),
    }));

  expect(container.resolve(WRITER).write()).toBe('hello');
  expect(() => container.resolve(APPLICATION)).toThrow(
    'Singleton service cannot depend on scoped service RequestId.',
  );
});

test('rejects scoped dependencies reached through a singleton transient chain', () => {
  @Injectable({ lifetime: 'scoped' })
  class RequestState {}

  @Injectable({
    dependencies: [RequestState],
    lifetime: 'transient',
  })
  class RequestFormatter {
    constructor(readonly state: RequestState) {}
  }

  @Injectable([RequestFormatter])
  class Application {
    constructor(readonly formatter: RequestFormatter) {}
  }

  const scope = new Container().createScope();
  expect(() => scope.resolve(Application)).toThrow(
    'Singleton service cannot depend on scoped service RequestState.',
  );
});

test('keeps factory aliases with their original disposal owner', async () => {
  const events: string[] = [];
  const RESOURCE = createToken<Disposable>('Resource');
  const ALIAS = createToken<Disposable>('Alias');
  const resource = {
    [Symbol.dispose](): void {
      events.push('resource');
    },
  };

  const container = new Container()
    .registerFactory(RESOURCE, () => resource)
    .registerFactory(ALIAS, (resolver) => resolver.resolve(RESOURCE), 'scoped');
  const scope = container.createScope();

  expect(scope.resolve(ALIAS)).toBe(resource);
  await scope.dispose();
  expect(events).toEqual([]);

  await container.dispose();
  expect(events).toEqual(['resource']);
});

test('preserves undefined values and reports the full circular dependency path', () => {
  const OPTIONAL = createToken<string | undefined>('Optional');
  const FIRST = createToken<object>('First');
  const SECOND = createToken<object>('Second');
  const container = new Container()
    .registerValue(OPTIONAL, undefined)
    .registerFactory(FIRST, (resolver) => resolver.resolve(SECOND))
    .registerFactory(SECOND, (resolver) => resolver.resolve(FIRST));

  expect(container.resolve(OPTIONAL)).toBeUndefined();
  expect(() => container.resolve(FIRST)).toThrow(
    'Circular dependency detected: First -> Second -> First.',
  );
});
