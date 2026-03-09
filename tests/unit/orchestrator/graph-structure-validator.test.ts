import { describe, it, expect, vi } from 'vitest';
import { validateGraphStructure, type StructuralViolationCode } from '../../../src/orchestrator/graph-structure-validator.js';
import type { GraphV3T } from '../../../src/schemas/cee-v3.js';

// ============================================================================
// Helper — valid minimal graph
// ============================================================================

function makeValidGraph(): GraphV3T {
  return {
    nodes: [
      { id: 'dec_1', kind: 'decision', label: 'Choose pricing' },
      { id: 'opt_a', kind: 'option', label: 'Option A' },
      { id: 'opt_b', kind: 'option', label: 'Option B' },
      { id: 'fac_x', kind: 'factor', label: 'Market size' },
      { id: 'goal_1', kind: 'goal', label: 'Revenue' },
    ],
    edges: [
      { from: 'dec_1', to: 'opt_a', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'dec_1', to: 'opt_b', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'opt_a', to: 'fac_x', strength: { mean: 0.5, std: 0.2 }, exists_probability: 0.9, effect_direction: 'positive' },
      { from: 'opt_b', to: 'fac_x', strength: { mean: 0.3, std: 0.1 }, exists_probability: 0.8, effect_direction: 'positive' },
      { from: 'fac_x', to: 'goal_1', strength: { mean: 0.7, std: 0.15 }, exists_probability: 0.95, effect_direction: 'positive' },
    ],
  } as unknown as GraphV3T;
}

function hasViolation(result: ReturnType<typeof validateGraphStructure>, code: StructuralViolationCode): boolean {
  return result.violations.some((v) => v.code === code);
}

describe('validateGraphStructure', () => {
  it('valid graph passes', () => {
    const result = validateGraphStructure(makeValidGraph());
    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('NO_GOAL: detects missing goal node', () => {
    const graph = makeValidGraph();
    graph.nodes = graph.nodes.filter((n) => n.kind !== 'goal');
    // Remove edges pointing to goal
    graph.edges = graph.edges.filter((e) => e.to !== 'goal_1');

    const result = validateGraphStructure(graph);
    expect(result.valid).toBe(false);
    expect(hasViolation(result, 'NO_GOAL')).toBe(true);
  });

  it('NO_DECISION: detects missing decision node', () => {
    const graph = makeValidGraph();
    graph.nodes = graph.nodes.filter((n) => n.kind !== 'decision');
    graph.edges = graph.edges.filter((e) => e.from !== 'dec_1');

    const result = validateGraphStructure(graph);
    expect(result.valid).toBe(false);
    expect(hasViolation(result, 'NO_DECISION')).toBe(true);
  });

  it('FEWER_THAN_TWO_OPTIONS: detects fewer than 2 option nodes', () => {
    const graph = makeValidGraph();
    graph.nodes = graph.nodes.filter((n) => n.id !== 'opt_b');
    graph.edges = graph.edges.filter((e) => e.from !== 'opt_b' && e.to !== 'opt_b');

    const result = validateGraphStructure(graph);
    expect(result.valid).toBe(false);
    expect(hasViolation(result, 'FEWER_THAN_TWO_OPTIONS')).toBe(true);
  });

  it('NODE_LIMIT_EXCEEDED: detects more than default 20 nodes', () => {
    const graph = makeValidGraph();
    // Add 16 more nodes (5 existing + 16 = 21 > default 20)
    for (let i = 0; i < 16; i++) {
      const id = `extra_${i}`;
      graph.nodes.push({ id, kind: 'factor', label: `Extra ${i}` } as GraphV3T['nodes'][number]);
      // Connect to avoid orphan violation
      graph.edges.push({
        from: 'opt_a', to: id,
        strength: { mean: 0.1, std: 0.1 }, exists_probability: 0.5, effect_direction: 'positive',
      } as GraphV3T['edges'][number]);
    }

    const result = validateGraphStructure(graph);
    expect(result.valid).toBe(false);
    expect(hasViolation(result, 'NODE_LIMIT_EXCEEDED')).toBe(true);
  });

  it('EDGE_LIMIT_EXCEEDED: detects more than default 30 edges', () => {
    const graph = makeValidGraph();
    // Add enough extra nodes and edges to exceed 30
    // 5 existing edges + 13 nodes × 2 edges each = 5 + 26 = 31 > 30
    for (let i = 0; i < 13; i++) {
      const id = `extra_${i}`;
      graph.nodes.push({ id, kind: 'factor', label: `Extra ${i}` } as GraphV3T['nodes'][number]);
      graph.edges.push({
        from: 'opt_a', to: id,
        strength: { mean: 0.1, std: 0.1 }, exists_probability: 0.5, effect_direction: 'positive',
      } as GraphV3T['edges'][number]);
      graph.edges.push({
        from: 'opt_b', to: id,
        strength: { mean: 0.1, std: 0.1 }, exists_probability: 0.5, effect_direction: 'positive',
      } as GraphV3T['edges'][number]);
    }

    const result = validateGraphStructure(graph);
    expect(result.valid).toBe(false);
    expect(hasViolation(result, 'EDGE_LIMIT_EXCEEDED')).toBe(true);
  });

  it('ORPHAN_NODE: detects node with no edges', () => {
    const graph = makeValidGraph();
    graph.nodes.push({ id: 'orphan_1', kind: 'factor', label: 'Orphan' } as GraphV3T['nodes'][number]);

    const result = validateGraphStructure(graph);
    expect(result.valid).toBe(false);
    expect(hasViolation(result, 'ORPHAN_NODE')).toBe(true);
    expect(result.violations.find((v) => v.code === 'ORPHAN_NODE')!.detail).toContain('orphan_1');
  });

  it('NO_PATH_TO_GOAL: detects node not reachable from decision', () => {
    const graph = makeValidGraph();
    // Add a disconnected subgraph (connected to each other but not to decision)
    graph.nodes.push({ id: 'island_a', kind: 'factor', label: 'Island A' } as GraphV3T['nodes'][number]);
    graph.nodes.push({ id: 'island_b', kind: 'factor', label: 'Island B' } as GraphV3T['nodes'][number]);
    graph.edges.push({
      from: 'island_a', to: 'island_b',
      strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive',
    } as GraphV3T['edges'][number]);

    const result = validateGraphStructure(graph);
    expect(result.valid).toBe(false);
    expect(hasViolation(result, 'NO_PATH_TO_GOAL')).toBe(true);
  });

  it('CYCLE_DETECTED: detects directed cycle', () => {
    const graph = makeValidGraph();
    // Create cycle: goal_1 → fac_x (fac_x→goal_1 already exists)
    graph.edges.push({
      from: 'goal_1', to: 'fac_x',
      strength: { mean: 0.1, std: 0.1 }, exists_probability: 0.5, effect_direction: 'positive',
    } as GraphV3T['edges'][number]);

    const result = validateGraphStructure(graph);
    expect(result.valid).toBe(false);
    expect(hasViolation(result, 'CYCLE_DETECTED')).toBe(true);
  });

  it('reports multiple violations without short-circuiting', () => {
    const graph: GraphV3T = {
      nodes: [
        // No decision, no goal, only 1 option, plus an orphan
        { id: 'opt_a', kind: 'option', label: 'Option A' },
        { id: 'orphan_1', kind: 'factor', label: 'Orphan' },
      ],
      edges: [],
    } as unknown as GraphV3T;

    const result = validateGraphStructure(graph);
    expect(result.valid).toBe(false);

    // Should report at least: NO_GOAL, NO_DECISION, FEWER_THAN_TWO_OPTIONS, ORPHAN_NODE (×2)
    expect(hasViolation(result, 'NO_GOAL')).toBe(true);
    expect(hasViolation(result, 'NO_DECISION')).toBe(true);
    expect(hasViolation(result, 'FEWER_THAN_TWO_OPTIONS')).toBe(true);
    expect(hasViolation(result, 'ORPHAN_NODE')).toBe(true);
    expect(result.violations.length).toBeGreaterThanOrEqual(4);
  });

  it('defaults are 20 nodes / 30 edges (from env or hardcoded default)', () => {
    // With no env override and default limits of 20/30, a graph with exactly 20 nodes should pass
    const graph = makeValidGraph();
    // Add 15 more nodes (5 existing + 15 = 20, exactly at limit)
    for (let i = 0; i < 15; i++) {
      const id = `extra_${i}`;
      graph.nodes.push({ id, kind: 'factor', label: `Extra ${i}` } as GraphV3T['nodes'][number]);
      graph.edges.push({
        from: 'opt_a', to: id,
        strength: { mean: 0.1, std: 0.1 }, exists_probability: 0.5, effect_direction: 'positive',
      } as GraphV3T['edges'][number]);
    }

    const result = validateGraphStructure(graph);
    expect(hasViolation(result, 'NODE_LIMIT_EXCEEDED')).toBe(false);
  });

  it('env override: CEE_GRAPH_MAX_NODES and CEE_GRAPH_MAX_EDGES are respected', async () => {
    // Re-import with env overrides set — module-level constants re-evaluate
    vi.stubEnv('CEE_GRAPH_MAX_NODES', '4');
    vi.stubEnv('CEE_GRAPH_MAX_EDGES', '3');

    // Dynamic import with unique query string to bypass vitest module cache
    const { validateGraphStructure: validate } = await import(
      '../../../src/orchestrator/graph-structure-validator.js?env-override-test'
    );

    const graph = makeValidGraph(); // 5 nodes, 5 edges
    const result = validate(graph);
    expect(hasViolation(result, 'NODE_LIMIT_EXCEEDED')).toBe(true); // 5 nodes > 4 limit
    expect(hasViolation(result, 'EDGE_LIMIT_EXCEEDED')).toBe(true); // 5 edges > 3 limit

    vi.unstubAllEnvs();
  });

  it('NaN env values fall back to defaults (limits still enforced)', async () => {
    vi.stubEnv('CEE_GRAPH_MAX_NODES', 'not-a-number');
    vi.stubEnv('CEE_GRAPH_MAX_EDGES', '');

    const { validateGraphStructure: validate } = await import(
      '../../../src/orchestrator/graph-structure-validator.js?nan-guard-test'
    );

    // With defaults (20/30), a graph with 21 nodes should exceed the limit
    const graph = makeValidGraph();
    for (let i = 0; i < 16; i++) {
      const id = `nan_${i}`;
      graph.nodes.push({ id, kind: 'factor', label: `NaN ${i}` } as GraphV3T['nodes'][number]);
      graph.edges.push({
        from: 'opt_a', to: id,
        strength: { mean: 0.1, std: 0.1 }, exists_probability: 0.5, effect_direction: 'positive',
      } as GraphV3T['edges'][number]);
    }

    const result = validate(graph);
    // Defaults should be enforced (20 nodes), 21 nodes > 20
    expect(hasViolation(result, 'NODE_LIMIT_EXCEEDED')).toBe(true);

    vi.unstubAllEnvs();
  });
});
