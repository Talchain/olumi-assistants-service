/**
 * Performance Monitoring Plugin
 *
 * Tracks request latency, response times, and emits metrics for observability.
 * Integrates with StatsD/Datadog for real-time monitoring and alerting.
 */

import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { logger } from '../utils/simple-logger.js';

// Extend FastifyRequest to include performance tracking
declare module 'fastify' {
  interface FastifyRequest {
    startTime?: number;
    routerPath?: string;
  }
}

interface PerformanceMetrics {
  totalRequests: number;
  slowRequests: number; // > 30s
  requestsByRoute: Map<string, { count: number; totalDuration: number; p99: number[] }>;
}

const metrics: PerformanceMetrics = {
  totalRequests: 0,
  slowRequests: 0,
  requestsByRoute: new Map(),
};

// Performance thresholds (configurable via environment)
const SLOW_REQUEST_THRESHOLD_MS = parseInt(process.env.PERF_SLOW_THRESHOLD_MS || '30000', 10);
const P99_ALERT_THRESHOLD_MS = parseInt(process.env.PERF_P99_THRESHOLD_MS || '30000', 10);
const METRICS_ENABLED = process.env.PERF_METRICS_ENABLED !== 'false';

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

  // Try to use existing statsd client from telemetry if available
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { statsd } = require('../utils/telemetry.js');
    if (statsd) {
      const tagArray = Object.entries(tags).map(([k, v]) => `${k}:${v}`);

      switch (metricType) {
        case 'histogram':
          statsd.histogram(metricName, value, tagArray);
          break;
        case 'counter':
          statsd.increment(metricName, value, tagArray);
          break;
        case 'gauge':
          statsd.gauge(metricName, value, tagArray);
          break;
      }
    }
  } catch (error) {
    // StatsD not configured or not available - metrics will only be tracked in-memory
  }
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
    const route = request.routerPath || request.url;
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
