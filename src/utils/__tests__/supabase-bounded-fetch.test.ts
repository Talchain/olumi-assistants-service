/**
 * ⛔ A STALLED SUPABASE REQUEST (served 14 Oct 14:19Z and 16:18Z: CEE's request never reached Supabase, and stalled
 * 109.8 s). Reads are retried once on a fresh connection. Writes are never retried, and come back typed UNKNOWN.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import {
  SUPABASE_READ_TIMEOUT_MS, SUPABASE_WRITE_TIMEOUT_MS, SupabaseOutcomeUnknownError, boundedSupabaseFetch,
} from '../supabase-bounded-fetch.js';
import { log } from '../telemetry.js';

const URL_BASE = 'https://example.supabase.co';
const stalled = (): Promise<Response> => new Promise(() => {});
const ok = (body: unknown = [{ id: 'row-1' }]) => new Response(JSON.stringify(body), {
  status: 200, headers: { 'content-type': 'application/json', 'content-range': '0-0/1' },
});

beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('a stalled READ recovers on its one retry, on a fresh connection', () => {
  it('⭐ GET that never answers → retried once on the fresh fetch, its answer returned, the stall logged', async () => {
    const warn = vi.spyOn(log, 'warn');
    const inner = vi.fn(stalled);
    const fresh = vi.fn(async () => ok());
    const f = boundedSupabaseFetch(inner as unknown as typeof fetch, () => fresh as unknown as typeof fetch);
    const res = f(`${URL_BASE}/rest/v1/v5_handler_facts?scenario_id=eq.x`, { method: 'GET' });
    await vi.advanceTimersByTimeAsync(SUPABASE_READ_TIMEOUT_MS);
    expect((await res).status).toBe(200);
    expect(inner).toHaveBeenCalledTimes(1);
    expect(fresh).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ event: 'supabase.fetch_stalled', method: 'GET',
      target: 'rest:v5_handler_facts', retried: true, reason: 'timeout' }), expect.any(String));
    // The scenario id in the query string is never logged.
    expect(JSON.stringify(warn.mock.calls)).not.toContain('scenario_id=eq.x');
  });
  it('a GET that fails on the network is retried once too', async () => {
    const fresh = vi.fn(async () => ok());
    const f = boundedSupabaseFetch((async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch, () => fresh as unknown as typeof fetch);
    expect((await f(`${URL_BASE}/rest/v1/scenarios`, { method: 'GET' })).status).toBe(200);
    expect(fresh).toHaveBeenCalledTimes(1);
  });
  it('the retry is the only one: a retry that stalls too fails the read', async () => {
    const f = boundedSupabaseFetch(stalled as unknown as typeof fetch, () => stalled as unknown as typeof fetch);
    let failed: unknown;
    const res = f(`${URL_BASE}/rest/v1/scenarios`).catch((e) => { failed = e; });
    await vi.advanceTimersByTimeAsync(2 * SUPABASE_READ_TIMEOUT_MS);
    await res;
    expect(failed).toBeInstanceOf(Error);
    expect((failed as Error).name).toBe('SupabaseRequestTimeoutError');
  });
});

describe('a stalled WRITE is never retried and comes back typed unknown', () => {
  it('⭐ POST (an insert) that never answers → SupabaseOutcomeUnknownError, no retry, the stall logged', async () => {
    const warn = vi.spyOn(log, 'warn');
    const fresh = vi.fn(async () => ok());
    const f = boundedSupabaseFetch(stalled as unknown as typeof fetch, () => fresh as unknown as typeof fetch);
    let failed: unknown;
    const res = f(`${URL_BASE}/rest/v1/v5_conversation_turns`, { method: 'POST', body: '{}' }).catch((e) => { failed = e; });
    await vi.advanceTimersByTimeAsync(SUPABASE_WRITE_TIMEOUT_MS);
    await res;
    expect(failed).toBeInstanceOf(SupabaseOutcomeUnknownError);
    expect(failed).toMatchObject({ outcome: 'unknown', method: 'POST', target: 'rest:v5_conversation_turns' });
    expect(fresh).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ event: 'supabase.fetch_stalled', method: 'POST', retried: false }), expect.any(String));
  });
  it('an RPC that fails on the network is unknown too, never retried', async () => {
    const fresh = vi.fn(async () => ok());
    const f = boundedSupabaseFetch((async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch, () => fresh as unknown as typeof fetch);
    await expect(f(`${URL_BASE}/rest/v1/rpc/append_turn`, { method: 'POST', body: '{}' })).rejects.toMatchObject({ name: 'SupabaseOutcomeUnknownError', target: 'rpc:append_turn' });
    expect(fresh).not.toHaveBeenCalled();
  });
});

describe('what the wrapper leaves alone', () => {
  it('a caller\'s own abort (the analysis-read deadline) passes through: no retry, no stall logged', async () => {
    const warn = vi.spyOn(log, 'warn');
    const fresh = vi.fn(async () => ok());
    const caller = new AbortController();
    const inner = ((_: unknown, init?: Parameters<typeof fetch>[1]) => new Promise<Response>((_r, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
    })) as unknown as typeof fetch;
    const f = boundedSupabaseFetch(inner, () => fresh as unknown as typeof fetch);
    const res = f(`${URL_BASE}/rest/v1/v5_handler_facts`, { method: 'GET', signal: caller.signal });
    caller.abort(new Error('caller deadline'));
    await expect(res).rejects.toThrow('caller deadline');
    expect(fresh).not.toHaveBeenCalled();
    expect(warn.mock.calls.some(([o]) => (o as { event?: string }).event === 'supabase.fetch_stalled')).toBe(false);
  });
  it('a healthy request returns its own response and leaves no timer', async () => {
    const answer = ok();
    const f = boundedSupabaseFetch((async () => answer) as unknown as typeof fetch);
    expect(await f(`${URL_BASE}/rest/v1/scenarios`)).toBe(answer);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('⭐ real path: through supabase-js, as every CEE client is built', () => {
  it('a stalled select recovers with its rows; a stalled insert is an error naming the unknown outcome (status 0)', async () => {
    let firstSelect = true;
    const inner = (async (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'GET' && firstSelect) { firstSelect = false; return stalled(); }
      if (method === 'POST') return stalled();
      return ok([{ id: 'row-1' }]);
    }) as unknown as typeof fetch;
    const client = createClient(URL_BASE, 'service-role-test-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: boundedSupabaseFetch(inner, () => inner) },
    });
    const read = client.from('v5_handler_facts').select('id').eq('scenario_id', 'x');
    const write = client.from('v5_conversation_turns').insert({ id: 'row-2' });
    const both = Promise.all([read, write]);
    await vi.advanceTimersByTimeAsync(SUPABASE_WRITE_TIMEOUT_MS);
    const [r, w] = await both;
    expect(r.error).toBeNull();
    expect(r.data).toEqual([{ id: 'row-1' }]);
    expect(w.status).toBe(0);
    expect(w.error?.message).toMatch(/^SupabaseOutcomeUnknownError: POST rest:v5_conversation_turns/);
  });
});
