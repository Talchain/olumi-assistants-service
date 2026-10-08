/** Q6 r1: the actual graph-read route carries the selected stored Run's exclusions to both Agent exits. */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { RunAnalysisHandlerFactSchema, RunInputSnapshotSchema } from '@talchain/schemas/orchestrator';
import { explanationContext } from './fixtures/run-explanation-follow-up.js';

type Rec = Record<string, unknown>;
const SCENARIO = '550e8400-e29b-41d4-a716-4466554400e6';
const KEEP = 'keep_49_price';
const RAISE = 'raise_pro_price_to_59';
const TEST = 'test_54_pro_price';
const AT = '2026-10-08T10:00:00.000Z';
const REPLAY_TURN = '550e8400-e29b-41d4-a716-4466554400e7';
const LABELS = new Map([[KEEP, 'Keep £49'], [RAISE, 'Raise Pro price to £59'], [TEST, 'Test £54 Pro price']]);
const BULLET = '- £49 is held as today; £59 and an Olumi-suggested £54 test are included for comparison.';
const PLAIN_LINE = '‘Test £54 Pro price’ was left out of this comparison.';
const OLUMI_LINE = '‘Test £54 Pro price’ is Olumi’s suggestion, so it was left out of this comparison until you add it.';
const GRAPH = {
  nodes: [
    { id: 'mrr', kind: 'goal', label: 'MRR' },
    { id: 'pro_plan_price', kind: 'factor', label: 'Pro plan price', observed_state: {
      value: 0.245, raw_value: 49, cap: 200, unit: 'GBP/month', source: 'user_override',
    } },
    ...[KEEP, RAISE, TEST].map(id => ({ id, kind: 'option', label: LABELS.get(id),
      interventions: { pro_plan_price: { value: id === KEEP ? 0.245 : id === RAISE ? 0.295 : 0.27,
        raw_value: id === KEEP ? 49 : id === RAISE ? 59 : 54, unit: 'GBP/month', source: 'user_override' } },
    })),
  ],
  edges: [{ from: 'pro_plan_price', to: 'mrr', strength: { mean: 0.5, std: 0.1 },
    exists_probability: 1, effect_direction: 'positive' }],
};

let graph: unknown = GRAPH;
let fact: unknown;
let narratorText = BULLET;
const modelRequests: Rec[] = [];
const rows = new Map<string, { id: string; turn_id: string; request_hash: string; assistant_message: string | null;
  user_message: string | null; llm_calls_used: number }>();
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readExistingScenario: vi.fn(async () => ({ userId: null, graph, briefText: null, analysisInvalidatedAt: null })),
  readCommittedTurn: vi.fn(async (_sid: string, turnId: string) => rows.get(turnId) ?? null),
  append: vi.fn(async (write: { turn_id: string; request_hash: string; assistantMessage?: string;
    userMessage?: string; llm_calls_used: number }) => {
    const row = { id: `row-${rows.size + 1}`, turn_id: write.turn_id, request_hash: write.request_hash,
      assistant_message: write.assistantMessage ?? null, user_message: write.userMessage ?? null,
      llm_calls_used: write.llm_calls_used };
    rows.set(write.turn_id, row);
    return { id: row.id };
  }),
  readRecent: vi.fn(async () => [{ id: 'stored-run-row', turn_id: 'stored-run', created_at: AT }]),
  readFactsFor: vi.fn(async () => [fact]),
  readAnalysisInvalidatedAt: vi.fn(async () => null),
  readMostRecentPendingActions: vi.fn(async () => []),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()), resolveUserIdentity: async () => ({ mode: 'off' }),
}));

type Reason = 'olumi_proposed' | 'infeasible' | 'removed' | 'not_analysable';
const STATES = { olumi_proposed: 'excluded_olumi_proposed', infeasible: 'excluded_infeasible', removed: 'excluded_removed' } as const;

describe('Q6 r1 production graph read → finalRead/replay → left-out-option egress', () => {
  let app: FastifyInstance;
  let hashOf: (graph: unknown) => string | null;
  let stamp: (enrichment: Rec) => Rec;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: { body?: string }) => {
      modelRequests.push(JSON.parse(String(init?.body ?? '{}')) as Rec);
      return new Response(JSON.stringify({ output: [
        { type: 'message', content: [{ type: 'output_text', text: narratorText }] },
      ] }), { status: 200 });
    }));
    vi.resetModules();
    vi.stubEnv('AGENT_LANE_ENABLED', 'true');
    vi.stubEnv('AGENT_LANE_PREVIEW', 'false');
    vi.stubEnv('CEE_REQUIRE_USER_JWT', 'false');
    const { deriveDecisionContextGraphHash } = await import('../../build-turn-context.js');
    hashOf = deriveDecisionContextGraphHash;
    ({ stampRunAnalysisProjection: stamp } = await import('../../context/analysis-projection-policy.js'));
    const { default: scenarioGraphRoute } = await import('../../../routes/assist.v1.scenario-graph.js');
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    await app.register(scenarioGraphRoute);
    await app.register(agentV1TurnRoute);
    await app.ready();
  });
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  beforeEach(() => { graph = structuredClone(GRAPH); rows.clear(); narratorText = BULLET; modelRequests.length = 0; store.append.mockClear(); });

  function seed(reason: Reason, sent = false): void {
    if (reason === 'not_analysable' && !sent) {
      const held = graph as { nodes: Rec[] };
      held.nodes.find(node => node.id === TEST)!.unresolved_targets = ['customer_reaction'];
    }
    const snapshot = reason === 'not_analysable' ? RunInputSnapshotSchema.parse({
      snapshot_version: 1, sent_digest: 'b'.repeat(64), goal: null,
      options: [KEEP, RAISE, ...(sent ? [TEST] : [])].map(option_id => ({ option_id, label: LABELS.get(option_id), settings: [] })),
      options_not_sent: sent ? [] : [{ option_id: TEST, label: LABELS.get(TEST), reason: 'not_analysable' }],
      factors: [], constraints: [], links: [],
    }) : undefined;
    // This is the stored handler fact, not the user-facing analysis_result block. The production reader projects it.
    fact = RunAnalysisHandlerFactSchema.parse({ fact_type: 'run_analysis', fact_version: 1, noop: false, result: {
      scenario_id: SCENARIO, computed_at: AT, graph_hash_at_run: hashOf(graph),
      leading_option_id: RAISE, summary: 'The comparison is recorded.',
      win_probabilities: { [KEEP]: 0.4, [RAISE]: 0.6 },
      constraint_verdict: { may_name_leading_option: true, constraint_verdict_state: 'evaluated_feasible' },
      enrichment: stamp({ analysis_status: 'completed', robustness: { level: 'strong', near_tie: { is_tie: false } } }),
      option_participation: sent || reason === 'not_analysable' ? [] : [{ option_id: TEST, state: STATES[reason] }],
      ...(snapshot !== undefined ? { input_snapshot: snapshot } : {}),
    } });
  }
  const graphRead = () => app.inject({ method: 'POST', url: `/assist/v1/scenarios/${SCENARIO}/graph`, payload: {} });
  const turn = (turnId?: string) => app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
    kind: 'message', scenario_id: SCENARIO, message: 'What does the model hold?', ...(turnId ? { turn_id: turnId } : {}),
  } });

  it.each(['olumi_proposed', 'infeasible', 'removed', 'not_analysable'] as const)(
    'RED-before: %s reaches actual graph read and live final egress from the selected stored fact; sent twin is unchanged',
    async reason => {
      seed(reason);
      const readResponse = await graphRead();
      expect(readResponse.statusCode, readResponse.body).toBe(200);
      const read = readResponse.json() as Rec;
      expect(read.analysis_result, 'control: a fresh result reached the production read').not.toBeNull();
      expect(read.analysis_result, 'input_snapshot never belongs to the production display block').not.toHaveProperty('input_snapshot');
      expect(read.analysis_run_option_set).toMatchObject({
        leftOut: [{ option_id: TEST, label: LABELS.get(TEST), reason }],
        sent: [{ option_id: KEEP }, { option_id: RAISE }],
      });
      expect(read.analysis_option_participation).toEqual(reason === 'not_analysable' ? [] : [{ option_id: TEST, state: STATES[reason] }]);

      const response = await turn();
      expect(response.statusCode, response.body).toBe(200);
      const body = response.json() as { assistant_text: string; _agent: { replayed?: boolean } };
      expect(body._agent.replayed, 'control: actual live finalRead egress').not.toBe(true);
      expect(body.assistant_text).not.toContain(BULLET);
      const line = reason === 'olumi_proposed' ? OLUMI_LINE : PLAIN_LINE;
      expect(body.assistant_text.split(line).length - 1).toBe(1);

      graph = structuredClone(GRAPH); rows.clear(); seed(reason, true);
      const sentResponse = await turn();
      expect(sentResponse.statusCode, sentResponse.body).toBe(200);
      expect(sentResponse.json().assistant_text).toBe(BULLET);
    },
  );

  it('RED-before: replay re-reads not_analysable from the stored snapshot and filters formerly stored sent-option prose', async () => {
    seed('not_analysable', true);
    const sent = await turn(REPLAY_TURN);
    expect(sent.statusCode, sent.body).toBe(200);
    expect(sent.json().assistant_text).toBe(BULLET);
    // The later recorded Run excludes this option. Retry reads that Run; it cannot trust the old assistant words.
    seed('not_analysable');
    const replay = await turn(REPLAY_TURN);
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.json()._agent.replayed).toBe(true);
    expect(replay.json().assistant_text).not.toContain(BULLET);
    expect(replay.json().assistant_text.split(PLAIN_LINE).length - 1).toBe(1);
  });

  it.each([false, true])('RED-before: typed Explain carries not_analysable from the actual selected Run read into saved-run limit facts (sent=%s)', async sent => {
    const LIMIT = 'agent-lane:monthly_churn_rate:<=';
    const limitGraph = structuredClone(GRAPH) as { nodes: Rec[]; edges: Rec[]; goal_constraints?: unknown };
    limitGraph.nodes.find(node => node.id === KEEP)!.is_baseline = true;
    delete limitGraph.nodes.find(node => node.id === KEEP)!.interventions;
    limitGraph.nodes.push({ id: 'monthly_churn_rate', kind: 'factor', label: 'Monthly churn rate', scale_frame: 100,
      observed_state: { value: 0.03, raw_value: 3, unit: '%', source: 'user_override' } });
    limitGraph.edges.push({ from: 'pro_plan_price', to: 'monthly_churn_rate', strength: { mean: 0.2, std: 0.1 },
      provenance: { source: 'cee_hypothesis', magnitude: 'olumi_estimate', natural_effect: {
        amount: 0.1, amount_unit: 'percentage points', per_source_change: 1,
        per_source_change_unit: 'GBP/month', strength_mean: 0.2,
      } } });
    limitGraph.goal_constraints = [{ constraint_id: LIMIT, node_id: 'monthly_churn_rate', label: 'Monthly churn rate',
      operator: '<=', value: 5, unit: '%', value_frame: 'level', provenance: 'explicit' }];
    graph = limitGraph;
    seed('not_analysable', sent);
    const stored = fact as { result: Rec };
    fact = RunAnalysisHandlerFactSchema.parse({ ...stored, result: { ...stored.result,
      constraint_verdict: { may_name_leading_option: false, constraint_verdict_state: 'unevaluated',
        per_limit: [{ constraint_id: LIMIT, state: 'estimate_only', reason: 'level_olumi_estimate' }],
        joint: { state: 'estimate_only' } },
    } });
    const readResponse = await graphRead();
    expect(readResponse.statusCode, readResponse.body).toBe(200);
    const read = readResponse.json() as Rec;
    expect(read.analysis_result).not.toHaveProperty('input_snapshot');
    const { runExplanationChip } = await import('../run-explanation.js');
    const chip = runExplanationChip(SCENARIO, { graphHash: read.graph_hash as string,
      analysisState: read.analysis_state, analysisResult: read.analysis_result });
    expect(chip, 'control: producer binds this Explain control to the real read\'s selected current Run').not.toBeNull();
    narratorText = 'Check the price-to-churn assumption.';
    const explained = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      scenario_id: SCENARIO, message: chip!.message, chip: { id: chip!.id },
    } });
    expect(explained.statusCode, explained.body).toBe(200);
    const context = modelRequests.map(request => explanationContext(request.input)).find(Boolean);
    expect(context, 'control: the typed Explain interpreter ran with the saved Run facts').toBeDefined();
    const limits = (context!.limit_checks as { limits: { say: string; withheld_for?: string[] }[] }).limits;
    expect(limits[0]!.say).toBe(`For ‘Raise Pro price to £59’${sent ? ' and ‘Test £54 Pro price’' : ''} it isn’t shown: it depends on how strongly ‘Pro plan price’ moves ‘Monthly churn rate’, which Olumi estimated.`);
    expect(limits[0]!.withheld_for).toEqual(sent ? ['Raise Pro price to £59', 'Test £54 Pro price'] : ['Raise Pro price to £59']);
  });
});
