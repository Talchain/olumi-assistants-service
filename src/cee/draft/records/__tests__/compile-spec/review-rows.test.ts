import { describe, expect, it } from 'vitest';
import { projectDraftRecords } from '../../seam.js';
import { sha8, type RecordProjection } from '../../projector.js';
import type { DraftRecordSet } from '../../grammar.js';
import { statedEffectQuoteMatches } from '../../../../provenance/stated-effect.js';
import { completionRegressesProtectedContent, shouldKeepCompletion } from '../../completion.js';
import { deriveNotModelledManifest } from '../../../../context-integrity/not-modelled-manifest.js';
import { transformEdgeToV3 } from '../../../../transforms/schema-v3.js';
import { transformNodeToV2, type V1Edge, type V1Node } from '../../../../transforms/schema-v2.js';

const quote = 'Each 1% price rise adds £1,200 a month to monthly recurring revenue.';
const detail = { amount: 1200, amount_unit: '£/month', per_source_change: 1, per_source_change_unit: '%' };
const goalQuote = 'Goal: reach £150,000 monthly recurring revenue.';
const brief = `${goalQuote} ${quote} Support cost is £20 a month. Revenue is £120,000 a month. There are 150 subscribers, between 80 and 250.`;
function records(): DraftRecordSet {
  const r: DraftRecordSet = { stated_items: [
    { kind: 'goal', source_quote: goalQuote, value: 150000, baseline: 120000, unit: '£/month', role: 'target' },
    { kind: 'cause', source_quote: quote },
    { kind: 'figure', source_quote: 'There are 150 subscribers, between 80 and 250.', value: 150, unit: 'subscribers', role: 'baseline' },
  ], claims: [
    { claim_kind: 'factor', label: 'Price rise', value: 0, unit: '%', value_scale: 'raw_count' },
    { claim_kind: 'outcome', label: 'Monthly recurring revenue', unit: '£/month' },
    { claim_kind: 'outcome', label: 'Monthly support cost', unit: '£/month' },
    { claim_kind: 'causal_link', label: 'price to revenue', from_claim: 0, to_claim: 1, effect: 'positive', basis: [1], effect_detail: { ...detail } },
    { claim_kind: 'causal_link', label: 'revenue to goal', from_claim: 1, to_stated: 0, effect: 'positive' },
    { claim_kind: 'causal_link', label: 'support to goal', from_claim: 2, to_stated: 0, effect: 'negative' },
    { claim_kind: 'causal_link', label: 'subscribers to goal', from_stated: 2, to_stated: 0, effect: 'positive' },
  ] };
  r.stated_items.push(
    { kind: 'figure', source_quote: quote, value: 1, unit: '%', role: 'context' },
    { kind: 'figure', source_quote: 'Revenue is £120,000 a month.', value: 120000, unit: '£/month', role: 'baseline' },
    { kind: 'figure', source_quote: 'Support cost is £20 a month.', value: 20, unit: '£/month', role: 'context' },
  );
  Object.assign(r.stated_items[0]!, { quantity: 4, baseline_ref: 4 });
  Object.assign(r.stated_items[1]!, { relationship: {
    from_quantity: 3, to_quantity: 4, ...detail,
    amount_span: { start: quote.indexOf('£1,200'), end: quote.indexOf('£1,200') + 6 },
    source_span: { start: quote.indexOf('1%'), end: quote.indexOf('1%') + 2 },
  } });
  Object.assign(r.stated_items[2]!, { range: {
    low: 80, high: 250, unit: 'subscribers',
    low_span: { start: 35, end: 37 }, high_span: { start: 42, end: 45 },
  } });
  Object.assign(r.claims[0]!, { quantity: 3 });
  Object.assign(r.claims[1]!, { quantity: 4 });
  Object.assign(r.claims[2]!, { quantity: 5 });
  return r;
}
function project(r = records(), b: string | undefined = brief): RecordProjection {
  const result = projectDraftRecords(r, b);
  if (!result.ok) throw new Error(result.detail);
  return result.projection;
}
const edgeId = sha8('edge', 'price to revenue', sha8('factor', 'Price rise'), sha8('outcome', 'Monthly recurring revenue'));
function sized(p: RecordProjection) { return p.graph.edges.find(e => e.id === edgeId)!; }

describe('P1-1 Signed relationship authority', () => {
  it('refuses reversed signs and unrelated clauses containing the same numbers', () => {
    for (const [amount, per] of [[-1200, 1], [1200, -1], [-1200, -1]]) {
      expect(statedEffectQuoteMatches(quote, { ...detail, amount, per_source_change: per })).toBe(false);
    }
    expect(statedEffectQuoteMatches('Price rise is 1%. Our unrelated budget is £1,200 a month.', detail)).toBe(false);
    const authority = records().stated_items[1]!.relationship!;
    expect(statedEffectQuoteMatches(quote, detail, authority)).toBe(true);
    expect(statedEffectQuoteMatches(quote, { ...detail, amount: -1200 }, authority)).toBe(false);
    const unrelated = 'Price rise is 1%. Our unrelated budget is £1,200 a month.';
    expect(statedEffectQuoteMatches(unrelated, detail, { ...authority,
      source_span: { start: unrelated.indexOf('1%'), end: unrelated.indexOf('1%') + 2 },
      amount_span: { start: unrelated.indexOf('£1,200'), end: unrelated.indexOf('£1,200') + 6 },
    })).toBe(false);
  });
  it('retains a decoded empty span without earning signed authority', () => {
    const r = records(); r.stated_items[1]!.relationship!.amount_span = { start: 0, end: 0 };
    expect(sized(project(r)).provenance?.magnitude).not.toBe('user_stated');
  });
});
describe('P1-2 Endpoint identity', () => {
  it('refuses a singleton revenue quote attached to support cost, with exact edge identity', () => {
    const r = records(); r.claims[3]!.to_claim = 2;
    const p = project(r);
    const id = sha8('edge', 'price to revenue', sha8('factor', 'Price rise'), sha8('outcome', 'Monthly support cost'));
    expect(p.graph.edges.find(e => e.id === id)!.provenance?.magnitude).not.toBe('user_stated');
  });
  it('folds equivalent denomination aliases before detecting competing endpoints', () => {
    const r = records();
    r.claims.push({ ...r.claims[3]!, label: 'Equivalent GBP denomination', effect_detail: { ...detail, amount_unit: 'GBP/month', per_source_change_unit: 'percent' } });
    const p = project(r);
    const pair = p.graph.edges.filter(e => e.from === sized(project()).from && e.to === sized(project()).to);
    expect(pair).toHaveLength(1);
    expect(pair[0]!.provenance?.magnitude).toBe('user_stated');
    expect(pair[0]!.provenance?.natural_effect?.amount).toBe(1200);
  });
});
describe('P1-3 Endpoint denomination', () => {
  it('does not relabel a stated GBP/month effect with a USD/month endpoint', () => {
    const r = records(); r.claims[1]!.unit = 'USD/month';
    // The quantity reference owns denomination; a redundant claim unit cannot change it.
    r.stated_items[4]!.unit = 'USD/month';
    // Give USD its own goal frame, so conversion is reachable on base.
    r.stated_items[0]!.unit = 'USD/month';
    expect(sized(project(r)).provenance?.magnitude).not.toBe('user_stated');
  });
});
describe('P1-4 Frame inheritance', () => {
  it('does not lend the revenue goal cap to an unrelated support-cost quantity', () => {
    expect(project().graph.nodes.find(n => n.id === sha8('outcome', 'Monthly support cost'))!.scale_frame).toBeUndefined();
  });
});
describe('P1-5 Baseline admission', () => {
  it('refuses fabricated 999999 and a missing-brief baseline', () => {
    const r = records(); r.stated_items[0]!.baseline = 999999;
    expect(project(r).graph.nodes.find(n => n.kind === 'goal')!.goal_baseline_raw).toBeUndefined();
    expect(project(records(), '').graph.nodes.find(n => n.kind === 'goal')!.goal_baseline_raw).toBeUndefined();
  });
  it('carries a bound same-quantity baseline through a duplicate-goal collapse', () => {
    const r = records();
    const original = r.stated_items[0]!;
    const baseline = r.stated_items[4]!;
    original.value_span = { start: goalQuote.indexOf('£150,000'), end: goalQuote.indexOf('£150,000') + 8 };
    original.unit_span = { start: goalQuote.indexOf('monthly'), end: goalQuote.indexOf('monthly') + 7 };
    baseline.value_span = { start: baseline.source_quote.indexOf('£120,000'), end: baseline.source_quote.indexOf('£120,000') + 8 };
    baseline.unit_span = { start: baseline.source_quote.indexOf('a month'), end: baseline.source_quote.indexOf('a month') + 7 };
    const duplicate = structuredClone(original);
    delete original.value; delete original.baseline_ref; delete original.baseline; delete original.quantity;
    r.stated_items.push(duplicate);
    const goal = project(r).graph.nodes.find(n => n.kind === 'goal')!;
    expect(goal.goal_baseline_raw).toBe(120000);
    expect(goal.goal_baseline).toBe(0.64);
    expect(goal.quantity_ref).toBe(4);
    const foreign = structuredClone(r);
    foreign.stated_items[foreign.stated_items.length - 1]!.quantity = 5;
    // baseline_ref is the identity even when the redundant quantity differs.
    expect(project(foreign).graph.nodes.find(n => n.kind === 'goal')!.goal_baseline_raw).toBe(120000);
    foreign.stated_items[foreign.stated_items.length - 1]!.baseline_ref = 5;
    // A context figure is not a baseline declaration.
    expect(project(foreign).graph.nodes.find(n => n.kind === 'goal')!.goal_baseline_raw).toBeUndefined();
  });
});
describe('P1-6 Range ownership and scale', () => {
  it('never writes a range from wording without typed ownership', () => {
    const r = records(); r.stated_items[2]!.source_quote = 'Revenue is £1 a month, between £1 and £2m.';
    r.stated_items[2]!.value = 1; r.stated_items[2]!.unit = '£/month';
    const p = project(r, `${brief} ${r.stated_items[2]!.source_quote}`);
    const n = p.graph.nodes.find(n => n.id === sha8('figure', r.stated_items[2]!.source_quote))!;
    expect(n.observed_state?.range).toBeUndefined();
  });
  it('retains scaled typed bounds and refuses wrong spans, currency and ownership', () => {
    const r = records(); const item = r.stated_items[2]!;
    item.source_quote = 'Revenue is £1 a month, between £1 and £2m.';
    item.value = 1; item.unit = '£/month';
    const low = item.source_quote.lastIndexOf('£1'), high = item.source_quote.indexOf('£2m');
    item.range = { low: 1, high: 2000000, unit: '£/month', low_span: { start: low, end: low + 2 }, high_span: { start: high, end: high + 3 } };
    item.value_span = { start: item.source_quote.indexOf('£1'), end: item.source_quote.indexOf('£1') + 2 };
    item.unit_span = { start: item.source_quote.indexOf('a month'), end: item.source_quote.indexOf('a month') + 7 };
    const b = `${brief} ${item.source_quote}`;
    const node = (set: DraftRecordSet) => project(set, b).graph.nodes.find(n => n.id === sha8('figure', item.source_quote))!;
    expect(node(r).observed_state?.range).toEqual({ min: 1, max: 2000000 });
    for (const change of [{ high: 2 }, { unit: 'USD/month' }, { low_span: { start: 0, end: 2 } }, { low: 80, high: 250 }]) {
      const bad = structuredClone(r); Object.assign(bad.stated_items[2]!.range!, change);
      expect(node(bad).observed_state?.range).toBeUndefined();
    }
  });
});
describe('P1-7 Complete sizing bundle', () => {
  it('keeps the exact sizing spread, not a later default', () => {
    const e = sized(project());
    expect((e as V1Edge).strength_std).toBe(Math.abs(e.strength_mean!) / 2);
  });
  it('refuses an unsupported coefficient instead of silently clamping 2 to 1', () => {
    const r = records(); r.claims[0]!.value = 100;
    r.claims[3]!.effect_detail!.amount = 3750;
    r.stated_items[1]!.source_quote = quote.replace('£1,200', '£3,750');
    Object.assign(r.stated_items[1]!, { relationship: { ...(r.stated_items[1] as unknown as { relationship: object }).relationship, amount: 3750 } });
    const e = sized(project(r, `${brief} ${r.stated_items[1]!.source_quote}`));
    expect(e.provenance?.magnitude).not.toBe('user_stated');
  });
  it('withdraws authored size when the V3 boundary changes its mean or spread', () => {
    const original = sized(project());
    for (const change of [{ strength_mean: 2 }, { strength_std: undefined }]) {
      const candidate = { ...original, ...change };
      const out = transformEdgeToV3(candidate as V1Edge, 0, []);
      expect(out.edge.provenance?.magnitude).not.toBe('user_stated');
      expect(out.edge.provenance?.natural_effect).toBeUndefined();
      expect(out.defaults).toContainEqual(expect.objectContaining({ field: 'magnitude' }));
    }
  });
});
describe('P1-8 Completion preservation', () => {
  it('preserves a sized edge when an additive completion supplies a weaker unbased parallel claim', () => {
    const before = project(); const r = records();
    r.claims.push({ claim_kind: 'causal_link', label: 'unbased duplicate', from_claim: 0, to_claim: 1, strength: 0, effect: 'positive' });
    const after = project(r);
    expect(sized(after)).toEqual(sized(before));
    expect(completionRegressesProtectedContent(before, after)).toEqual([]);
  });
  it('rejects an accepted additive completion whose reprojection erases a stated edge bundle', () => {
    const before = project(); const after = structuredClone(before);
    const e = sized(after); delete e.strength_mean; delete e.provenance;
    delete (after.provenance as Record<string, unknown>)[edgeId];
    expect(completionRegressesProtectedContent(before, after)).toContain(`stated_edge_bundle_changed:${edgeId}`);
    expect(shouldKeepCompletion({ items: [], baseClaimIndex: 7 }, { items: [], baseClaimIndex: 8 }, { before, after })).toBe(false);
  });
  it('rejects endpoint denomination and identity changes even when coefficients stay the same', () => {
    const before = project();
    for (const change of [{ unit: 'USD/month' }, { quantity: 5 }]) {
      const after = structuredClone(before);
      const target = after.graph.nodes.find(n => n.id === sized(before).to)!;
      if (change.unit !== undefined) target.data = { ...target.data, unit: change.unit };
      if (change.quantity !== undefined) target.quantity_ref = change.quantity;
      expect(completionRegressesProtectedContent(before, after)).toContain(`stated_edge_bundle_changed:${edgeId}`);
    }
  });
});
describe('P1-9 Size read-back', () => {
  it('preserves authored size and quote through the staged/terminal V3 transform', () => {
    const e = sized(project());
    const out = transformEdgeToV3(e as V1Edge, 0, []).edge;
    expect(out.provenance).toMatchObject({ magnitude: 'user_stated', natural_effect: { amount: 1200 }, quote });
  });
});
describe('P2a Factor metadata carriage', () => {
  it('carries raw baseline 150 and range [80,250] through the V2 reader', () => {
    const n = project().graph.nodes.find(n => n.id === sha8('figure', 'There are 150 subscribers, between 80 and 250.'))!;
    expect(transformNodeToV2(n as V1Node).observed_state).toMatchObject({ baseline: 150, range: { min: 80, max: 250 } });
  });
});
describe('P2b Manifest truth', () => {
  it('counts a complete current bundle and refuses it after its frame or unit changes', () => {
    const p = project();
    const graph = { nodes: p.graph.nodes.map(node => ({ ...node, observed_state: {
      ...node.observed_state, unit: node.data?.unit ?? node.goal_threshold_unit,
    } })), edges: p.graph.edges.map(edge => ({ ...edge, strength: { mean: edge.strength_mean, std: edge.strength_std } })) };
    const item = () => deriveNotModelledManifest(quote, graph).quantities!.items.find(i => i.literal === '£1,200')!;
    expect(item().verdict, JSON.stringify({ nodes: graph.nodes, edge: sized(p) })).toBe('in_model');
    const target = graph.nodes.find(node => node.id === sized(p).to)!;
    target.scale_frame = 100000;
    expect(item().verdict).not.toBe('in_model');
    target.scale_frame = 187500;
    target.observed_state.unit = 'USD/month';
    expect(item().verdict).not.toBe('in_model');
  });
  it('keeps full evidence beyond the 100-character display quote', () => {
    const r = records(); const full = `${quote} This is the gross recurring-revenue effect, before allowing for customer losses or other effects.`;
    r.stated_items[1]!.source_quote = full;
    const p = project(r, `${brief} ${full}`);
    expect(sized(p).provenance?.quote).toHaveLength(100);
    expect(sized(p).provenance?.source_quote).toBe(full);
    const edge = transformEdgeToV3(sized(p) as V1Edge, 0, []).edge;
    expect(edge.provenance?.source_quote).toBe(full);
    const graph = { nodes: p.graph.nodes, edges: [edge] };
    expect(deriveNotModelledManifest(full, graph).quantities!.items.find(i => i.literal === '£1,200')!.verdict).toBe('in_model');
  });
  it('does not count £1,200 after the current coefficient became zero', () => {
    const graph = { nodes: [
      { id: 'source', kind: 'factor', label: 'Price rise', scale_frame: 100, observed_state: { value: 0, unit: '%' } },
      { id: 'target', kind: 'outcome', label: 'Monthly recurring revenue', scale_frame: 187500, observed_state: { value: 0.64, unit: '£/month' } },
    ], edges: [{ id: 'stale-effect', from: 'source', to: 'target', strength: { mean: 0, std: 0.32 }, effect_direction: 'positive', provenance: {
      source: 'brief_extraction', magnitude: 'user_stated', quote, natural_effect: { ...detail, strength_mean: 0.64, strength_mean_frame: 'edge_strength' },
    } }] };
    const manifest = deriveNotModelledManifest(quote, graph);
    expect(manifest.quantities!.items.find(i => i.literal === '£1,200')!.verdict).not.toBe('in_model');
  });
});
