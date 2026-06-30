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
import type { HandlerFn, HandlerInvocation, HandlerRegistry } from '../tools/registry.js';
import type { FlipSummary } from '../compose/flip-proposal.js';
import type { V5ActionType } from '@talchain/schemas/orchestrator';

const SCENARIO_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const mockState: {
  priorTurns: Array<Record<string, unknown>>;
  priorFacts: Array<Record<string, unknown>>;
  persistedGraph: unknown | null;
} = { priorTurns: [], priorFacts: [], persistedGraph: null };

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: `row-${randomUUID()}` }),
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

describe('P0b-2 — routed what_would_flip suppresses option-pinned levers (chip-click parity)', () => {
  beforeEach(() => {
    capturedFlip = undefined;
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
});
