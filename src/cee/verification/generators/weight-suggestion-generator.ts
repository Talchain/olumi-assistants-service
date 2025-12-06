/**
 * Weight Suggestion Generator
 *
 * Generates suggestions for edges detected with problematic belief patterns
 * (uniform distribution, near-zero, near-one).
 *
 * Phase 2 of CEE Graph Quality Enhancement.
 *
 * Confidence is derived from the numerical grounding score:
 * - ≥0.8 → high confidence (0.9), auto_applied: true
 * - ≥0.5 → medium confidence (0.7), auto_applied: true
 * - <0.5 → low confidence (0.5), auto_applied: false
 *
 * When confidence ≥0.7, suggested_belief is populated with a recommended value.
 */

import type { GraphV1 } from "../../../contracts/plot/engine.js";
import type { CEEWeightSuggestionV1T } from "../../../schemas/ceeResponses.js";
import { log } from "../../../utils/telemetry.js";
import { config } from "../../../config/index.js";

/**
 * Context for generating weight suggestions
 */
export interface WeightSuggestionGeneratorContext {
  /** Optional brief for context (reserved for future LLM integration) */
  brief?: string;
  graph: GraphV1;
  detections: CEEWeightSuggestionV1T[];
  requestId: string;
  /** Numerical grounding score from verification pipeline (0-1, higher = better grounded) */
  numericalGroundingScore?: number;
}

/**
 * Generated weight suggestion with rationale
 */
export interface GeneratedWeightSuggestion extends CEEWeightSuggestionV1T {
  suggested_belief?: number;
  confidence: number;
  rationale: string;
  auto_applied: boolean;
}

/**
 * Confidence tier based on grounding score
 */
type ConfidenceTier = "high" | "medium" | "low";

/**
 * Maximum number of suggestions to generate per request
 */
const MAX_SUGGESTIONS = 5;

/**
 * Map numerical grounding score to confidence tier and numeric value.
 *
 * Thresholds per brief:
 * - ≥0.8 → high (0.9)
 * - ≥0.5 → medium (0.7)
 * - <0.5 → low (0.5)
 */
function mapGroundingToConfidence(score: number | undefined): {
  tier: ConfidenceTier;
  value: number;
  autoApplied: boolean;
} {
  // Default to medium if no score provided
  const effectiveScore = score ?? 0.6;

  if (effectiveScore >= 0.8) {
    return { tier: "high", value: 0.9, autoApplied: true };
  }
  if (effectiveScore >= 0.5) {
    return { tier: "medium", value: 0.7, autoApplied: true };
  }
  return { tier: "low", value: 0.5, autoApplied: false };
}

/**
 * Generate a suggested belief value based on detection reason.
 *
 * Only returns a value when confidence >= 0.7 (medium or high tier).
 */
function generateSuggestedBelief(
  detection: CEEWeightSuggestionV1T,
  confidenceValue: number
): number | undefined {
  // Only suggest specific beliefs when confidence is high enough
  if (confidenceValue < 0.7) {
    return undefined;
  }

  switch (detection.reason) {
    case "uniform_distribution":
      // For uniform distributions, suggest slight differentiation
      // based on position in the option set
      return undefined; // Can't suggest without knowing sibling options

    case "near_zero":
      // Suggest bumping up slightly or removing
      return 0.15; // Minimum meaningful probability

    case "near_one":
      // Suggest reducing to leave room for uncertainty
      return 0.85; // High but not certain

    default:
      return undefined;
  }
}

/**
 * Generate a deterministic suggestion based on detection type, graph context,
 * and grounding score.
 */
function generateSuggestion(
  detection: CEEWeightSuggestionV1T,
  graph: GraphV1,
  groundingConfidence: { tier: ConfidenceTier; value: number; autoApplied: boolean }
): GeneratedWeightSuggestion {
  // Find node labels for context-aware rationales
  const nodes = graph.nodes ?? [];
  const fromNode = nodes.find((n: any) => n.id === detection.from_node_id);
  const toNode = nodes.find((n: any) => n.id === detection.to_node_id);

  const fromLabel = (fromNode as any)?.label ?? detection.from_node_id;
  const toLabel = (toNode as any)?.label ?? detection.to_node_id;

  // Build reason-specific rationale with context
  let rationale: string;

  switch (detection.reason) {
    case "uniform_distribution":
      rationale =
        `All options from "${fromLabel}" have equal probability (${detection.current_belief.toFixed(2)}). ` +
        `Consider differentiating beliefs based on historical data, expert judgment, or domain-specific factors ` +
        `that might favor "${toLabel}" over alternatives.`;
      break;

    case "near_zero":
      rationale =
        `The edge from "${fromLabel}" to "${toLabel}" has very low probability (${detection.current_belief.toFixed(2)}). ` +
        `If this outcome is truly unlikely, consider removing it from the model. Otherwise, ` +
        `reassess the factors that could increase its likelihood.`;
      break;

    case "near_one":
      rationale =
        `The edge from "${fromLabel}" to "${toLabel}" has very high probability (${detection.current_belief.toFixed(2)}). ` +
        `Consider whether alternative outcomes should also be modeled to capture uncertainty, ` +
        `or whether this near-certainty is justified by strong evidence.`;
      break;

    default:
      rationale = "Consider reviewing this edge's belief value.";
  }

  // Generate suggested belief if confidence is high enough
  const suggestedBelief = generateSuggestedBelief(detection, groundingConfidence.value);

  return {
    ...detection,
    confidence: groundingConfidence.value,
    rationale,
    auto_applied: groundingConfidence.autoApplied,
    ...(suggestedBelief !== undefined && { suggested_belief: suggestedBelief }),
  };
}

/**
 * Generate weight suggestions for detected issues
 *
 * Uses numerical grounding score to determine confidence level:
 * - High grounding (≥0.8) → high confidence, auto-applied
 * - Medium grounding (≥0.5) → medium confidence, auto-applied
 * - Low grounding (<0.5) → low confidence, manual review required
 *
 * @param context - Graph, detected issues, grounding score, and request metadata
 * @returns Generated suggestions with rationales and confidence
 */
export async function generateWeightSuggestions(
  context: WeightSuggestionGeneratorContext
): Promise<GeneratedWeightSuggestion[]> {
  const { graph, detections, requestId, numericalGroundingScore } = context;

  // Limit to top N suggestions
  const limitedDetections = detections.slice(0, MAX_SUGGESTIONS);

  if (limitedDetections.length === 0) {
    return [];
  }

  // Map grounding score to confidence tier
  const groundingConfidence = mapGroundingToConfidence(numericalGroundingScore);

  // Check if feature is enabled (for telemetry purposes)
  let featureEnabled = false;
  try {
    featureEnabled = config.cee.weightSuggestionGenerationEnabled;
  } catch {
    // Config not available, default to disabled
  }

  log.debug(
    {
      request_id: requestId,
      detection_count: limitedDetections.length,
      feature_enabled: featureEnabled,
      grounding_score: numericalGroundingScore,
      confidence_tier: groundingConfidence.tier,
      confidence_value: groundingConfidence.value,
      auto_applied: groundingConfidence.autoApplied,
    },
    "Generating weight suggestions"
  );

  // Generate suggestions for each detection
  return limitedDetections.map((detection) =>
    generateSuggestion(detection, graph, groundingConfidence)
  );
}
