/**
 * Deterministic Intelligence Architecture — Core Types
 *
 * Layer 0: DeterministicTurnContext — canonical state per turn
 * Layer 1: LLM JSON response contract
 * Layer 2: Block data schemas for deterministic response assembly
 */

import type { DecisionStage, V2RunResponseEnvelope, SuggestedAction, TypedConversationBlock, PatchOperation, ConversationalState } from "../types.js";
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
  /** True when structural edges (option→goal) are missing. */
  missing_structural: boolean;
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
  constraints_met: boolean | null;
  constraint_tensions: string[];
}

export interface DriverSummary {
  label: string;
  factor_id: string;
  sensitivity: number;
  direction: string;
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
  /** Raw graph reference for action handlers that need full graph state. */
  graph: GraphV3T | null;
  /** Raw analysis reference for action handlers that need full analysis. */
  analysis: V2RunResponseEnvelope | null;
  /** Conversational state from the turn request. */
  conversational_state: ConversationalState | null;
  /** Scenario ID. */
  scenario_id: string;
}

// ============================================================================
// Layer 1 — LLM JSON Response Contract
// ============================================================================

export interface LLMInsight {
  type: 'observation' | 'suggestion' | 'warning' | 'question';
  description: string;
  severity?: 'info' | 'medium' | 'high';
  target_id?: string;
  science_concept?: string;
}

export interface LLMRecommendedAction {
  action_type: string;
  target_id?: string;
  parameters?: Record<string, unknown>;
  rationale?: string;
}

export interface LLMJsonResponse {
  text: string;
  insights: LLMInsight[];
  recommended_actions: LLMRecommendedAction[];
}

// ============================================================================
// Layer 2 — Block Data Schemas
// ============================================================================

/** Commentary block — narrative text with optional supporting references. */
export interface DeterministicCommentaryBlockData {
  narrative: string;
  supporting_refs: Array<{
    ref_type: 'fact' | 'review_card' | 'evidence';
    ref_id: string;
    claim: string;
  }>;
}

/** Comparison block — tabular option comparison + narrative. */
export interface ComparisonBlockData {
  options: Array<{
    option_id: string;
    label: string;
    win_probability: number;
    strengths: string[];
    weaknesses: string[];
  }>;
  differentiators: string[];
  narrative: string;
}

/** Premortem block — risk paths and failure narrative. */
export interface PremortermBlockData {
  target_option: string;
  risk_paths: Array<{
    factor_id: string;
    factor_label: string;
    influence_rank: number;
    failure_mode: string;
  }>;
  narrative: string;
}

/** Flip analysis block — what would change the winner. */
export interface FlipAnalysisBlockData {
  current_winner: string;
  flip_conditions: Array<{
    factor_id: string;
    factor_label: string;
    current_value: number;
    flip_value: number;
    conditional_winner: string;
  }>;
  narrative: string;
}

/** Proposal block — proposed change awaiting confirmation. */
export interface ProposalBlockData {
  /** Unique ID for matching confirmations to proposals. */
  proposal_id: string;
  action_type: ActionName;
  description: string;
  operations: PatchOperation[];
  impact_summary: string;
  /** Labels of affected elements. */
  affected_elements: string[];
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
}
