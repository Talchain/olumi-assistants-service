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
import type { ToolInvocation, ParsedLLMResponse } from "../response-parser.js";
import type { PLoTClientRunOpts } from "../plot-client.js";
import type { ChatWithToolsResult, ChatWithToolsArgs, CallOpts } from "../../adapters/llm/types.js";
import type { GuidanceItem } from "../types/guidance-item.js";

// ============================================================================
// Shared Value Types
// ============================================================================

export type ProgressKind = 'changed_model' | 'ran_analysis' | 'added_evidence' | 'committed' | 'none';
export type IntentClassification = 'explain' | 'recommend' | 'act' | 'conversational';

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

  // Inferred state
  stage_indicator: StageIndicator;
  intent_classification: IntentClassification;
  decision_archetype: DecisionArchetype;
  progress_markers: ProgressKind[];
  stuck: StuckState;

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
  blocks: ConversationBlock[];
  suggested_actions: SuggestedAction[];
  analysis_response?: V2RunResponseEnvelope;

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
};
