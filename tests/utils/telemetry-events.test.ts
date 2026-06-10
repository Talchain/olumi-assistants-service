import { describe, it, expect } from "vitest";
import { TelemetryEvents, VALID_EVENT_NAMES } from "../../src/utils/telemetry.js";

/**
 * Telemetry Event Freeze (M3 - CI Gate)
 *
 * These tests enforce that telemetry event names remain frozen and cannot
 * be accidentally changed without updating dashboards and alerts.
 *
 * **Why this matters:**
 * - Datadog dashboards query specific event names
 * - Alerts are configured for specific metrics
 * - Historical data uses these event names
 * - Changing an event name breaks observability
 *
 * **If you need to add a new event:**
 * 1. Add to TelemetryEvents enum in src/utils/telemetry.ts
 * 2. Update the snapshot in this test
 * 3. Update Datadog dashboard JSON (observability/dashboards/)
 * 4. Document in observability/README.md
 *
 * **If you need to rename an event:**
 * 1. DO NOT rename - create a new event instead
 * 2. Keep old event emitting for 30 days (deprecation period)
 * 3. Add deprecation notice in telemetry.ts
 * 4. Update dashboards to use new event name
 * 5. After 30 days, remove old event
 */

describe("Telemetry Events (Frozen Enum - M3)", () => {
  describe("Event name stability", () => {
    it("freezes all telemetry event names to prevent accidental changes", () => {
      // This snapshot ensures event names never change without explicit approval
      // If this test fails, you've changed an event name - update dashboards first!
      const eventSnapshot = {
        DraftStarted: "assist.draft.started",
        DraftCompleted: "assist.draft.completed",

        DraftUpstreamSuccess: "assist.draft.upstream_success",
        DraftUpstreamError: "assist.draft.upstream_error",

        SSEStarted: "assist.draft.sse_started",
        SSECompleted: "assist.draft.sse_completed",
        SSEError: "assist.draft.sse_error",
        SseClientClosed: "assist.draft.sse_client_closed",
        FixtureShown: "assist.draft.fixture_shown",
        FixtureReplaced: "assist.draft.fixture_replaced",
        LegacySSEPath: "assist.draft.legacy_sse_path",

        ValidationFailed: "assist.draft.validation_failed",
        RepairAttempted: "assist.draft.repair_attempted",
        RepairStart: "assist.draft.repair_start",
        RepairSuccess: "assist.draft.repair_success",
        RepairPartial: "assist.draft.repair_partial",
        RepairFallback: "assist.draft.repair_fallback",

        ClarifierRoundStart: "assist.clarifier.round_start",
        ClarifierRoundComplete: "assist.clarifier.round_complete",
        ClarifierRoundFailed: "assist.clarifier.round_failed",

        CritiqueStart: "assist.critique.start",
        CritiqueComplete: "assist.critique.complete",
        CritiqueFailed: "assist.critique.failed",

        SuggestOptionsStart: "assist.suggest_options.start",
        SuggestOptionsComplete: "assist.suggest_options.complete",
        SuggestOptionsFailed: "assist.suggest_options.failed",

        ExplainDiffStart: "assist.explain_diff.start",
        ExplainDiffComplete: "assist.explain_diff.complete",
        ExplainDiffFailed: "assist.explain_diff.failed",

        GuardViolation: "assist.draft.guard_violation",

        LegacyProvenance: "assist.draft.legacy_provenance",

        Stage: "assist.draft.stage",

        AuthSuccess: "assist.auth.success",
        AuthFailed: "assist.auth.failed",
        RateLimited: "assist.auth.rate_limited",

        LlmRetry: "assist.llm.retry",
        LlmRetrySuccess: "assist.llm.retry_success",
        LlmRetryExhausted: "assist.llm.retry_exhausted",

        ProviderFailover: "assist.llm.provider_failover",
        ProviderFailoverSuccess: "assist.llm.provider_failover_success",
        ProviderFailoverExhausted: "assist.llm.provider_failover_exhausted",

        ShareCreated: "assist.share.created",
        ShareAccessed: "assist.share.accessed",
        ShareRevoked: "assist.share.revoked",
        ShareExpired: "assist.share.expired",
        ShareNotFound: "assist.share.not_found",

        PromptCacheHit: "assist.llm.prompt_cache_hit",
        PromptCacheMiss: "assist.llm.prompt_cache_miss",
        PromptCacheEviction: "assist.llm.prompt_cache_eviction",

        ValidationCacheHit: "assist.draft.validation_cache_hit",
        ValidationCacheMiss: "assist.draft.validation_cache_miss",
        ValidationCacheBypass: "assist.draft.validation_cache_bypass",

        AnthropicPromptCacheHint: "assist.llm.anthropic_prompt_cache_hint",
        CostCalculationUnknownModel: "assist.cost_calculation.unknown_model",
        SseResumeIssued: "assist.sse.resume_issued",
        SseResumeAttempt: "assist.sse.resume_attempt",
        SseResumeSuccess: "assist.sse.resume_success",
        SseResumeExpired: "assist.sse.resume_expired",
        SseResumeIncompatible: "assist.sse.resume_incompatible",
        SseResumeReplayCount: "assist.sse.resume_replay_count",
        SsePartialRecovery: "assist.sse.partial_recovery",
        SseBufferTrimmed: "assist.sse.buffer_trimmed",
        SseSnapshotCreated: "assist.sse.snapshot_created",

        // v1.9 SSE Live Resume events
        SseResumeLiveStart: "assist.sse.resume_live_start",
        SseResumeLiveContinue: "assist.sse.resume_live_continue",
        SseResumeLiveEnd: "assist.sse.resume_live_end",
        SseSnapshotRenewed: "assist.sse.snapshot_renewed",

        // v1.11 SSE degraded mode events
        SseDegradedMode: "assist.sse.degraded_mode",

        // ISL config events (v1.13.0)
        IslConfigInvalidTimeout: "isl.config.invalid_timeout",
        IslConfigInvalidMaxRetries: "isl.config.invalid_max_retries",
        IslConfigTimeoutClamped: "isl.config.timeout_clamped",
        IslConfigRetriesClamped: "isl.config.retries_clamped",

        // CEE v1 Draft My Model events (v1.12.0)
        CeeDraftGraphRequested: "cee.draft_graph.requested",
        CeeDraftGraphSucceeded: "cee.draft_graph.succeeded",
        CeeDraftGraphFailed: "cee.draft_graph.failed",
        // v0.11.0 schema amendment — observable transition signals.
        DraftGraphLegacyCoachingValueNormalised: "cee.draft_graph.legacy_coaching_value_normalised",
        DraftGraphContractDefaultApplied: "cee.draft_graph.contract_default_applied",

        // Connectivity validation (P0 diagnostics)
        CeeConnectivityCheck: "cee.draft_graph.connectivity_check",

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

        // CEE v1 Explain Graph events (v1.12.0)
        CeeExplainGraphRequested: "cee.explain_graph.requested",
        CeeExplainGraphSucceeded: "cee.explain_graph.succeeded",
        CeeExplainGraphFailed: "cee.explain_graph.failed",

        // CEE v1 Evidence Helper events (v1.12.0)
        CeeEvidenceHelperRequested: "cee.evidence_helper.requested",
        CeeEvidenceHelperSucceeded: "cee.evidence_helper.succeeded",
        CeeEvidenceHelperFailed: "cee.evidence_helper.failed",

        // CEE v1 Bias Checker events (v1.12.0)
        CeeBiasCheckRequested: "cee.bias_check.requested",
        CeeBiasCheckSucceeded: "cee.bias_check.succeeded",
        CeeBiasCheckFailed: "cee.bias_check.failed",

        // CEE v1 Options events (v1.12.0)
        CeeOptionsRequested: "cee.options.requested",
        CeeOptionsSucceeded: "cee.options.succeeded",
        CeeOptionsFailed: "cee.options.failed",

        // CEE v1 Sensitivity Coach events (v1.12.0)
        CeeSensitivityCoachRequested: "cee.sensitivity_coach.requested",
        CeeSensitivityCoachSucceeded: "cee.sensitivity_coach.succeeded",
        CeeSensitivityCoachFailed: "cee.sensitivity_coach.failed",

        // CEE v1 Team Perspectives events (v1.12.0)
        CeeTeamPerspectivesRequested: "cee.team_perspectives.requested",
        CeeTeamPerspectivesSucceeded: "cee.team_perspectives.succeeded",
        CeeTeamPerspectivesFailed: "cee.team_perspectives.failed",

        // CEE Preflight events (Phase 2 input validation)
        PreflightValidationPassed: "cee.preflight.passed",
        PreflightValidationFailed: "cee.preflight.failed",
        PreflightReadinessAssessed: "cee.preflight.readiness_assessed",
        PreflightRejected: "cee.preflight.rejected",
        PreflightCompleted: "cee.preflight.completed",
        CeeBriefSignals: "cee.brief_signals",

        // CEE verification events (v1.14)
        CeeVerificationSucceeded: "cee.verification.succeeded",
        CeeVerificationFailed: "cee.verification.failed",

        // LLM Normalization events (Phase 1 NodeKind normalization)
        NodeKindNormalized: "llm.normalization.node_kind_mapped",

        // LLM Repair events (large graph handling)
        RepairPromptTruncated: "llm.repair_prompt.truncated",

        // Goal generation tracking (prompt tuning)
        GoalGeneration: "cee.goal_generation",

        // CEE Clarification enforcement events (Phase 5)
        ClarificationRequired: "cee.clarification.required",
        ClarificationBypassAllowed: "cee.clarification.bypass_allowed",

        // CEE Multi-turn Clarifier events (Phase 1)
        CeeClarifierSessionStart: "cee.clarifier.session_start",
        CeeClarifierQuestionAsked: "cee.clarifier.question_asked",
        CeeClarifierAnswerReceived: "cee.clarifier.answer_received",
        CeeClarifierAnswerIncorporated: "cee.clarifier.answer_incorporated",
        CeeClarifierConverged: "cee.clarifier.converged",
        CeeClarifierQuestionCached: "cee.clarifier.question_cached",
        CeeClarifierQuestionRetrieved: "cee.clarifier.question_retrieved",
        CeeClarifierFailed: "cee.clarifier.failed",
        CeeClarifierSkipped: "cee.clarifier.skipped",

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

        // Prompt Activation Guard events (v2.2)
        PromptActivationBlocked: "prompt.activation.blocked",
        PromptStagingActivated: "prompt.staging.activated",

        // Decision Review events (v2.0)
        DecisionReviewGenerated: "cee.decision_review.generated",
        DecisionReviewIslFallback: "cee.decision_review.isl_fallback",
        DecisionReviewRequested: "cee.decision_review.requested",
        DecisionReviewSucceeded: "cee.decision_review.succeeded",
        DecisionReviewFailed: "cee.decision_review.failed",

        // Decision Review M2 events (unique events only)
        CeeDecisionReviewPromptLoaded: "cee.decision_review.prompt_loaded",
        CeeDecisionReviewLlmCallStarted: "cee.decision_review.llm_call_started",
        CeeDecisionReviewLlmCallCompleted: "cee.decision_review.llm_call_completed",
        CeeDecisionReviewJsonExtracted: "cee.decision_review.json_extracted",
        CeeDecisionReviewShapeCheckFailed: "cee.decision_review.shape_check_failed",
        CeeDecisionReviewShapeCheckWarnings: "cee.decision_review.shape_check_warnings",

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

        // Graph Validation events (v2.2)
        CeeGraphValidation: "cee.graph.validation",
        CeeGraphGoalsMerged: "cee.graph.goals_merged",
        CeeGraphSizeExceeded: "cee.graph.size_exceeded",

        // Graph Readiness events (v2.3)
        CeeGraphReadinessRequested: "cee.graph_readiness.requested",
        CeeGraphReadinessCompleted: "cee.graph_readiness.completed",
        CeeGraphReadinessFailed: "cee.graph_readiness.failed",

        // Key Insight events (v2.4)
        CeeKeyInsightRequested: "cee.key_insight.requested",
        CeeKeyInsightSucceeded: "cee.key_insight.succeeded",
        CeeKeyInsightFailed: "cee.key_insight.failed",

        // Elicit Belief events (v2.5)
        CeeElicitBeliefRequested: "cee.elicit_belief.requested",
        CeeElicitBeliefSucceeded: "cee.elicit_belief.succeeded",
        CeeElicitBeliefFailed: "cee.elicit_belief.failed",

        // Utility Weight events (v2.5)
        CeeUtilityWeightRequested: "cee.utility_weight.requested",
        CeeUtilityWeightSucceeded: "cee.utility_weight.succeeded",
        CeeUtilityWeightFailed: "cee.utility_weight.failed",

        // Risk Tolerance events (v2.5)
        CeeRiskToleranceRequested: "cee.risk_tolerance.requested",
        CeeRiskToleranceSucceeded: "cee.risk_tolerance.succeeded",
        CeeRiskToleranceFailed: "cee.risk_tolerance.failed",

        // Edge Function Suggestion events (v2.6)
        CeeEdgeFunctionRequested: "cee.edge_function.requested",
        CeeEdgeFunctionCompleted: "cee.edge_function.completed",
        CeeEdgeFunctionFailed: "cee.edge_function.failed",

        // Edge Direction Validation events (Brief G)
        EdgeDirectionViolationDetected: "cee.edge_direction.violation_detected",
        EdgeDirectionValidationPassed: "cee.edge_direction.validation_passed",

        // Phase 4: Recommendation Narratives events
        CeeGenerateRecommendationRequested: "cee.generate_recommendation.requested",
        CeeGenerateRecommendationCompleted: "cee.generate_recommendation.completed",
        CeeGenerateRecommendationFailed: "cee.generate_recommendation.failed",

        CeeNarrateConditionsRequested: "cee.narrate_conditions.requested",
        CeeNarrateConditionsCompleted: "cee.narrate_conditions.completed",
        CeeNarrateConditionsFailed: "cee.narrate_conditions.failed",

        CeeExplainPolicyRequested: "cee.explain_policy.requested",
        CeeExplainPolicyCompleted: "cee.explain_policy.completed",
        CeeExplainPolicyFailed: "cee.explain_policy.failed",

        // Phase 5: Preference Elicitation events
        CeeElicitPreferencesRequested: "cee.elicit_preferences.requested",
        CeeElicitPreferencesSucceeded: "cee.elicit_preferences.succeeded",
        CeeElicitPreferencesFailed: "cee.elicit_preferences.failed",
        CeeElicitPreferencesAnswerRequested: "cee.elicit_preferences_answer.requested",
        CeeElicitPreferencesAnswerSucceeded: "cee.elicit_preferences_answer.succeeded",
        CeeElicitPreferencesAnswerFailed: "cee.elicit_preferences_answer.failed",
        CeeExplainTradeoffRequested: "cee.explain_tradeoff.requested",
        CeeExplainTradeoffSucceeded: "cee.explain_tradeoff.succeeded",
        CeeExplainTradeoffFailed: "cee.explain_tradeoff.failed",

        // Factor Extraction events (v2.3)
        FactorExtractionComplete: "cee.factor_extraction.complete",
        FactorBaselineDefaulted: "cee.factor.baseline_defaulted",

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

        // CEE Ask events (Working Set API)
        CeeAskRequested: "cee.ask.requested",
        CeeAskCompleted: "cee.ask.completed",
        CeeAskFailed: "cee.ask.failed",

        // CEE Review events (M1 Orchestrator)
        CeeReviewRequested: "cee.review.requested",
        CeeReviewSucceeded: "cee.review.succeeded",
        CeeReviewFailed: "cee.review.failed",

        // Boundary logging events (Observability v1)
        BoundaryRequest: "boundary.request",
        BoundaryResponse: "boundary.response",
        CeeBoundaryBlocked: "cee.boundary.blocked",

        // Config security events (Stream F)
        CeeConfigRawIoOverridden: "cee.config.raw_io_overridden",

        // Performance timing events (Observability v2)
        LlmCall: "llm.call",
        DownstreamCall: "downstream.call",

        // JSON extraction events (LLM response parsing)
        JsonExtractionRequired: "llm.json_extraction.required",

        // Options interventions defaulting (CEE)
        InterventionsMissingDefaulted: "cee.option.interventions_missing_defaulted",

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

        // v5-maintenance (2026-04-21): V5 additions. When adding new V5
        // telemetry events, ALSO add them here so this canary keeps flagging
        // accidental renames.
        AnalysisFreshnessDerived: "v5.analysis_freshness.derived",
        AnalysisFreshnessFactSelected: "v5.analysis_freshness.fact_selected",
        AnalysisFreshnessFirstTurnAssumed: "v5.analysis_freshness.first_turn_assumed",
        AnalysisFreshnessGraphHashMissing: "v5.analysis_freshness.graph_hash_missing",
        AnalysisFreshnessInvariantFailed: "v5.analysis_freshness.invariant_failed",
        BoundaryValidation: "boundary.validation",
        ContextPackAssembled: "v5.context_pack.assembled",
        CqeExtraction: "cqe.extraction",
        // V5 Phase 2 additions (2026-05-01).
        DraftNarrationCountMismatch: "v5.draft_narration.count_mismatch",
        // brief brief-display-safe-analysis A2 (2026-05-02).
        DraftNarrationCountSuppressed: "v5.draft_narration.count_suppressed",
        HandlerInvocation: "v5.handler_invocation",
        PlotResponseInvalidNumeric: "v5.plot_response.invalid_numeric",
        PostAnalysisDirectAnswerRecovered: "v5.post_analysis.direct_answer_recovered",
        PostAnalysisDirectAnswerRecoverySkipped: "v5.post_analysis.direct_answer_recovery_skipped",
        ProbabilityOutOfRange: "v5.probability_out_of_range",
        RecoveryResponse: "v5.recovery_response",
        SessionReadDegraded: "session.read_degraded",
        V5SessionContinuityGap: "v5.session.continuity_gap",
        TurnExecutorCompleted: "turn_executor.completed",
        TurnExecutorContaminationNarrate: "turn_executor.contamination_narrate",
        TurnExecutorFailureResponse: "turn_executor.failure_response",
        TurnExecutorGraphLookup: "turn_executor.graph_lookup",
        TurnExecutorStarted: "turn_executor.started",
        V5BriefTextNormalised: "v5.brief_text.normalised",
        DecisionContextDerived: "v5.decision_context.derived",
        V5CoachingStateDerived: "v5.coaching_state.derived",
        V5CoachingStatePersisted: "v5.coaching_state.persisted",
        V5CoachingStateLifecycleDerived: "v5.coaching_state.lifecycle_derived",
        V5CoachingSignalFired: "v5.coaching.signal_fired",
        V5DecisionReviewDegraded: "v5.decision_review_degraded",
        V5DecisionReviewFailed: "v5.decision_review.failed",
        V5DecisionReviewInvoked: "v5.decision_review.invoked",
        V5DecisionReviewSkipped: "v5.decision_review.skipped",
        V5DeterministicValueUpdate: "v5.deterministic_value_update",
        V5EditGraphGraphStatePresent: "v5.edit_graph.graph_state_present",
        V5EditGraphGraphStateReloaded: "v5.edit_graph.graph_state_reloaded",
        V5EditGraphGraphStateUnavailable: "v5.edit_graph.graph_state_unavailable",
        V5ExplanationAnswerVerdict: "v5.explanation.answer_verdict",
        V5ExplanationEvidence: "v5.explanation.evidence",
        V5MutationLanguageGuard: "v5.mutation_language_guard",
        V5PromptCache: "v5.prompt_cache",
        V5ResponseProseSanitised: "v5.response.prose_sanitised",
        V5PromptResolved: "v5.prompt_resolved",
        V5PromptResolutionPolicy: "v5.prompt_resolution_policy",
        V5RecoveryChipServed: "v5.recovery_chip_served",
        V5UnexpectedExplanationPayload: "v5.unexpected_explanation_payload",
        ValidatorOutcome: "v5.validator_outcome",
        // V5 interaction recovery tranche (2026-05-06): pending-action
        // lifecycle telemetry. Matches the keys in src/utils/telemetry.ts.
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
        // V5 interaction recovery tranche: add-risk preflight + clarification.
        EditGraphPreflightSkippedLlm: "v5.edit_graph.preflight_skipped_llm",
        V5EditGraphAddRiskClarified: "v5.edit_graph.add_risk_clarified",
        // PR #149 (cee-ws1-continuity-actions) — state-query guard + recent_changes pre-LLM.
        V5RecentChangesPreLlm: "v5.recent_changes.pre_llm",
        V5StateQueryGuard: "v5.state_query_guard",
        // V5 Context Management v1 — readiness snapshot + sibling guards + no-op recovery.
        V5ContextReadiness: "v5.context_readiness",
        V5StaleRerunGuard: "v5.stale_rerun_guard",
        V5RunComparisonGate: "v5.run_comparison_gate",
        V5ProposedChangeEmitted: "v5.proposed_change.emitted",
        V5NoAnalysisGuard: "v5.no_analysis_guard",
        V5EditGraphNoOpRecovery: "v5.edit_graph.no_op_recovery",
        V5EditGraphTurn: "v5.edit_graph.turn",
        // V5 link-safe response floor — headline Case-E + chip floor.
        V5HeadlineFellBack: "v5.headline.fell_back",
        V5ChipsEmptyIntentional: "v5.chips.empty_intentional",
        V5ChipsFloorApplied: "v5.chips.floor_applied",
        V5ChipsFinalized: "v5.chips.finalized",
        // CI hygiene baseline (Tranche B) — register inherited live emit() sites.
        EditGraphNoOperations: "edit_graph.no_operations",
        StreamingGeneratorPreflightFailure: "streaming.generator_preflight_failure",
        DeterministicPmsFallbackUsed: "deterministic.pms_fallback_used",
        V4PmsFallbackUsed: "v4.pms_fallback_used",
        DeterministicBannedTermDetected: "deterministic.banned_term_detected",
        OrchestratorDiagnosticsPreambleStripped: "orchestrator.diagnostics_preamble_stripped",
        OrchestratorXmlParseFallback: "orchestrator.xml_parse_fallback",
        CeeStage2EdgeCountInvariantViolated: "cee.stage2.edge_count_invariant_violated",
        CeePostEnrichInvariantViolation: "cee.post_enrich.invariant_violation",
        // M3 freeze-gate cleanup (2026-06-05) — register inherited live emit()
        // sites so drift is enforced again. All diagnostic-only; none have a
        // Datadog metric mapping (see debugOnlyEvents). No emit-site changes.
        CeeAutoBaselineDedupApplied: "cee.auto_baseline_dedup.applied",
        CeeAutoBaselineHeuristicOnlyCollision: "cee.auto_baseline_dedup.heuristic_only_collision",
        CeeOptionsIdenticalBypass: "cee.options_identical.pre_repair_bypass",
        CeeUnifiedPipelineStageTimings: "cee.unified_pipeline.stage_timings",
        V5DecisionReviewCompleted: "v5.decision_review.completed",
        V5EditGraphAnalyticalQuestionSuppressed: "v5.edit_graph.analytical_question_suppressed",
        V5EditGraphProposalConfirmResolved: "v5.edit_graph.proposal_confirm_resolved",
        V5EditGraphStateQuerySuppressed: "v5.edit_graph.state_query_suppressed",
        V5ContinuationGuardApplied: "v5.continuation.guard_applied",
        V5EditGraphAppliedGraphMissingWithOperations: "v5.edit_graph.applied_graph_missing_with_operations",
        V5EditGraphAppliedGraphSynthesizedLocally: "v5.edit_graph.applied_graph_synthesized_locally",
        V5EditGraphFalseSuccessRewritten: "v5.edit_graph.false_success_rewritten",
        V5InterceptedChipClarify: "v5.edit_graph.intercepted_chip_clarify",
        V5InterceptedVagueEdit: "v5.edit_graph.intercepted_vague_edit",
        V5EgressForbiddenPhraseDetected: "v5.egress.forbidden_phrase_detected",
        V5FrameStageNoBriefGuard: "v5.frame_stage_no_brief_guard",
        V5FreshAnalysisFollowupGuard: "v5.fresh_analysis_followup_guard",
        V5Phase3BlockLifecycle: "v5.phase3.block_lifecycle",
        V5PostAnalysisAdviceGate: "v5.post_analysis_advice_gate",
        V5PostAnalysisLabelIntercept: "v5.post_analysis_label_intercept",
        V5PostDraftCoachingSourceSelected: "v5.post_draft_coaching.source_selected",
        V5ProposalContinuationCaptured: "v5.proposal_continuation.captured",
        V5ProposalContinuationInvalidated: "v5.proposal_continuation.invalidated",
        V5ProposalContinuationResumed: "v5.proposal_continuation.resumed",
        V5RoutingBoundedFallback: "v5.routing_bounded_fallback",
        V5RunAnalysisTimings: "v5.run_analysis.timings",
        V5TurnStageTimings: "v5.turn_executor.stage_timings",
      };

      // Ensure TelemetryEvents matches the snapshot exactly
      expect(TelemetryEvents).toEqual(eventSnapshot);
    });

    it("validates that VALID_EVENT_NAMES set matches enum values", () => {
      const enumValues = Object.values(TelemetryEvents);
      const setValues = Array.from(VALID_EVENT_NAMES).sort();

      expect(setValues).toEqual(enumValues.sort());
    });

    it("ensures no duplicate event names exist", () => {
      const eventNames = Object.values(TelemetryEvents);
      const uniqueNames = new Set(eventNames);

      expect(uniqueNames.size).toBe(eventNames.length);
    });
  });

  describe("Event namespace consistency", () => {
    it("ensures all events start with a valid prefix and namespace", () => {
      const allEvents = Object.values(TelemetryEvents);
      // v5-maintenance (2026-04-21): added turn_executor.*, cqe.*,
      // session.*, and v5.* namespaces for V5 additions.
      const validPrefixes =
        /^(assist\.(draft|clarifier|critique|suggest_options|explain_diff|auth|llm|share|sse|cost_calculation)\.|cee\.(draft_graph|explain_graph|evidence_helper|bias_check|options|option|sensitivity_coach|team_perspectives|preflight|clarification|clarifier|decision_review|verification|graph|graph_readiness|key_insight|elicit_belief|utility_weight|risk_tolerance|edge_function|edge_direction|edge|generate_recommendation|narrate_conditions|explain_policy|elicit_preferences|elicit_preferences_answer|explain_tradeoff|factor_extraction|factor|schema_v2|schema_v3|isl_synthesis|ask|review|analysis_ready|goal_generation|boundary|config|stage2|post_enrich|auto_baseline_dedup|options_identical|unified_pipeline)\.|cee\.brief_signals$|cee\.intervention_extraction$|cee\.goal_generation$|orchestrator\.(turn|intent|tool|plot|idempotency|commentary|system_event|diagnostics_preamble_stripped|xml_parse_fallback)\b|llm\.(normalization\.|repair_prompt\.|call$|json_extraction\.required$)|isl\.config\.|prompt\.(store_error|store\.(cache\.|background_refresh$)|loader|compiled|hash_mismatch|experiment|staging|activation\.|test\.|version\.|rollback\.|approval\.)|admin\.(prompt|experiment|auth|ip)\.|boundary\.|downstream\.call$|turn_executor\.|cqe\.|session\.read_degraded$|v4\.pms_fallback_used$|deterministic\.(pms_fallback_used|banned_term_detected)$|streaming\.generator_preflight_failure$|edit_graph\.no_operations$|v5\.(brief_text|coaching|coaching_state|decision_review|decision_review_degraded|decision_context|deterministic_value_update|context_pack|continuation|edit_graph|handler_invocation|prompt_cache|recovery_response|recovery_chip_served|response|validator_outcome|explanation|mutation_language_guard|unexpected_explanation_payload|prompt_resolved|prompt_resolution_policy|analysis_freshness|plot_response|probability_out_of_range|draft_narration|post_analysis|pending_action|pending_actions|recent_changes|state_query_guard|headline|chips|egress|frame_stage_no_brief_guard|fresh_analysis_followup_guard|phase3|post_analysis_advice_gate|post_analysis_label_intercept|post_draft_coaching|proposal_continuation|routing_bounded_fallback|run_analysis|turn_executor|context_readiness|no_analysis_guard|stale_rerun_guard|run_comparison_gate|proposed_change|session)(\.|$))/;

      for (const event of allEvents) {
        expect(event).toMatch(validPrefixes);
      }
    });

    it("uses snake_case for event suffixes (not camelCase)", () => {
      const allEvents = Object.values(TelemetryEvents);

      // Check that no events use camelCase after the prefix
      for (const event of allEvents) {
        // Remove the namespace prefix (assist.*, cee.*, llm.*, isl.*)
        const suffix = event
          .replace(/^assist\.(draft|clarifier|critique|suggest_options|explain_diff|auth|llm|share|sse|cost_calculation)\./, "")
          .replace(/^cee\.(draft_graph|explain_graph|evidence_helper|bias_check|options|sensitivity_coach|team_perspectives|preflight)\./, "")
          .replace(/^llm\.normalization\./, "")
          .replace(/^isl\.config\./, "");

        // Should not contain capital letters (camelCase indicator)
        expect(suffix).not.toMatch(/[A-Z]/);

        // Should use underscores, not hyphens
        if (suffix.includes("_")) {
          expect(suffix).not.toMatch(/-/);
        }
      }
    });
  });

  describe("Critical events coverage", () => {
    it("has core lifecycle events (started, completed)", () => {
      expect(TelemetryEvents.DraftStarted).toBe("assist.draft.started");
      expect(TelemetryEvents.DraftCompleted).toBe("assist.draft.completed");
    });

    it("has SSE streaming events for fixture tracking", () => {
      expect(TelemetryEvents.SSEStarted).toBe("assist.draft.sse_started");
      expect(TelemetryEvents.SSECompleted).toBe("assist.draft.sse_completed");
      expect(TelemetryEvents.SSEError).toBe("assist.draft.sse_error");
      expect(TelemetryEvents.FixtureShown).toBe("assist.draft.fixture_shown");
      expect(TelemetryEvents.FixtureReplaced).toBe("assist.draft.fixture_replaced");
      expect(TelemetryEvents.LegacySSEPath).toBe("assist.draft.legacy_sse_path");
    });

    it("has validation and repair events for quality tracking", () => {
      expect(TelemetryEvents.ValidationFailed).toBe("assist.draft.validation_failed");
      expect(TelemetryEvents.RepairAttempted).toBe("assist.draft.repair_attempted");
      expect(TelemetryEvents.RepairStart).toBe("assist.draft.repair_start");
      expect(TelemetryEvents.RepairSuccess).toBe("assist.draft.repair_success");
      expect(TelemetryEvents.RepairPartial).toBe("assist.draft.repair_partial");
      expect(TelemetryEvents.RepairFallback).toBe("assist.draft.repair_fallback");
    });

    it("has deprecation tracking events", () => {
      expect(TelemetryEvents.LegacyProvenance).toBe("assist.draft.legacy_provenance");
      expect(TelemetryEvents.LegacySSEPath).toBe("assist.draft.legacy_sse_path");
    });
  });

  describe("Datadog metric alignment", () => {
    it("documents which events map to Datadog metrics", () => {
      // This serves as documentation for dashboard creators
      const datadogMetrics = {
        // Counters
        "draft.started": [TelemetryEvents.DraftStarted],
        "draft.completed": [TelemetryEvents.DraftCompleted],
        "draft.sse.started": [TelemetryEvents.SSEStarted],
        "draft.sse.completed": [TelemetryEvents.SSECompleted],
        "draft.sse.errors": [TelemetryEvents.SSEError],
        "draft.validation.failed": [TelemetryEvents.ValidationFailed],
        "draft.repair.attempted": [TelemetryEvents.RepairAttempted, TelemetryEvents.RepairStart],
        "draft.repair.success": [TelemetryEvents.RepairSuccess],
        "draft.repair.partial": [TelemetryEvents.RepairPartial],
        "draft.repair.fallback": [TelemetryEvents.RepairFallback],
        "draft.legacy_provenance.occurrences": [TelemetryEvents.LegacyProvenance],
        "draft.sse.legacy_path": [TelemetryEvents.LegacySSEPath],
        "draft.fixture.shown": [TelemetryEvents.FixtureShown],
        "draft.fixture.replaced": [TelemetryEvents.FixtureReplaced],
        "draft.guard_violation": [TelemetryEvents.GuardViolation],

        // Clarifier events
        "clarifier.round.started": [TelemetryEvents.ClarifierRoundStart],
        "clarifier.round.completed": [TelemetryEvents.ClarifierRoundComplete],
        "clarifier.round.failed": [TelemetryEvents.ClarifierRoundFailed],

        // Critique events
        "critique.started": [TelemetryEvents.CritiqueStart],
        "critique.completed": [TelemetryEvents.CritiqueComplete],
        "critique.failed": [TelemetryEvents.CritiqueFailed],

        // Suggest Options events
        "suggest_options.started": [TelemetryEvents.SuggestOptionsStart],
        "suggest_options.completed": [TelemetryEvents.SuggestOptionsComplete],
        "suggest_options.failed": [TelemetryEvents.SuggestOptionsFailed],

        // Explain Diff events
        "explain_diff.started": [TelemetryEvents.ExplainDiffStart],
        "explain_diff.completed": [TelemetryEvents.ExplainDiffComplete],
        "explain_diff.failed": [TelemetryEvents.ExplainDiffFailed],

        // Auth events (v1.3.0)
        "auth.success": [TelemetryEvents.AuthSuccess],
        "auth.failed": [TelemetryEvents.AuthFailed],
        "auth.rate_limited": [TelemetryEvents.RateLimited],

        // LLM retry events (v1.2.1)
        "llm.retry": [TelemetryEvents.LlmRetry],
        "llm.retry_success": [TelemetryEvents.LlmRetrySuccess],
        "llm.retry_exhausted": [TelemetryEvents.LlmRetryExhausted],

        // Provider failover events (v1.6)
        "llm.provider_failover": [TelemetryEvents.ProviderFailover],
        "llm.provider_failover.success": [TelemetryEvents.ProviderFailoverSuccess],
        "llm.provider_failover.exhausted": [TelemetryEvents.ProviderFailoverExhausted],

        // SSE client events (v1.2.1)
        "sse.client_closed": [TelemetryEvents.SseClientClosed],

        // Upstream telemetry events (v04)
        "draft.upstream_success": [TelemetryEvents.DraftUpstreamSuccess],
        "draft.upstream_error": [TelemetryEvents.DraftUpstreamError],

        // Share events (v1.6)
        "share.created": [TelemetryEvents.ShareCreated],
        "share.accessed": [TelemetryEvents.ShareAccessed],
        "share.revoked": [TelemetryEvents.ShareRevoked],
        "share.expired": [TelemetryEvents.ShareExpired],
        "share.not_found": [TelemetryEvents.ShareNotFound],

        // Prompt cache & validation cache events
        "llm.prompt_cache.hit": [TelemetryEvents.PromptCacheHit],
        "llm.prompt_cache.miss": [TelemetryEvents.PromptCacheMiss],
        "llm.prompt_cache.eviction": [TelemetryEvents.PromptCacheEviction],
        "draft.validation_cache.hit": [TelemetryEvents.ValidationCacheHit],
        "draft.validation_cache.miss": [TelemetryEvents.ValidationCacheMiss],
        "draft.validation_cache.bypass": [TelemetryEvents.ValidationCacheBypass],
        "llm.anthropic_prompt_cache.hint": [TelemetryEvents.AnthropicPromptCacheHint],

        // V5 routing prompt-cache observability — hit/miss only for
        // cache_mode='enabled'; disabled modes split out so they don't
        // skew hit-rate dashboards.
        "v5.prompt_cache.hit": [TelemetryEvents.V5PromptCache],
        "v5.prompt_cache.miss": [TelemetryEvents.V5PromptCache],
        "v5.prompt_cache.unknown": [TelemetryEvents.V5PromptCache],
        "v5.prompt_cache.disabled": [TelemetryEvents.V5PromptCache],

        // SSE Resume events (v1.8)
        "sse.resume.issued": [TelemetryEvents.SseResumeIssued],
        "sse.resume.attempt": [TelemetryEvents.SseResumeAttempt],
        "sse.resume.success": [TelemetryEvents.SseResumeSuccess],
        "sse.resume.expired": [TelemetryEvents.SseResumeExpired],
        "sse.resume.incompatible": [TelemetryEvents.SseResumeIncompatible],
        "sse.resume.replay_count": [TelemetryEvents.SseResumeReplayCount],
        "sse.partial_recovery": [TelemetryEvents.SsePartialRecovery],
        "sse.buffer_trimmed": [TelemetryEvents.SseBufferTrimmed],
        "sse.snapshot_created": [TelemetryEvents.SseSnapshotCreated],

        // SSE Live Resume events (v1.9)
        "sse.resume_live.started": [TelemetryEvents.SseResumeLiveStart],
        "sse.resume_live.continue": [TelemetryEvents.SseResumeLiveContinue],
        "sse.resume_live.ended": [TelemetryEvents.SseResumeLiveEnd],
        "sse.snapshot.renewed": [TelemetryEvents.SseSnapshotRenewed],

        // SSE degraded mode events (v1.11)
        "sse.degraded_mode": [TelemetryEvents.SseDegradedMode],

        // Histograms
        "draft.latency_ms": [TelemetryEvents.DraftCompleted],
        "draft.sse.stream_duration_ms": [TelemetryEvents.SSECompleted],
        "draft.confidence": [TelemetryEvents.DraftCompleted],
        "draft.cost_usd": [TelemetryEvents.DraftCompleted],
        "clarifier.duration_ms": [TelemetryEvents.ClarifierRoundComplete],
        "clarifier.cost_usd": [TelemetryEvents.ClarifierRoundComplete],
        "clarifier.confidence": [TelemetryEvents.ClarifierRoundComplete],
        "critique.duration_ms": [TelemetryEvents.CritiqueComplete],
        "critique.cost_usd": [TelemetryEvents.CritiqueComplete],
        "suggest_options.duration_ms": [TelemetryEvents.SuggestOptionsComplete],
        "suggest_options.cost_usd": [TelemetryEvents.SuggestOptionsComplete],
        "explain_diff.duration_ms": [TelemetryEvents.ExplainDiffComplete],
        "explain_diff.cost_usd": [TelemetryEvents.ExplainDiffComplete],

        // Gauges
        "draft.graph.nodes": [TelemetryEvents.DraftCompleted],
        "draft.graph.edges": [TelemetryEvents.DraftCompleted],
        "draft.validation.violations": [TelemetryEvents.ValidationFailed],
        "draft.legacy_provenance.percentage": [TelemetryEvents.LegacyProvenance],
        "critique.issues.blockers": [TelemetryEvents.CritiqueComplete],
        "critique.issues.improvements": [TelemetryEvents.CritiqueComplete],
        "critique.issues.observations": [TelemetryEvents.CritiqueComplete],
        "suggest_options.option_count": [TelemetryEvents.SuggestOptionsComplete],
        "explain_diff.rationale_count": [TelemetryEvents.ExplainDiffComplete],

        // CEE v1 endpoint events (counters)
        "cee.draft_graph.requested": [TelemetryEvents.CeeDraftGraphRequested],
        "cee.draft_graph.succeeded": [TelemetryEvents.CeeDraftGraphSucceeded],
        "cee.draft_graph.failed": [TelemetryEvents.CeeDraftGraphFailed],
        "cee.draft_graph.legacy_coaching_value_normalised": [TelemetryEvents.DraftGraphLegacyCoachingValueNormalised],
        "cee.draft_graph.contract_default_applied": [TelemetryEvents.DraftGraphContractDefaultApplied],
        "cee.draft_graph.connectivity_check": [TelemetryEvents.CeeConnectivityCheck],
        "cee.draft_graph.uniform_strengths_detected": [TelemetryEvents.CeeUniformStrengthsDetected],
        "cee.draft_graph.goal_inferred": [TelemetryEvents.CeeGoalInferred],
        "cee.explain_graph.requested": [TelemetryEvents.CeeExplainGraphRequested],
        "cee.explain_graph.succeeded": [TelemetryEvents.CeeExplainGraphSucceeded],
        "cee.explain_graph.failed": [TelemetryEvents.CeeExplainGraphFailed],
        "cee.evidence_helper.requested": [TelemetryEvents.CeeEvidenceHelperRequested],
        "cee.evidence_helper.succeeded": [TelemetryEvents.CeeEvidenceHelperSucceeded],
        "cee.evidence_helper.failed": [TelemetryEvents.CeeEvidenceHelperFailed],
        "cee.bias_check.requested": [TelemetryEvents.CeeBiasCheckRequested],
        "cee.bias_check.succeeded": [TelemetryEvents.CeeBiasCheckSucceeded],
        "cee.bias_check.failed": [TelemetryEvents.CeeBiasCheckFailed],
        "cee.brief_signals": [TelemetryEvents.CeeBriefSignals],
        "cee.options.requested": [TelemetryEvents.CeeOptionsRequested],
        "cee.options.succeeded": [TelemetryEvents.CeeOptionsSucceeded],
        "cee.options.failed": [TelemetryEvents.CeeOptionsFailed],
        "cee.sensitivity_coach.requested": [TelemetryEvents.CeeSensitivityCoachRequested],
        "cee.sensitivity_coach.succeeded": [TelemetryEvents.CeeSensitivityCoachSucceeded],
        "cee.sensitivity_coach.failed": [TelemetryEvents.CeeSensitivityCoachFailed],
        "cee.team_perspectives.requested": [TelemetryEvents.CeeTeamPerspectivesRequested],
        "cee.team_perspectives.succeeded": [TelemetryEvents.CeeTeamPerspectivesSucceeded],
        "cee.team_perspectives.failed": [TelemetryEvents.CeeTeamPerspectivesFailed],

        // CEE verification events (v1.14)
        "cee.verification.succeeded": [TelemetryEvents.CeeVerificationSucceeded],
        "cee.verification.failed": [TelemetryEvents.CeeVerificationFailed],

        // Prompt Management events (v2.0)
        "prompt.store.error": [TelemetryEvents.PromptStoreError],
        "prompt.loader.error": [TelemetryEvents.PromptLoaderError],
        "prompt.loader.source": [TelemetryEvents.PromptLoadedFromStore, TelemetryEvents.PromptLoadedFromDefault],
        "prompt.compiled": [TelemetryEvents.PromptCompiled],
        "prompt.hash_mismatch": [TelemetryEvents.PromptHashMismatch],
        "admin.prompt.access": [TelemetryEvents.AdminPromptAccess],
        "admin.experiment.access": [TelemetryEvents.AdminExperimentAccess],
        "admin.auth.failed": [TelemetryEvents.AdminAuthFailed],
        "admin.ip.blocked": [TelemetryEvents.AdminIPBlocked],

        // Prompt Experiment events (v2.0)
        "prompt.experiment.assigned": [TelemetryEvents.PromptExperimentAssigned],
        "prompt.staging.used": [TelemetryEvents.PromptStagingUsed],

        // Prompt Activation Guard events (v2.2)
        "prompt.activation.blocked": [TelemetryEvents.PromptActivationBlocked],
        "prompt.staging.activated": [TelemetryEvents.PromptStagingActivated],

        // Decision Review events (v2.0)
        "cee.decision_review.requested": [TelemetryEvents.DecisionReviewRequested],
        "cee.decision_review.succeeded": [TelemetryEvents.DecisionReviewGenerated, TelemetryEvents.DecisionReviewSucceeded],
        "cee.decision_review.failed": [TelemetryEvents.DecisionReviewFailed],
        "cee.decision_review.isl_fallback": [TelemetryEvents.DecisionReviewIslFallback],
        "cee.decision_review.prompt_loaded": [TelemetryEvents.CeeDecisionReviewPromptLoaded],
        "cee.decision_review.llm_call_started": [TelemetryEvents.CeeDecisionReviewLlmCallStarted],
        "cee.decision_review.llm_call_completed": [TelemetryEvents.CeeDecisionReviewLlmCallCompleted],
        "cee.decision_review.json_extracted": [TelemetryEvents.CeeDecisionReviewJsonExtracted],
        "cee.decision_review.shape_check_failed": [TelemetryEvents.CeeDecisionReviewShapeCheckFailed],
        "cee.decision_review.shape_check_warnings": [TelemetryEvents.CeeDecisionReviewShapeCheckWarnings],

        // Graph Readiness events (v2.3)
        "cee.graph_readiness.requested": [TelemetryEvents.CeeGraphReadinessRequested],
        "cee.graph_readiness.completed": [TelemetryEvents.CeeGraphReadinessCompleted],
        "cee.graph_readiness.failed": [TelemetryEvents.CeeGraphReadinessFailed],

        // Key Insight events (v2.4)
        "cee.key_insight.requested": [TelemetryEvents.CeeKeyInsightRequested],
        "cee.key_insight.succeeded": [TelemetryEvents.CeeKeyInsightSucceeded],
        "cee.key_insight.failed": [TelemetryEvents.CeeKeyInsightFailed],

        // Elicit Belief events (v2.5)
        "cee.elicit_belief.requested": [TelemetryEvents.CeeElicitBeliefRequested],
        "cee.elicit_belief.succeeded": [TelemetryEvents.CeeElicitBeliefSucceeded],
        "cee.elicit_belief.failed": [TelemetryEvents.CeeElicitBeliefFailed],

        // Utility Weight events (v2.5)
        "cee.utility_weight.requested": [TelemetryEvents.CeeUtilityWeightRequested],
        "cee.utility_weight.succeeded": [TelemetryEvents.CeeUtilityWeightSucceeded],
        "cee.utility_weight.failed": [TelemetryEvents.CeeUtilityWeightFailed],

        // Risk Tolerance events (v2.5)
        "cee.risk_tolerance.requested": [TelemetryEvents.CeeRiskToleranceRequested],
        "cee.risk_tolerance.succeeded": [TelemetryEvents.CeeRiskToleranceSucceeded],
        "cee.risk_tolerance.failed": [TelemetryEvents.CeeRiskToleranceFailed],

        // Edge Function Suggestion events (v2.6)
        "cee.edge_function.requested": [TelemetryEvents.CeeEdgeFunctionRequested],
        "cee.edge_function.completed": [TelemetryEvents.CeeEdgeFunctionCompleted],
        "cee.edge_function.failed": [TelemetryEvents.CeeEdgeFunctionFailed],

        // Edge Direction Validation events (Brief G)
        "cee.edge_direction.violation_detected": [TelemetryEvents.EdgeDirectionViolationDetected],
        "cee.edge_direction.validation_passed": [TelemetryEvents.EdgeDirectionValidationPassed],

        // Phase 4: Recommendation Narratives events
        "cee.generate_recommendation.requested": [TelemetryEvents.CeeGenerateRecommendationRequested],
        "cee.generate_recommendation.completed": [TelemetryEvents.CeeGenerateRecommendationCompleted],
        "cee.generate_recommendation.failed": [TelemetryEvents.CeeGenerateRecommendationFailed],

        "cee.narrate_conditions.requested": [TelemetryEvents.CeeNarrateConditionsRequested],
        "cee.narrate_conditions.completed": [TelemetryEvents.CeeNarrateConditionsCompleted],
        "cee.narrate_conditions.failed": [TelemetryEvents.CeeNarrateConditionsFailed],

        "cee.explain_policy.requested": [TelemetryEvents.CeeExplainPolicyRequested],
        "cee.explain_policy.completed": [TelemetryEvents.CeeExplainPolicyCompleted],
        "cee.explain_policy.failed": [TelemetryEvents.CeeExplainPolicyFailed],

        // Phase 5: Preference Elicitation events
        "cee.elicit_preferences.requested": [TelemetryEvents.CeeElicitPreferencesRequested],
        "cee.elicit_preferences.succeeded": [TelemetryEvents.CeeElicitPreferencesSucceeded],
        "cee.elicit_preferences.failed": [TelemetryEvents.CeeElicitPreferencesFailed],
        "cee.elicit_preferences_answer.requested": [TelemetryEvents.CeeElicitPreferencesAnswerRequested],
        "cee.elicit_preferences_answer.succeeded": [TelemetryEvents.CeeElicitPreferencesAnswerSucceeded],
        "cee.elicit_preferences_answer.failed": [TelemetryEvents.CeeElicitPreferencesAnswerFailed],
        "cee.explain_tradeoff.requested": [TelemetryEvents.CeeExplainTradeoffRequested],
        "cee.explain_tradeoff.succeeded": [TelemetryEvents.CeeExplainTradeoffSucceeded],
        "cee.explain_tradeoff.failed": [TelemetryEvents.CeeExplainTradeoffFailed],

        // Factor Extraction events (v2.3)
        "cee.factor_extraction.complete": [TelemetryEvents.FactorExtractionComplete],

        // Schema v2 Transform events (v2.3)
        "cee.schema_v2.transform_complete": [TelemetryEvents.SchemaV2TransformComplete],

        // Schema v3 Transform events (v3.0)
        "cee.schema_v3.transform_complete": [TelemetryEvents.SchemaV3TransformComplete],
        "cee.intervention_extraction": [TelemetryEvents.InterventionExtraction],

        // Edge coefficient clamping events (P1-CEE-2)
        "cee.edge.strength_clamped": [TelemetryEvents.EdgeStrengthClamped],
        "cee.edge.strength_negligible": [TelemetryEvents.EdgeStrengthNegligible],
        "cee.edge.strength_low": [TelemetryEvents.EdgeStrengthLow],

        // ISL Synthesis events (v2.3)
        "cee.isl_synthesis.requested": [TelemetryEvents.IslSynthesisRequested],
        "cee.isl_synthesis.succeeded": [TelemetryEvents.IslSynthesisSucceeded],
        "cee.isl_synthesis.failed": [TelemetryEvents.IslSynthesisFailed],

        // CEE Ask events (Working Set API)
        "cee.ask.requested": [TelemetryEvents.CeeAskRequested],
        "cee.ask.completed": [TelemetryEvents.CeeAskCompleted],
        "cee.ask.failed": [TelemetryEvents.CeeAskFailed],

        // CEE Review events (M1 Orchestrator)
        "cee.review.requested": [TelemetryEvents.CeeReviewRequested],
        "cee.review.succeeded": [TelemetryEvents.CeeReviewSucceeded],
        "cee.review.failed": [TelemetryEvents.CeeReviewFailed],

        // Prompt Store Cache events (v2.0 Phase 4.3)
        "prompt.store.cache.hit": [TelemetryEvents.PromptStoreCacheHit],
        "prompt.store.cache.miss": [TelemetryEvents.PromptStoreCacheMiss],
        "prompt.store.cache.invalidated": [TelemetryEvents.PromptStoreCacheInvalidated],
        "prompt.store.cache.warmed": [TelemetryEvents.PromptStoreCacheWarmed],
        "prompt.store.background_refresh": [TelemetryEvents.PromptStoreBackgroundRefresh],

        // Prompt Test Sandbox events (v2.1)
        "prompt.test.executed": [TelemetryEvents.PromptTestExecuted],
        "prompt.test.validation_passed": [TelemetryEvents.PromptTestValidationPassed],
        "prompt.test.validation_failed": [TelemetryEvents.PromptTestValidationFailed],

        // Prompt Version Lifecycle events (v2.1)
        "prompt.version.promoted": [TelemetryEvents.PromptVersionPromoted],
        "prompt.version.demoted": [TelemetryEvents.PromptVersionDemoted],
        "prompt.rollback.executed": [TelemetryEvents.PromptRollbackExecuted],
        "prompt.rollback.failed": [TelemetryEvents.PromptRollbackFailed],

        // Prompt Approval Gate events (v2.1)
        "prompt.approval.required": [TelemetryEvents.PromptApprovalRequired],
        "prompt.approval.granted": [TelemetryEvents.PromptApprovalGranted],
        "prompt.approval.rejected": [TelemetryEvents.PromptApprovalRejected],

        // Performance timing events (Observability v2)
        "llm.call": [TelemetryEvents.LlmCall],
        "llm.call.latency_ms": [TelemetryEvents.LlmCall],
        "llm.call.tokens_prompt": [TelemetryEvents.LlmCall],
        "llm.call.tokens_completion": [TelemetryEvents.LlmCall],
        "downstream.call": [TelemetryEvents.DownstreamCall],
        "downstream.call.latency_ms": [TelemetryEvents.DownstreamCall],
        "downstream.call.status": [TelemetryEvents.DownstreamCall],
      };

      // Verify all events are documented, except debug-only events
      const allEvents = Object.values(TelemetryEvents);
      const documentedEvents = new Set(
        Object.values(datadogMetrics).flat()
      );

      // Stage events are debug-only and intentionally have no Datadog mappings
      // ISL config events are logged locally and don't need Datadog counters
      // Preflight events are diagnostic and logged locally
      // LLM normalization events are debug-level mapping notifications
      // Clarification events are diagnostic and logged locally
      // Multi-turn clarifier events are diagnostic and logged locally
      const debugOnlyEvents: string[] = [
        TelemetryEvents.Stage,
        TelemetryEvents.CostCalculationUnknownModel,
        TelemetryEvents.IslConfigInvalidTimeout,
        TelemetryEvents.IslConfigInvalidMaxRetries,
        TelemetryEvents.IslConfigTimeoutClamped,
        TelemetryEvents.IslConfigRetriesClamped,
        TelemetryEvents.PreflightValidationPassed,
        TelemetryEvents.PreflightValidationFailed,
        TelemetryEvents.PreflightReadinessAssessed,
        TelemetryEvents.PreflightRejected,
        TelemetryEvents.PreflightCompleted,
        TelemetryEvents.CeeBriefSignals,
        // Deterministic graph enforcement (Stage 4 substep 9b) — diagnostic, no Datadog
        TelemetryEvents.CeeInboundSumRescaled,
        TelemetryEvents.CeeBridgeChainRepaired,
        TelemetryEvents.CeeEnforcementCompleted,
        TelemetryEvents.CeeEnforcementEdgeSkipped,
        TelemetryEvents.CeeEnforcementPostValidationErrors,
        TelemetryEvents.CeeEnforcementPostValidationWarnings,
        TelemetryEvents.CeeEnforcementPostValidationFailed,
        TelemetryEvents.CeeEnforcementBlocked,
        TelemetryEvents.NodeKindNormalized,
        TelemetryEvents.GoalGeneration,
        TelemetryEvents.ClarificationRequired,
        TelemetryEvents.ClarificationBypassAllowed,
        // Multi-turn clarifier events (Phase 1 - diagnostic only)
        TelemetryEvents.CeeClarifierSessionStart,
        TelemetryEvents.CeeClarifierQuestionAsked,
        TelemetryEvents.CeeClarifierAnswerReceived,
        TelemetryEvents.CeeClarifierAnswerIncorporated,
        TelemetryEvents.CeeClarifierConverged,
        TelemetryEvents.CeeClarifierQuestionCached,
        TelemetryEvents.CeeClarifierQuestionRetrieved,
        TelemetryEvents.CeeClarifierFailed,
        TelemetryEvents.CeeClarifierSkipped,
        // Bias mitigation events (diagnostic only)
        TelemetryEvents.BiasPatchesGenerated,
        TelemetryEvents.BiasPatchesApplied,
        // Graph Validation events (diagnostic only)
        TelemetryEvents.CeeGraphValidation,
        TelemetryEvents.CeeGraphGoalsMerged,
        TelemetryEvents.CeeGraphSizeExceeded,
        // Boundary logging events (observability, no Datadog counters initially)
        TelemetryEvents.BoundaryRequest,
        TelemetryEvents.BoundaryResponse,
        TelemetryEvents.CeeBoundaryBlocked,
        // Config security events (Stream F - diagnostic only, logged locally)
        TelemetryEvents.CeeConfigRawIoOverridden,
        // Analysis-Ready Output events (P0 - diagnostic only)
        TelemetryEvents.AnalysisReadyBuilt,
        TelemetryEvents.AnalysisReadyValidationFailed,
        // Factor baseline defaulting (diagnostic only)
        TelemetryEvents.FactorBaselineDefaulted,
        // JSON extraction events (diagnostic only)
        TelemetryEvents.JsonExtractionRequired,
        // Options interventions defaulting (diagnostic only)
        TelemetryEvents.InterventionsMissingDefaulted,
        // Repair prompt truncation (diagnostic only - large graph handling)
        TelemetryEvents.RepairPromptTruncated,
        // Orchestrator events (Track C - diagnostic only during PoC)
        TelemetryEvents.OrchestratorTurnStarted,
        TelemetryEvents.OrchestratorTurnCompleted,
        TelemetryEvents.OrchestratorTurnFailed,
        TelemetryEvents.OrchestratorIntentResolved,
        TelemetryEvents.OrchestratorToolInvoked,
        TelemetryEvents.OrchestratorToolCompleted,
        TelemetryEvents.OrchestratorToolFailed,
        TelemetryEvents.OrchestratorPlotRunRequested,
        TelemetryEvents.OrchestratorPlotRunCompleted,
        TelemetryEvents.OrchestratorPlotRunFailed,
        TelemetryEvents.OrchestratorPlotValidateRequested,
        TelemetryEvents.OrchestratorPlotValidateCompleted,
        TelemetryEvents.OrchestratorIdempotencyHit,
        TelemetryEvents.OrchestratorIdempotencyCached,
        TelemetryEvents.OrchestratorNumericFreehandStripped,
        TelemetryEvents.OrchestratorSystemEvent,
        TelemetryEvents.OrchestratorModeDisagreement,
        TelemetryEvents.OrchestratorToolSuppressed,
        TelemetryEvents.OrchestratorContractViolation,

        // v5-maintenance (2026-04-21): V5 additions are diagnostic-only
        // (turn-executor, CQE, decision-review, coaching-signal telemetry).
        // Not yet wired into Datadog dashboards; treating as debug-only
        // keeps this canary honest until Datadog alignment is explicit.
        TelemetryEvents.BoundaryValidation,
        TelemetryEvents.CqeExtraction,
        TelemetryEvents.SessionReadDegraded,
        TelemetryEvents.V5SessionContinuityGap,
        TelemetryEvents.TurnExecutorStarted,
        TelemetryEvents.TurnExecutorCompleted,
        TelemetryEvents.TurnExecutorContaminationNarrate,
        TelemetryEvents.TurnExecutorFailureResponse,
        TelemetryEvents.TurnExecutorGraphLookup,
        TelemetryEvents.V5CoachingSignalFired,
        TelemetryEvents.V5DecisionReviewInvoked,
        TelemetryEvents.V5DecisionReviewSkipped,
        TelemetryEvents.V5DecisionReviewFailed,
        TelemetryEvents.V5DecisionReviewDegraded,
        TelemetryEvents.V5RecoveryChipServed,
        // V5 alpha hardening Phase 2.5: primary lifecycle events.
        // Debug-only until Datadog alignment is explicit.
        TelemetryEvents.ContextPackAssembled,
        TelemetryEvents.ValidatorOutcome,
        TelemetryEvents.RecoveryResponse,
        TelemetryEvents.HandlerInvocation,
        // V5 Coaching State Spine Stage 1: internal DecisionContext projection
        // derivation — counts/flags/provenance only, no Datadog mapping yet.
        TelemetryEvents.DecisionContextDerived,
        // V5 Coaching State Spine Stage 2A: internal current-turn coaching-signal
        // container derivation — counts/flags/closed-enum codes/hashes only, no Datadog yet.
        TelemetryEvents.V5CoachingStateDerived,
        TelemetryEvents.V5CoachingStatePersisted,
        // V5 Coaching State Spine Stage 2B-2: internal lifecycle derivation —
        // counts/closed-enum codes/hash-availability flags only, no Datadog yet.
        TelemetryEvents.V5CoachingStateLifecycleDerived,
        // V5 state-trust freshness derivation (debug-only until Datadog
        // alignment lands; structured logs are the source of truth).
        TelemetryEvents.AnalysisFreshnessDerived,
        TelemetryEvents.AnalysisFreshnessFactSelected,
        TelemetryEvents.AnalysisFreshnessFirstTurnAssumed,
        TelemetryEvents.AnalysisFreshnessGraphHashMissing,
        TelemetryEvents.AnalysisFreshnessInvariantFailed,
        // Answer-carrying explanation handlers (debug-only — no Datadog
        // mapping yet; observability is via structured logs).
        TelemetryEvents.V5ExplanationAnswerVerdict,
        TelemetryEvents.V5ExplanationEvidence,
        TelemetryEvents.V5UnexpectedExplanationPayload,
        TelemetryEvents.V5MutationLanguageGuard,
        TelemetryEvents.V5DeterministicValueUpdate,
        // PMS-tracked prompt resolution. Structured-log only; not yet wired
        // into Datadog (intentionally, until cardinality is bounded by the
        // five tracked-key allowlist in src/prompts/tracked.ts).
        TelemetryEvents.V5PromptResolved,
        // V5 Phase 2 (2026-05-01) additions — diagnostic-only:
        //  - PlotResponseInvalidNumeric: defence-in-depth ingress guard.
        //    Structured log + handler error are the operational signal.
        //  - ProbabilityOutOfRange: defence-in-depth display formatter
        //    guard. Workstream E rejects upstream; this fires only if a
        //    bypass is observed.
        //  - DraftNarrationCountMismatch: Sonnet drift signal on the
        //    draft_graph dispatcher. Operational signal is the structured
        //    log; the dispatcher continues with the deterministic fallback.
        //  - DraftNarrationCountSuppressed: brief brief-display-safe-analysis
        //    A2 — fires when narration counts MATCH but the count-shaped
        //    wording itself was scrubbed in favour of decision-language
        //    fallback. Distinct from CountMismatch so dashboards can
        //    track Sonnet's residual graph-shaped-narration rate without
        //    polluting the mismatch alert. Diagnostic-only.
        TelemetryEvents.PlotResponseInvalidNumeric,
        TelemetryEvents.ProbabilityOutOfRange,
        TelemetryEvents.DraftNarrationCountMismatch,
        TelemetryEvents.DraftNarrationCountSuppressed,
        // Workstream A — coaching wrapper events. Operational signal is
        // the `post_analysis_coaching` fact persisted to the ledger;
        // these telemetry events are diagnostic-only.
        TelemetryEvents.PostAnalysisDirectAnswerRecovered,
        TelemetryEvents.PostAnalysisDirectAnswerRecoverySkipped,
        // V5 edit-graph routing recovery (debug-only — diagnostic signal
        // for whether graphState was present, reloaded from canonical
        // state, or genuinely unavailable).
        TelemetryEvents.V5EditGraphGraphStatePresent,
        TelemetryEvents.V5EditGraphGraphStateReloaded,
        TelemetryEvents.V5EditGraphGraphStateUnavailable,
        // V5 Phase 1 brief persistence — diagnostic signal that the
        // user-supplied brief exceeded MAX_BRIEF_TEXT_LENGTH and was
        // truncated by normaliseBriefText. Operators can alert on a
        // non-zero rate; the operational signal is the persisted
        // brief_text, not this event.
        TelemetryEvents.V5BriefTextNormalised,
        // Track 2A response-prose sanitiser — diagnostic signal that
        // the response composer rewrote prose to satisfy the
        // numeric-prose contract.
        TelemetryEvents.V5ResponseProseSanitised,
        // V5 interaction recovery tranche (2026-05-06): pending-action
        // lifecycle telemetry. Operational signal is the persisted
        // pending_actions JSONB column on v5_conversation_turns; these
        // events are diagnostic-only until Datadog dashboards include
        // the resumer cohort.
        TelemetryEvents.PendingActionCreated,
        TelemetryEvents.PendingActionMatched,
        TelemetryEvents.PendingActionConsumed,
        TelemetryEvents.PendingActionSkipped,
        TelemetryEvents.PendingActionExpired,
        TelemetryEvents.PendingActionInvalidated,
        TelemetryEvents.PendingActionRecoveryExpired,
        TelemetryEvents.PendingActionRecoveryAmbiguous,
        TelemetryEvents.PendingActionRerunAnalysisRequired,
        TelemetryEvents.PendingActionsReadDegraded,
        // V5 interaction recovery tranche: add-risk preflight + clarify.
        TelemetryEvents.EditGraphPreflightSkippedLlm,
        TelemetryEvents.V5EditGraphAddRiskClarified,
        // PR #149 (cee-ws1-continuity-actions) — diagnostic-only events.
        TelemetryEvents.V5RecentChangesPreLlm,
        TelemetryEvents.V5StateQueryGuard,
        // V5 Context Management v1 — readiness + sibling guards + no-op recovery.
        TelemetryEvents.V5ContextReadiness,
        TelemetryEvents.V5StaleRerunGuard,
        TelemetryEvents.V5RunComparisonGate,
        TelemetryEvents.V5ProposedChangeEmitted,
        TelemetryEvents.V5NoAnalysisGuard,
        TelemetryEvents.V5EditGraphNoOpRecovery,
        TelemetryEvents.V5EditGraphTurn,
        // CI hygiene baseline (Tranche B) — pre-existing live emit() sites
        // registered to unblock telemetry validation. All diagnostic-only;
        // structured logs are the operational signal until Datadog mappings
        // are added in a follow-up.
        TelemetryEvents.EditGraphNoOperations,
        TelemetryEvents.StreamingGeneratorPreflightFailure,
        TelemetryEvents.DeterministicPmsFallbackUsed,
        TelemetryEvents.V4PmsFallbackUsed,
        TelemetryEvents.DeterministicBannedTermDetected,
        TelemetryEvents.OrchestratorDiagnosticsPreambleStripped,
        TelemetryEvents.OrchestratorXmlParseFallback,
        TelemetryEvents.CeeStage2EdgeCountInvariantViolated,
        TelemetryEvents.CeePostEnrichInvariantViolation,
        // Prompt-resolution policy observability — loud signal is the
        // error-level log; no Datadog counter mapping yet (follow-up).
        TelemetryEvents.V5PromptResolutionPolicy,
        // M3 freeze-gate cleanup (2026-06-05) — inherited live emit() sites,
        // all diagnostic-only (structured logs are the operational signal; no
        // Datadog metric in emit()). Registered to restore drift enforcement.
        TelemetryEvents.CeeAutoBaselineDedupApplied,
        TelemetryEvents.CeeAutoBaselineHeuristicOnlyCollision,
        TelemetryEvents.CeeOptionsIdenticalBypass,
        TelemetryEvents.CeeUnifiedPipelineStageTimings,
        TelemetryEvents.V5DecisionReviewCompleted,
        TelemetryEvents.V5EditGraphAnalyticalQuestionSuppressed,
        // V5 Signature Loop — route-level suppressors + refresh-continuation
        // guard. Diagnostic-only (structured logs / suppressed-dispatch are the
        // operational signal; no Datadog metric mapping in emit()).
        TelemetryEvents.V5EditGraphProposalConfirmResolved,
        TelemetryEvents.V5EditGraphStateQuerySuppressed,
        TelemetryEvents.V5ContinuationGuardApplied,
        TelemetryEvents.V5EditGraphAppliedGraphMissingWithOperations,
        TelemetryEvents.V5EditGraphAppliedGraphSynthesizedLocally,
        TelemetryEvents.V5EditGraphFalseSuccessRewritten,
        TelemetryEvents.V5InterceptedChipClarify,
        TelemetryEvents.V5InterceptedVagueEdit,
        TelemetryEvents.V5EgressForbiddenPhraseDetected,
        TelemetryEvents.V5FrameStageNoBriefGuard,
        TelemetryEvents.V5FreshAnalysisFollowupGuard,
        TelemetryEvents.V5Phase3BlockLifecycle,
        TelemetryEvents.V5PostAnalysisAdviceGate,
        TelemetryEvents.V5PostAnalysisLabelIntercept,
        TelemetryEvents.V5PostDraftCoachingSourceSelected,
        TelemetryEvents.V5ProposalContinuationCaptured,
        TelemetryEvents.V5ProposalContinuationInvalidated,
        TelemetryEvents.V5ProposalContinuationResumed,
        TelemetryEvents.V5RoutingBoundedFallback,
        TelemetryEvents.V5RunAnalysisTimings,
        TelemetryEvents.V5TurnStageTimings,
        // M3 freeze-gate cleanup (2026-06-05) — pre-existing link-safe response
        // floor events: already in the frozen list but never datadog-classified.
        // Diagnostic-only (no Datadog metric in emit()); classify here to close
        // the gap. Live emit sites: chip-generator.ts, run-analysis.ts.
        TelemetryEvents.V5HeadlineFellBack,
        TelemetryEvents.V5ChipsEmptyIntentional,
        TelemetryEvents.V5ChipsFloorApplied,
        // V5 Lane 2 — egress chip-quality finalizer aggregate (diagnostic-only).
        TelemetryEvents.V5ChipsFinalized,
      ];

      for (const event of allEvents) {
        if (!debugOnlyEvents.includes(event)) {
          expect(documentedEvents).toContain(event);
        }
      }
    });
  });

  describe("Spec compliance", () => {
    it("matches frozen event names from specification (v04 + v1.8 + CEE v1)", () => {
      // These event names are specified in the v04 specification and v1.8 release
      // and must not change without updating the spec document
      const frozenEvents = [
        // v04 spec events
        "assist.draft.started",
        "assist.draft.completed",
        "assist.draft.upstream_success",
        "assist.draft.upstream_error",
        "assist.draft.sse_started",
        "assist.draft.sse_completed",
        "assist.draft.sse_error",
        "assist.draft.fixture_shown",
        "assist.draft.fixture_replaced",
        "assist.draft.legacy_sse_path",
        "assist.draft.validation_failed",
        "assist.draft.repair_attempted",
        "assist.draft.repair_start",
        "assist.draft.repair_success",
        "assist.draft.repair_partial",
        "assist.draft.repair_fallback",
        "assist.draft.guard_violation",
        "assist.draft.legacy_provenance",
        "assist.draft.stage",
        "assist.clarifier.round_start",
        "assist.clarifier.round_complete",
        "assist.clarifier.round_failed",
        "assist.critique.start",
        "assist.critique.complete",
        "assist.critique.failed",
        "assist.suggest_options.start",
        "assist.suggest_options.complete",
        "assist.suggest_options.failed",
        "assist.explain_diff.start",
        "assist.explain_diff.complete",
        "assist.explain_diff.failed",
        "assist.auth.success",
        "assist.auth.failed",
        "assist.auth.rate_limited",
        "assist.draft.sse_client_closed",
        "assist.llm.retry",
        "assist.llm.retry_success",
        "assist.llm.retry_exhausted",
        "assist.llm.provider_failover",
        "assist.llm.provider_failover_success",
        "assist.llm.provider_failover_exhausted",
        "assist.share.created",
        "assist.share.accessed",
        "assist.share.revoked",
        "assist.share.expired",
        "assist.share.not_found",
        "assist.llm.prompt_cache_hit",
        "assist.llm.prompt_cache_miss",
        "assist.llm.prompt_cache_eviction",
        // v1.8 SSE Resume events
        "assist.sse.resume_issued",
        "assist.sse.resume_attempt",
        "assist.sse.resume_success",
        "assist.sse.resume_expired",
        "assist.sse.resume_incompatible",
        "assist.sse.resume_replay_count",
        "assist.sse.partial_recovery",
        "assist.sse.buffer_trimmed",
        "assist.sse.snapshot_created",
        // v1.9 SSE Live Resume events
        "assist.sse.resume_live_start",
        "assist.sse.resume_live_continue",
        "assist.sse.resume_live_end",
        "assist.sse.snapshot_renewed",

        // v1.11 SSE degraded mode events
        "assist.sse.degraded_mode",

        // ISL config events (v1.13.0)
        "isl.config.invalid_timeout",
        "isl.config.invalid_max_retries",
        "isl.config.timeout_clamped",
        "isl.config.retries_clamped",

        // CEE v1 Draft My Model events
        "cee.draft_graph.requested",
        "cee.draft_graph.succeeded",
        "cee.draft_graph.failed",

        // v0.11.0 schema amendment — observable transition signals
        "cee.draft_graph.legacy_coaching_value_normalised",
        "cee.draft_graph.contract_default_applied",

        // Connectivity validation (P0 diagnostics)
        "cee.draft_graph.connectivity_check",

        // Uniform strength detection (LLM output quality)
        "cee.draft_graph.uniform_strengths_detected",

        // Goal inference (defence-in-depth for missing goal nodes)
        "cee.draft_graph.goal_inferred",

        // Deterministic graph enforcement (Stage 4 substep 9b)
        "cee.draft_graph.inbound_sum_rescaled",
        "cee.draft_graph.bridge_chain_repaired",
        "cee.draft_graph.enforcement_completed",
        "cee.draft_graph.enforcement_edge_skipped",
        "cee.draft_graph.enforcement_post_validation_errors",
        "cee.draft_graph.enforcement_post_validation_warnings",
        "cee.draft_graph.enforcement_post_validation_failed",
        "cee.draft_graph.enforcement_blocked",

        // CEE v1 Explain Graph events
        "cee.explain_graph.requested",
        "cee.explain_graph.succeeded",
        "cee.explain_graph.failed",

        // CEE v1 Evidence Helper events
        "cee.evidence_helper.requested",
        "cee.evidence_helper.succeeded",
        "cee.evidence_helper.failed",

        // CEE v1 Bias Checker events
        "cee.bias_check.requested",
        "cee.bias_check.succeeded",
        "cee.bias_check.failed",

        // CEE v1 BriefSignals events
        "cee.brief_signals",

        // CEE v1 Options events
        "cee.options.requested",
        "cee.options.succeeded",
        "cee.options.failed",

        // CEE v1 Sensitivity Coach events
        "cee.sensitivity_coach.requested",
        "cee.sensitivity_coach.succeeded",
        "cee.sensitivity_coach.failed",

        // CEE v1 Team Perspectives events
        "cee.team_perspectives.requested",
        "cee.team_perspectives.succeeded",
        "cee.team_perspectives.failed",

        // CEE Preflight events (Phase 2 input validation)
        "cee.preflight.passed",
        "cee.preflight.failed",
        "cee.preflight.readiness_assessed",
        "cee.preflight.rejected",
        "cee.preflight.completed",

        // LLM Normalization events (Phase 1 NodeKind normalization)
        "llm.normalization.node_kind_mapped",

        // LLM Repair events (large graph handling)
        "llm.repair_prompt.truncated",

        // CEE Clarification enforcement events (Phase 5)
        "cee.clarification.required",
        "cee.clarification.bypass_allowed",

        // Multi-turn clarifier integration events (v1.15)
        "cee.clarifier.session_start",
        "cee.clarifier.question_asked",
        "cee.clarifier.answer_received",
        "cee.clarifier.answer_incorporated",
        "cee.clarifier.converged",
        "cee.clarifier.question_cached",
        "cee.clarifier.question_retrieved",
        "cee.clarifier.failed",
        "cee.clarifier.skipped",

        // CEE verification events (v1.14)
        "cee.verification.succeeded",
        "cee.verification.failed",

        // Validation cache events
        "assist.draft.validation_cache_hit",
        "assist.draft.validation_cache_miss",
        "assist.draft.validation_cache_bypass",

        // Anthropic prompt cache hint event
        "assist.llm.anthropic_prompt_cache_hint",

        // Cost calculation guardrails
        "assist.cost_calculation.unknown_model",

        // Prompt Management events (v2.0)
        "prompt.store_error",
        "prompt.loader.error",
        "prompt.loader.store",
        "prompt.loader.default",
        "prompt.compiled",
        "prompt.hash_mismatch",
        "admin.prompt.access",
        "admin.experiment.access",
        "admin.auth.failed",
        "admin.ip.blocked",

        // Prompt Experiment events (v2.0)
        "prompt.experiment.assigned",
        "prompt.staging.used",

        // Prompt Activation Guard events (v2.2)
        "prompt.activation.blocked",
        "prompt.staging.activated",

        // Decision Review events (v2.0)
        "cee.decision_review.generated",
        "cee.decision_review.isl_fallback",
        "cee.decision_review.requested",
        "cee.decision_review.succeeded",
        "cee.decision_review.failed",

        // Decision Review M2 events
        "cee.decision_review.prompt_loaded",
        "cee.decision_review.llm_call_started",
        "cee.decision_review.llm_call_completed",
        "cee.decision_review.json_extracted",
        "cee.decision_review.shape_check_failed",
        "cee.decision_review.shape_check_warnings",

        // Bias Mitigation events (v2.0)
        "cee.bias_check.patches_generated",
        "cee.bias_check.patches_applied",

        // Prompt Store Cache events (v2.0 Phase 4.3)
        "prompt.store.cache.hit",
        "prompt.store.cache.miss",
        "prompt.store.cache.invalidated",
        "prompt.store.cache.warmed",
        "prompt.store.background_refresh",

        // Prompt Test Sandbox events (v2.1)
        "prompt.test.executed",
        "prompt.test.validation_passed",
        "prompt.test.validation_failed",

        // Prompt Version Lifecycle events (v2.1)
        "prompt.version.promoted",
        "prompt.version.demoted",
        "prompt.rollback.executed",
        "prompt.rollback.failed",

        // Prompt Approval Gate events (v2.1)
        "prompt.approval.required",
        "prompt.approval.granted",
        "prompt.approval.rejected",

        // Graph Validation events (v2.2)
        "cee.graph.validation",
        "cee.graph.goals_merged",
        "cee.graph.size_exceeded",

        // Graph Readiness events (v2.3)
        "cee.graph_readiness.requested",
        "cee.graph_readiness.completed",
        "cee.graph_readiness.failed",

        // Key Insight events (v2.4)
        "cee.key_insight.requested",
        "cee.key_insight.succeeded",
        "cee.key_insight.failed",

        // Elicit Belief events (v2.5)
        "cee.elicit_belief.requested",
        "cee.elicit_belief.succeeded",
        "cee.elicit_belief.failed",

        // Utility Weight events (v2.5)
        "cee.utility_weight.requested",
        "cee.utility_weight.succeeded",
        "cee.utility_weight.failed",

        // Risk Tolerance events (v2.5)
        "cee.risk_tolerance.requested",
        "cee.risk_tolerance.succeeded",
        "cee.risk_tolerance.failed",

        // Edge Function Suggestion events (v2.6)
        "cee.edge_function.requested",
        "cee.edge_function.completed",
        "cee.edge_function.failed",

        // Edge Direction Validation events (Brief G)
        "cee.edge_direction.violation_detected",
        "cee.edge_direction.validation_passed",

        // Phase 4: Recommendation Narratives events
        "cee.generate_recommendation.requested",
        "cee.generate_recommendation.completed",
        "cee.generate_recommendation.failed",

        // Goal generation tracking (prompt tuning)
        "cee.goal_generation",

        "cee.narrate_conditions.requested",
        "cee.narrate_conditions.completed",
        "cee.narrate_conditions.failed",

        "cee.explain_policy.requested",
        "cee.explain_policy.completed",
        "cee.explain_policy.failed",

        // Phase 5: Preference Elicitation events
        "cee.elicit_preferences.requested",
        "cee.elicit_preferences.succeeded",
        "cee.elicit_preferences.failed",
        "cee.elicit_preferences_answer.requested",
        "cee.elicit_preferences_answer.succeeded",
        "cee.elicit_preferences_answer.failed",
        "cee.explain_tradeoff.requested",
        "cee.explain_tradeoff.succeeded",
        "cee.explain_tradeoff.failed",

        // Factor Extraction events (v2.3)
        "cee.factor_extraction.complete",
        "cee.factor.baseline_defaulted",

        // Schema v2 Transform events (v2.3)
        "cee.schema_v2.transform_complete",

        // Schema v3 Transform events (v3.0)
        "cee.schema_v3.transform_complete",
        "cee.intervention_extraction",

        // Edge coefficient clamping events (P1-CEE-2)
        "cee.edge.strength_clamped",
        "cee.edge.strength_negligible",
        "cee.edge.strength_low",

        // Analysis-Ready Output events (P0)
        "cee.analysis_ready.built",
        "cee.analysis_ready.validation_failed",

        // ISL Synthesis events (v2.3)
        "cee.isl_synthesis.requested",
        "cee.isl_synthesis.succeeded",
        "cee.isl_synthesis.failed",

        // CEE Ask events (Working Set API)
        "cee.ask.requested",
        "cee.ask.completed",
        "cee.ask.failed",

        // CEE Review events (M1 Orchestrator)
        "cee.review.requested",
        "cee.review.succeeded",
        "cee.review.failed",

        // Boundary logging events (Observability v1)
        "boundary.request",
        "boundary.response",
        "cee.boundary.blocked",

        // Config security events (Stream F)
        "cee.config.raw_io_overridden",

        // Performance timing events (Observability v2)
        "llm.call",
        "downstream.call",

        // JSON extraction events (LLM response parsing)
        "llm.json_extraction.required",

        // Options interventions defaulting (CEE)
        "cee.option.interventions_missing_defaulted",

        // Orchestrator events (Track C)
        "orchestrator.turn.started",
        "orchestrator.turn.completed",
        "orchestrator.turn.failed",
        "orchestrator.intent.resolved",
        "orchestrator.tool.invoked",
        "orchestrator.tool.completed",
        "orchestrator.tool.failed",
        "orchestrator.plot.run_requested",
        "orchestrator.plot.run_completed",
        "orchestrator.plot.run_failed",
        "orchestrator.plot.validate_requested",
        "orchestrator.plot.validate_completed",
        "orchestrator.idempotency.hit",
        "orchestrator.idempotency.cached",
        "orchestrator.commentary.numeric_freehand_stripped",
        "orchestrator.system_event",
        "orchestrator.turn.mode_disagreement",
        "orchestrator.turn.tool_suppressed",
        "orchestrator.turn.contract_violation",

        // v5-maintenance (2026-04-21): V5 additions frozen below.
        "boundary.validation",
        "cqe.extraction",
        "session.read_degraded",
        "v5.session.continuity_gap",
        "turn_executor.completed",
        "turn_executor.contamination_narrate",
        "turn_executor.failure_response",
        "turn_executor.graph_lookup",
        "turn_executor.started",
        "v5.brief_text.normalised",
        "v5.decision_context.derived",
        "v5.coaching_state.derived",
        "v5.coaching_state.persisted",
        "v5.coaching_state.lifecycle_derived",
        "v5.coaching.signal_fired",
        "v5.decision_review.failed",
        "v5.decision_review.invoked",
        "v5.decision_review.skipped",
        "v5.decision_review_degraded",
        "v5.deterministic_value_update",
        "v5.edit_graph.graph_state_present",
        "v5.edit_graph.graph_state_reloaded",
        "v5.edit_graph.graph_state_unavailable",
        // V5 alpha hardening Phase 2.5: primary lifecycle events.
        "v5.analysis_freshness.derived",
        "v5.analysis_freshness.fact_selected",
        "v5.analysis_freshness.first_turn_assumed",
        "v5.analysis_freshness.graph_hash_missing",
        "v5.analysis_freshness.invariant_failed",
        "v5.context_pack.assembled",
        // V5 Phase 2 additions (2026-05-01).
        "v5.draft_narration.count_mismatch",
        // brief brief-display-safe-analysis A2 (2026-05-02).
        "v5.draft_narration.count_suppressed",
        "v5.explanation.answer_verdict",
        "v5.explanation.evidence",
        "v5.handler_invocation",
        "v5.mutation_language_guard",
        "v5.plot_response.invalid_numeric",
        "v5.post_analysis.direct_answer_recovered",
        "v5.post_analysis.direct_answer_recovery_skipped",
        "v5.probability_out_of_range",
        "v5.prompt_cache",
        "v5.prompt_resolved",
        "v5.prompt_resolution_policy",
        "v5.recovery_chip_served",
        "v5.recovery_response",
        "v5.response.prose_sanitised",
        "v5.unexpected_explanation_payload",
        "v5.validator_outcome",
        // V5 interaction recovery tranche — pending-action lifecycle
        "v5.pending_action.created",
        "v5.pending_action.matched",
        "v5.pending_action.consumed",
        "v5.pending_action.expired",
        "v5.pending_action.invalidated",
        "v5.pending_action.skipped",
        "v5.pending_action.recovery_expired",
        "v5.pending_action.recovery_ambiguous",
        "v5.pending_action.rerun_analysis_required",
        "v5.pending_actions.read_degraded",
        // V5 interaction recovery tranche — add-risk preflight + clarification
        "v5.edit_graph.preflight_skipped_llm",
        "v5.edit_graph.add_risk_clarified",
        // PR #149 (cee-ws1-continuity-actions) — state-query guard + recent_changes pre-LLM
        "v5.recent_changes.pre_llm",
        "v5.state_query_guard",
        // V5 Context Management v1
        "v5.context_readiness",
        "v5.stale_rerun_guard",
        "v5.run_comparison_gate",
        "v5.proposed_change.emitted",
        "v5.no_analysis_guard",
        "v5.edit_graph.no_op_recovery",
        "v5.edit_graph.turn",
        // V5 link-safe response floor — headline Case-E + chip floor
        "v5.headline.fell_back",
        "v5.chips.empty_intentional",
        "v5.chips.floor_applied",
        "v5.chips.finalized",
        // CI hygiene baseline (Tranche B) — register inherited live emit() sites
        "edit_graph.no_operations",
        "streaming.generator_preflight_failure",
        "deterministic.pms_fallback_used",
        "v4.pms_fallback_used",
        "deterministic.banned_term_detected",
        "orchestrator.diagnostics_preamble_stripped",
        "orchestrator.xml_parse_fallback",
        "cee.stage2.edge_count_invariant_violated",
        "cee.post_enrich.invariant_violation",
        // M3 freeze-gate cleanup (2026-06-05) — register inherited live emit()
        // sites so this frozen list is the hard drift gate again. Test-only;
        // no emit-site or runtime changes. Preserves #232's prompt_resolution_policy.
        "cee.auto_baseline_dedup.applied",
        "cee.auto_baseline_dedup.heuristic_only_collision",
        "cee.options_identical.pre_repair_bypass",
        "cee.unified_pipeline.stage_timings",
        "v5.continuation.guard_applied",
        "v5.decision_review.completed",
        "v5.edit_graph.analytical_question_suppressed",
        "v5.edit_graph.applied_graph_missing_with_operations",
        "v5.edit_graph.proposal_confirm_resolved",
        "v5.edit_graph.state_query_suppressed",
        "v5.edit_graph.applied_graph_synthesized_locally",
        "v5.edit_graph.false_success_rewritten",
        "v5.edit_graph.intercepted_chip_clarify",
        "v5.edit_graph.intercepted_vague_edit",
        "v5.egress.forbidden_phrase_detected",
        "v5.frame_stage_no_brief_guard",
        "v5.fresh_analysis_followup_guard",
        "v5.phase3.block_lifecycle",
        "v5.post_analysis_advice_gate",
        "v5.post_analysis_label_intercept",
        "v5.post_draft_coaching.source_selected",
        "v5.proposal_continuation.captured",
        "v5.proposal_continuation.invalidated",
        "v5.proposal_continuation.resumed",
        "v5.routing_bounded_fallback",
        "v5.run_analysis.timings",
        "v5.turn_executor.stage_timings",
      ];

      const actualEvents = Object.values(TelemetryEvents).sort();
      expect(actualEvents).toEqual(frozenEvents.sort());
    });
  });
});
