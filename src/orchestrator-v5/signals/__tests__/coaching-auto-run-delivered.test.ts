/**
 * THE INVERSION #1010 WOULD OTHERWISE CREATE — and both directions of it.
 *
 * ── WHY THIS FILE IS SEPARATE FROM `coaching-phantom-prior-run.test.ts` ─────
 * That file pins the world as it is TODAY: an auto-initiated run's result
 * reaches no client, so it is not a result the user saw, and the user's first
 * manual run is correctly narrated as their FIRST analysis (#1058).
 *
 * THIS file pins the world #1010 + UI #752 create: the scenario-graph read leg
 * returns the committed analysis, the UI renders it, and the SAME auto-run fact
 * — still stamped `auto_post_draft`, because provenance never changes — is now
 * a result the user HAS seen. A reader that decides delivery from the stamp
 * would suppress the re-run acknowledgement and narrate a genuine re-run as a
 * first analysis: #1058's defect facing the other way (CLAUDE.md trap #21 — two
 * questions under one name, coincident until a change decouples them).
 *
 * ⭐ THAT WORLD IS NOW PRODUCTION, so this file no longer mocks anything. It
 * USED to inject the delivered posture over a production `false`; the constant
 * was flipped alongside UI #752 and the injection became a no-op — see the note
 * above the fixtures. The counterfactual moved to
 * `coaching-phantom-prior-run.test.ts`, which now carries the injected
 * PRE-DELIVERY posture. `vi.mock` is file-scoped and hoisted, which is why the
 * two postures live in two files rather than two `describe`s.
 *
 * ── WHY BOTH DIRECTIONS ARE HERE, NOT JUST THE INVERSION (trap 22b) ─────────
 * One direction alone lets the other through. A fix that makes an auto-run count
 * as "seen" must NOT also make a genuine first analysis narrate as a re-run —
 * that is precisely the defect #1058 closed, and re-opening it while closing its
 * mirror is the oscillation CLAUDE.md trap 22f warns about. So every case here
 * has its opposite-direction twin, and the twins are asserted in the SAME
 * posture, so neither can be satisfied by the flag simply not applying.
 *
 * ── THE POSITIVE CONTROL (trap 13, and trap 12b) ───────────────────────────
 * The first test proves production really ships the delivered posture, so every
 * assertion below is about the shipped constant rather than an injected one.
 * ⚠ It deliberately does NOT rest on that constant alone: a control asserting
 * only the current value cannot fail once that value is the default — the way
 * the prompt-drift gate's three controls hollowed out. Its discriminating half
 * is the predicate's explicit parameter, which is real in both directions.
 */

import { describe, expect, it } from 'vitest';

import type { HandlerFact } from '@talchain/schemas/orchestrator';

import type { SuccessfulHandlerOutcome } from '../../tools/handler-outcome.js';
import { buildAutoRunProvenance, RUN_PROVENANCE_ENRICHMENT_KEY } from '../../context/run-initiator.js';
import { COACHING_TEXT, detectCoachingSignal } from '../coaching-signals.js';

// ── no posture switch: THIS FILE IS PRODUCTION ──────────────────────────────
//
// ⭐ IT USED TO CARRY ONE. Until the constant was flipped alongside UI #752 this
// file injected `AUTO_RUN_RESULT_REACHES_USER: true` over a production `false`.
// Production now ships `true`, so that injection would set a value to itself:
// a no-op mock whose "positive control" could no longer fail, i.e. a control
// decayed into a tautology by its own success (CLAUDE.md trap #12b, the exact
// shape that hollowed out the prompt-drift gate's three controls). It is
// REMOVED rather than left looking load-bearing, and the discrimination this
// file needs now comes from the predicate's explicit parameter, which is real
// in both directions.
//
// The counterfactual moved with it: `coaching-phantom-prior-run.test.ts` now
// carries the injected PRE-DELIVERY posture and its own positive control. The
// two files have swapped roles; neither posture went unpinned.

// ── fixtures (same carriers as the current-posture spec) ────────────────────

const OPTIONS = [
  { id: 'opt-build', label: 'build self-hosting this year', win: 0.6 },
  { id: 'opt-defer', label: 'defer it to next year', win: 0.4 },
];

function runEnvelope(): Record<string, unknown> {
  return {
    analysis_status: 'completed',
    results: OPTIONS.map((o) => ({
      option_id: o.id,
      option_label: o.label,
      win_probability: o.win,
      factor_sensitivity: [],
    })),
  };
}

/** This turn's own run_analysis outcome — identical numbers to the prior, so the
 *  rerun composer's "unchanged" arm is the one that fires when a prior counts. */
function thisTurnRunOutcome(): SuccessfulHandlerOutcome {
  const fact = {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: 'scen-a',
      leading_option_id: 'opt-build',
      summary: 'Ran analysis',
      enrichment: runEnvelope(),
    },
  } as unknown as HandlerFact;
  return { assistant_text: 'done', handler_facts: [fact], llm_calls_used: 0 };
}

/** Provenance is spread into `result.enrichment` exactly as
 *  `stampAutoRunProvenance` spreads it, so a fixture cannot drift from the
 *  writer's carrier. */
function priorRunFact(
  provenance: Record<string, unknown> | null,
  overrides: { noop?: boolean } = {},
): HandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: overrides.noop ?? false,
    result: {
      scenario_id: 'scen-a',
      leading_option_id: 'opt-build',
      summary: 'prior',
      computed_at: '2026-08-19T22:05:00.000Z',
      graph_hash_at_run: 'hash-prior',
      enrichment: {
        ...runEnvelope(),
        ...(provenance === null ? {} : { [RUN_PROVENANCE_ENRICHMENT_KEY]: provenance }),
      },
    },
  } as unknown as HandlerFact;
}

/** The fact the post-draft auto-run commits — provenance built by the SAME
 *  function the production writer calls. */
const AUTO_RUN_PRIOR = (): HandlerFact =>
  priorRunFact(buildAutoRunProvenance('draft-turn-abc') as unknown as Record<string, unknown>);

/** The fact a user's own "Run analysis" commits: no provenance stamp at all. */
const USER_RUN_PRIOR = (): HandlerFact => priorRunFact(null);

function setFactorOutcome(targetId: string): SuccessfulHandlerOutcome {
  const fact: HandlerFact = {
    fact_type: 'set_factor_value',
    fact_version: 1,
    noop: false,
    result: { target_id: targetId, status: 'applied', before: { value: 1 }, after: { value: 2 } },
  };
  return { assistant_text: 'done', handler_facts: [fact], llm_calls_used: 0 };
}

function runBranch(priorFacts: readonly HandlerFact[]) {
  return detectCoachingSignal({
    proposedHandlerId: 'run_analysis',
    mayNameLeadingOption: true,
    outcome: thisTurnRunOutcome(),
    contextPack: null,
    priorFacts,
  });
}

function editBranch(priorFacts: readonly HandlerFact[]) {
  return detectCoachingSignal({
    proposedHandlerId: 'set_factor_value',
    mayNameLeadingOption: true,
    outcome: setFactorOutcome('f-not-a-driver'),
    contextPack: null,
    priorFacts,
  });
}

// ── the control, then the two directions ────────────────────────────────────

describe('once #1010 + UI #752 deliver the auto-run result, an auto-run IS a result the user saw', () => {
  it('POSITIVE CONTROL: production ships the delivered posture, and the predicate still discriminates', async () => {
    // No mock stands between this file and production any more, so this is a
    // claim about the SHIPPED constant. It is not ceremony: every assertion
    // below is meaningful only if this reads `true`, and if the constant is
    // ever flipped back they must all fail rather than quietly change meaning.
    const runInitiator = await import('../../context/run-initiator.js');
    expect(runInitiator.AUTO_RUN_RESULT_REACHES_USER).toBe(true);
    expect(runInitiator.hasUserSeenRunAnalysisResult(AUTO_RUN_PRIOR())).toBe(true);

    // ⭐ THE DISCRIMINATION, and it does NOT come from the constant. A control
    // that only asserts the current value cannot fail once that value is the
    // default (trap #12b). The explicit parameter is real in both directions,
    // so this pair bites whichever way the constant is set.
    expect(runInitiator.hasUserSeenRunAnalysisResult(AUTO_RUN_PRIOR(), false)).toBe(false);
    expect(runInitiator.hasUserSeenRunAnalysisResult(AUTO_RUN_PRIOR(), true)).toBe(true);

    // …and provenance is unmoved by either: the identical fact is still
    // correctly identified as auto-INITIATED. Two questions, one object.
    expect(runInitiator.isAutoInitiatedRunAnalysisFact(AUTO_RUN_PRIOR())).toBe(true);
  });

  // ── DIRECTION 1: the inversion this PR must not create ────────────────────

  it('THE INVERSION: a genuine re-run after a DELIVERED auto-run is acknowledged as a re-run', () => {
    // The user saw the auto-run's result on the canvas, then pressed Run again.
    // Narrating that as "Your first analysis is ready" is the product claiming a
    // first analysis on a genuine re-run.
    const signal = runBranch([AUTO_RUN_PRIOR()]);
    expect(signal?.signal_id).toBe('RERUN_ANALYSIS_COMPLETE');
    expect(signal?.signal_id).not.toBe('FIRST_ANALYSIS_COMPLETE');
    expect(signal?.coaching_text).not.toBe(COACHING_TEXT.FIRST_ANALYSIS_COMPLETE({}));
    // Bound to the composed comparison, not merely to "some other signal fired".
    expect(signal?.coaching_text).toContain('The result is unchanged');
  });

  it('THE INVERSION, mixed history: an auto-run prior alongside a user prior still re-runs', () => {
    // Newest-first, as `prior_facts` arrives.
    expect(runBranch([AUTO_RUN_PRIOR(), USER_RUN_PRIOR()])?.signal_id).toBe(
      'RERUN_ANALYSIS_COMPLETE',
    );
  });

  // ── DIRECTION 2: the opposite-direction twins (trap 22b) ──────────────────
  // Closing direction 1 must not re-open #1058. These run in the SAME posture,
  // so they cannot be satisfied by the flag failing to apply.

  it('TWIN: a TRUE first analysis — no prior fact at all — is still acknowledged as FIRST', () => {
    const signal = runBranch([]);
    expect(signal?.signal_id).toBe('FIRST_ANALYSIS_COMPLETE');
    // Bound to the production constant, never a paraphrase.
    expect(signal?.coaching_text).toBe(COACHING_TEXT.FIRST_ANALYSIS_COMPLETE({}));
    expect(signal?.coaching_text).not.toContain('The result is unchanged');
  });

  it('TWIN: a first analysis whose only prior is a NON-run fact is still acknowledged as FIRST', () => {
    // An edit happened before the first run. Nothing was ever analysed, so the
    // delivered posture must not manufacture a prior out of an unrelated fact.
    const editFact: HandlerFact = {
      fact_type: 'set_factor_value',
      fact_version: 1,
      noop: false,
      result: { target_id: 'f-1', status: 'applied', before: { value: 1 }, after: { value: 2 } },
    };
    expect(runBranch([editFact])?.signal_id).toBe('FIRST_ANALYSIS_COMPLETE');
  });

  it('TWIN: a NOOP auto-run prior is still NOT a result the user saw — nothing ran to display', () => {
    // The `noop` exclusion is a different question ("did it run?") and is owned
    // by the coaching predicate, not by the delivery flag. Flipping delivery
    // must not smuggle a noop fact onto the re-run arm, where the comparison
    // cannot be built and the copy would assert a replacement that never
    // happened.
    const signal = runBranch([priorRunFact(null, { noop: true })]);
    expect(signal?.signal_id).toBe('FIRST_ANALYSIS_COMPLETE');
    expect(signal?.coaching_text).not.toContain('This was a re-run');
  });

  it('TWIN: a user-initiated prior is unaffected by the flip — it was always seen', () => {
    expect(runBranch([USER_RUN_PRIOR()])?.signal_id).toBe('RERUN_ANALYSIS_COMPLETE');
  });

  // ── the sibling predicate is NOT co-tightened (trap 21) ───────────────────

  it('the EDIT branch is untouched by delivery — it asks about the persisted analysis, not the screen', () => {
    // `hasPriorRunAnalysisFactToStale` counts an auto-run in BOTH postures,
    // deliberately: the auto-run really did persist an analysis, so an edit
    // really can stale it. Delivery is not its question, and a flip that moved
    // it too would be the co-tightening trap 21 exists to forbid.
    expect(editBranch([AUTO_RUN_PRIOR()])?.signal_id).toBe('STALE_ANALYSIS_AFTER_EDIT');
    expect(editBranch([USER_RUN_PRIOR()])?.signal_id).toBe('STALE_ANALYSIS_AFTER_EDIT');
  });

  it('the two branches now AGREE on an auto-run prior — the divergence was delivery, and it has closed', () => {
    // In the CURRENT posture these disagree (pinned in
    // `coaching-phantom-prior-run.test.ts`). In the delivered posture they
    // converge — and that convergence is the observable consequence of the
    // delivery channel going live, not of the two predicates being merged.
    expect(editBranch([AUTO_RUN_PRIOR()])?.signal_id).toBe('STALE_ANALYSIS_AFTER_EDIT');
    expect(runBranch([AUTO_RUN_PRIOR()])?.signal_id).toBe('RERUN_ANALYSIS_COMPLETE');
  });
});
