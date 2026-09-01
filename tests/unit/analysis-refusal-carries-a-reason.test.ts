/**
 * A REFUSED RUN MUST SAY WHY — the silent-refusal defect.
 *
 * ── THE QUESTION THIS SUITE ANSWERS, AND THE ONE IT DOES NOT ───────────────
 * `tests/unit/decision-free-model.test.ts` answers *"is the zero-option SHAPE
 * admitted by the validators?"* — and the answer is yes, deliberately, for the
 * exploratory map. THIS suite answers a different question (trap 21): *"when
 * run admission REFUSES, does the product hand the user a reason?"* The two
 * must not be collapsed: a graph can be perfectly legal to hold and still be
 * un-analysable, and that refusal is where the product either coaches or goes
 * silent.
 *
 * ── THE DEFECT, MEASURED AT `1a3f8c56` BEFORE THE FIX ──────────────────────
 * A model with no alternatives to compare — the state a DIAGNOSIS brief should
 * legitimately reach, where the team has named explanations but no course of
 * action — produced this:
 *
 *   readiness   status: "analysis_ready"   safeToAnalyse: TRUE   nextStep: null
 *   admission   willProceed: FALSE         blockedNextStep: NULL
 *
 * The run is refused and the user is told NOTHING. Every other refusal in the
 * branch space carries a real sentence; only this one is silent, so the silence
 * is a genuine discrimination and not an artefact of the corpus.
 *
 * The refusing branch's own comment claims the opposite — *"A local refusal is
 * immediate and explicable"* (`analysis-ready-core.ts`, the IDENTICAL_OPTIONS
 * floor). It was immediate and it was not explicable. This suite pins the
 * property that comment asserts.
 *
 * ── WHY THE INVARIANT IS STRUCTURAL AND NOT A CASE LIST ────────────────────
 * The fix is ONE derivation in `resolveRunAdmission`, which is already the
 * module's designated single derivation point for `blockedNextStep`. So the
 * guard is written as a PROPERTY over the enumerated branch space — *every*
 * refusal carries a reason — rather than as an assertion about the one cell
 * that moved. A per-case list would pass while a NEW silent return site was
 * added; the property cannot.
 *
 * ── OPPOSITE-DIRECTION TWINS (the whole risk) ──────────────────────────────
 * The harm this fix could trade for is overwriting the SPECIFIC refusals with a
 * generic one, or attaching a refusal sentence to a run that proceeds. Both
 * directions are pinned below, by exact string identity, and both fail if the
 * `??` fallback is widened into an unconditional assignment.
 */

import { describe, it, expect } from 'vitest';
import {
  resolveRunAdmission,
  AnalysisNotReadyError,
  NO_COMPARISON_NEXT_STEP,
} from '../../src/orchestrator-v5/tools/handlers/analysis-ready-core.js';
// The PRODUCTION Run-analysis chain, imported whole so the surface assertions
// below run over the real functions rather than a re-implementation of them.
import { loadScenarioSnapshotForRunAnalysis } from '../../src/orchestrator-v5/build-turn-context.js';
import { createRunAnalysisHandler } from '../../src/orchestrator-v5/tools/handlers/run-analysis.js';
import { HandlerInvocationFailedError } from '../../src/orchestrator-v5/tools/handler-errors.js';
import { composeHandlerFailure } from '../../src/orchestrator-v5/compose/handler-failure-responses.js';
import type { HandlerInvocation } from '../../src/orchestrator-v5/tools/registry.js';
import type { SessionStore } from '../../src/orchestrator-v5/session/store.js';
import type { ComposeContext } from '../../src/orchestrator-v5/compose/types.js';

// =============================================================================
// Shape builders — the branch space, enumerated rather than hand-picked
// =============================================================================

const edge = (from: string, to: string) => ({
  from,
  to,
  strength: { mean: 0.6, std: 0.1 },
  exists_probability: 0.9,
  effect_direction: 'positive' as const,
});

const factor = (id: string, label: string, category = 'controllable') => ({
  id,
  kind: 'factor',
  label,
  category,
  data: { value: 0.5, extractionType: 'explicit' },
});

const GRAPH_BASE = { version: '1', default_seed: 42 };

/**
 * ZERO ALTERNATIVES — the exploratory map, and the cell that was silent.
 *
 * This is the shape a diagnosis brief should reach: a goal the team wants to
 * understand, the things they think are driving it as FACTORS, and no course of
 * action yet because nobody has proposed one.
 */
const zeroAlternatives = {
  ...GRAPH_BASE,
  nodes: [
    { id: 'goal_1', kind: 'goal', label: 'Understand why retention is slipping' },
    { id: 'out_1', kind: 'outcome', label: 'Retention' },
    // ⚠ `observable`, and the category is LOAD-BEARING for this fixture. A
    // CONTROLLABLE factor on the same shape produces a different, already
    // non-silent refusal ("Choose which option changes for ..."), so a fixture
    // built with the wrong category would pin a cell that was never broken and
    // report a fix for a defect it never reached. Measured both ways at
    // `1a3f8c56`; only the observable arm was silent.
    factor('fac_a', 'Onboarding quality', 'observable'),
  ],
  edges: [edge('fac_a', 'out_1'), edge('out_1', 'goal_1')],
};

/**
 * TWIN OF THE FIXTURE ITSELF — the same zero-option shape with a CONTROLLABLE
 * factor. It was already explicable before this change and must stay that way:
 * proof that the new sentence is reached by the silent cell specifically, and
 * not by "any graph with no options".
 */
const zeroAlternativesControllable = {
  ...GRAPH_BASE,
  nodes: [
    { id: 'goal_1', kind: 'goal', label: 'Understand why retention is slipping' },
    { id: 'out_1', kind: 'outcome', label: 'Retention' },
    factor('fac_a', 'Onboarding quality'),
  ],
  edges: [edge('fac_a', 'out_1'), edge('out_1', 'goal_1')],
};

/** ONE alternative — a decision that is not yet a comparison. */
const oneAlternative = {
  ...GRAPH_BASE,
  nodes: [
    { id: 'goal_1', kind: 'goal', label: 'Grow' },
    { id: 'dec_1', kind: 'decision', label: 'What to do' },
    { id: 'opt_1', kind: 'option', label: 'Do it' },
    { id: 'out_1', kind: 'outcome', label: 'Revenue' },
    factor('fac_a', 'Load'),
  ],
  edges: [edge('dec_1', 'opt_1'), edge('opt_1', 'fac_a'), edge('fac_a', 'out_1'), edge('out_1', 'goal_1')],
};

/** TWO alternatives but no goal — a differently-broken refusal. */
const twoAlternativesNoGoal = {
  ...GRAPH_BASE,
  nodes: [
    { id: 'dec_1', kind: 'decision', label: 'What to do' },
    { id: 'opt_1', kind: 'option', label: 'A' },
    { id: 'opt_2', kind: 'option', label: 'B' },
    factor('fac_a', 'Load'),
  ],
  edges: [edge('dec_1', 'opt_1'), edge('dec_1', 'opt_2'), edge('opt_1', 'fac_a')],
};

/** TWO alternatives, configured and distinct — this one must PROCEED. */
const twoAlternativesConfigured = {
  ...GRAPH_BASE,
  nodes: [
    { id: 'goal_1', kind: 'goal', label: 'Grow revenue' },
    { id: 'dec_1', kind: 'decision', label: 'Which path' },
    { id: 'opt_1', kind: 'option', label: 'Raise price', data: { interventions: { fac_a: 0.8 } }, is_baseline: false },
    { id: 'opt_2', kind: 'option', label: 'Keep as is', data: { interventions: { fac_a: 0.2 } }, is_baseline: true },
    factor('fac_a', 'Price level'),
    { id: 'out_1', kind: 'outcome', label: 'Revenue' },
  ],
  edges: [
    edge('dec_1', 'opt_1'),
    edge('dec_1', 'opt_2'),
    edge('opt_1', 'fac_a'),
    edge('opt_2', 'fac_a'),
    edge('fac_a', 'out_1'),
    edge('out_1', 'goal_1'),
  ],
};

const BRANCH_SPACE: ReadonlyArray<readonly [string, unknown]> = [
  ['no graph at all', null],
  ['zero alternatives (the exploratory map)', zeroAlternatives],
  ['zero alternatives, controllable factor', zeroAlternativesControllable],
  ['one alternative', oneAlternative],
  ['two alternatives, no goal', twoAlternativesNoGoal],
  ['two alternatives, configured', twoAlternativesConfigured],
];

// =============================================================================
// THE PROPERTY — a refusal is never silent
// =============================================================================

describe('run admission — every refusal carries a reason', () => {
  it.each(BRANCH_SPACE)(
    'PROPERTY: %s — willProceed false implies a non-empty next step',
    (_name, graph) => {
      const admission = resolveRunAdmission(graph as never);
      if (admission.willProceed) return; // the proceed case is pinned separately below
      expect(typeof admission.blockedNextStep).toBe('string');
      expect((admission.blockedNextStep ?? '').trim().length).toBeGreaterThan(0);
    },
  );

  it('THE DEFECT: a model with no alternatives is refused, and now says why', () => {
    const admission = resolveRunAdmission(zeroAlternatives as never);
    // Bound by IDENTITY on both terms: the refusal AND the sentence. A value
    // predicate ("some string is present") could be satisfied by a different
    // refusal reaching this graph for a different reason.
    expect(admission.willProceed).toBe(false);
    // ⚠ A LITERAL, NOT THE IMPORTED CONSTANT (adversarial review, 2026-08-31).
    // This assertion previously read `.toBe(NO_COMPARISON_NEXT_STEP)`, i.e. it
    // imported its expected value from the module under test — so a rewrite of
    // the constant would have carried the test with it and stayed green. An
    // expectation derived from the thing it pins is a pin agreeing with itself.
    expect(admission.blockedNextStep).toBe(
      'Name at least two different options you are weighing, then run analysis.',
    );
    // The constant is what the production path uses, so pin that the exported
    // symbol IS this literal rather than assuming it.
    expect(NO_COMPARISON_NEXT_STEP).toBe(
      'Name at least two different options you are weighing, then run analysis.',
    );
  });

  it('the sentence coaches toward NAMING alternatives rather than apologising', () => {
    // Pins the exported constant itself, so a rewrite that turns coaching into
    // an apology or an error message REDs here rather than shipping.
    expect(NO_COMPARISON_NEXT_STEP).toMatch(/\bname\b/i);
    expect(NO_COMPARISON_NEXT_STEP).toMatch(/\boptions\b/i);
    expect(NO_COMPARISON_NEXT_STEP.endsWith('.')).toBe(true);
    // British English, and none of the egress-forbidden furniture.
    expect(NO_COMPARISON_NEXT_STEP).not.toMatch(/[—–]/);
  });
});

// =============================================================================
// OPPOSITE-DIRECTION TWINS — the harm this fix could have traded for
// =============================================================================

describe('run admission — the specific refusals are NOT overwritten', () => {
  /**
   * ⭐ THE LOAD-BEARING TWIN. The fix is a `??` fallback. Widened to an
   * unconditional assignment it would replace every specific, actionable
   * refusal with one generic sentence — strictly worse than the defect, because
   * it would delete working guidance from three branches to fix one.
   *
   * Each expectation is an EXACT string, captured from the pristine tree at
   * `1a3f8c56` before the change, so any drift is visible rather than absorbed.
   */
  it.each([
    ['no graph at all', null, 'Draft or save a model first, then run analysis.'],
    ['one alternative', oneAlternative, 'Review all 2 readiness issues together before analysis.'],
    ['two alternatives, no goal', twoAlternativesNoGoal, 'Review all 2 readiness issues together before analysis.'],
  ] as ReadonlyArray<readonly [string, unknown, string]>)(
    'TWIN: %s keeps its own reason, byte for byte',
    (_name, graph, expected) => {
      const admission = resolveRunAdmission(graph as never);
      expect(admission.willProceed).toBe(false);
      expect(admission.blockedNextStep).toBe(expected);
      // And it is NOT the new sentence — the discrimination, stated positively.
      expect(admission.blockedNextStep).not.toBe(NO_COMPARISON_NEXT_STEP);
    },
  );

  it('TWIN: the same zero-option shape with a controllable factor keeps ITS reason', () => {
    // The discrimination is the silent cell, not "no options". If the fallback
    // were keyed on option count instead of on an absent reason, this would
    // wrongly flip to the new sentence.
    const admission = resolveRunAdmission(zeroAlternativesControllable as never);
    expect(admission.willProceed).toBe(false);
    expect(admission.blockedNextStep).not.toBe(NO_COMPARISON_NEXT_STEP);
    expect((admission.blockedNextStep ?? '').length).toBeGreaterThan(0);
  });

  it('TWIN: a run that PROCEEDS carries no next step at all', () => {
    // The other direction of the same harm: attaching a refusal sentence to a
    // graph that is going to run would put a "do this first" instruction on a
    // screen that is already analysing.
    const admission = resolveRunAdmission(twoAlternativesConfigured as never);
    expect(admission.willProceed).toBe(true);
    expect(admission.blockedNextStep).toBeNull();
  });
});

// =============================================================================
// WHAT THIS SUITE DOES NOT COVER — stated, not implied
// =============================================================================

/**
 * ⚠ SCOPE, so no later reader infers coverage this does not have.
 *
 *  · The corpus above is AUTHOR-BUILT. It enumerates the admission branch space
 *    rather than sampling real briefs, which is appropriate for a STRUCTURAL
 *    invariant over return sites but is not evidence about which shapes real
 *    drafts reach.
 *  · The 14 captured draws in
 *    `tools/graph-evaluator/governed/draft-graph-v5/baseline/` are deliberately
 *    NOT used here. Measured: all 14 are V1-shaped draft output, so all 14 fail
 *    `GraphV3.safeParse` and land in ONE cell (`SCHEMA_INVALID`). Fourteen cases
 *    that all exercise one branch would read as breadth and supply none.
 *  · This suite says nothing about whether a diagnosis brief REACHES the
 *    zero-alternative shape. That depends on how the draft model files an
 *    explanation, which is the records/projection seam and is not touched here.
 */

// =============================================================================
// ⭐⭐ THE SENTENCE MUST REACH A USER — bound to the OUTPUT, not to the function
// =============================================================================

/**
 * ── WHY THIS SECTION EXISTS (adversarial review, 2026-08-31) ───────────────
 * Everything above is true of `resolveRunAdmission` in ISOLATION. A reviewer's
 * complete `rg -a` manifest showed the only prose consumer of `blockedNextStep`
 * — `compose/configure-option-clarify-response.ts:238-240`, reached from
 * `handlers/edit-graph-dispatch.ts:4018` — is gated on a configure-option
 * outcome that resolves an OPTION node with `status: 'needs_encoding'`. A
 * zero-alternatives graph HAS no option node, so that branch cannot fire on the
 * exact shape this suite was written for: the property held and the user still
 * heard nothing. That is this estate's "we build more than we plug in" pattern,
 * and a suite that measures the pure function cannot see it.
 *
 * The surface a user actually reaches is **Run analysis**:
 *
 *   persisted graph
 *     → `loadScenarioSnapshotForRunAnalysis` (build-turn-context.ts)   [REAL]
 *     → `resolveRunAdmission` refuses → `AnalysisNotReadyError`        [REAL]
 *     → `createRunAnalysisHandler` maps it to `analysis_not_ready`     [REAL]
 *         with `details.next_step`
 *     → `composeHandlerFailure` renders `assistant_text`               [REAL]
 *
 * Every hop below is the production function. Nothing is re-implemented and no
 * verdict is hand-built: the only fixtures are the persisted graph and a store
 * that returns it. The assertions bind to `assistant_text` — what a user reads
 * — so a fix that satisfies the pure function and stops short of the screen
 * REDs here.
 *
 * ⚠ SCOPE, stated rather than implied. This is an in-process seam witness over
 * CEE's own functions. It is not a wire capture and not a journey witness: it
 * says nothing about the UI rendering `assistant_text`, and nothing about the
 * `/graph-readiness` panel, which is a SECOND silent surface (`blocker_reason`
 * is emitted only inside `!safeToAnalyse`, and this graph reports
 * `safeToAnalyse: true`). That panel is deliberately untouched here.
 */

describe('run admission — the refusal reaches the user through Run analysis', () => {
  // The exact sentence, written as a LITERAL. Importing the expected value from
  // the module under test would let a rewrite of the constant carry the test
  // with it, which is a pin agreeing with itself.
  const EXPECTED_SENTENCE =
    'Name at least two different options you are weighing, then run analysis.';

  /** The composer's generic stand-in when `next_step` is ABSENT from details. */
  const GENERIC_FALLBACK = 'This scenario needs a quick fix before it can be analysed.';

  const CTX: ComposeContext = { handlerRegistry: {} };
  const INVOCATION = {
    payload: { scenario_id: '11111111-1111-4111-8111-111111111111' },
    requestId: 'req_refusal',
    signal: undefined,
  } as unknown as HandlerInvocation;

  function storeReturning(graph: unknown): SessionStore {
    return {
      loadGraph: async () => graph,
      loadGraphAndBriefText: async () => ({ graph, briefText: null }),
    } as unknown as SessionStore;
  }

  /** The REAL handler over the REAL reader; `plotCalls` proves no run happened. */
  function runAnalysisOver(graph: unknown, plotCalls: { n: number }) {
    return createRunAnalysisHandler({
      plotClient: {
        run: async () => {
          plotCalls.n += 1;
          return { analysis_status: 'computed', results: [], response_hash: 'h', meta: {} };
        },
      } as unknown as Parameters<typeof createRunAnalysisHandler>[0]['plotClient'],
      scenarioReader: async (scenarioId: string) =>
        loadScenarioSnapshotForRunAnalysis(scenarioId, 'req_refusal', storeReturning(graph)),
    });
  }

  async function refusalFor(graph: unknown): Promise<{
    failure: HandlerInvocationFailedError;
    assistantText: string;
    plotCalls: number;
    /**
     * TRUE when this refusal came from the TWO-TERM throw at
     * `build-turn-context.ts:2843` — the one call site that routes through
     * `refusedVerdict`. See `wentThroughRefusedVerdict` below for why that is
     * observable rather than assumed.
     */
    viaRefusedVerdict: boolean;
  }> {
    const plotCalls = { n: 0 };
    const handler = runAnalysisOver(graph, plotCalls);
    let caught: unknown;
    try {
      await handler(INVOCATION);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(HandlerInvocationFailedError);
    const failure = caught as HandlerInvocationFailedError;
    const { response } = composeHandlerFailure(failure, CTX, 'frame');
    return {
      failure,
      assistantText: response.assistant_text,
      plotCalls: plotCalls.n,
      viaRefusedVerdict: wentThroughRefusedVerdict(failure),
    };
  }

  /**
   * ⭐⭐ WHICH THROW DID THIS REFUSAL COME FROM? ASSERTED, NOT COMMENTED.
   *
   * ── WHY THIS EXISTS (review, 2026-08-31) ──────────────────────────────────
   * The two twins below have IDENTICAL assertion shapes, and only one of them
   * is discriminating. `NO_GRAPH` throws at `build-turn-context.ts:2716`
   * (`AnalysisNotReadyError(assessAnalysisReadiness(null))`) and never reaches
   * the two-term admission, so it is structurally blind to any change in
   * `refusedVerdict` — a mutant that stamps unconditionally leaves it green.
   * `oneAlternative` throws at `:2843` and IS the discriminator.
   *
   * Nothing in the tests said which was which; the discrimination rested on
   * routing that no assertion touched. That is precisely the vacuous shape the
   * NO_GRAPH twin was already replaced once for, waiting to come back on the
   * next refactor. So the routing is now OBSERVED.
   *
   * The observable is the SECOND constructor argument. The `:2843` throw passes
   * `admission.assessment.analysisReady` as `structuralReadiness`; the three
   * one-argument throws (`:2716` NO_GRAPH, `:2785`, `:2792`) cannot — the
   * assessor returns `analysisReady: undefined` for a graph it could not
   * identify, and inventing one would be the mirror of the defect this file
   * closes. So a present `structuralReadiness` is a witness that the refusal
   * came through the admission, and therefore through `refusedVerdict`.
   */
  function wentThroughRefusedVerdict(failure: HandlerInvocationFailedError): boolean {
    const cause = (failure as { cause?: unknown }).cause;
    return cause instanceof AnalysisNotReadyError && cause.structuralReadiness !== undefined;
  }

  it('THE DEFECT, HOP 1: the refusal carries the sentence on the wire field the composer reads', async () => {
    const { failure, plotCalls, viaRefusedVerdict } = await refusalFor(zeroAlternatives);
    // Bound by identity on the refusal itself, so a different failure reaching
    // this graph cannot satisfy the assertion.
    expect(failure.cause_kind).toBe('analysis_not_ready');
    // The same routing precondition as the twin below: this refusal reaches the
    // user THROUGH `refusedVerdict`, which is what makes the change observable.
    expect(viaRefusedVerdict).toBe(true);
    // At pristine this key was ABSENT — `run-analysis.ts:337` omits it when
    // `verdict.nextStep === null`, and the thrown verdict was `admission.strict`,
    // whose `nextStep` is null on exactly this cell. Measured RED: `undefined`.
    expect(failure.details.next_step).toBe(EXPECTED_SENTENCE);
    // A refused run must not have called the engine.
    expect(plotCalls).toBe(0);
  });

  it('THE DEFECT, HOP 2: pressing Run analysis on a model with no alternatives puts the sentence on screen', async () => {
    // ⭐ THE USER-REACHABLE OUTPUT, asserted on its own so it bites
    // independently of hop 1. This is what the reviewer asked for: not the pure
    // function's return value, the prose a user reads.
    const { assistantText } = await refusalFor(zeroAlternatives);
    expect(assistantText).toContain(EXPECTED_SENTENCE);
    // The discrimination, stated positively: at pristine the user got the
    // composer's generic stand-in, which names nothing and coaches nothing.
    expect(assistantText).not.toContain(GENERIC_FALLBACK);
  });

  it('TWIN: a NO_GRAPH refusal keeps its own sentence all the way to the screen', async () => {
    // ⚠ THIS TWIN WATCHES A DIFFERENT DOOR THAN IT LOOKS LIKE, and saying so is
    // the point. The null-graph branch throws at `build-turn-context.ts:2716`
    // — `AnalysisNotReadyError(assessAnalysisReadiness(null))` — which never
    // reaches the two-term admission and therefore never calls
    // `refusedVerdict`. Measured: a mutant that made `refusedVerdict` overwrite
    // EVERY refusal SURVIVED this test. It is kept because it pins that the
    // most common refusal is unaffected by the change, but it is NOT the
    // overwrite discriminator; the one below is.
    const { failure, assistantText, viaRefusedVerdict } = await refusalFor(null);
    expect(failure.cause_kind).toBe('analysis_not_ready');
    expect(failure.details.reason_code).toBe('NO_GRAPH');
    expect(assistantText).toContain('Draft or save a model first, then run analysis.');
    expect(assistantText).not.toContain(EXPECTED_SENTENCE);
    // ⚠ AND THE ROUTING, ASSERTED: this refusal does NOT pass through
    // `refusedVerdict`, so it is STRUCTURALLY BLIND to any change in it. Stated
    // as an assertion rather than a comment so the blindness is a pinned fact
    // and not a claim a reader has to take on trust.
    expect(viaRefusedVerdict).toBe(false);
  });

  it('TWIN (THE OVERWRITE DISCRIMINATOR): a refusal that goes THROUGH the same projection keeps its own sentence', async () => {
    // ⭐ The opposite-direction twin that actually bites. A graph with ONE
    // alternative is refused by the STRICT term, so it flows through
    // `resolveRunAdmission` → the `:2843` throw → `refusedVerdict` — the exact
    // code path the fix changed — while carrying a specific, non-null
    // `strict.nextStep` of its own.
    //
    // If `refusedVerdict` were widened from "fill an ABSENT reason" to "stamp
    // the new sentence", this user would be told to name two options when what
    // they actually need is to resolve two readiness issues. That is strictly
    // worse than the silence being fixed: it replaces working guidance with
    // guidance that is wrong for their model.
    const { failure, assistantText, viaRefusedVerdict } = await refusalFor(oneAlternative);
    expect(failure.cause_kind).toBe('analysis_not_ready');
    // ⭐ THE PRECONDITION THIS TWIN'S DISCRIMINATION RESTS ON, PINNED IN-TEST.
    // Without it this test has the same assertion shape as the NO_GRAPH twin
    // above and no reader — or refactor — can tell which one actually reaches
    // the code under test. Asserted FIRST, so if a change ever routes this
    // graph away from the two-term throw the test REDs here, loudly, instead of
    // quietly decaying into a passing tautology.
    expect(viaRefusedVerdict).toBe(true);
    expect(failure.details.next_step).toBe(
      'Review all 2 readiness issues together before analysis.',
    );
    expect(assistantText).toContain('Review all 2 readiness issues together before analysis.');
    expect(assistantText).not.toContain(EXPECTED_SENTENCE);
  });

  it('TWIN: a model with two configured alternatives is never refused at this seam', async () => {
    // The proceed direction, at the surface rather than at the function: proves
    // the refusal path is entered because of the graph and not because the
    // harness refuses everything it is handed.
    const plotCalls = { n: 0 };
    const handler = runAnalysisOver(twoAlternativesConfigured, plotCalls);
    let caught: unknown;
    try {
      await handler(INVOCATION);
    } catch (e) {
      caught = e;
    }
    const refusedNotReady =
      caught instanceof HandlerInvocationFailedError && caught.cause_kind === 'analysis_not_ready';
    expect(refusedNotReady).toBe(false);
  });
});
