/**
 * ⛔⛔ `none` AND `unknown` ARE DIFFERENT ANSWERS, AND FEEDING A DEGRADED READ'S
 * EMPTY ARRAY TO THE DERIVATION PUBLISHES A FALSE ABSENCE.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 * #63 item 15 made `dispatchFactorValueEdit` report freshness. It required switching
 * that writer off `loadPriorFactsQuietly`, which returns a bare array and DISCARDS
 * the read state. I merged it and said in the verdict that it had **no
 * discriminating control**. This supplies the half that can be proven behaviourally.
 *
 * ── THE HAZARD, DEMONSTRATED RATHER THAN DESCRIBED ──────────────────────────
 * The claim I shipped was: "with `loadPriorFactsQuietly`, a degraded read would have
 * reported `none` — an absence that was never observed, published as an observed
 * absence." That is a claim about what `deriveAnalysisFreshness` does when handed the
 * empty array a discarded read state leaves behind. It is directly testable, and
 * until now nothing tested it.
 *
 * `none` means "we looked and there is no run". `unknown` means "we could not look".
 * A surface that clears a "stale" mark on `none` but holds it on `unknown` behaves
 * differently for the user, so collapsing them is a product defect, not a wording one.
 *
 * ⚠ SCOPE, STATED PLAINLY. This proves the DERIVATION's verdicts and the hazard the
 * empty array creates. It does NOT exercise `dispatchFactorValueEdit`'s own
 * ok/degraded branch — that seam is heavily store-dependent and my attempt to mock it
 * ended in fixture-fitting rather than evidence. That branch's WIRING is held by
 * `anti-rederivation-callsite-pin.test.ts` (which counts the call sites and forced a
 * reasoned bump when item 15 added one); its BEHAVIOUR is still uncovered and I am
 * recording that rather than implying otherwise.
 */
import { describe, expect, it } from 'vitest';
import { deriveAnalysisFreshness } from '../freshness.js';
import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

const HASH = '9f2c1b0ae4d37c5a';
const OTHER_HASH = '1111111111111111';

/**
 * ⚠ THE FACT SHAPE IS COPIED FROM `tests/contract/analysis-freshness.test.ts`, NOT
 * INVENTED. My first version guessed `{kind, status, graph_hash}` and the selector
 * silently declined it, so all three verdict tests returned `none` and would have
 * "passed" any assertion that merely expected a non-`unknown` answer. A self-authored
 * fixture is not evidence; this one matches the shape the existing contract suite
 * already exercises (`fact_type`, `fact_version`, `noop: false`, and the hash and
 * timestamp inside `result`).
 */
function runFact(graphHash: string): RunAnalysisHandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      leading_option_id: 'opt_a',
      summary: 'Ran analysis on your current scenario.',
      enrichment: { analysis_status: 'computed' },
      graph_hash_at_run: graphHash,
      computed_at: '2026-09-24T12:00:00.000Z',
    },
  } as RunAnalysisHandlerFact;
}

/** ⭐ The premise: the fixture must actually be RECOGNISED, or every verdict is `none`. */
function isRecognised(f: RunAnalysisHandlerFact): boolean {
  return deriveAnalysisFreshness([f], HASH).freshness !== 'none';
}

describe('deriveAnalysisFreshness — the verdicts are distinct, and an empty array is NOT "unknown"', () => {
  it('⛔⛔ THE HAZARD: an EMPTY fact array yields `none`, so a discarded read state publishes a false absence', () => {
    // This is the counterfactual behind item 15's switch off `loadPriorFactsQuietly`.
    // That loader returns a bare `[]` for BOTH a healthy-empty read and a DEGRADED
    // one. Handed that `[]`, the derivation cannot tell them apart and answers `none` —
    // "we looked and there is no run" — for a read that never happened.
    const d = deriveAnalysisFreshness([], HASH);
    expect(d.freshness).toBe('none');
    expect(d.reason).toBe('no_successful_run_analysis_fact');
    // ⭐ The point: it does NOT answer `unknown`. The caller is the only place that
    // can know the difference, which is why the read state must reach it.
    expect(d.freshness).not.toBe('unknown');
  });

  it('⭐⭐ PREMISE: the fixture is RECOGNISED by the selector', () => {
    // Without this, a shape the selector declines makes every verdict below `none`
    // and each test still reads as passing something. That is exactly what my first
    // fixture did.
    expect(isRecognised(runFact(HASH)), 'the fact shape is not recognised — verdicts are vacuous').toBe(true);
  });

  it('⭐ a run against the CURRENT hash is `fresh`', () => {
    const d = deriveAnalysisFreshness([runFact(HASH)], HASH);
    expect(d.freshness).toBe('fresh');
  });

  it('⭐ a run against a DIFFERENT hash is `stale`', () => {
    const d = deriveAnalysisFreshness([runFact(OTHER_HASH)], HASH);
    expect(d.freshness).toBe('stale');
  });

  it('⭐ all three verdicts are genuinely DISTINCT — the sweep is not vacuous', () => {
    // Without this the three assertions above could all be satisfied by a function
    // that returned one constant, and each test would still read as passing.
    const verdicts = new Set([
      deriveAnalysisFreshness([], HASH).freshness,
      deriveAnalysisFreshness([runFact(HASH)], HASH).freshness,
      deriveAnalysisFreshness([runFact(OTHER_HASH)], HASH).freshness,
    ]);
    expect(verdicts.size).toBe(3);
    expect(verdicts.has('unknown')).toBe(false);
  });

  it('⚠ an unavailable CURRENT hash is reported as such, not as freshness', () => {
    // A null current hash means the comparison could not be made. It must not be
    // silently read as "the analysis is fine" — the same class of error as `none`
    // standing in for `unknown`.
    const d = deriveAnalysisFreshness([runFact(HASH)], null);
    expect(d.freshness).not.toBe('fresh');
  });
});
