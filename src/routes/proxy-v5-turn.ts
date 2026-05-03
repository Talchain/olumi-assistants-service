/**
 * Browser-safe proxy for V5 turns — bypasses Netlify Edge timeout.
 *
 * Route: POST /proxy/v5/turn
 *
 * This proxy exists because the Netlify Edge Function at /bff/orchestrate/*
 * has a ~40 s response-header timeout. V5 draft graph generation routinely
 * takes 40-60 s and the Edge infrastructure kills the connection before CEE
 * can respond. This route runs inside the CEE Fastify process on Render and
 * forwards the request internally via app.inject(), avoiding any intermediate
 * gateway timeout.
 *
 * Security model:
 * - The route is "public" in the auth-plugin sense (no X-Olumi-Assist-Key
 *   required from the browser). Auth bypass is declared in auth.ts isPublicRoute().
 * - The proxy enforces its own origin allowlist (BROWSER_PROXY_ALLOWED_ORIGINS).
 *   Non-browser callers can forge the Origin header, so origin validation is
 *   a browser defence — not a substitute for server-side auth. The service key
 *   is injected internally and never exposed. The proxy only forwards to the
 *   local /orchestrate/v2/turn route, not to arbitrary URLs.
 * - X-Olumi-Assist-Key is injected into the internal app.inject() call and
 *   is NEVER included in the response to the browser.
 *
 * Gated by: BROWSER_PROXY_ENABLED (default: false)
 *
 * Environment variables:
 * - BROWSER_PROXY_ENABLED — master switch (default: false)
 * - BROWSER_PROXY_ALLOWED_ORIGINS — comma-separated origin allowlist
 * - BROWSER_PROXY_TIMEOUT_MS — timeout for the internal inject call (default: 125 000 ms)
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { config } from "../config/index.js";
import { log } from "../utils/telemetry.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INTERNAL_TARGET = "/orchestrate/v2/turn";

/** Headers forwarded from the browser request to the internal CEE call. */
const ALLOWED_REQUEST_HEADERS = [
  "content-type",
  "accept",
  "x-correlation-id",
  "x-request-id",
  "x-user-id",
  "x-olumi-client-build",
  "x-olumi-payload-hash",
] as const;

/** Response headers safe to propagate back to the browser. */
const SAFE_RESPONSE_HEADERS = [
  "content-type",
  "x-olumi-service",
  "x-olumi-service-build",
  // x-olumi-response-hash intentionally excluded: the proxy parses and
  // reserializes the response body, so the original hash may not match
  // the downstream bytes. Forwarding a stale hash would mislead callers.
  "x-request-id",
  "x-olumi-trace-received",
  "x-olumi-downstream-calls",
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseAllowedOrigins(): Set<string> {
  const raw = config.proxy.browserProxyAllowedOrigins;
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((o) => o.trim())
      .filter((o) => o.length > 0),
  );
}

function isOriginAllowed(origin: string, allowedOrigins: Set<string>): boolean {
  // Exact-match only. Netlify preview patterns are NOT matched by regex here
  // because the global @fastify/cors plugin (which handles OPTIONS preflight)
  // only knows about ALLOWED_ORIGINS — it has no regex support. A preview
  // origin allowed by proxy regex but not by global CORS would pass POST
  // validation but fail OPTIONS preflight, causing a confusing CORS error.
  // List preview/branch origins explicitly in BROWSER_PROXY_ALLOWED_ORIGINS
  // AND in ALLOWED_ORIGINS if CORS preflight is needed.
  return allowedOrigins.has(origin);
}

function buildCorsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Accept, X-Correlation-Id, X-Request-Id, X-User-Id, X-Olumi-Client-Build, X-Olumi-Payload-Hash",
    Vary: "Origin, Access-Control-Request-Headers",
  };
}

/** Pick headers from an InjectResponse that are safe to return to the browser. */
function pickSafeResponseHeaders(
  injectHeaders: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const name of SAFE_RESPONSE_HEADERS) {
    const value = injectHeaders[name];
    if (typeof value === "string") {
      safe[name] = value;
    } else if (Array.isArray(value) && value.length > 0) {
      safe[name] = value[0];
    }
  }
  return safe;
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export async function proxyV5TurnRoute(app: FastifyInstance): Promise<void> {
  if (!config.proxy.browserProxyEnabled) {
    log.info({}, "[proxy-v5] BROWSER_PROXY_ENABLED is false — route not registered");
    return;
  }

  const allowedOrigins = parseAllowedOrigins();
  const timeoutMs = config.proxy.browserProxyTimeoutMs;

  // Resolve the service key: prefer the single-key config, fall back to the
  // first entry in the multi-key array. This mirrors how auth.ts builds its
  // valid-key set from both ASSIST_API_KEY and ASSIST_API_KEYS.
  const assistKey =
    config.auth.assistApiKey ??
    (config.auth.assistApiKeys && config.auth.assistApiKeys.length > 0
      ? config.auth.assistApiKeys[0]
      : undefined);

  if (!assistKey) {
    log.warn(
      {},
      "[proxy-v5] Neither ASSIST_API_KEY nor ASSIST_API_KEYS is set — internal requests will fail auth. " +
        "Route registered but will return 502 until a key is configured.",
    );
  }

  if (allowedOrigins.size === 0) {
    log.warn(
      {},
      "[proxy-v5] BROWSER_PROXY_ALLOWED_ORIGINS is empty — all origins will be rejected. " +
        "Set this env var to a comma-separated list of allowed origins.",
    );
  }

  log.info(
    {
      timeoutMs,
      originCount: allowedOrigins.size,
      target: INTERNAL_TARGET,
    },
    "[proxy-v5] Browser proxy registered: POST /proxy/v5/turn",
  );

  // NOTE: OPTIONS preflight is handled by @fastify/cors (registered in server.ts
  // with preflightContinue: false). That plugin intercepts OPTIONS before route
  // handlers, so a manual app.options() here would be dead code. The CORS
  // allowed-headers and exposed-headers are declared in server.ts's
  // DEFAULT_ALLOWED_HEADERS and the cors registration's exposedHeaders.

  // ---- POST (proxy) ----
  app.post("/proxy/v5/turn", async (request: FastifyRequest, reply: FastifyReply) => {
    const startTime = Date.now();
    const requestId =
      (request.headers["x-request-id"] as string) ?? crypto.randomUUID();

    // 1. Origin validation
    const origin = request.headers.origin;
    if (!origin || !isOriginAllowed(origin as string, allowedOrigins)) {
      log.warn({ origin, requestId }, "[proxy-v5] Rejected: origin not allowed");
      return reply.code(403).send({
        error: {
          code: "PROXY_ORIGIN_REJECTED",
          message: "Origin not allowed",
          source: "proxy",
          request_id: requestId,
        },
      });
    }

    // 2. Content-type guard (origin already validated — include CORS headers
    //    so the browser can read the error body instead of seeing a CORS failure)
    const ct = request.headers["content-type"];
    if (!ct || !ct.includes("application/json")) {
      const cors = buildCorsHeaders(origin as string);
      for (const [k, v] of Object.entries(cors)) {
        reply.header(k, v);
      }
      return reply.code(415).send({
        error: {
          code: "PROXY_UNSUPPORTED_MEDIA_TYPE",
          message: "Content-Type must be application/json",
          source: "proxy",
          request_id: requestId,
        },
      });
    }

    // 3. Build internal request headers
    const internalHeaders: Record<string, string> = {};
    for (const name of ALLOWED_REQUEST_HEADERS) {
      const value = request.headers[name];
      if (typeof value === "string") {
        internalHeaders[name] = value;
      }
    }
    // Inject service auth — this key NEVER leaves the process
    if (assistKey) {
      internalHeaders["x-olumi-assist-key"] = assistKey;
    }
    // Propagate request ID
    internalHeaders["x-request-id"] = requestId;

    // 4. Internal routing via app.inject()
    // app.inject() runs the request through the full Fastify hook chain
    // (auth, validation, handler) without an HTTP round-trip. It does NOT
    // traverse the Render gateway, so the only timeout is ROUTE_TIMEOUT_MS.
    // However, it does not support AbortSignal — we use Promise.race to
    // enforce the proxy timeout. If the timeout fires, the internal request
    // continues until ROUTE_TIMEOUT_MS kills it; this is acceptable because
    // CEE's own budgets (V5 DRAFT_REQUEST_BUDGET_MS / LLM timeouts) terminate
    // the LLM call independently.
    const bodyString =
      typeof request.body === "string"
        ? request.body
        : JSON.stringify(request.body);

    const injectPromise = app.inject({
      method: "POST",
      url: INTERNAL_TARGET,
      headers: internalHeaders,
      payload: bodyString,
    });

    // Suppress any rejection from injectPromise that arrives after the race
    // settles on "timeout". Without this, a late rejection (e.g. from
    // ROUTE_TIMEOUT_MS killing the internal route) becomes an unhandled
    // rejection. The catch is a no-op — we've already returned 504.
    injectPromise.catch((err: unknown) => {
      log.warn({ requestId, err }, "[proxy-v5] Late internal-inject rejection after proxy timeout");
    });

    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<"timeout">((resolve) => {
      timeoutTimer = setTimeout(() => resolve("timeout"), timeoutMs);
    });

    const result = await Promise.race([injectPromise, timeoutPromise]);

    // Clear the timeout timer to avoid leaking timers when inject finishes first
    if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);

    // 5. Handle timeout
    if (result === "timeout") {
      const duration = Date.now() - startTime;
      log.warn(
        { requestId, duration, timeoutMs },
        "[proxy-v5] Upstream timeout — internal route did not respond in time",
      );
      const cors = buildCorsHeaders(origin as string);
      for (const [k, v] of Object.entries(cors)) {
        reply.header(k, v);
      }
      return reply.code(504).send({
        error: {
          code: "PROXY_UPSTREAM_TIMEOUT",
          message: `The model generation service did not respond within ${Math.round(timeoutMs / 1000)}s. Please try again.`,
          upstream_duration_ms: duration,
          source: "proxy",
          request_id: requestId,
        },
      });
    }

    // 6. Forward response
    const injectResponse = result;
    const duration = Date.now() - startTime;

    // CORS headers
    const cors = buildCorsHeaders(origin as string);
    for (const [k, v] of Object.entries(cors)) {
      reply.header(k, v);
    }

    // Safe response headers from CEE
    const safeHeaders = pickSafeResponseHeaders(
      injectResponse.headers as Record<string, string | string[] | undefined>,
    );
    for (const [k, v] of Object.entries(safeHeaders)) {
      reply.header(k, v);
    }

    // Diagnostic: proxy-specific headers
    reply.header("x-proxy-duration-ms", String(duration));
    reply.header("x-proxy-source", "cee-browser-proxy");

    // Security: ensure the service key is NEVER in the response
    reply.removeHeader("x-olumi-assist-key");

    // app.inject() returns body as a raw string. If we pass a string to
    // reply.send() with content-type: application/json, Fastify will
    // JSON.stringify it again (double-encoding). Parse first so Fastify
    // serializes the object correctly.
    let responseBody: unknown;
    try {
      responseBody = JSON.parse(injectResponse.body);
    } catch {
      // Non-JSON internal response — should not happen in normal operation.
      // Return a structured JSON 502 so the browser always gets parseable JSON.
      const truncated = injectResponse.body.length > 200
        ? injectResponse.body.slice(0, 200) + "..."
        : injectResponse.body;
      log.error(
        { requestId, status: injectResponse.statusCode, body: truncated },
        "[proxy-v5] Internal route returned non-JSON body",
      );
      return reply.code(502).send({
        error: {
          code: "PROXY_INTERNAL_NON_JSON",
          message: "Internal service returned a non-JSON response.",
          source: "proxy",
          request_id: requestId,
          upstream_status: injectResponse.statusCode,
        },
      });
    }

    return reply.code(injectResponse.statusCode).send(responseBody);
  });
}
