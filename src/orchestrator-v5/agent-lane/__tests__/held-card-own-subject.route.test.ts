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
import { goalChanceScreenLinesForAgent } from '../goal-chance-screen-lines.js';
import { proposalPendingAction } from '../durable-proposal.js';
import { agentProposals, executableProposalId, readExecutableHeldProposalOffers } from '../held-approval-offers.js';
import { declineChipIdFor } from '../proposal-object/record.js';
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
  // ⛔ INPUT CHANGE (#3002, known-origin transport): each stub link declares its origin, as a prompt-following AI gives it:
  // Olumi's own new estimate, with its basis (the hiring card's served shape).
  { from_label: 'Mid-weight developers', to_label: 'Code quality degradation', strength: 'weak', origin: 'olumi', basis: 'Olumi\u2019s own estimate from the model' },
  { from_label: 'Code quality degradation', to_label: 'Productivity', strength: 'moderate', origin: 'olumi', basis: 'Olumi\u2019s own estimate from the model' },
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
  /** The selected Run, as the real `/graph` read carries it: only beside the graph it was computed against (none before). */
  let analysis: Rec = {};
  const graphWire = () => ({ graph: read(), graph_hash: hash(read()), brief_text: brief, scenario_created_at: STAMP,
    ...(analysis.analysis_result?.computed_against_hash === hash(read()) ? analysis : {}) });
  const versions = () => ({ versions: [{ version_id: 'draft-r1', sequence: 1, created_at: STAMP,
    creation: { kind: 'initial', source_turn_id: registrationTurnId(sid, constructionOperationId(sid, brief)) } }] });
  const onLatestRow = (chipId: string): boolean => ((latest() as Rec | undefined)?.pending_actions ?? []).some((p: Rec) => p.chip_id === chipId);
  return { sid, rows, writes, read, graphWire, versions, onLatestRow, replace: (g: Rec) => { bytes = JSON.stringify(g); },
    setAnalysis: (a: Rec) => { analysis = a; } };
}

let script: Rec[] = [];
/** The existing Run path's own turn (`runAnalysis` → `/orchestrate/v2/turn`, stage `analyse`): each request, the saved graph it ran on, and the reply. */
const runTurns: { body: Rec; graphAtRun: Rec }[] = [];
let runTurnReply: { status: number; json: Rec } = { status: 500, json: {} };
/** A Run that completes with this result, computed against the hash it ran on; later reads select it. */
let runResultFor: ((ranOn: string) => Rec) | undefined;
const apps: FastifyInstance[] = [];
beforeEach(() => { script = []; runTurns.length = 0; runTurnReply = { status: 500, json: {} }; runResultFor = undefined; });
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
  app.post('/orchestrate/v2/turn', async (req, reply) => {
    runTurns.push({ body: req.body as Rec, graphAtRun: w.read() });
    if (runResultFor !== undefined) {
      const ran = runResultFor(hash(w.read())); w.setAnalysis(ran);
      return reply.code(200).send({ analysis_ready: ran.analysis_ready, analysis_state: ran.analysis_state, blocks: [ran.analysis_result] });
    }
    return reply.code(runTurnReply.status).send(runTurnReply.json);
  });
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

  // ⛔ Codex r2 on #3024 (`/private/tmp/check3024-r2/independent.test.ts:362`), adopted RED → GREEN: a COLD session after an
  // unrelated approval (the process's in-memory proposal gone) still offers the exact waiting card, by its own rule.
  it('⭐ COLD: after an unrelated link approval and a cold session, the exact waiting deadline card is still offered (chip and fields)', async () => {
    const w = world(); const turn = await route(w);
    const { deadline, links, session } = await bothCards(w, turn);
    await turn({ message: links.message, source: 'chip_click', chip: { id: links.id }, agent_session_id: session });
    const p = agentProposals.outstanding(w.sid, null).find((x) => approvalChipIdFor(x.proposal_id) === deadline.id)!;
    expect(p, 'the deadline card is still outstanding').toBeDefined();
    agentProposals.discard(p.proposal_id);
    const cold = await turn({ message: 'Where are we?', source: 'composer', agent_session_id: randomUUID() });
    expect(w.onLatestRow(deadline.id)).toBe(true);
    expect((cold.suggested_actions ?? []).some((a: Rec) => a.id === deadline.id), JSON.stringify(cold.suggested_actions)).toBe(true);
    expect((cold._proposal_fields?.proposals ?? []).map((a: Rec) => a.proposal_id)).toContain(p.proposal_id);
    expect(executableProposalId(p.proposal_id, w.sid, null, hash(w.read()), w.read())).toBe(p.proposal_id);
    const offers = await readExecutableHeldProposalOffers({ scenarioId: w.sid, userId: null, graphHash: hash(w.read()), graph: w.read(),
      latest: await (live.store as Rec).readMostRecentPendingActions(w.sid), rows: w.rows, store: live.store } as never);
    expect(offers.map((x: Rec) => x.proposal_id)).toContain(p.proposal_id);
    // CONTRAST: its goal renamed (the hash unchanged) → a cold session never offers the card as approvable. ⛔ CHANGED CONTRACT
    // (PR-2, no silent lapse): its fields are still projected, as review only (`review_action`), so a reload shows it.
    const g = w.read(); goal(g).label = 'Team productivity'; w.replace(g);
    const cold2 = await turn({ message: 'And now?', source: 'composer', agent_session_id: randomUUID() });
    expect((cold2.suggested_actions ?? []).some((a: Rec) => a.id === deadline.id)).toBe(false);
    expect((cold2._proposal_fields?.proposals ?? []).find((a: Rec) => a.proposal_id === p.proposal_id)?.review_action?.id)
      .toBe(`agent-review-proposal:${p.proposal_id}`);
  }, 90_000);

  /** DGAI's press of a card it shows (SuggestedChips: the record's revision and digest, the SHOWN `graph_hash`, `fields: []`). */
  const editsPress = (chip: Rec, fieldsOf: Rec, session: string): Rec => {
    const pid = String(chip.id).slice('agent-approve-proposal:'.length);
    const rec = (fieldsOf.proposals as Rec[]).find((x) => x.proposal_id === pid)!;
    expect(rec, JSON.stringify(fieldsOf)).toBeDefined();
    return { message: chip.message, source: 'chip_click', chip: { id: chip.id }, agent_session_id: session,
      proposal_edits: { proposal_id: pid, revision: rec.revision, digest: rec.digest, graph_hash: fieldsOf.graph_hash, fields: [] } };
  };
  const authorised = (body: Rec): Rec[] => (body._agent.tool_calls as Rec[]).filter((c) => c.name === 'authorise_change');

  it('⭐ #3031 buddy: the card SHOWN after an unrelated approval, pressed as DGAI presses it (edits bound to the shown hash) → the date is saved; warm, and cold', async () => {
    for (const temperature of ['warm', 'cold'] as const) {
      const w = world(); const turn = await route(w);
      const { deadline, links, session } = await bothCards(w, turn);
      const afterLinks = await turn({ message: links.message, source: 'chip_click', chip: { id: links.id }, agent_session_id: session });
      let shown = afterLinks._proposal_fields as Rec; let at = session;
      if (temperature === 'cold') {
        const p = agentProposals.outstanding(w.sid, null).find((x) => approvalChipIdFor(x.proposal_id) === deadline.id)!;
        agentProposals.discard(p.proposal_id);
        at = randomUUID();
        shown = (await turn({ message: 'Where are we?', source: 'composer', agent_session_id: at }))._proposal_fields as Rec;
      }
      expect(shown?.graph_hash, `${temperature}: shown on the CURRENT model`).toBe(hash(w.read()));
      expect(shown.graph_hash, 'the model moved since the card was made').not.toBe(hash(FX.graph as Rec));
      const pressed = await turn(editsPress(deadline, shown, at));
      expect(authorised(pressed), `${temperature}: ${JSON.stringify(authorised(pressed))}`).toEqual([expect.objectContaining({ ok: true, mutated: true })]);
      expect(goal(w.read()).goal_horizon?.deadline, temperature).toBe(DEADLINE);
    }
  }, 180_000);

  it('#3031 buddy: the same press bound to the card’s ORIGINAL reply (its own base hash) after the unrelated approval → saved; an arbitrary hash → refused', async () => {
    const w = world(); const turn = await route(w);
    const first = await turn({ message: 'Why can I barely see the connections?', source: 'composer' }, [say('The connections are recorded.')]);
    const deadline = chipOf(first, 'propose_goal_deadline'); const session = first._agent.session_id;
    const offered = first._proposal_fields as Rec;
    expect(offered?.graph_hash).toBe(hash(FX.graph as Rec));
    const second = await turn({ message: 'Please fill in what is missing.', source: 'composer', agent_session_id: session },
      [call('propose_link_strengths', LINK_ARGS), say('Here are the link strengths to approve.')]);
    const links = chipOf(second, 'propose_link_strengths');
    await turn({ message: links.message, source: 'chip_click', chip: { id: links.id }, agent_session_id: session });
    expect(hash(w.read())).not.toBe(offered.graph_hash);
    // CONTRAST first: a hash the card was never shown on → refused, nothing written.
    const wrong = editsPress(deadline, { ...offered, graph_hash: 'f'.repeat(16) }, session);
    const refused = await turn(wrong);
    expect(authorised(refused)).toEqual([expect.objectContaining({ ok: false, mutated: false, refusal: 'edits_superseded' })]);
    expect(goal(w.read()).goal_horizon ?? null).toBeNull();
    const pressed = await turn(editsPress(deadline, offered, session));
    expect(authorised(pressed), JSON.stringify(authorised(pressed))).toEqual([expect.objectContaining({ ok: true, mutated: true })]);
    expect(goal(w.read()).goal_horizon?.deadline).toBe(DEADLINE);
  }, 120_000);

  it('NEGATIVE (#3031 buddy): the card shown after the unrelated approval, then its goal renamed (the hash unchanged, no turn between) → the edits press is refused, nothing written', async () => {
    const w = world(); const turn = await route(w);
    const { deadline, links, session } = await bothCards(w, turn);
    const shown = (await turn({ message: links.message, source: 'chip_click', chip: { id: links.id }, agent_session_id: session }))._proposal_fields as Rec;
    const g = w.read(); const before = hash(g); goal(g).label = 'Team productivity'; expect(hash(g)).toBe(before); w.replace(g);
    const pressed = await turn(editsPress(deadline, shown, session));
    expect(authorised(pressed)).toEqual([expect.objectContaining({ ok: false, mutated: false, refusal: 'edits_superseded' })]);
    expect(goal(w.read()).goal_horizon ?? null).toBeNull();
  }, 90_000);

  it('NEGATIVE: the goal’s TARGET changed (with the links) → the card is kept for review, said; its press writes nothing', async () => {
    const w = world(); const turn = await route(w);
    const { deadline, session } = await bothCards(w, turn);
    const g = w.read(); goal(g).goal_threshold_raw = 15; w.replace(g);
    const next = await turn({ message: 'And now?', source: 'composer', agent_session_id: session });
    // ⛔ CHANGED CONTRACT (DL-3 18 Oct, PR-2, no silent lapse): kept for review and SAID, never approvable; a press writes nothing.
    expect(String(next.assistant_text)).toMatch(/Model changed: review this change/);
    expect((next.suggested_actions ?? []).map((a: Rec) => a.id)).not.toContain(deadline.id);
    await turn({ message: deadline.message, source: 'chip_click', chip: { id: deadline.id }, agent_session_id: session });
    expect(goal(w.read()).goal_horizon ?? null).toBeNull();
  }, 90_000);

  it('NEGATIVE: the goal renamed elsewhere (the hash unchanged) → the card is kept for review, said; its press writes nothing', async () => {
    const w = world(); const turn = await route(w);
    const { deadline, session } = await bothCards(w, turn);
    const g = w.read(); const before = hash(g); goal(g).label = 'Team productivity'; expect(hash(g)).toBe(before); w.replace(g);
    const next = await turn({ message: 'And now?', source: 'composer', agent_session_id: session });
    // ⛔ CHANGED CONTRACT (DL-3 18 Oct, PR-2, no silent lapse): kept for review and SAID, never approvable; a press writes nothing.
    expect(String(next.assistant_text)).toMatch(/Model changed: review this change/);
    expect((next.suggested_actions ?? []).map((a: Rec) => a.id)).not.toContain(deadline.id);
    await turn({ message: deadline.message, source: 'chip_click', chip: { id: deadline.id }, agent_session_id: session });
    expect(goal(w.read()).goal_horizon ?? null).toBeNull();
  }, 90_000);

  it('NEGATIVE: the goal’s own date was set elsewhere → the card is kept for review, said; its press writes nothing', async () => {
    const w = world(); const turn = await route(w);
    const { deadline, session } = await bothCards(w, turn);
    const g = w.read(); goal(g).goal_horizon = { deadline: '2027-03-31' }; w.replace(g);
    const next = await turn({ message: 'And now?', source: 'composer', agent_session_id: session });
    // ⛔ CHANGED CONTRACT (PR-2): kept for review and SAID, never approvable; a press writes nothing.
    expect(String(next.assistant_text)).toMatch(/Model changed: review this change/);
    expect((next.suggested_actions ?? []).map((a: Rec) => a.id)).not.toContain(deadline.id);
    await turn({ message: deadline.message, source: 'chip_click', chip: { id: deadline.id }, agent_session_id: session });
    expect(goal(w.read()).goal_horizon).toEqual({ deadline: '2027-03-31' });
  }, 90_000);
});

describe('the one rule (`heldCardStillApplies`), read at press, at lapse and by the writer', () => {
  const caps = (beforeCommit?: (w: ReturnType<typeof world>) => void) => {
    const w = world(); const proposals = new ProposalStore();
    const dispatch: InternalDispatch = async path => {
      if (path.endsWith('/graph')) return { status: 200, json: w.graphWire() };
      if (path.endsWith('/versions')) return { status: 200, json: w.versions() };
      throw new Error(`Unexpected local dispatch ${path}`);
    };
    const c = createAgentCapabilities(dispatch, proposals, undefined, 'full', undefined,
      { commitOptionLevels: input => { beforeCommit?.(w); return commitOptionLevelsInProcess(input, 'held-card'); } });
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

  // ⛔ Codex r1 on #3024 (`/private/tmp/check3024-evidence/check3024-independent.test.ts`), adopted RED → GREEN.
  it('⛔ Codex r1 STALE WRITE: renamed between the approval read and the writer’s read (the hash unchanged) → the writer refuses, 0 graph writes', async () => {
    const { w, c, ctx } = caps((x) => { const g = x.read(); const h = hash(g); goal(g).label = 'Different approved subject'; expect(hash(g)).toBe(h); x.replace(g); });
    const pid = String((await c.proposeGoalDeadline!(ctx(null), DEADLINE_ARGS) as Rec).proposal_id);
    const pressed = await c.authoriseChange!({ ...ctx(null), typed_approval_of: pid } as never, { proposal_id: pid }) as Rec;
    expect(pressed).toMatchObject({ ok: false, mutated: false });
    expect(goal(w.read()).goal_horizon).toBeUndefined();
    expect(w.writes.filter((x) => x.graph)).toHaveLength(0);
  });

  it('⛔ Codex r1 FALSE RETRY: the same date set elsewhere and the target changed before the first press → no own write, so it lapses; 0 graph writes', async () => {
    const { w, c, ctx, proposals } = caps();
    const pid = String((await c.proposeGoalDeadline!(ctx(null), DEADLINE_ARGS) as Rec).proposal_id);
    const g = w.read(); goal(g).goal_threshold_raw = 15; goal(g).goal_horizon = { deadline: DEADLINE }; w.replace(g);
    expect(proposals.partialProgressOf(pid)).toBeUndefined();
    expect(heldCardStillApplies(proposals.get(pid)!, w.read())).toBe(false);
    const pressed = await c.authoriseChange!({ ...ctx(null), typed_approval_of: pid } as never, { proposal_id: pid }) as Rec;
    expect(pressed).toMatchObject({ ok: false, mutated: false });
    expect(w.writes.filter((x) => x.graph)).toHaveLength(0);
    // CONTRAST: the same date set elsewhere ALONE (the goal otherwise as bound) is still not this card's own write: refused.
    const b = caps();
    const pid2 = String((await b.c.proposeGoalDeadline!(b.ctx(null), DEADLINE_ARGS) as Rec).proposal_id);
    const g2 = b.w.read(); goal(g2).goal_horizon = { deadline: DEADLINE }; b.w.replace(g2);
    expect(await b.c.authoriseChange!({ ...b.ctx(null), typed_approval_of: pid2 } as never, { proposal_id: pid2 })).toMatchObject({ ok: false, mutated: false });
    expect(b.w.writes.filter((x) => x.graph)).toHaveLength(0);
  });

  it('Codex r1 (non-blocking): the held-offer reader agrees with the rule — after an unrelated change the waiting card is still offered', async () => {
    const { w, c, ctx, proposals } = caps();
    const out = await c.proposeGoalDeadline!(ctx(null), DEADLINE_ARGS) as Rec;
    const pid = String(out.proposal_id), p = proposals.get(pid)!;
    const chip = { id: approvalChipIdFor(pid), label: String(out.public_label), message: String(out.public_message ?? 'Yes') };
    const pa = proposalPendingAction(p, chip, { scenario_id: w.sid, emitted_at_iso: new Date().toISOString() });
    const moved = linkMoved(w.read());
    expect(heldCardStillApplies(p, moved)).toBe(true);
    const offered = await readExecutableHeldProposalOffers({ scenarioId: w.sid, userId: null, graphHash: hash(moved), graph: moved,
      latest: [pa], rows: [{ turn_id: 'offered' }], store: { readCommittedTurn: async () => ({ pending_actions: [pa] }) } } as never);
    expect(offered.map((x: Rec) => x.proposal_id)).toEqual([pid]);
    // CONTRAST: its goal renamed → not offered.
    const renamed = w.read(); goal(renamed).label = 'Team productivity';
    const none = await readExecutableHeldProposalOffers({ scenarioId: w.sid, userId: null, graphHash: hash(renamed), graph: renamed,
      latest: [pa], rows: [{ turn_id: 'offered' }], store: { readCommittedTurn: async () => ({ pending_actions: [pa] }) } } as never);
    expect(none).toEqual([]);
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

describe('⭐ ANALYSE AFTER EVERY COMMITTED CHANGE (Paul, #94 6166259456): the existing Run, once, in the same turn', () => {
  const analyseTurns = () => runTurns.filter((r) => r.body.stage === 'analyse');
  const RUN_OK = { status: 200, json: { analysis_ready: { status: 'ready', may_run: true }, analysis_state: { run_state: 'complete_current' },
    blocks: [{ type: 'analysis_result', data: { results: [] } }] } };

  it('⭐ approving the link card COMMITS it → the existing Run runs ONCE, after the save, on the saved model; no Run chip is offered', async () => {
    const w = world(); const turn = await route(w);
    const { links, session } = await bothCards(w, turn);
    expect(analyseTurns(), 'offering cards commits nothing, so nothing ran').toEqual([]);
    const before = JSON.stringify(w.read());
    runTurnReply = RUN_OK;
    const pressed = await turn({ message: links.message, source: 'chip_click', chip: { id: links.id }, agent_session_id: session });
    expect((pressed._agent.tool_calls as Rec[]).filter((c) => c.name === 'authorise_change')).toEqual([expect.objectContaining({ ok: true, mutated: true })]);
    const runs = analyseTurns();
    expect(runs, JSON.stringify(runTurns.map((r) => r.body))).toHaveLength(1);
    expect(runs[0]!.body).toMatchObject({ scenario_id: w.sid, stage: 'analyse', chip: { id: 'agent-run-analysis', action_type: 'run_analysis' } });
    expect(runs[0]!.body.chip.parameters, 'no Run when the turn began: no reading to carry').toEqual({ effects_timing: null });
    // Bound to the NEW revision: the Run read the model with the approved links already saved.
    expect(JSON.stringify(runs[0]!.graphAtRun)).not.toBe(before);
    expect(hash(runs[0]!.graphAtRun)).toBe(hash(w.read()));
    expect((pressed.suggested_actions ?? []).some((a: Rec) => a.id === 'agent-run-analysis'), 'it already ran: no Run chip').toBe(false);
  }, 90_000);

  /** A completed Run on the hash it ran on, with each option's chance of meeting the goal licensed (the screen's lines). */
  const LICENSED = (ranOn: string): Rec => ({
    analysis_ready: { status: 'ready', may_run: true },
    analysis_state: { run_state: { kind: 'complete_current', computed_at: '2026-10-14T13:00:00.000Z' } },
    analysis_result: { type: 'analysis_result', computed_against_hash: ranOn, enrichment: { inference_warnings: [{
      code: 'GOAL_CHANCE_LICENSED', severity: 'info', message: 'Each option’s chance of meeting your goal is licensed on this Run.', form: 'each',
      option_ids: ['hire_a_tech_lead', 'hire_two_developers'], pct_by_option: { hire_a_tech_lead: 67, hire_two_developers: 41 },
      target: { comparator: 'at_least', value: 10, unit: '%' } }] } },
  });

  it('⭐ C.md: the automatic Run IS this turn’s Run: its reply says each option’s chance, as a Run reply does', async () => {
    const w = world(); const turn = await route(w);
    const { links, session } = await bothCards(w, turn);
    runResultFor = LICENSED;
    const pressed = await turn({ message: links.message, source: 'chip_click', chip: { id: links.id }, agent_session_id: session });
    expect(analyseTurns()).toHaveLength(1);
    // Fixture control: this Run's licence gives the screen's chance lines on the saved model.
    const lines = goalChanceScreenLinesForAgent(LICENSED(hash(w.read())).analysis_result, w.read(), true);
    expect(lines.map((l) => l.option_id).sort()).toEqual(['hire_a_tech_lead', 'hire_two_developers']);
    const shown = (pressed.blocks as Rec[]).find(b => b.type === 'analysis_result');
    expect(shown).toMatchObject(LICENSED(hash(w.read())).analysis_result);
    expect(String(pressed.assistant_text)).not.toContain('67%');
    expect(String(pressed.assistant_text)).not.toContain('41%');
    // Recorded as this turn's Run, by the Run's own call.
    expect((pressed._agent.tool_calls as Rec[]).filter((c) => c.name === 'run_analysis')).toEqual([expect.objectContaining({ ok: true, mutated: false })]);
  }, 90_000);

  it('⭐ 12:57Z: the automatic Run carries the timing reading the Run current at the turn’s start recorded; a change to the goal carries none', async () => {
    /** The Run current on the model as the turn finds it, its licence recording Olumi's reading. */
    const priorRun = (w: ReturnType<typeof world>) => w.setAnalysis({
      analysis_state: { run_state: { kind: 'complete_current', computed_at: '2026-10-14T12:00:00.000Z' } },
      analysis_result: { type: 'analysis_result', computed_against_hash: hash(w.read()), enrichment: { inference_warnings: [{
        code: 'GOAL_CHANCE_LICENSED', form: 'each', option_ids: ['hire_a_tech_lead', 'hire_two_developers'],
        effects_timing: 'in_place_by_period', effects_timing_origin: 'olumi' }] } } });
    runTurnReply = RUN_OK;
    // The link card changes two factor links: no option, not the goal. The reading is carried.
    const a = world(); const turnA = await route(a);
    const cardsA = await bothCards(a, turnA);
    priorRun(a);
    await turnA({ message: cardsA.links.message, source: 'chip_click', chip: { id: cardsA.links.id }, agent_session_id: cardsA.session });
    expect(analyseTurns().map((r) => r.body.chip.parameters)).toEqual([{ effects_timing: 'in_place_by_period' }]);
    // The deadline card changes the goal's date: the reading's subject moved, so none is carried.
    runTurns.length = 0;
    const b = world(); const turnB = await route(b);
    const cardsB = await bothCards(b, turnB);
    priorRun(b);
    await turnB({ message: cardsB.deadline.message, source: 'chip_click', chip: { id: cardsB.deadline.id }, agent_session_id: cardsB.session });
    expect(goal(b.read()).goal_deadline ?? goal(b.read()).goal_horizon ?? null, 'the deadline was saved').not.toBeNull();
    expect(analyseTurns().map((r) => r.body.chip.parameters)).toEqual([{ effects_timing: null }]);
  }, 120_000);

  it('CONTRAST: a turn that commits nothing (a typed question; a declined card) runs nothing', async () => {
    const w = world(); const turn = await route(w);
    const { deadline, session } = await bothCards(w, turn);
    runTurnReply = RUN_OK;
    await turn({ message: 'What does the deadline card do?', source: 'composer', agent_session_id: session }, [say('It sets the goal’s date.')]);
    await turn({ message: 'Not now.', source: 'chip_click', chip: { id: declineChipIdFor(String(deadline.id).slice('agent-approve-proposal:'.length)) }, agent_session_id: session });
    expect(analyseTurns()).toEqual([]);
  }, 90_000);

  it('A FAILED Run says so, borrows no result, and the saved change stands: the Run chip is offered to try again', async () => {
    const w = world(); const turn = await route(w);
    const { links, session } = await bothCards(w, turn);
    runTurnReply = { status: 500, json: {} };
    const pressed = await turn({ message: links.message, source: 'chip_click', chip: { id: links.id }, agent_session_id: session });
    expect(analyseTurns()).toHaveLength(1);
    expect(String(pressed.assistant_text)).toContain('The analysis didn’t run this time. Your model was updated this turn');
    expect(String(pressed.assistant_text)).not.toContain('Nothing in your model changed');
    expect(pressed.analysis_result ?? null).toBeNull();
    expect(String(pressed.assistant_text)).not.toMatch(/chance of meeting/);
    expect((pressed._agent.tool_calls as Rec[]).some((c) => c.name === 'run_analysis'), 'a Run that did not complete is not recorded as one').toBe(false);
    expect((pressed.suggested_actions ?? []).some((a: Rec) => a.id === 'agent-run-analysis'), 'the Run is offered to try again').toBe(true);
  }, 90_000);
});
