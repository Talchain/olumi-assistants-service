/**
 * Graph Corrections Tracking Module
 *
 * Tracks all graph modifications made during the CEE pipeline for
 * debugging, auditing, and UI visibility.
 *
 * Based on the 25-stage pipeline inventory:
 * - Adapter Layer (stages 1-7): anthropic.ts / openai.ts
 * - Pipeline Layer (stages 8-18): pipeline.ts
 * - Guards Layer (stages 19-25): graphGuards.ts
 */

import { randomUUID } from "node:crypto";

// ============================================================================
// Types
// ============================================================================

export type CorrectionLayer = "adapter" | "pipeline" | "guards";

export type CorrectionType =
  | "node_added"
  | "node_removed"
  | "node_modified"
  | "edge_added"
  | "edge_removed"
  | "edge_modified"
  | "kind_normalised"
  | "coefficient_adjusted";

export interface CorrectionTarget {
  node_id?: string;
  edge_id?: string; // Format: "from_id->to_id"
  kind?: string;
}

export interface GraphCorrection {
  id: string;
  stage: number; // 1-25 from inventory
  stage_name: string;
  layer: CorrectionLayer;
  type: CorrectionType;
  target: CorrectionTarget;
  before?: unknown;
  after?: unknown;
  reason: string;
}

export interface CorrectionsSummary {
  total: number;
  by_layer: Record<CorrectionLayer, number>;
  by_type: Record<CorrectionType, number>;
}

// ============================================================================
// Stage Definitions (from inventory)
// ============================================================================

export const STAGE_DEFINITIONS: Record<
  number,
  { name: string; layer: CorrectionLayer }
> = {
  1: { name: "Kind Normalization", layer: "adapter" },
  2: { name: "V4→Flat Conversion", layer: "adapter" },
  3: { name: "Node Capping", layer: "adapter" },
  4: { name: "Edge Capping", layer: "adapter" },
  5: { name: "Dangling Edge Filter #1", layer: "adapter" },
  6: { name: "Edge ID Assignment", layer: "adapter" },
  7: { name: "Graph Sorting", layer: "adapter" },
  8: { name: "LLM Output Storage", layer: "pipeline" },
  9: { name: "Version Normalization", layer: "pipeline" },
  10: { name: "Risk Coefficient Norm", layer: "pipeline" },
  11: { name: "Factor Enrichment", layer: "pipeline" },
  12: { name: "Goal Merging", layer: "pipeline" },
  13: { name: "Outcome Belief Fill", layer: "pipeline" },
  14: { name: "Decision Belief Norm", layer: "pipeline" },
  15: { name: "Fault Injection", layer: "pipeline" },
  16: { name: "Min Structure Check", layer: "pipeline" },
  17: { name: "Goal Inference", layer: "pipeline" },
  18: { name: "Outcome→Goal Wiring", layer: "pipeline" },
  19: { name: "Node Capping #2", layer: "guards" },
  20: { name: "Edge Capping #2", layer: "guards" },
  21: { name: "Dangling Edge Filter #2", layer: "guards" },
  22: { name: "Cycle Breaking", layer: "guards" },
  23: { name: "Isolated Node Pruning", layer: "guards" },
  24: { name: "Edge ID Normalization", layer: "guards" },
  25: { name: "Meta Calculation", layer: "guards" },
};

// ============================================================================
// Correction Collector
// ============================================================================

export interface CorrectionCollector {
  /**
   * Add a correction record
   */
  add(correction: Omit<GraphCorrection, "id">): void;

  /**
   * Add a correction with stage number (auto-fills stage_name and layer)
   */
  addByStage(
    stage: number,
    type: CorrectionType,
    target: CorrectionTarget,
    reason: string,
    before?: unknown,
    after?: unknown
  ): void;

  /**
   * Get all collected corrections
   */
  getCorrections(): GraphCorrection[];

  /**
   * Get summary statistics
   */
  getSummary(): CorrectionsSummary;

  /**
   * Check if any corrections have been recorded
   */
  hasCorrections(): boolean;

  /**
   * Get count of corrections
   */
  count(): number;
}

/**
 * Create a new correction collector instance.
 * Pass this through the pipeline to accumulate corrections at each stage.
 */
export function createCorrectionCollector(): CorrectionCollector {
  const corrections: GraphCorrection[] = [];

  return {
    add(correction: Omit<GraphCorrection, "id">): void {
      corrections.push({
        ...correction,
        id: randomUUID(),
      });
    },

    addByStage(
      stage: number,
      type: CorrectionType,
      target: CorrectionTarget,
      reason: string,
      before?: unknown,
      after?: unknown
    ): void {
      const stageDef = STAGE_DEFINITIONS[stage];
      if (!stageDef) {
        // Unknown stage - use fallback
        corrections.push({
          id: randomUUID(),
          stage,
          stage_name: `Unknown Stage ${stage}`,
          layer: "pipeline",
          type,
          target,
          reason,
          before,
          after,
        });
        return;
      }

      corrections.push({
        id: randomUUID(),
        stage,
        stage_name: stageDef.name,
        layer: stageDef.layer,
        type,
        target,
        reason,
        before,
        after,
      });
    },

    getCorrections(): GraphCorrection[] {
      return [...corrections];
    },

    getSummary(): CorrectionsSummary {
      const byLayer: Record<CorrectionLayer, number> = {
        adapter: 0,
        pipeline: 0,
        guards: 0,
      };

      const byType: Record<CorrectionType, number> = {
        node_added: 0,
        node_removed: 0,
        node_modified: 0,
        edge_added: 0,
        edge_removed: 0,
        edge_modified: 0,
        kind_normalised: 0,
        coefficient_adjusted: 0,
      };

      for (const correction of corrections) {
        byLayer[correction.layer]++;
        byType[correction.type]++;
      }

      return {
        total: corrections.length,
        by_layer: byLayer,
        by_type: byType,
      };
    },

    hasCorrections(): boolean {
      return corrections.length > 0;
    },

    count(): number {
      return corrections.length;
    },
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Format an edge ID for correction tracking
 */
export function formatEdgeId(from: string, to: string): string {
  return `${from}->${to}`;
}

/**
 * Create a no-op collector for when tracking is disabled
 */
export function createNoOpCollector(): CorrectionCollector {
  const empty: GraphCorrection[] = [];
  const emptySummary: CorrectionsSummary = {
    total: 0,
    by_layer: { adapter: 0, pipeline: 0, guards: 0 },
    by_type: {
      node_added: 0,
      node_removed: 0,
      node_modified: 0,
      edge_added: 0,
      edge_removed: 0,
      edge_modified: 0,
      kind_normalised: 0,
      coefficient_adjusted: 0,
    },
  };

  return {
    add(): void {},
    addByStage(): void {},
    getCorrections(): GraphCorrection[] {
      return empty;
    },
    getSummary(): CorrectionsSummary {
      return emptySummary;
    },
    hasCorrections(): boolean {
      return false;
    },
    count(): number {
      return 0;
    },
  };
}
