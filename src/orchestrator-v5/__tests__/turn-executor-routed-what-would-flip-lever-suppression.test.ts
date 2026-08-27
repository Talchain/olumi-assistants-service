/**
 * P0b-2 — routed `what_would_flip` lever suppression (chip-click parity).
 *
 * The chip-click `what_would_flip` path already suppresses option-pinned levers
 * from the flip evidence (chip-click-dispatch.ts → filterFlipSummaryEntries), so
 * the deterministic fallback composer's "concrete" branch
 * (explanation-fallback.ts: "X is the most likely single factor to change which
 * option leads, so it is the clearest one to test.") can never name a lever.
 *
 * The ROUTED (Sonnet-classified, non-chip) path threaded the RAW
 * `pickLatestFlipSummary(prior_facts)` into the handler invocation WITHOUT that
 * filter (turn-executor.ts ~L4495), so a routed `what_would_flip` turn could name
 * an option-pinned lever as the clearest thing to test. #309 closed P0b-1 on the
 * re-projection/chip surfaces and deliberately deferred the routed path (P0b-2).
 *
 * This test drives the REAL `runTurnExecutor` for a routed `what_would_flip`
 * turn and captures the `flipSummary` actually threaded into the handler
 * invocation (the exact value the deterministic fallback composer would name).
 * The composer's "name the concrete entries as the clearest to test" behaviour
 * is independently locked by the chip-click behavioural tests
 * (`chip-click-what-would-flip-behaviour.test.ts`), so asserting on the threaded
 * `flipSummary.entries` is asserting on what the user-facing prose can name.
 *
 *   RED  (before fix): the threaded summary still contains the option-pinned
 *                      lever `fac_acquisition_cost` → composer would name it.
 *   GREEN (after fix):  the lever is dropped; the genuine non-pinned factor
 *                      `fac_market_demand` survives; a no-lever turn is unchanged.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { MessageTurnPayload } from '@talchain/schemas/boundary';

import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import { GraphStateIngressSchema } from '../boundary/request-extensions.js';
import { createWhatWouldFlipHandler } from '../tools/handlers/what-would-flip.js';
import type { HandlerFn, HandlerInvocation, HandlerRegistry } from '../tools/registry.js';
import type { FlipSummary } from '../compose/flip-proposal.js';
import type { V5ActionType } from '@talchain/schemas/orchestrator';

const SCENARIO_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const mockState: {
  priorTurns: Array<Record<string, unknown>>;
  priorFacts: Array<Record<string, unknown>>;
  persistedGraph: unknown | null;
} = { priorTurns: [], priorFacts: [], persistedGraph: null };
const appendCalls: unknown[][] = [];

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (...args: unknown[]) => {
      appendCalls.push(args);
      return { id: `row-${randomUUID()}` };
    },
    readRecent: async () => mockState.priorTurns,
    readFactsFor: async () => mockState.priorFacts,
    invalidateScoped: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => mockState.persistedGraph,
    loadGraphAndBriefText: async () => ({ graph: mockState.persistedGraph, briefText: null }),
    ensureScenarioExists: async () => ({ user_id: null }),
    readMostRecentPendingActions: async () => [],
  }),
  resetSessionStoreForTests: () => undefined,
}));

// Route the turn to `what_would_flip` (execute) deterministically — no real LLM.
// The proposal carries a short answer_text so the side-band validator marks it
// unusable, mirroring the real routed-fallback trigger; the spy handler below
// captures the threaded flipSummary regardless.
const routeWithToolUseMock = vi.fn();
vi.mock('../routing/route-with-tool-use.js', async () => {
  const actual = await vi.importActual<typeof import('../routing/route-with-tool-use.js')>(
    '../routing/route-with-tool-use.js',
  );
  return { ...actual, routeWithToolUse: routeWithToolUseMock };
});

const { runTurnExecutor } = await import('../turn-executor.js');

/**
 * Both options intervene on `fac_acquisition_cost` → it is an option-pinned
 * lever (collectInterventionControlledFactorIds picks it up). `fac_market_demand`
 * is a genuine external/tunable factor (no option intervenes on it).
 */
const READY_GRAPH = {
  nodes: [
    { id: 'dec_root', kind: 'decision' as const, label: 'Marketing capacity?' },
    { id: 'goal_growth', kind: 'goal' as const, label: 'Customer growth', goal_threshold: 0.8 },
    { id: 'fac_acquisition_cost', kind: 'factor' as const, label: 'Acquisition cost' },
    { id: 'fac_market_demand', kind: 'factor' as const, label: 'Market demand' },
    { id: 'opt_freelance', kind: 'option' as const, label: 'Freelance + Moderate Ad Spend', interventions: { fac_acquisition_cost: 0.55 } },
    { id: 'opt_hire', kind: 'option' as const, label: 'Hire Marketing Manager', interventions: { fac_acquisition_cost: 0.7 } },
  ],
  edges: [
    { from: 'dec_root', to: 'opt_freelance', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const },
    { from: 'dec_root', to: 'opt_hire', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const },
    { from: 'opt_freelance', to: 'fac_acquisition_cost', strength: { mean: 0.55, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' as const },
    { from: 'opt_hire', to: 'fac_acquisition_cost', strength: { mean: 0.7, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' as const },
    { from: 'fac_acquisition_cost', to: 'goal_growth', strength: { mean: 0.6, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const },
    { from: 'fac_market_demand', to: 'goal_growth', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const },
  ],
};

const SUBSTRING_LABEL_GRAPH = {
  ...READY_GRAPH,
  nodes: READY_GRAPH.nodes.map((node) => {
    if (node.id === 'opt_hire') return { ...node, label: 'US expansion' };
    if (node.id === 'fac_acquisition_cost') {
      return { ...node, label: 'US expansion cost' };
    }
    return node;
  }),
};

const SHORT_OPTION_LABEL_GRAPH = {
  ...READY_GRAPH,
  nodes: READY_GRAPH.nodes.map((node) =>
    node.id === 'opt_hire' ? { ...node, label: 'US' } : node,
  ),
};

/** A graph with NO option interventions → controlled set is empty (no-op case). */
const UNPINNED_GRAPH = {
  nodes: [
    { id: 'dec_root', kind: 'decision' as const, label: 'Marketing capacity?' },
    { id: 'goal_growth', kind: 'goal' as const, label: 'Customer growth', goal_threshold: 0.8 },
    { id: 'fac_acquisition_cost', kind: 'factor' as const, label: 'Acquisition cost' },
    { id: 'fac_market_demand', kind: 'factor' as const, label: 'Market demand' },
    { id: 'opt_freelance', kind: 'option' as const, label: 'Freelance + Moderate Ad Spend' },
    { id: 'opt_hire', kind: 'option' as const, label: 'Hire Marketing Manager' },
  ],
  edges: [
    { from: 'dec_root', to: 'opt_freelance', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const },
    { from: 'dec_root', to: 'opt_hire', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const },
    { from: 'fac_acquisition_cost', to: 'goal_growth', strength: { mean: 0.6, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const },
    { from: 'fac_market_demand', to: 'goal_growth', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const },
  ],
};

function priorRunAnalysisFact(graph: typeof READY_GRAPH | typeof UNPINNED_GRAPH): Record<string, unknown> {
  // Hash the PARSED graph so graph_hash_at_run matches the turn-executor's
  // current-graph hash (which is computed post-parse) → freshness 'fresh'.
  const parsed = GraphStateIngressSchema.safeParse(graph);
  if (!parsed.success) throw new Error('test setup: graph parse failed');
  const hash = computeAnalysisAffectingGraphHash(parsed.data)!;
  return {
    fact_type: 'run_analysis' as const,
    fact_version: 1 as const,
    noop: false,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: 'opt_freelance',
      win_probabilities: { opt_freelance: 0.62, opt_hire: 0.38 },
      summary: 'Ran analysis.',
      graph_hash_at_run: hash,
      computed_at: '2026-04-30T12:00:00.000Z',
      // T1 claim safety — the verdict the run_analysis handler stamps on EVERY
      // fact it writes (`projectClaimSafety`, run-analysis.ts). Stamped here for
      // the same reason phase3-lifecycle.test.ts stamps its keep-list fixture:
      // an UNSTAMPED fact FAILS CLOSED (`readMayNameLeadingOptionFromResult`),
      // so without this the turn is treated as WITHHELDING a leading-option
      // claim and the explanation-answer gate
      // (`compose/withheld-explanation-answer.ts`) replaces the routed fallback
      // prose wholesale. This file exists to pin LEVER suppression; it would
      // otherwise silently measure the withheld projection instead — the exact
      // wrong-branch defect TESTING-DISCIPLINE rule 1 was earned by. This
      // fixture represents a healthy, feasible run, so it permits.
      constraint_verdict: {
        may_name_leading_option: true,
        constraint_verdict_state: 'evaluated_feasible',
      },
      enrichment: {
        analysis_status: 'computed',
        margin_pp: 24,
        option_comparison: [
          { option_id: 'opt_freelance', option_label: 'Freelance + Moderate Ad Spend', win_probability: 0.62 },
          { option_id: 'opt_hire', option_label: 'Hire Marketing Manager', win_probability: 0.38 },
        ],
        // Two concrete flip thresholds: an option-pinned lever and a genuine
        // external factor. Both have finite flip_value → overall_status concrete.
        flip_thresholds: [
          { factor_id: 'fac_acquisition_cost', factor_label: 'Acquisition cost', flip_value: 0.6, direction: 'increase' },
          { factor_id: 'fac_market_demand', factor_label: 'Market demand', flip_value: 0.45, direction: 'increase' },
        ],
      },
    },
  };
}

const PRIOR_RA_TURN = {
  id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  scenario_id: SCENARIO_ID,
  user_id: null,
  turn_id: 'prior-turn-run-analysis',
  turn_class: 'handler',
  handler_id: 'run_analysis',
  request_hash: 'sha256:prior-ra',
  response_emitted: true,
  llm_calls_used: 1,
  duration_ms: 200,
  created_at: '2026-04-30T12:00:00.000Z',
};

function mkPayload(message: string): MessageTurnPayload {
  return {
    kind: 'message',
    source: 'composer',
    turn_id: `t-${randomUUID()}`,
    scenario_id: SCENARIO_ID,
    message,
    turn_class: 'decide',
    stage: 'analyse',
  };
}

/** Minimal valid routed tool_call proposing `what_would_flip` (execute). */
function routedWhatWouldFlip() {
  return {
    type: 'tool_call' as const,
    orientationText: '',
    llmCallCount: 1,
    rawResult: { content: [], stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 }, model: 'mock', latencyMs: 0 },
    proposal: {
      intent_class: 'execute' as const,
      action: {
        handler_id: 'what_would_flip',
        entity: {
          id: 'goal_growth',
          kind: 'goal' as const,
          resolution_status: 'resolved' as const,
          resolution_method: 'context_inference' as const,
        },
        parameters: [],
        cited_context_fields: [],
        // Short answer_text → side-band validator marks it unusable (the real
        // routed-fallback trigger). Irrelevant to the spy, kept for fidelity.
        explanation: { answer_text: 'x' },
      },
    },
  };
}

function routedWhatWouldFlipWithAnswer(answerText: string) {
  const routed = routedWhatWouldFlip();
  return {
    ...routed,
    proposal: {
      ...routed.proposal,
      action: {
        ...routed.proposal.action,
        explanation: { answer_text: answerText },
      },
    },
  };
}

let capturedFlip: FlipSummary | null | undefined;

/** Spy handler: captures the threaded flipSummary, returns a minimal outcome. */
function spyWhatWouldFlipHandler(): HandlerFn {
  return async (invocation: HandlerInvocation) => {
    capturedFlip = invocation.flipSummary;
    return {
      assistant_text: 'Here is what could change the outcome.',
      handler_facts: [],
      llm_calls_used: 0,
      suppress_orientation: true,
    };
  };
}

const SPY_REGISTRY: HandlerRegistry = new Map<V5ActionType, HandlerFn>([
  ['what_would_flip', spyWhatWouldFlipHandler()],
]);

// Real handler + composer, for the user-facing-prose regression.
const REAL_REGISTRY: HandlerRegistry = new Map<V5ActionType, HandlerFn>([
  ['what_would_flip', createWhatWouldFlipHandler()],
]);

/**
 * Prior fact carrying BOTH per-option driver sensitivities and flip thresholds
 * for the option-pinned lever (`fac_acquisition_cost`) and a genuine external
 * factor (`fac_market_demand`). Analysed on the canonical READY_GRAPH so the
 * hash matches the persisted graph → freshness fresh.
 */
function priorFactWithDriversAndFlip(
  graph: typeof READY_GRAPH = READY_GRAPH,
): Record<string, unknown> {
  const parsed = GraphStateIngressSchema.safeParse(graph);
  if (!parsed.success) throw new Error('test setup: graph parse failed');
  const hash = computeAnalysisAffectingGraphHash(parsed.data)!;
  const optionLabel = (id: 'opt_freelance' | 'opt_hire'): string =>
    graph.nodes.find((node) => node.id === id)?.label ?? id;
  return {
    fact_type: 'run_analysis' as const,
    fact_version: 1 as const,
    noop: false,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: 'opt_freelance',
      win_probabilities: { opt_freelance: 0.62, opt_hire: 0.38 },
      summary: 'Ran analysis.',
      graph_hash_at_run: hash,
      computed_at: '2026-04-30T12:00:00.000Z',
      // T1 claim safety — the verdict the run_analysis handler stamps on EVERY
      // fact it writes (`projectClaimSafety`, run-analysis.ts). Stamped here for
      // the same reason phase3-lifecycle.test.ts stamps its keep-list fixture:
      // an UNSTAMPED fact FAILS CLOSED (`readMayNameLeadingOptionFromResult`),
      // so without this the turn is treated as WITHHELDING a leading-option
      // claim and the explanation-answer gate
      // (`compose/withheld-explanation-answer.ts`) replaces the routed fallback
      // prose wholesale. This file exists to pin LEVER suppression; it would
      // otherwise silently measure the withheld projection instead — the exact
      // wrong-branch defect TESTING-DISCIPLINE rule 1 was earned by. This
      // fixture represents a healthy, feasible run, so it permits.
      constraint_verdict: {
        may_name_leading_option: true,
        constraint_verdict_state: 'evaluated_feasible',
      },
      enrichment: {
        analysis_status: 'computed',
        margin_pp: 24,
        option_comparison: [
          { option_id: 'opt_freelance', option_label: optionLabel('opt_freelance'), win_probability: 0.62 },
          { option_id: 'opt_hire', option_label: optionLabel('opt_hire'), win_probability: 0.38 },
        ],
        results: [
          {
            option_id: 'opt_freelance',
            option_label: optionLabel('opt_freelance'),
            win_probability: 0.62,
            outcome_mean: 1,
            factor_sensitivity: [
              { node_id: 'fac_acquisition_cost', label: 'Acquisition cost', elasticity: 0.7, direction: 'negative' },
              { node_id: 'fac_market_demand', label: 'Market demand', elasticity: 0.5, direction: 'positive' },
            ],
          },
          { option_id: 'opt_hire', option_label: optionLabel('opt_hire'), win_probability: 0.38, outcome_mean: 0.8 },
        ],
        flip_thresholds: [
          { factor_id: 'fac_acquisition_cost', factor_label: 'Acquisition cost', flip_value: 0.6, direction: 'increase' },
          {
            factor_id: 'fac_market_demand',
            factor_label: 'Market demand',
            flip_value: 0.45,
            direction: 'increase',
            alternative_winner_id: 'opt_hire',
            alternative_winner_label: optionLabel('opt_hire'),
          },
        ],
      },
    },
  };
}

describe('P0b-2 — routed what_would_flip suppresses option-pinned levers (chip-click parity)', () => {
  beforeEach(() => {
    capturedFlip = undefined;
    appendCalls.length = 0;
    routeWithToolUseMock.mockReset();
    routeWithToolUseMock.mockResolvedValue(routedWhatWouldFlip());
    mockState.priorTurns = [PRIOR_RA_TURN];
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('drops the option-pinned lever from the routed flip evidence; the non-pinned factor survives', async () => {
    mockState.priorFacts = [priorRunAnalysisFact(READY_GRAPH)];
    mockState.persistedGraph = READY_GRAPH;

    await runTurnExecutor(mkPayload('Let us keep going with this for now please.'), 'req-p0b2-red', {
      routingAdapter: { chatWithTools: vi.fn() } as never,
      handlerRegistry: SPY_REGISTRY,
      graphState: READY_GRAPH as never,
    });

    expect(routeWithToolUseMock).toHaveBeenCalledTimes(1); // routed (LLM) path, not a deterministic short-circuit
    expect(capturedFlip, 'routed path must thread a flip summary on this turn').toBeTruthy();
    const factorIds = (capturedFlip?.entries ?? []).map((e) => e.factor_id);
    const factorLabels = (capturedFlip?.entries ?? []).map((e) => e.factor_label);

    // NEGATIVE: the option-pinned lever must not reach the composer's
    // "clearest one to test" naming.
    expect(factorIds).not.toContain('fac_acquisition_cost');
    expect(factorLabels).not.toContain('Acquisition cost');

    // POSITIVE: the genuine external/tunable factor still surfaces — no
    // over-suppression, no blanking.
    expect(factorIds).toContain('fac_market_demand');
    expect(factorLabels).toContain('Market demand');
  });

  it('stale request graph vs canonical persisted graph: suppresses the lever from the PERSISTED (canonical) graph, not the lagging request graph', async () => {
    // Client-lag divergence: the canonical PERSISTED graph pins
    // `fac_acquisition_cost` (both options intervene), but the request-supplied
    // `graphState` is stale and carries NO interventions. Freshness derives the
    // current-graph hash from the PERSISTED graph (turn-executor.ts:957-987 —
    // "NOT the request-supplied graphStateForTurn"), so the prior analysis stays
    // fresh and the routed fallback fires. The controlled-ID authority must
    // therefore follow the same canonical (persisted-first) graph freshness
    // trusts — a request-first authority would read the empty intervention set
    // from the stale request graph and leak the pinned lever.
    mockState.priorFacts = [priorRunAnalysisFact(READY_GRAPH)]; // analysed on the canonical graph
    mockState.persistedGraph = READY_GRAPH; // canonical: lever pinned
    mockState.priorTurns = [PRIOR_RA_TURN];

    await runTurnExecutor(mkPayload('Let us keep going with this for now please.'), 'req-p0b2-divergence', {
      routingAdapter: { chatWithTools: vi.fn() } as never,
      handlerRegistry: SPY_REGISTRY,
      graphState: UNPINNED_GRAPH as never, // stale request graph: no interventions
    });

    expect(capturedFlip, 'routed path must thread a flip summary on this turn').toBeTruthy();
    const factorIds = (capturedFlip?.entries ?? []).map((e) => e.factor_id);
    // The pinned lever (per the canonical persisted graph) must be suppressed
    // even though the lagging request graph shows it as unpinned.
    expect(factorIds).not.toContain('fac_acquisition_cost');
    expect(factorIds).toContain('fac_market_demand');
  });

  it('full composer, stale request vs canonical persisted: the routed fallback PROSE never names the pinned lever (top-driver sentence OR flip sentence)', async () => {
    // End-to-end user-facing proof with the REAL what_would_flip handler +
    // composer. The lever is named in TWO places in this response: the
    // top-driver "would shift this result the most" sentence (fed by the
    // ContextPack driver projection) and the flip "clearest one to test"
    // sentence (fed by flipSummary). Both must be suppressed against the
    // canonical persisted graph even when the request graph is stale.
    mockState.priorFacts = [priorFactWithDriversAndFlip()];
    mockState.persistedGraph = READY_GRAPH; // canonical: lever pinned
    mockState.priorTurns = [PRIOR_RA_TURN];

    const result = await runTurnExecutor(mkPayload('Let us keep going with this for now please.'), 'req-p0b2-prose', {
      routingAdapter: { chatWithTools: vi.fn() } as never,
      handlerRegistry: REAL_REGISTRY,
      graphState: UNPINNED_GRAPH as never, // stale request graph: no interventions
    });

    const text = (result.response as { assistant_text?: string }).assistant_text ?? '';
    expect(text.length).toBeGreaterThan(0);
    // The option-pinned lever must not be named ANYWHERE in the routed fallback
    // prose — neither the top-driver nor the flip sentence.
    expect(text).not.toContain('Acquisition cost');
    // The genuine external factor still surfaces.
    expect(text).toContain('Market demand');
  });

  it('no option-pinned entries → threaded flip summary is unchanged (no behavioural change)', async () => {
    // UNPINNED_GRAPH has no interventions → controlled set empty →
    // filterFlipSummaryEntries is a no-op and the routed path threads the raw
    // summary verbatim. Both factors survive, order preserved.
    mockState.priorFacts = [priorRunAnalysisFact(UNPINNED_GRAPH)];
    mockState.persistedGraph = UNPINNED_GRAPH;

    await runTurnExecutor(mkPayload('Let us keep going with this for now please.'), 'req-p0b2-nopin', {
      routingAdapter: { chatWithTools: vi.fn() } as never,
      handlerRegistry: SPY_REGISTRY,
      graphState: UNPINNED_GRAPH as never,
    });

    expect(capturedFlip, 'routed path must thread a flip summary on this turn').toBeTruthy();
    const factorIds = (capturedFlip?.entries ?? []).map((e) => e.factor_id);
    expect(factorIds).toEqual(['fac_acquisition_cost', 'fac_market_demand']);
    expect(capturedFlip?.overall_status).toBe('concrete');
  });

  it('suppressing the sole concrete lever DEMOTES overall_status (concrete → no_practical_flip), not a silent over-claim', async () => {
    // Honesty property (integration-level). When the option-pinned lever is the
    // ONLY concrete flip entry (finite flip_value) and the genuine external
    // factor has no practical flip (`no_effect_within_bounds`, no flip_value),
    // dropping the lever must RE-SUMMARISE the kept entries so the threaded
    // `overall_status` demotes from 'concrete' to 'no_practical_flip'. A stale
    // 'concrete' after the only tipping point was removed would let the composer
    // imply a real single-factor flip still exists — the dishonesty this guards.
    const parsed = GraphStateIngressSchema.safeParse(READY_GRAPH);
    if (!parsed.success) throw new Error('test setup: graph parse failed');
    const hash = computeAnalysisAffectingGraphHash(parsed.data)!;
    const soleConcreteLeverFact: Record<string, unknown> = {
      fact_type: 'run_analysis' as const,
      fact_version: 1 as const,
      noop: false,
      result: {
        scenario_id: SCENARIO_ID,
        leading_option_id: 'opt_freelance',
        win_probabilities: { opt_freelance: 0.62, opt_hire: 0.38 },
        summary: 'Ran analysis.',
        graph_hash_at_run: hash,
        computed_at: '2026-04-30T12:00:00.000Z',
        // See the sibling fixtures above for why this stamp is load-bearing:
        // an unstamped fact fails closed and this lever-suppression pin would
        // silently measure the withheld projection instead.
        constraint_verdict: {
          may_name_leading_option: true,
          constraint_verdict_state: 'evaluated_feasible',
        },
        enrichment: {
          analysis_status: 'computed',
          margin_pp: 24,
          option_comparison: [
            { option_id: 'opt_freelance', option_label: 'Freelance + Moderate Ad Spend', win_probability: 0.62 },
            { option_id: 'opt_hire', option_label: 'Hire Marketing Manager', win_probability: 0.38 },
          ],
          flip_thresholds: [
            // Option-pinned AND the only concrete (finite flip_value) entry.
            { factor_id: 'fac_acquisition_cost', factor_label: 'Acquisition cost', flip_value: 0.6, direction: 'increase' },
            // Genuine external factor with NO practical flip (no flip_value).
            { factor_id: 'fac_market_demand', factor_label: 'Market demand', flip_reason: 'no_effect_within_bounds' },
          ],
        },
      },
    };
    mockState.priorFacts = [soleConcreteLeverFact];
    mockState.persistedGraph = READY_GRAPH;

    await runTurnExecutor(mkPayload('Let us keep going with this for now please.'), 'req-p0b2-demote', {
      routingAdapter: { chatWithTools: vi.fn() } as never,
      handlerRegistry: SPY_REGISTRY,
      graphState: READY_GRAPH as never,
    });

    expect(capturedFlip, 'routed path must thread a flip summary on this turn').toBeTruthy();
    const factorIds = (capturedFlip?.entries ?? []).map((e) => e.factor_id);
    // The pinned concrete lever is dropped; the non-concrete external factor stays.
    expect(factorIds).not.toContain('fac_acquisition_cost');
    expect(factorIds).toContain('fac_market_demand');
    // HONESTY: dropping the sole concrete entry demotes the overall status —
    // proving the routed path re-summarises kept entries rather than leaking a
    // stale 'concrete' verdict.
    expect(capturedFlip?.overall_status).toBe('no_practical_flip');
  });
});

describe('System B — selected canonical option referent continuity', () => {
  beforeEach(() => {
    capturedFlip = undefined;
    appendCalls.length = 0;
    routeWithToolUseMock.mockReset();
    routeWithToolUseMock.mockResolvedValue(
      routedWhatWouldFlipWithAnswer(
        'Freelance plus moderate advertising is the option to focus on because it is currently ahead and should remain the preferred route.',
      ),
    );
    mockState.priorTurns = [PRIOR_RA_TURN];
    mockState.priorFacts = [priorFactWithDriversAndFlip()];
    mockState.persistedGraph = READY_GRAPH;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('makes exact-label and selected deictic turns produce the same canonical targeted answer', async () => {
    const explicit = await runTurnExecutor(
      mkPayload('What would make Hire Marketing Manager win?'),
      'req-referent-explicit',
      {
        routingAdapter: { chatWithTools: vi.fn() } as never,
        handlerRegistry: REAL_REGISTRY,
        graphState: READY_GRAPH as never,
      },
    );

    const requestWithDisagreeingLabel = {
      ...READY_GRAPH,
      nodes: READY_GRAPH.nodes.map((node) =>
        node.id === 'opt_hire'
          ? { ...node, label: 'Request-only decoy option' }
          : node,
      ),
    };
    const deictic = await runTurnExecutor(
      mkPayload('What would make it win?'),
      'req-referent-selected',
      {
        routingAdapter: { chatWithTools: vi.fn() } as never,
        handlerRegistry: REAL_REGISTRY,
        graphState: requestWithDisagreeingLabel as never,
        selectedElements: { node_ids: ['opt_hire'], edge_ids: [] },
      },
    );

    expect(deictic.response.assistant_text).toBe(explicit.response.assistant_text);
    expect(deictic.response.assistant_text).toContain(
      'Hire Marketing Manager would lead instead',
    );
    expect(deictic.response.assistant_text).not.toContain('Freelance plus moderate advertising');
    expect(deictic.response.assistant_text).not.toContain('Request-only decoy option');

    // Read-only by construction: committing the conversational answers may
    // append turn rows, but neither append carries graph bytes and no model
    // version receipt reaches the response.
    expect(appendCalls.length).toBeGreaterThan(0);
    const flipFacts: Array<{ result?: Record<string, unknown> }> = [];
    for (const [write] of appendCalls) {
      const record = write as {
        graph?: unknown;
        handler_facts?: Array<{ fact_type?: string; result?: Record<string, unknown> }>;
      };
      expect(record.graph).toBeUndefined();
      flipFacts.push(
        ...(record.handler_facts ?? []).filter(
          (fact) => fact.fact_type === 'what_would_flip',
        ),
      );
    }
    expect(flipFacts).toHaveLength(2);
    for (const fact of flipFacts) {
      // Null failure reason pins that the deliberately wrong Sonnet answer was
      // valid and was displaced because the canonical target owns the turn —
      // not because the ordinary invalid-answer fallback happened to fire.
      expect(fact.result?.answer_source).toBe('deterministic_fallback');
      expect(fact.result?.fallback_reason).toBeNull();
    }
    expect(JSON.stringify(deictic.response)).not.toContain('model_version_receipt');
  });

  it('preserves generic and factor-targeted Sonnet answers when a canvas option is merely selected', async () => {
    const offshoreGraph = {
      ...READY_GRAPH,
      nodes: READY_GRAPH.nodes.map((node) =>
        node.id === 'opt_hire'
          ? { ...node, label: 'Engage Offshore Partner' }
          : node,
      ),
    };
    const genericAnswer =
      'Market demand and the current acquisition-cost assumptions are the main factors that could change the result, while the present analysis still leaves meaningful uncertainty around the alternatives.';
    routeWithToolUseMock.mockResolvedValue(
      routedWhatWouldFlipWithAnswer(genericAnswer),
    );
    mockState.persistedGraph = offshoreGraph;
    mockState.priorFacts = [priorFactWithDriversAndFlip(offshoreGraph)];

    for (const [message, requestId] of [
      ['What would change the result?', 'req-referent-generic'],
      ['What would change if Acquisition cost increased?', 'req-referent-factor-named'],
      ['What would change if it increased?', 'req-referent-factor-pronoun'],
    ] as const) {
      const result = await runTurnExecutor(mkPayload(message), requestId, {
        routingAdapter: { chatWithTools: vi.fn() } as never,
        handlerRegistry: REAL_REGISTRY,
        graphState: offshoreGraph as never,
        selectedElements: { node_ids: ['opt_hire'], edge_ids: [] },
      });

      // Selection is contextual evidence, not an implicit target. Without a
      // current-message option deictic, the existing valid generic answer is
      // byte-preserved instead of being rewritten for Engage Offshore Partner.
      expect(result.response.assistant_text, message).toBe(genericAnswer);
      expect(JSON.stringify(result.response)).not.toContain('model_version_receipt');
    }

    const flipFacts: Array<{ result?: Record<string, unknown> }> = [];
    for (const [write] of appendCalls) {
      const record = write as {
        graph?: unknown;
        handler_facts?: Array<{ fact_type?: string; result?: Record<string, unknown> }>;
      };
      expect(record.graph).toBeUndefined();
      flipFacts.push(
        ...(record.handler_facts ?? []).filter(
          (fact) => fact.fact_type === 'what_would_flip',
        ),
      );
    }
    expect(flipFacts).toHaveLength(3);
    for (const fact of flipFacts) {
      expect(fact.result?.answer_source).toBe('sonnet');
      expect(fact.result?.fallback_reason).toBeNull();
    }
  });

  it('fails weak when one selected identity is asserted as both option and factor', async () => {
    const crossKindGraph = {
      ...READY_GRAPH,
      nodes: [
        ...READY_GRAPH.nodes,
        { id: 'opt_hire', kind: 'factor' as const, label: 'Conflicting factor identity' },
      ],
    };
    const genericAnswer =
      'Market demand and the current acquisition-cost assumptions are the main factors that could change the result, while the present analysis still leaves meaningful uncertainty around the alternatives.';
    routeWithToolUseMock.mockResolvedValue(
      routedWhatWouldFlipWithAnswer(genericAnswer),
    );
    mockState.persistedGraph = crossKindGraph;
    mockState.priorFacts = [priorFactWithDriversAndFlip(crossKindGraph)];

    const result = await runTurnExecutor(
      mkPayload('What would make it win?'),
      'req-referent-cross-kind',
      {
        routingAdapter: { chatWithTools: vi.fn() } as never,
        handlerRegistry: REAL_REGISTRY,
        graphState: crossKindGraph as never,
        selectedElements: { node_ids: ['opt_hire'], edge_ids: [] },
      },
    );

    // The selection resolver sees the first option row, so this is a real
    // end-to-end falsifier for cross-kind identity handling rather than a test
    // that happens to fail earlier as “selected factor”.
    expect(result.response.assistant_text).toBe(genericAnswer);
    const flipFact = appendCalls
      .flatMap(([write]) => {
        const record = write as {
          handler_facts?: Array<{ fact_type?: string; result?: Record<string, unknown> }>;
        };
        return record.handler_facts ?? [];
      })
      .find((fact) => fact.fact_type === 'what_would_flip');
    expect(flipFact?.result?.answer_source).toBe('sonnet');
    expect(flipFact?.result?.fallback_reason).toBeNull();
    expect(JSON.stringify(result.response)).not.toContain('model_version_receipt');
  });

  it('preserves generic Sonnet truth for a longer factor label and a non-option rank phrase', async () => {
    const genericAnswer =
      'Market demand and the recorded cost assumptions are the main factors that could change the result, while the present analysis still leaves meaningful uncertainty around the alternatives.';
    routeWithToolUseMock.mockResolvedValue(
      routedWhatWouldFlipWithAnswer(genericAnswer),
    );
    mockState.persistedGraph = SUBSTRING_LABEL_GRAPH;
    mockState.priorFacts = [priorFactWithDriversAndFlip(SUBSTRING_LABEL_GRAPH)];

    for (const [message, requestId, withSelection] of [
      [
        'What would change the result?',
        'req-referent-entity-exclusive-control',
        false,
      ],
      [
        'What would change if US expansion cost increased?',
        'req-referent-longer-factor',
        true,
      ],
      [
        'What would make it become the top factor?',
        'req-referent-top-factor',
        true,
      ],
    ] as const) {
      const result = await runTurnExecutor(mkPayload(message), requestId, {
        routingAdapter: { chatWithTools: vi.fn() } as never,
        handlerRegistry: REAL_REGISTRY,
        graphState: SUBSTRING_LABEL_GRAPH as never,
        ...(withSelection
          ? { selectedElements: { node_ids: ['opt_hire'], edge_ids: [] } }
          : {}),
      });
      expect(result.response.assistant_text, message).toBe(genericAnswer);
      expect(JSON.stringify(result.response)).not.toContain('model_version_receipt');
    }

    const writes = appendCalls.map(([write]) => write as {
      graph?: unknown;
      handler_facts?: Array<{ fact_type?: string; result?: Record<string, unknown> }>;
    });
    for (const write of writes) expect(write.graph).toBeUndefined();
    const flipFacts = writes
      .flatMap((write) => write.handler_facts ?? [])
      .filter((fact) => fact.fact_type === 'what_would_flip');
    expect(flipFacts).toHaveLength(3);
    const controlFactBytes = JSON.stringify(flipFacts[0]!.result);
    for (const fact of flipFacts) {
      expect(fact.result?.answer_source).toBe('sonnet');
      expect(fact.result?.fallback_reason).toBeNull();
      expect(JSON.stringify(fact.result)).toBe(controlFactBytes);
    }
  });

  it('retains explicit and licensed deictic targeting beside a longer factor label', async () => {
    mockState.persistedGraph = SUBSTRING_LABEL_GRAPH;
    mockState.priorFacts = [priorFactWithDriversAndFlip(SUBSTRING_LABEL_GRAPH)];

    const explicit = await runTurnExecutor(
      mkPayload('What would make US expansion win?'),
      'req-referent-substring-explicit',
      {
        routingAdapter: { chatWithTools: vi.fn() } as never,
        handlerRegistry: REAL_REGISTRY,
        graphState: SUBSTRING_LABEL_GRAPH as never,
      },
    );
    const deictic = await runTurnExecutor(
      mkPayload('What would make it the leading option?'),
      'req-referent-leading-option',
      {
        routingAdapter: { chatWithTools: vi.fn() } as never,
        handlerRegistry: REAL_REGISTRY,
        graphState: SUBSTRING_LABEL_GRAPH as never,
        selectedElements: { node_ids: ['opt_hire'], edge_ids: [] },
      },
    );

    expect(deictic.response.assistant_text).toBe(explicit.response.assistant_text);
    expect(deictic.response.assistant_text).toContain('US expansion would lead instead');
    expect(deictic.response.assistant_text).not.toContain(
      'Freelance plus moderate advertising',
    );
    const flipFacts = appendCalls
      .flatMap(([write]) => {
        const record = write as {
          graph?: unknown;
          handler_facts?: Array<{ fact_type?: string; result?: Record<string, unknown> }>;
        };
        expect(record.graph).toBeUndefined();
        return record.handler_facts ?? [];
      })
      .filter((fact) => fact.fact_type === 'what_would_flip');
    expect(flipFacts).toHaveLength(2);
    for (const fact of flipFacts) {
      expect(fact.result?.answer_source).toBe('deterministic_fallback');
      expect(fact.result?.fallback_reason).toBeNull();
    }
    expect(JSON.stringify(deictic.response)).not.toContain('model_version_receipt');
  });

  it('does not turn word substrings or market-success language into option authority', async () => {
    const genericAnswer =
      'Market demand and the recorded cost assumptions are the main factors that could change the result, while the present analysis still leaves meaningful uncertainty around the alternatives.';
    routeWithToolUseMock.mockResolvedValue(
      routedWhatWouldFlipWithAnswer(genericAnswer),
    );
    mockState.persistedGraph = SHORT_OPTION_LABEL_GRAPH;
    mockState.priorFacts = [priorFactWithDriversAndFlip(SHORT_OPTION_LABEL_GRAPH)];

    for (const [message, requestId, withSelection] of [
      ['What would change the result?', 'req-referent-boundary-control', false],
      ['What would change for the business?', 'req-referent-business', true],
      ['How much trust would change the result?', 'req-referent-trust', true],
      ['Could it win over customers?', 'req-referent-win-over', true],
      [
        'What would make it win with enterprise buyers?',
        'req-referent-win-with',
        true,
      ],
      [
        'What would make it win? With enterprise buyers, specifically.',
        'req-referent-win-question-continuation',
        true,
      ],
      [
        'Could it win? Over customers, I mean.',
        'req-referent-win-over-continuation',
        true,
      ],
      [
        'Could it win. Over customers, I mean.',
        'req-referent-win-period-continuation',
        true,
      ],
      [
        'What would make it win! I mean win over customers.',
        'req-referent-win-exclamation-continuation',
        true,
      ],
    ] as const) {
      const result = await runTurnExecutor(mkPayload(message), requestId, {
        routingAdapter: { chatWithTools: vi.fn() } as never,
        handlerRegistry: REAL_REGISTRY,
        graphState: SHORT_OPTION_LABEL_GRAPH as never,
        ...(withSelection
          ? { selectedElements: { node_ids: ['opt_hire'], edge_ids: [] } }
          : {}),
      });
      expect(result.response.assistant_text, message).toBe(genericAnswer);
      expect(JSON.stringify(result.response)).not.toContain('model_version_receipt');
    }

    const writes = appendCalls.map(([write]) => write as {
      graph?: unknown;
      handler_facts?: Array<{ fact_type?: string; result?: Record<string, unknown> }>;
    });
    for (const write of writes) expect(write.graph).toBeUndefined();
    const flipFacts = writes
      .flatMap((write) => write.handler_facts ?? [])
      .filter((fact) => fact.fact_type === 'what_would_flip');
    expect(flipFacts).toHaveLength(9);
    const controlFactBytes = JSON.stringify(flipFacts[0]!.result);
    for (const fact of flipFacts) {
      expect(fact.result?.answer_source).toBe('sonnet');
      expect(fact.result?.fallback_reason).toBeNull();
      expect(JSON.stringify(fact.result)).toBe(controlFactBytes);
    }
  });

  it('retains bounded explicit, terminal-win and option-rank positives', async () => {
    mockState.persistedGraph = SHORT_OPTION_LABEL_GRAPH;
    mockState.priorFacts = [priorFactWithDriversAndFlip(SHORT_OPTION_LABEL_GRAPH)];

    const explicit = await runTurnExecutor(
      mkPayload('What would make US win?'),
      'req-referent-us-explicit',
      {
        routingAdapter: { chatWithTools: vi.fn() } as never,
        handlerRegistry: REAL_REGISTRY,
        graphState: SHORT_OPTION_LABEL_GRAPH as never,
      },
    );
    let selectedResponseCount = 0;
    for (const [message, requestId] of [
      ['What would make it win?', 'req-referent-terminal-win'],
      ['What would make it win?!', 'req-referent-terminal-cluster'],
      ['What would make it win??', 'req-referent-repeated-question'],
      ['“What would make it win?”', 'req-referent-curly-quote'],
      ['“What would make it win?”\u00a0', 'req-referent-unicode-whitespace'],
      ['"What would make it win?"', 'req-referent-straight-quote'],
      ['What would make it win?)', 'req-referent-closing-bracket'],
      ['What would make it win?）', 'req-referent-unicode-bracket'],
      ['What would make it the leading option?', 'req-referent-option-rank'],
    ] as const) {
      const result = await runTurnExecutor(mkPayload(message), requestId, {
        routingAdapter: { chatWithTools: vi.fn() } as never,
        handlerRegistry: REAL_REGISTRY,
        graphState: SHORT_OPTION_LABEL_GRAPH as never,
        selectedElements: { node_ids: ['opt_hire'], edge_ids: [] },
      });
      selectedResponseCount += 1;
      expect(result.response.assistant_text, message).toBe(
        explicit.response.assistant_text,
      );
      expect(JSON.stringify(result.response)).not.toContain('model_version_receipt');
    }

    expect(explicit.response.assistant_text).toContain('US would lead instead');
    const flipFacts = appendCalls
      .flatMap(([write]) => {
        const record = write as {
          graph?: unknown;
          handler_facts?: Array<{ fact_type?: string; result?: Record<string, unknown> }>;
        };
        expect(record.graph).toBeUndefined();
        return record.handler_facts ?? [];
      })
      .filter((fact) => fact.fact_type === 'what_would_flip');
    expect(flipFacts).toHaveLength(10);
    const explicitFactBytes = JSON.stringify(flipFacts[0]!.result);
    for (const fact of flipFacts) {
      expect(fact.result?.answer_source).toBe('deterministic_fallback');
      expect(fact.result?.fallback_reason).toBeNull();
      expect(JSON.stringify(fact.result)).toBe(explicitFactBytes);
    }
    expect(selectedResponseCount).toBe(9);
  });
});
