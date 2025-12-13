/**
 * CEE Preference-to-Utility Bridge
 *
 * Maps behavioural preferences (from CEE preference elicitation) to
 * mathematical utility specifications (consumed by ISL).
 *
 * ## Mapping Overview
 *
 * | CEE Preference    | ISL Utility Field      | Mapping Logic                     |
 * |-------------------|------------------------|-----------------------------------|
 * | goal_weights      | weights                | Pass through (normalised)         |
 * | risk_aversion     | utility_transform      | Linear/concave/convex shape       |
 * | loss_aversion     | asymmetric_weights     | Gain/loss multipliers (K&T style) |
 * | time_discount     | temporal_weights       | Discount rate for future outcomes |
 *
 * ## Limitations
 *
 * 1. **Risk aversion mapping is approximate**: The concave/convex transform is a
 *    simplification of expected utility theory. For full CRRA/CARA utility, ISL
 *    would need to implement the actual utility functions.
 *
 * 2. **Loss aversion requires outcome classification**: ISL must identify which
 *    outcomes are "gains" vs "losses" relative to a reference point. CEE provides
 *    the loss_aversion coefficient but not the classification.
 *
 * 3. **Time discount only applies to temporal graphs**: If the decision graph
 *    has no temporal structure (no time-varying outcomes), the discount rate
 *    is effectively unused.
 *
 * 4. **Confidence not directly mapped**: CEE's preference confidence level
 *    (low/medium/high) indicates elicitation quality but doesn't translate
 *    to a specific utility parameter. ISL may use it for uncertainty handling.
 */

import type { UserPreferencesT } from "../../schemas/cee.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Utility function shape transform based on risk attitude.
 *
 * - Linear: Risk-neutral (risk_aversion ≈ 0.5)
 * - Concave: Risk-averse (risk_aversion > 0.7) - diminishing marginal utility
 * - Convex: Risk-seeking (risk_aversion < 0.3) - increasing marginal utility
 */
export type UtilityTransform =
  | { type: "linear" }
  | { type: "concave"; coefficient: number }
  | { type: "convex"; coefficient: number };

/**
 * Asymmetric weighting for gains vs losses (Kahneman-Tversky style).
 *
 * In prospect theory, losses are typically felt 2-3x more strongly than
 * equivalent gains. This captures that asymmetry.
 */
export interface AsymmetricWeights {
  /** Multiplier for positive outcomes (typically 1.0) */
  gain_multiplier: number;
  /** Multiplier for negative outcomes (typically 2-3x gains) */
  loss_multiplier: number;
}

/**
 * Context about the decision graph for utility mapping.
 */
export interface GraphContext {
  /** IDs of goal nodes in the graph */
  goal_nodes: string[];
  /** Whether the graph has temporal structure */
  has_temporal_structure?: boolean;
  /** Reference point for gain/loss classification (default: 0) */
  reference_point?: number;
}

/**
 * Extended utility specification that ISL can consume.
 *
 * This extends the basic UtilitySpecification with preference-derived
 * parameters. ISL implementations can ignore fields they don't support.
 */
export interface ExtendedUtilitySpecification {
  // === Core fields (required) ===

  /** Primary goal node to optimise */
  goal_node_id: string;

  /** Whether to maximise (true) or minimise (false) the goal */
  maximize: boolean;

  // === Extended fields (optional) ===

  /** Additional goal nodes for multi-objective optimisation */
  additional_goals?: string[];

  /** Weights for each goal (goal_id -> normalised weight) */
  weights?: Record<string, number>;

  /** Utility function shape based on risk attitude */
  utility_transform?: UtilityTransform;

  /** Loss aversion coefficient for asymmetric outcome weighting */
  loss_aversion?: number;

  /** Time discount rate for future outcomes (0 = patient, 1 = impatient) */
  time_discount?: number;

  /** Reference point for gain/loss classification */
  reference_point?: number;

  /** Preference elicitation confidence (for uncertainty handling) */
  preference_confidence?: "low" | "medium" | "high";
}

/**
 * Result of mapping preferences to utility specification.
 */
export interface UtilityBridgeResult {
  /** The extended utility specification for ISL */
  specification: ExtendedUtilitySpecification;

  /** Human-readable description of the utility model */
  description: string;

  /** Warnings about mapping limitations */
  warnings: string[];
}

// ============================================================================
// Threshold Constants
// ============================================================================

const THRESHOLDS = {
  /** Below this, user is considered risk-seeking (convex utility) */
  RISK_SEEKING: 0.3,
  /** Above this, user is considered risk-averse (concave utility) */
  RISK_AVERSE: 0.7,
  /** Minimum loss aversion for meaningful asymmetric weighting */
  LOSS_AVERSION_MIN: 1.1,
} as const;

// ============================================================================
// Task 2: Risk Aversion → Utility Transform
// ============================================================================

/**
 * Derive utility function shape from risk aversion coefficient.
 *
 * Maps the 0-1 risk_aversion scale to utility function concavity:
 * - Risk-seeking (< 0.3): Convex utility (prefers gambles)
 * - Risk-neutral (0.3-0.7): Linear utility (expected value)
 * - Risk-averse (> 0.7): Concave utility (prefers certainty)
 *
 * The coefficient indicates the degree of curvature.
 */
export function deriveUtilityTransform(risk_aversion: number): UtilityTransform {
  // Clamp to valid range
  const clamped = Math.max(0, Math.min(1, risk_aversion));

  if (clamped < THRESHOLDS.RISK_SEEKING) {
    // Risk-seeking: convex utility
    // Coefficient increases as risk_aversion approaches 0
    return {
      type: "convex",
      coefficient: 1 - clamped, // 0.7 to 1.0 range
    };
  }

  if (clamped > THRESHOLDS.RISK_AVERSE) {
    // Risk-averse: concave utility
    // Coefficient increases as risk_aversion approaches 1
    return {
      type: "concave",
      coefficient: clamped, // 0.7 to 1.0 range
    };
  }

  // Risk-neutral: linear utility
  return { type: "linear" };
}

// ============================================================================
// Task 3: Loss Aversion → Asymmetric Weighting
// ============================================================================

/**
 * Derive asymmetric gain/loss weights from loss aversion coefficient.
 *
 * Based on Kahneman & Tversky's prospect theory:
 * - Gains are weighted at 1.0 (baseline)
 * - Losses are weighted at loss_aversion (typically 2-3x)
 *
 * A loss_aversion of 2.0 means a £100 loss feels as bad as a £200 gain feels good.
 */
export function deriveLossWeights(loss_aversion: number): AsymmetricWeights {
  // Clamp to valid range (1.0 = neutral, up to 3.0 = high loss aversion)
  const clamped = Math.max(1.0, Math.min(3.0, loss_aversion));

  return {
    gain_multiplier: 1.0,
    loss_multiplier: clamped,
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Normalise goal weights to sum to 1.0.
 */
function normaliseGoalWeights(
  weights: Record<string, number>,
  goalNodes: string[]
): Record<string, number> {
  const entries = Object.entries(weights);

  if (entries.length === 0) {
    // No weights provided - use equal weights for all goals
    if (goalNodes.length === 0) return {};
    const equalWeight = 1 / goalNodes.length;
    return Object.fromEntries(goalNodes.map((id) => [id, equalWeight]));
  }

  const total = entries.reduce((sum, [, w]) => sum + Math.max(0, w), 0);

  if (total === 0) {
    // All weights are zero - use equal weights
    const equalWeight = 1 / entries.length;
    return Object.fromEntries(entries.map(([k]) => [k, equalWeight]));
  }

  return Object.fromEntries(entries.map(([k, w]) => [k, Math.max(0, w) / total]));
}

/**
 * Generate human-readable description of utility specification.
 */
function describeUtilitySpec(spec: ExtendedUtilitySpecification): string {
  const parts: string[] = [];

  // Describe utility transform
  if (spec.utility_transform) {
    switch (spec.utility_transform.type) {
      case "linear":
        parts.push("risk-neutral expected value optimisation");
        break;
      case "concave":
        parts.push(
          `risk-averse utility (concavity: ${spec.utility_transform.coefficient.toFixed(2)})`
        );
        break;
      case "convex":
        parts.push(
          `risk-seeking utility (convexity: ${spec.utility_transform.coefficient.toFixed(2)})`
        );
        break;
    }
  }

  // Describe loss aversion
  if (spec.loss_aversion && spec.loss_aversion > THRESHOLDS.LOSS_AVERSION_MIN) {
    parts.push(`loss aversion ${spec.loss_aversion.toFixed(1)}x`);
  }

  // Describe time preference
  if (spec.time_discount !== undefined) {
    if (spec.time_discount > 0.15) {
      parts.push("strong preference for near-term outcomes");
    } else if (spec.time_discount < 0.05) {
      parts.push("patient, long-term focus");
    } else {
      parts.push(`${(spec.time_discount * 100).toFixed(0)}% time discount`);
    }
  }

  // Describe goals
  const goalCount = 1 + (spec.additional_goals?.length ?? 0);
  if (goalCount > 1) {
    parts.push(`${goalCount} weighted goals`);
  }

  return parts.length > 0 ? parts.join(", ") : "default utility specification";
}

/**
 * Generate warnings about mapping limitations.
 */
function generateWarnings(
  preferences: UserPreferencesT,
  context: GraphContext
): string[] {
  const warnings: string[] = [];

  // Low confidence warning
  if (preferences.confidence === "low") {
    warnings.push(
      "Preference confidence is low. Utility parameters are based on limited elicitation data."
    );
  }

  // Time discount without temporal structure
  if (
    preferences.time_discount > 0.05 &&
    context.has_temporal_structure === false
  ) {
    warnings.push(
      "Time discount specified but graph has no temporal structure. Discount rate will be unused."
    );
  }

  // Loss aversion without reference point
  if (
    preferences.loss_aversion > THRESHOLDS.LOSS_AVERSION_MIN &&
    context.reference_point === undefined
  ) {
    warnings.push(
      "Loss aversion active but no reference point provided. ISL must classify outcomes as gains/losses."
    );
  }

  // Multiple goals without weights
  if (
    context.goal_nodes.length > 1 &&
    Object.keys(preferences.goal_weights).length === 0
  ) {
    warnings.push(
      "Multiple goals detected but no weights provided. Using equal weights."
    );
  }

  return warnings;
}

// ============================================================================
// Task 5: Main Adapter Function
// ============================================================================

/**
 * Map CEE user preferences to ISL utility specification.
 *
 * This is the main entry point for the preference-to-utility bridge.
 *
 * @param preferences - User preferences from CEE elicitation
 * @param context - Graph context (goals, temporal structure, etc.)
 * @returns Extended utility specification with description and warnings
 *
 * @example
 * ```typescript
 * const result = mapPreferencesToUtility(
 *   { risk_aversion: 0.8, loss_aversion: 2.5, goal_weights: { revenue: 0.7, cost: 0.3 }, ... },
 *   { goal_nodes: ['revenue', 'cost'] }
 * );
 * // result.specification can be passed to ISL
 * ```
 */
export function mapPreferencesToUtility(
  preferences: UserPreferencesT,
  context: GraphContext
): UtilityBridgeResult {
  // Validate inputs
  if (context.goal_nodes.length === 0) {
    throw new Error("GraphContext must have at least one goal_node");
  }

  // Build the extended utility specification
  const specification: ExtendedUtilitySpecification = {
    // Core fields
    goal_node_id: context.goal_nodes[0],
    maximize: true, // Default to maximisation

    // Additional goals (if any)
    ...(context.goal_nodes.length > 1 && {
      additional_goals: context.goal_nodes.slice(1),
    }),

    // Goal weights (normalised)
    weights: normaliseGoalWeights(preferences.goal_weights, context.goal_nodes),

    // Risk → utility transform
    utility_transform: deriveUtilityTransform(preferences.risk_aversion),

    // Loss aversion (only include if meaningful)
    ...(preferences.loss_aversion > THRESHOLDS.LOSS_AVERSION_MIN && {
      loss_aversion: preferences.loss_aversion,
    }),

    // Time discount
    time_discount: preferences.time_discount,

    // Reference point (if provided)
    ...(context.reference_point !== undefined && {
      reference_point: context.reference_point,
    }),

    // Preference confidence
    preference_confidence: preferences.confidence,
  };

  return {
    specification,
    description: describeUtilitySpec(specification),
    warnings: generateWarnings(preferences, context),
  };
}

// ============================================================================
// Task 6: Availability Flag
// ============================================================================

/**
 * Check if the preference-to-utility adapter is available.
 *
 * This returns true now that the adapter is implemented.
 * ISL integrations can check this before attempting to use mapped preferences.
 */
export function isPreferenceAdapterAvailable(): boolean {
  return true;
}

// ============================================================================
// Convenience Exports
// ============================================================================

/**
 * Create a default utility specification when no preferences are available.
 */
export function createDefaultUtilitySpec(
  context: GraphContext
): ExtendedUtilitySpecification {
  if (context.goal_nodes.length === 0) {
    throw new Error("GraphContext must have at least one goal_node");
  }

  const equalWeight = 1 / context.goal_nodes.length;

  return {
    goal_node_id: context.goal_nodes[0],
    maximize: true,
    ...(context.goal_nodes.length > 1 && {
      additional_goals: context.goal_nodes.slice(1),
    }),
    weights: Object.fromEntries(
      context.goal_nodes.map((id) => [id, equalWeight])
    ),
    utility_transform: { type: "linear" },
    time_discount: 0.1,
    preference_confidence: "low",
  };
}

/**
 * Apply asymmetric weighting to an outcome value.
 *
 * Utility function for ISL implementations that support loss aversion.
 *
 * @param value - The outcome value
 * @param referencePoint - The reference point for gains/losses
 * @param lossAversion - The loss aversion coefficient
 * @returns The asymmetrically weighted value
 */
export function applyLossAversion(
  value: number,
  referencePoint: number,
  lossAversion: number
): number {
  const delta = value - referencePoint;

  if (delta >= 0) {
    // Gain: use as-is
    return delta;
  } else {
    // Loss: multiply by loss aversion coefficient
    return delta * lossAversion;
  }
}

/**
 * Apply utility transform to normalised value.
 *
 * Transforms a [0,1] normalised value according to the utility function shape.
 *
 * @param normalisedValue - Value in [0,1] range
 * @param transform - The utility transform to apply
 * @returns Transformed utility value
 */
export function applyUtilityTransform(
  normalisedValue: number,
  transform: UtilityTransform
): number {
  const clamped = Math.max(0, Math.min(1, normalisedValue));

  switch (transform.type) {
    case "linear":
      return clamped;

    case "concave":
      // Concave: sqrt-like shape (diminishing marginal utility)
      // U(x) = x^(1/c) where c > 1 for concavity
      return Math.pow(clamped, 1 / (1 + transform.coefficient * 0.5));

    case "convex":
      // Convex: square-like shape (increasing marginal utility)
      // U(x) = x^c where c > 1 for convexity
      return Math.pow(clamped, 1 + transform.coefficient * 0.5);
  }
}
