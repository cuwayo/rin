import { expect, test } from 'bun:test';
import { noul, TypeSafeClient } from '@typesafe-ai/sdk';
import { typeSafeResponse } from './typesafe-fetch.ts';

test('allows the TypeSafe SDK to parse a Bun response body', async () => {
  const client = new TypeSafeClient({
    apiKey: 'test-key',
    fetch: async () =>
      typeSafeResponse(
        new Response(
          JSON.stringify({
            model: 'jev-1.14.0',
            answers: { allowed: { type: 'noul', noul: 0.99 } },
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
      ),
  });

  const result = await client.systemOne({
    state: { content: 'test' },
    questions: { allowed: noul('Is this allowed?') },
  });

  expect(result).toMatchObject({
    answers: { allowed: { noul: 0.99 } },
  });
});
