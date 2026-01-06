/**
 * Rationale Generator
 *
 * Generates plain English explanations of why the recommended option
 * is suggested, using template-based generation for predictable latency.
 */

export interface RationaleResult {
  /** 2-3 sentence summary of the recommendation */
  summary: string;
  /** The most influential factor driving the recommendation */
  key_driver?: string;
  /** How the recommended option aligns with the stated goal */
  goal_alignment?: string;
}

export interface RationaleContext {
  /** The recommended option from robustness analysis */
  recommendedOption?: {
    id: string;
    label: string;
  };
  /** The primary goal from the graph */
  goal?: {
    id: string;
    label: string;
  };
  /** Top drivers influencing the recommendation */
  drivers?: Array<{
    id?: string;
    label: string;
    sensitivity?: number;
  }>;
  /** Recommendation stability from robustness analysis (0-1) */
  stability?: number;
  /** Total number of scenarios analyzed */
  scenarioCount?: number;
}

// =============================================================================
// Summary Templates
// =============================================================================

const SUMMARY_TEMPLATES = {
  with_driver_and_goal:
    "{option} is recommended because {driver} has the strongest positive effect on {goal}.",

  with_driver_stability:
    "{option} is recommended due to its favorable impact through {driver}, remaining the best choice in {stability}% of scenarios.",

  with_driver_only:
    "{option} is recommended due to its favorable impact on {driver}.",

  with_stability:
    "{option} remains the best choice across {stability}% of scenarios analyzed.",

  with_goal_only:
    "{option} is recommended as it best achieves {goal}.",

  minimal:
    "{option} shows the highest expected outcome based on the model.",
};

const GOAL_ALIGNMENT_TEMPLATES = {
  direct: 'Choosing "{option}" directly supports achieving "{goal}".',
  strong: '"{option}" shows the strongest path to "{goal}" through its key drivers.',
};

// =============================================================================
// Rationale Generation
// =============================================================================

/**
 * Generate a plain English rationale for the recommendation.
 * Returns null if no recommended option is provided.
 */
export function generateRationale(context: RationaleContext): RationaleResult | null {
  const { recommendedOption, goal, drivers, stability } = context;

  // Cannot generate rationale without a recommended option
  if (!recommendedOption || !recommendedOption.label) {
    return null;
  }

  const summary = buildSummary(recommendedOption, goal, drivers, stability);
  const keyDriver = drivers?.[0]?.label;
  const goalAlignment = goal ? buildGoalAlignment(recommendedOption, goal) : undefined;

  return {
    summary,
    key_driver: keyDriver,
    goal_alignment: goalAlignment,
  };
}

/**
 * Build the summary sentence(s) explaining the recommendation.
 */
function buildSummary(
  option: { label: string },
  goal: { label: string } | undefined,
  drivers: RationaleContext["drivers"],
  stability: number | undefined
): string {
  const topDriver = drivers?.[0];
  const stabilityPercent = stability ? Math.round(stability * 100) : undefined;

  // Best case: driver + goal
  if (topDriver && goal) {
    return SUMMARY_TEMPLATES.with_driver_and_goal
      .replace("{option}", option.label)
      .replace("{driver}", topDriver.label)
      .replace("{goal}", goal.label);
  }

  // Driver + stability
  if (topDriver && stabilityPercent && stabilityPercent > 50) {
    return SUMMARY_TEMPLATES.with_driver_stability
      .replace("{option}", option.label)
      .replace("{driver}", topDriver.label)
      .replace("{stability}", stabilityPercent.toString());
  }

  // Driver only
  if (topDriver) {
    return SUMMARY_TEMPLATES.with_driver_only
      .replace("{option}", option.label)
      .replace("{driver}", topDriver.label);
  }

  // Stability only (strong signal)
  if (stabilityPercent && stabilityPercent >= 70) {
    return SUMMARY_TEMPLATES.with_stability
      .replace("{option}", option.label)
      .replace("{stability}", stabilityPercent.toString());
  }

  // Goal only
  if (goal) {
    return SUMMARY_TEMPLATES.with_goal_only
      .replace("{option}", option.label)
      .replace("{goal}", goal.label);
  }

  // Minimal fallback
  return SUMMARY_TEMPLATES.minimal.replace("{option}", option.label);
}

/**
 * Build the goal alignment explanation.
 */
function buildGoalAlignment(
  option: { label: string },
  goal: { label: string }
): string {
  return GOAL_ALIGNMENT_TEMPLATES.direct
    .replace("{option}", option.label)
    .replace("{goal}", goal.label);
}
