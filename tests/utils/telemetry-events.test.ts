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
        // CEE v1 Draft My Model events (v1.12.0)
        CeeDraftGraphRequested: "cee.draft_graph.requested",
        CeeDraftGraphSucceeded: "cee.draft_graph.succeeded",
        CeeDraftGraphFailed: "cee.draft_graph.failed",

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
      const validPrefixes =
        /^(assist\.(draft|clarifier|critique|suggest_options|explain_diff|auth|llm|share|sse)\.|cee\.(draft_graph|explain_graph|evidence_helper|bias_check|options|sensitivity_coach|team_perspectives)\.)/;

      for (const event of allEvents) {
        expect(event).toMatch(validPrefixes);
      }
    });

    it("uses snake_case for event suffixes (not camelCase)", () => {
      const allEvents = Object.values(TelemetryEvents);

      // Check that no events use camelCase after the prefix
      for (const event of allEvents) {
        // Remove the namespace prefix (assist.* or cee.*)
        const suffix = event
          .replace(/^assist\.(draft|clarifier|critique|suggest_options|explain_diff|auth|llm|share|sse)\./, "")
          .replace(/^cee\.(draft_graph|explain_graph|evidence_helper|bias_check|options|sensitivity_coach|team_perspectives)\./, "");

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
        "cee.explain_graph.requested": [TelemetryEvents.CeeExplainGraphRequested],
        "cee.explain_graph.succeeded": [TelemetryEvents.CeeExplainGraphSucceeded],
        "cee.explain_graph.failed": [TelemetryEvents.CeeExplainGraphFailed],
        "cee.evidence_helper.requested": [TelemetryEvents.CeeEvidenceHelperRequested],
        "cee.evidence_helper.succeeded": [TelemetryEvents.CeeEvidenceHelperSucceeded],
        "cee.evidence_helper.failed": [TelemetryEvents.CeeEvidenceHelperFailed],
        "cee.bias_check.requested": [TelemetryEvents.CeeBiasCheckRequested],
        "cee.bias_check.succeeded": [TelemetryEvents.CeeBiasCheckSucceeded],
        "cee.bias_check.failed": [TelemetryEvents.CeeBiasCheckFailed],
        "cee.options.requested": [TelemetryEvents.CeeOptionsRequested],
        "cee.options.succeeded": [TelemetryEvents.CeeOptionsSucceeded],
        "cee.options.failed": [TelemetryEvents.CeeOptionsFailed],
        "cee.sensitivity_coach.requested": [TelemetryEvents.CeeSensitivityCoachRequested],
        "cee.sensitivity_coach.succeeded": [TelemetryEvents.CeeSensitivityCoachSucceeded],
        "cee.sensitivity_coach.failed": [TelemetryEvents.CeeSensitivityCoachFailed],
        "cee.team_perspectives.requested": [TelemetryEvents.CeeTeamPerspectivesRequested],
        "cee.team_perspectives.succeeded": [TelemetryEvents.CeeTeamPerspectivesSucceeded],
        "cee.team_perspectives.failed": [TelemetryEvents.CeeTeamPerspectivesFailed],
      };

      // Verify all events are documented, except debug-only events
      const allEvents = Object.values(TelemetryEvents);
      const documentedEvents = new Set(
        Object.values(datadogMetrics).flat()
      );

      // Stage events are debug-only and intentionally have no Datadog mappings
      const debugOnlyEvents: string[] = [
        TelemetryEvents.Stage,
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

        // CEE v1 Draft My Model events
        "cee.draft_graph.requested",
        "cee.draft_graph.succeeded",
        "cee.draft_graph.failed",

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

        // Validation cache events
        "assist.draft.validation_cache_hit",
        "assist.draft.validation_cache_miss",
        "assist.draft.validation_cache_bypass",

        // Anthropic prompt cache hint event
        "assist.llm.anthropic_prompt_cache_hint",
      ];

      const actualEvents = Object.values(TelemetryEvents).sort();
      expect(actualEvents).toEqual(frozenEvents.sort());
    });
  });
});
