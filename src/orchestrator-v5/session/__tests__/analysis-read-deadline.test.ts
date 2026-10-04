import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ANALYSIS_REREAD_TIMEOUT_MS, AnalysisReadDeadlineError, abortableAnalysisRead, withAnalysisReadDeadline } from '../analysis-read-deadline.js';
import { SupabaseSessionStore } from '../supabase-store.js';
import { SessionLRUCache } from '../cache.js';

const SCENARIO = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ROW = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

function clientWithPendingRead(supportsAbort: boolean) {
  let rejectLate!: (error: Error) => void;
  const pending = new Promise<never>((_resolve, reject) => { rejectLate = reject; });
  const signals: AbortSignal[] = [];
  const calls: unknown[][] = [];
  const query: Record<string, unknown> = { then: pending.then.bind(pending) };
  for (const method of ['select', 'eq', 'not', 'in', 'order', 'limit', 'maybeSingle']) {
    query[method] = (...args: unknown[]) => { calls.push([method, ...args]); return query; };
  }
  if (supportsAbort) query.abortSignal = (signal: AbortSignal) => { signals.push(signal); return query; };
  const client = { from: (table: string) => { calls.push(['from', table]); return query; },
    rpc: (name: string, args: unknown) => { calls.push(['rpc', name, args]); return query; } } as unknown as SupabaseClient;
  return { client, signals, calls, rejectLate };
}
const READERS = [
  ['scenario access', (store: SupabaseSessionStore) => store.readExistingScenario(SCENARIO), ['eq', 'id', SCENARIO]],
  ['hot-window turns', (store: SupabaseSessionStore) => store.readRecent(SCENARIO), ['eq', 'scenario_id', SCENARIO]],
  ['hot-window facts', (store: SupabaseSessionStore) => store.readFactsWithTurnFor([ROW]), ['in', 'v5_conversation_turn_id', [ROW]]],
  ['primary Run history', (store: SupabaseSessionStore) => store.readScenarioRunAnalysisFactsFor(SCENARIO, 21), ['eq', 'scenario_id', SCENARIO]],
  ['restore marker', (store: SupabaseSessionStore) => store.readAnalysisInvalidatedAt(SCENARIO), ['eq', 'id', SCENARIO]],
  ['graph/brief', (store: SupabaseSessionStore) => store.loadGraphAndBriefText(SCENARIO), ['eq', 'id', SCENARIO]],
  ['scope holds', (store: SupabaseSessionStore) => store.readMostRecentPendingActions(SCENARIO), ['eq', 'scenario_id', SCENARIO]],
  ['membership', (store: SupabaseSessionStore) => store.isScenarioMember(SCENARIO, 'user-id'), ['rpc', 'is_scenario_member', { p_scenario_id: SCENARIO, p_user_id: 'user-id' }]],
] as const;

describe('canonical reread: cancellation at supported production dependencies', () => {
  for (const supportsAbort of [false, true]) {
    it.each(READERS)(`%s never settles (abort support=${supportsAbort}): one deadline, exact identity, handled late rejection`, async (_name, read, filter) => {
      const fake = clientWithPendingRead(supportsAbort);
      const store = new SupabaseSessionStore(fake.client, new SessionLRUCache({ maxScenarios: 2, maxTurnsPerScenario: 20 }), { defaultReadLimit: 20 });
      let verdict: unknown;
      const bounded = withAnalysisReadDeadline<unknown>(() => read(store)).catch(error => { verdict = error; });
      await vi.advanceTimersByTimeAsync(ANALYSIS_REREAD_TIMEOUT_MS - 1);
      expect(verdict).toBeUndefined();
      expect(fake.calls).toContainEqual(filter);
      await vi.advanceTimersByTimeAsync(1);
      expect(verdict).toBeInstanceOf(AnalysisReadDeadlineError);
      await bounded;
      expect(fake.signals).toHaveLength(supportsAbort ? 1 : 0);
      if (supportsAbort) expect(fake.signals[0]!.aborted).toBe(true);
      fake.rejectLate(new Error('late production dependency rejection'));
      await vi.advanceTimersByTimeAsync(0);
      expect(vi.getTimerCount()).toBe(0);
    });
  }
  it('sequential/nested reads share the original budget and signal, rather than restarting after the first read', async () => {
    const fake = clientWithPendingRead(true);
    let verdict: unknown;
    const bounded = withAnalysisReadDeadline(async signal => {
      await new Promise(resolve => setTimeout(resolve, 600));
      return withAnalysisReadDeadline(nestedSignal => {
        expect(nestedSignal).toBe(signal);
        const store = new SupabaseSessionStore(fake.client, new SessionLRUCache({ maxScenarios: 2, maxTurnsPerScenario: 20 }), { defaultReadLimit: 20 });
        return store.readAnalysisInvalidatedAt(SCENARIO);
      });
    }).catch(error => { verdict = error; });
    await vi.advanceTimersByTimeAsync(ANALYSIS_REREAD_TIMEOUT_MS - 1);
    expect(verdict).toBeUndefined();
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await bounded;
    expect(verdict).toBeInstanceOf(AnalysisReadDeadlineError);
    expect(fake.signals[0]!.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  for (const supportsAbort of [false, true]) {
    it(`a hot-window read that SUCCEEDS after its deadline never overwrites the session cache (abort support=${supportsAbort}; review 2ed9906b)`, async () => {
      // The dependency ignores cancellation and resolves late with an OLD, empty history.
      let resolveLate!: (value: { data: unknown[]; error: null }) => void;
      const pending = new Promise<{ data: unknown[]; error: null }>(resolve => { resolveLate = resolve; });
      const query: Record<string, unknown> = { then: pending.then.bind(pending) };
      for (const method of ['select', 'eq', 'not', 'in', 'order', 'limit', 'maybeSingle']) query[method] = () => query;
      if (supportsAbort) query.abortSignal = () => query;
      const client = { from: () => query } as unknown as SupabaseClient;
      const cache = new SessionLRUCache({ maxScenarios: 2, maxTurnsPerScenario: 20 });
      const store = new SupabaseSessionStore(client, cache, { defaultReadLimit: 20 });
      let verdict: unknown;
      const bounded = withAnalysisReadDeadline(() => store.readRecent(SCENARIO)).catch(error => { verdict = error; });
      await vi.advanceTimersByTimeAsync(ANALYSIS_REREAD_TIMEOUT_MS);
      await bounded;
      expect(verdict).toBeInstanceOf(AnalysisReadDeadlineError);
      // A commit lands and repopulates the cache with the committed row's history.
      const committed = [{ id: ROW }] as never;
      cache.populate(SCENARIO, committed, { complete: true });
      // The old read now resolves successfully with empty history.
      resolveLate({ data: [], error: null });
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
      const after = cache.getScenario(SCENARIO);
      expect(after?.complete).toBe(true);
      expect(after?.turns).toHaveLength(1);
      expect((after?.turns[0] as { id?: string }).id).toBe(ROW);
    });
  }
  it('healthy reads keep the exact result object/bytes and do not retain timers or a cancellation scope', async () => {
    const value = { result: 'healthy', identity: SCENARIO };
    expect(await withAnalysisReadDeadline(async () => value)).toBe(value);
    expect(vi.getTimerCount()).toBe(0);
    const query = { abortSignal: vi.fn(() => query) };
    expect(abortableAnalysisRead(query)).toBe(query);
    expect(query.abortSignal).not.toHaveBeenCalled();
  });
});
