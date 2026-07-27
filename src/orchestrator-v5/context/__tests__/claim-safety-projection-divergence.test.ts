/**
 * F1 — THE PERMISSION AND THE CONTENT IT GOVERNS DESCRIBED DIFFERENT ANALYSES.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE DEFECT, AS THE COMPOSITION OF TWO CORRECT DECISIONS — AGAIN.
 *
 * #730 split the selectors, correctly: ENTITLEMENT ("did an analysis make a
 * claim, and did its verdict withhold?") must not be answered with a QUALITY
 * filter that deletes `partial` facts from the input. That fix is right and
 * this file does not undo it.
 *
 * But the split left the two questions answered by DIFFERENT FACTS, and only
 * one of them governs what the turn actually shows:
 *
 *   permission : `selectClaimBearingRunAnalysisFact`  → newest fact, ANY status
 *   content    : `selectRunAnalysisFact`              → newest SUCCESSFUL fact
 *                (`analysis-fallback.ts:510`, the one `buildAnalysisFromPriorFacts` uses)
 *
 * On a scenario carrying
 *
 *   A = newest SUCCESSFUL fact, verdict WITHHELD   (e.g. a ratified constraint
 *       PLoT never scored that run ⇒ `unevaluated`)
 *   B = a NEWER `partial` fact, verdict PERMITTED
 *
 * the permission read B and said `true`, while every content channel the turn
 * has — `display_analysis`, the raw `analysis` slot, the deterministic advice
 * composers — was built from A. The pack shipped A's withheld leader through
 * the model-input chokepoint UNPROJECTED, and the Layer-3 egress alarm was
 * armed with `true`, so a leaked leader did not even count.
 *
 * ⚠ REACHABILITY IS NOT HYPOTHETICAL. The constraint verdict is derived by
 * `deriveConstraintVerdict(response, ratifiedConstraints, leadingOptionId)`
 * (`tools/handlers/run-analysis.ts:837`) — `analysis_status` is NOT one of its
 * inputs. Verdict and status are orthogonal, the handler accepts and persists a
 * `partial` analysis (permissive accept matrix), and #731's own reachability
 * note calls partial+permitted "exactly the state #730 made visible".
 *
 * ⚠ AND #730 PINNED THIS STATE AS CORRECT. Its
 * `CONVERSE: a newer PARTIAL that PERMITS is honoured over an older withheld
 * one` test (claim-safety-entitlement-selector.test.ts) uses EXACTLY the A/B
 * fixture above and asserts `true`. The assertion was right about entitlement
 * and blind to content; it is corrected there, with a pointer here.
 *
 * THE FIX: the permission is the CONJUNCTION of the entitlement fact's verdict
 * and — when a DIFFERENT fact is what the turn can actually display — that
 * fact's own verdict. One-directional (`true → false` only), and provably a
 * no-op whenever the two selectors pick the same fact, which is every
 * non-divergent scenario.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';

import type { HandlerFact } from '@talchain/schemas/orchestrator';

import {
  readMayNameLeadingOptionVerdict,
  type ClaimSafetyScenarioScope,
} from '../claim-safety-read.js';
import { buildAnalysisFromPriorFacts } from '../analysis-fallback.js';
import { selectClaimBearingRunAnalysisFact, selectRunAnalysisFact } from '../freshness.js';

const ARRAY_ONLY: ClaimSafetyScenarioScope = {
  newestAnalysisFact: null,
  readOk: true,
  windowTruncated: false,
};

const WITHHELD = { may_name_leading_option: false, constraint_verdict_state: 'unevaluated' };
const PERMITTED = {
  may_name_leading_option: true,
  constraint_verdict_state: 'evaluated_feasible',
};

/**
 * A persisted run_analysis fact carrying enough enrichment for
 * `buildAnalysisFromPriorFacts` to project a real winner — which is what makes
 * this file able to say WHICH fact grounded the content, rather than only which
 * fact grounded the boolean.
 */
function analysisFact(opts: {
  readonly status: string;
  readonly computed_at: string;
  readonly verdict: { may_name_leading_option: boolean; constraint_verdict_state: string } | null;
  readonly leader: 'opt_a' | 'opt_b';
  readonly leaderProbability: number;
}): HandlerFact {
  const other = opts.leader === 'opt_a' ? 'opt_b' : 'opt_a';
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: 's',
      leading_option_id: opts.leader,
      summary: 'x',
      graph_hash_at_run: 'h',
      computed_at: opts.computed_at,
      win_probabilities: {
        [opts.leader]: opts.leaderProbability,
        [other]: 1 - opts.leaderProbability,
      },
      ...(opts.verdict === null ? {} : { constraint_verdict: opts.verdict }),
      enrichment: {
        analysis_status: opts.status,
        option_comparison: [
          {
            option_id: opts.leader,
            option_label: opts.leader === 'opt_a' ? 'Option A' : 'Option B',
            win_probability: opts.leaderProbability,
            outcome_mean: 0.5,
          },
          {
            option_id: other,
            option_label: other === 'opt_a' ? 'Option A' : 'Option B',
            win_probability: 1 - opts.leaderProbability,
            outcome_mean: 0.3,
          },
        ],
      },
    },
  } as unknown as HandlerFact;
}

/** A = the newest SUCCESSFUL analysis, and it WITHHELD the leader claim. */
const FACT_A_SUCCESSFUL_WITHHELD = analysisFact({
  status: 'completed',
  computed_at: '2026-07-01T00:00:00.000Z',
  verdict: WITHHELD,
  leader: 'opt_a',
  leaderProbability: 0.72,
});

/** B = a NEWER `partial` analysis, and its own verdict PERMITTED. */
const FACT_B_PARTIAL_PERMITTED = analysisFact({
  status: 'partial',
  computed_at: '2026-07-03T00:00:00.000Z',
  verdict: PERMITTED,
  leader: 'opt_b',
  leaderProbability: 0.66,
});

/** Newest-first, the order `readRecent` delivers. */
const DIVERGENT_FACTS: readonly HandlerFact[] = [
  FACT_B_PARTIAL_PERMITTED,
  FACT_A_SUCCESSFUL_WITHHELD,
];

describe('F1 — a withheld analysis must not be displayed under a newer fact’s permission', () => {
  // ── INSTRUMENT FIRST (TESTING-DISCIPLINE rule 2) ──────────────────────────
  it('INSTRUMENT: the two selectors really do pick DIFFERENT facts on this input', () => {
    // The premise of the whole finding, asserted rather than assumed. If the
    // selectors ever converge, every assertion below stops measuring what it
    // claims to and this goes red first.
    const entitlement = selectClaimBearingRunAnalysisFact(DIVERGENT_FACTS);
    const projected = selectRunAnalysisFact(DIVERGENT_FACTS);
    expect(entitlement?.fact).toBe(FACT_B_PARTIAL_PERMITTED);
    expect(projected?.fact).toBe(FACT_A_SUCCESSFUL_WITHHELD);
    expect(
      entitlement?.fact,
      'divergence is the precondition of this defect — same fact means no defect',
    ).not.toBe(projected?.fact);
  });

  it('INSTRUMENT: the projected CONTENT really is built from the WITHHELD fact', () => {
    // `buildAnalysisFromPriorFacts` is what fills `contextPack.analysis` and,
    // through it, the model-facing `display_analysis`. It selects with the
    // QUALITY selector, so on this input it grounds the turn in A.
    //
    // The two facts name DIFFERENT leaders on purpose: `opt_a` at 72% is A's
    // claim, `opt_b` at 66% is B's. Reading `opt_a` back proves the content
    // came from the fact whose verdict WITHHELD it — not merely that some
    // content exists.
    const projected = buildAnalysisFromPriorFacts(DIVERGENT_FACTS, undefined);
    expect(projected).not.toBeNull();
    expect(projected!.winner.option_id).toBe('opt_a');
    expect(projected!.winner.win_probability).toBe(0.72);
  });

  // ── THE DEFECT ────────────────────────────────────────────────────────────
  it('RED-FIRST: the permission is FALSE when the DISPLAYED analysis withheld', () => {
    // Pre-fix this returned `{ may_name_leading_option: true, provenance:
    // 'scenario_fact' }` — read off B — while every content channel carried A's
    // leader. The model-input chokepoint (`turn-executor.ts:2208`) keys on this
    // boolean, so the pack shipped A's withheld leader UNPROJECTED, and the
    // Layer-3 alarm was armed with `true` and stayed silent on the leak.
    const v = readMayNameLeadingOptionVerdict(DIVERGENT_FACTS, ARRAY_ONLY);
    expect(
      v.may_name_leading_option,
      'the turn can only name the leader it can display, and that analysis withheld it',
    ).toBe(false);
  });

  it('RED-FIRST: the provenance SAYS the narrowing happened — it is not a silent false', () => {
    // #726 and #730 both bought discriminators because two different answers
    // were the same wire byte. Folding this narrowing into `scenario_fact`
    // would rebuild that: a triager reading `_diagnostic_trace.claim_safety`
    // could not tell "the newest claim withheld" from "the newest claim
    // permitted but the displayable analysis withheld", and those need
    // different fixes.
    const v = readMayNameLeadingOptionVerdict(DIVERGENT_FACTS, ARRAY_ONLY);
    expect(v.provenance).toBe('fail_closed_projected_analysis');
  });

  it('RED-FIRST: the disclosed CAUSE is the DISPLAYED fact’s state, not the entitling fact’s', () => {
    // The state feeds the withheld-leader note the model is handed. B's state
    // is `evaluated_feasible` — reporting it beside a withhold would explain
    // the withhold with the reason it did NOT happen, which is #730's own P2
    // ("withheld correctly and explained the wrong reason") in a new place.
    const v = readMayNameLeadingOptionVerdict(DIVERGENT_FACTS, ARRAY_ONLY);
    expect(v.constraint_verdict_state).toBe('unevaluated');
  });

  it('ORDER-INDEPENDENT: the array order cannot change the answer', () => {
    // The selectors order by content (`computed_at` desc), so a store that
    // returned these rows oldest-first must reach the same verdict. A fix that
    // depended on insertion order would be a coin flip in production.
    const v = readMayNameLeadingOptionVerdict(
      [FACT_A_SUCCESSFUL_WITHHELD, FACT_B_PARTIAL_PERMITTED],
      ARRAY_ONLY,
    );
    expect(v.may_name_leading_option).toBe(false);
    expect(v.provenance).toBe('fail_closed_projected_analysis');
  });

  it('the UNSTAMPED displayed fact narrows too (the fail-closed default still reaches here)', () => {
    // A pre-#710 row carries no verdict at all and there is no migration, so
    // this is the largest class the default fires on. The narrowing must read
    // the same fail-closed default the entitlement path does, or the biggest
    // real-world population of A-facts would slip through the new gate.
    const unstampedA = analysisFact({
      status: 'completed',
      computed_at: '2026-07-01T00:00:00.000Z',
      verdict: null,
      leader: 'opt_a',
      leaderProbability: 0.72,
    });
    const v = readMayNameLeadingOptionVerdict([FACT_B_PARTIAL_PERMITTED, unstampedA], ARRAY_ONLY);
    expect(v.may_name_leading_option).toBe(false);
    expect(v.provenance).toBe('fail_closed_projected_analysis');
    expect(v.constraint_verdict_state, 'nothing was recorded, so nothing is invented').toBeNull();
  });

  // ── OVER-SUPPRESSION CONTROLS ─────────────────────────────────────────────
  //
  // Weighted equally with the leak. #730's CONVERSE test existed to stop its
  // fix degenerating into a blanket withhold; that purpose is preserved here,
  // by controls that isolate the ONE thing this change is allowed to move.

  it('CONTROL: a newer partial that permits, with NO displayable analysis, still permits', () => {
    // #730's rule survives intact wherever it actually applies. There is no
    // successful fact, so `selectRunAnalysisFact` returns null, there is no
    // second conjunct, and the newest claim-bearing fact governs alone —
    // exactly as #730 ruled. If this goes red the fix HAS degenerated into
    // "withhold always wins".
    const v = readMayNameLeadingOptionVerdict([FACT_B_PARTIAL_PERMITTED], ARRAY_ONLY);
    expect(v.may_name_leading_option).toBe(true);
    expect(v.provenance).toBe('scenario_fact');
    expect(v.constraint_verdict_state).toBe('evaluated_feasible');
  });

  it('CONTROL: a newer partial that permits over an older PERMITTED success still permits', () => {
    // Divergence alone must not withhold. The two selectors pick different
    // facts here too — and both facts permit, so nothing may move. A fix that
    // withheld on divergence RATHER than on the displayed verdict passes every
    // RED test above and fails this one.
    const olderPermitted = analysisFact({
      status: 'completed',
      computed_at: '2026-07-01T00:00:00.000Z',
      verdict: PERMITTED,
      leader: 'opt_a',
      leaderProbability: 0.72,
    });
    expect(selectRunAnalysisFact([FACT_B_PARTIAL_PERMITTED, olderPermitted])?.fact).toBe(
      olderPermitted,
    );
    const v = readMayNameLeadingOptionVerdict(
      [FACT_B_PARTIAL_PERMITTED, olderPermitted],
      ARRAY_ONLY,
    );
    expect(v.may_name_leading_option).toBe(true);
    expect(v.provenance).toBe('scenario_fact');
  });

  it('CONTROL: NO DIVERGENCE is byte-identical — one fact, both selectors, unchanged', () => {
    // The overwhelmingly common shape. Both selectors pick the same fact, the
    // conjunction is the identity, and both verdicts must read exactly as they
    // did before this change.
    const permittedOnly = analysisFact({
      status: 'completed',
      computed_at: '2026-07-01T00:00:00.000Z',
      verdict: PERMITTED,
      leader: 'opt_a',
      leaderProbability: 0.72,
    });
    expect(readMayNameLeadingOptionVerdict([permittedOnly], ARRAY_ONLY)).toEqual({
      may_name_leading_option: true,
      constraint_verdict_state: 'evaluated_feasible',
      provenance: 'scenario_fact',
    });
    expect(readMayNameLeadingOptionVerdict([FACT_A_SUCCESSFUL_WITHHELD], ARRAY_ONLY)).toEqual({
      may_name_leading_option: false,
      constraint_verdict_state: 'unevaluated',
      provenance: 'scenario_fact',
    });
  });

  it('CONTROL: the honest `no_analysis_exists` true is still reachable', () => {
    // If the narrowing ever fired on an empty array the fail-closed default's
    // cost would move from content to correctness — a scenario with no
    // analysis has nothing to withhold.
    expect(readMayNameLeadingOptionVerdict([], ARRAY_ONLY)).toEqual({
      may_name_leading_option: true,
      constraint_verdict_state: null,
      provenance: 'no_analysis_exists',
    });
  });

  it('CONTROL: the FRESHNESS selector is not loosened to buy this fix', () => {
    // The other way to make the RED tests green is to let the quality selector
    // see `partial`, which would have every freshness consumer building result
    // views from partial analyses. Asserted, not assumed.
    expect(selectRunAnalysisFact([FACT_B_PARTIAL_PERMITTED])).toBeNull();
  });
});
