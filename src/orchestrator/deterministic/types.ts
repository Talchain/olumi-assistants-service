/**
 * Deterministic Intelligence Architecture — Core Types
 *
 * Layer 0: DeterministicTurnContext — canonical state per turn
 * Layer 1: LLM JSON response contract
 * Layer 2: Block data schemas for deterministic response assembly
 */

import type { FastifyRequest } from "fastify";
import type { DecisionStage, V2RunResponseEnvelope, SuggestedAction, TypedConversationBlock, PatchOperation, ConversationalState, AnalysisInputs } from "../types.js";
import type { GraphV3T, NodeKindV3T } from "../../schemas/cee-v3.js";
import type { GuidanceItem } from "../types/guidance-item.js";
import type { ActionName } from "./actions/types.js";

// ============================================================================
// Layer 0 — DeterministicTurnContext
// ============================================================================

/** Registry entry for a graph element (node, edge, or option). */
export interface EntityEntry {
  id: string;
  label: string;
  kind: NodeKindV3T;
  aliases: string[];
  category?: string;
  /** True for option nodes and decision nodes — targets of structural actions. */
  is_action_target: boolean;
  /** Observed value (factor nodes only). */
  value?: number;
  unit?: string;
  cap?: number;
}

/** Registry entry for a graph edge. */
export interface EdgeEntry {
  from: string;
  to: string;
  from_label: string;
  to_label: string;
  strength_mean: number;
  strength_std: number;
  exists_probability: number;
  effect_direction?: 'positive' | 'negative';
}

/** Registry of all graph elements for entity resolution. */
export interface EntityRegistry {
  nodes: Map<string, EntityEntry>;
  edges: EdgeEntry[];
  option_ids: string[];
  goal_id: string | null;
}

/** Summary statistics for the current graph. */
export interface GraphSummary {
  node_count: number;
  edge_count: number;
  option_count: number;
  option_labels: string[];
  goal_label: string | null;
  /** Specific structural issues found (empty array = no issues). */
  missing_structural: string[];
}

/** Summary of the latest analysis results. */
export interface AnalysisSummary {
  winner: string | null;
  winner_probability: number | null;
  runner_up: string | null;
  runner_up_probability: number | null;
  robustness_band: string | null;
  top_drivers: DriverSummary[];
  fragile_edge_count: number;
  /** Fragile-edge details (label + switch_probability), sorted desc by switch_probability. Top 5 retained. */
  fragile_edges: FragileEdgeSummary[];
  /** Per-factor sensitivity entries forwarded by the UI (top-level on analysis_state). Top 5 by influence_rank. */
  factor_sensitivity: FactorSensitivitySummary[];
  /** Edge-level e-value summary from robustness analysis. Sorted by fragility (most fragile first). */
  edge_e_values: EdgeEValueSummary[];
  /** Conditional winner scenarios from robustness analysis. */
  conditional_winners: ConditionalWinnerSummary[];
  /** Inference warnings emitted by the analysis layer. */
  inference_warnings: string[];
  constraints_met: boolean | null;
  constraint_tensions: string[];
}

export interface DriverSummary {
  label: string;
  factor_id: string;
  sensitivity: number;
  direction: string;
}

/** Fragile-edge entry — surfaces the structural relationship and how easily its sign flips. */
export interface FragileEdgeSummary {
  label: string;
  switch_probability: number;
}

/** Factor sensitivity entry forwarded by the UI on analysis_state.factor_sensitivity. */
export interface FactorSensitivitySummary {
  label: string;
  influence_percent: number | null;
  confidence_band: string | null;
  influence_rank: number | null;
}

/** Edge e-value entry — quantifies how robust an edge's contribution is. */
export interface EdgeEValueSummary {
  label: string;
  e_value: number;
  /** True when this edge is among the most fragile; false for the most robust pick. */
  fragile: boolean;
}

/** Conditional winner — option that wins under a specific scenario assumption. */
export interface ConditionalWinnerSummary {
  scenario: string;
  winner_label: string;
  probability: number | null;
}

/** What prevents a specific action from executing. */
export interface Blocker {
  action_type: ActionName;
  reason: string;
  suggested_action_type?: ActionName;
}

/** Deterministic signals computed from graph + analysis data. */
export interface TurnSignals {
  /** Factor IDs with high uncertainty (multiple uncertainty drivers or inferred extraction). */
  high_uncertainty_factors: string[];
  /** Factor ID of the dominant driver (sensitivity > 2× runner-up). Null if none. */
  dominant_factor: string | null;
  /** True when winner margin < 5 percentage points. */
  close_call: boolean;
  /** Count of factors using default/inferred values. */
  default_value_count: number;
  /** Edge IDs (from→to) with strength < 0.3. */
  weak_edges: string[];
}

/** Capabilities — which action categories are possible given current state. */
export interface TurnCapabilities {
  can_run_analysis: boolean;
  can_explain_results: boolean;
  can_edit_graph: boolean;
  can_compare_options: boolean;
  can_challenge: boolean;
  can_generate_artefact: boolean;
}

/** Conversation context summary for the LLM. */
export interface ConversationSummary {
  turn_count: number;
  last_user_intent: string | null;
  recent_actions_taken: string[];
  recent_actions_declined: string[];
  pending_confirmation: string | null;
}

/**
 * DeterministicTurnContext — canonical state object computed per turn.
 * Replaces Zone 2 assembly for the deterministic pipeline.
 */
export interface DeterministicTurnContext {
  stage: DecisionStage;
  entities: EntityRegistry;
  graph_summary: GraphSummary;
  analysis_summary: AnalysisSummary | null;
  capabilities: TurnCapabilities;
  blockers: Blocker[];
  signals: TurnSignals;
  conversation: ConversationSummary;
  eligible_actions: ActionName[];
  /** Proactive disambiguation hints for entity near-collisions. Max 2. */
  disambiguation_hints: DisambiguationHint[];
  /** Raw graph reference for action handlers that need full graph state. */
  graph: GraphV3T | null;
  /** Raw analysis reference for action handlers that need full analysis. */
  analysis: V2RunResponseEnvelope | null;
  /** Conversational state from the turn request. */
  conversational_state: ConversationalState | null;
  /** Scenario ID. */
  scenario_id: string;
  /** Turn ID — unique per pipeline invocation; used for block provenance. */
  turn_id: string;
  /** Analysis inputs for run_analysis delegation. */
  analysis_inputs: AnalysisInputs | null;
  /** Fastify request — required by draft_graph action handler (calls unified pipeline). */
  request?: FastifyRequest;
  /** Abort signal — propagated from pipeline entry point for cancellation of long-running tools. */
  signal?: AbortSignal;
}

/**
 * Proactive disambiguation hint — emitted when the user message
 * contains a token that matches 2+ actionable entities.
 */
export interface DisambiguationHint {
  term: string;
  candidates: Array<{ id: string; label: string }>;
}

// ============================================================================
// Layer 1 — LLM JSON Response Contract
// ============================================================================

export type Priority = 'high' | 'medium' | 'low';

export interface LLMInsight {
  type: 'bias_detected' | 'missing_perspective' | 'assumption_risk' |
        'opportunity' | 'calibration_concern' | 'structural_gap';
  description: string;
  severity: 'info' | 'warning' | 'important';
  target_id?: string;
  science_concept?: string;
}

export type LLMRecommendedAction =
  | { action_type: 'set_factor_value'; target_id: string; value: number; raw_value?: number; unit?: string; priority: Priority; rationale?: string }
  | { action_type: 'add_constraint'; target_id: string; constraint_type?: 'threshold' | 'range'; threshold: number; label: string; unit?: string; priority: Priority; rationale?: string }
  | { action_type: 'add_factor'; label: string; category?: 'controllable' | 'observable' | 'external'; connect_to?: string[]; priority: Priority; rationale?: string }
  | { action_type: 'adjust_edge_strength'; from: string; to: string; strength_mean?: number; priority: Priority; rationale?: string }
  | { action_type: 'add_option'; label: string; priority: Priority; rationale?: string }
  | { action_type: 'remove_factor'; target_id: string; priority: Priority; rationale?: string }
  | { action_type: 'set_goal_target'; threshold: number; unit?: string; cap?: number; priority: Priority; rationale?: string }
  | { action_type: 'run_analysis'; priority: Priority; rationale?: string }
  | { action_type: 'explain_result'; focus?: string; priority: Priority; rationale?: string }
  | { action_type: 'compare_options'; priority: Priority; rationale?: string }
  | { action_type: 'challenge_assumption'; target_id?: string; priority: Priority; rationale?: string }
  | { action_type: 'run_premortem'; target_id?: string; priority: Priority; rationale?: string }
  | { action_type: 'what_would_flip'; priority: Priority; rationale?: string }
  | { action_type: 'generate_artefact'; artefact_type: string; priority: Priority; rationale?: string };

export interface LLMJsonResponse {
  text: string;
  insights: LLMInsight[];
  recommended_actions: LLMRecommendedAction[];
}

// ============================================================================
// Layer 2 — Block Data Schemas
// ============================================================================

/** Commentary block — narrative text with structured sections for explain_result. */
export interface DeterministicCommentaryBlockData {
  narrative: string;
  sections?: Array<{
    heading: string;
    content?: string;
    items?: string[];
  }>;
  supporting_refs?: Array<{
    ref_type: 'fact' | 'review_card' | 'evidence';
    ref_id: string;
    claim: string;
  }>;
}

/** Comparison block — tabular option comparison + narrative. */
export interface ComparisonBlockData {
  options: Array<{
    id: string;
    label: string;
    probability: number;
    rank: number;
    strengths: string[];
    weaknesses: string[];
    key_differentiators: string[];
  }>;
  narrative: string;
}

/** Premortem block — risk paths and failure narrative. */
export interface PremortemBlockData {
  target_option: { id: string; label: string };
  risk_paths: Array<{
    path: string[];
    influence: number;
    description: string;
  }>;
  narrative: string;
}

/** Flip analysis block — what would change the winner. */
export interface FlipAnalysisBlockData {
  current_winner: { id: string; label: string; probability: number };
  flip_conditions: Array<{
    assumption: string;
    current_value: number;
    flip_threshold: number;
    direction: string;
    alternative_winner: string;
  }>;
  narrative: string;
}

/** Proposal block — proposed change awaiting confirmation. */
export interface ProposalBlockData {
  proposal_id: string;
  action_type: ActionName;
  description: string;
  changes: Array<{
    operation: string;
    target: string;
    detail: string;
  }>;
  consequences: string[];
  confirmation_required: boolean;
}

/** Artefact block data — extends existing ArtefactBlockData. */
export interface DeterministicArtefactBlockData {
  artefact_type: 'decision_matrix' | 'sensitivity_explorer' | 'comparison_table' | 'premortem_worksheet' | 'assumption_map' | 'custom';
  title: string;
  description?: string;
  content: string;
}

/** Exercise block — structured coaching exercise output. */
export interface ExerciseBlockData {
  exercise_type: 'pre_mortem' | 'devil_advocate' | 'disconfirmation';
  target_option?: string;
  prompts: string[];
  narrative: string;
}

// ============================================================================
// Action Execution Result
// ============================================================================

export interface ActionResult {
  blocks: TypedConversationBlock[];
  assistantText: string | null;
  guidance_items: GuidanceItem[];
  /** Analysis response when run_analysis produces one. */
  analysis_response?: V2RunResponseEnvelope;
  /** Patch operations produced by graph-mutating actions. */
  operations?: PatchOperation[];
  /** Applied graph hash after patch validation. */
  applied_graph_hash?: string;
  /** Applied graph state after patch. */
  applied_graph?: GraphV3T;
}

// ============================================================================
// Pipeline Response
// ============================================================================

export interface DeterministicPipelineResult {
  envelope: import("../types.js").OrchestratorResponseEnvelope & {
    response_version: 2;
  };
  httpStatus: number;
  /** Quality metadata for telemetry (populated by assembler, emitted by pipeline). */
  _quality?: TurnQualityMeta;
}

/** Structured quality metadata emitted as telemetry after every deterministic turn. */
export interface TurnQualityMeta {
  parse_method: 'native' | 'fence' | 'regex' | 'fallback' | 'error';
  banned_terms_found: string[];
  ineligible_actions_stripped: string[];
  insights_count: number;
  actions_count: number;
  text_word_count: number;
  has_science_concept: boolean;
  disambiguation_triggered: boolean;
  empty_before_normalisation: boolean;
  llm_action_count_pre_filter: number;
  context_fallback_used: boolean;
  prompt_char_count: number;
  /** Streaming text extractor state: 'streaming' (progressive deltas) or 'fallback' (single delta). */
  streaming_extractor_state?: 'streaming' | 'fallback';
}
