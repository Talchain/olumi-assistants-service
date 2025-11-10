// Load environment variables from .env file (local development only)
import "dotenv/config";

import { env } from "node:process";
import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import draftRoute from "./routes/assist.draft-graph.js";
import suggestRoute from "./routes/assist.suggest-options.js";
import clarifyRoute from "./routes/assist.clarify-brief.js";
import critiqueRoute from "./routes/assist.critique-graph.js";
import explainRoute from "./routes/assist.explain-diff.js";
import evidencePackRoute from "./routes/assist.evidence-pack.js";
import observabilityPlugin from "./plugins/observability.js";
import { getAdapter } from "./adapters/llm/router.js";
import { SERVICE_VERSION } from "./version.js";
import { getAllFeatureFlags } from "./utils/feature-flags.js";
import { attachRequestId, getRequestId, REQUEST_ID_HEADER } from "./utils/request-id.js";
import { buildErrorV1, toErrorV1, getStatusCodeForErrorCode } from "./utils/errors.js";
import { authPlugin } from "./plugins/auth.js";

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

  // Security configuration (read from env or use defaults)
  const BODY_LIMIT_BYTES = Number(env.BODY_LIMIT_BYTES) || 1024 * 1024; // 1 MB default
  const REQUEST_TIMEOUT_MS = Number(env.REQUEST_TIMEOUT_MS) || 60000; // 60 seconds
  const GLOBAL_RATE_LIMIT_RPM = Number(env.GLOBAL_RATE_LIMIT_RPM) || 120; // requests per minute per IP
  const _SSE_RATE_LIMIT_RPM = Number(env.SSE_RATE_LIMIT_RPM) || 20; // SSE-specific limit
  const _COST_MAX_USD = Number(env.COST_MAX_USD) || 1.0;

  const app = Fastify({
  logger: true,
  bodyLimit: BODY_LIMIT_BYTES,
  connectionTimeout: REQUEST_TIMEOUT_MS,
  requestTimeout: REQUEST_TIMEOUT_MS,
});

// CORS: Strict allowlist (default: olumi.app + localhost dev)
const DEFAULT_ORIGINS = [
  'https://olumi.app',
  'https://app.olumi.app',
  'http://localhost:5173',
  'http://localhost:3000',
];

const allowedOrigins: string[] = env.ALLOWED_ORIGINS
  ? env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
  : DEFAULT_ORIGINS;

await app.register(cors, {
  origin: allowedOrigins,
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

  // Auth: API key authentication with per-key quotas (v1.3.0)
  await app.register(authPlugin);

  // Request ID tracking: attach to every request
  app.addHook("onRequest", async (request, _reply) => {
    attachRequestId(request);
  });

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

app.get("/healthz", async () => {
  // Get current adapter to show provider info
  const adapter = getAdapter();
  return {
    ok: true,
    service: "assistants",
    version: SERVICE_VERSION,
    provider: adapter.name,
    model: adapter.model,
    limits_source: env.ENGINE_BASE_URL ? "engine" : "config",
    feature_flags: getAllFeatureFlags()
  };
});

  await draftRoute(app);
  await suggestRoute(app);
  await clarifyRoute(app);
  await critiqueRoute(app);
  await explainRoute(app);
  await evidencePackRoute(app);

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
      const DEFAULT_ORIGINS = [
        'https://olumi.app',
        'https://app.olumi.app',
        'http://localhost:5173',
        'http://localhost:3000',
      ];
      const allowedOrigins = env.CORS_ORIGINS
        ? env.CORS_ORIGINS.split(',')
        : DEFAULT_ORIGINS;

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
      }, '🚀 Olumi Assistants Service starting');

      await app.listen({ port, host: "0.0.0.0" });
    })
    .catch((err: unknown) => {
      console.error('❌ Failed to start server:', err);
      process.exit(1);
    });
}
