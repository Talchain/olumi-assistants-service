/**
 * CEE Narrative Types
 *
 * Shared types for the two ACTIVE narrative endpoints:
 * - narrate-conditions
 * - explain-policy
 *
 * ROADMAP 2.213: the generate-recommendation types (`RankedAction`,
 * `GenerateRecommendationInput`, `GenerateRecommendationOutput`) were deleted
 * with the route and composer they served.
 */

// Narrate Conditions types
export interface ConditionBranch {
  recommendation: string;
  confidence: number; // 0-100
}

export interface Condition {
  condition_id: string;
  condition_label: string;
  if_true: ConditionBranch;
  if_false: ConditionBranch;
}

export interface NarrateConditionsInput {
  conditions: Condition[];
  primary_recommendation?: string;
  context?: string;
}

export interface ConditionSummary {
  condition: string;
  if_true_action: string;
  if_false_action: string;
}

export interface NarrateConditionsOutput {
  narrative: string;
  conditions_summary: ConditionSummary[];
  key_decision_points: string[];
  provenance: "cee";
}

// Explain Policy types
export interface PolicyStep {
  step_number: number;
  action: string;
  rationale?: string;
  depends_on?: string[];
}

export interface ExplainPolicyInput {
  policy_steps: PolicyStep[];
  goal_label?: string;
  context?: string;
}

export interface StepExplanation {
  step: number;
  action: string;
  explanation: string;
}

export interface ExplainPolicyOutput {
  policy_narrative: string;
  steps_explained: StepExplanation[];
  dependencies_explained?: string;
  provenance: "cee";
}
