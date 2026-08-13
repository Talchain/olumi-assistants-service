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
import { ROUTE_TIMEOUT_MS, DRAFT_REQUEST_BUDGET_MS } from "../config/timeouts.js";
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

/**
 * Serialise a browser-supplied turn body for the internal call, with the
 * caller-asserted `user_id` identity extension REMOVED.
 *
 * ── WHY THIS EXISTS, AND WHY IT IS THE LOAD-BEARING PART ────────────────────
 * This proxy admits unauthenticated visitors, so that a tester can open the
 * staging URL and use the product without signing in. On its own, admitting
 * them would be strictly WORSE than refusing them: `resolveUserIdentity`
 * answers `service_legacy` for a JWT-less caller, and in every mode except
 * `verified`, `authorizeScenarioOwnership` sets
 * `effectiveUserId = claimedUserId` — the caller-supplied body `user_id`. So
 * "anyone may send a turn" would have meant "anyone may send a turn AS ANYONE",
 * which is exactly the hole the 2026-08-12 flip closed.
 *
 * Removing that field here is what keeps it closed. An anonymous caller can
 * then only ever be anonymous, and `preflightEnsureScenario` does the rest: it
 * REFUSES an anonymous caller on an owned scenario (IDOR fail-closed) and
 * carves out unowned GUEST scenarios by design. Identity on this surface now
 * comes from ONE place — a verified JWT — and from nowhere else.
 *
 * The strip is UNCONDITIONAL, not "when there is no JWT". In `verified` mode
 * the JWT `sub` already overrides any body `user_id`, so this changes no
 * behaviour for a signed-in caller; making it unconditional means the
 * guarantee does not DEPEND on that override continuing to hold, and a future
 * change to the override cannot silently reopen the seam.
 *
 * Scope, derived rather than assumed: `body.user_id` is the ONLY channel that
 * can assert identity on the turn seam. `parseRequestExtensions`
 * (orchestrator-v5/boundary/request-extensions.ts) reads that key and no other,
 * and `x-user-id` — which this proxy DOES forward — has no reader anywhere in
 * `src/` outside comments and the CORS/forwarding allowlists (swept with a
 * contrast control: `authorization` returns nine readers).
 *
 * EXPORTED for the streamed sibling and used by all three browser rungs, so
 * there is ONE identity policy for this surface rather than three. A second
 * copy would be CLAUDE.md trap 12 with a security blast radius — and the
 * asymmetry it would create is not hypothetical: the Stop rung never had the
 * front door the other two did.
 */
export function serialiseProxiedBodyWithoutClaimedIdentity(body: unknown): string {
  let value: unknown = body;

  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      // Not JSON we can inspect — forward it verbatim, exactly as this route
      // did before the strip existed. The internal route is the parser of
      // record and will reject it. A body that does not parse also cannot
      // carry a top-level `user_id` for the extension parser to read, so
      // nothing escapes through here.
      return body as string;
    }
  }

  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return JSON.stringify(value ?? {});
  }

  // Copy-then-delete rather than destructuring: a `{ user_id: _unused, ...rest }`
  // rest-pattern trips `@typescript-eslint/no-unused-vars`, and lint runs
  // FIRST in the required check — a green test suite says nothing about a
  // step that gates it.
  const withoutIdentity: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  delete withoutIdentity.user_id;
  return JSON.stringify(withoutIdentity);
}

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

/**
 * 2.174 fix a — the public Stop rung's per-IP budget, pinned by
 * turn-stop-hardening.test.ts. Constants (not env) per the no-env-var-gates
 * doctrine; the window matches the global limiter's.
 */
export const TURN_STOP_RATE_LIMIT_MAX = 30;
export const TURN_STOP_RATE_LIMIT_WINDOW = "1 minute";

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
  // ⚠ THIS WARNING USED TO BE GATED ON `requireUserJwt !== true`, and leaving
  // it that way would have been a broken alarm of the worst kind: the removal
  // of the front door makes "unauthenticated turns are ACCEPTED" true in BOTH
  // postures, so a flag-gated warning would have fallen SILENT at the exact
  // moment its sentence became unconditional. Its own negative-control test
  // would have certified that silence. The condition moved; the disclosure
  // must move with it.
  //
  // This route accepts turns that carry NO caller identity. The origin
  // allowlist above does not change that: Origin is a browser-only defence and
  // any non-browser client can forge it. Owned scenarios are still protected
  // by the pre-flight ownership check (build-turn-context.ts) — and, since the
  // proxy strips the caller-asserted `user_id`, an anonymous caller cannot
  // present themselves as an owner. But GUEST scenarios (user_id IS NULL) have
  // no owner to check against, so anyone holding a guest scenario's UUID can
  // read its conversation and append turns to it.
  //
  // The posture was reported twice by independent reviewers before anyone
  // noticed, because nothing in the running system ever said it. Non-fatal by
  // design: it is the accepted PoC posture, not a misconfiguration.
  log.warn(
    {
      guest_turns_accepted: true,
      require_user_jwt: config.auth?.requireUserJwt === true,
      originCount: allowedOrigins.size,
    },
    "[proxy-v5] AUTH POSTURE: unauthenticated turns are ACCEPTED — this proxy admits a turn " +
      "with no credential at all, by design, so a visitor can use the product without signing in. " +
      "Origin is not authentication — a non-browser client can forge it. Guest scenarios " +
      "(user_id IS NULL) are readable and writable by anyone holding the scenario UUID. " +
      "Owned scenarios remain protected by the pre-flight ownership check, and the caller-asserted " +
      "user_id is stripped from every browser body, so an anonymous caller cannot claim to be one.",
  );

  // The flag still discriminates — it just discriminates about something
  // else now. With it OFF, a presented Bearer is never parsed, so a SIGNED-IN
  // user is anonymous to the ownership check and is refused on their own
  // scenario. That is a distinct, quieter failure than the one above and it
  // needs its own line, or a deployment that silently breaks every signed-in
  // user says nothing at boot about why.
  if (config.auth?.requireUserJwt !== true) {
    log.warn(
      {
        require_user_jwt: false,
        originCount: allowedOrigins.size,
      },
      "[proxy-v5] AUTH POSTURE: user JWTs are NOT verified (CEE_REQUIRE_USER_JWT is off). " +
        "A presented Bearer is never parsed, so a signed-in caller is anonymous to the ownership " +
        "pre-flight and will be refused on their OWN scenario. Turn it on to recognise signed-in users.",
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

    // 2.5. THE REQUIRED-LOGIN FRONT DOOR USED TO BE HERE. It is deliberately
    // gone, and what replaced it is the body strip at step 5.
    //
    // It refused any turn whose `Authorization` header was not JWT-SHAPED when
    // CEE_REQUIRE_USER_JWT was on. Note what it actually tested: the presence
    // and shape of one header. It knew nothing about the scenario, its owner,
    // or the body, and it ran before the body was parsed — so a guest never
    // reached the ownership pre-flight that would have ADMITTED them, because
    // a guest scenario has a NULL owner and `preflightEnsureScenario` carves
    // that case out by design. The gate was refusing people the ownership
    // model already had an answer for.
    //
    // Keeping it meant guest use and signed-in use were mutually exclusive by
    // configuration: with the flag on a visitor got 401 `sign_in_required`,
    // and with it off a signed-in user got 422 on their OWN scenario (the
    // Bearer is never parsed in that posture, so they are anonymous to the
    // ownership check) AND the forgeable body-`user_id` channel reopened.
    // Removing this gate while STRIPPING that field serves both populations
    // and leaves the forgery closed — which neither value of the flag could do.
    //
    // The flag itself is untouched and still governs what it should: whether a
    // PRESENTED token is verified downstream (`resolveUserIdentity`), and
    // therefore whether a signed-in user is recognised as themselves. An
    // invalid or expired token is still refused there with the same typed
    // recoverable `sign_in_required` BoundaryError, so the UI's one wire shape
    // for "sign in required" still exists — it now means "your token is bad",
    // never "you have no token".

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
    // 5. Serialise the body WITHOUT the caller-asserted identity extension.
    // This is what makes admitting unauthenticated callers safe — see the
    // helper's own note. It is not an optimisation and it is not hygiene:
    // delete it and this route grants any visitor the ability to act as any
    // user they can name by UUID.
    const bodyString = serialiseProxiedBodyWithoutClaimedIdentity(request.body);

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
  // ⚠⚠ THIS BLOCK USED TO SAY the Stop rung widened nothing, "because a caller
  //   who can stop a turn on a scenario is already a caller who can APPEND
  //   turns to it, which is strictly more power". THAT WAS FALSE, it was the
  //   sentence that made the hole look reviewed, and it survived a review and a
  //   deploy. Appending is gated by the turn route's scenario-ownership
  //   pre-flight (it refuses an anonymous caller on an OWNED scenario);
  //   stopping was gated by NOTHING but this origin allowlist. On an owned
  //   scenario the Stop rung therefore granted MORE authority than the turn
  //   rung — the exact inverse — and an invented `turn_id` could supersede a
  //   stranger's in-flight turn into losing its graph write. Codex audit C
  //   finding C-1; fixed under ROADMAP 2.236.
  //
  // Auth posture NOW: this rung is still PUBLIC at the plugin (the `/proxy/v5/turn`
  // prefix rule in src/plugins/auth.ts covers every subpath), and origin +
  // per-IP rate limit remain INGRESS concerns only — neither is authority.
  // Authorization lives in the shared handler, where Stop runs the SAME
  // verified-identity + scenario-ownership pre-flight as turn admission and
  // additionally requires the turn to have been admitted. Guest (unowned)
  // scenarios stay addressable by anyone holding the UUID, exactly as on a
  // turn — the two rungs now grant the same thing, which is the property that
  // was missing. See src/routes/turn-stop.ts.
  // ══════════════════════════════════════════════════════════════════════════
  app.post("/proxy/v5/turn/stop", {
    // 2.174 fix a — the PUBLIC rung is rate-limited per IP with the repo's
    // own limiter (@fastify/rate-limit, registered `global: true` in
    // server.ts; this route config overrides its max for exactly this
    // route). 30/min is generous for a human — a Stop is a click on a
    // running draft — and 4× tighter than the global 120 rpm an abuser
    // otherwise gets for tombstone spray. The /orchestrate sibling stays on
    // the global limit: it is service-key gated at ingress.
    config: {
      rateLimit: {
        max: TURN_STOP_RATE_LIMIT_MAX,
        timeWindow: TURN_STOP_RATE_LIMIT_WINDOW,
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
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

    // The SAME identity policy as the two turn rungs, and this one closes a
    // channel that was open BEFORE the front door was removed.
    //
    // This rung never HAD the front door: it was added under 2.236 with origin
    // + rate limit as its only ingress checks, on the reasoning that
    // authorization belongs in the shared handler. That is right, and the
    // handler does run the same ownership pre-flight — but the handler honours
    // a body `user_id` as the identity whenever the mode is not `verified`
    // (the documented service-caller carve-out). So a JWT-less browser caller
    // could assert `user_id: <owner>` and stop a stranger's admitted turn,
    // costing it its graph write — the exact harm 2.236 exists to prevent,
    // reached through the one door that check does not cover. Measured at
    // 219490ec: 200 and a fence row written.
    //
    // `recordExplicitTurnStop` reads `req.body`, so the claim is removed from
    // the request itself rather than from a serialised copy. Direct service
    // callers on the /orchestrate sibling are untouched and keep the carve-out.
    if (request.body !== null && typeof request.body === "object") {
      delete (request.body as Record<string, unknown>).user_id;
    }

    const result = await recordExplicitTurnStop(request, requestId);
    return reply.code(result.status).send(result.body);
  });
}
