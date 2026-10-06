/** Option C: real Run producer, existing commit, persisted canonical read and served Agent press. */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OlumiResponse } from '@talchain/schemas/boundary';
import type { HandlerFact } from '@talchain/schemas/orchestrator';

const sdk = vi.hoisted(() => ({ openai: vi.fn(), anthropic: vi.fn() }));
vi.mock('openai', () => ({ default: class { chat = { completions: { create: sdk.openai } }; } }));
vi.mock('@anthropic-ai/sdk', () => ({ default: class { messages = { create: sdk.anthropic }; } }));
type Row = { turn_id: string; request_hash: string; handler_facts: HandlerFact[]; assistantMessage?: string; pending_actions?: unknown[] };
const durable = vi.hoisted(() => ({ rows: [] as Row[] }));
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (_scenario: string, id: string) => {
    const row = durable.rows.find((r) => r.turn_id === id);
    return row === undefined ? null : { id, request_hash: row.request_hash, assistant_message: row.assistantMessage ?? null,
      pending_actions: row.pending_actions ?? [], llm_calls_used: 0 };
  }),
  append: vi.fn(async (row: Row) => { durable.rows.push(JSON.parse(JSON.stringify(row)) as Row); return { id: row.turn_id }; }),
  readRecent: vi.fn(async () => []), readFactsFor: vi.fn(async () => []), readFactsWithTurnFor: vi.fn(async () => []),
  readScenarioRunAnalysisFactsFor: vi.fn(async () => {
    const facts = durable.rows.flatMap((r) => r.handler_facts ?? []).filter((f) => f.fact_type === 'run_analysis');
    return { facts: facts.map((fact) => ({ fact, fact_row_id: 'saved-run', fact_created_at: fact.result.computed_at })), total_count: facts.length };
  }),
  readAnalysisInvalidatedAt: vi.fn(async () => null), readMostRecentPendingActions: vi.fn(async () => []),
  getScenarioOwner: vi.fn(async () => null),
};
vi.mock('../../session/index.js', async (original) => ({
  ...await original<typeof import('../../session/index.js')>(), getSessionStore: () => store,
}));
vi.mock('../../../orchestrator/user-identity.js', async (original) => ({
  ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));

import { config } from '../../../config/index.js';
import * as extraction from '../../../adapters/llm/extraction.js';
import { OPENAI_ONLY, runWithProviderPolicy } from '../../../adapters/llm/provider-policy.js';
import { createRunAnalysisHandler } from '../../tools/handlers/run-analysis.js';
import type { HandlerInvocation } from '../../tools/registry.js';
import { commitDirectAnswer } from '../../commit.js';
import { readScenarioAnalysis } from '../../../routes/scenario-graph-analysis-read.js';
import { agentV1TurnRoute, persistedFactorReviewFor } from '../../../routes/agent-v1-turn.js';
import legacyReviewRoute from '../../../routes/assist.v1.review.js';
import { buildCanonicalAnalysisReadyFromGraph } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { decisionReviewFor, factorReviewPressLine, DECISION_REVIEW_PRESS_ID } from '../decision-review-press.js';
import { AGENT_LANE_ENRICH_MODEL } from '../factor-review.js';
import { guidanceHistoryOf } from '../turn-context/guidance-history.js';

const SCENARIO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const QUESTION = 'What evidence would test the price assumption in this model?';
const WORDS = `The result moves most with ‘Price per seat’. A question to test it: ${QUESTION}`;
const graph = {
  nodes: [
    { id: 'decision', kind: 'decision', label: 'Pricing' }, { id: 'goal', kind: 'goal', label: 'Monthly revenue' },
    { id: 'price', kind: 'factor', label: 'Price per seat', observed_state: { value: 0.5 } },
    { id: 'raise', kind: 'option', label: 'Raise prices', interventions: { price: 0.6 } },
    { id: 'hold', kind: 'option', label: 'Hold prices', interventions: { price: 0.5 }, is_baseline: true },
  ],
  edges: [ ['decision', 'raise'], ['decision', 'hold'], ['raise', 'price'], ['hold', 'price'], ['price', 'goal'] ]
    .map(([from, to]) => ({ from, to, strength: { mean: 0.4, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' })),
  goal_node_id: 'goal',
};
const enrichment = (question = QUESTION) => ({ factor_id: 'price', sensitivity_rank: 1,
  observations: ['This factor affects the model result.'], perspectives: ['Evidence could test the assumption.'], confidence_question: question });
const sensitivity = [{ factor_id: 'price', elasticity: 0.62, importance_rank: 1 }];
const plotResponse = (withSensitivity = true) => ({ analysis_status: 'computed',
  meta: { seed_used: 42, n_samples: 1000, response_hash: 'h' }, response_hash: 'h',
  results: [],
  option_comparison: [ { option_id: 'raise', option_label: 'Raise prices', win_probability: 0.62 },
    { option_id: 'hold', option_label: 'Hold prices', win_probability: 0.38 } ],
  ...(withSensitivity ? { factor_sensitivity: sensitivity } : {}),
});
const invocation = (): HandlerInvocation => ({
  context: { stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {},
    messages: [], session_id: SCENARIO, request_id: 'mc-factor-review', budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 },
    prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: graph } as unknown as HandlerInvocation['context'],
  payload: { scenario_id: SCENARIO, turn_id: randomUUID(), message: 'Run analysis', turn_class: 'decide', stage: 'analyse' } as HandlerInvocation['payload'],
  requestId: 'mc-factor-review', signal: new AbortController().signal, orientationText: '',
});

async function runAndPersist(withSensitivity = true, agent = true) {
  const policy = OPENAI_ONLY('agent_v1_turn');
  const plot = vi.fn(async (_payload: Record<string, unknown>) => JSON.parse(JSON.stringify(plotResponse(withSensitivity))));
  const handler = createRunAnalysisHandler({ plotClient: { run: plot, validatePatch: vi.fn() } as never,
    scenarioReader: async () => ({ graph, rawPersistedGraph: graph, goal_node_id: 'goal',
      options: graph.nodes.filter((n) => n.kind === 'option').map((n) => ({ ...n, option_id: n.id })) }) as never });
  const execute = async () => {
    const result = await handler(invocation());
    await commitDirectAnswer({ response_version: 2, assistant_text: result.assistant_text, blocks: [], insights: [],
      suggested_actions: [], stage_indicator: 'analyse' } as OlumiResponse,
    { scenario_id: SCENARIO, turn_id: randomUUID(), turn_class: 'decide', handler_id: 'run_analysis',
      request_hash: 'mc-factor-review', llm_calls_used: result.llm_calls_used, duration_ms: 1, handler_facts: result.handler_facts }, store as never);
    return result;
  };
  const result = agent ? await runWithProviderPolicy(policy, execute) : await execute();
  return { result, policy, plot };
}

async function readStored() {
  const current = await readScenarioAnalysis({ scenarioId: SCENARIO, graph, requestId: 'cold-read' });
  const block = current.analysis_result as { computed_against_hash?: string } | null;
  const read = { graph, graphHash: block?.computed_against_hash, analysisState: current.analysis_state,
    analysisResult: current.analysis_result, analysisReady: buildCanonicalAnalysisReadyFromGraph(graph as never) };
  return { ...read, factorEnrichments: await persistedFactorReviewFor(SCENARIO, read, 'cold-read') };
}

describe('MC factor review served from the persisted Agent Run', () => {
  let agentApp: FastifyInstance;
  let legacyApp: FastifyInstance;
  const extractionSpy = vi.spyOn(extraction, 'callLLMForExtraction');
  const saved = { provider: config.llm.provider, model: config.cee.models.extraction,
    openaiKey: config.llm.openaiApiKey, anthropicKey: config.llm.anthropicApiKey,
    enabled: config.proxy.agentLaneEnabled, preview: config.proxy.agentLanePreview };
  beforeAll(async () => {
    config.proxy.agentLaneEnabled = true; config.proxy.agentLanePreview = false;
    agentApp = Fastify({ logger: false });
    agentApp.post('/assist/v1/scenarios/:id/graph', async () => {
      const current = await readStored();
      return { graph, graph_hash: current.graphHash, analysis_state: current.analysisState,
        analysis_result: current.analysisResult, analysis_ready: current.analysisReady };
    });
    Object.assign(store, { readGuidanceHistory: vi.fn(async () => guidanceHistoryOf([])) });
    await agentApp.register(agentV1TurnRoute); await agentApp.ready();
    legacyApp = Fastify({ logger: false }); await legacyApp.register(legacyReviewRoute); await legacyApp.ready();
  });
  beforeEach(() => {
    vi.clearAllMocks(); durable.rows.length = 0;
    config.llm.provider = 'openai'; config.cee.models.extraction = 'claude-sonnet-5';
    config.llm.openaiApiKey = 'test-openai'; config.llm.anthropicApiKey = 'test-anthropic';
    sdk.openai.mockImplementation(async () => ({ choices: [{ message: { content: JSON.stringify({ enrichments: [enrichment()] }) } }] }));
    sdk.anthropic.mockImplementation(async () => ({ content: [{ type: 'text', text: JSON.stringify({ enrichments: [enrichment()] }) }] }));
  });
  afterAll(async () => {
    await agentApp.close(); await legacyApp.close(); extractionSpy.mockRestore();
    config.llm.provider = saved.provider; config.cee.models.extraction = saved.model;
    config.llm.openaiApiKey = saved.openaiKey; config.llm.anthropicApiKey = saved.anthropicKey;
    config.proxy.agentLaneEnabled = saved.enabled; config.proxy.agentLanePreview = saved.preview;
  });
  const press = () => agentApp.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
    scenario_id: SCENARIO, turn_id: randomUUID(), message: 'Review this decision', source: 'chip_click', chip: { id: DECISION_REVIEW_PRESS_ID },
  } });

  it('(a) RED at base: an Agent Run stores the enrichment and the route serves exactly one rank-1 item', async () => {
    const { plot } = await runAndPersist();
    const fact = durable.rows[0]!.handler_facts.find((f) => f.fact_type === 'run_analysis')!;
    expect(fact.result.enrichment).toHaveProperty('factor_enrichments', [enrichment()]);
    expect(plot.mock.calls[0]![0]).not.toHaveProperty('brief');
    const response = await press(); expect(response.statusCode).toBe(200);
    const text = response.json().assistant_text as string;
    expect(text).toContain(`- ${WORDS}`); expect(text.split(WORDS)).toHaveLength(2);
    expect(text).not.toMatch(/0\.62|elasticity/); expect(extractionSpy).toHaveBeenCalledTimes(1);
  });

  it('(b) RED at base: extraction uses the exact OpenAI per-call model despite the Anthropic env default', async () => {
    const { policy } = await runAndPersist();
    expect(extractionSpy).toHaveBeenCalledTimes(1);
    const options = extractionSpy.mock.calls[0]![2]!;
    expect(options.modelOverride).toBe(AGENT_LANE_ENRICH_MODEL);
    expect(extraction.resolveExtractionAssignment('openai', options.modelOverride)).toMatchObject({ provider: 'openai', model: 'gpt-4.1-2025-04-14' });
    expect(sdk.openai.mock.calls[0]![0].model).toBe('gpt-4.1-2025-04-14');
    expect(policy.calls.filter((c) => c.site === 'extraction.openai')).toMatchObject([{ provider: 'openai', model: 'gpt-4.1-2025-04-14', outcome: 'allowed' }]);
    expect(policy.calls.filter((c) => c.provider === 'anthropic')).toEqual([]); expect(sdk.anthropic).not.toHaveBeenCalled();
  });

  it('(c) CONTROL: the legacy review route still resolves claude-sonnet-5 from the env assignment', async () => {
    const response = await legacyApp.inject({ method: 'POST', url: '/assist/v1/review?schema=v2', payload: {
      brief: 'We are exploring prices and monthly revenue.',
      graph: { nodes: graph.nodes.map(({ id, label, kind }) => ({ id, label, kind })),
        edges: graph.edges.map(({ from, to }) => ({ from, to })) },
      robustness_data: { factor_sensitivity: [{ ...sensitivity[0], factor_label: 'Price per seat' }] },
    } });
    expect(response.statusCode).toBe(200); expect(extractionSpy).toHaveBeenCalledTimes(1);
    expect(extractionSpy.mock.calls[0]![2]).not.toHaveProperty('modelOverride');
    expect(sdk.anthropic.mock.calls[0]![0].model).toBe('claude-sonnet-5'); expect(sdk.openai).not.toHaveBeenCalled();
  });

  it('(d) CONTROL: no sensitivity stores nothing, serves nothing and makes zero extraction calls', async () => {
    const { result, policy } = await runAndPersist(false);
    const fact = result.handler_facts.find((f) => f.fact_type === 'run_analysis')!;
    expect(fact.result.enrichment).not.toHaveProperty('factor_enrichments');
    expect((await press()).json().assistant_text).not.toContain('The result moves most with');
    expect(extractionSpy).not.toHaveBeenCalled(); expect(policy.calls).toEqual([]);
  });

  it('(e) RED at base: cold reload reads the stored Run and serves the same words with no model call', async () => {
    await runAndPersist();
    durable.rows = JSON.parse(JSON.stringify(durable.rows)) as Row[];
    extractionSpy.mockClear(); sdk.openai.mockClear(); sdk.anthropic.mockClear();
    const read = await readStored(); expect(read.factorEnrichments).toEqual([enrichment()]);
    expect(decisionReviewFor(SCENARIO, read).reply).toContain(WORDS);
    expect((await press()).json().assistant_text).toContain(WORDS);
    expect(extractionSpy).not.toHaveBeenCalled(); expect(sdk.openai).not.toHaveBeenCalled(); expect(sdk.anthropic).not.toHaveBeenCalled();
  });

  it.each(['What is best in this model?', 'What would you recommend in this model?', 'What does elasticity 0.62 show in this model?'])
  ('(f) MUST-FAIL: the guarded press withholds unsafe question %s', async (question) => {
    sdk.openai.mockImplementation(async () => ({ choices: [{ message: { content: JSON.stringify({ enrichments: [enrichment(question)] }) } }] }));
    await runAndPersist(); const read = await readStored();
    expect(read.factorEnrichments).toEqual([enrichment(question)]);
    expect(factorReviewPressLine(read)).toBeNull();
    const text = (await press()).json().assistant_text as string;
    expect(text).not.toContain(question); expect(text).not.toContain('The result moves most with');
  });

  it('CONTROL: conventional Runs make no enrichment call and retain the PLoT payload', async () => {
    const { result } = await runAndPersist(true, false);
    const fact = result.handler_facts.find((f) => f.fact_type === 'run_analysis')!;
    expect(fact.result.enrichment).not.toHaveProperty('factor_enrichments');
    expect(extractionSpy).not.toHaveBeenCalled();
  });

  it('CONTROL: an enrichment failure leaves the completed Run intact', async () => {
    sdk.openai.mockRejectedValueOnce(new Error('enrichment unavailable'));
    const { result } = await runAndPersist();
    expect(result.handler_facts[0]!.fact_type).toBe('run_analysis');
    const fact = result.handler_facts.find((f) => f.fact_type === 'run_analysis')!;
    expect(fact.result.enrichment).not.toHaveProperty('factor_enrichments');
  });

  it('CONTROL: a timed-out enrichment leaves the completed Run intact within its time box', async () => {
    vi.useFakeTimers();
    try {
      sdk.openai.mockImplementationOnce(() => new Promise(() => {}));
      const pending = runAndPersist();
      await vi.advanceTimersByTimeAsync(5_001);
      const { result } = await pending;
      const fact = result.handler_facts.find((f) => f.fact_type === 'run_analysis')!;
      expect(fact.result.enrichment).not.toHaveProperty('factor_enrichments');
    } finally {
      vi.useRealTimers();
    }
  });

  it('the live and replay route both use the persisted reader; the callback gate remains shut', () => {
    const route = readFileSync(new URL('../../../routes/agent-v1-turn.ts', import.meta.url), 'utf8');
    expect(route).toContain('factorEnrichments: await persistedFactorReviewFor(scenarioId, state, String(req.id))');
    expect(route).toContain('factorEnrichments: await persistedFactorReviewFor(scenarioId, composedRead, String(req.id))');
    const handler = readFileSync(new URL('../../tools/handlers/run-analysis.ts', import.meta.url), 'utf8');
    expect(handler).toContain('config.cee.sendBriefToPlot && currentProviderPolicy() === undefined');
  });
});
