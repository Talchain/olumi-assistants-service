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

  it('⭐ CONTROL: a WITHHOLDING fact in the window does NOT veto a newer permitted one', () => {
    // ═══════════════════════════════════════════════════════════════════════
    // THE PERMIT-WINS PIN, and the estate had NO such assertion until this one.
    //
    // Found by adversarial pre-merge review of F1. Before this test, NO test
    // anywhere asserted a TRUE verdict from `readMayNameLeadingOptionVerdict`
    // on a fact array that CONTAINS a withholding fact — #730's CONVERSE test
    // had been the only candidate, and F1's correction of it (rightly) removed
    // the withholding fact from its fixture. The gap is not academic: a future
    // "tighten the conjunction" change that conjoined over ALL facts in the
    // window — "any withheld analysis in this scenario's history vetoes the
    // claim" — would pass the ENTIRE suite while permanently over-suppressing
    // every scenario that ever had one unevaluated constraint. Proven: the
    // mutant M6 dies on this assertion and on nothing else.
    //
    // WHY TRUE IS THE RIGHT ANSWER HERE. Both selectors converge on the SAME
    // fact — the newer `completed` one that PERMITS. There is no divergence, so
    // F1's second conjunct is the identity, and #730's ruling governs alone:
    // the newest claim-bearing fact decides. History does not accumulate a
    // veto. An older withheld verdict describes an analysis the user is no
    // longer being shown, and re-running an analysis has to be able to CLEAR a
    // withhold — otherwise the withhold is permanent and the product can never
    // recover from one unevaluated constraint.
    //
    // The direction matters: this is the ONE assertion in the F1 suite whose
    // expected value is `true` on a multi-fact array. Every other arm here
    // proves the fix withholds. Without this one, "withhold more" is a free
    // move and nothing in the estate notices.
    // ═══════════════════════════════════════════════════════════════════════
    const newerPermitted = analysisFact({
      status: 'completed',
      computed_at: '2026-07-09T00:00:00.000Z',
      verdict: PERMITTED,
      leader: 'opt_b',
      leaderProbability: 0.81,
    });
    const facts = [newerPermitted, FACT_A_SUCCESSFUL_WITHHELD];

    // The premise, asserted rather than assumed: this is the CONVERGENT case.
    // If the two selectors ever disagreed on this input the test would be
    // measuring the divergence path and its `true` would be wrong.
    expect(selectClaimBearingRunAnalysisFact(facts)?.fact).toBe(newerPermitted);
    expect(selectRunAnalysisFact(facts)?.fact).toBe(newerPermitted);
    // …and the withholding fact really is in the array, or the pin is vacuous.
    expect(facts).toContain(FACT_A_SUCCESSFUL_WITHHELD);

    const v = readMayNameLeadingOptionVerdict(facts, ARRAY_ONLY);
    expect(
      v.may_name_leading_option,
      'an OLDER withheld fact must not veto the newest permitted analysis — a conjunction over ' +
        'ALL facts would over-suppress every scenario that ever recorded one withhold, and no ' +
        'other test in the estate can see that regression',
    ).toBe(true);
    expect(v.provenance).toBe('scenario_fact');
    expect(v.constraint_verdict_state).toBe('evaluated_feasible');
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

/**
 * THE WINDOW/SCENARIO INPUT ASYMMETRY — measured, not argued.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * F1's conjunction selects the DISPLAYED fact over `windowFacts ∪ {S}`, where
 * S is the scenario-scoped newest analysis fact #726 added. But the thing that
 * actually builds the displayed analysis — `buildAnalysisFromPriorFacts`, in
 * `turn-executor.ts:1876` — selects over the BARE WINDOW (`context.prior_facts`).
 * Two inputs, one claimed invariant.
 *
 * `claim-safety-read.ts` argues that gap is benign from loader properties. That
 * is a proof that expires silently the day the loader changes shape and nobody
 * re-reads the comment (CLAUDE.md trap 12b — a control whose reference is
 * "however the system currently behaves" has an expiry date nobody wrote down).
 * So both directions are pinned here as EXECUTED BEHAVIOUR, on inputs the
 * loader is not supposed to be able to produce. Every other divergence test in
 * this file uses the array-only scope; this is the missing arm.
 *
 * ⚠ AND MEASURING IT REFUTED HALF OF MY OWN CLAIM. The comment says the
 * asymmetry is unreachable "in the safe direction either way". The first half
 * holds — ARM A below fails CLOSED. The second half does NOT: ARM B is a
 * LEAK-direction residual, and it is characterised below rather than described
 * as safe. See the PR body; the fix is one word (`facts` → the bare window) and
 * is deliberately NOT taken here, because this branch is under merge review and
 * a production change belongs in a reviewed commit, not in a test amendment.
 * ═══════════════════════════════════════════════════════════════════════════
 */
describe('F1 — the window/scenario asymmetry, on inputs the loader should not produce', () => {
  /** S: a scenario-scoped fact reachable ONLY through the scope, never the window. */
  const scopeOf = (fact: HandlerFact | null): ClaimSafetyScenarioScope => ({
    newestAnalysisFact: fact,
    readOk: true,
    windowTruncated: false,
  });

  it('ARM A: a WITHHELD fact reachable only through the SCOPE still narrows — fail-CLOSED', () => {
    // The direction that matters, and the one worth having. The window holds
    // only the permitting `partial`, so the bare-window projection is `null` —
    // there is nothing displayed at all. The union nonetheless surfaces the
    // scenario's withheld successful analysis, and the conjunction withholds.
    //
    // Over-restrictive on this input, and that is the SAFE direction: a turn
    // that shows no analysis loses nothing by not naming a leader. What it buys
    // is the real case — a scenario whose withholding analysis has aged out of
    // the 20-turn window still narrows, which is exactly the decay #726 was
    // built to stop and which F1's conjunction would otherwise re-open.
    expect(
      buildAnalysisFromPriorFacts([FACT_B_PARTIAL_PERMITTED], undefined),
      'the bare window projects nothing here — that is what makes this the scope-only arm',
    ).toBeNull();

    const v = readMayNameLeadingOptionVerdict(
      [FACT_B_PARTIAL_PERMITTED],
      scopeOf(FACT_A_SUCCESSFUL_WITHHELD),
    );
    expect(v.may_name_leading_option).toBe(false);
    expect(v.provenance).toBe('fail_closed_projected_analysis');
    expect(v.constraint_verdict_state).toBe('unevaluated');
  });

  it('ARM B: CHARACTERISATION of the LEAK-direction residual — not a guarantee', () => {
    // ⚠ THIS TEST ASSERTS A LEAK, DELIBERATELY, AND SAYS SO. It is a
    // characterisation pin, not a blessing: it exists so the residual is
    // WRITTEN DOWN and executed, and so that any change to it — a fix, or a
    // widening — turns this red and forces a deliberate edit here.
    //
    // The input: the window holds the older WITHHELD successful fact A, and the
    // scope supplies a NEWER successful fact S that PERMITS. The union makes
    // both selectors converge on S, so the conjunction is the identity and the
    // verdict is `true` — while `buildAnalysisFromPriorFacts`, which sees only
    // the bare window, projects A's withheld leader. Permission and content
    // describe different analyses again, in the one input shape where the two
    // arrays disagree.
    //
    // WHY IT IS BELIEVED UNREACHABLE, stated as the premise it is so that it
    // can be checked rather than trusted: the window is the most recent N turns
    // and is therefore SUFFIX-CLOSED by recency, so if the window contains ANY
    // run_analysis fact then the scenario's NEWEST one is in it too — S is a
    // duplicate of a windowed fact, never a strictly newer stranger, and the
    // union is set-identical to the window. That argument rests on THREE
    // orderings agreeing: turn recency (which turns the window holds), the
    // store's `created_at DESC LIMIT 1` (which fact is S), and `computed_at`
    // (which fact the selectors pick). Nothing enforces their agreement. If any
    // of the three drifts, this input becomes producible and this test is the
    // record of what happens then.
    const S_NEWER_PERMITTED = analysisFact({
      status: 'completed',
      computed_at: '2026-07-05T00:00:00.000Z',
      verdict: PERMITTED,
      leader: 'opt_b',
      leaderProbability: 0.8,
    });

    // The premise of the characterisation: the bare window really does still
    // project the WITHHELD fact's leader. Without this the arm proves nothing.
    const displayed = buildAnalysisFromPriorFacts([FACT_A_SUCCESSFUL_WITHHELD], undefined);
    expect(displayed?.winner.option_id).toBe('opt_a');
    expect(displayed?.winner.win_probability).toBe(0.72);

    const v = readMayNameLeadingOptionVerdict(
      [FACT_A_SUCCESSFUL_WITHHELD],
      scopeOf(S_NEWER_PERMITTED),
    );
    expect(
      v.may_name_leading_option,
      'CHARACTERISATION, NOT A GUARANTEE: on this loader-impossible input the permission is ' +
        '`true` while the bare-window projection still carries the WITHHELD analysis’s leader. ' +
        'If you are reading this because the assertion went red, the residual has either been ' +
        'fixed (make it `false` and delete this paragraph) or widened (do not).',
    ).toBe(true);
    expect(v.provenance).toBe('scenario_fact');
  });

  it('CONTROL: with the scope EMPTY the same window is unchanged', () => {
    // Both arms above must be attributable to the scope member and to nothing
    // else in the fixture. Same window, `newestAnalysisFact: null`.
    expect(readMayNameLeadingOptionVerdict([FACT_B_PARTIAL_PERMITTED], scopeOf(null))).toEqual({
      may_name_leading_option: true,
      constraint_verdict_state: 'evaluated_feasible',
      provenance: 'scenario_fact',
    });
    expect(readMayNameLeadingOptionVerdict([FACT_A_SUCCESSFUL_WITHHELD], scopeOf(null))).toEqual({
      may_name_leading_option: false,
      constraint_verdict_state: 'unevaluated',
      provenance: 'scenario_fact',
    });
  });
});
