/**
 * THE PHANTOM PRIOR — a server-initiated analysis is not a result the user saw.
 *
 * ── THE WITNESS THIS SPEC EXISTS FOR ────────────────────────────────────────
 * UX gate, staging, 2026-08-19T22:01–22:38Z: on what the user experienced as
 * their FIRST-EVER analysis, the conversation said
 *     "The result is unchanged: build self-hosting this year still leads."
 *
 * ── THE MECHANISM (the originally-stated one was refuted) ───────────────────
 * NOT "an absent prior reads as equal" — `buildRerunAcknowledgement` fails
 * closed at two independent guards and cannot compare against nothing. The
 * prior was REAL and the user had simply never seen it:
 * `scheduleAutoRunAfterFreshDraft` (route-v2's draft_graph branch, ungated by
 * any flag) dispatches a SERVER-INITIATED provisional `run_analysis` after
 * every admissible fresh draft. That commits fact #1. The user's own "Run
 * analysis" is fact #2, compared against #1, identical — hence the sentence.
 *
 * ── WHY "NEVER SAW IT" IS A MEASUREMENT, NOT AN ASSUMPTION ──────────────────
 * Live capture on the deployed quartet (UI `2b6ec553`, CEE `19a60fd`, PLoT
 * `fb63b03`, ISL `28fe0c9`), headed Chromium, instrument control asserted
 * (`document.visibilityState === 'visible'`, rAF ticking): after the draft
 * landed the browser issued ZERO requests for 120 s and the auto-run's stored
 * disclosure sentence never entered the DOM. Structural, not timing — the
 * draft's SSE stream closes on a terminal COMPLETE frame, the auto-run turn has
 * no client, and the scenario-graph read leg returns no analysis. The two PRs
 * that would change it (CEE #1010, UI #752) were BOTH unmerged when that capture
 * was taken; both have since shipped.
 *
 * ── THE SECOND WITNESS, 2026-09-11, WHICH IS WHY THIS FILE IS PRODUCTION AGAIN ─
 * Both PRs shipping is what licensed the flip to the DELIVERED posture, and the
 * delivered posture was then refuted on the deployed build: a journey witness saw
 * a model's FIRST-EVER successful analysis open with "The result is unchanged:
 * <option> still leads", when BOTH prior runs had REFUSED and the panel had been
 * reading "No analysis has run yet for this model". The sentence is CEE's, not
 * the UI's — "The result is unchanged" reads 0 files across the whole UI repo,
 * with the contrast control "No analysis has run yet for this model" at 8 files
 * in the same sweep, so the sweep is not blind.
 *
 * ⭐ THE CHANNEL WAS NOT THE PROBLEM; THE CLAIM ABOUT IT WAS. #1010 + #752 really
 * do deliver — on the `delivered` outcome. The constant asserted delivery on all
 * five (`delivered | already_held | deadline | aborted | unreadable`), because a
 * module-level constant answers "can this channel deliver?" and the coaching slot
 * asks "did THIS USER receive it?". Two questions under one name (CLAUDE.md trap
 * #21), coincident only while the channel could never deliver at all.
 *
 * ── WHAT IS PINNED HERE ─────────────────────────────────────────────────────
 * Every case binds BY IDENTITY — to the production copy constant, to the
 * marker's `initiated_by` value, to the specific fact object — never to a value
 * predicate another fixture could satisfy (CLAUDE.md trap #19). And every
 * suppression case has its OPPOSITE-DIRECTION TWIN (trap 22b): a fix that
 * closes a false "you already saw this" must not open a false "this is your
 * first", so both harms are watched, not one door.
 */

import { describe, expect, it } from 'vitest';

import type { HandlerFact } from '@talchain/schemas/orchestrator';

import type { SuccessfulHandlerOutcome } from '../../tools/handler-outcome.js';
import {
  buildAutoRunProvenance,
  isAutoInitiatedRunAnalysisFact,
  RUN_PROVENANCE_ENRICHMENT_KEY,
} from '../../context/run-initiator.js';
import { RUN_PROVENANCE_ENRICHMENT_KEY as KEY_REEXPORTED_BY_THE_WRITER } from '../../handlers/chip-click-dispatch.js';
import { COACHING_TEXT, detectCoachingSignal } from '../coaching-signals.js';

// ── no posture switch: THIS FILE IS PRODUCTION AGAIN ────────────────────────
//
// ⭐ IT CARRIED ONE FOR THREE WEEKS, AND THE ROLES HAVE NOW SWAPPED BACK. While
// `AUTO_RUN_RESULT_REACHES_USER` read `true`, this file injected the
// PRE-DELIVERY posture so #1058 stayed under test as a counterfactual. The
// constant was flipped to `false` on 2026-09-11 after the witnessed sentence in
// this header's first block was seen AGAIN on the deployed build, so the
// injection would now set a value to itself: a no-op mock whose positive control
// could no longer fail — a control decayed into a tautology by its own success
// (CLAUDE.md trap #12b, the shape that hollowed out the prompt-drift gate's three
// controls). It is REMOVED rather than left looking load-bearing.
//
// The counterfactual moved with it: `coaching-auto-run-delivered.test.ts` now
// carries the injected DELIVERED posture and its own positive control. `vi.mock`
// is file-scoped and hoisted, which is why the two postures live in two files
// rather than two `describe`s. Neither posture went unpinned in the swap.
//
// The discrimination this file needs no longer comes from a mock at all: it comes
// from `hasUserSeenRunAnalysisResult`'s explicit parameter, which is real in both
// directions whatever the constant says.

// ── fixtures ────────────────────────────────────────────────────────────────

/** The witnessed decision's two options, so the composed sentence is the
 *  witnessed sentence rather than a paraphrase of it. */
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

/** This turn's own run_analysis outcome — identical numbers to the prior, so
 *  the rerun composer's "unchanged" arm is the one that would fire. */
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

/**
 * A prior run_analysis fact. `provenance` is spread into `result.enrichment`
 * exactly as `stampAutoRunProvenance` spreads it, so a fixture cannot drift
 * from the writer's carrier.
 */
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
 *  function the production writer calls, so writer and fixture cannot diverge. */
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
    // `null` is what the chip-click dispatch path really passes: it assembles
    // no ContextPack. The run_analysis branch never reads it, and the edit
    // branch's STALE verdict is decided before the driver-label lookup.
    contextPack: null,
    priorFacts,
  });
}

function editBranch(priorFacts: readonly HandlerFact[]) {
  return detectCoachingSignal({
    proposedHandlerId: 'set_factor_value',
    mayNameLeadingOption: true,
    // A target that is NOT a top driver, so HIGH_SENSITIVITY cannot fire and
    // mask the STALE verdict.
    outcome: setFactorOutcome('f-not-a-driver'),
    // `null` is what the chip-click dispatch path really passes: it assembles
    // no ContextPack. The run_analysis branch never reads it, and the edit
    // branch's STALE verdict is decided before the driver-label lookup.
    contextPack: null,
    priorFacts,
  });
}

// ── the defect ──────────────────────────────────────────────────────────────

describe('the phantom prior: a post-draft auto-run is not a result the user saw', () => {
  it('POSITIVE CONTROL: production ships the fail-closed posture, and the predicate still discriminates', async () => {
    // Without this, every suppression assertion below would pass or fail for
    // reasons invisible here (CLAUDE.md trap #13: an absence probe with no
    // positive control is vacuous). No mock stands between this file and
    // production any more, so this is a claim about the SHIPPED constant.
    const runInitiator = await import('../../context/run-initiator.js');
    expect(runInitiator.AUTO_RUN_RESULT_REACHES_USER).toBe(false);
    expect(runInitiator.hasUserSeenRunAnalysisResult(AUTO_RUN_PRIOR())).toBe(false);

    // ⭐ THE DISCRIMINATION, and it does NOT come from the constant. A control
    // that only asserts the current value cannot fail once that value is the
    // default (CLAUDE.md trap #12b). The explicit parameter is real in both
    // directions, so this pair bites whichever way the constant is set.
    expect(runInitiator.hasUserSeenRunAnalysisResult(AUTO_RUN_PRIOR(), false)).toBe(false);
    expect(runInitiator.hasUserSeenRunAnalysisResult(AUTO_RUN_PRIOR(), true)).toBe(true);

    // …and provenance is unmoved by either posture: the identical fact is still
    // correctly identified as auto-INITIATED. Two questions, one object.
    expect(runInitiator.isAutoInitiatedRunAnalysisFact(AUTO_RUN_PRIOR())).toBe(true);
  });

  it('THE WITNESSED SENTENCE: an auto-run-only prior must not produce "The result is unchanged"', () => {
    const signal = runBranch([AUTO_RUN_PRIOR()]);

    // The exact witnessed string, reconstructed from the witnessed labels.
    expect(signal?.coaching_text).not.toContain('The result is unchanged');
    expect(signal?.coaching_text).not.toContain(
      'The result is unchanged: build self-hosting this year still leads.',
    );
    // And no other arm of the rerun composer may stand in for it.
    expect(signal?.signal_id).not.toBe('RERUN_ANALYSIS_COMPLETE');
  });

  it('the user’s first manual run after an auto-run gets FIRST_ANALYSIS_COMPLETE, bound to the production copy', () => {
    const signal = runBranch([AUTO_RUN_PRIOR()]);
    expect(signal?.signal_id).toBe('FIRST_ANALYSIS_COMPLETE');
    // Bound to the production constant, never a paraphrase (the paraphrase is
    // the one sentence that never changes — CLAUDE.md's note on COACHING_TEXT).
    expect(signal?.coaching_text).toBe(COACHING_TEXT.FIRST_ANALYSIS_COMPLETE({}));
  });

  // ── the opposite-direction twins (trap 22b) ───────────────────────────────

  it('TWIN: a USER-initiated prior still produces the re-run comparison — the suppression is not blanket', () => {
    const signal = runBranch([USER_RUN_PRIOR()]);
    expect(signal?.signal_id).toBe('RERUN_ANALYSIS_COMPLETE');
    expect(signal?.coaching_text).toContain('The result is unchanged');
  });

  it('TWIN: an auto-run fact must not suppress a REAL prior the user saw', () => {
    // Newest-first, as `prior_facts` arrives: the user's run, then the auto-run.
    const signal = runBranch([USER_RUN_PRIOR(), AUTO_RUN_PRIOR()]);
    expect(signal?.signal_id).toBe('RERUN_ANALYSIS_COMPLETE');
  });

  it('TWIN: the marker binds by IDENTITY — an UNRECOGNISED initiated_by counts as user-initiated', () => {
    // An unknown future initiator must degrade to pre-R2 behaviour, never to
    // "the user never saw this". A false negative is recoverable; a false
    // positive silently deletes a real prior run.
    const unknownInitiator = priorRunFact({
      initiated_by: 'some_future_initiator',
      provisional: true,
      draft_turn_id: 'draft-turn-abc',
    });
    expect(isAutoInitiatedRunAnalysisFact(unknownInitiator)).toBe(false);
    expect(runBranch([unknownInitiator])?.signal_id).toBe('RERUN_ANALYSIS_COMPLETE');
  });

  it('TWIN: a malformed run_provenance value counts as user-initiated, not as invisible', () => {
    for (const malformed of ['auto_post_draft', null, 42, []] as unknown[]) {
      const fact = priorRunFact(malformed as Record<string, unknown> | null);
      // `[]` is an object but carries no initiated_by; a bare string is the
      // shape a careless future writer would produce. Neither may suppress.
      if (malformed === null) continue; // null omits the key entirely — covered above
      expect(isAutoInitiatedRunAnalysisFact(fact)).toBe(false);
      expect(runBranch([fact])?.signal_id).toBe('RERUN_ANALYSIS_COMPLETE');
    }
  });

  // ── the latent inversion this closes on the way past ──────────────────────

  it('a noop run_analysis prior is not a result the user saw either (closes the re-run-on-a-first-run inversion)', () => {
    // `hasAnyPriorRunAnalysisFact` counted noop facts while
    // `selectRunAnalysisFact` excludes them, so a noop-only prior took the
    // re-run arm and then could not build a comparison — asserting "This was a
    // re-run. It replaces the earlier result as the current analysis" on a
    // genuine first run. `run-analysis.ts` emits only `noop: false` today, so
    // this was unreachable; it is now unreachable by construction.
    const signal = runBranch([priorRunFact(null, { noop: true })]);
    expect(signal?.signal_id).toBe('FIRST_ANALYSIS_COMPLETE');
    expect(signal?.coaching_text).not.toContain('This was a re-run');
  });

  // ── the two questions, and the divergence between them (trap 21) ──────────

  it('the edit branch and the run_analysis branch DELIBERATELY disagree on an auto-run-only prior', () => {
    // Edit branch asks "could this edit have staled the persisted analysis?" —
    // and the auto-run really did persist one, so YES.
    expect(editBranch([AUTO_RUN_PRIOR()])?.signal_id).toBe('STALE_ANALYSIS_AFTER_EDIT');
    // Run branch asks "has the USER seen a result?" — and they have not, so NO.
    expect(runBranch([AUTO_RUN_PRIOR()])?.signal_id).toBe('FIRST_ANALYSIS_COMPLETE');
  });

  it('the two branches still AGREE on a user-initiated prior — the divergence is confined to the class that differs', () => {
    expect(editBranch([USER_RUN_PRIOR()])?.signal_id).toBe('STALE_ANALYSIS_AFTER_EDIT');
    expect(runBranch([USER_RUN_PRIOR()])?.signal_id).toBe('RERUN_ANALYSIS_COMPLETE');
  });

  // ── one definition of the marker (trap 12) ────────────────────────────────

  it('the marker key has ONE definition: the writer re-exports the run-initiator constant', () => {
    expect(KEY_REEXPORTED_BY_THE_WRITER).toBe(RUN_PROVENANCE_ENRICHMENT_KEY);
  });

  it('the reader accepts exactly what the writer builds (writer → reader round trip)', () => {
    const stamped = priorRunFact(
      buildAutoRunProvenance('draft-turn-xyz') as unknown as Record<string, unknown>,
    );
    expect(isAutoInitiatedRunAnalysisFact(stamped)).toBe(true);
    // …and the reader is not simply answering "true" for every run_analysis
    // fact — the discriminating negative, in the same test.
    expect(isAutoInitiatedRunAnalysisFact(USER_RUN_PRIOR())).toBe(false);
  });

  // ── provenance vs delivery: TWO questions, named apart (trap 21) ───────────

  it('PROVENANCE AND DELIVERY ARE DIFFERENT QUESTIONS ABOUT THE SAME FACT', async () => {
    // The whole point of the #1010 split, and it SURVIVES both flips — which is
    // the thing worth pinning. The split must not be readable as a restating of
    // the stamp: delivery moves with the POSTURE while provenance is immovable,
    // so the discrimination is carried by the explicit parameter rather than by
    // the constant's happening to hold either value (CLAUDE.md trap #12b: a
    // control pinned to whatever is current decays into a tautology the moment
    // current moves — and this constant has now moved twice).
    const real = await import('../../context/run-initiator.js');
    const autoRun = AUTO_RUN_PRIOR();

    // PROVENANCE — permanent, and unmoved by either posture.
    expect(real.isAutoInitiatedRunAnalysisFact(autoRun)).toBe(true);
    // DELIVERY — a fact about the channel, and it moves.
    expect(real.hasUserSeenRunAnalysisResult(autoRun, false)).toBe(false);
    expect(real.hasUserSeenRunAnalysisResult(autoRun, true)).toBe(true);

    // The discriminating positive, in the same test: a user-initiated run is
    // neither auto-initiated nor posture-dependent.
    const userRun = USER_RUN_PRIOR();
    expect(real.isAutoInitiatedRunAnalysisFact(userRun)).toBe(false);
    expect(real.hasUserSeenRunAnalysisResult(userRun, false)).toBe(true);
    expect(real.hasUserSeenRunAnalysisResult(userRun, true)).toBe(true);
  });

  it('BOTH POSTURES of the delivery predicate are pinned, so the constant governs exactly one class', async () => {
    const { hasUserSeenRunAnalysisResult: real } = await import(
      '../../context/run-initiator.js'
    );
    const autoRun = AUTO_RUN_PRIOR();
    // Fail-closed — what production ships, and what this file's cases describe.
    expect(real(autoRun, false)).toBe(false);
    // Delivered — the counterfactual, pinned in `coaching-auto-run-delivered.test.ts`.
    expect(real(autoRun, true)).toBe(true);
    // A user-initiated run is TRUE in BOTH postures — the flag governs exactly
    // one class of fact, and a flip that moved this one would be the
    // co-tightening trap 21 forbids.
    expect(real(USER_RUN_PRIOR(), false)).toBe(true);
    expect(real(USER_RUN_PRIOR(), true)).toBe(true);
  });

  it('THE FAIL-CLOSED PIN: auto-run delivery is OFF at this tip, and the cost of that is named', async () => {
    // ⚠ A CONSTANT IS A HAND-MAINTAINED MIRROR (CLAUDE.md trap #12), so it is
    // asserted rather than left to be remembered. It has now moved TWICE, which
    // is the argument for asserting it rather than describing it in prose.
    //
    // It reads `false` because the DELIVERED posture was refuted by a second
    // deployed witness on 2026-09-11: a first-ever successful analysis narrated
    // "The result is unchanged: <option> still leads", with both prior runs
    // REFUSED and the panel reading "No analysis has run yet for this model".
    //
    // ⭐ THE COST IS REAL AND IS NOT HIDDEN. Users who genuinely DID see the
    // provisional result now lose the re-run acknowledgement: their second
    // analysis is narrated as their first. Under-claiming is the right side of
    // the trade — it tells a user less than we know, where the other posture
    // asserted a comparison against something they never saw — but a future
    // session weighing a flip back must weigh a real loss, not a free one.
    //
    // ⚠⚠ NEITHER POSTURE IS CORRECT. The delivery hook arms only on a `running`
    // verdict and returns `delivered | already_held | deadline | aborted |
    // unreadable`; a constant cannot distinguish those five outcomes because it
    // is an estate-wide claim about a CHANNEL and the question is per-USER. Only
    // a DELIVERY RECEIPT can, and CEE has no surface to record one on
    // (`v5_handler_facts` is append-only; no `SessionStore` method updates a
    // fact), so it rides the NEXT REQUEST instead. That is the successor, and
    // this pin is what makes its absence loud rather than forgotten.
    //
    // ⚠ ONE PREMISE THIS PIN CARRIED WAS STALE AND IS CORRECTED IN PLACE
    // (2026-09-11). It read: "`serverGraphHydration.ts` is UNTOUCHED by that PR,
    // so the BOOT path never applies the analysis", derived at UI #752's head
    // `fe1944af`. At the DEPLOYED UI build `b93904c9` that file is NOT untouched
    // — it imports `applyBootAnalysisVerdict` / `applyBootLeaderClaimWithholding`
    // at line 25. ⭐ THE CONCLUSION SURVIVES AND ONLY THE PREMISE MOVED:
    // `'running'` is in that file's BOOT-DECLINED set, and the file writes no
    // analysis RESULTS at all (target 0; contrast control `useCanvasStore` reads
    // 9 in the same file, so the sweep is not blind). The boot path still never
    // applies the analysis. Corrected rather than deleted, because a session
    // reading the stale premise would conclude the residual had closed.
    const real = await import('../../context/run-initiator.js');
    expect(real.AUTO_RUN_RESULT_REACHES_USER).toBe(false);
  });
});
