/**
 * Key Insight Generator
 *
 * Generates clean, human-readable prose summaries from decision analysis results.
 * Uses template-based generation (no LLM) for fast, deterministic output.
 *
 * The Key Insight synthesizes ranked actions and drivers from PLoT inference
 * into a concise recommendation suitable for UI display.
 *
 * Goal-Anchored Headlines:
 * When goal_text is provided, headlines reference the user's stated goal
 * to create more compelling, contextual recommendations.
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
  /** Optional: quality of expected outcome - used to avoid contradictory messaging */
  outcome_quality?: "positive" | "neutral" | "negative" | "mixed";
  /** Optional: primary outcome label for context */
  primary_outcome?: string;
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
 * Goal information for multi-goal scenarios.
 */
export interface GoalInfo {
  id: string;
  text: string;
  type: "binary" | "continuous" | "compound";
  is_primary: boolean;
}

/**
 * Identifiability status from ISL causal analysis.
 */
export interface Identifiability {
  /** Whether causal effects are identifiable from the model structure */
  identifiable: boolean;
  /** Method used for identification (e.g., "backdoor", "frontdoor") */
  method?: string | null;
  /** Variables in the adjustment set for causal identification */
  adjustment_set?: string[] | null;
  /** Human-readable explanation of identifiability status */
  explanation?: string | null;
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
  /** Goal text for anchored headlines (optional) */
  goal_text?: string | null;
  /** Goal type classification (optional) */
  goal_type?: "binary" | "continuous" | "compound" | null;
  /** Goal node ID (optional) */
  goal_id?: string | null;
  /** Multiple goals for compound decisions (optional) */
  goals?: GoalInfo[];
  /** Primary goal ID for multi-goal scenarios (optional) */
  primary_goal_id?: string;
  /** Identifiability from ISL - if not provided, assumes identifiable */
  identifiability?: Identifiability;
}

/**
 * Structured headline data for flexible UI rendering.
 */
export interface HeadlineStructured {
  /** Goal text (null if no goal provided) */
  goal_text: string | null;
  /** The recommended action label */
  action: string;
  /** Outcome type classification */
  outcome_type: "positive" | "negative" | "neutral";
  /** Likelihood of success (0-1) */
  likelihood: number;
  /** Delta vs baseline option (null if no baseline) */
  vs_baseline: number | null;
  /** Direction compared to baseline */
  vs_baseline_direction: "better" | "worse" | "same" | null;
  /** Confidence in the ranking */
  ranking_confidence: "low" | "medium" | "high";
  /** Whether this is a close race between options */
  is_close_race: boolean;
}

/**
 * Generated key insight output.
 */
export interface KeyInsightOutput {
  /** Main recommendation headline */
  headline: string;
  /** Structured headline data for UI flexibility */
  headline_structured?: HeadlineStructured;
  /** Primary driver explanation */
  primary_driver: string;
  /** Confidence statement */
  confidence_statement: string;
  /** Caveat if recommendation is close (optional) */
  caveat?: string;
  /** Evidence points supporting the recommendation */
  evidence?: string[];
  /** Suggested next steps */
  next_steps?: string[];
  /** Recommendation status based on identifiability */
  recommendation_status?: "actionable" | "exploratory";
  /** Note about identifiability for transparency */
  identifiability_note?: string;
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

/** Maximum goal text length before truncation */
const MAX_GOAL_LENGTH = 80;

/**
 * Patterns that indicate a baseline/status quo option.
 * These should NEVER be described as "having negative impact".
 */
const BASELINE_PATTERNS = [
  /^(do\s+)?nothing$/i,
  /^no\s+action$/i,
  /^status\s+quo$/i,
  /^keep\s+(current|existing)/i,
  /^maintain\s+(current|existing)/i,
  /^stay\s+(the\s+)?(course|same)/i,
  /^current\s+(state|approach|strategy)/i,
  /^don't\s+change/i,
  /^wait(\s+and\s+see)?$/i,
  /^defer\s+decision/i,
  /^hold\s+(off|steady)/i,
];

// ============================================================================
// Baseline Detection Helpers
// ============================================================================

/**
 * Check if a label represents a baseline/status quo option.
 */
function isBaselineLabel(label: string): boolean {
  const normalised = label.trim().toLowerCase();
  return BASELINE_PATTERNS.some((pattern) => pattern.test(normalised));
}

/**
 * Reframe a baseline option label for neutral phrasing.
 * "Do nothing" → "maintaining current state"
 * "Status quo" → "the current approach"
 */
function reframeBaselineLabel(label: string): string {
  const lower = label.toLowerCase().trim();

  if (/^(do\s+)?nothing$/i.test(lower)) {
    return "maintaining current state";
  }
  if (/^no\s+action$/i.test(lower)) {
    return "deferring action";
  }
  if (/^status\s+quo$/i.test(lower)) {
    return "the current approach";
  }
  if (/^wait(\s+and\s+see)?$/i.test(lower)) {
    return "waiting for more information";
  }
  if (/^keep\s+(current|existing)/i.test(lower)) {
    return "preserving the current approach";
  }
  if (/^maintain\s+(current|existing)/i.test(lower)) {
    return "continuing current operations";
  }

  // Return sanitised original if no specific reframe
  return sanitiseLabel(label);
}

// ============================================================================
// Goal Text Processing
// ============================================================================

/**
 * Truncate goal text intelligently if too long.
 * Tries to break at word boundaries.
 */
function truncateGoalText(goalText: string, maxLength: number = MAX_GOAL_LENGTH): string {
  if (goalText.length <= maxLength) {
    return goalText;
  }

  // Find last space before maxLength
  const truncated = goalText.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(" ");

  if (lastSpace > maxLength * 0.6) {
    return truncated.slice(0, lastSpace) + "…";
  }

  return truncated + "…";
}

/**
 * Format goal text for use in headlines.
 * - Removes leading "Goal:" or "Objective:" prefixes
 * - Lowercases first letter for sentence flow
 * - Truncates if too long
 */
function formatGoalForHeadline(goalText: string): string {
  let cleaned = goalText
    .trim()
    .replace(/\?$/, "")
    .replace(/^(goal:|objective:)\s*/i, "")
    .trim();

  // Truncate if needed
  cleaned = truncateGoalText(cleaned);

  // Lowercase first letter for sentence flow
  return cleaned.charAt(0).toLowerCase() + cleaned.slice(1);
}

/**
 * Get the primary goal from multi-goal input.
 */
function getPrimaryGoal(input: KeyInsightInput): { text: string; type: "binary" | "continuous" | "compound" } | null {
  // Direct goal_text takes precedence
  if (input.goal_text) {
    return {
      text: input.goal_text,
      type: input.goal_type || "continuous",
    };
  }

  // Check multi-goal array
  if (input.goals && input.goals.length > 0) {
    // Find primary goal
    const primaryGoal = input.primary_goal_id
      ? input.goals.find((g) => g.id === input.primary_goal_id)
      : input.goals.find((g) => g.is_primary);

    if (primaryGoal) {
      return { text: primaryGoal.text, type: primaryGoal.type };
    }

    // Fall back to first goal
    return { text: input.goals[0].text, type: input.goals[0].type };
  }

  return null;
}

/**
 * Get secondary goals for compound decisions.
 */
function getSecondaryGoals(input: KeyInsightInput): GoalInfo[] {
  if (!input.goals || input.goals.length <= 1) {
    return [];
  }

  const primaryId = input.primary_goal_id || input.goals.find((g) => g.is_primary)?.id || input.goals[0].id;
  return input.goals.filter((g) => g.id !== primaryId);
}

// ============================================================================
// Confidence Calculation
// ============================================================================

/**
 * Calculate ranking confidence based on utility and margin.
 */
function calculateRankingConfidence(utility: number, margin: number): "low" | "medium" | "high" {
  if (utility >= CONFIDENCE_THRESHOLDS.HIGH && margin >= MARGIN_THRESHOLDS.SIGNIFICANT) {
    return "high";
  }
  if (utility >= CONFIDENCE_THRESHOLDS.MEDIUM && margin >= MARGIN_THRESHOLDS.CLOSE) {
    return "medium";
  }
  return "low";
}

// ============================================================================
// Outcome Type Classification
// ============================================================================

/**
 * Determine outcome type from ranked action.
 */
function getOutcomeType(winner: RankedAction): "positive" | "negative" | "neutral" {
  if (winner.outcome_quality === "negative") {
    return "negative";
  }
  if (winner.outcome_quality === "positive") {
    return "positive";
  }
  // Mixed and neutral both map to neutral for headline purposes
  return "neutral";
}

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
  const { ranked_actions, top_drivers, identifiability } = input;

  // Validate input
  if (!ranked_actions || ranked_actions.length === 0) {
    return generateNoDataInsight();
  }

  // Determine identifiability - default to true (identifiable) if not provided
  const isIdentifiable = identifiability?.identifiable ?? true;

  // Sort by expected utility (descending)
  const sorted = [...ranked_actions].sort(
    (a, b) => b.expected_utility - a.expected_utility
  );

  const winner = sorted[0];
  const runnerUp = sorted.length > 1 ? sorted[1] : null;

  // Find baseline option if present
  const baselineAction = sorted.find((a) => isBaselineLabel(a.label));

  // Calculate margin
  const margin = runnerUp
    ? winner.expected_utility - runnerUp.expected_utility
    : 1.0; // If only one option, it wins by default

  // Calculate vs baseline delta
  const vsBaseline = baselineAction && baselineAction !== winner
    ? winner.expected_utility - baselineAction.expected_utility
    : null;

  // Get goal info
  const goal = getPrimaryGoal(input);
  const secondaryGoals = getSecondaryGoals(input);

  // Determine outcome type
  const outcomeType = getOutcomeType(winner);

  // Check if all options have negative outcomes
  const allNegative = sorted.every((a) => a.outcome_quality === "negative");

  // Is this a close race?
  const isCloseRace = margin < MARGIN_THRESHOLDS.CLOSE;

  // Calculate ranking confidence
  const rankingConfidence = calculateRankingConfidence(winner.expected_utility, margin);

  // Check if winner is baseline
  const winnerIsBaseline = isBaselineLabel(winner.label);

  // Build winner label for use in headlines
  const winnerLabel = winnerIsBaseline
    ? capitalise(reframeBaselineLabel(winner.label))
    : labelForSentence(winner.label, "subject");

  // Generate headline based on identifiability and context
  let headline: string;
  if (isIdentifiable) {
    // Identifiable: use confident causal language
    headline = generateGoalAnchoredHeadline({
      winner,
      runnerUp,
      margin,
      goal,
      secondaryGoals,
      outcomeType,
      allNegative,
      isCloseRace,
      winnerIsBaseline,
    });
  } else {
    // Non-identifiable: use exploratory language
    headline = generateNonIdentifiableHeadline({
      winnerLabel,
      goal,
      isCloseRace,
      runnerUp,
    });
  }

  // Build structured headline data
  const headline_structured: HeadlineStructured = {
    goal_text: goal?.text ?? null,
    action: winnerLabel,
    outcome_type: outcomeType,
    likelihood: winner.expected_utility,
    vs_baseline: vsBaseline,
    vs_baseline_direction: vsBaseline === null
      ? null
      : vsBaseline > 0.01
        ? "better"
        : vsBaseline < -0.01
          ? "worse"
          : "same",
    ranking_confidence: rankingConfidence,
    is_close_race: isCloseRace,
  };

  // Generate other components
  const primary_driver = generateDriverStatement(top_drivers);
  const confidence_statement = isIdentifiable
    ? generateConfidenceStatement(winner.expected_utility, margin)
    : generateNonIdentifiableConfidenceStatement(margin);
  const caveat = isCloseRace ? generateCaveat(winner, runnerUp, margin) : undefined;

  // Generate evidence and next steps (adjusted for identifiability)
  const evidence = generateEvidence(winner, top_drivers, goal, isIdentifiable, identifiability);
  const next_steps = generateNextSteps(winner, outcomeType, isCloseRace, goal, isIdentifiable);

  // Generate recommendation status and identifiability note
  const recommendation_status: "actionable" | "exploratory" = isIdentifiable ? "actionable" : "exploratory";
  const identifiability_note = generateIdentifiabilityNote(isIdentifiable, identifiability);

  return {
    headline,
    headline_structured,
    primary_driver,
    confidence_statement,
    caveat,
    evidence,
    next_steps,
    recommendation_status,
    identifiability_note,
  };
}

// ============================================================================
// Goal-Anchored Headline Generation
// ============================================================================

interface HeadlineContext {
  winner: RankedAction;
  runnerUp: RankedAction | null;
  margin: number;
  goal: { text: string; type: "binary" | "continuous" | "compound" } | null;
  secondaryGoals: GoalInfo[];
  outcomeType: "positive" | "negative" | "neutral";
  allNegative: boolean;
  isCloseRace: boolean;
  winnerIsBaseline: boolean;
}

/**
 * Generates a goal-anchored headline based on context.
 */
function generateGoalAnchoredHeadline(ctx: HeadlineContext): string {
  const {
    winner,
    runnerUp,
    margin,
    goal,
    secondaryGoals,
    outcomeType,
    allNegative,
    isCloseRace,
    winnerIsBaseline,
  } = ctx;

  // Get winner label
  const winnerLabel = winnerIsBaseline
    ? capitalise(reframeBaselineLabel(winner.label))
    : labelForSentence(winner.label, "subject");

  // Format likelihood as percentage
  const likelihoodPct = Math.round(winner.expected_utility * 100);

  // No goal provided - fall back to generic headlines
  if (!goal) {
    return generateGenericHeadline(winner, runnerUp, margin, winnerLabel, winnerIsBaseline);
  }

  const goalText = formatGoalForHeadline(goal.text);

  // Handle edge cases first

  // Case: All options have negative outcomes
  if (allNegative) {
    return `All options carry risk to ${goalText} — ${winnerLabel} minimises potential downside`;
  }

  // Case: Baseline is best
  if (winnerIsBaseline) {
    return `${winnerLabel} remains your safest path to ${goalText}`;
  }

  // Case: Close race
  if (isCloseRace && runnerUp) {
    const runnerUpLabel = labelForComparison(runnerUp.label);
    return `Both ${winnerLabel} and ${runnerUpLabel} have similar paths to ${goalText} — consider other factors`;
  }

  // Case: Compound goal with trade-offs
  if (goal.type === "compound" && secondaryGoals.length > 0) {
    const secondaryText = truncateGoalText(secondaryGoals[0].text, 40);
    return `${winnerLabel} best balances ${goalText} and ${secondaryText}`;
  }

  // Standard goal-anchored headlines based on goal type and outcome
  if (goal.type === "binary") {
    return generateBinaryGoalHeadline(winnerLabel, goalText, outcomeType, likelihoodPct, margin);
  }

  // Continuous or default
  return generateContinuousGoalHeadline(winnerLabel, goalText, outcomeType, likelihoodPct, margin);
}

/**
 * Generate headline for binary (yes/no) goals.
 */
function generateBinaryGoalHeadline(
  winnerLabel: string,
  goalText: string,
  outcomeType: "positive" | "negative" | "neutral",
  likelihoodPct: number,
  margin: number
): string {
  if (outcomeType === "negative") {
    return `${winnerLabel} gives you the best chance of ${goalText}`;
  }

  if (outcomeType === "positive" && margin >= MARGIN_THRESHOLDS.CLEAR) {
    return `To ${goalText}, proceed with ${winnerLabel} — ${likelihoodPct}% likelihood of success`;
  }

  // Neutral or moderate margin
  return `${winnerLabel} gives you the best chance of ${goalText}`;
}

/**
 * Generate headline for continuous/optimization goals.
 */
function generateContinuousGoalHeadline(
  winnerLabel: string,
  goalText: string,
  outcomeType: "positive" | "negative" | "neutral",
  likelihoodPct: number,
  margin: number
): string {
  if (outcomeType === "negative") {
    return `${winnerLabel} minimises risk to achieving ${goalText}`;
  }

  if (outcomeType === "positive" && margin >= MARGIN_THRESHOLDS.CLEAR) {
    const marginPct = Math.round(margin * 100);
    return `${winnerLabel} is your best path to ${goalText} — ${marginPct}% better than alternatives`;
  }

  // Neutral or moderate margin
  return `${winnerLabel} is your best path to ${goalText}`;
}

/**
 * Generate generic headline when no goal is provided.
 * Falls back to original behavior.
 */
function generateGenericHeadline(
  winner: RankedAction,
  runnerUp: RankedAction | null,
  margin: number,
  winnerLabel: string,
  winnerIsBaseline: boolean
): string {
  // Check for negative outcomes
  if (winner.outcome_quality === "negative") {
    if (!runnerUp) {
      return `${winnerLabel} is the only option, though outcomes carry risk`;
    }
    if (margin >= MARGIN_THRESHOLDS.CLEAR) {
      return `${winnerLabel} minimises downside risk`;
    }
    return `${winnerLabel} offers relatively better outcomes despite risks`;
  }

  // Check for mixed outcomes
  if (winner.outcome_quality === "mixed") {
    if (margin >= MARGIN_THRESHOLDS.CLEAR) {
      return `${winnerLabel} is recommended, though outcomes are less predictable`;
    }
    return `${winnerLabel} is the stronger option with higher potential but less certainty`;
  }

  // Baseline winner
  if (winnerIsBaseline) {
    if (margin >= MARGIN_THRESHOLDS.CLEAR) {
      return `${winnerLabel} is the recommended approach`;
    }
    return `${winnerLabel} is advisable at this time`;
  }

  // Standard positive/neutral outcomes
  if (winner.dominant || margin >= MARGIN_THRESHOLDS.CLEAR) {
    return `${winnerLabel} is the clear best choice`;
  }

  if (margin >= MARGIN_THRESHOLDS.SIGNIFICANT) {
    return `${winnerLabel} is the stronger option`;
  }

  // Close call
  if (runnerUp && margin < MARGIN_THRESHOLDS.CLOSE) {
    const runnerUpLabel = labelForComparison(runnerUp.label);
    return `${winnerLabel} edges ahead of ${runnerUpLabel}`;
  }

  return `${winnerLabel} appears to be the better choice`;
}

// ============================================================================
// Non-Identifiable Headline Generation
// ============================================================================

interface NonIdentifiableHeadlineContext {
  winnerLabel: string;
  goal: { text: string; type: string } | null;
  isCloseRace: boolean;
  runnerUp: RankedAction | null;
}

/**
 * Generate headline for non-identifiable causal effects.
 * Uses exploratory language instead of confident causal claims.
 */
function generateNonIdentifiableHeadline(ctx: NonIdentifiableHeadlineContext): string {
  const { winnerLabel, goal, isCloseRace, runnerUp } = ctx;

  // Close race + non-identifiable = strong caution
  if (isCloseRace && runnerUp) {
    const runnerUpLabel = labelForComparison(runnerUp.label);
    if (goal) {
      const goalText = formatGoalForHeadline(goal.text);
      return `Options including ${winnerLabel} and ${runnerUpLabel} show similar potential for ${goalText} — but causal effects remain unconfirmed`;
    }
    return `${winnerLabel} and ${runnerUpLabel} show similar promise — causal relationship not definitively established`;
  }

  // Non-identifiable with goal
  if (goal) {
    const goalText = formatGoalForHeadline(goal.text);
    return `Based on current model structure, ${winnerLabel} appears most promising for ${goalText} — but causal effect cannot be confirmed`;
  }

  // Non-identifiable without goal
  return `Based on current model structure, ${winnerLabel} appears most promising — but causal effect cannot be confirmed`;
}

/**
 * Generate confidence statement for non-identifiable cases.
 */
function generateNonIdentifiableConfidenceStatement(margin: number): string {
  if (margin < MARGIN_THRESHOLDS.CLOSE) {
    return "Treat as exploratory scenario analysis. The ranking is close and causal effects are not confirmed.";
  }
  return "Treat as scenario analysis — consider gathering more data to strengthen causal claims.";
}

/**
 * Generate note explaining identifiability status.
 */
function generateIdentifiabilityNote(
  isIdentifiable: boolean,
  identifiability?: Identifiability
): string | undefined {
  if (isIdentifiable) {
    // When identifiable, optionally note the method used
    if (identifiability?.method) {
      return `Causal effects confirmed via ${identifiability.method} criterion.`;
    }
    return undefined; // No note needed for standard identifiable cases
  }

  // Non-identifiable: explain the limitation
  if (identifiability?.explanation) {
    return identifiability.explanation;
  }

  return "Causal relationship not definitively established from current model structure. Consider this exploratory analysis.";
}

// ============================================================================
// Driver Statement Generation
// ============================================================================

/**
 * Generates the primary driver explanation.
 *
 * IMPORTANT: Baseline options (do nothing, status quo) should NEVER be
 * described as having "negative impact". Use neutral reframing instead.
 */
function generateDriverStatement(drivers?: Driver[]): string {
  if (!drivers || drivers.length === 0) {
    return "Further analysis may reveal the key factors influencing this decision.";
  }

  const topDriver = drivers[0];
  const rawDriverLabel = topDriver.label;
  const isExternalFactor = topDriver.kind === "factor";
  const isControllableAction = topDriver.kind === "action";

  // Check if driver is a baseline option - use neutral reframing
  const isBaseline = isBaselineLabel(rawDriverLabel);
  const driverLabel = isBaseline
    ? reframeBaselineLabel(rawDriverLabel)
    : sanitiseLabel(rawDriverLabel);

  // Special handling for baseline options - always use neutral language
  if (isBaseline) {
    if (topDriver.impact_pct !== undefined && topDriver.impact_pct > 0) {
      const impact = Math.round(topDriver.impact_pct);
      if (impact >= 50) {
        return `${capitalise(driverLabel)} preserves baseline value and avoids implementation risk (${impact}% of outcome).`;
      }
      return `${capitalise(driverLabel)} accounts for ${impact}% of the outcome by avoiding change-related risks.`;
    }
    // No impact percentage
    return `${capitalise(driverLabel)} preserves current value and avoids implementation risks.`;
  }

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

// ============================================================================
// Evidence and Next Steps Generation
// ============================================================================

/**
 * Generate evidence points supporting the recommendation.
 * Adjusts language based on identifiability of causal effects.
 */
function generateEvidence(
  winner: RankedAction,
  drivers?: Driver[],
  goal?: { text: string; type: string } | null,
  isIdentifiable: boolean = true,
  identifiability?: Identifiability
): string[] {
  const evidence: string[] = [];

  // When non-identifiable, acknowledge the limitation first
  if (!isIdentifiable) {
    evidence.push("Note: Causal effects could not be confirmed from the model structure. Treat results as scenario analysis.");

    // Explain what's missing
    if (identifiability?.explanation) {
      evidence.push(identifiability.explanation);
    } else {
      evidence.push("The model may have unmeasured confounders or insufficient structure for causal identification.");
    }

    // Suggest remediation
    evidence.push("Consider gathering additional data or refining the causal model to strengthen conclusions.");
  }

  // Add utility-based evidence (adjusted language for non-identifiable)
  const utilityPct = Math.round(winner.expected_utility * 100);
  if (isIdentifiable) {
    if (utilityPct >= 70) {
      evidence.push(`Expected utility of ${utilityPct}% indicates strong likelihood of success.`);
    } else if (utilityPct >= 50) {
      evidence.push(`Expected utility of ${utilityPct}% suggests a reasonable chance of success.`);
    }
  } else {
    // Non-identifiable: use scenario language
    if (utilityPct >= 70) {
      evidence.push(`Scenario analysis shows ${utilityPct}% expected utility under current assumptions.`);
    } else if (utilityPct >= 50) {
      evidence.push(`Model suggests ${utilityPct}% expected utility, though causal relationship is unconfirmed.`);
    }
  }

  // Add driver-based evidence
  if (drivers && drivers.length > 0) {
    const topDriver = drivers[0];
    if (topDriver.impact_pct && topDriver.impact_pct >= 30) {
      const driverLabel = sanitiseLabel(topDriver.label);
      if (isIdentifiable) {
        evidence.push(`${capitalise(driverLabel)} accounts for ${Math.round(topDriver.impact_pct)}% of the outcome.`);
      } else {
        evidence.push(`${capitalise(driverLabel)} shows ${Math.round(topDriver.impact_pct)}% association with the outcome (correlation, not confirmed causation).`);
      }
    }
  }

  // Add outcome quality evidence
  if (winner.outcome_quality === "positive") {
    if (isIdentifiable) {
      evidence.push("Analysis indicates predominantly positive expected outcomes.");
    } else {
      evidence.push("Scenario indicates predominantly positive expected outcomes under current assumptions.");
    }
  } else if (winner.outcome_quality === "negative") {
    if (isIdentifiable) {
      evidence.push("Analysis indicates challenging expected outcomes; this option minimises downside.");
    } else {
      evidence.push("Scenario suggests challenging outcomes; this option appears to minimise potential downside.");
    }
  }

  return evidence.length > 0 ? evidence : undefined as unknown as string[];
}

/**
 * Generate suggested next steps.
 * Adjusts recommendations based on identifiability of causal effects.
 */
function generateNextSteps(
  winner: RankedAction,
  outcomeType: "positive" | "negative" | "neutral",
  isCloseRace: boolean,
  goal?: { text: string; type: string } | null,
  isIdentifiable: boolean = true
): string[] {
  const steps: string[] = [];

  // Non-identifiable: prioritize steps to strengthen causal claims
  if (!isIdentifiable) {
    steps.push("Gather additional data to strengthen causal claims before committing to this option.");
    steps.push("Consider running a pilot or experiment to validate the causal relationship.");
    steps.push("Review the model structure for potential confounders or missing variables.");

    // Still add sensitivity analysis for close races
    if (isCloseRace) {
      steps.push("Run sensitivity analysis to test how robust the ranking is to assumption changes.");
    }

    // Goal-specific step for non-identifiable
    if (goal) {
      steps.push(`Monitor early indicators to validate the path toward ${truncateGoalText(goal.text, 50)}.`);
    }

    return steps.slice(0, 4); // Allow up to 4 steps for non-identifiable cases
  }

  // Identifiable: standard next steps
  if (isCloseRace) {
    steps.push("Run sensitivity analysis to test how assumptions affect the ranking.");
    steps.push("Consider qualitative factors not captured in the model.");
  }

  if (outcomeType === "negative") {
    steps.push("Develop contingency plans for potential adverse outcomes.");
    steps.push("Identify early warning indicators to monitor.");
  }

  if (outcomeType === "neutral" || outcomeType === "positive") {
    steps.push("Validate key assumptions with stakeholders before proceeding.");
  }

  // Add goal-specific next steps
  if (goal) {
    steps.push(`Define success metrics for measuring progress toward ${truncateGoalText(goal.text, 50)}.`);
  }

  return steps.length > 0 ? steps.slice(0, 3) : undefined as unknown as string[];
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
