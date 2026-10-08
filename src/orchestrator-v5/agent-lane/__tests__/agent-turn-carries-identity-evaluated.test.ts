/**
 * ⭐ IDENTITY-EXACT (DL 8 Oct): THE AGENT TURN CARRIES THE IDENTITIES THIS RUN EVALUATED.
 *
 * Golden journey after Yes to "MRR = price × subscribers": CEE's goal-certainty treats price → MRR and subscribers → MRR
 * as exact (an operand into an identity THIS Run evaluated), but the turn never said so, and the canvas kept marking both
 * "strength not set". The turn now carries the read's `analysis_identity_evaluated_node_ids` (same fact, same gates as
 * `analysis_result`) as its `identity_evaluated_node_ids` sidecar — the `option_participation` pattern.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { OlumiResponseSchema } from '@talchain/schemas/boundary';

const SERVED = JSON.parse(readFileSync(new URL('./fixtures/served-graph-read-not-modelled-15e332b.json', import.meta.url), 'utf8')) as {
  graph: unknown;
  graph_hash: string;
};

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

describe('identity-exact: the Agent turn carries the Run\'s evaluated identity ids as a sidecar', () => {
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
  beforeEach(() => { readPayload = { graph: SERVED.graph, graph_hash: SERVED.graph_hash }; rows.clear(); store.append.mockClear(); });
  const turn = () => app.inject({ method: 'POST', url: '/agent/v1/turn',
    payload: { kind: 'message', scenario_id: SCENARIO, message: 'What does the model hold?' } });

  it('RED: the read\'s evaluated ids → `identity_evaluated_node_ids` on the turn, sorted, riding aside of the strict body', async () => {
    readPayload = { ...readPayload, analysis_identity_evaluated_node_ids: ['starter_tier_mrr', 'mrr'] };
    const r = await turn();
    expect(r.statusCode).toBe(200);
    const body = r.json() as Record<string, unknown>;
    expect(body.graph_hash, 'control: the read was taken').toBe(SERVED.graph_hash);
    expect(body.identity_evaluated_node_ids).toEqual(['mrr', 'starter_tier_mrr']);
    const { declared, additive } = declaredPart(body);
    const parsed = OlumiResponseSchema.safeParse(declared);
    expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues.slice(0, 3))).toBe(true);
    expect(additive).toContain('identity_evaluated_node_ids');
  });

  it('RECORDED EMPTY: `[]` → `identity_evaluated_node_ids: []`, never dropped to absent', async () => {
    readPayload = { ...readPayload, analysis_identity_evaluated_node_ids: [] };
    const body = (await turn()).json() as Record<string, unknown>;
    expect(body).toHaveProperty('identity_evaluated_node_ids');
    expect(body.identity_evaluated_node_ids).toEqual([]);
  });

  it.each([
    ['the read carries none (not attested)', () => {}],
    ['the read\'s value is not a list of ids', () => { readPayload = { ...readPayload, analysis_identity_evaluated_node_ids: [1, ''] }; }],
  ])('CONTRAST: %s → no key, and the declared body still parses', async (_name, arrange) => {
    arrange();
    const body = (await turn()).json() as Record<string, unknown>;
    expect(body.graph_hash, 'control: the read was taken').toBe(SERVED.graph_hash);
    expect('identity_evaluated_node_ids' in body).toBe(false);
    expect(OlumiResponseSchema.safeParse(declaredPart(body).declared).success).toBe(true);
  });
});
