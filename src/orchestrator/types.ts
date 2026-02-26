/**
 * CEE Orchestrator Types
 *
 * All TypeScript interfaces for the conversational orchestrator (Track C).
 * Faithfully reproduces the spec interfaces for:
 * - Request/response envelopes
 * - Blocks (conversation units)
 * - Context management
 * - Tool definitions
 * - PLoT V2 run response (narrow structural type)
 */

import type { GraphV3T, EdgeV3T, NodeV3T, OptionV3T } from "../schemas/cee-v3.js";

// ============================================================================
// Decision Stage
// ============================================================================

export type DecisionStage = 'frame' | 'ideate' | 'evaluate' | 'decide' | 'optimise';

// ============================================================================
// Request Types
// ============================================================================

export interface SystemEvent {
  type: 'patch_accepted' | 'patch_dismissed' | 'feedback_submitted' | 'direct_graph_edit' | 'direct_analysis_run';
  payload: Record<string, unknown>;
}

export interface OrchestratorTurnRequest {
  /** User's natural language message */
  message: string;
  /** Current conversation context (graph, analysis, framing, messages) */
  context: ConversationContext;
  /** Scenario identifier */
  scenario_id: string;
  /** Optional system event (UI-originated) */
  system_event?: SystemEvent;
  /** Client-generated turn ID for idempotency */
  client_turn_id: string;
}

// ============================================================================
// Response Types
// ============================================================================

export interface SuggestedAction {
  label: string;
  prompt: string;
  role: 'facilitator' | 'challenger';
}

export interface OrchestratorError {
  code: 'LLM_TIMEOUT' | 'TOOL_EXECUTION_FAILED' | 'VALIDATION_REJECTED' | 'CONTEXT_TOO_LARGE' | 'INVALID_REQUEST' | 'UNKNOWN';
  message: string;
  tool?: string;
  recoverable: boolean;
  suggested_retry?: string;
}

export interface TurnPlan {
  selected_tool: string | null;
  routing: 'deterministic' | 'llm';
  long_running: boolean;
  tool_latency_ms?: number;
}


export interface ResponseLineage {
  context_hash: string;
  plan_hash?: string;
  response_hash?: string;
  seed_used?: number;
  n_samples?: number;
  /** PLoT graph hash from validate-patch. Only set on patch_accepted acks. */
  graph_hash?: string;
}

export interface OrchestratorResponseEnvelope {
  turn_id: string;
  assistant_text: string | null;
  blocks: ConversationBlock[];
  suggested_actions?: SuggestedAction[];
  analysis_response?: unknown;
  lineage: ResponseLineage;
  turn_plan?: TurnPlan;
  stage_indicator?: DecisionStage;
  /** Debug aid — not part of INT-3 contract */
  stage_label?: string;
  error?: OrchestratorError;
  /** Diagnostics content from LLM <diagnostics> tag. Only in non-production. */
  diagnostics?: string;
  /** Parse warnings from XML envelope extraction. Only in non-production. */
  parse_warnings?: string[];
}

// ============================================================================
// V2RunResponseEnvelope — narrow structural type for PLoT /v2/run response
// ============================================================================

/**
 * CEE treats PLoT response as mostly opaque for forwarding but reads specific
 * fields for block construction. Uses unknown[] for arrays that are forwarded
 * without structural validation.
 */
export interface V2RunResponseEnvelope {
  meta: {
    seed_used: number;
    n_samples: number;
    response_hash: string;
    [k: string]: unknown;
  };
  /** OptionResult[] — CEE reads option_label, win_probability */
  results: unknown[];
  /** FactObjectV1[] — CEE reads fact_type, fact_id */
  fact_objects?: unknown[];
  /** ProposalCardV1[] — forwarded to ReviewCardBlock */
  review_cards?: unknown[];
  robustness?: {
    level: string;
    fragile_edges?: unknown[];
    [k: string]: unknown;
  };
  /** DecisionBriefV1 — used by generate_brief */
  decision_brief?: unknown;
  /** CEE reads label, elasticity, direction */
  factor_sensitivity?: unknown[];
  constraint_analysis?: {
    joint_probability?: number;
    per_constraint?: unknown[];
    [k: string]: unknown;
  };
  /** Top-level response_hash (preferred over meta.response_hash) */
  response_hash?: string;
  [k: string]: unknown;
}

// ============================================================================
// Block Types
// ============================================================================

export type BlockType = 'framing' | 'commentary' | 'graph_patch' | 'fact' | 'review_card' | 'brief';

export interface BlockProvenance {
  trigger: string;
  turn_id: string;
  timestamp: string;
}

export interface BlockAction {
  action_id: string;
  label: string;
  action_type: 'accept' | 'edit' | 'dismiss' | 'attach' | 'share' | 'rerun' | 'undo';
}

export interface ConversationBlock {
  block_id: string;
  block_type: BlockType;
  data: GraphPatchBlockData | FactBlockData | CommentaryBlockData | BriefBlockData | ReviewCardBlockData | FramingBlockData;
  actions?: BlockAction[];
  provenance: BlockProvenance;
  related_elements?: { node_ids?: string[]; edge_ids?: string[] };
}

// ---- Graph Patch Block ----

export type PatchType = 'full_draft' | 'edit' | 'repair';
export type PatchStatus = 'proposed' | 'accepted' | 'dismissed' | 'rejected';

export interface PatchOperation {
  op: 'add_node' | 'remove_node' | 'update_node' | 'add_edge' | 'remove_edge' | 'update_edge';
  path: string;
  value?: unknown;
  old_value?: unknown;
}

export interface RepairEntry {
  code: string;
  message: string;
  field?: string;
  old_value?: unknown;
  new_value?: unknown;
}

export interface GraphPatchBlockData {
  patch_type: PatchType;
  operations: PatchOperation[];
  status: PatchStatus;
  applied_graph_hash?: string;
  /** Canonical graph state after PLoT applies the patch */
  applied_graph?: GraphV3T;
  /** Hash of the graph the patch was generated against (optimistic concurrency audit trail) */
  base_graph_hash?: string;
  /** Semantic repairs applied by PLoT (surfaced as-is, never rewritten into operations) */
  repairs_applied?: RepairEntry[];
  summary?: string;
  rejection?: {
    reason: string;
    message?: string;
    code?: string;
    /** PLoT's specific rejection code (e.g. CYCLE_DETECTED). Only set when PLoT is the rejector. */
    plot_code?: string;
    /** PLoT's violation details (opaque — forwarded as-is). Only set when PLoT is the rejector. */
    plot_violations?: unknown[];
    /** Total LLM attempts before rejection (1 = no retry, 2 = one retry, etc.) */
    attempts?: number;
  };
  validation_warnings?: string[];
}

// ---- Fact Block ----

export interface FactBlockData {
  fact_type: string;
  facts: unknown[];
}

// ---- Commentary Block ----

export interface SupportingRef {
  ref_type: 'fact' | 'review_card' | 'evidence';
  ref_id: string;
  claim: string;
  ui_anchor?: { block_id?: string; section_id?: string };
}

export interface CommentaryBlockData {
  narrative: string;
  supporting_refs: SupportingRef[];
}

// ---- Brief Block ----

export interface BriefBlockData {
  brief: unknown;
}

// ---- Review Card Block ----

export interface ReviewCardBlockData {
  card: unknown;
}

// ---- Framing Block ----

export interface FramingBlockData {
  stage: DecisionStage;
  goal?: string;
  constraints?: unknown[];
}

// ============================================================================
// Context Types
// ============================================================================

export interface OptionForAnalysis {
  option_id: string;
  label: string;
  interventions: Record<string, unknown>;
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  tool_calls?: Array<{ name: string; input: Record<string, unknown> }>;
}

export interface AnalysisInputs {
  options: OptionForAnalysis[];
  constraints?: unknown[];
  seed?: number;
  n_samples?: number;
  [k: string]: unknown;
}

export interface ConversationContext {
  graph: GraphV3T | null;
  analysis_response: V2RunResponseEnvelope | null;
  framing: {
    stage: DecisionStage;
    goal?: string;
    constraints?: unknown[];
  } | null;
  messages: ConversationMessage[];
  event_log_summary?: string;
  selected_elements?: string[];
  scenario_id: string;
  analysis_inputs?: AnalysisInputs | null;
}

export interface OrchestratorEvent {
  event_type: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

// ============================================================================
// Tool Types
// ============================================================================

export interface OrchestratorToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  output_block_types: BlockType[];
  requires: string[];
  long_running: boolean;
}

// ============================================================================
// HTTP Status Mapping
// ============================================================================

export function getHttpStatusForError(error: OrchestratorError): number {
  switch (error.code) {
    case 'LLM_TIMEOUT': return 504;
    case 'TOOL_EXECUTION_FAILED': return 502;
    case 'VALIDATION_REJECTED': return 422;
    case 'CONTEXT_TOO_LARGE': return 413;
    case 'INVALID_REQUEST': return 400;
    case 'UNKNOWN':
    default: return 500;
  }
}

// ============================================================================
// Re-exports for convenience
// ============================================================================

export type { GraphV3T, EdgeV3T, NodeV3T, OptionV3T };

/** INT-3 convenience aliases */
export type ToolDefinition = OrchestratorToolDefinition;
export type V2RunResponse = V2RunResponseEnvelope;
