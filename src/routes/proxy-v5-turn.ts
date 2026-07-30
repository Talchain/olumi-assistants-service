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
import { emit, log, TelemetryEvents } from "../utils/telemetry.js";
import { ROUTE_TIMEOUT_MS, DRAFT_REQUEST_BUDGET_MS } from "../config/timeouts.js";
import {
  buildSignInRequiredError,
  extractJwtCandidate,
} from "../orchestrator/user-identity.js";
import { recordExplicitTurnStop } from "./turn-stop.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INTERNAL_TARGET = "/orchestrate/v2/turn";

/** Headers forwarded from the browser request to the internal CEE call. */
/** EXPORTED for the streamed sibling — one forwarding policy, not two. */
export const ALLOWED_REQUEST_HEADERS = [
  "content-type",
  "accept",
  "x-correlation-id",
  "x-request-id",
  "x-user-id",
  "x-olumi-client-build",
  "x-olumi-payload-hash",
  // Login 3.4 CEE-half seam: the browser's Supabase access token
  // (`Authorization: Bearer <jwt>`) passes through to the internal turn
  // route, where the flag-gated CEE_REQUIRE_USER_JWT verification consumes
  // it. Inert until the UI sends the header. Service auth is unaffected:
  // the injected x-olumi-assist-key is checked FIRST by the auth plugin.
  "authorization",
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

/**
 * EXPORTED (ROADMAP 2.122, CEE lane 2) so the streamed sibling
 * `/proxy/v5/turn/stream` shares ONE origin policy with this route instead of
 * mirroring it. A second copy of the browser allowlist is trap 12 with a
 * security blast radius.
 */
export function parseAllowedOrigins(): Set<string> {
  const raw = config.proxy.browserProxyAllowedOrigins;
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((o) => o.trim())
      .filter((o) => o.length > 0),
  );
}

/** EXPORTED for the streamed sibling — see parseAllowedOrigins. */
export function isOriginAllowed(origin: string, allowedOrigins: Set<string>): boolean {
  // Exact-match only. Netlify preview patterns are NOT matched by regex here
  // because the global @fastify/cors plugin (which handles OPTIONS preflight)
  // only knows about ALLOWED_ORIGINS — it has no regex support. A preview
  // origin allowed by proxy regex but not by global CORS would pass POST
  // validation but fail OPTIONS preflight, causing a confusing CORS error.
  // List preview/branch origins explicitly in BROWSER_PROXY_ALLOWED_ORIGINS
  // AND in ALLOWED_ORIGINS if CORS preflight is needed.
  return allowedOrigins.has(origin);
}

/**
 * EXPORTED for the streamed sibling.
 *
 * ⚠ The streamed sibling NEEDS these explicitly, and that is not a style choice:
 * an SSE route writes `reply.raw.writeHead` directly, which bypasses the Reply
 * API that `@fastify/cors` stages its headers through. See
 * `streamed-turn-sse.ts` `buildStagedSseHeaders`.
 */
export function buildCorsHeaders(origin: string): Record<string, string> {
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

/**
 * Resolve the service key the proxy injects into its internal call.
 *
 * Prefers the single-key config, falls back to the first entry in the multi-key
 * array — mirroring how `auth.ts` builds its valid-key set from both
 * `ASSIST_API_KEY` and `ASSIST_API_KEYS`. EXPORTED so the streamed sibling
 * injects the SAME key by the SAME rule; two resolutions could disagree and the
 * symptom would be a 401 buried inside a terminal SSE frame.
 */
export function resolveProxyAssistKey(): string | undefined {
  return (
    config.auth.assistApiKey ??
    (config.auth.assistApiKeys && config.auth.assistApiKeys.length > 0
      ? config.auth.assistApiKeys[0]
      : undefined)
  );
}

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
  const assistKey = resolveProxyAssistKey();

  if (!assistKey) {
    log.warn(
      {},
      "[proxy-v5] Neither ASSIST_API_KEY nor ASSIST_API_KEYS is set — internal requests will fail auth. " +
        "Route registered but will return 502 until a key is configured.",
    );
  }

  // Safety invariant: proxy timeout must be < ROUTE_TIMEOUT_MS so the proxy
  // can return structured JSON before Fastify kills the connection.
  // If violated, the proxy cannot fulfill its contract — refuse registration.
  if (timeoutMs >= ROUTE_TIMEOUT_MS) {
    log.error(
      { timeoutMs, routeTimeoutMs: ROUTE_TIMEOUT_MS },
      "[proxy-v5] BROWSER_PROXY_TIMEOUT_MS >= ROUTE_TIMEOUT_MS — proxy cannot return " +
        "structured JSON before Fastify kills the connection. Route NOT registered. " +
        "Reduce BROWSER_PROXY_TIMEOUT_MS below ROUTE_TIMEOUT_MS and restart.",
    );
    return;
  }

  if (timeoutMs < DRAFT_REQUEST_BUDGET_MS) {
    log.warn(
      { timeoutMs, draftBudgetMs: DRAFT_REQUEST_BUDGET_MS },
      "[proxy-v5] BROWSER_PROXY_TIMEOUT_MS < DRAFT_REQUEST_BUDGET_MS — proxy may time out " +
        "before a normal draft graph completes. Consider increasing BROWSER_PROXY_TIMEOUT_MS.",
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

  // State the auth posture of this deployment out loud, at boot.
  //
  // With CEE_REQUIRE_USER_JWT off, this route accepts turns that carry NO
  // caller identity whatsoever. The origin allowlist above does not change
  // that: Origin is a browser-only defence and any non-browser client can
  // send whatever Origin it likes. Owned scenarios are still protected by the
  // pre-flight ownership check (build-turn-context.ts), but GUEST scenarios
  // (scenarios.user_id IS NULL) have no owner to check against, so anyone
  // holding a guest scenario's UUID can read its conversation and append
  // turns to it.
  //
  // This was reported twice by independent reviewers before anyone noticed,
  // because nothing in the running system ever said it. A posture this open
  // should be visible in the boot log of every environment that has it, so
  // that turning it off is a decision someone makes rather than one that
  // silently persists. Non-fatal by design: it is the accepted PoC posture,
  // not a misconfiguration.
  if (config.auth?.requireUserJwt !== true) {
    log.warn(
      {
        require_user_jwt: false,
        originCount: allowedOrigins.size,
      },
      "[proxy-v5] AUTH POSTURE: unauthenticated turns are ACCEPTED (CEE_REQUIRE_USER_JWT is off). " +
        "Origin is not authentication — a non-browser client can forge it. Guest scenarios " +
        "(user_id IS NULL) are readable and writable by anyone holding the scenario UUID. " +
        "Owned scenarios remain protected by the pre-flight ownership check.",
    );
  }

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

    // 2.5. Flag-gated required-login front door (login 3.4 CEE-half,
    // CEE_REQUIRE_USER_JWT default OFF — dormant today). This proxy is the
    // browser-facing turn surface, so "this is a browser request" is
    // structural truth HERE — no request-header trust involved. When the
    // flag is on, a turn without a JWT-shaped Authorization header is
    // refused with the same typed recoverable sign_in_required
    // BoundaryError the internal route emits for invalid/expired tokens,
    // so the UI sees one wire shape for "sign in required". Tokens that
    // ARE present are verified downstream in the shared pre-flight
    // (runPreFlight → resolveUserIdentity), which derives user identity
    // from the verified `sub`. Direct key-authed service callers hitting
    // /orchestrate/v2/turn are NOT affected by this check — their
    // carve-out is documented in src/orchestrator/user-identity.ts.
    if (config.auth?.requireUserJwt === true && extractJwtCandidate(request.headers.authorization) === null) {
      log.warn({ requestId }, "[proxy-v5] Rejected: sign-in required (no user JWT presented)");
      emit(TelemetryEvents.UserJwtRefused, {
        request_id: requestId,
        reason: "missing_token",
        via_browser_proxy: true,
      });
      const cors = buildCorsHeaders(origin as string);
      for (const [k, v] of Object.entries(cors)) {
        reply.header(k, v);
      }
      return reply.code(401).send(buildSignInRequiredError("missing_token", requestId));
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

    // Pre-timeout rejections are handled by the try/catch around Promise.race
    // below. Post-timeout rejections (after the race settled on "timeout") are
    // unobserved by the race callback and would surface as an unhandled
    // rejection. Track whether the timeout fired so this catch only logs the
    // genuinely-late case — pre-timeout rejections are handled below and the
    // duplicate observation here would log a misleading "late" message.
    let timedOut = false;
    injectPromise.catch((err: unknown) => {
      if (timedOut) {
        log.warn({ requestId, err }, "[proxy-v5] Late internal-inject rejection after proxy timeout");
      }
    });

    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<"timeout">((resolve) => {
      timeoutTimer = setTimeout(() => {
        timedOut = true;
        resolve("timeout");
      }, timeoutMs);
    });

    let result: Awaited<typeof injectPromise> | "timeout";
    try {
      result = await Promise.race([injectPromise, timeoutPromise]);
    } catch (injectErr) {
      if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
      const duration = Date.now() - startTime;
      log.error(
        { requestId, duration, err: injectErr },
        "[proxy-v5] Internal inject rejected before timeout",
      );
      const cors = buildCorsHeaders(origin as string);
      for (const [k, v] of Object.entries(cors)) reply.header(k, v);
      return reply.code(502).send({
        error: {
          code: "PROXY_INTERNAL_ERROR",
          message: "Internal service error.",
          source: "proxy",
          request_id: requestId,
          upstream_duration_ms: duration,
        },
      });
    }

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
      // Do not log the raw body — it may contain user content. Log length only.
      log.error(
        { requestId, status: injectResponse.statusCode, bodyLength: injectResponse.body.length },
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

  // ══════════════════════════════════════════════════════════════════════════
  // POST /proxy/v5/turn/stop — THE EXPLICIT USER STOP, MADE SERVER-VISIBLE
  //
  // Until this existed, pressing Stop aborted the browser's own fetch and
  // nothing else: no cancel endpoint existed anywhere in CEE, and
  // `streamed-turn-sse.ts:71-78` deliberately does not cancel a turn on
  // hangup. Live-reproduced consequence (evidence
  // PHASE0-EVIDENCE-2026-07-28/fix-stop-fence.md): a draft stopped at +4.0s
  // ran the full 52.7s, committed, and OVERWROTE the graph of a later turn
  // the user had sent in the meantime.
  //
  // ⚠ THIS ROUTE DOES NOT CANCEL THE TURN, AND THAT IS THE DESIGN. It records
  //   a tombstone; the turn keeps running and its WRITE is refused at the
  //   commit chokepoint. Killing the in-flight pipeline is exactly what the
  //   #751 arc rejected — a turn destroyed mid-flight can leave a scenario
  //   half-applied. So the observable difference between an explicit Stop and
  //   an incidental disconnect is ONE thing: whether a tombstone exists. A
  //   disconnect sends nothing, has no tombstone, and still commits.
  //
  // ⚠ THE /orchestrate SIBLING IS NOT OPTIONAL — I first shipped this without
  //   one, on the argument that only a browser can press Stop. That argument was
  //   WRONG, and the derivation is what corrected it: the UI derives its stop URL
  //   as `<buffered endpoint>/stop`, and the buffered endpoint resolves to the
  //   Netlify edge rung (`/bff/orchestrate/v2/turn`) on any deployment that does
  //   not bake VITE_V5_ENDPOINT. Without the sibling, that rung 404s and the UI
  //   can never confirm a Stop on it. Both exist; ONE handler
  //   (`recordExplicitTurnStop`) serves them.
  //
  // Auth posture is INHERITED from POST /proxy/v5/turn above, unchanged: origin
  // allowlist, no caller identity, guest scenarios addressable by anyone
  // holding the UUID. That is not widened here — a caller who can stop a turn
  // on a scenario is already a caller who can APPEND turns to it, which is
  // strictly more power.
  // ══════════════════════════════════════════════════════════════════════════
  app.post("/proxy/v5/turn/stop", async (request: FastifyRequest, reply: FastifyReply) => {
    const requestId =
      (request.headers["x-request-id"] as string) ?? crypto.randomUUID();

    // Ingress concerns ONLY — origin allowlist + CORS. Everything else is
    // `recordExplicitTurnStop`, shared with the /orchestrate sibling.
    const origin = request.headers.origin;
    if (!origin || !isOriginAllowed(origin as string, allowedOrigins)) {
      log.warn({ origin, requestId }, "[proxy-v5] stop rejected: origin not allowed");
      return reply.code(403).send({
        error: {
          code: "PROXY_ORIGIN_REJECTED",
          message: "Origin not allowed",
          source: "proxy",
          request_id: requestId,
        },
      });
    }
    for (const [k, v] of Object.entries(buildCorsHeaders(origin as string))) {
      reply.header(k, v);
    }

    const result = await recordExplicitTurnStop(request.body, requestId);
    return reply.code(result.status).send(result.body);
  });
}
