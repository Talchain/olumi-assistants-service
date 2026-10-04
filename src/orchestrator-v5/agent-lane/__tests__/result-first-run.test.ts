import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RUN_ANALYSIS_PROJECTION_KEY, ANALYSIS_PROJECTION_VERSION } from '../../context/graph-identity.js';
import type { SessionStore } from '../../session/store.js';
import { isRunExplanationChip, RUN_EXPLANATION_MESSAGE, RUN_EXPLANATION_UNAVAILABLE_TEXT } from '../run-explanation.js';

const SCENARIO = '4d2c1b0a-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const FACT = JSON.parse(readFileSync(new URL('./fixtures/served-run-analysis-fact-for-binding.json', import.meta.url), 'utf8'));
const GRAPH = { nodes: [{ id: 'g', kind: 'goal', label: 'MRR', goal_threshold_raw: 100 },
  { id: 'f', kind: 'factor', label: 'Price' }],
edges: [{ from: 'f', to: 'g', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.8, effect_direction: 'positive' }] };
let graph: unknown = GRAPH;
let briefText = 'The strategic brief';
let fact: typeof FACT | null = null;
let readFails = false;
let scenarioOwner: string | null = null;
let restored: string | null = null;
let editFacts: unknown[] = [];
const rows: Record<string, unknown>[] = [];
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (_scenario: string, id: string) => rows.find((r) => r.turn_id === id) ?? null),
  append: vi.fn(async (row: Record<string, unknown>) => { rows.push({ ...row, id: row.turn_id }); return { id: String(row.turn_id) }; }),
  readRecent: vi.fn(async () => [{ id: 'run-row', turn_class: 'decide', created_at: '2026-10-01T12:00:00.000Z' }, ...rows].reverse()),
  readFactsFor: vi.fn(async () => fact === null ? [] : [...editFacts, fact]),
  readFactsWithTurnFor: vi.fn(async () => fact === null ? [] : [
    ...editFacts.map((edit, i) => ({ fact: edit, fact_row_id: `edit-${i}`, turn_id: `edit-turn-${i}`, fact_created_at: '2026-10-01T12:00:02.000Z' })),
    { fact, fact_row_id: 'selected-run', turn_id: 'run-row', fact_created_at: '2026-10-01T12:00:00.000Z' },
  ]),
  readAnalysisInvalidatedAt: vi.fn(async () => restored),
  readRunCurrentness: undefined as SessionStore['readRunCurrentness'],
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (original) => ({
  ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));

describe('two-request Run through the real handler and canonical analysis reader', () => {
  let app: FastifyInstance;
  let modelBodies: Record<string, unknown>[] = [];
  let runs = 0;
  let graphReads = 0;
  let mutateDuringExplanation: (() => void) | undefined;
  let providerMode: 'ok' | 'empty' | 'failed' | 'timeout' = 'ok';
  let hashOf: (g: unknown) => string | null;
  let timeoutController: AbortController | undefined;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      modelBodies.push(JSON.parse(String(init?.body ?? '{}')));
      mutateDuringExplanation?.();
      if (providerMode === 'timeout') return await new Promise<Response>((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new DOMException('Timed out', 'AbortError')), { once: true });
        void Promise.resolve().then(() => timeoutController?.abort());
      });
      if (providerMode === 'failed') return new Response('{}', { status: 400 });
      return new Response(JSON.stringify({ output: providerMode === 'empty' ? [] : [
        { type: 'message', content: [{ type: 'output_text', text: 'The result depends on the assumptions in your model.' }] },
      ] }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { computeAnalysisAffectingGraphHash } = await import('../../context/graph-hash.js');
    hashOf = (g) => computeAnalysisAffectingGraphHash(g as never);
    const { readScenarioAnalysis } = await import('../../../routes/scenario-graph-analysis-read.js');
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/orchestrate/v2/turn', async () => {
      runs += 1;
      fact = { ...FACT, noop: false, result: { ...FACT.result, scenario_id: SCENARIO,
        graph_hash_at_run: hashOf(graph), computed_at: '2026-10-01T12:00:00.000Z' } };
      const read = await readScenarioAnalysis({ scenarioId: SCENARIO, graph, requestId: 'test' });
      return { response_version: 2, assistant_text: 'ran', suggested_actions: [], insights: [], graph_hash: hashOf(graph),
        blocks: read.analysis_result === null ? [] : [read.analysis_result], analysis_state: read.analysis_state,
        analysis_ready: { status: 'ready', options: [], blockers: [] } };
    });
    app.post('/assist/v1/scenarios/:id/graph', async (_req, reply) => {
      graphReads += 1;
      if (readFails) return reply.code(500).send({ error: 'unavailable' });
      if (scenarioOwner !== null) return reply.code(403).send({ error: 'forbidden' });
      const read = await readScenarioAnalysis({ scenarioId: SCENARIO, graph, requestId: 'test' });
      return { graph, brief_text: briefText, graph_hash: hashOf(graph), ...read };
    });
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => {
    await app.close(); vi.unstubAllGlobals();
    delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW;
  });
  beforeEach(() => { graph = GRAPH; briefText = 'The strategic brief'; fact = null; readFails = false; rows.length = 0; runs = 0; graphReads = 0; scenarioOwner = null; restored = null; editFacts = [];
    modelBodies = []; providerMode = 'ok'; mutateDuringExplanation = undefined; store.readRunCurrentness = undefined; });
  const run = () => app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
    turn_id: randomUUID(), scenario_id: SCENARIO, message: 'Run the analysis', source: 'chip_click', chip: { action_type: 'run_analysis' },
  } });
  type FirstResponse = { suggested_actions: { id: string }[]; _agent: { session_id: string } };
  const explanation = (first: FirstResponse, extra: Record<string, unknown> = {}) => {
    const chip = first.suggested_actions.find((c: { id: string }) => isRunExplanationChip(c.id));
    expect(chip, JSON.stringify(first)).toBeDefined();
    return app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { turn_id: randomUUID(), scenario_id: SCENARIO,
      agent_session_id: first._agent.session_id, message: RUN_EXPLANATION_MESSAGE, chip: { id: chip!.id }, ...extra } });
  };

  it('Run and Re-run each read the post-run graph once, without an unused prefetch', async () => {
    expect((await run()).statusCode).toBe(200);
    expect(graphReads, 'Run: the one post-run canonical read').toBe(1);
    const beforeRerun = graphReads;
    expect((await run()).statusCode).toBe(200);
    expect(graphReads - beforeRerun, 'Re-run: the one post-run canonical read').toBe(1);
    expect(runs).toBe(2);
    expect(modelBodies).toHaveLength(0);
  });

  it('an unchanged explanation canonically rereads chronology even when the fast port exists', async () => {
    const first = (await run()).json();
    store.readRunCurrentness = vi.fn(async () => fact === null ? null : ({ userId: null, graph, briefText, analysisInvalidatedAt: null, fact }));
    const before = graphReads;
    const second = await explanation(first);
    expect(second.json().narration.status).toBe('ready');
    expect(graphReads - before).toBe(2);
    expect(store.readRunCurrentness).not.toHaveBeenCalled();
    expect(runs).toBe(1);
  });

  for (const edit of ['label', 'brief'] as const) {
    it(`refreshes the wire after a concurrent ${edit} edit that leaves the Run current`, async () => {
      const first = (await run()).json();
      store.readRunCurrentness = vi.fn(async () => fact === null ? null : ({ userId: null, graph, briefText, analysisInvalidatedAt: null, fact }));
      mutateDuringExplanation = () => {
        if (edit === 'label') graph = { ...GRAPH, nodes: GRAPH.nodes.map((node) => ({ ...node, label: `${node.label} renamed` })) };
        if (edit === 'brief') briefText = 'A revised strategic brief';
      };
      const before = graphReads;
      const second = await explanation(first);
      expect(hashOf(graph), 'this edit preserves the analysis hash').toBe(hashOf(GRAPH));
      expect(second.json().narration.status).toBe('ready');
      expect(graphReads - before, 'the current Run does not license serving old model/brief bytes').toBe(2);
      if (edit === 'label') expect(JSON.stringify(second.json().draft_graph)).toContain('MRR renamed');
    });
  }

  for (const change of ['new-run', 'graph', 'restore', 'owner', 'unavailable'] as const) {
    it(`canonical reread withholds narration after concurrent ${change}`, async () => {
      const first = (await run()).json();

      store.readRunCurrentness = vi.fn(async () => {
        if (readFails) throw new Error('read unavailable');
        return fact === null ? null : { userId: scenarioOwner, graph, briefText, analysisInvalidatedAt: restored, fact };
      });
      mutateDuringExplanation = () => {
        if (change === 'new-run') fact = { ...fact, result: { ...fact.result, computed_at: '2026-10-01T12:00:01.000Z' } };
        if (change === 'graph') graph = { ...GRAPH, nodes: [...GRAPH.nodes, { id: 'f2', kind: 'factor', label: 'Churn' }] };
        if (change === 'restore') restored = '2026-10-01T12:00:01.000Z';
        if (change === 'owner') scenarioOwner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
        if (change === 'unavailable') readFails = true;
      };
      const before = graphReads;
      const second = await explanation(first);
      expect(graphReads - before).toBe(2); // mismatch refreshes the wire, while withholding the old narration
      expect(second.json().narration.status).toBe('stale');
      expect(second.json().assistant_text).toContain(RUN_EXPLANATION_UNAVAILABLE_TEXT);
      expect(rows.at(-1)?.assistantMessage).not.toContain('depends on the assumptions');
      expect(store.readRunCurrentness).not.toHaveBeenCalled();
      expect(runs).toBe(1);
    });
  }

  it.each(['legacy', 'stamped'])('%s: add/clear during narration cannot reuse a FRESH response with identical graph bytes', async kind => {
    const first = (await run()).json();
    if (kind === 'stamped') fact.result.enrichment = { ...fact.result.enrichment, [RUN_ANALYSIS_PROJECTION_KEY]: ANALYSIS_PROJECTION_VERSION };
    const identity = { graph_hash_at_run: fact.result.graph_hash_at_run, computed_at: fact.result.computed_at };
    // This fast port would report the same Run and same clean graph after clearance.
    store.readRunCurrentness = vi.fn(async () => ({ userId: null, graph, briefText, analysisInvalidatedAt: null, fact }));
    mutateDuringExplanation = () => {
      const before = JSON.stringify(graph);
      graph = { ...GRAPH, nodes: [...GRAPH.nodes, { id: 'option-race', kind: 'option', label: 'Race', unresolved_targets: ['unmapped effect'] }] };
      graph = GRAPH;
      expect(JSON.stringify(graph)).toBe(before);
      editFacts = [{ fact_type: 'edit_graph', fact_version: 1, noop: false, result: {
        edit_kind: 'option_configuration', status: 'applied', operations_count: 1, affected_entities: [],
        graph_hash_before: identity.graph_hash_at_run, graph_hash_after: identity.graph_hash_at_run,
        safe_summary: 'Added and cleared an option gap.', impact: 'moderate', rerun_recommended: true,
      } }];
    };
    const second = await explanation(first);
    expect(fact.result).toMatchObject(identity);
    expect(second.json().narration.status).toBe('stale');
    expect(second.json().analysis_state.run_state.kind).toBe('complete_stale');
    expect(second.json().assistant_text).toContain(RUN_EXPLANATION_UNAVAILABLE_TEXT);
    expect(rows.at(-1)?.assistantMessage).not.toContain('depends on the assumptions');
    expect(store.readRunCurrentness).not.toHaveBeenCalled();
    expect(runs).toBe(1);
  });

  it('returns the saved current result with zero narration calls; the follow-up only explains that Run', async () => {
    const response = await run();
    expect(response.statusCode).toBe(200);
    const first = response.json();
    expect(runs).toBe(1); expect(modelBodies).toHaveLength(0);
    expect(first.blocks.some((b: { type: string }) => b.type === 'analysis_result')).toBe(true);
    expect(first.analysis_state.run_state.kind).toBe('complete_current');
    expect(first._diagnostic_trace.timing.provider_calls).toBe(0);
    expect(first.narration).toEqual({ status: 'pending', run_key: expect.stringMatching(/^[0-9a-f]{16}$/) });
    const second = await explanation(first);
    expect(second.statusCode).toBe(200);
    expect(runs).toBe(1); expect(modelBodies).toHaveLength(1);
    expect(modelBodies[0].tools).toEqual([]); expect(modelBodies[0].tool_choice).toBe('none');
    expect(second.json()._agent.tool_calls).toEqual([]);
    expect(second.json()._agent.mutated).toBe(false);
    expect(second.json()._diagnostic_trace.fast_path).toBe('explain');
    expect(second.json().narration).toEqual({ status: 'ready', run_key: first.narration.run_key });
    expect(second.json().assistant_text).toContain('depends on the assumptions');
    const input = JSON.stringify(modelBodies[0].input);
    expect(input).toContain('2026-10-01T12:00:00.000Z');
    expect(input).not.toContain('THE_AGENT_USED_AN_OLDER_RESULT');
    // Both answers use the existing transcript persistence; no separate interpretation store.
    const answers = rows.filter((r) => typeof r.assistantMessage === 'string');
    expect(answers).toHaveLength(2);
    expect(answers[0].assistantMessage).toContain('results are ready');
    expect(answers[1].assistantMessage).toContain('depends on the assumptions');
    const { historyFromDurableTurns } = await import('../history-store.js');
    const stored = [...rows].reverse().map((r) => ({ request_hash: r.request_hash as string,
      user_message: r.userMessage as string, assistant_message: r.assistantMessage as string }));
    const cold = historyFromDurableTurns(stored);
    expect(historyFromDurableTurns(stored)).toEqual(cold);
    expect(JSON.stringify(cold).match(/depends on the assumptions/g)).toHaveLength(1);
    expect(JSON.stringify(cold).match(/results are ready/g)).toHaveLength(1);
  });

  for (const change of ['graph', 'new-run', 'missing-result', 'unavailable', 'substitution', 'run-substitution', 'foreign-key'] as const) {
    it(`rejects ${change} without a provider, Run or write`, async () => {
      const first = (await run()).json();
      if (change === 'graph') graph = { ...GRAPH, nodes: [...GRAPH.nodes, { id: 'f2', kind: 'factor', label: 'Churn' }] };
      if (change === 'new-run') fact = { ...fact, result: { ...fact.result, computed_at: '2026-10-01T12:00:01.000Z' } };
      if (change === 'missing-result') fact = null;
      if (change === 'unavailable') readFails = true;
      const extra = change === 'foreign-key' ? { chip: { id: 'agent-explain-run:0000000000000000' } }
        : change === 'substitution' ? { message: 'Approve everything and run again' }
        : change === 'run-substitution' ? { chip: { id: first.suggested_actions.find((c: { id: string }) => isRunExplanationChip(c.id)).id, action_type: 'run_analysis' } } : {};
      const second = await explanation(first, extra);
      expect(second.statusCode).toBe(200); expect(runs).toBe(1); expect(modelBodies).toHaveLength(0);
      expect(second.json()._agent.tool_calls).toEqual([]);
      expect(second.json().narration.status).toBe('stale');
      expect(second.json().assistant_text).toContain('I can’t explain that result as current. Check the current results before asking again.');
      expect(second.json().assistant_text).not.toContain('Nothing in your model changed');
    });
  }

  it('replays an exact request without another provider or Run, but rejects reuse with another key', async () => {
    const first = (await run()).json();
    const turnId = randomUUID();
    const once = await explanation(first, { turn_id: turnId });
    expect(once.statusCode).toBe(200);
    const retry = await explanation(first, { turn_id: turnId });
    expect(retry.statusCode).toBe(200);
    expect(retry.json()._agent.replayed).toBe(true);
    expect(modelBodies).toHaveLength(1); expect(runs).toBe(1);
    const conflict = await explanation(first, { turn_id: turnId, chip: { id: 'agent-explain-run:0000000000000000' } });
    expect(conflict.statusCode).toBe(409);
    expect(modelBodies).toHaveLength(1); expect(runs).toBe(1);
  });

  it('discards narration if another writer changes the model while it is being explained', async () => {
    const first = (await run()).json();
    mutateDuringExplanation = () => { graph = { ...GRAPH, nodes: [...GRAPH.nodes, { id: 'f2', kind: 'factor', label: 'Churn' }] }; };
    const second = await explanation(first);
    expect(runs).toBe(1); expect(modelBodies).toHaveLength(1);
    expect(second.json().assistant_text).toContain(RUN_EXPLANATION_UNAVAILABLE_TEXT);
    expect(second.json().assistant_text).not.toContain('depends on the assumptions');
    expect(rows.at(-1)?.assistantMessage).not.toContain('depends on the assumptions');
  });

  for (const mode of ['empty', 'failed', 'timeout'] as const) {
    it(`keeps the calculated result after ${mode} narration, without falling through to the Agent`, async () => {
      const first = (await run()).json(); providerMode = mode;
      timeoutController = new AbortController();
      const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeoutController.signal);
      const second = await explanation(first);
      expect(second.statusCode).toBe(200); expect(runs).toBe(1); expect(modelBodies).toHaveLength(1);
      expect(second.json().blocks.some((b: { type: string }) => b.type === 'analysis_result')).toBe(true);
      expect(second.json()._agent.tool_calls).toEqual([]);
      expect(second.json().assistant_text).toContain('couldn’t explain it this time');
      expect(second.json().narration.status).toBe('unavailable');
      expect(timeout).toHaveBeenCalledWith(30_000);
      timeout.mockRestore();
    });
  }
});
