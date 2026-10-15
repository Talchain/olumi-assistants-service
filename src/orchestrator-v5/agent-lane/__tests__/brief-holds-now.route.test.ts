/**
 * ⭐ S2 HOLDS NOW, FROM THE BRIEF (DL Fix A, 14 Oct; SCIENCE's marketing e2e on served CEE de659cfd,
 * `live/runs/2026-10-14T202102Z-marketing-e2e-de659cfd-ffb2b138`, judge rows 5–6): Paul's brief says "I'm not that experienced
 * with marketing", yet every turn asked "Is ‘Limited marketing experience’ already true now? If so, say so. If not: How likely is
 * ‘Limited marketing experience’ to happen at least once within 3 months?". The meaning was lost at the source: the drafter's
 * risk carried only a label. Now the drafter reads it (`already_true_evidence`, AI), admission keeps only a WHOLE brief sentence
 * (host check), readiness quotes it instead of the occurrence question, and the route offers S2-B's holds-now card: one press.
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
  getAdapter: () => { throw new Error('Providers forbidden in the holds-now route replay'); },
  getAdapterWithResolution: () => { throw new Error('Providers forbidden in the holds-now route replay'); }, getMaxTokensFromConfig: () => undefined,
}));
vi.mock('../../../orchestrator/user-identity.js', async original => ({ ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }) }));
import { createMockSessionStore, makeSessionTurnRow } from '../../../../tests/utils/mock-session-store.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { computeGraphIdentityHash } from '../../context/graph-identity.js';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
import { buildCanonicalAnalysisReadyFromGraph } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { doorAsks, doorIssueArgs } from '../../statement-door/door.js';
import { readStatement } from '../../statement-door/read.js';
import { approvedOf, RISK_HOLDS_NOW_ROW, windowHoldsAskOf } from '../../statement-door/fields/risk.js';
import { applyRiskOccurrenceEdit } from '../risk-occurrence.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import type { SessionTurnWithContent } from '../../session/conversation-content.js';
import type { CommittedTurnLedger } from '../../session/store.js';

type Rec = Record<string, any>;
const SERVED = (JSON.parse(readFileSync(new URL('./fixtures/marketing-e2e-de659cfd-read05-before.json', import.meta.url), 'utf8')) as Rec).body as Rec;
const RAW = JSON.parse(readFileSync(new URL('./fixtures/marketing-2992-drafter-raw-f81dfd89.json', import.meta.url), 'utf8')) as CandidateModel;
const RISK = 'limited_marketing_experience';
const LABEL = 'Limited marketing experience';
const SENTENCE = 'I can\'t spend more than 25% of my time on this, and I\'m not that experienced with marketing.';
const OCCURRENCE = 'How likely is ‘Limited marketing experience’ to happen at least once within 3 months?';
const ROUTE_MS = 60_000;
// AIE 6183711560's safe question.
const WINDOW_ASK = 'Do you expect ‘Limited marketing experience’ to hold at any point during your goal’s period, the first 3 months after the launch? '
  + 'Keep any timing or other qualifications in your answer.';
// AIE 6183711560's safe card for a plain yes: his forecast with its scope and window, then the derived occurrence as Olumi's reading.
const WINDOW_CARD = 'your forecast that ‘Limited marketing experience’ would hold at some point during your goal’s period, the first 3 months '
  + 'after the launch, with no qualifications in your answer';
const DERIVED = 'For this conditional reading, Olumi represents that condition as true at least once in the first 3 months after the launch: '
  + 'occurrence 100%. This is a derived reading of your forecast, not a numerical probability you stated. It does not establish persistence '
  + 'throughout the window or the condition’s effect.';
const DERIVED_BLOCK = { version: 1, occurrence: { p_low: 1, p_high: 1, meaning: 'at_least_once_within_horizon', basis: 'olumi' }, horizon: { months: 3 } };
const ANSWER = 'Yes, I’ll still be new to marketing then.';
const riskOf = (g: Rec): Rec => (g.nodes as Rec[]).find((n) => n.id === RISK)!;
/** The served model with the drafter's reading, as admission keeps it. */
const withQuote = (body: Rec, quote = SENTENCE): Rec => { const b = structuredClone(body); riskOf(b.graph).already_true_quote = quote; return b; };
/** The served goal counts its 3 months from the LAUNCH; this variant counts them from today (AIE 6178729504's licensed case). */
const fromToday = (body: Rec): Rec => { const b = structuredClone(body); goalOf(b.graph).goal_target_basis.reference = 'today'; return b; };
const goalOf = (g: Rec): Rec => (g.nodes as Rec[]).find((n) => n.kind === 'goal')!;
const READING = `Your brief says: “${SENTENCE}” Olumi reads this as ‘${LABEL}’ already being true now.`;
const asks = (g: Rec): string[] => (((buildCanonicalAnalysisReadyFromGraph(g) as Rec).readiness_issues ?? []) as Rec[])
  .filter((i) => i.code === 'MISSING_FACTOR_LEVEL' && i.factor_id === RISK).map((i) => i.message as string);

/** The drafter's candidate, with the risk as it would read it; `evidence` is its `already_true_evidence`. */
const candidate = (evidence: { quote: string } | null): CandidateModel => ({ ...structuredClone(RAW),
  risks: [...RAW.risks, { label: LABEL, provenance: 'explicit', unit: null, plausible_max: null, already_true_evidence: evidence }],
  links: [...RAW.links, { ...structuredClone(RAW.links[0]!), from: LABEL, to: RAW.goal.metric, direction: 'negative', effect_amount: null,
    effect_per_source_change: null, effect_provenance: null }] } as CandidateModel);
const admittedRisk = (evidence: { quote: string } | null): Rec | undefined =>
  admitCandidateModel(candidate(evidence), {}, SERVED.brief_text).nodes.find((n) => n.label === LABEL) as Rec | undefined;

describe('S2 holds now from the brief: the drafter reads it, admission keeps only a whole sentence', () => {
  it('PRECONDITION (served de659cfd): the risk carries no reading, and readiness asks its occurrence', () => {
    expect(riskOf(SERVED.graph)).toEqual({ id: RISK, ref: 'R4', kind: 'risk', label: LABEL, provenance: 'from_brief' });
    expect(SERVED.brief_text).toContain(SENTENCE);
    expect(asks(SERVED.graph).join(' ')).toContain(OCCURRENCE);
  });

  it('admission keeps the drafter\'s WHOLE brief sentence on the risk, and the saved node keeps it', () => {
    const node = admittedRisk({ quote: SENTENCE });
    expect(node, 'the risk is admitted').toBeDefined();
    expect(node!.already_true_quote).toBe(SENTENCE);
    const parsed = GraphV3.safeParse({ nodes: [{ id: RISK, kind: 'risk', label: LABEL, already_true_quote: SENTENCE }], edges: [] });
    expect(parsed.success && (parsed.data.nodes[0] as Rec).already_true_quote).toBe(SENTENCE);
  });

  it('CONTRASTS: a quote that is not a whole brief sentence, or none ("might happen"), keeps nothing', () => {
    expect(admittedRisk({ quote: 'I\'m not that experienced with marketing.' })).not.toHaveProperty('already_true_quote');
    expect(admittedRisk({ quote: 'We have never run a campaign.' })).not.toHaveProperty('already_true_quote');
    expect(admittedRisk(null)).not.toHaveProperty('already_true_quote');
  });

  it('readiness quotes his sentence as a current condition, never the occurrence question; the card is named only where it is offered', () => {
    // AIE 6178729504, exact, where the card is offered: a window from today.
    expect(asks(fromToday(withQuote(SERVED)).graph)).toEqual([`${READING} Confirm or change that reading on the card; how strongly it affects `
      + '‘New customers’ is a separate assumption.']);
    // Served: his goal's 3 months count from the LAUNCH. True now does not show it holds then; no card is named: he is asked ONE
    // question about that period (DL 15 Oct), whose answer alone is his forecast for it.
    expect(asks(withQuote(SERVED).graph)).toEqual([`${READING} ${WINDOW_ASK} Or ask Olumi to suggest a starting estimate for you to review.`]);
    const noPeriod = withQuote(SERVED); delete goalOf(noPeriod.graph).goal_target_basis;
    expect(asks(noPeriod.graph)).toEqual([`${READING} To use it in the analysis, your goal needs one clear time period first.`]);
    for (const b of [fromToday(withQuote(SERVED)), withQuote(SERVED), noPeriod]) expect(asks(b.graph).join(' ')).not.toMatch(/How likely|can’t run the numbers/);
    expect(asks(SERVED.graph).join(' ')).toContain(OCCURRENCE);
  });

  it('marketing 0dac5dcc (its ONE blocker is this risk): the holds-now card comes first, and its press lets the Run go (DL AMEND, AIE 6181498097)', () => {
    const at = (JSON.parse(readFileSync(new URL('./fixtures/marketing-e2e-0dac5dcc-read02-after-approve.json', import.meta.url), 'utf8')) as Rec).body as Rec;
    const g = fromToday(withQuote(at)).graph;
    // Never silently left out: his reading holds the Run until he confirms it, and its card is the route's first offer.
    expect((buildCanonicalAnalysisReadyFromGraph(g) as Rec).may_run).toBe(false);
    expect(doorIssueArgs(g, null, {}, { toolCalls: [], mutated: false, proposalOffered: false, heldWaiting: false }))
      .toEqual({ subject: { kind: 'risk', id: RISK, field: 'holds_now' }, quotes: [SENTENCE] });
    const subject = { kind: 'risk' as const, id: RISK, field: 'holds_now' as const };
    const v = readStatement(g, subject, LABEL, [SENTENCE], { now: String(at.brief_text) });
    expect(v.kind, JSON.stringify(v)).toBe('read');
    if (v.kind !== 'read') return;
    const w = RISK_HOLDS_NOW_ROW.writer.approve(v.reading, g);
    if ('refused' in w) throw new Error(w.refused);
    const written = applyRiskOccurrenceEdit(g, approvedOf(w.payload)!);
    if (written.kind !== 'mutated') throw new Error(JSON.stringify(written));
    expect(riskOf(written.mutatedGraph).event_risk.occurrence).toMatchObject({ p_low: 1, p_high: 1, basis: 'user' });
    expect((buildCanonicalAnalysisReadyFromGraph(written.mutatedGraph) as Rec).may_run).toBe(true);
  });

  it('the route issues the holds-now card only over a window from today (its own gate, before the capability’s)', () => {
    // SYSTEM 1 M1: the ONE door issuer, from the brief's own sentence the model holds for the risk.
    const turn = { toolCalls: [], mutated: false, proposalOffered: false, heldWaiting: false };
    expect(doorIssueArgs(fromToday(withQuote(SERVED)).graph, null, {}, turn)).toEqual({ subject: { kind: 'risk', id: RISK, field: 'holds_now' }, quotes: [SENTENCE] });
    expect(doorIssueArgs(withQuote(SERVED).graph, null, {}, turn)).toBeUndefined();
  });
});

/**
 * ⭐ THE LAUNCH PERIOD (DL 15 Oct, on SESSION4's miss: M1's marketing row ran on a from-today window): Paul's goal counts its 3 months
 * from the LAUNCH, so his "I'm not that experienced with marketing" (true NOW) is never read forward (AIE 6178729504). Readiness asks
 * ONE question about that period, and only his own plain yes to it is his forecast that it holds then. AIE 6183711560: that qualitative
 * forecast is never his number. The card shows Olumi's derived occurrence 100% before the press, and it is written as OLUMI'S block
 * (`basis: 'olumi'`) beside his record of what he said. A no, a hedge or a condition keeps his words and writes nothing.
 */
describe('the launch period: his answer to its ONE question is his forecast for it', () => {
  const holdsNow = { kind: 'risk' as const, id: RISK, field: 'holds_now' as const };
  // Served marketing de659cfd read 05: the goal's ONE period is the launch reading (3 months from the launch).
  const launch = withQuote(SERVED).graph as Rec;
  it('PRECONDITION: the served goal counts from the launch; readiness asks the question in the words the door binds', () => {
    expect(windowHoldsAskOf(launch, RISK)).toBe(WINDOW_ASK);
    expect(asks(launch).join(' ')).toContain(`${WINDOW_ASK} Or ask Olumi to suggest`);
    expect(asks(launch)).toHaveLength(1);
  });
  it('RED (marketing de659cfd, launch window): his yes to THAT question is his forecast; the write is Olumi’s derived block beside his words, and its ask is gone', () => {
    const v = readStatement(launch, holdsNow, LABEL, [{ quote: ANSWER, answering: WINDOW_ASK }], { now: ANSWER }, { asks: doorAsks(launch) });
    expect(v.kind, JSON.stringify(v)).toBe('read');
    if (v.kind !== 'read') return;
    expect(v.reading.statements[0]).toMatchObject({ form: 'holds_in_window', quote: ANSWER, answering: WINDOW_ASK });
    expect(v.reading.reading).toBe(WINDOW_CARD);
    expect(v.reading.assumptions[0]).toBe(DERIVED);
    const w = RISK_HOLDS_NOW_ROW.writer.approve(v.reading, launch);
    if ('refused' in w) throw new Error(w.refused);
    const written = applyRiskOccurrenceEdit(launch, approvedOf(w.payload)!);
    if (written.kind !== 'mutated') throw new Error(JSON.stringify(written));
    // AIE 6183711560: the 100% is Olumi's derived reading, never his number; his words are kept as his, with the question they answer.
    expect(riskOf(written.mutatedGraph).event_risk).toEqual(DERIVED_BLOCK);
    expect(riskOf(written.mutatedGraph).user_statements).toEqual([expect.objectContaining({ field: 'holds_now',
      statements: [expect.objectContaining({ form: 'holds_in_window', quote: ANSWER, answering: WINDOW_ASK })] })]);
    expect(asks(written.mutatedGraph)).toEqual([]);
  });
  it('CONTRAST: the writer refuses his forecast written as HIS block (basis user), and the from-today "now" written as Olumi’s', () => {
    const v = readStatement(launch, holdsNow, LABEL, [{ quote: ANSWER, answering: WINDOW_ASK }], { now: ANSWER }, { asks: doorAsks(launch) });
    if (v.kind !== 'read') throw new Error(JSON.stringify(v));
    const w = RISK_HOLDS_NOW_ROW.writer.approve(v.reading, launch);
    if ('refused' in w) throw new Error(w.refused);
    const asHis = { ...approvedOf(w.payload)!, event_risk: { ...DERIVED_BLOCK, occurrence: { ...DERIVED_BLOCK.occurrence, basis: 'user' } } };
    expect(applyRiskOccurrenceEdit(launch, asHis as never)).toEqual({ kind: 'refused', reason: 'invalid_block' });
    const today = fromToday(withQuote(SERVED)).graph as Rec;
    const nowRead = readStatement(today, holdsNow, LABEL, [SENTENCE], { now: String(SERVED.brief_text) });
    if (nowRead.kind !== 'read') throw new Error(JSON.stringify(nowRead));
    const nowWrite = RISK_HOLDS_NOW_ROW.writer.approve(nowRead.reading, today);
    if ('refused' in nowWrite) throw new Error(nowWrite.refused);
    expect(approvedOf(nowWrite.payload)!.event_risk.occurrence.basis, 'true NOW over a window from today stays his').toBe('user');
    expect(applyRiskOccurrenceEdit(today, { ...approvedOf(nowWrite.payload)!, event_risk: DERIVED_BLOCK } as never)).toEqual({ kind: 'refused', reason: 'invalid_block' });
  });
  it('CONTRAST (from today): there is no period question, so the same words "answering" it bind nothing and write nothing', () => {
    const today = fromToday(withQuote(SERVED)).graph as Rec;
    expect(windowHoldsAskOf(today, RISK)).toBeUndefined();
    const v = readStatement(today, holdsNow, LABEL, [{ quote: ANSWER, answering: WINDOW_ASK }], { now: ANSWER }, { asks: doorAsks(today) });
    expect(v.kind === 'read' && v.reading.statements[0]!.form === 'holds_in_window').toBe(false);
  });
  it('CONTRAST: "now" is never read forward: a holds-now statement NOT answering the question still writes nothing over the launch period', () => {
    const v = readStatement(launch, holdsNow, LABEL, [ANSWER], { now: ANSWER }, { asks: doorAsks(launch) });
    expect(v.kind).toBe('refused');
  });
  it('CONTRAST: a yes that names the risk but answers no question, or answers the NOW question, is never his forecast for the period', () => {
    const named = 'Yes, my limited marketing experience will still be the case then.';
    expect(readStatement(launch, holdsNow, LABEL, [named], { now: named }, { asks: doorAsks(launch) }).kind).toBe('refused');
    const nowAsk = `Is ‘${LABEL}’ already true now?`;
    expect(readStatement(launch, holdsNow, LABEL, [{ quote: 'Yes, it is.', answering: nowAsk }], { now: 'Yes, it is.' }, { asks: doorAsks(launch) }).kind).toBe('refused');
  });
  it.each(['No, I’ll have learnt a lot by then.', 'Probably, yes.', 'Yes, if we don’t hire an agency.', 'I’m not sure.', 'Not really.'])(
    'CONTRAST: “%s” keeps his words as his answer and writes nothing', (said) => {
      const v = readStatement(launch, holdsNow, LABEL, [{ quote: said, answering: WINDOW_ASK }], { now: said }, { asks: doorAsks(launch) });
      expect(v.kind, JSON.stringify(v)).toBe('refused');
      if (v.kind === 'refused') {
        expect(v.detail).toContain('is the user’s own answer: keep it as theirs, with its qualifications');
        // AIE 6183711560: its effect is a different quantity; never asked instead, nor an unconditional answer pressed for.
        expect(v.detail).not.toMatch(/affect that period/);
        expect(v.detail).toContain('Do not ask about its effect instead, and do not press for an unconditional answer.');
      }
    });
  it('the route issues the card from his typed answer only when Olumi’s preceding reply asked THAT question', () => {
    const turn = { toolCalls: [], mutated: false, proposalOffered: false, heldWaiting: false };
    expect(doorIssueArgs(launch, ANSWER, { preceding_ask: `Here is where things stand. ${WINDOW_ASK}` }, turn))
      .toEqual({ subject: holdsNow, quotes: [{ quote: ANSWER, answering: WINDOW_ASK }] });
    expect(doorIssueArgs(launch, ANSWER, {}, turn)).toBeUndefined();
    // Olumi's last reply asked something else: a yes answers THAT, never the period question.
    expect(doorIssueArgs(launch, ANSWER, { preceding_ask: 'Shall I suggest some risks you have not considered?' }, turn)).toBeUndefined();
    expect(doorIssueArgs(launch, 'No, I’ll have learnt a lot by then.', { preceding_ask: WINDOW_ASK }, turn)).toBeUndefined();
  });
});

/** The served read in a stateful store (the level door appends the graph; its read-back reads the committed facts). */
function world(body: Rec) {
  const sid = String(body.scenario_id);
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
      writes.push(JSON.parse(JSON.stringify(write)));
      if (write.graph !== undefined && write.graph !== null) bytes = JSON.stringify(write.graph);
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
const apps: FastifyInstance[] = [];
afterEach(async () => { for (const app of apps.splice(0)) await app.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
async function route(w: ReturnType<typeof world>, reply = 'Here is your model.') {
  vi.stubEnv('AGENT_LANE_ENABLED', 'true'); vi.stubEnv('AGENT_LANE_PREVIEW', 'false');
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: { body?: string }) => {
    if (!String(url).includes('openai')) throw new Error(`Network forbidden: ${String(url)}`);
    const req = JSON.parse(String(init?.body ?? '{}')) as Rec;
    if (req.text?.format?.name === 'brief_spans') return new Response('{}', { status: 500 });
    return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: reply }] }] }), { status: 200 });
  }));
  const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
  const app = Fastify({ logger: false }); apps.push(app);
  app.post('/assist/v1/scenarios/:id/graph', async () => w.graphWire());
  app.post('/assist/v1/scenarios/:id/versions', async () => ({ versions: [] }));
  await app.register(agentV1TurnRoute); await app.ready();
  return async (over: Rec): Promise<Rec> => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', turn_id: randomUUID(), scenario_id: w.sid, ...over } });
    expect(r.statusCode, r.body.slice(0, 2000)).toBe(200);
    return r.json() as Rec;
  };
}
const approvals = (body: Rec): Rec[] => ((body.suggested_actions ?? []) as Rec[]).filter((c) => String(c.id).startsWith('agent-approve'));
const graphWrites = (w: ReturnType<typeof world>) => w.writes.filter((x) => x.graph !== undefined && x.graph !== null).length;

describe('S2 holds now from the brief, on the real route: ONE card quoting his sentence, ONE press', () => {
  it('RED→GREEN: his typed brief → the holds-now card quoting it → the press → the risk holds now as HIS; its ask is gone', async () => {
    const w = world(fromToday(withQuote(SERVED)));
    const turn = await route(w);
    const said = await turn({ message: SERVED.brief_text, source: 'composer' });
    const cards = approvals(said);
    expect(cards, JSON.stringify(said.suggested_actions)).toHaveLength(1);
    // The ONE door's card (AIE 6181498097's template, 6178729504's reading), quoting the message that holds his sentence. Its write
    // adds Olumi's derivation (true now → at least once within a window from today), so its button is "Use this reading".
    expect(cards[0]).toMatchObject({ label: 'Use this reading', message: 'Yes, use this reading.' });
    const card = String(cards[0]!.detail);
    expect(card.startsWith('From your message: “')).toBe(true);
    expect(card).toContain(SENTENCE);
    expect(card).toContain(`Olumi proposes this reading: ‘${LABEL}’ already being true now. How strongly it affects ‘New customers’ is a separate assumption:`);
    expect(card.endsWith('Record this reading?')).toBe(true);
    expect(graphWrites(w), 'nothing before the press').toBe(0);
    const pressed = await turn({ message: cards[0]!.message, source: 'chip_click', chip: { id: cards[0]!.id } });
    expect((pressed._agent?.tool_calls as Rec[]).filter((c) => c.name === 'authorise_change'), JSON.stringify(pressed._agent?.tool_calls))
      .toEqual([expect.objectContaining({ ok: true, mutated: true })]);
    expect(graphWrites(w)).toBe(1);
    expect(riskOf(w.graph()).event_risk).toEqual({ version: 1, occurrence: { p_low: 1, p_high: 1, meaning: 'at_least_once_within_horizon', basis: 'user' }, horizon: { months: 3 } });
    expect(asks(w.graph())).toEqual([]);
  }, ROUTE_MS);

  it('AIE 6178729504: over a window counted from the LAUNCH (served), no card and no p = 1 write; his reading is still quoted', async () => {
    const w = world({ ...withQuote(SERVED), scenario_id: randomUUID() });
    const turn = await route(w);
    expect(approvals(await turn({ message: SERVED.brief_text, source: 'composer' }))).toEqual([]);
    expect(graphWrites(w)).toBe(0);
    expect(riskOf(w.graph())).not.toHaveProperty('event_risk');
    expect(asks(w.graph()).join(' ')).toContain(`${READING} ${WINDOW_ASK} Or ask Olumi to suggest a starting estimate for you to review.`);
  }, ROUTE_MS);

  it('RED→GREEN (launch period, DL 15 Oct; AIE 6183711560): the period question → his typed yes → ONE card showing Olumi’s derived 100% → the press → Olumi’s block beside his words', async () => {
    const w = world({ ...withQuote(SERVED), scenario_id: randomUUID() });
    // Olumi's reply asks readiness's ONE question about the period (the words the door binds an answer to).
    const turn = await route(w, `Here is your model. ${WINDOW_ASK}`);
    expect(asks(w.graph()).join(' '), 'readiness asks the period question').toContain(WINDOW_ASK);
    const first = await turn({ message: SERVED.brief_text, source: 'composer' });
    expect(approvals(first)).toEqual([]);
    expect(String(first.assistant_text)).toContain(WINDOW_ASK);
    const answered = await turn({ message: ANSWER, source: 'composer' });
    const cards = approvals(answered);
    expect(cards, JSON.stringify(answered.suggested_actions)).toHaveLength(1);
    expect(cards[0]).toMatchObject({ label: 'Use this reading', message: 'Yes, use this reading.' });
    // The derived number is SHOWN before the press.
    expect(String(cards[0]!.detail)).toContain(`From your message: “${ANSWER}” Olumi proposes this reading: ${WINDOW_CARD}. ${DERIVED}`);
    expect(graphWrites(w), 'nothing before the press').toBe(0);
    const pressed = await turn({ message: cards[0]!.message, source: 'chip_click', chip: { id: cards[0]!.id } });
    expect((pressed._agent?.tool_calls as Rec[]).filter((c) => c.name === 'authorise_change')).toEqual([expect.objectContaining({ ok: true, mutated: true })]);
    expect(riskOf(w.graph()).event_risk).toEqual(DERIVED_BLOCK);
    // The receipt keeps his forecast his and the 100% Olumi's.
    expect(JSON.stringify(pressed)).toContain('Recorded your forecast: ‘Limited marketing experience’ would hold at some point during your goal’s period, '
      + 'the first 3 months after the launch. Olumi uses it as occurrence 100% in that period, a derived reading, not a probability you stated.');
    expect(asks(w.graph())).toEqual([]);
  }, ROUTE_MS);

  it('CONTRAST: the same risk with no reading from the brief gets no card, and keeps the occurrence ask', async () => {
    const body = { ...structuredClone(SERVED), scenario_id: randomUUID() };
    const w = world(body);
    const turn = await route(w);
    expect(approvals(await turn({ message: SERVED.brief_text, source: 'composer' }))).toEqual([]);
    expect(graphWrites(w)).toBe(0);
    expect(asks(w.graph()).join(' ')).toContain(OCCURRENCE);
  }, ROUTE_MS);
});
