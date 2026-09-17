/**
 * THE JOIN — compose selects a lens, and the COMMITTED fact carries THAT lens.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠⚠ WHY THIS FILE EXISTS, STATED SO NOBODY DELETES IT AS A DUPLICATE.
 *
 * `compose/__tests__/selected-lens-persistence.test.ts` covers the two HALVES:
 * the producer reports its selection through `onLensSelected`, and
 * `attachSelectedLensToRunAnalysisFact` records what it is handed. Neither
 * imports `turn-executor.ts`. So at the tip that introduced them, DELETING THE
 * JOINING LINE FROM THE EXECUTOR left every test in the repository GREEN while
 * the record was never written to anything a later turn can read.
 *
 * That is this estate's chronic failure #1 — built, not plugged in — and the
 * reviewer who blocked a sibling lane for exactly this shape an hour before
 * this file was written was right to. Two green halves are not a join.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⭐ EXECUTING, AND READING WHAT WAS ACTUALLY COMMITTED.
 *
 * This drives the REAL `runTurnExecutor` over a real registry and reads the
 * fact out of the STORE APPEND — the bytes a later turn loads as `prior_facts`
 * — through the same `readSelectedLensFromFact` a consumer uses. Not the
 * compose return value, not the in-memory array: the committed write.
 *
 * ⭐ BOUND BY IDENTITY, NOT PRESENCE. A test asserting "some lens was
 * recorded" would pass against a build that records a constant. Both arms run
 * the SAME analysis and differ ONLY in seeded lens history — the one input the
 * no-immediate-repeat tie-break (ROADMAP 2.211) reads:
 *
 *   ARM X  no prior analysis        → sensitivity_flip_risk  → committed as that
 *   ARM Y  one prior A5 analysis    → pre_mortem             → committed as that
 *
 * So the constant-recording mutant REDs ARM Y while ARM X stays green, and the
 * dropped-write mutant REDs both — while the two HALF specs stay green through
 * all of it. That RED/GREEN split is the evidence the JOIN is covered.
 *
 * Status ladder: TESTED. Stubbed PLoT + stubbed scenario reader is not a wire
 * witness and not a journey witness.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { HandlerFact } from '@talchain/schemas/orchestrator';

import { makeMessagePayload } from './fixtures.js';
import { setTestSink } from '../../utils/telemetry.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
  ToolResponseBlock,
} from '../../adapters/llm/types.js';

// Session store mock — capture append() so the assertions read the COMMITTED
// write rather than anything still in memory. `priorFactRows` is what
// `context.prior_facts` (and therefore the lens history) is built from.
const appendCalls: Array<Record<string, unknown>> = [];
const priorTurnRows: Array<unknown> = [];
const priorFactRows: Array<unknown> = [];
vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: unknown) => {
      appendCalls.push(write as Record<string, unknown>);
      return { id: 'mock-row-id' };
    },
    readRecent: async () => priorTurnRows,
    readFactsFor: async () => priorFactRows,
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
  }),
  resetSessionStoreForTests: () => {},
}));

import type { PLoTClient } from '../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../orchestrator/types.js';
import type { RunAnalysisScenarioSnapshot } from '../tools/handlers/run-analysis.js';

const { runTurnExecutor } = await import('../turn-executor.js');
const { createRegistry } = await import('../tools/registry.js');
const { OLUMI_ACTION_TOOL_NAME } = await import('../routing/tool-schema.js');
const { readSelectedLensFromFact, SELECTED_LENS_ENRICHMENT_KEY } = await import(
  '../compose/selected-lens-record.js'
);

const TEST_SCENARIO_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const BASE_PAYLOAD = makeMessagePayload({
  turn_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  scenario_id: TEST_SCENARIO_ID,
  message: 'run the analysis',
  turn_class: 'decide',
  stage: 'analyse',
});

const RUN_ANALYSIS_TOOL_CALL_INPUT = {
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

/**
 * The a5 golden lens signals (`lens-no-immediate-repeat.test.ts`, reproduced at
 * the measured numbers of the 31 Jul live walk). Rule 1a-i fires (an `isolated`
 * rank-1 factor) AND rule 2c fires (max win_probability 0.6242 ∈ [0.4, 0.7)),
 * so BOTH lenses trigger — which is what makes the history the deciding input.
 */
const A5_LENS_SIGNALS = {
  confidence_tier: 'fair',
  factor_sensitivity: [
    { factor_id: 'fac_sales_capacity', influence_score: 1.0, influence_rank: 1, confidence: 0.3, flip_risk_category: 'isolated' },
    { factor_id: 'fac_market_demand', influence_score: 0.74, influence_rank: 2, confidence: 0.448, flip_risk_category: 'correlated' },
    { factor_id: 'fac_product_investment', influence_score: 0.178, influence_rank: 3, confidence: 0.3, flip_risk_category: 'isolated' },
    { factor_id: 'fac_marketing_spend', influence_score: 0.141, influence_rank: 4, confidence: 0.3, flip_risk_category: 'correlated' },
  ],
  option_comparison: [
    { win_probability: 0.6242 },
    { win_probability: 0.2 },
    { win_probability: 0.1 },
    { win_probability: 0.0758 },
  ],
};

function makeA5PlotResponse(): V2RunResponseEnvelope {
  return {
    meta: { seed_used: 42, n_samples: 1000, response_hash: 'h' },
    results: [
      { option_id: 'opt_a', option_label: 'A', win_probability: 0.6242 },
      { option_id: 'opt_b', option_label: 'B', win_probability: 0.2 },
    ],
    response_hash: 'h-top',
    analysis_status: 'completed',
    ...A5_LENS_SIGNALS,
  } as unknown as V2RunResponseEnvelope;
}

// ⚠ Shape matters: `GraphStateIngressSchema` REQUIRES `label` on every node and
// `from`/`to` (not source/target) on every edge. A shape it rejects hashes to
// null, which silently costs the fact its `graph_hash_at_run` — see below.
const GRAPH = {
  nodes: [
    { id: 'g', kind: 'goal', label: 'Goal' },
    { id: 'f', kind: 'factor', label: 'Factor F' },
  ],
  edges: [{ id: 'e1', from: 'f', to: 'g' }],
};

function makeScenarioSnapshot(): RunAnalysisScenarioSnapshot {
  return {
    graph: GRAPH,
    // ⚠ LOAD-BEARING, not fixture padding. `graph_hash_at_run` is computed from
    // `rawPersistedGraph`; without it the fact carries NO hash, compose's
    // current-turn Phase-3 branch never runs, and no lens is ever selected — so
    // the join would read as "records nothing" for a reason that has nothing to
    // do with the join. Pinned by the precondition assertion below.
    rawPersistedGraph: GRAPH,
    options: [
      { id: 'opt_a', option_id: 'opt_a', label: 'A', interventions: { f: 1 } },
      { id: 'opt_b', option_id: 'opt_b', label: 'B', interventions: { f: 0 } },
    ],
    goal_node_id: 'g',
  } as unknown as RunAnalysisScenarioSnapshot;
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
    latencyMs: 50,
  };
}

function mockRoutingAdapter() {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation((async () => mkToolUseResult(RUN_ANALYSIS_TOOL_CALL_INPUT)) as never),
  };
}

/** Seed ONE prior a5 analysis, so the lens history replays to flip-risk. */
function seedPriorA5Analysis(): void {
  priorTurnRows.push({
    id: 'row-prior-1',
    scenario_id: TEST_SCENARIO_ID,
    turn_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    turn_class: 'handler',
    handler_id: 'run_analysis',
    created_at: '2026-07-15T00:00:00.000Z',
    response_emitted: true,
  });
  priorFactRows.push({
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: TEST_SCENARIO_ID,
      leading_option_id: 'opt_a',
      summary: 'prior run',
      enrichment: { ...makeA5PlotResponse() },
      computed_at: '2026-07-15T00:00:00.000Z',
      graph_hash_at_run: 'hash-prior-a5',
    },
  });
}

/** Drive the real executor and return the run_analysis fact AS COMMITTED. */
async function runAndReadCommittedFact(requestId: string): Promise<HandlerFact> {
  const registry = createRegistry({
    plotClient: {
      run: vi.fn(async () => makeA5PlotResponse()),
      validatePatch: vi.fn().mockResolvedValue({}),
    } as unknown as PLoTClient,
    scenarioReader: async () => makeScenarioSnapshot(),
  });
  const { telemetry } = await runTurnExecutor(BASE_PAYLOAD, requestId, {
    routingAdapter: mockRoutingAdapter(),
    handlerRegistry: registry,
  });
  // Precondition, pinned IN-TEST: a turn that did not commit, or committed no
  // run_analysis fact, proves nothing about the join either way.
  expect(telemetry.commit_performed).toBe(true);
  expect(appendCalls).toHaveLength(1);
  const facts = appendCalls[0]!.handler_facts as readonly HandlerFact[];
  const fact = facts.find((f) => f.fact_type === 'run_analysis');
  expect(fact, 'no run_analysis fact reached the commit — fixture is not exercising the join').toBeDefined();
  return fact!;
}

let events: Array<{ event: string; data: Record<string, unknown> }> = [];

beforeEach(() => {
  appendCalls.length = 0;
  priorTurnRows.length = 0;
  priorFactRows.length = 0;
  events = [];
  setTestSink((eventName, data) => events.push({ event: eventName, data }));
});

afterEach(() => {
  setTestSink(null);
});

describe('turn-executor JOIN — the committed fact carries the lens compose selected', () => {
  it('ARM X: no prior analysis → the committed fact records sensitivity_flip_risk', async () => {
    const fact = await runAndReadCommittedFact('req-join-armx');
    expect(readSelectedLensFromFact(fact)).toBe('sensitivity_flip_risk');
  });

  it('ARM Y: one prior a5 analysis → the committed fact records pre_mortem', async () => {
    seedPriorA5Analysis();
    const fact = await runAndReadCommittedFact('req-join-army');
    expect(readSelectedLensFromFact(fact)).toBe('pre_mortem');
  });

  it('the two arms COMMIT different lenses — the write tracks the selection, not a constant', async () => {
    const armX = readSelectedLensFromFact(await runAndReadCommittedFact('req-join-pair-x'));
    appendCalls.length = 0;
    seedPriorA5Analysis();
    const armY = readSelectedLensFromFact(await runAndReadCommittedFact('req-join-pair-y'));
    expect(armX).toBe('sensitivity_flip_risk');
    expect(armY).toBe('pre_mortem');
    expect(armX).not.toBe(armY);
  });

  it('the record survives the commit as ENRICHMENT, where a later turn reads prior_facts', async () => {
    const fact = await runAndReadCommittedFact('req-join-enrichment');
    expect(fact.fact_type).toBe('run_analysis');
    const enrichment =
      fact.fact_type === 'run_analysis' ? (fact.result.enrichment as Record<string, unknown>) : {};
    expect(enrichment[SELECTED_LENS_ENRICHMENT_KEY]).toBe('sensitivity_flip_risk');
    // Round-trips as JSON, the way the store hands it back.
    const roundTripped = JSON.parse(JSON.stringify(fact)) as HandlerFact;
    expect(readSelectedLensFromFact(roundTripped)).toBe('sensitivity_flip_risk');
  });
});
