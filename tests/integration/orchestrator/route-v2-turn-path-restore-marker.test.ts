/**
 * THE TURN PATH AGREES WITH THE RELOAD ABOUT A RESTORED MODEL — route level.
 *
 * Independent pre-review 5828601536 (source trace at served CEE 9417228); RC
 * ruling 5828706420 §4 asks for exactly this test, keyless and RED first.
 *
 * `buildTurnContext` reads the restore marker (`analysis_invalidated_at`) but
 * its `persisted_analysis_freshness` derivation did not pass it. That derivation
 * is what `turn-claim-safety.ts` hands every GRAPHLESS exit (`clarify_v2`
 * spreads `claimSafety.forExit()` with `graph: null`), so after
 * A → analyse → B → restore A the stored graph's hash MATCHES the run again and
 * a clarify question reports the analysis as current, while the reload of the
 * same scenario, from the same store, says it is stale.
 *
 * One store fake serves all three surfaces, and it is the ONLY variable:
 *   RED      marker NEWER than the run → the clarify_v2 exit says complete_stale,
 *            as the reload does;
 *   RED      the same for a ROUTED turn (turn_executor). The pre-review expected
 *            this to be the control, because `routingFreshness` and
 *            `promptAnalysisFreshness` do thread the marker. Measured: the wire's
 *            `analysis_state` comes from `selectCanonicalAnalysisState`, which has
 *            no marker input, and `analysis_ready.freshness` from the
 *            post-handler derivation, which does not pass it — so a routed turn
 *            also reads complete_current / fresh;
 *   RED      and the MODEL is told `coaching_context.freshness: "fresh"` on that
 *            routed turn (the prompt, not only the wire);
 *   CONTROL  the reload itself (the authority both must agree with);
 *   CONTROL  marker OLDER than the run → every surface says complete_current
 *            (bound by time, not by the marker's presence);
 *   CONTROL  no marker → complete_current everywhere.
 *
 * KEYLESS: the model adapter is replaced and the clarify dispatch's decision to
 * respond is forced; everything from the route's claim-safety stamp to the
 * finaliser's `analysis_state` is real.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import type { SessionTurnWithContent } from '../../../src/orchestrator-v5/session/conversation-content.js';
import type { ToolCallResponse } from '../../../src/orchestrator-v5/routing/tool-schema.js';
import { computeAnalysisAffectingGraphHash } from '../../../src/orchestrator-v5/context/graph-hash.js';
import { createMockSessionStore } from '../../utils/mock-session-store.js';

const { marker, clarify, coachCall } = vi.hoisted(() => ({
  marker: { value: null as string | null },
  clarify: { respond: false },
  coachCall: vi.fn(),
}));

const SCENARIO = 'a1b2c3d4-0000-4000-8000-00000000c0de';
const RUN_AT = '2026-09-25T09:00:00.000Z';
const BEFORE_RUN = '2026-09-25T08:00:00.000Z';
const AFTER_RUN = '2026-09-25T09:30:00.000Z';
const ANSWER = 'The split gives some capacity to reliability and some to sales.';
const CLARIFY_TEXT = 'Which of your constraints matters most here?';

const GRAPH = {
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
const GRAPH_HASH = computeAnalysisAffectingGraphHash(GRAPH);
if (GRAPH_HASH === null) throw new Error('premise: the fixture must have a real analysis hash');

const RUN_ROW_ID = '37fedec1-6d73-4f40-8854-201206f42dd5';
const PRIOR_TURN = {
  id: RUN_ROW_ID,
  scenario_id: SCENARIO,
  user_id: null,
  turn_id: '22222222-2222-4222-8222-222222222222',
  turn_class: 'handler',
  handler_id: 'run_analysis',
  request_hash: 'sha256:prior-analysis',
  response_emitted: true,
  llm_calls_used: 0,
  duration_ms: 8,
  created_at: RUN_AT,
  user_message: 'Run the analysis.',
  assistant_message: 'Analysis complete.',
} satisfies SessionTurnWithContent;
// The run was computed against EXACTLY the stored graph: the restore case, where
// only the marker can say the analysis no longer belongs to this model.
const RUN_FACT = {
  fact_type: 'run_analysis',
  fact_version: 1,
  noop: false,
  result: {
    scenario_id: SCENARIO,
    leading_option_id: null,
    summary: 'Previous analysis',
    enrichment: { analysis_status: 'completed' },
    graph_hash_at_run: GRAPH_HASH,
    computed_at: RUN_AT,
  },
} satisfies HandlerFact;
const IDENTIFIED = { fact: RUN_FACT, fact_row_id: `${RUN_ROW_ID}-fact-0`, fact_created_at: RUN_AT };

const store = createMockSessionStore({
  append: async () => ({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }),
  readRecent: async () => [PRIOR_TURN],
  readFactsFor: async () => [RUN_FACT] as never,
  readFactsWithTurnFor: async () => [{ ...IDENTIFIED, turn_id: PRIOR_TURN.turn_id }] as never,
  readScenarioRunAnalysisFactsFor: async () => ({ facts: [IDENTIFIED], total_count: 1 }) as never,
  loadGraph: async () => structuredClone(GRAPH) as never,
  loadGraphAndBriefText: async () => ({ graph: structuredClone(GRAPH), briefText: 'Balance growth with reliability.' }) as never,
  readAnalysisInvalidatedAt: async () => marker.value,
  ensureScenarioExists: async () => ({ user_id: null }),
  getScenarioOwner: async () => null,
});

vi.mock('../../../src/orchestrator-v5/session/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/orchestrator-v5/session/index.js')>()),
  getSessionStore: () => store,
  resetSessionStoreForTests: () => {},
}));

// The clarify dispatch's DECISION is forced (a live legacy round is incidental
// to this defect); the route's handling of a `respond` is real.
vi.mock('../../../src/orchestrator-v5/handlers/clarify-v2-dispatch.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/orchestrator-v5/handlers/clarify-v2-dispatch.js')>();
  return {
    ...actual,
    tryClarifyV2Turn: async () =>
      clarify.respond
        ? {
            kind: 'respond',
            response: {
              response_version: 2,
              assistant_text: CLARIFY_TEXT,
              blocks: [],
              suggested_actions: [],
              insights: [],
              stage_indicator: 'frame',
            },
          }
        : null,
  };
});

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
const { deriveDecisionContextGraphHash } = await import('../../../src/orchestrator-v5/build-turn-context.js');

/**
 * The `coaching_context` object the MODEL was handed on this turn, found by its
 * key in the prompt text and parsed by brace matching — the whole object, not a
 * substring another field could satisfy.
 */
function coachingContextSentToModel(): Record<string, unknown> {
  const texts: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'string') { if (v.includes('"coaching_context"')) texts.push(v); }
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v !== null && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(coachCall.mock.calls[0]);
  expect(texts, 'premise: the prompt carries exactly one coaching_context').toHaveLength(1);
  const text = texts[0]!;
  const open = text.indexOf('{', text.indexOf('"coaching_context"'));
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    if (text[i] === '}') { depth -= 1; if (depth === 0) return JSON.parse(text.slice(open, i + 1)); }
  }
  throw new Error('coaching_context object is not closed in the prompt');
}

let seq = 0;
function messageTurn() {
  seq += 1;
  return {
    kind: 'message',
    turn_id: `226cb149-9c1e-4518-9300-${String(seq).padStart(12, '0')}`,
    scenario_id: SCENARIO,
    stage: 'analyse',
    turn_class: 'frame',
    message: 'Please remind me how the two-and-two split addresses my reliability concern.',
    source: 'composer',
  };
}

describe('turn path vs reload — a restored model (same hash, newer marker)', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.register(scenarioGraphRoute);
    await app.ready();
  });
  afterAll(async () => { await app.close(); });
  beforeEach(() => {
    vi.clearAllMocks();
    marker.value = null;
    clarify.respond = false;
  });

  async function clarifyExit() {
    clarify.respond = true;
    const res = await app.inject({ method: 'POST', url: '/orchestrate/v2/turn', payload: messageTurn() });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.assistant_text, 'premise: this reply IS the clarify_v2 exit').toBe(CLARIFY_TEXT);
    expect(body.graph ?? null, 'premise: the exit is graphless').toBeNull();
    return body;
  }
  async function routedTurn() {
    clarify.respond = false;
    const res = await app.inject({ method: 'POST', url: '/orchestrate/v2/turn', payload: messageTurn() });
    expect(res.statusCode, res.body).toBe(200);
    expect(coachCall, 'premise: this reply went through the TurnExecutor').toHaveBeenCalledTimes(1);
    return res.json();
  }
  async function reload() {
    const res = await app.inject({ method: 'POST', url: `/assist/v1/scenarios/${SCENARIO}/graph`, payload: {} });
    expect(res.statusCode, res.body).toBe(200);
    return res.json();
  }

  it('premise: the run is a hash MATCH on every surface\'s own hash', () => {
    expect(deriveDecisionContextGraphHash(GRAPH)).toBe(GRAPH_HASH);
  });

  it('CONTROL (the authority): the reload says complete_stale when the marker is newer than the run', async () => {
    marker.value = AFTER_RUN;
    const read = await reload();
    expect(read.analysis_state.run_state.kind).toBe('complete_stale');
  });

  it('RED: the clarify_v2 exit agrees with the reload — complete_stale, never complete_current', async () => {
    marker.value = AFTER_RUN;
    const body = await clarifyExit();
    const read = await reload();
    expect(body.analysis_state.run_state.kind).toBe('complete_stale');
    expect(body.analysis_state.run_state.kind).toBe(read.analysis_state.run_state.kind);
  });

  it('RED: a routed turn agrees with the reload — complete_stale, and its analysis_ready is not `fresh`', async () => {
    marker.value = AFTER_RUN;
    const body = await routedTurn();
    const read = await reload();
    expect(body.analysis_state.run_state.kind).toBe('complete_stale');
    expect(body.analysis_state.run_state.kind).toBe(read.analysis_state.run_state.kind);
    expect(body.analysis_ready.freshness).toBe('stale');
  });

  it('RED: the model is not told a restored model\'s analysis is fresh', async () => {
    marker.value = AFTER_RUN;
    await routedTurn();
    expect(coachingContextSentToModel()).toMatchObject({ freshness: 'stale', rerun_required: true });
  });

  it('CONTROL: marker OLDER than the run → complete_current on all three (time, not presence)', async () => {
    marker.value = BEFORE_RUN;
    expect((await clarifyExit()).analysis_state.run_state.kind).toBe('complete_current');
    expect((await reload()).analysis_state.run_state.kind).toBe('complete_current');
    expect((await routedTurn()).analysis_state.run_state.kind).toBe('complete_current');
    expect(coachingContextSentToModel()).toMatchObject({ freshness: 'fresh' });
  });

  it('CONTROL: no marker → complete_current on all three', async () => {
    expect((await clarifyExit()).analysis_state.run_state.kind).toBe('complete_current');
    expect((await reload()).analysis_state.run_state.kind).toBe('complete_current');
    expect((await routedTurn()).analysis_state.run_state.kind).toBe('complete_current');
  });
});
