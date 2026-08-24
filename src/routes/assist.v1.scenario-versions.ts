/**
 * Model Management v1 — THE WIRING SLICE: scenario-addressed VERSIONS.
 *
 * `src/orchestrator-v5/model-management/` has been complete and deliberately
 * dark since 2026-07-05: the `model_versions` substrate is EXECUTED on staging
 * (migration 20260705120000), the service computes content identity via the
 * Group A authority, and contracts.ts carries the strict wire shapes "a later,
 * separately-reviewed wiring slice will parse ingress / validate egress with".
 * This file is that slice. Until it, versions were browser-local (DGAI #739):
 * one browser, one device, nothing shared, lost with site data. These routes
 * make the SHARED model's history reachable from any browser with access.
 *
 *   POST /assist/v1/scenarios/:scenario_id/versions          — list (read tier)
 *   POST /assist/v1/scenarios/:scenario_id/versions/save     — named save (write tier)
 *   POST /assist/v1/scenarios/:scenario_id/versions/restore  — restore (write tier)
 *
 * ── THE FAMILY RULES, INHERITED VERBATIM (scenario-graph read/register) ─────
 * · POST always; identity travels in the BODY (`parseRequestExtensions`), never
 *   a URL. · Order: identity → UUID → EXISTENCE → ownership → route-local BODY
 *   → the operation — existence BEFORE ownership because
 *   `authorizeScenarioOwnership` UPSERTS and none of these routes may create the
 *   row it addresses (the read route's pin; restore is a write to the GRAPH but
 *   must still never mint a scenario).
 * · ⚠ THE BODY PARSE IS LAST, NOT FIRST (corrected 2026-08-17). These three
 *   routes originally validated their route-local body BEFORE `preflight`,
 *   which inverts the family principle the shared pre-flight states in its own
 *   header and enforces for every turn: *authentication precedes body
 *   validation, so an unauthenticated caller learns nothing about payload
 *   validity* (route-v2-preflight.ts step 0; the register route observes it
 *   too — identity at :226, payload at :236). It is deliberately moved BELOW
 *   the whole pre-flight rather than just below step 0: a route-local 422 is
 *   decided purely on the caller's OWN bytes, so it carries no server state and
 *   costs nothing to defer, and deferring it keeps every pre-operation refusal
 *   these routes can emit on one side of the identity gate.
 * · ONE indistinguishable 404 for every scenario-shaped refusal. VERSION-shaped
 *   refusals name their cause: the caller already holds authorised access to
 *   the scenario, so "version not found" leaks nothing about anyone else.
 * · Rate tiers DERIVED from RATE_BUCKET_REGISTRY — list is `read` (fails open),
 *   save/restore are `coach` (fails CLOSED: a write must not be waved through
 *   when the limiter is blind). Buckets are per client (`req.ip`), because the
 *   `/bff/cee/*` edge injects the SAME assist key for every visitor.
 *
 * ── WHAT A SAVE IS: THE SERVER'S GRAPH, NEVER THE CLIENT'S ─────────────────
 * `/versions/save` versions `scenarios.graph` — the graph every turn and every
 * analysis is computed from. It accepts NO client graph (a smuggled `graph`
 * field is simply never read): a version is a snapshot of the SHARED model,
 * and letting a client supply the bytes would let it fabricate a history the
 * scenario never had. Identity is computed CEE-side by the service
 * (`computeGraphIdentityHash`); the contracts have nowhere to put a client
 * hash by design.
 *
 * ── WHAT A RESTORE IS: ONE TRANSACTION, OR NOTHING (Component 4) ──────────
 * ⚠ REWRITTEN 2026-08-24. Everything this section used to say about an
 * "RPC-first, append-second" order, a "CAS CHAIN", and an honest
 * `RESTORE_INCOMPLETE` describes a design that NO LONGER EXISTS. It is not
 * history worth preserving in place — it is a map of a partial state that
 * can no longer occur, and leaving it here would send the next reader
 * looking for split points that are gone. The old text is in git.
 *
 * A restore is now ONE call to ONE RPC — `restore_model_version_atomic`,
 * migration 20260824120000 — which is a single plpgsql invocation and
 * therefore a single transaction. Inside it, under one `scenarios` row lock:
 *
 *   · the pre-restore UNDO snapshot (via `create_model_version`, whose
 *     no-op dedupe supplies "reuse the head when its identity already
 *     matches the working graph" — derived, not re-decided),
 *   · the new head VERSION row carrying the re-projected bytes,
 *   · the head POINTER move,
 *   · the WORKING GRAPH write (via `append_turn_atomic_v4`, nested in the
 *     same transaction — still the one sanctioned graph writer),
 *   · the JOURNEY event.
 *
 * All of it commits, or none of it does. There is no partial outcome to
 * report, so `RESTORE_INCOMPLETE` and `version_recorded: true` are GONE
 * from this file: a state that cannot occur cannot be reported. Failures
 * are 404 / 409 / 422 / 503, every one of them all-or-nothing.
 *
 * ⚠ THIS ROUTE MAKES EXACTLY ONE MUTATING CALL, AND MUST CONTINUE TO.
 * The pre-atomic version made three, each committing separately — snapshot
 * RPC, restore RPC, graph append — which is precisely what made a partial
 * state representable. There is no fallback path and there must never be
 * one: a fallback is a second writer, and a second writer is the defect.
 *
 * ── THE TWO HASHES THAT SHARE A NAME ───────────────────────────────────────
 * `scenarios.graph_identity_hash` is the identity of the WORKING graph.
 * `model_versions.graph_identity_hash` is the identity of a SAVED VERSION.
 * They answer different questions. The pre-atomic route CHAINED them — the
 * client's expected hash (which describes the working graph the user was
 * looking at) gated `create_model_version`, whose CAS compares against the
 * HEAD VERSION's hash — a category error everywhere the two do not happen
 * to coincide. The RPC now CASes the caller's expectation against the
 * working graph, once, under the lock. One comparison, one authority.
 *
 * ── IDEMPOTENCY: `mutation_id` IS REQUIRED ────────────────────────────────
 * A replay returns the ORIGINAL receipt and writes nothing; two concurrent
 * attempts from one base give exactly one success and one 409. The old
 * route minted a fresh turn id per request, so a retry was NOT deduped and
 * a refreshed retry cost two new version rows per attempt.
 *
 * ── DEPLOY ORDER IS NOT FREE ──────────────────────────────────────────────
 * Apply migration 20260824120000 BEFORE deploying this code. If the RPC is
 * absent, PostgREST answers PGRST202 and this route answers an honest 503:
 * restore is UNAVAILABLE, never partial. That is the intended failure mode.
 *
 * Restore still accepts NO client graph: the bytes written are the STORED
 * version's, re-validated against the ingress contract and re-projected
 * through `projectGraphForPersistence` (idempotent by design; a version
 * saved under an older projection is normalised to today's persisted form,
 * and a version that no longer parses is refused honestly, never written).
 * ⚠ Those re-projected bytes are written to BOTH the working graph and the
 * new head version. The pre-existing `restore_model_version` RPC byte-copies
 * the TARGET's graph into the version row while the working graph receives
 * the RE-PROJECTED bytes — so for any version saved under an older
 * projection, the head and the working graph described different content the
 * moment the restore "succeeded". Writing one graph to both is why the
 * atomic RPC does not call it.
 *
 * ── GUESTS ─────────────────────────────────────────────────────────────────
 * Guest (unowned) scenarios cannot hold server-side versions — DB-level
 * design, D3 Branch A (`owner_user_id NOT NULL`, SQLSTATE MV001). The service
 * maps that to `sign_in_required`, and these routes answer 401 with
 * `SIGN_IN_REQUIRED` and the copy.ts wording. A guest's LIST is an empty list,
 * not an error: versions simply cannot exist for their scenario yet, and the
 * UI renders the sign-in invitation from the same one copy source.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { parseRequestExtensions } from "../orchestrator-v5/boundary/request-extensions.js";
import { GraphStateIngressSchema } from "../orchestrator-v5/boundary/request-extensions.js";
import {
  authorizeScenarioOwnership,
  resolveVerifiedIdentityOrRefuse,
} from "../orchestrator/route-v2-preflight.js";
import { projectGraphForPersistence } from "../orchestrator-v5/persisted-graph-projection.js";
import { getSessionStore } from "../orchestrator-v5/session/index.js";
import {
  getModelManagementService,
  ModelVersionSummaryResponseSchema,
  VersionWriteOutcomeResponseSchema,
  SIGN_IN_REQUIRED_MESSAGE,
} from "../orchestrator-v5/model-management/index.js";
import type {
  AtomicRestoreOutcome,
  ModelManagementResult,
  ModelVersionRecord,
} from "../orchestrator-v5/model-management/index.js";
import { resolveCeeRateLimit } from "../cee/config/limits.js";
import { buildErrorV1 } from "../utils/errors.js";
import { getRequestId } from "../utils/request-id.js";
import { log } from "../utils/telemetry.js";

/** Wire schema discriminators. Frozen — the UI lane builds against these. */
export const MODEL_VERSIONS_LIST_SCHEMA = "model_versions_list.v1" as const;
export const MODEL_VERSION_SAVE_SCHEMA = "model_version_save.v1" as const;
export const MODEL_VERSION_RESTORE_SCHEMA = "model_version_restore.v1" as const;

/** `scenarios.id` is a UUID column, so a non-UUID id cannot name a row. */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 64-hex sha256 — the ONLY hash a request may carry (a CAS expectation). */
const Sha256Hex = z.string().regex(/^[0-9a-f]{64}$/);

/**
 * Route-local ingress shapes. These deliberately do NOT reuse the module's
 * `.strict()` request contracts wholesale, because the BODY also carries the
 * identity extension (`user_id`) that `parseRequestExtensions` owns — a strict
 * parse of the raw body would refuse every authenticated request. Instead the
 * named version fields are picked explicitly (an unknown body key — including
 * a smuggled `graph` — is never read) and validated strictly here.
 */
const ListBodySchema = z.object({
  limit: z.number().int().positive().max(200).optional(),
});
const SaveBodySchema = z.object({
  label: z.string().min(1).max(200).optional(),
  expected_graph_identity_hash: Sha256Hex.optional(),
});
/**
 * Component 4 — `mutation_id` is REQUIRED, not optional.
 *
 * It is the idempotency key for the whole restore: a replay returns the
 * ORIGINAL receipt and writes nothing, and two concurrent attempts from one
 * base resolve to exactly one success and one 409. Making it optional would
 * make the guarantee optional — a caller that omitted it would silently get
 * the old at-least-once behaviour, which is precisely the class of "the
 * protection exists but nothing makes you use it" defect this component is
 * closing. A caller that has no key cannot be given one server-side without
 * defeating the purpose, so the request is refused instead.
 */
const MUTATION_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

const RestoreBodySchema = z.object({
  version_id: z.string().uuid(),
  mutation_id: z.string().regex(MUTATION_ID_PATTERN),
  label: z.string().min(1).max(200).optional(),
  expected_graph_identity_hash: Sha256Hex.optional(),
});

export default async function route(app: FastifyInstance) {
  // Tiers DERIVED from RATE_BUCKET_REGISTRY (drift-tested both directions).
  const LIST_RATE_LIMIT_MAX = resolveCeeRateLimit(
    "CEE_SCENARIO_VERSIONS_RATE_LIMIT_RPM",
  );
  const WRITE_RATE_LIMIT_MAX = resolveCeeRateLimit(
    "CEE_SCENARIO_VERSIONS_WRITE_RATE_LIMIT_RPM",
  );

  type Ctx = {
    requestId: string;
    scenarioId: string;
  };

  /** THE ONE REFUSAL for anything scenario-shaped (family rule). */
  const refuse = (reply: any, requestId: string) =>
    reply
      .code(404)
      .send(
        buildErrorV1(
          "NOT_FOUND",
          "No readable versions for that scenario.",
          {},
          requestId,
        ),
      );

  const unavailable = (reply: any, requestId: string, message: string) =>
    reply.code(503).send(buildErrorV1("INTERNAL", message, {}, requestId));

  /** A payload refusal names its cause in full — the caller supplied the bytes. */
  const invalid = (
    reply: any,
    requestId: string,
    code: string,
    message: string,
    details: Record<string, unknown> = {},
  ) =>
    reply
      .code(422)
      .send(buildErrorV1("BAD_INPUT", message, { code, ...details }, requestId));

  /** The service said versioning is disabled — honest 503, never an empty list. */
  const disabled = (reply: any, requestId: string) =>
    reply
      .code(503)
      .send(
        buildErrorV1(
          "INTERNAL",
          "Version history is not available on this service right now.",
          { code: "VERSIONS_DISABLED" },
          requestId,
        ),
      );

  /** Guest refusal — the copy.ts wording, D3 Branch A. */
  const signInRequired = (reply: any, requestId: string) =>
    reply
      .code(401)
      .send(
        buildErrorV1(
          "UNAUTHENTICATED",
          SIGN_IN_REQUIRED_MESSAGE,
          { code: "SIGN_IN_REQUIRED" },
          requestId,
        ),
      );

  /**
   * Component 4 — the ONE unavailable message for a refused restore.
   *
   * Every refusal below is all-or-nothing, so the copy can say "nothing was
   * changed" unconditionally. The pre-atomic route could not say that: it
   * had a branch where the version WAS recorded and the working model was
   * not, and it had to admit so (`RESTORE_INCOMPLETE`,
   * `version_recorded: true`). That branch no longer exists.
   */
  const RESTORE_UNAVAILABLE_MESSAGE =
    "The version could not be restored right now. Nothing was changed — try again shortly.";

  /** A version-shaped refusal names its cause: the caller already holds
   *  authorised access to the scenario, so this leaks nothing. */
  const versionNotFound = (reply: any, requestId: string) =>
    reply
      .code(404)
      .send(
        buildErrorV1(
          "NOT_FOUND",
          "That version is no longer available.",
          { code: "VERSION_NOT_FOUND" },
          requestId,
        ),
      );

  /** CAS conflict — the model moved since the caller looked. Recoverable. */
  const stale = (reply: any, requestId: string) =>
    reply
      .code(409)
      .send(
        buildErrorV1(
          "BAD_INPUT",
          "This model changed since you last loaded it. Refresh to see the latest, then try again.",
          { code: "VERSION_STALE" },
          requestId,
        ),
      );

  /**
   * Steps 0–3 of the family order, shared by all three routes: identity →
   * UUID syntax → EXISTENCE (fail closed; a missing probe is refused, never
   * assumed — the read route's create-on-read fence) → ownership (the SAME
   * shared pre-flight the turn route runs; no second ownership rule here).
   * Returns null when a refusal has already been sent.
   */
  async function preflight(req: any, reply: any): Promise<Ctx | null> {
    const requestId = getRequestId(req);
    const scenarioId = (req.params as { scenario_id: string }).scenario_id;

    // ── 0. Identity, from headers only, before ANY read of server state ──
    const resolved = await resolveVerifiedIdentityOrRefuse(req, requestId);
    if (!resolved.ok) {
      reply.code(resolved.status).send(resolved.error);
      return null;
    }

    // ── 1. Syntax: a non-UUID cannot name a row. No round trip. ──────────
    if (!UUID_PATTERN.test(scenarioId)) {
      refuse(reply, requestId);
      return null;
    }

    const store = getSessionStore();

    // ── 2. EXISTENCE — before ownership, so no route here can CREATE ─────
    let exists: boolean;
    try {
      if (typeof store.scenarioExists !== "function") {
        log.error(
          { event: "v5.scenario_versions.existence_check_unavailable", request_id: requestId },
          "Scenario versions — store cannot check scenario existence; refusing rather than risking a create-on-read",
        );
        unavailable(reply, requestId, "Versions could not be read right now.");
        return null;
      }
      exists = await store.scenarioExists(scenarioId);
    } catch (err) {
      log.warn(
        {
          event: "v5.scenario_versions.existence_read_failed",
          request_id: requestId,
          scenario_id: scenarioId,
          err: err instanceof Error ? err.message : String(err),
        },
        "Scenario versions — existence read failed; failing closed",
      );
      unavailable(reply, requestId, "Versions could not be read right now.");
      return null;
    }
    if (!exists) {
      refuse(reply, requestId);
      return null;
    }

    // ── 3. Ownership — the SAME pre-flight the turn route runs ───────────
    const extensions = parseRequestExtensions(req.body, requestId);
    if (!extensions.ok) {
      refuse(reply, requestId);
      return null;
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
          event: "v5.scenario_versions.ownership_read_failed",
          request_id: requestId,
          scenario_id: scenarioId,
          err: err instanceof Error ? err.message : String(err),
        },
        "Scenario versions — ownership pre-flight threw; failing closed",
      );
      unavailable(reply, requestId, "Versions could not be read right now.");
      return null;
    }
    if (!owned.ok) {
      log.warn(
        {
          event: "v5.scenario_versions.refused_not_owner",
          request_id: requestId,
          scenario_id: scenarioId,
          reason: owned.reason,
        },
        "Scenario versions — caller is not authorized for this scenario",
      );
      refuse(reply, requestId);
      return null;
    }

    return { requestId, scenarioId };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // LIST — POST /assist/v1/scenarios/:scenario_id/versions
  // ───────────────────────────────────────────────────────────────────────────
  app.post<{ Params: { scenario_id: string } }>(
    "/assist/v1/scenarios/:scenario_id/versions",
    { config: { rateLimit: { max: LIST_RATE_LIMIT_MAX, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const requestId = getRequestId(req);

      const ctx = await preflight(req, reply);
      if (ctx === null) return;

      // Route-local body AFTER the pre-flight — authentication precedes body
      // validation (see THE BODY PARSE IS LAST in the header).
      const body = (req.body ?? {}) as Record<string, unknown>;
      const parsedBody = ListBodySchema.safeParse({
        ...(body.limit !== undefined ? { limit: body.limit } : {}),
      });
      if (!parsedBody.success) {
        return invalid(reply, requestId, "LIMIT_INVALID", "`limit` must be a positive integer (max 200).");
      }

      const service = getModelManagementService();
      let listed: Awaited<ReturnType<typeof service.listVersions>>;
      let pointer: ModelManagementResult<string | null>;
      try {
        [listed, pointer] = await Promise.all([
          service.listVersions(ctx.scenarioId, parsedBody.data.limit),
          service.getCurrentVersionPointer(ctx.scenarioId),
        ]);
      } catch (err) {
        // The service maps its own errors; a throw here is harness-level.
        log.error(
          {
            event: "v5.scenario_versions.list_failed",
            request_id: requestId,
            scenario_id: ctx.scenarioId,
            err: err instanceof Error ? err.message : String(err),
          },
          "Scenario versions — list threw; failing closed",
        );
        return unavailable(reply, requestId, "Versions could not be read right now.");
      }

      if (listed.status === "disabled" || pointer.status === "disabled") {
        return disabled(reply, requestId);
      }
      if (listed.status !== "ok" || pointer.status !== "ok") {
        return unavailable(reply, requestId, "Versions could not be read right now.");
      }

      // Egress validation with the prepared strict contract — a malformed row
      // is REFUSED (fail closed), never emitted for a consumer to choke on.
      const versions: unknown[] = [];
      for (const row of listed.value) {
        const validated = ModelVersionSummaryResponseSchema.safeParse(row);
        if (!validated.success) {
          log.error(
            {
              event: "v5.scenario_versions.summary_egress_invalid",
              request_id: requestId,
              scenario_id: ctx.scenarioId,
              issues: validated.error.issues.slice(0, 5),
            },
            "Scenario versions — a summary row failed the egress contract; failing closed",
          );
          return unavailable(reply, requestId, "Versions could not be read right now.");
        }
        versions.push(validated.data);
      }

      return reply.code(200).send({
        schema: MODEL_VERSIONS_LIST_SCHEMA,
        scenario_id: ctx.scenarioId,
        versions,
        current_version_id: pointer.value,
        request_id: requestId,
      });
    },
  );

  // ───────────────────────────────────────────────────────────────────────────
  // SAVE — POST /assist/v1/scenarios/:scenario_id/versions/save
  // ───────────────────────────────────────────────────────────────────────────
  app.post<{ Params: { scenario_id: string } }>(
    "/assist/v1/scenarios/:scenario_id/versions/save",
    { config: { rateLimit: { max: WRITE_RATE_LIMIT_MAX, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const requestId = getRequestId(req);

      const ctx = await preflight(req, reply);
      if (ctx === null) return;

      // Route-local body AFTER the pre-flight — authentication precedes body
      // validation (see THE BODY PARSE IS LAST in the header).
      const body = (req.body ?? {}) as Record<string, unknown>;
      const parsedBody = SaveBodySchema.safeParse({
        ...(body.label !== undefined ? { label: body.label } : {}),
        ...(body.expected_graph_identity_hash !== undefined
          ? { expected_graph_identity_hash: body.expected_graph_identity_hash }
          : {}),
      });
      if (!parsedBody.success) {
        return invalid(
          reply,
          requestId,
          "SAVE_PAYLOAD_INVALID",
          "`label` must be a 1–200 character string; `expected_graph_identity_hash` must be a 64-hex sha256.",
        );
      }

      // The graph being versioned is the SERVER's — never the client's. A
      // `graph` field in the body is deliberately never read (see header).
      const store = getSessionStore();
      let currentGraph: unknown;
      try {
        currentGraph = await store.loadGraph(ctx.scenarioId);
      } catch (err) {
        log.warn(
          {
            event: "v5.scenario_versions.save_base_read_failed",
            request_id: requestId,
            scenario_id: ctx.scenarioId,
            err: err instanceof Error ? err.message : String(err),
          },
          "Scenario versions — current graph unreadable; failing closed",
        );
        return unavailable(reply, requestId, "The version could not be saved right now.");
      }

      const service = getModelManagementService();
      const result = await service.saveVersion({
        scenario_id: ctx.scenarioId,
        graph: currentGraph,
        ...(parsedBody.data.label !== undefined ? { label: parsedBody.data.label } : {}),
        provenance: "user_save",
        ...(parsedBody.data.expected_graph_identity_hash !== undefined
          ? { expected_graph_identity_hash: parsedBody.data.expected_graph_identity_hash }
          : {}),
      });

      if (result.status === "disabled") return disabled(reply, requestId);
      if (result.status === "conflict") return stale(reply, requestId);
      if (result.status === "error") {
        switch (result.error.code) {
          case "sign_in_required":
            return signInRequired(reply, requestId);
          case "empty_graph":
            return invalid(
              reply,
              requestId,
              "NOTHING_TO_SAVE",
              "There is no model content to version yet. Add to your model, then save a version.",
            );
          default:
            return unavailable(reply, requestId, "The version could not be saved right now.");
        }
      }

      const outcome = VersionWriteOutcomeResponseSchema.safeParse(result.value);
      if (!outcome.success) {
        return unavailable(reply, requestId, "The version could not be saved right now.");
      }

      log.info(
        {
          event: "v5.scenario_versions.saved",
          request_id: requestId,
          scenario_id: ctx.scenarioId,
          version_number: result.value.version_number,
          deduped: result.value.deduped,
        },
        "Scenario versions — named version saved",
      );

      return reply.code(200).send({
        schema: MODEL_VERSION_SAVE_SCHEMA,
        scenario_id: ctx.scenarioId,
        version: outcome.data,
        request_id: requestId,
      });
    },
  );

  // ───────────────────────────────────────────────────────────────────────────
  // RESTORE — POST /assist/v1/scenarios/:scenario_id/versions/restore
  // ───────────────────────────────────────────────────────────────────────────
  app.post<{ Params: { scenario_id: string } }>(
    "/assist/v1/scenarios/:scenario_id/versions/restore",
    { config: { rateLimit: { max: WRITE_RATE_LIMIT_MAX, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const requestId = getRequestId(req);
      const startedAt = Date.now();

      const ctx = await preflight(req, reply);
      if (ctx === null) return;

      // Route-local body AFTER the pre-flight — authentication precedes body
      // validation (see THE BODY PARSE IS LAST in the header).
      const body = (req.body ?? {}) as Record<string, unknown>;
      const parsedBody = RestoreBodySchema.safeParse({
        version_id: body.version_id,
        ...(body.label !== undefined ? { label: body.label } : {}),
        ...(body.expected_graph_identity_hash !== undefined
          ? { expected_graph_identity_hash: body.expected_graph_identity_hash }
          : {}),
      });
      if (!parsedBody.success) {
        return invalid(
          reply,
          requestId,
          "RESTORE_PAYLOAD_INVALID",
          "`version_id` must be a UUID; `mutation_id` 8–128 chars of [A-Za-z0-9_-] and is REQUIRED (it is the idempotency key that makes a retry safe); `label` 1–200 chars; `expected_graph_identity_hash` a 64-hex sha256.",
        );
      }

      const service = getModelManagementService();

      // ── 4. The target version — read BEFORE anything mutates ────────────
      // This read is NOT the authority: the RPC re-reads the row under its
      // own lock and refuses (MV409) if the identity moved. This read exists
      // so the bytes can be validated and projected in TypeScript, where the
      // ingress contract and the persistence projection live.
      const target = await service.getVersion(ctx.scenarioId, parsedBody.data.version_id);
      if (target.status === "disabled") return disabled(reply, requestId);
      if (target.status === "conflict") return stale(reply, requestId);
      if (target.status === "error") {
        if (target.error.code === "version_not_found") {
          return versionNotFound(reply, requestId);
        }
        if (target.error.code === "sign_in_required") return signInRequired(reply, requestId);
        return unavailable(reply, requestId, RESTORE_UNAVAILABLE_MESSAGE);
      }
      const targetRecord: ModelVersionRecord = target.value;

      // ── 5. The stored graph must still satisfy the ingress contract ─────
      // A version that no longer parses is refused honestly, never written.
      const parsedGraph = GraphStateIngressSchema.safeParse(targetRecord.graph);
      if (!parsedGraph.success) {
        return invalid(
          reply,
          requestId,
          "VERSION_GRAPH_INCOMPATIBLE",
          "This version was saved under an older model format and can no longer be restored.",
          { issues: parsedGraph.error.issues.slice(0, 5) },
        );
      }

      // Re-projected to today's persisted form (idempotent by design). These
      // are the bytes that become BOTH the working graph and the new head
      // version — one graph, written once, in one transaction.
      const graphForStore = projectGraphForPersistence(parsedGraph.data, {
        scenarioId: ctx.scenarioId,
        turnClass: "direct_answer",
        source: "version_restore",
      });

      // ── 6. THE ONE WRITE ────────────────────────────────────────────────
      // Everything the restore changes — the undo snapshot, the new head
      // version, the head pointer, the working graph and the journey event —
      // happens inside `restore_model_version_atomic`, which is a single
      // plpgsql invocation and therefore a single transaction.
      //
      // ⚠ THIS ROUTE MUST CONTINUE TO MAKE EXACTLY ONE MUTATING CALL. The
      // pre-atomic version made three (snapshot RPC → restore RPC → graph
      // append), each committing separately, which is what made a partial
      // state REPRESENTABLE and forced the honest-but-awful
      // `RESTORE_INCOMPLETE` / `version_recorded: true` response. There is no
      // fallback path and there must never be one: a fallback is a second
      // writer, and a second writer is the defect.
      //
      // `mutation_id` is the caller's idempotency key. A replay returns the
      // ORIGINAL receipt and writes nothing; two concurrent attempts from one
      // base produce exactly one success and one 409, decided under the RPC's
      // row lock rather than by anything here.
      const restored = await service.restoreVersionAtomic({
        scenario_id: ctx.scenarioId,
        version_id: parsedBody.data.version_id,
        mutation_id: parsedBody.data.mutation_id,
        graph: graphForStore,
        expected_source_identity_hash: targetRecord.graph_identity_hash,
        ...(parsedBody.data.label !== undefined ? { label: parsedBody.data.label } : {}),
        ...(parsedBody.data.expected_graph_identity_hash !== undefined
          ? {
              expected_graph_identity_hash:
                parsedBody.data.expected_graph_identity_hash,
            }
          : {}),
      });

      if (restored.status === "disabled") return disabled(reply, requestId);
      if (restored.status === "conflict") return stale(reply, requestId);
      if (restored.status === "error") {
        switch (restored.error.code) {
          case "sign_in_required":
            return signInRequired(reply, requestId);
          case "version_not_found":
            return versionNotFound(reply, requestId);
          case "empty_graph":
            return invalid(
              reply,
              requestId,
              "VERSION_GRAPH_INCOMPATIBLE",
              "This version was saved under an older model format and can no longer be restored.",
            );
          case "base_unverifiable":
            // The scenario holds a graph whose identity was never recorded,
            // so the base cannot be verified. Refused, not assumed — and
            // NOTHING was written, which is why this is a plain 503 with no
            // partial-state field to report.
            return reply
              .code(503)
              .send(
                buildErrorV1(
                  "INTERNAL",
                  "The model's current state could not be verified, so nothing was changed. Try again shortly.",
                  { code: "RESTORE_BASE_UNVERIFIABLE" },
                  requestId,
                ),
              );
          default:
            return unavailable(reply, requestId, RESTORE_UNAVAILABLE_MESSAGE);
        }
      }

      const outcome: AtomicRestoreOutcome = restored.value;

      log.info(
        {
          event: "v5.scenario_versions.restored",
          request_id: requestId,
          scenario_id: ctx.scenarioId,
          version_id: outcome.version_id,
          restored_from_version_id: outcome.restored_from_version_id,
          undo_version_id: outcome.undo_version_id,
          replayed: outcome.replayed,
          duration_ms: Date.now() - startedAt,
        },
        outcome.replayed
          ? "Scenario versions — restore replayed; the original receipt was returned and nothing was written"
          : "Scenario versions — version restored atomically (undo snapshot, head and working graph committed together)",
      );

      // ── 7. ONE canonical receipt ────────────────────────────────────────
      // `graph` and `graph_identity_hash` describe the bytes now held by BOTH
      // the scenario and the new head version. A reload that disagrees with
      // this receipt is a defect, not a race — that is the whole guarantee.
      return reply.code(200).send({
        schema: MODEL_VERSION_RESTORE_SCHEMA,
        scenario_id: ctx.scenarioId,
        restored: true,
        replayed: outcome.replayed,
        version: {
          version_id: outcome.version_id,
          version_number: outcome.version_number,
          graph_identity_hash: outcome.graph_identity_hash,
          restored_from_version_id: outcome.restored_from_version_id,
        },
        undo_version_id: outcome.undo_version_id,
        graph: outcome.graph,
        graph_identity_hash: outcome.graph_identity_hash,
        request_id: requestId,
      });
    },
  );
}
