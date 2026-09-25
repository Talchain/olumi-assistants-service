/**
 * THE RELOAD CARRIES THE SAME CURRENCY FACTS A TURN DOES — the CEE contract the
 * UI's "reload keeps a current Run's action live" (fix 2) relies on.
 *
 * #69 5830148774 (AI Conversation) and 5830165222 (R&C): after a reload the
 * run-turn card is `current` iff (1) its `graph_hash_at_generation` equals the
 * current graph hash, (2) `run_state` is `complete_current` with a usable
 * `computed_at`, and (3) the card's `created_at` equals `run_state.computed_at`
 * by EXACT string equality. The card's hash and `created_at` come from a TURN;
 * after a reload the other side of each comparison comes from the boot read
 * (`POST /assist/v1/scenarios/:id/graph`). So the contract is:
 *
 *   C1  for the same stored bytes, the reload's top-level `graph_hash` equals a
 *       turn's top-level `graph_hash` AND its `analysis_ready.current_graph_hash`
 *       (one concept, one value, two carriers — no second field is needed);
 *   C2  the reload's `run_state.computed_at` is the run fact's `computed_at`
 *       byte for byte (served shape, `…41.123Z`);
 *   C2b and a NON-canonical `computed_at` (microseconds, no milliseconds, an
 *       offset, 1–2 fraction digits — measured, every one) never yields a
 *       verdict: the reload fails closed to `unknown_degraded`. So whenever it
 *       says `complete_current`, `computed_at` is already the canonical
 *       `toISOString` form, and a card comparing `created_at` to it by exact
 *       string cannot be misled by a re-serialisation on the CEE side;
 *   C3  the reload says `complete_current` for a hash-matching run and no newer
 *       restore marker, and the turn agrees;
 *   CONTROL  the stored graph differs from the analysed one → the reload says
 *       `complete_stale`, and its `graph_hash` differs from the analysed hash.
 *
 * Keyless: the model adapter is replaced; the route, the commit-free routed turn
 * and the reload read are real, over one store fake.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import type { SessionTurnWithContent } from '../../../src/orchestrator-v5/session/conversation-content.js';
import type { ToolCallResponse } from '../../../src/orchestrator-v5/routing/tool-schema.js';
import { computeAnalysisAffectingGraphHash } from '../../../src/orchestrator-v5/context/graph-hash.js';
import { createMockSessionStore } from '../../utils/mock-session-store.js';

const { stored, coachCall } = vi.hoisted(() => ({
  stored: { graph: null as unknown, computedAt: '' },
  coachCall: vi.fn(),
}));

const SCENARIO = 'a1b2c3d4-0000-4000-8000-00000000c0df';
// The served shape (R&C 5830165222: every captured card's `created_at` and the
// run's `computed_at` read `…:4x.xxxZ`).
const RUN_AT = '2026-09-25T05:40:41.123Z';
// Postgres-style microseconds — a string a Date round trip would change.
const RUN_AT_MICROS = '2026-09-25T05:40:41.123456Z';
const ANSWER = 'The split gives some capacity to reliability and some to sales.';

const ANALYSED = {
  goal_node_id: 'goal_revenue',
  nodes: [
    { id: 'dec_hiring', kind: 'decision', label: 'How to use four hires' },
    { id: 'goal_revenue', kind: 'goal', label: 'Sustainable revenue' },
    { id: 'opt_eng', kind: 'option', label: 'Hire Four Platform Engineers', interventions: { fac_eng: 1 } },
    { id: 'opt_split', kind: 'option', label: 'Two-and-Two Split', interventions: { fac_eng: 0.5 } },
    { id: 'fac_eng', kind: 'factor', label: 'Platform Engineer Headcount Added', observed_state: { value: 1 } },
  ],
  edges: [
    { from: 'dec_hiring', to: 'opt_eng', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'dec_hiring', to: 'opt_split', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'opt_eng', to: 'fac_eng', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'opt_split', to: 'fac_eng', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'fac_eng', to: 'goal_revenue', strength: { mean: 0.4, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
  ],
};
// The same model after a value edit — a different analysis hash.
const EDITED = {
  ...ANALYSED,
  nodes: ANALYSED.nodes.map((n) => (n.id === 'fac_eng' ? { ...n, observed_state: { value: 0.6 } } : n)),
};
const ANALYSED_HASH = computeAnalysisAffectingGraphHash(ANALYSED);
const EDITED_HASH = computeAnalysisAffectingGraphHash(EDITED);
if (ANALYSED_HASH === null || EDITED_HASH === null || ANALYSED_HASH === EDITED_HASH) {
  throw new Error('premise: two distinct, real analysis hashes');
}

const RUN_ROW_ID = '37fedec1-6d73-4f40-8854-201206f42dd6';
const PRIOR_TURN = {
  id: RUN_ROW_ID,
  scenario_id: SCENARIO,
  user_id: null,
  turn_id: '22222222-2222-4222-8222-222222222223',
  turn_class: 'handler',
  handler_id: 'run_analysis',
  request_hash: 'sha256:prior-analysis',
  response_emitted: true,
  llm_calls_used: 0,
  duration_ms: 8,
  created_at: '2026-09-25T05:40:42.000Z',
  user_message: 'Run the analysis.',
  assistant_message: 'Analysis complete.',
} satisfies SessionTurnWithContent;
const RUN_FACT = {
  fact_type: 'run_analysis',
  fact_version: 1,
  noop: false,
  result: {
    scenario_id: SCENARIO,
    leading_option_id: null,
    summary: 'Previous analysis',
    enrichment: { analysis_status: 'completed' },
    graph_hash_at_run: ANALYSED_HASH,
    computed_at: RUN_AT,
  },
} satisfies HandlerFact;
/** The run fact as stored right now (its `computed_at` is the one variable C2b changes). */
const runFact = (): HandlerFact => ({ ...RUN_FACT, result: { ...RUN_FACT.result, computed_at: stored.computedAt } }) as HandlerFact;
const identified = () => ({ fact: runFact(), fact_row_id: `${RUN_ROW_ID}-fact-0`, fact_created_at: PRIOR_TURN.created_at });

const store = createMockSessionStore({
  append: async () => ({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab' }),
  readRecent: async () => [PRIOR_TURN],
  readFactsFor: async () => [runFact()] as never,
  readFactsWithTurnFor: async () => [{ ...identified(), turn_id: PRIOR_TURN.turn_id }] as never,
  readScenarioRunAnalysisFactsFor: async () => ({ facts: [identified()], total_count: 1 }) as never,
  loadGraph: async () => structuredClone(stored.graph) as never,
  loadGraphAndBriefText: async () => ({ graph: structuredClone(stored.graph), briefText: 'Balance growth with reliability.' }) as never,
  readAnalysisInvalidatedAt: async () => null,
  ensureScenarioExists: async () => ({ user_id: null }),
  getScenarioOwner: async () => null,
});

vi.mock('../../../src/orchestrator-v5/session/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/orchestrator-v5/session/index.js')>()),
  getSessionStore: () => store,
  resetSessionStoreForTests: () => {},
}));

vi.mock('../../../src/adapters/llm/router.js', () => {
  const adapter = {
    name: 'test',
    model: 'test-model',
    chat: async () => ({ content: ANSWER, usage: { input_tokens: 1, output_tokens: 1 } }),
    chatWithTools: (...args: unknown[]) => {
      coachCall(...args);
      return Promise.resolve({
        content: [{
          type: 'tool_use',
          id: 'toolu_discuss',
          name: 'olumi_action',
          input: {
            intent_class: 'execute',
            action: {
              handler_id: 'explain_from_structure',
              entity: { id: 'opt_split', kind: 'option', resolution_status: 'resolved', resolution_method: 'context_inference' },
              parameters: [],
              cited_context_fields: [],
              explanation: { answer_text: ANSWER },
              structure_query: { kind: 'general' },
            },
          } satisfies ToolCallResponse,
        }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 20 },
        model: 'test-model',
        latencyMs: 1,
      });
    },
  };
  return {
    getAdapter: () => adapter,
    getAdapterWithResolution: () => ({ adapter, resolution: { task: 'narrate', resolved_model: 'test-model', resolution_source: 'task_default' } }),
    getMaxTokensFromConfig: () => undefined,
  };
});
vi.mock('../../../src/adapters/llm/prompt-loader.js', () => ({ getSystemPrompt: async () => 'Test system prompt.' }));
vi.mock('../../../src/config/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/config/index.js')>();
  return {
    ...actual,
    config: new Proxy(actual.config, {
      get(target, property) {
        if (property === 'features') {
          return new Proxy(target.features, {
            get(features, key) { return key === 'pipelineV4Enabled' ? false : Reflect.get(features, key); },
          });
        }
        return Reflect.get(target, property);
      },
    }),
  };
});

const { ceeOrchestratorRouteV2 } = await import('../../../src/orchestrator/route-v2.js');
const { default: scenarioGraphRoute } = await import('../../../src/routes/assist.v1.scenario-graph.js');

let seq = 0;
type Body = {
  graph_hash?: string | null;
  analysis_ready?: { current_graph_hash?: string | null; freshness?: string };
  analysis_state?: { run_state?: { kind?: string; computed_at?: string } };
};

describe('the reload carries the currency facts a turn carries (fix 2 contract)', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.register(scenarioGraphRoute);
    await app.ready();
  });
  afterAll(async () => { await app.close(); });
  beforeEach(() => { vi.clearAllMocks(); stored.graph = ANALYSED; stored.computedAt = RUN_AT; });

  async function turn(): Promise<Body> {
    seq += 1;
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: `226cb149-9c1e-4518-9300-${String(seq).padStart(12, '0')}`,
        scenario_id: SCENARIO,
        stage: 'analyse',
        turn_class: 'frame',
        message: 'Please remind me how the two-and-two split addresses my reliability concern.',
        source: 'composer',
      },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(coachCall, 'premise: a routed turn (no graph write)').toHaveBeenCalledTimes(1);
    return res.json() as Body;
  }
  async function reload(): Promise<Body> {
    const res = await app.inject({ method: 'POST', url: `/assist/v1/scenarios/${SCENARIO}/graph`, payload: {} });
    expect(res.statusCode, res.body).toBe(200);
    return res.json() as Body;
  }

  it('C1: for the same stored bytes, reload.graph_hash === turn.graph_hash === turn.analysis_ready.current_graph_hash', async () => {
    const t = await turn();
    const r = await reload();
    expect(t.graph_hash, 'premise: the turn carries the current hash').toBe(ANALYSED_HASH);
    expect(t.analysis_ready?.current_graph_hash).toBe(t.graph_hash);
    expect(r.graph_hash).toBe(t.graph_hash);
  });

  it('C2b: a NON-canonical computed_at never yields a verdict — the reload fails closed to unknown_degraded, never complete_current', async () => {
    stored.computedAt = RUN_AT_MICROS;
    const r = await reload();
    expect(r.analysis_state?.run_state?.kind).not.toBe('complete_current');
    expect(r.analysis_state?.run_state?.kind).toBe('unknown_degraded');
  });

  it('C2: reload run_state.computed_at is the run fact\'s computed_at BYTE FOR BYTE (and the turn agrees)', async () => {
    const r = await reload();
    const t = await turn();
    expect(r.analysis_state?.run_state?.computed_at).toBe(RUN_AT);
    expect(t.analysis_state?.run_state?.computed_at).toBe(RUN_AT);
  });

  it('C3: a hash-matching run with no newer marker is complete_current on the reload and on the turn', async () => {
    const r = await reload();
    const t = await turn();
    expect(r.analysis_state?.run_state?.kind).toBe('complete_current');
    expect(t.analysis_state?.run_state?.kind).toBe('complete_current');
  });

  it('CONTROL: the stored graph moved since the run → reload complete_stale, and its graph_hash is not the analysed hash', async () => {
    stored.graph = EDITED;
    const r = await reload();
    expect(r.analysis_state?.run_state?.kind).toBe('complete_stale');
    expect(r.graph_hash).toBe(EDITED_HASH);
    expect(r.graph_hash).not.toBe(ANALYSED_HASH);
  });
});
