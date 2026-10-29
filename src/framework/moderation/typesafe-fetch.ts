import type { Fetch } from '@typesafe-ai/sdk';

/**
 * Bun marks a Response as consumed when the TypeSafe SDK's response-buffering
 * path obtains a reader for it. Hide that reader from the SDK so it drains its
 * clone and can still parse the original response.
 */
export async function typeSafeFetch(
  input: Parameters<Fetch>[0],
  init?: Parameters<Fetch>[1],
): Promise<Response> {
  return typeSafeResponse(await globalThis.fetch(input, init));
}

export function typeSafeResponse(response: Response): Response {
  return new Proxy<Response>(response, {
    get(target, property) {
      if (property === 'body') return undefined;
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
