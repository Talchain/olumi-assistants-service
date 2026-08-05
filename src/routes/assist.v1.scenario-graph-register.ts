/**
 * ROADMAP 2.467 — `register_graph`: THE DETERMINISTIC WHOLE-GRAPH WRITE SEAM.
 *
 * ── WHY THIS ROUTE EXISTS AT ALL ───────────────────────────────────────────
 * Canvas import performs ZERO server-side persistence, and run turns carry no
 * graph. The analyse path is UI → CEE → PLoT → ISL with **CEE reloading its OWN
 * persisted graph**, so after an import the results describe the pre-import
 * server graph while the imported one is on screen. That was witnessed on a real
 * browser on 4 Aug (analysis naming the OLD graph's nodes ×44, the sentinel ×0,
 * old rows re-bound BY NODE ID to the imported labels under an affirmative
 * "Analysis reflects the current model."). An interim UI mitigation (#592,
 * witnessed prevented 5 Aug) stopped the product ASSERTING that the mismatch was
 * fine. It did not make the import work. This route is what makes it work: it
 * puts the imported graph where CEE will actually read it.
 *
 * ── WHY IT IS NOT THE LLM EDIT TOOL (design review amendment A8, BINDING) ──
 * `propose_structural_edit` is architecturally incapable of this job, for three
 * independent byte-level reasons:
 *   · CAPS — referee `PROPOSAL_CAP = 8` envelopes and pipeline
 *     `MAX_PATCH_OPERATIONS = 15`, against imports that run to
 *     `GRAPH_MAX_NODES`/`GRAPH_MAX_EDGES` (50/100). A multi-batch train breaks
 *     the atomicity a registration requires.
 *   · BASE-HASH CURRENCY — every edit envelope must prove currency against the
 *     SERVER graph. An import wants to REPLACE that graph regardless of its hash.
 *   · FABRICATION — expressing a whole-graph replace as op diffs means the LLM
 *     computes the diff, which is precisely the 2.461 class the edit tool exists
 *     to kill.
 * So: no LLM in the loop, no ops, no referee. One graph in, one graph stored.
 *
 * ── THE ORDER OF THE CHECKS IS THE DESIGN ──────────────────────────────────
 *   0. identity     — headers only, before any state read (the read route's
 *                     rule: a refusal must not become an existence oracle).
 *   1. UUID syntax  — `scenarios.id` is a UUID column.
 *   2. PAYLOAD      — shape, caps, kind/type normalisation, ingress parse. All
 *                     of it BEFORE any database work, so a malformed body costs
 *                     no round trip and cannot be used to probe scenarios.
 *   3. ownership    — the SAME shared pre-flight the turn route runs.
 *   4. the base read— the trusted CAS base, from the SERVER's own bytes.
 *   5. the write    — projected, hashed, atomic.
 *
 * ⚠ (2) BEFORE (3) IS DELIBERATE AND IS THE INVERSE OF THE READ ROUTE'S ORDER,
 *   for the opposite reason. The read route gates on EXISTENCE first because
 *   `authorizeScenarioOwnership` upserts, and a read must never create the row
 *   it reads. A WRITE legitimately creates: a freshly-imported scenario has no
 *   row yet, and refusing it would make import-into-a-new-scenario impossible —
 *   which is the second import route (`ScenarioSwitcher → importScenarioFromFile`
 *   mints a NEW scenario id). Validating first means a hostile caller cannot
 *   grow `scenarios` with junk payloads; the rate limiter bounds the rest, and
 *   the turn route already carries this exact property.
 *
 * ── WHAT MAKES IT ATOMIC, AND WHY NOT `store_draft_graph` ──────────────────
 * `scenarios.graph` and `scenarios.graph_identity_hash` MUST move in one
 * statement. `append_turn_atomic_v3`/`_v4` (reached through `store.append`) do
 * exactly that under a `SELECT … FOR UPDATE` row lock, stamping
 * `p_incoming_graph_identity_hash` from the single normaliser authority. The
 * lighter `store_draft_graph` RPC does NOT write the identity hash, so using it
 * would leave the column describing a graph we no longer store — silently
 * poisoning every later CAS compare, which reads that column as its base. There
 * is exactly one correct writer here and it is `store.append`.
 *
 * The write is expressed as a `direct_answer` turn with `handler_id: null` —
 * the DL-7 precedent the system-event dispatcher already uses for
 * server-initiated, non-conversational commits (`system-events/dispatch.ts`).
 * That is not incidental: a graph replacement IS a state transition worth a row
 * in the turn log, and piggy-backing on the sanctioned writer is what buys the
 * atomicity above.
 *
 * ── FRESHNESS AND ANALYSIS STATE CLEAR THEMSELVES, BY CONSTRUCTION ─────────
 * Nothing here has to "clear the analysis". CEE stores no analysis snapshot and
 * no `last_result_hash` on `scenarios`; `deriveAnalysisFreshness` DERIVES the
 * verdict by comparing the newest `run_analysis` fact's `graph_hash_at_run`
 * against `computeAnalysisAffectingGraphHash(currentGraph)` at read time. The
 * moment this route replaces the graph, that comparison diverges and the verdict
 * flips to `graph_hash_diverged` on its own. Pending actions self-invalidate the
 * same way (`pending-action.ts`, reason `graph_hash_changed`) — but ONLY if the
 * bytes we hash are the bytes we store, which is why `projectGraphForPersistence`
 * runs BEFORE the hash and before the write, never after.
 *
 * ⚠ THE CAS BASE IS READ FROM THE SERVER, NEVER FROM THE REQUEST. The trusted
 *   base rule (`SessionTurnWrite.expectedGraphIdentityHash`) exists because a
 *   CAS that validates a write against the very graph being written always
 *   "matches". Under the deployed `CEE_V5_GRAPH_CAS_RPC=shadow` posture this is
 *   telemetry; under `enforce` it becomes a real guard, and this route is
 *   written so that promotion needs no change here.
 *
 * ── WHAT THIS ROUTE DOES NOT DO ────────────────────────────────────────────
 * · It does not run an LLM, compose a response, or touch the referee.
 * · It does not merge. A registration is a REPLACE — the client's graph is the
 *   graph. Merging would re-introduce the "two models, one screen" ambiguity.
 * · It does not accept layout. `scenarios.graph` holds no positions; a caller
 *   that sends them will simply have them hashed and stored, so the client is
 *   responsible for projecting canvas → wire before calling. (The read route's
 *   `layout_present` reports on that, measured rather than promised.)
 * · It does not mint an identity scheme: `graph_identity_hash` is
 *   `computeGraphIdentityHash`, identity.v1, the single normaliser authority,
 *   and it is an OPAQUE CEE-issued token — consumers store and compare it
 *   CEE-to-CEE gated on `projection_version`, and never recompute it locally.
 */

import type { FastifyInstance } from "fastify";

import { GRAPH_MAX_EDGES, GRAPH_MAX_NODES } from "../config/graphCaps.js";
import { normaliseGraphNodeKindField } from "../orchestrator-v5/graph-registration/normalise-node-kind.js";
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
import { resolveCeeRateLimit } from "../cee/config/limits.js";
import { buildErrorV1 } from "../utils/errors.js";
import { getRequestId } from "../utils/request-id.js";
import { log } from "../utils/telemetry.js";

/** Wire schema discriminator. Frozen — the UI lane builds against this. */
export const SCENARIO_GRAPH_REGISTRATION_SCHEMA =
  "scenario_graph_registration.v1" as const;

/** `scenarios.id` is a UUID column, so a non-UUID id cannot name a row. */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `turn_id` for the registration commit.
 *
 * Prefixed so the turn log says WHY the graph moved without anyone having to
 * join it against another table, and unique per request so the RPC's
 * idempotency key never collides with a conversational turn.
 */
function registrationTurnId(): string {
  return `graph_registration:${globalThis.crypto.randomUUID()}`;
}

export default async function route(app: FastifyInstance) {
  // Tier DERIVED from RATE_BUCKET_REGISTRY. This is a WRITE — it is registered
  // in the `coach` tier, not `read`: `read` fails OPEN on limiter error
  // (availability over strictness for cheap traffic), and a whole-graph
  // replacement is not traffic we want waved through when the limiter is blind.
  const RATE_LIMIT_MAX = resolveCeeRateLimit(
    "CEE_SCENARIO_GRAPH_REGISTER_RATE_LIMIT_RPM",
  );

  app.post<{ Params: { scenario_id: string } }>(
    "/assist/v1/scenarios/:scenario_id/graph/register",
    {
      // The repo's own limiter, per-route — the `proxy-v5-turn.ts` stop-rung
      // pattern, expressed through the sanctioned plugin so CodeQL's
      // `js/missing-rate-limiting` query can SEE it (a bespoke in-handler check
      // is invisible to the scanner and to every future reviewer).
      //
      // The bucket is per CLIENT (`req.ip`, the plugin default), for the same
      // reason as the sibling read route: through the `/bff/cee/*` edge every
      // visitor arrives carrying the SAME injected assist key, so a key-derived
      // bucket would be one product-wide shared-fate throttle.
      config: {
        rateLimit: {
          max: RATE_LIMIT_MAX,
          timeWindow: "1 minute",
        },
      },
    },
    async (req, reply) => {
      const requestId = getRequestId(req);
      const scenarioId = req.params.scenario_id;
      const startedAt = Date.now();

      /**
       * THE ONE REFUSAL for anything scenario-shaped. Absent scenario, someone
       * else's scenario, malformed id, ownership oracle down — all answer these
       * exact bytes, for the read route's reason: a refusal that named its
       * cause would be an enumeration oracle over other people's decisions.
       */
      const refuse = () =>
        reply
          .code(404)
          .send(
            buildErrorV1(
              "NOT_FOUND",
              "No registrable graph for that scenario.",
              {},
              requestId,
            ),
          );

      /**
       * A PAYLOAD refusal, by contrast, names its cause in full. The caller
       * supplied these bytes, so telling them what is wrong with them leaks
       * nothing — and a registration that fails silently is exactly the class
       * of defect this route exists to close.
       */
      const invalid = (
        code: string,
        message: string,
        details: Record<string, unknown> = {},
      ) =>
        reply
          .code(422)
          .send(buildErrorV1("VALIDATION_FAILED", message, { code, ...details }, requestId));

      const unavailable = () =>
        reply
          .code(503)
          .send(
            buildErrorV1(
              "INTERNAL",
              "The graph could not be registered right now.",
              {},
              requestId,
            ),
          );

      // ── 0. Identity, from headers only, before ANY read of server state ──
      const resolved = await resolveVerifiedIdentityOrRefuse(req, requestId);
      if (!resolved.ok) {
        return reply.code(resolved.status).send(resolved.error);
      }

      // ── 1. Syntax ───────────────────────────────────────────────────────
      if (!UUID_PATTERN.test(scenarioId)) {
        return refuse();
      }

      // ── 2. The payload, in full, before any database work ───────────────
      const extensions = parseRequestExtensions(req.body, requestId);
      if (!extensions.ok) {
        return refuse();
      }

      const body = (req.body ?? {}) as Record<string, unknown>;
      const submitted = body.graph;
      if (submitted === null || typeof submitted !== "object" || Array.isArray(submitted)) {
        return invalid("GRAPH_MISSING", "A `graph` object is required.");
      }

      const submittedRecord = submitted as Record<string, unknown>;
      const submittedNodes = submittedRecord.nodes;
      const submittedEdges = submittedRecord.edges;
      if (!Array.isArray(submittedNodes) || !Array.isArray(submittedEdges)) {
        return invalid(
          "GRAPH_SHAPE_INVALID",
          "`graph.nodes` and `graph.edges` must both be arrays.",
        );
      }

      // An EMPTY graph is refused rather than stored. Registering emptiness
      // would silently destroy a real server-side model, and no import produces
      // it: `graphImportDigest` on the UI side returns null for an empty graph
      // for the same reason.
      if (submittedNodes.length === 0) {
        return invalid("GRAPH_EMPTY", "A graph with no nodes cannot be registered.");
      }

      // Caps BEFORE normalisation, so a hostile 10k-node array is rejected in
      // O(1) rather than walked.
      if (submittedNodes.length > GRAPH_MAX_NODES) {
        return invalid("GRAPH_TOO_LARGE", "This model has too many nodes to register.", {
          nodes: submittedNodes.length,
          max_nodes: GRAPH_MAX_NODES,
        });
      }
      if (submittedEdges.length > GRAPH_MAX_EDGES) {
        return invalid("GRAPH_TOO_LARGE", "This model has too many connections to register.", {
          edges: submittedEdges.length,
          max_edges: GRAPH_MAX_EDGES,
        });
      }

      // 2.467c — the kind/type pair, resolved once, BEFORE anything hashes or
      // stores these bytes. A divergent-field file is REFUSED, not guessed at.
      const normalised = normaliseGraphNodeKindField(submitted);
      if (!normalised.ok) {
        return invalid(
          normalised.reason === "divergent_node_kind"
            ? "GRAPH_NODE_KIND_DIVERGENT"
            : "GRAPH_NODE_KIND_MISSING",
          normalised.reason === "divergent_node_kind"
            ? "Some nodes declare two different kinds. Fix the file and import again."
            : "Some nodes declare no kind. Fix the file and import again.",
          { node_ids: normalised.nodeIds },
        );
      }

      // The ingress parse is the contract gate: ids, kinds, labels, from/to.
      // It runs on the NORMALISED bytes, because a `type`-only node would
      // otherwise fail here for a reason we already know how to fix.
      const parsed = GraphStateIngressSchema.safeParse(normalised.graph);
      if (!parsed.success) {
        return invalid(
          "GRAPH_CONTRACT_INVALID",
          "This model does not match the graph contract.",
          { issues: parsed.error.issues.slice(0, 10) },
        );
      }

      // ── 3. Ownership — the SAME pre-flight the turn route runs ──────────
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
            event: "v5.scenario_graph_register.ownership_read_failed",
            request_id: requestId,
            scenario_id: scenarioId,
            err: err instanceof Error ? err.message : String(err),
          },
          "Graph registration — ownership pre-flight threw; failing closed",
        );
        return unavailable();
      }
      if (!owned.ok) {
        log.warn(
          {
            event: "v5.scenario_graph_register.refused_not_owner",
            request_id: requestId,
            scenario_id: scenarioId,
            reason: owned.reason,
          },
          "Graph registration — caller is not authorized for this scenario",
        );
        return refuse();
      }

      const store = getSessionStore();

      // ── 4. The trusted CAS base — the SERVER's bytes, never the request's ─
      // A read failure here is NOT fatal: it degrades to "uninstrumented"
      // (undefined), which the RPC treats as no base to compare. Failing the
      // whole registration because we could not read the OLD graph would leave
      // the user permanently unable to register a new one.
      let expectedGraphIdentityHash: string | null | undefined;
      let expectedGraphAnalysisHash: string | null | undefined;
      try {
        const base = await store.loadGraph(scenarioId);
        const hashes = computeExpectedGraphCasHashes(base);
        expectedGraphIdentityHash = hashes.expectedGraphIdentityHash;
        expectedGraphAnalysisHash = hashes.expectedGraphAnalysisHash;
      } catch (err) {
        log.warn(
          {
            event: "v5.scenario_graph_register.base_read_failed",
            request_id: requestId,
            scenario_id: scenarioId,
            err: err instanceof Error ? err.message : String(err),
          },
          "Graph registration — base read failed; proceeding uninstrumented",
        );
        expectedGraphIdentityHash = undefined;
        expectedGraphAnalysisHash = undefined;
      }

      // ── 5. Project, then hash, then write — in that order ────────────────
      // `projectGraphForPersistence` is the single definition of "the form in
      // which a graph is persisted". Hashing before it would advertise an
      // identity for bytes we do not store, which is the exact ordering defect
      // `commit.ts` was restructured to close.
      const graphForStore = projectGraphForPersistence(parsed.data, {
        scenarioId,
        turnClass: "direct_answer",
        source: "graph_registration",
      });

      const turnId = registrationTurnId();
      try {
        await store.append({
          scenario_id: scenarioId,
          turn_id: turnId,
          // DL-7 PR B precedent (system-events/dispatch.ts): a server-initiated
          // commit that composes no assistant prose is a `direct_answer` with a
          // null handler_id. The DB CHECK enforces
          // `(turn_class = 'handler') = (handler_id IS NOT NULL)`.
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
          // Atomic in-transaction CAS refused: the whole turn rolled back and
          // nothing was clobbered. This is a 409, never a silent overwrite and
          // never a 5xx — the caller can re-read and re-confirm.
          log.warn(
            {
              event: "v5.scenario_graph_register.cas_conflict",
              request_id: requestId,
              scenario_id: scenarioId,
            },
            "Graph registration — CAS conflict; nothing written",
          );
          return reply
            .code(409)
            .send(
              buildErrorV1(
                "CONFLICT",
                "This model changed while you were importing. Reload and import again.",
                { code: "GRAPH_STALE" },
                requestId,
              ),
            );
        }
        log.error(
          {
            event: "v5.scenario_graph_register.commit_failed",
            request_id: requestId,
            scenario_id: scenarioId,
            err: err instanceof Error ? err.message : String(err),
          },
          "Graph registration — commit failed",
        );
        return unavailable();
      }

      const identity = computeGraphIdentityHash(graphForStore as GraphStateIngress);

      log.info(
        {
          event: "v5.scenario_graph_register.registered",
          request_id: requestId,
          scenario_id: scenarioId,
          node_count: parsed.data.nodes.length,
          edge_count: parsed.data.edges.length,
          kind_fields_normalised: normalised.changedNodeCount,
        },
        "Graph registration — imported graph is now the persisted graph",
      );

      return reply.code(200).send({
        schema: SCENARIO_GRAPH_REGISTRATION_SCHEMA,
        scenario_id: scenarioId,
        registered: true,
        // The ACKNOWLEDGEMENT. This is what lets a client stop saying
        // "cannot confirm": the server has the graph, and this token names it.
        graph_identity_hash: identity,
        node_count: parsed.data.nodes.length,
        edge_count: parsed.data.edges.length,
        kind_fields_normalised: normalised.changedNodeCount,
        request_id: requestId,
      });
    },
  );
}
