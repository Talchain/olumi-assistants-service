import { describe, it, expect } from "vitest";
import {
  buildAddRiskOperations,
  buildAddRiskConfirmation,
  TemplateBuildError,
} from "../../../../src/orchestrator-v5/handlers/edit-templates/add-risk-template.js";
import { PatchOperationsArraySchema } from "../../../../src/orchestrator/patch-validation.js";
import { applyPatchOperations } from "../../../../src/orchestrator/patch-applier.js";
import { validateGraphStructure } from "../../../../src/orchestrator/graph-structure-validator.js";
import type { GraphV3T } from "../../../../src/schemas/cee-v3.js";

const baseGraph = (): GraphV3T => ({
  nodes: [
    { id: 'goal_1', kind: 'goal', label: 'Reach 1000 customers' },
    { id: 'dec_1', kind: 'decision', label: 'Pricing model' },
    { id: 'opt_a', kind: 'option', label: 'Subscription' },
    { id: 'opt_b', kind: 'option', label: 'One-off' },
    { id: 'fac_price', kind: 'factor', label: 'Price' },
  ],
  edges: [
    { from: 'dec_1', to: 'opt_a', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'dec_1', to: 'opt_b', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'opt_a', to: 'fac_price', strength: { mean: 0.4, std: 0.1 }, exists_probability: 0.8, effect_direction: 'positive' },
    { from: 'opt_b', to: 'fac_price', strength: { mean: 0.3, std: 0.1 }, exists_probability: 0.8, effect_direction: 'positive' },
    { from: 'fac_price', to: 'goal_1', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.8, effect_direction: 'positive' },
  ],
} as unknown as GraphV3T);

describe('buildAddRiskOperations', () => {
  it('produces three operations: risk node + decision->risk + risk->goal', () => {
    const result = buildAddRiskOperations('team dynamics', baseGraph());
    expect(result.operations).toHaveLength(3);
    expect(result.riskNodeId).toBe('risk_team_dynamics');
    expect(result.goalId).toBe('goal_1');
    expect(result.decisionId).toBe('dec_1');

    const [nodeOp, decisionEdgeOp, goalEdgeOp] = result.operations;
    expect(nodeOp.op).toBe('add_node');
    expect((nodeOp.value as { kind: string }).kind).toBe('risk');
    expect((nodeOp.value as { label: string }).label).toBe('team dynamics');

    expect(decisionEdgeOp.op).toBe('add_edge');
    expect((decisionEdgeOp.value as { from: string; to: string }).from).toBe('dec_1');
    expect((decisionEdgeOp.value as { from: string; to: string }).to).toBe('risk_team_dynamics');

    expect(goalEdgeOp.op).toBe('add_edge');
    const ge = goalEdgeOp.value as { from: string; to: string; strength: { mean: number }; effect_direction: string };
    expect(ge.from).toBe('risk_team_dynamics');
    expect(ge.to).toBe('goal_1');
    expect(ge.strength.mean).toBeLessThan(0); // NEGATIVE bridge — risks hurt the goal
    expect(ge.effect_direction).toBe('negative');
  });

  it('throws TemplateBuildError when no goal node exists', () => {
    const graph: GraphV3T = {
      nodes: [{ id: 'dec_1', kind: 'decision', label: 'Decision' }],
      edges: [],
    } as unknown as GraphV3T;
    expect(() => buildAddRiskOperations('foo bar', graph)).toThrow(TemplateBuildError);
  });

  it('throws TemplateBuildError when no decision node exists', () => {
    const graph: GraphV3T = {
      nodes: [{ id: 'goal_1', kind: 'goal', label: 'Goal' }],
      edges: [],
    } as unknown as GraphV3T;
    try {
      buildAddRiskOperations('foo bar', graph);
      expect.fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(TemplateBuildError);
      expect((err as TemplateBuildError).code).toBe('no_decision');
    }
  });

  it('produced operations pass PatchOperationSchema (Zod)', () => {
    const { operations } = buildAddRiskOperations('team dynamics', baseGraph());
    const parsed = PatchOperationsArraySchema.safeParse(operations);
    expect(parsed.success).toBe(true);
  });

  it('candidate graph passes validateGraphStructure (no new violations)', () => {
    const graph = baseGraph();
    const { operations } = buildAddRiskOperations('team dynamics', graph);
    const candidate = applyPatchOperations(graph, operations);
    const result = validateGraphStructure(candidate);
    expect(result.valid).toBe(true);
  });
});

describe('buildAddRiskConfirmation', () => {
  it('asks the user what factors drive the risk', () => {
    const text = buildAddRiskConfirmation('team dynamics');
    expect(text).toContain('team dynamics');
    expect(text).toContain('What factors drive this risk');
  });

  it('contains no raw IDs, operation counts, or schema language', () => {
    const text = buildAddRiskConfirmation('team dynamics');
    expect(text).not.toMatch(/risk_team_dynamics/);
    expect(text).not.toMatch(/\boperation\b/i);
    expect(text).not.toMatch(/\bpatch\b/i);
    expect(text).not.toMatch(/\b\d+\s*(operation|edge|node)/i);
  });
});
