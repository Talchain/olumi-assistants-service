import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
import { buildModelFromBrief, BUILD_INSTRUCTIONS, prepareProvisionalCandidate } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { verifiedFactorLevel, verifiedGoalLevel, verifiedOptionAction, verifiedOptionSetting, verifiedOptionTotal } from '../verified-option-setting.js';
import { probeRows } from './fixtures/r5-verified-cases.js';
import { GraphV3, OptionV3, type GraphV3T } from '../../../schemas/cee-v3.js';
import { classifyValueSource, edgeReviewedByUser } from '../../../cee/graph-readiness/obligation-provenance.js';
import { transformOptionToAnalysisReady } from '../../../cee/transforms/analysis-ready.js';
import { edgeProvenanceDisplay } from '../../../cee/transforms/provenance-display.js';
import { userStatedLinkUnitsOf } from '../../../orchestrator/context/placeholder-parts.js';
import { STRUCTURAL_EDGE_DEFAULTS } from '../../../orchestrator/context/constants.js';
import { linkSizing } from '../../../cee/magnitude/link-sizing.js';
import { withHeldUserLinks } from '../../goal-target/held-user-links.js';
import { decideOptionCostAsk } from '../../coaching/decide-option-cost-ask.js';
import { prepareOptionInterventionEdit } from '../../system-events/option-intervention-edit.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { parseEditGraphResponse } from '../../../orchestrator/tools/edit-graph.js';
import { applyPatchOperations } from '../../../orchestrator/patch-applier.js';
import { encodeOptionInterventionsForEdit } from '../../../orchestrator/tools/encode-option-interventions.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';

const quote = 'Should we raise our Pro plan price from £49 to £59 a month?';
const evidence = (text: string) => ({ quote: text, start: 0, end: text.length,
  amount_start: text.indexOf('£59'), option_quote: text, option_start: 0, option_end: text.length });
const bank: { brief: string; raw: string } = JSON.parse(readFileSync(new URL('./fixtures/mrr-drafter-answer-20260930.json', import.meta.url), 'utf8'));
function priceCandidate(text = quote): CandidateModel {
  const model: CandidateModel = JSON.parse(bank.raw);
  // Disclosed fixture-contract migration only: original raw has no receipt. Raw/bank bytes are untouched.
  model.options.find(o => o.label === 'Raise price to £59')!.interventions![0]!.stated_evidence = evidence(text);
  return model;
}
function priceParts(g: GraphV3T) {
  const option = g.nodes.find(n => n.label === 'Raise price to £59')!;
  const sibling = g.nodes.find(n => n.label === 'Raise price to £54')!;
  const price = g.nodes.find(n => n.label === 'Pro plan monthly price')!;
  const edge = g.edges.find(e => e.from === option.id && e.to === price.id)!;
  return { option, sibling, price, edge, cell: option.interventions![price.id]! };
}
async function build(model: CandidateModel, brief: string) {
  let registered: unknown;
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register') && typeof body === 'object' && body !== null && 'graph' in body) registered = body.graph;
    return { status: 200, json: { graph: { nodes: [], edges: [] }, model_version: { version_number: 1 }, versions: [] } };
  };
  const result = await buildModelFromBrief('00000000-0000-4000-8000-000000000060', brief, dispatch,
    async () => ({ text: JSON.stringify(model), status: 'completed' }));
  expect(result.ok, JSON.stringify(result)).toBe(true);
  expect(registered).toBeDefined();
  return { result, graph: GraphV3.parse(projectGraphForPersistence(registered)) };
}
function addition(baseline: number | null): CandidateModel {
  const receipt = 'One option is to hire 4 more engineers.';
  return { goal: { metric: 'Completed jobs', value: 100, unit: 'jobs', operator: '>=', horizon_months: null, provenance: 'ai_proposed' },
    constraints: [], factors: [{ label: 'Engineers', role: 'controllable', baseline_known: baseline !== null,
      baseline_value: baseline, unit: 'engineers', provenance: 'inferred', plausible_max: 20 }],
    options: [{ label: 'Hire 4 engineers', provenance: 'explicit', interventions: [{ factor_label: 'Engineers',
      value: 4, unit: 'engineers', value_kind: 'additional', provenance: 'explicit', stated_evidence: evidence(receipt) }] },
    { label: 'Keep staffing', provenance: 'ai_proposed', is_status_quo: true, interventions: [] }],
    outcomes: [], risks: [], links: [{ from: 'Engineers', to: 'Completed jobs', direction: 'positive', provenance: 'ai_proposed' }] };
}

function scopeCandidate(text: string): CandidateModel {
  return { ...addition(400), factors: [{ label: 'Riders', role: 'controllable', baseline_known: true,
    baseline_value: 400, unit: 'riders', provenance: 'explicit', baseline_evidence: { quote: text } }],
    options: [{ label: '400 riders', provenance: 'explicit', interventions: [{ factor_label: 'Riders', value: 400,
      unit: 'riders', value_kind: 'absolute', provenance: 'explicit', stated_evidence: evidence(text) }] }] };
}
function scopePrice(text: string): CandidateModel {
  const model = priceCandidate(text);
  const factor = model.factors.find(f => f.label === 'Pro plan monthly price')!;
  factor.label = 'Price'; factor.unit = 'GBP';
  const option = model.options.find(o => o.label === 'Raise price to £59')!;
  option.label = 'Set price to £59';
  const iv = option.interventions![0]!; iv.factor_label = factor.label; iv.unit = factor.unit;
  return model;
}

describe('RUN60 relationship and native operand authority', () => {
  it('source → receipt → real builder: authored price relationship, unconfirmed quantitative cell', async () => {
    const model = priceCandidate(); const o = model.options.find(o => o.label === 'Raise price to £59')!;
    expect(verifiedOptionAction(model, o, o.interventions![0]!, bank.brief)).toBe(true);
    expect(verifiedOptionSetting(model, o, o.interventions![0]!, bank.brief)).toBe(false);
    const { graph, result } = await build(model, bank.brief);
    const { cell, edge, price } = priceParts(graph);
    expect(cell).toMatchObject({ raw_value: 59, source: 'cee_hypothesis', unit: 'GBP per subscriber per month' });
    expect(edge.provenance).toMatchObject({ source: 'brief_extraction', source_quote: quote });
    expect(edgeProvenanceDisplay(edge.provenance?.source)).toBe('from_brief');
    expect(edge.strength).toStrictEqual(STRUCTURAL_EDGE_DEFAULTS.strength);
    expect(edge.provenance).not.toHaveProperty('natural_effect');
    expect(linkSizing(edge)).not.toBe('user');
    expect(price.observed_state?.source).not.toBe('brief_extraction');
    expect(JSON.stringify(result)).toContain('Not confirmed from your brief');
  });
  it('relationship consumers grant no numeric, review, effect-size or current-state authority', async () => {
    const { graph } = await build(priceCandidate(), bank.brief);
    const { option, price, edge, cell } = priceParts(graph);
    expect(classifyValueSource(cell.source)).toBe('ai_drafted');
    expect(edgeReviewedByUser(edge)).toBe(false);
    expect(userStatedLinkUnitsOf(graph.nodes, [edge]).size).toBe(0);
    // Holds are evaluated independently per edge (held-user-links.ts:309–324).
    expect(withHeldUserLinks(graph).edges.find(e => e.from === option.id && e.to === price.id)).toStrictEqual(edge);
    const withoutRelationshipReceipt = structuredClone(graph);
    const unstated = withoutRelationshipReceipt.edges.find(e => e.from === option.id && e.to === price.id)!;
    unstated.provenance = { ...unstated.provenance, source: 'cee_hypothesis' };
    delete unstated.provenance.source_quote;
    // The unrelated churn route's hold does not depend on D1 relationship authorship.
    expect(withHeldUserLinks(graph).edges.filter(e => e.from === 'monthly_churn'))
      .toStrictEqual(withHeldUserLinks(withoutRelationshipReceipt).edges.filter(e => e.from === 'monthly_churn'));
    const entry = OptionV3.parse({ id: option.id, label: option.label, status: 'ready', interventions: option.interventions });
    const numeric = transformOptionToAnalysisReady(entry);
    expect(numeric.interventions[price.id]).toBe(cell.value);
    expect(numeric.extraction_metadata?.source).toBe('cee_hypothesis');
    expect(decideOptionCostAsk({ notDecisionGrade: true, ratified: [{ node_id: price.id, unit: cell.unit }],
      nodes: graph.nodes, options: [entry] })).toMatchObject({ option_id: option.id, factor_id: price.id });
  });
  it('typed edit → scoped authority → persisted projection → reload: sibling remains unconfirmed', async () => {
    const { graph } = await build(priceCandidate(), bank.brief);
    const { option, sibling, price, cell } = priceParts(graph);
    const cap = price.observed_state!.cap!;
    const edited = prepareOptionInterventionEdit({ persistedGraph: graph, optionId: option.id, factorId: price.id,
      modelValue: 60 / cap, figure: { raw_value: 60, cap, unit: cell.unit },
      expectedGraphHash: computeAnalysisAffectingGraphHash(graph)!, source: 'user_specified' });
    if (edited.kind !== 'prepared') throw new Error(JSON.stringify(edited));
    expect(edited.kind).toBe('prepared');
    const rawOperations = parseEditGraphResponse(JSON.stringify({ operations: [edited.operation], removed_edges: [], warnings: [], coaching: null })).operations;
    const applied = applyPatchOperations(graph, rawOperations);
    const authority = [{ optionId: option.id, factorId: price.id }];
    const encoded = encodeOptionInterventionsForEdit(applied, new Set([option.id]), undefined, authority);
    expect(encoded.unresolvedOptionIds).toStrictEqual([]);
    const reloaded = GraphV3.parse(JSON.parse(JSON.stringify(projectGraphForPersistence({ ...graph, ...encoded.graph }, { humanAuthority: authority }))));
    expect(reloaded.nodes.find(n => n.id === option.id)!.interventions![price.id]).toMatchObject({ raw_value: 60, source: 'user_specified' });
    expect(reloaded.nodes.find(n => n.id === sibling.id)!.interventions![price.id]).toStrictEqual(sibling.interventions![price.id]);
    expect(price.observed_state?.source).not.toBe('brief_extraction');
  });
  it('verified native +4 retains receipt and role independently of unsupported total 9, including reload basis', async () => {
    const model = addition(5); const o = model.options[0]!; const iv = o.interventions![0]!; const brief = iv.stated_evidence!.quote;
    expect(verifiedOptionSetting(model, o, iv, brief)).toBe(true);
    expect(verifiedOptionTotal(model, o, iv, brief).verified).toBe(false);
    const p = prepareProvisionalCandidate(model, brief);
    expect(p.provenance_demoted[0]?.native_addition).toStrictEqual({ claim: iv, verified: true });
    const graph = admitCandidateModel(p.candidate, {}, brief);
    const reloaded = GraphV3.parse(JSON.parse(JSON.stringify(projectGraphForPersistence(graph))));
    const factor = reloaded.nodes.find(n => n.label === 'Engineers')!;
    expect(reloaded.nodes.find(n => n.label === o.label)!.interventions![factor.id])
      .toMatchObject({ raw_value: 9, source: 'cee_hypothesis', basis: brief });
    expect(JSON.parse(JSON.stringify(p.provenance_demoted))[0].native_addition).toStrictEqual({ claim: iv, verified: true });
    const served = await build(model, brief);
    expect(JSON.stringify(served.result)).toContain('native_addition');
    expect(JSON.stringify(served.result)).toContain('Not confirmed from your brief');
  });
  for (const baseline of [null, 0]) it(`native addition over unproved ${baseline} does not manufacture a total`, () => {
    const model = addition(baseline); const iv = model.options[0]!.interventions![0]!; const brief = iv.stated_evidence!.quote;
    const p = prepareProvisionalCandidate(model, brief);
    expect(p.additions_without_total[0]).toMatchObject({ value: 4, reason: 'baseline_unknown',
      native_addition: { claim: iv, verified: true } });
    expect(p.candidate.options[0]!.interventions).toStrictEqual([]);
    expect(p.candidate.options[0]!.changes).toContain('Engineers');
  });
  for (const text of [
    'Our competitor will raise their price to £59 a month.',
    'If sales rise, should we raise our Pro plan price to £59 a month?',
    'Our Pro plan price target is £59 a month.',
    'Last year we raised our Pro plan price to £59 a month.',
    'Should we raise our Pro plan price to £54 a month?',
    'Should we raise staff salaries to £59 a month?',
  ]) it(`refuses drafted relationship/cell: ${text}`, () => {
    const model = priceCandidate(text); const o = model.options.find(o => o.label === 'Raise price to £59')!;
    expect(verifiedOptionAction(model, o, o.interventions![0]!, text)).toBe(false);
    expect(verifiedOptionSetting(model, o, o.interventions![0]!, text)).toBe(false);
    const linked: CandidateModel = { ...model, links: [...model.links,
      { from: o.label, to: 'Pro plan monthly price', direction: 'positive', provenance: 'explicit' }] };
    const g = admitCandidateModel(prepareProvisionalCandidate(linked, text).candidate, {}, text);
    expect(g.edges.filter(e => e.from === 'raise_price_to_59' && e.to === 'pro_plan_monthly_price')
      .every(e => e.provenance?.source !== 'brief_extraction')).toBe(true);
  });
  for (const [text, expected] of [
    ['We could set the price to £59.', true],
  ] as const) it(`RUN61 purpose scope: ${text}`, () => {
    const m = priceCandidate(text);
    const f = m.factors.find(f => f.label === 'Pro plan monthly price')!;
    f.label = 'Price'; f.unit = 'GBP';
    const o = m.options.find(o => o.label === 'Raise price to £59')!;
    o.label = 'Set price to £59';
    const iv = o.interventions![0]!; iv.factor_label = f.label; iv.unit = f.unit;
    expect(verifiedOptionSetting(m, o, iv, text)).toBe(expected);
  });
  it('RUN61 proposed keep is not mistaken for history or desire', () => {
    const text = 'We could keep 400 riders.';
    const m: CandidateModel = { ...addition(20), factors: [{ label: 'Riders', role: 'controllable', baseline_known: true, baseline_value: 20, unit: 'riders', provenance: 'explicit' }],
      options: [{ label: '400 riders', provenance: 'explicit', interventions: [{ factor_label: 'Riders', value: 400,
      unit: 'riders', value_kind: 'absolute', provenance: 'explicit', stated_evidence: evidence(text) }] }] };
    const o = m.options[0]!;
    expect(verifiedOptionSetting(m, o, o.interventions![0]!, text)).toBe(true);
  });
  it('RUN61 B3-d2 retains symmetric senior and junior additions before the purpose clause', () => {
    const record: { brief: string; output_text: string } = JSON.parse(readFileSync(new URL('../../goal-target/__tests__/fixtures/event-b3-d2-20261008.json', import.meta.url), 'utf8'));
    const m: CandidateModel = JSON.parse(record.output_text);
    for (const [option, factor, value] of [['Two senior engineers', 'Senior engineers hired', 2],
      ['Four junior engineers', 'Junior engineers hired', 4]] as const) {
      const o = m.options.find(o => o.label === option)!;
      const iv = o.interventions!.find(i => i.factor_label === factor && i.value === value)!;
      expect(verifiedOptionSetting(m, o, iv, record.brief)).toBe(true);
    }
  });
  it('a target-as-current cannot obtain observation authority from a quote or an explicit slot', () => {
    const text = 'We want 1,900 riders.';
    const model: CandidateModel = { ...addition(1900), options: [],
      factors: [{ label: 'Registered riders', role: 'observable', unit: 'riders', baseline_known: true,
        baseline_value: 1900, provenance: 'explicit', baseline_evidence: { quote: text } }] };
    const node = admitCandidateModel(model, {}, text).nodes.find(n => n.label === 'Registered riders')!;
    expect(node.observed_state).toMatchObject({ raw_value: 1900, source: 'cee_inference', user_material_unverified: true });
  });
  it('the immutable historical answer has no receipt and remains withheld without the disclosed migration', () => {
    const original: CandidateModel = JSON.parse(bank.raw);
    const o = original.options.find(o => o.label === 'Raise price to £59')!;
    expect(o.interventions![0]!.stated_evidence).toBeUndefined();
    expect(verifiedOptionAction(original, o, o.interventions![0]!, bank.brief)).toBe(false);
    const g = admitCandidateModel(prepareProvisionalCandidate(original, bank.brief).candidate, {}, bank.brief);
    const option = g.nodes.find(n => n.label === o.label)!;
    const factor = g.nodes.find(n => n.label === 'Pro plan monthly price')!;
    expect(option.interventions![factor.id]!.source).toBe('cee_hypothesis');
    expect(g.edges.find(e => e.from === option.id && e.to === factor.id)!.provenance?.source).toBe('cee_hypothesis');
  });
  it('missing/duplicate/paraphrased receipt cannot witness a drafted relationship', () => {
    const model = priceCandidate(); const o = model.options.find(o => o.label === 'Raise price to £59')!; const iv = o.interventions![0]!;
    expect(verifiedOptionAction(model, o, iv, `${quote} ${quote}`)).toBe(false);
    iv.stated_evidence = evidence(quote.replace('raise', 'increase'));
    expect(verifiedOptionAction(model, o, iv, quote)).toBe(false);
    iv.stated_evidence = null;
    expect(verifiedOptionAction(model, o, iv, quote)).toBe(false);
  });
  // RUN64: original-claim scope, independent of candidate slots and positive proposal openings.
  for (const text of ['We had 400 riders.', 'We used to have 400 riders.', 'Our service was operating with 400 riders.',
    'We hope to have 400 riders.', 'We want 400 riders.', 'We aim to have 400 riders.',
    'We expect to have 400 riders.', 'We plan to have 400 riders.',
    'We have 400 riders provided sales rise.', 'We have 400 riders contingent on sales rising.',
    'We have 400 riders conditional on sales rising.', 'We have 400 riders unless sales fall.']) {
    it(`RUN64 scope withheld and claim retained by both consumers: ${text}`, () => {
      const m = scopeCandidate(text); const f = m.factors[0]!; const o = m.options[0]!; const iv = o.interventions![0]!;
      expect(verifiedFactorLevel(m, f, text)).toBe(false);
      expect(verifiedOptionSetting(m, o, iv, text)).toBe(false);
      const p = prepareProvisionalCandidate(m, text);
      expect(p.candidate.options[0]!.interventions![0]).toMatchObject({ ...iv, provenance: 'ai_proposed', basis: text });
      expect(p.provenance_demoted).toContainEqual({ option: o.label, factor: f.label, value: 400 });
      const g = admitCandidateModel(p.candidate, {}, text);
      const node = g.nodes.find(n => n.label === f.label)!;
      expect(node.observed_state).toMatchObject({ raw_value: 400, user_material_unverified: true });
      expect(node.observed_state?.source).not.toBe('brief_extraction');
      expect(g.nodes.find(n => n.label === o.label)!.interventions![node.id]).toMatchObject({ raw_value: 400, source: 'cee_hypothesis', basis: text });
    });
  }
  for (const text of ['We had 400 riders.', 'We hope to have 400 riders.', 'We used to have 400 riders.', 'We have 400 riders.']) {
    it(`RUN64 goal current role shares the original scope: ${text}`, () => {
      const m = scopeCandidate(text);
      const goal = { ...m.goal, metric: 'Riders', unit: 'riders', value: 1000, baseline_known: true,
        baseline_value: 400, baseline_provenance: 'explicit' as const, baseline_evidence: { quote: text } };
      expect(verifiedGoalLevel({ ...m, goal, factors: [], options: [] }, text)).toBe(text === 'We have 400 riders.');
    });
  }
  for (const [text, credited] of [['We have 400 riders.', true], ['We carried 400 riders last month.', false]] as const) {
    it(`RUN64 measured report preserves baseline outcome: ${text}`, () => {
      const m = scopeCandidate(text);
      expect(verifiedFactorLevel(m, m.factors[0]!, text)).toBe(credited);
      expect(verifiedOptionSetting(m, m.options[0]!, m.options[0]!.interventions![0]!, text)).toBe(credited);
    });
  }
  for (const [text, credited] of [
    ['We could set the price to £59 subject to sales rising by 10%.', false],
    ['We could set the price to £59 provided sales rise.', false],
    ['We could set the price to £59 contingent on sales rising.', false],
    ['We could set the price to £59 conditional on sales rising.', false],
    ['We could set the price to £59 unless sales fall.', false],
    ['We could set the price to £59.', true], ['We would set the price to £59.', true],
    ['Should we raise the price to £59?', true], ['We could set the price to £59 or £60.', false],
  ] as const) {
    it(`RUN64 governing condition vs authored proposal: ${text}`, () => {
      const m = scopePrice(text); const o = m.options.find(o => o.label === 'Set price to £59')!; const iv = o.interventions![0]!;
      expect(verifiedOptionSetting(m, o, iv, text)).toBe(credited);
      const p = prepareProvisionalCandidate(m, text);
      expect(p.candidate.options.find(o => o.label === 'Set price to £59')!.interventions![0])
        .toMatchObject({ ...iv, provenance: credited ? 'explicit' : 'ai_proposed' });
      if (!credited) expect(p.provenance_demoted).toContainEqual({ option: o.label, factor: 'Price', value: 59 });
    });
  }
  it('RUN64 coordinated signed proposals stay eligible; numeric alternatives for one arm do not become a point', () => {
    const text = 'Should we cut our list price 15% or raise it 10%?';
    const m: CandidateModel = { ...addition(0), factors: [{ label: 'List price change', role: 'controllable',
      baseline_known: true, baseline_value: 0, unit: '%', provenance: 'explicit' }], options: [
      { label: 'Cut list price 15%', provenance: 'explicit', interventions: [{ factor_label: 'List price change',
        value: -15, unit: '%', value_kind: 'absolute', provenance: 'explicit', stated_evidence: evidence(text) }] },
      { label: 'Raise list price 10%', provenance: 'explicit', interventions: [{ factor_label: 'List price change',
        value: 10, unit: '%', value_kind: 'absolute', provenance: 'explicit', stated_evidence: evidence(text) }] }] };
    for (const o of m.options) expect(verifiedOptionSetting(m, o, o.interventions![0]!, text)).toBe(true);
    const alternative = 'Should we cut our list price 15% or 10%?';
    const o = m.options[0]!;
    expect(verifiedOptionSetting(m, o, { ...o.interventions![0]!, stated_evidence: evidence(alternative) }, alternative)).toBe(false);
  });
  it('RUN64 condition retained through real response and reload, never flattened to unconditional user credit', async () => {
    const text = 'We could set the price to £59 subject to sales rising by 10%.';
    const model = scopePrice(text); const { result, graph } = await build(model, text);
    const factor = graph.nodes.find(n => n.label === 'Price')!;
    const reloaded = GraphV3.parse(JSON.parse(JSON.stringify(projectGraphForPersistence(graph))));
    expect(reloaded.nodes.find(n => n.label === 'Set price to £59')!.interventions![factor.id])
      .toMatchObject({ raw_value: 59, source: 'cee_hypothesis', basis: text });
    expect(JSON.stringify(result)).toContain('Not confirmed from your brief');
    expect(prepareProvisionalCandidate(model, text).candidate.options.find(o => o.label === 'Set price to £59')!.interventions![0]!.stated_evidence?.quote).toBe(text);
  });
  // Import the complete original block: includes every protected FALSE-CREDIT id plus positive/conservative controls.
  for (const row of probeRows) it(`unchanged retained probe: ${row.name}`, row.run);
  it('frozen instructions and protected matcher bytes remain unchanged', () => {
    const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
    expect(sha(BUILD_INSTRUCTIONS)).toBe('ca036d122da73946c2d7d68ca135d44e512b2769d654bad6785b9b1199b6c444');
    const source = readFileSync(new URL('./fixtures/r5-verified-cases.ts', import.meta.url), 'utf8');
    expect(sha(source.slice(source.indexOf('export const probeRows:'), source.indexOf('const positive ='))))
      .toBe('080a47995ce792de0e3671eeb0a024f342b70065329426f53e562ba250dd1a42');
  });
});
