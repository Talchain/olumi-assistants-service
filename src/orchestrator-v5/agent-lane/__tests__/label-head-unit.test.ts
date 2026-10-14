/** MC own-label unit class. Banked endpoints/edges, no LLM. Verification belongs to the DL; not run by this lane. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GraphV3, NodeV3 } from '../../../schemas/cee-v3.js';
import { magnitudeNodes } from '../../../cee/magnitude/frame-defaulted-links.js';
import { deriveNotModelledManifest } from '../../../cee/context-integrity/not-modelled-manifest.js';
import { statedEffectQuoteMatches, statedSwitchEffectQuoteMatches } from '../../../cee/provenance/stated-effect.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { applyLinkEffectEdit, linkEffectEdgeToken, linkEffectReadingToken } from '../../system-events/link-effect-edit.js';
import { prepareLinkEffectUnitReadings } from '../../system-events/link-effect-unit-reading.js';
import type { CommitOptionLevelsInput, CommitOptionLevelsResult } from '../../system-events/dispatch.js';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
import { approvalChipsFor } from '../approval-chips.js';
import type { LabelHeadReading } from '../label-head-unit.js';
import { ProposalStore } from '../proposal.js';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import { bindStatedLinkSizes } from '../stated-size-binding.js';
import { linkEffectTheUserStated } from '../stated-by-user.js';

// The new leaf is absent at base. Fall back there so the banked DOOR rows fail at their assertions, not at import.
const labelReaderPath = '../label-head-unit.js';
const { canAdoptLabelUnit, labelHeadUnit }: Pick<typeof import('../label-head-unit.js'), 'canAdoptLabelUnit' | 'labelHeadUnit'> =
  await import(labelReaderPath).catch(() => ({ canAdoptLabelUnit: () => false, labelHeadUnit: () => undefined }));

type Rec = Record<string, any>;
const BANK = JSON.parse(readFileSync(new URL('./fixtures/label-head-unit-banked.json', import.meta.url), 'utf8')) as Record<string, { graph: Rec }>;
const ROWS = [
  { bank: 'mealkit-14', from: 'pause_option_availability', to: 'monthly_cancellations', amount: -40,
    unit: 'cancellations/month', perUnit: 'switch', quote: 'The pause option would cut monthly cancellations by about 40.' },
  { bank: 'consult-12', from: 'additional_senior_consultants', to: 'additional_senior_billable_days', amount: 150,
    unit: 'days/year', perUnit: 'consultants', quote: 'Each senior consultant should bill about 150 days a year.' },
  { bank: 'dental-4', from: 'appointments_cancelled_or_rescheduled_in_advance', to: 'no_shows', amount: -1,
    unit: 'no-shows', perUnit: 'appointments', quote: 'Each appointment cancelled in advance prevents about 1 no-show.' },
  { bank: 'bakery-6', from: 'shops_closed', to: 'annual_weak_shop_losses_avoided', amount: 40000,
    unit: 'GBP/year', perUnit: 'shops', quote: 'Each shop we close avoids about £40k a year of losses.' },
] as const;
type Row = Omit<typeof ROWS[number], 'amount'> & { readonly amount: number };
const nodeOf = (g: Rec, id: string): Rec => g.nodes.find((n: Rec) => n.id === id)!;
const edgeOf = (g: Rec, r: Row): Rec => g.edges.find((e: Rec) => e.from === r.from && e.to === r.to)!;
const effectOf = (r: Row) => ({ amount: r.amount, amount_unit: r.unit, per_source_change: 1, per_source_change_unit: r.perUnit });

/** Explicit U1-compatible twin: retain topology, remove dental's three earlier percentage-sized incoming tuples. */
function bankFor(r: Row, dentalUnsized = true): Rec {
  const g = structuredClone(BANK[r.bank]!.graph);
  if (r.bank === 'dental-4' && dentalUnsized) {
    for (const e of g.edges as Rec[]) if (e.to === r.from) delete e.provenance.natural_effect;
  }
  return g;
}
function bind(g: Rec, r: Row, quote: string = r.quote) {
  const readings = new Map<string, LabelHeadReading>();
  const at = g.edges.indexOf(edgeOf(g, r));
  const links = (g.edges as Rec[]).map((e, i) => ({ from: e.from as string, to: e.to as string,
    effect_direction: e.effect_direction as string,
    natural_effect: i === at ? { ...effectOf(r), amount_unit: '',
      per_source_change_unit: r.bank === 'dental-4' ? '' : r.perUnit } : e.provenance?.natural_effect }));
  const nodes = (g.nodes as Rec[]).map(n => ({ ...n, id: n.id as string, label: n.label as string,
    unit: n.unit ?? n.observed_state?.unit ?? n.data?.unit ?? n.goal_threshold_unit ?? n.unit_reading?.unit }));
  return { bound: bindStatedLinkSizes(links, nodes, quote, [], { labelUnits: readings }), readings, at };
}

describe('MC own-label units: the four banked readings (expected RED at base)', () => {
  it.each(ROWS)('$bank binds only the sentence and writes its own noun/period reading (consult: explicit two-end twin)', r => {
    const graph = bankFor(r);
    // The consult bank also names ‘Billable days per senior consultant’ and ‘Annual billable days’.
    // Its unchanged third-quantity refusal is checked below; this positive twin contains only the two banked ends.
    if (r.bank === 'consult-12') {
      graph.edges = [edgeOf(graph, r)];
      graph.nodes = [nodeOf(graph, r.from), nodeOf(graph, r.to)];
    }
    const before = structuredClone(graph);
    const { bound, readings, at } = bind(graph, r);
    expect(bound.get(at)).toBe(r.quote);
    expect(readings.get(r.to)?.unit).toBe(r.unit);
    if (r.bank === 'dental-4') expect(readings.get(r.from)?.unit).toBe('appointments');
    expect(graph).toEqual(before); // the binder only returns attestations; admission owns writes.
    const prepared = prepareLinkEffectUnitReadings(graph, r.from, r.to, effectOf(r), r.quote);
    expect(prepared.ask).toBeUndefined();
    expect(prepared.unit_readings.find(x => x.node_id === r.to)?.unit_reading).toMatchObject({ unit: r.unit, source: 'user_stated' });
  });

  it('consult: the unchanged bank names other quantities, so the existing sentence gate refuses adoption', () => {
    const r = ROWS[1], graph = bankFor(r), before = structuredClone(graph);
    const { bound, readings, at } = bind(graph, r);
    expect(bound.has(at)).toBe(false);
    expect(readings.size).toBe(0);
    expect(graph).toEqual(before);
  });

  it('dental: the explicit target 1 and implied source each locate different nouns', () => {
    const r = ROWS[2], g = bankFor(r);
    const ends = { source: nodeOf(g, r.from).label, target: nodeOf(g, r.to).label };
    expect(statedEffectQuoteMatches(r.quote, effectOf(r), undefined, ends)).toBe(true);
    expect(labelHeadUnit(r.quote, 1, ends.source, ends.target, true)).toMatchObject({ unit: 'appointments', implicit: true });
    expect(labelHeadUnit(r.quote, -1, ends.target, ends.source)).toMatchObject({ unit: 'no-shows' });
    expect(linkEffectTheUserStated(r.quote, effectOf(r), ends,
      { quantities: [], source_unitless: true, target_unitless: true })).toBeNull();
    expect(linkEffectTheUserStated('Each appointment rescheduled in advance prevents about 1 no-show.',
      { ...effectOf(r), per_source_change_unit: 'rescheduled' }, ends,
      { quantities: [], source_unitless: true, target_unitless: true })).toBe('figure_counts_another_unit');
  });

  it('bakery: £40k stays 40,000 pounds/year, with the verbatim local currency receipt', () => {
    const r = ROWS[3], g = bankFor(r);
    expect(statedEffectQuoteMatches(r.quote, effectOf(r), undefined,
      { source: nodeOf(g, r.from).label, target: nodeOf(g, r.to).label })).toBe(true);
    const reading = labelHeadUnit(r.quote, 40000, nodeOf(g, r.to).label, nodeOf(g, r.from).label)!;
    expect(reading.unit).toBe('GBP/year');
    expect(reading.source_quote).toBe('£40k a year of losses');
    expect(r.quote.slice(reading.amount.start, reading.amount.end).trim()).toBe('£40k');
  });

  it.each(['Monthly cancellation', 'Cancellations/month'])('singular/plural and period equivalent label: %s', label => {
    const r = ROWS[0], g = bankFor(r);
    nodeOf(g, r.to).label = label;
    expect(bind(g, r).readings.get(r.to)?.unit).toBe('cancellations/month');
  });
});

describe('MC own-label units: MUST NOT controls', () => {
  it.each([
    { r: ROWS[1], quote: 'Each senior consultant should bill about 150 consultants a year.' },
    { r: ROWS[0], quote: 'The pause option would cut late deliveries by about 40.' },
    { r: ROWS[0], quote: 'The pause option would cut monthly cancellations by about 40%.' },
    { r: ROWS[0], quote: 'The pause option would cut monthly cancellations by about 40 a year.' },
    { r: ROWS[1], quote: 'Each senior consultant should bill about 150 days customers a year.' },
  ])('$quote remains unbound and adopts no unit', ({ r, quote }) => {
    const { bound, readings } = bind(bankFor(r), r, quote);
    expect(bound.size).toBe(0);
    expect(readings.size).toBe(0);
  });

  it('a measure different from the label head stays unbound: response time is not hours', () => {
    const r = { ...ROWS[0], amount: -2 } as Row;
    const g = bankFor(r);
    nodeOf(g, r.to).label = 'Customer response time';
    const quote = 'The pause option would cut customer response time by about 2 hours.';
    expect(bind(g, r, quote).bound.size).toBe(0);
    expect(labelHeadUnit(quote, -2, 'Customer response time', 'Pause option availability')).toBeUndefined();
  });

  it.each([
    { observed_state: { value: 0 } }, { observed_state: { raw_value: 0 } }, { observed_state: { baseline: 0 } },
    { unit: 'tickets' }, { data: { unit: 'tickets' } }, { unit_reading: { unit: 'tickets', source: 'user_stated' } },
    { goal_threshold_unit: 'tickets' }, { goal_threshold_raw: 0 },
  ])('U1: a stored unit or level blocks adoption: %j', patch => {
    const r = ROWS[0], g = bankFor(r);
    Object.assign(nodeOf(g, r.to), patch);
    expect(bind(g, r).bound.size).toBe(0);
    expect(prepareLinkEffectUnitReadings(g, r.from, r.to, effectOf(r), r.quote).unit_readings).toEqual([]);
    expect(canAdoptLabelUnit(patch, [], r.unit)).toBe(false);
  });

  it('U1: the unchanged dental bank has percentage-sized parents; never re-unit them as appointments', () => {
    const r = ROWS[2], g = bankFor(r, false);
    expect(g.edges.filter((e: Rec) => e.to === r.from && e.provenance?.natural_effect).length).toBe(3);
    expect(bind(g, r).bound.size).toBe(0);
    expect(prepareLinkEffectUnitReadings(g, r.from, r.to, effectOf(r), r.quote).unit_readings
      .some(x => x.node_id === r.from)).toBe(false);
  });

  it('U1: another sized link in a different unit blocks adoption; the same unit does not', () => {
    const r = ROWS[0];
    for (const [unit, allowed] of [['deliveries', false], ['cancellations/month', true]] as const) {
      const g = bankFor(r);
      const sibling = g.edges.find((e: Rec) => e.to === r.to && e.from !== r.from)!;
      sibling.provenance.natural_effect = { amount: -1, amount_unit: unit, per_source_change: 1, per_source_change_unit: '%' };
      expect(bind(g, r).readings.has(r.to)).toBe(allowed);
      expect(prepareLinkEffectUnitReadings(g, r.from, r.to, effectOf(r), r.quote).unit_readings
        .some(x => x.node_id === r.to)).toBe(allowed);
    }
  });

  it('U3: a bare percent still asks; 40% is never 40 cancellations', () => {
    const r = ROWS[0], g = bankFor(r);
    const quote = 'The pause option would cut monthly cancellations by about 40%.';
    const prepared = prepareLinkEffectUnitReadings(g, r.from, r.to, { ...effectOf(r), amount_unit: '%' }, quote);
    expect(prepared.unit_readings).toEqual([]);
    expect(prepared.ask).toContain('40-point');
    expect(labelHeadUnit(quote, -40, nodeOf(g, r.to).label, nodeOf(g, r.from).label)).toBeUndefined();
  });

  it('W3/sign/excluded spans still gate adoption before admission can write it', () => {
    const r = ROWS[0], g = bankFor(r);
    expect(bind(g, r, `${r.quote} ${r.quote}`).readings.size).toBe(0);
    edgeOf(g, r).effect_direction = 'positive';
    expect(bind(g, r).readings.size).toBe(0);
    const readings = new Map<string, LabelHeadReading>();
    expect(bindStatedLinkSizes([{ from: r.from, to: r.to, effect_direction: 'negative', natural_effect: effectOf(r) }],
      [{ id: r.from, label: nodeOf(g, r.from).label }, { id: r.to, label: nodeOf(g, r.to).label }], r.quote,
      [{ start: r.quote.indexOf('40'), end: r.quote.indexOf('40') + 2 }], { labelUnits: readings }).size).toBe(0);
    expect(readings.size).toBe(0);
  });

  it('two otherwise distinct sentences cannot adopt different currencies for one shared end', () => {
    const r = ROWS[3], g = bankFor(r);
    const source = 'central_kitchen_fit_out_cost';
    g.edges.push({ from: source, to: r.to, effect_direction: 'positive',
      provenance: { natural_effect: { amount: 40000, amount_unit: '', per_source_change: 1, per_source_change_unit: 'GBP' } } });
    const quote = `${r.quote} Each £1 of central kitchen fit-out cost avoids about $40k a year of losses.`;
    const result = bind(g, r, quote);
    expect(result.bound.size).toBe(0); expect(result.readings.size).toBe(0);
  });
});

/** Banked topology, with explicit test frames only where the bank has none or cannot fit the new natural amount.
 * These frames are test inputs, never units/levels inferred by this implementation. */
function framedForChat(r: Row): Rec {
  const g = bankFor(r);
  if (r.bank === 'mealkit-14') nodeOf(g, r.to).scale_frame = 5000;
  if (r.bank === 'dental-4') nodeOf(g, r.to).scale_frame = 100;
  if (r.bank === 'bakery-6') nodeOf(g, r.to).scale_frame = 1000000;
  return g;
}
const scenario = '550e8400-e29b-41d4-a716-4466554400a7';
const saying = (user_text: string) => ({ scenario_id: scenario, authenticated_user_id: null, request_id: 'mc-label-unit', user_text });
function world(graph: Rec) {
  const store = new ProposalStore();
  const commits: CommitOptionLevelsInput[] = [];
  const dispatch: InternalDispatch = async path => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph, graph_hash: computeAnalysisAffectingGraphHash(graph as never) } };
    throw new Error(`Unexpected dispatch ${path}`);
  };
  const commitOptionLevels = async (input: CommitOptionLevelsInput): Promise<CommitOptionLevelsResult> => {
    commits.push(input);
    const le = (input.link_effect ?? input.link_effects?.[0])!;
    const applied = applyLinkEffectEdit({ persistedGraph: graph, from: le.from, to: le.to, effect: le.effect,
      expected: { graph_hash: input.base_graph_hash, edge_token: le.edge_token }, quote: le.quote,
      reading_token: le.reading_token, unit_readings: le.unit_readings, reversal: le.reversal, link_selected: le.link_selected });
    if (applied.kind === 'refused') throw new Error(`Writer refused: ${applied.reason}`);
    const reloaded = GraphV3.parse(applied.mutatedGraph);
    graph.nodes = reloaded.nodes; graph.edges = reloaded.edges;
    return { status: 'committed', graph_hash: computeAnalysisAffectingGraphHash(graph as never)!, receipt: null,
      already_applied: false, committed_levels: [], links_resized: [] };
  };
  return { store, commits, caps: createAgentCapabilities(dispatch, store, undefined, 'full', undefined, { commitOptionLevels }) };
}

describe('MC answer door: consent, atomic writer and strict reload (expected RED at base)', () => {
  it.each(ROWS.flatMap(r => [{ ...r, lane: 'single' }, { ...r, lane: 'grouped' }]))(
    '$bank $lane prepares without writing; approval stores the stated size and governing reading together', async r => {
    const graph = framedForChat(r), before = structuredClone(graph);
    const { caps, store, commits } = world(graph);
    const args = { from_label: nodeOf(graph, r.from).label, to_label: nodeOf(graph, r.to).label, ...effectOf(r), quote: r.quote };
    const proposal = await caps.proposeLinkEffect!(saying(r.quote), r.lane === 'grouped' ? { links: [args] } : args) as Rec;
    expect(proposal, JSON.stringify(proposal)).toMatchObject({ ok: true, mutated: false });
    expect(graph).toEqual(before); expect(commits).toEqual([]);
    const card = approvalChipsFor([{ name: 'propose_link_effect', ok: true, mutated: false, proposal_id: String(proposal.proposal_id) }],
      id => ({ proposal: store.get(id), result: proposal as never }))[0]!;
    expect(card.detail).toContain(r.unit);
    expect(card.detail).toContain(r.quote);
    expect(store.get(String(proposal.proposal_id))!.operations[0]!.value).not.toHaveProperty('mediator_readings');
    const approved = await caps.authoriseChange!({ ...saying(card.message), typed_approval_of: String(proposal.proposal_id),
      typed_approval_words: card.message }, { proposal_id: String(proposal.proposal_id) }) as Rec;
    expect(approved, JSON.stringify(approved)).toMatchObject({ ok: true, applied: true, mutated: true });
    expect(commits).toHaveLength(1);
    expect(edgeOf(graph, r).provenance).toMatchObject({ magnitude: 'user_stated', source_quote: r.quote,
      natural_effect: effectOf(r) });
    const node = NodeV3.parse(nodeOf(graph, r.to));
    expect(node.unit_reading).toMatchObject({ unit: r.unit, source: 'user_stated' });
    expect(node.observed_state).toEqual(nodeOf(before, r.to).observed_state);
    expect(magnitudeNodes(graph.nodes, new Set()).get(r.to)?.unit).toBe(r.unit);
    expect(computeAnalysisAffectingGraphHash(graph as never)).not.toBe(computeAnalysisAffectingGraphHash(before as never));
    if (r.bank === 'bakery-6') {
      const held = deriveNotModelledManifest(r.quote, graph).quantities?.items.find(x => x.literal === '£40k');
      expect(held).toMatchObject({ verdict: 'in_model', matched_node_id: r.to });
      // Currency plus ‘each shop’ already verifies through the literal grammar, independently of the new receipt.
      expect(statedEffectQuoteMatches(r.quote, effectOf(r))).toBe(true);
      nodeOf(graph, r.to).unit_reading.source = 'olumi_reading';
      const literal = deriveNotModelledManifest(r.quote, graph).quantities?.items.find(x => x.literal === '£40k');
      expect(literal).toMatchObject({ verdict: 'in_model', matched_node_id: r.to });
    }
    if (r.bank === 'mealkit-14') {
      // This backward noun really needs the label grammar. An inferred-provenance twin has no chat/brief C3 fallback.
      const receiptTwin = structuredClone(graph);
      edgeOf(receiptTwin, r).provenance.source = 'cee_hypothesis';
      expect(statedSwitchEffectQuoteMatches(r.quote, effectOf(r))).toBe(false);
      const held = deriveNotModelledManifest(r.quote, receiptTwin).quantities?.items.find(x => x.literal === '40');
      expect(held).toMatchObject({ verdict: 'in_model', matched_node_id: r.to });
      // The receipt locates only this quote's numeral; an unrelated bare 40 is still outside the search.
      const withOtherNumber = deriveNotModelledManifest(`${r.quote} Another estimate is 40.`, receiptTwin).quantities;
      expect(withOtherNumber?.items.filter(x => x.literal === '40')).toHaveLength(1);
      expect(withOtherNumber?.items.find(x => x.literal === '40')).toMatchObject({ verdict: 'in_model', matched_node_id: r.to });
      for (const invalidate of [
        (g: Rec) => { delete nodeOf(g, r.to).unit_reading; },
        (g: Rec) => { delete edgeOf(g, r).provenance.source_quote; delete edgeOf(g, r).provenance.quote; },
        (g: Rec) => { edgeOf(g, r).provenance.magnitude = 'inferred'; },
        (g: Rec) => { edgeOf(g, r).provenance.natural_effect.amount = 40; },
        (g: Rec) => { edgeOf(g, r).provenance.natural_effect.amount_unit = 'cancellations/year'; },
      ]) {
        const invalid = structuredClone(receiptTwin);
        invalidate(invalid);
        expect(deriveNotModelledManifest(r.quote, invalid).quantities?.items.find(x => x.literal === '40')).toBeUndefined();
      }
      expect(deriveNotModelledManifest(`${r.quote} ${r.quote}`, receiptTwin).quantities?.items.find(x => x.literal === '40')).toBeUndefined();
      nodeOf(receiptTwin, r.to).unit_reading.source = 'olumi_reading';
      const guessed = deriveNotModelledManifest(r.quote, receiptTwin).quantities?.items.find(x => x.literal === '40');
      expect(guessed).toBeUndefined();
    }
  });

  it('mealkit without a measurement frame still refuses the atomic write, without inventing a level or range', async () => {
    const r = ROWS[0], graph = bankFor(r), before = structuredClone(graph);
    const { caps, store, commits } = world(graph);
    const result = await caps.proposeLinkEffect!(saying(r.quote), { from_label: nodeOf(graph, r.from).label,
      to_label: nodeOf(graph, r.to).label, ...effectOf(r), quote: r.quote }) as Rec;
    expect(result).toMatchObject({ ok: false, refusal: 'unconvertible' });
    expect(graph).toEqual(before); expect(commits).toEqual([]); expect(store.size()).toBe(0);
  });

  it.each([
    { r: ROWS[1], quote: 'Each senior consultant should bill about 150 consultants a year.', why: 'figure_of_another_quantity' },
    { r: ROWS[0], quote: 'The pause option would cut late deliveries by about 40.', why: 'figure_of_another_quantity' },
    { r: ROWS[0], quote: 'The pause option would cut monthly cancellations by about 40%.', why: undefined },
  ])('answer MUST NOT: $quote prepares no card and leaves every byte intact', async ({ r, quote, why }) => {
    const graph = framedForChat(r), before = structuredClone(graph);
    const { caps, store, commits } = world(graph);
    const out = await caps.proposeLinkEffect!(saying(quote), { from_label: nodeOf(graph, r.from).label,
      to_label: nodeOf(graph, r.to).label, ...effectOf(r), quote }) as Rec;
    expect(out.ok).toBe(false); expect(out).not.toHaveProperty('proposal_id');
    if (why !== undefined) expect(out.why).toBe(why);
    expect(store.size()).toBe(0); expect(commits).toEqual([]); expect(graph).toEqual(before);
  });

  it('the writer independently rechecks U1 if an identity-only unit arrives after preparation', () => {
    const r = ROWS[1], graph = framedForChat(r), effect = effectOf(r);
    const prepared = prepareLinkEffectUnitReadings(graph, r.from, r.to, effect, r.quote);
    const expected = { graph_hash: computeAnalysisAffectingGraphHash(graph as never)!, edge_token: linkEffectEdgeToken(graph, r.from, r.to)! };
    const reading_token = linkEffectReadingToken({ from: r.from, to: r.to, effect, quote: r.quote, unit_readings: prepared.unit_readings });
    nodeOf(graph, r.to).unit_reading = { unit: 'tickets', source: 'olumi_reading', source_quote: 'A later interpretation.' };
    expect(computeAnalysisAffectingGraphHash(graph as never)).toBe(expected.graph_hash);
    const before = structuredClone(graph);
    expect(applyLinkEffectEdit({ persistedGraph: graph, from: r.from, to: r.to, effect, quote: r.quote, expected,
      unit_readings: prepared.unit_readings, reading_token })).toMatchObject({ kind: 'refused', reason: 'unit_mismatch' });
    expect(graph).toEqual(before);
  });

  it('an unwritten negative gauge child does not reverse the own-noun reading on its approval card', async () => {
    const r = ROWS[3], graph = framedForChat(r);
    const child = graph.edges.find((e: Rec) => e.from === r.to)!;
    child.effect_direction = 'negative'; child.strength.mean = -0.5;
    const before = structuredClone(graph), { caps, store } = world(graph);
    const result = await caps.proposeLinkEffect!(saying(r.quote), { from_label: nodeOf(graph, r.from).label,
      to_label: nodeOf(graph, r.to).label, ...effectOf(r), quote: r.quote }) as Rec;
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true, mutated: false });
    const value = store.get(String(result.proposal_id))!.operations[0]!.value;
    expect(value).not.toHaveProperty('reversal'); expect(value).not.toHaveProperty('mediator_readings');
    const card = approvalChipsFor([{ name: 'propose_link_effect', ok: true, mutated: false, proposal_id: String(result.proposal_id) }],
      id => ({ proposal: store.get(id), result: result as never }))[0]!;
    expect(card.detail).toContain(r.unit);
    expect(card.detail).toContain(r.quote);
    expect(card.detail).not.toContain('REVERSAL');
    expect(card.detail).not.toContain('whole path');
    expect(graph).toEqual(before);

    // The child cannot reverse the newly measured own noun. The source link's own stored direction still governs.
    const conflicting = structuredClone(graph);
    edgeOf(conflicting, r).effect_direction = 'negative';
    edgeOf(conflicting, r).strength.mean = -0.5;
    const conflictBefore = structuredClone(conflicting);
    const effect = effectOf(r), quote = r.quote;
    const unit_readings = prepareLinkEffectUnitReadings(conflicting, r.from, r.to, effect, quote).unit_readings;
    expect(applyLinkEffectEdit({ persistedGraph: conflicting, from: r.from, to: r.to, effect, quote, unit_readings,
      expected: { graph_hash: computeAnalysisAffectingGraphHash(conflicting as never)!, edge_token: linkEffectEdgeToken(conflicting, r.from, r.to)! },
      reading_token: linkEffectReadingToken({ from: r.from, to: r.to, effect, quote, unit_readings }) }))
      .toMatchObject({ kind: 'refused', reason: 'sign_conflict' });
    expect(conflicting).toEqual(conflictBefore);
  });
});

describe('MC construction writer: admission persists only a bound own-label unit', () => {
  const r = ROWS[1];
  const candidate = (): CandidateModel => ({
    goal: { metric: 'annual gross profit', operator: '>', value: null, target_stated: false, unit: '£/year',
      horizon_months: null, provenance: 'explicit' },
    options: [{ label: 'Hire senior consultants', provenance: 'explicit', interventions: [
      { factor_label: 'Additional senior consultants', value: 3, unit: 'consultants', provenance: 'explicit' },
    ] }],
    factors: [{ label: 'Additional senior consultants', role: 'controllable', baseline_known: true, baseline_value: 0,
      unit: 'consultants', provenance: 'explicit', plausible_max: 20 }],
    risks: [], outcomes: [{ label: 'Additional senior billable days', provenance: 'inferred', unit: null, plausible_max: 3000 }],
    constraints: [], links: [{ from: 'Additional senior consultants', to: 'Additional senior billable days', direction: 'positive',
      provenance: 'explicit', effect_amount: 150, effect_per_source_change: 1, effect_provenance: 'explicit' }],
  });
  it('consult: unit_reading survives NodeV3 and sizes the stored link in days/year (expected RED at base)', () => {
    const admitted = admitCandidateModel(candidate(), undefined, r.quote, undefined, undefined, undefined, () => false);
    const target = NodeV3.parse(admitted.nodes.find(n => n.id === r.to));
    expect(target.unit_reading).toMatchObject({ unit: r.unit, source: 'user_stated', source_quote: '150 days a year' });
    expect(target.observed_state).toBeUndefined();
    expect(admitted.edges.find(e => e.from === r.from && e.to === r.to)?.provenance).toMatchObject({ magnitude: 'user_stated',
      source_quote: r.quote, natural_effect: effectOf(r) });
  });
  it('a different quantity in the sentence writes neither the label unit nor user credit', () => {
    const admitted = admitCandidateModel(candidate(), undefined, 'Each senior consultant should bill about 150 consultants a year.',
      undefined, undefined, undefined, () => false);
    expect(admitted.nodes.find(n => n.id === r.to)?.unit_reading).toBeUndefined();
    expect(admitted.edges.find(e => e.from === r.from && e.to === r.to)?.provenance?.magnitude).not.toBe('user_stated');
  });

  it('a goal endpoint keeps its user-stated period through build/register, ahead of the generic currency reading', async () => {
    const bakery = ROWS[3], g = bankFor(bakery);
    const source = nodeOf(g, bakery.from).label, target = nodeOf(g, bakery.to).label;
    const wire: CandidateModel = {
      goal: { metric: target, operator: '>', value: null, target_stated: false, unit: '', horizon_months: null,
        provenance: 'explicit', baseline_known: false, baseline_value: null },
      options: [{ label: 'Close weak shops', provenance: 'explicit', interventions: [
        { factor_label: source, value: 2, unit: 'shops', provenance: 'explicit' },
      ] }],
      factors: [{ label: source, role: 'controllable', baseline_known: true, baseline_value: 0, unit: 'shops',
        provenance: 'explicit', plausible_max: 14 }],
      risks: [], outcomes: [], constraints: [], links: [{ from: source, to: target, direction: 'positive', provenance: 'explicit',
        effect_amount: 40000, effect_per_source_change: 1, effect_provenance: 'explicit' }],
    };
    let registered: Rec | undefined;
    const dispatch: InternalDispatch = async (path, body) => {
      if (path.endsWith('/graph/register')) {
        registered = structuredClone((body as { graph: Rec }).graph);
        return { status: 200, json: { model_version: { version_number: 1 } } };
      }
      return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
    };
    const call = (async () => ({ text: JSON.stringify(wire) })) as unknown as CallStructuredModel;
    const result = await buildModelFromBrief(scenario, bakery.quote, dispatch, call) as Rec;
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
    const stored = NodeV3.parse(registered!.nodes.find((n: Rec) => n.kind === 'goal'));
    expect(stored.unit_reading).toEqual({ unit: 'GBP/year', source: 'user_stated', source_quote: '£40k a year of losses' });
    expect(stored.observed_state).toBeUndefined();
    expect(stored.goal_threshold_raw).toBeUndefined();
  });
});
