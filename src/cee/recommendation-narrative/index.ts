/**
 * CEE Narrative Module (formerly "Recommendation Narrative")
 *
 * Two capabilities, both template-based (no LLM calls), both deterministic:
 * - narrateConditions: narrate the caller's conditional branches
 * - explainPolicy: explain sequential decision logic
 *
 * ROADMAP 2.213 (no-recommendations doctrine): `generateRecommendation` and
 * its `/assist/v1/generate-recommendation` route were DELETED. They crowned
 * a winner in the advisory register and had no caller in UI `src/**` or CEE
 * `src/**`; the module's own egress-guard note already recorded the route as
 * dead pending the V4 retirement decision.
 */

import type {
  NarrateConditionsInput,
  NarrateConditionsOutput,
  ExplainPolicyInput,
  ExplainPolicyOutput,
} from "./types.js";

import {
  generateConditionalNarrative,
  extractKeyDecisionPoints,
  generatePolicyNarrative,
  generateStepExplanations,
  generateDependenciesExplanation,
} from "./templates.js";

import { sanitiseLabel } from "../../utils/label-sanitiser.js";

export * from "./types.js";

/**
 * Generate conditional recommendation narratives.
 */
export function narrateConditions(
  input: NarrateConditionsInput,
): NarrateConditionsOutput {
  const { conditions, primary_recommendation, context: _context } = input;

  const narrative = generateConditionalNarrative(conditions, primary_recommendation);

  const conditions_summary = conditions.map((cond) => ({
    condition: sanitiseLabel(cond.condition_label),
    if_true_action: sanitiseLabel(cond.if_true.recommendation),
    if_false_action: sanitiseLabel(cond.if_false.recommendation),
  }));

  const key_decision_points = extractKeyDecisionPoints(conditions);

  return {
    narrative,
    conditions_summary,
    key_decision_points,
    provenance: "cee",
  };
}

/**
 * Explain sequential decision/policy logic.
 */
export function explainPolicy(
  input: ExplainPolicyInput,
): ExplainPolicyOutput {
  const { policy_steps, goal_label, context: _context } = input;

  const policy_narrative = generatePolicyNarrative(policy_steps, goal_label);
  const steps_explained = generateStepExplanations(policy_steps);
  const dependencies_explained = generateDependenciesExplanation(policy_steps);

  return {
    policy_narrative,
    steps_explained,
    dependencies_explained,
    provenance: "cee",
  };
}

/**
 * Validate input for narrate-conditions.
 */
export function validateNarrateConditionsInput(
  input: unknown,
): input is NarrateConditionsInput {
  if (!input || typeof input !== "object") {
    return false;
  }

  const obj = input as Record<string, unknown>;

  // Check conditions array
  if (!Array.isArray(obj.conditions) || obj.conditions.length === 0) {
    return false;
  }

  for (const cond of obj.conditions) {
    if (typeof cond !== "object" || !cond) return false;
    const c = cond as Record<string, unknown>;
    if (typeof c.condition_id !== "string") return false;
    if (typeof c.condition_label !== "string") return false;

    // Check if_true and if_false branches
    if (typeof c.if_true !== "object" || !c.if_true) return false;
    if (typeof c.if_false !== "object" || !c.if_false) return false;

    const ifTrue = c.if_true as Record<string, unknown>;
    const ifFalse = c.if_false as Record<string, unknown>;

    if (typeof ifTrue.recommendation !== "string") return false;
    if (typeof ifTrue.confidence !== "number") return false;
    if (typeof ifFalse.recommendation !== "string") return false;
    if (typeof ifFalse.confidence !== "number") return false;
  }

  // Optional fields
  if (
    obj.primary_recommendation !== undefined &&
    typeof obj.primary_recommendation !== "string"
  ) {
    return false;
  }
  if (obj.context !== undefined && typeof obj.context !== "string") {
    return false;
  }

  return true;
}

/**
 * Validate input for explain-policy.
 */
export function validateExplainPolicyInput(
  input: unknown,
): input is ExplainPolicyInput {
  if (!input || typeof input !== "object") {
    return false;
  }

  const obj = input as Record<string, unknown>;

  // Check policy_steps array
  if (!Array.isArray(obj.policy_steps) || obj.policy_steps.length === 0) {
    return false;
  }

  for (const step of obj.policy_steps) {
    if (typeof step !== "object" || !step) return false;
    const s = step as Record<string, unknown>;
    if (typeof s.step_number !== "number") return false;
    if (typeof s.action !== "string") return false;

    // Optional fields
    if (s.rationale !== undefined && typeof s.rationale !== "string") {
      return false;
    }
    if (s.depends_on !== undefined && !Array.isArray(s.depends_on)) {
      return false;
    }
  }

  // Optional fields
  if (obj.goal_label !== undefined && typeof obj.goal_label !== "string") {
    return false;
  }
  if (obj.context !== undefined && typeof obj.context !== "string") {
    return false;
  }

  return true;
}
