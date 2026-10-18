/**
 * The approval-one-action world (SYNTHETIC bakery model and wording), shared by the route rows and the real-AI consent gate:
 * the REAL `agentV1TurnRoute` over an in-memory session store, the UI's request shapes, 0 network outside the Agent's provider.
 * Each spec owns its `vi.mock`s and passes its hoisted store holder in (`world(live)`).
 */
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { expect, vi } from 'vitest';
import { createMockSessionStore, makeSessionTurnRow } from '../../../../../tests/utils/mock-session-store.js';
import { approvalChipIdFor } from '../../approval-chips.js';
import { computeAnalysisAffectingGraphHash } from '../../../context/graph-hash.js';
import { constructionOperationId } from '../../runtime/build-model.js';
import { registrationTurnId } from '../../../graph-registration/registration-identity.js';
import type { SessionTurnWithContent } from '../../../session/conversation-content.js';

export type Rec = Record<string, any>;
export const STAMP = '2026-10-18T09:00:00.000Z';
export const BRIEF = 'Our bakery wants at least 90% of orders ready on time. Should we add a second oven or buy a faster mixer?';
export const edge = (from: string, to: string, mean = 1) => ({ from, to, strength: { mean, std: 0.01 }, provenance: { source: 'cee_hypothesis' },
  effect_direction: 'positive', exists_probability: 1 });
export const GRAPH: Rec = {
  nodes: [
    { id: 'oven_or_mixer', ref: 'D1', kind: 'decision', label: 'Add a second oven or buy a faster mixer?', provenance: 'from_brief' },
    { id: 'orders_on_time', ref: 'G1', kind: 'goal', label: 'Orders ready on time', provenance: 'from_brief', goal_direction: '>=', goal_threshold: 0.9 },
    { id: 'add_second_oven', ref: 'O1', kind: 'option', label: 'Add a second oven', provenance: 'from_brief',
      interventions: { oven_capacity: { unit: 'ovens', value: 0.5, raw_value: 2, source: 'cee_hypothesis', target_match: { node_id: 'oven_capacity' } } } },
    { id: 'buy_faster_mixer', ref: 'O2', kind: 'option', label: 'Buy a faster mixer', provenance: 'from_brief' },
    { id: 'carry_on', ref: 'O3', kind: 'option', label: 'Carry on as now', provenance: 'ai_inferred', is_baseline: true },
    { id: 'oven_capacity', ref: 'F1', kind: 'factor', label: 'Oven capacity', category: 'controllable', provenance: 'ai_inferred', scale_frame: 4,
      observed_state: { unit: 'ovens', value: 0.25, raw_value: 1, source: 'cee_inference' } },
    { id: 'prep_time_cut', ref: 'F2', kind: 'factor', label: 'Prep time cut from mixer', category: 'controllable', provenance: 'ai_inferred', scale_frame: 100 },
  ],
  edges: [edge('oven_or_mixer', 'add_second_oven'), edge('oven_or_mixer', 'buy_faster_mixer'), edge('oven_or_mixer', 'carry_on'),
    edge('add_second_oven', 'oven_capacity'), edge('oven_capacity', 'orders_on_time', 0.5), edge('prep_time_cut', 'orders_on_time', 0.3)],
  ref_high_water: { D: 1, G: 1, O: 3, F: 2 },
};
export const LAPSE = /no longer fits the model as it now stands, so it has lapsed/;
export const hash = (g: Rec) => computeAnalysisAffectingGraphHash(g as never)!;
export const node = (g: Rec, id: string): Rec => g.nodes.find((n: Rec) => n.id === id);
export const say = (text: string) => ({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] });
export const call = (name: string, args: Rec) => ({ output: [{ type: 'function_call', name, call_id: `call_${name}_${randomUUID().slice(0, 8)}`, arguments: JSON.stringify(args) }] });
/** Olumi's starting value for the factor (card A): an assumption, never the user's. */
export const START = { assumptions: [{ factor_label: 'Prep time cut from mixer', value: 0, unit: '%', user_stated: false,
  basis: 'Olumi assumes no cut today because the mixer is not bought yet.' }], option_levels: [] };
/** The user's own figure for the mixer (card B): a new link with its level. */
export const MIXER = { interventions: [{ option_label: 'Buy a faster mixer', factor_label: 'Prep time cut from mixer', value: 15, user_stated: true,
  basis: 'The user: the faster mixer cuts prep time by 15%.' }] };
export const MIXER_WORDS = 'The faster mixer cuts prep time by 15%.';

export function world(live: { store: unknown }) {
  const sid = randomUUID(); let bytes = JSON.stringify(GRAPH);
  const read = (): Rec => JSON.parse(bytes);
  const rows: SessionTurnWithContent[] = [makeSessionTurnRow({ id: randomUUID(), scenario_id: sid, turn_id: registrationTurnId(sid, constructionOperationId(sid, BRIEF)),
    request_hash: 'graph_registration:draft', turn_class: 'direct_answer', handler_id: null, response_emitted: false, created_at: STAMP })];
  const writes: Rec[] = []; const latest = () => rows.find(r => !r.turn_id.endsWith(':claim'));
  live.store = createMockSessionStore({
    loadGraph: async () => read(), loadGraphAndBriefText: async () => ({ graph: read(), briefText: BRIEF }),
    ensureScenarioExists: async () => ({ user_id: null }),
    readCommittedTurn: async (_sid, id) => { const r = rows.find(x => x.turn_id === id); return r ? { id: r.id, request_hash: r.request_hash,
      user_message: r.user_message ?? null, assistant_message: r.assistant_message ?? null, llm_calls_used: r.llm_calls_used, pending_actions: (r as Rec).pending_actions ?? [] } : null; },
    readMostRecentPendingActions: async (_sid, opts) => { opts?.onLatestRowId?.(latest()?.id ?? null); return (latest() as Rec)?.pending_actions ?? []; },
    readRecent: async () => rows.filter(r => !r.turn_id.endsWith(':claim')),
    readFactsWithTurnFor: async ids => rows.flatMap(r => ids.includes(r.id) ? (writes.find(w => w.turn_id === r.turn_id)?.handler_facts ?? [])
      .map((fact: Rec) => ({ turn_id: r.id, fact_created_at: r.created_at, fact })) : []),
    append: async write => {
      writes.push(JSON.parse(JSON.stringify(write))); if (write.graph !== undefined && write.graph !== null) bytes = JSON.stringify(write.graph);
      const id = randomUUID(); rows.unshift({ ...makeSessionTurnRow({ id, scenario_id: sid, turn_id: write.turn_id, request_hash: write.request_hash,
        turn_class: write.turn_class, handler_id: write.handler_id, response_emitted: write.response_emitted, created_at: new Date().toISOString(),
        user_message: write.userMessage ?? null, assistant_message: write.assistantMessage ?? null }), pending_actions: write.pending_actions ?? [] } as SessionTurnWithContent);
      return { id };
    },
  });
  const graphWire = () => ({ graph: read(), graph_hash: hash(read()), brief_text: BRIEF, scenario_created_at: STAMP });
  const versions = () => ({ versions: [{ version_id: 'draft-r1', sequence: 1, created_at: STAMP,
    creation: { kind: 'initial', source_turn_id: registrationTurnId(sid, constructionOperationId(sid, BRIEF)) } }] });
  const onLatestRow = (chipId: string): boolean => ((latest() as Rec | undefined)?.pending_actions ?? []).some((p: Rec) => p.chip_id === chipId);
  return { sid, read, graphWire, versions, onLatestRow };
}

/** The open apps, closed by the spec's `afterEach` (`closeApps`). */
const apps: FastifyInstance[] = [];
export async function closeApps(): Promise<void> { for (const app of apps.splice(0)) await app.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); }
/**
 * The Agent's provider: a turn's scripted outputs answer first, in order; then `fallback(request)` (a recorded reply, or the
 * real provider), else "Noted.". Brief spans always fail closed (as served when unavailable). Any other network is refused.
 */
export type Respond = (req: Rec, url: string, init: { body?: string; headers?: unknown; method?: string } | undefined) => Promise<Response> | Response;
export type Turn = (over: Rec, steps?: Rec[]) => Promise<Rec>;
export async function route(w: ReturnType<typeof world>, fallback?: Respond): Promise<Turn> {
  let script: Rec[] = [];
  vi.stubEnv('AGENT_LANE_ENABLED', 'true'); vi.stubEnv('AGENT_LANE_PREVIEW', 'false');
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: { body?: string; headers?: unknown; method?: string }) => {
    if (!String(url).includes('openai')) throw new Error(`Network forbidden: ${String(url)}`);
    const req = JSON.parse(String(init?.body ?? '{}')) as Rec;
    if (req.text?.format?.name === 'brief_spans') return new Response('{}', { status: 500 });
    if (script.length > 0) return new Response(JSON.stringify(script.shift()), { status: 200 });
    return fallback !== undefined ? fallback(req, String(url), init) : new Response(JSON.stringify(say('Noted.')), { status: 200 });
  }));
  const { agentV1TurnRoute } = await import('../../../../routes/agent-v1-turn.js');
  const app = Fastify({ logger: false }); apps.push(app);
  app.post('/assist/v1/scenarios/:id/graph', async () => w.graphWire());
  app.post('/assist/v1/scenarios/:id/versions', async () => w.versions());
  app.post('/orchestrate/v2/turn', async (_req, reply) => reply.code(500).send({}));
  await app.register(agentV1TurnRoute); await app.ready();
  // As the client does: a typed turn sends the cards its last reply showed (`shownBy`), unless the turn names its own set.
  // `lost: true` is a reply lost in transport: the client never saw it, so what it shows does not change.
  let shown: Rec[] = [];
  return async ({ lost, ...over }: Rec, steps: Rec[] = []): Promise<Rec> => {
    script = [...steps];
    const displayed = over.source === 'composer' && !('displayed_proposals' in over) ? { displayed_proposals: shown } : {};
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', turn_id: randomUUID(), scenario_id: w.sid, ...displayed, ...over } });
    expect(r.statusCode, r.body.slice(0, 2000)).toBe(200);
    const body = r.json() as Rec;
    if (lost !== true) shown = shownBy(body);
    return body;
  };
}
/** What the client shows after a reply (DGAI `displayedProposals`): each listed card at its revision, and any other approve button. */
export const shownBy = (body: Rec): Rec[] => {
  const listed = ((body._proposal_fields?.proposals ?? []) as Rec[]).map((p) => ({ proposal_id: p.proposal_id, revision: p.revision }));
  const buttons = chips(body).filter((id) => id.startsWith('agent-approve-proposal:')).map((id) => id.slice('agent-approve-proposal:'.length))
    .filter((id) => !listed.some((p) => p.proposal_id === id)).map((id) => ({ proposal_id: id }));
  return [...listed, ...buttons];
};
export const idOf = (body: Rec, tool: string): string => {
  const made = (body._agent.tool_calls as Rec[]).filter((c) => c.name === tool);
  expect(made, JSON.stringify(body._agent.tool_calls)).toEqual([expect.objectContaining({ ok: true })]);
  return String(made[0]!.proposal_id);
};
export const chips = (body: Rec): string[] => ((body.suggested_actions ?? []) as Rec[]).map((c) => String(c.id));
export const chipFor = (body: Rec, id: string): Rec => {
  const chip = ((body.suggested_actions ?? []) as Rec[]).find((c) => c.id === approvalChipIdFor(id));
  expect(chip, `no button for ${id}: ${JSON.stringify(body.suggested_actions)}`).toBeDefined();
  return chip!;
};
export const authorised = (body: Rec): Rec[] => (body._agent.tool_calls as Rec[]).filter((c) => c.name === 'authorise_change');
export const mixerSaved = (g: Rec): boolean => g.edges.some((e: Rec) => e.from === 'buy_faster_mixer' && e.to === 'prep_time_cut')
  && node(g, 'buy_faster_mixer').interventions?.prep_time_cut !== undefined;

/** Card A (Olumi's starting value), then card B (the user's 15%), both held. */
export async function bothCards(w: ReturnType<typeof world>, turn: Turn) {
  const first = await turn({ message: 'What starting value would you use for the prep time cut?', source: 'composer' },
    [call('propose_starting_point', START), say('Here is a starting value for you to adopt or correct.')]);
  const a = idOf(first, 'propose_starting_point'); const session = first._agent.session_id;
  const second = await turn({ message: MIXER_WORDS, source: 'composer', agent_session_id: session },
    [call('propose_option_interventions', MIXER), say('Here is that change for you to approve.')]);
  const b = idOf(second, 'propose_option_interventions');
  expect(w.onLatestRow(approvalChipIdFor(a)), 'card A still held beside B').toBe(true);
  expect(w.onLatestRow(approvalChipIdFor(b))).toBe(true);
  return { a, b, session, first };
}

