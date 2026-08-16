import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import ts from 'typescript';

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

  it('refuses malformed carrier values', () => {
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

  it('requires explicit goal identity whenever one or more goal nodes exist', () => {
    expect(
      buildCanonicalCommittedGraphReceipt(fullGraph).draftGraph.goal_node_id,
    ).toBe('goal_value');

    expect(() =>
      buildCanonicalCommittedGraphReceipt({ ...fullGraph, goal_node_id: null }),
    ).toThrowError('goal_identity_invalid');

    const withMultipleGoals = {
      ...fullGraph,
      nodes: [
        ...fullGraph.nodes,
        { id: 'goal_resilience', kind: 'goal', label: 'Resilience' },
      ],
    };
    expect(
      buildCanonicalCommittedGraphReceipt(withMultipleGoals).draftGraph.goal_node_id,
    ).toBe('goal_value');
    expect(() =>
      buildCanonicalCommittedGraphReceipt({
        ...withMultipleGoals,
        goal_node_id: null,
      }),
    ).toThrowError('goal_identity_invalid');
  });

  it('accepts explicit null only when the graph has no goal node', () => {
    const noGoal = {
      nodes: fullGraph.nodes.filter((node) => node.kind !== 'goal'),
      edges: [],
      options: fullGraph.options,
      goal_node_id: null,
      goal_constraints: [],
    };
    expect(
      buildCanonicalCommittedGraphReceipt(noGoal).draftGraph.goal_node_id,
    ).toBeNull();
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

  it('makes commit.ts the sole pre-append receipt/readiness authority', () => {
    const source = readFileSync(
      join(repoRoot, 'src/orchestrator-v5/commit.ts'),
      'utf8',
    );
    const receiptBuild = source.indexOf(
      'const canonicalGraphReceipt = buildCanonicalCommittedGraphReceipt(graphForStore);',
    );
    const readinessBuild = source.indexOf(
      'const canonicalAnalysisReady = buildCanonicalAnalysisReadyFromGraph(graphForStore);',
    );
    const responseDerivation = source.indexOf(
      'if (metadata.deriveResponseFromPersistedGraph !== undefined)',
    );
    const append = source.indexOf('const appendResult = await store.append({');

    expect(source.match(/buildCanonicalCommittedGraphReceipt\(/g)).toHaveLength(1);
    expect(source.match(/buildCanonicalAnalysisReadyFromGraph\(/g)).toHaveLength(1);
    expect(receiptBuild).toBeGreaterThan(source.indexOf('const effectiveGraphHash'));
    expect(readinessBuild).toBeGreaterThan(receiptBuild);
    expect(responseDerivation).toBeGreaterThan(readinessBuild);
    expect(append).toBeGreaterThan(responseDerivation);
    expect(source).toContain(
      'canonicalGraphReceipt.analysisGraphHash !== persistedAnalysisGraphHash',
    );
    expect(source).toContain(
      'graphSnapshotAfterReceiptValidation !== graphSnapshotBeforeReceiptValidation',
    );
  });

  it('pins every production graph writer to an explicit exact intent', () => {
    const writers: Array<{
      readonly file: string;
      readonly line: number;
      readonly intent: string | null;
    }> = [];

    for (const relative of productionFiles) {
      const source = readFileSync(join(repoRoot, relative), 'utf8');
      const file = ts.createSourceFile(
        relative,
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
      );
      const visit = (node: ts.Node): void => {
        if (
          ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          (node.expression.text === 'commitTurn' ||
            node.expression.text === 'commitDirectAnswer')
        ) {
          const metadata = node.arguments[1];
          if (metadata !== undefined && ts.isObjectLiteralExpression(metadata)) {
            const graph = metadata.properties.find(
              (property) => property.name?.getText(file) === 'graph',
            );
            if (graph !== undefined) {
              const intent = metadata.properties.find(
                (property) => property.name?.getText(file) === 'graphReceiptIntent',
              );
              writers.push({
                file: relative,
                line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
                intent:
                  intent !== undefined && ts.isPropertyAssignment(intent)
                    ? intent.initializer.getText(file)
                    : null,
              });
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(file);
    }

    expect(writers).toHaveLength(8);
    expect(writers.every((writer) => writer.intent !== null)).toBe(true);
    expect(
      writers.filter((writer) => writer.intent?.includes("'canonical_mutation'")),
    ).toHaveLength(8);
    const adoptionWriters = writers.filter((writer) =>
      writer.intent?.includes("'receipt_free_adoption'"),
    );
    expect(adoptionWriters).toHaveLength(1);
    expect(adoptionWriters[0]?.file).toBe('src/orchestrator-v5/turn-executor.ts');
  });

  it('has no caller-side postcommit receipt/readiness builder seam', () => {
    for (const relative of productionFiles) {
      const source = readFileSync(join(repoRoot, relative), 'utf8');
      expect(source).not.toContain('buildCanonicalCommittedGraphReceipt(');
      expect(source).not.toMatch(
        /buildCanonicalAnalysisReadyFromGraph\(\s*(?:committed\.persistedGraph|persistedGraphBytes)/,
      );
    }

    const turnExecutor = readFileSync(
      join(repoRoot, 'src/orchestrator-v5/turn-executor.ts'),
      'utf8',
    );
    expect(turnExecutor.match(/deriveResponseFromPersistedGraph:/g)).toHaveLength(4);
    expect(
      turnExecutor.match(/_persistedGraph,\s*canonicalReadiness,/g),
    ).toHaveLength(2);
    expect(turnExecutor).toContain(
      'analysisReadyForTurn = committedAnalysisReady ?? undefined;',
    );
  });

  it('pins draft hold/hash/append to one precommit fixed point and accepted hash to the receipt', () => {
    const source = readFileSync(
      join(repoRoot, 'src/orchestrator-v5/handlers/draft-graph-dispatch.ts'),
      'utf8',
    );

    expect(
      source.match(/const draftGraphForCommit\s*=\s*[\s\S]*?projectGraphForPersistence\(/g),
    ).toHaveLength(1);
    expect(source).toContain('graphAfterCommit: draftGraphForCommit');
    expect(source).toContain('graph: draftGraphForCommit ?? undefined');
    expect(source).toContain("? 'canonical_mutation' : undefined");
    expect(source).toContain('commitResult.canonicalGraphReceipt');
    expect(source).toContain('commitResult.canonicalAnalysisReady');
    expect(source).toContain(
      'const currentGraphHash = committedReceipt?.analysisGraphHash ?? null',
    );
    expect(source).toContain('graph: committedDraftGraph');
    expect(source).not.toMatch(
      /computeAnalysisAffectingGraphHash\(\s*draftResult\.graphOutput/,
    );
  });
});
