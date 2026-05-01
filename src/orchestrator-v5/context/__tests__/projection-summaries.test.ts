/**
 * Projection summaries — unit tests.
 */

import { describe, expect, it } from 'vitest';

import type {
  ContextPackAnalysis,
  ContextPackGraph,
} from '../context-pack-assembler.js';
import {
  buildAnalysisProjectionSummary,
  buildStructureProjectionSummary,
} from '../projection-summaries.js';

const ANALYSIS: ContextPackAnalysis = {
  status: 'complete',
  leading_option: { label: 'Hire Senior Engineer', probability: 0.62 },
  runner_up: { label: 'Hire Two Mid-Level', probability: 0.27 },
  margin_pp: 35,
  robustness_band: 'stable',
  top_drivers: [
    { factor_label: 'Engineering Capacity', sensitivity_value: 0.65 },
    { factor_label: 'Hiring Cost', sensitivity_value: -0.42 },
  ],
  fragile_edges: [],
};

function makeGraph(
  nodes: ReadonlyArray<{ id: string; kind: string; label: string }>,
  edges: ReadonlyArray<{
    from: string;
    to: string;
    strength: number;
    plain_interpretation?: string;
  }>,
): ContextPackGraph {
  const options = nodes
    .filter((n) => n.kind === 'option')
    .map((n) => ({ id: n.id, label: n.label }));
  return {
    nodes,
    edges,
    options,
    goals: nodes.filter((n) => n.kind === 'goal'),
    constraints: [],
    counts: {
      nodes: nodes.length,
      edges: edges.length,
      options: options.length,
      goals: nodes.filter((n) => n.kind === 'goal').length,
      constraints: 0,
    },
  };
}

describe('buildAnalysisProjectionSummary', () => {
  it('returns null when analysis is null', () => {
    expect(buildAnalysisProjectionSummary(null)).toBeNull();
  });

  it('passes through fields without computing new metrics (F.6 invariant)', () => {
    const summary = buildAnalysisProjectionSummary(ANALYSIS);
    expect(summary).not.toBeNull();
    expect(summary?.status).toBe('complete');
    expect(summary?.leading_option?.label).toBe('Hire Senior Engineer');
    expect(summary?.leading_option?.probability).toBe(0.62);
    expect(summary?.runner_up?.label).toBe('Hire Two Mid-Level');
    expect(summary?.margin_pp).toBe(35);
    expect(summary?.robustness_band).toBe('stable');
    expect(summary?.top_drivers).toHaveLength(2);
    // V5 state-trust: `staleness_reason` removed from the projection
    // entirely. The field MUST NOT be present.
    expect('staleness_reason' in (summary as object)).toBe(false);
  });
});

describe('buildStructureProjectionSummary', () => {
  it('returns goal label, top causal links sorted by |strength| desc, and counts', () => {
    const graph = makeGraph(
      [
        { id: 'g1', kind: 'goal', label: 'Q3 Throughput' },
        { id: 'f1', kind: 'factor', label: 'Engineering Capacity' },
        { id: 'f2', kind: 'factor', label: 'Hiring Cost' },
        { id: 'f3', kind: 'factor', label: 'Marketing Spend' },
        { id: 'opt1', kind: 'option', label: 'Hire Senior' },
      ],
      [
        { from: 'f1', to: 'g1', strength: 0.65 },
        { from: 'f2', to: 'g1', strength: -0.42 },
        { from: 'f3', to: 'g1', strength: 0.1 },
        { from: 'f1', to: 'f2', strength: 0.3 },
      ],
    );
    const summary = buildStructureProjectionSummary(graph);
    expect(summary.goal_label).toBe('Q3 Throughput');
    expect(summary.factor_count).toBe(3);
    expect(summary.option_count).toBe(1);
    expect(summary.top_causal_links).toHaveLength(3);
    // Sorted by |strength| desc — 0.65 > 0.42 > 0.3.
    expect(summary.top_causal_links[0].label_from).toBe('Engineering Capacity');
    expect(summary.top_causal_links[0].label_to).toBe('Q3 Throughput');
    expect(summary.top_causal_links[0].strength).toBe(0.65);
    expect(summary.top_causal_links[1].strength).toBe(-0.42);
    expect(summary.top_causal_links[2].strength).toBe(0.3);
  });

  it('extracts named-factor pathways when the user message mentions a factor by label', () => {
    const graph = makeGraph(
      [
        { id: 'g1', kind: 'goal', label: 'Throughput' },
        { id: 'f1', kind: 'factor', label: 'Engineering Capacity' },
        { id: 'f2', kind: 'factor', label: 'Hiring Cost' },
      ],
      [
        { from: 'f1', to: 'g1', strength: 0.65 },
        { from: 'f2', to: 'g1', strength: -0.42 },
        { from: 'f1', to: 'f2', strength: 0.2 },
      ],
    );
    const summary = buildStructureProjectionSummary(graph, {
      messageText: 'How does Engineering Capacity affect this decision?',
    });
    expect(summary.named_factor_label).toBe('Engineering Capacity');
    expect(summary.named_factor_pathways).toHaveLength(2);
    // Only the two edges touching Engineering Capacity, sorted by |strength|.
    expect(summary.named_factor_pathways[0].strength).toBe(0.65);
    expect(summary.named_factor_pathways[1].strength).toBe(0.2);
  });

  it('returns no named_factor_label when message does not mention a factor', () => {
    const graph = makeGraph(
      [{ id: 'g1', kind: 'goal', label: 'Throughput' }],
      [],
    );
    const summary = buildStructureProjectionSummary(graph, {
      messageText: 'Give me a summary of the model.',
    });
    expect(summary.named_factor_label).toBeUndefined();
    expect(summary.named_factor_pathways).toEqual([]);
  });

  it('skips edges whose endpoints have no resolvable label', () => {
    const graph = makeGraph(
      [
        { id: 'g1', kind: 'goal', label: 'Goal' },
        { id: 'f1', kind: 'factor', label: 'Real Factor' },
      ],
      [
        { from: 'f1', to: 'g1', strength: 0.5 },
        // ghost-node edge: 'unknown_id' is not in the node list
        { from: 'unknown_id', to: 'g1', strength: 0.9 },
      ],
    );
    const summary = buildStructureProjectionSummary(graph);
    expect(summary.top_causal_links).toHaveLength(1);
    expect(summary.top_causal_links[0].label_from).toBe('Real Factor');
  });

  it('handles empty graphs gracefully', () => {
    const graph = makeGraph([], []);
    const summary = buildStructureProjectionSummary(graph);
    expect(summary.goal_label).toBeNull();
    expect(summary.top_causal_links).toEqual([]);
    expect(summary.factor_count).toBe(0);
    expect(summary.option_count).toBe(0);
  });
});
