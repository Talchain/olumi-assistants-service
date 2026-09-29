/**
 * Rationale Generator
 *
 * Generates plain English explanations of WHY the leading option leads,
 * using template-based generation for predictable latency.
 *
 * ROADMAP 2.725 — the no-verdict doctrine, at the `assist.v1.review` producer.
 * Founder's BINDING ruling: the product recommends what to INVESTIGATE, never
 * what to CHOOSE. These templates used to say "{option} is recommended…" and
 * "remaining the best choice in {stability}% of scenarios" — the advisory
 * register verbatim, on a route the V5 egress guard never scanned.
 *
 * The rewrite is LANGUAGE-ONLY: every measured quantity (the driver, the goal,
 * the stability percentage, the scenario count) survives unchanged. Ordering by
 * measured goal-fit is analysis and stays; the crowning verb is what goes.
 *
 * The `recommendedOption` / `recommended_option` identifiers below are the
 * PLoT robustness-data wire field names (schema-owned) and are deliberately
 * untouched — this doctrine governs prose, not the contract.
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

export const SUMMARY_TEMPLATES = {
  with_driver_and_goal:
    "{option} currently leads because {driver} has the strongest positive effect on {goal}.",

  with_driver_stability:
    "{option} currently leads, helped by its favorable impact through {driver}, and stays in front in {stability}% of scenarios.",

  with_driver_only:
    "{option} currently leads, helped by its favorable impact on {driver}.",

  with_stability:
    "{option} stays in front across {stability}% of scenarios analyzed.",

  with_goal_only:
    "{option} scores highest against {goal}.",

  minimal:
    "{option} shows the highest expected outcome based on the model.",
} as const;

// The `strong` variant ('"{option}" shows the strongest path to "{goal}"…')
// was removed by 2.725: it had ZERO call sites (`buildGoalAlignment` only ever
// used `direct`) and crowned a path with a superlative. A dead template is a
// loaded gun for the next consumer, so it is deleted rather than reworded.
export const GOAL_ALIGNMENT_TEMPLATES = {
  direct: 'Choosing "{option}" directly supports achieving "{goal}".',
} as const;

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
