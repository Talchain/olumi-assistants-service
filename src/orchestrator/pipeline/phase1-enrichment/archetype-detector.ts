/**
 * Archetype Detector
 *
 * Detects the decision type (archetype) from the user's message
 * and optional framing context using keyword heuristics.
 *
 * Pure function — no LLM calls, no I/O.
 */

import type { DecisionArchetype, ConversationContext } from "../types.js";

// ============================================================================
// Archetype Keyword Sets
// ============================================================================

const ARCHETYPE_KEYWORDS: Record<string, string[]> = {
  pricing: ['price', 'pricing', 'cost', 'revenue', 'margin', 'subscription', 'tier'],
  build_vs_buy: ['build', 'buy', 'outsource', 'vendor', 'in-house', 'make or buy'],
  hiring: ['hire', 'recruit', 'headcount', 'team', 'candidate', 'role'],
  market_entry: ['market', 'launch', 'expand', 'enter', 'geography', 'region'],
  resource_allocation: ['allocate', 'budget', 'invest', 'prioritise', 'prioritize', 'capacity'],
};

// ============================================================================
// Detector
// ============================================================================

/**
 * Detect the decision archetype from user message and framing context.
 *
 * Checks both the message AND `framing?.goal` (if present) for keyword matches.
 *
 * Confidence:
 * - high: ≥2 keywords match the same archetype
 * - medium: 1 keyword matches
 * - low: 0 keywords match (type is null)
 */
export function detectArchetype(
  message: string,
  framing: ConversationContext['framing'],
): DecisionArchetype {
  // Combine message and goal for keyword search
  const searchText = [message, framing?.goal ?? ''].join(' ').toLowerCase();

  let bestType: string | null = null;
  let bestCount = 0;
  let bestEvidence: string[] = [];

  for (const [archetypeName, keywords] of Object.entries(ARCHETYPE_KEYWORDS)) {
    const matched = keywords.filter(kw => searchText.includes(kw));
    if (matched.length > bestCount) {
      bestCount = matched.length;
      bestType = archetypeName;
      bestEvidence = matched;
    }
  }

  if (bestCount === 0) {
    return {
      type: null,
      confidence: 'low',
      evidence: 'no keywords matched',
    };
  }

  return {
    type: bestType,
    confidence: bestCount >= 2 ? 'high' : 'medium',
    evidence: bestEvidence.join(', '),
  };
}
