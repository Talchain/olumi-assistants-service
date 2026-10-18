/**
 * ⭐ A FIGURE WRITTEN IN WORDS IS WRITTEN (DL-3, deployed first loss, CEE 7d052e5d: 7/7 live corrections stopped before any
 * card). The user corrected a level in words ("seventy tickets a week, not eighty"); `figureTheUserWrote` read digits only, so
 * the figure's origin was unknown and `propose_assumptions` was refused (`origin_unknown`). The same words in digits gave a card,
 * the press applied, and the readback held the figure. THE PATH: the REAL `agentV1TurnRoute` → the REAL Agent loop → the REAL
 * `propose_assumptions` → ONE card → the press → the level writer → the store → the readback. Synthetic typed words on a served
 * graph (capacity 358132d8); scripted: only the Agent's outputs. 0 provider calls.
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
  getAdapter: () => { throw new Error('Providers forbidden in the spelled-figure route replay'); },
  getAdapterWithResolution: () => { throw new Error('Providers forbidden in the spelled-figure route replay'); }, getMaxTokensFromConfig: () => undefined,
}));
vi.mock('../../../orchestrator/user-identity.js', async original => ({ ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }) }));
import { createMockSessionStore, makeSessionTurnRow } from '../../../../tests/utils/mock-session-store.js';
import { approvalChipIdFor } from '../approval-chips.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { computeGraphIdentityHash } from '../../context/graph-identity.js';
import type { CommittedTurnLedger } from '../../session/store.js';
import type { SessionTurnWithContent } from '../../session/conversation-content.js';
import { figureTheUserWrote, timesTheUserWrote, withdrawUnstatedBaselineStamps } from '../stated-by-user.js';

type Rec = Record<string, any>;
const FX = JSON.parse(readFileSync(new URL('./fixtures/capacity-358132d8-unsized-olumi-risk-graph-20261014.json', import.meta.url), 'utf8')) as Rec;
const SERVED: Rec = { graph: JSON.parse(FX.graph_text), brief_text: FX.brief_text };
const TEAM = 'existing_team_capacity', SPECIALISTS = 'additional_specialists';
const UNIT = 'tickets per week';
const ROUTE_MS = 60_000;

const nodeOf = (g: Rec, id: string): Rec => (g.nodes as Rec[]).find((n) => n.id === id)!;
const say = (text: string) => ({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] });
const call = (name: string, args: Rec) => ({ output: [{ type: 'function_call', name, call_id: `call_${name}_${randomUUID().slice(0, 8)}`, arguments: JSON.stringify(args) }] });

function world(served: Rec) {
  const sid = randomUUID();
  const body: Rec = { ...served, scenario_id: sid };
  let bytes = JSON.stringify(body.graph);
  const graph = (): Rec => JSON.parse(bytes);
  const rows: SessionTurnWithContent[] = [];
  const writes: Rec[] = [];
  const latest = () => rows.find(r => !r.turn_id.endsWith(':claim'));
  const ledger: CommittedTurnLedger = { write_turn_ids: [], user_message_turn_ids: [], first_user_message: String(body.brief_text), complete: true } as never;
  live.store = createMockSessionStore({
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
      writes.push(JSON.parse(JSON.stringify(write))); if (write.graph !== undefined && write.graph !== null) bytes = JSON.stringify(write.graph);
      const id = randomUUID(); rows.unshift({ ...makeSessionTurnRow({ id, scenario_id: sid, turn_id: write.turn_id, request_hash: write.request_hash,
        turn_class: write.turn_class, handler_id: write.handler_id, response_emitted: write.response_emitted, created_at: new Date().toISOString(),
        user_message: write.userMessage ?? null, assistant_message: write.assistantMessage ?? null }), pending_actions: write.pending_actions ?? [] } as SessionTurnWithContent);
      return { id };
    },
  });
  const graphWire = () => ({ ...structuredClone(body), graph: graph(), graph_hash: computeAnalysisAffectingGraphHash(graph() as never),
    graph_identity_hash: computeGraphIdentityHash(graph() as never) });
  return { sid, writes, graph, graphWire };
}

let agentScript: Rec[] = [];
const apps: FastifyInstance[] = [];
beforeEach(() => { agentScript = []; });
afterEach(async () => { for (const app of apps.splice(0)) await app.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
async function route(w: ReturnType<typeof world>) {
  vi.stubEnv('AGENT_LANE_ENABLED', 'true'); vi.stubEnv('AGENT_LANE_PREVIEW', 'false');
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: { body?: string }) => {
    if (!String(url).includes('openai')) throw new Error(`Network forbidden: ${String(url)}`);
    const req = JSON.parse(String(init?.body ?? '{}')) as Rec;
    if (req.text?.format?.name === 'brief_spans') return new Response('{}', { status: 500 });
    return new Response(JSON.stringify(agentScript.shift() ?? say('Done.')), { status: 200 });
  }));
  const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
  const app = Fastify({ logger: false }); apps.push(app);
  app.post('/assist/v1/scenarios/:id/graph', async () => w.graphWire());
  app.post('/assist/v1/scenarios/:id/versions', async () => ({ versions: [] }));
  await app.register(agentV1TurnRoute); await app.ready();
  return async (over: Rec, script: Rec[] = []): Promise<Rec> => {
    agentScript = [...script];
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', turn_id: randomUUID(), scenario_id: w.sid, ...over } });
    expect(r.statusCode, r.body.slice(0, 2000)).toBe(200);
    return r.json() as Rec;
  };
}

/** One typed correction, the Agent's one `propose_assumptions`, then the press when a card is offered. */
async function correct(typed: string, a: Rec) {
  const w = world(SERVED);
  const turn = await route(w);
  const offer = await turn({ message: typed, source: 'composer' }, [call('propose_assumptions', { assumptions: [a] }), say('Here is a card to review.')]);
  const result = (offer._agent.tool_calls as Rec[]).find((c) => c.name === 'propose_assumptions')!;
  const pid = String(result.proposal_id);
  const chip = (offer.suggested_actions as Rec[] | undefined)?.find((c) => c.id === approvalChipIdFor(pid));
  if (chip !== undefined) await turn({ message: chip.message, source: 'chip_click', chip: { id: chip.id }, agent_session_id: offer._agent.session_id });
  return { result, chip, w };
}
const teamLevel = (value: number) => ({ factor_label: 'Existing team capacity', value, unit: UNIT, user_stated: true, revise: true,
  basis: 'the user’s correction of today’s level' });

describe('a figure written in words is written, exactly as its digits are (deployed 7d052e5d first loss)', () => {
  it('⭐ RED → GREEN: "seventy" and "70" give the same card, the press applies, and the readback holds 70 as the user’s', async () => {
    const digits = await correct('Correction: our existing team resolves 70 tickets per week, not 80.', teamLevel(70));
    const words = await correct('Correction: our existing team resolves seventy tickets per week, not eighty.', teamLevel(70));
    expect(digits.result, 'CONTROL: the digits path gives a card').toMatchObject({ ok: true, mutated: false });
    expect(words.result, JSON.stringify(words.result)).toMatchObject({ ok: true, mutated: false });
    expect(words.chip?.label).toBe(digits.chip?.label);
    expect(String(words.chip?.detail).replace('seventy', '70').replace('eighty', '80')).toBe(String(digits.chip?.detail));
    for (const { w } of [digits, words]) expect(nodeOf(w.graph(), TEAM).observed_state).toMatchObject({ raw_value: 70, unit: UNIT });
    expect(nodeOf(words.w.graph(), TEAM)).toEqual(nodeOf(digits.w.graph(), TEAM));
  }, 4 * ROUTE_MS);

  it('⛔ a spelled figure of ANOTHER quantity in the same words is never attested to this one (nor are its digits)', async () => {
    const digits = await correct('We now have 70 customers on the support plan; the team resolves the same as before.', teamLevel(70));
    const words = await correct('We now have seventy customers on the support plan; the team resolves the same as before.', teamLevel(70));
    // In words, a figure counts as written only with its unit word ("seventy TICKETS"): "seventy customers" is no figure of a
    // tickets-per-week level, so the Agent's 70 has no human origin here and nothing is offered or written.
    expect(words.result).toMatchObject({ ok: false, mutated: false, refusal: 'origin_unknown' });
    expect(words.chip).toBeUndefined();
    expect(nodeOf(words.w.graph(), TEAM)).toEqual(nodeOf(SERVED.graph, TEAM));
    // CONTROL (today's digits): presence is never attestation either: the card says which factor it is about is Olumi's reading,
    // and after the press the saved figure keeps that binding unverified.
    expect(digits.chip, 'CONTROL: digits give a card').toBeDefined();
    expect(String(digits.chip!.detail)).toContain('(figure from the quoted message; field binding unverified)');
    expect(nodeOf(digits.w.graph(), TEAM).observed_state).toMatchObject({ raw_value: 70, user_material_unverified: true });
  }, 4 * ROUTE_MS);

  it.each([
    ['an ordinal', 'This is the first week the new rota has run.'],
    ['the pronoun "one"', 'One of them was off sick, and the one who covered was new.'],
  ])('⛔ %s is no figure: a 1 the user never wrote is refused (origin unknown), no card, nothing written', async (_n, typed) => {
    const { result, chip, w } = await correct(typed, { factor_label: 'Additional specialists', value: 1, unit: 'specialists', user_stated: true,
      revise: true, basis: 'the user’s words' });
    expect(result).toMatchObject({ ok: false, mutated: false, refusal: 'origin_unknown' });
    expect(chip).toBeUndefined();
    expect(nodeOf(w.graph(), SPECIALISTS)).toEqual(nodeOf(SERVED.graph, SPECIALISTS));
  }, 2 * ROUTE_MS);
});

describe('another speaker’s quoted figure, a name or an ordinal is never the user’s correction (real route)', () => {
  it.each([
    ['an ordinal after a compound (Codex BLOCK 628a1634: saved 100)', 'This is our one hundred first ticket this week.', 100],
    ['another speaker’s quoted words', 'Our manager said: \u201Cthe team resolves seventy tickets per week\u201D.', 70],
    ['a name', 'We moved to the Seventy Tickets plan last year.', 70],
  ])('⛔ %s: the Agent’s figure has no human origin, no card, nothing written', async (_n, typed, value) => {
    const { result, chip, w } = await correct(typed, teamLevel(value));
    expect(result).toMatchObject({ ok: false, mutated: false, refusal: 'origin_unknown' });
    expect(chip).toBeUndefined();
    expect(nodeOf(w.graph(), TEAM)).toEqual(nodeOf(SERVED.graph, TEAM));
  }, 2 * ROUTE_MS);
});

/**
 * ⛔ Codex SPELLED pair AMEND (AIE bb91dcdd; PL 20:57; verifier C4): a figure in words is read by the digit path's own unit check,
 * never a stricter one. What only words need: its unit word right after it (so "one of them" and ordinals are no figures), never
 * money, a percentage or a scaled unit, a name or another speaker's quoted words. Presence only, never attestation.
 */
describe('a figure in words is read by the digit path\'s own unit check, with its unit word after it', () => {
  it.each([
    ['a count with its unit', 70, 'tickets per week', 'Our team resolves seventy tickets per week.', true],
    ['a duration with its unit', 2, 'hours per week', 'It takes two hours per week.', true],
    ['the same period, said another way', 2, 'hours per week', 'It takes two hours a week.', true],
    ['a correction', 35, 'minutes', 'The wait is thirty-five minutes, not forty-five.', true],
    ['a sentence that opens with it', 2, 'developers', 'Two developers left last month.', true],
    ['after a colon', 70, 'tickets per week', 'Correction: Seventy tickets per week, not eighty.', true],
    ['C4: a spelled figure with a spelled period', 15, 'food bags per 10 minutes', 'We pack fifteen bags per ten minutes.', true],
    // trailing unit and period
    // the digit path's own check: the same figure, and no unit word of another kind ("2 weeks" is no count of people)
    ['another figure', 80, 'tickets per week', 'Our team resolves seventy tickets per week.', false],
    ['a unit word of another kind', 2, 'people per week', 'It took two weeks.', false],
    ['no unit word', 2, 'hours per week', 'We have two of them.', false],
    ['the pronoun "one"', 1, 'specialists', 'One of them was off sick, and the one who covered was new.', false],
    ['another count', 70, 'tickets per week', 'Our team serves seventy customers per week.', false],
    ['another kind of unit', 2, 'minutes', 'We hired two developers.', false],
    // scale, money, percentages and shares
    ['money in words, scaled unit', 2, '£k/month', 'It costs two thousand pounds a month.', false],
    ['money in words, plain unit', 2000, '£', 'It costs two thousand pounds.', false],
    ['a percentage in words', 2, 'people', 'Churn is two percent.', false],
    ['a percentage in words, % unit', 50, '%', 'Fifty percent of customers renew.', false],
    ['a share', 0.5, 'share of customers', 'About half of them renew.', false],
    // ordinals
    ['a hyphenated ordinal', 20, 'weeks', 'This is the twenty-first week of the rota.', false],
    ['a spaced ordinal', 40, 'customers', 'She was our forty fifth customer.', false],
    ['a scale ordinal', 1, 'customers', 'He was our one hundredth customer.', false],
    ['an ordinal after a compound (Codex BLOCK 628a1634)', 100, 'tickets per week', 'This is our one hundred first ticket this week.', false],
    // names
    ['a name inside a sentence', 2, 'developers', 'We work with Two Developers Ltd on the app.', false],
    ['a name that opens a sentence', 2, 'developers', 'Two Developers Ltd sent the quote.', false],
    // another speaker's quoted words
    ['double quotes', 70, 'tickets per week', 'Our manager said "we resolve seventy tickets per week" in the review.', false],
    ['curly quotes', 70, 'tickets per week', 'Our manager said: \u201Cwe resolve seventy tickets per week\u201D.', false],
  ] as const)('%s', (_n, value, unit, text, written) => {
    expect(figureTheUserWrote(value, unit, text)).toBe(written);
    expect(timesTheUserWrote(value, unit, text) >= 1).toBe(written);
  });

  it('a name, an ordinal or a quote is never a second writing; the user’s own words are', () => {
    expect(timesTheUserWrote(2, 'developers', 'We need two developers. We work with Two Developers Ltd.')).toBe(1);
    expect(timesTheUserWrote(70, 'tickets per week', 'Seventy tickets per week. Our manager said "seventy tickets per week".')).toBe(1);
    expect(timesTheUserWrote(70, 'tickets per week', 'Seventy tickets per week, so 70 tickets per week.')).toBe(2);
  });

  it('ONE unit check: with its unit word after it, a spelled figure reads exactly as its digits do (C4; never stricter)', () => {
    const pairs: [string, string, number, string][] = [
      ['Our team resolves seventy tickets per week.', 'Our team resolves 70 tickets per week.', 70, 'tickets per week'],
      ['It takes two hours per week.', 'It takes 2 hours per week.', 2, 'hours per week'],
      ['The wait is thirty-five minutes.', 'The wait is 35 minutes.', 35, 'minutes'],
      ['We pack fifteen bags per ten minutes.', 'We pack 15 bags per 10 minutes.', 15, 'food bags per 10 minutes'],
      ['We pack fifteen bags per ten minutes.', 'We pack 15 bags per ten minutes.', 15, 'food bags per 10 minutes'],
      // Presence only, as for digits: a figure of the same kind of unit is no attestation of which unit or period it is.
      ['The wait is thirty-five minutes.', 'The wait is 35 minutes.', 35, 'hours'],
      ['It takes two hours per week.', 'It takes 2 hours per week.', 2, 'hours per month'],
      ['About one customer in five leaves.', 'About 1 customer in 5 leaves.', 1, 'share of customers'],
    ];
    for (const [words, digits, v, unit] of pairs) {
      expect(figureTheUserWrote(v, unit, words), words).toBe(figureTheUserWrote(v, unit, digits));
      expect(figureTheUserWrote(v, unit, words), words).toBe(true);
    }
  });
});

/**
 * ⛔ A BRIEF'S BASELINE (Codex probe: "Hire three engineers" kept an unstated 3 enterprise customers as the user's): words never bypass
 * `baselineTheBriefStates`'s own binding (the words right after the figure must name this factor); digits are read first, as before.
 */
describe('a spelled baseline is the user’s only where the words after it name the factor', () => {
  const factor = (raw: number): Rec => ({ id: 'ent', kind: 'factor', label: 'Enterprise customers',
    observed_state: { value: raw / 100, raw_value: raw, unit: 'customers', source: 'brief_extraction' } });
  const sourceOf = (brief: string, raw: number): unknown => (withdrawUnstatedBaselineStamps([factor(raw)], brief)[0]!.observed_state as Rec).source;
  it.each([
    ['spelled, naming the factor', 'We serve three enterprise customers today.', 3, 'brief_extraction'],
    ['digits, naming the factor', 'We serve 3 enterprise customers today.', 3, 'brief_extraction'],
    ['spelled, another quantity', 'We plan to hire three engineers.', 3, 'cee_inference'],
    ['spelled ordinal', 'Our twenty-first enterprise customer signed today.', 20, 'cee_inference'],
  ] as const)('%s', (_n, brief, raw, source) => {
    expect(sourceOf(brief, raw)).toBe(source);
  });
});
