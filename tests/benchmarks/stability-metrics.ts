/**
 * Per-Edge Stability Metrics (Task 3)
 *
 * Computes CV of strength.mean, strength.std, and exists_probability
 * for always-present edges. Reports presence rate and parameter ranges
 * for intermittent edges.
 *
 * Safe CV handling: when |mean| < 0.05, CV explodes. We report absolute
 * std and IQR instead, using an epsilon floor: CV = std / max(|mean|, 0.05).
 */

import type { MatchedEdge, MatchResult } from "./matching.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Epsilon floor for CV computation near zero */
const CV_EPSILON = 0.05;

export interface EdgeParameterStats {
  mean: number;
  std: number;
  min: number;
  max: number;
  /** Coefficient of variation (epsilon-floored if |mean| < 0.05) */
  cv: number;
  /** If true, |mean| < epsilon and CV is unreliable — prefer abs_std and iqr */
  near_zero: boolean;
  /** Interquartile range (Q3 - Q1) */
  iqr: number;
  values: number[];
}

export interface AlwaysPresentEdgeMetrics {
  edge_key: string;
  strength_mean: EdgeParameterStats;
  strength_std: EdgeParameterStats;
  belief_exists: EdgeParameterStats;
}

export interface IntermittentEdgeMetrics {
  edge_key: string;
  /** Fraction of runs where this edge appeared, e.g. 0.6 = 3/5 */
  presence_rate: number;
  present_count: number;
  total_runs: number;
  /** Parameter ranges when present */
  strength_mean_range: { min: number; max: number };
  strength_std_range: { min: number; max: number };
  belief_exists_range: { min: number; max: number };
}

export interface BriefStabilityMetrics {
  brief_id: string;
  /** Fraction of edges present in all runs */
  structural_stability: number;
  /** Same node set across all runs? */
  node_set_stable: boolean;
  /** If not stable, description of differences */
  node_set_diff?: string;
  /** Per-edge metrics for always-present edges */
  always_present: AlwaysPresentEdgeMetrics[];
  /** Per-edge metrics for intermittent edges */
  intermittent: IntermittentEdgeMetrics[];
  /** Edges with CV > threshold — instability heatmap candidates */
  high_cv_edges: Array<{ edge_key: string; parameter: string; cv: number }>;
}

// ---------------------------------------------------------------------------
// Statistical Helpers
// ---------------------------------------------------------------------------

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function std(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance = values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = q * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (pos - lo) * (sorted[hi]! - sorted[lo]!);
}

function iqr(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return quantile(sorted, 0.75) - quantile(sorted, 0.25);
}

function computeParameterStats(values: number[]): EdgeParameterStats {
  // Filter out NaN/null/undefined values that may leak from V1 edges
  const clean = values.filter((v) => typeof v === "number" && Number.isFinite(v));
  if (clean.length === 0) {
    return { mean: 0, std: 0, min: 0, max: 0, cv: 0, near_zero: true, iqr: 0, values: clean };
  }

  const m = mean(clean);
  const s = std(clean);
  const nearZero = Math.abs(m) < CV_EPSILON;
  const cv = s / Math.max(Math.abs(m), CV_EPSILON);
  const sorted = [...clean].sort((a, b) => a - b);

  return {
    mean: m,
    std: s,
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
    cv: Number.isFinite(cv) ? cv : 0,
    near_zero: nearZero,
    iqr: iqr(clean),
    values: clean,
  };
}

// ---------------------------------------------------------------------------
// Edge Field Extraction (V4 with V1 fallback)
// ---------------------------------------------------------------------------

/**
 * Extract edge parameters, falling back from V4 to V1 fields.
 * V4: strength_mean, strength_std, belief_exists
 * V1: weight (0-1), belief (0-1) — strength_std has no V1 equivalent
 */
function extractEdgeParams(instance: any): { sm: number; ss: number; be: number } {
  const sm = typeof instance.strength_mean === "number"
    ? instance.strength_mean
    : typeof instance.weight === "number"
      ? instance.weight
      : 0;
  const ss = typeof instance.strength_std === "number"
    ? instance.strength_std
    : 0.1; // Sensible default when no uncertainty data
  const be = typeof instance.belief_exists === "number"
    ? instance.belief_exists
    : typeof instance.belief === "number"
      ? instance.belief
      : 0.8; // Sensible default
  return { sm, ss, be };
}

// ---------------------------------------------------------------------------
// Metric Computation
// ---------------------------------------------------------------------------

function computeAlwaysPresentMetrics(edge: MatchedEdge): AlwaysPresentEdgeMetrics {
  const strengthMeans: number[] = [];
  const strengthStds: number[] = [];
  const beliefExists: number[] = [];

  for (const instance of edge.instances.values()) {
    const { sm, ss, be } = extractEdgeParams(instance);
    strengthMeans.push(sm);
    strengthStds.push(ss);
    beliefExists.push(be);
  }

  return {
    edge_key: edge.key,
    strength_mean: computeParameterStats(strengthMeans),
    strength_std: computeParameterStats(strengthStds),
    belief_exists: computeParameterStats(beliefExists),
  };
}

function computeIntermittentMetrics(edge: MatchedEdge): IntermittentEdgeMetrics {
  const strengthMeans: number[] = [];
  const strengthStds: number[] = [];
  const beliefExists: number[] = [];

  for (const instance of edge.instances.values()) {
    const { sm, ss, be } = extractEdgeParams(instance);
    strengthMeans.push(sm);
    strengthStds.push(ss);
    beliefExists.push(be);
  }

  return {
    edge_key: edge.key,
    presence_rate: edge.present_in_runs.length / edge.total_runs,
    present_count: edge.present_in_runs.length,
    total_runs: edge.total_runs,
    strength_mean_range: {
      min: Math.min(...strengthMeans),
      max: Math.max(...strengthMeans),
    },
    strength_std_range: {
      min: Math.min(...strengthStds),
      max: Math.max(...strengthStds),
    },
    belief_exists_range: {
      min: Math.min(...beliefExists),
      max: Math.max(...beliefExists),
    },
  };
}

// ---------------------------------------------------------------------------
// Top-Level
// ---------------------------------------------------------------------------

/** CV threshold for flagging high-instability edges */
const HIGH_CV_THRESHOLD = 0.5;

/**
 * Compute full stability metrics for a brief across multiple runs.
 */
export function computeBriefStabilityMetrics(
  briefId: string,
  matchResult: MatchResult,
): BriefStabilityMetrics {
  const totalEdges = matchResult.matched_edges.length;
  const alwaysPresentCount = matchResult.always_present_edges.length;
  const structuralStability = totalEdges > 0 ? alwaysPresentCount / totalEdges : 1;

  // Node set stability: check if every matched node appears in every run
  // Use total_runs from MatchResult (set by runner), not inferred from edges
  const totalRuns = matchResult.total_runs;

  let nodeSetStable = true;
  const diffs: string[] = [];
  for (const mn of matchResult.matched_nodes) {
    if (mn.instances.size < totalRuns) {
      nodeSetStable = false;
      const missingRuns = [];
      for (let i = 0; i < totalRuns; i++) {
        if (!mn.instances.has(i)) missingRuns.push(i);
      }
      diffs.push(`${mn.key} missing in runs: [${missingRuns.join(", ")}]`);
    }
  }

  // Compute per-edge metrics
  const alwaysPresent = matchResult.always_present_edges.map(computeAlwaysPresentMetrics);
  const intermittent = matchResult.intermittent_edges.map(computeIntermittentMetrics);

  // High-CV edge detection
  const highCvEdges: BriefStabilityMetrics["high_cv_edges"] = [];
  for (const apm of alwaysPresent) {
    if (apm.strength_mean.cv > HIGH_CV_THRESHOLD) {
      highCvEdges.push({ edge_key: apm.edge_key, parameter: "strength_mean", cv: apm.strength_mean.cv });
    }
    if (apm.strength_std.cv > HIGH_CV_THRESHOLD) {
      highCvEdges.push({ edge_key: apm.edge_key, parameter: "strength_std", cv: apm.strength_std.cv });
    }
    if (apm.belief_exists.cv > HIGH_CV_THRESHOLD) {
      highCvEdges.push({ edge_key: apm.edge_key, parameter: "belief_exists", cv: apm.belief_exists.cv });
    }
  }

  return {
    brief_id: briefId,
    structural_stability: structuralStability,
    node_set_stable: nodeSetStable,
    node_set_diff: diffs.length > 0 ? diffs.join("; ") : undefined,
    always_present: alwaysPresent,
    intermittent,
    high_cv_edges: highCvEdges,
  };
}
