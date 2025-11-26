import { env } from "node:process";
import pino from "pino";
import { StatsD } from "hot-shots";

export const log = pino({ level: env.LOG_LEVEL || "info" });

/**
 * Test sink for capturing telemetry events in tests (v1.11.0)
 * Only used when NODE_ENV=test or VITEST=true
 */
let testSink: ((eventName: string, data: Record<string, any>) => void) | null = null;

export function setTestSink(sink: ((eventName: string, data: Record<string, any>) => void) | null): void {
  // Safety check: only allow in test environment
  if (process.env.NODE_ENV !== 'test' && process.env.VITEST !== 'true') {
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

  CeeExplainGraphRequested: "cee.explain_graph.requested",
  CeeExplainGraphSucceeded: "cee.explain_graph.succeeded",
  CeeExplainGraphFailed: "cee.explain_graph.failed",

  CeeEvidenceHelperRequested: "cee.evidence_helper.requested",
  CeeEvidenceHelperSucceeded: "cee.evidence_helper.succeeded",
  CeeEvidenceHelperFailed: "cee.evidence_helper.failed",

  CeeBiasCheckRequested: "cee.bias_check.requested",
  CeeBiasCheckSucceeded: "cee.bias_check.succeeded",
  CeeBiasCheckFailed: "cee.bias_check.failed",

  CeeOptionsRequested: "cee.options.requested",
  CeeOptionsSucceeded: "cee.options.succeeded",
  CeeOptionsFailed: "cee.options.failed",

  CeeSensitivityCoachRequested: "cee.sensitivity_coach.requested",
  CeeSensitivityCoachSucceeded: "cee.sensitivity_coach.succeeded",
  CeeSensitivityCoachFailed: "cee.sensitivity_coach.failed",

  CeeTeamPerspectivesRequested: "cee.team_perspectives.requested",
  CeeTeamPerspectivesSucceeded: "cee.team_perspectives.succeeded",
  CeeTeamPerspectivesFailed: "cee.team_perspectives.failed",

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
  NodeKindNormalized: "llm.normalization.node_kind_mapped",

  // Clarification enforcement events (v1.14 - Phase 5)
  ClarificationRequired: "cee.clarification.required",
  ClarificationBypassAllowed: "cee.clarification.bypass_allowed",

  // Clarifier events (v04)
  ClarifierRoundStart: "assist.clarifier.round_start",
  ClarifierRoundComplete: "assist.clarifier.round_complete",
  ClarifierRoundFailed: "assist.clarifier.round_failed",

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

  // Prompt Experiment events (v2.0)
  PromptExperimentAssigned: "prompt.experiment.assigned",
  PromptStagingUsed: "prompt.staging.used",

  // Decision Review events (v2.0)
  DecisionReviewGenerated: "cee.decision_review.generated",
  DecisionReviewIslFallback: "cee.decision_review.isl_fallback",
  DecisionReviewRequested: "cee.decision_review.requested",
  DecisionReviewSucceeded: "cee.decision_review.succeeded",
  DecisionReviewFailed: "cee.decision_review.failed",
} as const;

/**
 * All valid event names (for CI validation)
 */
export const VALID_EVENT_NAMES: Set<string> = new Set(Object.values(TelemetryEvents));

/**
 * Datadog StatsD client (optional, configured via DD_AGENT_HOST)
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
 * Anthropic pricing (as of 2025-01, Claude 3.5 Sonnet)
 * Update these if pricing changes or using different models
 */
const ANTHROPIC_PRICING = {
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

const OPENAI_PRICING = {
  "gpt-4o": {
    input_per_1k: 0.0025,  // $2.50 per million input tokens
    output_per_1k: 0.01,   // $10 per million output tokens
  },
  "gpt-4o-mini": {
    input_per_1k: 0.00015, // $0.15 per million input tokens
    output_per_1k: 0.0006, // $0.60 per million output tokens
  },
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
