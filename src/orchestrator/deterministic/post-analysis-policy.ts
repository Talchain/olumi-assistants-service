/**
 * Post-Analysis Policy
 *
 * Single source of truth for which actions are read-only explanation tools
 * that query existing analysis data without triggering new computation.
 *
 * These tools (explain_result, compare_options, what_would_flip) remain
 * available in the tool set when fresh analysis is present — they are NOT
 * suppressed. They produce structured explanation responses from existing
 * analysis data (factor_sensitivity, fragile_edges, top_drivers, etc.).
 *
 * Only run_analysis is suppressed post-analysis (via tool-builder's
 * staleness rule) to prevent redundant long-running calls. The staleness
 * bypass in pipeline-v4 lets chip clicks override that suppression.
 *
 * This set is used by:
 * - chip-engine (via action-tool-mapping) for documenting explanation tools
 * - tests for verifying the tool availability contract
 */

import type { ActionName } from "./actions/types.js";

export const POST_ANALYSIS_EXPLANATION_ACTIONS: ReadonlySet<ActionName> = new Set<ActionName>([
  'explain_result',
  'compare_options',
  'what_would_flip',
]);
