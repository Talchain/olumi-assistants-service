import { describe, it, expect } from 'vitest';
import { isStructuralEdge, extractGraphStructureForPass2 } from '../../../src/cee/validation-pipeline/utils.js';
import type { EdgeV3T, NodeV3T } from '../../../src/schemas/cee-v3.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeEdge(mean: number, std: number, ep: number, extra: Record<string, unknown> = {}): EdgeV3T {
  return {
    from: 'a',
    to: 'b',
    strength: { mean, std },
    exists_probability: ep,
    effect_direction: mean >= 0 ? 'positive' : 'negative',
    ...extra,
  } as unknown as EdgeV3T;
}

function makeNode(id: string, kind: string, label: string, extra: Record<string, unknown> = {}): NodeV3T {
  return { id, kind, label, ...extra } as unknown as NodeV3T;
}

// ── isStructuralEdge ─────────────────────────────────────────────────────────

describe('isStructuralEdge', () => {
  it('identifies sentinel structural edges (mean=1.0, std=0.01, ep=1.0)', () => {
    expect(isStructuralEdge(makeEdge(1.0, 0.01, 1.0))).toBe(true);
  });

  it('allows tiny floating-point deviation in mean', () => {
    expect(isStructuralEdge(makeEdge(1.0000001, 0.01, 1.0))).toBe(true);
  });

  it('rejects causal edges with realistic parameters', () => {
    expect(isStructuralEdge(makeEdge(0.6, 0.15, 0.85))).toBe(false);
  });

  it('rejects edge where mean is 1.0 but std is not sentinel', () => {
    expect(isStructuralEdge(makeEdge(1.0, 0.10, 1.0))).toBe(false);
  });

  it('rejects edge where ep is not 1.0', () => {
    expect(isStructuralEdge(makeEdge(1.0, 0.01, 0.90))).toBe(false);
  });

  it('rejects edge with negative mean', () => {
    expect(isStructuralEdge(makeEdge(-0.5, 0.15, 0.80))).toBe(false);
  });
});

// ── extractGraphStructureForPass2 ────────────────────────────────────────────

describe('extractGraphStructureForPass2', () => {
  const nodes: NodeV3T[] = [
    makeNode('dec_1', 'decision', 'The Decision'),
    makeNode('opt_a', 'option', 'Option A'),
    makeNode('fac_x', 'factor', 'Factor X', { category: 'external' }),
    makeNode('out_y', 'outcome', 'Outcome Y'),
    makeNode('goal_z', 'goal', 'Goal Z'),
  ];

  const causalEdge = makeEdge(0.6, 0.15, 0.85);
  Object.assign(causalEdge, { from: 'fac_x', to: 'out_y' });

  const structuralEdge = makeEdge(1.0, 0.01, 1.0);
  Object.assign(structuralEdge, { from: 'dec_1', to: 'opt_a' });

  const bidirectedEdge = makeEdge(0, 0.01, 1.0);
  Object.assign(bidirectedEdge, { from: 'fac_x', to: 'out_y', edge_type: 'bidirected' });

  it('filters out structural sentinel edges', () => {
    const { edges } = extractGraphStructureForPass2(nodes, [structuralEdge]);
    expect(edges).toHaveLength(0);
  });

  it('filters out bidirected edges', () => {
    const { edges } = extractGraphStructureForPass2(nodes, [bidirectedEdge]);
    expect(edges).toHaveLength(0);
  });

  it('includes causal edges', () => {
    const { edges } = extractGraphStructureForPass2(nodes, [causalEdge]);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toEqual({ from: 'fac_x', to: 'out_y' });
  });

  it('maps nodes to minimal shape (no parameter values)', () => {
    const { nodes: nodeInputs } = extractGraphStructureForPass2(nodes, []);
    const factorNode = nodeInputs.find((n) => n.id === 'fac_x');
    expect(factorNode).toBeDefined();
    expect(factorNode?.category).toBe('external');
    // No strength, ep, or observed_state values
    expect((factorNode as any).strength).toBeUndefined();
    expect((factorNode as any).exists_probability).toBeUndefined();
    expect((factorNode as any).observed_state).toBeUndefined();
  });

  it('omits category when not set', () => {
    const { nodes: nodeInputs } = extractGraphStructureForPass2(nodes, []);
    const goal = nodeInputs.find((n) => n.id === 'goal_z');
    expect(goal).toBeDefined();
    expect(Object.prototype.hasOwnProperty.call(goal, 'category')).toBe(false);
  });

  it('includes edge label when present', () => {
    const labelledEdge = { ...causalEdge, from: 'fac_x', to: 'out_y', label: 'affects' };
    const { edges } = extractGraphStructureForPass2(nodes, [labelledEdge as unknown as EdgeV3T]);
    expect(edges[0].label).toBe('affects');
  });

  it('handles empty graph', () => {
    const result = extractGraphStructureForPass2([], []);
    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
  });
});
