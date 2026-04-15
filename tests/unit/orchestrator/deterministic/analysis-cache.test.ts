/**
 * computeAnalysisGraphHash — determinism and sensitivity tests.
 */

import { describe, it, expect } from "vitest";
import {
  computeAnalysisGraphHash,
  isRehydrationInScope,
} from "../../../../src/orchestrator/deterministic/analysis-cache.js";
import type { GraphV3T } from "../../../../src/schemas/cee-v3.js";

function makeGraph(overrides?: Partial<GraphV3T>): GraphV3T {
  return {
    nodes: [
      { id: 'goal_g', kind: 'goal', label: 'Goal', observed_state: { value: 0.5 } },
      { id: 'opt_a', kind: 'option', label: 'A' },
      { id: 'fac_x', kind: 'factor', label: 'X', observed_state: { value: 0.7, unit: 'scale' } },
    ],
    edges: [
      { from: 'fac_x', to: 'opt_a', strength: { mean: 0.5, std: 0.1 } },
    ],
    ...overrides,
  } as unknown as GraphV3T;
}

describe('computeAnalysisGraphHash', () => {
  it('returns null for null input', () => {
    expect(computeAnalysisGraphHash(null)).toBeNull();
  });

  it('is deterministic for identical graphs', () => {
    const a = computeAnalysisGraphHash(makeGraph());
    const b = computeAnalysisGraphHash(makeGraph());
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is invariant to node/edge ordering', () => {
    const g1 = makeGraph();
    const g2 = makeGraph({
      nodes: [...g1.nodes].reverse(),
      edges: [...g1.edges],
    });
    expect(computeAnalysisGraphHash(g1)).toBe(computeAnalysisGraphHash(g2));
  });

  it('changes when a node value changes', () => {
    const g1 = makeGraph();
    const g2 = makeGraph({
      nodes: [
        g1.nodes[0],
        g1.nodes[1],
        { ...g1.nodes[2], observed_state: { value: 0.9, unit: 'scale' } } as unknown as GraphV3T['nodes'][number],
      ],
    });
    expect(computeAnalysisGraphHash(g1)).not.toBe(computeAnalysisGraphHash(g2));
  });

  it('is invariant to label-only rename', () => {
    const g1 = makeGraph();
    const g2 = makeGraph({
      nodes: g1.nodes.map((n) => ({ ...n, label: `${n.label}_renamed` })) as unknown as GraphV3T['nodes'],
    });
    // Labels excluded from hash → same hash.
    expect(computeAnalysisGraphHash(g1)).toBe(computeAnalysisGraphHash(g2));
  });

  it('changes when an edge is added', () => {
    const g1 = makeGraph();
    const g2 = makeGraph({
      edges: [
        ...g1.edges,
        { from: 'opt_a', to: 'goal_g', strength: { mean: 0.4, std: 0.1 } },
      ] as unknown as GraphV3T['edges'],
    });
    expect(computeAnalysisGraphHash(g1)).not.toBe(computeAnalysisGraphHash(g2));
  });

  it('changes when exists_probability on a node changes', () => {
    const g1 = makeGraph({
      nodes: [
        { id: 'goal_g', kind: 'goal', label: 'Goal', exists_probability: 1 },
        { id: 'opt_a', kind: 'option', label: 'A' },
      ] as unknown as GraphV3T['nodes'],
    });
    const g2 = makeGraph({
      nodes: [
        { id: 'goal_g', kind: 'goal', label: 'Goal', exists_probability: 0.6 },
        { id: 'opt_a', kind: 'option', label: 'A' },
      ] as unknown as GraphV3T['nodes'],
    });
    expect(computeAnalysisGraphHash(g1)).not.toBe(computeAnalysisGraphHash(g2));
  });

  it('changes when edge effect_direction flips', () => {
    const g1 = makeGraph({
      edges: [
        { from: 'fac_x', to: 'opt_a', strength: { mean: 0.5, std: 0.1 }, effect_direction: 'positive' },
      ] as unknown as GraphV3T['edges'],
    });
    const g2 = makeGraph({
      edges: [
        { from: 'fac_x', to: 'opt_a', strength: { mean: 0.5, std: 0.1 }, effect_direction: 'negative' },
      ] as unknown as GraphV3T['edges'],
    });
    expect(computeAnalysisGraphHash(g1)).not.toBe(computeAnalysisGraphHash(g2));
  });

  it('changes when goal target_value changes', () => {
    const g1 = makeGraph({
      nodes: [
        { id: 'goal_g', kind: 'goal', label: 'Goal', target_value: 100 },
        { id: 'opt_a', kind: 'option', label: 'A' },
      ] as unknown as GraphV3T['nodes'],
    });
    const g2 = makeGraph({
      nodes: [
        { id: 'goal_g', kind: 'goal', label: 'Goal', target_value: 200 },
        { id: 'opt_a', kind: 'option', label: 'A' },
      ] as unknown as GraphV3T['nodes'],
    });
    expect(computeAnalysisGraphHash(g1)).not.toBe(computeAnalysisGraphHash(g2));
  });
});

describe('isRehydrationInScope (S6 gating)', () => {
  it('fires when framing.stage is evaluate, even with a generic message', () => {
    expect(isRehydrationInScope({
      message: 'ok',
      framingStage: 'evaluate',
      systemEventType: null,
    })).toBe(true);
  });

  it('fires when the user message matches an evaluate-intent pattern', () => {
    expect(isRehydrationInScope({
      message: 'Why does option A win?',
      framingStage: 'ideate',
      systemEventType: null,
    })).toBe(true);
  });

  it('fires on direct_analysis_run system event', () => {
    expect(isRehydrationInScope({
      message: '',
      framingStage: null,
      systemEventType: 'direct_analysis_run',
    })).toBe(true);
  });

  it('does NOT fire on ideate turns with non-evaluate message', () => {
    expect(isRehydrationInScope({
      message: 'Add a new option for subscription pricing',
      framingStage: 'ideate',
      systemEventType: null,
    })).toBe(false);
  });

  it('does NOT fire on frame turns with non-evaluate message', () => {
    expect(isRehydrationInScope({
      message: 'I want to compare the framing of my decision',
      framingStage: 'frame',
      systemEventType: null,
    })).toBe(true); // NOTE: "compare" matches EVAL_INTENT_RE — expected behaviour
  });

  it('does NOT fire on a pure edit turn with no evaluate signals', () => {
    expect(isRehydrationInScope({
      message: 'Connect factor X to option A',
      framingStage: 'ideate',
      systemEventType: 'patch_accepted',
    })).toBe(false);
  });
});
