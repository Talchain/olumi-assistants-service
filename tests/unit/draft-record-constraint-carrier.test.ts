import { describe, expect, it } from 'vitest';
import { projectDraftRecords } from '../../src/cee/draft/records/seam.js';
import { compileRecordConstraint } from '../../src/cee/compound-goal/record-constraint-carrier.js';
import { extractCompoundGoals } from '../../src/cee/compound-goal/extractor.js';
import { runCompoundGoals } from '../../src/cee/unified-pipeline/stages/repair/compound-goals.js';
import type { RecordConstraintCandidate } from '../../src/cee/draft/records/projector.js';

function fixture(quote = 'Keep monthly churn under 4%', value = 4, unit = '%', direction = 'ceiling') {
  const brief = `We need to grow net revenue. ${quote}. We can invest or hold.`;
  const records = {
    stated_items: [
      { kind: 'goal', source_quote: 'grow net revenue', role: 'target' },
      { kind: 'constraint', source_quote: quote, value, unit, direction, applies_to_claim: 0 },
      { kind: 'option', source_quote: 'invest' },
      { kind: 'option', source_quote: 'hold' },
    ],
    claims: [
      { claim_kind: 'factor', label: 'Subscription Loss Metric' },
      { claim_kind: 'causal_link', label: 'metric affects revenue', from_claim: 0, to_stated: 0 },
      { claim_kind: 'causal_link', label: 'limit affects revenue', from_stated: 1, to_stated: 0 },
      { claim_kind: 'causal_link', label: 'invest alters metric', from_stated: 2, to_claim: 0, sets_to: 0.2 },
      { claim_kind: 'causal_link', label: 'hold alters metric', from_stated: 3, to_claim: 0, sets_to: 0.5 },
    ],
  };
  const projected = projectDraftRecords(records, brief);
  if (!projected.ok) throw new Error(projected.reason);
  expect(projected.projection.constraintCandidates).toHaveLength(1);
  return { brief, records, projection: projected.projection, candidate: projected.projection.constraintCandidates[0]! };
}

function context(f: ReturnType<typeof fixture>): any {
  return {
    requestId: 'records-constraint-carrier', effectiveBrief: f.brief,
    graph: structuredClone(f.projection.graph),
    recordConstraintCandidates: structuredClone(f.projection.constraintCandidates),
    recordDisclosures: [...f.projection.dropped],
  };
}

describe('records declaration → existing compound-goals authority', () => {
  it('carries the exact declared reference through framing and preserves the original constraint node', () => {
    const f = fixture();
    expect(f.candidate).toMatchObject({
      stated_index: 1, source_quote: 'Keep monthly churn under 4%',
      target_ref: { namespace: 'claims', index: 0 }, declared_direction: 'ceiling',
      constraint: { value: 4, unit: '%', operator: '<=' },
    });
    const ctx = context(f);
    const before = structuredClone(ctx.graph);
    runCompoundGoals(ctx);
    expect(ctx.goalConstraints).toEqual([expect.objectContaining({
      node_id: f.candidate.constraint.node_id, operator: '<=', value: 0.04, unit: 'fraction', value_frame: 'level',
    })]);
    expect(ctx.recordConstraintDispositions[0].reason).toBe('record_constraint_admitted');
    expect(ctx.graph).toEqual(before);
    expect(ctx.graph.nodes.some((n: any) => n.id === f.candidate.carrier_node_id)).toBe(true);
    expect(ctx.directionUnresolved).toEqual([]);
  });

  it.each([
    ['Keep spending under £1500', 1500, '£', 1500, '£', 'level'],
    ['Reduce monthly spend by 15%', 15, '%', -0.15, 'fraction', 'delta'],
  ])('uses the parser arithmetic for %s without inventing a frame', (quote, value, unit, canonicalValue, canonicalUnit, frame) => {
    const f = fixture(String(quote), Number(value), String(unit));
    const ctx = context(f);
    runCompoundGoals(ctx);
    expect(ctx.recordConstraintDispositions[0]).toMatchObject({
      reason: 'record_constraint_admitted',
      canonical_constraint: { node_id: f.candidate.constraint.node_id, value: canonicalValue, unit: canonicalUnit, value_frame: frame },
    });
    expect(ctx.goalConstraints).toContainEqual(expect.objectContaining({
      node_id: f.candidate.constraint.node_id, value: canonicalValue, unit: canonicalUnit, value_frame: frame,
    }));
  });

  it.each([
    ['changed value', (c: RecordConstraintCandidate) => ({ ...c, constraint: { ...c.constraint, value: 99 } }), 'record_constraint_quantity_unproven'],
    ['wrong unit', (c: RecordConstraintCandidate) => ({ ...c, constraint: { ...c.constraint, unit: '£' } }), 'record_constraint_unit_unproven'],
    ['missing unit', (c: RecordConstraintCandidate) => ({ ...c, constraint: { ...c.constraint, unit: undefined } }), 'record_constraint_unit_unproven'],
    ['invented quote', (c: RecordConstraintCandidate) => ({ ...c, source_quote: 'Keep losses under 4%' }), 'record_constraint_quote_unlocated'],
    ['wrong direction', (c: RecordConstraintCandidate) => ({ ...c, constraint: { ...c.constraint, operator: '>=' as const } }), 'record_constraint_semantics_unproven'],
  ])('refuses %s by name', (_name, mutate, reason) => {
    const f = fixture();
    const ctx = context(f);
    ctx.recordConstraintCandidates = [mutate(f.candidate)];
    runCompoundGoals(ctx);
    expect(ctx.recordConstraintDispositions[0].reason).toBe(reason);
    expect(ctx.recordDisclosures).toContainEqual(expect.objectContaining({ reason, node_id: f.candidate.carrier_node_id }));
    // A refusal must not call a model-declared number user-authored on the wire.
    expect(ctx.recordDisclosures.at(-1)).not.toHaveProperty('value');
  });

  it('accepts a complete trailing constraint clause without guessing from a rewritten target label', () => {
    const f = fixture('keeping monthly churn under 4%');
    f.brief = 'We need to grow net revenue while keeping monthly churn under 4%.';
    const ctx = context(f);
    runCompoundGoals(ctx);
    expect(ctx.recordConstraintDispositions[0].reason).toBe('record_constraint_admitted');
    expect(ctx.goalConstraints).toContainEqual(expect.objectContaining({
      node_id: f.candidate.constraint.node_id, value: 0.04, unit: 'fraction', value_frame: 'level',
    }));
  });

  it('refuses extractor arithmetic that disagrees with the independently stated amount', () => {
    const f = fixture('Keep payout under 2k%', 2000, '%');
    expect(compileRecordConstraint(f.candidate, f.brief, f.projection.graph.nodes).reason)
      .toBe('record_constraint_arithmetic_unproven');
  });

  it.each(['data', 'observed_state', 'metadata'])('checks the actual target denomination in %s, not a currency family', (carrier) => {
    const f = fixture('Keep spending under £1500', 1500, '£');
    const nodes = structuredClone(f.projection.graph.nodes) as any[];
    const target = nodes.find((n) => n.id === f.candidate.constraint.node_id)!;
    const setUnit = (unit: string) => {
      if (carrier === 'metadata') target.observed_state = { metadata: { unit } };
      else target[carrier] = { unit };
    };
    setUnit('$');
    expect(compileRecordConstraint(f.candidate, f.brief, nodes).reason).toBe('record_constraint_target_unit_mismatch');
    setUnit('GBP');
    expect(compileRecordConstraint(f.candidate, f.brief, nodes).reason).toBe('record_constraint_validated');
  });

  it('refuses a repeated quote instead of accepting the first occurrence', () => {
    const f = fixture();
    const result = compileRecordConstraint(f.candidate, `${f.brief} ${f.candidate.source_quote}.`, f.projection.graph.nodes);
    expect(result.reason).toBe('record_constraint_quote_ambiguous');
  });

  it.each([false, true])('a partial percentage unit never becomes a bare percentage (quote truncated: %s)', (truncated) => {
    const f = fixture('Keep monthly churn under 25%/month', 25, '%');
    const candidate = truncated ? { ...f.candidate, source_quote: 'Keep monthly churn under 25%' } : f.candidate;
    const result = compileRecordConstraint(candidate, f.brief, f.projection.graph.nodes);
    expect(result.reason).toBe('record_constraint_semantics_unproven');
    expect(result.canonical_constraint).toBeUndefined();
  });

  it('retains deadlines as nonbinding evidence with their metadata', () => {
    const f = fixture('Complete delivery within 2 months', 2, 'months');
    const ctx = context(f);
    runCompoundGoals(ctx);
    expect(ctx.recordConstraintDispositions[0]).toMatchObject({
      reason: 'record_constraint_temporal_nonbinding', deadline_metadata: expect.objectContaining({ deadline_date: expect.any(String) }),
    });
    expect(ctx.goalConstraints ?? []).toEqual([]);
    expect(ctx.graph.nodes.some((n: any) => n.id === f.candidate.carrier_node_id)).toBe(true);
    expect(ctx.recordDisclosures).toContainEqual(expect.objectContaining({ reason: 'record_constraint_temporal_nonbinding' }));
  });

  it('uses the existing risk gate after semantic compilation', () => {
    const f = fixture('Churn could rise above 4%', 4, '%', 'floor');
    const ctx = context(f);
    runCompoundGoals(ctx);
    expect(ctx.recordConstraintDispositions[0].reason).toBe('record_constraint_risk_nonbinding');
    expect(ctx.goalConstraints ?? []).toEqual([]);
  });

  it('refuses a target removed during repair without retargeting', () => {
    const f = fixture();
    const nodes = f.projection.graph.nodes.filter((n) => n.id !== f.candidate.constraint.node_id);
    expect(compileRecordConstraint(f.candidate, f.brief, nodes).reason).toBe('record_constraint_target_unavailable');
  });

  it.each([
    ['Keep payout under 2k%', 2000, '%', 'Payout', undefined, 'record_constraint_arithmetic_unproven', 0.02],
    ['Keep spending under £1500', 1500, '£', 'Spending', '$', 'record_constraint_target_unit_mismatch', 1500],
  ])('stage source ownership closes the real regex fallback for %s', (quote, value, unit, label, targetUnit, reason, wrongValue) => {
    const f = fixture(String(quote), Number(value), String(unit));
    const ctx = context(f);
    const target = ctx.graph.nodes.find((n: any) => n.id === f.candidate.constraint.node_id);
    target.label = label;
    if (targetUnit) target.data = { unit: targetUnit };
    ctx.effectiveBrief += ' Keep acquisition cost under £250.';
    ctx.graph.nodes.push({ id: 'fac_acquisition_cost', kind: 'factor', label: 'Acquisition cost' });
    const legacy = structuredClone(ctx);
    legacy.recordConstraintCandidates = [];
    runCompoundGoals(legacy);
    expect(legacy.goalConstraints).toContainEqual(expect.objectContaining({ value: wrongValue }));
    runCompoundGoals(ctx);
    expect(ctx.recordConstraintDispositions[0].reason).toBe(reason);
    expect(ctx.goalConstraints).toEqual([expect.objectContaining({
      node_id: 'fac_acquisition_cost', value: 250, unit: '£', value_frame: 'level',
    })]);
  });

  it('stage source ownership leaves an independent limit in the same sentence eligible', () => {
    const f = fixture();
    const ctx = context(f);
    ctx.effectiveBrief = 'Keep revenue above 50% and keep monthly churn under 4%.';
    ctx.graph.nodes.push({ id: 'fac_revenue', kind: 'factor', label: 'Revenue' });
    ctx.recordConstraintCandidates[0].constraint.value = 99;
    runCompoundGoals(ctx);
    expect(ctx.recordConstraintDispositions[0].reason).toBe('record_constraint_quantity_unproven');
    expect(ctx.goalConstraints).toEqual([expect.objectContaining({
      node_id: 'fac_revenue', operator: '>=', value: 0.5, unit: 'fraction', value_frame: 'level',
    })]);
  });

  it.each([false, true])('stage source ownership does not suppress a construction-minted limit with the same number elsewhere (record admitted: %s)', (admitted) => {
    const f = fixture();
    const ctx = context(f);
    const independent = 'Do not let revenue drop below 4%.';
    expect(extractCompoundGoals(independent, { includeProxies: false }).constraints).toEqual([]);
    ctx.effectiveBrief += ` ${independent}`;
    ctx.graph.nodes.push({ id: 'fac_revenue', kind: 'factor', label: 'Revenue' });
    if (!admitted) ctx.recordConstraintCandidates[0].constraint.unit = '£';
    runCompoundGoals(ctx);
    expect(ctx.recordConstraintDispositions[0].reason).toBe(admitted ? 'record_constraint_admitted' : 'record_constraint_unit_unproven');
    expect(ctx.goalConstraints).toHaveLength(admitted ? 2 : 1);
    expect(ctx.goalConstraints).toContainEqual(expect.objectContaining({
      node_id: 'fac_revenue', operator: '>=', value: 0.04, unit: 'fraction', value_frame: 'level',
    }));
    if (admitted) expect(ctx.goalConstraints).toContainEqual(expect.objectContaining({
      node_id: f.candidate.constraint.node_id, operator: '<=', value: 0.04, unit: 'fraction', value_frame: 'level',
    }));
  });

  it.each([40000, 20000])('stage source ownership retains the actual noun amount occurrence in a multi-quantity quote (first amount: %s)', (firstValue) => {
    const f = fixture('a $20,000 budget for hiring', 20000, '$');
    const ctx = context(f);
    const first = firstValue === 40000 ? '$40,000' : '$20,000';
    // Prefix whitespace changes normalized offsets; the producer offsets remain
    // in the exact raw input. Equal quantities also cannot identify an occurrence.
    ctx.effectiveBrief = ` \tWe have a ${first} budget for travel and \n  a $20,000 budget for hiring. Keep acquisition cost under £250.`;
    const target = ctx.graph.nodes.find((n: any) => n.id === f.candidate.constraint.node_id);
    target.label = 'Budget';
    target.data = { unit: '£' };
    ctx.graph.nodes.push({ id: 'fac_acquisition_cost', kind: 'factor', label: 'Acquisition cost' });
    const legacy = structuredClone(ctx);
    legacy.recordConstraintCandidates = [];
    runCompoundGoals(legacy);
    const budget = legacy.goalConstraints.find((row: any) => row.node_id === target.id);
    expect(budget).toMatchObject({ value: 20000, unit: '$', value_frame: 'level' });
    expect(budget.source_quote).toContain(`${first} budget for travel`);
    expect(budget.source_quote).toContain('$20,000 budget for hiring');
    expect(budget).not.toHaveProperty('sourceAmountSpan');

    runCompoundGoals(ctx);
    expect(ctx.recordConstraintDispositions[0].reason).toBe('record_constraint_target_unit_mismatch');
    expect(ctx.goalConstraints).toHaveLength(firstValue === 20000 ? 2 : 1);
    expect(ctx.goalConstraints).toContainEqual(expect.objectContaining({
      node_id: 'fac_acquisition_cost', value: 250, unit: '£', value_frame: 'level',
    }));
    // The existing extractor selects the stricter second amount, but retains
    // the first occurrence on an equal-value tie. Only the second is owned by
    // this records quote: preserving the first is the discriminating positive.
    if (firstValue === 20000) expect(ctx.goalConstraints).toContainEqual(budget);
  });

  it('does not choose between competing explicit targets for one statement', () => {
    const f = fixture();
    const ctx = context(f);
    ctx.graph.nodes.find((n: any) => n.id === f.candidate.constraint.node_id).label = 'Monthly Churn';
    ctx.graph.nodes.push({ id: 'other_metric', kind: 'factor', label: 'Another Metric' });
    const regexOnly = structuredClone(ctx);
    regexOnly.recordConstraintCandidates = [];
    runCompoundGoals(regexOnly);
    expect(regexOnly.goalConstraints).toContainEqual(expect.objectContaining({ value: 0.04, unit: 'fraction' }));
    ctx.recordConstraintCandidates.push({ ...f.candidate, constraint: { ...f.candidate.constraint, node_id: 'other_metric' } });
    runCompoundGoals(ctx);
    expect(ctx.recordConstraintDispositions.map((d: any) => d.reason)).toEqual([
      'record_constraint_binding_conflict', 'record_constraint_binding_conflict',
    ]);
    expect(ctx.goalConstraints ?? []).toEqual([]);
    // The conflict is local to this source statement; an unrelated limit survives.
    ctx.effectiveBrief += ' Keep acquisition cost under £1500.';
    ctx.graph.nodes.push({ id: 'fac_acquisition_cost', kind: 'factor', label: 'Acquisition cost' });
    runCompoundGoals(ctx);
    expect(ctx.goalConstraints).toContainEqual(expect.objectContaining({
      node_id: 'fac_acquisition_cost', value: 1500, unit: '£', value_frame: 'level',
    }));
    expect(ctx.goalConstraints.every((row: any) => row.node_id === 'fac_acquisition_cost')).toBe(true);
  });
});
