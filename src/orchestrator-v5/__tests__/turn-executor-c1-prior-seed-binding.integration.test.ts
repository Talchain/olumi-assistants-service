/**
 * C1 seed reuse — the TURN is what hands the run_analysis handler the Run it will be paired with
 * (`turn-executor.ts` binds `priorRunSeed` from the turn's own prior facts; `coaching/seed-reuse.ts`).
 * Harness after `turn-executor-imperative-rerun-preroute.integration.test.ts`: a deterministic "run it again" reaches a
 * stub run_analysis handler, which records what the turn bound. No LLM, no PLoT.
 *
 *   T1 a prior Run that recorded its seed echo and inputs → the handler sees that Run's seed + draw-structure key.
 *   T2 (control) a legacy prior Run (no recorded inputs) → the handler sees `prior_not_recorded`, so nothing is lent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { MessageTurnPayload } from '@talchain/schemas/boundary';

import { setTestSink } from '../../utils/telemetry.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import type { ChatWithToolsArgs, ChatWithToolsResult } from '../../adapters/llm/types.js';
import type { RunTurnExecutorOptions } from '../turn-executor.js';
import { currentBoundAnalysisSnapshot } from '../run-analysis-snapshot-binding.js';

const mockState: {
  priorTurns: Array<Record<string, unknown>>; priorFacts: Array<Record<string, unknown>>; persistedGraph: unknown | null;
  /** The scenario's durable analysis read (`null` = the port throws: the reconciled set degrades). */
  durableFacts: Array<Record<string, unknown>> | null;
} = {
  priorTurns: [], priorFacts: [], persistedGraph: null, durableFacts: null,
};

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: `row-${randomUUID()}` }),
    readRecent: async () => mockState.priorTurns,
    readFactsFor: async () => mockState.priorFacts,
    invalidateScoped: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    loadGraph: async () => mockState.persistedGraph,
    loadGraphAndBriefText: async () => ({ graph: mockState.persistedGraph, briefText: null }),
    ensureScenarioExists: async () => ({ user_id: null }),
    readMostRecentPendingActions: async () => [],
    readScenarioRunAnalysisFactsFor: async () => {
      if (mockState.durableFacts === null) throw new Error('durable analysis read unavailable');
      return {
        facts: mockState.durableFacts.map((fact, i) => ({ fact, fact_row_id: `durable-row-${i}`, fact_created_at: new Date(Date.now() - 60_000 - i * 1000).toISOString() })),
        total_count: mockState.durableFacts.length,
      };
    },
  }),
  resetSessionStoreForTests: () => undefined,
}));

const { runTurnExecutor } = await import('../turn-executor.js');

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const READY_GRAPH = {
  nodes: [
    { id: 'goal_q3', kind: 'goal', label: 'Q3 Roadmap' },
    { id: 'fac_capacity', kind: 'factor', label: 'Capacity' },
    { id: 'opt_hire', kind: 'option', label: 'Hire', interventions: { fac_capacity: 1 } },
    { id: 'opt_status_quo', kind: 'option', label: 'Hold', is_baseline: true, interventions: { fac_capacity: 0 } },
  ],
  edges: [
    { from: 'opt_hire', to: 'fac_capacity', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const },
    { from: 'opt_status_quo', to: 'fac_capacity', strength: { mean: 0.01, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const },
    { from: 'fac_capacity', to: 'goal_q3', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const },
  ],
  goal_node_id: 'goal_q3',
};
const READY_GRAPH_HASH = computeAnalysisAffectingGraphHash(READY_GRAPH as never)!;
const SNAPSHOT = {
  // Schema-valid (`goal` is required): the durable read parses every fact with HandlerFactSchema, as production writes it.
  snapshot_version: 1, sent_digest: 'a'.repeat(64), goal: null,
  options: [{ option_id: 'opt_hire', settings: [{ factor_id: 'fac_capacity', encoded: 1 }] }],
  options_not_sent: [], factors: [], constraints: [],
  links: [{ from: 'fac_capacity', to: 'goal_q3', mean: 1, exists_probability: 1 }],
};

function priorRun(withInputs: boolean): Record<string, unknown> {
  return {
    fact_type: 'run_analysis' as const, fact_version: 1 as const, noop: false,
    result: {
      scenario_id: SCENARIO_ID, leading_option_id: 'opt_hire', summary: 'Prior analysis result',
      graph_hash_at_run: READY_GRAPH_HASH, computed_at: new Date(Date.now() - 60_000).toISOString(),
      enrichment: { analysis_status: 'completed', meta: { seed_used: '1234567', n_samples: 1000 } },
      win_probabilities: { opt_hire: 0.72, opt_status_quo: 0.28 },
      ...(withInputs ? { input_snapshot: SNAPSHOT } : {}),
    },
  };
}
const PRIOR_TURN = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', scenario_id: SCENARIO_ID, user_id: null, turn_id: 'prior-turn-run-analysis',
  turn_class: 'handler', handler_id: 'run_analysis', request_hash: 'sha256:prior-ra', response_emitted: true,
  llm_calls_used: 1, duration_ms: 200, created_at: new Date(Date.now() - 60_000).toISOString(),
};
const mkPayload = (message: string): MessageTurnPayload => ({
  kind: 'message', source: 'composer', turn_id: `t-${randomUUID()}`, scenario_id: SCENARIO_ID, message, turn_class: 'frame', stage: 'analyse',
});
const adapter = () => ({
  chatWithTools: vi.fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
    .mockImplementation(async () => ({ content: [{ type: 'text', text: 'Routed answer.' }], stop_reason: 'end_turn' as const, usage: { input_tokens: 5, output_tokens: 5 }, model: 'mock-routing', latencyMs: 0 })),
});

const seen: unknown[] = [];
function registries(): Pick<RunTurnExecutorOptions, 'validationRegistry' | 'handlerRegistry'> {
  const validationRegistry = {
    run_analysis: { handler_id: 'run_analysis', accepted_entity_kinds: ['option', 'goal'], preconditions: () => ({ ok: true as const }), confirmation_template: 'Ran analysis on your current scenario.' },
  } as unknown as RunTurnExecutorOptions['validationRegistry'];
  const handlerRegistry = new Map([[
    'run_analysis',
    async () => {
      seen.push(currentBoundAnalysisSnapshot()?.priorRunSeed);
      return { assistant_text: 'Ran analysis on your current scenario.', handler_facts: [], llm_calls_used: 0 };
    },
  ]]) as unknown as RunTurnExecutorOptions['handlerRegistry'];
  return { validationRegistry, handlerRegistry };
}

describe('C1 — the turn binds the Run a rerun will be paired with', () => {
  beforeEach(() => {
    seen.length = 0;
    mockState.priorTurns = [PRIOR_TURN];
    mockState.persistedGraph = READY_GRAPH;
    mockState.durableFacts = null;
    setTestSink(() => {});
  });
  afterEach(() => { vi.clearAllMocks(); setTestSink(null); });

  it('T1: a prior Run with a seed echo and recorded inputs → the handler sees that Run\'s seed', async () => {
    mockState.priorFacts = [priorRun(true)];
    await runTurnExecutor(mkPayload('Please run the analysis again on this same model.'), 'req-c1-bind', { routingAdapter: adapter(), graphState: READY_GRAPH as never, ...registries() });
    expect(seen.length, 'the rerun reached run_analysis').toBe(1);
    expect(seen[0]).toMatchObject({ seedUsed: '1234567' });
    expect(typeof (seen[0] as { structureKey?: unknown }).structureKey).toBe('string');
  });

  it('T2 (control): a legacy prior Run (no recorded inputs) → prior_not_recorded, nothing lent', async () => {
    mockState.priorFacts = [priorRun(false)];
    await runTurnExecutor(mkPayload('Please run the analysis again on this same model.'), 'req-c1-legacy', { routingAdapter: adapter(), graphState: READY_GRAPH as never, ...registries() });
    expect(seen).toEqual(['prior_not_recorded']);
  });

  // ⭐ C1 DURABLE HISTORY on the EXECUTOR path (CODEX on 30bb9170: a composer imperative rerun reaches run_analysis here).
  it('T3 (RED): the prior Run AGED OUT of the 20-turn window, the durable set holds it → the handler sees its EXACT seed', async () => {
    mockState.priorTurns = [];
    mockState.priorFacts = [];
    mockState.durableFacts = [priorRun(true)];
    await runTurnExecutor(mkPayload('Please run the analysis again on this same model.'), 'req-c1-aged', { routingAdapter: adapter(), graphState: READY_GRAPH as never, ...registries() });
    expect(seen.length, 'the rerun reached run_analysis').toBe(1);
    expect(seen[0]).toMatchObject({ seedUsed: '1234567' });
  });

  it('T4 (control): aged out AND the durable read is down → no_prior_run (today\'s answer)', async () => {
    mockState.priorTurns = [];
    mockState.priorFacts = [];
    await runTurnExecutor(mkPayload('Please run the analysis again on this same model.'), 'req-c1-aged-down', { routingAdapter: adapter(), graphState: READY_GRAPH as never, ...registries() });
    expect(seen).toEqual(['no_prior_run']);
  });
});
