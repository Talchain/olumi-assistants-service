/**
 * ⭐ TODAY'S LEVEL FROM THE USER'S ANSWER (DL-3 lease 16 Oct; Relief's native check at c72fc72c, 7 pass / 2 fail; the three
 * authorship dimensions). Through the real /agent/v1/turn route with a scripted provider: the AI asks, the AI calls
 * propose_goal_current_level, the card is pressed, the route registers, and a fresh /graph read is the cold readback.
 *  · LOSS 1: "We have no funding." quoted whole and read as none (`stated_none`): the card itself says £0 is Olumi's reading
 *    of those words, and its button adopts a reading; the press saves £0 as Olumi's figure the user accepted (`user_confirmed`,
 *    read by the provenance readers as `user_ratified` / `olumi_accepted`, never the user's typed figure), with the user's
 *    sentence kept beside it (`user_statements`, `describes`, `read_as: 0`).
 *  · LOSS 2, BOUNDED: a figure the AI reads as reported from elsewhere (`reported`) is never carded as the user's level. A
 *    mislabelled report still reaches a card, which then shows the user's whole sentence; the AI's reading is not an attestation.
 *  · UNKNOWN (TL 22:18Z): a level the user does not know, read by the AI as `unknown`, records nothing and offers no figure.
 *  · KEPT: an explicit "£0 funding" and "about 80 a week today" save as before; chance, other quantity, wrong unit and model
 *    origin are refused as before. A reading is none only, of words that write no figure, quoted from the user's own messages.
 * Kit adapted from Relief's (recovery-notes/level-answer-c72fc72c). SYNTHETIC answers, never an unseen brief.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { createMockSessionStore, makeSessionTurnRow } from '../../../../tests/utils/mock-session-store.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { computeGraphIdentityHash } from '../../context/graph-identity.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { __setUseAppendV6ForTest } from '../../append-v6-flag.js';
import type { SessionTurnWrite } from '../../session/store.js';
import { userStatementFor } from '../../statement-door/statements.js';
import { inputOriginOf, valueClassOf, valueProvenanceOf, whoseOf } from '../../../cee/provenance/provenance-of.js';
import { goalLevelIsOlumisEstimate } from '../../goal-target/goal-chance-licence.js';
import { applyGoalCurrentLevel } from '../goal-current-level.js';
import { createProposal } from '../proposal.js';

const { facade } = vi.hoisted(() => ({ facade: { value: null as unknown } }));
vi.mock('../../session/index.js', async (original) => ({ ...await original<Record<string, unknown>>(), getSessionStore: () => facade.value }));
vi.mock('../../../orchestrator/user-identity.js', async (original) => ({ ...await original<Record<string, unknown>>(),
  resolveUserIdentity: async () => ({ mode: 'off' }) }));

type Dict = Record<string, any>;
const SCENARIO = '550e8400-e29b-41d4-a716-4466554400da';
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const TOOL = 'propose_goal_current_level';
const apps: FastifyInstance[] = [];
let stored: Dict;
let writes: SessionTurnWrite[];
let phase: 'ask' | 'propose';
let emitted: boolean;
let question: string;
let args: Dict;
let toolResults: Dict[];

function graph(label: string, unit: string, target: number, cap: number): Dict {
  return projectGraphForPersistence({ nodes: [
    { id: 'goal', kind: 'goal', label, goal_threshold: target / cap, goal_threshold_raw: target,
      goal_threshold_cap: cap, goal_threshold_unit: unit, goal_threshold_frame: 'level', goal_direction: 'at_least' },
    { id: 'pilot', kind: 'option', label: 'Pilot' },
    { id: 'effort', kind: 'factor', label: 'Effort' },
  ], edges: [{ from: 'effort', to: 'goal', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' }] }) as Dict;
}

async function world(g: Dict) {
  stored = clone(g); writes = []; toolResults = []; emitted = false; phase = 'ask';
  const recent = () => writes.map((w, i) => makeSessionTurnRow({ id: `row-${i}`, scenario_id: w.scenario_id,
    turn_id: w.turn_id, turn_class: w.turn_class, handler_id: w.handler_id, request_hash: w.request_hash,
    response_emitted: w.response_emitted, llm_calls_used: w.llm_calls_used, duration_ms: w.duration_ms,
    user_message: w.userMessage ?? null, assistant_message: w.assistantMessage ?? null })).reverse();
  facade.value = createMockSessionStore({
    ensureScenarioExists: async () => ({ user_id: null }), getScenarioOwner: async () => null,
    scenarioExists: async () => true,
    loadGraph: async () => clone(stored), loadGraphAndBriefText: async () => ({ graph: clone(stored), briefText: null }),
    readRecent: async () => recent(), readMostRecentPendingActions: async () => clone(writes.at(-1)?.pending_actions ?? []),
    readFactsWithTurnFor: async (ids) => writes.flatMap((w, i) => ids.includes(`row-${i}`)
      ? w.handler_facts.map((fact) => ({ turn_id: `row-${i}`, fact_created_at: new Date().toISOString(), fact })) : []),
    append: async (w) => { writes.push(clone(w)); if (w.graph !== undefined) stored = clone(w.graph) as Dict; return { id: `row-${writes.length - 1}` }; },
  });
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, init: { body?: unknown }) => {
    expect(String(url)).toBe('https://api.openai.com/v1/responses');
    const request = JSON.parse(String(init.body));
    for (const item of request.input ?? []) if (item.type === 'function_call_output') {
      try { toolResults.push(JSON.parse(item.output)); } catch { /* the raw request stays in the assertion messages */ }
    }
    const output = phase === 'propose' && !emitted
      ? [{ type: 'function_call', call_id: 'native-level', name: TOOL, arguments: JSON.stringify(args) }]
      : [{ type: 'message', content: [{ type: 'output_text', text: phase === 'ask' ? question : 'Review the current-level card before it is saved.' }] }];
    emitted = true;
    return new Response(JSON.stringify({ id: `stub-${randomUUID()}`, status: 'completed', output }), { status: 200 });
  }));
  const app = Fastify({ logger: false }); apps.push(app);
  app.post('/assist/v1/scenarios/:id/graph', async () => ({ graph: clone(stored),
    graph_hash: computeAnalysisAffectingGraphHash(stored as never), graph_identity_hash: computeGraphIdentityHash(stored as never) }));
  const register = (await import('../../../routes/assist.v1.scenario-graph-register.js')).default;
  await app.register(register);
  const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js'); await app.register(agentV1TurnRoute);
  await app.ready();
  const session = `level-reading-${randomUUID()}`;
  return { app, turn: (message: string, chip?: Dict) => app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
    kind: 'message', scenario_id: SCENARIO, agent_session_id: session, message, ...(chip ? { chip } : {}),
  } }) };
}

/** The AI asks; the user answers; the AI calls the level door with `given`. The answer turn's response, and the world. */
async function answered(label: string, unit: string, target: number, cap: number, answer: string, given: Dict) {
  question = `What is today's level of ${label}, in ${unit}?`;
  args = { goal_label: label, unit, user_stated: true, goal_is: 'at_least', ...given };
  const w = await world(graph(label, unit, target, cap));
  const asked = await w.turn('Help me understand what is missing.'); expect(asked.statusCode, asked.body).toBe(200);
  phase = 'propose'; emitted = false;
  const res = await w.turn(answer); expect(res.statusCode, res.body).toBe(200);
  const b = res.json();
  expect(b._agent?.tool_calls).toContainEqual(expect.objectContaining({ name: TOOL }));
  const card = b.suggested_actions?.find((c: Dict) => String(c.id).startsWith('agent-approve-proposal:'));
  return { ...w, b, card };
}

/** Press the card, then the cold read: the one written graph equals a fresh /graph read, and that read's goal. */
async function pressAndReopen(w: { app: FastifyInstance; turn: (m: string, c?: Dict) => Promise<any> }, card: Dict) {
  const approved = await w.turn(card.message, card);
  expect(approved.statusCode, approved.body).toBe(200);
  const graphWrites = writes.filter((x) => x.graph !== undefined);
  expect(graphWrites).toHaveLength(1);
  const read = await w.app.inject({ method: 'POST', url: `/assist/v1/scenarios/${SCENARIO}/graph`, payload: {} });
  const cold = clone(read.json().graph);
  expect(graphWrites[0]!.graph).toEqual(cold);
  return { cold, goal: cold.nodes.find((n: Dict) => n.id === 'goal') as Dict };
}
const levelRecord = (g: Dict) => userStatementFor(g, { kind: 'goal', id: 'goal', field: 'level' });

beforeEach(() => {
  __setUseAppendV6ForTest(false);
  process.env.AGENT_LANE_ENABLED = 'true'; process.env.AGENT_LANE_PREVIEW = 'false';
});
afterEach(async () => { while (apps.length) await apps.pop()!.close(); vi.unstubAllGlobals(); });

describe('today\'s level from the user\'s answer: AI ask → card → press → register → cold read', () => {
  it('⭐ LOSS 1: "We have no funding." is read as £0 on a card that says it is Olumi\'s reading; saved as an accepted reading', async () => {
    const said = 'We have no funding.';
    const w = await answered('Funding secured', 'GBP', 250000, 1000000, said, { value: 0, source_quote: said, figure_origin: 'stated_none' });
    expect(w.card, JSON.stringify({ calls: w.b._agent?.tool_calls, toolResults })).toBeDefined();
    // The BINDING is said ON THE CARD before the press, and its button adopts a reading, never "Record … as your figure".
    const words = 'Record the current level of "Funding secured" as £0, Olumi\'s reading of your words “We have no funding.” (target £250,000)';
    expect(w.card).toMatchObject({ label: 'Use this reading', message: 'Yes, use this reading.', detail: words });
    // DL-3 ruling (#3325 B1): the reading card offers Use this reading / Change / Reject, with the full quote shown.
    expect((w.b.suggested_actions as Dict[]).map((c) => c.label)).toEqual(expect.arrayContaining(['Use this reading', 'Change something first', 'Reject']));
    expect(toolResults.find((r) => typeof r.public_label === 'string')!.public_label).toBe(words);
    expect(writes.filter((x) => x.graph !== undefined)).toHaveLength(0);
    const { cold, goal } = await pressAndReopen(w, w.card);
    // Whose figure, through the ACTUAL provenance readers: Olumi's, accepted by the press; never the user's typed figure.
    expect(goal.observed_state).toMatchObject({ raw_value: 0, unit: 'GBP', source: 'user_confirmed' });
    expect(valueClassOf(goal.observed_state)).toBe('user_ratified');
    expect(inputOriginOf(goal.observed_state)).toBe('ai_accepted');
    expect(whoseOf(valueProvenanceOf(goal.observed_state))).toBe('olumi_accepted');
    expect(goalLevelIsOlumisEstimate(cold, 'goal')).toBe(false); // the accepted reading never blocks the goal's chance
    expect(goal.goal_threshold_raw).toBe(250000);
    // SOURCE kept: the user's whole sentence, a figure-free statement (no low/high), Olumi's reading of it as 0.
    const record = levelRecord(cold)!;
    expect(record.attest).toEqual({ read_as: 0 });
    expect(record.statements).toEqual([expect.objectContaining({ speaker: 'user', reading: 'olumi', quote: said, source: said, form: 'describes', unit: 'GBP' })]);
    expect(record.statements[0]).not.toHaveProperty('low');
    // A second press of the same card writes nothing more.
    const again = await w.turn(w.card.message, w.card); expect(again.statusCode, again.body).toBe(200);
    expect(writes.filter((x) => x.graph !== undefined)).toHaveLength(1);
  }, 30_000);

  it('NEGATIVE: a reading whose unit is of another kind (a percentage for a goal in pounds) is about something else: no card', async () => {
    const said = 'We have no funding.';
    const w = await answered('Funding secured', 'GBP', 250000, 1000000, said, { value: 0, unit: '%', source_quote: said, figure_origin: 'stated_none' });
    expect(toolResults).toContainEqual(expect.objectContaining({ ok: false, refusal: 'unit_mismatch' }));
    expect(w.card).toBeUndefined();
    expect(writes.filter((x) => x.graph !== undefined)).toHaveLength(0);
  }, 30_000);

  // TL 22:18Z meaning ruling (BUDDY-A #3325 B1): what the user does not know is UNKNOWN, never £0. The AI's own reading says so
  // (`unknown`), and the door records nothing and offers no figure: no level, no card, one ask at most.
  it('UNKNOWN: "We don\'t know whether we have any funding." → no level, no £0, no card; the AI is told to ask once at most', async () => {
    const said = 'We don\'t know whether we have any funding.';
    const w = await answered('Funding secured', 'GBP', 250000, 1000000, said, { value: 0, source_quote: said, figure_origin: 'unknown' });
    const refused = toolResults.find((r) => r.refusal === 'level_unknown');
    expect(refused, JSON.stringify(toolResults)).toMatchObject({ ok: false, mutated: false });
    expect(String(refused!.detail)).toMatch(/stays unknown: nothing is recorded, and no figure is offered for it\..*Ask once for it only if/);
    expect(w.card).toBeUndefined();
    expect(writes.filter((x) => x.graph !== undefined)).toHaveLength(0);
    expect(stored.nodes.find((n: Dict) => n.id === 'goal').observed_state).toBeUndefined();
  }, 30_000);

  it('CONTRAST: an explicit "We have £0 funding today." is the user\'s own figure in the same readers', async () => {
    const said = 'We have £0 funding today.';
    const w = await answered('Funding secured', 'GBP', 250000, 1000000, said, { value: 0, source_quote: said, figure_origin: 'written' });
    expect(w.card).toMatchObject({ label: 'Record this current level', detail: expect.stringContaining('as your figure: £0, from your words “We have £0 funding today.”') });
    const { goal } = await pressAndReopen(w, w.card);
    expect(goal.observed_state).toMatchObject({ raw_value: 0, source: 'user_override' });
    expect(valueClassOf(goal.observed_state)).toBe('user_stated');
    expect(inputOriginOf(goal.observed_state)).toBe('human');
  }, 30_000);

  it('A REPLACED LEVEL IS SAID: "We have no new funding." beside a held £50,000 shows £50,000 → £0 as Olumi\'s reading before any write', async () => {
    const said = 'We have no new funding.';
    const held = graph('Funding secured', 'GBP', 250000, 1000000);
    held.nodes.find((n: Dict) => n.id === 'goal').observed_state = { value: 0.05, baseline: 0.05, unit: 'GBP', source: 'user_override', raw_value: 50000, cap: 1000000 };
    question = 'What is today\'s level of Funding secured, in GBP?';
    args = { goal_label: 'Funding secured', unit: 'GBP', user_stated: true, value: 0, source_quote: said, figure_origin: 'stated_none' };
    const w = await world(held);
    await w.turn('Help me understand what is missing.');
    phase = 'propose'; emitted = false;
    const b = (await w.turn(said)).json();
    const card = b.suggested_actions?.find((c: Dict) => String(c.id).startsWith('agent-approve-proposal:'));
    expect(card?.detail).toBe('Record the current level of "Funding secured" as £50,000 → £0, Olumi\'s reading of your words “We have no new funding.” (target £250,000)');
    expect(writes.filter((x) => x.graph !== undefined)).toHaveLength(0);
  }, 30_000);

  it.each([
    ['Funding secured', 'GBP', 250000, 1000000, 'We have £0 funding today.', 0],
    ['Order volume', 'orders per week', 100, 200, 'We do about 80 a week today.', 80],
  ] as const)('KEPT: %s, "%s" saves the user\'s written figure as before; quoted, its sentence is kept as a point', async (label, unit, target, cap, answer, raw) => {
    for (const given of [{ value: raw }, { value: raw, source_quote: answer, figure_origin: 'written' }]) {
      const w = await answered(label, unit, target, cap, answer, given);
      expect(w.card, JSON.stringify({ given, toolResults })).toBeDefined();
      expect(JSON.stringify(w.card)).not.toContain('Olumi\'s reading');
      expect(w.card.label).toBe('Record this current level');
      if (given.source_quote !== undefined) expect(w.card.detail).toContain(`from your words “${answer}”`);
      else expect(w.card.detail).toBeUndefined();
      const { cold, goal } = await pressAndReopen(w, w.card);
      expect(goal.observed_state).toMatchObject({ raw_value: raw, unit, source: 'user_override' });
      const record = levelRecord(cold);
      if (given.source_quote === undefined) expect(record).toBeUndefined();
      else expect(record?.statements).toEqual([expect.objectContaining({ quote: answer, form: 'point', low: raw, high: raw, reading: 'olumi' })]);
      while (apps.length) await apps.pop()!.close();
    }
  }, 60_000);

  it.each([
    ['LOSS 2 (old Run, reported)', 'The old Run estimated 80 orders per week; I have no current measurement.', { value: 80, figure_origin: 'reported' }, 'not_the_users_observation'],
    ['chance', 'The last Run gave an 80% chance, not a current order volume.', { value: 80, unit: '%' }, undefined],
    ['other quantity', 'Our budget is £80 a week today.', { value: 80 }, undefined],
    ['wrong unit', 'We do about 80 a week today.', { value: 80, unit: 'GBP' }, undefined],
    ['model origin', 'I do not know today’s order volume.', { value: 80, user_stated: false }, 'not_the_users_figure'],
    ['a reading is none only', 'We have hardly any orders.', { value: 5, source_quote: 'We have hardly any orders.', figure_origin: 'stated_none' }, 'reading_not_none'],
    ['a reading never overrides a written figure', 'We do about 80 a week today.', { value: 0, source_quote: 'We do about 80 a week today.', figure_origin: 'stated_none' }, 'figure_in_quote'],
    ['a quote the user never wrote', 'We have no orders yet.', { value: 0, source_quote: 'We have no orders at all.', figure_origin: 'stated_none' }, 'statement_not_found'],
    ['a reading needs its quote', 'We have no orders yet.', { value: 0, figure_origin: 'stated_none' }, 'statement_malformed'],
    ['a written figure is in its quote', 'We do about 80 a week today. We hope for 90.', { value: 90, source_quote: 'We do about 80 a week today.' }, 'figure_not_in_quote'],
    ['a shortened quote', 'We have no orders yet.', { value: 0, source_quote: 'We have no', figure_origin: 'stated_none' }, 'statement_not_found'],
    ['Olumi\'s own words are never the source', 'Nothing yet.', { value: 0, source_quote: 'What is today\'s level of Order volume, in orders per week?', figure_origin: 'stated_none' }, 'statement_not_found'],
    ['an unknown origin label', 'We have no orders yet.', { value: 0, source_quote: 'We have no orders yet.', figure_origin: 'guessed' }, 'statement_malformed'],
  ] as const)('NEGATIVE (%s): no card, nothing written', async (_name, answer, given, refusal) => {
    const w = await answered('Order volume', 'orders per week', 100, 200, answer, given);
    expect(w.b._agent?.tool_calls).toContainEqual(expect.objectContaining({ name: TOOL, ok: false, mutated: false }));
    if (refusal !== undefined) expect(toolResults).toContainEqual(expect.objectContaining({ ok: false, refusal }));
    expect(w.card).toBeUndefined();
    expect(writes.filter((x) => x.graph !== undefined)).toHaveLength(0);
  }, 30_000);
});

describe('TL 21:30Z: today\'s level does not depend on the target (G1 founder 829a152b turn 3 shape)', () => {
  // The served goal: a target held as 1.3 "million (currency unspecified)", on the level frame, with NO cap.
  const halfWritten = (): Dict => projectGraphForPersistence({ nodes: [
    { id: 'goal', kind: 'goal', label: 'Funding secured', goal_threshold_raw: 1.3, goal_threshold_unit: 'million (currency unspecified)', goal_threshold_frame: 'level' },
    { id: 'pilot', kind: 'option', label: 'Pilot' }, { id: 'effort', kind: 'factor', label: 'Effort' },
  ], edges: [{ from: 'effort', to: 'goal', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' }] }) as Dict;
  async function turnOn(g: Dict, answer: string, given: Dict) {
    question = 'What is today\'s level of Funding secured?';
    args = { goal_label: 'Funding secured', user_stated: true, ...given };
    const w = await world(g);
    await w.turn('Help me understand what is missing.');
    phase = 'propose'; emitted = false;
    const b = (await w.turn(answer)).json();
    return { ...w, b, card: b.suggested_actions?.find((c: Dict) => String(c.id).startsWith('agent-approve-proposal:')) };
  }
  it('⭐ "We have no funding." beside the unframed target: offered as Olumi\'s reading, saved as 0 with no frame, the target untouched', async () => {
    const said = 'We have no funding.';
    const w = await turnOn(halfWritten(), said, { value: 0, unit: 'GBP', source_quote: said, figure_origin: 'stated_none' });
    expect(w.card, JSON.stringify(toolResults)).toMatchObject({ label: 'Use this reading', detail: expect.stringContaining('Olumi\'s reading of your words “We have no funding.”') });
    const { cold, goal } = await pressAndReopen(w, w.card);
    expect(goal.observed_state).toMatchObject({ raw_value: 0, value: 0, baseline: 0, source: 'user_confirmed' });
    expect(goal.observed_state).not.toHaveProperty('cap');
    expect(goal).toMatchObject({ goal_threshold_raw: 1.3, goal_threshold_unit: 'million (currency unspecified)', goal_threshold_frame: 'level' });
    expect(goal.observed_state.unit).toBe('million (currency unspecified)'); // none, in the goal's own unit: the words wrote no unit
    expect(levelRecord(cold)?.statements[0]).toMatchObject({ quote: said, form: 'describes' });
  }, 30_000);
  // A target held in pounds but not yet framed (no cap): the "currency unspecified" placeholder is a separate unit reading.
  const halfWrittenGbp = (): Dict => { const g = halfWritten(); Object.assign(g.nodes.find((n: Dict) => n.id === 'goal'), { goal_threshold_raw: 250000, goal_threshold_unit: 'GBP' }); return g; };
  it('the explicit "We have £0 funding today." beside an unframed target is no longer refused no_target: saved as the user\'s 0', async () => {
    const said = 'We have £0 funding today.';
    const w = await turnOn(halfWrittenGbp(), said, { value: 0, unit: 'GBP' });
    expect(toolResults).not.toContainEqual(expect.objectContaining({ refusal: 'no_target' }));
    expect(w.card, JSON.stringify(toolResults)).toBeDefined();
    const { goal } = await pressAndReopen(w, w.card);
    expect(goal.observed_state).toMatchObject({ raw_value: 0, value: 0, source: 'user_override' });
  }, 30_000);
  it('a positive level beside the unframed target is recorded on its own frame, as with no target', async () => {
    const said = 'We have £50,000 secured today.';
    const w = await turnOn(halfWrittenGbp(), said, { value: 50000, unit: 'GBP' });
    expect(toolResults).not.toContainEqual(expect.objectContaining({ refusal: 'no_target' }));
    expect(w.card, JSON.stringify(toolResults)).toBeDefined();
    const { goal } = await pressAndReopen(w, w.card);
    expect(goal.observed_state).toMatchObject({ raw_value: 50000, source: 'user_override' });
    expect(goal.observed_state.cap).toBeGreaterThan(50000);
    expect(goal.observed_state.value).toBeCloseTo(50000 / goal.observed_state.cap, 12);
  }, 30_000);
});

describe('the apply re-checks the reading against its stamp (tamper; zero dispatch)', () => {
  const said = 'We have no funding.';
  const goalNode = { id: 'goal', kind: 'goal', label: 'Funding secured', goal_threshold: 0.25, goal_threshold_raw: 250000, goal_threshold_cap: 1000000,
    goal_threshold_unit: 'GBP', goal_threshold_frame: 'level', goal_direction: 'at_least' };
  const approved = { graph_hash: 'h', graph_identity_hash: 'i', nodes: [goalNode], raw: { nodes: [goalNode], edges: [] } } as never;
  const record = (form: 'describes' | 'point') => ({ subject_key: 'goal|goal|||level', field: 'level', recorded_at: '2026-10-16T21:00:00.000Z',
    statements: [{ speaker: 'user', quote: said, source: said, subject: { quantity: 'level', node_id: 'goal' }, form, unit: 'GBP', reading: 'olumi',
      ...(form === 'point' ? { low: 0, high: 0 } : {}) }], ...(form === 'describes' ? { attest: { read_as: 0 } } : {}) });
  const apply = async (source: string, level_statement?: unknown) => {
    const dispatched: string[] = [];
    const proposal = createProposal({ scenario_id: SCENARIO, user_id: null, base_graph_identity_hash: 'h',
      operations: [{ op: 'update_node', path: 'goal', value: { goal_current_level: { value: 0, baseline: 0, unit: 'GBP', source, raw_value: 0, cap: 1000000 },
        against: { goal_threshold_raw: 250000, goal_threshold_cap: 1000000, goal_threshold_unit: 'GBP', goal_threshold_frame: 'level' },
        ...(level_statement !== undefined ? { level_statement } : {}) } }],
      provenance: { authored_by: 'user_stated', basis: 'test' }, validation: { admitted: true, loss_count: 0, refusals: [] }, public_label: 'card' } as never);
    const r = await applyGoalCurrentLevel({ dispatch: async (path: string) => { dispatched.push(path); return { status: 200, json: {} }; },
      readGraph: async () => approved, proposals: { put: () => undefined, markApplied: () => undefined } as never, operationId: (k: string) => k },
    { scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'r' } as never, proposal, approved) as Dict;
    return { r, dispatched };
  };
  it.each([
    ['an accepted reading with no statement', 'user_confirmed', undefined],
    ['an accepted reading with a point record (a figure the user never wrote)', 'user_confirmed', record('point')],
    ['the user\'s own stamp on a figure-free record', 'user_override', record('describes')],
  ] as const)('%s writes nothing', async (_n, source, statement) => {
    const { r, dispatched } = await apply(source, statement);
    expect(r).toMatchObject({ ok: false, mutated: false, refusal: 'not_applied', detail: expect.stringMatching(/^The statement this level of "Funding secured" was read from changed/) });
    expect(dispatched).toEqual([]);
  });
  it('POSITIVE CONTROL: the matching accepted reading and its figure-free record pass the re-check and reach the register', async () => {
    const { dispatched } = await apply('user_confirmed', record('describes'));
    expect(dispatched).toEqual([`/assist/v1/scenarios/${SCENARIO}/graph/register`]);
  });
});
