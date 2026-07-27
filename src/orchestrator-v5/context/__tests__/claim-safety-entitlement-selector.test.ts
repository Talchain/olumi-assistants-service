/**
 * P0 — A QUALITY SELECTOR WAS BEING USED AS AN ENTITLEMENT SELECTOR.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE FAIL-OPEN, stated as the two independently-correct decisions that
 * combined into a wrong one. Neither component is buggy in isolation, which is
 * exactly why this survived review.
 *
 *   1. `selectRunAnalysisFact` (context/freshness.ts) answers a FRESHNESS
 *      question: "which analysis is good enough to build a result view from?"
 *      Its eligibility filter therefore excludes `partial`, `blocked`,
 *      `failed`, `degraded` — and, deliberately, any FUTURE PLoT status it does
 *      not recognise. Correct for freshness.
 *   2. The run_analysis handler ACCEPTS a `partial` analysis, persists it, and
 *      may name a leading option from it (permissive accept matrix, resilience
 *      contract Part C). Also correct.
 *
 * Composed: a `partial` fact that WITHHELD the leader claim is invisible to the
 * claim-safety read, which then takes its `no analysis exists ⇒ true` branch —
 * the HONEST true, whose entire justification is "no claim can be grounded, so
 * nothing can leak". On this input that premise is false: a claim was grounded,
 * it was withheld, and the permission says `true`.
 *
 * The default is not fail-open. The SELECTOR made the default unreachable.
 *
 * ⚠ AND THE FORWARD-COMPATIBILITY CLAUSE MAKES IT WORSE, NOT BETTER. The filter
 * excludes unrecognised statuses so that a new PLoT status cannot be mistaken
 * for success — safe for freshness, and the exact opposite of safe here: the
 * day PLoT ships a new status string, every fact carrying it becomes entitled
 * to name a leader. A silent, upstream-triggered fail-open with no CEE deploy.
 *
 * THE FIX: entitlement is selected INDEPENDENTLY of quality. Any fact that can
 * bear a claim is claim-bearing regardless of its analysis_status; if a fact
 * exists but its verdict cannot be interpreted we FAIL CLOSED with an honest
 * provenance, and `no_analysis_exists` is reserved for genuinely empty
 * scenarios. Freshness keeps its own selector, unchanged — the two questions
 * get two selectors ON PURPOSE, which is not the same as the second-derivation
 * defect: they answer DIFFERENT questions and now say so.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';

import type { HandlerFact } from '@talchain/schemas/orchestrator';

import {
  readMayNameLeadingOptionVerdict,
  type ClaimSafetyScenarioScope,
} from '../claim-safety-read.js';
import { selectClaimBearingRunAnalysisFact, selectRunAnalysisFact } from '../freshness.js';

const base = {
  scenario_id: 's',
  summary: 'x',
  leading_option_id: 'opt_a',
  graph_hash_at_run: 'h',
};

/** A persisted run_analysis fact with an explicit status and verdict. */
const fact = (opts: {
  status?: string;
  computed_at?: string;
  verdict?: { may_name_leading_option: boolean; constraint_verdict_state: string } | null;
}): HandlerFact =>
  ({
    fact_type: 'run_analysis',
    noop: false,
    result: {
      ...base,
      computed_at: opts.computed_at ?? '2026-07-02T00:00:00.000Z',
      enrichment: {
        ...(opts.status === undefined ? {} : { analysis_status: opts.status }),
      },
      ...(opts.verdict == null ? {} : { constraint_verdict: opts.verdict }),
    },
  }) as unknown as HandlerFact;

const WITHHELD = { may_name_leading_option: false, constraint_verdict_state: 'unevaluated' };
const PERMITTED = { may_name_leading_option: true, constraint_verdict_state: 'evaluated_feasible' };

const ARRAY_ONLY: ClaimSafetyScenarioScope = {
  newestAnalysisFact: null,
  readOk: true,
  windowTruncated: false,
};

describe('P0 REPRO: a withheld PARTIAL analysis must not be entitled to name a leader', () => {
  it('INSTRUMENT: the freshness selector really does reject these facts', () => {
    // The premise of the whole P0, asserted rather than assumed. If this ever
    // goes green-by-acceptance, the repro below stops testing what it claims.
    expect(selectRunAnalysisFact([fact({ status: 'partial', verdict: WITHHELD })])).toBeNull();
    expect(
      selectRunAnalysisFact([fact({ status: 'a_future_plot_status', verdict: WITHHELD })]),
    ).toBeNull();
    // …and it ACCEPTS a completed one, so the rejection above is about status.
    expect(selectRunAnalysisFact([fact({ status: 'completed', verdict: WITHHELD })])).not.toBeNull();
  });

  it('RED-FIRST: a `partial` fact carrying may_name_leading_option:false yields FALSE', () => {
    // Pre-fix this returned `{ may_name_leading_option: true, provenance:
    // 'no_analysis_exists' }` — the product asserting it may name a leader on a
    // scenario whose only analysis explicitly withheld one.
    const v = readMayNameLeadingOptionVerdict([fact({ status: 'partial', verdict: WITHHELD })], ARRAY_ONLY);
    expect(v.may_name_leading_option).toBe(false);
    expect(
      v.provenance,
      'a fact WAS selected, so the provenance must say so — `no_analysis_exists` on an input ' +
        'that contains an analysis is the false premise this P0 is made of',
    ).toBe('scenario_fact');
    expect(v.constraint_verdict_state).toBe('unevaluated');
  });

  it('RED-FIRST: an UNKNOWN/forward-compatible status behaves identically', () => {
    // The clause that makes this upstream-triggerable: the day PLoT ships a new
    // status string, the pre-fix code entitled every fact carrying it.
    const v = readMayNameLeadingOptionVerdict(
      [fact({ status: 'a_future_plot_status', verdict: WITHHELD })],
      ARRAY_ONLY,
    );
    expect(v.may_name_leading_option).toBe(false);
    expect(v.provenance).toBe('scenario_fact');
  });

  it('a claim-bearing PARTIAL fact with NO verdict stamp fails CLOSED', () => {
    // The unstamped case, on a status the entitlement selector now sees. "A
    // fact exists but carries no verdict" withholds via the reader's own
    // fail-closed branch — and pre-fix this input never reached that branch at
    // all, because the quality filter removed the fact first.
    const v = readMayNameLeadingOptionVerdict([fact({ status: 'partial', verdict: null })], ARRAY_ONLY);
    expect(v.may_name_leading_option).toBe(false);
    expect(v.provenance).toBe('scenario_fact');
    expect(v.constraint_verdict_state, 'nothing was recorded, so nothing is invented').toBeNull();
  });

  it('DECLARED UNREACHABLE: the `fail_closed_uninterpretable` guard cannot be exercised today', () => {
    // ⚠ STATED RATHER THAN PROVEN, because I could not prove it and will not
    // imply otherwise. The fix replaced a branch that returned `true` for a
    // selection whose `fact_type` is not `run_analysis` with one that withholds
    // under `fail_closed_uninterpretable`. A mutation that reverts it to the
    // old fail-open passes every test in this file — because the branch is
    // UNREACHABLE BY CONSTRUCTION: `viewRunAnalysisFact` calls
    // `isRunAnalysisFact` before admitting a candidate, so the selector cannot
    // return anything else.
    //
    // So this is a defensive guard whose only value is DIRECTION: if the
    // selector's contract ever changes, the failure is a withhold rather than
    // an entitlement. It is not covered, it is not claimed to be covered, and
    // the assertion below pins the reachability premise instead — if the
    // selector ever starts returning a non-run_analysis fact, this goes red and
    // the guard needs real tests.
    const notAnAnalysis = { fact_type: 'edit_graph', noop: false, result: {} } as unknown as HandlerFact;
    expect(
      selectClaimBearingRunAnalysisFact([notAnAnalysis]),
      'the entitlement selector admitted a non-run_analysis fact — the `fail_closed_' +
        'uninterpretable` branch is now REACHABLE and needs its own coverage',
    ).toBeNull();
  });

  it('THE SHADOW CASE: a newer PARTIAL does not resurrect an older COMPLETE permission', () => {
    // `supabase-store.ts` returns only the newest non-noop scenario fact, so a
    // partial fact can SHADOW an older complete one.
    //
    // ⭐ THE RULING, and it is derived rather than inherited: the newest
    // CLAIM-BEARING fact governs. A partial analysis is still an analysis —
    // the handler accepted it, persisted it, and may name a leader from it — so
    // it is the current claim, and its verdict is the current entitlement.
    //
    // The alternative ("skip the partial, let the older complete fact's
    // permission stand") is REJECTED, and not on taste: it would let a NEWER
    // withheld verdict be overridden by an OLDER permitted one, which is a
    // `false -> true` move. #726's one-directionality argument exists to forbid
    // exactly that direction, and nothing about a status string earns an
    // exception to it.
    const olderComplete = fact({
      status: 'completed',
      computed_at: '2026-07-01T00:00:00.000Z',
      verdict: PERMITTED,
    });
    const newerPartial = fact({
      status: 'partial',
      computed_at: '2026-07-03T00:00:00.000Z',
      verdict: WITHHELD,
    });
    for (const facts of [
      [olderComplete, newerPartial],
      [newerPartial, olderComplete],
    ]) {
      const v = readMayNameLeadingOptionVerdict(facts, ARRAY_ONLY);
      expect(
        v.may_name_leading_option,
        'the newest CLAIM-BEARING fact governs; an older permitted verdict must not shadow a ' +
          'newer withheld one',
      ).toBe(false);
      expect(v.constraint_verdict_state).toBe('unevaluated');
    }
  });

  it('CONVERSE: a newer PARTIAL that PERMITS is honoured — WHEN NOTHING ELSE IS DISPLAYED', () => {
    // ⚠ CORRECTED BY F1, AND THE ORIGINAL VERSION OF THIS TEST WAS PINNING THE
    // DEFECT. It used a two-fact fixture — an OLDER `completed` fact that
    // WITHHELD plus a NEWER `partial` that PERMITTED — and asserted `true`.
    //
    // That assertion was right about ENTITLEMENT and blind to CONTENT. On
    // exactly that input, `selectRunAnalysisFact` (the QUALITY selector, the
    // one `buildAnalysisFromPriorFacts` uses) rejects the partial and projects
    // the OLDER fact into `contextPack.analysis` and `display_analysis`. So the
    // `true` this test pinned entitled the turn to name a leader that could
    // only ever be the WITHHELD fact's leader — the partial's content is never
    // displayed. The model-input chokepoint keys on this boolean, so the pack
    // shipped unprojected and the egress alarm was armed to ignore it.
    //
    // The divergence fixture and its full derivation now live in
    // `claim-safety-projection-divergence.test.ts`, which asserts `false` and
    // `fail_closed_projected_analysis` on it.
    //
    // ⭐ #730'S RULING IS NOT REVERTED, AND THIS TEST STILL DEFENDS IT. The
    // rule is still "newest claim-bearing fact", not "withhold wins" — it is
    // now conjoined with the verdict of the fact the turn can actually SHOW.
    // Strip the older fact and there is nothing else to show: the quality
    // selector returns null, there is no second conjunct, and the newer
    // permitting partial governs alone. That is the property this test exists
    // to protect, isolated from the property it was accidentally also
    // asserting, and it is the arm that goes red if F1's fix ever degenerates
    // into a blanket withhold.
    const newerPartialPermitted = fact({
      status: 'partial',
      computed_at: '2026-07-03T00:00:00.000Z',
      verdict: PERMITTED,
    });
    // The premise, asserted rather than assumed: there is no displayable
    // analysis here, which is what makes the entitlement fact govern alone.
    expect(selectRunAnalysisFact([newerPartialPermitted])).toBeNull();

    const v = readMayNameLeadingOptionVerdict([newerPartialPermitted], ARRAY_ONLY);
    expect(v.may_name_leading_option).toBe(true);
    expect(v.provenance).toBe('scenario_fact');
    expect(v.constraint_verdict_state).toBe('evaluated_feasible');

    // …and the same, with an older fact present that ALSO permits. Divergence
    // between the two selectors is not by itself a reason to withhold; only a
    // withholding DISPLAYED fact is. Without this, F1's fix could have been
    // "withhold on divergence" and still passed everything above.
    const olderPermitted = fact({
      status: 'completed',
      computed_at: '2026-07-01T00:00:00.000Z',
      verdict: PERMITTED,
    });
    const both = readMayNameLeadingOptionVerdict(
      [olderPermitted, newerPartialPermitted],
      ARRAY_ONLY,
    );
    expect(both.may_name_leading_option).toBe(true);
    expect(both.provenance).toBe('scenario_fact');
  });

  // ── POSITIVE CONTROLS ─────────────────────────────────────────────────────

  it('POSITIVE CONTROL: a genuinely EMPTY scenario still returns the honest true', () => {
    // `no_analysis_exists` must keep meaning what it says. If the fix made
    // everything withhold, the honest-true branch would be dead and the cost of
    // the fail-closed default would move from content to correctness.
    const v = readMayNameLeadingOptionVerdict([], ARRAY_ONLY);
    expect(v).toEqual({
      may_name_leading_option: true,
      constraint_verdict_state: null,
      provenance: 'no_analysis_exists',
    });
  });

  it('POSITIVE CONTROL: COMPLETED-status behaviour is byte-identical to pre-fix', () => {
    const permitted = readMayNameLeadingOptionVerdict(
      [fact({ status: 'completed', verdict: PERMITTED })],
      ARRAY_ONLY,
    );
    expect(permitted.may_name_leading_option).toBe(true);
    expect(permitted.provenance).toBe('scenario_fact');

    const withheld = readMayNameLeadingOptionVerdict(
      [fact({ status: 'completed', verdict: WITHHELD })],
      ARRAY_ONLY,
    );
    expect(withheld.may_name_leading_option).toBe(false);
    expect(withheld.provenance).toBe('scenario_fact');

    // A legacy fact with NO status at all was always eligible and stays so.
    const legacy = readMayNameLeadingOptionVerdict([fact({ verdict: WITHHELD })], ARRAY_ONLY);
    expect(legacy.may_name_leading_option).toBe(false);
  });

  it('POSITIVE CONTROL: the FRESHNESS selector is untouched by this change', () => {
    // The two questions now have two selectors on purpose. This asserts the
    // quality filter still rejects a partial fact — if the fix had "solved" the
    // P0 by loosening `selectRunAnalysisFact`, every freshness consumer would
    // silently start building result views from partial analyses.
    expect(selectRunAnalysisFact([fact({ status: 'partial', verdict: WITHHELD })])).toBeNull();
    expect(selectRunAnalysisFact([fact({ status: 'degraded', verdict: WITHHELD })])).toBeNull();
  });
});
