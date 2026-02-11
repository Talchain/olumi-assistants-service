/**
 * Pipeline Checkpoints + Provenance
 *
 * Lightweight snapshots at canonical pipeline stages for debugging
 * edge field presence (strength_mean, interventions, etc.) without
 * requiring full debug bundles or staging access.
 *
 * Gated by CEE_PIPELINE_CHECKPOINTS_ENABLED (default false).
 * Provenance is always on (no feature flag).
 */

import { SERVICE_VERSION, GIT_COMMIT_SHORT, BUILD_TIMESTAMP } from '../version.js';

// =============================================================================
// Types
// =============================================================================

export type CheckpointStage =
  | 'post_adapter_normalisation'  // After adapter normaliseDraftResponse()
  | 'post_normalisation'          // After pipeline normaliseCeeGraphVersionAndProvenance()
  | 'post_repair'                 // After validateAndFixGraph()
  | 'post_stabilisation'          // Final graph state before response assembly
  | 'pre_boundary';               // After verification, before return

export interface PipelineCheckpoint {
  stage: CheckpointStage;
  node_count: number;
  edge_count: number;
  edge_field_presence: {
    strength_mean: number;
    strength_std: number;
    belief_exists: number;
    effect_direction: number;
    weight: number;
  };
  node_field_presence: {
    option_nodes_total: number;
    options_with_interventions: number;
  };
  sample_edges: Array<{
    from: string;
    to: string;
    strength_mean: number | 'MISSING';
    strength_std: number | 'MISSING';
    belief_exists: number | 'MISSING';
    effect_direction: string | 'MISSING';
  }>;
  /** Only present on post_adapter_normalisation stage */
  nested_strength_detected?: boolean;
}

export interface CEEProvenance {
  commit: string;
  version: string;
  build_timestamp: string;
  prompt_version: string;
  prompt_source: 'supabase' | 'defaults' | 'env_override';
  prompt_override_active: boolean;
  model: string;
  pipeline_path: 'A' | 'B';
  engine_base_url_configured: boolean;
  model_override_active: boolean;
  prompt_store_version: number | null;
}

// =============================================================================
// Checkpoint capture
// =============================================================================

/**
 * Capture a pipeline checkpoint snapshot.
 *
 * Uses stratified edge sampling (1 structural + 1 causal + 1 bridge)
 * to avoid the sampling bias where .slice(0,3) always picks structural
 * dec→opt edges without strength values.
 */
export function captureCheckpoint(
  stage: CheckpointStage,
  graph: unknown,
  options?: { includeNestedStrengthDetection?: boolean },
): PipelineCheckpoint {
  const g = graph as { nodes?: unknown[]; edges?: unknown[] } | null | undefined;
  const nodes = Array.isArray(g?.nodes) ? g!.nodes : [];
  const edges = Array.isArray(g?.edges) ? g!.edges : [];

  // Edge field presence counts (only valid edges)
  let validEdgeCount = 0;
  let strengthMeanCount = 0;
  let strengthStdCount = 0;
  let beliefExistsCount = 0;
  let effectDirectionCount = 0;
  let weightCount = 0;
  let nestedStrengthDetected = false;

  for (const edge of edges) {
    if (!edge || typeof edge !== 'object') continue;
    validEdgeCount++;
    const e = edge as Record<string, unknown>;
    if (e.strength_mean !== undefined) strengthMeanCount++;
    if (e.strength_std !== undefined) strengthStdCount++;
    if (e.belief_exists !== undefined) beliefExistsCount++;
    if (e.effect_direction !== undefined) effectDirectionCount++;
    if (e.weight !== undefined) weightCount++;
    if (options?.includeNestedStrengthDetection && typeof e.strength === 'object' && e.strength !== null) {
      nestedStrengthDetected = true;
    }
  }

  // Node field presence counts
  let optionNodesTotal = 0;
  let optionsWithInterventions = 0;

  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue;
    const n = node as Record<string, unknown>;
    if (n.kind === 'option') {
      optionNodesTotal++;
      const data = n.data as Record<string, unknown> | undefined;
      if (data?.interventions && typeof data.interventions === 'object' && data.interventions !== null) {
        if (Object.keys(data.interventions as object).length > 0) {
          optionsWithInterventions++;
        }
      }
    }
  }

  // Stratified edge sampling
  const sampleEdges = sampleEdgesStratified(edges);

  const checkpoint: PipelineCheckpoint = {
    stage,
    node_count: nodes.length,
    edge_count: validEdgeCount,
    edge_field_presence: {
      strength_mean: strengthMeanCount,
      strength_std: strengthStdCount,
      belief_exists: beliefExistsCount,
      effect_direction: effectDirectionCount,
      weight: weightCount,
    },
    node_field_presence: {
      option_nodes_total: optionNodesTotal,
      options_with_interventions: optionsWithInterventions,
    },
    sample_edges: sampleEdges,
  };

  if (options?.includeNestedStrengthDetection) {
    checkpoint.nested_strength_detected = nestedStrengthDetected;
  }

  return checkpoint;
}

// =============================================================================
// Stratified edge sampling
// =============================================================================

function sampleEdgesStratified(
  edges: unknown[],
): PipelineCheckpoint['sample_edges'] {
  if (edges.length === 0) return [];

  const validEdges = edges.filter(
    (e): e is Record<string, unknown> => e !== null && typeof e === 'object',
  );
  if (validEdges.length === 0) return [];

  const sorted = [...validEdges].sort((a, b) =>
    `${a.from ?? ''}::${a.to ?? ''}`.localeCompare(`${b.from ?? ''}::${b.to ?? ''}`),
  );

  const mapEdge = (e: Record<string, unknown>) => ({
    from: String(e.from ?? ''),
    to: String(e.to ?? ''),
    strength_mean: e.strength_mean !== undefined ? (e.strength_mean as number) : 'MISSING' as const,
    strength_std: e.strength_std !== undefined ? (e.strength_std as number) : 'MISSING' as const,
    belief_exists: e.belief_exists !== undefined ? (e.belief_exists as number) : 'MISSING' as const,
    effect_direction: e.effect_direction !== undefined ? String(e.effect_direction) : 'MISSING' as const,
  });

  // Pick one from each category
  const structural = sorted.find(
    (e) => String(e.from ?? '').startsWith('dec_') || String(e.from ?? '').startsWith('opt_'),
  );
  const causal = sorted.find((e) => String(e.from ?? '').startsWith('fac_'));
  const bridge = sorted.find(
    (e) => String(e.from ?? '').startsWith('out_') || String(e.from ?? '').startsWith('risk_'),
  );

  const picked = [structural, causal, bridge].filter(Boolean) as Record<string, unknown>[];
  const pickedSet = new Set(picked);

  // Fill remaining slots from globally sorted list (up to 3 total)
  if (picked.length < 3) {
    for (const e of sorted) {
      if (picked.length >= 3) break;
      if (!pickedSet.has(e)) {
        picked.push(e);
        pickedSet.add(e);
      }
    }
  }

  return picked.map(mapEdge);
}

// =============================================================================
// Provenance assembly
// =============================================================================

export interface ProvenanceInput {
  pipelinePath: 'A' | 'B';
  model: string;
  promptVersion?: string;
  promptSource?: 'store' | 'default';
  promptStoreVersion?: number | null;
  modelOverrideActive?: boolean;
}

export function assembleCeeProvenance(input: ProvenanceInput): CEEProvenance {
  const promptSource: CEEProvenance['prompt_source'] =
    Boolean(process.env.CEE_DRAFT_PROMPT_VERSION)
      ? 'env_override'
      : input.promptSource === 'store'
        ? 'supabase'
        : 'defaults';

  return {
    commit: GIT_COMMIT_SHORT,
    version: SERVICE_VERSION,
    build_timestamp: BUILD_TIMESTAMP,
    prompt_version: input.promptVersion ?? 'unknown',
    prompt_source: promptSource,
    prompt_override_active: Boolean(process.env.CEE_DRAFT_PROMPT_VERSION),
    model: input.model,
    pipeline_path: input.pipelinePath,
    engine_base_url_configured: Boolean(process.env.ENGINE_BASE_URL),
    model_override_active: input.modelOverrideActive ?? false,
    prompt_store_version: input.promptStoreVersion ?? null,
  };
}

// =============================================================================
// Size guard
// =============================================================================

const MAX_CHECKPOINTS_BYTES = 3000;

/**
 * If checkpoints exceed 3KB, drop sample_edges to stay within budget.
 */
export function applyCheckpointSizeGuard(
  checkpoints: PipelineCheckpoint[],
): PipelineCheckpoint[] {
  const serialized = JSON.stringify(checkpoints);
  if (serialized.length <= MAX_CHECKPOINTS_BYTES) return checkpoints;

  // Drop sample_edges from all checkpoints
  return checkpoints.map((cp) => ({ ...cp, sample_edges: [] }));
}
