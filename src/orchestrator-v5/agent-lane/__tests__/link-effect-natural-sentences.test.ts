/**
 * RT-6 step 3 / Science B1–B5: held-out natural sentences through the real consent/write door.
 * Request selection is resolved by RT-1 against getCanonicalState, never supplied in Agent args.
 * Only SessionStore I/O is replaced: the proposer, card, authoriser, in-process dispatch, canonical
 * writer, commit scope guard, strict schema readers and persistence projection are real.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockSessionStore, makeSessionTurnRow } from '../../../../tests/utils/mock-session-store.js';
import { GraphV3, NodeV3 } from '../../../schemas/cee-v3.js';
import { nodeUnitOf, olumiGuessedLink } from '../../../orchestrator/context/placeholder-parts.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { computeGraphIdentityHash } from '../../context/graph-identity.js';
import { targetTestabilityOf } from '../../admission/target-testability.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import type { SessionStore, SessionTurnWrite } from '../../session/store.js';
import { commitOptionLevelsInProcess, type CommitOptionLevelsInput } from '../../system-events/dispatch.js';
import { applyLinkEffectEdit, linkEffectEdgeToken, linkEffectReadingToken, type LinkEffectStatement } from '../../system-events/link-effect-edit.js';
import { prepareLinkEffectUnitReadings } from '../../system-events/link-effect-unit-reading.js';
import { linkEffectQuestionCarrier, LINK_EFFECT_QUESTION_WALL_TTL_MS } from '../link-effect-question.js';
import { parsePendingAction, type PendingAction } from '../../session/pending-action.js';
import { ProposalStore } from '../proposal.js';
import { approvalChipsFor, linkEffectReadingOf } from '../approval-chips.js';
import { findLinkEffectAmounts } from '../link-effect-figures.js';
import { agentSelectionContext } from '../selection-context.js';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import type { AgentToolContext } from '../runtime/agent-tools.js';

type Json = Record<string, any>;
type Selection = 'link' | 'nodes' | 'source_only' | 'wrong_link';
interface CorpusRow {
  id: string;
  fixture: 'f0eb03ac' | 'b8143909' | '96ea7439' | 'd39c05ba' | 'lift' | 'lift0';
  from: string;
  to: string;
  quote: string;
  effect: LinkEffectStatement;
  selection?: Selection;
  card?: string;
  ask?: string;
  /** An honest limit (the model's range, not the user's figure, stops it): said plainly, never a question about the figure. */
  limit?: string;
}
const SCENARIOS = { f0eb03ac: 'f0eb03ac-f6c6-4e68-9631-fa41d29d693f', b8143909: 'b8143909-9267-479e-ae3d-da8e19188427',
  // Acceptance's served reads on b644ddb (5 Oct): 96ea7439 (graph ba4fea4e) and d39c05ba (graph 3fe4a430).
  '96ea7439': '96ea7439-40a4-40d5-a89a-0508e50ec998', d39c05ba: 'd39c05ba-0000-4000-8000-000000000000',
  // Codex step-4 buddy r1's counterexample graph: café "Revenue" (GBP/month) beside a separate "Lift revenue".
  lift: '11f7c0de-0000-4000-8000-000000000001',
  // The same graph with café "Revenue" UNITLESS: the unit reader decides (step 4).
  lift0: '11f7c0de-0000-4000-8000-000000000002' } as const;
const TAIL = ' Approve, or correct.';
const wasteHead = 'Record: +1 percentage point on "Production waste rate" → −0.5 percentage points in "gross margin": raising "Production waste rate" by 1 percentage point lowers "gross margin" by 0.5 percentage points.';
const effect = (amount: number, amount_unit: string, per_source_change: number, per_source_change_unit: string): LinkEffectStatement => ({ amount, amount_unit, per_source_change, per_source_change_unit });
// Card expectations are literals, independent of the production formatter and its interpretation.
export const NATURAL_SENTENCE_ROWS: readonly CorpusRow[] = [
  { id: 'S1', fixture: 'f0eb03ac', from: 'production_waste_rate', to: 'gross_margin',
    quote: 'Each 1 percentage point rise in production waste rate cuts our gross margin by about 0.5 percentage points.',
    effect: effect(-0.5, 'percentage points', 1, 'percentage points'),
    card: wasteHead + ' From your words: "Each 1 percentage point rise in production waste rate cuts our gross margin by about 0.5 percentage points."' + TAIL },
  { id: 'S2', fixture: 'f0eb03ac', from: 'production_waste_rate', to: 'gross_margin',
    quote: 'Each 1 percentage point rise in production waste rate costs us about 0.5 percentage points of gross margin.',
    effect: effect(-0.5, 'percentage points', 1, 'percentage points'),
    card: wasteHead + ' From your words: "Each 1 percentage point rise in production waste rate costs us about 0.5 percentage points of gross margin."' + TAIL },
  { id: 'S3', fixture: 'f0eb03ac', from: 'production_waste_rate', to: 'gross_margin',
    quote: 'When Production waste rate rises by 1 percentage point, gross margin falls by about 0.5 percentage points.',
    effect: effect(-0.5, 'percentage points', 1, 'percentage points'),
    card: wasteHead + ' From your words: "When Production waste rate rises by 1 percentage point, gross margin falls by about 0.5 percentage points."' + TAIL },
  { id: 'S4', fixture: 'f0eb03ac', from: 'production_waste_rate', to: 'gross_margin',
    quote: 'Each 1 percentage point rise in production waste rate reduces gross margin by about 0.5 percentage points.',
    effect: effect(-0.5, 'percentage points', 1, 'percentage points'),
    card: wasteHead + ' From your words: "Each 1 percentage point rise in production waste rate reduces gross margin by about 0.5 percentage points."' + TAIL },
  { id: 'S5', fixture: 'f0eb03ac', from: 'monthly_wholesale_subscription_revenue', to: 'gross_margin',
    quote: 'Each 10% rise in monthly wholesale subscription revenue adds about 1 percentage point of gross margin.',
    effect: effect(1, 'percentage points', 10, '%'),
    ask: 'What GBP per month change in “Monthly wholesale subscription revenue” do you mean by 10%?' },
  { id: 'S6', fixture: 'f0eb03ac', from: 'subscribed_local_caf_s', to: 'monthly_wholesale_subscription_revenue',
    quote: 'Each additional subscribed local café raises monthly wholesale subscription revenue by about £400.',
    effect: effect(400, 'GBP per month', 1, 'cafés'),
    card: 'Record: +1 café on "Subscribed local cafés" → +£400/month in "Monthly wholesale subscription revenue": raising "Subscribed local cafés" by 1 café raises "Monthly wholesale subscription revenue" by £400/month. From your words: "Each additional subscribed local café raises monthly wholesale subscription revenue by about £400."' + TAIL },
  { id: 'F1', fixture: 'b8143909', from: 'bread_price_change', to: 'footfall',
    quote: "If we put bread prices up 10%, I'd expect footfall to drop by roughly 3%.",
    effect: effect(-3, '%', 10, '%'),
    ask: 'Is that a 10-point rise in “Bread price change” (say 10% → 20%), or 10% of today’s level; is that a 3-point fall in “Footfall” (say 13% → 10%), or 3% of today’s level?' },
  { id: 'F2', fixture: 'b8143909', from: 'staff_hours', to: 'gross_margin',
    quote: 'Cutting 100 staff hours a week would add about one and a half points to our gross margin.',
    effect: effect(1.5, 'points', -100, 'staff hours/week'),
    // D7 doctrine: the user's figure is not cut down and not questioned; the RANGE is named as what stops it.
    limit: 'Nothing was prepared: the user\'s figure is more than the analysis can represent on the range the model uses for "Staff hours"' },
  { id: 'F3', fixture: 'b8143909', from: 'production_waste_rate', to: 'gross_margin',
    quote: 'Halving waste from 8% to 4% would lift gross margin by about 2 points.',
    effect: effect(2, 'points', -4, 'percentage points'),
    card: 'Record: −4 percentage points on "Production waste rate" → +2 points in "gross margin": lowering "Production waste rate" by 4 percentage points raises "gross margin" by 2 points. Source change: 8% → 4% = −4 percentage points. From your words: "Halving waste from 8% to 4% would lift gross margin by about 2 points."' + TAIL },
  { id: 'F4', fixture: 'b8143909', from: 'bread_price_change', to: 'gross_margin',
    quote: 'A 5% price increase should be worth something like 3 to 4 points of margin to us.',
    effect: effect(3.5, 'points', 5, '%'),
    ask: 'What single change in “gross margin” do you mean, rather than a range?' },
  { id: 'F5', fixture: 'b8143909', from: 'caf_subscribers', to: 'wholesale_subscription_revenue', selection: 'link',
    quote: 'Every new café that signs up brings in around £250 a month.',
    effect: effect(250, 'GBP per month', 1, 'cafés'),
    card: 'Record: +1 café on "Café subscribers" → +£250/month in "Wholesale subscription revenue": raising "Café subscribers" by 1 café raises "Wholesale subscription revenue" by £250/month. From your words: "Every new café that signs up brings in around £250 a month." I\'ve taken "Wholesale subscription revenue" to be in GBP/month, from your words.' + TAIL },
  { id: 'F6', fixture: 'f0eb03ac', from: 'shops_operating', to: 'gross_margin',
    quote: 'Closing two shops would probably push gross margin up by about a point.',
    effect: effect(1, 'points', -2, 'shops'),
    card: 'Record: −2 shops on "Shops operating" → +1 point in "gross margin": lowering "Shops operating" by 2 shops raises "gross margin" by 1 point. From your words: "Closing two shops would probably push gross margin up by about a point."' + TAIL },
  { id: 'F7', fixture: 'f0eb03ac', from: 'wholesale_flour_cost_increase', to: 'gross_margin',
    quote: 'Every 10% jump in flour prices knocks roughly 4 points off our gross margin.',
    effect: effect(-4, 'points', 10, '% increase from prior year'),
    card: 'Record: +10 % increase from prior year on "Wholesale flour cost increase" → −4 points in "gross margin": raising "Wholesale flour cost increase" by 10 % increase from prior year lowers "gross margin" by 4 points. From your words: "Every 10% jump in flour prices knocks roughly 4 points off our gross margin."' + TAIL },
  // Acceptance's fresh corpus row 6 (#87 5999916809): staging @147c6630 cards it; step 3 must not regress it to a question.
  { id: 'A6', fixture: 'f0eb03ac', from: 'wholesale_flour_cost_increase', to: 'gross_margin',
    quote: 'A third of any flour price rise comes straight off our margin, so an 18% rise costs us about 6 points.',
    effect: effect(-6, 'percentage points', 18, '% increase from prior year'),
    card: 'Record: +18 % increase from prior year on "Wholesale flour cost increase" → −6 percentage points in "gross margin": raising "Wholesale flour cost increase" by 18 % increase from prior year lowers "gross margin" by 6 percentage points. From your words: "A third of any flour price rise comes straight off our margin, so an 18% rise costs us about 6 points."' + TAIL },
  { id: 'F8', fixture: 'f0eb03ac', from: 'central_kitchen_fit_out_cost', to: 'gross_margin',
    quote: 'Spending £250k on the central kitchen fit-out would cost us about 1.5 margin points this year.',
    effect: effect(-1.5, 'points', 250000, 'GBP'),
    card: 'Record: +£250,000 on "Central kitchen fit-out cost" → −1.5 points in "gross margin": raising "Central kitchen fit-out cost" by £250,000 lowers "gross margin" by 1.5 points. From your words: "Spending £250k on the central kitchen fit-out would cost us about 1.5 margin points this year."' + TAIL },
];
const nodeOf = (graph: Json, id: string): Json => graph.nodes.find((n: Json) => n.id === id)!;
const edgeOf = (graph: Json, row: Pick<CorpusRow, 'from' | 'to'>): Json => {
  const edges = graph.edges.filter((e: Json) => e.from === row.from && e.to === row.to);
  expect(edges, 'reload identifies the exact directed edge').toHaveLength(1);
  return edges[0]!;
};
const hashOf = (graph: unknown): string => computeAnalysisAffectingGraphHash(graph as never)!;
const ctxFor = (row: CorpusRow, words = row.quote): AgentToolContext => ({ scenario_id: SCENARIOS[row.fixture],
  authenticated_user_id: null, request_id: `rt6-natural-${row.id}`, user_text: words, user_turn_text: words });
const session = vi.hoisted(() => ({ store: undefined as SessionStore | undefined }));
vi.mock('../../session/index.js', async original => ({
  ...await original<typeof import('../../session/index.js')>(),
  getSessionStore: () => {
    if (session.store === undefined) throw new Error('No serialized RT-6 natural-sentence store selected');
    return session.store;
  },
}));
afterEach(() => { session.store = undefined; });

function fixture(row: CorpusRow): Json {
  const raw = JSON.parse(readFileSync(new URL(`./fixtures/rt6-graph-${row.fixture}.json`, import.meta.url), 'utf8'));
  return projectGraphForPersistence(GraphV3.parse(raw)) as Json;
}

/** JSON bytes are the store boundary. Every /graph read reparses and projects the stored bytes. */
function world(row: CorpusRow, initial = fixture(row), corruptReload?: 'reading' | 'direction' | 'strength', held?: () => readonly PendingAction[]) {
  let graphJson = JSON.stringify(initial);
  const proposals = new ProposalStore();
  const attempts: SessionTurnWrite[] = [];
  const rows: { id: string; write: SessionTurnWrite }[] = [];
  const commits: CommitOptionLevelsInput[] = [];
  const reads: string[] = [];
  const graph = (): Json => JSON.parse(graphJson);
  const store = createMockSessionStore({
    loadGraph: async () => graph(),
    loadGraphAndBriefText: async () => ({ graph: graph(), briefText: null }),
    readExistingScenario: async () => ({ userId: null, graph: graph(), briefText: null, analysisInvalidatedAt: null }),
    readMostRecentPendingActions: async () => [], readAnalysisInvalidatedAt: async () => null, getScenarioOwner: async () => null,
    append: async write => {
      const saved = JSON.parse(JSON.stringify(write)) as SessionTurnWrite;
      attempts.push(saved);
      const id = `rt6-natural-row-${rows.length + 1}`;
      rows.push({ id, write: saved });
      if (saved.graph !== undefined) graphJson = JSON.stringify(saved.graph);
      return { id };
    },
    readRecent: async () => rows.map(({ id, write }) => makeSessionTurnRow({ id, scenario_id: write.scenario_id,
      turn_id: write.turn_id, turn_class: write.turn_class, handler_id: write.handler_id,
      request_hash: write.request_hash, response_emitted: write.response_emitted,
      llm_calls_used: write.llm_calls_used, duration_ms: write.duration_ms })),
    readFactsWithTurnFor: async ids => rows.filter(r => ids.includes(r.id)).flatMap(({ id, write }) =>
      write.handler_facts.map(fact => ({ turn_id: id, fact_created_at: '2026-10-05T00:00:00.000Z', fact }))),
  });
  const dispatch: InternalDispatch = async path => {
    expect(path.endsWith('/graph')).toBe(true);
    reads.push(path);
    const stored = graph();
    if (attempts.length > 0 && corruptReload !== undefined) {
      const edge = edgeOf(stored, row);
      if (corruptReload === 'reading') delete edge.provenance.reading;
      if (corruptReload === 'direction') edge.effect_direction = 'negative';
      if (corruptReload === 'strength') edge.strength.mean *= -1;
    }
    const strict = GraphV3.parse({ ...stored, nodes: stored.nodes.map((n: Json) => NodeV3.parse(n)) });
    const reloaded = projectGraphForPersistence(strict);
    return { status: 200, json: { graph: reloaded, graph_hash: hashOf(reloaded),
      graph_identity_hash: computeGraphIdentityHash(reloaded as never) } };
  };
  return { caps: createAgentCapabilities(dispatch, proposals, undefined, 'full', undefined, {
    // The server's latest answer row (phase 2): only rows that pass a held list read one.
    ...(held !== undefined ? { readPendingActions: async () => held() } : {}),
    commitOptionLevels: async input => {
      commits.push(input);
      session.store = store;
      try { return await commitOptionLevelsInProcess(input, 'rt6-natural-real-door'); }
      finally { session.store = undefined; }
    },
  }), proposals, attempts, rows, commits, reads, graph };
}
type World = ReturnType<typeof world>;
const cardsFor = (w: World, result: Json) => approvalChipsFor([
  { name: 'propose_link_effect', ok: result.ok === true, mutated: false, ...(result.proposal_id === undefined ? {} : { proposal_id: String(result.proposal_id) }) },
], id => ({ proposal: w.proposals.get(id), result: result as never }));
async function propose(w: World, row: CorpusRow, selection: Selection | null | undefined = row.selection): Promise<Json> {
  const ctx = ctxFor(row);
  let grounded_selection;
  let grounded_links;
  if (selection !== undefined && selection !== null) {
    const requestSelection = selection === 'link' ? { node_ids: [], edge_ids: [`${row.from}→${row.to}`] }
      : selection === 'nodes' ? { node_ids: [row.from, row.to], edge_ids: [] }
        : selection === 'source_only' ? { node_ids: [row.from], edge_ids: [] }
          : { node_ids: [], edge_ids: ['subscription_price→wholesale_subscription_revenue'] };
    const state = await w.caps.getCanonicalState(ctx);
    const selected = agentSelectionContext(requestSelection, state);
    expect(selected).not.toBeNull();
    grounded_selection = selected!.grounded;
    grounded_links = selected!.links;
  }
  return await w.caps.proposeLinkEffect!({ ...ctx, ...(grounded_selection === undefined ? {} : { grounded_selection, grounded_links }) }, {
    from_label: nodeOf(w.graph(), row.from).label, to_label: nodeOf(w.graph(), row.to).label,
    ...row.effect, quote: row.quote,
  }) as Json;
}
const noWrite = (w: World, row: CorpusRow, before: Json): void => {
  expect(w.attempts).toEqual([]); expect(w.rows).toEqual([]); expect(w.commits).toEqual([]);
  expect(w.graph()).toEqual(before);
  expect(w.proposals.outstanding(SCENARIOS[row.fixture], null)).toEqual([]);
};
function oneQuestion(result: Json, expected: string): void {
  expect(result).toMatchObject({ ok: false, mutated: false });
  expect(result).not.toHaveProperty('proposal_id');
  expect(result.question, JSON.stringify(result)).toBe(expected);
  expect(String(result.detail)).toContain(expected);
  expect(String(result.question).match(/\?/g)).toHaveLength(1);
  // The existing canvas fallback quotes its inspector label verbatim. Its '?' is UI copy,
  // not a second question addressed to the user; keep that step-2 wording unchanged.
  expect(String(result.detail).replaceAll('How strong is this effect?', 'the inspector label').match(/\?/g)).toHaveLength(1);
  expect(String(result.detail)).not.toMatch(/rephrase|say it as one|statement naming both/i);
}

describe('RT-6 natural sentences: held-out B5 corpus', () => {
  for (const row of NATURAL_SENTENCE_ROWS) it(`${row.id}: ${row.quote}`, async () => {
    const w = world(row); const before = w.graph(); const result = await propose(w, row);
    if (row.limit !== undefined) {
      expect(result).toMatchObject({ ok: false, mutated: false, refusal: 'not_representable' });
      expect(String(result.detail)).toContain(row.limit);
      expect(String(result.detail)).toContain('never shrink it yourself');
      expect(String(result.detail)).not.toMatch(/rephrase|which part of the model/i);
      expect(cardsFor(w, result)).toEqual([]);
      noWrite(w, row, before);
      return;
    }
    if (row.ask !== undefined) {
      oneQuestion(result, row.ask);
      expect(cardsFor(w, result)).toEqual([]);
      noWrite(w, row, before);
      return;
    }
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true, mutated: false });
    const cards = cardsFor(w, result);
    expect(cards).toHaveLength(2);
    const card = cards[0]!;
    expect(card.detail).toBe(row.card);
    expect(card.message).toBe(`Yes — ${row.card}`);
    expect(w.attempts, 'offering a card grants no write').toEqual([]);
    expect(w.commits).toEqual([]); expect(w.graph()).toEqual(before);
    const approved = await w.caps.authoriseChange({ ...ctxFor(row, card.message), typed_approval_of: String(result.proposal_id),
      typed_approval_words: card.message }, { proposal_id: String(result.proposal_id) });
    expect(approved, JSON.stringify(approved)).toMatchObject({ ok: true, mutated: true, applied: true });
    expect(w.commits).toHaveLength(1); expect(w.attempts).toHaveLength(1); expect(w.rows).toHaveLength(1);
    const stored = w.graph();
    const reload = projectGraphForPersistence(GraphV3.parse({ ...stored, nodes: stored.nodes.map((n: Json) => NodeV3.parse(n)) })) as Json;
    const link = edgeOf(reload, row);
    expect(link.provenance).toMatchObject({ source: 'user_specified', magnitude: 'user_stated', source_quote: row.quote,
      reading: 'agent_proposed_user_confirmed', natural_effect: { amount: row.effect.amount, per_source_change: row.effect.per_source_change } });
    expect(link.provenance.natural_effect).not.toHaveProperty('reading');
    expect(olumiGuessedLink(link, nodeUnitOf(reload.nodes)), 'an approved card counts as user-sized for the licence').toBe(false);
    if (row.id === 'S1') {
      // Hold all other model content fixed and inspect this actual option → waste → margin path.
      // Before consent, P5 withholds the Olumi estimate; the approved reading satisfies the same licence.
      const path = (g: Json): Json => ({ ...g, edges: g.edges.filter((e: Json) =>
        (e.from === 'close_shops_and_centralise' && e.to === row.from) || (e.from === row.from && e.to === row.to)) });
      expect(targetTestabilityOf(path(before))).toMatchObject({ kind: 'not_testable',
        failures: expect.arrayContaining([expect.objectContaining({ precondition: 'P5' })]) });
      expect(targetTestabilityOf(path(reload))).toMatchObject({ kind: 'testable' });
    }
    const noReading = structuredClone(reload);
    delete edgeOf(noReading, row).provenance.reading;
    expect(hashOf(noReading), 'reading is outside the analysis hash').toBe(hashOf(reload));
    expect(computeGraphIdentityHash(noReading as never)?.value, 'reading participates in persisted identity').not.toBe(computeGraphIdentityHash(reload as never)?.value);
    const readsBefore = w.reads.length;
    const coldState = await w.caps.getCanonicalState(ctxFor(row));
    expect(coldState.ok).toBe(true);
    expect(w.reads.length).toBeGreaterThan(readsBefore);
    expect(w.reads.at(-1)).toContain('/graph');
    expect(edgeOf(w.graph(), row).provenance.reading).toBe('agent_proposed_user_confirmed');
    expect(w.proposals.outstanding(SCENARIOS[row.fixture], null)).toEqual([]);
  });
});

describe('RT-6 request selection, conservative statement controls and mutants', () => {
  const f5 = NATURAL_SENTENCE_ROWS.find(row => row.id === 'F5')!;
  it.each(['nodes', null, 'source_only', 'wrong_link'] as const)('F5 with selection %s: both REQUEST node ends bind; other selections ask which link once', async selection => {
    const w = world(f5); const before = w.graph(); const result = await propose(w, f5, selection);
    if (selection === 'nodes') {
      expect(result, JSON.stringify(result)).toMatchObject({ ok: true, mutated: false });
      expect(cardsFor(w, result)[0]?.detail).toBe(f5.card);
      expect(w.attempts).toEqual([]); expect(w.graph()).toEqual(before);
    } else {
      oneQuestion(result, 'Which link do you mean: “Café subscribers” → “Wholesale subscription revenue”?');
      expect(cardsFor(w, result)).toEqual([]); noWrite(w, f5, before);
    }
  });
  it.each([
    ['question', 'Does each 1 percentage point rise in production waste rate cut gross margin by 0.5 percentage points?'],
    ['denied', "Each 1 percentage point rise in production waste rate doesn't cut gross margin by 0.5 percentage points."],
  ])('%s remains a non-statement: no card and no write', async (_name, quote) => {
    const row = { ...NATURAL_SENTENCE_ROWS[0]!, quote: quote! };
    const w = world(row); const before = w.graph(); const result = await propose(w, row);
    expect(result).toMatchObject({ ok: false, mutated: false, why: _name });
    expect(cardsFor(w, result)).toEqual([]); noWrite(w, row, before);
  });
  it('M-sign: the wrong Agent sign is exposed in card WORDS and an explicit reversal before consent', async () => {
    const row = { ...NATURAL_SENTENCE_ROWS[0]!, effect: effect(0.5, 'percentage points', 1, 'percentage points') };
    const w = world(row); const before = w.graph(); const result = await propose(w, row);
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true, mutated: false });
    expect(cardsFor(w, result)[0]?.detail).toBe('REVERSAL: this changes the link from negative to positive. Record: +1 percentage point on "Production waste rate" → +0.5 percentage points in "gross margin": raising "Production waste rate" by 1 percentage point raises "gross margin" by 0.5 percentage points. From your words: "Each 1 percentage point rise in production waste rate cuts our gross margin by about 0.5 percentage points."' + TAIL);
    expect(w.attempts).toEqual([]); expect(w.graph()).toEqual(before);
  });
  it('M-bare: a literal bare source % on a % of output level asks once, even when the Agent calls it points', async () => {
    const row = { ...NATURAL_SENTENCE_ROWS[0]!, quote: 'Each 1% rise in production waste rate cuts gross margin by about 0.5 percentage points.' };
    const w = world(row); const before = w.graph(); const result = await propose(w, row);
    // Science F1: the example uses the user's own level (brief_extraction 12% of output), never a generic one.
    oneQuestion(result, 'Is that a 1-point rise in “Production waste rate” (12% → 13%), or 1% of today’s 12%, i.e. 12.12%?');
    expect(cardsFor(w, result)).toEqual([]); noWrite(w, row, before);
  });
  it('F1 on the served graph: when Bread price change\'s 0 is the USER\'s, only Footfall (Olumi\'s level) is asked', async () => {
    const row = NATURAL_SENTENCE_ROWS.find(r => r.id === 'F1')!;
    const initial = fixture(row);
    // Served b8143909 holds Olumi's 0 (cee_inference): the F1 row above asks about both ends. The user's own 0 settles one.
    expect(nodeOf(initial, 'bread_price_change').observed_state).toMatchObject({ raw_value: 0, source: 'cee_inference' });
    nodeOf(initial, 'bread_price_change').observed_state.source = 'brief_extraction';
    const w = world(row, initial); const before = w.graph(); const result = await propose(w, row);
    oneQuestion(result, 'Is that a 3-point fall in “Footfall” (say 13% → 10%), or 3% of today’s level?');
    expect(cardsFor(w, result)).toEqual([]); noWrite(w, row, before);
  });
  it('M-number: a target figure the user never wrote cannot yield a card', async () => {
    const row = { ...NATURAL_SENTENCE_ROWS[0]!, effect: effect(-0.7, 'percentage points', 1, 'percentage points') };
    const w = world(row); const before = w.graph(); const result = await propose(w, row);
    expect(result).toMatchObject({ ok: false, mutated: false, refusal: 'not_the_users_figure' });
    expect(cardsFor(w, result)).toEqual([]); noWrite(w, row, before);
  });
  it('one-sentence numbers: figures in different user sentences never combine into a card', async () => {
    const row = { ...NATURAL_SENTENCE_ROWS[0]!, quote: 'Production waste rate rises by 1 percentage point. Gross margin falls by 0.5 percentage points.' };
    const w = world(row); const before = w.graph(); const result = await propose(w, row);
    expect(result).toMatchObject({ ok: false, mutated: false, refusal: 'not_the_users_statement', why: 'not_one_statement' });
    expect(cardsFor(w, result)).toEqual([]); noWrite(w, row, before);
  });
  it.each([
    ['question', 'Does each 1 percentage point rise in production waste rate cut gross margin by 0.5 percentage points?', 'each 1 percentage point rise in production waste rate cut gross margin by 0.5 percentage points'],
    ['denied', "It doesn't mean each 1 percentage point rise in production waste rate cuts gross margin by 0.5 percentage points.", 'each 1 percentage point rise in production waste rate cuts gross margin by 0.5 percentage points'],
    // Codex buddy r1 HIGH: a colon or semicolon does not end the sentence that denies or asks.
    ['denied', 'I do not believe this claim: Each 1 percentage point rise in production waste rate cuts gross margin by 0.5 percentage points.', 'Each 1 percentage point rise in production waste rate cuts gross margin by 0.5 percentage points.'],
    ['question', 'Is this right; each 1 percentage point rise in production waste rate cuts gross margin by 0.5 percentage points.', 'each 1 percentage point rise in production waste rate cuts gross margin by 0.5 percentage points.'],
  ])('a quoted fragment cannot omit its original %s', async (why, words, quote) => {
    const row = { ...NATURAL_SENTENCE_ROWS[0]!, quote: words! };
    const w = world(row); const before = w.graph();
    const result = await w.caps.proposeLinkEffect!(ctxFor(row), { from_label: 'Production waste rate', to_label: 'gross margin',
      ...row.effect, quote }) as Json;
    expect(result).toMatchObject({ ok: false, mutated: false, why });
    expect(cardsFor(w, result)).toEqual([]); noWrite(w, row, before);
  });
  it.each([
    ['near-equal unwritten figure', NATURAL_SENTENCE_ROWS[0]!.quote, effect(-0.5000000001, 'points', 1, 'points')],
    ['single figure reused for both ends', 'Production waste rate changes by 1 point and gross margin responds.', effect(-1, 'points', 1, 'points')],
    ['unsupported fraction', 'Each two thirds of a point in production waste rate cuts gross margin by 0.5 points.', effect(-0.5, 'points', 2, 'points')],
    ['unsupported decimal words', 'Each one point five points of production waste rate cuts gross margin by 0.5 points.', effect(-0.5, 'points', 1, 'points')],
    ['transition endpoint reused as target figure', 'Halving waste from 8% to 4% lifts gross margin.', effect(4, 'points', -4, 'points')],
    ['a fraction after a number ("two" would read as 2)', 'Each 4 percentage point rise in production waste rate costs us two thirds of our gross margin.', effect(-2, 'points', 4, 'percentage points')],
    ['digits and a half (Codex r1 HIGH: 2 would be read)', 'Each 2 and a half percentage points rise in production waste rate cuts our gross margin by about 0.5 percentage points.', effect(-0.5, 'percentage points', 2, 'percentage points')],
    ['a vulgar fraction after digits ("2½")', 'Each 2½ percentage points rise in production waste rate cuts our gross margin by about 0.5 percentage points.', effect(-0.5, 'percentage points', 2, 'percentage points')],
    ['a fraction OF a written figure', 'Each 1 percentage point rise in production waste rate costs a third of 6 points of gross margin.', effect(-6, 'points', 1, 'percentage points')],
    ['half OF a written figure', 'Each 1 percentage point rise in production waste rate costs half of 0.5 percentage points of gross margin.', effect(-0.5, 'percentage points', 1, 'percentage points')],
    ['a fraction before a unit', 'Each 2 percentage point rise in production waste rate costs 1 and a quarter points of gross margin.', effect(-1, 'points', 2, 'percentage points')],
  ] as const)('%s never invents a user magnitude', async (_name, quote, proposed) => {
    const row = { ...NATURAL_SENTENCE_ROWS[0]!, quote, effect: proposed };
    const w = world(row); const before = w.graph(); const result = await propose(w, row);
    expect(result, JSON.stringify(result)).toMatchObject({ ok: false, mutated: false });
    expect(cardsFor(w, result)).toEqual([]); noWrite(w, row, before);
  });
  it('a denial in a DIFFERENT sentence does not touch the quoted one (the context is the quote\'s own sentence)', async () => {
    const row = NATURAL_SENTENCE_ROWS[0]!;
    const words = 'I don\'t think waste is our biggest issue. ' + row.quote;
    const w = world(row);
    const result = await w.caps.proposeLinkEffect!(ctxFor(row, words), { from_label: 'Production waste rate', to_label: 'gross margin',
      ...row.effect, quote: row.quote }) as Json;
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true, mutated: false });
    expect(cardsFor(w, result)[0]?.detail).toBe(row.card);
  });
  it.each([
    ['starts inside "11"', 'Each 11 percentage points rise in production waste rate cuts our gross margin by about 0.5 percentage points.',
      '1 percentage points rise in production waste rate cuts our gross margin by about 0.5 percentage points.', effect(-0.5, 'percentage points', 1, 'percentage points')],
    ['ends inside "0.55"', 'Each 1 percentage point rise in production waste rate cuts our gross margin by about 0.55 percentage points.',
      'Each 1 percentage point rise in production waste rate cuts our gross margin by about 0.5', effect(-0.5, 'percentage points', 1, 'percentage points')],
    ['ends before ".5" of "1.5"', 'Each 2 percentage point rise in production waste rate cuts our gross margin by about 1.5 percentage points.',
      'Each 2 percentage point rise in production waste rate cuts our gross margin by about 1', effect(-1, 'percentage points', 2, 'percentage points')],
  ] as const)('Codex r1 HIGH: a quote that %s is not the user\'s words, so no card', async (_name, words, quote, proposed) => {
    const row = NATURAL_SENTENCE_ROWS[0]!; const w = world(row); const before = w.graph();
    const result = await w.caps.proposeLinkEffect!(ctxFor(row, words), { from_label: 'Production waste rate', to_label: 'gross margin',
      ...proposed, quote }) as Json;
    expect(result).toMatchObject({ ok: false, mutated: false, refusal: 'quote_not_verbatim' });
    expect(cardsFor(w, result)).toEqual([]); noWrite(w, row, before);
  });
  it('Codex r1 P2: the card\'s exact figure is the stored one (no 6-significant-figure rounding of the user\'s number)', async () => {
    const quote = 'Each 1 percentage point rise in production waste rate cuts our gross margin by about 0.5000001 percentage points.';
    const row = { ...NATURAL_SENTENCE_ROWS[0]!, quote, effect: effect(-0.5000001, 'percentage points', 1, 'percentage points') };
    const w = world(row); const result = await propose(w, row);
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true, mutated: false });
    const card = cardsFor(w, result)[0]!;
    expect(card.detail).toContain('lowers "gross margin" by 0.5000001 percentage points');
    const approved = await w.caps.authoriseChange({ ...ctxFor(row, card.message), typed_approval_of: String(result.proposal_id),
      typed_approval_words: card.message }, { proposal_id: String(result.proposal_id) });
    expect(approved, JSON.stringify(approved)).toMatchObject({ ok: true, applied: true });
    expect(edgeOf(projectGraphForPersistence(GraphV3.parse(w.graph())) as Json, row).provenance.natural_effect)
      .toMatchObject({ amount: -0.5000001, per_source_change: 1 });
  });
  // Codex buddy r2 (final round), each counterexample verbatim. Café rows use S6's link; waste rows S1's.
  const s6 = NATURAL_SENTENCE_ROWS.find(row => row.id === 'S6')!;
  it.each([
    ['r2 HIGH: an implicit source change still checks the target ("which is £400 today")', s6,
      'Each additional subscribed local café raises monthly wholesale subscription revenue, which is £400 today.', s6.effect,
      'target_figure_a_level', 'Is £400 a change in “Monthly wholesale subscription revenue”, or its level today?'],
    ['r2 HIGH: ownership BEFORE the figure ("cuts net margin by 0.5")', NATURAL_SENTENCE_ROWS[0]!,
      'Each 1 percentage point rise in production waste rate cuts net margin by 0.5 percentage points while gross margin stays steady.', NATURAL_SENTENCE_ROWS[0]!.effect,
      'figure_of_another_quantity', 'Is 0.5 percentage points of net margin a change in “gross margin”?'],
    ['r2 HIGH: an adjective before the counted noun ("one additional small group of")', s6,
      'One additional small group of subscribed local cafés raises monthly wholesale subscription revenue by £400.', s6.effect,
      'figure_counts_another_unit', 'What change in “Subscribed local cafés” does “One” stand for?'],
  ] as const)('%s → ONE typed question, no card', async (_name, base, quote, proposed, why, question) => {
    const row = { ...base, quote, effect: proposed };
    const w = world(row); const before = w.graph(); const result = await propose(w, row);
    oneQuestion(result, question);
    expect(result.why).toBe(why);
    expect(cardsFor(w, result)).toEqual([]); noWrite(w, row, before);
  });
  it('r2 HIGH: a quote starting at the separator inside "1,500" is not the user\'s words', async () => {
    const words = 'Each 1,500 additional subscribed local cafés raises monthly wholesale subscription revenue by about £400.';
    const w = world(s6); const before = w.graph();
    const result = await w.caps.proposeLinkEffect!(ctxFor(s6, words), { from_label: 'Subscribed local cafés', to_label: 'Monthly wholesale subscription revenue',
      ...s6.effect, per_source_change: 500, quote: ',500 additional subscribed local cafés raises monthly wholesale subscription revenue by about £400.' }) as Json;
    expect(result).toMatchObject({ ok: false, mutated: false, refusal: 'quote_not_verbatim' });
    expect(cardsFor(w, result)).toEqual([]); noWrite(w, s6, before);
  });
  it('r2 P2: a time phrase is not another quantity ("… of gross margin this year" still cards)', async () => {
    const quote = 'Each 1 percentage point rise in production waste rate costs us about 0.5 percentage points of gross margin this year.';
    const row = { ...NATURAL_SENTENCE_ROWS[0]!, quote };
    const w = world(row); const result = await propose(w, row);
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true, mutated: false });
    expect(cardsFor(w, result)[0]?.detail).toBe(wasteHead + ` From your words: "${quote}"` + TAIL);
  });
  it('normalises supported number words deterministically with original spans', () => {
    for (const [words, value] of [['two', 2], ['one and a half points', 1.5], ['half a point', 0.5], ['about a point', 1]] as const) {
      const numbers = findLinkEffectAmounts(words);
      expect(numbers).toHaveLength(1); expect(numbers[0]!.magnitude).toBe(value);
      expect(words.slice(numbers[0]!.index, numbers[0]!.index + numbers[0]!.matchedText.length)).toBe(numbers[0]!.matchedText);
    }
  });
  it.each(['reading', 'direction', 'strength'] as const)('reload loses confirmed %s: never report a recorded reading', async corruption => {
    const row = { ...NATURAL_SENTENCE_ROWS[0]!, effect: effect(0.5, 'points', 1, 'points') };
    const w = world(row, fixture(row), corruption); const result = await propose(w, row);
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true, mutated: false });
    const card = cardsFor(w, result)[0]!;
    const approved = await w.caps.authoriseChange({ ...ctxFor(row, card.message), typed_approval_of: String(result.proposal_id),
      typed_approval_words: card.message }, { proposal_id: String(result.proposal_id) });
    expect(approved, JSON.stringify(approved)).toMatchObject({ ok: false, mutated: true, applied: false, refusal: 'not_verified' });
    expect(w.attempts).toHaveLength(1); expect(w.commits).toHaveLength(1);
    expect(w.proposals.outstanding(SCENARIOS[row.fixture], null)).toHaveLength(1);
  });
  it('B4 keeps every other provenance key, and drops Olumi\'s why and clamp marker, through approve → real commit → strict /graph reload', async () => {
    const row = NATURAL_SENTENCE_ROWS[0]!; const initial = fixture(row);
    const extras = { note: { held: 'untouched' } };
    // Olumi's reasoning and clamp marker describe Olumi's figure: never carried onto the user's (Review Desk; base strip).
    Object.assign(edgeOf(initial, row).provenance, extras, { reasoning: 'Olumi\'s explanation of its own estimate', clamped_from: 0.3, definitional: true });
    const w = world(row, initial); const result = await propose(w, row);
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true, mutated: false });
    const card = cardsFor(w, result)[0]!;
    const approved = await w.caps.authoriseChange({ ...ctxFor(row, card.message), typed_approval_of: String(result.proposal_id),
      typed_approval_words: card.message }, { proposal_id: String(result.proposal_id) });
    expect(approved, JSON.stringify(approved)).toMatchObject({ ok: true, mutated: true, applied: true });
    await w.caps.getCanonicalState(ctxFor(row));
    const reload = projectGraphForPersistence(GraphV3.parse(w.graph())) as Json;
    expect(edgeOf(reload, row).provenance).toMatchObject({ ...extras, reading: 'agent_proposed_user_confirmed', source_quote: row.quote });
    expect(edgeOf(reload, row).provenance).not.toHaveProperty('reasoning');
    expect(edgeOf(reload, row).provenance).not.toHaveProperty('clamped_from');
    expect(edgeOf(reload, row).provenance, 'Codex r1 P2: never a definition at the user\'s size').not.toHaveProperty('definitional');
  });
});

// ⭐ RT-6 STEP 4 (DL e8 5 Oct ~19:4xZ): shapes Acceptance's served witnesses hit on b644ddb, on their own served graphs.
describe('RT-6 step 4: a hyphenated end name and "raise <end> by N points" bind the unit the user wrote', () => {
  const coordination = { fixture: '96ea7439', from: 'team_coordination_overhead', to: 'feature_launch_delay_risk' } as const;
  const headcount = { fixture: 'd39c05ba', from: 'developer_headcount', to: 'onboarding_drag' } as const;
  const onboardingHead = 'Record: +2 developers on "Developer headcount" → +1 percentage point in "Onboarding drag": raising "Developer headcount" by 2 developers raises "Onboarding drag" by 1 percentage point.';
  const takenOnboarding = ' I\'ve taken "Onboarding drag" to be in %, from your words.';
  it.each([
    ['S4-H: "feature-launch delay risk" names "Feature-launch delay risk"', { ...coordination, id: 'S4-H',
      quote: 'Every 5 percentage points of team coordination overhead adds about 1 percentage point of feature-launch delay risk.',
      effect: effect(1, 'percentage points', 5, 'percentage points'),
      card: 'Record: +5 percentage points on "Team coordination overhead" → +1 percentage point in "Feature-launch delay risk": raising "Team coordination overhead" by 5 percentage points raises "Feature-launch delay risk" by 1 percentage point. From your words: "Every 5 percentage points of team coordination overhead adds about 1 percentage point of feature-launch delay risk." I\'ve taken "Feature-launch delay risk" to be in %, from your words.' + TAIL }],
    ['S4-H backward: "…, feature-launch delay risk rises by about 1 percentage point"', { ...coordination, id: 'S4-H2',
      quote: 'When team coordination overhead rises by 5 percentage points, feature-launch delay risk rises by about 1 percentage point.',
      effect: effect(1, 'percentage points', 5, 'percentage points'),
      card: 'Record: +5 percentage points on "Team coordination overhead" → +1 percentage point in "Feature-launch delay risk": raising "Team coordination overhead" by 5 percentage points raises "Feature-launch delay risk" by 1 percentage point. From your words: "When team coordination overhead rises by 5 percentage points, feature-launch delay risk rises by about 1 percentage point." I\'ve taken "Feature-launch delay risk" to be in %, from your words.' + TAIL }],
    ['S4-B: "raise onboarding drag by about 1 percentage point"', { ...headcount, id: 'S4-B1',
      quote: 'Each 2 more developers raise onboarding drag by about 1 percentage point.', effect: effect(1, 'percentage points', 2, 'developers'),
      card: onboardingHead + ' From your words: "Each 2 more developers raise onboarding drag by about 1 percentage point."' + takenOnboarding + TAIL }],
    ['S4-B: "increase onboarding drag by about 1 percentage point"', { ...headcount, id: 'S4-B2',
      quote: 'Each 2 additional developers increase onboarding drag by about 1 percentage point.', effect: effect(1, 'percentage points', 2, 'developers'),
      card: onboardingHead + ' From your words: "Each 2 additional developers increase onboarding drag by about 1 percentage point."' + takenOnboarding + TAIL }],
    ['CONTROL (cards before step 4): "…1 percentage point of onboarding drag"', { ...headcount, id: 'S4-C',
      quote: 'Every 2 extra developers add about 1 percentage point of onboarding drag.', effect: effect(1, 'percentage points', 2, 'developers'),
      card: onboardingHead + ' From your words: "Every 2 extra developers add about 1 percentage point of onboarding drag."' + takenOnboarding + TAIL }],
  ] as const)('%s → a card that takes the unit from the user\'s words', async (_n, row) => {
    const w = world(row as CorpusRow); const result = await propose(w, row as CorpusRow);
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true, mutated: false });
    expect(cardsFor(w, result)[0]?.detail).toBe(row.card);
  });
  it.each([
    ['S4-H hyphenated name', { ...coordination, id: 'S4-H', quote: 'Every 5 percentage points of team coordination overhead adds about 1 percentage point of feature-launch delay risk.',
      effect: effect(1, 'percentage points', 5, 'percentage points') }, 'feature_launch_delay_risk', '1 percentage point of feature-launch delay risk'],
    ['S4-H backward', { ...coordination, id: 'S4-H2', quote: 'When team coordination overhead rises by 5 percentage points, feature-launch delay risk rises by about 1 percentage point.',
      effect: effect(1, 'percentage points', 5, 'percentage points') }, 'feature_launch_delay_risk', 'feature-launch delay risk rises by about 1 percentage point'],
    ['S4-B "raise <end> by"', { ...headcount, id: 'S4-B1', quote: 'Each 2 more developers raise onboarding drag by about 1 percentage point.',
      effect: effect(1, 'percentage points', 2, 'developers') }, 'onboarding_drag', 'onboarding drag by about 1 percentage point'],
  ] as const)('%s: Approve → ONE real commit → strict reload keeps the link sized AND the end\'s unit reading from the user\'s own clause', async (_n, row, endId, clause) => {
    const w = world(row as CorpusRow); const result = await propose(w, row as CorpusRow);
    const card = cardsFor(w, result)[0]!;
    const approved = await w.caps.authoriseChange({ ...ctxFor(row as CorpusRow, card.message), typed_approval_of: String(result.proposal_id),
      typed_approval_words: card.message }, { proposal_id: String(result.proposal_id) });
    expect(approved, JSON.stringify(approved)).toMatchObject({ ok: true, mutated: true, applied: true });
    expect(w.commits).toHaveLength(1);
    const stored = w.graph();
    const reload = projectGraphForPersistence(GraphV3.parse({ ...stored, nodes: stored.nodes.map((n: Json) => NodeV3.parse(n)) })) as Json;
    expect(nodeOf(reload, endId).unit_reading).toEqual({ unit: '%', source: 'user_stated', source_quote: clause });
    expect(edgeOf(reload, row).provenance).toMatchObject({ source: 'user_specified', magnitude: 'user_stated', source_quote: row.quote,
      reading: 'agent_proposed_user_confirmed', natural_effect: { amount: 1, per_source_change: row.effect.per_source_change } });
  });
  it.each([
    ['a hyphen joins a name word to ANOTHER word ("launch-day delay risk")', { ...coordination, id: 'S4-Hx',
      quote: 'Every 5 percentage points of team coordination overhead adds about 1 percentage point of launch-day delay risk.',
      effect: effect(1, 'percentage points', 5, 'percentage points') }, 'Is 1 percentage point of launch-day delay risk a change in “Feature-launch delay risk”?'],
    ['only a HYPHEN joins name words: "feature/launch delay risk"', { ...coordination, id: 'S4-Hy',
      quote: 'Every 5 percentage points of team coordination overhead adds about 1 percentage point of feature/launch delay risk.',
      effect: effect(1, 'percentage points', 5, 'percentage points') }, 'What unit is the 1 change in “Feature-launch delay risk” stated in?'],
    ['"raise <another quantity> by 1 percentage point" ("onboarding costs")', { ...headcount, id: 'S4-Bx',
      quote: 'Each 2 more developers raise onboarding costs by about 1 percentage point.', effect: effect(1, 'percentage points', 2, 'developers') },
      'What unit is the 1 change in “Onboarding drag” stated in?'],
    ['Codex step-4 r1 HIGH: a hyphenated name\'s POSSESSIVE ("feature-launch delay risk\'s share of …")', { ...coordination, id: 'S4-Hp',
      quote: "Every 5 percentage points of team coordination overhead adds about 1 percentage point of feature-launch delay risk's share of total delivery risk.",
      effect: effect(1, 'percentage points', 5, 'percentage points') },
      'Is 1 percentage point of feature-launch delay risk\'s share of total delivery risk a change in “Feature-launch delay risk”?'],
    ['Codex step-4 r1 HIGH: "increase LIFT revenue" on a unitless café Revenue', { fixture: 'lift0', from: 'customers', to: 'revenue', id: 'S4-Bl',
      quote: 'Every 2 additional customers increase lift revenue by £100 per month.', effect: effect(100, 'GBP/month', 2, 'customers') },
      'Is £100 of lift revenue a change in “Revenue”?'],
    ['bare "point" on a unitless end stays asked (Science F1)', { ...headcount, id: 'S4-F1',
      quote: 'Every 2 extra developers add about 1 point of onboarding drag.', effect: effect(1, 'points', 2, 'developers') },
      'What unit is the 1 change in “Onboarding drag” stated in?'],
  ] as const)('NOT bound: %s → ONE typed question, nothing stored', async (_n, row, question) => {
    const w = world(row as CorpusRow); const before = w.graph(); const result = await propose(w, row as CorpusRow);
    oneQuestion(result, question); expect(cardsFor(w, result)).toEqual([]); noWrite(w, row as CorpusRow, before);
  });
});

describe('RT-6 step 4: the UNIT READER itself never takes a unit from another quantity\'s words (the writer re-runs it at commit)', () => {
  const read = (fixtureId: CorpusRow['fixture'], from: string, to: string, e: LinkEffectStatement, quote: string, change?: (g: Json) => void) => {
    const g = structuredClone(fixture({ fixture: fixtureId } as CorpusRow)); change?.(g);
    return prepareLinkEffectUnitReadings(projectGraphForPersistence(GraphV3.parse(g)), from, to, e, quote).unit_readings.filter(r => r.node_id === to);
  };
  const risks = (g: Json) => { g.nodes.find((n: Json) => n.id === 'feature_launch_delay_risk').label = 'Feature-launch delay risks'; };
  const priceIncrease = (g: Json) => {
    g.nodes.push({ id: 'price_increase', kind: 'factor', label: 'Price increase', category: 'controllable',
      observed_state: { value: 0, raw_value: 0, cap: 100, unit: '%', source: 'user_override' } });
    g.edges.push({ from: 'price_increase', to: 'revenue', strength: { mean: 0.5, std: 0.125 }, defaulted: true,
      provenance: { source: 'cee_hypothesis' }, effect_direction: 'positive', exists_probability: 0.8 });
  };
  it.each([
    ['Codex r2: a determiner before the modifier ("increase OUR lift revenue")', 'lift0', 'customers', 'revenue', effect(100, 'GBP/month', 2, 'customers'),
      'Every 2 additional customers increase our lift revenue by £100 per month.', undefined],
    ['Codex r2: a PLURAL possessive ("…delay risks’ share of …")', '96ea7439', 'team_coordination_overhead', 'feature_launch_delay_risk',
      effect(1, 'percentage points', 5, 'percentage points'),
      'Every 5 percentage points of team coordination overhead adds about 1 percentage point of feature-launch delay risks’ share of total delivery risk.', risks],
  ] as const)('NOT adopted: %s', (_n, fx, from, to, e, quote, change) => {
    expect(read(fx, from, to, e, quote, change)).toEqual([]);
  });
  it.each([
    ['Codex r2 P2: an inflected verb opens the phrase ("a price increase RAISES revenue")', 'lift0', 'price_increase', 'revenue',
      effect(100, 'GBP/month', 2, 'percentage points'), 'A 2 percentage point price increase raises revenue by £100 per month.', priceIncrease],
    ['Codex r2 P2: a relative clause\'s verb is not a modifier ("customers we add increase revenue")', 'lift0', 'customers', 'revenue',
      effect(100, 'GBP/month', 2, 'customers'), 'Every 2 customers we add increase revenue by £100 per month.', undefined],
  ] as const)('CONTROL adopted: %s', (_n, fx, from, to, e, quote, change) => {
    expect(read(fx, from, to, e, quote, change)).toEqual([{ node_id: to, unit_reading: { unit: 'GBP/month', source: 'user_stated', source_quote: 'revenue by £100 per month' } }]);
  });
  it.each([
    ['a possessive after the name ("…feature-launch delay risk\'s share of …")', '96ea7439', 'team_coordination_overhead', 'feature_launch_delay_risk',
      effect(1, 'percentage points', 5, 'percentage points'),
      "Every 5 percentage points of team coordination overhead adds about 1 percentage point of feature-launch delay risk's share of total delivery risk."],
    ['a movement word before a movement word ("increase LIFT revenue")', 'lift0', 'customers', 'revenue',
      effect(100, 'GBP/month', 2, 'customers'), 'Every 2 additional customers increase lift revenue by £100 per month.'],
  ] as const)('NOT adopted: %s', (_n, fx, from, to, e, quote) => {
    expect(read(fx, from, to, e, quote)).toEqual([]);
  });
  it.each([
    ['the hyphenated name itself', '96ea7439', 'team_coordination_overhead', 'feature_launch_delay_risk', effect(1, 'percentage points', 5, 'percentage points'),
      'Every 5 percentage points of team coordination overhead adds about 1 percentage point of feature-launch delay risk.', '%',
      '1 percentage point of feature-launch delay risk'],
    ['"customers increase revenue by £100" (the verb opens the phrase)', 'lift0', 'customers', 'revenue', effect(100, 'GBP/month', 2, 'customers'),
      'Every 2 additional customers increase revenue by £100 per month.', 'GBP/month', 'revenue by £100 per month'],
  ] as const)('CONTROL adopted: %s', (_n, fx, from, to, e, quote, unit, clause) => {
    expect(read(fx, from, to, e, quote)).toEqual([{ node_id: to, unit_reading: { unit, source: 'user_stated', source_quote: clause } }]);
  });
});

// ⛔ Codex step-4 buddy r1 (5 Oct ~20:1xZ): two shapes #2605's other-quantity guard let through as WRONG-reading cards.
describe('RT-6 step 3: a possessive or a modifier names ANOTHER quantity, never the end', () => {
  const headcount = { fixture: 'd39c05ba', from: 'developer_headcount', to: 'onboarding_drag' } as const;
  const resort = { fixture: 'lift', from: 'customers', to: 'revenue' } as const;
  it.each([
    ['a possessive continuation ("onboarding drag\'s share of total delivery risk")', { ...headcount, id: 'P-poss',
      quote: "Every 2 extra developers add about 1 percentage point of onboarding drag's share of total delivery risk.",
      effect: effect(1, 'percentage points', 2, 'developers') }, 'Is 1 percentage point of onboarding drag\'s share of total delivery risk a change in “Onboarding drag”?'],
    ['a modifier after the verb ("increase LIFT revenue", Revenue already in GBP/month)', { ...resort, id: 'P-lift',
      quote: 'Every 2 additional customers increase lift revenue by £100 per month.', effect: effect(100, 'GBP/month', 2, 'customers') }, 'Is £100 of lift revenue a change in “Revenue”?'],
  ] as const)('%s → ONE typed question, no card, nothing stored', async (_n, row, question) => {
    const w = world(row as CorpusRow); const before = w.graph(); const result = await propose(w, row as CorpusRow);
    oneQuestion(result, question); expect(cardsFor(w, result)).toEqual([]); noWrite(w, row as CorpusRow, before);
  });
  it.each([
    ['the end itself ("…of onboarding drag")', { ...headcount, id: 'C-poss', quote: 'Every 2 extra developers add about 1 percentage point of onboarding drag.',
      effect: effect(1, 'percentage points', 2, 'developers') }],
    ['no modifier ("increase revenue by £100")', { ...resort, id: 'C-lift', quote: 'Every 2 additional customers increase revenue by £100 per month.',
      effect: effect(100, 'GBP/month', 2, 'customers') }],
    ['a particle is not a modifier ("push up revenue by £100")', { ...resort, id: 'C-up', quote: 'Every 2 additional customers push up revenue by £100 per month.',
      effect: effect(100, 'GBP/month', 2, 'customers') }],
  ] as const)('CONTROL: %s still cards', async (_n, row) => {
    const w = world(row as CorpusRow); const result = await propose(w, row as CorpusRow);
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true, mutated: false });
    expect(cardsFor(w, result)[0]?.detail).toContain(`From your words: "${row.quote}"`);
  });
});

// ⛔ Codex step-4 buddy r2 (5 Oct ~20:4xZ, final round): the residual shapes of the same two classes, verbatim.
describe('RT-6 step 3 (Codex r2): determiner, plural and backward possessives name ANOTHER quantity; a clause\'s verb stays the verb', () => {
  const resort = { fixture: 'lift', from: 'customers', to: 'revenue' } as const;
  const per100 = effect(100, 'GBP/month', 2, 'customers');
  /** A served-graph twin with ONE change, re-projected through the persistence boundary. */
  const twin = (row: CorpusRow, change: (g: Json) => void): Json => {
    const g = structuredClone(fixture(row)); change(g); return projectGraphForPersistence(GraphV3.parse(g)) as Json;
  };
  const risks = (g: Json) => { g.nodes.find((n: Json) => n.id === 'feature_launch_delay_risk').label = 'Feature-launch delay risks'; };
  const priceIncrease = (g: Json) => {
    g.nodes.push({ id: 'price_increase', kind: 'factor', label: 'Price increase', category: 'controllable',
      observed_state: { value: 0, raw_value: 0, cap: 100, unit: '%', source: 'user_override' } });
    g.edges.push({ from: 'price_increase', to: 'revenue', strength: { mean: 0.5, std: 0.125 }, defaulted: true,
      provenance: { source: 'cee_hypothesis' }, effect_direction: 'positive', exists_probability: 0.8 });
  };
  it.each([
    ['a determiner before the modifier ("increase OUR lift revenue")', { ...resort, id: 'R2-det', quote: 'Every 2 additional customers increase our lift revenue by £100 per month.', effect: per100 },
      undefined, 'Is £100 of lift revenue a change in “Revenue”?'],
    ['a possessive BEFORE the figure ("increase revenue\'s tax by £100")', { ...resort, id: 'R2-back', quote: "Every 2 additional customers increase revenue's tax by £100 per month.", effect: per100 },
      undefined, 'Is £100 of revenue\'s tax a change in “Revenue”?'],
    ['a PLURAL possessive ("…delay risks’ share of total delivery risk")', { fixture: '96ea7439', from: 'team_coordination_overhead', to: 'feature_launch_delay_risk', id: 'R2-plural',
      quote: 'Every 5 percentage points of team coordination overhead adds about 1 percentage point of feature-launch delay risks’ share of total delivery risk.',
      effect: effect(1, 'percentage points', 5, 'percentage points') }, risks,
      'Is 1 percentage point of feature-launch delay risks’ share of total delivery risk a change in “Feature-launch delay risks”?'],
  ] as const)('%s → ONE typed question, no card, nothing stored', async (_n, row, change, question) => {
    const initial = change === undefined ? fixture(row as CorpusRow) : twin(row as CorpusRow, change);
    const w = world(row as CorpusRow, initial); const before = w.graph(); const result = await propose(w, row as CorpusRow);
    oneQuestion(result, question); expect(cardsFor(w, result)).toEqual([]); noWrite(w, row as CorpusRow, before);
  });
  it.each([
    ['a relative clause\'s verb is not a modifier ("customers we ADD increase revenue")', { ...resort, id: 'R2-rel',
      quote: 'Every 2 customers we add increase revenue by £100 per month.', effect: per100 }, undefined],
    ['an inflected verb is THE verb ("a price increase RAISES revenue")', { ...resort, from: 'price_increase', id: 'R2-infl',
      quote: 'A 2 percentage point price increase raises revenue by £100 per month.', effect: effect(100, 'GBP/month', 2, 'percentage points') }, priceIncrease],
  ] as const)('CONTROL (Codex r2 P2): %s still cards', async (_n, row, change) => {
    const initial = change === undefined ? fixture(row as CorpusRow) : twin(row as CorpusRow, change);
    const w = world(row as CorpusRow, initial); const result = await propose(w, row as CorpusRow);
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true, mutated: false });
    expect(cardsFor(w, result)[0]?.detail).toContain(`From your words: "${row.quote}"`);
  });
});

// ⛔ DL 0df0e1 ruling (5 Oct ~20:2xZ) on Acceptance 6001583510: Olumi suggested an exact wording and the recorder refused it
// 3/3. The chat never improvises a wording: a statement whose figures the recorder cannot read gets ONE fixed question, said
// exactly, WITH the canvas route that always works. Acceptance's own untyped rows 7 and 8, on their served f0eb03ac graph.
describe('RT-6: figures the recorder cannot read → ONE fixed question + the canvas route, never an improvised wording', () => {
  it.each([
    ['Acceptance row 7 ("a shop" / "half a margin point")', { id: 'A7', fixture: 'f0eb03ac', from: 'shops_operating', to: 'gross_margin',
      quote: 'Shutting a shop is worth maybe half a margin point, give or take.', effect: effect(0.5, 'percentage points', -1, 'shops') },
      'How much does “Shops operating” move “gross margin”, in figures?', ['Shops operating', 'gross margin']],
    ['Acceptance row 8 ("every extra percent")', { id: 'A8', fixture: 'f0eb03ac', from: 'bread_price_change_from_current', to: 'footfall_lost_from_price_rise',
      quote: 'Up to about a 5% price rise we barely lose anyone, but past that every extra percent costs us about 1% of footfall.', effect: effect(1, '%', 1, '%') },
      'How much does “Bread price change from current” move “Footfall lost from price rise”, in figures?', ['Bread price change from current', 'Footfall lost from price rise']],
  ] as const)('%s', async (_n, row, question, [from, to]) => {
    const w = world(row as CorpusRow); const before = w.graph(); const result = await propose(w, row as CorpusRow);
    oneQuestion(result, question);
    expect(result).toMatchObject({ refusal: 'not_the_users_figure' });
    expect(String(result.detail)).toMatch(/^Nothing was prepared\. Tell the user exactly this: "/);
    expect(String(result.detail)).toContain(`click the link from “${from}” to “${to}”, and under “How strong is this effect?”`);
    expect(String(result.detail)).not.toMatch(/Ask the user|in numbers/);
    expect(cardsFor(w, result)).toEqual([]); noWrite(w, row as CorpusRow, before);
  });
});

// ⭐ RT-6 S4-A PHASE 2 (design pd output/harness-github11/S4A-PHASE2-DESIGN.md): the question a one-word answer completes.
describe('RT-6 S4-A phase 2: the unit reader says WHICH end it asked about, as typed data', () => {
  const read = (fixtureId: CorpusRow['fixture'], from: string, to: string, e: LinkEffectStatement, quote: string) =>
    prepareLinkEffectUnitReadings(fixture({ fixture: fixtureId } as CorpusRow), from, to, e, quote);
  it('Acceptance C1 ("1 point of onboarding drag", unitless target) → asked_unit names the TARGET and its figure', () => {
    const r = read('d39c05ba', 'developer_headcount', 'onboarding_drag', effect(1, 'points', 2, 'developers'),
      'Every 2 extra developers add about 1 point of onboarding drag.');
    expect(r.ask).toBe('What unit is the 1 change in “Onboarding drag” stated in?');
    expect(r.asked_unit).toEqual([{ end: 'target', node_id: 'onboarding_drag', value: 1 }]);
  });
  it('CONTROL: a unit written in the sentence asks nothing, so nothing is asked about', () => {
    const r = read('d39c05ba', 'developer_headcount', 'onboarding_drag', effect(1, 'percentage points', 2, 'developers'),
      'Every 2 extra developers add about 1 percentage point of onboarding drag.');
    expect(r.ask).toBeUndefined(); expect(r.asked_unit).toBeUndefined();
  });
  it('a points-or-share question is NOT a unit question (its answer is not a unit)', () => {
    const r = read('96ea7439', 'team_coordination_overhead', 'feature_launch_delay_risk', effect(1, '%', 5, '%'),
      'Each 5% rise in team coordination overhead adds about 1% to feature-launch delay risk.');
    expect(r.ask).toMatch(/^Is that a 5-point rise in “Team coordination overhead”/);
    expect(r.asked_unit ?? []).not.toContainEqual(expect.objectContaining({ end: 'source' }));
  });
});

describe('RT-6 S4-A phase 2 (B): the refused proposal carries the server-held question, validated by the session reader', () => {
  const headcount = { fixture: 'd39c05ba', from: 'developer_headcount', to: 'onboarding_drag' } as const;
  const C1 = 'Every 2 extra developers add about 1 point of onboarding drag.';
  it('Acceptance C1 → ONE unit question AND a carrier that the strict reader parses, bound to this graph, 2 turns / 10 min', async () => {
    const row = { ...headcount, id: 'Q-C1', quote: C1, effect: effect(1, 'points', 2, 'developers') } as CorpusRow;
    const w = world(row); const before = w.graph(); const result = await propose(w, row);
    oneQuestion(result, 'What unit is the 1 change in “Onboarding drag” stated in?');
    const carrier = result.pending_action as Json;
    expect(parsePendingAction(JSON.parse(JSON.stringify(carrier))), 'the strict reader parses it').not.toBeNull();
    expect(carrier.chip_id).toBe(carrier.id); expect(carrier.id).toMatch(/^leq_[0-9a-f-]{36}$/);
    expect(carrier.action).toEqual({ kind: 'agent_link_effect_question', question: 'What unit is the 1 change in “Onboarding drag” stated in?',
      from_node_id: 'developer_headcount', to_node_id: 'onboarding_drag', from_label: 'Developer headcount', to_label: 'Onboarding drag',
      quote: C1, effect: { amount: 1, amount_unit: 'points', per_source_change: 2, per_source_change_unit: 'developers' }, asked_ends: ['target'] });
    const reloaded = projectGraphForPersistence(GraphV3.parse({ ...before, nodes: before.nodes.map((n: Json) => NodeV3.parse(n)) }));
    expect(carrier.preconditions).toEqual({ graph_hash: hashOf(reloaded) });
    expect(carrier.expires_at_turn_count).toBe(2);
    expect(Date.parse(carrier.expires_at_iso) - Date.parse(carrier.emitted_at_iso)).toBe(LINK_EFFECT_QUESTION_WALL_TTL_MS);
    noWrite(w, row, before);
  });
  it.each([
    ['a card (the unit is written)', { ...headcount, id: 'Q-card', quote: 'Every 2 extra developers add about 1 percentage point of onboarding drag.',
      effect: effect(1, 'percentage points', 2, 'developers') }],
    ['a points-or-share question (its answer is not a unit)', { fixture: '96ea7439', from: 'team_coordination_overhead', to: 'feature_launch_delay_risk', id: 'Q-u3',
      quote: 'Each 5% rise in team coordination overhead adds about 1% to feature-launch delay risk.', effect: effect(1, '%', 5, '%') }],
  ] as const)('CONTROL: %s carries no question', async (_n, row) => {
    const w = world(row as CorpusRow); const result = await propose(w, row as CorpusRow);
    expect(result).not.toHaveProperty('pending_action');
  });
  const base = { scenario_id: SCENARIOS.d39c05ba, question: 'What unit is the 1 change in “Onboarding drag” stated in?',
    from: { id: 'developer_headcount', label: 'Developer headcount' }, to: { id: 'onboarding_drag', label: 'Onboarding drag' }, quote: C1,
    effect: effect(1, 'points', 2, 'developers'), asked_unit: [{ end: 'target' as const, node_id: 'onboarding_drag', value: 1 }],
    graph_hash: '3fe4a430fb6b8cf7', emitted_at_iso: '2026-10-05T21:00:00.000Z' };
  it('CONTROL: the base input carries', () => { expect(linkEffectQuestionCarrier(base)).toBeDefined(); });
  it.each([
    ['both ends asked at once', { asked_unit: [{ end: 'source' as const, node_id: 'developer_headcount', value: 2 }, { end: 'target' as const, node_id: 'onboarding_drag', value: 1 }] }],
    ['the question is not the unit question for that end', { question: 'Is that a 1-point rise in “Onboarding drag” (say 10% → 11%), or 1% of today’s level?' }],
    ['the asked end is not this link\'s', { asked_unit: [{ end: 'target' as const, node_id: 'someone_else', value: 1 }] }],
    ['the session reader would refuse it (a 1001-character label)', { to: { id: 'onboarding_drag', label: 'D'.repeat(1001) },
      question: `What unit is the 1 change in “${'D'.repeat(1001)}” stated in?` }],
  ] as const)('NO carrier: %s', (_n, patch) => {
    expect(linkEffectQuestionCarrier({ ...base, ...patch } as never)).toBeUndefined();
  });
});

// ⭐ RT-6 S4-A PHASE 2 (D): Acceptance's C1 asked its unit; the user's NEXT reply is one or two words. Science d5 (5 Oct ~21:0xZ)
// ruled the card names BOTH readings and quotes the answer; DL e8 ruled the question is the server's, by id, never history.
describe('RT-6 S4-A phase 2 (D): a one-word unit answer completes the server-held question → card → Approve → reload', () => {
  const C1 = 'Every 2 extra developers add about 1 point of onboarding drag.';
  const row = { fixture: 'd39c05ba', from: 'developer_headcount', to: 'onboarding_drag', id: 'D-C1', quote: C1,
    effect: effect(1, 'points', 2, 'developers') } as CorpusRow;
  const QUESTION = 'What unit is the 1 change in “Onboarding drag” stated in?';
  const POINTS_CARD = 'Record: +2 developers on "Developer headcount" → +1 percentage point in "Onboarding drag": raising "Developer headcount" by 2 developers raises "Onboarding drag" by 1 percentage point.'
    + ' From your words: "Every 2 extra developers add about 1 point of onboarding drag."'
    + ' I\'ve taken "Onboarding drag" to be a percentage, and your "1 point" to mean 1 percentage point, from your answer "Percentage points".' + TAIL;
  /** Turn 1 asks; the carrier it returns is what the route persists (C). `patch` edits that held row. */
  async function asked(initial = fixture(row), patch: (c: Json) => Json = c => c, r: CorpusRow = row) {
    let held: PendingAction[] = [];
    const w = world(r, initial, undefined, () => held);
    const first = await propose(w, r);
    oneQuestion(first, QUESTION);
    held = [patch(JSON.parse(JSON.stringify(first.pending_action))) as PendingAction];
    return { w, carrier: first.pending_action as Json, setHeld: (h: PendingAction[]) => { held = h; } };
  }
  const answer = (w: World, words: string, message = words) =>
    w.caps.proposeLinkEffect!({ ...ctxFor(row, message), request_id: 'rt6-natural-D-answer' }, { unit_answer: words }) as Promise<Json>;
  async function approve(w: World, result: Json): Promise<Json> {
    const card = cardsFor(w, result)[0]!;
    return await w.caps.authoriseChange({ ...ctxFor(row, card.message), typed_approval_of: String(result.proposal_id),
      typed_approval_words: card.message }, { proposal_id: String(result.proposal_id) }) as Json;
  }

  it('"Percentage points." → the card names BOTH readings and quotes the answer → Approve → the strict reload holds the user\'s figure, unit from their answer', async () => {
    const { w } = await asked();
    const before = w.graph();
    const result = await answer(w, 'Percentage points.');
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true, mutated: false });
    expect(cardsFor(w, result)[0]!.message).toBe(`Yes — ${POINTS_CARD}`);
    expect(w.graph(), 'nothing is written before approval').toEqual(before);
    const approved = await approve(w, result);
    expect(approved, JSON.stringify(approved)).toMatchObject({ ok: true, mutated: true, applied: true });
    const reload = projectGraphForPersistence(GraphV3.parse(w.graph())) as Json;
    expect(nodeOf(reload, 'onboarding_drag').unit_reading).toEqual({ unit: '%', source: 'user_stated', source_quote: 'Percentage points' });
    expect(edgeOf(reload, row).provenance).toMatchObject({ source: 'user_specified', magnitude: 'user_stated',
      reading: 'agent_proposed_user_confirmed', source_quote: C1 });
  });

  it('the answered write IS the write of the same sentence with its unit written (edge and end, byte for byte but the quotes)', async () => {
    const { w } = await asked();
    const viaAnswer = await answer(w, 'Percentage points');
    expect(await approve(w, viaAnswer)).toMatchObject({ applied: true });
    const written = { ...row, id: 'D-written', quote: 'Every 2 extra developers add about 1 percentage point of onboarding drag.',
      effect: effect(1, 'percentage points', 2, 'developers') } as CorpusRow;
    const w2 = world(written);
    const direct = await propose(w2, written);
    expect(direct, JSON.stringify(direct)).toMatchObject({ ok: true });
    const card = cardsFor(w2, direct)[0]!;
    expect(await w2.caps.authoriseChange({ ...ctxFor(written, card.message), typed_approval_of: String(direct.proposal_id),
      typed_approval_words: card.message }, { proposal_id: String(direct.proposal_id) })).toMatchObject({ applied: true });
    const a = projectGraphForPersistence(GraphV3.parse(w.graph())) as Json;
    const b = projectGraphForPersistence(GraphV3.parse(w2.graph())) as Json;
    const { source_quote: qa, ...edgeA } = edgeOf(a, row).provenance; const { source_quote: qb, ...edgeB } = edgeOf(b, row).provenance;
    expect([qa, qb]).toEqual([C1, written.quote]);
    expect(edgeA).toEqual(edgeB);
    expect(edgeOf(a, row).strength).toEqual(edgeOf(b, row).strength);
    expect(nodeOf(a, 'onboarding_drag').unit_reading.unit).toBe(nodeOf(b, 'onboarding_drag').unit_reading.unit);
  });

  it('Science: a bare "%" answer is two readings → the points-or-share question (U3), no card, no unit question held', async () => {
    const { w } = await asked();
    const before = w.graph();
    const result = await answer(w, '%');
    oneQuestion(result, 'Is that a 1-point rise in “Onboarding drag” (say 10% → 11%), or 1% of today’s level?');
    expect(result).not.toHaveProperty('pending_action');
    noWrite(w, row, before);
  });

  it.each([['hours'], ['points'], ['pounds']])('"%s" is not a unit this end is read in → the SAME question again, held again; nothing prepared', async (words) => {
    const { w } = await asked();
    const before = w.graph();
    const result = await answer(w, words);
    oneQuestion(result, QUESTION);
    expect((result.pending_action as Json).action.question).toBe(QUESTION);
    noWrite(w, row, before);
  });

  it('a currency answer ("£") reaches exactly what the sentence with "£1" written reaches (here: the sizer\'s honest limit)', async () => {
    const { w } = await asked();
    const viaAnswer = await answer(w, '£');
    const written = { ...row, id: 'D-gbp', quote: 'Every 2 extra developers add about £1 of onboarding drag.', effect: effect(1, 'GBP', 2, 'developers') } as CorpusRow;
    const viaWritten = await propose(world(written), written);
    const pick = (r: Json) => ({ ok: r.ok, refusal: r.refusal, detail: r.detail });
    expect(viaWritten.ok, 'the control is the sizer\'s limit, not a question').toBe(false);
    expect(pick(viaAnswer)).toEqual(pick(viaWritten));
  });

  it('the card for a currency answer says the unit and quotes the answer', () => {
    const value = { from: 'developer_headcount', to: 'onboarding_drag', effect: effect(1, 'GBP', 2, 'developers'), quote: C1, edge_token: 't',
      unit_readings: [{ node_id: 'onboarding_drag', unit_reading: { unit: 'GBP', source: 'user_stated', source_quote: '£' }, answer: true }] };
    const proposal = { operations: [{ op: 'set_link_effect', path: 'developer_headcount::onboarding_drag', value }] } as never;
    expect(linkEffectReadingOf(proposal, { from: 'Developer headcount', to: 'Onboarding drag' }))
      .toMatch(/ From your words: "Every 2 extra developers add about 1 point of onboarding drag\." I've taken "Onboarding drag" to be in GBP, from your answer "£"\. Approve, or correct\.$/);
    const unflagged = { ...value, unit_readings: [{ ...value.unit_readings[0]!, answer: undefined }].map(({ answer: _a, ...r }) => r) };
    expect(linkEffectReadingOf({ operations: [{ op: 'set_link_effect', path: 'x', value: unflagged }] } as never,
      { from: 'Developer headcount', to: 'Onboarding drag' }), 'CONTROL: a sentence reading must quote the sentence').toBeUndefined();
    const two = { ...value, unit_readings: [{ ...value.unit_readings[0]!, node_id: 'developer_headcount' }, value.unit_readings[0]!] };
    expect(linkEffectReadingOf({ operations: [{ op: 'set_link_effect', path: 'x', value: two }] } as never,
      { from: 'Developer headcount', to: 'Onboarding drag' }), 'two answers are never one card').toBeUndefined();
  });

  it.each([
    ['the answer is not in THIS message', 'unit_answer_not_verbatim', (_c: Json) => _c, 'Percentage points', 'Could you size it for me instead?'],
    ['no question is held', 'no_unit_question', null, 'Percentage points', 'Percentage points'],
    ['the held question expired (10 minutes)', 'no_unit_question', (c: Json) => ({ ...c, expires_at_iso: '2026-10-05T00:00:00.000Z' }), 'Percentage points', 'Percentage points'],
    ['the held question is another scenario\'s', 'no_unit_question', (c: Json) => ({ ...c, scenario_id: 'someone-elses-scenario' }), 'Percentage points', 'Percentage points'],
    ['the model moved after it was asked', 'model_changed_since_question', (c: Json) => ({ ...c, preconditions: { graph_hash: 'moved' } }), 'Percentage points', 'Percentage points'],
    ['the held figure is not one the user wrote (a corrupt row: 5, not 1)', 'not_the_users_statement',
      (c: Json) => ({ ...c, action: { ...c.action, effect: { ...c.action.effect, amount: 5 } } }), 'Percentage points', 'Percentage points'],
  ] as const)('REFUSED, nothing prepared: %s', async (_n, refusal, patch, words, message) => {
    const { w, setHeld } = await asked(undefined, patch ?? (c => c));
    if (patch === null) setHeld([]);
    const before = w.graph();
    const result = await answer(w, words, message);
    expect(result, JSON.stringify(result)).toMatchObject({ ok: false, mutated: false, refusal });
    expect(result).not.toHaveProperty('proposal_id');
    noWrite(w, row, before);
  });

  // Science's third row ("typed-zero bare % → card, no question"): a held unit question cannot exist for an end holding the
  // user's own level (U1 never asks a unit beside a level), so there is no answer to complete; the sentence itself decides.
  it.each([
    ['a typed 0 with no unit → the canvas route, no question held', { value: 0, source: 'user_override' }, false],
    ['a typed 0% → the card at once (F1 points), no question', { value: 0, raw_value: 0, cap: 100, unit: '%', source: 'user_override' }, true],
  ] as const)('Science typed zero: %s', async (_n, observed, cards) => {
    const initial = fixture(row); nodeOf(initial, 'onboarding_drag').observed_state = observed;
    const w = world(row, projectGraphForPersistence(GraphV3.parse(initial)) as Json);
    const result = await propose(w, row);
    expect(result.ok, JSON.stringify(result)).toBe(cards);
    expect(result).not.toHaveProperty('pending_action');
    expect(result).not.toHaveProperty('question');
  });

  it('an end another link already sizes in hours never becomes a % from the answer (U1): the question stands', async () => {
    const initial = fixture(row);
    initial.edges.push({ ...JSON.parse(JSON.stringify(edgeOf(initial, row))), from: 'team_size_other', to: 'onboarding_drag',
      provenance: { source: 'user_specified', magnitude: 'user_stated', natural_effect: { amount: 3, amount_unit: 'hours', per_source_change: 1,
        per_source_change_unit: 'developers', strength_mean: 0.5, strength_mean_frame: 'edge_strength' } } });
    initial.nodes.push({ id: 'team_size_other', kind: 'factor', label: 'Contractor headcount' });
    // The Agent's own (wrong) unit guess matches the other link, so the sentence alone still asks its unit.
    const { w } = await asked(projectGraphForPersistence(GraphV3.parse(initial)) as Json, undefined, { ...row, effect: effect(1, 'hours', 2, 'developers') });
    const before = w.graph();
    const result = await answer(w, 'Percentage points');
    oneQuestion(result, QUESTION);
    noWrite(w, row, before);
  });
});

describe('RT-6 S4-A phase 2 (D): the WRITER re-derives an answered unit; a forged one writes nothing', () => {
  const C1 = 'Every 2 extra developers add about 1 point of onboarding drag.';
  const g = () => fixture({ fixture: 'd39c05ba' } as CorpusRow);
  const answered = (words: string, node_id = 'onboarding_drag') =>
    ({ node_id, unit_reading: { unit: '%', source: 'user_stated' as const, source_quote: words }, answer: true as const });
  const write = (quote: string, e: LinkEffectStatement, unit_readings: readonly Json[]) => {
    const graph = g();
    return applyLinkEffectEdit({ persistedGraph: graph, from: 'developer_headcount', to: 'onboarding_drag', effect: e, quote,
      unit_readings: unit_readings as never, expected: { graph_hash: hashOf(graph), edge_token: linkEffectEdgeToken(graph, 'developer_headcount', 'onboarding_drag')! },
      reading_token: linkEffectReadingToken({ from: 'developer_headcount', to: 'onboarding_drag', effect: e, quote, unit_readings: unit_readings as never }) });
  };
  const pp = effect(1, 'percentage points', 2, 'developers');
  it('CONTROL: the honest answered reading writes', () => {
    expect(write(C1, pp, [answered('Percentage points')]).kind).toBe('mutated');
  });
  it('a quote that asks a SECOND question too (the source\'s points-or-share) is never completed by one unit answer', () => {
    const graph = g();
    nodeOf(graph, 'developer_headcount').observed_state = { value: 0.3, raw_value: 30, cap: 100, unit: '%', source: 'brief_extraction' };
    const quote = 'Every 2% rise in developer headcount adds about 1 point of onboarding drag.';
    const e = effect(1, 'percentage points', 2, '%');
    const base = prepareLinkEffectUnitReadings(graph, 'developer_headcount', 'onboarding_drag', e, quote);
    expect(base.asked_unit, 'PRECONDITION: one UNIT question…').toEqual([{ end: 'target', node_id: 'onboarding_drag', value: 1 }]);
    expect(base.ask, '…inside a joined ask that also asks points-or-share').toMatch(/^Is that a 2-point rise in “Developer headcount”.*; what unit is the 1 change in “Onboarding drag” stated in\?$/);
    const readings = [answered('Percentage points')];
    expect(applyLinkEffectEdit({ persistedGraph: graph, from: 'developer_headcount', to: 'onboarding_drag', effect: e, quote, unit_readings: readings as never,
      expected: { graph_hash: hashOf(graph), edge_token: linkEffectEdgeToken(graph, 'developer_headcount', 'onboarding_drag')! },
      reading_token: linkEffectReadingToken({ from: 'developer_headcount', to: 'onboarding_drag', effect: e, quote, unit_readings: readings as never }) }))
      .toEqual({ kind: 'refused', reason: 'unit_mismatch' });
  });
  it.each([
    ['the quote asks no unit (it is written), yet an answer is claimed', 'Every 2 extra developers add about 1 percentage point of onboarding drag.', pp, [answered('Percentage points')]],
    ['the answer is a bare % (two readings)', C1, pp, [answered('%')]],
    ['the answer is not a unit', C1, pp, [answered('hours')]],
    ['two answers', C1, pp, [answered('Percentage points', 'developer_headcount'), answered('Percentage points')]],
    ['the answer is claimed for the end that was NOT asked', C1, pp, [answered('Percentage points', 'developer_headcount')]],
    ['the change is not said in the answered unit', C1, effect(1, 'points', 2, 'developers'), [answered('Percentage points')]],
  ] as const)('REFUSED: %s', (_n, quote, e, readings) => {
    expect(write(quote, e, readings)).toEqual({ kind: 'refused', reason: 'unit_mismatch' });
  });
});
