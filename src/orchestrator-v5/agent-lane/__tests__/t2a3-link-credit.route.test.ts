/**
 * T2A3 (#2993 independent check, blocking 1 and 2; PL 22:07Z) on the REAL path, end to end:
 * DGAI's `selected_elements: [{ id: 'from→to', kind: 'edge' }]` → `/agent/v1/turn` resolves it to `grounded_links` →
 * the stubbed model calls `propose_link_strengths` → the real door prepares the card → the user presses the card's own
 * approve chip through the same route → the production writer (`commitOptionLevelsInProcess`, fenced in the route) →
 * the stored graph is read back. Served bytes: the W3 cold read (`520aab46`, CEE `f074916`). 0 LLM calls.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';

type Json = Record<string, any>;
const SERVED = JSON.parse(readFileSync(new URL('./fixtures/served-w3-520aab46-cold-read-f074916.json', import.meta.url), 'utf8')) as Json;
const LATER = 'OK, record your estimates for the links.';

type Row = { id: string; scenario_id: string; turn_id: string; request_hash: string; assistant_message: string | null;
  user_message: string | null; llm_calls_used: number; turn_class: string; handler_id: string | null; pending_actions: unknown[]; created_at: string };
const rows = new Map<string, Row>();
const order: string[] = [];
const graphOf = new Map<string, unknown>();
const latestRow = (sid: string): Row | undefined => [...order].reverse().map((k) => rows.get(k)!).find((r) => r.scenario_id === sid && !r.turn_id.endsWith(':claim'));
const parsedPending = async (row: Row | undefined, sid: string): Promise<unknown[]> => {
  const { parsePendingAction } = await import('../../session/pending-action.js');
  return (row ? JSON.parse(JSON.stringify(row.pending_actions)) as unknown[] : []).map((x) => parsePendingAction(x)).filter((x) => x !== null && x.scenario_id === sid);
};
let tick = 0;
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  getScenarioOwner: vi.fn(async () => null),
  readCommittedTurn: vi.fn(async (sid: string, turnId: string) => {
    const row = rows.get(`${sid}:${turnId}`);
    return row === undefined ? null : { ...row, pending_actions: await parsedPending(row, sid) };
  }),
  readMostRecentPendingActions: vi.fn(async (sid: string) => parsedPending(latestRow(sid), sid)),
  append: vi.fn(async (w: Json) => {
    const k = `${w.scenario_id}:${w.turn_id}`;
    if (!rows.has(k)) {
      tick += 1;
      rows.set(k, { id: `row-${rows.size + 1}`, scenario_id: w.scenario_id, turn_id: w.turn_id, request_hash: w.request_hash,
        assistant_message: w.assistantMessage ?? null, user_message: w.userMessage ?? null, llm_calls_used: w.llm_calls_used ?? 0,
        turn_class: w.turn_class ?? 'direct_answer', handler_id: w.handler_id ?? null,
        pending_actions: JSON.parse(JSON.stringify(w.pending_actions ?? [])) as unknown[],
        created_at: new Date(Date.UTC(2026, 9, 13, 0, 0, tick)).toISOString() });
      order.push(k);
      if (w.graph !== undefined && w.graph !== null) graphOf.set(w.scenario_id, JSON.parse(JSON.stringify(w.graph)));
    }
    return { id: rows.get(k)!.id };
  }),
  readRecent: vi.fn(async (sid: string) => [...order].reverse().map((k) => rows.get(k)!).filter((r) => r.scenario_id === sid && !r.turn_id.endsWith(':claim'))),
  readFactsFor: vi.fn(async () => []),
  readFactsWithTurnFor: vi.fn(async () => []),
  readScenarioRunAnalysisFactsFor: vi.fn(async () => ({ facts: [], total_count: 0 })),
  readAnalysisInvalidatedAt: vi.fn(async () => null),
  invalidateScoped: vi.fn(async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] })),
  invalidateAll: vi.fn(async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] })),
  loadGraph: vi.fn(async (sid: string) => graphOf.get(sid) ?? null),
  loadGraphAndBriefText: vi.fn(async (sid: string) => ({ graph: graphOf.get(sid) ?? null, briefText: null })),
  hasPriorTurns: vi.fn(async (sid: string) => order.some((k) => rows.get(k)!.scenario_id === sid)),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store, resetSessionStoreForTests: () => {}, SessionReadError: class SessionReadError extends Error {} }));
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

describe('T2A3 on /agent/v1/turn: whose band a link strength is, from the selection to the saved graph', () => {
  let app: FastifyInstance;
  let scenario = '';
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
    app.post('/assist/v1/scenarios/:id/graph', async (req) => {
      const g = graphOf.get((req.params as { id: string }).id) ?? null;
      return { ...SERVED, graph: g, graph_hash: g === null ? null : computeAnalysisAffectingGraphHash(g as never) };
    });
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 600_000);
  beforeEach(() => {
    doors.length = 0; proposeOn = null;
    scenario = randomUUID();
    graphOf.set(scenario, structuredClone(SERVED.graph));
  });
  afterAll(async () => { await app?.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  const send = async (payload: Json): Promise<Json> => {
    const res = await app.inject({ method: 'POST', url: '/agent/v1/turn',
      payload: { kind: 'message', scenario_id: scenario, turn_id: randomUUID(), ...payload } });
    expect(res.statusCode, res.body.slice(0, 400)).toBe(200);
    return res.json() as Json;
  };
  const edgeNow = (from: string, to: string): Json => (graphOf.get(scenario) as Json).edges.find((e: Json) => e.from === from && e.to === to);
  /** The ONE prepared operation for this link, the card's own approve chip pressed, and the saved edge read back. */
  const proposeAndApprove = async (session: string, message: string, extra: Json, link: Json, path: string) => {
    proposeOn = { message, links: [link] };
    const body = await send({ agent_session_id: session, message, ...extra });
    expect(doors, 'the stubbed model reached the real link-set door once').toHaveLength(1);
    const ops = doors[0]!.operations.filter((op) => op.path === path);
    expect(ops, path).toHaveLength(1);
    const chips = (body.suggested_actions as Json[]).filter((c) => String(c.id).startsWith('agent-approve-proposal:'));
    expect(chips, JSON.stringify(body.suggested_actions)).toHaveLength(1);
    proposeOn = null;
    await send({ agent_session_id: session, message: chips[0]!.message, source: 'chip', chip: { id: chips[0]!.id } });
    return { op: ops[0]!, label: String(doors[0]!.public_label), ctx: doors[0]!.ctx };
  };
  const CHURN = ['monthly_churn', 'paying_subscribers'] as const;
  const CHURN_EDGE = { id: 'monthly_churn→paying_subscribers', kind: 'edge' };
  const NEW_EDGE = { id: 'monthly_new_paying_subscribers→paying_subscribers', kind: 'edge' };
  const churnLink = (strength: string) => ({ from_label: 'Monthly churn', to_label: 'Paying subscribers', strength });
  const expectSaved = (author: 'user_stated' | 'model_proposed', magnitude: number) => {
    const saved = edgeNow(...CHURN);
    expect(Math.abs(saved.strength.mean), 'the approved band was written').toBe(magnitude);
    if (author === 'user_stated') expect(saved.provenance.source).toBe('user_specified');
    else expect(saved.provenance.source, 'Olumi’s estimate, never the user’s').not.toBe('user_specified');
  };

  it.each([
    ['Pro plan price is strong.', [CHURN_EDGE], 'model_proposed'],
    ['Monthly churn is strong.', [CHURN_EDGE], 'user_stated'],
    // PL 22:07Z: two selected links are an ambiguous selection: no link is credited, even the one whose end is named.
    ['Monthly churn is strong.', [CHURN_EDGE, NEW_EDGE], 'model_proposed'],
  ] as const)('blocking 1: "%s" with %j selected → %s, on the card and in the saved graph', async (message, selected, author) => {
    expect(edgeNow(...CHURN).provenance.source, 'precondition: Olumi’s placeholder').toBe('cee_hypothesis');
    const { op, label, ctx } = await proposeAndApprove(`t2a3-${randomUUID()}`, message, { selected_elements: selected },
      churnLink('strong'), CHURN.join('::'));
    expect(ctx.grounded_links, 'the UI selection reaches the door as the host-resolved links')
      .toEqual(selected.map((s) => ({ from: s.id.split('→')[0], to: s.id.split('→')[1] })));
    expect(op.value).toMatchObject({ band: 'strong', author });
    expect(label.includes('your estimate')).toBe(author === 'user_stated');
    expectSaved(author, 0.55);
  });

  it.each([
    ['Olumi says Monthly churn has a weak effect on Paying subscribers. Is that right?', 'model_proposed'],
    ['You suggested Monthly churn has a weak effect on Paying subscribers; I disagree.', 'model_proposed'],
    ['Monthly churn has a weak effect on Paying subscribers.', 'user_stated'],
  ] as const)('blocking 2: earlier "%s", then a weak estimate → %s, on the card and in the saved graph', async (earlier, author) => {
    const session = `t2a3-${randomUUID()}`;
    await send({ agent_session_id: session, message: earlier });
    expect(doors, 'turn 1 proposes nothing').toHaveLength(0);
    const { op, label, ctx } = await proposeAndApprove(session, LATER, {}, churnLink('weak'), CHURN.join('::'));
    expect(String(ctx.user_text), 'the earlier turn is retained, verified history').toContain(earlier);
    expect(op.value).toMatchObject({ band: 'weak', author });
    expect(label.includes('your estimate')).toBe(author === 'user_stated');
    expectSaved(author, 0.1);
  });
});
