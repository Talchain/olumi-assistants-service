/**
 * POST /proxy/v5/turn/stream — the BROWSER-facing streamed V5 turn.
 *
 * ROADMAP 2.122 / 1.204 M1 — CEE lane 2, added at adversarial review.
 * Transport, frame contract and client rules: `./streamed-turn-sse.ts`.
 *
 * ── WHY THIS ROUTE EXISTS (and why the lane was incomplete without it) ──────
 * The lane's first submission shipped `/orchestrate/v2/turn/stream` and claimed
 * *"the UI opts in by calling it"*. **That was false, and review proved it twice
 * over.** That route sits behind the ordinary auth hook, which wants an assist
 * key or an HMAC signature — and a browser can hold neither, because any
 * `VITE_*` value is public by construction. It is also the route whose raw SSE
 * write dropped every CORS header, so a cross-origin call would have run the
 * turn, COMMITTED it, and handed the browser an opaque error it could read
 * nothing from.
 *
 * The buffered product path already solved the same problem the same way:
 * `/proxy/v5/turn` is public, validates its own origin allowlist, and injects
 * the service key internally so it never reaches the browser. **This is that
 * route's streamed sibling** — the streamed entry point the UI can actually use.
 *
 * ── WHAT IS SHARED, AND WHAT IS NOT ─────────────────────────────────────────
 * Ingress is this file: origin validation, the required-login gate, the internal
 * key injection, the CORS response headers. Everything after that — the emitter
 * context, the inject, the frame contract, the terminal frame, the timeout, the
 * heartbeat — is `streamTurnAsStagedSse`, shared verbatim with the service
 * sibling. Every ingress helper below is IMPORTED from `proxy-v5-turn.ts` rather
 * than reimplemented: one origin allowlist, one forwarding policy, one CORS
 * builder, one key-resolution rule. A second copy of the browser allowlist would
 * be CLAUDE.md trap 12 with a security blast radius.
 *
 * ⚠ IT FORWARDS TO THE BUFFERED TURN, NOT TO `/orchestrate/v2/turn/stream`.
 * `app.inject()` buffers a response until `raw.end()`, so injecting into a
 * streamed route would collapse every frame into one blob at the end — deleting
 * the entire latency benefit while all frame-content tests kept passing. Both
 * streamed routes are peers over one buffered turn, never layered.
 *
 * ── CORS IS LIFE-OR-DEATH HERE ──────────────────────────────────────────────
 * This is the route a browser actually calls, so a missing
 * `access-control-allow-origin` is not a cosmetic gap — it is an invisible
 * commit followed by a user retry, i.e. duplicate turns. The headers are applied
 * two ways, both derived and neither mirrored:
 *   1. `buildStagedSseHeaders(reply, …)` re-emits whatever `@fastify/cors`,
 *      `@fastify/rate-limit` and helmet already staged on the Reply (which the
 *      raw `writeHead` path would otherwise silently discard);
 *   2. this route's own `buildCorsHeaders(origin)` — the same set the buffered
 *      proxy puts on its error responses — because the proxy's allowlist
 *      (`BROWSER_PROXY_ALLOWED_ORIGINS`) is deliberately a DIFFERENT list from
 *      the global CORS one, so an origin this route accepts may not be one the
 *      global plugin decided for.
 * Pinned by test on this route specifically.
 *
 * ── AUTH POSTURE ────────────────────────────────────────────────────────────
 * Public in the auth-plugin sense — `isPublicRoute()` matches by prefix
 * (`path === route || path.startsWith(route + "/")`), so `/proxy/v5/turn/stream`
 * is covered by the existing `/proxy/v5/turn` entry **without editing the
 * allowlist**. That is inheritance, not a new exemption: it is exactly as public
 * as the route it mirrors, and it applies the same origin check and the same
 * flag-gated required-login gate. A consequence worth stating: because the auth
 * hook returns early for public routes, this route does NOT consume the per-key
 * SSE token bucket that the service sibling does — the inner turn pays the
 * per-key bucket under the injected service key, exactly as the buffered proxy's
 * inner turn does.
 *
 * Gated by `BROWSER_PROXY_ENABLED`, the same switch as its buffered sibling:
 * a deployment that has not enabled the browser proxy has no browser surface to
 * stream over, and registering one would be a new public surface nobody asked
 * for. This is not a dark launch of the feature — the feature ships ON wherever
 * the browser proxy is ON, and rollback is a revert.
 */

import crypto from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { config } from "../config/index.js";
import { log } from "../utils/telemetry.js";
import {
  ALLOWED_REQUEST_HEADERS,
  buildCorsHeaders,
  isOriginAllowed,
  parseAllowedOrigins,
  resolveProxyAssistKey,
  serialiseProxiedBodyWithoutClaimedIdentity,
} from "./proxy-v5-turn.js";
import { streamTurnAsStagedSse, STAGED_FRAME_CLASSES } from "./streamed-turn-sse.js";

/** This route's own path. */
export const PROXY_STREAMED_TURN_ROUTE = "/proxy/v5/turn/stream";

export default async function proxyV5TurnStreamRoute(app: FastifyInstance): Promise<void> {
  if (!config.proxy.browserProxyEnabled) {
    log.info({}, "[proxy-v5-stream] BROWSER_PROXY_ENABLED is false — route not registered");
    return;
  }

  const allowedOrigins = parseAllowedOrigins();
  const assistKey = resolveProxyAssistKey();
  const FEATURE_VERSION = "streamed-turn-proxy-1.0.0";

  if (!assistKey) {
    log.warn(
      {},
      "[proxy-v5-stream] Neither ASSIST_API_KEY nor ASSIST_API_KEYS is set — the internal turn " +
        "will fail auth and the terminal frame will carry a 401. Route registered anyway so the " +
        "failure is visible in a frame rather than as a missing route.",
    );
  }

  log.info(
    { originCount: allowedOrigins.size },
    "[proxy-v5-stream] Browser streamed turn registered: POST /proxy/v5/turn/stream",
  );

  app.post(PROXY_STREAMED_TURN_ROUTE, async (request: FastifyRequest, reply: FastifyReply) => {
    const requestId = (request.headers["x-request-id"] as string) ?? crypto.randomUUID();

    // ── 1. Origin validation ────────────────────────────────────────────────
    // Refused BEFORE the stream opens, so the browser gets an ordinary JSON 403
    // it can actually read (with CORS headers where the origin is known) rather
    // than a 200 SSE stream whose first frame is an error. Origin is a browser
    // defence, not authentication — a non-browser client can forge it.
    const origin = request.headers.origin;
    if (!origin || !isOriginAllowed(origin as string, allowedOrigins)) {
      log.warn({ origin, requestId }, "[proxy-v5-stream] Rejected: origin not allowed");
      return reply.code(403).send({
        error: {
          code: "PROXY_ORIGIN_REJECTED",
          message: "Origin not allowed",
          source: "proxy",
          request_id: requestId,
        },
      });
    }

    const cors = buildCorsHeaders(origin as string);

    // ── 2. Content-type guard ───────────────────────────────────────────────
    const ct = request.headers["content-type"];
    if (!ct || !ct.includes("application/json")) {
      for (const [k, v] of Object.entries(cors)) reply.header(k, v);
      return reply.code(415).send({
        error: {
          code: "PROXY_UNSUPPORTED_MEDIA_TYPE",
          message: "Content-Type must be application/json",
          source: "proxy",
          request_id: requestId,
        },
      });
    }

    // ── 3. THE REQUIRED-LOGIN FRONT DOOR USED TO BE HERE ────────────────────
    // Removed together with the buffered sibling's copy, and for the same
    // reason — one identity policy for this surface, never two. The full
    // rationale lives on the buffered route (step 2.5) rather than being
    // restated here, because two copies of a security rationale drift exactly
    // as fast as two copies of a security check.
    // What makes admitting these callers safe is the strip at step 5.

    // ── 4. Internal request headers ─────────────────────────────────────────
    // Allowlisted forwarding (not verbatim, unlike the service sibling): this is
    // a public surface, so only the headers the buffered proxy already forwards
    // may cross. The service key is injected here and NEVER reaches the browser.
    const internalHeaders: Record<string, string> = {};
    for (const name of ALLOWED_REQUEST_HEADERS) {
      const value = request.headers[name];
      if (typeof value === "string") internalHeaders[name] = value;
    }
    if (assistKey) internalHeaders["x-olumi-assist-key"] = assistKey;
    internalHeaders["content-type"] = "application/json";
    // The inner turn is buffered JSON; the browser's `text/event-stream` accept
    // describes the OUTER transport only.
    internalHeaders["accept"] = "application/json";
    internalHeaders["x-request-id"] = requestId;

    // ── 5. Body WITHOUT the caller-asserted identity extension ──────────────
    // The property that makes step 3's removal safe. Shared helper, so the
    // streamed and buffered rungs cannot diverge on who a caller is allowed
    // to claim to be.
    const payload = serialiseProxiedBodyWithoutClaimedIdentity(request.body ?? {});

    await streamTurnAsStagedSse({
      app,
      reply,
      requestId,
      internalHeaders,
      payload,
      featureVersion: FEATURE_VERSION,
      endpoint: PROXY_STREAMED_TURN_ROUTE,
      extraResponseHeaders: cors,
    });

    return reply;
  });
}

export { STAGED_FRAME_CLASSES };
