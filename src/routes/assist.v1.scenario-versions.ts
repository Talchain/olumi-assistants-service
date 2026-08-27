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
 *   a URL.
 *
 *   ⚠⚠ THE SECOND HALF OF THAT SENTENCE NO LONGER DESCRIBES OWNERSHIP, AND THE
 *      HEADING ABOVE IT WAS FALSE FOR ONE COMMIT. Both are left standing and
 *      corrected here rather than rewritten, because WHY they drifted is the
 *      load-bearing part.
 *
 *      WHAT WAS TRUE WHEN WRITTEN — the body-supplied `user_id` was the
 *      ownership input on every route of this file, so "identity
 *      travels in the BODY" described the authorization decision as well as
 *      the transport.
 *
 *      WHAT IS TRUE NOW (26 Aug 2026) — ownership on every route of this
 *      family is the VERIFIED TOKEN SUBJECT. A request-supplied identifier is
 *      not an input to it, in either direction: it can neither grant access
 *      nor withdraw it. The call site below passes
 *      `CALLER_ASSERTED_IDENTITY_NOT_ADMISSIBLE`, exactly as the read and
 *      register routes do. The body is still parsed, and a body that fails to
 *      parse is still refused — so the sentence remains true of TRANSPORT and
 *      of every non-identity extension. It is only ownership that moved.
 *
 *      ⚠⚠ AND THAT MAKES CEE_REQUIRE_USER_JWT LOAD-BEARING, NOT A ROLLBACK
 *         LEVER. The verified token subject is the only ownership input here,
 *         so with the flag OFF (its DEFAULT, and unguarded in that direction)
 *         no caller is ever identified and every OWNED scenario is refused to
 *         its OWN owner on all four endpoints in this file — list, compare,
 *         save and restore. Guest (unowned) scenarios are unaffected.
 *         Disclosed at boot (`config.scenario_ownership_posture`, server.ts)
 *         and pinned in the suite as a KNOWN MISCONFIGURATION.
 *
 *      ⚠ WHY THE HEADING IS RESTORED RATHER THAN DELETED. "INHERITED VERBATIM"
 *        was accurate until the read and register routes were cut over and this
 *        one was not; for that interval the file asserted it followed rules it
 *        no longer followed, which is worse than claiming nothing — a partial
 *        cutover on one prefix family reads as a closed seam. The heading is
 *        true again because this route was cut over to the same shape, not
 *        because the claim was softened. If a future change moves one member of
 *        this family, it moves all of them or this heading comes out with it.
 *        All four endpoints in this file share one pre-flight helper, so the
 *        single call site below governs the whole file — including `/compare`,
 *        added after this correction was first written.
 *
 * · Order: identity → UUID → EXISTENCE → ownership → route-local BODY
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
 * ── UNDO IS A RESTORE, AND THE RETURN LEG IS ADMISSIBLE ────────────────────
 * There is no undo route and there must not be one: undo is "restore the
 * version the current head names as its undo pointer", so it produces the same
 * version/hash/receipt/event truth as any other canonical mutation, and
 * analysis/readiness respond to the restored canonical snapshot rather than to
 * any client-side history. The structural floor's delta check had no concept
 * for a target the scenario ALREADY HELD, which made restore a one-way door on
 * a legacy-corrupt scenario; `isReturnLegRestore` names that case apart. It is
 * an identity binding to exactly one version, it fails closed in every
 * direction, and it is a REAL widening of what this route may write — all of
 * which is argued at that function.
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
  CALLER_ASSERTED_IDENTITY_NOT_ADMISSIBLE,
} from "../orchestrator/route-v2-preflight.js";
import { projectGraphForPersistence } from "../orchestrator-v5/persisted-graph-projection.js";
import { assertNoIntroducedGraphViolations } from "../orchestrator-v5/persist-graph-write.js";
import {
  PersistedGraphInvariantError,
  checkPersistedGraphInvariants,
} from "../orchestrator-v5/persisted-graph-invariants.js";
import { computeGraphIdentityHash } from "../orchestrator-v5/context/graph-identity.js";
import type { GraphStateIngress } from "../orchestrator-v5/boundary/request-extensions.js";
import { getSessionStore } from "../orchestrator-v5/session/index.js";
import {
  getModelManagementService,
  MODEL_VERSION_LIST_DEFAULT_LIMIT,
  VersionComparisonResponseSchema,
  VersionWriteOutcomeResponseSchema,
  SIGN_IN_REQUIRED_MESSAGE,
} from "../orchestrator-v5/model-management/index.js";
import {
  ModelVersionMutationReceiptV1LocalSchema,
  toModelVersionMutationReceiptV1,
} from "../orchestrator-v5/model-management/mutation-receipt.js";
import {
  decodeModelVersionsCursor,
  encodeModelVersionsCursor,
  ModelVersionSummaryV2LocalSchema,
  ModelVersionsListV2LocalSchema,
  type ModelVersionSummaryV2Local,
} from "../orchestrator-v5/model-management/history-v2.js";
import { ModelVersionDiffV1LocalSchema } from "../orchestrator-v5/model-management/diff-v1.js";
import type {
  ModelManagementResult,
  ModelVersionRecord,
  ModelVersionSummary,
} from "../orchestrator-v5/model-management/index.js";
import { resolveCeeRateLimit } from "../cee/config/limits.js";
import { buildErrorV1 } from "../utils/errors.js";
import { getRequestId } from "../utils/request-id.js";
import { log } from "../utils/telemetry.js";
import { readScenarioAnalysis } from "./scenario-graph-analysis-read.js";

/** Wire schema discriminators. Frozen — the UI lane builds against these. */
export const MODEL_VERSIONS_LIST_SCHEMA = "model_versions_list.v2" as const;
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
  cursor: z.string().min(1).optional(),
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

/**
 * ── THE RETURN LEG: is this restore undoing the restore that is currently head?
 *
 * WHY THIS EXISTS. The persistence floor's check is DELTA-SCOPED: it refuses a
 * write whose violations the CURRENT graph does not already carry
 * (`persisted-graph-invariants.ts:195-260`). That predicate answers *"does the
 * target carry violations the current graph doesn't?"*, and the guarantee it
 * serves is *"don't make the scenario structurally worse"*.
 *
 * ⭐ THOSE ARE THE SAME QUESTION ONLY WHEN THE TARGET IS A **NEW** STATE. They
 * diverge when the target is a state this scenario ALREADY HELD: returning
 * there makes it exactly as bad as it was a moment ago, with the floor's own
 * consent, so no "worse" is possible. The predicate is correct for the outward
 * leg and simply had NO CONCEPT for the return leg — CLAUDE.md trap 21, two
 * questions under one name. That gap made restore a ONE-WAY DOOR: on a
 * legacy-corrupt scenario, restoring a clean version succeeded and the Undo it
 * offered was refused 422, because the RPC stores the pre-restore working graph
 * as an undo version verbatim (`20260824200000:397-410`) and there is NO
 * separate undo route — undo IS an ordinary restore.
 *
 * WHAT THIS IS NOT. It is NOT "a `pre_restore` version may be restored". That
 * would be a value predicate any legacy row could satisfy (trap 19) and would
 * re-open the floor for every corrupt version this scenario ever held. The
 * admission binds BY IDENTITY to exactly ONE version: the one the current head
 * names as its own undo pointer.
 *
 * THE FOUR CONJUNCTS, and what each one refuses:
 *  1. a head exists                    — nothing to have undone otherwise;
 *  2. the head is itself a RESTORE     — a `user_save` head with a parent
 *                                        pointer is not a restore to return from;
 *  3. head.parent_version_id === the target — THE IDENTITY BINDING. The RPC sets
 *     this to the undo version it captured (`20260824200000:429`), so this is
 *     satisfiable one step back and nowhere else;
 *  4. the working graph IS the head    — compared through the canonical identity
 *     authority (value + full envelope), mirroring the RPC's own undo-reuse
 *     predicate (`20260824200000:379-384`). If a turn has moved the graph on
 *     since the restore, this is NOT a return to a held state — it would be
 *     introducing old corruption into a graph that has since changed — and the
 *     refusal stands.
 *
 * ⚠⚠ DO NOT DELETE CONJUNCT 4 AS REDUNDANT WITH 1-3. IT IS NOT. There are
 * production writers that move `scenarios.graph` WITHOUT moving
 * `current_model_version_id`, and against those, conjuncts 1-3 ALL STILL HOLD
 * after the graph has changed — the identity comparison is the only thing that
 * can see it. Derived, not assumed: `current_model_version_id` has exactly FOUR
 * write sites across every migration (`20260705120000:308` and `:464`, and this
 * migration's `:467` and `:877`) and NONE of them is in
 * `append_turn_atomic_v2/v3/v4` — yet that family writes
 * `UPDATE scenarios SET graph = p_graph`, and it is a LIVE path
 * (`session/supabase-store.ts:378` selects v3 or v2 by config). The same is true
 * of `append_turn_atomic_v5`'s no-version path, which returns early after the
 * delegated graph write (`20260824200000:808-810`).
 *
 * ⚠ AND THE HONEST BOUND, because the over-broad version of this claim is
 * tempting: on the v5 seam an OWNED scenario whose graph actually CHANGED does
 * move the head (`v_should_create`, `20260824200000:615`) and stamps
 * `provenance = 'commit'`, so conjunct 2 catches that one. Conjunct 4 is the
 * sole guard on the v2/v3/v4 seam and on v5's no-version path — not on every
 * conceivable turn.
 *
 * ⚠ EVERY FAILURE MODE FAILS CLOSED. An unreadable head, a null identity, a
 * drifted projection/normaliser envelope: each returns `false`, which restores
 * the pre-existing 422. The widening can only ever be granted by a positive
 * match on all four conjuncts.
 *
 * ⚠ LEGACY LIMIT, STATED NOT SOFTENED: restore rows written by the pre-C8
 * application sequence carry NULL `parent_version_id` (the C8 columns are
 * additive). Their return leg stays refused, correctly — we cannot prove those
 * are held states.
 */
export function isReturnLegRestore(params: {
  readonly head: ModelVersionRecord | null;
  readonly targetVersionId: string;
  readonly currentGraph: unknown;
}): boolean {
  const { head, targetVersionId, currentGraph } = params;
  if (head === null) return false;
  if (head.provenance !== "restore") return false;
  if (head.parent_version_id !== targetVersionId) return false;

  // The identity authority, never a raw byte compare: the head's hash comes
  // from the database and the working graph from `store.loadGraph`, so a
  // JSON-shape comparison would be key-order sensitive across two different
  // serialisation sources. `computeGraphIdentityHash` goes through
  // `stableStringify` and carries the envelope that makes the value meaningful.
  const currentIdentity = computeGraphIdentityHash(
    currentGraph as GraphStateIngress | null | undefined,
  );
  if (currentIdentity === null) return false;

  return (
    currentIdentity.value === head.graph_identity_hash &&
    currentIdentity.algorithm === head.hash_algorithm &&
    currentIdentity.projection_version === head.identity_projection_version &&
    currentIdentity.normaliser_version === head.identity_normaliser_version &&
    currentIdentity.graph_schema_version === head.graph_schema_version
  );
}

function summaryV2(row: ModelVersionSummary): ModelVersionSummaryV2Local | null {
  let actor: ModelVersionSummaryV2Local["actor"];
  if (row.actor_kind === "known") {
    if (row.authored_by === null) return null;
    actor = { kind: "known", authored_by: row.authored_by };
  } else if (row.actor_kind === "system") {
    if (row.authored_by !== null) return null;
    actor = { kind: "system" };
  } else {
    if (row.actor_kind === "unknown" && row.authored_by !== null) return null;
    if (row.actor_kind === null && row.authored_by !== null) return null;
    actor = { kind: "unknown" };
  }

  const mutation_id = row.mutation_id;
  const source_turn_id = row.source_turn_id;
  const sourceVersionId = row.source_version_id ?? row.restored_from_version_id;
  let creation: ModelVersionSummaryV2Local["creation"];
  switch (row.creation_kind) {
    case "initial":
    case "committed_mutation":
    case "unknown":
      if (sourceVersionId !== null) return null;
      creation = { kind: row.creation_kind, mutation_id, source_turn_id };
      break;
    case "restore":
    case "variant_creation":
    case "variant_promotion":
      if (sourceVersionId === null) return null;
      creation = {
        kind: row.creation_kind,
        source_version_id: sourceVersionId,
        mutation_id,
        source_turn_id,
      };
      break;
    case null:
      // The legacy restore RPC persisted an exact source pointer before it
      // persisted creation_kind. That named pointer licenses restore, but no
      // provenance/event-type string is used to invent creation metadata.
      if (row.source_version_id !== null) return null;
      creation =
        row.restored_from_version_id === null
          ? { kind: "unknown", mutation_id, source_turn_id }
          : {
              kind: "restore",
              source_version_id: row.restored_from_version_id,
              mutation_id,
              source_turn_id,
            };
      break;
  }

  const lineage: ModelVersionSummaryV2Local["lineage"] =
    row.root_version_id === null
      ? { kind: "unknown" }
      : {
          kind: "known",
          parent_version_id: row.parent_version_id,
          root_version_id: row.root_version_id,
        };

  const parsed = ModelVersionSummaryV2LocalSchema.safeParse({
    version_id: row.id,
    scenario_id: row.scenario_id,
    sequence: row.version_number,
    label: row.label,
    created_at: row.created_at,
    actor,
    creation,
    lineage,
    full_hash: row.graph_identity_hash,
    analysis_affecting_hash: row.analysis_affecting_hash,
  });
  return parsed.success ? parsed.data : null;
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
        // Ownership on this surface is derived from the verified token
        // subject. A request-supplied identifier is not an input to that
        // decision, so the sentinel is passed rather than the parsed
        // extension. See the constant for why this is expressed here and not
        // in the shared function.
        CALLER_ASSERTED_IDENTITY_NOT_ADMISSIBLE,
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
        ...(body.cursor !== undefined ? { cursor: body.cursor } : {}),
      });
      if (!parsedBody.success) {
        return invalid(
          reply,
          requestId,
          "HISTORY_PAGE_INVALID",
          "`limit` must be a positive integer (max 200) and `cursor` must be non-empty.",
        );
      }
      const beforeSequence =
        parsedBody.data.cursor === undefined
          ? undefined
          : decodeModelVersionsCursor(parsedBody.data.cursor);
      if (beforeSequence === null) {
        return invalid(
          reply,
          requestId,
          "HISTORY_CURSOR_INVALID",
          "That history cursor is not valid. Reload the version history and try again.",
        );
      }
      const pageLimit = parsedBody.data.limit ?? MODEL_VERSION_LIST_DEFAULT_LIMIT;

      const service = getModelManagementService();
      let listed: Awaited<ReturnType<typeof service.listVersions>>;
      let pointer: ModelManagementResult<string | null>;
      try {
        [listed, pointer] = await Promise.all([
          service.listVersions(ctx.scenarioId, pageLimit + 1, beforeSequence),
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

      const hasNextPage = listed.value.length > pageLimit;
      const pageRows = listed.value.slice(0, pageLimit);
      const versions: ModelVersionSummaryV2Local[] = [];
      for (const row of pageRows) {
        const validated = summaryV2(row);
        if (validated === null) {
          log.error(
            {
              event: "v5.scenario_versions.summary_egress_invalid",
              request_id: requestId,
              scenario_id: ctx.scenarioId,
              version_id: row.id,
            },
            "Scenario versions — a summary row failed the egress contract; failing closed",
          );
          return unavailable(reply, requestId, "Versions could not be read right now.");
        }
        versions.push(validated);
      }
      const lastSequence = versions.at(-1)?.sequence;
      const nextCursor =
        hasNextPage && lastSequence !== undefined
          ? encodeModelVersionsCursor(lastSequence)
          : null;
      const outcome = ModelVersionsListV2LocalSchema.safeParse({
        schema: MODEL_VERSIONS_LIST_SCHEMA,
        scenario_id: ctx.scenarioId,
        versions,
        current_version_id: pointer.value,
        request_id: requestId,
        next_cursor: nextCursor,
      });
      if (!outcome.success) {
        log.error(
          {
            event: "v5.scenario_versions.list_egress_invalid",
            request_id: requestId,
            scenario_id: ctx.scenarioId,
            issues: outcome.error.issues.slice(0, 5),
          },
          "Scenario versions — list failed the v2 egress contract; failing closed",
        );
        return unavailable(reply, requestId, "Versions could not be read right now.");
      }
      return reply.code(200).send(outcome.data);
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
      const wireOutcome = ModelVersionDiffV1LocalSchema.safeParse({
        schema: MODEL_VERSION_DIFF_SCHEMA,
        scenario_id: ctx.scenarioId,
        ...wireComparison,
        request_id: requestId,
      });
      if (!wireOutcome.success) {
        log.error(
          {
            event: "v5.scenario_versions.compare_public_egress_invalid",
            request_id: requestId,
            scenario_id: ctx.scenarioId,
            issues: wireOutcome.error.issues.slice(0, 5),
          },
          "Scenario versions — comparison failed the public diff contract; failing closed",
        );
        return unavailable(reply, requestId, "Those versions could not be compared right now.");
      }
      return reply.code(200).send(wireOutcome.data);
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

      // ── 6b. Is this the RETURN LEG? — see `isReturnLegRestore` for the whole
      // argument. Read the head through the service's existing scenario-scoped
      // reader (it filters on BOTH `scenario_id` and `id`, so a pointer can only
      // ever resolve to a version this scenario owns).
      //
      // ⚠ A HEAD-READ FAILURE IS NOT A RESTORE FAILURE. Any non-`ok` status
      // yields `null`, `isReturnLegRestore` returns false, and the pre-existing
      // fail-closed 422 stands. This read can only ever GRANT the widening, so
      // it must never be able to refuse a restore that would otherwise succeed.
      const headResult = await service.getCurrentVersion(ctx.scenarioId);
      const head: ModelVersionRecord | null =
        headResult.status === "ok" ? headResult.value : null;

      // ── 7. Normalise the stored target; still no client graph authority ──
      const graphForStore = projectGraphForPersistence(parsedGraph.data, {
        scenarioId: ctx.scenarioId,
        turnClass: "direct_answer",
        source: "version_restore",
      });

      const returnLeg = isReturnLegRestore({
        head,
        targetVersionId: parsedBody.data.version_id,
        currentGraph,
      });

      // ── 7b. THE SHARED PERSISTENCE FLOOR — the CHECK half (C8) ───────────
      // This route is the THIRD production `scenarios.graph` writer. Until this
      // change it was the only one that did not enforce the terminal structural
      // invariants: `projectGraphForPersistence` was imported here (`:125`) and
      // `checkPersistedGraphInvariants` was not, so a stored version carrying a
      // duplicate node id or a dangling edge endpoint was written back silently
      // while the turn and registration paths refused exactly that, fail-closed.
      // A restored graph is NOT self-evidently safe just because it was stored
      // once: versions predate this floor, and the RPC's only content guard is
      // emptiness.
      //
      // ⚠ THE CHECK ONLY — NOT `appendCheckedGraphWrite`. That function appends
      // through `store.append`, and this path must not: its RPC owns graph +
      // undo + version + head + event in one statement, and its CAS is
      // UNCONDITIONAL where the `append_turn_atomic_*` family's is
      // `p_cas_enforce DEFAULT FALSE`. Routing this through the floor's append
      // would have DOWNGRADED a guarantee to close a gap. It is not a shortcut
      // that this path keeps its own writer; it is the stronger of the two.
      //
      // BASELINE: `currentGraph`, the same server-read bytes the CAS above uses.
      // `store.loadGraph` returns `null` — never `undefined` — so a fresh or
      // empty scenario takes the ABSOLUTE branch and every violation counts as
      // introduced, exactly as on the registration path. The observe-only
      // degrade (`undefined`) is UNREACHABLE here: the base-read failure at
      // step 6 returns `unavailable` and never arrives at this line. So this
      // path always has a real baseline — stricter than the register route.
      //
      // Delta-scoping means a scenario whose CURRENT graph already carries the
      // violation absorbs it and still restores. What is refused is making a
      // clean scenario structurally WORSE.
      //
      // ⚠⚠ THIS WAS A ONE-WAY DOOR UNTIL THE RETURN-LEG BRANCH BELOW.
      // An earlier draft of this comment claimed "you can always get back"; that
      // was FALSE, and the suite could not see it because the absorption test
      // above had no opposite-direction twin. Measured at the route:
      //   · the RPC stores the PRE-RESTORE working graph as an undo version
      //     VERBATIM AND UNCHECKED (`20260824200000:397-410`, label
      //     'Before restore', provenance 'pre_restore'); and
      //   · there is NO separate undo route — undo IS an ordinary restore
      //     (zero `versions/undo` handlers in `src/`, measured with a firing
      //     contrast control on the restore registration itself).
      // So on a legacy-corrupt scenario, restoring a CLEAN version succeeded and
      // the Undo it offered was REFUSED 422 — escapable exactly once, and not
      // re-entrant.
      //
      // ⭐ WHAT CHANGED, AND WHICH OF THE TWO DELIBERATE DECISIONS THIS IS. The
      // superseded pin named the only two ways out: *"either the undo capture
      // became checked or the baseline semantics changed"*. THIS IS THE SECOND.
      // The first — refusing the whole OUTWARD restore when the pre-restore
      // graph would be unreturnable — was considered and REJECTED: it does not
      // remove the trap, it INVERTS it, leaving the user trapped INSIDE the
      // corruption with no escape at all. The standing reason an absolute check
      // is wrong here is NOT restated in this file; it is owned by
      // `persisted-graph-invariants.ts:195-204`, which quotes
      // `edit-graph.ts:2750-2755`. Read it there.
      //
      // What is NEW, and therefore what this file owns: the delta check had no
      // concept for a target the scenario ALREADY HELD (`isReturnLegRestore`).
      // Every NEW state that would make the scenario structurally worse is still
      // refused — the outward-leg guarantee is untouched.
      //
      // ⚠ THE WIDENING, STATED PLAINLY BECAUSE IT IS REAL: a graph carrying a
      // structural violation CAN now be written to `scenarios.graph` by this
      // route, on one narrow branch. It is justified because those exact bytes
      // WERE `scenarios.graph` a moment earlier and this floor permitted them
      // there — we are undoing a write the floor allowed, not introducing one it
      // refused.
      if (returnLeg) {
        // OBSERVE, DO NOT REFUSE. The admission decision was made by the
        // identity binding above; re-running the delta here with a self-baseline
        // would be a guard agreeing with itself. This call is DISCLOSURE only.
        //
        // ⚠ WHY THIS IS A THIRD EVENT AND NOT `v5.graph_persist.invariant_*`.
        // The surfacing RULE is the floor's, not this file's — "a violation
        // nobody can see is one nobody will ever fix"
        // (`persist-graph-write.ts:272-274`). But neither existing event can
        // express this case: `invariant_violation` means REFUSED, and
        // `invariant_inherited` means the BASE already carried it. Here the set
        // is `introduced` by the delta's own arithmetic — the base does NOT
        // carry it — and is admitted anyway, on the identity binding. A distinct
        // name is the deliberate divergence; the payload deliberately says
        // `admitted`, never `introduced` or `inherited`, so a log consumer
        // cannot read this as either of the other two.
        const admitted = checkPersistedGraphInvariants(graphForStore, {
          baseGraph: currentGraph,
        });
        if (admitted.status === "violated") {
          log.warn(
            {
              event: "v5.scenario_versions.return_leg_admitted",
              request_id: requestId,
              scenario_id: ctx.scenarioId,
              version_id: parsedBody.data.version_id,
              head_version_id: head?.id ?? null,
              admitted: admitted.violations.map((v) => ({
                code: v.code,
                count: v.count,
                entity_ids: v.entity_ids,
              })),
            },
            "Scenario versions — return leg: restoring a previously-held state that carries structural violations; admitted knowingly",
          );
        }
      } else {
        try {
          assertNoIntroducedGraphViolations({
            graph: graphForStore,
            identity: { scenario_id: ctx.scenarioId, turn_id: null, turn_class: null },
            writesGraph: true,
            baseGraphForInvariants: currentGraph,
            source: "version_restore",
          });
        } catch (err) {
          if (err instanceof PersistedGraphInvariantError) {
            // 422, not 503 and not 409: the bytes can never succeed, so inviting
            // a retry would be misleading. Same code and shape as the
            // registration path's refusal — one vocabulary for one class of
            // refusal.
            log.warn(
              {
                event: "v5.scenario_versions.invariant_violation",
                request_id: requestId,
                scenario_id: ctx.scenarioId,
                version_id: parsedBody.data.version_id,
                introduced: err.violations.map((v) => ({
                  code: v.code,
                  count: v.count,
                  entity_ids: v.entity_ids,
                })),
              },
              "Scenario versions — restore refused: this version introduces a structural violation; nothing written",
            );
            return invalid(
              reply,
              requestId,
              "GRAPH_INVARIANT_VIOLATION",
              "This version has a structural problem and was not restored.",
              {
                violations: err.violations.map((v) => ({
                  code: v.code,
                  count: v.count,
                  entity_ids: v.entity_ids,
                })),
              },
            );
          }
          throw err;
        }
      }

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
