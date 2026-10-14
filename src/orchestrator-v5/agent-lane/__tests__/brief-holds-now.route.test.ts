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
import { briefHoldsNowArgs } from '../held-figure-confirm.js';
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
    // Served: his goal's 3 months count from the LAUNCH. True now does not show it holds then; no card is named, the real next step is.
    expect(asks(withQuote(SERVED).graph)).toEqual([`${READING} Whether it still holds during your goal’s period, which counts from the launch, `
      + 'is a separate question. Ask Olumi to suggest a starting estimate for you to review.']);
    const noPeriod = withQuote(SERVED); delete goalOf(noPeriod.graph).goal_target_basis;
    expect(asks(noPeriod.graph)).toEqual([`${READING} To use it in the analysis, your goal needs one clear time period first.`]);
    for (const b of [fromToday(withQuote(SERVED)), withQuote(SERVED), noPeriod]) expect(asks(b.graph).join(' ')).not.toMatch(/How likely|can’t run the numbers/);
    expect(asks(SERVED.graph).join(' ')).toContain(OCCURRENCE);
  });

  it('the route issues the holds-now card only over a window from today (its own gate, before the capability’s)', () => {
    expect(briefHoldsNowArgs(fromToday(withQuote(SERVED)).graph)).toEqual({ assumptions: [expect.objectContaining({ factor_label: LABEL, holds_now: { quote: SENTENCE } })] });
    expect(briefHoldsNowArgs(withQuote(SERVED).graph)).toBeUndefined();
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
async function route(w: ReturnType<typeof world>) {
  vi.stubEnv('AGENT_LANE_ENABLED', 'true'); vi.stubEnv('AGENT_LANE_PREVIEW', 'false');
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: { body?: string }) => {
    if (!String(url).includes('openai')) throw new Error(`Network forbidden: ${String(url)}`);
    const req = JSON.parse(String(init?.body ?? '{}')) as Rec;
    if (req.text?.format?.name === 'brief_spans') return new Response('{}', { status: 500 });
    return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'Here is your model.' }] }] }), { status: 200 });
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
    // S2-B's own card, quoting the message that holds his sentence.
    expect(String(cards[0]!.detail ?? cards[0]!.label)).toBe(`From your message: ‘${SERVED.brief_text}’ Do you want to record that ‘${LABEL}’ is already true now? `
      + 'How strongly it affects the model is a separate question, still Olumi’s placeholder on its link.');
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
    expect(asks(w.graph()).join(' ')).toContain(`${READING} Whether it still holds during your goal’s period, which counts from the launch`);
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
