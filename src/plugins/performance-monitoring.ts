/**
 * Performance Monitoring Plugin
 *
 * Tracks request latency, response times, and emits metrics for observability.
 * Integrates with StatsD/Datadog for real-time monitoring and alerting.
 */

import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { logger } from '../utils/simple-logger.js';
import { config } from '../config/index.js';

// Extend FastifyRequest to include performance tracking
declare module 'fastify' {
  interface FastifyRequest {
    startTime?: number;
    routerPath?: string;
  }
}

interface PerformanceMetrics {
  totalRequests: number;
  slowRequests: number; // > 5s (configurable via PERF_SLOW_THRESHOLD_MS)
  requestsByRoute: Map<string, { count: number; totalDuration: number; p99: number[] }>;
}

const metrics: PerformanceMetrics = {
  totalRequests: 0,
  slowRequests: 0,
  requestsByRoute: new Map(),
};

// Performance thresholds (from centralized config)
const SLOW_REQUEST_THRESHOLD_MS = config.performance.slowThresholdMs;
const P99_ALERT_THRESHOLD_MS = config.performance.p99ThresholdMs;
const METRICS_ENABLED = config.performance.metricsEnabled;

/**
 * Calculate p99 latency from array of durations
 */
function calculateP99(durations: number[]): number {
  if (durations.length === 0) return 0;
  const sorted = [...durations].sort((a, b) => a - b);
  const index = Math.ceil(sorted.length * 0.99) - 1;
  return sorted[Math.max(0, index)];
}

/**
 * Get current metrics snapshot
 */
export function getPerformanceMetrics(): {
  totalRequests: number;
  slowRequests: number;
  routes: Array<{
    route: string;
    count: number;
    avgDuration: number;
    p99: number;
  }>;
} {
  const routes = Array.from(metrics.requestsByRoute.entries()).map(([route, data]) => ({
    route,
    count: data.count,
    avgDuration: data.totalDuration / data.count,
    p99: calculateP99(data.p99),
  }));

  return {
    totalRequests: metrics.totalRequests,
    slowRequests: metrics.slowRequests,
    routes: routes.sort((a, b) => b.count - a.count), // Sort by request count
  };
}

/**
 * Reset performance metrics (for testing)
 */
export function resetPerformanceMetrics(): void {
  metrics.totalRequests = 0;
  metrics.slowRequests = 0;
  metrics.requestsByRoute.clear();
}

// Cached statsd client reference (lazy loaded)
let cachedStatsd: unknown = null;
let statsdLoadAttempted = false;

/**
 * Get StatsD client (lazy loaded, cached)
 */
async function getStatsdClient(): Promise<unknown> {
  if (statsdLoadAttempted) return cachedStatsd;

  statsdLoadAttempted = true;
  try {
    // Dynamic import for ESM compatibility
    const telemetry = await import('../utils/telemetry.js');
    cachedStatsd = telemetry?.statsd ?? null;
  } catch {
    cachedStatsd = null;
  }
  return cachedStatsd;
}

/**
 * Normalize route path for metrics to prevent high-cardinality.
 * - Uses Fastify's route template (routeOptions.url) when available
 * - Falls back to URL path with query string stripped
 * - Replaces dynamic segments like UUIDs/IDs with placeholders
 */
function normalizeRoute(request: FastifyRequest): string {
  // Prefer Fastify's route template (e.g., "/assist/v1/draft-graph/:id")
  const routeTemplate = request.routeOptions?.url;
  if (routeTemplate) {
    return routeTemplate;
  }

  // Fallback: strip query string and normalize dynamic segments
  const urlPath = request.url.split('?')[0];

  // Replace common dynamic patterns to prevent cardinality explosion
  return urlPath
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:uuid')
    .replace(/\/[0-9a-f]{24,}/gi, '/:id')
    .replace(/\/\d+/g, '/:num');
}

/**
 * Emit metrics to StatsD/Datadog if configured
 */
function emitMetric(
  metricType: 'histogram' | 'counter' | 'gauge',
  metricName: string,
  value: number,
  tags: Record<string, string | number> = {}
): void {
  if (!METRICS_ENABLED) return;

  // Fire and forget - don't block on metric emission
  getStatsdClient().then((statsd) => {
    if (!statsd) return;

    const client = statsd as {
      histogram: (name: string, value: number, tags: string[]) => void;
      increment: (name: string, value: number, tags: string[]) => void;
      gauge: (name: string, value: number, tags: string[]) => void;
    };

    const tagArray = Object.entries(tags).map(([k, v]) => `${k}:${v}`);

    switch (metricType) {
      case 'histogram':
        client.histogram(metricName, value, tagArray);
        break;
      case 'counter':
        client.increment(metricName, value, tagArray);
        break;
      case 'gauge':
        client.gauge(metricName, value, tagArray);
        break;
    }
  }).catch(() => {
    // StatsD not configured or not available - metrics will only be tracked in-memory
  });
}

export const performanceMonitoring: FastifyPluginAsync = async (app) => {
  // Hook 1: Record request start time
  app.addHook('onRequest', async (request: FastifyRequest) => {
    request.startTime = Date.now();
  });

  // Hook 2: Track and emit performance metrics on response
  app.addHook('onResponse', async (request: FastifyRequest, reply) => {
    if (!request.startTime) return;

    const duration = Date.now() - request.startTime;
    const route = normalizeRoute(request); // Use normalized route to prevent high-cardinality
    const method = request.method;
    const statusCode = reply.statusCode;

    // Update in-memory metrics
    metrics.totalRequests++;

    if (duration > SLOW_REQUEST_THRESHOLD_MS) {
      metrics.slowRequests++;
    }

    // Track per-route metrics
    const routeKey = `${method} ${route}`;
    if (!metrics.requestsByRoute.has(routeKey)) {
      metrics.requestsByRoute.set(routeKey, {
        count: 0,
        totalDuration: 0,
        p99: [],
      });
    }

    const routeMetrics = metrics.requestsByRoute.get(routeKey)!;
    routeMetrics.count++;
    routeMetrics.totalDuration += duration;
    routeMetrics.p99.push(duration);

    // Keep only last 1000 samples for p99 calculation (rolling window)
    if (routeMetrics.p99.length > 1000) {
      routeMetrics.p99.shift();
    }

    // Emit metrics to StatsD/Datadog
    emitMetric('histogram', 'request.duration', duration, {
      route: routeKey,
      method,
      status: statusCode,
    });

    emitMetric('counter', 'request.count', 1, {
      route: routeKey,
      method,
      status: statusCode,
    });

    // Alert on slow requests
    if (duration > SLOW_REQUEST_THRESHOLD_MS) {
      logger.warn({
        msg: 'Slow request detected',
        duration_ms: duration,
        route: routeKey,
        method,
        status: statusCode,
        threshold_ms: SLOW_REQUEST_THRESHOLD_MS,
        request_id: reply.getHeader('x-request-id'),
      });

      emitMetric('counter', 'request.slow', 1, {
        route: routeKey,
        method,
      });
    }

    // Check p99 threshold and alert
    const currentP99 = calculateP99(routeMetrics.p99);
    if (currentP99 > P99_ALERT_THRESHOLD_MS && routeMetrics.count >= 100) {
      logger.warn({
        msg: 'Route p99 latency exceeds threshold',
        route: routeKey,
        p99_ms: currentP99,
        threshold_ms: P99_ALERT_THRESHOLD_MS,
        sample_size: routeMetrics.count,
      });

      emitMetric('gauge', 'request.p99', currentP99, {
        route: routeKey,
      });
    }

    // Log performance metrics periodically (every 100 requests)
    if (metrics.totalRequests % 100 === 0) {
      logger.info({
        msg: 'Performance metrics snapshot',
        total_requests: metrics.totalRequests,
        slow_requests: metrics.slowRequests,
        slow_request_rate: (metrics.slowRequests / metrics.totalRequests * 100).toFixed(2) + '%',
      });
    }
  });

  logger.info({
    msg: 'Performance monitoring plugin initialized',
    slow_threshold_ms: SLOW_REQUEST_THRESHOLD_MS,
    p99_threshold_ms: P99_ALERT_THRESHOLD_MS,
    metrics_enabled: METRICS_ENABLED,
  });
};
