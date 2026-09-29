/**
 * ⭐ 0.63.0 ON THE TURN: the run's STORED `goal_certainty` as a SIDECAR root key (DL 5883197828; Canvas 5887080467).
 *
 * A user-clicked Run reaches the UI on the TURN (the cold read is applied only at boot/reload), so the turn carries the
 * SAME array the cold read's `analysis_goal_certainty` does: taken off the graph read, i.e. off the SAME fact, under
 * the SAME gates, as the `analysis_result` this turn shows. The B5 `limit_verdicts` pattern exactly: spread after the
 * finalised body; `OlumiResponseSchema` is `.strict()`, and the UI parser moves an undeclared root key into
 * `__additive__`. Never recomputed on the turn. ABSENT = NOT RECORDED; a recorded `[]` stays `[]`.
 * Mutant (run by hand): drop the route's `goal_certainty` spread → the ⭐ and `[]` rows go RED.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { OlumiResponseSchema } from '@talchain/schemas/boundary';

const SERVED = JSON.parse(readFileSync(new URL('./fixtures/served-graph-read-not-modelled-15e332b.json', import.meta.url), 'utf8')) as {
  graph: unknown;
  graph_hash: string;
};
/** One earned and one unearned decision, contract-valid (`GoalCertaintyDecisionSchema`), as the Run stored them. */
const STORED = [
  { option_id: 'keep_current_49_price', probability_of_goal: 0, earned: true },
  {
    option_id: 'increase_price_to_59', probability_of_goal: 0, earned: false,
    unsized_path: { from: 'pro_plan_price', enters_goal_through: 'pro_plan_price' }, no_break_even: 'not_an_identity',
    say: 'Olumi can’t yet say how likely ‘Increase price to £59’ is to miss the goal.',
  },
];

const SCENARIO = '7c1f8e3b-4d5a-4f6b-8c9d-0e1f2a3b4c5d';

let readPayload: Record<string, unknown> = {};
const rows = new Map<string, { id: string; turn_id: string; request_hash: string; assistant_message: string | null; user_message: string | null; llm_calls_used: number }>();
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (_sid: string, turnId: string) => rows.get(turnId) ?? null),
  append: vi.fn(async (w: { turn_id: string; request_hash: string; assistantMessage?: string; userMessage?: string; llm_calls_used: number }) => {
    const row = { id: `row-${rows.size + 1}`, turn_id: w.turn_id, request_hash: w.request_hash, assistant_message: w.assistantMessage ?? null, user_message: w.userMessage ?? null, llm_calls_used: w.llm_calls_used };
    rows.set(w.turn_id, row);
    return { id: row.id };
  }),
  readRecent: vi.fn(async () => []),
  readFactsFor: vi.fn(async () => []),
  readAnalysisInvalidatedAt: vi.fn(async () => null),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});

/** What the UI parser does before its strict parse: every root key the contract does not declare moves aside. */
function declaredPart(body: Record<string, unknown>): { declared: Record<string, unknown>; additive: string[] } {
  const shape = (OlumiResponseSchema as unknown as { shape: Record<string, unknown> }).shape;
  const declared: Record<string, unknown> = {};
  const additive: string[] = [];
  for (const [k, v] of Object.entries(body)) {
    if (Object.prototype.hasOwnProperty.call(shape, k)) declared[k] = v;
    else additive.push(k);
  }
  return { declared, additive };
}

describe('0.63.0: the Agent turn carries the run\'s STORED goal certainty as the `goal_certainty` sidecar', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      const output = [{ type: 'message', content: [{ type: 'output_text', text: 'Here is what the model holds.' }] }];
      return new Response(JSON.stringify({ output }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async () => readPayload);
    await app.register(agentV1TurnRoute);
    await app.ready();
  });
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => {
    readPayload = { graph: SERVED.graph, graph_hash: SERVED.graph_hash };
    rows.clear();
    store.append.mockClear();
  });

  const turn = () => app.inject({
    method: 'POST', url: '/agent/v1/turn',
    payload: { kind: 'message', scenario_id: SCENARIO, message: 'What does the model hold?' },
  });

  it('⭐ a read carrying the run\'s stored array → `goal_certainty` on the turn, equal to it byte for byte', async () => {
    readPayload = { ...readPayload, analysis_goal_certainty: STORED };
    const r = await turn();
    expect(r.statusCode).toBe(200);
    const body = r.json() as Record<string, unknown>;
    expect(body.graph_hash, 'control: the read was taken').toBe(SERVED.graph_hash);
    expect(body.goal_certainty).toEqual(STORED);
    // Strict validation: the declared body still parses, and the key rides aside (the UI reads `__additive__`).
    const { declared, additive } = declaredPart(body);
    const parsed = OlumiResponseSchema.safeParse(declared);
    expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues.slice(0, 3))).toBe(true);
    expect(additive).toContain('goal_certainty');
    expect(OlumiResponseSchema.safeParse({ ...declared, goal_certainty: STORED }).success, 'contrast: the turn contract does not declare it').toBe(false);
  });

  it('RECORDED EMPTY: a read carrying `[]` → `goal_certainty: []` on the turn, never dropped to absent', async () => {
    readPayload = { ...readPayload, analysis_goal_certainty: [] };
    const body = (await turn()).json() as Record<string, unknown>;
    expect(body).toHaveProperty('goal_certainty');
    expect(body.goal_certainty).toEqual([]);
  });

  it.each([
    ['the read carries none (a Run from before 0.63.0, or a stale Run)', () => {}],
    ['the read\'s array is not one the contract accepts (an earned decision carrying a sentence)', () => {
      readPayload = { ...readPayload, analysis_goal_certainty: [{ option_id: 'x', probability_of_goal: 1, earned: true, say: 'certain' }] };
    }],
  ])('CONTRAST: %s → no `goal_certainty` key, and the declared body still parses', async (_name, arrange) => {
    arrange();
    const r = await turn();
    expect(r.statusCode).toBe(200);
    const body = r.json() as Record<string, unknown>;
    expect(body.graph_hash, 'control: the read was taken').toBe(SERVED.graph_hash);
    expect('goal_certainty' in body).toBe(false);
    expect(OlumiResponseSchema.safeParse(declaredPart(body).declared).success).toBe(true);
  });
  describe('0.65.0: the Agent turn carries stored option participation beside its selected result', () => {
  const EXCLUDED = [{ option_id: 'suggested', state: 'excluded_olumi_proposed' }];

  it('turn and cold read carry the same verdict, including a recorded empty array', async () => {
    for (const participation of [EXCLUDED, []]) {
      readPayload = { graph: SERVED.graph, graph_hash: SERVED.graph_hash,
        analysis_option_participation: participation };
      const body = (await app.inject({ method: 'POST', url: '/agent/v1/turn',
        payload: { kind: 'message', scenario_id: SCENARIO, message: `What does the model hold ${participation.length}?` },
      })).json() as Record<string, unknown>;
      expect(body.option_participation).toEqual(participation);
      expect(declaredPart(body).additive).toContain('option_participation');
    }
  });

  it('an unrecorded or invalid verdict is absent from the turn', async () => {
    for (const participation of [undefined, [{ option_id: 'suggested', state: 'invalid' }]]) {
      readPayload = { graph: SERVED.graph, graph_hash: SERVED.graph_hash,
        ...(participation !== undefined ? { analysis_option_participation: participation } : {}) };
      const body = (await app.inject({ method: 'POST', url: '/agent/v1/turn',
        payload: { kind: 'message', scenario_id: SCENARIO, message: `What does the model hold ${String(participation)}?` },
      })).json() as Record<string, unknown>;
      expect(body).not.toHaveProperty('option_participation');
    }
  });
});
});
