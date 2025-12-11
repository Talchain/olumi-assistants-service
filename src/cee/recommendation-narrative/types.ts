/**
 * CEE Recommendation Narrative Types
 *
 * Shared types for the three recommendation narrative endpoints:
 * - generate-recommendation
 * - narrate-conditions
 * - explain-policy
 */

export type Tone = "formal" | "conversational";
export type Confidence = "high" | "medium" | "low";

// Generate Recommendation types
export interface RankedAction {
  node_id: string;
  label: string;
  score: number; // 0-100
  rank: number; // 1-based
  /** Optional outcome quality indicator - used to avoid contradictory messaging */
  outcome_quality?: "positive" | "neutral" | "negative" | "mixed";
  /** Optional: whether this option has associated risks */
  has_risks?: boolean;
  /** Optional: primary outcome label for context */
  primary_outcome?: string;
}

export interface GenerateRecommendationInput {
  ranked_actions: RankedAction[];
  goal_label?: string;
  context?: string;
  tone?: Tone;
}

export interface GenerateRecommendationOutput {
  headline: string;
  recommendation_narrative: string;
  confidence_statement: string;
  alternatives_summary?: string;
  caveat?: string;
  provenance: "cee";
}

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
