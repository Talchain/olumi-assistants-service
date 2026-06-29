/**
 * Behavioural integration test for the chip-click `what_would_flip` path.
 *
 * Reproduces the live staging bug: chip click on a fresh analysis with
 * fragile robustness and a ~6pp margin produced
 *
 *   "The robustness band is currently fragile, so smaller changes are
 *   unlikely to flip the outcome on their own."
 *
 * The sibling source-grep test (`chip-click-dispatch-raw-robustness-wiring`)
 * locks the literal wiring lines so a refactor cannot silently delete the
 * `pickLatestRawRobustness(context.prior_facts)` call. THIS file drives
 * the dispatcher end-to-end with the REAL `what_would_flip` handler and
 * the REAL `composeWhatWouldFlipFallback` composer, and asserts the
 * assistant_text actually committed by the dispatcher contains the
 * corrected copy and never the buggy sentence.
 *
 * What's mocked vs. real:
 *   - `buildTurnContext`     — mocked, returns prior_facts + persistedGraph
 *   - `commitDirectAnswer`   — mocked, captures the response so we can
 *                              inspect `assistant_text` without persisting
 *   - `routeWithToolUse`     — mocked, spied to prove zero LLM calls
 *   - `loadScenarioSnapshotForRunAnalysis` — mocked (defensive; not
 *                              actually consulted on this path)
 *   - HANDLER + COMPOSER     — REAL. The dispatcher receives a registry
 *                              constructed from `createWhatWouldFlipHandler()`
 *                              via the injectable `handlerRegistry` param,
 *                              so the actual fallback prose is generated.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { makeMessagePayload } from '../../__tests__/fixtures.js';

const {
  loadScenarioSnapshotForRunAnalysisMock,
  commitDirectAnswerMock,
  routeWithToolUseSpy,
  buildTurnContextMock,
} = vi.hoisted(() => ({
  loadScenarioSnapshotForRunAnalysisMock: vi.fn(),
  commitDirectAnswerMock: vi.fn(),
  routeWithToolUseSpy: vi.fn(),
  buildTurnContextMock: vi.fn(),
}));

vi.mock('../../build-turn-context.js', async () => {
  const actual = await vi.importActual<typeof import('../../build-turn-context.js')>(
    '../../build-turn-context.js',
  );
  return {
    ...actual,
    loadScenarioSnapshotForRunAnalysis: loadScenarioSnapshotForRunAnalysisMock,
    buildTurnContext: buildTurnContextMock,
  };
});

vi.mock('../../commit.js', () => ({
  commitDirectAnswer: commitDirectAnswerMock,
  computeRequestHash: vi.fn().mockReturnValue('sha256:testhash'),
}));

// Hard guard on the deterministic-bypass contract — no LLM call permitted
// on the chip-click `what_would_flip` path.
vi.mock('../../routing/route-with-tool-use.js', () => ({
  routeWithToolUse: routeWithToolUseSpy,
}));

import type { V5ActionType } from '@talchain/schemas/orchestrator';

import { dispatchDeterministicChipClick } from '../chip-click-dispatch.js';
import { createWhatWouldFlipHandler } from '../../tools/handlers/what-would-flip.js';
import type { HandlerFn, HandlerRegistry } from '../../tools/registry.js';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TURN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

/**
 * Minimal valid GraphV3 shape with the two options the analysis fact
 * references. The structural-readiness derivation is incidental here —
 * what matters is the analysis-affecting graph hash matching the
 * fact's `graph_hash_at_run` so freshness lands on `'fresh'` and the
 * handler reaches the composer rather than the precondition-fail
 * template.
 */
const READY_GRAPH = {
  nodes: [
    { id: 'dec_root', kind: 'decision' as const, label: 'Marketing capacity?' },
    {
      id: 'goal_growth',
      kind: 'goal' as const,
      label: 'Customer growth',
      goal_threshold: 0.8,
    },
    {
      id: 'fac_acquisition_cost',
      kind: 'factor' as const,
      label: 'Acquisition cost',
    },
    {
      id: 'opt_freelance',
      kind: 'option' as const,
      label: 'Freelance Consultant + Moderate Ad Spend',
      interventions: { fac_acquisition_cost: 0.55 },
    },
    {
      id: 'opt_hire',
      kind: 'option' as const,
      label: 'Hire Marketing Manager',
      interventions: { fac_acquisition_cost: 0.7 },
    },
  ],
  edges: [
    {
      from: 'dec_root',
      to: 'opt_freelance',
      strength: { mean: 1, std: 0.1 },
      exists_probability: 1,
      effect_direction: 'positive' as const,
    },
    {
      from: 'dec_root',
      to: 'opt_hire',
      strength: { mean: 1, std: 0.1 },
      exists_probability: 1,
      effect_direction: 'positive' as const,
    },
    {
      from: 'opt_freelance',
      to: 'fac_acquisition_cost',
      strength: { mean: 0.55, std: 0.1 },
      exists_probability: 0.9,
      effect_direction: 'positive' as const,
    },
    {
      from: 'opt_hire',
      to: 'fac_acquisition_cost',
      strength: { mean: 0.7, std: 0.1 },
      exists_probability: 0.9,
      effect_direction: 'positive' as const,
    },
    {
      from: 'fac_acquisition_cost',
      to: 'goal_growth',
      strength: { mean: 0.6, std: 0.1 },
      exists_probability: 1,
      effect_direction: 'positive' as const,
    },
  ],
};

// Typed loosely so happy-path overrides can replace `prior_facts` and
// `persistedGraph` with real-shaped values without narrowing fighting
// us; the dispatcher only reads the fields the build-turn-context layer
// already validates, so a less-strict test fixture is safe here.
const DEFAULT_TURN_CONTEXT: Record<string, unknown> = {
  stage: 'analyse' as const,
  entity_registry: { option_ids: [], goal_id: null },
  capabilities: {
    can_run_analysis: false,
    can_edit_graph: false,
    can_run_decision_review: false,
    can_generate_coaching: false,
    can_invoke_tools: false,
    can_commit_session_state: false,
  },
  messages: [
    { role: 'user' as const, content: 'What could change the outcome?' },
  ],
  session_id: SCENARIO_ID,
  request_id: 'req-flip-behaviour',
  budgets: {
    turn_ms: 30000,
    handler_ms: 20000,
    plot_ms: 15000,
    anthropic_ms: 15000,
    openai_ms: 15000,
  },
  prior_turns: [],
  prior_facts: [],
  scenarioBriefText: null,
  persistedGraph: null,
};

function payloadFor() {
  return makeMessagePayload({
    scenario_id: SCENARIO_ID,
    turn_id: TURN_ID,
    stage: 'analyse',
    message: 'What could change the outcome?',
    turn_class: 'decide',
    source: 'chip_click',
    chip: { action_type: 'what_would_flip' },
  });
}

/**
 * Real handler registry — only `what_would_flip` is registered. The
 * dispatcher's resolver will use it via the `handlerRegistry` override
 * param so the test goes through the REAL composer.
 */
const REAL_REGISTRY: HandlerRegistry = new Map<V5ActionType, HandlerFn>([
  ['what_would_flip', createWhatWouldFlipHandler()],
]);

async function buildFreshFragileContext(opts: {
  readonly margin_pp: number;
  readonly leading_prob: number;
  readonly runner_prob: number;
  /**
   * Optional per-option `results` for the enrichment so the driver-derive
   * path (`compactAnalysis` → `deriveTopDrivers`) surfaces top drivers.
   * Default omits it — the existing tests exercise robustness copy, not
   * driver copy.
   */
  readonly results?: ReadonlyArray<Record<string, unknown>>;
  /**
   * `null` = omit raw `enrichment.robustness` entirely. When set, the
   * `pickLatestRawRobustness` selector will surface
   * `{ level, near_tie_is_tie: false }` and the composer's raw-fragile
   * branch becomes reachable.
   */
  readonly raw_robustness_level: string | null;
  /**
   * `null` = omit `enrichment.robustness_synthesis` entirely. When set,
   * `compactAnalysis.deriveRobustnessLevel` reads this first and
   * `ROBUSTNESS_MAP` canonicalises (`'low'` / `'very_low'` →
   * `'fragile'`). Pass this WITHOUT `raw_robustness_level` to exercise
   * the projected-fragile branch in isolation — proving the composer
   * honours the canonical band even when the raw enrichment block is
   * absent (older facts compatibility).
   */
  readonly synthesis_overall_assessment?: string | null;
  /**
   * Optional `enrichment.flip_thresholds[]` (V5 P0-B). Set to the live
   * staging shape (flip_value null + flip_reason no_effect_within_bounds +
   * margin_sensitivity{movement:'none'}) to drive the honest no-tipping-point
   * composer branch end-to-end.
   */
  readonly flip_thresholds?: ReadonlyArray<Record<string, unknown>>;
}): Promise<typeof DEFAULT_TURN_CONTEXT> {
  // Compute the analysis-affecting graph hash so the prior fact's
  // graph_hash_at_run can match → freshness 'fresh' → composer runs.
  const { computeAnalysisAffectingGraphHash } = await import(
    '../../context/graph-hash.js'
  );
  const { GraphStateIngressSchema } = await import(
    '../../boundary/request-extensions.js'
  );
  const parsed = GraphStateIngressSchema.safeParse(READY_GRAPH);
  if (!parsed.success) throw new Error('test setup: graph parse failed');
  const expectedHash = computeAnalysisAffectingGraphHash(parsed.data)!;

  const enrichment: Record<string, unknown> = {
    option_comparison: [
      {
        option_id: 'opt_freelance',
        option_label: 'Freelance Consultant + Moderate Ad Spend',
        win_probability: opts.leading_prob,
      },
      {
        option_id: 'opt_hire',
        option_label: 'Hire Marketing Manager',
        win_probability: opts.runner_prob,
      },
    ],
    analysis_status: 'computed',
    margin_pp: opts.margin_pp,
    factor_sensitivity: [
      { factor_id: 'fac_acquisition_cost', sensitivity_value: 0.55 },
    ],
  };
  if (opts.results !== undefined) {
    enrichment.results = opts.results;
  }
  if (opts.flip_thresholds !== undefined) {
    enrichment.flip_thresholds = opts.flip_thresholds;
  }
  if (opts.raw_robustness_level !== null) {
    enrichment.robustness = { level: opts.raw_robustness_level };
  }
  if (
    opts.synthesis_overall_assessment !== undefined
    && opts.synthesis_overall_assessment !== null
  ) {
    enrichment.robustness_synthesis = {
      overall_assessment: opts.synthesis_overall_assessment,
    };
  }

  const priorRunAnalysisFact = {
    fact_type: 'run_analysis' as const,
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: 'opt_freelance',
      win_probabilities: {
        opt_freelance: opts.leading_prob,
        opt_hire: opts.runner_prob,
      },
      summary: 'Ran analysis.',
      enrichment,
      graph_hash_at_run: expectedHash,
      computed_at: '2026-04-30T12:00:00.000Z',
    },
  };

  return {
    ...DEFAULT_TURN_CONTEXT,
    prior_facts: [priorRunAnalysisFact],
    persistedGraph: READY_GRAPH,
  };
}

/**
 * Pull the assistant_text the dispatcher actually committed (this is
 * what the wire response carries, so it is the live user-visible string).
 */
function commitedAssistantText(): string {
  expect(commitDirectAnswerMock).toHaveBeenCalledTimes(1);
  const args = commitDirectAnswerMock.mock.calls[0]!;
  const response = args[0] as { assistant_text?: string };
  return response.assistant_text ?? '';
}

describe('chip-click what_would_flip — behavioural regression (PR #196 round-1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    commitDirectAnswerMock.mockResolvedValue({
      response: {},
      performed: true,
      persisted_row_id: 'row-1',
      graphPersisted: false,
    });
  });

  it('fragile robustness + ~6pp margin: response is deterministic, contains fragility/small-change copy, and does NOT contain the buggy "smaller changes are unlikely" sentence (reproduces the live staging bug)', async () => {
    buildTurnContextMock.mockResolvedValueOnce(
      await buildFreshFragileContext({
        leading_prob: 0.49,
        runner_prob: 0.433,
        margin_pp: 5.7,
        raw_robustness_level: 'fragile',
      }),
    );

    const out = await dispatchDeterministicChipClick('what_would_flip', {
      payload: payloadFor(),
      requestId: 'req-flip-fragile-6pp',
      handlerRegistry: REAL_REGISTRY,
    });

    if (out.outcome !== 'ok') {
      throw new Error(`expected ok, got ${out.outcome}`);
    }

    // Determinism contract — no LLM call on the chip-click path.
    expect(routeWithToolUseSpy).not.toHaveBeenCalled();

    const text = commitedAssistantText();

    // Hard regression: the buggy sentence must never reach the user.
    expect(text).not.toContain(
      'The robustness band is currently fragile, so smaller changes are unlikely',
    );
    expect(text).not.toMatch(/smaller changes are unlikely to flip/i);

    // Positive: fragility-aware closing copy.
    expect(text.toLowerCase()).toMatch(/picture appears fragile/);
    expect(text.toLowerCase()).toMatch(
      /small adjustments to the strongest drivers/,
    );
    expect(text.toLowerCase()).toMatch(/shift which option leads/);

    // Sanity: option labels from the fact reach the user.
    expect(text).toContain('Freelance Consultant + Moderate Ad Spend');
  });

  it('canonical fragile band derived from robustness_synthesis (raw enrichment.robustness omitted): deterministically triggers fragility-aware copy', async () => {
    // Round-2 review: the previous version of this test omitted both the
    // raw robustness block AND the synthesis, so the canonical band was
    // not guaranteed to be 'fragile' — making the assertion conditional.
    // `compactAnalysis.deriveRobustnessLevel` reads
    // `robustness_synthesis.overall_assessment` first; `ROBUSTNESS_MAP`
    // maps `'low'` → `'fragile'`. Setting synthesis without the raw
    // block deterministically exercises the projected-fragile branch:
    // raw signals are absent, but `projection.robustness_band === 'fragile'`.
    buildTurnContextMock.mockResolvedValueOnce(
      await buildFreshFragileContext({
        leading_prob: 0.49,
        runner_prob: 0.433,
        margin_pp: 5.7,
        raw_robustness_level: null,
        synthesis_overall_assessment: 'low',
      }),
    );

    const out = await dispatchDeterministicChipClick('what_would_flip', {
      payload: payloadFor(),
      requestId: 'req-flip-canonical-only',
      handlerRegistry: REAL_REGISTRY,
    });

    if (out.outcome !== 'ok') {
      throw new Error(`expected ok, got ${out.outcome}`);
    }

    const text = commitedAssistantText();
    // Hard regression: the buggy sentence must never reach the user.
    expect(text).not.toMatch(/smaller changes are unlikely to flip/i);
    // Deterministic positive: canonical 'fragile' band alone must trigger
    // the fragility-aware closing sentence (composer's projectedFragile
    // branch).
    expect(text.toLowerCase()).toMatch(/picture appears fragile/);
    expect(text.toLowerCase()).toMatch(
      /small adjustments to the strongest drivers/,
    );
  });

  it('neutral driver: deterministic prose says "has little effect" and never strengthen/weaken (end-to-end)', async () => {
    // A driver PLoT marks `direction: 'neutral'` (with a non-trivial unsigned
    // magnitude) must reach the user as no clear directional effect — the
    // reattachment maps it to sensitivity_value 0, so the composer's near-zero
    // band renders "has little effect" instead of "strengthens"/"weakens".
    buildTurnContextMock.mockResolvedValueOnce(
      await buildFreshFragileContext({
        leading_prob: 0.55,
        runner_prob: 0.45,
        margin_pp: 10,
        raw_robustness_level: null,
        results: [
          {
            option_id: 'opt_freelance',
            option_label: 'Freelance Consultant + Moderate Ad Spend',
            win_probability: 0.55,
            outcome_mean: 1,
            factor_sensitivity: [
              // Unsigned magnitude + neutral direction. `fac_runway` is a
              // genuinely external/tunable factor (no option intervenes on it),
              // so the Spine A backstop leaves it in place — the mechanic under
              // test (neutral → "has little effect") is unaffected. (Using the
              // option-controlled `fac_acquisition_cost` here would be correctly
              // suppressed; that path is covered by its own test below.)
              { node_id: 'fac_runway', label: 'Runway', elasticity: 0.6, direction: 'neutral' },
            ],
          },
          {
            option_id: 'opt_hire',
            option_label: 'Hire Marketing Manager',
            win_probability: 0.45,
            outcome_mean: 0.8,
          },
        ],
      }),
    );

    const out = await dispatchDeterministicChipClick('what_would_flip', {
      payload: payloadFor(),
      requestId: 'req-flip-neutral-driver',
      handlerRegistry: REAL_REGISTRY,
    });

    if (out.outcome !== 'ok') {
      throw new Error(`expected ok, got ${out.outcome}`);
    }
    expect(routeWithToolUseSpy).not.toHaveBeenCalled();

    const text = commitedAssistantText();
    expect(text.toLowerCase()).toContain('has little effect');
    expect(text.toLowerCase()).not.toMatch(/strengthens|weakens/);
    // The neutral driver is still named — no raw id leak.
    expect(text).toContain('Runway');
  });

  it('multi-driver: a lower-magnitude DIRECTIONAL driver is selected ahead of a higher-magnitude NEUTRAL driver', async () => {
    // Regression for the chip-click projection ordering bug: before the shared
    // `projectTopDrivers` (sort AFTER neutral → 0), the high-magnitude neutral
    // stayed first and the composer said it "would shift this result the most".
    // Now the directional driver must be named ahead of the neutral one.
    buildTurnContextMock.mockResolvedValueOnce(
      await buildFreshFragileContext({
        leading_prob: 0.55,
        runner_prob: 0.45,
        margin_pp: 10,
        raw_robustness_level: null,
        results: [
          {
            option_id: 'opt_freelance',
            option_label: 'Freelance Consultant + Moderate Ad Spend',
            win_probability: 0.55,
            outcome_mean: 1,
            factor_sensitivity: [
              // Neutral has the LARGER raw magnitude; directional is smaller.
              // Both factors are genuinely external/tunable (no option
              // intervenes on them), so the Spine A backstop leaves them in
              // place — the ordering mechanic under test is unaffected.
              { node_id: 'fac_brand', label: 'Brand sentiment', elasticity: 0.8, direction: 'neutral' },
              { node_id: 'fac_runway', label: 'Runway', elasticity: 0.4, direction: 'negative' },
            ],
          },
          {
            option_id: 'opt_hire',
            option_label: 'Hire Marketing Manager',
            win_probability: 0.45,
            outcome_mean: 0.8,
          },
        ],
      }),
    );

    const out = await dispatchDeterministicChipClick('what_would_flip', {
      payload: payloadFor(),
      requestId: 'req-flip-multi-driver',
      handlerRegistry: REAL_REGISTRY,
    });
    if (out.outcome !== 'ok') {
      throw new Error(`expected ok, got ${out.outcome}`);
    }
    expect(routeWithToolUseSpy).not.toHaveBeenCalled();

    const text = commitedAssistantText();
    // Both named, but the directional driver leads (appears first).
    expect(text).toContain('Runway');
    expect(text).toContain('Brand sentiment');
    expect(text.indexOf('Runway')).toBeLessThan(text.indexOf('Brand sentiment'));
    // Honest direction: the directional driver weakens; the neutral one has
    // little effect (and is never mis-signed as strengthen/weaken).
    expect(text.toLowerCase()).toMatch(/weakens/);
    expect(text.toLowerCase()).toContain('has little effect');
  });

  it('Spine A: an option-controlled lever is NOT named as a tunable driver (end-to-end)', async () => {
    // READY_GRAPH wires both options to intervene on `fac_acquisition_cost`, so
    // it is an option-controlled lever — not an independently tunable external
    // driver. The Spine A backstop must keep it out of the deterministic "what
    // would shift the result" prose even though it is the only/strongest
    // sensitivity entry, closing the lever-as-sensitivity leak on the chip-click
    // path while the producer fix (Lane A1) is pending. Values are preserved;
    // the driver is simply not surfaced as tunable.
    buildTurnContextMock.mockResolvedValueOnce(
      await buildFreshFragileContext({
        leading_prob: 0.55,
        runner_prob: 0.45,
        margin_pp: 10,
        raw_robustness_level: null,
        results: [
          {
            option_id: 'opt_freelance',
            option_label: 'Freelance Consultant + Moderate Ad Spend',
            win_probability: 0.55,
            outcome_mean: 1,
            factor_sensitivity: [
              { node_id: 'fac_acquisition_cost', label: 'Acquisition cost', elasticity: 0.7, direction: 'negative' },
            ],
          },
          {
            option_id: 'opt_hire',
            option_label: 'Hire Marketing Manager',
            win_probability: 0.45,
            outcome_mean: 0.8,
          },
        ],
      }),
    );

    const out = await dispatchDeterministicChipClick('what_would_flip', {
      payload: payloadFor(),
      requestId: 'req-flip-controlled-lever-suppressed',
      handlerRegistry: REAL_REGISTRY,
    });
    if (out.outcome !== 'ok') {
      throw new Error(`expected ok, got ${out.outcome}`);
    }
    expect(routeWithToolUseSpy).not.toHaveBeenCalled();

    const text = commitedAssistantText();
    // The option-controlled lever must not be named as a sensitivity driver,
    // and the response must still be a valid, non-empty answer.
    expect(text).not.toContain('Acquisition cost');
    expect(text.length).toBeGreaterThan(0);
    expect(text.toLowerCase()).not.toMatch(/would shift this result the most/);
  });

  it('Spine A raw-graph: suppresses a lever whose interventions live in node.data.interventions (GraphV3-stripped)', async () => {
    // Same controlled lever, but the persisted graph stores the option
    // interventions under `node.data.interventions` instead of the canonical
    // top-level `node.interventions`. GraphV3.safeParse strips `node.data`, so
    // the backstop only catches this because the chip-click path reads the RAW
    // persisted graph (the regression for review point #4).
    const dataInterventionsGraph = {
      nodes: [
        { id: 'dec_root', kind: 'decision', label: 'Marketing capacity?' },
        { id: 'goal_growth', kind: 'goal', label: 'Customer growth', goal_threshold: 0.8 },
        { id: 'fac_acquisition_cost', kind: 'factor', label: 'Acquisition cost' },
        { id: 'opt_freelance', kind: 'option', label: 'Freelance Consultant + Moderate Ad Spend', data: { interventions: { fac_acquisition_cost: 0.55 } } },
        { id: 'opt_hire', kind: 'option', label: 'Hire Marketing Manager', data: { interventions: { fac_acquisition_cost: 0.7 } } },
      ],
      edges: READY_GRAPH.edges,
    };
    const ctx = await buildFreshFragileContext({
      leading_prob: 0.55,
      runner_prob: 0.45,
      margin_pp: 10,
      raw_robustness_level: null,
      results: [
        {
          option_id: 'opt_freelance',
          option_label: 'Freelance Consultant + Moderate Ad Spend',
          win_probability: 0.55,
          outcome_mean: 1,
          factor_sensitivity: [
            { node_id: 'fac_acquisition_cost', label: 'Acquisition cost', elasticity: 0.7, direction: 'negative' },
          ],
        },
        {
          option_id: 'opt_hire',
          option_label: 'Hire Marketing Manager',
          win_probability: 0.45,
          outcome_mean: 0.8,
        },
      ],
    });
    buildTurnContextMock.mockResolvedValueOnce({ ...ctx, persistedGraph: dataInterventionsGraph });

    const out = await dispatchDeterministicChipClick('what_would_flip', {
      payload: payloadFor(),
      requestId: 'req-flip-data-interventions',
      handlerRegistry: REAL_REGISTRY,
    });
    if (out.outcome !== 'ok') {
      throw new Error(`expected ok, got ${out.outcome}`);
    }
    const text = commitedAssistantText();
    expect(text).not.toContain('Acquisition cost');
  });

  // V5 P0-B — the live staging failure, reproduced end-to-end and fixed.
  // Build cef69b0, scenario e22aa97b: the served answer said the picture was
  // fragile and "small adjustments could shift which option leads" while the
  // flip analysis had found NO single-factor tipping point within bounds.
  it('no_practical_flip (flip_value null + no_effect_within_bounds, margin movement none) on a fragile band: answers honestly, SUPPRESSES the contradiction, emits non-empty blocks + suggested_actions, and never calls the LLM', async () => {
    buildTurnContextMock.mockResolvedValueOnce(
      await buildFreshFragileContext({
        leading_prob: 0.66,
        runner_prob: 0.32,
        margin_pp: 34,
        // Fragile band: WITHOUT flip evidence this would emit the contradiction.
        raw_robustness_level: 'fragile',
        // The exact live-staging flip_thresholds shape.
        flip_thresholds: [
          {
            factor_id: 'fac_hiring_cost',
            factor_label: 'Hiring and Salary Cost',
            flip_value: null,
            direction: 'increase',
            flip_reason: 'no_effect_within_bounds',
            margin_sensitivity: {
              movement: 'none',
              strongest_delta_abs: null,
              display_value_available: false,
            },
          },
        ],
      }),
    );

    const out = await dispatchDeterministicChipClick('what_would_flip', {
      payload: payloadFor(),
      requestId: 'req-flip-no-practical',
      handlerRegistry: REAL_REGISTRY,
    });
    if (out.outcome !== 'ok') throw new Error(`expected ok, got ${out.outcome}`);

    // (1) Deterministic — no LLM router call.
    expect(routeWithToolUseSpy).not.toHaveBeenCalled();

    // (2) Honest answer text.
    const text = commitedAssistantText();
    expect(text.toLowerCase()).toMatch(
      /no single factor on its own reached a tipping point/,
    );
    // The exact live-staging contradiction must be gone.
    expect(text.toLowerCase()).not.toMatch(/could shift which option leads/);
    expect(text.toLowerCase()).not.toMatch(/picture appears fragile/);

    // (3) Non-empty blocks + suggested_actions (P0 #3).
    const response = commitDirectAnswerMock.mock.calls[0]![0] as {
      blocks?: ReadonlyArray<{ type: string }>;
      suggested_actions?: ReadonlyArray<unknown>;
    };
    expect(response.blocks?.some((b) => b.type === 'analysis_result')).toBe(true);
    expect((response.suggested_actions ?? []).length).toBeGreaterThan(0);
  });
});
