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

  // SSE streaming events
  SSECompleted: "assist.draft.sse_completed",
  SSEError: "assist.draft.sse_error",
  FixtureShown: "assist.draft.fixture_shown",
  FixtureReplaced: "assist.draft.fixture_replaced",

  // Validation and repair events
  ValidationFailed: "assist.draft.validation_failed",
  RepairAttempted: "assist.draft.repair_attempted",
  RepairStart: "assist.draft.repair_start",
  RepairSuccess: "assist.draft.repair_success",
  RepairPartial: "assist.draft.repair_partial",
  RepairFallback: "assist.draft.repair_fallback",

  // Deprecation tracking
  LegacyProvenance: "assist.draft.legacy_provenance",

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
  // Add other models if used
} as const;

/**
 * Calculate estimated cost for an Anthropic API call
 * @param model Model ID
 * @param tokensIn Input tokens
 * @param tokensOut Output tokens
 * @returns Estimated cost in USD
 */
export function calculateCost(model: string, tokensIn: number, tokensOut: number): number {
  const pricing = ANTHROPIC_PRICING[model as keyof typeof ANTHROPIC_PRICING];
  if (!pricing) {
    log.warn({ model }, "Unknown model for cost calculation");
    return 0;
  }

  const inputCost = (tokensIn / 1000) * pricing.input_per_1k;
  const outputCost = (tokensOut / 1000) * pricing.output_per_1k;
  return inputCost + outputCost;
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

        case TelemetryEvents.SSECompleted: {
          if (typeof data.stream_duration_ms === "number") {
            datadogClient.histogram("draft.sse.stream_duration_ms", data.stream_duration_ms);
          }
          datadogClient.increment("draft.sse.completed", 1);
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
