/**
 * V5 Coaching State Spine — Stage 2B-1b: persist + read coaching_state snapshot.
 *
 * End-to-end (in-memory store) proof that the turn-start pre-dispatch
 * coaching_state threads to `append`, that the most-recent NON-NULL snapshot is
 * read back as `prior_coaching_state` on the next turn, that null/system-event
 * turns do not reset the prior thread, and that `v5.coaching_state.persisted`
 * fires only after a successful append with no raw content.
 */

import { describe, it, expect, afterEach } from 'vitest';

import { commitDirectAnswer } from '../commit.js';
import type { CommitMetadata } from '../commit.js';
import { composeDirectAnswerResponse } from '../compose.js';
import { buildTurnContext } from '../build-turn-context.js';
import { makeMessagePayload } from './fixtures.js';
import { setTestSink } from '../../utils/telemetry.js';
import type { SessionStore, SessionTurnWrite } from '../session/store.js';
import { toPreDispatchSnapshot, type CoachingStateSnapshot } from '../coaching/coaching-state-snapshot.js';
import { EMPTY_COACHING_STATE, type CoachingState } from '../coaching/coaching-state.js';

const SCENARIO_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const ACTIVE_STATE: CoachingState = {
  version: 'v1',
  status: 'active',
  graph_hash: 'h_now',
  analysis_graph_hash: 'h_run',
  signals: [
    {
      signal_id: 'analysis_missing:no_successful_run_analysis_fact',
      kind: 'analysis_missing',
      status: 'active',
      source: 'analysis_freshness',
      graph_hash: 'h_now',
      analysis_graph_hash: null,
      reason_code: 'no_successful_run_analysis_fact',
      created_from: 'derived_current_turn',
    },
  ],
  summary: { active_count: 1, stale_count: 0, unavailable_count: 0 },
};

function meta(coaching_state: CoachingState | null): CommitMetadata {
  return {
    scenario_id: SCENARIO_ID,
    turn_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    turn_class: 'direct_answer',
    handler_id: null,
    request_hash: 'sha256:test',
    llm_calls_used: 0,
    duration_ms: 1,
    handler_facts: [],
    coaching_state,
  };
}

const RESPONSE = composeDirectAnswerResponse({ assistant_text: 'hi', stage: 'frame' });

/**
 * In-memory SessionStore that records each turn's coaching_state as a wrapped
 * snapshot and reads back the most recent NON-NULL one — mirroring the
 * supabase-store write (wrap) + null-filtered read, so the round-trip and the
 * null-doesn't-reset invariant can be proven without a DB.
 */
function makeStatefulStore(): { store: SessionStore; snaps: Array<CoachingStateSnapshot | null> } {
  const snaps: Array<CoachingStateSnapshot | null> = [];
  const store = {
    append: async (w: SessionTurnWrite) => {
      snaps.push(w.coaching_state ? toPreDispatchSnapshot(w.coaching_state) : null);
      return { id: `row-${snaps.length}` };
    },
    readRecent: async () => [],
    readFactsFor: async () => [],
    readFactsWithTurnFor: async () => [],
    invalidateScoped: async () => ({ scenario_id: SCENARIO_ID, evicted: 0 }),
    invalidateAll: async () => ({ scenario_id: SCENARIO_ID, evicted: 0 }),
    storeDraftGraph: async () => {},
    loadGraph: async () => null,
    loadGraphAndBriefText: async () => ({ graph: null, briefText: null }),
    ensureScenarioExists: async () => ({ user_id: null }),
    readMostRecentPendingActions: async () => [],
    readMostRecentCoachingState: async () => {
      for (let i = snaps.length - 1; i >= 0; i -= 1) {
        if (snaps[i] !== null) return snaps[i];
      }
      return null;
    },
  } as unknown as SessionStore;
  return { store, snaps };
}

afterEach(() => setTestSink(null));

describe('2B-1b — write path threads coaching_state to append', () => {
  it('passes the current coaching_state to SessionStore.append (req 1)', async () => {
    const { store, snaps } = makeStatefulStore();
    await commitDirectAnswer(RESPONSE, meta(ACTIVE_STATE), store);
    expect(snaps).toHaveLength(1);
    expect(snaps[0]).toEqual(toPreDispatchSnapshot(ACTIVE_STATE));
    expect(snaps[0]!.snapshot_timing).toBe('pre_dispatch');
  });

  it('persists null when coaching_state is null/omitted (req 2)', async () => {
    const { store, snaps } = makeStatefulStore();
    await commitDirectAnswer(RESPONSE, meta(null), store);
    expect(snaps[0]).toBeNull();
  });
});

describe('2B-1b — round-trip + null-filter (reqs 3, 4, 8)', () => {
  it('round-trips the prior snapshot; a null turn does not reset it', async () => {
    const { store } = makeStatefulStore();
    const payload = makeMessagePayload({ scenario_id: SCENARIO_ID, message: 'hi' });

    // Turn 1: no prior snapshot yet.
    const ctx1 = await buildTurnContext(payload, 'req-1', { sessionStore: store });
    expect(ctx1.prior_coaching_state).toBeNull();

    // Commit turn 1 with a real coaching_state.
    await commitDirectAnswer(RESPONSE, meta(ACTIVE_STATE), store);

    // Turn 2 reads turn 1's pre-dispatch snapshot as prior.
    const ctx2 = await buildTurnContext(payload, 'req-2', { sessionStore: store });
    expect(ctx2.prior_coaching_state).toEqual(toPreDispatchSnapshot(ACTIVE_STATE));

    // Commit turn 2 with NULL coaching_state (e.g. system-event-like).
    await commitDirectAnswer(RESPONSE, meta(null), store);

    // Turn 3: the null row must NOT reset the prior — still turn 1's snapshot.
    const ctx3 = await buildTurnContext(payload, 'req-3', { sessionStore: store });
    expect(ctx3.prior_coaching_state).toEqual(toPreDispatchSnapshot(ACTIVE_STATE));
  });

  it('attaches null prior when the store does not implement readMostRecentCoachingState', async () => {
    // Stateful store minus the optional method → graceful null.
    const { store } = makeStatefulStore();
    delete (store as { readMostRecentCoachingState?: unknown }).readMostRecentCoachingState;
    const ctx = await buildTurnContext(
      makeMessagePayload({ scenario_id: SCENARIO_ID, message: 'hi' }),
      'req-x',
      { sessionStore: store },
    );
    expect(ctx.prior_coaching_state).toBeNull();
  });

  it('degrades prior_coaching_state to null when readMostRecentCoachingState throws', async () => {
    // A read failure must never fail the turn — buildTurnContext catches and
    // degrades to a null prior (mirrors fetchMostRecentPendingActions).
    const { store } = makeStatefulStore();
    (store as { readMostRecentCoachingState: unknown }).readMostRecentCoachingState = async () => {
      throw new Error('simulated read failure');
    };
    const ctx = await buildTurnContext(
      makeMessagePayload({ scenario_id: SCENARIO_ID, message: 'hi' }),
      'req-throw',
      { sessionStore: store },
    );
    expect(ctx.prior_coaching_state).toBeNull();
  });
});

describe('2B-1b — v5.coaching_state.persisted telemetry (req 10)', () => {
  it('emits after successful append, present=true with summary + no raw content', async () => {
    const events: Array<{ name: string; data: Record<string, unknown> }> = [];
    setTestSink((name, data) => events.push({ name, data }));
    const { store } = makeStatefulStore();
    await commitDirectAnswer(RESPONSE, meta(ACTIVE_STATE), store);

    const ev = events.find((e) => e.name === 'v5.coaching_state.persisted');
    expect(ev).toBeDefined();
    expect(ev!.data.coaching_state_present).toBe(true);
    expect(ev!.data.status).toBe('active');
    expect(ev!.data.signal_count).toBe(1);
    expect(ev!.data.snapshot_timing).toBe('pre_dispatch');
    expect(ev!.data.turn_class).toBe('direct_answer');
    expect(typeof ev!.data.scenario_id).toBe('string');
    // Privacy: counts/enums/hashes only — no raw decision content.
    const serialised = JSON.stringify(ev!.data);
    for (const banned of ['brief', 'label', 'description', 'monetary', 'timeline']) {
      expect(serialised.toLowerCase()).not.toContain(banned);
    }
  });

  it('emits present=false (snapshot_timing null) when no coaching_state was derived', async () => {
    const events: Array<{ name: string; data: Record<string, unknown> }> = [];
    setTestSink((name, data) => events.push({ name, data }));
    const { store } = makeStatefulStore();
    await commitDirectAnswer(RESPONSE, meta(null), store);

    const ev = events.find((e) => e.name === 'v5.coaching_state.persisted');
    expect(ev).toBeDefined();
    expect(ev!.data.coaching_state_present).toBe(false);
    expect(ev!.data.status).toBeNull();
    expect(ev!.data.signal_count).toBe(0);
    expect(ev!.data.snapshot_timing).toBeNull();
  });

  it('does NOT emit when append throws (post-success only)', async () => {
    const events: Array<{ name: string; data: Record<string, unknown> }> = [];
    setTestSink((name, data) => events.push({ name, data }));
    const store = {
      ...makeStatefulStore().store,
      append: async () => {
        throw new Error('simulated RPC failure');
      },
    } as unknown as SessionStore;
    await expect(commitDirectAnswer(RESPONSE, meta(ACTIVE_STATE), store)).rejects.toThrow(/simulated/);
    expect(events.find((e) => e.name === 'v5.coaching_state.persisted')).toBeUndefined();
  });

  it('does NOT fail the commit when post-success telemetry throws (persisted-state invariant)', async () => {
    // Force emit() to throw via the test-sink path. The persisted event fires
    // AFTER the durable append, so a telemetry fault must degrade to a log and
    // the commit must still resolve successfully — never surface as a turn error.
    setTestSink((name) => {
      if (name === 'v5.coaching_state.persisted') throw new Error('simulated telemetry failure');
    });
    const { store, snaps } = makeStatefulStore();
    const result = await commitDirectAnswer(RESPONSE, meta(ACTIVE_STATE), store);
    expect(result.performed).toBe(true);
    // State was persisted before telemetry ran — the throw did not roll it back.
    expect(snaps).toHaveLength(1);
    expect(snaps[0]).toEqual(toPreDispatchSnapshot(ACTIVE_STATE));
  });
});

// EMPTY_COACHING_STATE is a valid input too (cold-start turns derive it).
describe('2B-1b — empty state persists + round-trips', () => {
  it('wraps and round-trips EMPTY_COACHING_STATE', async () => {
    const { store } = makeStatefulStore();
    await commitDirectAnswer(RESPONSE, meta(EMPTY_COACHING_STATE), store);
    const ctx = await buildTurnContext(
      makeMessagePayload({ scenario_id: SCENARIO_ID, message: 'hi' }),
      'req-e',
      { sessionStore: store },
    );
    expect(ctx.prior_coaching_state?.coaching_state).toEqual(EMPTY_COACHING_STATE);
  });
});
