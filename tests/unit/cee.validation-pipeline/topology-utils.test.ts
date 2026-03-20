import { describe, it, expect } from 'vitest';
import { computeDistancesToGoal, edgeDistanceToGoal } from '../../../src/cee/validation-pipeline/topology-utils.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function edge(from: string, to: string, extra: Record<string, unknown> = {}) {
  return { from, to, ...extra };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('computeDistancesToGoal', () => {
  it('goal node itself has distance 0', () => {
    const nodes = ['goal_z'];
    const distances = computeDistancesToGoal(nodes, [], 'goal_z');
    expect(distances.get('goal_z')).toBe(0);
  });

  it('linear chain: fac → out → goal', () => {
    const nodes = ['fac_x', 'out_y', 'goal_z'];
    const edges = [edge('fac_x', 'out_y'), edge('out_y', 'goal_z')];
    const distances = computeDistancesToGoal(nodes, edges, 'goal_z');
    expect(distances.get('goal_z')).toBe(0);
    expect(distances.get('out_y')).toBe(1);
    expect(distances.get('fac_x')).toBe(2);
  });

  it('branching DAG: two factors reach goal through different paths', () => {
    // fac_a → out_1 → goal
    // fac_b → out_2 → goal
    const nodes = ['fac_a', 'fac_b', 'out_1', 'out_2', 'goal'];
    const edges = [
      edge('fac_a', 'out_1'),
      edge('fac_b', 'out_2'),
      edge('out_1', 'goal'),
      edge('out_2', 'goal'),
    ];
    const distances = computeDistancesToGoal(nodes, edges, 'goal');
    expect(distances.get('out_1')).toBe(1);
    expect(distances.get('out_2')).toBe(1);
    expect(distances.get('fac_a')).toBe(2);
    expect(distances.get('fac_b')).toBe(2);
  });

  it('uses shortest path when multiple routes exist', () => {
    // fac_x → goal (direct, distance 1)
    // fac_x → out_y → goal (via out, distance 2 for out_y but fac_x is still 1)
    const nodes = ['fac_x', 'out_y', 'goal'];
    const edges = [
      edge('fac_x', 'goal'),
      edge('fac_x', 'out_y'),
      edge('out_y', 'goal'),
    ];
    const distances = computeDistancesToGoal(nodes, edges, 'goal');
    expect(distances.get('fac_x')).toBe(1);
    expect(distances.get('out_y')).toBe(1);
  });

  it('disconnected node has Infinity distance', () => {
    const nodes = ['fac_orphan', 'goal'];
    const distances = computeDistancesToGoal(nodes, [], 'goal');
    expect(distances.get('fac_orphan')).toBe(Infinity);
    expect(distances.get('goal')).toBe(0);
  });

  it('excludes bidirected edges from BFS', () => {
    // fac_a → fac_b (bidirected) should not count as a path
    // fac_a is unreachable if only connected via bidirected edge
    const nodes = ['fac_a', 'fac_b', 'goal'];
    const edges = [
      edge('fac_b', 'goal'),
      edge('fac_a', 'fac_b', { edge_type: 'bidirected' }),
    ];
    const distances = computeDistancesToGoal(nodes, edges, 'goal');
    expect(distances.get('fac_b')).toBe(1);
    // fac_a has no directed path to goal
    expect(distances.get('fac_a')).toBe(Infinity);
  });

  it('handles goal node not in nodeIds array', () => {
    // Goal node may not be explicitly listed but should still be registered.
    const nodes = ['fac_x', 'out_y'];
    const edges = [edge('fac_x', 'out_y'), edge('out_y', 'goal')];
    const distances = computeDistancesToGoal(nodes, edges, 'goal');
    expect(distances.get('goal')).toBe(0);
    expect(distances.get('out_y')).toBe(1);
    expect(distances.get('fac_x')).toBe(2);
  });

  it('handles empty graph', () => {
    const distances = computeDistancesToGoal([], [], 'goal');
    expect(distances.get('goal')).toBe(0);
    expect(distances.size).toBe(1);
  });
});

describe('edgeDistanceToGoal', () => {
  it('returns distance of the edge target node', () => {
    const distances = new Map([['out_y', 1], ['goal', 0]]);
    expect(edgeDistanceToGoal(distances, 'out_y')).toBe(1);
    expect(edgeDistanceToGoal(distances, 'goal')).toBe(0);
  });

  it('returns finite sentinel (999) for unknown nodes instead of Infinity', () => {
    const distances = new Map([['goal', 0]]);
    expect(edgeDistanceToGoal(distances, 'unknown_node')).toBe(999);
    expect(Number.isFinite(edgeDistanceToGoal(distances, 'unknown_node'))).toBe(true);
  });
});
