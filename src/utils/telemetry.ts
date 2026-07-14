import { env } from "node:process";
import { createHash, randomBytes } from "crypto";
import pino from "pino";
import { StatsD } from "hot-shots";
import { createLoggerConfig } from "./logger-config.js";

/**
 * Server salt for IP hashing (stable for session correlation, not stored)
 * Uses IP_HASH_SALT env var or generates once at boot.
 * Centralized here to ensure consistent hashing across all modules.
 */
const IP_HASH_SALT = env.IP_HASH_SALT || randomBytes(16).toString('hex');

/**
 * Hash IP address for telemetry/logging (avoids storing raw PII)
 * Returns first 12 chars of SHA-256 hash (enough for correlation, not reconstruction)
 */
export function hashIP(ip: string): string {
  return createHash('sha256').update(IP_HASH_SALT + ip).digest('hex').substring(0, 12);
}

/**
 * Pino logger with secret/PII redaction
 *
 * Redacts sensitive fields to prevent accidental exposure in logs.
 * Paths use wildcards to match nested objects at any depth.
 *
 * SECURITY: Redaction paths centralized in src/utils/logger-config.ts
 * to ensure both Fastify and standalone Pino loggers stay in sync.
 */
export const log = pino(createLoggerConfig(env.LOG_LEVEL || "info"));

/**
 * Test sink for capturing telemetry events in tests (v1.11.0)
 * Only used when NODE_ENV=test or VITEST=true
 */
let testSink: ((eventName: string, data: Record<string, any>) => void) | null = null;

export function setTestSink(sink: ((eventName: string, data: Record<string, any>) => void) | null): void {
  // Safety check: only allow in test environment
  // Use direct env check to avoid circular dependency issues during module initialization
  const isTestEnv = env.NODE_ENV === 'test' || env.VITEST === 'true' || Boolean(env.VITEST);
  if (!isTestEnv) {
    throw new Error('setTestSink() can only be used in test environment');
  }
  testSink = sink;
}

/**
 * Frozen telemetry event names (v04 spec)
 * DO NOT modify these names without updating CI guards and dashboards
 */
export const TelemetryEvents = {
  // Core lifecycle events
  DraftStarted: "assist.draft.started",
  DraftCompleted: "assist.draft.completed",

  // CEE v1 Draft My Model events (v1.12.0)
  CeeDraftGraphRequested: "cee.draft_graph.requested",
  CeeDraftGraphSucceeded: "cee.draft_graph.succeeded",
  CeeDraftGraphFailed: "cee.draft_graph.failed",

  // v0.11.0 schema amendment — observable transition signals.
  // LegacyCoachingValueNormalised fires once per substituted off-enum
  // bias_category / bias_signal value at the Anthropic adapter ingress
  // seam. Removable after v194 prompt deployment + 7 consecutive days of
  // zero events.
  // ContractDefaultApplied fires whenever the schema-valid empty coaching
  // default is inserted at Stage 5 Package — should be zero in production
  // after v194 ships; non-zero indicates a prompt regression.
  DraftGraphLegacyCoachingValueNormalised: "cee.draft_graph.legacy_coaching_value_normalised",
  DraftGraphContractDefaultApplied: "cee.draft_graph.contract_default_applied",

  // Lane 3 (2026-07-07): structured-outputs degradation must NOT be silent.
  // Fires (alongside the WARN-level pino log at the call site) when the
  // Anthropic adapter's draft_graph structured-outputs request is rejected
  // by the API (e.g. "compiled grammar is too large") and the call falls
  // back to prompt-only JSON mode. Non-zero in production means every
  // draft is paying the slow un-constrained path — investigate the schema
  // grammar budget (tests/unit/anthropic-graph-schema-grammar-budget.test.ts).
  CeeStructuredOutputsFellBack: "cee.draft_graph.structured_outputs_fell_back",

  CeeExplainGraphRequested: "cee.explain_graph.requested",
  CeeExplainGraphSucceeded: "cee.explain_graph.succeeded",
  CeeExplainGraphFailed: "cee.explain_graph.failed",

  CeeEvidenceHelperRequested: "cee.evidence_helper.requested",
  CeeEvidenceHelperSucceeded: "cee.evidence_helper.succeeded",
  CeeEvidenceHelperFailed: "cee.evidence_helper.failed",

  CeeBiasCheckRequested: "cee.bias_check.requested",
  CeeBiasCheckSucceeded: "cee.bias_check.succeeded",
  CeeBiasCheckFailed: "cee.bias_check.failed",

  CeeGraphReadinessRequested: "cee.graph_readiness.requested",
  CeeGraphReadinessCompleted: "cee.graph_readiness.completed",
  CeeGraphReadinessFailed: "cee.graph_readiness.failed",

  CeeOptionsRequested: "cee.options.requested",
  CeeOptionsSucceeded: "cee.options.succeeded",
  CeeOptionsFailed: "cee.options.failed",

  // Stage 4 pre-LLM-repair fail-fast gate for OPTIONS_IDENTICAL. Emitted by
  // src/cee/unified-pipeline/stages/repair/index.ts when the deterministic
  // sweep leaves an OPTIONS_IDENTICAL violation — that class has repeatedly
  // failed `repair_graph` revalidation, so we bypass the LLM call and emit
  // a fail-fast clarification-shaped CEE_GRAPH_INVALID instead.
  CeeOptionsIdenticalBypass: "cee.options_identical.pre_repair_bypass",

  // Graceful-dedup variant of the above (ROADMAP 2.53 mitigation rung 1).
  // Fires when the duplicate group that reached the bypass consisted
  // entirely of AI-inferred options (no explicit is_baseline, no
  // baseline-shaped label/id, no from_brief extraction marker) and >=2
  // usable options remained after dropping the duplicate(s) — the draft
  // CONTINUES instead of failing fast. The pre_repair_bypass event above
  // keeps firing for the still-erroring residual, so the combined rate of
  // the two events tracks the underlying LLM collision rate. See
  // src/cee/unified-pipeline/stages/repair/options-identical-graceful-dedup.ts.
  CeeOptionsIdenticalDroppedDuplicate: "cee.options_identical.dropped_duplicate",

  // Stage 4 Substep 0.9 — deterministic auto-baseline dedup. Fires when
  // the LLM-injected status-quo option (with explicit is_baseline=true)
  // duplicates an explicit option's intervention signature; drops the
  // baseline so OPTIONS_IDENTICAL never gets raised for this known
  // LLM-artefact case. See
  // src/cee/unified-pipeline/stages/repair/auto-baseline-dedup.ts.
  CeeAutoBaselineDedupApplied: "cee.auto_baseline_dedup.applied",

  // Diagnostic-only counterpart to the above. Fires when a duplicate
  // group contains options that LOOK like baselines by label / id-suffix
  // heuristic but lack the explicit is_baseline flag. The dedup substep
  // does NOT mutate the graph in this case (it would risk deleting a
  // user-explicit option with a baseline-shaped label) — the collision
  // flows through to the PR #202 OPTIONS_IDENTICAL typed-clarification
  // bypass. The event surfaces LLM prompt drift to operators (the
  // draft_graph prompt mandates is_baseline=true on status-quo options).
  CeeAutoBaselineHeuristicOnlyCollision: "cee.auto_baseline_dedup.heuristic_only_collision",

  // V5 route-v2 frame-stage no-brief guard. Fires when a frame-stage
  // message arrives with no graph yet but does NOT match the
  // draft_graph trigger regex — typically a retry after a failed
  // draft_graph, or a user reply that isn't a fresh decision brief.
  // Replaces the "I couldn't complete that turn cleanly" generic
  // TurnExecutor max_tokens fallback with a deterministic framing
  // prompt. See src/orchestrator/route-v2.ts (frame_no_brief_guard).
  V5FrameStageNoBriefGuard: "v5.frame_stage_no_brief_guard",

  CeeSensitivityCoachRequested: "cee.sensitivity_coach.requested",
  CeeSensitivityCoachSucceeded: "cee.sensitivity_coach.succeeded",
  CeeSensitivityCoachFailed: "cee.sensitivity_coach.failed",

  CeeTeamPerspectivesRequested: "cee.team_perspectives.requested",
  CeeTeamPerspectivesSucceeded: "cee.team_perspectives.succeeded",
  CeeTeamPerspectivesFailed: "cee.team_perspectives.failed",

  CeeKeyInsightRequested: "cee.key_insight.requested",
  CeeKeyInsightSucceeded: "cee.key_insight.succeeded",
  CeeKeyInsightFailed: "cee.key_insight.failed",

  CeeElicitBeliefRequested: "cee.elicit_belief.requested",
  CeeElicitBeliefSucceeded: "cee.elicit_belief.succeeded",
  CeeElicitBeliefFailed: "cee.elicit_belief.failed",

  CeeUtilityWeightRequested: "cee.utility_weight.requested",
  CeeUtilityWeightSucceeded: "cee.utility_weight.succeeded",
  CeeUtilityWeightFailed: "cee.utility_weight.failed",

  CeeRiskToleranceRequested: "cee.risk_tolerance.requested",
  CeeRiskToleranceSucceeded: "cee.risk_tolerance.succeeded",
  CeeRiskToleranceFailed: "cee.risk_tolerance.failed",

  CeeEdgeFunctionRequested: "cee.edge_function.requested",
  CeeEdgeFunctionCompleted: "cee.edge_function.completed",
  CeeEdgeFunctionFailed: "cee.edge_function.failed",

  CeeGenerateRecommendationRequested: "cee.generate_recommendation.requested",
  CeeGenerateRecommendationCompleted: "cee.generate_recommendation.completed",
  CeeGenerateRecommendationFailed: "cee.generate_recommendation.failed",

  CeeNarrateConditionsRequested: "cee.narrate_conditions.requested",
  CeeNarrateConditionsCompleted: "cee.narrate_conditions.completed",
  CeeNarrateConditionsFailed: "cee.narrate_conditions.failed",

  CeeExplainPolicyRequested: "cee.explain_policy.requested",
  CeeExplainPolicyCompleted: "cee.explain_policy.completed",
  CeeExplainPolicyFailed: "cee.explain_policy.failed",

  // CEE Preference Elicitation events (Brief 9)
  CeeElicitPreferencesRequested: "cee.elicit_preferences.requested",
  CeeElicitPreferencesSucceeded: "cee.elicit_preferences.succeeded",
  CeeElicitPreferencesFailed: "cee.elicit_preferences.failed",

  CeeElicitPreferencesAnswerRequested: "cee.elicit_preferences_answer.requested",
  CeeElicitPreferencesAnswerSucceeded: "cee.elicit_preferences_answer.succeeded",
  CeeElicitPreferencesAnswerFailed: "cee.elicit_preferences_answer.failed",

  CeeExplainTradeoffRequested: "cee.explain_tradeoff.requested",
  CeeExplainTradeoffSucceeded: "cee.explain_tradeoff.succeeded",
  CeeExplainTradeoffFailed: "cee.explain_tradeoff.failed",

  // CEE Ask endpoint events (Working Set)
  CeeAskRequested: "cee.ask.requested",
  CeeAskCompleted: "cee.ask.completed",
  CeeAskFailed: "cee.ask.failed",

  // CEE Review endpoint events (M1 Orchestrator)
  CeeReviewRequested: "cee.review.requested",
  CeeReviewSucceeded: "cee.review.succeeded",
  CeeReviewFailed: "cee.review.failed",

  // CEE Decision Review endpoint events (M2) - unique events only
  // Note: Requested/Succeeded/Failed use existing DecisionReviewRequested etc.
  CeeDecisionReviewPromptLoaded: "cee.decision_review.prompt_loaded",
  CeeDecisionReviewLlmCallStarted: "cee.decision_review.llm_call_started",
  CeeDecisionReviewLlmCallCompleted: "cee.decision_review.llm_call_completed",
  CeeDecisionReviewJsonExtracted: "cee.decision_review.json_extracted",
  CeeDecisionReviewShapeCheckFailed: "cee.decision_review.shape_check_failed",
  CeeDecisionReviewShapeCheckWarnings: "cee.decision_review.shape_check_warnings",

  // V04: Upstream telemetry events
  DraftUpstreamSuccess: "assist.draft.upstream_success",
  DraftUpstreamError: "assist.draft.upstream_error",

  // SSE streaming events
  SSEStarted: "assist.draft.sse_started",
  SSECompleted: "assist.draft.sse_completed",
  SSEError: "assist.draft.sse_error",
  FixtureShown: "assist.draft.fixture_shown",
  FixtureReplaced: "assist.draft.fixture_replaced",
  LegacySSEPath: "assist.draft.legacy_sse_path",

  // Validation and repair events
  ValidationFailed: "assist.draft.validation_failed",
  RepairAttempted: "assist.draft.repair_attempted",
  RepairStart: "assist.draft.repair_start",
  RepairSuccess: "assist.draft.repair_success",
  RepairPartial: "assist.draft.repair_partial",
  RepairFallback: "assist.draft.repair_fallback",

  // Preflight validation events (v1.13)
  PreflightValidationPassed: "cee.preflight.passed",
  PreflightValidationFailed: "cee.preflight.failed",
  PreflightReadinessAssessed: "cee.preflight.readiness_assessed",
  PreflightRejected: "cee.preflight.rejected",
  // Structured preflight outcome event with full calibration fields (v1.17)
  PreflightCompleted: "cee.preflight.completed",
  // BriefSignals v1 — deterministic brief quality extraction
  CeeBriefSignals: "cee.brief_signals",

  // CEE verification events (v1.14)
  CeeVerificationSucceeded: "cee.verification.succeeded",
  CeeVerificationFailed: "cee.verification.failed",

  // Edge direction validation events (Brief G)
  EdgeDirectionViolationDetected: "cee.edge_direction.violation_detected",
  EdgeDirectionValidationPassed: "cee.edge_direction.validation_passed",

  // Uniform strength detection (LLM output quality)
  CeeUniformStrengthsDetected: "cee.draft_graph.uniform_strengths_detected",

  // Goal inference (defence-in-depth for missing goal nodes)
  CeeGoalInferred: "cee.draft_graph.goal_inferred",

  // Deterministic graph enforcement (Stage 4 substep 9b)
  CeeInboundSumRescaled: "cee.draft_graph.inbound_sum_rescaled",
  CeeBridgeChainRepaired: "cee.draft_graph.bridge_chain_repaired",
  CeeEnforcementCompleted: "cee.draft_graph.enforcement_completed",
  CeeEnforcementEdgeSkipped: "cee.draft_graph.enforcement_edge_skipped",
  CeeEnforcementPostValidationErrors: "cee.draft_graph.enforcement_post_validation_errors",
  CeeEnforcementPostValidationWarnings: "cee.draft_graph.enforcement_post_validation_warnings",
  CeeEnforcementPostValidationFailed: "cee.draft_graph.enforcement_post_validation_failed",
  CeeEnforcementBlocked: "cee.draft_graph.enforcement_blocked",

  // Connectivity validation (P0 diagnostics)
  CeeConnectivityCheck: "cee.draft_graph.connectivity_check",

  NodeKindNormalized: "llm.normalization.node_kind_mapped",
  FactorBaselineDefaulted: "cee.factor.baseline_defaulted",
  InterventionsMissingDefaulted: "cee.option.interventions_missing_defaulted",

  // JSON extraction events (model output normalization)
  JsonExtractionRequired: "llm.json_extraction.required",

  // Repair prompt truncation event (large graph handling)
  RepairPromptTruncated: "llm.repair_prompt.truncated",

  // Goal generation tracking (prompt tuning)
  GoalGeneration: "cee.goal_generation",

  // Clarification enforcement events (v1.14 - Phase 5)
  ClarificationRequired: "cee.clarification.required",
  ClarificationBypassAllowed: "cee.clarification.bypass_allowed",

  // Clarifier events (v04)
  ClarifierRoundStart: "assist.clarifier.round_start",
  ClarifierRoundComplete: "assist.clarifier.round_complete",
  ClarifierRoundFailed: "assist.clarifier.round_failed",

  // Multi-turn clarifier integration events (v1.15)
  CeeClarifierSessionStart: "cee.clarifier.session_start",
  CeeClarifierQuestionAsked: "cee.clarifier.question_asked",
  CeeClarifierAnswerReceived: "cee.clarifier.answer_received",
  CeeClarifierAnswerIncorporated: "cee.clarifier.answer_incorporated",
  CeeClarifierConverged: "cee.clarifier.converged",
  CeeClarifierQuestionCached: "cee.clarifier.question_cached",
  CeeClarifierQuestionRetrieved: "cee.clarifier.question_retrieved",
  CeeClarifierFailed: "cee.clarifier.failed",
  CeeClarifierSkipped: "cee.clarifier.skipped",

  // Critique events (v04)
  CritiqueStart: "assist.critique.start",
  CritiqueComplete: "assist.critique.complete",
  CritiqueFailed: "assist.critique.failed",

  // Suggest Options events (v04)
  SuggestOptionsStart: "assist.suggest_options.start",
  SuggestOptionsComplete: "assist.suggest_options.complete",
  SuggestOptionsFailed: "assist.suggest_options.failed",

  // Explain Diff events (v04)
  ExplainDiffStart: "assist.explain_diff.start",
  ExplainDiffComplete: "assist.explain_diff.complete",
  ExplainDiffFailed: "assist.explain_diff.failed",

  // Auth events (v1.3.0)
  AuthSuccess: "assist.auth.success",
  AuthFailed: "assist.auth.failed",
  RateLimited: "assist.auth.rate_limited",

  // User-JWT identity events (login 3.4 CEE-half — CEE_REQUIRE_USER_JWT).
  // Emitted ONLY when the flag is on; the flag-off path is dormant.
  UserJwtVerified: "assist.auth.user_jwt_verified",
  UserJwtRefused: "assist.auth.user_jwt_refused",
  UserJwtIdentityMismatch: "assist.auth.user_jwt_identity_mismatch",
  UserJwtServiceCallerLegacy: "assist.auth.user_jwt_service_caller_legacy",

  // Guard violations
  GuardViolation: "assist.draft.guard_violation",

  // Deprecation tracking
  LegacyProvenance: "assist.draft.legacy_provenance",

  // LLM retry events (v1.2.1)
  LlmRetry: "assist.llm.retry",
  LlmRetrySuccess: "assist.llm.retry_success",
  LlmRetryExhausted: "assist.llm.retry_exhausted",

  // Provider failover events (v1.6.0)
  ProviderFailover: "assist.llm.provider_failover",
  ProviderFailoverSuccess: "assist.llm.provider_failover_success",
  ProviderFailoverExhausted: "assist.llm.provider_failover_exhausted",

  // SSE client events (v1.2.1)
  SseClientClosed: "assist.draft.sse_client_closed",

  // Share events (v1.6.0)
  ShareCreated: "assist.share.created",
  ShareAccessed: "assist.share.accessed",
  ShareRevoked: "assist.share.revoked",
  ShareExpired: "assist.share.expired",
  ShareNotFound: "assist.share.not_found",

  // Prompt cache events (v1.6.0)
  PromptCacheHit: "assist.llm.prompt_cache_hit",
  PromptCacheMiss: "assist.llm.prompt_cache_miss",
  PromptCacheEviction: "assist.llm.prompt_cache_eviction",

  ValidationCacheHit: "assist.draft.validation_cache_hit",
  ValidationCacheMiss: "assist.draft.validation_cache_miss",
  ValidationCacheBypass: "assist.draft.validation_cache_bypass",

  AnthropicPromptCacheHint: "assist.llm.anthropic_prompt_cache_hint",

  // V5 routing prompt-cache observability (one event per chatWithTools call
  // out of route-with-tool-use.ts; covers cached, disabled-by-config, and
  // cache_control-rejection fallback paths).
  V5PromptCache: "v5.prompt_cache",
  CostCalculationUnknownModel: "assist.cost_calculation.unknown_model",
  // SSE Resume events (v1.8.0)
  SseResumeIssued: "assist.sse.resume_issued",
  SseResumeAttempt: "assist.sse.resume_attempt",
  SseResumeSuccess: "assist.sse.resume_success",
  SseResumeExpired: "assist.sse.resume_expired",
  SseResumeIncompatible: "assist.sse.resume_incompatible",
  SseResumeReplayCount: "assist.sse.resume_replay_count",
  SsePartialRecovery: "assist.sse.partial_recovery",
  SseBufferTrimmed: "assist.sse.buffer_trimmed",
  SseSnapshotCreated: "assist.sse.snapshot_created",

  // SSE Live Resume events (v1.9.0)
  SseResumeLiveStart: "assist.sse.resume_live_start",
  SseResumeLiveContinue: "assist.sse.resume_live_continue",
  SseResumeLiveEnd: "assist.sse.resume_live_end",
  SseSnapshotRenewed: "assist.sse.snapshot_renewed",

  // SSE degraded mode events (v1.11.0)
  SseDegradedMode: "assist.sse.degraded_mode",

  // ISL config events (v1.13.0)
  IslConfigInvalidTimeout: "isl.config.invalid_timeout",
  IslConfigInvalidMaxRetries: "isl.config.invalid_max_retries",
  IslConfigTimeoutClamped: "isl.config.timeout_clamped",
  IslConfigRetriesClamped: "isl.config.retries_clamped",

  // Internal stage events (for debugging)
  Stage: "assist.draft.stage",

  // Prompt Management events (v2.0)
  PromptStoreError: "prompt.store_error",
  PromptLoaderError: "prompt.loader.error",
  PromptLoadedFromStore: "prompt.loader.store",
  PromptLoadedFromDefault: "prompt.loader.default",
  PromptCompiled: "prompt.compiled",
  PromptHashMismatch: "prompt.hash_mismatch",
  AdminPromptAccess: "admin.prompt.access",
  AdminExperimentAccess: "admin.experiment.access",
  AdminAuthFailed: "admin.auth.failed",
  AdminIPBlocked: "admin.ip.blocked",

  // Prompt Experiment events (v2.0)
  PromptExperimentAssigned: "prompt.experiment.assigned",
  PromptStagingUsed: "prompt.staging.used",

  // Decision Review events (v2.0)
  DecisionReviewGenerated: "cee.decision_review.generated",
  DecisionReviewIslFallback: "cee.decision_review.isl_fallback",
  DecisionReviewRequested: "cee.decision_review.requested",
  DecisionReviewSucceeded: "cee.decision_review.succeeded",
  DecisionReviewFailed: "cee.decision_review.failed",

  // Bias Mitigation events (v2.0)
  BiasPatchesGenerated: "cee.bias_check.patches_generated",
  BiasPatchesApplied: "cee.bias_check.patches_applied",

  // Prompt Store Cache events (v2.0 Phase 4.3)
  PromptStoreCacheHit: "prompt.store.cache.hit",
  PromptStoreCacheMiss: "prompt.store.cache.miss",
  PromptStoreCacheInvalidated: "prompt.store.cache.invalidated",
  PromptStoreCacheWarmed: "prompt.store.cache.warmed",
  PromptStoreBackgroundRefresh: "prompt.store.background_refresh",

  // Prompt Test Sandbox events (v2.1)
  PromptTestExecuted: "prompt.test.executed",
  PromptTestValidationPassed: "prompt.test.validation_passed",
  PromptTestValidationFailed: "prompt.test.validation_failed",

  // Prompt Version Lifecycle events (v2.1)
  PromptVersionPromoted: "prompt.version.promoted",
  PromptVersionDemoted: "prompt.version.demoted",
  PromptRollbackExecuted: "prompt.rollback.executed",
  PromptRollbackFailed: "prompt.rollback.failed",

  // Prompt Approval Gate events (v2.1)
  PromptApprovalRequired: "prompt.approval.required",
  PromptApprovalGranted: "prompt.approval.granted",
  PromptApprovalRejected: "prompt.approval.rejected",

  // Prompt Activation Guard events (v2.2)
  PromptActivationBlocked: "prompt.activation.blocked",
  PromptStagingActivated: "prompt.staging.activated",

  // Graph Validation events (v2.2)
  CeeGraphValidation: "cee.graph.validation",
  CeeGraphGoalsMerged: "cee.graph.goals_merged",
  CeeGraphSizeExceeded: "cee.graph.size_exceeded",

  // Factor Extraction events (v2.3)
  FactorExtractionComplete: "cee.factor_extraction.complete",

  // Schema v2 Transform events (v2.3)
  SchemaV2TransformComplete: "cee.schema_v2.transform_complete",

  // Schema v3 Transform events (v3.0)
  SchemaV3TransformComplete: "cee.schema_v3.transform_complete",
  InterventionExtraction: "cee.intervention_extraction",

  // Edge coefficient clamping events (P1-CEE-2)
  EdgeStrengthClamped: "cee.edge.strength_clamped",
  EdgeStrengthNegligible: "cee.edge.strength_negligible",
  EdgeStrengthLow: "cee.edge.strength_low",

  // Analysis-Ready Output events (P0)
  AnalysisReadyBuilt: "cee.analysis_ready.built",
  AnalysisReadyValidationFailed: "cee.analysis_ready.validation_failed",

  // ISL Synthesis events (v2.3)
  IslSynthesisRequested: "cee.isl_synthesis.requested",
  IslSynthesisSucceeded: "cee.isl_synthesis.succeeded",
  IslSynthesisFailed: "cee.isl_synthesis.failed",

  // Boundary logging events (observability v1)
  BoundaryRequest: "boundary.request",
  BoundaryResponse: "boundary.response",
  CeeBoundaryBlocked: "cee.boundary.blocked",

  // Config security events (Stream F)
  CeeConfigRawIoOverridden: "cee.config.raw_io_overridden",

  // Performance timing events (observability v2)
  LlmCall: "llm.call",
  DownstreamCall: "downstream.call",

  // Orchestrator events (Track C)
  OrchestratorTurnStarted: "orchestrator.turn.started",
  OrchestratorTurnCompleted: "orchestrator.turn.completed",
  OrchestratorTurnFailed: "orchestrator.turn.failed",
  OrchestratorIntentResolved: "orchestrator.intent.resolved",
  OrchestratorToolInvoked: "orchestrator.tool.invoked",
  OrchestratorToolCompleted: "orchestrator.tool.completed",
  OrchestratorToolFailed: "orchestrator.tool.failed",
  OrchestratorPlotRunRequested: "orchestrator.plot.run_requested",
  OrchestratorPlotRunCompleted: "orchestrator.plot.run_completed",
  OrchestratorPlotRunFailed: "orchestrator.plot.run_failed",
  OrchestratorPlotValidateRequested: "orchestrator.plot.validate_requested",
  OrchestratorPlotValidateCompleted: "orchestrator.plot.validate_completed",
  OrchestratorIdempotencyHit: "orchestrator.idempotency.hit",
  OrchestratorIdempotencyCached: "orchestrator.idempotency.cached",
  OrchestratorNumericFreehandStripped: "orchestrator.commentary.numeric_freehand_stripped",
  OrchestratorSystemEvent: "orchestrator.system_event",
  OrchestratorModeDisagreement: "orchestrator.turn.mode_disagreement",
  OrchestratorToolSuppressed: "orchestrator.turn.tool_suppressed",
  OrchestratorContractViolation: "orchestrator.turn.contract_violation",

  // V5 boundary validation (Boundary Contract v1.1 §4.4).
  // Emitted by B1 ingress/egress validators on /orchestrate/v2/turn (slice A0).
  // Fields per §4.4: boundary, direction, validator, contract_version, pass, error_code?, request_id
  BoundaryValidation: "boundary.validation",

  // V5 TurnExecutor lifecycle (slice A1, addendum §2.1.9).
  // Started emits when runTurnExecutor enters. Completed emits in `finally`.
  // Exactly-one-response invariant: every started MUST have a matching completed
  // with response_emitted=true. ContaminationNarrate is informational only.
  TurnExecutorStarted: "turn_executor.started",
  TurnExecutorCompleted: "turn_executor.completed",
  // V5 alpha hardening Phase 2.5: primary lifecycle events. Every event
  // on this list carries the full obs field set (v5_journey_id,
  // prompt_version, prompt_hash, system_chars, context_pack_chars,
  // handler_proposed, validator_outcome, response_type). Lower-level
  // debug/warn logs carry only request_id + v5_journey_id. See
  // Docs/v5/v5-resilience-contract.md Part E.
  ContextPackAssembled: "v5.context_pack.assembled",
  ValidatorOutcome: "v5.validator_outcome",
  RecoveryResponse: "v5.recovery_response",
  HandlerInvocation: "v5.handler_invocation",
  TurnExecutorContaminationNarrate: "turn_executor.contamination_narrate",

  // Context Architecture v2 S0 "measure first" (ROADMAP 1.73; design pack
  // 03-budgets-and-telemetry §2). Both are LOG-ONLY (no Datadog mapping —
  // registered in debugOnlyEvents in the freeze test) and telemetry-additive:
  // no flag, no behaviour change.
  //   v5.context_budget      — once per LLM call: per-section char accounting
  //                            + API usage tokens (ground truth) + measured
  //                            chars_per_token. Emitted at the turn-executor
  //                            routing seam and the edit/repair/review/draft
  //                            adapter boundaries.
  //   v5.context_truncation  — at the cut site the moment ANY content is
  //                            dropped (truncateGraphJson, capConversationText,
  //                            window slice, brief slice). A truncation event
  //                            with disclosed:false is the pre-S1 baseline the
  //                            disclosure ratchet later flips.
  V5ContextBudget: "v5.context_budget",
  V5ContextTruncation: "v5.context_truncation",
  // Context Architecture v2 S6 (ROADMAP 1.73; design pack 02 §Seam 3).
  // Shadow validation of the PLoT→CEE enrichment passthrough (the
  // platform's known-open seam): emitted when CEE_ENRICHMENT_VALIDATION
  // is shadow/enforce and AnalysisEnrichmentSchema.safeParse fails on a
  // PLoT run response. Log-only; the turn proceeds unchanged (stage 1).
  V5EnrichmentSchemaMismatch: "v5.enrichment.schema_mismatch",
  // Context Architecture v2 S4 (ROADMAP 1.73; design pack 01 §2/§4, 03 §2).
  // Rolling conversation summary. Both LOG-ONLY (debugOnlyEvents; no Datadog
  // mapping — harness 1.70 v1 is the consumer), content-free (statuses/counts,
  // never summary text).
  //   v5.summary.updated — one per commit-seam maintainer pass: status
  //                        (applied/regressed/rejected_kept_prior/floor/…),
  //                        generator (regen/incremental/floor), duration_ms,
  //                        chars, capped_fallback, history_capped (Codex r2
  //                        fix 4a — the full-history read filled its limit;
  //                        the stored summary discloses the partiality).
  //                        `regressed` is the R4 monotonic no-op — an
  //                        out-of-order/stale write that the DB guard refused
  //                        (NOT an error). Passes are per-scenario
  //                        single-flight (fix 4b): commits landing mid-pass
  //                        coalesce into ONE rerun, so a burst emits one
  //                        event per EXECUTED pass, not per commit.
  //   v5.summary.lag     — the staleness-invariant signal (01 §4): emitted when
  //                        summary_lag_turns exceeds the verbatim-window bound,
  //                        so a summariser outage is loud + disclosed. Emitted
  //                        by the injector at assembly time (S4 injection
  //                        follow-up); registered here with the maintainer.
  //                        `refused` (Codex r2 blocker 1): true = memory-hole
  //                        refusal — the watermark was not provably covered
  //                        by the window (or the gap exceeded the verbatim
  //                        slice), so the four-slot block was WITHHELD and a
  //                        disclosed-absence note injected instead;
  //                        false = disclosed-stale injection.
  V5SummaryUpdated: "v5.summary.updated",
  V5SummaryLag: "v5.summary.lag",

  // V5 latency observability (Fix 4 — per-stage timings).
  // Always emitted to logs. The matching `_timings` block on the wire
  // response envelope is gated by TWO conditions (PR #182): the server
  // permission flag `cee.timingDebugEnabled` (env `V5_TIMING_DEBUG=true`)
  // AND the per-request header `X-Olumi-Debug: timings`. Normal browser
  // traffic without the header does not receive `_timings`.
  V5TurnStageTimings: "v5.turn_executor.stage_timings",
  V5RunAnalysisTimings: "v5.run_analysis.timings",
  // Track S 0.13c-1 — run_analysis load-time intercept guard summary.
  // Redacted: corrected_count + node IDs only, no observed magnitudes.
  V5RunAnalysisInterceptGuard: "v5.run_analysis.intercept_guard",
  // Track S 0.13c-4 — persist-site intercept repair summary (non-draft chokepoint).
  // Redacted: corrected_count + node IDs (+ turn_class/source) only, no magnitudes.
  V5GraphPersistInterceptRepair: "v5.graph_persist.intercept_repair",
  CeeUnifiedPipelineStageTimings: "cee.unified_pipeline.stage_timings",

  // V5 pending-action lifecycle. Fired at the appropriate point in the
  // resume cycle. No raw graph / analysis / target-label values in
  // payloads; only ids and bounded enums.
  //
  //   created     — write succeeded (Wave 1)
  //   matched     — short-confirm pre-route found a resumable pending action
  //   consumed    — handler successfully dispatched via the resumer
  //   skipped     — short-confirm pre-route declined to resume; carries reason
  //   expired     — pending action TTL exceeded (placeholder; resumer rolls
  //                 wall+turn TTL into 'all_expired' skip reason today)
  //   invalidated — preconditions failed (graph hash, target missing, etc.;
  //                 Wave 3 will start emitting this as set_factor_value /
  //                 edit_graph_add_risk pending actions land)
  PendingActionCreated: "v5.pending_action.created",
  PendingActionMatched: "v5.pending_action.matched",
  PendingActionConsumed: "v5.pending_action.consumed",
  PendingActionSkipped: "v5.pending_action.skipped",
  PendingActionExpired: "v5.pending_action.expired",
  PendingActionInvalidated: "v5.pending_action.invalidated",
  PendingActionRecoveryExpired: "v5.pending_action.recovery_expired",
  PendingActionRecoveryAmbiguous: "v5.pending_action.recovery_ambiguous",
  PendingActionRerunAnalysisRequired: "v5.pending_action.rerun_analysis_required",
  PendingActionsReadDegraded: "v5.pending_actions.read_degraded",
  // V5 P0 proposal-memory continuation (post-analysis coaching → action).
  // captured: emit-time hook recognised a Sonnet-emitted "add X as a
  //   factor/risk" proposal in the assistant_text and persisted a
  //   `proposed_concept` pending action alongside the turn commit.
  // resumed: next-turn no-op recovery layer matched the pending and
  //   emitted either a Stage 1 (agreement) or Stage 2 (add-as-factor)
  //   deterministic clarifier instead of the bland vague-edit fallback.
  V5ProposalContinuationCaptured: "v5.proposal_continuation.captured",
  V5ProposalContinuationResumed: "v5.proposal_continuation.resumed",
  V5ProposalContinuationInvalidated: "v5.proposal_continuation.invalidated",
  // Preflight skipped the LLM call because the requested edit would
  // exceed structural limits. Reason names match the post-validator
  // codes so dashboards can correlate (edge_limit ↔
  // EDGE_LIMIT_EXCEEDED, node_limit ↔ NODE_LIMIT_EXCEEDED).
  EditGraphPreflightSkippedLlm: "v5.edit_graph.preflight_skipped_llm",

  // V5 state-trust freshness derivation. Emitted once per projection
  // build (every turn). Single event is sufficient to reconstruct the
  // freshness state for any turn. Fields:
  //   freshness: 'fresh' | 'stale' | 'unknown' | 'none'
  //   reason: FreshnessReason (graph_hash_match / graph_hash_diverged /
  //           legacy_fact_missing_hash / current_graph_hash_unavailable /
  //           no_successful_run_analysis_fact / invariant_failed)
  //   selected_fact_index: number | null
  //   graph_hash_at_run: string | null
  //   current_graph_hash: string | null
  //   computed_at: ISO string | null
  //   prior_fact_count: number
  //   analysis_state_source: 'request' | 'fallback' | 'absent'
  AnalysisFreshnessDerived: "v5.analysis_freshness.derived",
  /** Hard invariant violation: hashes were both present but freshness
   *  derived as 'unknown'. Fall back to 'unknown' (never 'stale'),
   *  emit so ops can investigate. */
  AnalysisFreshnessInvariantFailed: "v5.analysis_freshness.invariant_failed",
  /** Soft signal: current graph hash was null (graph absent on this
   *  turn) so the comparison was impossible. */
  AnalysisFreshnessGraphHashMissing: "v5.analysis_freshness.graph_hash_missing",
  /** Selection signal: which fact won and why. Separate from .derived so
   *  operators can grep "fact_selected" without parsing the bigger event.
   *  Fires only when a fact was actually selected (selected_fact_index
   *  non-null). */
  AnalysisFreshnessFactSelected: "v5.analysis_freshness.fact_selected",
  /** Telemetry-only marker for dispatcher paths (currently draft_graph)
   *  that synthesise the freshness verdict without reading the prior
   *  fact chain. The wire freshness still reflects the canonical state
   *  (none / unknown); this event records the assumption so operators
   *  can investigate replay scenarios where a "first-turn" trigger
   *  shape lands on a session that already has a prior fact. */
  AnalysisFreshnessFirstTurnAssumed: "v5.analysis_freshness.first_turn_assumed",
  /** Option-identity guard (CEE_OPTION_IDENTITY_FRESHNESS_GUARD) fired: the
   *  analysed option identities on the selected fact diverged from the current
   *  graph's option IDs, so the verdict was forced to 'stale'. Carries the
   *  standard correlation + freshness fields (request_id, scenario_id,
   *  dispatch_path, selected_fact_index, graph_hash_at_run, current_graph_hash)
   *  — never option IDs/labels or user content. Emitted IN ADDITION to the
   *  graph_hash_missing event on recovery paths (that signal is keyed on the
   *  hash fields, not the reason, so it is not lost when the verdict is
   *  overridden to 'analysed_options_diverged'). The richer per-option detail
   *  (counts, sub-reason) lives on the gated context-summary diagnostic. */
  AnalysisFreshnessOptionsDiverged: "v5.analysis_freshness.options_diverged",

  // V5 Coaching State Spine — Stage 1. Emitted once per turn when the
  // internal DecisionContext projection is derived from canonical state.
  // Privacy contract: carries the STANDARD correlation IDs (request_id,
  // scenario_id — same as every other V5 telemetry event, e.g. .derived /
  // SessionReadDegraded) plus counts / flags / provenance ONLY. It NEVER
  // carries raw decision content — no monetary values, entity labels, timeline
  // strings, or brief text. Fields:
  //   request_id, scenario_id: string  (correlation only; not decision content)
  //   status: 'not_populated' | 'partial' | 'populated'
  //   monetary_count: number
  //   has_timeline: boolean
  //   entity_count: number
  //   has_goal_metric: boolean
  //   has_goal_target: boolean
  //   derived_from_graph_hash: string | null
  DecisionContextDerived: "v5.decision_context.derived",

  // V5 Coaching State Spine — Stage 2A. Emitted once per turn when the internal
  // current-turn CoachingState container is derived from canonical state. Same
  // privacy contract as DecisionContextDerived / context_readiness: STANDARD
  // correlation IDs plus counts / flags / closed-enum codes / hashes ONLY — never
  // raw decision content (no labels, values, node/edge/option/factor/fact ids).
  // Fields:
  //   request_id, scenario_id: string  (correlation only)
  //   status: 'empty' | 'active' | 'degraded'
  //   signal_count, active_count, stale_count, unavailable_count: number
  //   kinds_present: string[]    (sorted distinct CoachingStateSignalKind — closed enum)
  //   reason_codes: string[]     (sorted distinct CoachingStateReasonCode — closed enum)
  //   graph_hash, analysis_graph_hash: string | null  (SHA-prefix provenance)
  //   freshness: 'fresh' | 'stale' | 'unknown' | 'none'  (for cross-ref with analysis_freshness.derived)
  V5CoachingStateDerived: "v5.coaching_state.derived",

  // V5 Coaching Context Pack v1 (CEE_COACHING_CONTEXT_PROMPT_ENABLED). Emitted
  // when the deterministic coaching-output post-check fires on an LLM-authored
  // coaching turn and the response is degraded to safe. Privacy: correlation
  // IDs + the closed-enum `violation` + the pack's closed-enum / boolean state
  // (freshness / rerun_required / usable_for_chips / blocked) ONLY — never the
  // model prose or any decision content.
  V5CoachingOutputPostcheck: "v5.coaching.output_postcheck",

  // CEE_ANSWER_TEXT_REQUIRED (belt-and-braces hardening, default OFF).
  // Emitted when the compose-layer guard (layer B) catches a coach/converse
  // turn where BOTH `answer_text` and `orientationText` landed empty or
  // whitespace-only (even after the schema-pressure REPAIR_ONCE retry —
  // layer A) and degrades to the bounded-recovery response instead of
  // shipping an empty assistant_text. Privacy: correlation IDs + the
  // closed-enum `intent_class` + LENGTHS only — never the model's prose.
  // Fields:
  //   request_id, scenario_id: string  (correlation only)
  //   intent_class: 'coach' | 'converse'
  //   answer_text_length: number  (0 when absent)
  //   orientation_length: number
  V5CoachingEmptyAnswerRecovered: "v5.coaching.empty_answer_recovered",

  // ROADMAP 1.38 — the measurement instrument for the answer_text channel
  // itself. Emitted at the compose pick site for EVERY coach/converse
  // (tool_call) turn — NOT flag-gated behind CEE_ANSWER_TEXT_REQUIRED,
  // because the whole point is to quantify the prompt-only world as it
  // exists today (v42.2g), i.e. how often `answer_text` ships vs the
  // `orientationText` fallback, BEFORE any of the belt-and-braces hardening
  // above ever engages. One event per pick, right after the ternary decides
  // which channel wins. Privacy: correlation IDs + the closed-enum
  // `intent_class` + closed-enum `source` + LENGTHS only — never the
  // model's prose. Fields:
  //   request_id, scenario_id: string  (correlation only)
  //   intent_class: 'coach' | 'converse'
  //   source: 'answer_text' | 'orientation_fallback'
  //   answer_text_length: number  (0 when absent)
  //   orientation_length: number
  V5CoachingAnswerSource: "v5.coaching.answer_source",

  // V5 Coaching State Spine — Stage 2B-1b. Emitted once per turn AFTER the turn's
  // state is successfully persisted (post-append_turn_atomic). Same privacy
  // contract as V5CoachingStateDerived: correlation IDs + counts / closed-enum
  // status / SHA-prefix hashes / version / timing / turn_class ONLY — never raw
  // decision content. `coaching_state_present` distinguishes turns that derived a
  // snapshot (turn-executor / chip-click) from those that did not (system events,
  // route-v2 draft/edit) so missed write-site wiring is visible. Fields:
  //   scenario_id, turn_id, turn_row_id: string  (correlation only)
  //   turn_class: 'direct_answer' | 'clarify' | 'handler' | 'unhandled'  (closed enum)
  //   coaching_state_present: boolean
  //   status: 'empty' | 'active' | 'degraded' | null
  //   signal_count, active_count, stale_count, unavailable_count: number
  //   graph_hash, analysis_graph_hash, version: string | null
  //   snapshot_timing: 'pre_dispatch' | null
  V5CoachingStatePersisted: "v5.coaching_state.persisted",

  // A3 graph CAS observe-mode. Emitted once per graph-bearing append() when
  // CEE_V5_GRAPH_CAS_MODE != 'off', AFTER the pre-RPC evaluation and BEFORE
  // the append_turn_atomic_v2 call. App-side stale-write OBSERVATION only —
  // NOT atomic CAS (a SELECT-then-write TOCTOU window remains; see
  // Docs/v5/proposals/append-turn-atomic-v3-graph-cas.md). Privacy contract:
  // correlation IDs + closed-enum category/reason + hash PREFIXES + timing
  // ONLY — never raw graph content, labels, values or prose. Fields:
  //   scenario_id, turn_id: string           (correlation only)
  //   mode: 'observe' | 'enforce'            (the active mode)
  //   category: GraphCasConflictCategory     (closed enum — graph-cas-conflict.ts)
  //   reason: GraphCasConflictReason         (closed enum)
  //   expected_identity_hash, current_identity_hash, incoming_identity_hash:
  //     string | null                        (16-hex prefixes of the 64-hex identity hashes)
  //   expected_analysis_hash, current_analysis_hash: string | null  (already 16-hex)
  //   select_ms: number | null               (pre-write scenarios SELECT latency)
  //   select_failed: boolean
  V5GraphCasEvaluated: "v5.graph_cas.evaluated",

  // A3 graph CAS — enforce mode ONLY (never observe; enforce is auto-downgraded
  // to observe in prod). Emitted when a write categorised as
  // analysis_affecting_conflict is blocked pre-RPC via GraphStaleWriteError
  // (which extends StateCommitFailedError, so the existing typed failure
  // envelope handles it — no wire-shape change). Same privacy contract and
  // field set as V5GraphCasEvaluated.
  V5GraphCasWriteBlocked: "v5.graph_cas.write_blocked",

  // Graph Management referee (CEE_GRAPH_MANAGEMENT_MODE != 'off'). One event
  // per refereed CandidateMutationEnvelope, name = the verdict (T4.0 §5
  // no-silent-outcome contract: every held/stale/rejected/clarify verdict
  // has exactly one event). REDACTED payload (graph-management/telemetry.ts
  // mutationTelemetryEvent + the seam's mode/dispatch fields): closed-enum
  // kind/verdict/mutation_class/blocker_code, base_hash_match boolean,
  // provenance source, scenario/turn ids, latency — NEVER payload values,
  // labels, or candidate graph internals. `mode` ('shadow' | 'live') rides
  // alongside so dashboards can split observation from routing.
  V5CandidateMutationWouldApply: "v5.candidate_mutation.would_apply",
  V5CandidateMutationHeld: "v5.candidate_mutation.held",
  V5CandidateMutationStale: "v5.candidate_mutation.stale",
  V5CandidateMutationRejected: "v5.candidate_mutation.rejected",
  V5CandidateMutationClarifyRequired: "v5.candidate_mutation.clarify_required",

  // Model Management (CEE_MODEL_VERSIONS_ENABLED) — commit-seam version hook.
  // Emitted AFTER a durable graph-bearing commit when the fire-and-forget
  // saveVersion call resolves. Content-free: scenario/turn ids, outcome
  // status ('ok' | 'deduped' | 'disabled' | 'conflict' | 'error'),
  // version_number, 16-hex-prefixed graph_identity_hash, error code — never
  // graph content or labels. Non-blocking contract: emit/save failures log
  // and NEVER affect the turn result.
  V5ModelVersionCreated: "v5.model_versions.version_created",

  // Decision Records (CEE_DECISION_RECORD_CAPTURE) — commit-seam capture
  // hook (ROADMAP 3.1, CEE half; ships DARK until migration
  // 20260710113000_v5_decision_records.sql is executed). Emitted AFTER a
  // durable commit carrying a successful (non-noop) run_analysis fact when
  // the fire-and-forget create_decision_record call resolves, or when the
  // builder skips before the RPC. Content-free: scenario/turn/row ids,
  // outcome status ('ok' | 'deduped' | 'skipped' | 'guest_refused' |
  // 'error'), deterministic record_id (UUID), closed-enum skip_reason,
  // error name — never option labels, prediction text, or analysis values.
  // The known-guest PRE-CHECK skip is deliberately log-only (no event; the
  // MM WARN-spam lesson) — 'guest_refused' marks only the RPC's
  // authoritative DR001 on the fail-open path. Non-blocking contract:
  // capture/emit failures log and NEVER affect the turn result.
  V5DecisionRecordCaptured: "v5.decision_records.record_captured",

  // V5 Coaching State Spine — Stage 2B-2. Emitted once per turn after the internal coaching
  // LIFECYCLE is derived (prior pre-dispatch snapshot vs current pre-dispatch coaching_state
  // + per-source evaluability). Same privacy contract as the other coaching events: STANDARD
  // correlation IDs + counts / closed-enum codes / hash-AVAILABILITY flags / version / timing
  // ONLY — never raw decision content (no labels, values, node/edge/option/factor ids, brief
  // text, free text). Internal-only; the emit is guarded so a telemetry fault never fails the
  // turn. Fields:
  //   request_id, scenario_id: string  (correlation only)
  //   status: 'empty' | 'active' | 'degraded'
  //   prior_snapshot_available, version_mismatch: boolean
  //   active_count, resolved_count, stale_count, unavailable_count: number
  //   kinds_present: string[]                 (sorted distinct CoachingStateSignalKind — closed enum)
  //   reason_codes: string[]                  (sorted distinct CoachingStateReasonCode — closed enum)
  //   lifecycle_statuses_present: string[]    (sorted distinct 'active'|'resolved'|'stale'|'unavailable')
  //   prior_graph_hash_present, current_graph_hash_present: boolean  (availability flags — NOT values)
  //   snapshot_timing: 'pre_dispatch'
  //   version: 'v1'
  V5CoachingStateLifecycleDerived: "v5.coaching_state.lifecycle_derived",

  // V5 TurnExecutor per-code failure composition.
  // Emitted once per failure path that runs a per-code composer. Fields:
  //   request_id, session_id, stage,
  //   failure_origin: 'validator' | 'handler',       // which layer produced the error
  //   error_code: ValidationErrorCode | HandlerInvocationFailedCause,
  //   template_used: string,                         // the composer branch that ran
  //   chip_attached: boolean,                        // did the response ship a chip?
  //   chip_type: 'action' | 'text_prompt' | 'entity_suggestion' | null,
  //   chip_count: number,
  //   retryable?: boolean                            // handler layer only
  // Regression guard: `template_used === 'fallback'` should never appear for
  // reachable codes in integration tests — used to detect new codes missing
  // templates. `failure_origin` is strictly 'validator' or 'handler'; the
  // fallback path signals via template_used, NOT via failure_origin.
  TurnExecutorFailureResponse: "turn_executor.failure_response",

  // V5 Phase 1.5: graph lookup adapter outcome (Imp-2, review P1-3).
  // Emitted exactly once per turn. Fields:
  //   outcome: 'no_graph' | 'ok' | 'all_dropped' | 'test_override'
  //   total_nodes, mapped_nodes, dropped_by_unknown_kind, dropped_by_missing_id
  // 'all_dropped' is a hard payload-drift signal; ops should alert on it.
  // 'test_override' indicates the adapter was bypassed (tests only) — stats
  // are zero in that case.
  TurnExecutorGraphLookup: "turn_executor.graph_lookup",

  // V5 session persistence (slice B).
  // SessionReadDegraded emits when buildTurnContext's readRecent fails: the
  // turn still runs with empty prior-turn history. Emitted with
  // severity='warning' and a stable event name so ops alerting can match it;
  // critical for detecting silent session-loss windows. Event payload:
  // { scenario_id, error_code, severity: 'warning' }.
  SessionReadDegraded: "session.read_degraded",

  // V5 Conversation Context Reliability: continuity-gap detector. Emits when a
  // turn that PROVABLY continues a prior conversation (source 'chip'/'chip_click'
  // — a chip can only exist if a prior assistant turn rendered it) arrives with
  // ZERO prior turns under its scenario_id. The strongest server-observable
  // signal of UI scenario-id fragmentation (the conversation was split across
  // scenario_ids), which CEE cannot repair but must not silently accept. CEE
  // takes ingress.scenario_id verbatim; the payload carries no conversation
  // history, so a fragmented scenario looks (correctly) empty here. Content-free
  // payload: { scenario_id, source, stage, prior_turn_count: 0 } — never message
  // text. See the V5 Conversation Context Reliability lane + the UI scenario-id
  // follow-up.
  V5SessionContinuityGap: "v5.session.continuity_gap",

  // V5 Group 1 Task B: decision_review auto-fire after successful
  // run_analysis. Invoked emits once the enricher decides to fire. Skipped
  // emits with a reason when the prerequisite data is absent. Failed emits
  // when the call times out / aborts / shape-check fails; in all failure
  // modes the turn still succeeds with thin content (enrichment absent).
  V5DecisionReviewInvoked: "v5.decision_review.invoked",
  V5DecisionReviewSkipped: "v5.decision_review.skipped",
  V5DecisionReviewFailed: "v5.decision_review.failed",

  // Phase 3A content-thinness diagnostic (F1, 2026-05-18). Fires once the
  // decision_review LLM call returned a non-null parsed output AND the
  // enrichment has been successfully sanitised and attached to the
  // handler fact. Mutually exclusive with V5DecisionReviewFailed for any
  // given request_id — a throw between shape extraction and attach lands
  // in the catch block and emits `failed`, not `completed`.
  //
  // Carries counts, lengths, and presence-booleans only — never any
  // prose, graph labels, raw IDs, brief text, or decision_review content.
  // Pairs an `input_*` snapshot (read from the raw PLoT V2 envelope) with
  // an `output_*` snapshot (read from the LLM output verbatim).
  //
  // Purpose: discriminate between (a) sparse PLoT envelope → empty Phase 3
  // blocks (RC-1/RC-2 from the content-thinness investigation) vs (b)
  // dense PLoT envelope → over-filtered LLM output (RC-3). Without this
  // event, both look identical at the wire — Phase 3 blocks just don't
  // appear, and operators can't tell which side owns the fix.
  //
  // `duration_ms` measures the full invoked → emit window (LLM round-trip
  // + shape extraction + sanitise + attach), so dashboards see the true
  // success-path latency, not just the LLM call.
  //
  // Privacy contract: every NON-ROUTING field MUST be a finite number or
  // boolean. `request_id` and `scenario_id` are strings (routing keys,
  // also present on `invoked` / `skipped` / `failed`). No other strings,
  // no arrays, no nested objects. Adding a non-routing string field to
  // this event is a regression and the contract test should fail.
  V5DecisionReviewCompleted: "v5.decision_review.completed",

  // ROADMAP 1.77 (B1 neuro-symbolic experiment). Fires once per auto-fired
  // decision_review when the decomposed path (CEE_DECISION_REVIEW_DECOMPOSE=
  // true) ran, recording the outcome of the 4-parallel-haiku fan-out +
  // deterministic composition + composed-consistency check. Mutually
  // exclusive per request_id with the shape of `completed`/`failed` only in
  // that this event describes the DECOMPOSITION decision, not the attach:
  // it says whether the composed review was shipped (`composed`) or the
  // composer fell back to the gpt-4.1 monolith (`fell_back`), and — on
  // fallback — the machine reason. The enricher still emits the usual
  // `completed`/`failed` for the attach lifecycle downstream of this.
  //
  // Privacy contract: `request_id` / `scenario_id` are routing-key strings;
  // `outcome` and `fallback_reason` are bounded enum strings (no prose, no
  // labels, no IDs, no brief text). Every other field is a finite number or
  // boolean (fragment success counts, violation count, wall-clock ms).
  V5DecisionReviewDecomposed: "v5.decision_review.decomposed",

  // V5 Phase 2.5 Defect A — edit_graph dispatch state observability. Three
  // events cover the graphState resolution outcomes for an edit-intent turn,
  // so the routing-contract invariant (edit intent → mutation OR clarification
  // OR typed recovery; never silent fallthrough) is observable end-to-end:
  //
  //  - V5EditGraphGraphStatePresent: edit intent detected and `graphState`
  //    arrived on the request. Baseline counter for future audit; useful when
  //    triaging "edit intent matched but dispatch never fired" — if this
  //    event fires but no edit_graph dispatch follows, the failure is
  //    upstream (an earlier branch returned first).
  //  - V5EditGraphGraphStateReloaded: edit intent detected, `graphState`
  //    absent on request, persisted graph reload from `scenarios.graph`
  //    succeeded; dispatch proceeds against the reloaded graph.
  //  - V5EditGraphGraphStateUnavailable: edit intent detected, `graphState`
  //    absent and persisted graph either missing or invalid. The route
  //    returns a typed recovery response (`turn_class: direct_answer`)
  //    rather than silently falling through to TurnExecutor / Sonnet.
  //    Carries `reason: 'no_persisted_graph' | 'persisted_graph_invalid' |
  //    'session_store_failed'` so operators can distinguish the failure
  //    modes in dashboards.
  V5EditGraphGraphStatePresent: "v5.edit_graph.graph_state_present",
  V5EditGraphGraphStateReloaded: "v5.edit_graph.graph_state_reloaded",
  V5EditGraphGraphStateUnavailable: "v5.edit_graph.graph_state_unavailable",

  // V5 A4 corrective path — bare add-risk request clarified without an LLM
  // call or graph mutation. Payload: { request_id, scenario_id, latency_ms,
  // label_length }. The label itself is intentionally not emitted.
  V5EditGraphAddRiskClarified: "v5.edit_graph.add_risk_clarified",

  // V5 H5 defence-in-depth — the dispatcher's false-success invariant
  // fired: `handleEditGraph` returned `wasRejected: false` AND
  // `isSuccessfulAppliedMutation()` returned false (i.e. NOT a true
  // applied mutation: any combination of empty/missing operations,
  // absent appliedGraph, or the impossible-but-not-enforced shape
  // appliedGraph + operations=[]), yet `assistantText` contained
  // success-claim language ("successfully", "I've applied/updated/…",
  // bare past-tense "Updated Price.", terse "Done.", etc.). The
  // runtime rewrites `assistant_text` to the neutral
  // EGRESS_FORBIDDEN_PHRASE_FALLBACK_TEXT before commit so the user
  // never sees a success claim that wasn't backed by persisted state.
  // Payload: { request_id, scenario_id, original_phrase, dispatch_path }.
  // Counterpart to V5EgressForbiddenPhraseDetected; this event is the
  // structural-mismatch trigger, that one is the lexical-denial trigger.
  V5EditGraphFalseSuccessRewritten: "v5.edit_graph.false_success_rewritten",

  // V5 appliedGraph-persistence fix (post-H5 follow-up). The
  // structural-invariant backstop in the V5 edit_graph dispatcher
  // fired: V4 returned `wasRejected: false` AND `operations.length > 0`
  // AND `appliedGraph == null`. This shape proves the LLM-authored
  // prose cannot be backed by persisted state regardless of phrasing
  // — `findSuccessClaimHit` can't enumerate every variant Sonnet
  // produces ("Strengthened the X edge from Y to Z..." is a real
  // observed miss). The runtime rewrites `assistant_text` to the
  // neutral EGRESS_FORBIDDEN_PHRASE_FALLBACK_TEXT unconditionally
  // when this signature fires. After the V4 source fix (synthesize
  // appliedGraph from candidateGraph when PLoT didn't supply one),
  // this event should be at-or-near zero in normal operation; a
  // non-zero rate signals a regression in the V4 success branch's
  // appliedGraph plumbing.
  // Payload: { request_id, scenario_id, operations_count, dispatch_path }.
  V5EditGraphAppliedGraphMissingWithOperations: "v5.edit_graph.applied_graph_missing_with_operations",

  // V5 appliedGraph-persistence fix (post-H5 follow-up). V4's
  // `handleEditGraph` success branch synthesized appliedGraph from
  // the locally-computed `candidateGraph` (via
  // `applyPatchOperations`) because PLoT did not supply one — either
  // `plotClient` was null (V5 dispatch path's default) or PLoT
  // validated but omitted `applied_graph` in its response. This is
  // the expected steady-state path on the V5 dispatch route until
  // the V4-residue retirement lands. A healthy `synthesized_locally`
  // rate with near-zero `missing_with_operations` rate means the
  // pair is working as designed.
  // Payload: { request_id, scenario_id, operations_count, plot_configured }.
  // `plot_configured` distinguishes Rule A (PLoT not wired — V5 dispatch
  // default) from Rule B (PLoT wired but omitted applied_graph with no
  // repairs reported). Rule lettering matches the synthesis block
  // comment in src/orchestrator/tools/edit-graph.ts. The
  // `applied_graph_hash` value is in the companion structured log line
  // ("edit_graph appliedGraph synthesized from local candidateGraph")
  // rather than this event payload.
  V5EditGraphAppliedGraphSynthesizedLocally: "v5.edit_graph.applied_graph_synthesized_locally",

  // V5 recovery chips — fired when the egress safety layer
  // (failure-response.ts) attaches one or more recovery chips to a failure
  // response. Distinct from V5DecisionReviewFailed: this event is about the
  // chips served, not the original failure cause. Payload: failure_type,
  // chip_labels, scenario_id, turn_id, is_retry, handler_id.
  V5RecoveryChipServed: "v5.recovery_chip_served",

  // PMS-tracked prompt resolution. Fires on every prompt load for the five
  // tracked keys (routing, edit_graph, draft_graph, decision_review,
  // repair_graph), at runtime, healthz/status probes, reload, and startup
  // snapshot build. Payload: { key, source: 'pms' | 'default', version,
  // content_hash, trigger, cache?: 'hit' | 'miss' }.
  V5PromptResolved: "v5.prompt_resolved",

  // Prompt-resolution policy observability (PR1). Fires once per resolution
  // decision at the routing-snapshot build and the adapter cold-default path.
  // Payload: { key, outcome, degraded, source: 'pms' | 'default',
  // fallback_reason, runtime_env, trigger? }. `outcome` (a payload value, not a
  // frozen event name) is one of pms_success | default_allowed |
  // default_on_critical_deployed in PR1; PR2 extends it with
  // lkg_used | emergency_default | fail_closed without re-registration. Loud
  // signal is the error-level log; no Datadog mapping (see debugOnlyEvents).
  V5PromptResolutionPolicy: "v5.prompt_resolution_policy",

  // V5 decision_review call-site safety net. The enricher itself catches
  // its own failures (see V5DecisionReviewFailed). This event fires only
  // when an exception escaped the enricher and was caught by the
  // turn-executor's defensive wrap — i.e. a future regression where the
  // enricher's never-throws invariant was breached.
  V5DecisionReviewDegraded: "v5.decision_review_degraded",

  // V5 Group 1 Task C: coaching signal fired during Step 5. Payload carries
  // the signal_id + turn_id so evaluators can correlate with coaching text.
  V5CoachingSignalFired: "v5.coaching.signal_fired",

  // V5 Phase 1 brief persistence — fires from draft-graph-dispatch when the
  // user-supplied free-text brief is truncated by normaliseBriefText (input
  // length exceeded MAX_BRIEF_TEXT_LENGTH). Payload: { request_id,
  // scenario_id, original_length, truncated_length, reason }. Operators can
  // alert on a non-zero rate to detect users systematically pasting briefs
  // exceeding the 8000-char DB cap.
  V5BriefTextNormalised: "v5.brief_text.normalised",

  // V5 Phase 3A PR 3 — block lifecycle: emitted once per composer call that
  // considered Phase 3 block emission (either from the current-turn fact, a
  // prior fact, or skipped). Payload: structural enums + booleans + counts
  // ONLY — NEVER prose, labels, raw entity IDs, scenario text,
  // decision_review content, or graph content.
  //   {
  //     request_id, scenario_id,
  //     lifecycle_state: 'emitted_fresh' | 'emitted_stale'
  //       | 'skipped_unknown' | 'skipped_none' | 'rebuild_failed',
  //     selected_fact_index: number | null,
  //     graph_hash_at_run: string | null,
  //     current_graph_hash: string | null,
  //     reason: FreshnessReason | 'no_current_run_analysis_fact' | …,
  //     block_count: number,                // total Phase 3 blocks emitted
  //                                         // (excludes analysis_result).
  //     stale_coaching_emitted: boolean,    // true only on emitted_stale.
  //   }
  // The two graph_hash fields ARE safe to log (they are SHA-prefixes already
  // logged via v5.analysis_freshness.derived). Operators can confirm a
  // stale-vs-fresh outcome and trace which fact in prior_facts was selected
  // without seeing any user content.
  V5Phase3BlockLifecycle: "v5.phase3.block_lifecycle",

  // V5Phase3LifecycleIndexMismatch — defence-in-depth cross-check for the
  // Phase 3 lifecycle fact selection. The freshness derivation reports a
  // `selected_fact_index` relative to the EXACT array it was derived from;
  // the compose lifecycle resolves the prior run_analysis fact by CONTENT
  // (selectRunAnalysisFact) rather than trusting that index. This event fires
  // when the content-selected position differs from the passed index — a
  // signal that an upstream call site derived freshness against one fact-array
  // basis but handed compose a differently-ordered array (the historical
  // routed-turn prepend bug). Metadata only: { request_id, scenario_id,
  // passed_index, content_index } — both are array positions, never user
  // content. Behaviour is unchanged when it fires (content selection wins);
  // the event exists so the regression cannot silently reappear.
  V5Phase3LifecycleIndexMismatch: "v5.phase3.lifecycle_index_mismatch",

  // CQE (Custom Quantity Extractor — V5 Layer 0) per CQE Design v1.1 §9 and
  // cqe-investigation-proposal.md §7.2. Emits once per turn after the
  // assembler runs extractQuantities(). Carries aggregate signals needed for
  // SLO tracking and upgrade-trigger alerts (word_range_missed > 5%,
  // compromise_match_count > 30%). Per-turn context lives in the routing
  // log; this event is the observability stream.
  CqeExtraction: "cqe.extraction",

  // V5 answer-carrying explanation handlers. Emitted from the turn-executor
  // around handler dispatch.
  //
  // V5ExplanationAnswerVerdict — once per explanation-handler turn after
  // the side-band check. Payload: { handler_id, answer_text_valid,
  // answer_validation_error?, answer_text_length, evidence_used_count,
  // cited_fields_count, forbidden_term_matched }. `forbidden_term_matched`
  // is non-null only when answer_validation_error === 'forbidden_internal_term'
  // — the single matched internal-vocabulary term (e.g. "node", "handler"),
  // deliberately never a surrounding excerpt (see
  // validator-explanation.ts's `forbidden_term_matched` docstring: the
  // matched term is always closed-vocabulary and PII-safe, but an excerpt
  // could capture adjacent user-authored decision-graph labels).
  V5ExplanationAnswerVerdict: "v5.explanation.answer_verdict",
  // V5ExplanationEvidence — observability-only mirror of Sonnet's
  // evidence_used / cited_fields. Emitted when at least one entry is
  // present. Never persisted on the handler fact and never surfaced to the
  // user. Payload: { handler_id, evidence_used, cited_fields }.
  V5ExplanationEvidence: "v5.explanation.evidence",
  // V5ExplanationValidationBeat — mechanism record for the "what to
  // validate" beat on the explain_results execute path
  // (V5-LANE-B-STRUCTURAL-01). Emitted once per execute-verdict
  // explain_results turn so live smoke can assert the mechanism, not just
  // the surface text. Payload: { handler_id, mechanism: 'appended' |
  // 'dedup_skipped' | 'omitted', variant?: 'link' | 'driver',
  // from_label?, to_label?, driver_label?, omission_reason? }.
  // The label fields follow the V5ExplanationEvidence precedent above:
  // observability-only display labels, never persisted on the handler fact
  // (the generated fact schema is .strict(); a persisted field is a
  // @talchain/schemas follow-up blocked behind V5-CI-01) and never
  // surfaced to the user from here.
  V5ExplanationValidationBeat: "v5.explanation.validation_beat",
  // V5UnexpectedExplanationPayload — emitted when a mutation/computation
  // handler (run_analysis, draft_graph, edit_graph) carries a stray
  // `explanation` field. The field is silently dropped; the user is not
  // shown an error. Payload: { handler_id, request_id }.
  V5UnexpectedExplanationPayload: "v5.unexpected_explanation_payload",
  // V5MutationLanguageGuard — STEP 6 log-only check. Emitted when the
  // final composed assistant_text on a non-edit handler turn matches the
  // mutation-language regex despite the side-band check. Detection only;
  // the final text is NOT mutated at this stage. Payload:
  // { handler_id, text_length }.
  V5MutationLanguageGuard: "v5.mutation_language_guard",
  // V5StructuralSuccessClaimSwapped — Brief 4 STEP 6.6 ENFORCING gate.
  // Emitted when a turn that committed NO durable mutation produced a
  // first-person structural success claim and the gate replaced the text
  // with the honest decline. Safe metadata only (no raw assistant text).
  // Payload: { request_id, scenario_id, handler_id, text_length }.
  V5StructuralSuccessClaimSwapped: "v5.structural_success_claim_swapped",
  // V5StructuralSuccessClaimCandidateMiss — Brief 4 STEP 6.6 MONITOR.
  // Non-blocking observability for possible false-negatives: no mutation
  // committed, broad mutation language is present, but the narrow structural
  // detector did NOT fire (so no swap). Used to surface novel phrasings the
  // narrow detector should learn. Safe metadata only.
  // Payload: { request_id, scenario_id, handler_id, text_length }.
  V5StructuralSuccessClaimCandidateMiss: "v5.structural_success_claim_candidate_miss",
  // V5ResponseProseSanitised — STEP 6.4 defence-in-depth post-compose
  // prose sanitiser. Emitted when at least one rewrite/match occurred
  // on the final composed assistant_text — covers raw decimal
  // probabilities, raw sensitivity values, and structural edge-strength
  // language that survived the LLM despite prompt-level guidance.
  // Payload:
  // { handler_id, mode, probability_rewrites, sensitivity_rewrites,
  //   structural_matches, structural_suppressed,
  //   structural_missed_grammar, structural_rule_ids }.
  // `mode`: 'rewrite' (legacy — text was mutated) | 'detect_only'
  // (current — text passes through unchanged, counters still emitted
  // as a regression canary). The flip to 'detect_only' landed with
  // A2.2 Task 2 once upstream display-safe projections (A2 / A2.1 /
  // A2.2) closed every known source of raw-numeric leakage.
  V5ResponseProseSanitised: "v5.response.prose_sanitised",
  // V5DeterministicValueUpdate — emitted when the pre-LLM value-update
  // pre-route runs. `matched: true` means the turn was dispatched as a
  // clarify direct_answer without an LLM call; `matched: false` means the
  // pre-route declined and the turn proceeded to the LLM. Payload:
  // { matched, dispatch?, candidate_count?, top_score?, skip_reason?,
  //   cqe_quantity_count }.
  V5DeterministicValueUpdate: "v5.deterministic_value_update",

  // V5 Context Management v1 — context-readiness snapshot. Emitted once
  // per turn, immediately after context-pack assembly + analysis-freshness
  // derivation, so operators can see at a glance what CEE knew when
  // routing fired (graph/brief presence, prior fact counts,
  // successful-run-analysis presence, freshness verdict + graph hashes,
  // pending action count, recent_changes count, Phase 3 block context
  // availability, context_pack size).
  //
  // Privacy contract: every NON-ROUTING field is a number, boolean, the
  // freshness enum, or a graph hash. `request_id` and `scenario_id` are
  // the two allowed routing strings; the two graph_hash fields are
  // SHA-prefix strings already emitted by `v5.analysis_freshness.derived`
  // (safe). No user prose, no labels, no raw entity / node / edge /
  // option / fact IDs, no decision_review content.
  V5ContextReadiness: "v5.context_readiness",

  // V5 Context Management v1 — sibling stale-rerun guard. Fires for the
  // narrow case where prior analysis is stale (graph hash diverged) AND
  // the user is asking an analytical question (explain / what_drove /
  // what_would_flip / rerun_question) AND there is no concrete
  // mutation signal. Short-circuits to a deterministic direct_answer
  // that nudges re-run, mirroring the Phase 3 stale-safe coaching block
  // copy + action shape. Payload: structural enums + booleans only.
  V5StaleRerunGuard: "v5.stale_rerun_guard",

  // V5 P0.2 — run-comparison gate. Fires on a result-sense "what
  // changed?" turn. Payload: structural enums + booleans only (gate
  // mode, matched, unmatched_reason, leading_option_changed) — no
  // option/factor labels, no copy.
  V5RunComparisonGate: "v5.run_comparison_gate",

  // V5 P0.2 — flip-threshold proposal emitted on a what_would_flip turn.
  // Content-free: { result: 'emitted'|'no_proposal'|'unsafe_copy'|
  // 'unknown_intent' } — no factor labels, values, or copy.
  V5ProposedChangeEmitted: "v5.proposed_change.emitted",

  // V5 Context Management v1 — sibling no-analysis guard. Fires when no
  // successful run_analysis fact exists AND the user is asking an
  // analytical question. Short-circuits to a deterministic direct_answer
  // that nudges the user to run analysis first. Payload: structural
  // enums + booleans only.
  V5NoAnalysisGuard: "v5.no_analysis_guard",

  // V5 Context Management v1 — edit_graph no-op recovery. Emitted from
  // the dispatchEditGraph no-op branch when the recovery decision is
  // computed. Replaces the bland fallback with context-aware copy when
  // the message is analytical (and analysis exists) or with a concise
  // clarification when the message looks edit-like but vague. Payload:
  // structural enums + booleans only. `intent_class` is the
  // AnalyticalIntentClass enum or null; `branch_taken` is the recovery
  // branch enum:
  //   analytical_fresh / analytical_stale / analytical_none / vague_edit
  //   / explore_factor / explore_factor_stale / ambiguous
  // The `explore_factor` / `explore_factor_stale` pair was added as a
  // safety net for label-shaped no-op messages that slip past the
  // upstream `tryPostAnalysisLabelIntercept` (V5PostAnalysisLabelIntercept
  // event below). The `_stale` variant fires when the prior analysis is
  // stale; it emits a single re-run chip instead of the three
  // exploration chips so users never get an analysis-grounded nudge
  // against an out-of-date result.
  V5EditGraphNoOpRecovery: "v5.edit_graph.no_op_recovery",
  // R7 — one structured event per edit_graph turn (content-free; pino /
  // Datadog-log only, registered debug-only in the freeze-gate).
  V5EditGraphTurn: "v5.edit_graph.turn",

  // V5 edit lifecycle recovery v1 — pre-LLM intercept for the legacy
  // V4 "Simplify the change" facilitator chip (edit-graph.ts:2096,
  // :2198). The chip submits the free-text prompt "Try a simpler
  // version of this change.", which on its own would match
  // EDIT_GRAPH_POSITIVE_REGEX (via "change") and re-enter the V4
  // edit_graph LLM — typically producing another empty-operations
  // no-op. This event fires when route-v2's chip-simplify-intercept
  // short-circuits that loop with deterministic clarification copy,
  // BEFORE the LLM call. Payload:
  //   - source: 'exact_text' (only leg shipped in this PR; future
  //     metadata leg will add 'chip_metadata').
  //   - prior_analysis_is_fresh: boolean — whether the request's
  //     `analysisState` carries a successful `analysis_status` AND a
  //     `graph_hash_at_run` matching the current graph hash. Always
  //     boolean; the previous async DB-backed derivation that could
  //     also return `null` on session-store failure was replaced
  //     (PR #194 review-1) with a pure request-local helper that
  //     returns `false` when it cannot verify.
  V5InterceptedChipClarify: "v5.edit_graph.intercepted_chip_clarify",

  // V5 edit lifecycle recovery v1 — pre-LLM narrow vague-edit guard.
  // Fires when route-v2's vague-edit-guard short-circuits a free-text
  // edit message that cleared the existing route-v2 gates but is too
  // underspecified to spend an LLM call on (no numeric, no factor /
  // edge / option anchor, no add/remove construct, no mutation
  // signal, not a question). Payload:
  //   - prior_analysis_is_fresh: boolean — same shape as the
  //     chip-clarify event above (always boolean since PR #194
  //     review-1; see V5InterceptedChipClarify for the rationale).
  //   - chips_emitted: number — how many graph-derived chips the
  //     clarify composer attached (0 means cancel-only).
  V5InterceptedVagueEdit: "v5.edit_graph.intercepted_vague_edit",

  // V5 edit lifecycle recovery v1 — pre-edit analytical-question
  // guard. Fires when route-v2 detected an edit verb in the message
  // (EDIT_GRAPH_POSITIVE_REGEX matched) AND the analytical-question
  // guard suppressed `editIntentDetected` because the message is a
  // hypothetical / analytical question about the outcome
  // (e.g. "What could change the outcome?"). The turn then falls
  // through to TurnExecutor where the post-analysis advice gate /
  // `what_would_flip` handler owns the response. Payload is
  // structural only:
  //   - intent_class: AnalyticalIntentClass | null — null when the
  //     match came from this guard's additional patterns rather
  //     than `classifyAnalyticalIntent`.
  V5EditGraphAnalyticalQuestionSuppressed:
    "v5.edit_graph.analytical_question_suppressed",

  // V5 Signature Loop — route-level proposal-confirmation guard. Emitted when
  // a confirmation-shaped, edit-verb-bearing message ("make that update",
  // "make that change", "update the model") reaches the edit_graph intent
  // gate. Resolves the proposal-vs-edit ambiguity BEFORE edit routing so a
  // confirmation can never no-op into edit_graph and wipe the pending
  // proposal. Diagnostic-only; the operational outcome is the suppressed edit
  // dispatch / the no-live-proposal clarification.
  //
  // Payload:
  //   - outcome: 'suppressed_live'        — ≥1 route-visible-live, graph-safe
  //              proposal → edit routing + Stage-4A intercepts bypassed; falls
  //              through to TurnExecutor, which makes the AUTHORITATIVE apply /
  //              supersede / idempotency decision (NOT a guarantee of mutation).
  //            | 'clarify_none'           — read OK, no pending proposal at all.
  //            | 'clarify_expired'        — read OK, only wall/turn-expired ones.
  //            | 'clarify_hash_mismatch'  — read OK, only graph-hash-stale ones.
  //            | 'suppressed_read_failed' — pending read THREW; degrade safely
  //              by suppressing edit routing (do NOT silently look like "none").
  //   - live_candidate_count: number      — live, graph-safe apply_proposed_change.
  // The three `clarify_*` outcomes drive the deterministic no-live-proposal
  // response; `suppressed_read_failed` is the distinct read-failure trace.
  V5EditGraphProposalConfirmResolved: "v5.edit_graph.proposal_confirm_resolved",

  // V5 Signature Loop — route-level state-query guard. Emitted when a question
  // phrase that contains an edit verb ("what did you just change?", "what did
  // that update do?") is recognised at the edit_graph intent gate and edit
  // routing is suppressed, so the turn falls through to TurnExecutor where the
  // recent-changes-grounded `tryStateQueryGuard` answers it instead of a
  // mutating edit. Diagnostic-only. Payload: request_id, scenario_id.
  V5EditGraphStateQuerySuppressed: "v5.edit_graph.state_query_suppressed",

  // V5 Signature Loop — refresh-continuation guard. Emitted when a turn arrives
  // at frame stage with no request graph but the scenario already has committed
  // turns (refresh / reconnection). The guard suppresses the draft_graph /
  // frame-no-brief "start over" shortcuts so the turn reaches TurnExecutor,
  // which reconstructs memory from server-side state (persisted graph + recent
  // turns) instead of re-asking for the brief. Diagnostic-only.
  //
  // Payload:
  //   - guard: 'draft_graph' | 'frame_no_brief' — which shortcut was skipped.
  //   - prior_turns_present: true                — the discriminator that fired.
  V5ContinuationGuardApplied: "v5.continuation.guard_applied",

  // V5 product-state continuity (foamy-bee tranche) — emitted by the
  // deterministic state-query guard. Closes the named misroute class
  // where "what update did you make?" routes to legacy edit_graph and
  // returns "No changes were needed for this request."
  //
  // Payload:
  //   - matched: boolean — did the message match a state-query phrase
  //   - dispatch?: 'with_recent_change' | 'no_recent_changes' — only set
  //     when matched
  //   - recent_change_count: number — entries projected into ContextPack
  //   - prior_mutation_fact_count: number — successful mutation facts
  //     across prior_facts (not capped, used for observability)
  //
  // The `matched: true` branch means the turn was dispatched as a
  // direct_answer with no LLM call. `matched: false` means the guard
  // declined and the turn proceeded to the LLM (still grounded by the
  // recent_changes ContextPack projection if any mutations exist).
  V5StateQueryGuard: "v5.state_query_guard",

  // V5 P0 stabilisation — post-analysis advice gate / deterministic
  // post-analysis router.
  //
  // Fires once per turn, AFTER the state-query guard and BEFORE the LLM
  // routing call. Records whether the gate short-circuited the turn
  // (matched=true → deterministic direct_answer) or fell through to
  // normal routing.
  //
  // Payload:
  //   - request_id: string
  //   - scenario_id: string
  //   - matched: boolean
  //   - unmatched_reason: 'no_analysis' | 'mutation_signal' |
  //     'no_advice_signal' | 'empty_message' | 'not_fresh' |
  //     'data_unavailable_for_class' | null
  //     ('no_leading_option' was retired post-PR #173: missing
  //     leading_option now surfaces uniformly as
  //     'data_unavailable_for_class' with `missing_inputs: ['leading_option']`
  //     so dashboards see the matched class.)
  //   - advice_class: 'advice' | 'next_step' | 'update_advice' |
  //     'improvement' | 'meaning' | 'readiness' | 'evidence_gap' |
  //     'explain_results_free_text' | 'what_would_flip_free_text' | null
  //     Surfaced on `matched=true` AND on the
  //     `data_unavailable_for_class` fall-through so dashboards can
  //     see which class is producing fall-throughs without re-running
  //     the matcher.
  //   - missing_inputs: string[] | null — only set when
  //     `unmatched_reason === 'data_unavailable_for_class'`. Lists
  //     which required-input keys were absent (e.g. ['top_driver'],
  //     ['analysis_ready']).
  //   - leading_option_present: boolean — analysis projection had a
  //     leading option at gate-evaluation time
  //   - top_driver_present: boolean — top driver label was available
  //     for the composed prose
  //   - suggested_action_count: number — count of chips threaded into
  //     the direct_answer response. Zero on unmatched turns; per-class
  //     on matched turns (1 for explain/meaning/advice/next_step/
  //     update_advice/improvement; 0 for what_would_flip_free_text /
  //     readiness / evidence_gap). Structural-only — chip labels and
  //     message strings are not emitted.
  V5PostAnalysisAdviceGate: "v5.post_analysis_advice_gate",

  // V5 fresh-analysis follow-up guard — catch-net for analytical questions
  // the post-analysis advice gate could not synthesise (data_unavailable_for_class
  // fall-through OR pattern gap between the 9-class advice taxonomy and
  // analytical-intent.ts). Fires once per turn, AFTER the advice gate and
  // BEFORE the LLM router. Records whether the new guard intercepted the
  // turn and which existing handler the chip points at.
  //
  // Payload:
  //   - request_id: string
  //   - scenario_id: string
  //   - matched: boolean
  //   - unmatched_reason: 'not_fresh' | 'no_analysis_fact' | 'empty_message'
  //     | 'mutation_signal' | 'no_analytical_signal' | null
  //   - intent_class: 'explain' | 'what_drove' | 'what_would_flip'
  //     | 'rerun_question' | null
  //   - analysis_freshness: 'fresh' | 'stale' | 'unknown' | 'none' | null
  //   - selected_path: 'fresh_analysis_followup' | null
  //   - selected_action_type: 'explain_results' | 'what_would_flip' | null
  V5FreshAnalysisFollowupGuard: "v5.fresh_analysis_followup_guard",

  // V5 P0 stabilisation — bounded routing-failure fallback.
  //
  // Fires when the routing call returns a "model output failed" error
  // class (max_tokens / empty_response / schema_repair_failed) and the
  // turn executor degrades to a deterministic direct_answer envelope
  // with recovery chips instead of a 500 BoundaryError. Allows ops to
  // see how often the bounded fallback fires and which cause is
  // dominant.
  //
  // Payload:
  //   - request_id: string
  //   - scenario_id: string
  //   - routing_error_cause: 'schema_repair_failed' | 'empty_response' |
  //     'unexpected_stop_reason'
  //   - llm_calls_used: number — attempts before bounded-fallback
  //   - analysis_ready: boolean — drove the chip set
  V5RoutingBoundedFallback: "v5.routing_bounded_fallback",

  // V5 WS1 / E4 — pre-LLM evidence that the curated `recent_changes`
  // projection reached the routing payload assembly. Emitted exactly
  // once per turn, immediately before the `routeWithToolUse` call,
  // and only when the state-query guard did NOT short-circuit the turn
  // (i.e. the LLM is about to be called). NEVER logs the curated
  // content itself — only the count, a presence flag, and a short
  // canonical hash so operators can prove the same projection reached
  // multiple turns / instances.
  //
  // Payload:
  //   - request_id: string
  //   - scenario_id: string
  //   - recent_change_count: number — 0 when the field is missing or
  //     not an array (regression signal).
  //   - recent_changes_field_present: boolean — derived at runtime via
  //     Array.isArray on the actual contextPack field. Today's
  //     assembler unconditionally populates `recent_changes` as a
  //     frozen array, so this flag is `true` on every healthy turn;
  //     however a future assembler regression that drops the field or
  //     emits it as a non-array would fire this event with `false` and
  //     count 0, making the regression detectable from logs alone
  //     without a code-search.
  //   - recent_changes_hash: string — see
  //     `deriveRecentChangesEvidence` in recent-changes.ts. Returns the
  //     literal "empty" sentinel when count is zero (including the
  //     missing-field regression case).
  V5RecentChangesPreLlm: "v5.recent_changes.pre_llm",

  // V5 stale-aware explain recovery — finaliser-level egress guard
  // detected a forbidden user-facing phrase in `response.assistant_text`
  // (per `FORBIDDEN_USER_FACING_PHRASES` in
  // `src/orchestrator-v5/compose/forbidden-user-facing-phrases.ts`).
  // Fires from turn-executor's `finalizeRun()` and the terminal compose
  // points of `edit-graph-dispatch.ts` / `chip-click-dispatch.ts` so
  // EVERY emit path (deterministic templates, LLM output, fallback
  // copy, recoverable-handler recovery) is covered uniformly.
  //
  // Payload:
  //   - request_id: string
  //   - scenario_id: string
  //   - phrase: string — the matched substring verbatim (NOT the
  //     regex source) so dashboards group by user-visible text.
  //   - dispatch_path: string — one of 'turn_executor_finalise',
  //     'edit_graph_finalise', 'chip_click_finalise' so the on-call
  //     can attribute hits to the producing surface without grepping.
  //
  // On hit, the runtime ALSO replaces `assistant_text` with a neutral
  // fallback that does not contain any forbidden phrase, so the user
  // never sees the contradictory wording even when an upstream emit
  // path produces it. The chip set + blocks are preserved so the
  // user retains a recovery affordance.
  V5EgressForbiddenPhraseDetected: "v5.egress.forbidden_phrase_detected",

  // V5 Phase 2 workstream E — PLoT response carries non-finite numeric
  // value (NaN / +Infinity / -Infinity) at ingress. Walker is structural
  // so any new PLoT field is covered automatically. Payload:
  // { request_id, session_id, field_path, value_repr }.
  // Handler responds by throwing HandlerInvocationFailedError; UI surfaces
  // the standard recovery chip via buildFailureResponse.
  PlotResponseInvalidNumeric: "v5.plot_response.invalid_numeric",

  // V5 Phase 2 workstream C — defence-in-depth signal from the display
  // formatters. Workstream E rejects non-finite values at ingress; if a
  // value still reaches `formatProbability` / `formatPercentagePoints`
  // outside the legal range, this event fires so ops can trace the
  // upstream root cause. Payload: { field_path, value_kind, detail }.
  // value_kind: 'non_finite' (NaN/Infinity) | 'out_of_range' (<0 or >1).
  ProbabilityOutOfRange: "v5.probability_out_of_range",

  // V5 Phase 2 workstream B — Sonnet's draft_graph narration explicitly
  // states a node/edge count that DISAGREES with the final post-repair
  // graph. Dispatcher prefers the deterministic fallback in this case
  // and emits this event so ops can chase the upstream prompt drift.
  // Payload: { request_id, final_node_count, final_edge_count,
  //            narration_node_count, narration_edge_count,
  //            narration_length }.
  // Strict semantic — only real mismatches fire here. The matched-but-
  // graph-shaped suppression case is a separate event below
  // (DraftNarrationCountSuppressed) so ops dashboards / alerts that
  // page on this event keep their original baseline.
  DraftNarrationCountMismatch: "v5.draft_narration.count_mismatch",
  // brief brief-display-safe-analysis A2 — Sonnet's narration carried
  // node/edge-count wording that AGREED with the final graph, but the
  // wording itself is graph-shaped framing the brief forbids. The
  // dispatcher replaces it with the decision-language fallback. Distinct
  // from DraftNarrationCountMismatch so ops can track Sonnet's residual
  // count-shaped narration rate without polluting the mismatch alert.
  // Payload: { request_id, final_node_count, final_edge_count,
  //            narration_node_count, narration_edge_count,
  //            narration_length }.
  DraftNarrationCountSuppressed: "v5.draft_narration.count_suppressed",

  // V5 post-draft coaching gated-hybrid composer — which source filled
  // the sentence-4 assumption (or replaced the whole response). Emitted
  // by the draft_graph dispatcher after buildPostDraftNarrative runs on
  // the success path. Category/count only — never logs raw user or
  // coaching text. Payload:
  // { request_id, scenario_id,
  //   assumption_source: 'coaching_summary' | 'strengthen_item_detail'
  //                    | 'strengthen_item_label' | 'bias_finding'
  //                    | 'coaching_bias_signal' | 'uncertainty_driver'
  //                    | 'deterministic_fallback',
  //   coaching_summary_present: boolean,
  //   coaching_summary_passed_gate: boolean,
  //   coaching_summary_reject_reason: GateRejectReason | null,
  //   fallback_reason: 'gate_rejected' | 'no_candidate' | null,
  //   strengthen_items_count: number,
  //   bias_findings_count: number,
  //   coaching_bias_signals_count: number }.
  //
  // GateRejectReason values: 'empty' | 'too_short' | 'too_long' |
  //   'em_dash' | 'internal_id' | 'schema_term' | 'graph_shape' |
  //   'premature_recommendation' | 'question_shaped' |
  //   'trailing_punctuation' | 'awkward_grammar' | 'markdown' |
  //   'no_decision_framing' | 'no_tradeoff_or_gap' | 'no_next_step'.
  V5PostDraftCoachingSourceSelected: "v5.post_draft_coaching.source_selected",

  // V5 Phase 2 workstream A — post-analysis coaching wrapper fired.
  // SUCCESS telemetry of the post-analysis chip wrapper: an analyse-stage
  // direct_answer with a fresh run_analysis fact yielded ≥1
  // review-card-derived chip. NOT an empty-answer salvage — that is
  // v5.coaching.empty_answer_recovered (V5CoachingEmptyAnswerRecovered);
  // conflating the two caused a real misdiagnosis in the 11 Jul manual
  // test (1.16j). No fact is committed — recovery state travels on this
  // event only (see post-analysis-wrapper.ts's result doc comment; the
  // earlier version of this comment predated the P0 fix that dropped the
  // persisted fact). Name is frozen (deliberate-update-only registry) —
  // clarity lives in this comment and at the emit site, not in a rename.
  // Payload: { request_id, session_id, chip_count, selected_card_count,
  //   answer_text_hash, generated_chip_ids, selected_review_card_ids,
  //   freshness_at_response }.
  PostAnalysisDirectAnswerRecovered: "v5.post_analysis.direct_answer_recovered",
  // Companion to ...Recovered: emitted when the wrapper's trigger
  // conditions fail (or unsupported card_types are filtered out).
  // Payload: { request_id, session_id, reason, unsupported_count? }.
  // reason: 'no_run_fact' | 'stale_analysis' | 'no_review_cards'
  //       | 'unsupported_chip_actions' | 'non_analyse_stage'
  //       | 'freshness_unknown'.
  PostAnalysisDirectAnswerRecoverySkipped: "v5.post_analysis.direct_answer_recovery_skipped",

  // CI hygiene baseline (claude-v5/ci-hygiene-baseline) — pre-existing live
  // emit() call sites that were never registered, causing Telemetry Event
  // Name Validation to fail on every staging push. Registry-only addition;
  // no new emissions. Each entry corresponds to one or more currently active
  // emit() sites in src/ (xml_parse_fallback fires from three sites, the
  // streaming preflight failure from two, the rest from one each).
  EditGraphNoOperations: "edit_graph.no_operations",
  StreamingGeneratorPreflightFailure: "streaming.generator_preflight_failure",
  DeterministicPmsFallbackUsed: "deterministic.pms_fallback_used",
  V4PmsFallbackUsed: "v4.pms_fallback_used",
  DeterministicBannedTermDetected: "deterministic.banned_term_detected",
  OrchestratorDiagnosticsPreambleStripped: "orchestrator.diagnostics_preamble_stripped",
  OrchestratorXmlParseFallback: "orchestrator.xml_parse_fallback",
  CeeStage2EdgeCountInvariantViolated: "cee.stage2.edge_count_invariant_violated",
  CeePostEnrichInvariantViolation: "cee.post_enrich.invariant_violation",

  // Lane CEE-D (edit-loop reliability) — additive parse-shape recovery
  // event: parseEditGraphResponse received a BARE SINGLE-OPERATION object
  // (either emitted directly by the model, or produced by the greedy
  // object extraction slicing the first op out of a prose-wrapped
  // single-op legacy array) and wrapped it into `operations: [op]`
  // instead of failing with 'v2 response missing required "operations"
  // array'. Payload: { op } — the operation kind only, no user text.
  EditGraphBareSingleOpWrapped: "edit_graph.bare_single_op_wrapped",

  // Lane CEE-D (edit-loop reliability) — relative-delta resolution at the
  // set_factor_value dispatch seam (turn-executor STEP 2, before
  // validateToolCall). A proposal carrying a relative percent expression
  // (structured { value, unit:'%' } with increase/decrease, or a string
  // "+5%"/"-10%") was resolved against the factor's CURRENT value into an
  // absolute `set` proposal. Live trace: request_id baca4f1c ("increase
  // it slightly by 5%" → PARAMETER_INVALID → recovered template).
  // Payload (system ids + closed enums only — no user values):
  //   - request_id / scenario_id
  //   - handler_id: 'set_factor_value'
  //   - target_id: node id
  //   - direction: 'increase' | 'decrease'
  //   - source_shape: 'structured_percent' | 'string_percent'
  //   - value_unit_guard_skipped: boolean — the P0-A containment guard is
  //     bypassed for the resolved proposal because the % token was
  //     deliberately consumed by the resolution, not silently dropped.
  V5RelativeDeltaResolved: "v5.turn_executor.relative_delta_resolved",

  // PR #414 review — F3 fail-open fallback visibility. The STEP 7 commit
  // chokepoint re-projects the committed D1 graph (wire `analysis_ready` +
  // the egress label graph) through GraphV3; when that parse FAILS the turn
  // fails open to the pre-mutation wire projection (the pre-#414 behaviour)
  // instead of dropping readiness from the wire. Should be unreachable — D1
  // handlers GraphV3-validate the mutated graph and the persistence merge
  // only restores top-level fields — so any hit is a merge-seam / schema
  // drift signal that must be dashboard-visible, not warn-log-only.
  // Content-free payload:
  //   request_id, scenario_id: string  (correlation only)
  //   handler_id: string | null        (closed handler enum)
  //   first_issue_path: string         (first zod issue path, dot-joined —
  //                                     schema keys/indices only, never values)
  V5CommittedGraphReprojectionFailed:
    "v5.turn_executor.committed_graph_reprojection_failed",

  // V5 post-analysis exploration intercept — fires when route-v2's
  // `tryPostAnalysisLabelIntercept` short-circuits a chip-click /
  // free-text submission that would otherwise dispatch into V4
  // `edit_graph` and no-op. Two predicates share the event so
  // dashboards can attribute hits to:
  //   - 'bare_label'       — forward-looking gate (new chips and
  //                          free-text label submissions).
  //   - 'legacy_fill_in'   — catches the EXACT in-flight failing
  //                          shape `Change <known label> [—|–|-]`
  //                          rendered by the pre-Touch-4
  //                          `buildLabelChip` in
  //                          `compose/edit-clarify-response.ts`.
  //                          Can be retired once that chip's submit
  //                          message has bled through deployed UIs.
  //
  // Payload (structural enums + booleans only — NO label text):
  //   - request_id: string
  //   - scenario_id: string
  //   - predicate: 'bare_label' | 'legacy_fill_in'
  //   - match_kind: 'exact'
  //   - node_kind: string — the matched graph node's `kind` field
  //     ('factor' | 'option' | 'driver' | ...); not enumerated so a
  //     future kind doesn't require a telemetry-registry edit.
  //   - chips_emitted: number — always 3 in the current composer;
  //     dashboards can alert on drift if a future change reduces it.
  //
  // No label text crosses the wire. The matched node's `label`
  // surfaces ONLY in the user-facing `assistant_text` via the
  // composer in `routing/post-analysis-label-intercept.ts`.
  V5PostAnalysisLabelIntercept: "v5.post_analysis_label_intercept",

  // V5 link-safe response floor — analysis headline Case-E fallback. Fires
  // from src/orchestrator-v5/tools/handlers/run-analysis.ts when the
  // deterministic headline builder chooses the minimal Case-E branch
  // (`{label} currently leads.`) because stronger cases (A/B/C/D) did not
  // qualify. Surfaces *why* the stronger cases were skipped so we can tune
  // the strict gates over time. Metadata-only — no user prose or label
  // text crosses the wire.
  V5HeadlineFellBack: "v5.headline.fell_back",

  // V5 link-safe response floor — chip floor. Fires from
  // src/orchestrator-v5/compose/chip-generator.ts. EmptyIntentional is
  // emitted when a 200 response legitimately has no chips (clarification,
  // terminal acknowledgement, error recovery, or no safe floor available).
  // FloorApplied is emitted when the generator would otherwise return an
  // empty array but the floor mechanism picks a single safe deterministic
  // chip based on `analysisReady.status` / handler facts / freshness. Both
  // events carry only reason classes + booleans/counts — no user text.
  V5ChipsEmptyIntentional: "v5.chips.empty_intentional",
  V5ChipsFloorApplied: "v5.chips.floor_applied",
  // ROADMAP 1.20(b) — chip-sameness guard. Fires when ANY candidate chip
  // this turn computed (raw rules + floor) exactly matches a chip offered
  // on the immediately-prior turn (`most_recent_pending_actions` chip_id
  // set) — the generator drops the repeated chips and ships only the
  // survivors (an honest empty set when EVERY candidate was a repeat), so
  // chip selection varies turn to turn instead of looping the same
  // suggestion regardless of content. Payload: suppressed chip ids +
  // survivor count only (no user text).
  V5ChipsRecentlyOfferedSuppressed: "v5.chips.recently_offered_suppressed",

  // V5 Lane 2 — egress chip-quality finalizer aggregate. Fires from
  // src/orchestrator-v5/compose/output-safety.ts (the egress chokepoint)
  // when the deterministic finalizer drops (unsafe/generic), dedupes, or
  // budget-trims the response's chips. Content-free: scalar counts +
  // request_id + bounded exit_path only — no user copy. Diagnostic-only
  // (no Datadog metric); per-chip detail is a separate v5.chip.suppressed
  // structured log.
  V5ChipsFinalized: "v5.chips.finalized",

  // V6 dual-model draft enrichment (CEE_V6_DUAL_DRAFT_ENABLED, default OFF).
  // Fires from src/cee/dual-draft/. Content-free: counts, coded reasons,
  // model ids and latencies only — proposal free text never leaves the stage.
  // M2Outcome: one per enrichment attempt (outcome kind + latency + model).
  // MergeReport: exact-one-bucket accounting (applied / artifacts / failure-
  // code histogram / post_merge_valid). Degraded: the stage returned the M1
  // graph with the coded reason (fail-open is recorded, never silent).
  V6DualDraftM2Outcome: "v6.dual_draft.m2_outcome",
  V6DualDraftMergeReport: "v6.dual_draft.merge_report",
  V6DualDraftDegraded: "v6.dual_draft.degraded",
} as const;

/**
 * All valid event names (for CI validation)
 */
export const VALID_EVENT_NAMES: Set<string> = new Set(Object.values(TelemetryEvents));

/**
 * Datadog StatsD client (optional, configured via DD_AGENT_HOST)
 * Exported as `statsd` for use by performance-monitoring plugin
 */
let datadogClient: StatsD | null = null;

if (env.DD_AGENT_HOST || env.DD_API_KEY) {
  datadogClient = new StatsD({
    host: env.DD_AGENT_HOST || "127.0.0.1",
    port: Number(env.DD_AGENT_PORT) || 8125,
    prefix: "olumi.assistants.",
    globalTags: {
      service: env.DD_SERVICE || "olumi-assistants-service",
      env: env.DD_ENV || env.NODE_ENV || "development",
    },
    errorHandler: (error: Error) => {
      log.error({ error }, "Datadog StatsD error");
    },
  });
  log.info({ dd_host: env.DD_AGENT_HOST }, "Datadog StatsD client initialized");
}

/** Exported StatsD client for use by other modules (may be null) */
export const statsd = datadogClient;

export type TelemetryLeaf = string | number | boolean | null | undefined;
export type TelemetryShape = {
  [key: string]: TelemetryLeaf | TelemetryShape | Array<TelemetryLeaf | TelemetryShape>;
};
export type Event = Record<string, unknown>;

function sanitizeTelemetryValue(
  value: unknown
): TelemetryLeaf | TelemetryShape | Array<TelemetryLeaf | TelemetryShape> | undefined {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === undefined
  ) {
    return value as TelemetryLeaf;
  }

  if (Array.isArray(value)) {
    // Cap arrays to avoid high-cardinality telemetry
    const MAX_ARRAY_ITEMS = 10;
    const SAMPLE_SIZE = 3;

    if (value.length > MAX_ARRAY_ITEMS) {
      // Truncate large arrays to a summary object
      const sample: Array<TelemetryLeaf | TelemetryShape> = [];
      for (let i = 0; i < Math.min(SAMPLE_SIZE, value.length); i++) {
        const sanitizedItem = sanitizeTelemetryValue(value[i]);
        if (sanitizedItem !== undefined) {
          sample.push(sanitizedItem as TelemetryLeaf | TelemetryShape);
        }
      }
      return {
        truncated: true,
        count: value.length,
        sample,
      } as TelemetryShape;
    }

    const sanitizedArray: Array<TelemetryLeaf | TelemetryShape> = [];
    for (const item of value) {
      const sanitizedItem = sanitizeTelemetryValue(item);
      if (sanitizedItem !== undefined) {
        sanitizedArray.push(sanitizedItem as TelemetryLeaf | TelemetryShape);
      }
    }
    return sanitizedArray;
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const sanitizedObj: TelemetryShape = {};
    for (const [key, v] of Object.entries(obj)) {
      const sanitizedChild = sanitizeTelemetryValue(v);
      if (sanitizedChild !== undefined) {
        sanitizedObj[key] = sanitizedChild as
          | TelemetryLeaf
          | TelemetryShape
          | Array<TelemetryLeaf | TelemetryShape>;
      }
    }
    return sanitizedObj;
  }

  return undefined;
}

function sanitizeTelemetryData(data: Event): TelemetryShape {
  const result: TelemetryShape = {};
  for (const [key, value] of Object.entries(data)) {
    const sanitized = sanitizeTelemetryValue(value);
    if (sanitized !== undefined) {
      result[key] = sanitized as
        | TelemetryLeaf
        | TelemetryShape
        | Array<TelemetryLeaf | TelemetryShape>;
    }
  }
  return result;
}

/**
 * Anthropic pricing (updated 2026-03)
 * Update these if pricing changes or using different models
 * Reference: https://www.anthropic.com/pricing
 */
const ANTHROPIC_PRICING = {
  // Claude 4.x family
  "claude-sonnet-4-20250514": {
    input_per_1k: 0.003,   // $3 per million input tokens
    output_per_1k: 0.015,  // $15 per million output tokens
  },
  "claude-sonnet-4-6": {
    input_per_1k: 0.003,   // $3 per million input tokens
    output_per_1k: 0.015,  // $15 per million output tokens
  },
  "claude-sonnet-4-5-20250929": {
    input_per_1k: 0.003,   // $3 per million input tokens
    output_per_1k: 0.015,  // $15 per million output tokens
  },
  "claude-opus-4-20250514": {
    input_per_1k: 0.015,   // $15 per million input tokens
    output_per_1k: 0.075,  // $75 per million output tokens
  },
  "claude-opus-4-6": {
    input_per_1k: 0.015,   // $15 per million input tokens
    output_per_1k: 0.075,  // $75 per million output tokens
  },
  "claude-opus-4-5-20251101": {
    input_per_1k: 0.015,   // $15 per million input tokens
    output_per_1k: 0.075,  // $75 per million output tokens
  },
  // Claude Haiku 4.5 — current fast tier (replacement for the retired 3.5 Haiku)
  "claude-haiku-4-5": {
    input_per_1k: 0.001,   // $1 per million input tokens
    output_per_1k: 0.005,  // $5 per million output tokens
  },
  // Claude 3.5 family (RETIRED by Anthropic 2026-02-19; kept for historical cost tracking)
  "claude-3-5-haiku-20241022": {
    input_per_1k: 0.0008,  // $0.80 per million input tokens
    output_per_1k: 0.004,  // $4 per million output tokens
  },
  // Legacy Claude 3 (kept for historical cost tracking)
  "claude-3-5-sonnet-20241022": {
    input_per_1k: 0.003,   // $3 per million input tokens
    output_per_1k: 0.015,  // $15 per million output tokens
  },
  "claude-3-opus-20240229": {
    input_per_1k: 0.015,   // $15 per million input tokens
    output_per_1k: 0.075,  // $75 per million output tokens
  },
  "claude-3-sonnet-20240229": {
    input_per_1k: 0.003,   // $3 per million input tokens
    output_per_1k: 0.015,  // $15 per million output tokens
  },
  "claude-3-haiku-20240307": {
    input_per_1k: 0.00025, // $0.25 per million input tokens
    output_per_1k: 0.00125, // $1.25 per million output tokens
  },
} as const;

/**
 * OpenAI pricing (updated 2026-03)
 * Reference: https://openai.com/pricing
 */
const OPENAI_PRICING = {
  // GPT-5 family
  "gpt-5.2": {
    input_per_1k: 0.015,   // $15 per million input tokens (reasoning model)
    output_per_1k: 0.06,   // $60 per million output tokens (reasoning model)
  },
  "gpt-5-mini": {
    input_per_1k: 0.0003,  // $0.30 per million input tokens (fast tier)
    output_per_1k: 0.0012, // $1.20 per million output tokens (fast tier)
  },
  // GPT-4.1 family
  "gpt-4.1-2025-04-14": {
    input_per_1k: 0.002,   // $2 per million input tokens
    output_per_1k: 0.008,  // $8 per million output tokens
  },
  "gpt-4.1-mini-2025-04-14": {
    input_per_1k: 0.0004,  // $0.40 per million input tokens
    output_per_1k: 0.0016, // $1.60 per million output tokens
  },
  "gpt-4.1-nano-2025-04-14": {
    input_per_1k: 0.0001,  // $0.10 per million input tokens
    output_per_1k: 0.0004, // $0.40 per million output tokens
  },
  // GPT-4o family
  "gpt-4o": {
    input_per_1k: 0.0025,  // $2.50 per million input tokens
    output_per_1k: 0.01,   // $10 per million output tokens
  },
  "gpt-4o-mini": {
    input_per_1k: 0.00015, // $0.15 per million input tokens
    output_per_1k: 0.0006, // $0.60 per million output tokens
  },
  // o-series reasoning models
  "o1": {
    input_per_1k: 0.015,   // $15 per million input tokens
    output_per_1k: 0.06,   // $60 per million output tokens
  },
  "o1-mini": {
    input_per_1k: 0.003,   // $3 per million input tokens
    output_per_1k: 0.012,  // $12 per million output tokens
  },
  "o1-preview": {
    input_per_1k: 0.015,   // $15 per million input tokens
    output_per_1k: 0.06,   // $60 per million output tokens
  },
  "o3": {
    input_per_1k: 0.01,    // $10 per million input tokens
    output_per_1k: 0.04,   // $40 per million output tokens
  },
  "o3-mini": {
    input_per_1k: 0.0011,  // $1.10 per million input tokens
    output_per_1k: 0.0044, // $4.40 per million output tokens
  },
  "o4-mini": {
    input_per_1k: 0.0011,  // $1.10 per million input tokens
    output_per_1k: 0.0044, // $4.40 per million output tokens
  },
  // Legacy models
  "gpt-4-turbo": {
    input_per_1k: 0.01,    // $10 per million input tokens
    output_per_1k: 0.03,   // $30 per million output tokens
  },
  "gpt-4": {
    input_per_1k: 0.03,    // $30 per million input tokens
    output_per_1k: 0.06,   // $60 per million output tokens
  },
  "gpt-3.5-turbo": {
    input_per_1k: 0.0005,  // $0.50 per million input tokens
    output_per_1k: 0.0015, // $1.50 per million output tokens
  },
} as const;

/**
 * Calculate estimated cost for an LLM API call.
 * Supports both Anthropic and OpenAI models.
 *
 * @param model Model ID (e.g., "claude-3-5-sonnet-20241022", "gpt-4o-mini")
 * @param tokensIn Input tokens
 * @param tokensOut Output tokens
 * @returns Estimated cost in USD (returns 0 for unknown models or fixtures)
 */
export function calculateCost(model: string, tokensIn: number, tokensOut: number): number {
  // Check Anthropic pricing first
  const anthropicPricing = ANTHROPIC_PRICING[model as keyof typeof ANTHROPIC_PRICING];
  if (anthropicPricing) {
    const inputCost = (tokensIn / 1000) * anthropicPricing.input_per_1k;
    const outputCost = (tokensOut / 1000) * anthropicPricing.output_per_1k;
    return inputCost + outputCost;
  }

  // Check OpenAI pricing
  const openaiPricing = OPENAI_PRICING[model as keyof typeof OPENAI_PRICING];
  if (openaiPricing) {
    const inputCost = (tokensIn / 1000) * openaiPricing.input_per_1k;
    const outputCost = (tokensOut / 1000) * openaiPricing.output_per_1k;
    return inputCost + outputCost;
  }

  // Fixtures or unknown model - return 0 (only warn if not fixtures)
  if (model !== "fixture-v1") {
    emit(TelemetryEvents.CostCalculationUnknownModel, {
      model,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
    });
    log.warn({ model }, "Unknown model for cost calculation");
  }
  return 0;
}

/**
 * Emit telemetry event (logs + Datadog metrics)
 *
 * @param event Event name (use TelemetryEvents enum)
 * @param data Event data
 */
export function emit(event: string, data: Event) {
  const eventData = sanitizeTelemetryData(data);
  // Call test sink if installed (v1.11.0)
  if (testSink) {
    testSink(event, eventData);
  }

  // Always log to pino
  log.info({ event, ...eventData });

  // Send metrics to Datadog if configured
  if (datadogClient) {
    try {
      // Map events to Datadog metrics
      switch (event) {
        case TelemetryEvents.DraftCompleted: {
          // Latency histogram
          if (typeof eventData.latency_ms === "number") {
            datadogClient.histogram("draft.latency_ms", eventData.latency_ms as number, {
              draft_source: String((eventData.draft_source as string) || "unknown"),
              quality_tier: String((eventData.quality_tier as string) || "unknown"),
              fallback_reason: String((eventData.fallback_reason as string) || "none"),
            });
          }

          // Graph size metrics
          if (typeof eventData.graph_nodes === "number") {
            datadogClient.gauge("draft.graph.nodes", eventData.graph_nodes as number);
          }
          if (typeof eventData.graph_edges === "number") {
            datadogClient.gauge("draft.graph.edges", eventData.graph_edges as number);
          }

          // Confidence distribution
          if (typeof eventData.confidence === "number") {
            datadogClient.histogram("draft.confidence", eventData.confidence as number, {
              quality_tier: String((eventData.quality_tier as string) || "unknown"),
            });
          }

          // Cost tracking (per request)
          if (typeof eventData.cost_usd === "number") {
            datadogClient.histogram("draft.cost_usd", eventData.cost_usd as number, {
              draft_source: String((eventData.draft_source as string) || "unknown"),
            });
          }

          // Cache hit rate
          if (typeof eventData.prompt_cache_hit === "boolean") {
            datadogClient.increment("draft.prompt_cache", 1, {
              hit: String(eventData.prompt_cache_hit as boolean),
            });
          }

          // Quality tier distribution
          datadogClient.increment("draft.completed", 1, {
            quality_tier: String(data.quality_tier || "unknown"),
            draft_source: String(data.draft_source || "unknown"),
            fallback_reason: String(data.fallback_reason || "none"),
          });
          break;
        }

        case TelemetryEvents.SSEStarted: {
          datadogClient.increment("draft.sse.started", 1);
          break;
        }

        case TelemetryEvents.SSECompleted: {
          if (typeof eventData.stream_duration_ms === "number") {
            datadogClient.histogram(
              "draft.sse.stream_duration_ms",
              eventData.stream_duration_ms as number
            );
          }
          if (typeof eventData.fixture_shown === "boolean") {
            datadogClient.increment("draft.sse.completed", 1, {
              fixture_shown: String(eventData.fixture_shown as boolean),
            });
          } else {
            datadogClient.increment("draft.sse.completed", 1);
          }
          break;
        }

        case TelemetryEvents.SSEError: {
          datadogClient.increment("draft.sse.errors", 1, {
            error_code: String((eventData.error_code as string) || "unknown"),
          });
          break;
        }

        case TelemetryEvents.ValidationFailed: {
          datadogClient.increment("draft.validation.failed", 1);
          if (typeof eventData.violation_count === "number") {
            datadogClient.gauge(
              "draft.validation.violations",
              eventData.violation_count as number
            );
          }
          break;
        }

        case TelemetryEvents.RepairAttempted:
        case TelemetryEvents.RepairStart: {
          datadogClient.increment("draft.repair.attempted", 1);
          break;
        }

        case TelemetryEvents.RepairSuccess: {
          datadogClient.increment("draft.repair.success", 1);
          break;
        }

        case TelemetryEvents.RepairFallback: {
          datadogClient.increment("draft.repair.fallback", 1, {
            reason: String((eventData.reason as string) || "unknown"),
          });
          break;
        }

        case TelemetryEvents.LegacyProvenance: {
          datadogClient.increment("draft.legacy_provenance.occurrences", 1);
          if (typeof eventData.legacy_percentage === "number") {
            datadogClient.gauge(
              "draft.legacy_provenance.percentage",
              eventData.legacy_percentage as number
            );
          }
          break;
        }

        case TelemetryEvents.FixtureShown: {
          datadogClient.increment("draft.fixture.shown", 1);
          break;
        }

        case TelemetryEvents.FixtureReplaced: {
          datadogClient.increment("draft.fixture.replaced", 1);
          break;
        }

        case TelemetryEvents.LegacySSEPath: {
          datadogClient.increment("draft.sse.legacy_path", 1, {
            endpoint: String((eventData.endpoint as string) || "unknown"),
          });
          break;
        }

        case TelemetryEvents.ClarifierRoundComplete: {
          // Track clarifier usage
          datadogClient.increment("clarifier.round.completed", 1, {
            round: String((eventData.round as string | number | undefined) ?? "unknown"),
            provider: String((eventData.provider as string) || "unknown"),
          });

          // Latency histogram
          if (typeof eventData.duration_ms === "number") {
            datadogClient.histogram("clarifier.duration_ms", eventData.duration_ms as number, {
              round: String((eventData.round as string | number | undefined) ?? "unknown"),
            });
          }

          // Cost tracking
          if (typeof eventData.cost_usd === "number") {
            datadogClient.histogram("clarifier.cost_usd", eventData.cost_usd as number, {
              provider: String((eventData.provider as string) || "unknown"),
            });
          }

          // Confidence tracking
          if (typeof eventData.confidence === "number") {
            datadogClient.histogram("clarifier.confidence", eventData.confidence as number);
          }
          break;
        }

        case TelemetryEvents.ClarifierRoundFailed: {
          datadogClient.increment("clarifier.round.failed", 1, {
            round: String((eventData.round as string | number | undefined) ?? "unknown"),
          });
          break;
        }

        case TelemetryEvents.CritiqueComplete: {
          // Track critique usage
          datadogClient.increment("critique.completed", 1, {
            provider: String((eventData.provider as string) || "unknown"),
            overall_quality: String((eventData.overall_quality as string | number) || "unknown"),
          });

          // Latency histogram
          if (typeof eventData.duration_ms === "number") {
            datadogClient.histogram("critique.duration_ms", eventData.duration_ms as number);
          }

          // Cost tracking
          if (typeof eventData.cost_usd === "number") {
            datadogClient.histogram("critique.cost_usd", eventData.cost_usd as number, {
              provider: String((eventData.provider as string) || "unknown"),
            });
          }

          // Issue counts by severity
          if (typeof eventData.blocker_count === "number") {
            datadogClient.gauge(
              "critique.issues.blockers",
              eventData.blocker_count as number
            );
          }
          if (typeof eventData.improvement_count === "number") {
            datadogClient.gauge(
              "critique.issues.improvements",
              eventData.improvement_count as number
            );
          }
          if (typeof eventData.observation_count === "number") {
            datadogClient.gauge(
              "critique.issues.observations",
              eventData.observation_count as number
            );
          }
          break;
        }

        case TelemetryEvents.CritiqueFailed: {
          datadogClient.increment("critique.failed", 1);
          break;
        }

        case TelemetryEvents.SuggestOptionsComplete: {
          // Track suggest-options usage
          datadogClient.increment("suggest_options.completed", 1, {
            provider: String(data.provider || "unknown"),
          });

          // Latency histogram
          if (typeof eventData.duration_ms === "number") {
            datadogClient.histogram(
              "suggest_options.duration_ms",
              eventData.duration_ms as number
            );
          }

          // Cost tracking
          if (typeof eventData.cost_usd === "number") {
            datadogClient.histogram("suggest_options.cost_usd", eventData.cost_usd as number, {
              provider: String((eventData.provider as string) || "unknown"),
            });
          }

          // Option count distribution
          if (typeof eventData.option_count === "number") {
            datadogClient.gauge(
              "suggest_options.option_count",
              eventData.option_count as number
            );
          }
          break;
        }

        case TelemetryEvents.SuggestOptionsFailed: {
          datadogClient.increment("suggest_options.failed", 1);
          break;
        }

        case TelemetryEvents.ExplainDiffComplete: {
          // Track explain-diff usage
          datadogClient.increment("explain_diff.completed", 1, {
            provider: String(data.provider || "unknown"),
          });

          // Latency histogram
          if (typeof eventData.duration_ms === "number") {
            datadogClient.histogram(
              "explain_diff.duration_ms",
              eventData.duration_ms as number
            );
          }

          // Cost tracking
          if (typeof eventData.cost_usd === "number") {
            datadogClient.histogram("explain_diff.cost_usd", eventData.cost_usd as number, {
              provider: String((eventData.provider as string) || "unknown"),
            });
          }

          // Rationale count distribution
          if (typeof eventData.rationale_count === "number") {
            datadogClient.gauge(
              "explain_diff.rationale_count",
              eventData.rationale_count as number
            );
          }
          break;
        }

        case TelemetryEvents.ExplainDiffFailed: {
          datadogClient.increment("explain_diff.failed", 1);
          break;
        }

        case TelemetryEvents.LlmRetry: {
          datadogClient.increment("llm.retry", 1, {
            adapter: String((eventData.adapter as string) || "unknown"),
            operation: String((eventData.operation as string) || "unknown"),
            attempt: String(
              (eventData.attempt as string | number | undefined) || "unknown"
            ),
            max_attempts: String(
              (eventData.max_attempts as string | number | undefined) || "unknown"
            ),
          });
          if (typeof eventData.delay_ms === "number") {
            datadogClient.histogram("llm.retry.delay_ms", eventData.delay_ms as number);
          }
          break;
        }

        case TelemetryEvents.LlmRetrySuccess: {
          datadogClient.increment("llm.retry_success", 1, {
            adapter: String((eventData.adapter as string) || "unknown"),
            operation: String((eventData.operation as string) || "unknown"),
            total_attempts: String(
              (eventData.total_attempts as string | number | undefined) || "unknown"
            ),
          });
          break;
        }

        case TelemetryEvents.LlmRetryExhausted: {
          datadogClient.increment("llm.retry.exhausted", 1, {
            adapter: String((eventData.adapter as string) || "unknown"),
            operation: String((eventData.operation as string) || "unknown"),
          });
          break;
        }

        case TelemetryEvents.ProviderFailover: {
          datadogClient.increment("llm.provider_failover", 1, {
            from_provider: String((eventData.from_provider as string) || "unknown"),
            to_provider: String((eventData.to_provider as string) || "unknown"),
            operation: String((eventData.operation as string) || "unknown"),
          });
          break;
        }

        case TelemetryEvents.ProviderFailoverSuccess: {
          datadogClient.increment("llm.provider_failover.success", 1, {
            primary_provider: String((eventData.primary_provider as string) || "unknown"),
            fallback_provider: String((eventData.fallback_provider as string) || "unknown"),
            operation: String((eventData.operation as string) || "unknown"),
            fallback_index: String(
              (eventData.fallback_index as string | number | undefined) || "unknown"
            ),
          });
          break;
        }

        case TelemetryEvents.ProviderFailoverExhausted: {
          datadogClient.increment("llm.provider_failover.exhausted", 1, {
            operation: String((eventData.operation as string) || "unknown"),
            total_attempts: String(
              (eventData.total_attempts as string | number | undefined) || "unknown"
            ),
          });
          break;
        }

        case TelemetryEvents.SseClientClosed: {
          datadogClient.increment("draft.sse.client_closed", 1);
          break;
        }

        case TelemetryEvents.PromptCacheHit: {
          datadogClient.increment("llm.prompt_cache.hit", 1, {
            operation: String((eventData.operation as string) || "unknown"),
            provider: String((eventData.provider as string) || "unknown"),
          });
          break;
        }

        case TelemetryEvents.PromptCacheMiss: {
          datadogClient.increment("llm.prompt_cache.miss", 1, {
            operation: String((eventData.operation as string) || "unknown"),
            provider: String((eventData.provider as string) || "unknown"),
          });
          break;
        }

        case TelemetryEvents.PromptCacheEviction: {
          datadogClient.increment("llm.prompt_cache.eviction", 1, {
            reason: String((eventData.reason as string) || "unknown"),
          });
          break;
        }

        case TelemetryEvents.ValidationCacheHit: {
          datadogClient.increment("draft.validation_cache.hit", 1, {
            operation: String((eventData.operation as string) || "unknown"),
          });
          break;
        }

        case TelemetryEvents.ValidationCacheMiss: {
          datadogClient.increment("draft.validation_cache.miss", 1, {
            operation: String((eventData.operation as string) || "unknown"),
          });
          break;
        }

        case TelemetryEvents.ValidationCacheBypass: {
          datadogClient.increment("draft.validation_cache.bypass", 1, {
            operation: String((eventData.operation as string) || "unknown"),
            reason: String((eventData.reason as string) || "unknown"),
          });
          break;
        }

        case TelemetryEvents.AnthropicPromptCacheHint: {
          datadogClient.increment("llm.anthropic_prompt_cache.hint", 1, {
            provider: String((eventData.provider as string) || "unknown"),
            operation: String((eventData.operation as string) || "unknown"),
          });
          break;
        }

        case TelemetryEvents.V5PromptCache: {
          const cacheMode = String((eventData.cache_mode as string) || "unknown");
          const cacheHit = eventData.cache_hit;
          const llmCall = String((eventData.llm_call as number | string) ?? "unknown");
          // Only emit hit/miss counters for cache_mode === 'enabled' so that
          // dashboards computing hit / (hit + miss) reflect the true cache
          // performance. When caching is disabled (config flag off, or
          // cache_control rejected by the API) the call had no opportunity
          // to hit; conflating those with misses understates the hit rate.
          // Disabled paths increment a separate counter tagged by mode.
          if (cacheMode === "enabled") {
            if (cacheHit === true) {
              datadogClient.increment("v5.prompt_cache.hit", 1, {
                cache_mode: cacheMode,
                llm_call: llmCall,
              });
            } else if (cacheHit === false) {
              datadogClient.increment("v5.prompt_cache.miss", 1, {
                cache_mode: cacheMode,
                llm_call: llmCall,
              });
            } else {
              datadogClient.increment("v5.prompt_cache.unknown", 1, {
                cache_mode: cacheMode,
                llm_call: llmCall,
              });
            }
          } else {
            datadogClient.increment("v5.prompt_cache.disabled", 1, {
              cache_mode: cacheMode,
              llm_call: llmCall,
            });
          }
          break;
        }

        case TelemetryEvents.GuardViolation: {
          datadogClient.increment("draft.guard_violation", 1, {
            violation_type: String((eventData.violation_type as string) || "unknown"),
          });
          break;
        }

        // CEE v1 Draft My Model
        case TelemetryEvents.CeeDraftGraphRequested: {
          datadogClient.increment("cee.draft_graph.requested", 1);
          break;
        }

        case TelemetryEvents.CeeDraftGraphSucceeded: {
          datadogClient.increment("cee.draft_graph.succeeded", 1);
          if (typeof eventData.cost_usd === "number") {
            datadogClient.histogram("cee.draft_graph.cost_usd", eventData.cost_usd as number, {
              provider: String((eventData.engine_provider as string) || "unknown"),
              model: String((eventData.engine_model as string) || "unknown"),
            });
          }

          if (typeof eventData.draft_warning_count === "number") {
            datadogClient.histogram(
              "cee.draft_graph.structural_warning_count",
              eventData.draft_warning_count as number,
            );
          }

          if (typeof eventData.uncertain_node_count === "number") {
            datadogClient.histogram(
              "cee.draft_graph.uncertain_node_count",
              eventData.uncertain_node_count as number,
            );
          }

          if ("simplification_applied" in (eventData as Record<string, unknown>)) {
            datadogClient.increment("cee.draft_graph.simplification_applied", 1, {
              value: String((eventData as any).simplification_applied === true),
            });
          }

          break;
        }

        case TelemetryEvents.CeeDraftGraphFailed: {
          datadogClient.increment("cee.draft_graph.failed", 1, {
            error_code: String((eventData.error_code as string) || "unknown"),
            http_status: String(
              (eventData.http_status as number | string | undefined) || "unknown",
            ),
          });
          break;
        }

        // CEE v1 Explain My Model
        case TelemetryEvents.CeeExplainGraphRequested: {
          datadogClient.increment("cee.explain_graph.requested", 1);
          break;
        }

        case TelemetryEvents.CeeExplainGraphSucceeded: {
          datadogClient.increment("cee.explain_graph.succeeded", 1);
          break;
        }

        case TelemetryEvents.CeeExplainGraphFailed: {
          datadogClient.increment("cee.explain_graph.failed", 1, {
            error_code: String((eventData.error_code as string) || "unknown"),
            http_status: String(
              (eventData.http_status as number | string | undefined) || "unknown",
            ),
          });
          break;
        }

        // CEE v1 Evidence Helper
        case TelemetryEvents.CeeEvidenceHelperRequested: {
          datadogClient.increment("cee.evidence_helper.requested", 1);
          break;
        }

        case TelemetryEvents.CeeEvidenceHelperSucceeded: {
          datadogClient.increment("cee.evidence_helper.succeeded", 1);
          break;
        }

        case TelemetryEvents.CeeEvidenceHelperFailed: {
          datadogClient.increment("cee.evidence_helper.failed", 1, {
            error_code: String((eventData.error_code as string) || "unknown"),
            http_status: String(
              (eventData.http_status as number | string | undefined) || "unknown",
            ),
          });
          break;
        }

        // CEE v1 Bias Check
        case TelemetryEvents.CeeBiasCheckRequested: {
          datadogClient.increment("cee.bias_check.requested", 1);
          break;
        }

        case TelemetryEvents.CeeBiasCheckSucceeded: {
          datadogClient.increment("cee.bias_check.succeeded", 1);

          if (typeof eventData.bias_count === "number") {
            datadogClient.histogram(
              "cee.bias_check.bias_count",
              eventData.bias_count as number,
            );
          }

          break;
        }

        case TelemetryEvents.CeeBiasCheckFailed: {
          datadogClient.increment("cee.bias_check.failed", 1, {
            error_code: String((eventData.error_code as string) || "unknown"),
            http_status: String(
              (eventData.http_status as number | string | undefined) || "unknown",
            ),
          });
          break;
        }

        // CEE v1 Graph Readiness
        case TelemetryEvents.CeeGraphReadinessRequested: {
          datadogClient.increment("cee.graph_readiness.requested", 1);
          break;
        }

        case TelemetryEvents.CeeGraphReadinessCompleted: {
          datadogClient.increment("cee.graph_readiness.completed", 1);

          const latencyMs = eventData.latency_ms;
          if (typeof latencyMs === "number" && Number.isFinite(latencyMs)) {
            datadogClient.histogram(
              "cee.graph_readiness.latency_ms",
              latencyMs,
            );
          }

          const readinessScore = eventData.readiness_score;
          if (typeof readinessScore === "number" && Number.isFinite(readinessScore)) {
            datadogClient.histogram(
              "cee.graph_readiness.readiness_score",
              readinessScore,
            );
          }

          break;
        }

        case TelemetryEvents.CeeGraphReadinessFailed: {
          datadogClient.increment("cee.graph_readiness.failed", 1, {
            error_code: String((eventData.error_code as string) || "unknown"),
            http_status: String(
              (eventData.http_status as number | string | undefined) || "unknown",
            ),
          });
          break;
        }

        // CEE v1 Options Helper
        case TelemetryEvents.CeeOptionsRequested: {
          datadogClient.increment("cee.options.requested", 1);
          break;
        }

        case TelemetryEvents.CeeOptionsSucceeded: {
          datadogClient.increment("cee.options.succeeded", 1);
          break;
        }

        case TelemetryEvents.CeeOptionsFailed: {
          datadogClient.increment("cee.options.failed", 1, {
            error_code: String((eventData.error_code as string) || "unknown"),
            http_status: String(
              (eventData.http_status as number | string | undefined) || "unknown",
            ),
          });
          break;
        }

        // CEE v1 Sensitivity Coach
        case TelemetryEvents.CeeSensitivityCoachRequested: {
          datadogClient.increment("cee.sensitivity_coach.requested", 1);
          break;
        }

        case TelemetryEvents.CeeSensitivityCoachSucceeded: {
          datadogClient.increment("cee.sensitivity_coach.succeeded", 1);
          break;
        }

        case TelemetryEvents.CeeSensitivityCoachFailed: {
          datadogClient.increment("cee.sensitivity_coach.failed", 1, {
            error_code: String((eventData.error_code as string) || "unknown"),
            http_status: String(
              (eventData.http_status as number | string | undefined) || "unknown",
            ),
          });
          break;
        }

        // CEE v1 Team Perspectives
        case TelemetryEvents.CeeTeamPerspectivesRequested: {
          datadogClient.increment("cee.team_perspectives.requested", 1);
          break;
        }

        case TelemetryEvents.CeeTeamPerspectivesSucceeded: {
          datadogClient.increment("cee.team_perspectives.succeeded", 1);
          break;
        }

        case TelemetryEvents.CeeTeamPerspectivesFailed: {
          datadogClient.increment("cee.team_perspectives.failed", 1, {
            error_code: String((eventData.error_code as string) || "unknown"),
            http_status: String(
              (eventData.http_status as number | string | undefined) || "unknown",
            ),
          });
          break;
        }

        case TelemetryEvents.CeeKeyInsightRequested: {
          datadogClient.increment("cee.key_insight.requested", 1);
          break;
        }

        case TelemetryEvents.CeeKeyInsightSucceeded: {
          datadogClient.increment("cee.key_insight.succeeded", 1);
          break;
        }

        case TelemetryEvents.CeeKeyInsightFailed: {
          datadogClient.increment("cee.key_insight.failed", 1, {
            error_code: String((eventData.error_code as string) || "unknown"),
            http_status: String(
              (eventData.http_status as number | string | undefined) || "unknown",
            ),
          });
          break;
        }

        case TelemetryEvents.CeeElicitBeliefRequested: {
          datadogClient.increment("cee.elicit_belief.requested", 1);
          break;
        }

        case TelemetryEvents.CeeElicitBeliefSucceeded: {
          datadogClient.increment("cee.elicit_belief.succeeded", 1);
          break;
        }

        case TelemetryEvents.CeeElicitBeliefFailed: {
          datadogClient.increment("cee.elicit_belief.failed", 1, {
            error_code: String((eventData.error_code as string) || "unknown"),
            http_status: String(
              (eventData.http_status as number | string | undefined) || "unknown",
            ),
          });
          break;
        }

        case TelemetryEvents.CeeUtilityWeightRequested: {
          datadogClient.increment("cee.utility_weight.requested", 1);
          break;
        }

        case TelemetryEvents.CeeUtilityWeightSucceeded: {
          datadogClient.increment("cee.utility_weight.succeeded", 1);
          break;
        }

        case TelemetryEvents.CeeUtilityWeightFailed: {
          datadogClient.increment("cee.utility_weight.failed", 1, {
            error_code: String((eventData.error_code as string) || "unknown"),
            http_status: String(
              (eventData.http_status as number | string | undefined) || "unknown",
            ),
          });
          break;
        }

        case TelemetryEvents.CeeRiskToleranceRequested: {
          datadogClient.increment("cee.risk_tolerance.requested", 1);
          break;
        }

        case TelemetryEvents.CeeRiskToleranceSucceeded: {
          datadogClient.increment("cee.risk_tolerance.succeeded", 1);
          break;
        }

        case TelemetryEvents.CeeRiskToleranceFailed: {
          datadogClient.increment("cee.risk_tolerance.failed", 1, {
            error_code: String((eventData.error_code as string) || "unknown"),
            http_status: String(
              (eventData.http_status as number | string | undefined) || "unknown",
            ),
          });
          break;
        }

        case TelemetryEvents.CeeEdgeFunctionRequested: {
          datadogClient.increment("cee.edge_function.requested", 1);
          break;
        }

        case TelemetryEvents.CeeEdgeFunctionCompleted: {
          datadogClient.increment("cee.edge_function.completed", 1, {
            suggested_function: String((eventData.suggested_function as string) || "unknown"),
            confidence: String((eventData.confidence as string) || "unknown"),
          });

          const latencyMs = eventData.latency_ms;
          if (typeof latencyMs === "number" && Number.isFinite(latencyMs)) {
            datadogClient.histogram("cee.edge_function.latency_ms", latencyMs);
          }
          break;
        }

        case TelemetryEvents.CeeEdgeFunctionFailed: {
          datadogClient.increment("cee.edge_function.failed", 1, {
            error_code: String((eventData.error_code as string) || "unknown"),
            http_status: String(
              (eventData.http_status as number | string | undefined) || "unknown",
            ),
          });
          break;
        }

        // Phase 4: Recommendation Narratives metrics
        case TelemetryEvents.CeeGenerateRecommendationRequested: {
          datadogClient.increment("cee.generate_recommendation.requested", 1);
          break;
        }

        case TelemetryEvents.CeeGenerateRecommendationCompleted: {
          datadogClient.increment("cee.generate_recommendation.completed", 1);
          const latencyMs = eventData.latency_ms;
          if (typeof latencyMs === "number" && Number.isFinite(latencyMs)) {
            datadogClient.histogram("cee.generate_recommendation.latency_ms", latencyMs);
          }
          break;
        }

        case TelemetryEvents.CeeGenerateRecommendationFailed: {
          datadogClient.increment("cee.generate_recommendation.failed", 1, {
            error_code: String((eventData.error_code as string) || "unknown"),
            http_status: String(
              (eventData.http_status as number | string | undefined) || "unknown",
            ),
          });
          break;
        }

        case TelemetryEvents.CeeNarrateConditionsRequested: {
          datadogClient.increment("cee.narrate_conditions.requested", 1);
          break;
        }

        case TelemetryEvents.CeeNarrateConditionsCompleted: {
          datadogClient.increment("cee.narrate_conditions.completed", 1);
          const latencyMs = eventData.latency_ms;
          if (typeof latencyMs === "number" && Number.isFinite(latencyMs)) {
            datadogClient.histogram("cee.narrate_conditions.latency_ms", latencyMs);
          }
          break;
        }

        case TelemetryEvents.CeeNarrateConditionsFailed: {
          datadogClient.increment("cee.narrate_conditions.failed", 1, {
            error_code: String((eventData.error_code as string) || "unknown"),
            http_status: String(
              (eventData.http_status as number | string | undefined) || "unknown",
            ),
          });
          break;
        }

        case TelemetryEvents.CeeExplainPolicyRequested: {
          datadogClient.increment("cee.explain_policy.requested", 1);
          break;
        }

        case TelemetryEvents.CeeExplainPolicyCompleted: {
          datadogClient.increment("cee.explain_policy.completed", 1);
          const latencyMs = eventData.latency_ms;
          if (typeof latencyMs === "number" && Number.isFinite(latencyMs)) {
            datadogClient.histogram("cee.explain_policy.latency_ms", latencyMs);
          }
          break;
        }

        case TelemetryEvents.CeeExplainPolicyFailed: {
          datadogClient.increment("cee.explain_policy.failed", 1, {
            error_code: String((eventData.error_code as string) || "unknown"),
            http_status: String(
              (eventData.http_status as number | string | undefined) || "unknown",
            ),
          });
          break;
        }

        // CEE Verification metrics (v1.14)
        case TelemetryEvents.CeeVerificationSucceeded: {
          datadogClient.increment("cee.verification.succeeded", 1, {
            feature: String((eventData.feature as string) || "unknown"),
          });
          const latencyMs = eventData.latency_ms;
          if (typeof latencyMs === "number" && Number.isFinite(latencyMs)) {
            datadogClient.histogram("cee.verification.latency_ms", latencyMs);
          }
          break;
        }

        case TelemetryEvents.CeeVerificationFailed: {
          datadogClient.increment("cee.verification.failed", 1, {
            feature: String((eventData.feature as string) || "unknown"),
            stage: String((eventData.stage as string) || "unknown"),
          });
          break;
        }

        // Prompt Management metrics (v2.0)
        case TelemetryEvents.PromptStoreError: {
          datadogClient.increment("prompt.store.error", 1, {
            operation: String((eventData.operation as string) || "unknown"),
            error: String((eventData.error as string) || "unknown"),
          });
          break;
        }

        case TelemetryEvents.PromptLoaderError: {
          datadogClient.increment("prompt.loader.error", 1, {
            task_id: String((eventData.taskId as string) || "unknown"),
          });
          break;
        }

        case TelemetryEvents.PromptLoadedFromStore: {
          datadogClient.increment("prompt.loader.source", 1, {
            source: "store",
            task_id: String((eventData.taskId as string) || "unknown"),
            version: String((eventData.version as number | undefined) || "unknown"),
          });
          break;
        }

        case TelemetryEvents.PromptLoadedFromDefault: {
          datadogClient.increment("prompt.loader.source", 1, {
            source: "default",
            task_id: String((eventData.taskId as string) || "unknown"),
            reason: String((eventData.reason as string) || "unknown"),
            cached: String((eventData.cached as boolean | undefined) ?? "unknown"),
          });
          break;
        }

        case TelemetryEvents.PromptCompiled: {
          datadogClient.increment("prompt.compiled", 1, {
            task_id: String((eventData.taskId as string) || "unknown"),
            version: String((eventData.version as number | undefined) || "unknown"),
          });
          break;
        }

        case TelemetryEvents.PromptHashMismatch: {
          datadogClient.increment("prompt.hash_mismatch", 1, {
            prompt_id: String((eventData.promptId as string) || "unknown"),
          });
          break;
        }

        case TelemetryEvents.AdminPromptAccess: {
          datadogClient.increment("admin.prompt.access", 1, {
            action: String((eventData.action as string) || "unknown"),
          });
          break;
        }

        case TelemetryEvents.AdminExperimentAccess: {
          datadogClient.increment("admin.experiment.access", 1, {
            action: String((eventData.action as string) || "unknown"),
          });
          break;
        }

        case TelemetryEvents.AdminAuthFailed: {
          datadogClient.increment("admin.auth.failed", 1, {
            reason: String((eventData.reason as string) || "unknown"),
          });
          break;
        }

        case TelemetryEvents.AdminIPBlocked: {
          datadogClient.increment("admin.ip.blocked", 1);
          break;
        }

        // Prompt Experiment metrics (v2.0)
        case TelemetryEvents.PromptExperimentAssigned: {
          datadogClient.increment("prompt.experiment.assigned", 1, {
            experiment_name: String((eventData.experimentName as string) || "unknown"),
            task_id: String((eventData.taskId as string) || "unknown"),
            variant: String((eventData.variant as string) || "unknown"),
          });
          break;
        }

        case TelemetryEvents.PromptStagingUsed: {
          datadogClient.increment("prompt.staging.used", 1, {
            task_id: String((eventData.taskId as string) || "unknown"),
          });
          break;
        }

        // Decision Review metrics (v2.0)
        case TelemetryEvents.DecisionReviewRequested: {
          datadogClient.increment("cee.decision_review.requested", 1);
          break;
        }

        case TelemetryEvents.DecisionReviewGenerated:
        case TelemetryEvents.DecisionReviewSucceeded: {
          datadogClient.increment("cee.decision_review.succeeded", 1, {
            isl_available: String((eventData.isl_available as boolean | undefined) ?? "unknown"),
          });

          if (typeof eventData.endpoints_used === "number" || Array.isArray(eventData.endpointsUsed)) {
            const count = typeof eventData.endpoints_used === "number"
              ? eventData.endpoints_used
              : (eventData.endpointsUsed as string[])?.length ?? 0;
            datadogClient.gauge("cee.decision_review.isl_endpoints_used", count);
          }

          if (typeof eventData.latency_ms === "number") {
            datadogClient.histogram("cee.decision_review.latency_ms", eventData.latency_ms as number);
          }
          break;
        }

        case TelemetryEvents.DecisionReviewFailed: {
          datadogClient.increment("cee.decision_review.failed", 1, {
            error_code: String((eventData.error_code as string) || "unknown"),
            http_status: String((eventData.http_status as number | string | undefined) || "unknown"),
          });
          break;
        }

        case TelemetryEvents.DecisionReviewIslFallback: {
          datadogClient.increment("cee.decision_review.isl_fallback", 1, {
            reason: String((eventData.reason as string) || "unknown"),
          });
          break;
        }

        // Prompt Store Cache metrics (v2.0 Phase 4.3)
        case TelemetryEvents.PromptStoreCacheHit: {
          datadogClient.increment("prompt.store.cache.hit", 1, {
            task_id: String((eventData.taskId as string) || "unknown"),
          });
          break;
        }

        case TelemetryEvents.PromptStoreCacheMiss: {
          datadogClient.increment("prompt.store.cache.miss", 1, {
            task_id: String((eventData.taskId as string) || "unknown"),
          });
          break;
        }

        case TelemetryEvents.PromptStoreCacheInvalidated: {
          datadogClient.increment("prompt.store.cache.invalidated", 1, {
            reason: String((eventData.reason as string) || "unknown"),
            task_id: String((eventData.taskId as string) || "all"),
          });
          break;
        }

        case TelemetryEvents.PromptStoreCacheWarmed: {
          datadogClient.gauge("prompt.store.cache.warmed", Number(eventData.warmed) || 0);
          datadogClient.gauge("prompt.store.cache.warmed_failed", Number(eventData.failed) || 0);
          datadogClient.gauge("prompt.store.cache.warmed_skipped", Number(eventData.skipped) || 0);
          break;
        }

        case TelemetryEvents.PromptStoreBackgroundRefresh: {
          datadogClient.increment("prompt.store.background_refresh", 1, {
            task_id: String((eventData.taskId as string) || "unknown"),
          });
          break;
        }

        // Performance timing events (observability v2)
        case TelemetryEvents.LlmCall: {
          datadogClient.increment("llm.call", 1, {
            step: String((eventData.step as string) || "unknown"),
            model: String((eventData.model as string) || "unknown"),
            provider: String((eventData.provider as string) || "unknown"),
          });
          if (typeof eventData.elapsed_ms === "number") {
            datadogClient.histogram("llm.call.latency_ms", eventData.elapsed_ms as number, {
              step: String((eventData.step as string) || "unknown"),
              model: String((eventData.model as string) || "unknown"),
            });
          }
          if (typeof eventData.tokens_prompt === "number") {
            datadogClient.histogram("llm.call.tokens_prompt", eventData.tokens_prompt as number, {
              model: String((eventData.model as string) || "unknown"),
            });
          }
          if (typeof eventData.tokens_completion === "number") {
            datadogClient.histogram("llm.call.tokens_completion", eventData.tokens_completion as number, {
              model: String((eventData.model as string) || "unknown"),
            });
          }
          break;
        }

        case TelemetryEvents.DownstreamCall: {
          datadogClient.increment("downstream.call", 1, {
            target: String((eventData.target as string) || "unknown"),
            operation: String((eventData.operation as string) || "unknown"),
          });
          if (typeof eventData.elapsed_ms === "number") {
            datadogClient.histogram("downstream.call.latency_ms", eventData.elapsed_ms as number, {
              target: String((eventData.target as string) || "unknown"),
            });
          }
          if (typeof eventData.status === "number") {
            datadogClient.increment("downstream.call.status", 1, {
              target: String((eventData.target as string) || "unknown"),
              status: String(eventData.status),
            });
          }
          break;
        }

        case TelemetryEvents.SessionReadDegraded: {
          // V5 Slice B — silent-session-loss alerting hook. Count every read
          // failure so ops can alert on `session.read_degraded_total > 0`
          // over a short window (e.g. 5 min). Tags carry the error shape so
          // the dashboard can distinguish "RPC down" from "config drift"
          // from "row-shape parse failure".
          datadogClient.increment("session.read_degraded_total", 1, {
            error_code: String((eventData.error_code as string) || "unknown"),
            severity: String((eventData.severity as string) || "warning"),
          });
          break;
        }

        case TelemetryEvents.CqeExtraction: {
          // CQE per-turn aggregate metrics. Fields are a subset of the 10
          // CqeExtractionSummary fields — patterns_matched is omitted here
          // (high cardinality goes to the routing log only), as are the
          // low-signal message_too_long and ambiguous_phrasing_detected.
          datadogClient.increment("cqe.extraction.completed", 1);
          if (typeof eventData.timeout === "boolean" && eventData.timeout) {
            datadogClient.increment("cqe.extraction.timeout", 1);
          }
          if (
            typeof eventData.word_range_missed === "boolean" &&
            eventData.word_range_missed
          ) {
            datadogClient.increment("cqe.extraction.word_range_missed", 1);
          }
          if (typeof eventData.message_length === "number") {
            datadogClient.histogram(
              "cqe.extraction.message_length",
              eventData.message_length,
            );
          }
          if (typeof eventData.result_count === "number") {
            datadogClient.histogram(
              "cqe.extraction.result_count",
              eventData.result_count,
            );
          }
          if (typeof eventData.cqe_match_count === "number") {
            datadogClient.gauge(
              "cqe.extraction.cqe_match_count",
              eventData.cqe_match_count,
            );
          }
          if (typeof eventData.compromise_match_count === "number") {
            datadogClient.gauge(
              "cqe.extraction.compromise_match_count",
              eventData.compromise_match_count,
            );
          }
          if (typeof eventData.duration_ms === "number") {
            datadogClient.histogram(
              "cqe.extraction.duration_ms",
              eventData.duration_ms,
            );
          }
          break;
        }

        // Stage events are debug-only, don't send to Datadog by default
        default:
          // Unknown event - log warning but don't fail
          if (!VALID_EVENT_NAMES.has(event)) {
            log.warn({ event }, "Unknown telemetry event (not in frozen enum)");
          }
      }
    } catch (error) {
      // Never let telemetry break the application
      log.error({ error, event }, "Failed to send Datadog metrics");
    }
  }
}

/**
 * Flush Datadog metrics (for graceful shutdown)
 */
export async function flushMetrics(): Promise<void> {
  if (datadogClient) {
    return new Promise((resolve, reject) => {
      datadogClient!.close((error) => {
        if (error) {
          log.error({ error }, "Error flushing Datadog metrics");
          reject(error);
        } else {
          log.info("Datadog metrics flushed");
          resolve();
        }
      });
    });
  }
}
