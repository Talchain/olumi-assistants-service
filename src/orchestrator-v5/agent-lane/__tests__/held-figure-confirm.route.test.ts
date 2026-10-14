/**
 * ⭐ S2 CONFIRM, ONE PRESS, on the real route (DL 20:09Z 14 Oct; SCIENCE's pricing e2e, served CEE 2a35ff31, turn 02 "Run
 * analysis", `live/runs/2026-10-14T200105Z-pricing-e2e-2a35ff31-ffb2b138`). The Run asked "Is your £49 per subscriber per
 * month today's ‘Pro plan price’?" as free text and offered only "Explain this result": the Run press's interpreter cannot call
 * a tool after the Run, so #3113's confirm card never existed. The route now issues it, quoting Paul's own sentence; ONE press
 * records his £49 as his, through the served level door. Scripted provider; the store, read route and writer are real.
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import type {} from '../../../plugins/scenario-ownership.js';
import type {} from '@fastify/rate-limit';
import { afterEach, describe, expect, it, vi } from 'vitest';
const live = vi.hoisted(() => ({ store: null as unknown }));
vi.mock('../../session/index.js', async original => ({ ...await original<typeof import('../../session/index.js')>(), getSessionStore: () => live.store }));
vi.mock('../../rolling-summary/capture.js', () => ({ maintainRollingSummaryForCommit: async () => undefined }));
vi.mock('../../../adapters/llm/router.js', () => ({
  getAdapter: () => { throw new Error('Providers forbidden in the confirm-card route replay'); },
  getAdapterWithResolution: () => { throw new Error('Providers forbidden in the confirm-card route replay'); }, getMaxTokensFromConfig: () => undefined,
}));
vi.mock('../../../orchestrator/user-identity.js', async original => ({ ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }) }));
import { createMockSessionStore, makeSessionTurnRow } from '../../../../tests/utils/mock-session-store.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { computeGraphIdentityHash } from '../../context/graph-identity.js';
import { valueClassOf } from '../../../cee/provenance/provenance-of.js';
import { runPressToolResponse } from './fixtures/run-press-model.js';
import type { CommittedTurnLedger } from '../../session/store.js';
import type { SessionTurnWithContent } from '../../session/conversation-content.js';

type Rec = Record<string, any>;
const SERVED = (JSON.parse(readFileSync(new URL('./fixtures/pricing-e2e-2a35ff31-read02-after-reopen.json', import.meta.url), 'utf8')) as Rec).body as Rec;
const PRICE = 'pro_plan_price';
const SENTENCE = 'Should we increase the Pro plan price from £49 to £59 per month with the next Pro feature release?';
const ASK = 'Is your £49 per subscriber per month today\'s ‘Pro plan price’?';
const ROUTE_MS = 60_000;
const say = (text: string) => ({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] });
const priceOf = (g: Rec): Rec => (g.nodes as Rec[]).find((n) => n.id === PRICE)!;

/** The served read in a stateful store, with the Run (the served result) behind `/orchestrate/v2/turn`. */
function world(body: Rec) {
  const sid = String(body.scenario_id);
  let bytes = JSON.stringify(body.graph);
  const graph = (): Rec => JSON.parse(bytes);
  const rows: SessionTurnWithContent[] = [];
  const writes: Rec[] = [];
  const latest = () => rows.find(r => !r.turn_id.endsWith(':claim'));
  const ledger: CommittedTurnLedger = { write_turn_ids: [], user_message_turn_ids: [], first_user_message: String(body.brief_text), complete: true } as never;
  const store = createMockSessionStore({
    loadGraph: async () => graph(),
    loadGraphAndBriefText: async () => ({ graph: graph(), briefText: String(body.brief_text) }),
    ensureScenarioExists: async () => ({ user_id: null }),
    readCommittedTurn: async (_sid, id) => { const r = rows.find(x => x.turn_id === id); return r ? { id: r.id, request_hash: r.request_hash,
      user_message: r.user_message ?? null, assistant_message: r.assistant_message ?? null, llm_calls_used: r.llm_calls_used, pending_actions: (r as Rec).pending_actions ?? [] } : null; },
    readMostRecentPendingActions: async (_sid, opts) => { opts?.onLatestRowId?.(latest()?.id ?? null); return (latest() as Rec)?.pending_actions ?? []; },
    readRecent: async () => rows.filter(r => !r.turn_id.endsWith(':claim')),
    readCommittedTurnLedger: async () => structuredClone(ledger),
    readFactsWithTurnFor: async ids => rows.flatMap(r => ids.includes(r.id) ? (writes.find(w => w.turn_id === r.turn_id)?.handler_facts ?? [])
      .map((fact: Rec) => ({ turn_id: r.id, fact_created_at: r.created_at, fact })) : []),
    append: async write => {
      writes.push(JSON.parse(JSON.stringify(write)));
      if (write.graph !== undefined && write.graph !== null) bytes = JSON.stringify(write.graph);
      const id = randomUUID(); rows.unshift({ ...makeSessionTurnRow({ id, scenario_id: sid, turn_id: write.turn_id, request_hash: write.request_hash,
        turn_class: write.turn_class, handler_id: write.handler_id, response_emitted: write.response_emitted, created_at: new Date().toISOString(),
        user_message: write.userMessage ?? null, assistant_message: write.assistantMessage ?? null }), pending_actions: write.pending_actions ?? [] } as SessionTurnWithContent);
      return { id };
    },
  });
  live.store = store;
  const graphWire = () => ({ ...structuredClone(body), graph: graph(), graph_hash: computeAnalysisAffectingGraphHash(graph() as never),
    graph_identity_hash: computeGraphIdentityHash(graph() as never) });
  /** `/orchestrate/v2/turn`: the Run, its served result on today's graph (the press writes through the level door, into the store). */
  const turn = async (_b: Rec): Promise<Rec> => {
    return { response_version: 2, assistant_text: 'ran', suggested_actions: [], insights: [], graph_hash: computeAnalysisAffectingGraphHash(graph() as never),
      blocks: [{ ...structuredClone(body.analysis_result), computed_against_hash: computeAnalysisAffectingGraphHash(graph() as never) }],
      analysis_state: body.analysis_state, analysis_ready: body.current_read.analysis_ready };
  };
  return { sid, rows, writes, graph, graphWire, turn };
}

const apps: FastifyInstance[] = [];
afterEach(async () => { for (const app of apps.splice(0)) await app.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
async function route(w: ReturnType<typeof world>) {
  vi.stubEnv('AGENT_LANE_ENABLED', 'true'); vi.stubEnv('AGENT_LANE_PREVIEW', 'false');
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: { body?: string }) => {
    if (!String(url).includes('openai')) throw new Error(`Network forbidden: ${String(url)}`);
    const req = JSON.parse(String(init?.body ?? '{}')) as Rec;
    if (req.text?.format?.name === 'brief_spans') return new Response('{}', { status: 500 });
    return runPressToolResponse(req) ?? new Response(JSON.stringify(say('Your results are ready.')), { status: 200 });
  }));
  const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
  const app = Fastify({ logger: false }); apps.push(app);
  app.post('/assist/v1/scenarios/:id/graph', async () => w.graphWire());
  app.post('/assist/v1/scenarios/:id/versions', async () => ({ versions: [] }));
  app.post('/orchestrate/v2/turn', async (req) => w.turn(req.body as Rec));
  await app.register(agentV1TurnRoute); await app.ready();
  return async (over: Rec): Promise<Rec> => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', turn_id: randomUUID(), scenario_id: w.sid, ...over } });
    expect(r.statusCode, r.body.slice(0, 2000)).toBe(200);
    return r.json() as Rec;
  };
}
const runPress = { message: 'Run analysis', source: 'chip_click', chip: { action_type: 'run_analysis' } };
const approvals = (body: Rec): Rec[] => ((body.suggested_actions ?? []) as Rec[]).filter((c) => String(c.id).startsWith('agent-approve'));

describe('the Run\'s confirm of the user\'s own figure is ONE card quoting their sentence, with ONE press', () => {
  it('PRECONDITION (served): his £49 is held as his, role unverified; the brief states it in one sentence', () => {
    expect(valueClassOf(priceOf(SERVED.graph).observed_state)).not.toBe('user_stated');
    expect(priceOf(SERVED.graph).observed_state).toMatchObject({ raw_value: 49, user_material_unverified: true });
    expect(SERVED.brief_text).toContain(SENTENCE);
  });

  it('RED→GREEN: the Run press → the ask AND its one card quoting his sentence → the press → his £49, unchanged, is his', async () => {
    const w = world(SERVED);
    const turn = await route(w);
    // As served: Paul typed his brief in this scenario's session, then pressed Run (no agent_session_id on either).
    await turn({ message: SERVED.brief_text, source: 'composer' });
    const ran = await turn(runPress);
    expect(JSON.stringify(ran)).toContain(ASK);
    const cards = approvals(ran);
    expect(cards, JSON.stringify(ran.suggested_actions)).toHaveLength(1);
    // #3113's own card, quoting the message that states it.
    expect(String(cards[0]!.detail ?? cards[0]!.label)).toBe(`Record 1 figure you gave: Pro plan price = £49 per subscriber per month today, as you wrote it: “${SERVED.brief_text}”`);
    expect(SERVED.brief_text).toContain(SENTENCE);
    const graphWrites = () => w.writes.filter((x) => x.graph !== undefined && x.graph !== null).length;
    expect(graphWrites(), 'nothing before the press').toBe(0);
    const pressed = await turn({ message: cards[0]!.message, source: 'chip_click', chip: { id: cards[0]!.id }, agent_session_id: ran._agent?.session_id });
    expect((pressed._agent?.tool_calls as Rec[]).filter((c) => c.name === 'authorise_change'), JSON.stringify(pressed._agent?.tool_calls))
      .toEqual([expect.objectContaining({ ok: true, mutated: true, proposal_id: cards[0]!.id.replace(/^agent-approve-proposal:/, '') })]);
    expect(graphWrites()).toBe(1);
    const os = priceOf(w.graph()).observed_state;
    expect({ raw_value: os.raw_value, value: os.value }).toEqual({ raw_value: 49, value: priceOf(SERVED.graph).observed_state.value });
    expect(valueClassOf(os), JSON.stringify(os)).toBe('user_stated');
  }, ROUTE_MS);

  it('CONTRASTS: two sentences state the figure, or his figure is already his: no card, and nothing is written', async () => {
    const twice: Rec = { ...structuredClone(SERVED), scenario_id: randomUUID(), brief_text: `${SERVED.brief_text} Today we charge £49.` };
    const w1 = world(twice);
    const t1 = await route(w1);
    await t1({ message: twice.brief_text, source: 'composer' });
    expect(approvals(await t1(runPress))).toEqual([]);
    expect(w1.writes.filter((x) => x.graph !== undefined && x.graph !== null)).toHaveLength(0);
    const own: Rec = { ...structuredClone(SERVED), scenario_id: randomUUID() };
    const { user_material_unverified: _u, ...kept } = priceOf(own.graph).observed_state;
    priceOf(own.graph).observed_state = { ...kept, source: 'user_override', extractionType: 'explicit' };
    priceOf(own.graph).provenance = 'user_set';
    const w2 = world(own);
    const t2 = await route(w2);
    await t2({ message: own.brief_text, source: 'composer' });
    const ran = await t2(runPress);
    expect(JSON.stringify(ran)).not.toContain(ASK);
    expect(approvals(ran)).toEqual([]);
  }, ROUTE_MS);
});
