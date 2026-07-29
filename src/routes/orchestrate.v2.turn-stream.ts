/**
 * POST /orchestrate/v2/turn/stream — the V5 TURN as staged SSE, for SERVICE callers.
 *
 * ROADMAP 2.122 (POC-DONE step 1) / 1.204 M1 — CEE lane 2.
 * Transport, frame contract and client rules: `./streamed-turn-sse.ts`.
 *
 * ── WHY THIS ROUTE, AND WHO CAN ACTUALLY CALL IT ────────────────────────────
 * A cold draft holds the user in one silent ~53–60 s request. #745 decomposed
 * that wait and proved the graph is validated at ~33 s — but on an ASSIST route,
 * and THE PRODUCT DOES NOT DRAFT THAT WAY. The UI's cold draft is a V5 TURN, and
 * re-pointing it at the assist route would leave `scenarios.graph` NULL, so the
 * next thing the user does — Run analysis — honestly refuses. This route streams
 * the TURN, commit included.
 *
 * ⚠ THIS IS THE SERVICE-CALLER SURFACE, NOT THE BROWSER ONE. It sits behind the
 * ordinary auth hook, which requires an assist key or an HMAC signature —
 * **neither of which a browser can hold** (any `VITE_*` value is public by
 * construction). That is exactly why the buffered browser path is the public,
 * origin-validated `/proxy/v5/turn`. **The UI's streamed entry point is
 * `POST /proxy/v5/turn/stream`** (`./proxy-v5-turn-stream.ts`), which reuses this
 * same transport with the proxy's ingress. Adversarial review caught the
 * original PR claiming "the UI opts in by calling it" about THIS route; that was
 * false, and the browser sibling is the correction.
 *
 * ── AUTH ────────────────────────────────────────────────────────────────────
 * Not listed in `auth.ts` `isPublicRoute()`, so the global `onRequest` hook
 * authenticates it exactly as it authenticates the buffered turn. No new auth
 * surface.
 *
 * ⚠ API-KEY CALLERS ONLY — HMAC CANNOT WORK HERE, AND THE ROUTE MUST NOT CLAIM
 * IT CAN. The HMAC canonical string is PATH-BOUND
 * (`METHOD\nPATH\n[TS\nNONCE\n]BODYHASH`, verified over `request.url` in
 * `plugins/auth.ts` → `utils/hmac-auth.ts`) and its nonce is single-use. A
 * signature computed over `/orchestrate/v2/turn/stream` can NEVER verify against
 * the inner `/orchestrate/v2/turn`, no matter how faithfully the raw body is
 * forwarded. Proven empirically under review: with `HMAC_SECRET` configured, the
 * same client construction authenticates against the buffered turn, while on
 * this route the outer request 200s and the INNER turn is rejected 401 inside
 * the COMPLETE frame. An earlier version of this file cited raw-byte forwarding
 * as HMAC compatibility — that rationale was **false**, and a false security
 * rationale is how the next lane inherits a wrong premise. Raw-byte forwarding
 * is retained because forwarding what arrived is simply correct; it just buys
 * nothing for HMAC. No known live HMAC caller of the turn routes (UI → public
 * proxy; testers → assist key). **Rowed, not fixed.**
 *
 * ── RATE LIMITS, STATED PRECISELY ───────────────────────────────────────────
 * This route mints no bucket of its own, so a client gains no extra *draft*
 * allowance by streaming. Two charges do differ from the buffered turn, and the
 * original PR body understated them:
 *   1. `isSseRequest` (`plugins/auth.ts:86`) matches **any URL containing
 *      `/stream`**, so the outer request consumes the per-key **SSE token
 *      bucket** (`SSE_RATE_LIMIT_RPM`, default **20/min**) while the inner turn
 *      pays the per-key default bucket. Streamed turns are therefore capped at
 *      ~20/min/key by default.
 *   2. The global per-minute counter sees the outer request as well as the inner
 *      one — the same double-count `/proxy/v5/turn` has produced since it shipped.
 * Harmless at POC scale; recorded so nobody rediscovers it as a mystery 429.
 */

import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";

import { getRequestId } from "../utils/request-id.js";
import {
  streamTurnAsStagedSse,
  STREAMED_TURN_INTERNAL_TARGET,
  STAGED_FRAME_CLASSES,
} from "./streamed-turn-sse.js";

/** This route's own path. */
export const STREAMED_TURN_ROUTE = "/orchestrate/v2/turn/stream";

/**
 * Headers that must NOT cross into the internal inject.
 *
 * Hop-by-hop headers describe THIS connection, not the request, and
 * `content-length` / `accept-encoding` describe a body and an encoding the
 * injected call re-derives for itself. `accept` is overridden rather than
 * dropped: the client's `accept` is `text/event-stream`, which describes the
 * transport of the OUTER request; the inner turn is and must remain buffered
 * JSON.
 */
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "te",
  "trailer",
  "proxy-authorization",
  "proxy-authenticate",
  "host",
  "content-length",
  "accept-encoding",
]);

/**
 * Build the internal request headers.
 *
 * Everything not hop-by-hop is forwarded verbatim so the inner request presents
 * the SAME API-KEY credentials the outer one did — the inner turn is
 * authenticated by the same global hook against the same key set. (It cannot
 * carry HMAC across; see the route header.)
 *
 * `x-request-id` is pinned to the stream's own id so the inner turn's logs are
 * attributable to the stream that ran it. Without it, a client that sends no
 * `x-request-id` gets UUID-A on the stream and a freshly generated UUID-B in the
 * turn's logs, and the two cannot be joined — `/proxy/v5/turn` sets it for
 * exactly this reason.
 */
export function buildInternalTurnHeaders(
  headers: FastifyRequest["headers"],
  requestId: string,
): Record<string, string> {
  const internal: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const key = name.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(key)) continue;
    if (typeof value === "string") internal[key] = value;
    else if (Array.isArray(value)) internal[key] = value.join(", ");
  }
  internal["content-type"] = "application/json";
  internal["accept"] = "application/json";
  internal["x-request-id"] = requestId;
  return internal;
}

export default async function route(app: FastifyInstance) {
  const FEATURE_VERSION = "streamed-turn-1.0.0";

  app.post(STREAMED_TURN_ROUTE, async (req, reply) => {
    const requestId = getRequestId(req) ?? randomUUID();

    // Forward the RAW body bytes when the auth plugin captured them
    // (`preParsing`, `plugins/auth.ts`). Re-serialising `req.body` would change
    // the bytes; forwarding what arrived keeps the inner turn's view of the
    // request identical to the outer one's.
    const rawBody = (req as FastifyRequest & { rawBody?: string }).rawBody;
    const payload = typeof rawBody === "string" ? rawBody : JSON.stringify(req.body ?? {});

    await streamTurnAsStagedSse({
      app,
      reply,
      requestId,
      internalHeaders: buildInternalTurnHeaders(req.headers, requestId),
      payload,
      featureVersion: FEATURE_VERSION,
      endpoint: STREAMED_TURN_ROUTE,
    });

    return reply;
  });
}

export { STAGED_FRAME_CLASSES, STREAMED_TURN_INTERNAL_TARGET };
