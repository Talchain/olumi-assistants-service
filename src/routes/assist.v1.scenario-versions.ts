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
 *   POST /assist/v1/scenarios/:scenario_id/versions/compare  — compare two stored versions (read tier)
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
 * · ⚠ THE BODY PARSE IS LAST, NOT FIRST (corrected 2026-08-17). These four
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
 * ── WHAT A RESTORE IS: ONE GUARDED TRANSACTION ──────────────────────────────
 * Restore atomically replaces the working graph and records its immutable
 * version, head, journey event, undo pointer and analysis invalidation marker.
 * Exact full-identity CAS runs while the scenario is locked. Any refusal or
 * write failure rolls back the entire mutation; a same-mutation retry returns
 * the original canonical receipt without adding rows or moving state.
 *
 * Restore accepts NO client graph either: the bytes appended are the STORED
 * version's, re-validated against the GraphV3 contract before the atomic RPC.
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
import { AnalysisStateV1Schema } from "@talchain/schemas/boundary";

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
  VersionComparisonResponseSchema,
  VersionWriteOutcomeResponseSchema,
  SIGN_IN_REQUIRED_MESSAGE,
} from "../orchestrator-v5/model-management/index.js";
import {
  ModelVersionMutationReceiptV1LocalSchema,
  toModelVersionMutationReceiptV1,
} from "../orchestrator-v5/model-management/mutation-receipt.js";
import type {
  ModelManagementResult,
  ModelVersionRecord,
} from "../orchestrator-v5/model-management/index.js";
import { resolveCeeRateLimit } from "../cee/config/limits.js";
import { buildErrorV1 } from "../utils/errors.js";
import { getRequestId } from "../utils/request-id.js";
import { log } from "../utils/telemetry.js";
import { readScenarioAnalysis } from "./scenario-graph-analysis-read.js";

/** Wire schema discriminators. Frozen — the UI lane builds against these. */
export const MODEL_VERSIONS_LIST_SCHEMA = "model_versions_list.v1" as const;
export const MODEL_VERSION_DIFF_SCHEMA = "model_version_diff.v1" as const;
export const MODEL_VERSION_SAVE_SCHEMA = "model_version_save.v1" as const;
export const MODEL_VERSION_RESTORE_SCHEMA = "model_version_restore.v2" as const;

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
const CompareBodySchema = z.object({
  from_version_id: z.string().uuid(),
  to_version_id: z.string().uuid(),
});
const COMPARE_BODY_ALLOWED_KEYS = new Set([
  "user_id",
  "from_version_id",
  "to_version_id",
]);
const AtomicRestoreRouteResponseSchema = z
  .object({
    schema: z.literal(MODEL_VERSION_RESTORE_SCHEMA),
    scenario_id: z.string().uuid(),
    restored: z.literal(true),
    receipt: ModelVersionMutationReceiptV1LocalSchema,
    analysis_state: AnalysisStateV1Schema.nullable(),
    request_id: z.string().min(1),
  })
  .strict();
const RestoreBodySchema = z.object({
  version_id: z.string().uuid(),
  mutation_id: z.string().uuid(),
  label: z.string().min(1).max(200).optional(),
  expected_graph_identity_hash: Sha256Hex.nullable(),
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
   * Steps 0–3 of the family order, shared by all four routes: identity →
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
  // COMPARE — POST /assist/v1/scenarios/:scenario_id/versions/compare
  // ───────────────────────────────────────────────────────────────────────────
  app.post<{ Params: { scenario_id: string } }>(
    "/assist/v1/scenarios/:scenario_id/versions/compare",
    { config: { rateLimit: { max: LIST_RATE_LIMIT_MAX, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const requestId = getRequestId(req);
      const ctx = await preflight(req, reply);
      if (ctx === null) return;

      const body = (req.body ?? {}) as Record<string, unknown>;
      if (Object.keys(body).some((key) => !COMPARE_BODY_ALLOWED_KEYS.has(key))) {
        return invalid(
          reply,
          requestId,
          "VERSION_COMPARE_SERVER_AUTHORITY_REQUIRED",
          "Compare accepts version IDs only; graph and hash truth are loaded by the server.",
        );
      }
      const parsedBody = CompareBodySchema.safeParse({
        from_version_id: body.from_version_id,
        to_version_id: body.to_version_id,
      });
      if (!parsedBody.success) {
        return invalid(
          reply,
          requestId,
          "VERSION_COMPARE_PAYLOAD_INVALID",
          "`from_version_id` and `to_version_id` must be UUIDs.",
        );
      }

      const service = getModelManagementService();
      const result = await service.compareVersions(
        ctx.scenarioId,
        parsedBody.data.from_version_id,
        parsedBody.data.to_version_id,
      );
      if (result.status === "disabled") return disabled(reply, requestId);
      if (result.status === "conflict") return stale(reply, requestId);
      if (result.status === "error") {
        if (result.error.code === "version_not_found") {
          return reply.code(404).send(
            buildErrorV1(
              "NOT_FOUND",
              "One of those versions is no longer available.",
              { code: "VERSION_NOT_FOUND" },
              requestId,
            ),
          );
        }
        if (result.error.code === "version_graph_incompatible") {
          return invalid(
            reply,
            requestId,
            "VERSION_GRAPH_INCOMPATIBLE",
            "One of those versions cannot be compared safely.",
          );
        }
        if (result.error.code === "sign_in_required") return signInRequired(reply, requestId);
        return unavailable(reply, requestId, "Those versions could not be compared right now.");
      }

      const validated = VersionComparisonResponseSchema.safeParse(result.value);
      if (!validated.success) {
        log.error(
          {
            event: "v5.scenario_versions.compare_egress_invalid",
            request_id: requestId,
            scenario_id: ctx.scenarioId,
            issues: validated.error.issues.slice(0, 5),
          },
          "Scenario versions — comparison failed the egress contract; failing closed",
        );
        return unavailable(reply, requestId, "Those versions could not be compared right now.");
      }

      const comparison = validated.data;
      const wireComparison = comparison.relation === "different"
        ? (({ diff: _internalCounts, short_circuit: _internalShortCircuit, ...wire }) => wire)(comparison)
        : (({ short_circuit: _internalShortCircuit, ...wire }) => wire)(comparison);
      return reply.code(200).send({
        schema: MODEL_VERSION_DIFF_SCHEMA,
        scenario_id: ctx.scenarioId,
        ...wireComparison,
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

      const ctx = await preflight(req, reply);
      if (ctx === null) return;

      // Route-local body AFTER the pre-flight — authentication precedes body
      // validation (see THE BODY PARSE IS LAST in the header).
      const body = (req.body ?? {}) as Record<string, unknown>;
      const parsedBody = RestoreBodySchema.safeParse({
        version_id: body.version_id,
        mutation_id: body.mutation_id,
        ...(body.label !== undefined ? { label: body.label } : {}),
        expected_graph_identity_hash: body.expected_graph_identity_hash,
      });
      if (!parsedBody.success) {
        return invalid(
          reply,
          requestId,
          "RESTORE_PAYLOAD_INVALID",
          "`version_id` and `mutation_id` must be UUIDs; `label` 1–200 chars; `expected_graph_identity_hash` is required and must be null or a 64-hex sha256.",
        );
      }

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

      // ── 6. Current graph — server-read input to atomic CAS + undo capture ─
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
          "Scenario versions — current graph unreadable; refusing atomic restore",
        );
        return unavailable(reply, requestId, "The version could not be restored right now.");
      }

      // ── 7. Normalise the stored target; still no client graph authority ──
      const graphForStore = projectGraphForPersistence(parsedGraph.data, {
        scenarioId: ctx.scenarioId,
        turnClass: "direct_answer",
        source: "version_restore",
      });

      // ── 8. ONE RPC owns graph + undo + version + head + event ───────────
      const restored = await service.restoreVersionAtomic({
        scenario_id: ctx.scenarioId,
        version_id: parsedBody.data.version_id,
        mutation_id: parsedBody.data.mutation_id,
        graph: graphForStore,
        source_graph_identity_hash: targetRecord.graph_identity_hash,
        current_graph: currentGraph,
        expected_graph_identity_hash: parsedBody.data.expected_graph_identity_hash,
        actor_kind: "known",
        authored_by: "owner",
        source_turn_id: null,
        ...(parsedBody.data.label !== undefined
          ? { label: parsedBody.data.label }
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
          case "mutation_id_reused":
            return reply
              .code(409)
              .send(
                buildErrorV1(
                  "BAD_INPUT",
                  "This restore identity was already used for another version.",
                  { code: "MUTATION_ID_REUSED" },
                  requestId,
                ),
              );
          case "empty_graph":
            return invalid(
              reply,
              requestId,
              "VERSION_GRAPH_INCOMPATIBLE",
              "This version has no restorable model content.",
            );
          default:
            return unavailable(reply, requestId, "The version could not be restored right now.");
        }
      }

      const replayed = restored.value.replayed;
      const analysis = await readScenarioAnalysis({
        scenarioId: ctx.scenarioId,
        graph: restored.value.graph,
        requestId,
        analysisInvalidatedAt: restored.value.analysis_invalidated_at,
      });
      const outcome = AtomicRestoreRouteResponseSchema.safeParse({
        schema: MODEL_VERSION_RESTORE_SCHEMA,
        scenario_id: ctx.scenarioId,
        restored: true,
        receipt: toModelVersionMutationReceiptV1(ctx.scenarioId, restored.value),
        analysis_state: analysis.analysis_state,
        request_id: requestId,
      });
      if (!outcome.success) {
        return unavailable(reply, requestId, "The version could not be restored right now.");
      }

      log.info(
        {
          event: "v5.scenario_versions.restored",
          request_id: requestId,
          scenario_id: ctx.scenarioId,
          mutation_id: outcome.data.receipt.mutation_id,
          version_id: outcome.data.receipt.version_id,
          restored_from_version_id: parsedBody.data.version_id,
          replayed,
          undo_version_id: outcome.data.receipt.undo_version_id,
        },
        "Scenario versions — version restored to the working graph",
      );

      return reply.code(200).send(outcome.data);
    },
  );
}
