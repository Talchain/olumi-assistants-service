/**
 * ROADMAP 2.804 — the coaching slot's leader-claim permission.
 *
 * ## The defect this pins
 *
 * Two authorities answered "may this turn name the leading option?" and they
 * disagreed on a reachable class of run:
 *
 *   A — the handler-outcome channel. `run_analysis` set
 *       `__leading_option_claim_withheld` on its outcome when THIS RUN's
 *       constraint verdict withheld; `coaching-signals.ts` read it, absent
 *       meaning permitted. A per-run answer.
 *   B — the fact-chain verdict, `readMayNameLeadingOptionVerdict`. Since #737
 *       this is a CONJUNCTION: the entitling fact's verdict AND the DISPLAYED
 *       analysis's verdict (`narrowToProjectedAnalysis`). A turn-level,
 *       display-bound answer.
 *
 * A structurally cannot see B's second conjunct, because A never touches the
 * fact array. So on a turn where the two conjuncts disagree, A permitted while
 * B withheld — and the user saw a confirmation that withheld the leader with a
 * coaching sentence directly beneath it naming one. That is the G-CEE-1 harm
 * the whole subsystem exists to stop, reproduced at the coaching slot instead
 * of the headline slot.
 *
 * The fix: the coaching slot consumes B. A is deleted (it had exactly one
 * write and one read repo-wide, and ZERO test references — which is why this
 * file has to exist).
 *
 * ## Why a `computed`-only suite cannot see this
 *
 * `narrowToProjectedAnalysis` short-circuits whenever the two selectors return
 * the SAME fact. On every turn whose newest claim-bearing fact is also a
 * canonical success, A and B agree — so a suite built only from `computed`
 * fixtures agrees with itself 100% of the time while the defect is fully live.
 * That is exactly how it shipped: the divergence sat documented in a comment
 * in `turn-executor.ts` with no test anywhere.
 *
 * **Therefore every test below PINS ITS OWN PRECONDITION IN-TEST** (CLAUDE.md
 * trap 13b, third face): before asserting anything about coaching, it asserts
 * that the two selectors really do return DIFFERENT facts on this payload, and
 * that the two authorities really do give OPPOSITE answers. Without those
 * assertions a later tidy-up of the fixture builder silently reduces this file
 * to a tautology with no red anywhere.
 *
 * ## Binding
 *
 * Assertions bind by IDENTITY (trap 19): facts are compared with `toBe` on the
 * exact object, the signal id is the exact constant, and the copy is asserted
 * against the PRODUCTION text bank (`COACHING_TEXT`) rather than a paraphrase —
 * a paraphrase only proves the code agrees with the sentence the test author
 * wrote.
 */

import { describe, it, expect } from 'vitest';
import type { HandlerFact } from '@talchain/schemas/orchestrator';

import { applyCoachingSignal } from '../coaching-signal-application.js';
import { COACHING_TEXT } from '../../signals/coaching-signals.js';
import {
  readMayNameLeadingOptionVerdict,
  readMayNameLeadingOptionVerdictForFact,
  type ClaimSafetyScenarioScope,
} from '../../context/claim-safety-read.js';
import {
  isSuccessfulRunAnalysisFact,
  selectClaimBearingRunAnalysisFact,
  selectRunAnalysisFact,
} from '../../context/freshness.js';
import { projectRunFact } from '../compare-runs.js';
import type { SuccessfulHandlerOutcome } from '../../tools/handler-outcome.js';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

/**
 * The array-only scope: no scenario-scoped read, so the degraded-store
 * fail-closed fallback can never arm. Every split below is produced by the
 * fact array alone, which is the point — the defect is not a scope defect.
 */
const SCOPE: ClaimSafetyScenarioScope = {
  newestAnalysisFact: null,
  readOk: true,
  windowTruncated: false,
};

/**
 * A PLoT `/v2/run` envelope with usable option outcomes.
 *
 * `analysis_status` is the discriminator. PLoT's `determineTopLevelStatus`
 * returns `'partial'` whenever options are usable but robustness or drivers
 * degraded — WITH a full option comparison, because the failure guard returned
 * `'failed'` earlier if options were not usable. So a `partial` envelope that
 * still names a leader is the producer's declared output, not an invention of
 * this test (`plot-lite-service` `src/routes/v2/run.ts`, `determineTopLevelStatus`).
 */
function envelope(analysisStatus: string): Record<string, unknown> {
  return {
    analysis_status: analysisStatus,
    results: [
      {
        option_id: 'opt_launch',
        option_label: 'Launch now',
        win_probability: 0.62,
        factor_sensitivity: [],
      },
      {
        option_id: 'opt_status_quo',
        option_label: 'Status quo',
        win_probability: 0.38,
        factor_sensitivity: [],
      },
    ],
  };
}

/** A `run_analysis` fact. `constraintVerdict: null` ⇒ UNSTAMPED (pre-#710). */
function runFact(opts: {
  readonly analysisStatus: string;
  readonly computedAt: string;
  readonly constraintVerdict: {
    may_name_leading_option: boolean;
    constraint_verdict_state: string;
  } | null;
}): HandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: 'opt_launch',
      summary: 'Analysis ran with two options compared.',
      computed_at: opts.computedAt,
      graph_hash_at_run: `hash-${opts.computedAt}`,
      enrichment: envelope(opts.analysisStatus),
      ...(opts.constraintVerdict === null
        ? {}
        : { constraint_verdict: opts.constraintVerdict }),
    },
  } as unknown as HandlerFact;
}

function outcomeFor(fact: HandlerFact): SuccessfulHandlerOutcome {
  return {
    assistant_text: 'Analysis complete.',
    handler_facts: [fact],
    llm_calls_used: 0,
  } as unknown as SuccessfulHandlerOutcome;
}

/** Both option labels the copy could name. Used for the harm-level assertion. */
const OPTION_LABELS = ['Launch now', 'Status quo'] as const;

// ============================================================================
// Precondition: the status predicate this whole file rests on.
// ============================================================================

describe('precondition — CEE classifies the statuses this file relies on', () => {
  it('a `partial` fact is NOT a canonical success; a `computed` fact IS', () => {
    // Derived from CEE's own allowlist (`freshness.ts` SUCCESSFUL_ANALYSIS_STATUSES),
    // not asserted about PLoT. If this ever flips, every divergence fixture
    // below silently stops diverging — so it is pinned here rather than assumed.
    expect(
      isSuccessfulRunAnalysisFact(
        runFact({
          analysisStatus: 'partial',
          computedAt: '2026-08-01T00:00:00.000Z',
          constraintVerdict: null,
        }),
      ),
    ).toBe(false);
    expect(
      isSuccessfulRunAnalysisFact(
        runFact({
          analysisStatus: 'computed',
          computedAt: '2026-08-01T00:00:00.000Z',
          constraintVerdict: null,
        }),
      ),
    ).toBe(true);
  });
});

// ============================================================================
// CASE 1 — the F1 projection divergence. A permits, B withholds.
// ============================================================================

describe('coaching slot on the A/B divergence path (ROADMAP 2.804)', () => {
  /**
   * THIS turn's analysis: `partial`, newest, and its own verdict PERMITS.
   * Authority A's answer is derived from exactly this fact, so A permits.
   */
  function currentPartialPermitting(): HandlerFact {
    return runFact({
      analysisStatus: 'partial',
      computedAt: '2026-08-01T00:00:00.000Z',
      constraintVerdict: { may_name_leading_option: true, constraint_verdict_state: 'not_applicable' },
    });
  }

  /**
   * An older analysis that IS projectable (`computed`) and reads WITHHELD
   * because it is UNSTAMPED — the pre-#710 population, for which the A1 ruling
   * records there is no data migration, so these facts are still in the store.
   *
   * This is THE DISPLAYED ANALYSIS: `selectRunAnalysisFact` picks the NEWEST
   * successful fact, and this one is newer than {@link olderStillWithheld}.
   */
  function priorProjectableWithheld(): HandlerFact {
    return runFact({
      analysisStatus: 'computed',
      computedAt: '2026-07-15T00:00:00.000Z',
      constraintVerdict: null,
    });
  }

  /**
   * A THIRD fact, older still, also projectable and also withheld — and it is
   * NOT the displayed analysis.
   *
   * It exists to make the binding provable rather than plausible (trap 19). A
   * test with only two facts can be satisfied by "some withheld fact exists
   * somewhere in the array"; with this one present, the DISCRIMINATING MUTANT
   * PAIR becomes available:
   *   - stamp {@link priorProjectableWithheld} as permitting  => MUST go RED
   *   - stamp THIS fact as permitting                          => MUST stay GREEN
   * Neither mutant alone shows binding. The pair proves the assertion is bound
   * to the DISPLAYED analysis specifically, not to the array's contents.
   */
  function olderStillWithheld(): HandlerFact {
    return runFact({
      analysisStatus: 'computed',
      computedAt: '2026-07-01T00:00:00.000Z',
      constraintVerdict: null,
    });
  }

  it('withholds the leader in the coaching sentence when the DISPLAYED analysis withholds it', () => {
    const current = currentPartialPermitting();
    const prior = priorProjectableWithheld();
    const older = olderStillWithheld();
    const priorFacts = [prior, older];
    const handlerFacts = [current];
    const unified = [...handlerFacts, ...priorFacts];

    // ---- PRECONDITION PINS (trap 13b, third face) -------------------------
    // Without these four, a fixture that stopped diverging would leave this
    // test GREEN while proving nothing at all.

    // 1. The two selectors pick DIFFERENT facts — by identity, not by value.
    const claimBearing = selectClaimBearingRunAnalysisFact(unified);
    const projected = selectRunAnalysisFact(unified);
    expect(claimBearing?.fact).toBe(current);
    // THE DISPLAYED ANALYSIS IS `prior`, NOT `older` — bound by identity, so a
    // change to the selector's ordering fails here rather than silently
    // re-pointing every assertion below at a different fact.
    expect(projected?.fact).toBe(prior);
    expect(projected?.fact).not.toBe(older);
    expect(claimBearing?.fact).not.toBe(projected?.fact);

    // 2. Authority A's answer (this run's own verdict) PERMITS.
    expect(
      readMayNameLeadingOptionVerdictForFact(current).may_name_leading_option,
    ).toBe(true);

    // 3. Authority B's answer WITHHOLDS, and does so via the divergence branch
    //    specifically — the provenance names it, so this cannot pass because
    //    some other fail-closed path happened to fire.
    const verdictB = readMayNameLeadingOptionVerdict(unified, SCOPE);
    expect(verdictB.may_name_leading_option).toBe(false);
    expect(verdictB.provenance).toBe('fail_closed_projected_analysis');

    // 4. The leader-naming path is genuinely LIVE on this payload: both runs
    //    project, so `buildRerunDelta` would produce a comparison that names
    //    an option. If either stopped projecting, the copy would degrade for
    //    an unrelated reason and this test would prove nothing.
    expect(projectRunFact(prior)).not.toBeNull();
    expect(projectRunFact(current)).not.toBeNull();

    // ---- THE PROPERTY ------------------------------------------------------
    const out = applyCoachingSignal({
      proposedHandlerId: 'run_analysis',
      outcome: outcomeFor(current),
      contextPack: null,
      priorFacts,
      handlerFacts,
      requestId: 'req-divergence',
      scenarioId: SCENARIO_ID,
      claimSafetyScope: SCOPE,
    });

    expect(out.signalId).toBe('RERUN_ANALYSIS_COMPLETE');
    // Bound to the PRODUCTION text bank's comparison-free degrade, not a
    // paraphrase and not a substring predicate another branch could satisfy.
    expect(out.coachingText).toBe(
      COACHING_TEXT.RERUN_ANALYSIS_COMPLETE({ runDelta: null }),
    );
    // The harm, stated directly: no option label reaches the screen.
    for (const label of OPTION_LABELS) {
      expect(out.coachingText).not.toContain(label);
    }
  });

  it('SUPPRESSES the first-analysis nudge when B withholds (no prior run_analysis fact)', () => {
    // The FIRST_ANALYSIS arm of the same gate. `hasPriorSuccessfulRunAnalysis`
    // tests only `fact_type === 'run_analysis'`, so the divergence has to be
    // produced by the scenario-scoped fact instead of a prior-window fact.
    const current = runFact({
      analysisStatus: 'partial',
      computedAt: '2026-08-01T00:00:00.000Z',
      constraintVerdict: { may_name_leading_option: true, constraint_verdict_state: 'not_applicable' },
    });
    const scenarioNewestWithheld = priorProjectableWithheld();
    const scope: ClaimSafetyScenarioScope = {
      newestAnalysisFact: scenarioNewestWithheld,
      readOk: true,
      windowTruncated: false,
    };
    const handlerFacts = [current];
    const unified = [...handlerFacts];

    // PRECONDITION PINS — A permits, B withholds, and no prior fact exists in
    // the window (so this really is the FIRST_ANALYSIS arm).
    expect(
      readMayNameLeadingOptionVerdictForFact(current).may_name_leading_option,
    ).toBe(true);
    const verdictB = readMayNameLeadingOptionVerdict(unified, scope);
    expect(verdictB.may_name_leading_option).toBe(false);
    expect(verdictB.provenance).toBe('fail_closed_projected_analysis');

    const out = applyCoachingSignal({
      proposedHandlerId: 'run_analysis',
      outcome: outcomeFor(current),
      contextPack: null,
      priorFacts: [],
      handlerFacts,
      requestId: 'req-first-divergence',
      scenarioId: SCENARIO_ID,
      claimSafetyScope: scope,
    });

    // Suppressed entirely — the whole value of this signal is the "explore the
    // leading option" nudge, and there is no leading option to explore.
    expect(out.signalId).toBeNull();
    expect(out.coachingText).toBeNull();
  });
});

// ============================================================================
// CASE 2 — the OPPOSITE split: B must be read AFTER this turn's fact exists.
// ============================================================================

describe('the coaching slot reads the SETTLED permission, not the turn-entry one', () => {
  /**
   * ⚠ THIS IS THE TRAP IN THE FIX, AND IT IS THE REASON THIS CASE EXISTS.
   *
   * In `turn-executor.ts` the coaching call (STEP 5) runs BEFORE the
   * post-handler re-read of B. A naive thread would hand the coaching slot the
   * TURN-ENTRY verdict, computed over `context.prior_facts` — the state before
   * this turn's analysis existed. On a scenario whose PRIOR fact withholds and
   * whose CURRENT analysis permits, that would suppress honest coaching, on the
   * most common turn shape in the product: a P2 turned into a visible
   * regression, and one that looks correct in review because the types line up.
   *
   * The fix removes the possibility rather than ordering around it: the
   * permission is derived INSIDE `applyCoachingSignal`, from the facts the
   * helper already holds (`handlerFacts` ∪ `priorFacts`). There is no path from
   * there to the turn-entry value, so this case cannot regress by a caller
   * passing the wrong variable.
   */
  it('permits and names the leader when the prior fact withheld but THIS turn permits', () => {
    const prior = runFact({
      analysisStatus: 'computed',
      computedAt: '2026-07-15T00:00:00.000Z',
      constraintVerdict: null, // unstamped ⇒ withheld
    });
    const current = runFact({
      analysisStatus: 'computed',
      computedAt: '2026-08-01T00:00:00.000Z',
      constraintVerdict: { may_name_leading_option: true, constraint_verdict_state: 'evaluated_feasible' },
    });
    const priorFacts = [prior];
    const handlerFacts = [current];
    const unified = [...handlerFacts, ...priorFacts];

    // ---- PRECONDITION PIN: the two READ POINTS genuinely differ ------------
    // This is what makes the case discriminating. If entry and settled agreed,
    // the assertion below would pass whichever value the code consumed.
    const entryVerdict = readMayNameLeadingOptionVerdict(priorFacts, SCOPE);
    const settledVerdict = readMayNameLeadingOptionVerdict(unified, SCOPE);
    expect(entryVerdict.may_name_leading_option).toBe(false);
    expect(settledVerdict.may_name_leading_option).toBe(true);

    // And the settled verdict short-circuits the narrow (same fact both
    // selectors), which is why it permits — pinned so the reason is asserted,
    // not assumed.
    expect(selectClaimBearingRunAnalysisFact(unified)?.fact).toBe(current);
    expect(selectRunAnalysisFact(unified)?.fact).toBe(current);

    // ---- THE PROPERTY ------------------------------------------------------
    const out = applyCoachingSignal({
      proposedHandlerId: 'run_analysis',
      outcome: outcomeFor(current),
      contextPack: null,
      priorFacts,
      handlerFacts,
      requestId: 'req-settled',
      scenarioId: SCENARIO_ID,
      claimSafetyScope: SCOPE,
    });

    expect(out.signalId).toBe('RERUN_ANALYSIS_COMPLETE');
    // Permitted ⇒ the real comparison, which NAMES the leader. Asserted as the
    // exact production string for the delta this fixture produces (identical
    // envelopes ⇒ the unchanged-leader arm), so a degrade to the
    // comparison-free copy fails here loudly.
    expect(out.coachingText).toContain('Launch now');
    expect(out.coachingText).not.toBe(
      COACHING_TEXT.RERUN_ANALYSIS_COMPLETE({ runDelta: null }),
    );
  });
});
