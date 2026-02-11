/**
 * Tests for pipeline-checkpoints.ts
 *
 * Covers:
 * - captureCheckpoint: field presence counts, stratified sampling, node_field_presence, weight count
 * - assembleCeeProvenance: pipeline_path, prompt_source derivation, all fields
 * - applyCheckpointSizeGuard: size guard behaviour
 * - sampleEdgesStratified: deterministic sort, edge category sampling, fallback
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  captureCheckpoint,
  assembleCeeProvenance,
  applyCheckpointSizeGuard,
  type PipelineCheckpoint,
  type CEEProvenance,
  type CheckpointStage,
} from '../../src/cee/pipeline-checkpoints.js';

// ============================================================================
// Fixtures
// ============================================================================

/** Minimal graph with all edge field types */
function makeGraph(opts?: {
  nodeCount?: number;
  optionNodes?: number;
  optionsWithInterventions?: number;
  edges?: Array<{
    from: string;
    to: string;
    strength_mean?: number;
    strength_std?: number;
    belief_exists?: number;
    effect_direction?: string;
    weight?: number;
    strength?: { mean: number; std: number };
  }>;
}) {
  const nodeCount = opts?.nodeCount ?? 5;
  const optionNodes = opts?.optionNodes ?? 2;
  const optionsWithInterventions = opts?.optionsWithInterventions ?? 1;

  const nodes: any[] = [];

  // Add goal
  nodes.push({ id: 'goal_1', kind: 'goal', label: 'Main Goal' });

  // Add decision
  nodes.push({ id: 'dec_1', kind: 'decision', label: 'Decision' });

  // Add option nodes
  for (let i = 0; i < optionNodes; i++) {
    const hasInterventions = i < optionsWithInterventions;
    nodes.push({
      id: `opt_${i + 1}`,
      kind: 'option',
      label: `Option ${i + 1}`,
      data: hasInterventions
        ? { interventions: { lever_1: { value: 0.8 } } }
        : {},
    });
  }

  // Fill remaining with factor nodes
  const remaining = nodeCount - nodes.length;
  for (let i = 0; i < remaining; i++) {
    nodes.push({ id: `fac_${i + 1}`, kind: 'factor', label: `Factor ${i + 1}` });
  }

  const edges = opts?.edges ?? [
    // Structural: dec → opt
    { from: 'dec_1', to: 'opt_1', strength_mean: undefined, weight: 1.0, effect_direction: 'positive' },
    { from: 'dec_1', to: 'opt_2', strength_mean: undefined, weight: 1.0, effect_direction: 'positive' },
    // Causal: fac → out (with strength)
    { from: 'fac_1', to: 'goal_1', strength_mean: 0.7, strength_std: 0.15, belief_exists: 0.9, effect_direction: 'positive', weight: 0.7 },
    // Bridge: out → goal
    { from: 'out_1', to: 'goal_1', strength_mean: 0.8, strength_std: 0.1, belief_exists: 0.95, effect_direction: 'positive' },
  ];

  return { nodes, edges };
}

// ============================================================================
// captureCheckpoint
// ============================================================================

describe('captureCheckpoint', () => {
  it('counts nodes and edges correctly', () => {
    const graph = makeGraph({ nodeCount: 7 });
    const cp = captureCheckpoint('post_repair', graph);

    expect(cp.stage).toBe('post_repair');
    expect(cp.node_count).toBe(7);
    expect(cp.edge_count).toBe(4);
  });

  it('counts edge field presence correctly', () => {
    const graph = makeGraph();
    const cp = captureCheckpoint('post_normalisation', graph);

    // 2 edges have strength_mean (fac→goal and out→goal)
    expect(cp.edge_field_presence.strength_mean).toBe(2);
    // 2 edges have strength_std
    expect(cp.edge_field_presence.strength_std).toBe(2);
    // 2 edges have belief_exists
    expect(cp.edge_field_presence.belief_exists).toBe(2);
    // All 4 edges have effect_direction
    expect(cp.edge_field_presence.effect_direction).toBe(4);
    // 3 edges have weight (Task 4: verify weight is counted)
    expect(cp.edge_field_presence.weight).toBe(3);
  });

  it('counts node_field_presence correctly (Task 3)', () => {
    const graph = makeGraph({ optionNodes: 3, optionsWithInterventions: 2 });
    const cp = captureCheckpoint('post_repair', graph);

    expect(cp.node_field_presence.option_nodes_total).toBe(3);
    expect(cp.node_field_presence.options_with_interventions).toBe(2);
  });

  it('handles empty interventions object as not having interventions', () => {
    const graph = {
      nodes: [
        { id: 'opt_1', kind: 'option', data: { interventions: {} } },
        { id: 'opt_2', kind: 'option', data: { interventions: { x: 1 } } },
      ],
      edges: [],
    };
    const cp = captureCheckpoint('post_repair', graph);

    expect(cp.node_field_presence.option_nodes_total).toBe(2);
    expect(cp.node_field_presence.options_with_interventions).toBe(1);
  });

  it('uses renamed stage post_adapter_normalisation (Task 2)', () => {
    const graph = makeGraph();
    const cp = captureCheckpoint('post_adapter_normalisation', graph);
    expect(cp.stage).toBe('post_adapter_normalisation');
  });

  it('detects nested strength object when includeNestedStrengthDetection is true', () => {
    const graph = {
      nodes: [{ id: 'goal_1', kind: 'goal' }],
      edges: [
        { from: 'fac_1', to: 'goal_1', strength: { mean: 0.7, std: 0.1 } },
      ],
    };

    const cp = captureCheckpoint('post_adapter_normalisation', graph, {
      includeNestedStrengthDetection: true,
    });

    expect(cp.nested_strength_detected).toBe(true);
  });

  it('does not include nested_strength_detected when option is not set', () => {
    const graph = {
      nodes: [{ id: 'goal_1', kind: 'goal' }],
      edges: [
        { from: 'fac_1', to: 'goal_1', strength: { mean: 0.7, std: 0.1 } },
      ],
    };

    const cp = captureCheckpoint('post_repair', graph);
    expect(cp.nested_strength_detected).toBeUndefined();
  });

  it('returns false for nested_strength_detected when no nested strength exists', () => {
    const graph = {
      nodes: [{ id: 'goal_1', kind: 'goal' }],
      edges: [
        { from: 'fac_1', to: 'goal_1', strength_mean: 0.7 },
      ],
    };

    const cp = captureCheckpoint('post_adapter_normalisation', graph, {
      includeNestedStrengthDetection: true,
    });

    expect(cp.nested_strength_detected).toBe(false);
  });

  it('handles null/undefined graph gracefully', () => {
    const cp = captureCheckpoint('post_repair', null);

    expect(cp.node_count).toBe(0);
    expect(cp.edge_count).toBe(0);
    expect(cp.edge_field_presence.strength_mean).toBe(0);
    expect(cp.sample_edges).toEqual([]);
  });

  it('handles graph with no nodes/edges', () => {
    const cp = captureCheckpoint('post_repair', {});

    expect(cp.node_count).toBe(0);
    expect(cp.edge_count).toBe(0);
  });
});

// ============================================================================
// Stratified edge sampling (Task 6)
// ============================================================================

describe('captureCheckpoint stratified sampling', () => {
  it('picks one structural, one causal, one bridge edge', () => {
    const graph = {
      nodes: [],
      edges: [
        { from: 'dec_1', to: 'opt_1', weight: 1.0 },
        { from: 'dec_1', to: 'opt_2', weight: 1.0 },
        { from: 'fac_1', to: 'goal_1', strength_mean: 0.7 },
        { from: 'fac_2', to: 'goal_1', strength_mean: 0.8 },
        { from: 'out_1', to: 'goal_1', strength_mean: 0.9 },
        { from: 'risk_1', to: 'goal_1', strength_mean: 0.3 },
      ],
    };

    const cp = captureCheckpoint('post_repair', graph);

    expect(cp.sample_edges.length).toBe(3);
    // One structural (dec_ prefix)
    expect(cp.sample_edges.some(e => e.from.startsWith('dec_'))).toBe(true);
    // One causal (fac_ prefix)
    expect(cp.sample_edges.some(e => e.from.startsWith('fac_'))).toBe(true);
    // One bridge (out_ or risk_ prefix)
    expect(cp.sample_edges.some(e => e.from.startsWith('out_') || e.from.startsWith('risk_'))).toBe(true);
  });

  it('falls back to sorted edges when no prefixed IDs exist', () => {
    const graph = {
      nodes: [],
      edges: [
        { from: 'a', to: 'b', strength_mean: 0.5 },
        { from: 'c', to: 'd', strength_mean: 0.6 },
        { from: 'e', to: 'f', strength_mean: 0.7 },
        { from: 'g', to: 'h', strength_mean: 0.8 },
      ],
    };

    const cp = captureCheckpoint('post_repair', graph);

    expect(cp.sample_edges.length).toBe(3);
    // Should be deterministically sorted by from::to
    expect(cp.sample_edges[0].from).toBe('a');
    expect(cp.sample_edges[1].from).toBe('c');
    expect(cp.sample_edges[2].from).toBe('e');
  });

  it('uses MISSING sentinel for undefined edge fields', () => {
    const graph = {
      nodes: [],
      edges: [
        { from: 'fac_1', to: 'goal_1' }, // no strength_mean, etc.
      ],
    };

    const cp = captureCheckpoint('post_repair', graph);

    expect(cp.sample_edges.length).toBe(1);
    expect(cp.sample_edges[0].strength_mean).toBe('MISSING');
    expect(cp.sample_edges[0].strength_std).toBe('MISSING');
    expect(cp.sample_edges[0].belief_exists).toBe('MISSING');
    expect(cp.sample_edges[0].effect_direction).toBe('MISSING');
  });

  it('includes actual values when fields are present', () => {
    const graph = {
      nodes: [],
      edges: [
        { from: 'fac_1', to: 'goal_1', strength_mean: 0.7, strength_std: 0.1, belief_exists: 0.9, effect_direction: 'positive' },
      ],
    };

    const cp = captureCheckpoint('post_repair', graph);

    expect(cp.sample_edges[0].strength_mean).toBe(0.7);
    expect(cp.sample_edges[0].strength_std).toBe(0.1);
    expect(cp.sample_edges[0].belief_exists).toBe(0.9);
    expect(cp.sample_edges[0].effect_direction).toBe('positive');
  });

  it('handles null edges in the array gracefully', () => {
    const graph = {
      nodes: [],
      edges: [null, undefined, { from: 'fac_1', to: 'goal_1', strength_mean: 0.5 }],
    };

    const cp = captureCheckpoint('post_repair', graph);

    expect(cp.edge_count).toBe(1); // Only 1 valid edge (null/undefined excluded)
    expect(cp.sample_edges.length).toBe(1);
    expect(cp.sample_edges[0].from).toBe('fac_1');
  });

  it('sorts edges deterministically by from::to', () => {
    const graph = {
      nodes: [],
      edges: [
        { from: 'z_node', to: 'a_node' },
        { from: 'a_node', to: 'z_node' },
        { from: 'm_node', to: 'm_node' },
      ],
    };

    const cp = captureCheckpoint('post_repair', graph);

    expect(cp.sample_edges[0].from).toBe('a_node');
    expect(cp.sample_edges[1].from).toBe('m_node');
    expect(cp.sample_edges[2].from).toBe('z_node');
  });
});

// ============================================================================
// assembleCeeProvenance
// ============================================================================

describe('assembleCeeProvenance', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns all required fields', () => {
    const provenance = assembleCeeProvenance({
      pipelinePath: 'A',
      model: 'gpt-4o',
      promptVersion: 'v1.2.3',
      promptSource: 'store',
      promptStoreVersion: 42,
    });

    expect(provenance.commit).toBeDefined();
    expect(provenance.version).toBeDefined();
    expect(provenance.build_timestamp).toBeDefined();
    expect(provenance.prompt_version).toBe('v1.2.3');
    expect(provenance.model).toBe('gpt-4o');
    expect(provenance.pipeline_path).toBe('A');
    expect(typeof provenance.engine_base_url_configured).toBe('boolean');
    expect(typeof provenance.model_override_active).toBe('boolean');
    expect(typeof provenance.prompt_override_active).toBe('boolean');
    expect(provenance.prompt_store_version).toBe(42);
  });

  it('sets pipeline_path correctly for Pipeline A (Task 1)', () => {
    const prov = assembleCeeProvenance({ pipelinePath: 'A', model: 'gpt-4o' });
    expect(prov.pipeline_path).toBe('A');
  });

  it('sets pipeline_path correctly for Pipeline B (Task 1)', () => {
    const prov = assembleCeeProvenance({ pipelinePath: 'B', model: 'claude-3' });
    expect(prov.pipeline_path).toBe('B');
  });

  it('derives prompt_source as supabase when source is store', () => {
    delete process.env.CEE_DRAFT_PROMPT_VERSION;
    const prov = assembleCeeProvenance({
      pipelinePath: 'A',
      model: 'gpt-4o',
      promptSource: 'store',
    });
    expect(prov.prompt_source).toBe('supabase');
  });

  it('derives prompt_source as defaults when source is default', () => {
    delete process.env.CEE_DRAFT_PROMPT_VERSION;
    const prov = assembleCeeProvenance({
      pipelinePath: 'A',
      model: 'gpt-4o',
      promptSource: 'default',
    });
    expect(prov.prompt_source).toBe('defaults');
  });

  it('derives prompt_source as env_override when CEE_DRAFT_PROMPT_VERSION is set', () => {
    process.env.CEE_DRAFT_PROMPT_VERSION = 'v2.0';
    const prov = assembleCeeProvenance({
      pipelinePath: 'A',
      model: 'gpt-4o',
      promptSource: 'store',
    });
    expect(prov.prompt_source).toBe('env_override');
    expect(prov.prompt_override_active).toBe(true);
  });

  it('sets engine_base_url_configured based on ENGINE_BASE_URL env', () => {
    delete process.env.ENGINE_BASE_URL;
    const prov1 = assembleCeeProvenance({ pipelinePath: 'A', model: 'gpt-4o' });
    expect(prov1.engine_base_url_configured).toBe(false);

    process.env.ENGINE_BASE_URL = 'https://engine.example.com';
    const prov2 = assembleCeeProvenance({ pipelinePath: 'A', model: 'gpt-4o' });
    expect(prov2.engine_base_url_configured).toBe(true);
  });

  it('defaults prompt_version to unknown when not provided', () => {
    const prov = assembleCeeProvenance({ pipelinePath: 'A', model: 'gpt-4o' });
    expect(prov.prompt_version).toBe('unknown');
  });

  it('defaults prompt_store_version to null when not provided', () => {
    const prov = assembleCeeProvenance({ pipelinePath: 'A', model: 'gpt-4o' });
    expect(prov.prompt_store_version).toBeNull();
  });

  it('respects modelOverrideActive parameter', () => {
    const prov = assembleCeeProvenance({
      pipelinePath: 'A',
      model: 'gpt-4o',
      modelOverrideActive: true,
    });
    expect(prov.model_override_active).toBe(true);
  });
});

// ============================================================================
// applyCheckpointSizeGuard
// ============================================================================

describe('applyCheckpointSizeGuard', () => {
  it('returns checkpoints as-is when under 3KB', () => {
    const cps: PipelineCheckpoint[] = [
      captureCheckpoint('post_repair', {
        nodes: [{ id: 'goal_1', kind: 'goal' }],
        edges: [{ from: 'a', to: 'b' }],
      }),
    ];

    const guarded = applyCheckpointSizeGuard(cps);
    expect(guarded).toBe(cps); // Same reference
    expect(guarded[0].sample_edges.length).toBeGreaterThan(0);
  });

  it('drops sample_edges when checkpoints exceed 3KB', () => {
    // Create enough checkpoints with big edge samples to exceed 3KB
    const bigGraph = {
      nodes: [],
      edges: Array.from({ length: 100 }, (_, i) => ({
        from: `node_${i}_very_long_name_to_inflate_size`,
        to: `node_${i + 100}_another_very_long_name`,
        strength_mean: 0.5,
        strength_std: 0.1,
        belief_exists: 0.9,
        effect_direction: 'positive',
      })),
    };

    const stages: CheckpointStage[] = [
      'post_adapter_normalisation',
      'post_normalisation',
      'post_repair',
      'post_stabilisation',
      'pre_boundary',
    ];

    const cps = stages.map(stage => captureCheckpoint(stage, bigGraph));
    // Force size to be large by repeating
    const oversized = [...cps, ...cps, ...cps];

    const guarded = applyCheckpointSizeGuard(oversized);

    // Should have dropped sample_edges
    for (const cp of guarded) {
      expect(cp.sample_edges).toEqual([]);
    }
    // But kept other fields
    for (const cp of guarded) {
      expect(cp.stage).toBeDefined();
      expect(cp.node_count).toBeDefined();
      expect(cp.edge_count).toBeDefined();
      expect(cp.edge_field_presence).toBeDefined();
    }
  });

  it('handles empty array', () => {
    const guarded = applyCheckpointSizeGuard([]);
    expect(guarded).toEqual([]);
  });
});
