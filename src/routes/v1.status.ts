/**
 * /v1/status - Comprehensive Service Diagnostics
 *
 * Provides detailed operational metrics beyond simple health checks.
 *
 * **Use Cases:**
 * - Operational dashboards and monitoring
 * - Performance tuning and capacity planning
 * - Debugging production issues
 * - Understanding cache effectiveness
 *
 * **Differences from /healthz:**
 * - /healthz: Simple liveness check (ok/version/provider)
 * - /v1/status: Detailed runtime diagnostics and statistics
 *
 * **Security:** No authentication required (metrics only, no sensitive data)
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getAdapter } from "../adapters/llm/router.js";
import {
  resolveModelRoutingSnapshot,
  buildEffectiveTaskModels,
} from "../adapters/llm/model-routing-report.js";
import { getStorageStats } from "../utils/share-storage.js";
import { SERVICE_VERSION } from "../version.js";
import { getPerformanceMetrics } from "../plugins/performance-monitoring.js";
import { config } from "../config/index.js";

// Track service uptime
const SERVICE_START_TIME = Date.now();

// Request counter (simple in-memory counter, resets on restart)
let totalRequests = 0;
let client4xxErrors = 0; // Client errors (validation, auth, etc.)
let server5xxErrors = 0; // Server errors (crashes, timeouts, etc.)

/**
 * Increment request counter (called by middleware)
 */
export function incrementRequestCount(): void {
  totalRequests++;
}

/**
 * Increment error counter (called by error handler)
 * Only counts 5xx as true "errors" for health metrics
 */
export function incrementErrorCount(statusCode: number): void {
  if (statusCode >= 500) {
    server5xxErrors++;
  } else if (statusCode >= 400) {
    client4xxErrors++;
  }
}

interface StatusResponse {
  service: string;
  version: string;
  uptime_seconds: number;
  timestamp: string;

  // Request statistics
  requests: {
    total: number;
    client_errors_4xx: number;
    server_errors_5xx: number;
    error_rate_5xx: number; // Only 5xx counted as true errors
  };

  // LLM adapter status
  llm: {
    /**
     * ⚠ THE UNTASKED DEFAULT ADAPTER — `getAdapter()` with no task, which
     * lands on precedence rank 6 (`llm_model_fallback`) because the ranks
     * that can select a real model (store pin, `CEE_MODEL_*`,
     * `TASK_MODEL_DEFAULTS`) are ALL keyed on `task`.
     *
     * NO USER TURN IS SERVED BY THIS ADAPTER. Every untasked `getAdapter()`
     * call site in `src/` reads `.name`/`.model` for reporting and never
     * invokes a method. Reading `llm.model` as "the model the product runs
     * on" is a live misreading this field name invites — a deployed capture
     * of this endpoint reported `gpt-4o-mini` while real turns were routing
     * to `claude-sonnet-5`.
     *
     * For what real turns actually run on, read `model_routing` below.
     */
    scope: "untasked_default_adapter";
    provider: string;
    model: string;
    cache_enabled: boolean;
    cache_stats?: {
      size: number;
      capacity: number;
      ttlMs: number; // camelCase to match adapter.stats() return value
      enabled: boolean;
    };
    failover_enabled: boolean;
    failover_providers?: string[];
  };

  /**
   * THE MODELS REAL TURNS RUN ON — the per-task routing the product actually
   * serves, as opposed to the untasked default reported in `llm` above.
   *
   * Derived from `resolveModelRoutingSnapshot()`, the same adapter-free
   * projection that boot logs as `config.task_models` and that
   * `/admin/models/routing` serves, so this endpoint cannot drift from them.
   *
   * Deliberately NOT the full `tasks[]` rows: those carry configuration key
   * NAMES (`CEE_MODEL_*`, `providers.json...`) and configuration-error
   * messages, and `/v1/status` is unauthenticated. Those stay on the
   * admin-key-gated `/admin/models/routing`.
   */
  model_routing: {
    /** Provider the untasked fallback would use — same value as /admin/models/routing. */
    default_provider: string;
    /**
     * task id → resolved model id, for every task with an executable path
     * that is not behind a default-off gate or a configuration error.
     */
    effective_task_models: Readonly<Record<string, string>>;
  };

  // Share storage statistics
  share: {
    enabled: boolean;
    total_shares: number;
    active_shares: number;
    revoked_shares: number;
  };

  // Feature flags
  feature_flags: {
    grounding: boolean;
    critique: boolean;
    clarifier: boolean;
    share_review: boolean;
    prompt_cache: boolean;
  };

  // Performance metrics
  performance: {
    total_requests: number;
    slow_requests: number;
    slow_request_rate: number;
    top_routes: Array<{
      route: string;
      count: number;
      avg_duration_ms: number;
      p99_ms: number;
    }>;
  };
}

/**
 * GET /v1/status - Service diagnostics endpoint
 */
export async function statusRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/status", async (request: FastifyRequest, reply: FastifyReply) => {
    const adapter = getAdapter();
    // Adapter-free projection: constructs no adapter and makes no network
    // call, so adding it costs this endpoint nothing.
    const modelRoutingSnapshot = resolveModelRoutingSnapshot();

    // Calculate uptime
    const uptimeSeconds = Math.floor((Date.now() - SERVICE_START_TIME) / 1000);

    // Get cache stats if caching adapter is in use
    let cacheStats: StatusResponse["llm"]["cache_stats"] | undefined;
    if ("stats" in adapter && typeof adapter.stats === "function") {
      try {
        cacheStats = adapter.stats();
      } catch {
        // Cache stats not available
      }
    }

    // Check if failover is enabled
    let failoverEnabled = false;
    let failoverProviders: string[] | undefined;
    if ("getFailoverMetadata" in adapter && typeof adapter.getFailoverMetadata === "function") {
      const metadata = adapter.getFailoverMetadata();
      failoverEnabled = metadata.enabled;
      failoverProviders = metadata.providers;
    }

    // Get share storage stats
    const shareStats = await getStorageStats();

    // Calculate 5xx error rate (true service health metric)
    const errorRate5xx = totalRequests > 0 ? server5xxErrors / totalRequests : 0;

    // Get performance metrics
    const perfMetrics = getPerformanceMetrics();
    const slowRequestRate = perfMetrics.totalRequests > 0
      ? (perfMetrics.slowRequests / perfMetrics.totalRequests) * 100
      : 0;

    const status: StatusResponse = {
      service: "assistants",
      version: SERVICE_VERSION,
      uptime_seconds: uptimeSeconds,
      timestamp: new Date().toISOString(),

      requests: {
        total: totalRequests,
        client_errors_4xx: client4xxErrors,
        server_errors_5xx: server5xxErrors,
        error_rate_5xx: Math.round(errorRate5xx * 10000) / 100, // Percentage with 2 decimals
      },

      llm: {
        scope: "untasked_default_adapter",
        provider: adapter.name,
        model: adapter.model,
        cache_enabled: cacheStats?.enabled ?? false,
        cache_stats: cacheStats,
        failover_enabled: failoverEnabled,
        failover_providers: failoverProviders,
      },

      model_routing: {
        default_provider: modelRoutingSnapshot.default_provider,
        effective_task_models: buildEffectiveTaskModels(modelRoutingSnapshot),
      },

      share: {
        enabled: config.features.shareReview,
        total_shares: shareStats.total,
        active_shares: shareStats.active,
        revoked_shares: shareStats.revoked,
      },

      feature_flags: {
        grounding: config.features.grounding,
        critique: config.features.critique,
        clarifier: config.features.clarifier,
        // pii_guard removed 2026-07-20 (O-7 wave 2, Appendix A4): the flag
        // only ever fed this report field — no enforcement existed, so the
        // field was a false safety signal.
        share_review: config.features.shareReview,
        prompt_cache: config.promptCache.enabled,
      },

      performance: {
        total_requests: perfMetrics.totalRequests,
        slow_requests: perfMetrics.slowRequests,
        slow_request_rate: Math.round(slowRequestRate * 100) / 100, // Percentage with 2 decimals
        top_routes: perfMetrics.routes.slice(0, 10).map(r => ({
          route: r.route,
          count: r.count,
          avg_duration_ms: Math.round(r.avgDuration * 100) / 100, // 2 decimal places
          p99_ms: Math.round(r.p99 * 100) / 100, // 2 decimal places
        })),
      },
    };

    // Return 200 with diagnostics
    return reply.status(200).send(status);
  });
}
