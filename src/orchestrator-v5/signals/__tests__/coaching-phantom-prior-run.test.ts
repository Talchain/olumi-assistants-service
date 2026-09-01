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
 * the post-draft auto-run, REMOVED 2026-09-01 (route-v2's draft_graph branch, ungated by
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
 * that would change it (CEE #1010, UI #752) are BOTH unmerged.
 *
 * ── WHAT IS PINNED HERE ─────────────────────────────────────────────────────
 * Every case binds BY IDENTITY — to the production copy constant, to the
 * marker's `initiated_by` value, to the specific fact object — never to a value
 * predicate another fixture could satisfy (CLAUDE.md trap #19). And every
 * suppression case has its OPPOSITE-DIRECTION TWIN (trap 22b): a fix that
 * closes a false "you already saw this" must not open a false "this is your
 * first", so both harms are watched, not one door.
 */

import { describe, expect, it, vi } from 'vitest';

import type { HandlerFact } from '@talchain/schemas/orchestrator';

import type { SuccessfulHandlerOutcome } from '../../tools/handler-outcome.js';
// ⚠ `AUTO_RUN_RESULT_REACHES_USER` and `hasUserSeenRunAnalysisResult` are NOT
// imported here on purpose. The mock below injects the pre-delivery posture over
// this module, so a file-level import of either would hand the tests the
// injection back and let them agree with themselves (CLAUDE.md trap #13b). Every
// test that needs the SHIPPED answer reaches for it with `vi.importActual`.
import {
  buildAutoRunProvenance,
  isAutoInitiatedRunAnalysisFact,
  RUN_PROVENANCE_ENRICHMENT_KEY,
} from '../../context/run-initiator.js';
import { RUN_PROVENANCE_ENRICHMENT_KEY as KEY_REEXPORTED_BY_THE_WRITER } from '../../handlers/chip-click-dispatch.js';
import { COACHING_TEXT, detectCoachingSignal } from '../coaching-signals.js';

// ── the posture switch: PRE-DELIVERY ────────────────────────────────────────
//
// ⭐ THIS MOCK IS NOT DECORATION — IT IS WHAT KEEPS #1058 UNDER TEST AFTER THE
// FLIP. `AUTO_RUN_RESULT_REACHES_USER` is `true` in production from the change
// that flipped it alongside UI #752, so the suppression cases below no longer
// describe production. They still describe a REACHABLE state — see the
// residual-exposure note on the deploy-ordering pin at the foot of this file —
// and they describe the exact defect the witness in this header recorded. So
// the pre-delivery posture is INJECTED here rather than deleted, and this file
// and `coaching-auto-run-delivered.test.ts` have swapped roles: that one is now
// production, this one is the counterfactual.
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
    AUTO_RUN_RESULT_REACHES_USER: false,
    hasUserSeenRunAnalysisResult: (fact: HandlerFact): boolean =>
      actual.hasUserSeenRunAnalysisResult(fact, false),
  };
});

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
  it('POSITIVE CONTROL: the pre-delivery posture actually reaches the predicate production calls', async () => {
    // Without this, every suppression assertion below would pass or fail for
    // reasons invisible here (CLAUDE.md trap #13: an absence probe with no
    // positive control is vacuous). The injection must be observable AT the
    // predicate, and it must DISCRIMINATE — so the contrast is asserted in the
    // same test, against the REAL module.
    const injected = await import('../../context/run-initiator.js');
    const real = await vi.importActual<typeof import('../../context/run-initiator.js')>(
      '../../context/run-initiator.js',
    );
    expect(injected.AUTO_RUN_RESULT_REACHES_USER).toBe(false);
    expect(injected.hasUserSeenRunAnalysisResult(AUTO_RUN_PRIOR())).toBe(false);
    // …and the contrast: production ships the DELIVERED posture. If these two
    // ever read the same value, this file has stopped being a counterfactual
    // and every suppression case below is silently re-testing production.
    expect(real.AUTO_RUN_RESULT_REACHES_USER).toBe(true);
    expect(real.hasUserSeenRunAnalysisResult(AUTO_RUN_PRIOR())).toBe(true);
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
    // The whole point of the #1010 split, and it SURVIVES the flip — which is
    // the thing worth pinning. Before delivery the two answers differed on the
    // same object; now they agree on it. If the split were only ever a restating
    // of the stamp, that agreement would make it vanish. It does not: delivery
    // still moves with the POSTURE while provenance is immovable, so the
    // discrimination is carried by the explicit parameter rather than by the
    // constant's happening to be `false` (CLAUDE.md trap #12b: a control pinned
    // to whatever is current decays into a tautology the moment current moves).
    const real = await vi.importActual<typeof import('../../context/run-initiator.js')>(
      '../../context/run-initiator.js',
    );
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
    // ⚠ Bound to the REAL module. Reading the file-level import here would ask
    // the injection what the injection says — a guard agreeing with itself
    // (CLAUDE.md trap #13b).
    const { hasUserSeenRunAnalysisResult: real } = await vi.importActual<
      typeof import('../../context/run-initiator.js')
    >('../../context/run-initiator.js');
    const autoRun = AUTO_RUN_PRIOR();
    // Pre-delivery — what this file's suppression cases describe.
    expect(real(autoRun, false)).toBe(false);
    // Delivered — what production ships.
    expect(real(autoRun, true)).toBe(true);
    // A user-initiated run is TRUE in BOTH postures — the flag governs exactly
    // one class of fact, and a flip that moved this one would be the
    // co-tightening trap 21 forbids.
    expect(real(USER_RUN_PRIOR(), false)).toBe(true);
    expect(real(USER_RUN_PRIOR(), true)).toBe(true);
  });

  it('THE DEPLOY-ORDERING PIN: auto-run delivery is ON at this tip, and the residual exposure is named', async () => {
    // ⚠ A CONSTANT IS A HAND-MAINTAINED MIRROR (CLAUDE.md trap #12), so it is
    // asserted rather than left to be remembered — and asserted against the
    // REAL module, because the file-level import is injected above.
    //
    // It reads `true` because UI #752 renders the auto-run's result: the
    // scenario-graph read leg returns the committed analysis and
    // `canvas/hooks/useProvisionalAnalysisDelivery.ts` applies it without
    // another turn. Flipped LATE it would have left the inversion (a genuine
    // re-run narrated as a first analysis); flipped EARLY it re-opens #1058.
    //
    // ⚠⚠ AND THE FLIP DOES NOT CLOSE #1058 — IT NARROWS IT. Derived at UI
    // #752's head `fe1944af`: the delivery hook arms only on a `running`
    // verdict and returns `delivered | already_held | deadline | aborted |
    // unreadable`; `serverGraphHydration.ts` is UNTOUCHED by that PR, so the
    // BOOT path never applies the analysis. A user who navigates away or
    // reloads inside the ~20s run therefore never sees the result, and this
    // constant still asserts they did — #1058, verbatim, on that path. Only a
    // per-user DELIVERY RECEIPT can distinguish those outcomes, and CEE has no
    // surface to record one on (`v5_handler_facts` is append-only; no
    // `SessionStore` method updates a fact). That is the successor, and this
    // pin is what makes its absence loud rather than forgotten.
    const real = await vi.importActual<typeof import('../../context/run-initiator.js')>(
      '../../context/run-initiator.js',
    );
    expect(real.AUTO_RUN_RESULT_REACHES_USER).toBe(true);
  });
});
