/**
 * Key Insight Generator
 *
 * Generates clean, human-readable prose summaries from decision analysis results.
 * Uses template-based generation (no LLM) for fast, deterministic output.
 *
 * The Key Insight synthesizes ranked actions and drivers from PLoT inference
 * into a concise recommendation suitable for UI display.
 */

import type { GraphV1 } from "../../contracts/plot/engine.js";
import {
  sanitiseLabel,
  labelForSentence,
  labelForComparison,
} from "../../utils/label-sanitiser.js";

// ============================================================================
// Types
// ============================================================================

/**
 * A ranked action from PLoT inference.
 * Represents an option with its computed expected utility.
 */
export interface RankedAction {
  /** Node ID of the option */
  node_id: string;
  /** Label of the option (may contain question marks) */
  label: string;
  /** Expected utility score (higher = better) */
  expected_utility: number;
  /** Optional: whether this option is dominant (clearly best) */
  dominant?: boolean;
}

/**
 * A driver from PLoT inference.
 * Represents a factor that influences the decision outcome.
 */
export interface Driver {
  /** Node ID of the driver node */
  node_id: string;
  /** Label of the driver */
  label: string;
  /** Impact percentage (0-100) */
  impact_pct?: number;
  /** Direction of influence */
  direction?: "positive" | "negative" | "neutral";
  /** Node kind - helps distinguish factor (external) from action (controllable) */
  kind?: string;
}

/**
 * Input for key insight generation.
 */
export interface KeyInsightInput {
  /** The decision graph */
  graph: GraphV1;
  /** Ranked actions from PLoT inference (required) */
  ranked_actions: RankedAction[];
  /** Top drivers from PLoT inference (optional) */
  top_drivers?: Driver[];
}

/**
 * Generated key insight output.
 */
export interface KeyInsightOutput {
  /** Main recommendation headline */
  headline: string;
  /** Primary driver explanation */
  primary_driver: string;
  /** Confidence statement */
  confidence_statement: string;
  /** Caveat if recommendation is close (optional) */
  caveat?: string;
}

// ============================================================================
// Constants
// ============================================================================

const MARGIN_THRESHOLDS = {
  /** Margin above which winner is clearly better */
  CLEAR: 0.20,
  /** Margin above which winner is significantly better */
  SIGNIFICANT: 0.10,
  /** Margin below which it's a close call */
  CLOSE: 0.05,
};

const CONFIDENCE_THRESHOLDS = {
  /** Utility above which confidence is high */
  HIGH: 0.7,
  /** Utility above which confidence is medium */
  MEDIUM: 0.4,
};

// ============================================================================
// Core Generation Functions
// ============================================================================

/**
 * Generates a key insight from ranked actions and drivers.
 *
 * @param input - Graph, ranked actions, and optional drivers from PLoT
 * @returns Key insight with headline, driver explanation, and confidence
 */
export function generateKeyInsight(input: KeyInsightInput): KeyInsightOutput {
  const { ranked_actions, top_drivers } = input;

  // Validate input
  if (!ranked_actions || ranked_actions.length === 0) {
    return generateNoDataInsight();
  }

  // Sort by expected utility (descending)
  const sorted = [...ranked_actions].sort(
    (a, b) => b.expected_utility - a.expected_utility
  );

  const winner = sorted[0];
  const runnerUp = sorted.length > 1 ? sorted[1] : null;

  // Calculate margin
  const margin = runnerUp
    ? winner.expected_utility - runnerUp.expected_utility
    : 1.0; // If only one option, it wins by default

  // Generate components
  const headline = generateHeadline(winner, runnerUp, margin);
  const primary_driver = generateDriverStatement(top_drivers);
  const confidence_statement = generateConfidenceStatement(winner.expected_utility, margin);
  const caveat = margin < MARGIN_THRESHOLDS.CLOSE ? generateCaveat(winner, runnerUp, margin) : undefined;

  return {
    headline,
    primary_driver,
    confidence_statement,
    caveat,
  };
}

/**
 * Generates the main headline based on winner and margin.
 */
function generateHeadline(
  winner: RankedAction,
  runnerUp: RankedAction | null,
  margin: number
): string {
  const winnerLabel = labelForSentence(winner.label, "subject");

  // Dominant option (explicitly marked or very high margin)
  if (winner.dominant || margin >= MARGIN_THRESHOLDS.CLEAR) {
    return `${winnerLabel} is the clear best choice`;
  }

  // Significant margin
  if (margin >= MARGIN_THRESHOLDS.SIGNIFICANT) {
    return `${winnerLabel} is the stronger option`;
  }

  // Close call
  if (runnerUp && margin < MARGIN_THRESHOLDS.CLOSE) {
    const runnerUpLabel = labelForComparison(runnerUp.label);
    return `${winnerLabel} edges ahead of ${runnerUpLabel}`;
  }

  // Default moderate advantage
  return `${winnerLabel} appears to be the better choice`;
}

/**
 * Generates the primary driver explanation.
 */
function generateDriverStatement(drivers?: Driver[]): string {
  if (!drivers || drivers.length === 0) {
    return "Further analysis may reveal the key factors influencing this decision.";
  }

  const topDriver = drivers[0];
  const driverLabel = sanitiseLabel(topDriver.label);
  const isExternalFactor = topDriver.kind === "factor";
  const isControllableAction = topDriver.kind === "action";

  if (topDriver.impact_pct !== undefined && topDriver.impact_pct > 0) {
    const impact = Math.round(topDriver.impact_pct);

    // Handle external factors differently - highlight they're outside user control
    if (isExternalFactor) {
      if (impact >= 50) {
        return `External factors like ${driverLabel} significantly influence your outcome (${impact}% impact). Consider how sensitive your decision is to changes in ${driverLabel}.`;
      }
      return `${capitalise(driverLabel)} (external factor) accounts for ${impact}% of the outcome—outside your direct control.`;
    }

    // Handle controllable actions - emphasize user agency
    if (isControllableAction) {
      if (impact >= 50) {
        return `Taking action on ${driverLabel} would most improve your outcome (${impact}% impact).`;
      }
      return `${capitalise(driverLabel)} is within your control and has ${impact}% impact on the outcome.`;
    }

    // Default for other node kinds
    if (impact >= 50) {
      return `${capitalise(driverLabel)} is the dominant factor, accounting for ${impact}% of the outcome.`;
    }

    if (impact >= 25) {
      return `${capitalise(driverLabel)} is the primary differentiator (${impact}% impact).`;
    }

    return `${capitalise(driverLabel)} is the leading factor among several contributors.`;
  }

  // No impact percentage available - use kind-specific messaging
  if (isExternalFactor) {
    return `External factor ${driverLabel} significantly influences this decision—consider its uncertainty.`;
  }

  if (isControllableAction) {
    return `Taking action on ${driverLabel} could improve your outcome.`;
  }

  if (topDriver.direction === "positive") {
    return `${capitalise(driverLabel)} is the main factor favouring this recommendation.`;
  }

  if (topDriver.direction === "negative") {
    return `${capitalise(driverLabel)} is the key risk being mitigated.`;
  }

  return `${capitalise(driverLabel)} is the primary factor in this decision.`;
}

/**
 * Generates the confidence statement based on utility and margin.
 */
function generateConfidenceStatement(utility: number, margin: number): string {
  // High confidence: high utility AND clear margin
  if (utility >= CONFIDENCE_THRESHOLDS.HIGH && margin >= MARGIN_THRESHOLDS.SIGNIFICANT) {
    return "This recommendation has high confidence based on the analysis.";
  }

  // High utility but close race
  if (utility >= CONFIDENCE_THRESHOLDS.HIGH && margin < MARGIN_THRESHOLDS.CLOSE) {
    return "While confident in the top option, the alternatives are close.";
  }

  // Medium confidence
  if (utility >= CONFIDENCE_THRESHOLDS.MEDIUM) {
    return "This recommendation has moderate confidence and merits review.";
  }

  // Low confidence
  return "This recommendation has lower confidence; consider gathering more evidence.";
}

/**
 * Generates a caveat for close decisions.
 */
function generateCaveat(
  winner: RankedAction,
  runnerUp: RankedAction | null,
  margin: number
): string | undefined {
  if (!runnerUp || margin >= MARGIN_THRESHOLDS.CLOSE) {
    return undefined;
  }

  const marginPct = Math.round(margin * 100);
  const runnerUpLabel = labelForComparison(runnerUp.label);

  if (marginPct <= 2) {
    return `The difference is marginal (${marginPct}%); ${runnerUpLabel} is essentially equivalent.`;
  }

  if (marginPct <= 5) {
    return `Consider that ${runnerUpLabel} is a close second—sensitivity analysis recommended.`;
  }

  return `${capitalise(runnerUpLabel)} remains a viable alternative.`;
}

/**
 * Generates insight when no ranked actions are provided.
 */
function generateNoDataInsight(): KeyInsightOutput {
  return {
    headline: "Unable to generate recommendation",
    primary_driver: "No ranked actions were provided for analysis.",
    confidence_statement: "Run inference on the graph to generate a recommendation.",
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Capitalises the first letter of a string.
 */
function capitalise(str: string): string {
  if (!str) return "";
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Validates that the input has the required structure.
 */
export function validateKeyInsightInput(input: unknown): input is KeyInsightInput {
  if (!input || typeof input !== "object") {
    return false;
  }

  const obj = input as Record<string, unknown>;

  // Must have graph
  if (!obj.graph || typeof obj.graph !== "object") {
    return false;
  }

  // Must have ranked_actions array
  if (!Array.isArray(obj.ranked_actions)) {
    return false;
  }

  // Each ranked action must have required fields
  for (const action of obj.ranked_actions) {
    if (!action || typeof action !== "object") {
      return false;
    }
    const a = action as Record<string, unknown>;
    if (typeof a.node_id !== "string" || typeof a.label !== "string") {
      return false;
    }
    if (typeof a.expected_utility !== "number") {
      return false;
    }
  }

  // top_drivers is optional but must be array if present
  if (obj.top_drivers !== undefined && !Array.isArray(obj.top_drivers)) {
    return false;
  }

  return true;
}
