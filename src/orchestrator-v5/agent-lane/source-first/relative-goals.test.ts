import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { compileSourceMeaning, sourceEntityId } from './compiler.js';
import type { SourceMeaning } from './meaning.js';

const captures = JSON.parse(readFileSync(new URL('./fixtures/repaired-live-source-meaning.json', import.meta.url), 'utf8')) as Array<{ case: string; brief: string; meaning: SourceMeaning }>;
const cloud = () => structuredClone(captures.find((capture) => capture.case === 'cloud')!);

describe('relative goals use typed metric references', () => {
  it('withholds the frozen relative target instead of borrowing another entity’s baseline or unit', () => {
    const captured = cloud();
    const result = compileSourceMeaning(captured.brief, captured.meaning);
    const graph = GraphV3.parse(JSON.parse(JSON.stringify(result.graph)));
    const goal = graph.nodes.find((node) => node.id === sourceEntityId('g1'))!;
    expect(goal.source_quote).toBe('we want to cut costs by 20%');
    expect(goal.goal_threshold_raw).toBeUndefined();
    expect(goal.goal_threshold_frame).toBeUndefined();
    expect(goal.goal_threshold_unit).toBeUndefined();
    expect(goal.goal_threshold).toBeUndefined();
    expect(goal.goal_threshold_cap).toBeUndefined();
    expect(goal.threshold_source).toBeUndefined();
    expect(goal.observed_state).toBeUndefined();
    expect(graph.nodes.find((node) => node.id === sourceEntityId('f1'))?.observed_state).toMatchObject({ raw_value: 45000, unit: 'GBP per month' });
    expect(result.unresolved).toContainEqual(expect.objectContaining({ ref: 'q2', code: 'relative_goal_metric_unbound' }));
    expect(result.unresolved.some((finding) => finding.ref === 'q2' && finding.code === 'unassigned_change')).toBe(false);
    expect(graph.edges).toEqual([expect.objectContaining({ from: sourceEntityId('d1'), to: sourceEntityId('o1'), origin: 'structural' })]);
  });

  it('compiles the full canonical target only when current and change already share one metric reference', () => {
    const captured = cloud();
    // Positive typed-contract fixture, not a repair of the frozen provider output.
    captured.meaning.quantities.find((claim) => claim.ref === 'q1')!.entity_ref = 'g1';
    captured.meaning.entities = captured.meaning.entities.filter((entity) => entity.ref !== 'f1');
    const result = compileSourceMeaning(captured.brief, captured.meaning);
    const graph = GraphV3.parse(JSON.parse(JSON.stringify(result.graph)));
    const goal = graph.nodes.find((node) => node.id === sourceEntityId('g1'))!;
    expect(goal).toMatchObject({ goal_threshold_raw: -0.2, goal_threshold: -0.2,
      goal_threshold_frame: 'change_rel', goal_threshold_unit: 'GBP per month',
      threshold_source: 'brief_extraction',
      observed_state: { raw_value: 45000, unit: 'GBP per month', source_quote: 'Monthly spend is £45k' } });
    expect(goal.goal_threshold_cap).toBeGreaterThanOrEqual(45000);
    expect(goal.observed_state!.value * goal.goal_threshold_cap!).toBe(45000);
    expect(result.unresolved.some((finding) => finding.ref === 'q2')).toBe(false);
    expect(graph.nodes.some((node) => node.observed_state?.raw_value === 36000 || node.goal_threshold_raw === 36000)).toBe(false);
  });

  it('does not merge separate metric references even when their labels match', () => {
    const captured = cloud();
    captured.meaning.entities.find((entity) => entity.ref === 'f1')!.label = 'Cloud cost';
    captured.meaning.entities.find((entity) => entity.ref === 'g1')!.label = 'Cloud cost';
    const result = compileSourceMeaning(captured.brief, captured.meaning);
    const goal = result.graph.nodes.find((node) => node.id === sourceEntityId('g1'))!;
    expect(goal.observed_state).toBeUndefined();
    expect(goal.goal_threshold_unit).toBeUndefined();
    expect(goal.goal_threshold_raw).toBeUndefined();
    expect(result.unresolved).toContainEqual(expect.objectContaining({ ref: 'q2', code: 'relative_goal_metric_unbound' }));
  });
});
