/**
 * Validation Pipeline — Enforcement Lints
 *
 * Auto-correct rules applied to Pass 2 (o4-mini) output before comparison.
 * Corrections ensure Pass 2 values respect the same parameter contracts as Pass 1.
 *
 * Auto-correct rules (applied sequentially, most to least aggressive):
 *   1. Budget rescale — Σ|mean| > 1.0 for a target node → proportional rescale
 *   2. Std clamp — std > |mean| → std = |mean| * STD_CLAMP_RATIO
 *   3. EP cap (domain_prior) — ep > DOMAIN_PRIOR_EP_CAP → clamp
 *   4. EP cap (weak_guess) — basis=weak_guess, ep > WEAK_GUESS_EP_CAP → clamp
 *   5. Std floor (weak_guess) — basis=weak_guess, std < WEAK_GUESS_STD_FLOOR → floor
 *   6. NUI enforcement — basis=weak_guess, needs_user_input=false → set true
 *
 * Detection lints (warn only, no value change):
 *   D1. Identical values across all edges — suspicious sign of copy-paste
 *   D2. Clustered EP — all ep values within 0.05 range — suspicious
 *   D3. Empty reasoning — one or more edges have reasoning === ''
 *
 * Source of truth: validation_comparison_spec_v1_4.md §Enforcement Lints.
 */

import { VALIDATION_CONSTANTS } from './constants.js';
import type { LintEntry, LintedPass2Estimate, Pass2EdgeEstimate } from './types.js';

// ============================================================================
// Auto-correct rules
// ============================================================================

/**
 * Applies all enforcement lints to a list of Pass 2 edge estimates.
 *
 * Returns:
 *  - `edges`: lint-corrected estimates (values mutated only via returned copy)
 *  - `lintLog`: all lint events, including detection-only lints
 */
export function runEnforcementLints(
  estimates: Pass2EdgeEstimate[],
): { edges: LintedPass2Estimate[]; lintLog: LintEntry[] } {
  const lintLog: LintEntry[] = [];

  // Work on deep copies so the caller's originals are not mutated.
  let edges: LintedPass2Estimate[] = estimates.map((e) => ({
    ...e,
    strength: { ...e.strength },
    lint_corrected: false,
  }));

  // ── Rule 1: Budget rescale ─────────────────────────────────────────────────
  // For each unique target node, if the sum of |mean| values of all incoming
  // edges exceeds 1.0, scale all means proportionally so that Σ|mean| = 1.0.
  edges = applyBudgetRescale(edges, lintLog);

  // ── Rule 2: Std clamp ─────────────────────────────────────────────────────
  // If std > |mean|, clamp std to |mean| * STD_CLAMP_RATIO.
  // Skip edges where mean = 0 to avoid division by zero.
  for (const edge of edges) {
    const mean = edge.strength.mean;
    const std = edge.strength.std;
    if (mean !== 0 && std > Math.abs(mean)) {
      const before = std;
      const after = Math.abs(mean) * VALIDATION_CONSTANTS.STD_CLAMP_RATIO;
      edge.strength.std = after;
      edge.lint_corrected = true;
      lintLog.push({
        code: 'LINT_STD_CLAMPED',
        edge_key: edgeKey(edge),
        before,
        after,
      });
    }
  }

  // ── Rule 3: EP cap (domain_prior) ─────────────────────────────────────────
  for (const edge of edges) {
    if (
      edge.basis === 'domain_prior' &&
      edge.exists_probability > VALIDATION_CONSTANTS.DOMAIN_PRIOR_EP_CAP
    ) {
      const before = edge.exists_probability;
      edge.exists_probability = VALIDATION_CONSTANTS.DOMAIN_PRIOR_EP_CAP;
      edge.lint_corrected = true;
      lintLog.push({
        code: 'LINT_EP_CAPPED_DOMAIN_PRIOR',
        edge_key: edgeKey(edge),
        before,
        after: VALIDATION_CONSTANTS.DOMAIN_PRIOR_EP_CAP,
      });
    }
  }

  // ── Rule 4: EP cap (weak_guess) ────────────────────────────────────────────
  for (const edge of edges) {
    if (
      edge.basis === 'weak_guess' &&
      edge.exists_probability > VALIDATION_CONSTANTS.WEAK_GUESS_EP_CAP
    ) {
      const before = edge.exists_probability;
      edge.exists_probability = VALIDATION_CONSTANTS.WEAK_GUESS_EP_CAP;
      edge.lint_corrected = true;
      lintLog.push({
        code: 'LINT_EP_CAPPED_WEAK_GUESS',
        edge_key: edgeKey(edge),
        before,
        after: VALIDATION_CONSTANTS.WEAK_GUESS_EP_CAP,
      });
    }
  }

  // ── Rule 5: Std floor (weak_guess) ────────────────────────────────────────
  for (const edge of edges) {
    if (
      edge.basis === 'weak_guess' &&
      edge.strength.std < VALIDATION_CONSTANTS.WEAK_GUESS_STD_FLOOR
    ) {
      const before = edge.strength.std;
      edge.strength.std = VALIDATION_CONSTANTS.WEAK_GUESS_STD_FLOOR;
      edge.lint_corrected = true;
      lintLog.push({
        code: 'LINT_STD_FLOORED_WEAK_GUESS',
        edge_key: edgeKey(edge),
        before,
        after: VALIDATION_CONSTANTS.WEAK_GUESS_STD_FLOOR,
      });
    }
  }

  // ── Rule 6: NUI enforcement ────────────────────────────────────────────────
  for (const edge of edges) {
    if (edge.basis === 'weak_guess' && !edge.needs_user_input) {
      lintLog.push({
        code: 'LINT_NUI_ENFORCED',
        edge_key: edgeKey(edge),
        before: false,
        after: true,
      });
      edge.needs_user_input = true;
      edge.lint_corrected = true;
    }
  }

  // ── Detection lints (warn only, no mutations) ──────────────────────────────
  applyDetectionLints(edges, lintLog);

  return { edges, lintLog };
}

// ============================================================================
// Budget rescale helper
// ============================================================================

function applyBudgetRescale(
  edges: LintedPass2Estimate[],
  lintLog: LintEntry[],
): LintedPass2Estimate[] {
  // Group edges by their target node.
  const byTarget = new Map<string, LintedPass2Estimate[]>();
  for (const edge of edges) {
    const group = byTarget.get(edge.to);
    if (group) {
      group.push(edge);
    } else {
      byTarget.set(edge.to, [edge]);
    }
  }

  for (const [, group] of byTarget) {
    const totalAbsMean = group.reduce(
      (sum, e) => sum + Math.abs(e.strength.mean),
      0,
    );
    if (totalAbsMean <= VALIDATION_CONSTANTS.BUDGET_SUM_MAX) continue;

    // Scale factor: divide each mean by totalAbsMean so Σ|mean| = BUDGET_SUM_MAX.
    const scale = VALIDATION_CONSTANTS.BUDGET_SUM_MAX / totalAbsMean;
    for (const edge of group) {
      const before = edge.strength.mean;
      const after = edge.strength.mean * scale;
      edge.strength.mean = after;
      edge.lint_corrected = true;
      lintLog.push({
        code: 'LINT_BUDGET_RESCALE',
        edge_key: edgeKey(edge),
        before,
        after,
      });
    }
  }

  return edges;
}

// ============================================================================
// Detection lint helpers
// ============================================================================

function applyDetectionLints(
  edges: LintedPass2Estimate[],
  lintLog: LintEntry[],
): void {
  if (edges.length === 0) return;

  // D1: Identical mean values across all edges.
  const allMeans = edges.map((e) => e.strength.mean);
  const uniqueMeans = new Set(allMeans);
  if (edges.length > 1 && uniqueMeans.size === 1) {
    for (const edge of edges) {
      lintLog.push({
        code: 'WARN_IDENTICAL_VALUES',
        edge_key: edgeKey(edge),
        before: edge.strength.mean,
        after: edge.strength.mean,
      });
    }
  }

  // D2: Clustered EP — all ep values within a 0.05 range.
  if (edges.length > 1) {
    const eps = edges.map((e) => e.exists_probability);
    const epMin = Math.min(...eps);
    const epMax = Math.max(...eps);
    if (epMax - epMin < VALIDATION_CONSTANTS.WARN_CLUSTERED_EP_RANGE) {
      for (const edge of edges) {
        lintLog.push({
          code: 'WARN_CLUSTERED_EP',
          edge_key: edgeKey(edge),
          before: edge.exists_probability,
          after: edge.exists_probability,
        });
      }
    }
  }

  // D3: Empty reasoning string.
  for (const edge of edges) {
    if (edge.reasoning.trim() === '') {
      lintLog.push({
        code: 'WARN_EMPTY_REASONING',
        edge_key: edgeKey(edge),
        before: 0,
        after: 0,
      });
    }
  }
}

// ============================================================================
// Shared helpers
// ============================================================================

function edgeKey(edge: { from: string; to: string }): string {
  return `${edge.from}->${edge.to}`;
}
