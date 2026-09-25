/**
 * ⛔ A USER'S STATED GOAL TARGET SURVIVES AN UNRELATED EDIT.
 *
 * Served (CEE `bed9a0c`, 25 Sep 14:35Z, `witness-target-stamp-survival.sh`): the UI registers the goal node
 * with `threshold_source: 'user'` + `success_threshold` — its durable per-goal source of truth for a target
 * the user stated (UI `store.ts` ~:2377). The register write keeps both. The next unrelated turn-path write (a
 * `structural_add` of one factor) re-parses the graph through CEE's `NodeV3`, which declares neither, and
 * both are SILENTLY DELETED — the reload then reads the target as not stated by the user.
 *
 * `@talchain/schemas` already names `threshold_source` as a provenance stamp (ruling J2, `editable-fields`),
 * and `field-safety.ts` denies every producer from SETTING it. Preserving what was written is the other half.
 */
import { describe, expect, it } from 'vitest';

import { GraphV3 } from '../../../../../schemas/cee-v3.js';
import { applyAndValidateMutation } from '../apply-graph-mutation.js';

import { buildD1Fixture } from './fixtures.js';

type GoalLike = { id: string; kind: string; threshold_source?: unknown; success_threshold?: unknown; goal_threshold_raw?: unknown; not_a_declared_field?: unknown };

const stampedGraph = (stamp: Record<string, unknown>) => {
  const graph = buildD1Fixture() as unknown as { nodes: GoalLike[] };
  graph.nodes = graph.nodes.map((n) => (n.id === 'g-revenue' ? { ...n, goal_threshold_raw: 20, ...stamp } : n));
  return graph;
};
const unrelatedEdit = (graph: unknown) =>
  applyAndValidateMutation(graph, (clone) => {
    const node = clone.nodes.find((n) => n.id === 'f-churn');
    if (!node || !node.observed_state) throw new Error('fixture broken');
    node.observed_state = { ...node.observed_state, value: 0.05, raw_value: 5 };
    return { before: null, after: null };
  }).mutatedGraph;
const goalOf = (graph: unknown): GoalLike =>
  (graph as { nodes: GoalLike[] }).nodes.find((n) => n.id === 'g-revenue')!;

describe("a user's stated goal target survives an unrelated canonical edit", () => {
  it("RED: threshold_source 'user' + success_threshold survive an edit to a different node", () => {
    const after = goalOf(unrelatedEdit(stampedGraph({ threshold_source: 'user', success_threshold: 20 })));
    expect(after.goal_threshold_raw, 'the control: a declared goal field survives').toBe(20);
    expect(after.threshold_source).toBe('user');
    expect(after.success_threshold).toBe(20);
  });

  it('RED: a cleared target (success_threshold null) stays cleared, not erased into "never set"', () => {
    const after = goalOf(unrelatedEdit(stampedGraph({ threshold_source: 'user', success_threshold: null })));
    expect(after.threshold_source).toBe('user');
    expect(after.success_threshold).toBeNull();
  });

  it('RED: every GraphV3 parse site keeps them — the schema itself, not only this helper', () => {
    const parsed = GraphV3.safeParse(stampedGraph({ threshold_source: 'user', success_threshold: 20 }));
    expect(parsed.success).toBe(true);
    const goal = (parsed as { data: { nodes: GoalLike[] } }).data.nodes.find((n) => n.id === 'g-revenue')!;
    expect(goal.threshold_source).toBe('user');
    expect(goal.success_threshold).toBe(20);
  });

  it('CONTRAST: NodeV3 still strips a key it does not declare — this is a declaration, not a passthrough', () => {
    const after = goalOf(unrelatedEdit(stampedGraph({ threshold_source: 'user', not_a_declared_field: 'x' })));
    expect(after.threshold_source).toBe('user');
    expect(after.not_a_declared_field).toBeUndefined();
  });

  it('CONTRAST: a malformed stamp is dropped as before — never preserved, and never a new reason to refuse the whole graph', () => {
    const parsed = GraphV3.safeParse(stampedGraph({ threshold_source: 42, success_threshold: 'twenty' }));
    expect(parsed.success, 'a stored graph that parsed before must still parse').toBe(true);
    const goal = (parsed as { data: { nodes: GoalLike[] } }).data.nodes.find((n) => n.id === 'g-revenue')!;
    expect(goal.success_threshold).toBeUndefined();
    expect(goal.threshold_source).toBeUndefined();
    expect(JSON.parse(JSON.stringify(goal))).not.toHaveProperty('success_threshold');
  });
});
