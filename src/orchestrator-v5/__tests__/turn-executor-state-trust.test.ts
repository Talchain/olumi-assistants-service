/**
 * V5 state-trust — TurnExecutor integration tests.
 *
 * These tests drive `runTurnExecutor` end-to-end with a mocked session
 * store and a stub routing adapter, verifying that the freshness
 * verdict on the returned `TurnExecutorRunResult.freshness` reflects
 * the POST-dispatch fact chain (not just `context.prior_facts`).
 *
 * Why route-shape rather than helper-shape: the unit tests in
 * freshness.test.ts already cover the derivation in isolation. The
 * regression risk these tests guard against is a future change that
 * removes the post-dispatch re-derivation block — a unit-level test
 * cannot catch that regression because the helper still works in
 * isolation. These tests assert the integration: dispatch a routed
 * `run_analysis`, confirm the wire-bound `freshness` reflects the
 * just-produced fact.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HandlerFact } from '@talchain/schemas/orchestrator';

import { makeMessagePayload } from './fixtures.js';

import type { ChatWithToolsArgs, ChatWithToolsResult, ToolResponseBlock } from '../../adapters/llm/types.js';
import { setTestSink } from '../../utils/telemetry.js';
import type { GraphStateIngress } from '../boundary/request-extensions.js';
import type { HandlerRegistry, HandlerFn, HandlerInvocation, HandlerOutcome } from '../tools/registry.js';

const SCENARIO_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const TURN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const BASE_PAYLOAD = makeMessagePayload({
  turn_id: TURN_ID,
  scenario_id: SCENARIO_ID,
  message: 'why does the leading option win?',
  turn_class: 'decide',
  stage: 'analyse',
});

// In-memory store handle the test mutates per scenario.
let mockedPriorFacts: HandlerFact[] = [];

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: 'mock-row-id' }),
    readRecent: async () => [
      // build-turn-context filters by turn_class === 'handler' and uses the row id.
      { id: 'mock-prior-handler-row', turn_class: 'handler', turn_id: 'prior-turn' },
    ],
    readFactsFor: async () => mockedPriorFacts,
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
  }),
  resetSessionStoreForTests: () => {},
}));

const { runTurnExecutor } = await import('../turn-executor.js');
const { OLUMI_ACTION_TOOL_NAME } = await import('../routing/tool-schema.js');

const baseGraph: GraphStateIngress = {
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Goal' },
    { id: 'budget', kind: 'factor', label: 'Budget', observed_state: { value: 100 } },
    { id: 'opt_a', kind: 'option', label: 'A' },
    { id: 'opt_b', kind: 'option', label: 'B' },
  ],
  edges: [
    { from: 'budget', to: 'goal', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
  ],
  options: [
    { id: 'opt_a', status: 'ready', interventions: { budget: { value: 100, target_match: { node_id: 'budget' } } } },
    { id: 'opt_b', status: 'ready', interventions: { budget: { value: 50, target_match: { node_id: 'budget' } } } },
  ],
  goal_node_id: 'goal',
} as unknown as GraphStateIngress;

function buildRunAnalysisToolInput() {
  return {
    intent_class: 'execute',
    action: {
      handler_id: 'run_analysis',
      entity: {
        id: 'opt_a',
        kind: 'option',
        resolution_status: 'resolved',
        resolution_method: 'id_match',
      },
      parameters: [],
      cited_context_fields: ['graph.options'],
    },
  };
}

function buildExplainResultsToolInput() {
  return {
    intent_class: 'execute',
    action: {
      handler_id: 'explain_results',
      entity: {
        id: 'goal',
        kind: 'goal',
        label: 'Goal',
        resolution_status: 'resolved',
        resolution_method: 'context_inference',
      },
      parameters: [],
      cited_context_fields: ['analysis.leading_option'],
      explanation: {
        answer_text:
          'Looking at the leading option, the strongest direct driver in the model is Budget which connects to the goal. Walking the structure first will explain the result.',
      },
    },
  };
}

function mkToolUseResult(input: unknown): ChatWithToolsResult {
  const content: ToolResponseBlock[] = [
    { type: 'tool_use', id: 'tu-1', name: OLUMI_ACTION_TOOL_NAME, input: input as Record<string, unknown> },
  ];
  return {
    content,
    stop_reason: 'tool_use',
    usage: { input_tokens: 10, output_tokens: 20 } as unknown as ChatWithToolsResult['usage'],
    model: 'claude-sonnet-4-6',
    latencyMs: 5,
  };
}

function mockAdapter(input: unknown) {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockResolvedValue(mkToolUseResult(input)),
  };
}

// Stub registry that returns a curated handler outcome. The handler
// outcome's facts feed the post-dispatch freshness derivation.
function stubRegistry(handlerId: string, factsForCurrentTurn: HandlerFact[]): HandlerRegistry {
  const fn: HandlerFn = async (_invocation: HandlerInvocation): Promise<HandlerOutcome> => ({
    assistant_text: 'Ran analysis on your current scenario.',
    handler_facts: factsForCurrentTurn,
    llm_calls_used: 0,
  });
  return new Map([[handlerId, fn]]) as unknown as HandlerRegistry;
}

beforeEach(() => {
  setTestSink(() => {});
  mockedPriorFacts = [];
});

afterEach(() => {
  setTestSink(null);
  vi.restoreAllMocks();
});

describe('TurnExecutor — V5 state-trust freshness threading', () => {
  it('routed run_analysis on a fresh turn → result.freshness reflects the JUST-PRODUCED fact, not context.prior_facts', async () => {
    const { computeAnalysisAffectingGraphHash } = await import('../context/graph-hash.js');
    const expectedHash = computeAnalysisAffectingGraphHash(baseGraph)!;

    // Prior fact chain has a stale fact (different hash) — pre-state-trust
    // would surface that as 'stale'. Post-state-trust should pick the
    // just-produced fact instead.
    mockedPriorFacts = [
      {
        fact_type: 'run_analysis',
        fact_version: 1,
        noop: false,
        result: {
          scenario_id: SCENARIO_ID,
          leading_option_id: 'opt_a',
          summary: 'Ran analysis (older).',
          enrichment: { analysis_status: 'computed' },
          graph_hash_at_run: 'old_hash________',
          computed_at: '2026-04-29T00:00:00.000Z',
        },
      } as HandlerFact,
    ];

    // Current-turn fact: a freshly-produced run_analysis with the matching hash.
    const currentTurnFact: HandlerFact = {
      fact_type: 'run_analysis',
      fact_version: 1,
      noop: false,
      result: {
        scenario_id: SCENARIO_ID,
        leading_option_id: 'opt_a',
        summary: 'Ran analysis (fresh).',
        enrichment: { analysis_status: 'computed' },
        graph_hash_at_run: expectedHash,
        computed_at: '2026-04-30T00:00:00.000Z',
      },
    } as HandlerFact;

    const adapter = mockAdapter(buildRunAnalysisToolInput());

    const result = await runTurnExecutor(BASE_PAYLOAD, 'req-state-trust-fresh', {
      routingAdapter: adapter,
      graphState: baseGraph,
      handlerRegistry: stubRegistry('run_analysis', [currentTurnFact]),
    });

    expect(result.freshness).toBeDefined();
    expect(result.freshness!.freshness).toBe('fresh');
    expect(result.freshness!.reason).toBe('graph_hash_match');
    expect(result.freshness!.graph_hash_at_run).toBe(expectedHash);
    expect(result.freshness!.computed_at).toBe('2026-04-30T00:00:00.000Z');
    // selected_fact_index 0 — current-turn facts come first in the chain.
    expect(result.freshness!.selected_fact_index).toBe(0);
  });

  it('explain turn (no current-turn run_analysis) → freshness reflects prior fact verdict', async () => {
    const { computeAnalysisAffectingGraphHash } = await import('../context/graph-hash.js');
    const matchingHash = computeAnalysisAffectingGraphHash(baseGraph)!;

    mockedPriorFacts = [
      {
        fact_type: 'run_analysis',
        fact_version: 1,
        noop: false,
        result: {
          scenario_id: SCENARIO_ID,
          leading_option_id: 'opt_a',
          summary: 'Prior run.',
          enrichment: { analysis_status: 'computed' },
          graph_hash_at_run: matchingHash,
          computed_at: '2026-04-29T00:00:00.000Z',
        },
      } as HandlerFact,
    ];

    const adapter = mockAdapter(buildExplainResultsToolInput());

    const explainFact: HandlerFact = {
      fact_type: 'explain_results',
      fact_version: 1,
      noop: true,
      result: {
        precondition_unmet: false,
        option_count: 2,
        answer_source: 'sonnet',
        fallback_reason: null,
        answer_text_length: 50,
        staleness_prefixed: false,
      },
    } as HandlerFact;

    const result = await runTurnExecutor(BASE_PAYLOAD, 'req-state-trust-explain-fresh', {
      routingAdapter: adapter,
      graphState: baseGraph,
      handlerRegistry: stubRegistry('explain_results', [explainFact]),
    });

    expect(result.freshness).toBeDefined();
    expect(result.freshness!.freshness).toBe('fresh');
    // The selected fact is the prior-turn run_analysis (explain_results
    // is noop and excluded from selection).
    expect(result.freshness!.computed_at).toBe('2026-04-29T00:00:00.000Z');
  });

  it('explain turn against a value-edited graph (no current-turn run_analysis) → freshness=stale', async () => {
    const { computeAnalysisAffectingGraphHash } = await import('../context/graph-hash.js');

    // Prior fact recorded against the BASE graph; current turn ships
    // an EDITED graph (value-only change) — hashes diverge → stale.
    const baseHash = computeAnalysisAffectingGraphHash(baseGraph)!;
    const editedGraph: GraphStateIngress = {
      ...baseGraph,
      nodes: baseGraph.nodes.map((n) => {
        const node = n as Record<string, unknown>;
        if (node.id === 'budget') {
          return { ...node, observed_state: { value: 250 } };
        }
        return node;
      }),
    } as GraphStateIngress;
    const editedHash = computeAnalysisAffectingGraphHash(editedGraph)!;
    expect(editedHash).not.toBe(baseHash);

    mockedPriorFacts = [
      {
        fact_type: 'run_analysis',
        fact_version: 1,
        noop: false,
        result: {
          scenario_id: SCENARIO_ID,
          leading_option_id: 'opt_a',
          summary: 'Prior run.',
          enrichment: { analysis_status: 'computed' },
          graph_hash_at_run: baseHash,
          computed_at: '2026-04-29T00:00:00.000Z',
        },
      } as HandlerFact,
    ];

    const adapter = mockAdapter(buildExplainResultsToolInput());

    const explainFact: HandlerFact = {
      fact_type: 'explain_results',
      fact_version: 1,
      noop: true,
      result: {
        precondition_unmet: false,
        option_count: 2,
        answer_source: 'sonnet',
        fallback_reason: null,
        answer_text_length: 50,
        staleness_prefixed: false,
      },
    } as HandlerFact;

    const result = await runTurnExecutor(BASE_PAYLOAD, 'req-state-trust-stale', {
      routingAdapter: adapter,
      graphState: editedGraph,
      handlerRegistry: stubRegistry('explain_results', [explainFact]),
    });

    expect(result.freshness).toBeDefined();
    expect(result.freshness!.freshness).toBe('stale');
    expect(result.freshness!.reason).toBe('graph_hash_diverged');
    expect(result.freshness!.graph_hash_at_run).toBe(baseHash);
    expect(result.freshness!.current_graph_hash).toBe(editedHash);
  });

  it('first-turn (no prior facts, no current-turn run_analysis fact) → freshness=none', async () => {
    mockedPriorFacts = [];

    const adapter = mockAdapter(buildExplainResultsToolInput());

    const explainFact: HandlerFact = {
      fact_type: 'explain_results',
      fact_version: 1,
      noop: true,
      result: {
        precondition_unmet: false,
        option_count: 2,
        answer_source: 'sonnet',
        fallback_reason: null,
        answer_text_length: 50,
        staleness_prefixed: false,
      },
    } as HandlerFact;

    const result = await runTurnExecutor(BASE_PAYLOAD, 'req-state-trust-none', {
      routingAdapter: adapter,
      graphState: baseGraph,
      handlerRegistry: stubRegistry('explain_results', [explainFact]),
    });

    expect(result.freshness).toBeDefined();
    expect(result.freshness!.freshness).toBe('none');
    expect(result.freshness!.reason).toBe('no_successful_run_analysis_fact');
    expect(result.freshness!.selected_fact_index).toBeNull();
  });

  it('turn_outcome contract is populated when freshness is derived', async () => {
    mockedPriorFacts = [];

    const adapter = mockAdapter(buildExplainResultsToolInput());

    const explainFact: HandlerFact = {
      fact_type: 'explain_results',
      fact_version: 1,
      noop: true,
      result: {
        precondition_unmet: false,
        option_count: 2,
        answer_source: 'sonnet',
        fallback_reason: null,
        answer_text_length: 50,
        staleness_prefixed: false,
      },
    } as HandlerFact;

    const result = await runTurnExecutor(BASE_PAYLOAD, 'req-state-trust-outcome', {
      routingAdapter: adapter,
      graphState: baseGraph,
      handlerRegistry: stubRegistry('explain_results', [explainFact]),
    });

    expect(result.turn_outcome).toBeDefined();
    expect(result.turn_outcome!.analysis_freshness).toBe('none');
    expect(result.turn_outcome!.graph_mutated).toBe(false);
    expect(result.turn_outcome!.analysis_run).toBe(false);
  });

  // P0 V5 golden-path repair (follow-up): graph_mutated derives from
  // handler output, not a handler-id allowlist. The end-to-end positive
  // case is asserted in turn-executor-deterministic-value-update.test.ts
  // ("graph_mutated=true on a real set_factor_value dispatch") which
  // exercises the full validator + handler path. The negative case
  // here is the lockstep sanity for that contract.
  it('graph_mutated=false when a non-mutation handler runs (explain_results)', async () => {
    // Sanity check the inverse: the contract is "mutated_graph emitted
    // → flag true", and a handler that emits no mutated_graph keeps
    // the flag false.
    mockedPriorFacts = [];
    const adapter = mockAdapter(buildExplainResultsToolInput());

    const explainFact: HandlerFact = {
      fact_type: 'explain_results',
      fact_version: 1,
      noop: true,
      result: {
        precondition_unmet: false,
        option_count: 2,
        answer_source: 'sonnet',
        fallback_reason: null,
        answer_text_length: 50,
        staleness_prefixed: false,
      },
    } as HandlerFact;

    const result = await runTurnExecutor(
      BASE_PAYLOAD,
      'req-state-trust-no-mutation',
      {
        routingAdapter: adapter,
        graphState: baseGraph,
        handlerRegistry: stubRegistry('explain_results', [explainFact]),
      },
    );

    expect(result.turn_outcome!.graph_mutated).toBe(false);
  });
});
