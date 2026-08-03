/**
 * ROADMAP 2.312 track 2 (2) — THE SCENARIO-ADDRESSED GRAPH READ.
 *
 * CEE owns the ONLY live reader of `scenarios.graph`
 * (`supabase-store.ts::loadGraphAndBriefText`) and, until this route, exposed no
 * scenario-addressed way to reach it: every existing caller is an internal
 * turn-context builder. The guest tier can never read the graph directly —
 * `REVOKE ALL ON scenarios FROM anon` stands and is NOT loosened by this work.
 * This route is the CEE-mediated substitute: the browser asks CEE, CEE asks
 * Supabase with the service role, and the browser never touches Supabase.
 *
 * ── WHY POST FOR A READ (the convention DEMANDS it; this is not a preference) ─
 * Two independent reasons, both derived at the tip:
 *
 *   1. IDENTITY LIVES IN THE BODY. `CEE_REQUIRE_USER_JWT` is off on staging, so
 *      `resolveUserIdentity` returns `mode: "off"` and `authorizeScenarioOwnership`
 *      falls back to the CALLER-SUPPLIED `user_id` — which the shared parser
 *      (`parseRequestExtensions`) reads from the request BODY. A GET has no body,
 *      so `claimedUserId` would be null on every request, and a null caller
 *      against a stored owner is precisely the IDOR case the pre-flight refuses.
 *      Every OWNED scenario would be permanently unreadable by its own owner.
 *
 *   2. THE ALTERNATIVE PUTS A USER ID IN A URL. Carrying `user_id` as a query
 *      parameter would write an account identifier into proxy logs, browser
 *      history and referrers. Not acceptable for an identifier that is the
 *      authorization input.
 *
 * The scenario is still addressed in the PATH, so the route is scenario-addressed
 * in the sense that matters: one URL per scenario, cacheable to reason about,
 * and no graph is ever sent by the caller. Every other `/assist/v1/*` route is
 * POST, so this also matches the family it joins.
 *
 * ── THE UI REACHES THIS AS `/bff/cee/scenarios/:id/graph` ───────────────────
 * DERIVED from the UI's `cee-proxy` EDGE FUNCTION on its `staging` branch
 * (`netlify/edge-functions/cee-proxy.ts`, ROADMAP 2.317):
 *     config.path = "/bff/cee/*"      → target https://cee-staging.onrender.com
 *     pathname.replace(/^\/bff\/cee/, "/assist/v1")
 *     methods GET/HEAD/POST/OPTIONS   → POST is allowed
 *     injects X-Olumi-Assist-Key, forwards `authorization` (the user's
 *     Supabase token, which is what this route's identity step will read once
 *     CEE_REQUIRE_USER_JWT is on)
 * The rewrite is a PREFIX replace, so the multi-segment
 * `/bff/cee/scenarios/<uuid>/graph` lands on
 * `/assist/v1/scenarios/<uuid>/graph`. The key never reaches the browser.
 *
 * ⚠ DO NOT RE-DERIVE THIS FROM `netlify.toml` ON THE UI'S `main` BRANCH — that
 *   is where this note first went wrong. `main` still carries the SUPERSEDED
 *   `[[redirects]]` pair, which (a) never executed at all (Netlify processes
 *   `public/_redirects` first, and its SPA catch-all `/* /index.html 200` won
 *   every time, so `/bff/cee/*` answered SPA HTML) and (b) named
 *   `olumi-assistants-service.onrender.com` — measured 3 Aug at
 *   `/v1/status`: version 1.11.1, uptime 9,936,008s (≈115 days), against CEE
 *   staging's 1.12.0. Wrong twice over. The edge function on `staging` is the
 *   live seam and it targets `cee-staging`, which is where this route deploys.
 *
 * ⚠ AND THAT IS EXACTLY WHY THE ASSIST KEY IS NOT AN AUTHORIZATION BOUNDARY
 *   HERE. The edge injects it for ANY visitor, so "holds a valid assist key"
 *   distinguishes nobody from anybody. The key gate (applied globally by
 *   `plugins/auth.ts` to every non-public route — this one included, by
 *   omission from `isPublicRoute`) stops anonymous internet traffic and does
 *   the per-key quota. USER separation is done below, by the same
 *   scenario-ownership pre-flight the turn route runs.
 *
 * ── THE ORDER OF THE CHECKS IS THE DESIGN ──────────────────────────────────
 *   0. identity      — headers only, no state read. FIRST, so that a refusal
 *                      status cannot become a scenario-existence oracle for a
 *                      caller presenting a deliberately bad token (the exact
 *                      regression turn-stop.ts had to hoist away).
 *   1. UUID syntax   — `scenarios.id` is a UUID column, so a non-UUID cannot
 *                      name a row. Refused without a round trip.
 *   2. EXISTENCE     — and it is before ownership FOR A REASON, see below.
 *   3. ownership     — the SAME two shared functions the turn route uses. No
 *                      second ownership rule is written in this file.
 *   4. the read      — only now, and only for a caller who passed 0–3.
 *
 * ⚠ (2) BEFORE (3) IS LOAD-BEARING: A READ MUST NEVER CREATE THE ROW IT READS.
 *   `authorizeScenarioOwnership` → `preflightEnsureScenario` →
 *   `ensureScenarioExists` runs `INSERT … ON CONFLICT (id) DO NOTHING`. Reached
 *   with an id that does not exist, it CREATES that scenario — so a stranger
 *   posting random UUIDs at a read endpoint would grow `scenarios` without
 *   bound. Gating on existence first makes the upsert a pure read (the row
 *   always already exists when it runs, so ON CONFLICT DO NOTHING does
 *   nothing) while still keeping ownership in the shared function where it
 *   belongs. turn-stop.ts ordered these two the same way for the same reason.
 *
 * ── EVERY REFUSAL ANSWERS THE SAME BYTES ───────────────────────────────────
 * "No such scenario", "not your scenario" and "ownership oracle unavailable"
 * are INDISTINGUISHABLE: one status, one code, one message. A refusal that
 * named its reason would hand any holder of a scenario UUID a free oracle over
 * which scenarios exist and who owns them — rebuilt one bit at a time. Guest
 * (unowned) scenarios stay addressable by anyone holding the UUID: that is the
 * accepted PoC posture, it is what the turn route already does, and it is what
 * makes PC5's guest tier work at all.
 *
 * ── RATE LIMITING, AND WHY THE BUCKET IS KEYED ON THE CLIENT ───────────────
 * The first cut of this route shipped with NO route-local limiter, arguing the
 * global `@fastify/rate-limit` (`global: true`) and the auth plugin's per-key
 * quota already covered it. Both of those are real and do apply — but CodeQL
 * flagged `js/missing-rate-limiting` HIGH ("this route handler performs
 * authorization, but is not rate-limited") and it was RIGHT to: every sibling
 * `/assist/v1/*` route carries one, and this is the only route in the estate
 * that returns another user's decision graph. A coarse global limiter is not
 * the same control as a per-route one on a data-read endpoint.
 *
 * ⚠ THE BUCKET IS KEYED ON THE CLIENT (ip), NOT ON THE KEY ID — the inverse of
 *   the sibling routes' `keyId || req.ip`, deliberately. Through the
 *   `/bff/cee/*` edge EVERY visitor arrives carrying the SAME injected assist
 *   key, so a keyId-first bucket is a single shared-fate bucket in which one
 *   busy tab throttles every other user of the product. `req.ip` resolves from
 *   `x-forwarded-for` in production (`trustProxy: nodeEnv === "production"`),
 *   so it is per-visitor, which is also the granularity that actually limits
 *   the threat here: one host enumerating many scenario ids. keyId is the
 *   FALLBACK, for direct service-to-service callers that arrive without a
 *   forwarded client address.
 *
 * ── WHAT THIS ROUTE DOES NOT DO ────────────────────────────────────────────
 * · It does not write. Not the graph, not the row, not a turn.
 * · It does not MINT AN IDENTITY SCHEME. `graph_identity_hash` is
 *   `computeGraphIdentityHash` — identity.v1, the single normaliser authority
 *   named by the CAS migration itself — so the UI's rebase detection compares
 *   the same value CEE's own compare-and-swap does.
 * · It does not carry layout. `scenarios.graph` holds no positions (the UI
 *   merges those locally), and `layout_present` REPORTS that by measuring the
 *   returned bytes rather than promising it in prose.
 */

import type { FastifyInstance } from "fastify";

import { parseRequestExtensions } from "../orchestrator-v5/boundary/request-extensions.js";
import type { GraphStateIngress } from "../orchestrator-v5/boundary/request-extensions.js";
import {
  authorizeScenarioOwnership,
  resolveVerifiedIdentityOrRefuse,
} from "../orchestrator/route-v2-preflight.js";
import { computeGraphIdentityHash } from "../orchestrator-v5/context/graph-identity.js";
import { getSessionStore } from "../orchestrator-v5/session/index.js";
import { getCeeFeatureRateLimiter } from "../cee/config/limits.js";
import { getRequestKeyId } from "../plugins/auth.js";
import { buildErrorV1 } from "../utils/errors.js";
import { getRequestId } from "../utils/request-id.js";
import { log } from "../utils/telemetry.js";

/** Wire schema discriminator. Frozen — the UI lane builds against this. */
export const SCENARIO_GRAPH_SCHEMA = "scenario_graph.v1" as const;

/**
 * `scenarios.id` is a UUID column, so a non-UUID id cannot name an existing
 * row. Same pattern and same rationale as turn-stop.ts.
 */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Keys that would mean canvas LAYOUT had been persisted into `scenarios.graph`.
 *
 * ⚠ THIS IS A HAND-WRITTEN LIST, AND IT KNOWS IT (trap 12d). Deriving
 * `layout_present` from a list proves the consumers agree with the list; it can
 * never prove the list is complete. So the list is deliberately INCLUSIVE — the
 * asymmetry runs one way: a false TRUE is a harmless over-report the UI can
 * ignore, a false FALSE is a promise of "no layout" made over bytes that carry
 * it. Paired with a positive control in the spec that proves the derivation
 * fires at all, rather than passing by never firing.
 */
const LAYOUT_KEYS = new Set(["position", "positions", "layout", "x", "y"]);

/**
 * Does the graph we are about to return carry any layout/position data?
 *
 * MEASURED, NOT ASSERTED. A hardcoded `false` would be a hand-maintained mirror
 * of a schema fact (trap 12) that keeps answering "no layout" for exactly as
 * long as nobody re-checks it. Today this returns false for every real
 * `scenarios.graph`; the day it returns true, the UI gets a signal instead of a
 * stale promise.
 */
function detectLayout(graph: unknown): boolean {
  if (graph === null || typeof graph !== "object") return false;
  const g = graph as Record<string, unknown>;

  for (const key of Object.keys(g)) {
    if (LAYOUT_KEYS.has(key.toLowerCase())) return true;
  }

  for (const collection of ["nodes", "edges", "options"] as const) {
    const entries = g[collection];
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (entry === null || typeof entry !== "object") continue;
      for (const key of Object.keys(entry as Record<string, unknown>)) {
        if (LAYOUT_KEYS.has(key.toLowerCase())) return true;
      }
    }
  }

  return false;
}

export default async function route(app: FastifyInstance) {
  // The SHARED limiter, not a 15th hand-rolled copy of the `pruneBuckets` /
  // `checkRateLimit` pair that 17 route files already carry (trap 12: every
  // copy is a place the tier policy can drift silently). The env var is
  // registered in RATE_BUCKET_REGISTRY as tier `read`, which the drift test
  // enforces in both directions.
  const limiter = getCeeFeatureRateLimiter(
    "scenario_graph",
    "CEE_SCENARIO_GRAPH_RATE_LIMIT_RPM",
  );

  app.post<{ Params: { scenario_id: string } }>(
    "/assist/v1/scenarios/:scenario_id/graph",
    async (req, reply) => {
      const requestId = getRequestId(req);
      const scenarioId = req.params.scenario_id;

      /**
       * THE ONE REFUSAL. Absent scenario, someone else's scenario, malformed
       * id, ownership oracle down — all answer these exact bytes. See the
       * header: a refusal that named its reason would be an enumeration oracle
       * over other people's decisions.
       */
      const refuse = () =>
        reply
          .code(404)
          .send(
            buildErrorV1(
              "NOT_FOUND",
              "No readable graph for that scenario.",
              {},
              requestId,
            ),
          );

      /**
       * A read that could not complete is an UNKNOWN, never an absence and
       * never an empty graph. Answering 404 or `graph: null` on a DB blip
       * would tell the UI the user's decision does not exist / is empty, and
       * the UI would render that as an empty canvas over live data.
       */
      const unavailable = () =>
        reply
          .code(503)
          .send(
            buildErrorV1(
              "INTERNAL",
              "The graph could not be read right now.",
              {},
              requestId,
            ),
          );

      // ── Rate limit, FIRST ────────────────────────────────────────────────
      // Ahead of identity because a 429 is derived only from the caller's own
      // request volume: it is the one refusal that carries no information about
      // the scenario, so putting it first cannot become an oracle (the ordering
      // hazard the identity step below exists to avoid) and it keeps a flood
      // from reaching the store at all.
      //
      // keyId is the FALLBACK, not the primary — see the header: through the
      // `/bff/cee/*` edge every visitor shares ONE injected assist key, so a
      // keyId-first bucket would throttle the whole product on one busy tab.
      const keyId = getRequestKeyId(req) ?? undefined;
      const bucketKey = req.ip ? `ip::${req.ip}` : `key::${keyId ?? "unknown"}`;
      const rate = limiter.tryConsume(bucketKey, keyId);
      if (!rate.allowed) {
        return reply.code(429).send(
          buildErrorV1(
            "RATE_LIMITED",
            "Too many graph reads. Try again shortly.",
            { retry_after_seconds: rate.retryAfterSeconds },
            requestId,
          ),
        );
      }

      // ── 0. Identity, from headers only, before ANY read of server state ──
      const resolved = await resolveVerifiedIdentityOrRefuse(req, requestId);
      if (!resolved.ok) {
        return reply.code(resolved.status).send(resolved.error);
      }

      // ── 1. Syntax: a non-UUID cannot name a row. No round trip. ─────────
      if (!UUID_PATTERN.test(scenarioId)) {
        return refuse();
      }

      const store = getSessionStore();

      // ── 2. EXISTENCE — before ownership, so the read cannot CREATE ──────
      // Error discipline is the INVERSE of turn-stop's fail-open: a Stop
      // fails open because a DB blip must not cost a user their Stop, and the
      // worst case is a spurious tombstone. Here the worst case is serving or
      // fabricating someone's decision graph, so a thrown read fails CLOSED
      // and says 503 — it never degrades into 404 or into an empty graph.
      //
      // ⚠ A MISSING `scenarioExists` FAILS CLOSED, and this is the one place
      //   this route deliberately diverges from turn-stop.ts's structural
      //   probe. `scenarioExists` is OPTIONAL on the SessionStore interface.
      //   turn-stop can skip it when absent, because skipping only costs it a
      //   hardening check. Skipping it HERE would fall straight through to the
      //   ownership pre-flight — the call that UPSERTS — so "I could not check
      //   whether this scenario exists" would become "create it and read it".
      //   Defaulting to `true` (assume it exists) is exactly the dangerous
      //   direction, and it would make the invariant this route advertises
      //   ("a read never creates the row it reads") conditional on a store
      //   shape rather than structural. An unverifiable precondition is
      //   refused, not assumed.
      let exists: boolean;
      try {
        if (typeof store.scenarioExists !== "function") {
          log.error(
            {
              event: "v5.scenario_graph.existence_check_unavailable",
              request_id: requestId,
            },
            "Scenario graph read — store cannot check scenario existence; refusing rather than risking a create-on-read",
          );
          return unavailable();
        }
        exists = await store.scenarioExists(scenarioId);
      } catch (err) {
        log.warn(
          {
            event: "v5.scenario_graph.existence_read_failed",
            request_id: requestId,
            scenario_id: scenarioId,
            err: err instanceof Error ? err.message : String(err),
          },
          "Scenario graph read — existence read failed; failing closed",
        );
        return unavailable();
      }
      if (!exists) {
        return refuse();
      }

      // ── 3. Ownership — the SAME pre-flight the turn route runs ──────────
      // The caller-supplied `user_id` is read by the SAME parser the turn
      // route uses, not a hand-rolled `body.user_id` read that would drift the
      // day the extension contract moves.
      const extensions = parseRequestExtensions(req.body, requestId);
      if (!extensions.ok) {
        return refuse();
      }

      let owned: Awaited<ReturnType<typeof authorizeScenarioOwnership>>;
      try {
        owned = await authorizeScenarioOwnership(
          scenarioId,
          extensions.value.userId,
          resolved.identity,
          requestId,
        );
      } catch (err) {
        log.warn(
          {
            event: "v5.scenario_graph.ownership_read_failed",
            request_id: requestId,
            scenario_id: scenarioId,
            err: err instanceof Error ? err.message : String(err),
          },
          "Scenario graph read — ownership pre-flight threw; failing closed",
        );
        return unavailable();
      }
      if (!owned.ok) {
        // Reason is LOGGED, never returned — including the oracle-down case,
        // which is fail-CLOSED here (see the header).
        log.warn(
          {
            event: "v5.scenario_graph.refused_not_owner",
            request_id: requestId,
            scenario_id: scenarioId,
            reason: owned.reason,
          },
          "Scenario graph read — caller is not authorized for this scenario",
        );
        return refuse();
      }

      // ── 4. The read ─────────────────────────────────────────────────────
      let graph: unknown;
      let briefText: string | null;
      try {
        const loaded = await store.loadGraphAndBriefText(scenarioId);
        graph = loaded.graph;
        briefText = loaded.briefText;
      } catch (err) {
        log.warn(
          {
            event: "v5.scenario_graph.read_failed",
            request_id: requestId,
            scenario_id: scenarioId,
            err: err instanceof Error ? err.message : String(err),
          },
          "Scenario graph read — graph read failed; failing closed",
        );
        return unavailable();
      }

      // An EMPTY graph is a valid answer, not an error: every scenario starts
      // there, and 404-ing it would make "no graph yet" indistinguishable from
      // "not yours" — collapsing the very distinction the UI needs.
      const graphPresent = graph !== null && graph !== undefined;

      return reply.code(200).send({
        schema: SCENARIO_GRAPH_SCHEMA,
        scenario_id: scenarioId,
        graph: graphPresent ? graph : null,
        graph_present: graphPresent,
        brief_text: briefText,
        // identity.v1, from the single normaliser authority. Null when the
        // graph is absent or identity-empty — there is no identity to anchor
        // to, and a hash of nothing would be a false anchor.
        graph_identity_hash: graphPresent
          ? computeGraphIdentityHash(graph as GraphStateIngress)
          : null,
        layout_present: detectLayout(graphPresent ? graph : null),
        request_id: requestId,
      });
    },
  );
}
