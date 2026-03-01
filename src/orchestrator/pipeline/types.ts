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
} from "../types.js";
import type { ToolInvocation, ParsedLLMResponse } from "../response-parser.js";
import type { PLoTClientRunOpts } from "../plot-client.js";
import type { ChatWithToolsResult, ChatWithToolsArgs, CallOpts } from "../../adapters/llm/types.js";

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

  error?: {
    code: string;
    message: string;
  };

  /** Diagnostics content from LLM. Non-production only. */
  diagnostics?: string;
  /** Parse warnings from XML envelope extraction. Non-production only. */
  parse_warnings?: string[];
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
    options?: { plotOpts?: PLoTClientRunOpts; request?: FastifyRequest },
  ): Promise<ToolResult>;
}

export interface PipelineDeps {
  llmClient: LLMClient;
  toolDispatcher: ToolDispatcher;
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
};
