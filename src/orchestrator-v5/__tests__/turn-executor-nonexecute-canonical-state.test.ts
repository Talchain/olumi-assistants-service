/**
 * Non-execute shared-state foundation — `finalizeRun` canonical-state fallback.
 *
 * Proves that NON-execute turns (converse / direct_answer — turns that dispatch
 * NO mutation/run handler, so they finalise BEFORE the post-dispatch execute
 * assembly) now carry a graph-authority-consistent `result.canonicalState`,
 * assembled at the single `finalizeRun` chokepoint from `handlerFacts: []` +
 * `priorFacts` + the persisted-graph authority. Read-only / diagnostic: prose +
 * suggested_actions are unchanged; dispatch is untouched.
 *
 * Mirrors turn-executor-canonical-readiness-graph-authority.test.ts for the
 * session mock (persisted-graph + prior-fact injection via globals).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeMessagePayload } from './fixtures.js';
import { setTestSink } from '../../utils/telemetry.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
  ToolResponseBlock,
} from '../../adapters/llm/types.js';
import type { GraphStateIngress } from '../boundary/request-extensions.js';
import type { HandlerFact, SessionTurn } from '@talchain/schemas/orchestrator';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';

type G = Record<string, unknown>;

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: 'mock-row-id' }),
    readRecent: async () => ((global as G).__test_prior_turns ?? []) as readonly SessionTurn[],
    readFactsFor: async (ids: readonly string[]) => {
      const map = ((global as G).__test_facts_by_row ?? new Map()) as Map<string, HandlerFact[]>;
      const out: HandlerFact[] = [];
      for (const id of ids) out.push(...(map.get(id) ?? []));
      return out;
    },
    readFactsWithTurnFor: async (ids: readonly string[]) => {
      const map = ((global as G).__test_facts_by_row ?? new Map()) as Map<string, HandlerFact[]>;
      const out: Array<{ fact: HandlerFact; turn_id: string; fact_created_at: string }> = [];
      for (const id of ids) {
        for (const fact of map.get(id) ?? []) {
          out.push({ fact, turn_id: id, fact_created_at: '2026-04-30T01:00:00.000Z' });
        }
      }
      return out;
    },
    invalidateScoped: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => (global as G).__test_persisted_graph ?? null,
    loadGraphAndBriefText: async () => ({
      graph: (global as G).__test_persisted_graph ?? null,
      briefText: null,
    }),
    ensureScenarioExists: async () => ({ user_id: null }),
    readMostRecentPendingActions: async () => [],
  }),
  resetSessionStoreForTests: () => {
    delete (global as G).__test_prior_turns;
    delete (global as G).__test_facts_by_row;
    delete (global as G).__test_persisted_graph;
  },
}));

const { runTurnExecutor } = await import('../turn-executor.js');
const { OLUMI_ACTION_TOOL_NAME } = await import('../routing/tool-schema.js');

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function conversePayload(message: string) {
  return makeMessagePayload({
    turn_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    scenario_id: SCENARIO_ID,
    message,
    turn_class: 'decide',
    stage: 'analyse',
  });
}

// Request graph: 2 options.
const REQUEST_2OPT: GraphStateIngress = {
  nodes: [
    { id: 'goal_1', kind: 'goal', label: 'Profit' },
    { id: 'dec_1', kind: 'decision', label: 'Choose an option' },
    { id: 'f1', kind: 'factor', label: 'Commercial impact' },
    { id: 'opt_a', kind: 'option', label: 'A', interventions: { f1: { value: 1 } } },
    { id: 'opt_b', kind: 'option', label: 'B', interventions: { f1: { value: 0 } } },
  ],
  edges: [
    { from: 'dec_1', to: 'opt_a', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'dec_1', to: 'opt_b', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'opt_a', to: 'f1', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'opt_b', to: 'f1', strength: { mean: 0.01, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'f1', to: 'goal_1', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
  ],
  options: [
    { id: 'opt_a', status: 'ready', interventions: { f1: { value: 1 } } },
    { id: 'opt_b', status: 'ready', interventions: { f1: { value: 0 } } },
  ],
} as GraphStateIngress;

// Persisted graph (client lagged behind a delete): only 1 option → needs_user_input.
const PERSISTED_1OPT: GraphStateIngress = {
  nodes: [
    { id: 'goal_1', kind: 'goal', label: 'Profit' },
    { id: 'dec_1', kind: 'decision', label: 'Choose an option' },
    { id: 'f1', kind: 'factor', label: 'Commercial impact' },
    { id: 'opt_a', kind: 'option', label: 'A', interventions: { f1: { value: 1 } } },
  ],
  edges: [
    { from: 'dec_1', to: 'opt_a', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'opt_a', to: 'f1', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'f1', to: 'goal_1', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
  ],
  options: [{ id: 'opt_a', status: 'ready', interventions: { f1: { value: 1 } } }],
} as GraphStateIngress;

// A distinct but still canonical-ready persisted graph. Used for the stale
// analysis control so freshness divergence is tested independently of the
// one-option structural block above.
const PERSISTED_2OPT_CHANGED: GraphStateIngress = {
  ...REQUEST_2OPT,
  nodes: REQUEST_2OPT.nodes.map((node) =>
    node.id === 'opt_b'
      ? { ...node, interventions: { f1: { value: 0.2 } } }
      : node,
  ),
  options: REQUEST_2OPT.options?.map((option) =>
    option.id === 'opt_b'
      ? { ...option, interventions: { f1: { value: 0.2 } } }
      : option,
  ),
} as GraphStateIngress;

// The 2-option graph hash — used as a prior fact's graph_hash_at_run to drive
// fresh (current persisted graph == REQUEST_2OPT) vs stale (current persisted
// graph == PERSISTED_1OPT, whose hash turn-executor computes internally) cases.
const HASH_2OPT = computeAnalysisAffectingGraphHash(REQUEST_2OPT as never)!;

// Persisted graph that fails GraphStateIngress parse (node missing required
// `label`) but still loads as context.persistedGraph → the H3 IIFE returns a
// null hash → freshness resolves to 'unknown' (current_graph_hash_unavailable),
// never a false 'fresh'.
const MALFORMED_PERSISTED = {
  nodes: [{ id: 'goal_1', kind: 'goal' }],
  edges: [],
} as unknown as GraphStateIngress;

// Request graph whose nodes ALL have unknown kinds → buildGraphLookup drops
// everything ('all_dropped') and the executor returns BEFORE routing freshness
// is derived (the pre-freshness early exit).
const ALL_UNKNOWN_GRAPH = {
  nodes: [
    { id: 'n1', kind: 'unknown_xyz', label: 'X' },
    { id: 'n2', kind: 'invalid_kind', label: 'Y' },
  ],
  edges: [],
} as unknown as GraphStateIngress;

function priorRunAnalysisTurn(): SessionTurn {
  return {
    id: 'row-prior-1',
    scenario_id: SCENARIO_ID,
    user_id: null,
    turn_id: 'turn-prior-1',
    turn_class: 'handler',
    handler_id: 'run_analysis',
    request_hash: 'sha256:prior',
    response_emitted: true,
    llm_calls_used: 0,
    duration_ms: 100,
    created_at: '2026-04-30T01:00:00.000Z',
  } as unknown as SessionTurn;
}

function runAnalysisFact(graphHashAtRun: string): HandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: 'opt_a',
      summary: 'Option A leads.',
      win_probabilities: { opt_a: 0.7, opt_b: 0.3 },
      graph_hash_at_run: graphHashAtRun,
      computed_at: '2026-04-30T01:00:00.000Z',
      enrichment: { analysis_status: 'completed' },
    },
  } as unknown as HandlerFact;
}

function mkConverseResult(): ChatWithToolsResult {
  const content: ToolResponseBlock[] = [
    { type: 'text', text: 'Happy to talk it through.' },
    {
      type: 'tool_use',
      id: 'tu-1',
      name: OLUMI_ACTION_TOOL_NAME,
      input: { intent_class: 'converse' } as Record<string, unknown>,
    },
  ];
  return {
    content,
    stop_reason: 'tool_use',
    usage: { input_tokens: 10, output_tokens: 20 } as unknown as ChatWithToolsResult['usage'],
    model: 'claude-sonnet-4-6',
    latencyMs: 50,
  };
}

function converseAdapter() {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation((async () => mkConverseResult()) as never),
  };
}

interface RunOpts {
  persisted?: GraphStateIngress;
  priorFactHash?: string; // present → seed one prior run_analysis fact
  request?: GraphStateIngress;
}

async function runConverse(reqId: string, opts: RunOpts = {}) {
  if (opts.persisted) (global as G).__test_persisted_graph = opts.persisted;
  if (opts.priorFactHash) {
    (global as G).__test_prior_turns = [priorRunAnalysisTurn()];
    (global as G).__test_facts_by_row = new Map([
      ['row-prior-1', [runAnalysisFact(opts.priorFactHash)]],
    ]);
  }
  return runTurnExecutor(conversePayload('thanks, that helps'), reqId, {
    routingAdapter: converseAdapter(),
    graphState: opts.request ?? REQUEST_2OPT,
  });
}

describe('TurnExecutor — non-execute canonical-state fallback (finalizeRun)', () => {
  beforeEach(() => setTestSink(() => {}));
  afterEach(() => {
    setTestSink(null);
    delete (global as G).__test_prior_turns;
    delete (global as G).__test_facts_by_row;
    delete (global as G).__test_persisted_graph;
    vi.restoreAllMocks();
  });

  it('converse turn (no prior analysis) → canonicalState present + honest freshness none', async () => {
    const result = await runConverse('req-nx-none');
    // Non-execute exit: NO handler dispatched, NO mutation.
    expect(result.telemetry.turn_class).toBe('direct_answer');
    expect(result.telemetry.commit_performed).toBe(true);
    // Task 2: the canonical state is now assembled on the non-execute path.
    expect(result.canonicalState).toBeDefined();
    expect(result.canonicalState!.version).toBe('1.0.0');
    // Honest: no prior fact → freshness none, not fabricated.
    expect(result.canonicalState!.freshness).toBe('none');
    expect(result.canonicalState!.selected_fact_index).toBeNull();
  });

  it('graph-authority: canonical readiness reflects the PERSISTED graph, not the request graph', async () => {
    const stale = await runConverse('req-nx-authority-stale', { persisted: PERSISTED_1OPT });
    const control = await runConverse('req-nx-authority-control', { persisted: REQUEST_2OPT });

    // The non-execute fallback derives readiness from the persisted authority
    // (1-option → blocked by the canonical structural record); the genuine
    // 2-option control remains ready.
    expect(stale.canonicalState!.status).toBe('blocked');
    expect(control.canonicalState!.status).toBe('ready');

    // Read-only posture: ONLY the diagnostic differs — prose + actions identical.
    expect(stale.response.assistant_text).toBe(control.response.assistant_text);
    expect(JSON.stringify(stale.response.suggested_actions)).toBe(
      JSON.stringify(control.response.suggested_actions),
    );
  });

  it('prior fresh analysis (fact hash == persisted graph hash) → freshness fresh, prose usable', async () => {
    const result = await runConverse('req-nx-fresh', {
      persisted: REQUEST_2OPT,
      priorFactHash: HASH_2OPT,
    });
    expect(result.canonicalState!.freshness).toBe('fresh');
    expect(result.canonicalState!.selected_fact_index).not.toBeNull();
    expect(result.canonicalState!.usableForProse).toBe(true);
    expect(result.canonicalState!.usableForChips).toBe(true);
  });

  it('prior stale analysis (graph diverged since the run) → freshness stale, rerun required, chips withheld', async () => {
    const result = await runConverse('req-nx-stale', {
      persisted: PERSISTED_2OPT_CHANGED, // changed but still ready current graph
      priorFactHash: HASH_2OPT, // fact ran against the OLD 2-option graph
    });
    expect(result.canonicalState!.freshness).toBe('stale');
    expect(result.canonicalState!.requiresRerun).toBe(true);
    expect(result.canonicalState!.usableForChips).toBe(false);
    expect(result.canonicalState!.usableForProse).toBe(true); // stale prose allowed (caveated)
  });

  // ── C2 contract: 'freshness !== null' — "state unknown" still assembles an
  //    honest verdict; "no state derived yet" (pre-freshness exit) stays absent.

  it('unparseable persisted graph → freshness UNKNOWN, state still assembled (never false-fresh)', async () => {
    // Persisted graph fails ingress parse → null current hash. With a prior
    // run_analysis fact this is freshness 'unknown' (non-null), so the finalize
    // fallback assembles an honest unknown verdict rather than skipping.
    const result = await runConverse('req-nx-unparseable', {
      persisted: MALFORMED_PERSISTED,
      priorFactHash: HASH_2OPT,
    });
    expect(result.canonicalState).toBeDefined();
    expect(result.canonicalState!.freshness).toBe('unknown');
    expect(result.canonicalState!.selected_fact_index).not.toBeNull(); // prior fact still seen
    expect(result.canonicalState!.usableForChips).toBe(false); // unknown is never chip-safe
    expect(result.canonicalState!.requiresRerun).toBe(false); // unknown ≠ stale
    expect(result.canonicalState!.status).toBeNull(); // readiness undefined (no parseable authority)
  });

  it('pre-freshness early exit (all-dropped graph) → canonicalState ABSENT (no state yet)', async () => {
    // Every node has an unknown kind → graph lookup drops all → the executor
    // returns BEFORE routing freshness is derived. `freshness` is still null at
    // finalizeRun, so the 'freshness !== null' guard skips assembly: honestly
    // absent, never a fabricated verdict.
    const result = await runConverse('req-nx-alldropped', { request: ALL_UNKNOWN_GRAPH });
    expect(result.canonicalState).toBeUndefined();
    // Proves we exited BEFORE routing freshness was derived (not merely that
    // assembly was skipped for some other reason): freshness is still null, so
    // finalizeRun surfaces no freshness either.
    expect(result.freshness).toBeUndefined();
  });
});
