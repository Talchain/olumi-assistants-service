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
    pii_guard: boolean;
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
        provider: adapter.name,
        model: adapter.model,
        cache_enabled: cacheStats?.enabled ?? false,
        cache_stats: cacheStats,
        failover_enabled: failoverEnabled,
        failover_providers: failoverProviders,
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
        pii_guard: config.features.piiGuard,
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
