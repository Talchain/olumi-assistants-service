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
import { identityPartFiguresToIssue } from '../identity-card.js';
import { figuresWritten } from '../user-statements.js';
import { amountsWrittenIn } from '../stated-by-user.js';
import { sourceMapOf } from '../construction-source-map.js';
import { comparatorTheUserWrote, comparatorTheUserWroteFor, figureTheUserWrote, figureTheUserWroteFor, figureTheUserWroteSpan, timesTheUserWrote, withdrawUnstatedBaselineStamps } from '../stated-by-user.js';

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

  it('⛔ ANOTHER quantity ("seventy customers" for a tickets level) is no figure of it, in digits as in words: no card, nothing written', async () => {
    for (const typed of ['We now have 70 customers on the support plan; the team resolves the same as before.',
      'We now have seventy customers on the support plan; the team resolves the same as before.']) {
      const { result, chip, w } = await correct(typed, teamLevel(70));
      // The user wrote 70, for customers: nothing is proposed for the team and the Agent asks which they mean (Codex R6 on #3433:
      // the generic "origin unknown" refusal became the quantity-specific ask).
      expect(result, typed).toMatchObject({ ok: false, mutated: false, refusal: 'nothing_to_adopt' });
      expect(chip).toBeUndefined();
      expect(nodeOf(w.graph(), TEAM)).toEqual(nodeOf(SERVED.graph, TEAM));
    }
  }, 4 * ROUTE_MS);

  // DL-3 ruling on Codex R3 (#3433 @d3bcc80e): a labelled card that still WRITES a figure the user gave to something else (here
  // a company's name) is a wrong write. The one quantity-identity rule now governs the write: nothing is proposed for the team.
  it('= a name (Codex R2; the same with digits): never written as the team\'s figure, the same refusal in both forms', async () => {
    const digits = await correct('We signed with 70 TICKETS LTD this week.', teamLevel(70));
    const words = await correct('We signed with SEVENTY TICKETS LTD this week.', teamLevel(70));
    for (const r of [digits, words]) {
      expect(r.result, JSON.stringify(r.result)).toMatchObject({ ok: false, mutated: false, refusal: 'nothing_to_adopt' });
      expect(r.chip).toBeUndefined();
      expect(nodeOf(r.w.graph(), TEAM)).toEqual(nodeOf(SERVED.graph, TEAM));
    }
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

describe('another speaker’s quoted figure or an ordinal is never the user’s correction (real route)', () => {
  it.each([
    ['an ordinal after a compound (Codex BLOCK 628a1634: saved 100)', 'This is our one hundred first ticket this week.', 100],
    ['another speaker’s quoted words', 'Our manager said: \u201Cthe team resolves seventy tickets per week\u201D.', 70],
  ])('⛔ %s: the Agent’s figure has no human origin, no card, nothing written', async (_n, typed, value) => {
    const { result, chip, w } = await correct(typed, teamLevel(value));
    expect(result).toMatchObject({ ok: false, mutated: false, refusal: 'origin_unknown' });
    expect(chip).toBeUndefined();
    expect(nodeOf(w.graph(), TEAM)).toEqual(nodeOf(SERVED.graph, TEAM));
  }, 2 * ROUTE_MS);
});

/**
 * ⭐ THE ONE READER (DL-3 ruling on Codex #3429 R2): `amountsWrittenIn` locates every amount in digits or words, and `amountTheUserWrote`
 * is the ONE check for both forms. What only words need is whether a word is a number at all: it counts something (a word follows it
 * that is no phrase break), and it is no ordinal. Money and percentages in words stay unread (Codex R1). Presence only.
 */
describe('one reader, one check: a word is a number only where it counts something, then reads as its digits do', () => {
  it.each([
    ['a count with its unit', 70, 'tickets per week', 'Our team resolves seventy tickets per week.', true],
    ['a duration with its unit', 2, 'hours per week', 'It takes two hours per week.', true],
    ['the same period, said another way', 2, 'hours per week', 'It takes two hours a week.', true],
    ['a correction', 35, 'minutes', 'The wait is thirty-five minutes, not forty-five.', true],
    ['a sentence that opens with it', 2, 'developers', 'Two developers left last month.', true],
    ['after a colon', 70, 'tickets per week', 'Correction: Seventy tickets per week, not eighty.', true],
    ['C4: a spelled figure with a spelled period', 15, 'food bags per 10 minutes', 'We pack fifteen bags per ten minutes.', true],
    // the digit path's own check: the same figure, and no unit word of another kind ("2 weeks" is no count of people)
    ['another figure', 80, 'tickets per week', 'Our team resolves seventy tickets per week.', false],
    ['a unit word of another kind', 2, 'people per week', 'It took two weeks.', false],
    ['counts nothing: a phrase break after it', 2, 'hours per week', 'We have two of them.', false],
    ['counts nothing: punctuation after it (the old figure)', 12, 'minutes', 'It is thirty-five minutes, not twelve.', false],
    ['the pronoun "one"', 1, 'specialists', 'One of them was off sick, and the one who covered was new.', false],
    ['another kind of unit', 2, 'minutes', 'We hired two developers.', false],
    // a count's own counted noun (DL-3 on #3429): another noun is another quantity, in digits as in words
    ['another counted noun, words', 45, 'hours per week', 'Correction: forty-five nurses cover the night shifts.', false],
    ['another counted noun, digits', 45, 'hours per week', 'Correction: 45 nurses cover the night shifts.', false],
    ['another unit of its kind, digits', 35, 'hours', 'The wait is 35 minutes.', false],
    ['another count, digits', 70, 'tickets per week', 'Our team serves 70 customers per week.', false],
    ['the held noun, digits', 45, 'hours per week', 'Night shifts take 45 hours a week.', true],
    ['the held noun, words', 45, 'hours per week', 'Night shifts take forty-five hours per week.', true],
    ['the held noun after a modifier', 70, 'tickets per week', 'We now have seventy support tickets per week.', true],
    ['no noun after it: read as before, digits', 45, 'hours per week', 'Night shifts are 45 now.', true],
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
    ['an ordinal after "and"', 100, 'tickets per week', 'This is our one hundred and first ticket this week.', false],
    ['a hyphenated second', 20, 'tickets per week', 'This is our twenty-second ticket this week.', false],
    ['a spelled duration is still read', 20, 'seconds', 'Each check takes twenty seconds.', true],
    ['a hyphenated word after it is still read', 2, 'cars', 'We bought two second-hand cars.', true],
    // another speaker's quoted words
    ['double quotes', 70, 'tickets per week', 'Our manager said "we resolve seventy tickets per week" in the review.', false],
    ['curly quotes', 70, 'tickets per week', 'Our manager said: \u201Cwe resolve seventy tickets per week\u201D.', false],
    ['double quotes, digits', 70, 'tickets per week', 'Our manager said "we resolve 70 tickets per week" in the review.', false],
  ] as const)('%s', (_n, value, unit, text, written) => {
    expect(figureTheUserWrote(value, unit, text)).toBe(written);
    expect(timesTheUserWrote(value, unit, text) >= 1).toBe(written);
  });

  it('an ordinal or another speaker’s quote is never a second writing; the user’s own words are, in either form', () => {
    expect(timesTheUserWrote(20, 'tickets per week', 'Twenty tickets per week. It is our twenty-first week.')).toBe(1);
    expect(timesTheUserWrote(70, 'tickets per week', 'Seventy tickets per week. Our manager said "seventy tickets per week".')).toBe(1);
    expect(timesTheUserWrote(70, 'tickets per week', 'Seventy tickets per week. Our manager said "70 tickets per week".')).toBe(1);
    expect(timesTheUserWrote(70, 'tickets per week', 'Seventy tickets per week, so 70 tickets per week.')).toBe(2);
  });

  it('ONE unit check: with its unit word after it, a spelled figure reads exactly as its digits do (C4; never stricter)', () => {
    const pairs: [string, string, number, string][] = [
      ['Our team resolves seventy tickets per week.', 'Our team resolves 70 tickets per week.', 70, 'tickets per week'],
      ['It takes two hours per week.', 'It takes 2 hours per week.', 2, 'hours per week'],
      ['The wait is thirty-five minutes.', 'The wait is 35 minutes.', 35, 'minutes'],
      ['We pack fifteen bags per ten minutes.', 'We pack 15 bags per 10 minutes.', 15, 'food bags per 10 minutes'],
      ['We pack fifteen bags per ten minutes.', 'We pack 15 bags per ten minutes.', 15, 'food bags per 10 minutes'],
      // Presence only, as for digits: the held unit's own noun in another period is no attestation of which period it is.
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
 * ⭐ PARITY BY PROPERTY (DL-3 ruling 1): every phrase template × held unit × counted noun × modifier × period, written in words and in
 * digits, gives the same verdict at the same place; and a count whose noun names nothing of the held unit is never its figure (the
 * noun-mismatch property). Generated, so it is no list of examples; it must reach both verdicts.
 */
describe('parity by property: a spelled figure gives exactly its digits’ verdict and located value', () => {
  const NUMBERS: [number, string][] = [[2, 'two'], [15, 'fifteen'], [35, 'thirty-five'], [120, 'one hundred and twenty']];
  const UNITS = ['tickets per week', 'hours per week', 'minutes', 'food bags per 10 minutes', 'people', 'specialists per month'];
  const NOUNS = ['tickets', 'hours', 'minutes', 'bags', 'people', 'customers', 'weeks', 'nurses'];
  const MODIFIERS = ['', 'support ', 'food ', 'new '];
  const PERIODS: [string, string][] = [['', ''], [' per week', ' per week'], [' a month', ' a month'], [' per ten minutes', ' per 10 minutes']];
  const TEMPLATES = [(f: string) => `Correction: we handle ${f}, not more.`, (f: string) => `${f} today; the rest is unchanged.`,
    (f: string) => `We signed with ${f.toUpperCase()} LTD this week.`];
  it('same verdict and the same figure located, for every combination', () => {
    const seen = { written: 0, not: 0 };
    for (const [v, w] of NUMBERS) for (const unit of UNITS) for (const noun of NOUNS) for (const m of MODIFIERS) for (const [pw, pd] of PERIODS) for (const t of TEMPLATES) {
      const words = t(`${w} ${m}${noun}${pw}`), digits = t(`${v} ${m}${noun}${pd}`);
      const d = figureTheUserWroteSpan(v, unit, digits), x = figureTheUserWroteSpan(v, unit, words);
      expect(x !== null, `${unit} | ${words}`).toBe(d !== null);
      if (d !== null && x !== null) {
        expect(digits.slice(d.start, d.end)).toBe(String(v));
        expect(words.slice(x.start, x.end).toLowerCase()).toBe(w);
      }
      // The noun-mismatch property: a count whose own noun (with its modifier) names nothing of the held unit is never its figure,
      // unless the held unit is a headcount.
      const heldWords = unit.toLowerCase().match(/[a-z]{3,}/g)!.map((x) => x.replace(/s$/, ''));
      const headcount = unit === 'people'; // a headcount unit counts any phrase ("300 subscribers" are people)
      if (!headcount && ![noun, m.trim()].some((x) => x !== '' && heldWords.includes(x.toLowerCase().replace(/s$/, '')))) expect(d, `${unit} | ${digits}`).toBeNull();
      seen[d !== null ? 'written' : 'not'] += 1;
    }
    expect(seen.written).toBeGreaterThan(200);
    expect(seen.not).toBeGreaterThan(200);
  });
});

/**
 * ⛔ ONE SPEAKER RULE FOR EVERY READER (Codex #3429 R3: the identity card's bound-figure reader skipped it and saved a manager's quoted
 * 70 subscribers as "your figure"). `figureTheUserWroteFor`, which the identity, option and limit doors bind with, never reads another
 * speaker's quoted words either, in digits or words; the user's own words still bind.
 */
describe('the bound-figure reader keeps the one speaker rule', () => {
  const scope = { target: ['Paying subscribers'], others: ['Pro plan price', 'MRR'] };
  it.each([
    ['quoted, digits', 'Our manager said: \u201CPaying subscribers are 70 subscribers\u201D.', false],
    ['quoted, words', 'Our manager said: \u201CPaying subscribers are seventy subscribers\u201D.', false],
    // the binder's own word rule (a label word within two words of a spelled count) is unchanged
    ['the user’s own, digits', 'We have 70 paying subscribers today.', true],
    ['the user’s own, words', 'We have seventy paying subscribers today.', true],
    ['the same words quoted', 'Our manager said: \u201CWe have seventy paying subscribers today\u201D.', false],
  ] as const)('%s', (_n, text, bound) => {
    expect(figureTheUserWroteFor(70, 'subscribers', text, scope)).toBe(bound);
  });
});

/**
 * ⭐ ONE BINDING, BOTH FORMS (Codex #3427 R4 first loss: the user's own elliptical "it is forty-five hours per week" withdrew 40 but saved
 * no 45, while its digits saved 45; the words-only nearby-label branch). Generated: number × form × sentence × scope mode. A word amount
 * binds, named or unbound, exactly as its digits do; another entity named, another speaker's words, another counted noun, several
 * figures under the strict reader and a reader that requires a name all still refuse, in both forms.
 */
describe('parity by property: the bound reader binds a spelled figure exactly as its digits, named or unbound', () => {
  // Article forms bind exactly as their digits too (a fraction is no figure: words-read-whole-or-not.test.ts).
  const NUMBERS: [number, string][] = [[45, 'forty-five'], [45, 'forty five'], [12, 'twelve'], [120, 'one hundred and twenty'],
    [100, 'a hundred'], [120, 'a hundred and twenty']];
  const SENTENCES: [string, (f: string) => string, { plain: boolean; strict: boolean; named: boolean }][] = [
    ['elliptical', (f) => `It is ${f} hours per week.`, { plain: true, strict: true, named: false }],
    ['named', (f) => `Night shift is ${f} hours per week.`, { plain: true, strict: true, named: true }],
    ['another entity named', (f) => `Day shift is ${f} hours per week.`, { plain: false, strict: false, named: false }],
    ['another speaker', (f) => `Our lead said: "it is ${f} hours per week".`, { plain: false, strict: false, named: false }],
    ['another counted noun', (f) => `It is ${f} nurses.`, { plain: false, strict: false, named: false }],
    ['another counted noun, same rate', (f) => `It is ${f} emails per week.`, { plain: false, strict: false, named: false }],
    ['several figures, unnamed', (f) => `It is ${f} hours per week, not 30.`, { plain: true, strict: false, named: false }],
  ];
  const base = { target: ['Night shift hours'], others: ['Day shift hours'] };
  const MODES = [['plain', base], ['strict', { ...base, strict: true as const }], ['named', { ...base, requireNamed: true as const }]] as const;
  it('the same verdict in words and digits, and the rule\'s verdict, for every combination', () => {
    let bound = 0;
    for (const [v, w] of NUMBERS) for (const [name, say, expected] of SENTENCES) for (const [mode, scope] of MODES) {
      const words = figureTheUserWroteFor(v, 'hours per week', say(w), scope);
      expect(words, `${name} ${mode} | ${say(w)}`).toBe(figureTheUserWroteFor(v, 'hours per week', say(String(v)), scope));
      expect(words, `${name} ${mode} | ${say(w)}`).toBe(expected[mode]);
      if (words) bound += 1;
    }
    expect(bound).toBeGreaterThan(10);
  });
  /**
   * ⛔ ALIASES ARE THE SAME UNIT (Codex #3438 R1: "Night shift is 45 hrs per week" and "45 mins" bound on base and not on 3f82142f). The
   * counted noun is read through THE ONE UNIT VOCABULARY's spellings, in digits and words: every alias gives its canonical spelling's verdict.
   */
  it('alias template: hrs/hours, mins/minutes, wk/week and £k/thousand give the canonical spelling\'s verdict, named and unbound', () => {
    const ALIASES: [string, number, string, string[], { target: string[]; others: string[] }][] = [
      ['hours per week', 45, '45 hours per week', ['45 hrs per week', '45 hr per week', '45 hours per wk', '45 hrs a week', 'forty-five hrs per week'], base],
      ['minutes per day', 45, '45 minutes per day', ['45 mins per day', '45 min a day', '45 minutes a day', 'forty-five mins per day'], { target: ['Night shift handover time'], others: ['Day shift handover time'] }],
      ['£k', 45, '£45k', ['£45 thousand', '£45,000'], { target: ['Night shift cost'], others: ['Day shift cost'] }],
    ];
    let bound = 0;
    for (const [unit, v, canonical, forms, scope] of ALIASES) for (const say of [(f: string) => `Night shift is ${f}.`, (f: string) => `It is ${f}.`])
    for (const mode of [scope, { ...scope, strict: true as const }]) {
      const want = figureTheUserWroteFor(v, unit, say(canonical), mode);
      expect(want, `${unit} canonical | ${say(canonical)}`).toBe(true);
      for (const f of forms) { expect(figureTheUserWroteFor(v, unit, say(f), mode), `${unit} | ${say(f)}`).toBe(want); bound += 1; }
    }
    expect(bound).toBeGreaterThan(30);
    // Another quantity is still another, whatever its spelling: weeks are not hours, nurses are not hours.
    for (const text of ['It is 45 weeks.', 'It is 45 wks.', 'It is 45 nurses.']) expect(figureTheUserWroteFor(45, 'hours per week', text, base), text).toBe(false);
  });

  /**
   * ⛔ COMPOUND TEMPLATE (Codex #3438 R2: "a hundred and twenty" read 100, "half a million and fifty thousand" read 500000, both credited).
   * A compound is read whole or refused whole, at the one reader, the verifier's figure list and the shared check alike; a plain
   * cardinal keeps the grammar's own reading.
   */
  it('compound template: read whole or not at all; never a truncated prefix', () => {
    const words = (t: string): number[] => amountsWrittenIn(t).filter((a) => a.kind === 'words').map((a) => a.magnitude);
    const COMPOUNDS: [string, number[], number[]][] = [
      ['We sell a hundred and twenty tickets.', [120], [100, 20]],
      ['We sell a thousand and fifty tickets.', [1050], [1000, 50]],
      ['We have half a million and fifty thousand tickets.', [], [500000, 50000]],
      ['Revenue is two and a half million and fifty thousand pounds.', [], [2500000, 50000]],
      ['It takes three hours.', [3], []],
    ];
    for (const [text, whole, never] of COMPOUNDS) {
      expect(words(text), text).toEqual(whole);
      for (const v of never) {
        expect(figuresWritten(text).some((f) => f.low === v && f.high === v), `${text} figuresWritten ${v}`).toBe(false);
        expect(figureTheUserWrote(v, 'tickets', text), `${text} shared check ${v}`).toBe(false);
      }
    }
  });

  it('OWNER REVIEW (the article forms): the counted-noun, speaker and idiom guards hold for them too; a fraction is no figure', () => {
    expect(figureTheUserWroteFor(1000000, 'hours per week', 'We serve a million customers.', base), 'another counted noun').toBe(false);
    expect(figureTheUserWroteFor(120, 'hours per week', 'Our lead said: "it is a hundred and twenty hours per week".', base), 'another speaker').toBe(false);
    expect(figureTheUserWroteFor(100, 'hours per week', 'A hundred things could go wrong on the night shift.', base), 'idiom').toBe(false);
    expect(figureTheUserWroteFor(120, 'hours per week', 'It is a hundred and twenty hours per week.', base), 'control: the user\'s own').toBe(true);
    for (const v of [2, 2.5]) expect(figureTheUserWroteFor(v, 'hours per week', 'It is two and a half hours per week.', base), `fraction ${v}`).toBe(false);
  });
  it('a word that counts nothing, an idiom or an ordinal is never a figure (the word safeguards kept)', () => {
    for (const text of ['It is forty-five of them.', 'That is the forty-fifth hour this week.', 'One more thing: night shift hours matter.'])
      expect(figureTheUserWroteFor(45, 'hours per week', text, base) || figureTheUserWroteFor(1, 'hours per week', text, base), text).toBe(false);
  });
});

/**
 * ⭐ NO PARALLEL CARDINAL SCAN (Codex #3427 R4 SIMPLER): the verifier's figure list (`figuresWritten`) and its speech check
 * (`figureOnlyInSpeech`) read the one located-amount reader and the one speaker rule. An ordinal or a fraction is never a count there
 * either, and another speaker's quotation opening on the figure itself is theirs in digits exactly as in words.
 */
describe('the verifier reads the one reader: no ordinal count, and one speaker rule for both forms', () => {
  it('an ordinal or a fraction is never a figure the span writes; a cardinal in words or digits is', () => {
    const has = (q: string, v: number): boolean => figuresWritten(q).some((f) => f.low === v && f.high === v);
    expect(has('This is our one hundred first ticket.', 100)).toBe(false);
    expect(has('It closes on the twenty-first of May.', 20)).toBe(false);
    expect(has('We raised two and a half million.', 2)).toBe(false);
    expect(has('We resolve one hundred and twenty tickets.', 120)).toBe(true);
    expect(has('We resolve 120 tickets.', 120)).toBe(true);
  });
  it('another speaker\'s single-quoted figure is refused at the verifier in digits as in words; the user\'s own is verified', () => {
    const verdict = (sentence: string): string => {
      const st = { quote: sentence, subject: { kind: 'factor', label: 'Weekly tickets resolved', to_label: null, factor_label: null }, field: 'level',
        form: 'point', value: 70, low: null, high: null, unit: 'tickets per week', qualifier: null, conditions: null };
      const map = sourceMapOf([st], `${sentence} We need 90 tickets per week.`);
      return map.verified.size > 0 ? 'verified' : map.refused[0]?.refusal ?? 'none';
    };
    for (const f of ['70', 'seventy']) {
      expect(verdict(`Our lead said: '${f} tickets per week'.`), f).toBe('statement_not_found');
      expect(verdict(`I checked: ${f} tickets per week.`), f).toBe('verified');
    }
  });
});

/**
 * ⛔ SPEAKER OWNERSHIP, EVERY QUOTE STYLE, BOTH FORMS (Codex #3429 R3: "Our lead said: '70 tickets per week'" saved 70 while its word
 * twin refused). Generated: quote style × attribution × number, words and digits, quoted never the user's; the same words unquoted are.
 */
describe('parity by property: another speaker’s quoted figure is never the user’s, in any quote style or form', () => {
  const NUMBERS: [number, string][] = [[2, 'two'], [15, 'fifteen'], [70, 'seventy'], [120, 'one hundred and twenty']];
  const QUOTES: [string, string][] = [['"', '"'], ['\u201C', '\u201D'], ["'", "'"], ['\u2018', '\u2019']];
  const LEADS = ['Our lead said: ', 'Our lead said ', 'The report says: '];
  it('quoted: never written; unquoted: written; for every combination', () => {
    // The quotation may open on the figure itself ("'70 tickets per week'") or on a word before it.
    for (const [v, w] of NUMBERS) for (const [open, close] of QUOTES) for (const lead of LEADS) for (const f of [w, String(v)])
    for (const said of [`we resolve ${f} tickets per week`, `${f} tickets per week`]) {
      const quoted = `${lead}${open}${said}${close}; I have not checked it.`;
      expect(figureTheUserWrote(v, 'tickets per week', quoted), quoted).toBe(false);
      expect(figureTheUserWrote(v, 'tickets per week', `I checked: ${said}.`), said).toBe(true);
    }
  });
});

/**
 * ⛔ THE IDENTITY CARD READS THROUGH THE ONE READER AND CHECK (Codex #3429 R3: identity-card.ts:139 scanned for itself and saved a
 * manager's quoted figure as "your figure"). Served 828d87ac graph; the part figure is issued only from the user's own words. (A spelled
 * count here is held back by the bound reader's own word rule, a label word within two words, unchanged: this part's unit IS its label.)
 */
describe('identity part figures: the one reader and check, both forms', () => {
  type Graph = { nodes: Record<string, any>[] };
  const raw: Graph = JSON.parse(readFileSync(new URL('../../system-events/__tests__/fixtures/b1-828d87ac-stored-graph.json', import.meta.url), 'utf8'));
  const graph = structuredClone(raw);
  graph.nodes.find((n) => n.id === 'mrr')!.nonlinear_identity.stated_in_brief = false;
  const answer = (userText: string) => identityPartFiguresToIssue({ graph, userText, toolCalls: [], mutated: false, proposalOffered: false, pending: [] });
  const COUNT = { part_label: 'pro_paying_subscribers', value: 300, unit: 'Pro paying subscribers' };
  it.each([
    ['digits, the user’s own', 'We have 300 Pro subscribers', { parts: [COUNT] }],
    ['digits, a manager’s quoted words', 'Our manager said: \u201CWe have 300 Pro subscribers\u201D.', undefined],
    ['digits, single quotes', "Our manager said: 'We have 300 Pro subscribers'.", undefined],
    ['digits, single quotes opening on the figure', "Our manager said: '300 Pro subscribers'.", undefined],
  ] as const)('%s', (_n, text, issued) => {
    expect(answer(text)).toEqual(issued);
  });
});

/**
 * ⭐ THE COMPARATOR READERS USE THE ONE READER (lean core on 02837faf: "at least forty-five night shift hours per week" saved a plain
 * 45 while "at least 45 …" was refused). Generated: every comparator × number × noun phrase reads the same in words and digits.
 */
describe('parity by property: a comparator binds a spelled figure exactly as it binds its digits', () => {
  const NUMBERS: [number, string][] = [[2, 'two'], [15, 'fifteen'], [45, 'forty-five'], [120, 'one hundred and twenty']];
  const PHRASES = (f: string): string[] => [`at least ${f}`, `no more than ${f}`, `over ${f}`, `under ${f}`, `${f} or more`, `${f} or fewer`, `exactly ${f}`];
  const NOUNS = ['night shift hours per week', 'support tickets', 'people'];
  it('the lean core row: "at least forty-five night shift hours per week" is at least 45, as its digits are', () => {
    expect(comparatorTheUserWroteFor('We need at least forty-five night shift hours per week.', 45)).toBe('at_least');
    expect(comparatorTheUserWroteFor('We need at least 45 night shift hours per week.', 45)).toBe('at_least');
  });
  it('same comparator for every combination, whole-turn and per figure; the sweep reaches every comparator', () => {
    const seen = new Set<string | null>();
    for (const [v, w] of NUMBERS) for (const noun of NOUNS) {
      const words = PHRASES(`${w} ${noun}`), digits = PHRASES(`${v} ${noun}`);
      words.forEach((phrase, i) => {
        const wt = `We need ${phrase} next quarter.`, dt = `We need ${digits[i]} next quarter.`;
        expect(comparatorTheUserWroteFor(wt, v), wt).toBe(comparatorTheUserWroteFor(dt, v));
        expect(comparatorTheUserWrote(wt), wt).toBe(comparatorTheUserWrote(dt));
        seen.add(comparatorTheUserWroteFor(dt, v));
      });
    }
    expect([...seen].sort()).toEqual(['above', 'at_least', 'at_most', 'below', null].sort());
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
