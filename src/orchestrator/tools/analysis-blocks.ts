/**
 * Pure transformer: analysis response → blocks + guidance items.
 *
 * No side effects, no PLoT calls, no context mutations.
 * Used by both the run_analysis tool handler (via dispatch.ts) and the
 * direct_analysis_run system event handler (Path A — UI already ran analysis).
 */

import type { ConversationBlock, V2RunResponseEnvelope } from "../types.js";
import type { GraphV3T } from "../types.js";
import type { GuidanceItem } from "../types/guidance-item.js";
import { createFactBlock, createReviewCardBlock } from "../blocks/factory.js";
import { generatePostAnalysisGuidance } from "../guidance/post-analysis.js";

// ============================================================================
// Types
// ============================================================================

export interface AnalysisBlocksResult {
  blocks: ConversationBlock[];
  guidanceItems: GuidanceItem[];
  responseHash: string | undefined;
}

// ============================================================================
// Transformer
// ============================================================================

/**
 * Build ConversationBlocks and GuidanceItems from a V2RunResponseEnvelope.
 *
 * Pure function — no PLoT calls, no context mutations.
 * Mirrors the block-building logic in run-analysis.ts handleRunAnalysis().
 *
 * @param response - Full analysis response from PLoT (or UI-provided)
 * @param graph - Current graph (for guidance generation). May be null.
 * @param turnId - Turn ID for block provenance
 */
export function buildAnalysisBlocksAndGuidance(
  response: V2RunResponseEnvelope,
  graph: GraphV3T | null,
  turnId: string,
): AnalysisBlocksResult {
  const responseHash = response.response_hash ?? response.meta?.response_hash;
  const seedUsed = Number(response.meta?.seed_used);

  const blocks: ConversationBlock[] = [];

  // FactBlocks from fact_objects (grouped by fact_type)
  // Only if fact_objects is present and non-empty — do NOT synthesise from other fields
  if (response.fact_objects && Array.isArray(response.fact_objects) && response.fact_objects.length > 0) {
    const grouped = groupByFactType(response.fact_objects);
    for (const [factType, facts] of grouped) {
      blocks.push(createFactBlock(
        { fact_type: factType, facts },
        turnId,
        responseHash,
        seedUsed,
      ));
    }
  }

  // ReviewCardBlocks from review_cards
  // Only if review_cards is present and non-empty — do NOT synthesise
  if (response.review_cards && Array.isArray(response.review_cards) && response.review_cards.length > 0) {
    for (const card of response.review_cards) {
      blocks.push(createReviewCardBlock(card, turnId));
    }
  }

  const guidanceItems = generatePostAnalysisGuidance(response, graph);

  return { blocks, guidanceItems, responseHash };
}

// ============================================================================
// Helpers
// ============================================================================

function groupByFactType(factObjects: unknown[]): Map<string, unknown[]> {
  const grouped = new Map<string, unknown[]>();

  for (const fact of factObjects) {
    const factType = (fact as Record<string, unknown>)?.fact_type;
    if (typeof factType !== 'string') continue;

    const existing = grouped.get(factType);
    if (existing) {
      existing.push(fact);
    } else {
      grouped.set(factType, [fact]);
    }
  }

  return grouped;
}
