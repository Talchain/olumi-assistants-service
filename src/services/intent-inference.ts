/**
 * Intent Inference Service
 *
 * Infers user intent from message text using keyword heuristics.
 * Used by /ask endpoint when intent is not explicitly provided.
 *
 * Intent classification:
 * - "explain" / "clarify" - Grounded to selected nodes/edges; include highlights
 * - "repair" - Propose concrete model_actions that improve structure/validity
 * - "ideate" - Generate alternatives or new ideas
 * - "compare" - Compare options or paths
 * - "challenge" - Challenge assumptions or beliefs
 *
 * Default: "clarify" when uncertain
 */

import { log } from "../utils/telemetry.js";
import type { AskIntentT, SelectionT } from "../schemas/working-set.js";

// ============================================================================
// Intent Keywords
// ============================================================================

/**
 * Keywords that strongly indicate a specific intent.
 * Order matters for multi-match - first match wins.
 */
const INTENT_KEYWORDS: Record<AskIntentT, RegExp[]> = {
  explain: [
    /\bwhy\b/i,
    /\bexplain\b/i,
    /\bwhat does\b/i,
    /\bhow does\b/i,
    /\bwhat is\b/i,
    /\btell me about\b/i,
    /\bunderstand\b/i,
    /\bmeaning\b/i,
    /\breason\b/i,
    /\bcause\b/i,
  ],
  repair: [
    /\bfix\b/i,
    /\brepair\b/i,
    /\bwrong\b/i,
    /\berror\b/i,
    /\bmistake\b/i,
    /\bincorrect\b/i,
    /\bbroken\b/i,
    /\bissue\b/i,
    /\bproblem\b/i,
    /\bimprove\b/i,
    /\bcorrect\b/i,
  ],
  ideate: [
    /\bwhat if\b/i,
    /\balternative\b/i,
    /\bother option/i,
    /\bother choice/i,
    /\bidea/i,
    /\bsuggest/i,
    /\bpropose\b/i,
    /\bbrainstorm/i,
    /\bcould we\b/i,
    /\bwhat about\b/i,
    /\bhow about\b/i,
    /\bpossibilities\b/i,
  ],
  compare: [
    /\bcompare\b/i,
    /\bdifference\b/i,
    /\bversus\b/i,
    /\bvs\.?\b/i,
    /\bbetter\b/i,
    /\bworse\b/i,
    /\btradeoff/i,
    /\btrade-off/i,
    /\bpros and cons\b/i,
    /\bweigh\b/i,
  ],
  challenge: [
    /\bchallenge\b/i,
    /\bquestion\b/i,
    /\bdoubt\b/i,
    /\bsure\b/i,
    /\bcertain\b/i,
    /\bassume\b/i,
    /\bassumption\b/i,
    /\bprove\b/i,
    /\bevidence\b/i,
    /\bvalid\b/i,
    /\breally\b/i,
    /\bactually\b/i,
  ],
  clarify: [
    /\bclarify\b/i,
    /\bconfused\b/i,
    /\bunclear\b/i,
    /\bdon't understand\b/i,
    /\bmore info/i,
    /\bmore detail/i,
    /\belaborate\b/i,
  ],
};

/**
 * Priority order for intent matching.
 * Earlier intents take precedence when multiple match.
 */
const INTENT_PRIORITY: AskIntentT[] = [
  "repair",    // Fixing things is high priority
  "compare",   // Explicit comparison request
  "challenge", // Challenging is specific
  "ideate",    // Generating ideas
  "explain",   // Explanation
  "clarify",   // Default catch-all
];

// ============================================================================
// Inference Logic
// ============================================================================

/**
 * Result of intent inference.
 */
export interface InferenceResult {
  /** Inferred intent */
  intent: AskIntentT;
  /** Confidence score (0-1) */
  confidence: number;
  /** Keywords that matched */
  matchedKeywords: string[];
  /** Whether this was a default/fallback */
  isDefault: boolean;
}

/**
 * Infer intent from user message.
 *
 * @param message - User's question/message
 * @param selection - Optional selection context (affects confidence)
 * @returns Inferred intent with confidence
 */
export function inferIntent(
  message: string,
  selection?: SelectionT
): InferenceResult {
  const matchResults: Array<{
    intent: AskIntentT;
    matches: string[];
    score: number;
  }> = [];

  // Check each intent's keywords
  for (const [intent, patterns] of Object.entries(INTENT_KEYWORDS) as Array<
    [AskIntentT, RegExp[]]
  >) {
    const matches: string[] = [];
    for (const pattern of patterns) {
      const match = message.match(pattern);
      if (match) {
        matches.push(match[0]);
      }
    }
    if (matches.length > 0) {
      // Score based on number of matches and keyword specificity
      const score = Math.min(0.5 + matches.length * 0.1, 0.9);
      matchResults.push({ intent, matches, score });
    }
  }

  // If no matches, default to clarify
  if (matchResults.length === 0) {
    log.debug(
      { message_length: message.length },
      "No intent keywords matched, defaulting to clarify"
    );
    return {
      intent: "clarify",
      confidence: 0.3,
      matchedKeywords: [],
      isDefault: true,
    };
  }

  // Sort by priority (earlier in INTENT_PRIORITY wins ties)
  matchResults.sort((a, b) => {
    // First by score (descending)
    if (a.score !== b.score) {
      return b.score - a.score;
    }
    // Then by priority (ascending index = higher priority)
    return (
      INTENT_PRIORITY.indexOf(a.intent) - INTENT_PRIORITY.indexOf(b.intent)
    );
  });

  const best = matchResults[0];

  // Boost confidence if there's selection context matching intent
  let confidence = best.score;
  if (selection?.node_id || selection?.edge_id) {
    // Having a selection context increases confidence for explain/repair
    if (best.intent === "explain" || best.intent === "repair") {
      confidence = Math.min(confidence + 0.1, 0.95);
    }
  }

  log.debug(
    {
      inferred_intent: best.intent,
      confidence,
      matched_keywords: best.matches,
      candidates: matchResults.length,
    },
    "Intent inferred from message"
  );

  return {
    intent: best.intent,
    confidence,
    matchedKeywords: best.matches,
    isDefault: false,
  };
}

/**
 * Check if an intent is supported for P0 (explain, clarify, repair).
 * Other intents may return follow_up_question or limited actions.
 */
export function isP0Intent(intent: AskIntentT): boolean {
  return intent === "explain" || intent === "clarify" || intent === "repair";
}

/**
 * Get a human-readable description of an intent.
 */
export function getIntentDescription(intent: AskIntentT): string {
  switch (intent) {
    case "explain":
      return "explain why something is in the graph";
    case "clarify":
      return "get more context or ask a follow-up question";
    case "repair":
      return "fix errors or improve structure";
    case "ideate":
      return "generate alternatives or new ideas";
    case "compare":
      return "compare options or paths";
    case "challenge":
      return "challenge assumptions or beliefs";
    default:
      return "process your request";
  }
}
