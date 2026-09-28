/**
 * C1 (DL #72 5862738581, Canonical 5862863093) — THE HOT-WINDOW FACT READ OVERLAPS THE PARALLEL BATCH.
 *
 * Every graph read and every turn context loads the prior turns, then the facts for those turns
 * (`readFactsWithTurnFor(turnRowIds)`). The facts depend ONLY on the turns, but they were awaited after
 * the WHOLE parallel batch — so on staging the ~0.31 s facts round trip sat behind the batch's slowest
 * read (the durable analysis-fact page) on every read, three times per approval. Chaining the facts read
 * onto the turns read inside the batch issues the SAME queries and returns the SAME result; only the
 * await order moves. These rows bind that order by identity (which call has started while which is
 * still pending), plus the unchanged result and the unchanged degraded semantics.
 */
import { describe, it, expect } from 'vitest';
import type { SessionStore } from '../session/store.js';
import { buildTurnContext, loadScenarioAnalysisFactsForRead } from '../build-turn-context.js';
import { createNoopSessionStore } from '../session/__tests__/fixtures.js';
import { makeMessagePayload } from './fixtures.js';

const SCENARIO = '11111111-1111-4111-8111-111111111111';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const flush = () => new Promise<void>((r) => setImmediate(r));

function storeDouble(opts: { readonly factsThrow?: boolean; readonly turnsThrow?: boolean } = {}) {
  const calls: string[] = [];
  const durable = deferred<{ facts: readonly unknown[]; complete: boolean }>();
  const store = {
    async readRecent() {
      calls.push('readRecent');
      if (opts.turnsThrow) throw new Error('turns read failed');
      return [{ id: 'row-1', turn_id: 't-1', scenario_id: SCENARIO }];
    },
    async readFactsWithTurnFor(ids: readonly string[]) {
      calls.push(`readFactsWithTurnFor:${ids.join(',')}`);
      if (opts.factsThrow) throw new Error('facts read failed');
      return [];
    },
    async readFactsFor() {
      calls.push('readFactsFor');
      return [];
    },
    readScenarioRunAnalysisFactsFor() {
      calls.push('readScenarioRunAnalysisFactsFor');
      return durable.promise;
    },
  } as unknown as SessionStore;
  return { store, calls, durable };
}

describe('C1 — the hot-window fact read starts inside the batch, not after it', () => {
  it('RED at base: the facts read has STARTED while the durable fact page is still pending', async () => {
    const { store, calls, durable } = storeDouble();
    const pending = loadScenarioAnalysisFactsForRead(SCENARIO, 'req-c1', store);
    await flush();
    // The durable page has not resolved, yet the facts for the turns already read are being fetched.
    expect(calls).toContain('readScenarioRunAnalysisFactsFor');
    expect(calls).toContain('readFactsWithTurnFor:row-1');
    durable.resolve({ facts: [], complete: true });
    const out = await pending;
    expect(out.hotWindow.status).toBe('ok');
  });

  it('the result is unchanged: the facts read runs once, for exactly the turns read', async () => {
    const { store, calls, durable } = storeDouble();
    durable.resolve({ facts: [], complete: true });
    const out = await loadScenarioAnalysisFactsForRead(SCENARIO, 'req-c1', store);
    expect(calls.filter((c) => c.startsWith('readFactsWithTurnFor'))).toEqual(['readFactsWithTurnFor:row-1']);
    expect(out.hotWindow).toEqual({ status: 'ok', facts: [] });
  });

  it('a failed FACTS read still degrades the hot window (never a rejected batch)', async () => {
    const { store, durable } = storeDouble({ factsThrow: true });
    durable.resolve({ facts: [], complete: true });
    const out = await loadScenarioAnalysisFactsForRead(SCENARIO, 'req-c1', store);
    expect(out.hotWindow).toEqual({ status: 'degraded', facts: [] });
  });

  it('a failed TURNS read still degrades the hot window, and no facts read is issued for it', async () => {
    const { store, calls, durable } = storeDouble({ turnsThrow: true });
    durable.resolve({ facts: [], complete: true });
    const out = await loadScenarioAnalysisFactsForRead(SCENARIO, 'req-c1', store);
    expect(out.hotWindow).toEqual({ status: 'degraded', facts: [] });
    expect(calls.some((c) => c.startsWith('readFactsWithTurnFor'))).toBe(false);
  });
});

describe('C1 — buildTurnContext: the same overlap on the turn path', () => {
  it('TURN PATH, RED at base: the facts read has STARTED while the durable fact page is still pending', async () => {
    const calls: string[] = [];
    const durable = deferred<{ facts: readonly unknown[]; complete: boolean }>();
    const turn = {
      id: '22222222-2222-4222-8222-222222222222', scenario_id: SCENARIO, user_id: '33333333-3333-4333-8333-333333333333',
      turn_id: '44444444-4444-4444-8444-444444444444', turn_class: 'handler' as const, handler_id: 'run_analysis' as const,
      request_hash: 'sha256:prior', response_emitted: true, llm_calls_used: 1, duration_ms: 100, created_at: '2026-08-27T12:00:00.000Z',
    };
    const store = {
      ...createNoopSessionStore(),
      async readRecent() { calls.push('readRecent'); return [turn]; },
      async readFactsWithTurnFor(ids: readonly string[]) { calls.push(`readFactsWithTurnFor:${ids.join(',')}`); return []; },
      readScenarioRunAnalysisFactsFor() { calls.push('readScenarioRunAnalysisFactsFor'); return durable.promise; },
    } as unknown as SessionStore;
    const pending = buildTurnContext(makeMessagePayload({ scenario_id: SCENARIO, message: 'What does it imply?' }), 'req-c1', { sessionStore: store });
    await flush();
    expect(calls).toContain('readScenarioRunAnalysisFactsFor');
    expect(calls).toContain(`readFactsWithTurnFor:${turn.id}`);
    durable.resolve({ facts: [], complete: true });
    await pending;
    expect(calls.filter((c) => c.startsWith('readFactsWithTurnFor'))).toEqual([`readFactsWithTurnFor:${turn.id}`]);
  });
});
