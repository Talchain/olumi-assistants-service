import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { sha256, assertExactCaseIds } from './contract.js';
import { readServingObservation } from './live-observation.js';

const names = ['GET only and no redirects', 'credentials never serialized', 'unmodified response bodies', 'missing endpoint is not a success', 'transport failure cannot produce an observation', 'embedded credentials refused'] as const;
const collected: string[] = [];
beforeEach(() => expect.hasAssertions());
afterAll(() => assertExactCaseIds(names, collected));
const test = (name: typeof names[number], run: () => Promise<void>) => it(name, async () => { collected.push(name); await run(); });
const input = { baseUrl: 'https://cee.example.test', promptId: 'draft_graph_default', adminKey: 'private-test-key-never-persist', environment: 'staging' as const };
const paths = ['/admin/prompts/draft_graph_default', '/admin/prompts/verify', '/admin/models/routing', '/healthz'];

describe('read-only serving observation transport', () => {
  test('GET only and no redirects', async () => {
    const requests: Array<{ url: string; init?: Parameters<typeof fetch>[1] }> = [];
    const fetcher: typeof fetch = async (url, init) => {
      requests.push({ url: String(url), init });
      return new Response('{"unrelated":"teapot"}', { status: 200 });
    };
    const observation = await readServingObservation(input, fetcher);
    expect(requests.map(r => new URL(r.url).pathname).sort()).toEqual([...paths].sort());
    expect(requests).toHaveLength(4);
    for (const request of requests) {
      expect(request.init?.method).toBe('GET');
      expect(request.init?.body).toBeUndefined();
      expect(request.init?.redirect).toBe('error');
      expect(request.init?.signal).toBeInstanceOf(AbortSignal);
      expect(new URL(request.url).origin).toBe(input.baseUrl);
    }
    expect(observation.instanceId).toBeNull();
    expect(observation.environment).toBe('staging');
  });

  test('credentials never serialized', async () => {
    let authenticated = 0;
    const fetcher: typeof fetch = async (_url, init) => {
      if (new Headers(init?.headers).get('X-Admin-Key') === input.adminKey) authenticated++;
      return new Response('{"public_fact":"retained"}', { headers: { 'Set-Cookie': 'private-session-token' } });
    };
    const observation = await readServingObservation(input, fetcher);
    expect(authenticated).toBe(4); // Contrast: the key really participated in the request.
    const saved = JSON.stringify(observation);
    expect(saved).not.toContain(input.adminKey);
    expect(saved).not.toContain('X-Admin-Key');
    expect(saved).not.toContain('private-session-token');
    expect(saved).toContain('public_fact');
  });

  test('unmodified response bodies', async () => {
    const raw = '  { "prompt" : "Crème brûlée", "unrelated" : "teapot" }\n\n';
    const observation = await readServingObservation(input, async () => new Response(raw));
    for (const capture of [observation.stored, observation.loaded, observation.routing, observation.health]) {
      expect(capture?.body).toBe(raw);
      expect(capture?.bodySha256).toBe(sha256(raw));
      expect(capture?.bodySha256).not.toBe(sha256(JSON.stringify(JSON.parse(raw))));
    }
  });

  test('missing endpoint is not a success', async () => {
    const fetcher: typeof fetch = async url => new URL(String(url)).pathname === '/admin/models/routing'
      ? new Response('route unavailable\n', { status: 404 })
      : new Response('{"available":true}', { status: 200 });
    const observation = await readServingObservation(input, fetcher);
    expect(observation.routing).toMatchObject({ httpStatus: 404, body: 'route unavailable\n', bodySha256: sha256('route unavailable\n') });
    expect(observation.stored?.httpStatus).toBe(200);
    expect(observation.loaded?.httpStatus).toBe(200);
    expect(observation.health?.httpStatus).toBe(200);
    expect(observation).not.toHaveProperty('status', 'PASS');
  });

  test('transport failure cannot produce an observation', async () => {
    const fetcher: typeof fetch = async url => {
      if (new URL(String(url)).pathname === '/healthz') throw new Error('offline transport failure');
      return new Response('{"available":true}');
    };
    await expect(readServingObservation(input, fetcher)).rejects.toThrow('offline transport failure');
  });

  test('embedded credentials refused', async () => {
    let calls = 0;
    const fetcher: typeof fetch = async () => { calls++; return new Response('{}'); };
    await expect(readServingObservation({ ...input, baseUrl: 'https://user:password@cee.example.test' }, fetcher)).rejects.toThrow('credentials must not be embedded');
    expect(calls).toBe(0);
    await readServingObservation(input, fetcher);
    expect(calls).toBe(4);
  });
});
