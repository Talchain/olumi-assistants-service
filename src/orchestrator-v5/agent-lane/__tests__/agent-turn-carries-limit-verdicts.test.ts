/**
 * ⭐ B5 ON THE TURN: `limit_verdicts: {per_limit, joint}` as a SIDECAR root key (DL 5859845823).
 *
 * The run's per-limit rows are stored on its fact's `constraint_verdict` (`run_analysis`). The graph read carries them
 * as `analysis_limit_verdicts` from the SAME fact, under the SAME gates, as `analysis_result` (the block this turn
 * shows), so the turn's rows describe exactly the run whose result it carries. The route spreads them AFTER the
 * finalised body, beside `_not_modelled`: `OlumiResponseSchema` is `.strict()` and 0.60 does not declare the key, and
 * the UI parser moves an undeclared root key into `__additive__` (DGAI #2212 reads `__additive__.limit_verdicts`).
 *
 * ABSENT = NOT ATTESTED: a read with no rows yields no key, never an empty or defaulted verdict.
 *
 * The fake read route answers with a SERVED 200 of the graph read route (build 15e332b, the A7 fixture) plus the
 * stored rows; the rows are the 17d1 verdict the handler stores (see `run-analysis-per-limit-verdict.test.ts`).
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { OlumiResponseSchema } from '@talchain/schemas/boundary';

const SERVED = JSON.parse(readFileSync(new URL('./fixtures/served-graph-read-not-modelled-15e332b.json', import.meta.url), 'utf8')) as {
  graph: unknown;
  graph_hash: string;
};
const STORED = {
  per_limit: [{ constraint_id: 'agent-lane:monthly_churn:<=', state: 'estimate_only', reason: 'level_olumi_estimate' }],
  joint: { state: 'estimate_only' },
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

describe('B5: the Agent turn carries the run\'s per-limit verdicts as the `limit_verdicts` sidecar', () => {
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

  it('⭐ a read carrying the run\'s rows → `limit_verdicts` on the turn, equal to the stored rows', async () => {
    readPayload = { ...readPayload, analysis_limit_verdicts: STORED };
    const r = await turn();
    expect(r.statusCode).toBe(200);
    const body = r.json() as Record<string, unknown>;
    expect(body.graph_hash, 'control: the read was taken').toBe(SERVED.graph_hash);
    expect(body.limit_verdicts).toEqual(STORED);
    // Strict validation: the declared body still parses, and the key rides aside (the UI reads `__additive__`).
    const { declared, additive } = declaredPart(body);
    const parsed = OlumiResponseSchema.safeParse(declared);
    expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues.slice(0, 3))).toBe(true);
    expect(additive).toContain('limit_verdicts');
    expect(OlumiResponseSchema.safeParse({ ...declared, limit_verdicts: STORED }).success, 'contrast: 0.60 does not declare it').toBe(false);
  });

  it.each([
    ['the read carries no rows (a run that attests none, or an older route)', () => {}],
    ['the read\'s rows are not a verdict the contract accepts', () => { readPayload = { ...readPayload, analysis_limit_verdicts: { per_limit: [{ constraint_id: 'x', state: 'bogus' }], joint: { state: 'scored' } } }; }],
  ])('CONTRAST: %s → no `limit_verdicts` key, and the declared body still parses', async (_name, arrange) => {
    arrange();
    const r = await turn();
    expect(r.statusCode).toBe(200);
    const body = r.json() as Record<string, unknown>;
    expect(body.graph_hash, 'control: the read was taken').toBe(SERVED.graph_hash);
    expect('limit_verdicts' in body).toBe(false);
    expect(OlumiResponseSchema.safeParse(declaredPart(body).declared).success).toBe(true);
  });
});
