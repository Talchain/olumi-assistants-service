/**
 * Progress Classifier
 *
 * Classifies THIS turn's progress from tool results.
 * Separate from Phase 1's historical marker computation.
 */

import type { ToolResult, ProgressKind } from "../types.js";

/**
 * Classify the progress kind for the current turn based on tool side effects.
 *
 * - graph_updated → changed_model
 * - analysis_ran → ran_analysis
 * - brief_generated → committed (per spec: brief generation counts as commitment for PoC)
 *   // Post-pilot: separate 'generated_brief' from explicit user commitment.
 * - no tools invoked → none
 */
export function classifyProgress(toolResult: ToolResult): ProgressKind {
  if (toolResult.side_effects.graph_updated) return 'changed_model';
  if (toolResult.side_effects.analysis_ran) return 'ran_analysis';
  // Post-pilot: separate 'generated_brief' from explicit user commitment.
  if (toolResult.side_effects.brief_generated) return 'committed';
  return 'none';
}
