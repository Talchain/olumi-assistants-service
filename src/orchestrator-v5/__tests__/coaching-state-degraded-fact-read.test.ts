/**
 * CONTEXT/MEMORY V5 defect 4 — THE PERSIST HALF, AT THE ROUTE THAT WRITES IT.
 *
 * WHY THIS IS THE MOST CONSEQUENTIAL ARM OF THE FIX. `freshness-degraded-fact-
 * read.test.ts` proves the DERIVATION is honest when told the read degraded.
 * This file proves the coaching route actually tells it — and that matters more
 * here than anywhere else in the estate, because this verdict does not merely
 * get displayed and discarded. The chain, derived at the bytes:
 *
 *   fetchPriorFacts THROWS  →  prior_facts = [], prior_facts_read_ok = false
 *     → build-turn-context.ts:671  deriveAnalysisFreshness(...)
 *     → coaching-state.ts:229      deriveAnalysisSignals(freshness)
 *     → 'none' produces an ACTIVE `analysis_missing` signal
 *     → context.coaching_state
 *     → turn-executor.ts:1412 / chip-click-dispatch.ts:1214 (commit metadata)
 *     → commit.ts:1105  →  supabase-store.ts:238 `p_coaching_state`
 *     → PERSISTED into the `coaching_state` JSONB column
 *     → read back on LATER turns as `prior_coaching_state`
 *
 * And it does not age out. `readMostRecentCoachingState` selects
 * `coaching_state IS NOT NULL ORDER BY created_at DESC LIMIT 1` (store.ts:495-508),
 * so turns that persist NULL do not clear it: one degraded read could write
 * "this scenario has never been analysed" into stored state and have it replayed
 * indefinitely, long after the store recovered. A transient read failure would
 * become a durable false claim.
 *
 * WHAT WOULD HAVE TO BE TRUE for these to pass while the property is broken:
 *   · the option could be accepted and ignored — covered, the degraded arm
 *     asserts the SIGNAL KIND changes, not merely that a signal exists;
 *   · it could fire on an ordinary empty scenario, making every never-analysed
 *     scenario stop reporting `analysis_missing` — covered by the ok-arm control,
 *     which is the discriminating twin and must keep reporting it;
 *   · it could blank out a scenario that really does carry an analysis — covered
 *     by the fact-present arm.
 *
 * ⚠ SCOPE NOTE, stated precisely rather than faked. The "degraded read + a fact
 * was nonetheless returned" combination is UNREACHABLE ON THIS ROUTE by
 * construction: `fetchPriorFacts` sets `readOk: false` only in its catch, which
 * returns an empty array. So the fact-authoritative property is asserted here in
 * the form this route can actually produce (a healthy read that returns a fact
 * must not report `analysis_missing`), and the degraded-flag-versus-real-fact
 * arm lives at the derivation, in `freshness-degraded-fact-read.test.ts:93`,
 * where that combination IS constructible. Naming which arm lives where is the
 * point — an invented route-level fixture for an unreachable state would be a
 * self-authored input encoding my model of the producer, not the producer.
 */

import { describe, it, expect } from 'vitest';

import { buildTurnContext } from '../build-turn-context.js';
import { createNoopSessionStore } from '../session/__tests__/fixtures.js';
import { SessionReadError } from '../session/store.js';
import { makeMessagePayload } from './fixtures.js';
import type { HandlerFact } from '@talchain/schemas/orchestrator';

const BASE = makeMessagePayload({ message: 'hello' });

/** A handler turn whose facts the loader will try to read. */
function handlerTurn() {
  return {
    turn_id: 'client-turn-uuid',
    id: 'db-row-uuid',
    created_at: '2026-08-15T11:00:00.000+00:00',
    turn_class: 'handler' as const,
    handler_id: 'run_analysis' as const,
  };
}

/**
 * ⚠ SHAPE DERIVED FROM THE PRODUCER, NOT INVENTED — `viewRunAnalysisFact` reads
 * `graph_hash_at_run` / `computed_at` from `result` and requires `noop === false`.
 * A top-level-fields fixture is silently UNSELECTABLE, which would make the
 * fact-present arm below assert against a fact the derivation cannot see.
 * Matches `mkRunAnalysisFact` in `freshness.test.ts`.
 */
function runAnalysisFact(graphHash: string): HandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      graph_hash_at_run: graphHash,
      computed_at: '2026-08-15T00:00:00.000Z',
    },
  } as unknown as HandlerFact;
}

const analysisSignals = (ctx: Awaited<ReturnType<typeof buildTurnContext>>) =>
  ctx.coaching_state.signals.filter((s) => s.source === 'analysis_freshness');

describe('buildTurnContext coaching_state — a degraded fact read is not "analysis_missing"', () => {
  it('DEGRADED read: no active analysis_missing signal is derived (or persisted)', async () => {
    const store = {
      ...createNoopSessionStore({ priorTurns: [handlerTurn() as never] }),
      readFactsFor: async () => {
        throw new SessionReadError('DB offline', { code: '57P03' });
      },
    };
    const ctx = await buildTurnContext(BASE, 'req-coaching-degraded', {
      sessionStore: store,
    });

    // PIN THE PRECONDITION IN-TEST. Without this the assertions below could
    // hold on a turn that simply had facts, and the test would be asserting
    // nothing about the degraded path at all.
    expect(ctx.prior_facts).toEqual([]);
    expect(ctx.prior_facts_read_ok).toBe(false);

    // The defect, stated as the product harm: this is the signal that would be
    // committed into the `coaching_state` column and replayed forward.
    expect(analysisSignals(ctx).map((s) => s.kind)).not.toContain('analysis_missing');
    expect(ctx.coaching_state.signals.map((s) => s.signal_id)).not.toContain(
      'analysis_missing:no_successful_run_analysis_fact',
    );

    // And the honest degradation that must replace it: `unavailable`, not a
    // positive claim in either direction. `derivation_failed` maps to
    // `staleness_indeterminate` (coaching-state.ts:453-457) because the closed
    // `CoachingStateReasonCode` enum has no member of its own for it.
    const degraded = analysisSignals(ctx);
    expect(degraded).toHaveLength(1);
    expect(degraded[0]!.kind).toBe('analysis_stale');
    expect(degraded[0]!.status).toBe('unavailable');
    expect(degraded[0]!.reason_code).toBe('staleness_indeterminate');
  });

  it('CONTROL (ok arm): a healthy read that genuinely returns nothing still reports analysis_missing', async () => {
    // THE DISCRIMINATING TWIN. A fix that downgraded every empty read — or that
    // hard-coded the degraded branch — would satisfy the arm above and fail
    // here, silently deleting the real "you have not analysed this yet" signal
    // for every new scenario. One direction alone guards one door.
    const store = {
      ...createNoopSessionStore({ priorTurns: [handlerTurn() as never] }),
      readFactsFor: async () => [],
    };
    const ctx = await buildTurnContext(BASE, 'req-coaching-empty', {
      sessionStore: store,
    });

    expect(ctx.prior_facts).toEqual([]);
    expect(ctx.prior_facts_read_ok).toBe(true);

    const signals = analysisSignals(ctx);
    expect(signals).toHaveLength(1);
    expect(signals[0]!.kind).toBe('analysis_missing');
    expect(signals[0]!.status).toBe('active');
    expect(signals[0]!.reason_code).toBe('no_successful_run_analysis_fact');
  });

  it('a fact that WAS read stays authoritative — never reported as missing', async () => {
    // Bounds the change in the other direction: the flag speaks only to the
    // ABSENCE of facts. A scenario carrying a real run_analysis fact must never
    // report `analysis_missing`, and its reason code must come from the hash
    // comparison rather than from the degraded branch — which is what
    // distinguishes this arm from the degraded one by IDENTITY (a different
    // reason code), not merely by the absence of a signal.
    const store = {
      ...createNoopSessionStore({ priorTurns: [handlerTurn() as never] }),
      readFactsFor: async () => [runAnalysisFact('abc123')],
    };
    const ctx = await buildTurnContext(BASE, 'req-coaching-fact', {
      sessionStore: store,
    });

    expect(ctx.prior_facts).toHaveLength(1);
    expect(ctx.prior_facts_read_ok).toBe(true);

    const signals = analysisSignals(ctx);
    expect(signals.map((s) => s.kind)).not.toContain('analysis_missing');
    expect(signals).toHaveLength(1);
    // No persisted graph in this fixture ⇒ no comparable current hash, so the
    // derivation lands on `current_graph_hash_unavailable` — NOT the degraded
    // branch's `staleness_indeterminate`. The two are distinguishable, which is
    // what makes the degraded arm above a real discrimination.
    expect(signals[0]!.reason_code).toBe('current_graph_hash_unavailable');
  });
});
