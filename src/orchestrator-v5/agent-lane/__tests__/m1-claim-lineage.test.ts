import { describe, expect, it } from 'vitest';
import { bindM1ClaimSources, sourceOfM1Claim } from '../m1-claim-lineage.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';

const bind = (brief: string, role: Parameters<typeof sourceOfM1Claim>[1]['role'], value = 75000, entity = 'MRR', unit: unknown = 'GBP/month', others: string[] = []) => sourceOfM1Claim(brief, { entity, others, value, unit, role });

describe('M1 claim source roles and repeated occurrences', () => {
  it('binds repeated equal current, target, change and limit figures to their own occurrences', () => {
    const brief = 'Current MRR is £75k. We target MRR of £75k. We want to increase MRR by £75k. MRR must stay below £75k.';
    const bindings = ['current', 'target', 'change_abs', 'limit'].map((role) => bind(brief, role as Parameters<typeof bind>[1]));
    expect(bindings.every(Boolean)).toBe(true);
    expect(new Set(bindings.map((b) => b!.number_start)).size).toBe(4);
    for (const b of bindings) expect(brief.slice(b!.start, b!.end)).toBe(b!.quote);
    expect(bindings[0]!.quote).toContain('Current');
    expect(bindings[1]!.quote).toContain('target');
    expect(bindings[2]!.quote).toContain('increase');
    expect(bindings[3]!.quote).toContain('must');
  });

  it('never upgrades a target, limit or change occurrence into a current quote', () => {
    for (const brief of ['Our MRR target is £75k.', 'MRR must stay below £75k.', 'We want to increase MRR by £75k.', 'Current MRR is below £75k.', 'We want current MRR above £75k.']) expect(bind(brief, 'current')).toBeNull();
  });

  it('distinguishes percentage level, relative change and absolute change without changing units', () => {
    const brief = 'Current churn is 20%. We target churn at 20%. We want to reduce churn by 20%.';
    expect(bind(brief, 'current', 20, 'churn', '%')?.quote).toContain('Current');
    expect(bind(brief, 'target', 20, 'churn', '%')?.quote).toContain('target');
    expect(bind(brief, 'change_rel', 20, 'churn', '%')?.quote).toContain('reduce');
    expect(bind(brief, 'change_abs', 20, 'churn', '%')).toBeNull();
    expect(bind('We want to reduce costs by £20.', 'change_rel', 20, 'costs', 'GBP')).toBeNull();
  });

  it('does not select arbitrarily among two current occurrences or steal another entity’s amount', () => {
    expect(bind('Current MRR is £75k. Current MRR is £75k.', 'current')).toBeNull();
    const brief = 'Current MRR is £70k and current ARR is £75k.';
    expect(bind(brief, 'current', 75000, 'MRR', 'GBP/month', ['ARR'])).toBeNull();
    expect(bind(brief, 'current', 75000, 'ARR', 'GBP/year', ['MRR'])?.quote).toContain('ARR');
  });

  it('leaves role-ambiguous bare figures unbound and preserves Unicode offsets and original whitespace', () => {
    expect(bind('MRR £75k.', 'current')).toBeNull();
    expect(bind('We want MRR above £90k within 3 months.', 'target', 3)).toBeNull();
    expect(bind('We want CSAT above 90% within 3 months.', 'target', 3, 'CSAT', '%')).toBeNull();
    const brief = '📌 Current MRR  is £75k.\nWe target MRR at £85k.';
    const b = bind(brief, 'current')!;
    expect(b).not.toBeNull();
    expect(brief.slice(b.start, b.end)).toBe(b.quote);
    expect(brief.slice(b.number_start, b.number_end)).toBe('£75k');
    expect(b.quote).toContain('MRR  is');
  });
});

describe('M1 registered claim lineage and ownership', () => {
  const graph = {
    nodes: [
      { id: 'mrr', kind: 'goal', label: 'MRR', provenance: 'from_brief', observed_state: { value: 75000, raw_value: 75000, unit: 'GBP/month', source: 'brief_extraction' }, goal_threshold_raw: 85000, goal_threshold_unit: 'GBP/month', goal_threshold_frame: 'level', threshold_source: 'brief_extraction' },
      { id: 'price', kind: 'factor', label: 'Pro price', provenance: 'from_brief', observed_state: { value: 49, raw_value: 49, unit: 'GBP/subscriber/month', source: 'brief_extraction' } },
      { id: 'raise', kind: 'option', label: 'Raise Pro price', provenance: 'from_brief', source_quote: 'raise Pro price from £49 to £59 a month', interventions: { price: { value: 59, raw_value: 59, unit: 'GBP/subscriber/month', source: 'brief_extraction', target_match: { node_id: 'price', match_type: 'exact_id', confidence: 'high' } } } },
    ], edges: [],
  };
  const brief = 'Should we raise Pro price from £49 to £59 a month? Current MRR is £75k. We want MRR above £85k.';

  it('keeps current/target quotes distinct, carries factor quotes and leaves numeric scientific fields untouched', () => {
    const before = JSON.stringify(graph);
    const result = bindM1ClaimSources(graph, brief);
    const saved = GraphV3.parse(result.graph);
    const goal = saved.nodes.find((n) => n.id === 'mrr')!;
    const factor = saved.nodes.find((n) => n.id === 'price')!;
    const option = saved.nodes.find((n) => n.id === 'raise')!;
    expect(goal.source_quote).toContain('£85k');
    expect(goal.observed_state!.source_quote).toContain('£75k');
    expect(goal.source_quote).not.toBe(goal.observed_state!.source_quote);
    expect(factor.source_quote).toBe(factor.observed_state!.source_quote);
    expect(factor.observed_state!.unit).toBe('GBP/subscriber/month'); // Binding does not attest or invent this denominator.
    expect(option.interventions!.price!.source_quote).toContain('to £59');
    expect(result.bindings).toHaveLength(4);
    for (const b of result.bindings) expect(brief.slice(b.source.start, b.source.end)).toBe(b.source.quote);
    expect(JSON.stringify(graph)).toBe(before);
    const withoutLineage = (value: unknown) => JSON.stringify(value, (key, v) => ['source_quote', 'source_span'].includes(key) ? undefined : v);
    expect(withoutLineage(result.graph)).toBe(withoutLineage(graph));
  });

  it('does not bind an Olumi estimate or an Olumi-owned option even when every number is present', () => {
    const altered = structuredClone(graph);
    altered.nodes[0]!.observed_state!.source = 'cee_inference';
    altered.nodes[2]!.provenance = 'ai_inferred';
    const result = bindM1ClaimSources(altered, brief);
    expect(result.bindings.some((b) => b.field_path === 'nodes[mrr].observed_state')).toBe(false);
    expect(result.bindings.some((b) => b.role === 'intervention')).toBe(false);
  });

  it('does not use a current-price occurrence as a proposed option setting', () => {
    const altered = structuredClone(graph);
    altered.nodes[2]!.interventions!.price!.raw_value = 49;
    altered.nodes[2]!.interventions!.price!.value = 49;
    expect(bindM1ClaimSources(altered, brief).bindings.some((b) => b.role === 'intervention')).toBe(false);
  });
});
