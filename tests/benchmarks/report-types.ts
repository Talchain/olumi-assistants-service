/**
 * Benchmark Report Types (Tasks 7 + 8)
 *
 * Defines the full report structure including reproducibility metadata
 * and the ISL outcome stability stub.
 */

import type { BriefStabilityMetrics } from "./stability-metrics.js";
import type { BriefAggregateMetrics, ISLOutcomeStabilityStub } from "./aggregate-metrics.js";
import type { SensitivityComparison } from "./prompt-sensitivity.js";

// ---------------------------------------------------------------------------
// Reproducibility Metadata (Task 8)
// ---------------------------------------------------------------------------

export interface ReproducibilityMetadata {
  /** Gold brief set version used */
  gold_set_version: number;
  /** Git commit hash of the CEE codebase */
  cee_commit_hash: string;
  /** Concrete LLM model ID (e.g. "claude-sonnet-4-5-20250929", "gpt-4o") */
  model_name?: string;
  /** LLM provider (e.g. "anthropic", "openai", "fixtures") */
  model_version: string;
  /** Prompt version identifier (if tracked) */
  prompt_version?: string;
  /** LLM temperature setting (if configurable) */
  temperature?: number;
  /** Seed sequence used for the runs */
  seed_sequence: string[];
  /** ISO 8601 timestamp of benchmark execution */
  timestamp: string;
  /** Benchmark mode: "nightly" (all × 5) or "on-demand" (3 × 3) */
  mode: "nightly" | "on-demand";
}

// ---------------------------------------------------------------------------
// Per-Brief Report
// ---------------------------------------------------------------------------

export interface BriefReport {
  brief_id: string;
  domain: string;
  /** Per-edge stability metrics */
  stability: BriefStabilityMetrics;
  /** Aggregate option/outcome metrics */
  aggregate: BriefAggregateMetrics;
  /** Alert flags */
  alerts: BriefAlerts;
  /** Number of successfully completed seed runs */
  completed_runs: number;
  /** Number of expected seed runs */
  expected_runs: number;
}

export interface BriefAlerts {
  /** Any always-present edge has CV > 0.5 */
  high_cv_edges: boolean;
  /** Structural stability < 80% */
  low_structural_stability: boolean;
  /** Option set changes across runs */
  option_set_changes: boolean;
}

// ---------------------------------------------------------------------------
// Sensitivity Report
// ---------------------------------------------------------------------------

export interface SensitivityReport {
  brief_id: string;
  comparisons: SensitivityComparison[];
}

// ---------------------------------------------------------------------------
// Full Benchmark Report
// ---------------------------------------------------------------------------

export interface BenchmarkReport {
  /** Reproducibility metadata */
  metadata: ReproducibilityMetadata;
  /** Per-brief results */
  brief_reports: BriefReport[];
  /** Brief IDs that were expected but dropped (failed all seeds / insufficient runs) */
  dropped_brief_ids: string[];
  /** Prompt sensitivity results (only for sensitivity subset) */
  sensitivity_reports: SensitivityReport[];
  /** Summary across all briefs */
  summary: BenchmarkSummary;
}

export interface BenchmarkSummary {
  total_briefs: number;
  briefs_with_alerts: number;
  average_structural_stability: number;
  average_node_set_stability_rate: number;
  average_option_count_stability_rate: number;
  /** Briefs where any alert was triggered */
  flagged_brief_ids: string[];
}

// ---------------------------------------------------------------------------
// Alert Thresholds
// ---------------------------------------------------------------------------

export const ALERT_THRESHOLDS = {
  /** CV threshold for individual edges */
  edge_cv: 0.5,
  /** Minimum structural stability */
  structural_stability: 0.8,
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check alerts for a brief's metrics.
 */
export function checkAlerts(
  stability: BriefStabilityMetrics,
  aggregate: BriefAggregateMetrics,
): BriefAlerts {
  return {
    high_cv_edges: stability.high_cv_edges.length > 0,
    low_structural_stability: stability.structural_stability < ALERT_THRESHOLDS.structural_stability,
    option_set_changes: !aggregate.option_set_stability.count_stable || !aggregate.option_set_stability.labels_stable,
  };
}

/**
 * Compute summary across all brief reports.
 */
export function computeSummary(reports: BriefReport[]): BenchmarkSummary {
  const flagged = reports.filter(
    (r) => r.alerts.high_cv_edges || r.alerts.low_structural_stability || r.alerts.option_set_changes,
  );

  const avgStructural =
    reports.length > 0
      ? reports.reduce((sum, r) => sum + r.stability.structural_stability, 0) / reports.length
      : 1;

  const avgNodeSetStability =
    reports.length > 0
      ? reports.filter((r) => r.stability.node_set_stable).length / reports.length
      : 1;

  const avgOptionStability =
    reports.length > 0
      ? reports.filter((r) => r.aggregate.option_set_stability.count_stable).length / reports.length
      : 1;

  return {
    total_briefs: reports.length,
    briefs_with_alerts: flagged.length,
    average_structural_stability: avgStructural,
    average_node_set_stability_rate: avgNodeSetStability,
    average_option_count_stability_rate: avgOptionStability,
    flagged_brief_ids: flagged.map((r) => r.brief_id),
  };
}
