import { env } from "node:process";
import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import draftRoute from "./routes/assist.draft-graph.js";
import suggestRoute from "./routes/assist.suggest-options.js";

// Security configuration
const BODY_LIMIT_BYTES = 1024 * 1024; // 1 MB
const REQUEST_TIMEOUT_MS = 60000; // 60 seconds
const RATE_LIMIT_MAX = 10; // requests per minute per IP
const RATE_LIMIT_WINDOW_MS = 60000; // 1 minute

const app = Fastify({
  logger: true,
  bodyLimit: BODY_LIMIT_BYTES,
  connectionTimeout: REQUEST_TIMEOUT_MS,
  requestTimeout: REQUEST_TIMEOUT_MS,
});

// CORS: Allow localhost for development + production origins from env
const allowedOrigins: (string | RegExp)[] = [
  /^http:\/\/localhost:\d+$/,
  /^http:\/\/127\.0\.0\.1:\d+$/,
];

if (env.ALLOWED_ORIGINS) {
  // Parse comma-separated list of production origins
  const prodOrigins = env.ALLOWED_ORIGINS.split(",").map((o) => o.trim());
  allowedOrigins.push(...prodOrigins);
}

await app.register(cors, {
  origin: allowedOrigins,
});

// Rate limiting: 10 requests per minute per IP
await app.register(rateLimit, {
  max: RATE_LIMIT_MAX,
  timeWindow: RATE_LIMIT_WINDOW_MS,
  addHeadersOnExceeding: {
    "x-ratelimit-limit": true,
    "x-ratelimit-remaining": true,
    "x-ratelimit-reset": true,
  },
  addHeaders: {
    "x-ratelimit-limit": true,
    "x-ratelimit-remaining": true,
    "x-ratelimit-reset": true,
  },
  errorResponseBuilder: (_req, _context) => {
    // Log rate limit hits for observability
    app.log.warn({ event: "rate_limit_hit", max: RATE_LIMIT_MAX, window_ms: RATE_LIMIT_WINDOW_MS }, "Rate limit exceeded");
    return {
      schema: "error.v1",
      code: "RATE_LIMITED",
      message: "Rate limit exceeded",
      details: { max: RATE_LIMIT_MAX, window_ms: RATE_LIMIT_WINDOW_MS },
    };
  },
});

// Error handler for body size limit and other errors
app.setErrorHandler((error, _request, reply) => {
  // Body size limit exceeded
  if (error.statusCode === 413) {
    app.log.warn({ event: "body_limit_hit", limit_bytes: BODY_LIMIT_BYTES }, "Body size limit exceeded");
    return reply.status(413).send({
      schema: "error.v1",
      code: "BAD_INPUT",
      message: "Request payload too large",
      details: { limit_bytes: BODY_LIMIT_BYTES },
    });
  }

  // Request timeout
  if (error.statusCode === 408 || error.code === "ETIMEDOUT") {
    app.log.warn({ event: "request_timeout", timeout_ms: REQUEST_TIMEOUT_MS }, "Request timeout");
    return reply.status(408).send({
      schema: "error.v1",
      code: "INTERNAL",
      message: "Request timeout",
      details: { timeout_ms: REQUEST_TIMEOUT_MS },
    });
  }

  // Default error handling
  app.log.error({ error }, "Unhandled error");
  return reply.status(error.statusCode || 500).send({
    schema: "error.v1",
    code: "INTERNAL",
    message: error.message || "Internal server error",
  });
});

app.get("/healthz", async () => ({
  ok: true,
  service: "assistants",
  limits_source: env.ENGINE_BASE_URL ? "engine" : "config"
}));

await draftRoute(app);
await suggestRoute(app);

const port = Number(env.PORT || 3101);

app
  .listen({ port, host: "0.0.0.0" })
  .catch((err: unknown) => {
    app.log.error(err);
    process.exit(1);
  });
