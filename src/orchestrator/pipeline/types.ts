/**
 * V2 Pipeline Types
 *
 * Inter-phase data contracts for the five-phase orchestrator pipeline.
 * Every phase receives the output of the previous phase and adds its own enrichments.
 *
 * Reuses existing types from ../types.ts where they exist — does not duplicate.
 */

import type { FastifyRequest } from "fastify";
import type {
  ConversationContext,
  ConversationBlock,
  ConversationMessage,
  SuggestedAction,
  ConversationalState,
  PendingClarificationState,
  PendingProposalState,
  ProposedChangesPayload,
  SystemEvent,
  DecisionStage,
  V2RunResponseEnvelope,
  OrchestratorError,
  TurnPlan,
  GraphV3T,
  AnalysisInputs,
  GraphPatchBlockData,
} from "../types.js";
import type { GraphV3Compact } from "../context/graph-compact.js";
import type { AnalysisResponseSummary } from "../context/analysis-compact.js";
import type { DecisionContinuity } from "../context/decision-continuity.js";
import type { ToolInvocation, ParsedLLMResponse } from "../response-parser.js";
import type { PLoTClientRunOpts } from "../plot-client.js";
import type { ChatWithToolsResult, ChatWithToolsArgs, CallOpts } from "../../adapters/llm/types.js";
import type { GuidanceItem } from "../types/guidance-item.js";
import type { EditGraphTraceDiagnostics } from "../tools/edit-graph.js";

// ============================================================================
// Shared Value Types
// ============================================================================

export type ProgressKind = 'changed_model' | 'ran_analysis' | 'added_evidence' | 'committed' | 'none';
export type IntentClassification = 'explain' | 'recommend' | 'act' | 'conversational';
export type RouteOutcome =
  | 'default_llm'
  | 'explicit_generate'
  | 'generation_clarification'
  | 'clarification_continuation'
  | 'proposal_created'
  | 'proposal_confirmation'
  | 'proposal_dismissal'
  | 'proposal_stale_dismissal'
  | 'results_explanation'
  | 'rationale_explanation'
  | 'direct_analysis_ack_only'
  | 'direct_analysis_with_narration'
  | 'direct_analysis_narration_skipped';

export interface RouteMetadata {
  outcome: RouteOutcome;
  reasoning: string;
  // Extended observability fields (populated by envelope assembler)
  tool_selected?: string | null;
  tool_permitted?: boolean;
  response_mode?: string | null;
  turn_type?: string | null;
  has_graph?: boolean;
  has_analysis?: boolean;
  contract_version?: string;
  // Model observability (populated by phase3-llm after LLM call)
  resolved_model?: string | null;
  resolved_provider?: string | null;
}

export type TriggerSource =
  | 'user_message'
  | 'system_event'
  | 'direct_analysis_run'
  | 'analysis_complete_followup'
  | 'chip'
  | 'dock_action';

export interface IntentGateDebugSummary {
  routing: 'deterministic' | 'llm';
  tool: string | null;
  matched_pattern: string | null;
  confidence?: string | null;
}

export interface Phase3RouteDebug {
  initial_intent_gate: IntentGateDebugSummary;
  final_intent_gate: IntentGateDebugSummary;
  deterministic_override: {
    applied: boolean;
    reason: string | null;
  };
  explicit_generate_override: {
    considered: boolean;
    applied: boolean;
    reason: string | null;
  };
  explain_results_selection: {
    considered: boolean;
    selected: boolean;
    reason: string | null;
    explanation_path: 'rationale_explanation' | 'results_explanation' | null;
  };
  clarification_continuation: {
    present: boolean;
    grouped: boolean;
  };
  pending_proposal_followup: {
    present: boolean;
    action: 'confirm' | 'dismiss' | 'stale' | null;
  };
  post_analysis_followup: {
    triggered: boolean;
    reason: string | null;
  };
  draft_graph_selection: {
    considered: boolean;
    selected: boolean;
    reason: string | null;
  };
}

export interface TurnDebugBundle {
  request_id: string;
  turn_id: string;
  scenario_id: string;
  trigger_source: TriggerSource;
  processed_user_message: string | null;
  recent_conversation: Array<{
    role: 'user' | 'assistant';
    text: string;
  }>;
  stage_from_ui: string | null;
  stage_inferred: string | null;
  intent_classification: string | null;
  initial_intent_gate: IntentGateDebugSummary;
  final_route: {
    routing: 'deterministic' | 'llm';
    selected_tool: string | null;
    route_outcome: RouteOutcome | null;
    route_reasoning: string | null;
  };
  route_decisions: Phase3RouteDebug | null;
  analysis_state: {
    present: boolean;
    explainable: boolean;
    current: boolean;
    runnable: boolean;
  };
  clarification_state: {
    present: boolean;
    candidate_labels: string[];
  };
  pending_proposal_state: {
    present: boolean;
    summary: string | null;
  };
  grouped_continuation_used: boolean;
  outcome: 'blocked' | 'clarified' | 'proposed' | 'applied' | 'narrated' | 'failed' | 'answered';
  failure: {
    branch: string | null;
    code: string | null;
    message: string | null;
  };
  direct_analysis_run: {
    source_context: string | null;
    narration_branch: string | null;
    stale_state_reused: boolean | null;
  } | null;
}

export interface StageIndicator {
  stage: DecisionStage;
  substate?: 'needs_run' | 'has_run' | 'ready_to_commit' | 'committed';
  confidence: 'high' | 'medium' | 'low';
  source: 'explicit_event' | 'inferred';
}

export interface DecisionArchetype {
  type: string | null;
  confidence: 'high' | 'medium' | 'low';
  evidence: string;
}

export interface StuckState {
  detected: boolean;
  rescue_routes: SuggestedAction[];
}

// ============================================================================
// Science / Specialist Placeholder Types
// ============================================================================

/** Placeholder — populated by A.9 (DSK loader). */
export interface ClaimReference {
  claim_id: string;
  claim_version: string;
}

/** Placeholder — populated by A.10 (science annotations). */
export interface ScienceAnnotation {
  span_start: number;
  span_end: number;
  span_text: string;
  claim_id: string;
  claim_version: string;
  category: 'empirical' | 'technique_efficacy' | 'causal_rule' | 'population';
}

/** Placeholder — populated by A.12 (claims ledger). */
export interface TechniqueReference {
  technique_id: string;
  technique_version: string;
}

/** Placeholder — populated post-pilot (specialist routing). */
export interface SpecialistAdvice {
  specialist_id: string;
  recommendation: string;
  confidence: number;
}

/** Placeholder — populated post-pilot (specialist routing). */
export interface SpecialistAdviceCandidate {
  specialist_id: string;
  score: number;
  reason: string;
}

/** Placeholder — populated by A.9 (DSK loader). */
export interface DSKTrigger {
  trigger_id: string;
  condition: string;
}

/** Placeholder — populated by A.9 (DSK loader). */
export interface DSKTechnique {
  technique_id: string;
  name: string;
}

// ============================================================================
// Entity Detail (for entity-aware context enrichment)
// ============================================================================

export interface ReferencedEntityEdgeSummary {
  connected_label: string;
  strength: number;
  effect_direction?: string;
}

export interface ReferencedEntityDetail {
  id: string;
  label: string;
  kind: string;
  category?: string;
  value?: number;
  raw_value?: number;
  unit?: string;
  cap?: number;
  source?: string;
  edges: ReferencedEntityEdgeSummary[];
}

// ============================================================================
// Phase 1 Output — EnrichedContext
// ============================================================================

export interface EnrichedContext {
  // Scenario state (loaded from request)
  graph: GraphV3T | null;
  analysis: V2RunResponseEnvelope | null;
  framing: ConversationContext['framing'];
  conversation_history: ConversationMessage[];
  selected_elements: string[];

  // Context management (populated by Phase 1 context management layer)
  graph_compact?: GraphV3Compact;              // compact graph for LLM context
  analysis_response?: AnalysisResponseSummary; // compact analysis summary
  messages?: ConversationMessage[];            // trimmed to 5 turns (optional for backward compat)
  event_log_summary?: string;                  // from buildEventLogSummary
  selected_node_ids?: string[];                // from selected_elements (node IDs)
  selected_edge_ids?: string[];                // from selected_elements (edge IDs)
  context_hash?: string;                       // from computeContextHash
  analysis_inputs?: AnalysisInputs | null;     // passed through from request for run_analysis tool
  /** Decision continuity summary — populated by Phase 1 after compaction. */
  decision_continuity?: DecisionContinuity;
  /** Entity-aware detail blocks — populated by Phase 1 when message references graph entities. */
  referenced_entities?: ReferencedEntityDetail[];

  // Inferred state
  stage_indicator: StageIndicator;
  intent_classification: IntentClassification;
  decision_archetype: DecisionArchetype;
  progress_markers: ProgressKind[];
  stuck: StuckState;
  conversational_state: ConversationalState;

  // DSK (stubbed — populated by A.9)
  dsk: {
    claims: ClaimReference[];
    triggers: DSKTrigger[];
    techniques: DSKTechnique[];
    version_hash: string | null;
  };

  // User profile (stubbed — populated by A.4+)
  user_profile: {
    coaching_style: 'socratic';
    calibration_tendency: 'unknown';
    challenge_tolerance: 'medium';
  };

  // System
  scenario_id: string;
  turn_id: string;
  system_event?: SystemEvent;
  user_message?: string;
}

// ============================================================================
// Phase 2 Output — SpecialistResult
// ============================================================================

export interface SpecialistResult {
  advice: SpecialistAdvice | null;
  candidates: SpecialistAdviceCandidate[];
  triggers_fired: string[];
  triggers_suppressed: string[];
}

// ============================================================================
// Phase 3 Output — LLMResult
// ============================================================================

export interface LLMResult {
  assistant_text: string | null;
  tool_invocations: ToolInvocation[];
  science_annotations: ScienceAnnotation[];
  raw_response: string;
  suggested_actions: SuggestedAction[];
  diagnostics: string | null;
  parse_warnings: string[];
  route_metadata?: RouteMetadata;
  route_debug?: Phase3RouteDebug;
}

// ============================================================================
// Phase 4 Output — ToolResult
// ============================================================================

export interface ToolResult {
  blocks: ConversationBlock[];
  side_effects: {
    graph_updated: boolean;
    analysis_ran: boolean;
    brief_generated: boolean;
  };
  assistant_text: string | null;
  analysis_response?: V2RunResponseEnvelope;
  tool_latency_ms?: number;
  /** GuidanceItems generated by this tool execution. Always present; defaults to []. */
  guidance_items: GuidanceItem[];
  /** Suggested follow-up actions from tool handler (e.g. "Re-run analysis" after edit_graph). */
  suggested_actions?: SuggestedAction[];
  /** edit_graph-only diagnostics for turn trace. */
  edit_graph_diagnostics?: EditGraphTraceDiagnostics;
  pending_clarification?: PendingClarificationState;
  pending_proposal?: PendingProposalState;
  proposed_changes?: ProposedChangesPayload;
  route_metadata?: RouteMetadata;
  /** Applied change receipt from a successful edit_graph. Absent on failed edits. */
  applied_changes?: Record<string, unknown>;
  /** Which explain_results tier resolved this turn: 1 = cached, 2 = review data, 3 = LLM. */
  deterministic_answer_tier?: 1 | 2 | 3;
}

// ============================================================================
// Phase 5 Output — OrchestratorResponseEnvelopeV2
// ============================================================================

export interface ScienceLedger {
  claims_used: ClaimReference[];
  techniques_used: TechniqueReference[];
  scope_violations: string[];
  phrasing_violations: string[];
  rewrite_applied: boolean;
}

export interface OrchestratorResponseEnvelopeV2 {
  turn_id: string;
  assistant_text: string | null;
  assistant_tool_calls?: Array<{ name: string; input: Record<string, unknown> }>;
  blocks: ConversationBlock[];
  suggested_actions: SuggestedAction[];
  proposed_changes?: ProposedChangesPayload;
  analysis_response?: V2RunResponseEnvelope;
  /**
   * Applied change receipt from a successful edit_graph operation.
   * Additive UI supplement — does not replace GraphPatchBlock.
   * Absent when edit was rejected or no edit occurred this turn.
   */
  applied_changes?: Record<string, unknown>;
  /**
   * Which explain_results tier resolved this turn.
   * 1 = cached deterministic, 2 = review data, 3 = LLM call.
   * Absent when explain_results was not used.
   */
  deterministic_answer_tier?: 1 | 2 | 3;

  lineage: {
    context_hash: string;
    plan_hash?: string;
    response_hash?: string;
    dsk_version_hash: string | null;
  };

  stage_indicator: {
    stage: DecisionStage;
    substate?: string;
    confidence: 'high' | 'medium' | 'low';
    source: 'explicit_event' | 'inferred';
    transition?: { from: DecisionStage; to: DecisionStage; trigger: string };
  };

  science_ledger: ScienceLedger;

  progress_marker: {
    kind: ProgressKind;
  };

  observability: {
    triggers_fired: string[];
    triggers_suppressed: string[];
    intent_classification: string;
    specialist_contributions: SpecialistAdvice[];
    specialist_disagreement: null;
  };

  turn_plan: TurnPlan;

  /**
   * Structured coaching items generated from this turn's tool execution.
   * Always present; defaults to []. Additive — existing consumers that don't
   * read this field are unaffected.
   */
  guidance_items: GuidanceItem[];

  /**
   * Envelope-level analysis readiness computed from the current graph state.
   * The UI uses this to enable/disable the Analyse button.
   * Absent when no graph exists. Computed via computeStructuralReadiness().
   */
  analysis_ready?: GraphPatchBlockData['analysis_ready'];

  /**
   * When run_analysis returns blocked/failed — from PLoT V2RunError (422) or CEE prereq check.
   * V2 contract: analysis failures communicated via analysis_status, not HTTP status.
   */
  analysis_status?: string;
  status_reason?: string;
  retryable?: boolean;
  critiques?: unknown[];
  meta?: Record<string, unknown>;

  error?: {
    code: string;
    message: string;
  };

  /** Server-constructed model receipt after draft_graph. */
  model_receipt?: import("../types.js").ModelReceipt;

  /** Diagnostics content from LLM. Non-production only. */
  diagnostics?: string;
  /** Parse warnings from XML envelope extraction. Non-production only. */
  parse_warnings?: string[];
  _route_metadata?: RouteMetadata;
  _debug_bundle?: TurnDebugBundle;
  /**
   * Contract violation codes from Phase 5 validation. Populated by phase5Validate
   * when violations are found; used by emitTurnTrace for structured log diagnostics.
   * Internal — not serialised to the HTTP response.
   */
  _contract_violation_codes?: string[];
}

// ============================================================================
// Dependency Injection Interfaces
// ============================================================================

export interface LLMClient {
  chatWithTools(
    args: ChatWithToolsArgs,
    opts: CallOpts,
  ): Promise<ChatWithToolsResult>;

  chat(
    options: { system: string; userMessage: string },
    config: { requestId: string; timeoutMs: number },
  ): Promise<{ content: string }>;

  /**
   * Return the resolved model ID and provider name for the last call.
   * Optional — production client implements this; test mocks may omit it.
   */
  getResolvedModel?(): { model: string; provider: string } | null;
}

export interface ToolDispatcher {
  dispatch(
    toolName: string,
    toolInput: Record<string, unknown>,
    context: ConversationContext,
    turnId: string,
    requestId: string,
    options?: { plotOpts?: PLoTClientRunOpts; request?: FastifyRequest; intentClassification?: string },
  ): Promise<ToolResult>;
}

export interface PipelineDeps {
  llmClient: LLMClient;
  toolDispatcher: ToolDispatcher;
  /** PLoT client for system event routing (validate-patch). Optional — omit in tests that don't exercise PLoT. */
  plotClient?: import("../plot-client.js").PLoTClient | null;
  /** PLoT call opts (turn budget, signal). Passed to system event router. */
  plotOpts?: PLoTClientRunOpts;
}

// ============================================================================
// Re-exports for convenience
// ============================================================================

export type {
  ConversationContext,
  ConversationBlock,
  ConversationMessage,
  SuggestedAction,
  ConversationalState,
  ProposedChangesPayload,
  SystemEvent,
  DecisionStage,
  V2RunResponseEnvelope,
  OrchestratorError,
  TurnPlan,
  GraphV3T,
  ToolInvocation,
  ParsedLLMResponse,
  PLoTClientRunOpts,
  FastifyRequest,
  ChatWithToolsResult,
  ChatWithToolsArgs,
  CallOpts,
  GraphV3Compact,
  AnalysisResponseSummary,
  GuidanceItem,
  DecisionContinuity,
};
