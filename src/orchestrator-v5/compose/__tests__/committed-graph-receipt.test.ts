import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import {
  buildCanonicalCommittedGraphReceipt,
  CommittedGraphReceiptError,
} from '../committed-graph-receipt.js';

const fullGraph = {
  nodes: [
    {
      id: 'goal_value',
      kind: 'goal',
      label: 'Value',
      goal_threshold: 0.7,
      goal_threshold_raw: 700_000,
      goal_threshold_cap: 1_000_000,
    },
    {
      id: 'fac_cost',
      kind: 'factor',
      label: 'Cost',
      factor_type: 'continuous',
      intercept: 0.12,
      encoding_map: { low: 0, high: 1 },
      observed_state: { value: 0.4, baseline: 0.3, cap: 1 },
    },
  ],
  edges: [
    {
      from: 'fac_cost',
      to: 'goal_value',
      edge_type: 'directed',
      strength: { mean: -0.5, std: 0.1 },
      effect_direction: 'negative',
      exists_probability: 0.9,
    },
  ],
  options: [
    {
      id: 'opt_a',
      label: 'A',
      status: 'needs_encoding',
      is_baseline: false,
      interventions: {
        fac_cost: {
          value: 0.6,
          value_type: 'continuous',
          encoding_map: { low: 0, high: 1 },
          target_match: {
            node_id: 'fac_cost',
            match_type: 'exact',
            confidence: 1,
          },
        },
      },
      raw_interventions: { fac_cost: 'high' },
    },
  ],
  goal_node_id: 'goal_value',
  goal_constraints: [
    {
      constraint_id: 'c_budget',
      node_id: 'fac_cost',
      operator: '<=',
      value: 0.8,
      value_frame: 'level',
    },
  ],
};

describe('buildCanonicalCommittedGraphReceipt', () => {
  it('preserves all five hash carriers from append.graph and derives counts only', () => {
    const built = buildCanonicalCommittedGraphReceipt(fullGraph);
    for (const key of [
      'nodes',
      'edges',
      'options',
      'goal_node_id',
      'goal_constraints',
    ] as const) {
      expect(built.draftGraph[key], key).toEqual(fullGraph[key]);
    }
    expect(built.draftGraph.node_count).toBe(fullGraph.nodes.length);
    expect(built.draftGraph.edge_count).toBe(fullGraph.edges.length);
    expect(built.analysisGraphHash).toBe(
      computeAnalysisAffectingGraphHash(fullGraph),
    );
    expect(
      computeAnalysisAffectingGraphHash(
        built.draftGraph as Parameters<typeof computeAnalysisAffectingGraphHash>[0],
      ),
    ).toBe(built.analysisGraphHash);
  });

  it('refuses every legacy omission instead of synthesising a canonical attestation', () => {
    for (const key of [
      'nodes',
      'edges',
      'options',
      'goal_node_id',
      'goal_constraints',
    ] as const) {
      const partial = { ...fullGraph };
      delete partial[key];
      expect(() => buildCanonicalCommittedGraphReceipt(partial), key).toThrowError(
        'missing_hash_carrier',
      );
    }
  });

  it('accepts an explicit null goal but refuses malformed/present carrier values', () => {
    expect(
      buildCanonicalCommittedGraphReceipt({ ...fullGraph, goal_node_id: null })
        .draftGraph.goal_node_id,
    ).toBeNull();

    for (const graph of [
      null,
      { ...fullGraph, options: 'not-an-array' },
      { ...fullGraph, goal_node_id: '' },
      { ...fullGraph, goal_node_id: 'missing_goal' },
      { ...fullGraph, goal_constraints: [{ constraint_id: 'missing-shape' }] },
      {
        ...fullGraph,
        edges: [{ ...fullGraph.edges[0], exists_probability: 1.4 }],
      },
    ]) {
      expect(() => buildCanonicalCommittedGraphReceipt(graph)).toThrow(
        CommittedGraphReceiptError,
      );
    }
  });

  it('accepts explicit canonical empty state and hashes those exact bytes', () => {
    const empty = {
      nodes: [],
      edges: [],
      options: [],
      goal_node_id: null,
      goal_constraints: [],
    };
    const built = buildCanonicalCommittedGraphReceipt(empty);
    expect(built.draftGraph).toEqual({ ...empty, node_count: 0, edge_count: 0 });
    expect(built.analysisGraphHash).toBe(computeAnalysisAffectingGraphHash(empty));
  });

  it('keeps validation errors content-free', () => {
    const secret = 'Private acquisition target';
    try {
      buildCanonicalCommittedGraphReceipt({
        ...fullGraph,
        nodes: [{ ...fullGraph.nodes[0], label: secret }],
        goal_node_id: 'missing_goal',
      });
      throw new Error('expected receipt failure');
    } catch (err) {
      expect(String(err)).not.toContain(secret);
      expect(String(err)).not.toContain('missing_goal');
    }
  });
});

describe('canonical receipt architecture drift guards', () => {
  const composeDir = fileURLToPath(new URL('..', import.meta.url));
  const repoRoot = join(composeDir, '../../..');
  const productionFiles = [
    'src/orchestrator-v5/turn-executor.ts',
    'src/orchestrator-v5/system-events/dispatch.ts',
    'src/orchestrator-v5/handlers/edit-graph-dispatch.ts',
    'src/orchestrator-v5/handlers/draft-graph-dispatch.ts',
  ];

  it('has no legacy lossy helper and never feeds the canonical helper appliedGraph/committedParse', () => {
    for (const relative of productionFiles) {
      const source = readFileSync(join(repoRoot, relative), 'utf8');
      expect(source).not.toContain('buildAppliedGraphWireField');
      expect(source).not.toMatch(
        /buildCanonicalCommittedGraphReceipt\s*\(\s*[^)]*(?:\.appliedGraph|committedParse\.data)/s,
      );
    }
  });

  it('keeps whole-status readiness and sidecar attestation out of the receipt builder', () => {
    const source = readFileSync(
      join(repoRoot, 'src/orchestrator-v5/compose/committed-graph-receipt.ts'),
      'utf8',
    );
    expect(source).not.toContain('computeStructuralReadiness(');
    expect(source).not.toContain('canonical_graph_hash_analysis_state');
    expect(source).not.toMatch(/analysis_ready\s*:/);
  });
});
