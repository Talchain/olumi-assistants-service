/**
 * ⭐ THE AGENT TURN CARRIES THE RUN'S STORED `option_participation` (52f8cd; DL #75 5924731600; PANEL 5924723004).
 *
 * Served `dafdc620`: Olumi's own option, left out of the comparison on purpose, read "The analysis returned no result
 * for this option" — the Run recorded nothing. A user-clicked Run reaches the UI on THIS turn, so the turn carries the
 * read's `analysis_option_participation` (the SAME stored fact, under the SAME gates as `analysis_result`) as its
 * `option_participation` sidecar, which DGAI `storedOptionParticipation.ts` reads. The `goal_certainty` pattern.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { OlumiResponseSchema } from '@talchain/schemas/boundary';

const SERVED = JSON.parse(readFileSync(new URL('./fixtures/served-graph-read-not-modelled-15e332b.json', import.meta.url), 'utf8')) as {
  graph: unknown;
  graph_hash: string;
};
/** What the Run stored for Olumi's left-out option, contract-valid (`OptionParticipationEntrySchema`). */
const STORED = [{ option_id: 'raise_price_to_54', state: 'excluded_olumi_proposed' }];

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

describe('52f8cd: the Agent turn carries the run\'s STORED option participation as the `option_participation` sidecar', () => {
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

  it('RED: a read carrying the run\'s stored record → `option_participation` on the turn, equal to it byte for byte', async () => {
    readPayload = { ...readPayload, analysis_option_participation: STORED };
    const r = await turn();
    expect(r.statusCode).toBe(200);
    const body = r.json() as Record<string, unknown>;
    expect(body.graph_hash, 'control: the read was taken').toBe(SERVED.graph_hash);
    expect(body.option_participation).toEqual(STORED);
    // Strict validation: the declared body still parses, and the key rides aside (the UI reads `__additive__`).
    const { declared, additive } = declaredPart(body);
    const parsed = OlumiResponseSchema.safeParse(declared);
    expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues.slice(0, 3))).toBe(true);
    expect(additive).toContain('option_participation');
  });

  it('RECORDED EMPTY: a read carrying `[]` → `option_participation: []` on the turn, never dropped to absent', async () => {
    readPayload = { ...readPayload, analysis_option_participation: [] };
    const body = (await turn()).json() as Record<string, unknown>;
    expect(body).toHaveProperty('option_participation');
    expect(body.option_participation).toEqual([]);
  });

  it.each([
    ['the read carries none (a Run from before this: not recorded)', () => {}],
    ['the read\'s array is not one the contract accepts (an exclusion naming unanalysable options)', () => {
      readPayload = { ...readPayload, analysis_option_participation: [{ option_id: 'x', state: 'excluded_olumi_proposed', unanalysable_user_option_ids: ['y'] }] };
    }],
  ])('CONTRAST: %s → no `option_participation` key, and the declared body still parses', async (_name, arrange) => {
    arrange();
    const r = await turn();
    expect(r.statusCode).toBe(200);
    const body = r.json() as Record<string, unknown>;
    expect(body.graph_hash, 'control: the read was taken').toBe(SERVED.graph_hash);
    expect('option_participation' in body).toBe(false);
    expect(OlumiResponseSchema.safeParse(declaredPart(body).declared).success).toBe(true);
  });
});
