/**
 * RT-6 step 2: the user's own unit-bearing clause can size an UNSIZED link.
 * No LLM or external store. Approval exercises the real proposer, card, canonical writer,
 * scope guard and commitDirectAnswer over a serialized SessionStore, then NodeV3 reload by id.
 * M1: accepting a bare % as a % level makes R1 and the target-% twin red.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockSessionStore, makeSessionTurnRow } from '../../../../tests/utils/mock-session-store.js';
import { GraphV3, NodeV3 } from '../../../schemas/cee-v3.js';
import { magnitudeNodes, percentLevelIds } from '../../../cee/magnitude/frame-defaulted-links.js';
import { unitOf } from '../../../cee/magnitude/link-effect.js';
import { nodeUnitOf } from '../../../orchestrator/context/placeholder-parts.js';
import { createAgentCapabilities, type InternalDispatch } from '../../agent-lane/runtime/agent-capabilities.js';
import { ProposalStore } from '../../agent-lane/proposal.js';
import { approvalChipsFor } from '../../agent-lane/approval-chips.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import type { SessionStore, SessionTurnWrite } from '../../session/store.js';
import { commitOptionLevelsInProcess, type CommitOptionLevelsInput, type CommitOptionLevelsResult } from '../dispatch.js';
import { applyLinkEffectEdit, linkEffectEdgeToken, linkEffectReadingToken, type ApplyLinkEffectEditParams } from '../link-effect-edit.js';
import { executeOptionInterventionBatch, linkStrengthsPostimageIsScoped, type ApprovedLinkEffect } from '../option-intervention-edit.js';
import { prepareLinkEffectUnitReadings } from '../link-effect-unit-reading.js';
import { findStatedAmounts } from '../../../cee/provenance/stated-amounts.js';
import { targetTestabilityOf } from '../../admission/target-testability.js';

type Json = Record<string, any>;
const SCENARIO = '0c6dcb3d-de66-4b46-8860-4b7dce0bb107';
const SOURCE = 'footfall_lost_from_price_rise';
const TARGET = 'gross_margin';
const OTHER = 'unrelated_factor';
const FOOTFALL = 'Footfall loss from price rise';
const MARGIN = 'Gross margin';
const SAID_BARE = 'Each 5% of footfall loss costs us about 2 percentage points of gross margin.';
const SAID_POINTS = 'Each 5 percentage points of footfall loss costs us about 2 percentage points of gross margin.';
const EFFECT = { amount: -2, amount_unit: 'percentage points', per_source_change: 5, per_source_change_unit: 'percentage points' };
const SOURCE_CLAUSE = '5 percentage points of footfall loss';
const TARGET_CLAUSE = '2 percentage points of gross margin';
const reading = (unit: string, source_quote: string) => ({ unit, source: 'user_stated' as const, source_quote });
const ctxSaying = (user_text: string) => ({ scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'rt6-size-by-chat', user_text });
const nodeOf = (graph: Json, id: string) => (graph.nodes as Json[]).find(n => n.id === id)!;
const linkOf = (graph: Json) => (graph.edges as Json[]).find(e => e.from === SOURCE && e.to === TARGET)!;
const hashOf = (graph: unknown) => computeAnalysisAffectingGraphHash(graph as never)!;

// The real writer still produces the postimage. C3 introduces a malicious extra write
// immediately after it, so the REAL commit scope guard must refuse before append.
const sabotage = vi.hoisted(() => ({ field: undefined as undefined | 'label' | 'other_reading' | 'wrong_reading' }));
const session = vi.hoisted(() => ({ store: undefined as SessionStore | undefined }));
vi.mock('../../session/index.js', async original => ({
  ...await original<typeof import('../../session/index.js')>(),
  getSessionStore: () => {
    if (session.store === undefined) throw new Error('No serialized RT-6 store selected');
    return session.store;
  },
}));
vi.mock('../link-effect-edit.js', async original => {
  const actual = await original<typeof import('../link-effect-edit.js')>();
  return { ...actual, applyLinkEffectEdit: (params: Parameters<typeof actual.applyLinkEffectEdit>[0]) => {
    const result = actual.applyLinkEffectEdit(params);
    if (result.kind !== 'mutated' || sabotage.field === undefined) return result;
    const graph = structuredClone(result.mutatedGraph) as Json;
    if (sabotage.field === 'label') graph.nodes.find((n: Json) => n.id === params.from)!.label = 'Secretly renamed';
    if (sabotage.field === 'other_reading') graph.nodes.find((n: Json) => n.id === 'unrelated_factor')!.unit_reading = { unit: 'GBP', source: 'user_stated', source_quote: '£1' };
    if (sabotage.field === 'wrong_reading') graph.nodes.find((n: Json) => n.id === params.from)!.unit_reading.source_quote = 'a different sentence';
    return { ...result, mutatedGraph: graph };
  } };
});
afterEach(() => { sabotage.field = undefined; session.store = undefined; });

/** A persistence fixed point with both link ends unitless and without an observed level. */
function unsizedGraph(): Json {
  return projectGraphForPersistence(GraphV3.parse({
    nodes: [
      { id: SOURCE, ref: 'R1', kind: 'risk', label: FOOTFALL, scale_frame: 100 },
      { id: TARGET, ref: 'G1', kind: 'goal', label: MARGIN, goal_threshold_cap: 100 },
      { id: OTHER, ref: 'F1', kind: 'factor', label: 'Unrelated factor', scale_frame: 100 },
    ],
    edges: [{ from: SOURCE, to: TARGET, strength: { mean: -0.2, std: 0.1 }, exists_probability: 0.8,
      effect_direction: 'negative', defaulted: true, provenance: { source: 'cee_hypothesis', magnitude: 'olumi_placeholder' } }],
    ref_high_water: { R: 1, G: 1, F: 1 },
  })) as Json;
}

/** Serialized bytes are the store boundary; no writer or commit function is replaced. */
function world(initial: Json = unsizedGraph(), options: { dropReadingOnAgentRead?: string; useInProcessDoor?: boolean } = {}) {
  let graphJson = JSON.stringify(initial);
  const proposals = new ProposalStore();
  const attempts: SessionTurnWrite[] = [];
  const rows: { id: string; write: SessionTurnWrite }[] = [];
  const graph = () => JSON.parse(graphJson) as Json;
  const store = createMockSessionStore({
    loadGraph: async () => graph(),
    loadGraphAndBriefText: async () => ({ graph: graph(), briefText: null }),
    readExistingScenario: async () => ({ userId: null, graph: graph(), briefText: null, analysisInvalidatedAt: null }),
    readMostRecentPendingActions: async () => [],
    readAnalysisInvalidatedAt: async () => null,
    getScenarioOwner: async () => null,
    append: async write => {
      const stored = JSON.parse(JSON.stringify(write)) as SessionTurnWrite;
      attempts.push(stored);
      const id = `rt6-row-${rows.length + 1}`;
      rows.push({ id, write: stored });
      if (stored.graph !== undefined) graphJson = JSON.stringify(stored.graph);
      return { id };
    },
    readRecent: async () => rows.map(({ id, write }) => makeSessionTurnRow({ id, scenario_id: write.scenario_id,
      turn_id: write.turn_id, turn_class: write.turn_class, handler_id: write.handler_id,
      request_hash: write.request_hash, response_emitted: write.response_emitted,
      llm_calls_used: write.llm_calls_used, duration_ms: write.duration_ms })),
    readFactsWithTurnFor: async ids => rows.filter(row => ids.includes(row.id)).flatMap(({ id, write }) =>
      write.handler_facts.map(fact => ({ turn_id: id, fact_created_at: '2026-10-05T00:00:00.000Z', fact }))),
  });
  const commits: CommitOptionLevelsInput[] = [];
  const commitOptionLevels = async (input: CommitOptionLevelsInput): Promise<CommitOptionLevelsResult> => {
    commits.push(input);
    if (options.useInProcessDoor === true) {
      session.store = store;
      try { return await commitOptionLevelsInProcess(input, 'rt6-real-in-process-door'); }
      finally { session.store = undefined; }
    }
    const out = await executeOptionInterventionBatch({ scenarioId: input.scenario_id, turnId: input.turn_id,
      requestId: 'rt6-real-commit', requestHash: `rt6:${input.turn_id}`, stage: 'frame',
      freshness: 'fresh', hasExistingAnalysis: false, expectedGraphHash: input.base_graph_hash, targets: [],
      ...(input.link_effect !== undefined ? { linkEffect: input.link_effect } : {}),
      ...(input.link_effects !== undefined ? { linkEffects: input.link_effects } : {}),
    }, store);
    if (out.kind === 'refused') return { status: 'refused', reason: out.reason };
    if (out.kind !== 'committed') throw new Error(`Real commit did not verify: ${JSON.stringify(out)}`);
    return { status: 'committed', graph_hash: out.analysisGraphHash, receipt: null, already_applied: false,
      committed_levels: [], links_resized: [] };
  };
  const dispatch: InternalDispatch = async path => {
    if (!path.endsWith('/graph')) throw new Error(`Unexpected dispatch: ${path}`);
    const read = graph();
    if (attempts.length > 0 && options.dropReadingOnAgentRead !== undefined) delete nodeOf(read, options.dropReadingOnAgentRead).unit_reading;
    return { status: 200, json: { graph: read, graph_hash: hashOf(read) } };
  };
  return { caps: createAgentCapabilities(dispatch, proposals, undefined, 'full', undefined, { commitOptionLevels }),
    proposals, commits, attempts, rows, graph, replace: (next: Json) => { graphJson = JSON.stringify(next); } };
}
type World = ReturnType<typeof world>;
const cardFor = (w: World, proposal: Json) => approvalChipsFor([
  { name: 'propose_link_effect', ok: true, mutated: false, proposal_id: String(proposal.proposal_id) },
], id => ({ proposal: w.proposals.get(id), result: proposal as never }))[0]!;
async function propose(w: World, quote: string = SAID_POINTS, effect = EFFECT) {
  return await w.caps.proposeLinkEffect!(ctxSaying(quote), { from_label: nodeOf(w.graph(), SOURCE).label,
    to_label: nodeOf(w.graph(), TARGET).label, ...effect, quote }) as Json;
}
async function approve(w: World, r: Json) {
  expect(r.ok, JSON.stringify(r)).toBe(true);
  const card = cardFor(w, r);
  return { card, out: await w.caps.authoriseChange({ ...ctxSaying(card.message), typed_approval_of: String(r.proposal_id),
    typed_approval_words: card.message }, { proposal_id: String(r.proposal_id) }) as Json };
}
function writerParams(graph: Json = unsizedGraph(), quote: string = SAID_POINTS, effect = EFFECT): ApplyLinkEffectEditParams {
  const p = { persistedGraph: graph, from: SOURCE, to: TARGET, effect, quote,
    unit_readings: prepareLinkEffectUnitReadings(graph, SOURCE, TARGET, effect, quote).unit_readings,
    expected: { graph_hash: hashOf(graph), edge_token: linkEffectEdgeToken(graph, SOURCE, TARGET)! } };
  return { ...p, reading_token: linkEffectReadingToken(p) };
}
const approvedEffect = (p: ApplyLinkEffectEditParams): ApprovedLinkEffect => ({ from: p.from, to: p.to,
  effect: p.effect, quote: p.quote, edge_token: p.expected.edge_token, reading_token: p.reading_token, unit_readings: p.unit_readings });

describe('RT-6 size-by-chat on an UNSIZED link', () => {
  it('R1 red-team bare %: target pp adopted at preparation, source asked once BEFORE canvas route; NOTHING written', async () => {
    const w = world();
    const before = w.graph();
    const effect = { ...EFFECT, per_source_change_unit: '%' };
    const prepared = prepareLinkEffectUnitReadings(before, SOURCE, TARGET, effect, SAID_BARE);
    expect(prepared.unit_readings).toEqual([{ node_id: TARGET, unit_reading: reading('%', TARGET_CLAUSE) }]);
    const ask = `Is that a 5-point rise in \u201c${FOOTFALL}\u201d (say 10% → 15%), or 5% of today\u2019s level?`;
    expect(prepared.ask).toBe(ask);
    const r = await propose(w, SAID_BARE, effect);
    expect(r).toMatchObject({ ok: false, mutated: false, refusal: 'unit_mismatch' });
    // ONE well-formed quoted sentence: the ask FIRST, then the canvas alternative (order is the string), never "can't record".
    expect(String(r.detail)).toBe(`Nothing was prepared. Tell the user exactly this: "${ask} Nothing is recorded until you answer. `
      + `If you\u2019d rather not answer, you can set how strong this link is on the canvas: click the link from \u201c${FOOTFALL}\u201d `
      + `to \u201c${MARGIN}\u201d, and under \u201cHow strong is this effect?\u201d choose Slight, Moderate, Strong or Very strong. `
      + 'That records how strong you judge the link, not your figure."');
    expect(String(r.detail)).not.toMatch(/can\u2019t record|can't record|available tools/);
    expect(r).not.toHaveProperty('proposal_id');
    expect(w.proposals.outstanding(SCENARIO, null)).toEqual([]);
    expect(w.commits).toEqual([]);
    expect(w.attempts).toEqual([]);
    expect(w.graph()).toEqual(before);
    expect(linkOf(w.graph()).provenance).not.toHaveProperty('natural_effect');
  });

  it('R2 pp at both ends: real proposer → card approval → REAL in-process dispatch → ONE real commit → NodeV3 reload by id', async () => {
    const w = world(unsizedGraph(), { useInProcessDoor: true });
    const before = w.graph();
    const r = await propose(w);
    expect(w.attempts).toEqual([]);
    expect(w.graph()).toEqual(before);
    const { card, out } = await approve(w, r);
    expect(card.detail).toContain(`Record: +5 percentage points on "${FOOTFALL}" → −2 percentage points in "${MARGIN}"`);
    expect(card.detail).toContain(`I've taken "${FOOTFALL}" to be in %, from your words.`);
    expect(card.detail).toContain(`I've taken "${MARGIN}" to be in %, from your words.`);
    expect(card.detail).toContain(SAID_POINTS.slice(0, -1));
    expect(out, JSON.stringify(out)).toMatchObject({ ok: true, mutated: true, applied: true });
    expect(w.commits).toHaveLength(1);
    expect(w.attempts).toHaveLength(1);
    expect(w.rows).toHaveLength(1);
    const written = w.graph();
    const cold = { ...written, nodes: written.nodes.map((node: Json) => NodeV3.parse(JSON.parse(JSON.stringify(node)))) };
    expect(nodeOf(cold, SOURCE).unit_reading).toEqual(reading('%', SOURCE_CLAUSE));
    expect(nodeOf(cold, TARGET).unit_reading).toEqual(reading('%', TARGET_CLAUSE));
    expect(Object.keys(nodeOf(cold, SOURCE).unit_reading).sort()).toEqual(['source', 'source_quote', 'unit']);
    expect(linkOf(cold).provenance).toMatchObject({ source: 'user_specified', magnitude: 'user_stated', natural_effect: {
      amount: -2, amount_unit: 'percentage points', per_source_change: 5, per_source_change_unit: 'percentage points' } });
    expect(w.commits[0]!.link_effect?.quote).toBe(SAID_POINTS);
    expect(w.rows[0]!.write.handler_facts[0]).toMatchObject({ fact_type: 'adjust_edge_strength',
      result: { after: { stated_quote: SAID_POINTS } } });
    expect(w.attempts[0]!.graph).toEqual(written);
    expect(nodeOf(cold, OTHER)).toEqual(nodeOf(before, OTHER));
    expect(w.proposals.outstanding(SCENARIO, null)).toEqual([]);
  });

  it('R3 >500-character twin keeps each bounded own clause through strict NodeV3 reload', async () => {
    const said = `${'Context about our bakery and its market. '.repeat(20)}${SAID_POINTS}`;
    expect(said.length).toBeGreaterThan(500);
    const w = world();
    const r = await propose(w, said);
    const { card, out } = await approve(w, r);
    expect(out, JSON.stringify(out)).toMatchObject({ ok: true, applied: true });
    for (const [id, clause] of [[SOURCE, SOURCE_CLAUSE], [TARGET, TARGET_CLAUSE]]) {
      const parsed = NodeV3.parse(nodeOf(w.graph(), id!));
      expect(parsed.unit_reading).toEqual(reading('%', clause!));
      expect(parsed.unit_reading!.source_quote.length).toBeLessThanOrEqual(500);
      expect(card.detail).toContain(`I've taken "${nodeOf(w.graph(), id!).label}" to be in %, from your words.`);
    }
    expect(w.attempts).toHaveLength(1);
  });

  it('R2 frameless percentage ends are sized in points without inventing a stored scale or level', async () => {
    const graph = unsizedGraph();
    delete nodeOf(graph, SOURCE).scale_frame;
    delete nodeOf(graph, TARGET).goal_threshold_cap;
    const w = world(graph);
    const { out } = await approve(w, await propose(w));
    expect(out, JSON.stringify(out)).toMatchObject({ ok: true, applied: true });
    for (const id of [SOURCE, TARGET]) {
      expect(nodeOf(w.graph(), id).unit_reading.unit).toBe('%');
      expect(nodeOf(w.graph(), id)).not.toHaveProperty('observed_state');
      expect(nodeOf(w.graph(), id)).not.toHaveProperty('scale_frame');
    }
    expect(nodeOf(w.graph(), TARGET)).not.toHaveProperty('goal_threshold_cap');
  });

  // 'points' left this row (Science F1, #87 5999199710): bare "points" is points of a % only on a % quantity; see U2-points.
  it.each(['pp', 'percentage points'] as const)('U2 literal %s of each label adopts % and the real writer sizes it', unitWords => {
    const graph = unsizedGraph();
    const said = `Each 5 ${unitWords} of footfall loss costs us about 2 ${unitWords} of gross margin.`;
    const effect = { ...EFFECT, amount_unit: unitWords, per_source_change_unit: unitWords };
    const prepared = prepareLinkEffectUnitReadings(graph, SOURCE, TARGET, effect, said);
    expect(prepared.ask).toBeUndefined();
    expect(prepared.unit_readings).toEqual([
      { node_id: SOURCE, unit_reading: reading('%', `5 ${unitWords} of footfall loss`) },
      { node_id: TARGET, unit_reading: reading('%', `2 ${unitWords} of gross margin`) },
    ]);
    const result = applyLinkEffectEdit(writerParams(graph, said, effect));
    expect(result.kind, JSON.stringify(result)).toBe('mutated');
    if (result.kind !== 'mutated') return;
    expect(NodeV3.parse(nodeOf(result.mutatedGraph as Json, SOURCE)).unit_reading).toEqual(prepared.unit_readings[0]!.unit_reading);
    expect(linkOf(result.mutatedGraph as Json).provenance.natural_effect).toMatchObject({ amount_unit: unitWords, per_source_change_unit: unitWords });
  });

  it.each(['extra key', 'quote >500', 'unit >40'] as const)(
    'strict reload trap: %s drops the carrier, and the real writer refuses that claimed approval', defect => {
      const graph = unsizedGraph();
      const params = writerParams(graph);
      const unit_readings = params.unit_readings!.map(item => structuredClone(item)) as Json[];
      const defective = unit_readings[0]!.unit_reading as Json;
      if (defect === 'extra key') defective.period = 'month';
      if (defect === 'quote >500') defective.source_quote = 'x'.repeat(501);
      if (defect === 'unit >40') defective.unit = 'x'.repeat(41);
      expect(NodeV3.parse({ ...nodeOf(graph, SOURCE), unit_reading: defective }).unit_reading).toBeUndefined();
      const tampered = { ...params, unit_readings: unit_readings as unknown as ApplyLinkEffectEditParams['unit_readings'] };
      const result = applyLinkEffectEdit({ ...tampered, reading_token: linkEffectReadingToken(tampered) });
      expect(result).toMatchObject({ kind: 'refused' });
      expect(nodeOf(graph, SOURCE)).not.toHaveProperty('unit_reading');
      expect(linkOf(graph).provenance).not.toHaveProperty('natural_effect');
    });

  it.each([
    ['no period', 'Each £1,000 of marketing spend brings about 3 more customers', 'GBP'],
    ['explicit code', 'Each GBP 1,000 of marketing spend brings about 3 more customers', 'GBP'],
    ['explicit period', 'Each £1,000 of marketing spend per month brings about 3 more customers', 'GBP/month'],
  ])('R4 currency/count, %s: adopt GBP + matching count noun, period only when literally stated', async (_name, said, currency) => {
    const graph = unsizedGraph();
    Object.assign(nodeOf(graph, SOURCE), { label: 'Marketing spend', kind: 'factor', ref: 'F2', scale_frame: 10000 });
    Object.assign(nodeOf(graph, TARGET), { label: 'Customers', count_noun: 'customers', goal_threshold_cap: 100 });
    graph.ref_high_water.F = 2;
    linkOf(graph).effect_direction = 'positive';
    linkOf(graph).strength.mean = 0.2;
    const w = world(projectGraphForPersistence(graph) as Json);
    const r = await propose(w, said, { amount: 3, amount_unit: 'customers', per_source_change: 1000, per_source_change_unit: currency });
    const { out } = await approve(w, r);
    expect(out, JSON.stringify(out)).toMatchObject({ ok: true, applied: true });
    const cold = GraphV3.parse(w.graph()) as Json;
    expect(nodeOf(cold, SOURCE).unit_reading.unit).toBe(currency);
    expect(nodeOf(cold, TARGET).unit_reading.unit).toBe('customers');
    expect(nodeOf(cold, TARGET).unit_reading.source_quote).toBe('3 more customers');
    expect(said).toContain(nodeOf(cold, SOURCE).unit_reading.source_quote);
    if (_name === 'no period') expect(nodeOf(cold, SOURCE).unit_reading.unit).not.toContain('month');
    expect(w.attempts).toHaveLength(1);
  });

  it('R4 a currency CODE is read ONLY on this path: the shared scanner stays symbol-only for every other reader', () => {
    // Contrast for the opt-in: the default scan (13 other readers) is byte-for-byte today's.
    expect(findStatedAmounts('GBP 1,000').map((a) => [a.kind, a.currencyCode])).toEqual([['plain', undefined]]);
    expect(findStatedAmounts('GBP 1,000', { isoCurrencyCodes: true }).map((a) => [a.kind, a.currencyCode])).toEqual([['currency', 'GBP']]);
    expect(findStatedAmounts('£1,000').map((a) => [a.kind, a.currencyCode])).toEqual([['currency', 'GBP']]);
  });

  // Codex buddy HIGH (5 Oct): an end may never take another quantity's unit-bearing span.
  it.each([
    ['backward borrow', 'Each £1,000 of marketing spend on sales brings in £3 of profit', 'Sales revenue', { amount: 3, amount_unit: 'GBP', per_source_change: 1000, per_source_change_unit: 'GBP' }],
    ['forward borrow', 'Each 5 percentage points of footfall loss costs us 2 percentage points of market share for gross margin', MARGIN, { ...EFFECT }],
  ] as const)('H %s: the target is NOT adopted from another quantity\'s phrase', (_n, said, targetLabel, effect) => {
    const graph = unsizedGraph();
    if (targetLabel === 'Sales revenue') {
      Object.assign(nodeOf(graph, SOURCE), { label: 'Marketing spend', kind: 'factor', ref: 'F2', scale_frame: 10000 });
      Object.assign(nodeOf(graph, TARGET), { label: 'Sales revenue' });
      graph.ref_high_water.F = 2;
    }
    const prepared = prepareLinkEffectUnitReadings(graph, SOURCE, TARGET, effect, said);
    expect(prepared.unit_readings.some((r) => r.node_id === TARGET)).toBe(false);
    expect(prepared.ask, 'the unread end is asked about, never sized').toBeDefined();
  });

  it('H control: the same figure written as "£3 of sales revenue" IS the target\'s own span', () => {
    const graph = unsizedGraph();
    Object.assign(nodeOf(graph, SOURCE), { label: 'Marketing spend', kind: 'factor', ref: 'F2', scale_frame: 10000 });
    Object.assign(nodeOf(graph, TARGET), { label: 'Sales revenue' });
    graph.ref_high_water.F = 2;
    const prepared = prepareLinkEffectUnitReadings(graph, SOURCE, TARGET,
      { amount: 3, amount_unit: 'GBP', per_source_change: 1000, per_source_change_unit: 'GBP' }, 'Each £1,000 of marketing spend brings in £3 of sales revenue');
    expect(prepared.unit_readings).toEqual([
      { node_id: SOURCE, unit_reading: reading('GBP', '£1,000 of marketing spend') },
      { node_id: TARGET, unit_reading: reading('GBP', '£3 of sales revenue') },
    ]);
    expect(prepared.ask).toBeUndefined();
  });

  // Codex buddy r2 (5 Oct): each counterexample, verbatim.
  it('a movement noun may stand between figure and end ("5 percentage point rise in footfall loss")', () => {
    const prepared = prepareLinkEffectUnitReadings(unsizedGraph(), SOURCE, TARGET, EFFECT,
      'Each 5 percentage point rise in footfall loss costs us about 2 percentage points of gross margin.');
    expect(prepared.unit_readings.find((r) => r.node_id === SOURCE)).toEqual({ node_id: SOURCE, unit_reading: reading('%', '5 percentage point rise in footfall loss') });
  });

  it('H2 a partial label prefix never names the end ("of gross profit for gross margin")', () => {
    const prepared = prepareLinkEffectUnitReadings(unsizedGraph(), SOURCE, TARGET, EFFECT,
      'Each 5 percentage points of footfall loss costs us 2 percentage points of gross profit for gross margin');
    expect(prepared.unit_readings.some((r) => r.node_id === TARGET)).toBe(false);
    expect(prepared.ask).toBeDefined();
  });

  it.each([
    ['backward', 'Each £1,000 of marketing spend sees revenue rising by £3 per month', '£3 per month', 'revenue rising by £3 per month'],
    ['forward', 'Each £1,000 per month of marketing spend brings £3 of revenue per month', '£1,000 per month of marketing spend', '£3 of revenue per month'],
  ] as const)('P2 a "per" period after the figure is kept (%s)', (_n, said, sourceOrFigure, targetClause) => {
    const graph = unsizedGraph();
    Object.assign(nodeOf(graph, SOURCE), { label: 'Marketing spend', kind: 'factor', ref: 'F2', scale_frame: 10000 });
    Object.assign(nodeOf(graph, TARGET), { label: 'Revenue' });
    graph.ref_high_water.F = 2;
    const perUnit = _n === 'forward' ? 'GBP/month' : 'GBP';
    const prepared = prepareLinkEffectUnitReadings(graph, SOURCE, TARGET,
      { amount: 3, amount_unit: 'GBP/month', per_source_change: 1000, per_source_change_unit: perUnit }, said);
    expect(prepared.unit_readings.find((r) => r.node_id === TARGET)).toEqual({ node_id: TARGET, unit_reading: reading('GBP/month', targetClause) });
    if (_n === 'forward') expect(prepared.unit_readings.find((r) => r.node_id === SOURCE)).toEqual({ node_id: SOURCE, unit_reading: reading('GBP/month', sourceOrFigure) });
  });

  it('P2 labels sharing a word: "£3 of marketing revenue" names Marketing revenue beside Marketing spend', () => {
    const graph = unsizedGraph();
    Object.assign(nodeOf(graph, SOURCE), { label: 'Marketing spend', kind: 'factor', ref: 'F2', scale_frame: 10000 });
    Object.assign(nodeOf(graph, TARGET), { label: 'Marketing revenue' });
    graph.ref_high_water.F = 2;
    const prepared = prepareLinkEffectUnitReadings(graph, SOURCE, TARGET,
      { amount: 3, amount_unit: 'GBP', per_source_change: 1000, per_source_change_unit: 'GBP' }, 'Each £1,000 of marketing spend brings in £3 of marketing revenue');
    expect(prepared.unit_readings).toEqual([
      { node_id: SOURCE, unit_reading: reading('GBP', '£1,000 of marketing spend') },
      { node_id: TARGET, unit_reading: reading('GBP', '£3 of marketing revenue') },
    ]);
    expect(prepared.ask).toBeUndefined();
  });

  it.each(['gbp', 'Gbp', 'GBP'] as const)('P2 an ISO code in any case is GBP on the opt-in scan (%s)', (code) => {
    expect(findStatedAmounts(`${code} 1,000`, { isoCurrencyCodes: true }).map((a) => a.currencyCode)).toEqual(['GBP']);
    expect(findStatedAmounts(`${code} 1,000`).map((a) => a.kind)).toEqual(['plain']); // default scan unchanged
  });

  // Codex buddy r3 (5 Oct): each counterexample, verbatim. A run must hold the label's HEAD noun + a distinguishing word.
  it.each([
    ['Operating margin → Gross margin', 'Operating margin', 'Gross margin'],
    ['… → Gross profit margin', FOOTFALL, 'Gross profit margin'],
  ] as const)('H3 a partial prefix without the head noun never names the end (%s)', (_n, sourceLabel, targetLabel) => {
    const graph = unsizedGraph();
    Object.assign(nodeOf(graph, SOURCE), { label: sourceLabel });
    Object.assign(nodeOf(graph, TARGET), { label: targetLabel });
    const said = `Each 5 percentage points of ${sourceLabel.toLowerCase()} costs us 2 percentage points of gross profit for gross margin`;
    const prepared = prepareLinkEffectUnitReadings(graph, SOURCE, TARGET, EFFECT, said);
    expect(prepared.unit_readings.some((r) => r.node_id === TARGET)).toBe(false);
    expect(prepared.ask).toBeDefined();
  });

  it('P2 a count noun that is not the label head is no alias ("3 more customers" never names Customer retention)', () => {
    const graph = unsizedGraph();
    Object.assign(nodeOf(graph, SOURCE), { label: 'Marketing spend', kind: 'factor', ref: 'F2', scale_frame: 10000 });
    Object.assign(nodeOf(graph, TARGET), { label: 'Customer retention', count_noun: 'customers' });
    graph.ref_high_water.F = 2;
    const prepared = prepareLinkEffectUnitReadings(graph, SOURCE, TARGET,
      { amount: 3, amount_unit: 'customers', per_source_change: 1000, per_source_change_unit: 'GBP' }, 'Each £1,000 of marketing spend brings about 3 more customers');
    expect(prepared.unit_readings.some((r) => r.node_id === TARGET)).toBe(false);
    expect(prepared.ask).toBeDefined();
  });

  it('P2 a numbered period ("per 12 months") is asked about, never dropped', () => {
    const graph = unsizedGraph();
    Object.assign(nodeOf(graph, SOURCE), { label: 'Marketing spend', kind: 'factor', ref: 'F2', scale_frame: 10000 });
    Object.assign(nodeOf(graph, TARGET), { label: 'Revenue' });
    graph.ref_high_water.F = 2;
    const prepared = prepareLinkEffectUnitReadings(graph, SOURCE, TARGET,
      { amount: 3, amount_unit: 'GBP', per_source_change: 1000, per_source_change_unit: 'GBP' }, 'Each £1,000 of marketing spend brings in £3 of revenue per 12 months');
    expect(prepared.unit_readings.some((r) => r.node_id === TARGET)).toBe(false);
    expect(prepared.ask).toBeDefined();
  });

  // Codex buddy r4 (5 Oct): each counterexample, verbatim. A run must be a COMPLETE phrase holding the exact head token.
  it.each([
    ['revenue tax', 'Marketing spend', 'Revenue', undefined, 'Each £1,000 of marketing spend brings in £3 of revenue tax for revenue', 'GBP'],
    ['marginal ≠ margin', 'Operating margin', 'Gross margin', undefined, 'Each 5 percentage points of operating margin costs us 2 percentage points of gross marginal tax rates for gross margin', 'percentage points'],
    ['count noun without its head', 'Marketing spend', 'Enterprise customers', 'enterprise customers', 'Each £1,000 of marketing spend brings in £3 of enterprise revenue for enterprise customers', 'GBP'],
    ['"per" before a numbered period', 'Marketing spend', 'Revenue per month', undefined, 'Each £1,000 of marketing spend brings in £3 of revenue per 12 months', 'GBP'],
  ] as const)('H4 the target is not adopted: %s', (_n, sourceLabel, targetLabel, countNoun, said, amountUnit) => {
    const graph = unsizedGraph();
    Object.assign(nodeOf(graph, SOURCE), { label: sourceLabel, kind: 'factor', ref: 'F2' });
    Object.assign(nodeOf(graph, TARGET), { label: targetLabel, ...(countNoun !== undefined ? { count_noun: countNoun } : {}) });
    graph.ref_high_water.F = 2;
    const perUnit = amountUnit === 'GBP' ? 'GBP' : 'percentage points';
    const prepared = prepareLinkEffectUnitReadings(graph, SOURCE, TARGET,
      { amount: amountUnit === 'GBP' ? 3 : -2, amount_unit: amountUnit, per_source_change: amountUnit === 'GBP' ? 1000 : 5, per_source_change_unit: perUnit }, said);
    expect(prepared.unit_readings.some((r) => r.node_id === TARGET)).toBe(false);
    expect(prepared.ask).toBeDefined();
  });

  it('H4 backward: a phrase completed on its LEFT by another word ("gross revenue rising by £3") never names Revenue', () => {
    const graph = unsizedGraph();
    Object.assign(nodeOf(graph, SOURCE), { label: 'Marketing spend', kind: 'factor', ref: 'F2' });
    Object.assign(nodeOf(graph, TARGET), { label: 'Revenue' });
    graph.ref_high_water.F = 2;
    const prepared = prepareLinkEffectUnitReadings(graph, SOURCE, TARGET,
      { amount: 3, amount_unit: 'GBP', per_source_change: 1000, per_source_change_unit: 'GBP' }, 'Each £1,000 of marketing spend sees gross revenue rising by £3');
    expect(prepared.unit_readings.some((r) => r.node_id === TARGET)).toBe(false);
  });

  // Discriminating twins: COMPLETE phrases (ending at a full stop), so only the head rule can refuse them.
  it('H4 head by exact token: a complete "… of gross marginal." never names Gross margin', () => {
    const graph = unsizedGraph();
    Object.assign(nodeOf(graph, SOURCE), { label: 'Operating margin' });
    Object.assign(nodeOf(graph, TARGET), { label: 'Gross margin' });
    const prepared = prepareLinkEffectUnitReadings(graph, SOURCE, TARGET, EFFECT,
      'Each 5 percentage points of operating margin costs us 2 percentage points of gross marginal.');
    expect(prepared.unit_readings.some((r) => r.node_id === TARGET)).toBe(false);
  });

  it('H4 count noun needs its head token: a complete "… of enterprise." never names Enterprise customers', () => {
    const graph = unsizedGraph();
    Object.assign(nodeOf(graph, SOURCE), { label: 'Marketing spend', kind: 'factor', ref: 'F2' });
    Object.assign(nodeOf(graph, TARGET), { label: 'Enterprise customers', count_noun: 'enterprise customers' });
    graph.ref_high_water.F = 2;
    const prepared = prepareLinkEffectUnitReadings(graph, SOURCE, TARGET,
      { amount: 3, amount_unit: 'GBP', per_source_change: 1000, per_source_change_unit: 'GBP' }, 'Each £1,000 of marketing spend brings in £3 of enterprise.');
    expect(prepared.unit_readings.some((r) => r.node_id === TARGET)).toBe(false);
  });

  it('H4 control: a complete phrase still names the end ("… £3 of revenue, every month")', () => {
    const graph = unsizedGraph();
    Object.assign(nodeOf(graph, SOURCE), { label: 'Marketing spend', kind: 'factor', ref: 'F2' });
    Object.assign(nodeOf(graph, TARGET), { label: 'Revenue' });
    graph.ref_high_water.F = 2;
    const prepared = prepareLinkEffectUnitReadings(graph, SOURCE, TARGET,
      { amount: 3, amount_unit: 'GBP', per_source_change: 1000, per_source_change_unit: 'GBP' }, 'Each £1,000 of marketing spend brings in £3 of revenue, every month');
    expect(prepared.unit_readings.find((r) => r.node_id === TARGET)).toEqual({ node_id: TARGET, unit_reading: reading('GBP', '£3 of revenue') });
  });

  it('R4 own-clause negative: a multiword count noun cannot be adopted from a different counted thing', () => {
    const graph = unsizedGraph();
    Object.assign(nodeOf(graph, SOURCE), { label: 'Marketing spend', scale_frame: 10000 });
    Object.assign(nodeOf(graph, TARGET), { label: 'Enterprise customers', count_noun: 'enterprise customers' });
    const effect = { amount: 3, amount_unit: 'enterprise customers', per_source_change: 1000, per_source_change_unit: 'GBP' };
    const said = 'Each £1,000 of marketing spend brings about 3 enterprise hires';
    const prepared = prepareLinkEffectUnitReadings(graph, SOURCE, TARGET, effect, said);
    expect(prepared.unit_readings.some(item => item.node_id === TARGET)).toBe(false);
    expect(prepared.ask).toContain('Enterprise customers');
  });

  it('R4 conflicting literal currency periods ask rather than select or invent a period', () => {
    const graph = unsizedGraph();
    Object.assign(nodeOf(graph, SOURCE), { label: 'Marketing spend', scale_frame: 10000 });
    Object.assign(nodeOf(graph, TARGET), { label: 'Customers', count_noun: 'customers' });
    const effect = { amount: 3, amount_unit: 'customers', per_source_change: 1000, per_source_change_unit: 'GBP/month' };
    const said = 'Each £1,000 of marketing spend per month per year brings about 3 more customers';
    const prepared = prepareLinkEffectUnitReadings(graph, SOURCE, TARGET, effect, said);
    expect(prepared.unit_readings.some(item => item.node_id === SOURCE)).toBe(false);
    expect(prepared.ask).toContain('Marketing spend');
  });

  it('R4 slash period is adopted only from the source currency\'s literal clause', () => {
    const graph = unsizedGraph();
    Object.assign(nodeOf(graph, SOURCE), { label: 'Marketing spend', scale_frame: 10000 });
    Object.assign(nodeOf(graph, TARGET), { label: 'Customers', count_noun: 'customers' });
    const effect = { amount: 3, amount_unit: 'customers', per_source_change: 1000, per_source_change_unit: 'GBP/month' };
    const said = 'Each £1,000/month of marketing spend brings about 3 more customers';
    const prepared = prepareLinkEffectUnitReadings(graph, SOURCE, TARGET, effect, said);
    expect(prepared.ask).toBeUndefined();
    expect(prepared.unit_readings.find(item => item.node_id === SOURCE)?.unit_reading).toEqual(
      reading('GBP/month', '£1,000/month of marketing spend'));
    expect(prepared.unit_readings.find(item => item.node_id === TARGET)?.unit_reading.unit).toBe('customers');
  });

  it('R4 currency period on the other end cannot be borrowed by a source with no period', () => {
    const graph = unsizedGraph();
    Object.assign(nodeOf(graph, SOURCE), { label: 'Marketing spend', scale_frame: 10000 });
    Object.assign(nodeOf(graph, TARGET), { label: 'Revenue', goal_threshold_cap: 100 });
    const effect = { amount: 3, amount_unit: 'GBP/month', per_source_change: 1000, per_source_change_unit: 'GBP' };
    const said = 'Each £1,000 of marketing spend brings about £3 of revenue per month';
    const prepared = prepareLinkEffectUnitReadings(graph, SOURCE, TARGET, effect, said);
    expect(prepared.ask).toBeUndefined();
    expect(prepared.unit_readings.find(item => item.node_id === SOURCE)?.unit_reading).toEqual(
      reading('GBP', '£1,000 of marketing spend'));
    expect(prepared.unit_readings.find(item => item.node_id === TARGET)?.unit_reading).toEqual(
      reading('GBP/month', '£3 of revenue per month'));
  });

  it('U2-points: bare "points" never makes an end of unknown unit a % (loyalty points); each end is asked, nothing adopted', () => {
    const graph = unsizedGraph();
    const said = 'Each 5 points of footfall loss costs us about 2 points of gross margin.';
    const prepared = prepareLinkEffectUnitReadings(graph, SOURCE, TARGET, { ...EFFECT, amount_unit: 'points', per_source_change_unit: 'points' }, said);
    expect(prepared.unit_readings).toEqual([]);
    expect(prepared.ask).toBe('What unit is the 5 change in “Footfall loss from price rise” stated in; what unit is the 2 change in “Gross margin” stated in?');
  });

  it('C1 existing own units govern: pp remains sizeable and no unit_reading is written', async () => {
    const graph = unsizedGraph();
    nodeOf(graph, SOURCE).observed_state = { value: 0, raw_value: 0, cap: 100, unit: '%', source: 'user_override' };
    nodeOf(graph, TARGET).goal_threshold_unit = '%';
    const w = world(projectGraphForPersistence(graph) as Json);
    const { out } = await approve(w, await propose(w));
    expect(out, JSON.stringify(out)).toMatchObject({ ok: true, applied: true });
    expect(nodeOf(w.graph(), SOURCE)).not.toHaveProperty('unit_reading');
    expect(nodeOf(w.graph(), TARGET)).not.toHaveProperty('unit_reading');
    const mismatch = world(projectGraphForPersistence(graph) as Json);
    const said = 'Each £5 of footfall loss costs us about 2 percentage points of gross margin.';
    const refused = await propose(mismatch, said, { ...EFFECT, per_source_change_unit: 'GBP' });
    expect(refused).toMatchObject({ ok: false, refusal: 'unit_mismatch' });
    expect(mismatch.attempts).toEqual([]);
  });

  describe('Science F1 (#87 5999199710, typed fields 17:3xZ): a % at the user\'s OWN 0 is points; any other level keeps the question', () => {
    const BARE = { ...EFFECT, per_source_change_unit: '%' };
    /** The source end's level as stored; the goal is a % level with no level of its own. */
    const levelled = (observed_state: Json | undefined, targetState?: Json): Json => {
      const graph = unsizedGraph();
      if (observed_state !== undefined) nodeOf(graph, SOURCE).observed_state = observed_state;
      nodeOf(graph, TARGET).goal_threshold_unit = '%';
      if (targetState !== undefined) nodeOf(graph, TARGET).observed_state = targetState;
      return projectGraphForPersistence(GraphV3.parse(graph)) as Json;
    };
    const ZERO_CARD = 'Record: +5 percentage points on "Footfall loss from price rise" → −2 percentage points in "Gross margin": '
      + 'raising "Footfall loss from price rise" by 5 percentage points lowers "Gross margin" by 2 percentage points. '
      + 'From your words: "Each 5% of footfall loss costs us about 2 percentage points of gross margin." Approve, or correct.';
    const proposeAs = async (w: World, shape: 'single' | 'grouped', quote: string, effect: typeof EFFECT) => {
      const args = { from_label: FOOTFALL, to_label: MARGIN, ...effect, quote };
      return await w.caps.proposeLinkEffect!(ctxSaying(quote), shape === 'grouped' ? { links: [args] } : args) as Json;
    };
    it.each([
      ['user-stated 0 (raw_value)', { value: 0, raw_value: 0, cap: 100, unit: '%', source: 'user_override' }],
      ['user-stated 0 held as value only (no raw_value)', { value: 0, unit: '%', source: 'brief_extraction' }],
    ] as const)('F1 %s: no question; the card says points, and the write is the points write', async (_name, os) => {
      // Control: the same link sized from a sentence that SAYS points. The writer stores each end in its own unit (one
      // point is one raw unit of a % level), so the points reading is identified by an identical stored size.
      const control = world(levelled({ ...os }));
      expect((await approve(control, await proposeAs(control, 'single', SAID_POINTS, EFFECT))).out).toMatchObject({ ok: true, applied: true });
      const pointsLink = linkOf(projectGraphForPersistence(GraphV3.parse(control.graph())) as Json);
      const w = world(levelled({ ...os }));
      const r = await proposeAs(w, 'single', SAID_BARE, BARE);
      expect(r, JSON.stringify(r)).toMatchObject({ ok: true, mutated: false });
      const { card, out } = await approve(w, r);
      expect(card.detail).toBe(ZERO_CARD);
      expect(out, JSON.stringify(out)).toMatchObject({ ok: true, applied: true });
      const cold = projectGraphForPersistence(GraphV3.parse(w.graph())) as Json;
      expect(linkOf(cold).provenance.natural_effect).toEqual(pointsLink.provenance.natural_effect);
      expect(linkOf(cold).strength).toEqual(pointsLink.strength);
      expect(linkOf(cold).provenance).toMatchObject({ magnitude: 'user_stated', source_quote: SAID_BARE, reading: 'agent_proposed_user_confirmed' });
      expect(nodeOf(cold, SOURCE)).not.toHaveProperty('unit_reading');
      // The grouped door stores the same points reading. (A ONE-link grouped result shows no card on staging today:
      // `linkEffectReadingFor` reads `result.link` for one operation. Pre-existing; a follow-up row, not this change.)
      const g = world(levelled({ ...os }));
      const grouped = await proposeAs(g, 'grouped', SAID_BARE, BARE);
      expect(grouped, JSON.stringify(grouped)).toMatchObject({ ok: true, mutated: false });
      expect((g.proposals.get(String(grouped.proposal_id))!.operations[0]!.value as Json).effect)
        .toEqual({ ...BARE, per_source_change_unit: 'percentage points' });
    });
    it.each([
      ['user-stated 30%: the example is the user\'s own level', { value: 0.3, raw_value: 30, cap: 100, unit: '%', source: 'user_override' },
        'Is that a 5-point rise in “Footfall loss from price rise” (30% → 35%), or 5% of today’s 30%, i.e. 31.5%?'],
      ['Olumi-estimated 0 (cee_inference): no typed zero, generic example', { value: 0, raw_value: 0, cap: 100, unit: '%', source: 'cee_inference' },
        'Is that a 5-point rise in “Footfall loss from price rise” (say 10% → 15%), or 5% of today’s level?'],
      ['a 0 with no source: no typed zero, generic example', { value: 0, raw_value: 0, cap: 100, unit: '%' },
        'Is that a 5-point rise in “Footfall loss from price rise” (say 10% → 15%), or 5% of today’s level?'],
      ['Olumi-estimated 30%: never shown as today’s level', { value: 0.3, raw_value: 30, cap: 100, unit: '%', source: 'cee_inference' },
        'Is that a 5-point rise in “Footfall loss from price rise” (say 10% → 15%), or 5% of today’s level?'],
      ['user-stated 98%: points would pass 100%, so the generic example', { value: 0.98, raw_value: 98, cap: 100, unit: '%', source: 'user_override' },
        'Is that a 5-point rise in “Footfall loss from price rise” (say 10% → 15%), or 5% of today’s level?'],
    ] as const)('F1 contrast, %s: ONE question, nothing prepared or written', async (_name, os, question) => {
      for (const shape of ['single', 'grouped'] as const) {
        const w = world(levelled({ ...os }));
        const r = await proposeAs(w, shape, SAID_BARE, BARE);
        expect(r, JSON.stringify(r)).toMatchObject({ ok: false, mutated: false, refusal: 'unit_mismatch' });
        expect(String(r.detail)).toContain(question);
        if (shape === 'single') expect(r.question).toBe(question);
        expect(w.attempts).toEqual([]); expect(w.commits).toEqual([]);
      }
    });
    it('F1 each end on its own: the user\'s 0 settles the source; the target\'s Olumi-estimated level is still asked', async () => {
      const w = world(levelled({ value: 0, raw_value: 0, cap: 100, unit: '%', source: 'user_override' },
        { value: 0.54, raw_value: 54, cap: 100, unit: '%', source: 'cee_inference' }));
      const said = 'Each 5% of footfall loss costs us about 2% of gross margin.';
      const r = await proposeAs(w, 'single', said, { ...BARE, amount_unit: '%' });
      expect(r.question).toBe('Is that a 2-point fall in “Gross margin” (say 12% → 10%), or 2% of today’s level?');
      expect(w.attempts).toEqual([]);
    });
    /** The source with NO stored cap or scale_frame: the writer pins % on 100, so the reader must too (Codex r1 HIGH). */
    const capless = (source: string | undefined): Json => {
      const graph = unsizedGraph();
      delete nodeOf(graph, SOURCE).scale_frame;
      nodeOf(graph, SOURCE).observed_state = { value: 0, raw_value: 0, unit: '%', ...(source === undefined ? {} : { source }) };
      nodeOf(graph, TARGET).goal_threshold_unit = '%';
      return projectGraphForPersistence(GraphV3.parse(graph)) as Json;
    };
    it.each([['cee_inference'], [undefined]] as const)('F1 no stored cap, source %s: the pinned % frame still asks U3; nothing prepared', async source => {
      const w = world(capless(source));
      const r = await proposeAs(w, 'single', SAID_BARE, BARE);
      expect(r.question, JSON.stringify(r)).toBe('Is that a 5-point rise in \u201cFootfall loss from price rise\u201d (say 10% \u2192 15%), or 5% of today\u2019s level?');
      expect(w.attempts).toEqual([]);
    });
    it('F1 no stored cap, the user\'s 0: never the bare % card; the writer cannot size points off a frame of 1, so no card (follow-up row)', async () => {
      const w = world(capless('user_override'));
      const r = await proposeAs(w, 'single', SAID_BARE, BARE);
      expect(r, JSON.stringify(r)).toMatchObject({ ok: false, mutated: false, refusal: 'unit_mismatch' });
      expect(w.attempts).toEqual([]);
      expect(applyLinkEffectEdit(writerParams(capless('user_override'), SAID_BARE, BARE))).toEqual({ kind: 'refused', reason: 'unit_mismatch' });
    });
    it('Codex r1 HIGH: another quantity\'s "from 20% to 25%" never settles, or is shown as, the source\'s change', async () => {
      const said = 'Footfall loss rises by 5% and revenue moves from 20% to 25% while gross margin falls by 2 percentage points.';
      const w = world(levelled({ value: 0, raw_value: 0, cap: 100, unit: '%', source: 'cee_inference' }));
      const r = await proposeAs(w, 'single', said, BARE);
      expect(r.question, JSON.stringify(r)).toBe('Is that a 5-point rise in \u201cFootfall loss from price rise\u201d (say 10% \u2192 15%), or 5% of today\u2019s level?');
      expect(w.attempts).toEqual([]);
    });
    it('F1 writer: a forged reading that stores a bare % at the user\'s 0 is refused at commit (the card said points)', () => {
      const graph = levelled({ value: 0, raw_value: 0, cap: 100, unit: '%', source: 'user_override' });
      expect(applyLinkEffectEdit(writerParams(graph, SAID_BARE, BARE))).toEqual({ kind: 'refused', reason: 'unit_mismatch' });
      const points = applyLinkEffectEdit(writerParams(graph, SAID_BARE, { ...BARE, per_source_change_unit: 'percentage points' }));
      expect(points.kind, JSON.stringify(points)).toBe('mutated');
    });
  });

  it.each(['observed level', 'other outgoing sized link', 'other incoming sized link'] as const)(
    'C2 U1: %s prevents source adoption, nothing prepared or written', async kind => {
      const graph = unsizedGraph();
      if (kind === 'observed level') nodeOf(graph, SOURCE).observed_state = { value: 0.1, raw_value: 10, cap: 100, source: 'user_override' };
      else graph.edges.push({ from: kind === 'other outgoing sized link' ? SOURCE : OTHER,
        to: kind === 'other outgoing sized link' ? OTHER : SOURCE, strength: { mean: 0.2, std: 0.1 },
        effect_direction: 'positive', exists_probability: 0.8, provenance: { source: 'user_specified', magnitude: 'user_stated',
          natural_effect: { amount: 1, amount_unit: kind === 'other incoming sized link' ? 'GBP' : 'customers',
            per_source_change: 5, per_source_change_unit: kind === 'other outgoing sized link' ? 'GBP' : 'customers',
            strength_mean: 0.2, strength_mean_frame: 'edge_strength' } } });
      const w = world(projectGraphForPersistence(graph) as Json);
      const before = w.graph();
      const prepared = prepareLinkEffectUnitReadings(before, SOURCE, TARGET, EFFECT, SAID_POINTS);
      expect(prepared.unit_readings.some(item => item.node_id === SOURCE)).toBe(false);
      const r = await propose(w);
      expect(r, JSON.stringify(r)).toMatchObject({ ok: false, refusal: 'unit_mismatch' });
      // Never a dead end: an end step 2 may not adopt keeps step 1's Science-checked canvas route, verbatim.
      expect(String(r.detail)).toBe('Nothing was prepared. Tell the user exactly this: "'
        + `\u201c${FOOTFALL}\u201d and \u201c${MARGIN}\u201d have no unit or scale in this model yet, so I can\u2019t record your figure from chat, `
        + `and nothing was recorded. You can set how strong this link is now: on the canvas, click the link from \u201c${FOOTFALL}\u201d `
        + `to \u201c${MARGIN}\u201d, and under \u201cHow strong is this effect?\u201d choose Slight, Moderate, Strong or Very strong. `
        + 'That records how strong you judge the link, not your figure."');
      expect(w.attempts).toEqual([]);
      expect(w.graph()).toEqual(before);
    });

  it.each(['label', 'other_reading', 'wrong_reading'] as const)(
    'C3 real commit refuses an unapproved writer postimage: %s', async field => {
      const graph = unsizedGraph();
      const approved = approvedEffect(writerParams(graph));
      const w = world(graph);
      sabotage.field = field;
      const out = await executeOptionInterventionBatch({ scenarioId: SCENARIO, turnId: 'c3-scope', requestId: 'c3-scope',
        requestHash: 'c3-scope', expectedGraphHash: hashOf(graph), stage: 'frame', freshness: 'fresh',
        hasExistingAnalysis: false, targets: [], linkEffect: approved }, createMockSessionStore({
          loadGraph: async () => graph, readMostRecentPendingActions: async () => [],
          append: async write => { w.attempts.push(write); throw new Error('scope violation reached append'); },
        }));
      expect(out).toEqual({ kind: 'refused', reason: 'link_scope_mismatch' });
      expect(w.attempts).toEqual([]);
    });

  it('C3 guard admits exactly the approved end readings and rejects another node reading or node field', () => {
    const before = unsizedGraph();
    const params = writerParams(before);
    const result = applyLinkEffectEdit(params);
    if (result.kind !== 'mutated') throw new Error(JSON.stringify(result));
    const after = result.mutatedGraph as Json;
    const links = [approvedEffect(params)];
    expect(linkStrengthsPostimageIsScoped(before, after, links)).toBe(true);
    const otherReading = structuredClone(after);
    nodeOf(otherReading, OTHER).unit_reading = reading('GBP', '£1');
    expect(linkStrengthsPostimageIsScoped(before, otherReading, links)).toBe(false);
    const renamed = structuredClone(after);
    nodeOf(renamed, SOURCE).label = 'Not approved';
    expect(linkStrengthsPostimageIsScoped(before, renamed, links)).toBe(false);
  });

  it('C4 both consumers use an adopted reading; each own unit wins over that fallback', () => {
    const graph = unsizedGraph();
    nodeOf(graph, SOURCE).unit_reading = reading('%', SOURCE_CLAUSE);
    expect(magnitudeNodes(graph.nodes, percentLevelIds(graph)).get(SOURCE)!.unit).toBe('%');
    expect(nodeUnitOf(graph.nodes)(SOURCE)).toBe('%');
    const withData = structuredClone(graph);
    nodeOf(withData, SOURCE).data = { unit: 'GBP' };
    expect(magnitudeNodes(withData.nodes, new Set()).get(SOURCE)!.unit).toBe('GBP');
    const withOwn = structuredClone(graph);
    nodeOf(withOwn, SOURCE).observed_state = { unit: 'customers', value: 0.1 };
    expect(unitOf(magnitudeNodes(withOwn.nodes, new Set()).get(SOURCE)!)).toBe('customers');
    expect(nodeUnitOf(withOwn.nodes)(SOURCE)).toBe('customers');
    nodeOf(withOwn, SOURCE).unit = 'GBP';
    expect(nodeUnitOf(withOwn.nodes)(SOURCE)).toBe('GBP'); // P5 already read a top-level unit first; unchanged.
  });

  // DL 5999243055: only the USER's stated reading governs a unit; an Olumi-written one never moves P5.
  it('goal path: the user\'s stated reading on the GOAL end is the unit both readers use (it has no own unit)', () => {
    const graph = unsizedGraph();
    nodeOf(graph, TARGET).unit_reading = reading('%', TARGET_CLAUSE);
    expect(nodeUnitOf(graph.nodes)(TARGET)).toBe('%');
    expect(magnitudeNodes(graph.nodes, percentLevelIds(graph)).get(TARGET)!.unit).toBe('%');
  });

  it('contrast: an Olumi-written reading on the same goal end is read by NEITHER reader, and P5 is unchanged', () => {
    const plain = unsizedGraph();
    const olumi = unsizedGraph();
    nodeOf(olumi, TARGET).unit_reading = { unit: '%', source: 'olumi_reading', source_quote: 'Olumi read gross margin as %' };
    expect(nodeUnitOf(olumi.nodes)(TARGET)).toBeUndefined();
    expect(magnitudeNodes(olumi.nodes, percentLevelIds(olumi)).get(TARGET)!.unit).toBeNull();
    expect(targetTestabilityOf(olumi)).toEqual(targetTestabilityOf(plain));
    // data.unit never reaches P5's reader either.
    const withData = unsizedGraph();
    nodeOf(withData, TARGET).data = { unit: '%' };
    expect(nodeUnitOf(withData.nodes)(TARGET)).toBeUndefined();
  });

  it('M1 target-% twin asks about its own bare %; pp on source cannot license the other end', async () => {
    const said = 'Each 5 percentage points of footfall loss costs us about 2% of gross margin.';
    const w = world();
    const effect = { ...EFFECT, amount_unit: '%' };
    const prepared = prepareLinkEffectUnitReadings(w.graph(), SOURCE, TARGET, effect, said);
    expect(prepared.unit_readings).toEqual([{ node_id: SOURCE, unit_reading: reading('%', SOURCE_CLAUSE) }]);
    expect(prepared.ask).toContain(`\u201c${MARGIN}\u201d`);
    const out = await propose(w, said, effect);
    expect(out).toMatchObject({ ok: false, refusal: 'unit_mismatch' });
    expect(w.attempts).toEqual([]);
  });

  it('stale adoption rechecks U1 on persisted nodes even when only identity content changed', () => {
    const before = unsizedGraph();
    const params = writerParams(before);
    const now = structuredClone(before);
    nodeOf(now, SOURCE).unit_reading = reading('GBP', 'Each £5');
    expect(hashOf(now)).toBe(hashOf(before)); // unit_reading is outside analysis hash, within identity hash.
    const result = applyLinkEffectEdit({ ...params, persistedGraph: now });
    expect(result).toMatchObject({ kind: 'refused' });
    expect(nodeOf(now, SOURCE).unit_reading).toEqual(reading('GBP', 'Each £5'));
    expect(linkOf(now).provenance).not.toHaveProperty('natural_effect');
  });

  it('readback checks each adopted unit by node id before reporting an applied approval', async () => {
    const w = world(unsizedGraph(), { dropReadingOnAgentRead: SOURCE });
    const { out } = await approve(w, await propose(w));
    expect(w.attempts).toHaveLength(1);
    expect(nodeOf(w.graph(), SOURCE).unit_reading).toEqual(reading('%', SOURCE_CLAUSE));
    expect(out.ok, JSON.stringify(out)).toBe(false);
    expect(out.applied).not.toBe(true);
  });
});
