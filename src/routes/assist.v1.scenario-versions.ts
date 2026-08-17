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
 *   a URL. · Order: identity → UUID → EXISTENCE → ownership → the operation —
 *   existence BEFORE ownership because `authorizeScenarioOwnership` UPSERTS and
 *   none of these routes may create the row it addresses (the read route's pin;
 *   restore is a write to the GRAPH but must still never mint a scenario).
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
 * ── WHAT A RESTORE IS: GUARDED, RPC-FIRST, HONEST ABOUT ITS SEAM ───────────
 * Restore overwrites the working graph, so it is guarded twice:
 *
 *   1. THE PRE-RESTORE SNAPSHOT. The CURRENT graph is saved (provenance
 *      `pre_restore`) BEFORE anything changes, so the state being replaced is
 *      always recoverable — the response carries it as `undo_version_id`.
 *      The RPC's no-op dedupe makes this free when the head version already
 *      captures the current graph (the steady state with the commit-seam hook
 *      on), and it is exactly the guard that matters when it does NOT (drift
 *      accumulated while versioning was off would otherwise be unrecoverable).
 *      If the current graph cannot be READ, the restore is REFUSED (503) — an
 *      unverifiable precondition is refused, not assumed.
 *   2. THE CAS CHAIN. The client's `expected_graph_identity_hash` (the head it
 *      showed the user) gates the snapshot; the snapshot's own resulting head
 *      hash gates the restore RPC. A concurrent commit moving the head fails
 *      the chain with 409 BEFORE the working graph is touched.
 *
 * Order is RPC-first, append-second: every refusal the RPC can raise (guest
 * MV001, absent version MV404, stale head MV409) lands before the working
 * graph moves. The append then writes the restored graph through the ONE
 * sanctioned atomic writer — `store.append` as a `direct_answer` / null-handler
 * turn (the graph-registration precedent; `store_draft_graph` is banned here
 * because it does not move `graph_identity_hash` with the graph and would
 * poison every later CAS compare). If the append fails AFTER the RPC, the
 * response says so honestly (`RESTORE_INCOMPLETE`, `version_recorded: true`)
 * — and a retried restore CONVERGES: the RPC dedupes (the head already carries
 * the target's envelope) and the append re-runs.
 *
 * Restore accepts NO client graph either: the bytes appended are the STORED
 * version's, re-validated against the ingress contract and re-projected
 * through `projectGraphForPersistence` (idempotent by design; a version saved
 * under an older projection is normalised to today's persisted form, and a
 * version that no longer parses is refused honestly rather than written).
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
import type { GraphStateIngress } from "../orchestrator-v5/boundary/request-extensions.js";
import {
  authorizeScenarioOwnership,
  resolveVerifiedIdentityOrRefuse,
} from "../orchestrator/route-v2-preflight.js";
import { computeGraphIdentityHash } from "../orchestrator-v5/context/graph-identity.js";
import { computeExpectedGraphCasHashes } from "../orchestrator-v5/context/graph-cas-conflict.js";
import { projectGraphForPersistence } from "../orchestrator-v5/persisted-graph-projection.js";
import { getSessionStore } from "../orchestrator-v5/session/index.js";
import { GraphStaleWriteError } from "../orchestrator-v5/session/store.js";
import {
  getModelManagementService,
  ModelVersionSummaryResponseSchema,
  VersionWriteOutcomeResponseSchema,
  SIGN_IN_REQUIRED_MESSAGE,
} from "../orchestrator-v5/model-management/index.js";
import type {
  ModelManagementResult,
  ModelVersionRecord,
  VersionWriteOutcome,
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
const RestoreBodySchema = z.object({
  version_id: z.string().uuid(),
  label: z.string().min(1).max(200).optional(),
  expected_graph_identity_hash: Sha256Hex.optional(),
});

/**
 * `turn_id` for the restore commit — prefixed so the turn log says WHY the
 * graph moved, unique per request so the idempotency key never collides.
 * (The graph-registration precedent, verbatim.)
 */
function restoreTurnId(): string {
  return `version_restore:${globalThis.crypto.randomUUID()}`;
}

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
      const body = (req.body ?? {}) as Record<string, unknown>;

      // Payload validation BEFORE any database work (register-route rule):
      // the caller supplied these bytes, so a bad limit costs no round trip.
      const parsedBody = ListBodySchema.safeParse({
        ...(body.limit !== undefined ? { limit: body.limit } : {}),
      });
      if (!parsedBody.success) {
        return invalid(reply, requestId, "LIMIT_INVALID", "`limit` must be a positive integer (max 200).");
      }

      const ctx = await preflight(req, reply);
      if (ctx === null) return;

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

      const ctx = await preflight(req, reply);
      if (ctx === null) return;

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
          "`version_id` must be a UUID; `label` 1–200 chars; `expected_graph_identity_hash` a 64-hex sha256.",
        );
      }

      const ctx = await preflight(req, reply);
      if (ctx === null) return;

      const service = getModelManagementService();

      // ── 4. The target version — read BEFORE anything mutates ────────────
      const target = await service.getVersion(ctx.scenarioId, parsedBody.data.version_id);
      if (target.status === "disabled") return disabled(reply, requestId);
      if (target.status === "conflict") return stale(reply, requestId);
      if (target.status === "error") {
        if (target.error.code === "version_not_found") {
          return reply
            .code(404)
            .send(
              buildErrorV1(
                "NOT_FOUND",
                "That version is no longer available.",
                { code: "VERSION_NOT_FOUND" },
                requestId,
              ),
            );
        }
        if (target.error.code === "sign_in_required") return signInRequired(reply, requestId);
        return unavailable(reply, requestId, "The version could not be restored right now.");
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

      // ── 6. The current graph — the thing the snapshot guard protects ────
      // Unreadable ⇒ REFUSE (503). Restoring blind would overwrite a state no
      // version captures; an unverifiable precondition is refused, not assumed.
      const store = getSessionStore();
      let currentGraph: unknown;
      try {
        currentGraph = await store.loadGraph(ctx.scenarioId);
      } catch (err) {
        log.warn(
          {
            event: "v5.scenario_versions.restore_base_read_failed",
            request_id: requestId,
            scenario_id: ctx.scenarioId,
            err: err instanceof Error ? err.message : String(err),
          },
          "Scenario versions — current graph unreadable; refusing restore (the snapshot guard cannot run blind)",
        );
        return unavailable(reply, requestId, "The version could not be restored right now.");
      }

      // ── 7. THE PRE-RESTORE SNAPSHOT GUARD ───────────────────────────────
      // Client's expected hash gates THIS write (the head the user saw).
      // `undo_version_id` is the snapshot's id — deduped or not, it names the
      // version that holds the pre-restore state.
      let undoVersionId: string | null = null;
      let expectedForRestore: string | undefined =
        parsedBody.data.expected_graph_identity_hash;
      if (currentGraph !== null && currentGraph !== undefined) {
        const snapshot = await service.saveVersion({
          scenario_id: ctx.scenarioId,
          graph: currentGraph,
          label: "Before restore",
          provenance: "pre_restore",
          ...(parsedBody.data.expected_graph_identity_hash !== undefined
            ? {
                expected_graph_identity_hash:
                  parsedBody.data.expected_graph_identity_hash,
              }
            : {}),
        });
        if (snapshot.status === "disabled") return disabled(reply, requestId);
        if (snapshot.status === "conflict") return stale(reply, requestId);
        if (snapshot.status === "error") {
          if (snapshot.error.code === "sign_in_required") {
            return signInRequired(reply, requestId);
          }
          if (snapshot.error.code !== "empty_graph") {
            // A real failure to capture the current state aborts the restore:
            // the guard IS the feature.
            return unavailable(reply, requestId, "The version could not be restored right now.");
          }
          // empty_graph: identity-empty current graph — nothing to lose,
          // nothing to snapshot. The restore proceeds unguarded by design.
        } else {
          undoVersionId = snapshot.value.version_id;
          expectedForRestore = snapshot.value.graph_identity_hash;
        }
      }

      // ── 8. The restore RPC — every refusal BEFORE the working graph moves ─
      const restored = await service.restoreVersion({
        scenario_id: ctx.scenarioId,
        version_id: parsedBody.data.version_id,
        ...(parsedBody.data.label !== undefined ? { label: parsedBody.data.label } : {}),
        ...(expectedForRestore !== undefined
          ? { expected_graph_identity_hash: expectedForRestore }
          : {}),
      });
      if (restored.status === "disabled") return disabled(reply, requestId);
      if (restored.status === "conflict") return stale(reply, requestId);
      if (restored.status === "error") {
        switch (restored.error.code) {
          case "sign_in_required":
            return signInRequired(reply, requestId);
          case "version_not_found":
            return reply
              .code(404)
              .send(
                buildErrorV1(
                  "NOT_FOUND",
                  "That version is no longer available.",
                  { code: "VERSION_NOT_FOUND" },
                  requestId,
                ),
              );
          default:
            return unavailable(reply, requestId, "The version could not be restored right now.");
        }
      }
      const restoredOutcome: VersionWriteOutcome = restored.value;

      // ── 9. The append — the sanctioned atomic writer, skipped on dedupe ──
      // A deduped restore means the head ALREADY carries the target's identity
      // envelope AND the snapshot step proved the current graph matches that
      // head — the working graph is already the target state. Nothing to write.
      const graphForStore = projectGraphForPersistence(parsedGraph.data, {
        scenarioId: ctx.scenarioId,
        turnClass: "direct_answer",
        source: "version_restore",
      });

      if (!restoredOutcome.deduped) {
        // CAS base from the SERVER's own current bytes (the register-route
        // rule: never from the request).
        let expectedGraphIdentityHash: string | null | undefined;
        let expectedGraphAnalysisHash: string | null | undefined;
        try {
          const hashes = computeExpectedGraphCasHashes(currentGraph);
          expectedGraphIdentityHash = hashes.expectedGraphIdentityHash;
          expectedGraphAnalysisHash = hashes.expectedGraphAnalysisHash;
        } catch {
          expectedGraphIdentityHash = undefined;
          expectedGraphAnalysisHash = undefined;
        }

        const turnId = restoreTurnId();
        try {
          await store.append({
            scenario_id: ctx.scenarioId,
            turn_id: turnId,
            turn_class: "direct_answer",
            handler_id: null,
            request_hash: turnId,
            response_emitted: false,
            llm_calls_used: 0,
            duration_ms: Date.now() - startedAt,
            handler_facts: [],
            graph: graphForStore,
            expectedGraphIdentityHash,
            expectedGraphAnalysisHash,
          });
        } catch (err) {
          if (err instanceof GraphStaleWriteError) {
            // The working graph moved between the RPC and the append. Nothing
            // was overwritten; the version row IS recorded. Honest 409.
            log.warn(
              {
                event: "v5.scenario_versions.restore_append_cas_conflict",
                request_id: requestId,
                scenario_id: ctx.scenarioId,
              },
              "Scenario versions — restore append CAS conflict; version recorded, working graph untouched",
            );
            return reply
              .code(409)
              .send(
                buildErrorV1(
                  "BAD_INPUT",
                  "This model changed while restoring. Nothing was overwritten — refresh and try again.",
                  { code: "VERSION_STALE", version_recorded: true },
                  requestId,
                ),
              );
          }
          log.error(
            {
              event: "v5.scenario_versions.restore_append_failed",
              request_id: requestId,
              scenario_id: ctx.scenarioId,
              err: err instanceof Error ? err.message : String(err),
            },
            "Scenario versions — restore recorded but the working graph write failed; retry converges",
          );
          return reply
            .code(503)
            .send(
              buildErrorV1(
                "INTERNAL",
                "The restore did not complete. The version was recorded but the working model was not updated — try again.",
                { code: "RESTORE_INCOMPLETE", version_recorded: true },
                requestId,
              ),
            );
        }
      }

      const outcome = VersionWriteOutcomeResponseSchema.safeParse(restoredOutcome);
      if (!outcome.success) {
        return unavailable(reply, requestId, "The version could not be restored right now.");
      }

      const identity = computeGraphIdentityHash(graphForStore as GraphStateIngress);

      log.info(
        {
          event: "v5.scenario_versions.restored",
          request_id: requestId,
          scenario_id: ctx.scenarioId,
          version_id: restoredOutcome.version_id,
          restored_from_version_id: parsedBody.data.version_id,
          deduped: restoredOutcome.deduped,
          undo_version_id: undoVersionId,
        },
        "Scenario versions — version restored to the working graph",
      );

      return reply.code(200).send({
        schema: MODEL_VERSION_RESTORE_SCHEMA,
        scenario_id: ctx.scenarioId,
        restored: true,
        deduped: restoredOutcome.deduped,
        version: outcome.data,
        undo_version_id: undoVersionId,
        // The restored graph, exactly as persisted — for the client-side
        // receipt-class reconcile (adds + updates + deletions, layout local).
        graph: graphForStore,
        graph_identity_hash: identity,
        request_id: requestId,
      });
    },
  );
}
