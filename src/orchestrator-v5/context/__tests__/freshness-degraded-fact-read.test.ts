/**
 * CONTEXT/MEMORY V5 — defect 4: A FACT-STORE FAILURE READS AS "NEVER ANALYSED".
 *
 * `fetchPriorFacts` (build-turn-context.ts) returns the same empty array in
 * FOUR different situations: no session store, no prior turns, no row ids, and
 * `readFactsFor` THREW. `deriveAnalysisFreshness` then sees no `run_analysis`
 * fact and returns `'none'` / `no_successful_run_analysis_fact` — i.e. it tells
 * the coach the scenario has never been analysed, when the truth is that we
 * could not read the store.
 *
 * The consequences are not cosmetic. `'none'` is a POSITIVE claim about the
 * scenario, and downstream it clears state: a `'none'` verdict on a scenario
 * that HAS a good analysis fact produces an orphaned-result banner over valid
 * results, and the chip generator branches on it (`chip-generator.ts:135`).
 * `'unknown'` is the vocabulary's own word for "freshness could not be
 * derived", and `derivation_failed` already exists in `FreshnessReason` with
 * exactly this meaning — "dispatcher attempted derivation and failed
 * (session-store error…)". Nothing was reaching it from this path.
 *
 * CEE #977 built the distinction that makes the fix possible —
 * `PriorFactsReadResult.status: 'ok' | 'degraded'` — and its own docblock says
 * why: "Freshness consumers must distinguish 'there are no prior analysis
 * facts' from 'the fact store could not be read'." The pack path simply never
 * consumed it. This wires it.
 *
 * WHAT WOULD HAVE TO BE TRUE for these to pass while the property is broken:
 * the parameter could be accepted and ignored (covered — the degraded arm
 * asserts the verdict CHANGES); or it could override a real fact and blank out
 * a good analysis (covered — the "degraded read does not erase a real fact"
 * arm); or it could fire on an ordinary empty scenario and make every
 * never-analysed scenario read `unknown` (covered by the ok-arm control).
 */

import { describe, expect, it } from 'vitest';

import { deriveAnalysisFreshness } from '../freshness.js';
// Imported from the contract, matching `freshness.ts` itself — `../../types.js`
// does not export this symbol, and the local `pnpm typecheck` gate cannot see
// the mistake because `tsconfig.build.json` excludes test files. Only the
// separate `Typecheck Drift (ratchet)` CI check covers them.
import type { HandlerFact } from '@talchain/schemas/orchestrator';

/**
 * A successful run_analysis fact whose hash matches the current graph.
 *
 * ⚠ SHAPE DERIVED FROM THE PRODUCER, NOT INVENTED. This file's first draft
 * put `graph_hash_at_run` and `status` at the TOP level; `viewRunAnalysisFact`
 * reads them from `result` and requires `noop === false`, so that fixture was
 * silently unselectable and the "does not erase a real fact" arm below was
 * asserting against a fact the derivation could not see — a self-authored
 * input encoding the author's model of the producer rather than the producer.
 * This shape matches `mkRunAnalysisFact` in `freshness.test.ts`.
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

const HASH = 'abc123';

describe('deriveAnalysisFreshness — a degraded fact read is not "never analysed"', () => {
  it('CONTROL: an ok read with no facts is genuinely "none"', () => {
    // The discriminating control. If this ever became `unknown`, every
    // never-analysed scenario would claim its freshness was underivable and
    // the fix below would be indistinguishable from a blanket downgrade.
    const d = deriveAnalysisFreshness([], HASH, null, { priorFactsReadOk: true });
    expect(d.freshness).toBe('none');
    expect(d.reason).toBe('no_successful_run_analysis_fact');
  });

  it('CONTROL: absent flag preserves today\'s behaviour exactly', () => {
    // Back-compatibility arm: every existing caller omits the option, and must
    // keep the pre-fix verdict. A fix that changed behaviour for unwired
    // callers would be a silent estate-wide change, not a targeted one.
    const d = deriveAnalysisFreshness([], HASH);
    expect(d.freshness).toBe('none');
    expect(d.reason).toBe('no_successful_run_analysis_fact');
  });

  it('a DEGRADED read with no facts is "unknown / derivation_failed", never "none"', () => {
    const d = deriveAnalysisFreshness([], HASH, null, { priorFactsReadOk: false });
    expect(d.freshness).toBe('unknown');
    expect(d.reason).toBe('derivation_failed');
  });

  it('a degraded read does NOT erase a fact that was actually read', () => {
    // Bounds the change: the flag only speaks to the ABSENCE of facts. If a
    // fact came back, it is authoritative and the hash comparison decides —
    // a degraded flag must not blank out a good analysis. (This is the arm
    // that stops the fix from becoming a fail-closed sledgehammer.)
    const d = deriveAnalysisFreshness([runAnalysisFact(HASH)], HASH, null, {
      priorFactsReadOk: false,
    });
    expect(d.freshness).toBe('fresh');
    expect(d.reason).toBe('graph_hash_match');
  });

  it('the degraded verdict carries the current hash for provenance', () => {
    // The derivation's own contract: `current_graph_hash` is provenance, not a
    // verdict input, and must survive the new branch like every other.
    const d = deriveAnalysisFreshness([], HASH, null, { priorFactsReadOk: false });
    expect(d.current_graph_hash).toBe(HASH);
    expect(d.graph_hash_at_run).toBeNull();
    expect(d.selected_fact_index).toBeNull();
  });
});
