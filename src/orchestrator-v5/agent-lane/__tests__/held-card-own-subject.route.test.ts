/**
 * ⭐ A HELD DEADLINE CARD LAPSES ONLY WHEN ITS OWN SUBJECT CHANGED (hiring judges post3007/3008/3009: "the deadline card lapses
 * after an unrelated approval"; DL 14 Oct, option (A); `proposal-object/still-applies.ts`).
 *
 * Served hiring post3009 (`tests/fixtures/held-card/…`, the `/graph` read before turn 05, verbatim): turn 02 offered the deadline
 * card, turn 04 proposed two link strengths, turn 05 approved them, and that same turn said the deadline card "no longer fits the
 * model as it now stands, so it has lapsed" although the goal and its date were unchanged.
 *
 * THE PATH: the REAL `agentV1TurnRoute` (Fastify inject, the UI's shapes: a typed message; a press is `chip_click` + `chip.id`) →
 * the REAL Agent loop → the REAL `propose_goal_deadline` and `propose_link_strengths` → the cards → the presses →
 * `authoriseChange` → the REAL in-process level door (`commitOptionLevelsInProcess`) → the store → the reconcile (`lifecycle.ts`)
 * → the read-back. Scripted: only the Agent's outputs. 0 provider calls. TESTED, not WIRE-WITNESSED.
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import type {} from '../../../plugins/scenario-ownership.js';
import type {} from '@fastify/rate-limit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const live = vi.hoisted(() => ({ store: null as unknown }));
vi.mock('../../session/index.js', async original => ({ ...await original<typeof import('../../session/index.js')>(), getSessionStore: () => live.store }));
vi.mock('../../rolling-summary/capture.js', () => ({ maintainRollingSummaryForCommit: async () => undefined }));
vi.mock('../../../adapters/llm/router.js', () => ({
  getAdapter: () => { throw new Error('Providers forbidden in the held-card replay'); },
  getAdapterWithResolution: () => { throw new Error('Providers forbidden in the held-card replay'); }, getMaxTokensFromConfig: () => undefined,
}));
vi.mock('../../../orchestrator/user-identity.js', async original => ({ ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }) }));
import { createMockSessionStore, makeSessionTurnRow } from '../../../../tests/utils/mock-session-store.js';
import { approvalChipIdFor } from '../approval-chips.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { constructionOperationId } from '../runtime/build-model.js';
import { registrationTurnId } from '../../graph-registration/registration-identity.js';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { commitOptionLevelsInProcess } from '../../system-events/dispatch.js';
import { heldCardStillApplies } from '../proposal-object/still-applies.js';
import type { SessionTurnWithContent } from '../../session/conversation-content.js';

type Rec = Record<string, any>;
const FX = JSON.parse(readFileSync('tests/fixtures/held-card/served-hiring-post3009-read01-20261014.json', 'utf8')) as { graph: Rec; brief: string };
/** The served draft's day: the card reads "3 months from 14 October 2026". */
const STAMP = '2026-10-14T04:36:33.022411Z';
const DEADLINE = '2027-01-14';
const LAPSE = /no longer fits the model as it now stands, so it has lapsed/;
const hash = (g: Rec) => computeAnalysisAffectingGraphHash(g as never)!;
const goal = (g: Rec): Rec => g.nodes.find((n: Rec) => n.kind === 'goal');
const say = (text: string) => ({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] });
const call = (name: string, args: Rec) => ({ output: [{ type: 'function_call', name, call_id: `call_${name}_${randomUUID().slice(0, 8)}`, arguments: JSON.stringify(args) }] });
const DEADLINE_ARGS = { deadline_words: 'three months', rationale: 'We have an urgent launch date in the next three months.' };
/** Served turn 04's two links, as served turn 05 recorded them ("slight"; "moderate"). */
const LINK_ARGS = { links: [
  { from_label: 'Mid-weight developers', to_label: 'Code quality degradation', strength: 'weak' },
  { from_label: 'Code quality degradation', to_label: 'Productivity', strength: 'moderate' },
], rationale: 'Olumi’s starting estimates for the quality pathway, for you to adopt or correct.' };

function world() {
  const sid = randomUUID(); let bytes = JSON.stringify(FX.graph); const brief = FX.brief;
  const read = (): Rec => JSON.parse(bytes);
  const rows: SessionTurnWithContent[] = [makeSessionTurnRow({ id: randomUUID(), scenario_id: sid, turn_id: registrationTurnId(sid, constructionOperationId(sid, brief)),
    request_hash: 'graph_registration:draft', turn_class: 'direct_answer', handler_id: null, response_emitted: false, created_at: STAMP })];
  const writes: Rec[] = []; const latest = () => rows.find(r => !r.turn_id.endsWith(':claim'));
  live.store = createMockSessionStore({
    loadGraph: async () => read(), loadGraphAndBriefText: async () => ({ graph: read(), briefText: brief }),
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
  const graphWire = () => ({ graph: read(), graph_hash: hash(read()), brief_text: brief, scenario_created_at: STAMP });
  const versions = () => ({ versions: [{ version_id: 'draft-r1', sequence: 1, created_at: STAMP,
    creation: { kind: 'initial', source_turn_id: registrationTurnId(sid, constructionOperationId(sid, brief)) } }] });
  const onLatestRow = (chipId: string): boolean => ((latest() as Rec | undefined)?.pending_actions ?? []).some((p: Rec) => p.chip_id === chipId);
  return { sid, rows, writes, read, graphWire, versions, onLatestRow, replace: (g: Rec) => { bytes = JSON.stringify(g); } };
}

let script: Rec[] = [];
const apps: FastifyInstance[] = [];
beforeEach(() => { script = []; });
afterEach(async () => { for (const app of apps.splice(0)) await app.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
async function route(w: ReturnType<typeof world>) {
  vi.stubEnv('AGENT_LANE_ENABLED', 'true'); vi.stubEnv('AGENT_LANE_PREVIEW', 'false');
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: { body?: string }) => {
    if (!String(url).includes('openai')) throw new Error(`Network forbidden: ${String(url)}`);
    const req = JSON.parse(String(init?.body ?? '{}')) as Rec;
    if (req.text?.format?.name === 'brief_spans') return new Response('{}', { status: 500 });
    return new Response(JSON.stringify(script.shift() ?? say('Noted.')), { status: 200 });
  }));
  const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
  const app = Fastify({ logger: false }); apps.push(app);
  app.post('/assist/v1/scenarios/:id/graph', async () => w.graphWire());
  app.post('/assist/v1/scenarios/:id/versions', async () => w.versions());
  await app.register(agentV1TurnRoute); await app.ready();
  return async (over: Rec, steps: Rec[] = []): Promise<Rec> => {
    script = [...steps];
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', turn_id: randomUUID(), scenario_id: w.sid, ...over } });
    expect(r.statusCode, r.body.slice(0, 2000)).toBe(200);
    return r.json() as Rec;
  };
}
const chipOf = (body: Rec, tool: string): Rec => {
  const made = (body._agent.tool_calls as Rec[]).filter((c) => c.name === tool);
  expect(made, JSON.stringify(body._agent.tool_calls)).toEqual([expect.objectContaining({ ok: true })]);
  const chip = (body.suggested_actions as Rec[]).find((c) => c.id === approvalChipIdFor(String(made[0]!.proposal_id)));
  expect(chip, JSON.stringify(body.suggested_actions)).toBeDefined();
  return chip!;
};
/** Served turns 02 and 04: the deadline card, then the link-strength card, both held. */
async function bothCards(w: ReturnType<typeof world>, turn: Awaited<ReturnType<typeof route>>) {
  // Served turn 02: the first Agent turn after the draft; the AI answers and the ROUTE issues the card (ruling A, attested words).
  const first = await turn({ message: 'Why can I barely see the connections?', source: 'composer' }, [say('The connections are recorded.')]);
  const deadline = chipOf(first, 'propose_goal_deadline');
  const session = first._agent.session_id;
  const second = await turn({ message: 'Please fill in what is missing.', source: 'composer', agent_session_id: session },
    [call('propose_link_strengths', LINK_ARGS), say('Here are the link strengths to approve.')]);
  const links = chipOf(second, 'propose_link_strengths');
  expect(w.onLatestRow(deadline.id), 'the deadline card is still held beside the link card').toBe(true);
  return { deadline, links, session };
}

describe('held deadline card: an unrelated approval never lapses it; any change to its goal does', () => {
  it('⭐ RED→GREEN (served post3009 shape): approve the link strengths → the deadline card stays pressable → press → the date is saved → read back → cold', async () => {
    const w = world(); const turn = await route(w);
    const { deadline, links, session } = await bothCards(w, turn);
    const before = hash(w.read());
    // Served turn 05: the press of the link card. The model moves; the reconcile of THIS turn used to lapse the deadline card.
    const approved = await turn({ message: links.message, source: 'chip_click', chip: { id: links.id }, agent_session_id: session });
    expect((approved._agent.tool_calls as Rec[]).filter((c) => c.name === 'authorise_change')).toEqual([expect.objectContaining({ ok: true, mutated: true })]);
    expect(hash(w.read()), 'the model moved').not.toBe(before);
    expect(String(approved.assistant_text)).not.toMatch(LAPSE);
    expect(w.onLatestRow(deadline.id), 'the deadline card is still held on the latest row').toBe(true);
    const withLinks = structuredClone(w.read());
    // The press of the SAME chip the user saw (its digest unchanged): the date is written on the CURRENT base.
    const pressed = await turn({ message: deadline.message, source: 'chip_click', chip: { id: deadline.id }, agent_session_id: session });
    expect((pressed._agent.tool_calls as Rec[]).filter((c) => c.name === 'authorise_change')).toEqual([expect.objectContaining({ ok: true, mutated: true })]);
    const after = w.read();
    expect(goal(after).goal_horizon).toMatchObject({ deadline: DEADLINE });
    expect(after.edges, 'the approved link strengths are kept').toEqual(withLinks.edges);
    // Cold: a fresh agent session over the stored model keeps the date and the links, and offers no card again.
    const cold = await turn({ message: 'Where are we?', source: 'composer', agent_session_id: randomUUID() });
    expect(goal(w.read()).goal_horizon).toMatchObject({ deadline: DEADLINE });
    expect(w.read().edges).toEqual(withLinks.edges);
    expect(String(cold.assistant_text)).not.toMatch(LAPSE);
    expect((cold.suggested_actions as Rec[] ?? []).some((c) => c.id === deadline.id)).toBe(false);
  }, 90_000);

  it('NEGATIVE: the goal’s TARGET changed (with the links) → the card lapses, said; its press writes nothing', async () => {
    const w = world(); const turn = await route(w);
    const { deadline, session } = await bothCards(w, turn);
    const g = w.read(); goal(g).goal_threshold_raw = 15; w.replace(g);
    const next = await turn({ message: 'And now?', source: 'composer', agent_session_id: session });
    expect(String(next.assistant_text)).toMatch(LAPSE);
    expect(w.onLatestRow(deadline.id)).toBe(false);
    await turn({ message: deadline.message, source: 'chip_click', chip: { id: deadline.id }, agent_session_id: session });
    expect(goal(w.read()).goal_horizon ?? null).toBeNull();
  }, 90_000);

  it('NEGATIVE: the goal renamed elsewhere (the hash unchanged) → the card lapses, said; its press writes nothing', async () => {
    const w = world(); const turn = await route(w);
    const { deadline, session } = await bothCards(w, turn);
    const g = w.read(); const before = hash(g); goal(g).label = 'Team productivity'; expect(hash(g)).toBe(before); w.replace(g);
    const next = await turn({ message: 'And now?', source: 'composer', agent_session_id: session });
    expect(String(next.assistant_text)).toMatch(LAPSE);
    expect(w.onLatestRow(deadline.id)).toBe(false);
    await turn({ message: deadline.message, source: 'chip_click', chip: { id: deadline.id }, agent_session_id: session });
    expect(goal(w.read()).goal_horizon ?? null).toBeNull();
  }, 90_000);

  it('NEGATIVE: the goal’s own date was set elsewhere → the card lapses, said; its press writes nothing', async () => {
    const w = world(); const turn = await route(w);
    const { deadline, session } = await bothCards(w, turn);
    const g = w.read(); goal(g).goal_horizon = { deadline: '2027-03-31' }; w.replace(g);
    const next = await turn({ message: 'And now?', source: 'composer', agent_session_id: session });
    expect(String(next.assistant_text)).toMatch(LAPSE);
    await turn({ message: deadline.message, source: 'chip_click', chip: { id: deadline.id }, agent_session_id: session });
    expect(goal(w.read()).goal_horizon).toEqual({ deadline: '2027-03-31' });
  }, 90_000);
});

describe('the one rule (`heldCardStillApplies`), read at press, at lapse and by the writer', () => {
  const caps = () => {
    const w = world(); const proposals = new ProposalStore();
    const dispatch: InternalDispatch = async path => {
      if (path.endsWith('/graph')) return { status: 200, json: w.graphWire() };
      if (path.endsWith('/versions')) return { status: 200, json: w.versions() };
      throw new Error(`Unexpected local dispatch ${path}`);
    };
    const c = createAgentCapabilities(dispatch, proposals, undefined, 'full', undefined, { commitOptionLevels: input => commitOptionLevelsInProcess(input, 'held-card') });
    return { w, proposals, c, ctx: (user: string | null) => ({ scenario_id: w.sid, authenticated_user_id: user, request_id: 'held-card', user_text: DEADLINE_ARGS.rationale, user_turn_text: DEADLINE_ARGS.rationale }) };
  };
  const linkMoved = (g: Rec): Rec => { const e = (g.edges as Rec[]).find((x) => x.from === 'mid_weight_developers' || typeof x.strength?.mean === 'number')!; e.strength = { ...e.strength, mean: 0.25 }; return g; };

  it('holds on an unrelated link change; fails on a renamed goal, a new target, a new period reading; a card with no subject keeps the whole-model rule', async () => {
    const { w, proposals, c, ctx } = caps();
    const out = await c.proposeGoalDeadline!(ctx(null), DEADLINE_ARGS) as Rec;
    expect(out).toMatchObject({ ok: true });
    const p = proposals.get(String(out.proposal_id))!;
    expect((p.operations[0]!.value as Rec).expected_goal).toMatchObject({ label: 'Productivity', target: { raw: 10 } });
    expect(heldCardStillApplies(p, linkMoved(w.read()))).toBe(true);
    const renamed = w.read(); goal(renamed).label = 'Team productivity';
    expect(heldCardStillApplies(p, renamed)).toBe(false);
    const target = w.read(); goal(target).goal_threshold_raw = 15;
    expect(heldCardStillApplies(p, target)).toBe(false);
    const reading = w.read(); goal(reading).goal_target_basis = { ...goal(reading).goal_target_basis, period_months: 6 };
    expect(heldCardStillApplies(p, reading)).toBe(false);
    const legacy = { operations: [{ ...p.operations[0]!, value: { ...(p.operations[0]!.value as Rec), expected_goal: undefined } }] };
    expect(heldCardStillApplies(legacy as never, linkMoved(w.read()))).toBe(false);
  });

  it('THE WRITER: the goal renamed elsewhere with the hash unchanged, pressed with no turn between → refused, nothing written', async () => {
    const { w, c, ctx } = caps();
    const out = await c.proposeGoalDeadline!(ctx(null), DEADLINE_ARGS) as Rec;
    const pid = String(out.proposal_id);
    const g = w.read(); const before = hash(g); goal(g).label = 'Team productivity';
    expect(hash(g), 'the analysis hash does not see a goal label').toBe(before);
    w.replace(g);
    const pressed = await c.authoriseChange!({ ...ctx(null), typed_approval_of: pid } as never, { proposal_id: pid }) as Rec;
    expect(pressed).toMatchObject({ ok: false, mutated: false, reason: 'model_changed_since_approval' });
    expect(goal(w.read()).goal_horizon ?? null).toBeNull();
    // CONTRAST: the same press on the goal as the card bound it writes the date.
    const { w: w2, c: c2, ctx: ctx2 } = caps();
    const pid2 = String((await c2.proposeGoalDeadline!(ctx2(null), DEADLINE_ARGS) as Rec).proposal_id);
    expect(await c2.authoriseChange!({ ...ctx2(null), typed_approval_of: pid2 } as never, { proposal_id: pid2 })).toMatchObject({ ok: true, mutated: true });
    expect(goal(w2.read()).goal_horizon).toMatchObject({ deadline: DEADLINE });
  });

  it('PERMISSION: another user’s press is refused, even on an unchanged model; nothing is written', async () => {
    const { w, c, ctx } = caps();
    const out = await c.proposeGoalDeadline!(ctx(null), DEADLINE_ARGS) as Rec;
    const pid = String(out.proposal_id);
    const refused = await c.authoriseChange!({ ...ctx('someone-else'), typed_approval_of: pid } as never, { proposal_id: pid }) as Rec;
    expect(refused).toMatchObject({ ok: false, mutated: false });
    expect(goal(w.read()).goal_horizon ?? null).toBeNull();
  });
});
