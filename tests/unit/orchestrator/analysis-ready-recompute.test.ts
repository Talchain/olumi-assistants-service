import { describe, it, expect } from 'vitest';
import { computeStructuralReadiness } from '../../../src/orchestrator/tools/analysis-ready-helper.js';
import { assembleEnvelope } from '../../../src/orchestrator/envelope.js';
import type { GraphV3T } from '../../../src/schemas/cee-v3.js';
import type { ConversationBlock, GraphPatchBlockData, ConversationContext } from '../../../src/orchestrator/types.js';

/**
 * Minimal graph factory that satisfies GraphV3T structure.
 * Uses `as unknown as GraphV3T` per codebase convention for test fixtures.
 */
function makeGraph(overrides?: Partial<GraphV3T>): GraphV3T {
  return {
    nodes: [
      { id: 'goal_1', kind: 'goal', label: 'Maximise Revenue' },
      { id: 'dec_1', kind: 'decision', label: 'Choose supplier' },
      { id: 'opt_a', kind: 'option', label: 'Option A', interventions: { price: 100 } },
      { id: 'opt_b', kind: 'option', label: 'Option B', interventions: { price: 200 } },
      { id: 'fac_1', kind: 'factor', label: 'Market share' },
    ],
    edges: [
      { from: 'dec_1', to: 'opt_a' },
      { from: 'dec_1', to: 'opt_b' },
      { from: 'opt_a', to: 'fac_1' },
      { from: 'opt_b', to: 'fac_1' },
      { from: 'fac_1', to: 'goal_1' },
    ],
    ...overrides,
  } as unknown as GraphV3T;
}

describe('analysis_ready recomputation (Task 8)', () => {
  it('graph with valid interventions on all options → status "ready"', () => {
    const graph = makeGraph();
    const result = computeStructuralReadiness(graph);

    expect(result).toBeDefined();
    expect(result!.status).toBe('ready');
    expect(result!.goal_node_id).toBe('goal_1');
    expect(result!.options).toHaveLength(2);
    expect(result!.options.every((o) => o.status === 'ready')).toBe(true);
  });

  it('graph after removing interventions → status reflects the change', () => {
    const graph = makeGraph({
      nodes: [
        { id: 'goal_1', kind: 'goal', label: 'Maximise Revenue' },
        { id: 'dec_1', kind: 'decision', label: 'Choose supplier' },
        // Option A still has interventions
        { id: 'opt_a', kind: 'option', label: 'Option A', interventions: { price: 100 } },
        // Option B has no interventions (simulating removal)
        { id: 'opt_b', kind: 'option', label: 'Option B' },
        { id: 'fac_1', kind: 'factor', label: 'Market share' },
      ],
      edges: [
        { from: 'dec_1', to: 'opt_a' },
        { from: 'dec_1', to: 'opt_b' },
        { from: 'opt_a', to: 'fac_1' },
        { from: 'opt_b', to: 'fac_1' },
        { from: 'fac_1', to: 'goal_1' },
      ],
    } as unknown as Partial<GraphV3T>);

    const result = computeStructuralReadiness(graph);

    expect(result).toBeDefined();
    // Not ready because opt_b has connected factors but no numeric interventions
    expect(result!.status).not.toBe('ready');
    expect(result!.options.find((o) => o.option_id === 'opt_a')!.status).toBe('ready');
  });

  it('graph with no goal node → returns undefined', () => {
    const graph = makeGraph({
      nodes: [
        { id: 'dec_1', kind: 'decision', label: 'Choose' },
        { id: 'opt_a', kind: 'option', label: 'A' },
        { id: 'opt_b', kind: 'option', label: 'B' },
      ],
    } as unknown as Partial<GraphV3T>);

    const result = computeStructuralReadiness(graph);
    expect(result).toBeUndefined();
  });

  it('graph with fewer than 2 options → status "needs_user_input"', () => {
    const graph = makeGraph({
      nodes: [
        { id: 'goal_1', kind: 'goal', label: 'Revenue' },
        { id: 'dec_1', kind: 'decision', label: 'Choose' },
        { id: 'opt_a', kind: 'option', label: 'Only Option', interventions: { price: 100 } },
      ],
      edges: [
        { from: 'dec_1', to: 'opt_a' },
        { from: 'opt_a', to: 'goal_1' },
      ],
    } as unknown as Partial<GraphV3T>);

    const result = computeStructuralReadiness(graph);
    expect(result).toBeDefined();
    expect(result!.status).toBe('needs_user_input');
  });
});

// ============================================================================
// Envelope-level recomputation regression tests
// ============================================================================

/** Minimal ConversationContext for envelope assembly. */
function makeContext(graphOverride?: GraphV3T | null): ConversationContext {
  return {
    messages: [],
    framing: null,
    graph: graphOverride ?? null,
    analysis_response: null,
    scenario_id: 'test',
  } as unknown as ConversationContext;
}

/** Build a graph_patch ConversationBlock with optional applied_graph and stale analysis_ready. */
function makeGraphPatchBlock(opts: {
  appliedGraph?: GraphV3T;
  staleAnalysisReady?: GraphPatchBlockData['analysis_ready'];
}): ConversationBlock {
  const data: GraphPatchBlockData = {
    patch_type: 'edit',
    operations: [],
    status: 'proposed',
  } as unknown as GraphPatchBlockData;

  if (opts.appliedGraph) {
    data.applied_graph = opts.appliedGraph;
  }
  if (opts.staleAnalysisReady) {
    data.analysis_ready = opts.staleAnalysisReady;
  }

  return {
    block_id: 'blk_test_1',
    block_type: 'graph_patch',
    data,
  } as ConversationBlock;
}

describe('Envelope-level analysis_ready recomputation', () => {
  it('stale block-level analysis_ready is overridden by envelope recompute', () => {
    // applied_graph has valid interventions on all options → should be "ready"
    const validGraph = makeGraph();
    const block = makeGraphPatchBlock({
      appliedGraph: validGraph,
      staleAnalysisReady: {
        status: 'needs_user_mapping',
        goal_node_id: 'goal_1',
        options: [
          { option_id: 'opt_a', label: 'Option A', status: 'needs_user_mapping', interventions: {} },
          { option_id: 'opt_b', label: 'Option B', status: 'needs_user_mapping', interventions: {} },
        ],
      },
    });

    const envelope = assembleEnvelope({
      turnId: 'test-stale-override',
      assistantText: 'Test',
      blocks: [block],
      context: makeContext(),
    });

    const patchData = envelope.blocks[0].data as GraphPatchBlockData;
    expect(patchData.analysis_ready).toBeDefined();
    expect(patchData.analysis_ready!.status).toBe('ready');
  });

  it('fallback to context.graph when no applied_graph on block', () => {
    // No applied_graph on the block, but context.graph is valid → should still compute
    const contextGraph = makeGraph();
    const block = makeGraphPatchBlock({});

    const envelope = assembleEnvelope({
      turnId: 'test-context-fallback',
      assistantText: 'Test',
      blocks: [block],
      context: makeContext(contextGraph),
    });

    const patchData = envelope.blocks[0].data as GraphPatchBlockData;
    expect(patchData.analysis_ready).toBeDefined();
    expect(patchData.analysis_ready!.status).toBe('ready');
    expect(patchData.analysis_ready!.goal_node_id).toBe('goal_1');
  });

  it('no applied_graph and no context.graph → analysis_ready unchanged (null safe)', () => {
    const block = makeGraphPatchBlock({});
    // Confirm analysis_ready is not set before assembly
    expect((block.data as GraphPatchBlockData).analysis_ready).toBeUndefined();

    const envelope = assembleEnvelope({
      turnId: 'test-null-safe',
      assistantText: 'Test',
      blocks: [block],
      context: makeContext(null),
    });

    const patchData = envelope.blocks[0].data as GraphPatchBlockData;
    // Should remain undefined — no graph available to compute from
    expect(patchData.analysis_ready).toBeUndefined();
  });
});
