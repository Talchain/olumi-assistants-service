// Load environment variables from .env file (local development only)
import "dotenv/config";

import { env } from "node:process";
import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import compress from "@fastify/compress";
import draftRoute from "./routes/assist.draft-graph.js";
import suggestRoute from "./routes/assist.suggest-options.js";
import clarifyRoute from "./routes/assist.clarify-brief.js";
import critiqueRoute from "./routes/assist.critique-graph.js";
import explainRoute from "./routes/assist.explain-diff.js";
import evidencePackRoute from "./routes/assist.evidence-pack.js";
import shareRoute from "./routes/assist.share.js";
import ceeDraftRouteV1 from "./routes/assist.v1.draft-graph.js";
import ceeDraftStreamRouteV1 from "./routes/assist.v1.draft-graph-stream.js";
import ceeOptionsRouteV1 from "./routes/assist.v1.options.js";
import ceeBiasCheckRouteV1 from "./routes/assist.v1.bias-check.js";
import ceeExplainGraphRouteV1 from "./routes/assist.v1.explain-graph.js";
import ceeEvidenceHelperRouteV1 from "./routes/assist.v1.evidence-helper.js";
import ceeSensitivityCoachRouteV1 from "./routes/assist.v1.sensitivity-coach.js";
import ceeTeamPerspectivesRouteV1 from "./routes/assist.v1.team-perspectives.js";
import ceeDecisionReviewExampleRouteV1 from "./routes/assist.v1.decision-review-example.js";
import ceeGraphReadinessRouteV1 from "./routes/assist.v1.graph-readiness.js";
import ceeKeyInsightRouteV1 from "./routes/assist.v1.key-insight.js";
import ceeElicitBeliefRouteV1 from "./routes/assist.v1.elicit-belief.js";
import ceeUtilityWeightRouteV1 from "./routes/assist.v1.suggest-utility-weights.js";
import ceeRiskToleranceRouteV1 from "./routes/assist.v1.elicit-risk-tolerance.js";
import ceeEdgeFunctionRouteV1 from "./routes/assist.v1.suggest-edge-function.js";
import ceeGenerateRecommendationRouteV1 from "./routes/assist.v1.generate-recommendation.js";
import ceeNarrateConditionsRouteV1 from "./routes/assist.v1.narrate-conditions.js";
import ceeExplainPolicyRouteV1 from "./routes/assist.v1.explain-policy.js";
import ceeHealthRouteV1 from "./routes/assist.v1.health.js";
import { statusRoutes, incrementRequestCount, incrementErrorCount } from "./routes/v1.status.js";
import { limitsRoute } from "./routes/v1.limits.js";
import observabilityPlugin from "./plugins/observability.js";
import { performanceMonitoring } from "./plugins/performance-monitoring.js";
import { getAdapter } from "./adapters/llm/router.js";
import { SERVICE_VERSION } from "./version.js";
import { getAllFeatureFlags } from "./utils/feature-flags.js";
import { attachRequestId, getRequestId, REQUEST_ID_HEADER } from "./utils/request-id.js";
import { buildErrorV1, toErrorV1, getStatusCodeForErrorCode } from "./utils/errors.js";
import { authPlugin, getRequestKeyId } from "./plugins/auth.js";
import { responseHashPlugin } from "./plugins/response-hash.js";
import { getRecentCeeErrors } from "./cee/logging.js";
import { resolveCeeRateLimit } from "./cee/config/limits.js";
import { HTTP_CLIENT_TIMEOUT_MS, ROUTE_TIMEOUT_MS, UPSTREAM_RETRY_DELAY_MS } from "./config/timeouts.js";
import { getISLConfig } from "./adapters/isl/config.js";
import { getIslCircuitBreakerStatusForDiagnostics } from "./cee/bias/causal-enrichment.js";
import { adminPromptRoutes } from "./routes/admin.prompts.js";
import { adminUIRoutes } from "./routes/admin.ui.js";
import { initializePromptStore, getBraintrustManager, registerAllDefaultPrompts, getPromptStoreStatus, isPromptStoreHealthy } from "./prompts/index.js";
import { getActiveExperiments } from "./adapters/llm/prompt-loader.js";
import { config } from "./config/index.js";
import { createLoggerConfig } from "./utils/logger-config.js";

const DEFAULT_ORIGINS = [
  "https://olumi.app",
  "https://app.olumi.app",
  "http://localhost:5173",
  "http://localhost:3000",
];

function resolveAllowedOrigins(): string[] {
  const raw = env.ALLOWED_ORIGINS;
  const origins = raw
    ? raw
        .split(",")
        .map((o) => o.trim())
        .filter((o) => o.length > 0)
    : DEFAULT_ORIGINS;

  if (env.NODE_ENV === "production" && origins.some((origin) => origin === "*" || origin === '"*"')) {
    throw new Error("FATAL: ALLOWED_ORIGINS cannot contain '*' in production");
  }

  return origins;
}

/**
 * Build and configure Fastify server instance
 * (Can be imported for testing or run directly)
 */
export async function build() {
  // Fail-fast: Verify LLM provider and API key configuration
  const llmProvider = env.LLM_PROVIDER || 'openai';
  if (llmProvider === 'openai' && !env.OPENAI_API_KEY) {
    throw new Error('FATAL: LLM_PROVIDER=openai but OPENAI_API_KEY is not set');
  }
  if (llmProvider === 'anthropic' && !env.ANTHROPIC_API_KEY) {
    throw new Error('FATAL: LLM_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set');
  }

  // Fail-fast: In production, require at least one API key or HMAC secret so
  // that authentication cannot be accidentally disabled.
  const nodeEnv = env.NODE_ENV || 'development';
  const hasApiKeys =
    Boolean(env.ASSIST_API_KEY && env.ASSIST_API_KEY.trim().length > 0) ||
    Boolean(
      env.ASSIST_API_KEYS &&
        env.ASSIST_API_KEYS
          .split(',')
          .some((k) => k.trim().length > 0),
    );
  const hasHmacSecret = Boolean(env.HMAC_SECRET && env.HMAC_SECRET.trim().length > 0);

  if (nodeEnv === 'production' && !hasApiKeys && !hasHmacSecret) {
    throw new Error(
      'FATAL: In production, at least one ASSIST_API_KEY/ASSIST_API_KEYS or HMAC_SECRET must be configured',
    );
  }

  // Register default prompts (fallbacks for prompt management system)
  // This must happen before routes are registered so prompts are available
  registerAllDefaultPrompts();

  // Security configuration (read from env or use defaults)
  const BODY_LIMIT_BYTES = Number(env.BODY_LIMIT_BYTES) || 1024 * 1024; // 1 MB default
  const GLOBAL_RATE_LIMIT_RPM = Number(env.GLOBAL_RATE_LIMIT_RPM) || 120; // requests per minute per IP
  const _SSE_RATE_LIMIT_RPM = Number(env.SSE_RATE_LIMIT_RPM) || 20; // SSE-specific limit
  const _COST_MAX_USD = Number(env.COST_MAX_USD) || 1.0;

  const app = Fastify({
    logger: createLoggerConfig(env.LOG_LEVEL || "info"),
    bodyLimit: BODY_LIMIT_BYTES,
    connectionTimeout: ROUTE_TIMEOUT_MS,
    requestTimeout: ROUTE_TIMEOUT_MS,
  });

  // CORS: Strict allowlist (default: olumi.app + localhost dev)
  const allowedOrigins = resolveAllowedOrigins();

  await app.register(cors, {
    origin: allowedOrigins,
  });

  // Security headers: Standard HTTP security headers for defense-in-depth
  // Note: contentSecurityPolicy disabled - this is a pure API, not serving HTML
  await app.register(helmet, {
    contentSecurityPolicy: false, // Not relevant for JSON API
    crossOriginEmbedderPolicy: false, // Would break CORS for API clients
    crossOriginOpenerPolicy: false, // Not relevant for API responses
    crossOriginResourcePolicy: { policy: "cross-origin" }, // Allow cross-origin API access
    // The following headers ARE enabled by default:
    // - X-Content-Type-Options: nosniff
    // - X-Frame-Options: SAMEORIGIN (prevents clickjacking if ever serving HTML)
    // - X-DNS-Prefetch-Control: off
    // - X-Download-Options: noopen
    // - X-Permitted-Cross-Domain-Policies: none
    strictTransportSecurity: {
      maxAge: 31536000, // 1 year
      includeSubDomains: true,
    },
  });

  // Response compression: Enable for JSON (SSE streams auto-skipped)
  await app.register(compress, {
    threshold: 1024, // Only compress responses > 1KB
    encodings: ['gzip', 'deflate'],
    // Plugin automatically skips compression for text/event-stream
    customTypes: /^(application\/json|text\/plain)$/,
  });

// Rate limiting: Global + SSE-specific limits
await app.register(rateLimit, {
  global: true,
  max: GLOBAL_RATE_LIMIT_RPM,
  timeWindow: '1 minute',
  addHeadersOnExceeding: {
    "x-ratelimit-limit": true,
    "x-ratelimit-remaining": true,
    "x-ratelimit-reset": true,
  },
  addHeaders: {
    "x-ratelimit-limit": true,
    "x-ratelimit-remaining": true,
    "x-ratelimit-reset": true,
    "retry-after": true,
  },
  errorResponseBuilder: (req, context) => {
    const requestId = getRequestId(req);
    // Calculate retry_after_seconds with proper guards
    let retryAfter = 60; // Default fallback
    if (context.after && typeof context.after === 'number') {
      const diff = Math.ceil((context.after - Date.now()) / 1000);
      retryAfter = Math.max(1, diff); // Ensure at least 1 second
    }
    app.log.warn({
      event: "rate_limit_hit",
      max: GLOBAL_RATE_LIMIT_RPM,
      request_id: requestId,
    }, "Rate limit exceeded");

    // Use centralized error builder for consistency
    // Note: Must include statusCode for @fastify/rate-limit
    return {
      statusCode: 429,
      ...buildErrorV1(
        'RATE_LIMITED',
        'Too many requests',
        { retry_after_seconds: retryAfter },
        requestId
      ),
    };
  },
});

  // Observability: Structured logging with sampling and redaction
  await app.register(observabilityPlugin);

  // Performance Monitoring: Track request latency and emit metrics
  await app.register(performanceMonitoring);

  // Request ID tracking: attach FIRST (before auth) to ensure CallerContext has correct ID
  app.addHook("onRequest", async (request, _reply) => {
    attachRequestId(request);
    incrementRequestCount();
  });

  // Auth: API key authentication with per-key quotas (v1.3.0)
  // Note: authPlugin uses getRequestId() which now has correct ID from above hook
  await app.register(authPlugin);

  // Response hash: Add X-Olumi-Response-Hash header (v1.5 PR N)
  await app.register(responseHashPlugin);

  // Response hook: Add X-Request-Id header to every response
  app.addHook("onSend", async (request, reply, payload) => {
    const requestId = getRequestId(request);
    reply.header(REQUEST_ID_HEADER, requestId);
    return payload;
  });

  // Performance profiling hooks (enabled with PERF_TRACE=1)
  if (env.PERF_TRACE === "1") {
  app.log.info("Performance tracing enabled (PERF_TRACE=1)");

  // Track timing for each request phase
  app.addHook("onRequest", async (request) => {
    (request as any).perfTrace = {
      start: Date.now(),
      spans: [] as Array<{ name: string; duration: number }>,
    };
  });

  app.addHook("preHandler", async (request) => {
    const trace = (request as any).perfTrace;
    if (trace) {
      trace.preHandlerStart = Date.now();
      const onRequestDuration = trace.preHandlerStart - trace.start;
      trace.spans.push({ name: "onRequest", duration: onRequestDuration });
    }
  });

  app.addHook("onSend", async (request, _reply, payload) => {
    const trace = (request as any).perfTrace;
    if (trace && trace.preHandlerStart) {
      const now = Date.now();
      const handlerDuration = now - trace.preHandlerStart;
      trace.spans.push({ name: "handler", duration: handlerDuration });
      trace.onSendStart = now;
    }
    return payload;
  });

  app.addHook("onResponse", async (request, reply) => {
    const trace = (request as any).perfTrace;
    if (trace) {
      const total = Date.now() - trace.start;

      if (trace.onSendStart) {
        const onSendDuration = Date.now() - trace.onSendStart;
        trace.spans.push({ name: "onSend", duration: onSendDuration });
      }

      // Sort spans by duration (descending) and take top 3
      const top3 = trace.spans
        .sort((a: any, b: any) => b.duration - a.duration)
        .slice(0, 3);

      app.log.info({
        event: "perf_trace",
        method: request.method,
        url: request.url,
        status: reply.statusCode,
        total_ms: total,
        top_spans: top3,
      }, `[PERF] ${request.method} ${request.url} ${total}ms`);
    }
  });
}

// Centralized error handler: structured error.v1 responses with request_id
app.setErrorHandler((error, request, reply) => {
  const errorV1 = toErrorV1(error, request);
  const statusCode = getStatusCodeForErrorCode(errorV1.code);

  // Track error for /v1/status metrics (separates 4xx vs 5xx)
  incrementErrorCount(statusCode);

  // Log errors with context (redaction handled by logger)
  if (statusCode >= 500) {
    app.log.error({
      error: error,
      request_id: errorV1.request_id,
      method: request.method,
      url: request.url,
    }, `[${errorV1.code}] ${errorV1.message}`);
  } else {
    app.log.warn({
      request_id: errorV1.request_id,
      code: errorV1.code,
      method: request.method,
      url: request.url,
    }, `[${errorV1.code}] ${errorV1.message}`);
  }

  // Add Retry-After header for rate limit errors
  if (errorV1.code === 'RATE_LIMITED' && errorV1.details?.retry_after_seconds) {
    reply.header('Retry-After', errorV1.details.retry_after_seconds);
  }

  return reply.status(statusCode).send(errorV1);
});

function buildCeeConfig() {
  return {
    draft_graph: {
      feature_version: env.CEE_DRAFT_FEATURE_VERSION || "draft-model-1.0.0",
      rate_limit_rpm: resolveCeeRateLimit("CEE_DRAFT_RATE_LIMIT_RPM"),
    },
    options: {
      feature_version: env.CEE_OPTIONS_FEATURE_VERSION || "options-1.0.0",
      rate_limit_rpm: resolveCeeRateLimit("CEE_OPTIONS_RATE_LIMIT_RPM"),
    },
    bias_check: {
      feature_version: env.CEE_BIAS_CHECK_FEATURE_VERSION || "bias-check-1.0.0",
      rate_limit_rpm: resolveCeeRateLimit("CEE_BIAS_CHECK_RATE_LIMIT_RPM"),
    },
    evidence_helper: {
      feature_version:
        env.CEE_EVIDENCE_HELPER_FEATURE_VERSION || "evidence-helper-1.0.0",
      rate_limit_rpm: resolveCeeRateLimit("CEE_EVIDENCE_HELPER_RATE_LIMIT_RPM"),
    },
    sensitivity_coach: {
      feature_version:
        env.CEE_SENSITIVITY_COACH_FEATURE_VERSION || "sensitivity-coach-1.0.0",
      rate_limit_rpm: resolveCeeRateLimit("CEE_SENSITIVITY_COACH_RATE_LIMIT_RPM"),
    },
    team_perspectives: {
      feature_version:
        env.CEE_TEAM_PERSPECTIVES_FEATURE_VERSION || "team-perspectives-1.0.0",
      rate_limit_rpm: resolveCeeRateLimit("CEE_TEAM_PERSPECTIVES_RATE_LIMIT_RPM"),
    },
    explain_graph: {
      feature_version: env.CEE_EXPLAIN_FEATURE_VERSION || "explain-model-1.0.0",
      rate_limit_rpm: resolveCeeRateLimit("CEE_EXPLAIN_RATE_LIMIT_RPM"),
    },
  };
}

app.get("/healthz", async () => {
  const adapter = getAdapter();
  const ceeConfig = buildCeeConfig();

  // ISL configuration - use centralized config for consistency
  const islConfig = getISLConfig();
  const maskedBaseUrl = islConfig.baseUrl
    ? islConfig.baseUrl.replace(/:\/\/([^:/]+)(:\d+)?/, '://$1:***')  // Mask port/credentials
    : undefined;

  // Prompt store health (degraded if unhealthy but not critical)
  const promptStoreStatus = getPromptStoreStatus();
  const promptStoreHealthy = isPromptStoreHealthy();
  const isDegraded = promptStoreStatus.enabled && !promptStoreHealthy;

  return {
    ok: true,
    degraded: isDegraded,
    service: "assistants",
    version: SERVICE_VERSION,
    provider: adapter.name,
    model: adapter.model,
    limits_source: env.ENGINE_BASE_URL ? "engine" : "config",
    feature_flags: getAllFeatureFlags(),
    cee: {
      diagnostics_enabled: env.CEE_DIAGNOSTICS_ENABLED === "true",
      config: ceeConfig,
      timeouts: {
        route_ms: ROUTE_TIMEOUT_MS,
        http_client_ms: HTTP_CLIENT_TIMEOUT_MS,
        retry_delay_ms: UPSTREAM_RETRY_DELAY_MS,
      },
    },
    isl: {
      enabled: islConfig.enabled,
      configured: islConfig.configured,
      base_url: maskedBaseUrl,
      timeout_ms: islConfig.timeout,
      max_retries: islConfig.maxRetries,
      config_sources: {
        timeout: islConfig.sources.timeout,
        max_retries: islConfig.sources.maxRetries,
      },
    },
    prompts: {
      enabled: promptStoreStatus.enabled,
      healthy: promptStoreHealthy,
      degraded_reason: isDegraded ? 'prompt_store_unhealthy' : undefined,
    },
  };
});

if (env.CEE_DIAGNOSTICS_ENABLED === "true") {
  const diagnosticsKeyIdsRaw = env.CEE_DIAGNOSTICS_KEY_IDS;
  const diagnosticsKeyIds = diagnosticsKeyIdsRaw && diagnosticsKeyIdsRaw.trim().length > 0
    ? new Set(
        diagnosticsKeyIdsRaw
          .split(",")
          .map((id) => id.trim())
          .filter((id) => id.length > 0),
      )
    : null;

  app.get("/diagnostics", async (request, reply) => {
    // Security: Diagnostics access requires explicit key ID allowlist
    if (!diagnosticsKeyIds || diagnosticsKeyIds.size === 0) {
      reply.code(403);
      return reply.send({
        schema: "error.v1",
        code: "FORBIDDEN",
        message: "Diagnostics endpoint requires CEE_DIAGNOSTICS_KEY_IDS configuration.",
      });
    }

    const keyId = getRequestKeyId(request);
    if (!keyId || !diagnosticsKeyIds.has(keyId)) {
      reply.code(403);
      return reply.send({
        schema: "error.v1",
        code: "FORBIDDEN",
        message: "Diagnostics access denied.",
      });
    }

    const adapter = getAdapter();
    const ceeConfig = buildCeeConfig();
    const recentErrors = getRecentCeeErrors(20);
    const promptStoreStatus = getPromptStoreStatus();
    const activeExperiments = getActiveExperiments();

    return {
      service: "assistants",
      version: SERVICE_VERSION,
      timestamp: new Date().toISOString(),
      feature_flags: getAllFeatureFlags(),
      cee: {
        provider: adapter.name,
        model: adapter.model,
        config: ceeConfig,
        recent_errors: recentErrors,
      },
      isl: {
        circuit_breaker: getIslCircuitBreakerStatusForDiagnostics(),
      },
      prompts: {
        store: promptStoreStatus,
        active_experiments: activeExperiments,
        experiment_count: activeExperiments.length,
      },
    };
  });
}

  await statusRoutes(app);
  await limitsRoute(app);
  await draftRoute(app);
  await suggestRoute(app);
  await clarifyRoute(app);
  await critiqueRoute(app);
  await explainRoute(app);
  await evidencePackRoute(app);
  await shareRoute(app);

  await ceeDraftRouteV1(app);
  await ceeDraftStreamRouteV1(app);
  await ceeOptionsRouteV1(app);
  await ceeBiasCheckRouteV1(app);
  await ceeExplainGraphRouteV1(app);
  await ceeEvidenceHelperRouteV1(app);
  await ceeSensitivityCoachRouteV1(app);
  await ceeTeamPerspectivesRouteV1(app);
  await ceeGraphReadinessRouteV1(app);
  await ceeKeyInsightRouteV1(app);
  await ceeElicitBeliefRouteV1(app);
  await ceeUtilityWeightRouteV1(app);
  await ceeRiskToleranceRouteV1(app);
  await ceeEdgeFunctionRouteV1(app);
  await ceeGenerateRecommendationRouteV1(app);
  await ceeNarrateConditionsRouteV1(app);
  await ceeExplainPolicyRouteV1(app);
  await ceeHealthRouteV1(app);
  if (env.CEE_DECISION_REVIEW_EXAMPLE_ENABLED === "true") {
    await ceeDecisionReviewExampleRouteV1(app);
  }

  // Admin routes for prompt management (enabled via config)
  if (config.prompts?.enabled || config.prompts?.adminApiKey) {
    await initializePromptStore();
    await adminPromptRoutes(app);
    await adminUIRoutes(app);
    app.log.info('Admin prompt management routes registered');

    // Initialize Braintrust experiment tracking if enabled
    if (config.prompts?.braintrustEnabled) {
      const braintrust = getBraintrustManager();
      await braintrust.initialize();
    }
  }

  return app;
}

// If running directly (not imported), start the server
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(env.PORT || 3101);

  build()
    .then(async (app) => {
      // Boot summary: Log configuration before starting server
      const adapter = getAdapter();
      const GLOBAL_RATE_LIMIT_RPM = Number(env.GLOBAL_RATE_LIMIT_RPM) || 120;
      const SSE_RATE_LIMIT_RPM = Number(env.SSE_RATE_LIMIT_RPM) || 20;
      const BODY_LIMIT_BYTES = Number(env.BODY_LIMIT_BYTES) || 1024 * 1024;
      const COST_MAX_USD = Number(env.COST_MAX_USD) || 1.0;
      const allowedOrigins = resolveAllowedOrigins();

      app.log.info({
        service: 'olumi-assistants-service',
        version: SERVICE_VERSION,
        provider: adapter.name,
        model: adapter.model,
        cost_cap_usd: COST_MAX_USD,
        global_rate_limit_rpm: GLOBAL_RATE_LIMIT_RPM,
        sse_rate_limit_rpm: SSE_RATE_LIMIT_RPM,
        body_limit_mb: (BODY_LIMIT_BYTES / 1024 / 1024).toFixed(1),
        cors_origins: allowedOrigins,
        engine_url: env.ENGINE_BASE_URL || 'not set',
        route_timeout_ms: ROUTE_TIMEOUT_MS,
        http_client_timeout_ms: HTTP_CLIENT_TIMEOUT_MS,
        upstream_retry_delay_ms: UPSTREAM_RETRY_DELAY_MS,
      }, '🚀 Olumi Assistants Service starting');

      await app.listen({ port, host: "0.0.0.0" });
    })
    .catch((err: unknown) => {
      console.error('❌ Failed to start server:', err);
      process.exit(1);
    });
}
