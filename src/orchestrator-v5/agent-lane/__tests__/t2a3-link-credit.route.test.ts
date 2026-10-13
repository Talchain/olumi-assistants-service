/**
 * T2A3 (#2993 independent check, blocking 1 and 2) on the REAL path: DGAI sends the selected link as
 * `selected_elements: [{ id: 'from→to', kind: 'edge' }]`; `/agent/v1/turn` resolves it to `grounded_links`
 * (`agent-v1-turn.ts`, the runAgentTurn ctx) and the earlier typed turns to `user_text`. The stubbed model calls
 * `propose_link_strengths`; the real capability decides whose band each link holds. Served bytes: the W3 cold read
 * (`520aab46`, CEE `f074916`). 0 LLM calls.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type Json = Record<string, any>;
const SERVED = JSON.parse(readFileSync(new URL('./fixtures/served-w3-520aab46-cold-read-f074916.json', import.meta.url), 'utf8')) as Json;
const SCENARIO = '6a7c2f0e-1b3d-4e5f-8a9b-0c1d2e3f4a5c';
const LATER = 'OK, record your estimates for the links.';

const rows: Json[] = [];
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (_s: string, id: string) => rows.find((r) => r.turn_id === id) ?? null),
  append: vi.fn(async (row: Json) => { rows.push({ ...row, id: row.turn_id }); return { id: String(row.turn_id) }; }),
  readRecent: vi.fn(async () => [...rows].reverse()),
  readFactsFor: vi.fn(async () => []),
  readAnalysisInvalidatedAt: vi.fn(async () => null),
  readMostRecentPendingActions: vi.fn(async () => []),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));
// Observe the real link-set door's input and the operations it prepares; the capability itself runs unchanged.
const doors: { ctx: Json; operations: Json[]; public_label: unknown }[] = [];
vi.mock('../runtime/agent-capabilities.js', async (original) => {
  const actual = await original<typeof import('../runtime/agent-capabilities.js')>();
  return { ...actual, createAgentCapabilities: (...input: Parameters<typeof actual.createAgentCapabilities>) => {
    const capabilities = actual.createAgentCapabilities(...input);
    const proposeLinkStrengths = capabilities.proposeLinkStrengths!;
    return { ...capabilities, proposeLinkStrengths: async (...args: Parameters<typeof proposeLinkStrengths>) => {
      const result = await proposeLinkStrengths(...args);
      const proposal = input[1].get(String(result.proposal_id));
      doors.push({ ctx: args[0] as Json, operations: [...(proposal?.operations ?? [])] as Json[], public_label: result.public_label });
      return result;
    } };
  } };
});

/** What the stubbed model proposes on the turn that asks for it. */
let proposeOn: { message: string; links: Json[] } | null = null;
const lastUserText = (body: Json): string => String((body.input as Json[]).filter((i) => i.role === 'user').pop()?.content?.[0]?.text ?? '');
const reply = (output: Json[]) => new Response(JSON.stringify({ output }), { status: 200 });

describe('T2A3 on /agent/v1/turn: whose band a proposed link strength is', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
      const body = JSON.parse(String(init?.body)) as Json;
      const input = body.input as Json[];
      const thisTurn = input.slice(input.map((i) => i.role === 'user').lastIndexOf(true) + 1);
      const answered = thisTurn.some((i) => i.type === 'function_call_output');
      if (!answered && proposeOn !== null && lastUserText(body) === proposeOn.message) {
        return reply([{ type: 'function_call', name: 'propose_link_strengths', call_id: 'fixture_link_set',
          arguments: JSON.stringify({ links: proposeOn.links, rationale: 'The user asked for these link strengths.' }) }]);
      }
      return reply([{ type: 'message', content: [{ type: 'output_text', text: 'Noted.' }] }]);
    }));
    vi.stubEnv('AGENT_LANE_ENABLED', 'true');
    vi.stubEnv('AGENT_LANE_PREVIEW', 'false');
    vi.resetModules();
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async () => SERVED);
    await app.register(agentV1TurnRoute);
    await app.ready();
  });
  beforeEach(() => { doors.length = 0; proposeOn = null; });
  afterAll(async () => { await app?.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  const send = (payload: Json) => app.inject({ method: 'POST', url: '/agent/v1/turn',
    payload: { kind: 'message', scenario_id: SCENARIO, turn_id: randomUUID(), ...payload } });
  /** The ONE operation the door prepared for this directed link. */
  const opFor = (path: string): Json => {
    expect(doors, 'the stubbed model reached the real link-set door once').toHaveLength(1);
    const ops = doors[0]!.operations.filter((op) => op.path === path);
    expect(ops, path).toHaveLength(1);
    return ops[0]!;
  };

  // Not MRR's own links: MRR = Pro plan price × Paying subscribers defines those, and the door leaves them out.
  const CHURN_SUBSCRIBERS = { id: 'monthly_churn→paying_subscribers', kind: 'edge' };
  it.each([
    ['Pro plan price is strong.', 'model_proposed'],
    ['Monthly churn is strong.', 'user_stated'],
  ] as const)('blocking 1: Monthly churn → Paying subscribers selected, "%s" → %s', async (message, author) => {
    proposeOn = { message, links: [{ from_label: 'Monthly churn', to_label: 'Paying subscribers', strength: 'strong' }] };
    const res = await send({ agent_session_id: `t2a3-${randomUUID()}`, message, selected_elements: [CHURN_SUBSCRIBERS] });
    expect(res.statusCode).toBe(200);
    expect(doors[0]?.ctx.grounded_links, 'the UI selection reaches the door as the host-resolved link').toEqual([{ from: 'monthly_churn', to: 'paying_subscribers' }]);
    expect(opFor('monthly_churn::paying_subscribers').value).toMatchObject({ band: 'strong', author });
    expect(String(doors[0]!.public_label).includes('your estimate')).toBe(author === 'user_stated');
  });

  it.each([
    ['Olumi says Monthly churn has a weak effect on Paying subscribers. Is that right?', 'model_proposed'],
    ['You suggested Monthly churn has a weak effect on Paying subscribers; I disagree.', 'model_proposed'],
    ['Monthly churn has a weak effect on Paying subscribers.', 'user_stated'],
  ] as const)('blocking 2: earlier "%s", then a weak estimate → %s', async (earlier, author) => {
    const session = `t2a3-${randomUUID()}`;
    expect((await send({ agent_session_id: session, message: earlier })).statusCode).toBe(200);
    expect(doors, 'turn 1 proposes nothing').toHaveLength(0);
    proposeOn = { message: LATER, links: [{ from_label: 'Monthly churn', to_label: 'Paying subscribers', strength: 'weak' }] };
    expect((await send({ agent_session_id: session, message: LATER })).statusCode).toBe(200);
    expect(String(doors[0]?.ctx.user_text), 'the earlier turn is retained, verified history').toContain(earlier);
    expect(opFor('monthly_churn::paying_subscribers').value).toMatchObject({ band: 'weak', author });
    expect(String(doors[0]!.public_label).includes('your estimate')).toBe(author === 'user_stated');
  });
});
