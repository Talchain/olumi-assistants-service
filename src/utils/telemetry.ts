import { env } from "node:process";
import pino from "pino";
import { StatsD } from "hot-shots";

export const log = pino({ level: env.LOG_LEVEL || "info" });

/**
 * Frozen telemetry event names (v04 spec)
 * DO NOT modify these names without updating CI guards and dashboards
 */
export const TelemetryEvents = {
  // Core lifecycle events
  DraftStarted: "assist.draft.started",
  DraftCompleted: "assist.draft.completed",

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

  // SSE client events (v1.2.1)
  SseClientClosed: "assist.draft.sse_client_closed",

  // Archetype detection (v1.4.0)
  ArchetypeDetected: "assist.draft.archetype_detected",

  // Internal stage events (for debugging)
  Stage: "assist.draft.stage",
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

export type Event = Record<string, unknown>;

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
  if (model !== 'fixture-v1') {
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
  // Always log to pino
  log.info({ event, ...data });

  // Send metrics to Datadog if configured
  if (datadogClient) {
    try {
      // Map events to Datadog metrics
      switch (event) {
        case TelemetryEvents.DraftCompleted: {
          // Latency histogram
          if (typeof data.latency_ms === "number") {
            datadogClient.histogram("draft.latency_ms", data.latency_ms, {
              draft_source: String(data.draft_source || "unknown"),
              quality_tier: String(data.quality_tier || "unknown"),
              fallback_reason: String(data.fallback_reason || "none"),
            });
          }

          // Graph size metrics
          if (typeof data.graph_nodes === "number") {
            datadogClient.gauge("draft.graph.nodes", data.graph_nodes);
          }
          if (typeof data.graph_edges === "number") {
            datadogClient.gauge("draft.graph.edges", data.graph_edges);
          }

          // Confidence distribution
          if (typeof data.confidence === "number") {
            datadogClient.histogram("draft.confidence", data.confidence, {
              quality_tier: String(data.quality_tier || "unknown"),
            });
          }

          // Cost tracking (per request)
          if (typeof data.cost_usd === "number") {
            datadogClient.histogram("draft.cost_usd", data.cost_usd, {
              draft_source: String(data.draft_source || "unknown"),
            });
          }

          // Cache hit rate
          if (typeof data.prompt_cache_hit === "boolean") {
            datadogClient.increment("draft.prompt_cache", 1, {
              hit: String(data.prompt_cache_hit),
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
          if (typeof data.stream_duration_ms === "number") {
            datadogClient.histogram("draft.sse.stream_duration_ms", data.stream_duration_ms);
          }
          if (typeof data.fixture_shown === "boolean") {
            datadogClient.increment("draft.sse.completed", 1, {
              fixture_shown: String(data.fixture_shown),
            });
          } else {
            datadogClient.increment("draft.sse.completed", 1);
          }
          break;
        }

        case TelemetryEvents.SSEError: {
          datadogClient.increment("draft.sse.errors", 1, {
            error_code: String(data.error_code || "unknown"),
          });
          break;
        }

        case TelemetryEvents.ValidationFailed: {
          datadogClient.increment("draft.validation.failed", 1);
          if (typeof data.violation_count === "number") {
            datadogClient.gauge("draft.validation.violations", data.violation_count);
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
            reason: String(data.reason || "unknown"),
          });
          break;
        }

        case TelemetryEvents.LegacyProvenance: {
          datadogClient.increment("draft.legacy_provenance.occurrences", 1);
          if (typeof data.legacy_percentage === "number") {
            datadogClient.gauge("draft.legacy_provenance.percentage", data.legacy_percentage);
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
            endpoint: String(data.endpoint || "unknown"),
          });
          break;
        }

        case TelemetryEvents.ClarifierRoundComplete: {
          // Track clarifier usage
          datadogClient.increment("clarifier.round.completed", 1, {
            round: String(data.round ?? "unknown"),
            provider: String(data.provider || "unknown"),
          });

          // Latency histogram
          if (typeof data.duration_ms === "number") {
            datadogClient.histogram("clarifier.duration_ms", data.duration_ms, {
              round: String(data.round ?? "unknown"),
            });
          }

          // Cost tracking
          if (typeof data.cost_usd === "number") {
            datadogClient.histogram("clarifier.cost_usd", data.cost_usd, {
              provider: String(data.provider || "unknown"),
            });
          }

          // Confidence tracking
          if (typeof data.confidence === "number") {
            datadogClient.histogram("clarifier.confidence", data.confidence);
          }
          break;
        }

        case TelemetryEvents.ClarifierRoundFailed: {
          datadogClient.increment("clarifier.round.failed", 1, {
            round: String(data.round ?? "unknown"),
          });
          break;
        }

        case TelemetryEvents.CritiqueComplete: {
          // Track critique usage
          datadogClient.increment("critique.completed", 1, {
            provider: String(data.provider || "unknown"),
            overall_quality: String(data.overall_quality || "unknown"),
          });

          // Latency histogram
          if (typeof data.duration_ms === "number") {
            datadogClient.histogram("critique.duration_ms", data.duration_ms);
          }

          // Cost tracking
          if (typeof data.cost_usd === "number") {
            datadogClient.histogram("critique.cost_usd", data.cost_usd, {
              provider: String(data.provider || "unknown"),
            });
          }

          // Issue counts by severity
          if (typeof data.blocker_count === "number") {
            datadogClient.gauge("critique.issues.blockers", data.blocker_count);
          }
          if (typeof data.improvement_count === "number") {
            datadogClient.gauge("critique.issues.improvements", data.improvement_count);
          }
          if (typeof data.observation_count === "number") {
            datadogClient.gauge("critique.issues.observations", data.observation_count);
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
          if (typeof data.duration_ms === "number") {
            datadogClient.histogram("suggest_options.duration_ms", data.duration_ms);
          }

          // Cost tracking
          if (typeof data.cost_usd === "number") {
            datadogClient.histogram("suggest_options.cost_usd", data.cost_usd, {
              provider: String(data.provider || "unknown"),
            });
          }

          // Option count distribution
          if (typeof data.option_count === "number") {
            datadogClient.gauge("suggest_options.option_count", data.option_count);
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
          if (typeof data.duration_ms === "number") {
            datadogClient.histogram("explain_diff.duration_ms", data.duration_ms);
          }

          // Cost tracking
          if (typeof data.cost_usd === "number") {
            datadogClient.histogram("explain_diff.cost_usd", data.cost_usd, {
              provider: String(data.provider || "unknown"),
            });
          }

          // Rationale count distribution
          if (typeof data.rationale_count === "number") {
            datadogClient.gauge("explain_diff.rationale_count", data.rationale_count);
          }
          break;
        }

        case TelemetryEvents.ExplainDiffFailed: {
          datadogClient.increment("explain_diff.failed", 1);
          break;
        }

        case TelemetryEvents.LlmRetry: {
          datadogClient.increment("llm.retry", 1, {
            adapter: String(data.adapter || "unknown"),
            operation: String(data.operation || "unknown"),
            attempt: String(data.attempt || "unknown"),
          });
          if (typeof data.delay_ms === "number") {
            datadogClient.histogram("llm.retry.delay_ms", data.delay_ms);
          }
          break;
        }

        case TelemetryEvents.LlmRetrySuccess: {
          datadogClient.increment("llm.retry.success", 1, {
            adapter: String(data.adapter || "unknown"),
            operation: String(data.operation || "unknown"),
            total_attempts: String(data.total_attempts || "unknown"),
          });
          break;
        }

        case TelemetryEvents.LlmRetryExhausted: {
          datadogClient.increment("llm.retry.exhausted", 1, {
            adapter: String(data.adapter || "unknown"),
            operation: String(data.operation || "unknown"),
          });
          break;
        }

        case TelemetryEvents.SseClientClosed: {
          datadogClient.increment("draft.sse.client_closed", 1);
          break;
        }

        case TelemetryEvents.ArchetypeDetected: {
          datadogClient.increment("draft.archetype.detected", 1, {
            archetype: String(data.archetype || "unknown"),
          });
          break;
        }

        case TelemetryEvents.GuardViolation: {
          datadogClient.increment("draft.guard_violation", 1, {
            violation_type: String(data.violation_type || "unknown"),
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
