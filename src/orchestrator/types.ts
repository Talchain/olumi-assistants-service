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

// ============================================================================
// System Event Types — discriminated union on event_type
// ============================================================================

export type SystemEventType =
  | 'patch_accepted'
  | 'patch_dismissed'
  | 'direct_graph_edit'
  | 'direct_analysis_run'
  | 'feedback_submitted';

/** Opaque operation record sent from UI in patch events. */
export type SystemEventPatchOp = Record<string, unknown>;

export interface PatchAcceptedDetails {
  patch_id: string;
  block_id?: string;
  operations: SystemEventPatchOp[];
  applied_graph_hash?: string;
}

export interface PatchDismissedDetails {
  patch_id?: string;
  block_id?: string;
  reason?: string;
}

export interface DirectGraphEditDetails {
  changed_node_ids: string[];
  changed_edge_ids: string[];
  operations: ('add' | 'update' | 'remove')[];
}

/** No details — graph_state and analysis_state come from the turn request fields. */
export type DirectAnalysisRunDetails = Record<string, never>;

export interface FeedbackSubmittedDetails {
  turn_id: string;
  rating: 'up' | 'down';
  comment?: string;
}

export type SystemEvent =
  | { event_type: 'patch_accepted'; timestamp: string; event_id: string; details: PatchAcceptedDetails }
  | { event_type: 'patch_dismissed'; timestamp: string; event_id: string; details: PatchDismissedDetails }
  | { event_type: 'direct_graph_edit'; timestamp: string; event_id: string; details: DirectGraphEditDetails }
  | { event_type: 'direct_analysis_run'; timestamp: string; event_id: string; details: DirectAnalysisRunDetails }
  | { event_type: 'feedback_submitted'; timestamp: string; event_id: string; details: FeedbackSubmittedDetails };

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
  /**
   * Full graph state provided by the UI.
   * Required when system_event.details.applied_graph_hash is set (patch_accepted Path A)
   * and for direct_analysis_run Path B validation.
   */
  graph_state?: GraphV3T | null;
  /**
   * Full analysis response provided by the UI (direct_analysis_run Path A).
   * When present, CEE skips PLoT /v2/run and uses this directly.
   */
  analysis_state?: V2RunResponseEnvelope | null;
  /** When true, the UI explicitly requested model generation (Generate Model button). */
  generate_model?: boolean;
}

// ============================================================================
// Response Types
// ============================================================================

export interface SuggestedAction {
  label: string;
  prompt: string;
  role: 'facilitator' | 'challenger';
}

export type ConversationalTopic =
  | 'framing'
  | 'editing'
  | 'configuring'
  | 'analysing'
  | 'explaining';

export type CanonicalConstraint = `${'budget' | 'timeline' | 'threshold'}:${string}`;

export interface LastFailedAction {
  tool: string;
  reason: string;
}

export interface PendingClarificationState {
  tool: 'edit_graph';
  original_edit_request: string;
  candidate_labels: string[];
}

export interface PendingProposalState {
  tool: 'edit_graph';
  original_edit_request: string;
  proposed_changes: ProposedChangesPayload;
  candidate_labels: string[];
  base_graph_hash: string;
}

export interface ConversationalState {
  active_entities: string[];
  stated_constraints: CanonicalConstraint[];
  current_topic: ConversationalTopic;
  last_failed_action: LastFailedAction | null;
  pending_clarification?: PendingClarificationState | null;
  pending_proposal?: PendingProposalState | null;
}

export type ProposedChangeActionType =
  | 'value_update'
  | 'option_config'
  | 'structural_add'
  | 'structural_remove';

export interface ProposedChange {
  description: string;
  element_label: string;
  action_type: ProposedChangeActionType;
}

export interface ProposedChangesPayload {
  changes: ProposedChange[];
}

export interface OrchestratorError {
  code: 'LLM_TIMEOUT' | 'TOOL_EXECUTION_FAILED' | 'VALIDATION_REJECTED' | 'CONTEXT_TOO_LARGE' | 'INVALID_REQUEST' | 'MISSING_GRAPH_STATE' | 'INTERNAL_PAYLOAD_ERROR' | 'PLOT_RESPONSE_MALFORMED' | 'PIPELINE_ERROR' | 'UNKNOWN';
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
  /** All tools that executed this turn (in execution order). Single-tool turns have one entry. */
  executed_tools?: string[];
  /** Long-running tools deferred because one already executed this turn. */
  deferred_tools?: string[];
  /** Populated when the turn was driven by a system event. Additive — does not conflict with routing fields. */
  system_event?: { type: SystemEventType; event_id: string };
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
  /** Structured debug summaries. Only in non-production. */
  debug?: OrchestratorDebugPayload;
  /** DSK deterministic coaching items. Omitted when DSK_COACHING_ENABLED=false or both arrays empty. */
  dsk_coaching?: import("../schemas/dsk-coaching.js").DskCoachingItems;
  /** Server-constructed model receipt after draft_graph. */
  model_receipt?: ModelReceipt;
}

export interface OrchestratorDebugPayload {
  response_summary: {
    assistant_text_present: boolean;
    assistant_text_length: number;
    block_count_by_type: Record<string, number>;
    suggested_action_count: number;
    error_present: boolean;
  };
  turn_summary: {
    stage: string | null;
    response_mode_declared: string | null;
    response_mode_inferred: string | null;
    tool_selected: string | null;
    tool_permitted: boolean | null;
  };
  fallback_summary: {
    fallback_injected: boolean;
    fallback_reason: string | null;
  };
  contract_summary: {
    contract_violations_count: number;
    contract_violation_codes: string[];
  };
}

// ============================================================================
// Model Receipt — server-side metadata for the UI after draft_graph
// ============================================================================

export interface ModelReceipt {
  node_count: number;
  edge_count: number;
  option_labels: string[];
  goal_label: string | null;
  top_insight: string | null;
  readiness_status: string | null;
  repairs_applied_count: number;
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

export type BlockType = 'framing' | 'commentary' | 'graph_patch' | 'fact' | 'review_card' | 'brief' | 'evidence' | 'artefact';

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
  data: GraphPatchBlockData | FactBlockData | CommentaryBlockData | BriefBlockData | ReviewCardBlockData | FramingBlockData | EvidenceBlockData | ArtefactBlockData;
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

/**
 * PLoT emits repairs in two shapes:
 *  - Legacy: { action, field, from_value, reason, to_value }
 *  - F.5 canonical: { action, after, before, code, field, field_path, from_value, layer, reason, severity, to_value }
 *
 * `reason` is present in both — use it as the primary display field.
 * `code` is canonical-only — use it to identify repair type when available.
 */
export type RepairEntry =
  | {
      /** F.5 canonical shape */
      code: string;
      /** Origin layer: 'plot' for PLoT-applied repairs, 'cee' for CEE deterministic/boundary repairs */
      layer: 'plot' | 'cee';
      field_path: string;
      field?: string;
      before: unknown;
      after: unknown;
      from_value?: unknown;
      to_value?: unknown;
      reason: string;
      severity: 'info' | 'warn';
      action: string;
    }
  | {
      /** Legacy shape — no code, layer, or field_path */
      action: string;
      field: string;
      from_value: unknown;
      to_value: unknown;
      reason: string;
    };

export interface GraphPatchBlockData {
  patch_type: PatchType;
  operations: PatchOperation[];
  status: PatchStatus;
  /**
   * When true, the UI applies the patch immediately without an Accept/Dismiss gate.
   * Used for full_draft patches (draft_graph). Targeted edits (edit_graph) use false.
   */
  auto_apply?: boolean;
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
  /**
   * Analysis-ready payload from the draft pipeline (full_draft only).
   * Contains option intervention mappings, goal_node_id, and readiness status.
   * The UI uses this to populate the pre-analysis panel without a separate API call.
   */
  analysis_ready?: {
    options: Array<{
      option_id: string;
      label: string;
      status: string;
      interventions: Record<string, number>;
    }>;
    goal_node_id: string;
    status: string;
    blockers?: unknown[];
    model_adjustments?: unknown[];
    goal_threshold?: number;
  };
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

// ---- Evidence Block ----

/**
 * Evidence block — research findings from web search, grounded with citations.
 * Produced by research_topic tool. Claims and mapping suggestions are best-effort;
 * never auto-applied to the model — advisory only.
 */
export interface EvidenceBlockData {
  query: string;
  target_factor: string | null;
  findings: string;
  claims?: Array<{
    claim: string;
    value: string | null;
    time_period: string | null;
    context: string | null;
    source_url: string | null;
  }>;
  model_mapping_suggestions?: Array<{
    target_factor: string;
    suggested_update: string;
    confidence: 'direct' | 'inferred';
  }>;
  sources: Array<{ title: string; url: string }>;
  confidence_note: string;
}

// ---- Artefact Block ----

/**
 * Artefact block — self-contained HTML block for interactive decision-support
 * outputs (decision matrices, charts, comparison tables). Passed through to
 * the UI unchanged; rendered in a sandboxed iframe.
 */
export interface ArtefactBlockData {
  artefact_type: string;
  title: string;
  description?: string;
  /** Raw HTML — preserved exactly as generated, no escaping or transformation. */
  content: string;
  actions?: Array<{
    label: string;
    message: string;
  }>;
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
    constraints?: string[];
    options?: string[];
  } | null;
  messages: ConversationMessage[];
  event_log_summary?: string;
  selected_elements?: string[];
  scenario_id: string;
  analysis_inputs?: AnalysisInputs | null;
  conversational_state?: ConversationalState;
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
    case 'MISSING_GRAPH_STATE': return 400;
    case 'INTERNAL_PAYLOAD_ERROR': return 500;
    case 'PLOT_RESPONSE_MALFORMED': return 502;
    case 'PIPELINE_ERROR': return 500;
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

// ============================================================================
// Applied Changes Receipt — returned on successful edit_graph
// ============================================================================

export interface AppliedChangeItem {
  /** Human-readable element label. Never contains internal IDs. */
  label: string;
  /** Description of the change (old->new or new state if old unavailable). */
  description: string;
  /** Node/edge path for UI highlighting. Not shown to user. */
  element_ref: string;
}

/**
 * Structured receipt for a successful edit_graph operation.
 * Additive supplement to GraphPatchBlock — does not replace it.
 */
export interface AppliedChanges {
  /** One compact sentence describing the net change. No internal IDs. */
  summary: string;
  changes: AppliedChangeItem[];
  /** True when an existing analysis would be materially affected by this change. */
  rerun_recommended: boolean;
}
