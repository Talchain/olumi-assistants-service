/**
 * ⭐ AN APPROVAL IS ONE ACTION (DL-3 18 Oct; Codex co-design §2; assessment 18 Oct K5: L2 "Yes, I approve the proposed 10%"
 * refused while its card waited; T4 approving Olumi's starting value lapsed the user's pending card).
 *
 * THE PATH: the REAL `agentV1TurnRoute` (Fastify inject, the UI's shapes: a typed message; a press is `chip_click` + `chip.id`)
 * → the REAL Agent loop → the REAL `propose_starting_point` / `propose_option_interventions` → the cards → typed words or a
 * press → `authoriseChange` → the REAL in-process level door → the store → the reconcile (`lifecycle.ts`) → the read-back.
 * Scripted: only the Agent's outputs. 0 provider calls. SYNTHETIC wording and model (a bakery). TESTED, not WIRE-WITNESSED.
 */
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import type {} from '../../../plugins/scenario-ownership.js';
import type {} from '@fastify/rate-limit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const live = vi.hoisted(() => ({ store: null as unknown }));
vi.mock('../../session/index.js', async original => ({ ...await original<typeof import('../../session/index.js')>(), getSessionStore: () => live.store }));
vi.mock('../../rolling-summary/capture.js', () => ({ maintainRollingSummaryForCommit: async () => undefined }));
vi.mock('../../../adapters/llm/router.js', () => ({
  getAdapter: () => { throw new Error('Providers forbidden in the approval replay'); },
  getAdapterWithResolution: () => { throw new Error('Providers forbidden in the approval replay'); }, getMaxTokensFromConfig: () => undefined,
}));
vi.mock('../../../orchestrator/user-identity.js', async original => ({ ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }) }));
import { createMockSessionStore, makeSessionTurnRow } from '../../../../tests/utils/mock-session-store.js';
import { approvalChipIdFor } from '../approval-chips.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { constructionOperationId } from '../runtime/build-model.js';
import { registrationTurnId } from '../../graph-registration/registration-identity.js';
import { declineChipIdFor } from '../proposal-object/record.js';
import type { SessionTurnWithContent } from '../../session/conversation-content.js';

type Rec = Record<string, any>;
const STAMP = '2026-10-18T09:00:00.000Z';
const BRIEF = 'Our bakery wants at least 90% of orders ready on time. Should we add a second oven or buy a faster mixer?';
const edge = (from: string, to: string, mean = 1) => ({ from, to, strength: { mean, std: 0.01 }, provenance: { source: 'cee_hypothesis' },
  effect_direction: 'positive', exists_probability: 1 });
const GRAPH: Rec = {
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
const LAPSE = /no longer fits the model as it now stands, so it has lapsed/;
const hash = (g: Rec) => computeAnalysisAffectingGraphHash(g as never)!;
const node = (g: Rec, id: string): Rec => g.nodes.find((n: Rec) => n.id === id);
const say = (text: string) => ({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] });
const call = (name: string, args: Rec) => ({ output: [{ type: 'function_call', name, call_id: `call_${name}_${randomUUID().slice(0, 8)}`, arguments: JSON.stringify(args) }] });
/** Olumi's starting value for the factor (card A): an assumption, never the user's. */
const START = { assumptions: [{ factor_label: 'Prep time cut from mixer', value: 0, unit: '%', user_stated: false,
  basis: 'Olumi assumes no cut today because the mixer is not bought yet.' }], option_levels: [] };
/** The user's own figure for the mixer (card B): a new link with its level. */
const MIXER = { interventions: [{ option_label: 'Buy a faster mixer', factor_label: 'Prep time cut from mixer', value: 15, user_stated: true,
  basis: 'The user: the faster mixer cuts prep time by 15%.' }] };
const MIXER_WORDS = 'The faster mixer cuts prep time by 15%.';

function world() {
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
  app.post('/orchestrate/v2/turn', async (_req, reply) => reply.code(500).send({}));
  await app.register(agentV1TurnRoute); await app.ready();
  return async (over: Rec, steps: Rec[] = []): Promise<Rec> => {
    script = [...steps];
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', turn_id: randomUUID(), scenario_id: w.sid, ...over } });
    expect(r.statusCode, r.body.slice(0, 2000)).toBe(200);
    return r.json() as Rec;
  };
}
const idOf = (body: Rec, tool: string): string => {
  const made = (body._agent.tool_calls as Rec[]).filter((c) => c.name === tool);
  expect(made, JSON.stringify(body._agent.tool_calls)).toEqual([expect.objectContaining({ ok: true })]);
  return String(made[0]!.proposal_id);
};
const chips = (body: Rec): string[] => ((body.suggested_actions ?? []) as Rec[]).map((c) => String(c.id));
const chipFor = (body: Rec, id: string): Rec => {
  const chip = ((body.suggested_actions ?? []) as Rec[]).find((c) => c.id === approvalChipIdFor(id));
  expect(chip, `no button for ${id}: ${JSON.stringify(body.suggested_actions)}`).toBeDefined();
  return chip!;
};
const authorised = (body: Rec): Rec[] => (body._agent.tool_calls as Rec[]).filter((c) => c.name === 'authorise_change');
const mixerSaved = (g: Rec): boolean => g.edges.some((e: Rec) => e.from === 'buy_faster_mixer' && e.to === 'prep_time_cut')
  && node(g, 'buy_faster_mixer').interventions?.prep_time_cut !== undefined;

/** Card A (Olumi's starting value), then card B (the user's 15%), both held. */
async function bothCards(w: ReturnType<typeof world>, turn: Awaited<ReturnType<typeof route>>) {
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

describe('an approval is ONE action: typed words with one card waiting are its press; several cards ask which, each with a button', () => {
  it('⭐ A1: one card waiting, typed "Yes, go ahead with the 15% mixer change." → saved once, the same model as its button', async () => {
    const typedWorld = world(); const typedTurn = await route(typedWorld);
    const first = await typedTurn({ message: MIXER_WORDS, source: 'composer' }, [call('propose_option_interventions', MIXER), say('Here is that change.')]);
    const b = idOf(first, 'propose_option_interventions');
    const typed = await typedTurn({ message: 'Yes, go ahead with the 15% mixer change.', source: 'composer', agent_session_id: first._agent.session_id },
      [call('authorise_change', { proposal_id: b }), say('Done.')]);
    expect(authorised(typed), JSON.stringify(authorised(typed))).toEqual([expect.objectContaining({ ok: true, mutated: true })]);
    expect(mixerSaved(typedWorld.read())).toBe(true);
    // Consent provenance (ruling A): recorded as a typed approval read by Olumi, the user's exact words quoted.
    expect(typed._agent.typed_approvals).toEqual([{ proposal_id: b, approval: 'typed_approval_read_by_olumi', words: 'Yes, go ahead with the 15% mixer change.' }]);
    expect(String(typed.assistant_text)).toContain('Saved on your typed approval: \u201cYes, go ahead with the 15% mixer change.\u201d');
    // CONTRAST: the same card pressed in its own world — the saved model is the same.
    const pressWorld = world(); const pressTurn = await route(pressWorld);
    const offered = await pressTurn({ message: MIXER_WORDS, source: 'composer' }, [call('propose_option_interventions', MIXER), say('Here is that change.')]);
    const chip = chipFor(offered, idOf(offered, 'propose_option_interventions'));
    const pressed = await pressTurn({ message: chip.message, source: 'chip_click', chip: { id: chip.id }, agent_session_id: offered._agent.session_id });
    expect(authorised(pressed)).toEqual([expect.objectContaining({ ok: true, mutated: true })]);
    expect(pressed._agent.typed_approvals, 'a press is not a typed approval').toBeUndefined();
    expect(String(pressed.assistant_text)).not.toContain('typed approval');
    expect(typedWorld.read().edges).toEqual(pressWorld.read().edges);
    expect(node(typedWorld.read(), 'buy_faster_mixer')).toEqual(node(pressWorld.read(), 'buy_faster_mixer'));
  }, 120_000);

  it('A1 host guarantee: typed words with one card waiting write nothing unless the Agent approves THAT card', async () => {
    const w = world(); const turn = await route(w);
    const first = await turn({ message: MIXER_WORDS, source: 'composer' }, [call('propose_option_interventions', MIXER), say('Here is that change.')]);
    const before = hash(w.read());
    const declined = await turn({ message: 'No, leave that for now.', source: 'composer', agent_session_id: first._agent.session_id }, [say('Left as it is.')]);
    expect(authorised(declined)).toEqual([]);
    expect(hash(w.read())).toBe(before);
  }, 90_000);

  it('⭐ A2 (the live T3 shape): two cards waiting, typed yes naming one → nothing written, both buttons shown, that card first; one press applies it', async () => {
    const w = world(); const turn = await route(w);
    const { a, b, session } = await bothCards(w, turn);
    const before = hash(w.read());
    const typed = await turn({ message: 'Yes, I approve the 15% mixer setting.', source: 'composer', agent_session_id: session },
      [call('authorise_change', { proposal_id: b }), say('You approved the 15% mixer setting.')]);
    expect(authorised(typed), JSON.stringify(authorised(typed))).toEqual([expect.objectContaining({ ok: false, mutated: false, refusal: 'approval_required' })]);
    expect(hash(w.read()), 'nothing written').toBe(before);
    const ids = chips(typed);
    expect(ids, 'a button for EVERY waiting card').toEqual(expect.arrayContaining([approvalChipIdFor(a), approvalChipIdFor(b)]));
    expect(ids.indexOf(approvalChipIdFor(b)), 'the card the words meant comes first').toBeLessThan(ids.indexOf(approvalChipIdFor(a)));
    expect(ids).toEqual(expect.arrayContaining([declineChipIdFor(a), declineChipIdFor(b)]));
    expect(String(typed.assistant_text)).toMatch(/two changes are waiting\. To apply "Buy a faster mixer[^"]*", press its button below\./);
    // ONE click applies the right one; the other card keeps its button.
    const chip = chipFor(typed, b);
    const pressed = await turn({ message: chip.message, source: 'chip_click', chip: { id: chip.id }, agent_session_id: session });
    expect(authorised(pressed)).toEqual([expect.objectContaining({ ok: true, mutated: true, proposal_id: b })]);
    expect(mixerSaved(w.read())).toBe(true);
    expect(chips(pressed)).toContain(approvalChipIdFor(a));
    expect(w.onLatestRow(approvalChipIdFor(a))).toBe(true);
  }, 120_000);

  it('A2 ambiguous: two cards waiting, a bare typed "yes" → never bound (even when the Agent picks one), both buttons offered', async () => {
    const w = world(); const turn = await route(w);
    const { a, b, session } = await bothCards(w, turn);
    const before = hash(w.read());
    const typed = await turn({ message: 'yes', source: 'composer', agent_session_id: session },
      [call('authorise_change', { proposal_id: a }), say('Which change do you mean?')]);
    expect(authorised(typed)).toEqual([expect.objectContaining({ ok: false, mutated: false, refusal: 'approval_required' })]);
    expect(hash(w.read())).toBe(before);
    expect(chips(typed)).toEqual(expect.arrayContaining([approvalChipIdFor(a), approvalChipIdFor(b)]));
    expect(String(typed.assistant_text)).toMatch(/two changes are waiting/);
  }, 120_000);

  it('⭐ A4: approving Olumi’s starting value never lapses the user’s new-link card on the same factor; it stays pressable, then saves', async () => {
    const w = world(); const turn = await route(w);
    const { a, b, session, first } = await bothCards(w, turn);
    const chipA = chipFor(first, a);
    const before = hash(w.read());
    const pressedA = await turn({ message: chipA.message, source: 'chip_click', chip: { id: chipA.id }, agent_session_id: session });
    expect(authorised(pressedA)).toEqual([expect.objectContaining({ ok: true, mutated: true })]);
    expect(hash(w.read()), 'the model moved').not.toBe(before);
    expect(String(pressedA.assistant_text)).not.toMatch(LAPSE);
    expect(w.onLatestRow(approvalChipIdFor(b)), 'the user’s card is still held').toBe(true);
    const chipB = chipFor(pressedA, b);
    // Cold: a fresh session still offers it; its press writes the link and the level on the CURRENT model.
    const cold = await turn({ message: 'Where are we?', source: 'composer', agent_session_id: randomUUID() }, [say('Here is where things stand.')]);
    expect(chips(cold)).toContain(approvalChipIdFor(b));
    const pressedB = await turn({ message: chipB.message, source: 'chip_click', chip: { id: chipB.id }, agent_session_id: session });
    expect(authorised(pressedB), JSON.stringify(authorised(pressedB)) + String(pressedB.assistant_text)).toEqual([expect.objectContaining({ ok: true, mutated: true })]);
    expect(mixerSaved(w.read())).toBe(true);
  }, 150_000);
});
