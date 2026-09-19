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
 * ⭐⭐ THAT WORLD WAS PRODUCTION FOR THREE WEEKS AND IS NOW THE COUNTERFACTUAL
 * AGAIN. The constant was flipped to `true` alongside UI #752, this file dropped
 * its injection, and on 2026-09-11 the delivered posture was REFUTED on the
 * deployed build — #1058's sentence, verbatim, on a first-ever analysis whose two
 * prior runs had refused. The constant is now `false`, so this file re-acquires
 * the injection and `coaching-phantom-prior-run.test.ts` is production again.
 * `vi.mock` is file-scoped and hoisted, which is why the two postures live in two
 * files rather than two `describe`s.
 *
 * ⚠ THE CASES BELOW ARE NOT HYPOTHETICAL, AND THAT IS WHY THEY STAY. They are
 * exactly the cost the fail-closed posture charges: for every user whose browser
 * DID receive the provisional result — the `delivered` outcome, the common one —
 * their second analysis is now narrated as their first, and they lose the delta,
 * the attribution and the inert-edit explanation. This file is the standing
 * record of what that trade gives up, so a future session weighing the receipt
 * can see the size of the prize rather than inferring it.
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
 * The first test proves the injection really reaches the predicate production
 * calls, AND asserts the contrast against the real module — so if the constant is
 * ever flipped back to `true`, this file stops being a counterfactual and the
 * control REDs rather than every case below quietly re-testing production.
 * ⚠ It deliberately does NOT rest on the constant alone: a control asserting only
 * the current value cannot fail once that value is the default — the way the
 * prompt-drift gate's three controls hollowed out. Its discriminating half is the
 * predicate's explicit parameter, which is real in both directions.
 */

import { describe, expect, it, vi } from 'vitest';

import type { HandlerFact } from '@talchain/schemas/orchestrator';

import type { SuccessfulHandlerOutcome } from '../../tools/handler-outcome.js';
// ⚠ `AUTO_RUN_RESULT_REACHES_USER` and `hasUserSeenRunAnalysisResult` are NOT
// imported here on purpose. The mock below injects the DELIVERED posture over
// this module, so a file-level import of either would hand the tests the
// injection back and let them agree with themselves (CLAUDE.md trap #13b). Every
// test that needs the SHIPPED answer reaches for it with `vi.importActual`.
import { buildAutoRunProvenance, RUN_PROVENANCE_ENRICHMENT_KEY } from '../../context/run-initiator.js';
import { COACHING_TEXT, detectCoachingSignal } from '../coaching-signals.js';

// ── the posture switch: DELIVERED ───────────────────────────────────────────
//
// ⭐ THIS MOCK IS NOT DECORATION — IT IS WHAT KEEPS THE INVERSION UNDER TEST
// AFTER THE FAIL-CLOSED FLIP. `AUTO_RUN_RESULT_REACHES_USER` reads `false` in
// production from 2026-09-11, so the re-run cases below no longer describe
// production. They still describe a REACHABLE state — the `delivered` outcome of
// `useProvisionalAnalysisDelivery`, which is the COMMON one — and they describe
// the exact harm the fail-closed posture pays for: a genuine re-run narrated as a
// first analysis. So the delivered posture is INJECTED here rather than deleted.
//
// ⚠⚠ THIS FILE AND `coaching-phantom-prior-run.test.ts` HAVE NOW SWAPPED ROLES
// TWICE. That is the argument for keeping both: the constant is a posture, not a
// derivation, and whichever way it points, the other direction is a live harm
// somebody will meet. The day a per-turn DELIVERY RECEIPT lands, both files stop
// being postures and become two halves of one derivation.
//
// `importOriginal`-spread so every other export stays REAL (CLAUDE.md trap #12:
// a `vi.mock` factory REPLACES the module). `vi.mock` is file-scoped and
// hoisted, which is why the two postures live in two files rather than two
// `describe`s.
//
// ⚠ Tests below that need PRODUCTION semantics use `vi.importActual`, never the
// file-level import, so they cannot read this injection back as if it were the
// shipped answer.
vi.mock('../../context/run-initiator.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../context/run-initiator.js')>();
  return {
    ...actual,
    AUTO_RUN_RESULT_REACHES_USER: true,
    hasUserSeenRunAnalysisResult: (fact: HandlerFact): boolean =>
      actual.hasUserSeenRunAnalysisResult(fact, true),
  };
});

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
  it('POSITIVE CONTROL: the delivered posture actually reaches the predicate production calls', async () => {
    // Without this, every re-run assertion below would pass or fail for reasons
    // invisible here (CLAUDE.md trap #13: a probe with no positive control is
    // vacuous). The injection must be observable AT the predicate, and it must
    // DISCRIMINATE — so the contrast is asserted in the same test, against the
    // REAL module.
    const injected = await import('../../context/run-initiator.js');
    const real = await vi.importActual<typeof import('../../context/run-initiator.js')>(
      '../../context/run-initiator.js',
    );
    expect(injected.AUTO_RUN_RESULT_REACHES_USER).toBe(true);
    expect(injected.hasUserSeenRunAnalysisResult(AUTO_RUN_PRIOR())).toBe(true);
    // …and the contrast: production ships the FAIL-CLOSED posture. If these two
    // ever read the same value, this file has stopped being a counterfactual and
    // every re-run case below is silently re-testing production.
    expect(real.AUTO_RUN_RESULT_REACHES_USER).toBe(false);
    expect(real.hasUserSeenRunAnalysisResult(AUTO_RUN_PRIOR())).toBe(false);

    // ⭐ THE DISCRIMINATION, and it does NOT come from the constant. A control
    // that only asserts the current value cannot fail once that value is the
    // default (trap #12b). The explicit parameter is real in both directions,
    // so this pair bites whichever way the constant is set.
    expect(real.hasUserSeenRunAnalysisResult(AUTO_RUN_PRIOR(), false)).toBe(false);
    expect(real.hasUserSeenRunAnalysisResult(AUTO_RUN_PRIOR(), true)).toBe(true);

    // …and provenance is unmoved by either: the identical fact is still
    // correctly identified as auto-INITIATED. Two questions, one object.
    expect(real.isAutoInitiatedRunAnalysisFact(AUTO_RUN_PRIOR())).toBe(true);
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
