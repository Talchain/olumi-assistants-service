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
 *                     ⚠ Ownership here is the VERIFIED TOKEN SUBJECT alone
 *                     (`CALLER_ASSERTED_IDENTITY_NOT_ADMISSIBLE` at the call
 *                     site), which makes CEE_REQUIRE_USER_JWT load-bearing
 *                     rather than a rollback lever: with it OFF — its DEFAULT,
 *                     and unguarded in that direction — no caller is ever
 *                     identified and every OWNED scenario is refused to its
 *                     OWN owner across all six /assist/v1/scenarios/*
 *                     endpoints. Disclosed at boot
 *                     (`config.scenario_ownership_posture`, server.ts) and
 *                     pinned in the suite as a KNOWN MISCONFIGURATION.
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
 * poisoning every later CAS compare, which reads that column as its base.
 *
 * ⚠ UPDATED (C3 closure) — this used to end "there is exactly one correct
 * writer here and it is `store.append`". The atomicity argument above is
 * unchanged and still the reason, but the call is now
 * `appendCheckedGraphWrite` (`orchestrator-v5/persist-graph-write.ts`), which
 * enforces the terminal structural invariants and then performs that same
 * `store.append`. The correction matters rather than being cosmetic: while this
 * route called `store.append` directly it was the ONLY `scenarios.graph` writer
 * that skipped those invariants, so a registration could persist a violation
 * the turn path refuses fail-closed.
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
 *   "matches". Under a `shadow` RPC posture this is telemetry; under `enforce`
 *   it becomes a real guard, and this route is written so that promotion needs
 *   no change here.
 *
 *   ⭐ THE POSTURE IS NOW OBSERVABLE — DERIVE IT, DO NOT READ IT HERE.
 *   This sentence used to assert "the deployed `CEE_V5_GRAPH_CAS_RPC=shadow`
 *   posture" while `resolveGraphCasCapability` in `config/index.ts` asserted
 *   staging runs `MODE=observe` + `RPC=enforce`. One was stale, neither was
 *   evidence, and the deployed value — living only in the Render dashboard —
 *   was unobservable from any client. Both sites were left pointing at each
 *   other so no reader picked one at random.
 *
 *   Since 18 Sep 2026 `/healthz` publishes the resolved capability:
 *
 *       curl -s https://cee-staging.onrender.com/healthz | jq .graph_cas
 *
 *   ⛔ Do not restore a posture claim to this header. Behaviour here must
 *   still be correct under BOTH postures — that requirement never depended on
 *   knowing which one is deployed, which is exactly why the two prose claims
 *   were able to disagree for a month without anything failing.
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
  CALLER_ASSERTED_IDENTITY_NOT_ADMISSIBLE,
  resolveVerifiedIdentityOrRefuse,
} from "../orchestrator/route-v2-preflight.js";
import { computeGraphIdentityHash, isIdentityEmptyGraph } from "../orchestrator-v5/context/graph-identity.js";
import { computeExpectedGraphCasHashes } from "../orchestrator-v5/context/graph-cas-conflict.js";
import { projectGraphForPersistence } from "../orchestrator-v5/persisted-graph-projection.js";
import { appendCheckedGraphWrite, assertNoIntroducedGraphViolations } from "../orchestrator-v5/persist-graph-write.js";
import { buildAtomicCommittedModelVersion } from "../orchestrator-v5/commit.js";
import { PersistedGraphInvariantError } from "../orchestrator-v5/persisted-graph-invariants.js";
import { getSessionStore } from "../orchestrator-v5/session/index.js";
import { registrationRequestHash, registrationTurnId } from "../orchestrator-v5/graph-registration/registration-identity.js";
import { AtomicPreconditionUnenforceableError, GraphStaleWriteError } from "../orchestrator-v5/session/store.js";
import { runWithPendingTurnFence, TurnFenceRejectedError } from "../orchestrator-v5/session/turn-fence.js";
import { admitCurrentTurnFence } from "../orchestrator/turn-fence-prehandler.js";
import { normaliseBriefText } from "../orchestrator-v5/session/normalise-brief-text.js";
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
          // `ErrorCode` is a deliberately coarse SHARED family
          // (`BAD_INPUT | UNAUTHENTICATED | FORBIDDEN | NOT_FOUND |
          // RATE_LIMITED | INTERNAL`) with a status mapping in
          // `getStatusCodeForErrorCode`. The precise, actionable reason rides
          // in `details.code`, and the HTTP status carries the class. Widening
          // that union from a build lane would change a contract every route
          // shares — not this slice's call to make.
          .send(buildErrorV1("BAD_INPUT", message, { code, ...details }, requestId));

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
      // Additive initial-context contract: string or absent/null. Reuse the
      // canonical brief bound, but reject truncation instead of losing words.
      // This is outside the graph/hash and uses the SAME atomic append below:
      // the RPC seeds only an empty brief_text, preserving existing user text.
      if (body.brief_text != null && typeof body.brief_text !== "string") {
        return invalid("BRIEF_INVALID", "`brief_text` must be a string when supplied.");
      }
      // An OPTIONAL caller-named operation. Validated before any database work:
      // it becomes part of the durable idempotency key, so a malformed one must
      // never reach the RPC.
      if (body.operation_id != null && (typeof body.operation_id !== "string" || !UUID_PATTERN.test(body.operation_id))) {
        return invalid("OPERATION_ID_INVALID", "`operation_id` must be a UUID when supplied.");
      }
      const operationId = typeof body.operation_id === "string" ? body.operation_id : undefined;
      // An OPTIONAL caller assertion: "write this ONLY if the model is still the
      // one I read". Validated before any database work, like `operation_id`.
      if (body.expected_graph_hash != null && (typeof body.expected_graph_hash !== "string" || body.expected_graph_hash.length === 0)) {
        return invalid("EXPECTED_GRAPH_HASH_INVALID", "`expected_graph_hash` must be a non-empty string when supplied.");
      }
      const callerExpectedGraphHash =
        typeof body.expected_graph_hash === "string" ? body.expected_graph_hash : undefined;
      // An OPTIONAL caller assertion that the model is still EMPTY — the precondition a
      // FIRST construction was built on. Validated before any database work.
      if (body.expected_model_empty != null && body.expected_model_empty !== true) {
        return invalid("EXPECTED_MODEL_EMPTY_INVALID", "`expected_model_empty` must be `true` when supplied.");
      }
      const callerExpectsEmptyModel = body.expected_model_empty === true;
      const brief = normaliseBriefText(body.brief_text);
      if (brief.truncated) {
        return invalid("BRIEF_INVALID", "`brief_text` exceeds the supported brief length.");
      }
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
      // The SAME server-read bytes serve two different questions: the trusted
      // CAS base (hashes, below) and the invariant BASELINE handed to the
      // persistence floor. Hoisted out of the try so the floor can see it —
      // `undefined` after a failed read, which the floor treats as "no
      // baseline", i.e. observe-only. That is the correct degrade: a read
      // failure must not start refusing registrations it cannot adjudicate.
      let baseGraphForInvariants: unknown;
      try {
        const base = await store.loadGraph(scenarioId);
        baseGraphForInvariants = base;
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

      /**
       * ⛔ A CALLER'S EXPECTATION IS CHECKED BEFORE ANY WRITE, AGAINST THE
       * SERVER'S OWN READ.
       *
       * Without this, this route's CAS base is only ever the server's own read
       * a moment ago: it closes the route's read→write window and says nothing
       * about the model the CALLER approved. Independent review of #1712
       * (CHANGES_REQUIRED at 3674539 and ecb45282) measured the consequence on
       * the Agent's one-approval path: an unrelated edit after the user approved
       * a starting point was absorbed, and the approval landed on a model the
       * user never saw, reported as applied. `factor_value_edit` carries no base
       * at all (0.55, `.strict()`), so no existing primitive made a value write
       * conditional on the approved model.
       *
       * The comparison is in ANALYSIS space — the same `graph_hash` the read
       * route returns and a proposal is bound to (`computeAnalysisAffectingGraphHash`
       * over the same ingress parse). Equality here, plus the atomic RPC's
       * identity CAS on this very base at write time, means the bytes written
       * sit on the model the caller named. A caller that sends nothing is
       * unaffected, byte for byte.
       *
       * ⚠ A failed base read cannot adjudicate an expectation, so it refuses as
       * our outage (503) rather than writing unconditionally.
       */
      if (callerExpectedGraphHash !== undefined) {
        if (expectedGraphIdentityHash === undefined) {
          return unavailable();
        }
        if (expectedGraphAnalysisHash !== callerExpectedGraphHash) {
          log.warn(
            {
              event: "v5.scenario_graph_register.expected_graph_hash_stale",
              request_id: requestId,
              scenario_id: scenarioId,
              expected: callerExpectedGraphHash,
              current: expectedGraphAnalysisHash ?? null,
            },
            "Graph registration — the model changed since the caller read it; nothing written",
          );
          return reply
            .code(409)
            .send(
              buildErrorV1(
                "BAD_INPUT",
                "This model changed since it was read. Nothing was written — read it again first.",
                { code: "GRAPH_STALE", expected_graph_hash: callerExpectedGraphHash, current_graph_hash: expectedGraphAnalysisHash ?? null },
                requestId,
              ),
            );
        }
      }

      /**
       * ⛔ A FIRST CONSTRUCTION NEVER LANDS ON A MODEL SOMEONE ELSE SAVED (independent
       * review of #1786, 5805279370). A construction reads the model as empty, then spends
       * ~20 s generating. Without this, the CAS base above is the server's read NOW — so a
       * graph another author committed in that window became the base, and the
       * construction replaced it. The caller's precondition is checked against the same
       * server read; when it holds, that read is an ABSENT/empty base, which the atomic
       * RPC then enforces as known-absent (`p_expected_base_known`), closing the
       * read→write window too. A populated model is refused with nothing written — the
       * caller recovers its OWN earlier commit by its operation's version, never by
       * adopting the newer state.
       *
       * ⛔ "EMPTY" IS THE CANONICAL IDENTITY RULE, `isIdentityEmptyGraph` — not "no nodes"
       * (independent review of #1786, 5807034398). This check used to admit any base whose
       * `nodes` was absent or empty, while the identity rule counts nodes, edges, options
       * AND goal_node_id and the ingress schema admits an options-only graph. So an
       * options-, edges- or goal-only model passed as empty: its identity hash is non-NULL,
       * the store sent no strict flag, and the construction replaced it as a "first" model.
       * The predicate reads the raw server bytes, never the hash, so an unparseable graph
       * (identity hash NULL) is judged by its content too. The SAME four fields are the
       * SQL's `v_current_identity_bearing` under the row lock (migration 20260924030000);
       * the correspondence is pinned by
       * `append-turn-atomic-v5-strict-expected-empty-static-guards.test.ts`. A base that
       * passes here therefore has a NULL identity hash, which is what makes the store send
       * `p_require_expected_empty`.
       */
      if (callerExpectsEmptyModel) {
        if (expectedGraphIdentityHash === undefined) {
          return unavailable();
        }
        if (!isIdentityEmptyGraph(baseGraphForInvariants)) {
          log.warn(
            {
              event: "v5.scenario_graph_register.expected_model_empty_stale",
              request_id: requestId,
              scenario_id: scenarioId,
              current: expectedGraphAnalysisHash ?? null,
            },
            "Graph registration — a model was saved since the caller read it as empty; nothing written",
          );
          return reply
            .code(409)
            .send(
              buildErrorV1(
                "BAD_INPUT",
                "A model was saved for this decision after it was read as empty. Nothing was written.",
                { code: "MODEL_NOT_EMPTY", current_graph_hash: expectedGraphAnalysisHash ?? null },
                requestId,
              ),
            );
        }
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

      const turnId = registrationTurnId(scenarioId, operationId);
      const requestHash = registrationRequestHash(graphForStore, brief.value);
      // THE CANONICAL RECEIPT, captured rather than discarded. The RPC builds
      // it and `SupabaseSessionStore` parses it onto the append outcome; this
      // route threw that outcome away, which is why a freshly constructed model
      // had no version identity any caller could cite.
      let appendOutcome: Awaited<ReturnType<typeof appendCheckedGraphWrite>> | undefined;

      /**
       * ⛔ A REGISTRATION THAT WRITES A GRAPH MUST LEAVE A VERSION BEHIND.
       *
       * Until this, the write below carried no `modelVersion`, so
       * `supabase-store.ts` took its NON-VERSIONED branch
       * (`if (write.modelVersion !== undefined)`) and the RPC was never asked
       * for a version at all. The version was not lost — it was never
       * requested. MEASURED on deployed staging: a model built through this
       * route wrote 28 nodes with `model_versions = 0` and
       * `current_model_version_id = NULL`, while the conventional route minted
       * one for the identical brief. A user's first model had no version to
       * reread, no receipt, and no rollback point.
       *
       * ⭐ The SAME builder the turn path uses, not a second one — the brief
       *    forbids duplicate controllers, and `append_turn_atomic_v5` stays the
       *    only writer either way.
       *
       * ⚠ `creation_kind` is deliberately left as the carrier's
       *   `committed_mutation`: the RPC REQUIRES exactly that value from any
       *   caller (it raises `creation/source turn carrier mismatch` otherwise)
       *   and decides the stored value itself —
       *   `CASE WHEN NOT v_has_versions THEN 'initial' ELSE 'committed_mutation' END`.
       *   So a first registration is correctly recorded as `initial` without
       *   this route asserting anything about lineage. Verified against the
       *   deployed function body and against the data: all 3,162 scenario-first
       *   versions are `initial`, and `committed_mutation` never appears first.
       */
      const versionPlan = buildAtomicCommittedModelVersion(graphForStore, {
        scenario_id: scenarioId,
        turn_id: turnId,
        baseGraphForInvariants,
      });

      try {
        // C3 — THE SHARED PERSISTENCE FLOOR, not `store.append` directly. This
        // route and `commitDirectAnswer` are the only two `scenarios.graph`
        // writers, and until this change only the turn path enforced the
        // terminal structural invariants: a registration could persist a
        // violation the turn path refuses fail-closed. They answer different
        // questions (a TURN vs a REGISTRATION — no LLM, no composed response,
        // `response_emitted: false`), so they are not merged; what they share
        // is HOW a graph persists, and that now has one owner.
        /**
         * ⛔ A REGISTRATION IS A GRAPH WRITE, SO IT TAKES A PLACE IN THE FENCE.
         *
         * MEASURED on deployed staging (Paul's OpenAI test, 22 Sep 23:22:42Z and
         * 23:42:15Z, scenario 450acd25): both registrations logged level-50
         * `v5.turn_fence.no_ingress_fence` — "a GRAPH WRITE reached the store
         * with no ingress fence handle; it is proceeding UNFENCED". The fence is
         * bound by `turnFencePreHandler` on `/orchestrate/v2/turn` only, so this
         * route — the other `scenarios.graph` writer — never had a slot, and the
         * store's one non-refusing gap let it through.
         *
         * Same two steps as the turn ingress, in the same order: bind the slot
         * for THIS write's identity, then claim AFTER admission (auth, body
         * validation and ownership all passed above), so a request this route
         * refuses never advances the scenario's generation. The store then
         * enforces it exactly as it does for a turn: superseded/stopped refuse,
         * a failed claim refuses fail-closed.
         *
         * ⭐ RETRY STAYS SAFE. The claim is idempotent on (scenario_id, turn_id)
         * and `registrationTurnId` is derived from the operation id, so a replay
         * re-reads its ORIGINAL generation; the atomic RPC decides replay of an
         * already-committed turn before its fence gate (20260806120000 + the
         * 2.738(a) move to the top of the function), so the replay returns the
         * original row and receipt rather than a superseded refusal. And a first
         * graph onto an empty scenario is exempt from OLTF2 by design.
         */
        /**
         * ⛔ REFUSE A STRUCTURALLY INVALID GRAPH BEFORE IT CLAIMS A GENERATION.
         *
         * Independent review of #1706 (CHANGES_REQUIRED at 19a0d8b5 and
         * 614296be): the claim below ran BEFORE the persistence floor's
         * invariant check, so an ingress-valid but structurally refused
         * registration (a duplicate node id) still advanced the scenario's
         * generation — superseding an earlier VALID in-flight turn while writing
         * nothing itself. The same terminal check now runs first, on the exact
         * bytes and the same trusted baseline the floor uses, and throws the
         * same `PersistedGraphInvariantError` the catch below maps to 422. The
         * floor inside `appendCheckedGraphWrite` is kept: nothing may mutate the
         * graph between the two, and a second check is the cheap half of that.
         */
        assertNoIntroducedGraphViolations({
          graph: graphForStore,
          identity: { scenario_id: scenarioId, turn_id: turnId, turn_class: "direct_answer" },
          writesGraph: true,
          baseGraphForInvariants,
          source: "graph_registration",
        });
        appendOutcome = await runWithPendingTurnFence(scenarioId, turnId, async () => {
          await admitCurrentTurnFence();
          return appendCheckedGraphWrite({
          store,
          writesGraph: true,
          // Only what THIS registration introduces can refuse it — a scenario
          // whose stored graph is already invalid stays registrable.
          //
          // ⚠ EXCEPT ON A FRESH SCENARIO, WHERE THIS IS ABSOLUTE — a stated
          // decision, not a side effect. `store.loadGraph` returns `null` (never
          // `undefined`) for an absent scenario or a NULL `graph` column, and the
          // floor's observe-only degrade keys on a STRICT `=== undefined`. So a
          // `null` base takes the DELTA branch against an EMPTY baseline and
          // every violation counts as introduced: A FIRST IMPORT INTO AN EMPTY
          // SCENARIO IS FULLY FAIL-CLOSED (422), which is the dominant import
          // journey. That is deliberate — `GraphStateIngressSchema` enforces
          // neither node-id uniqueness nor edge referential integrity, so such
          // imports previously received a silent 200 and stored a graph the turn
          // path would refuse. The observe-only degrade is reached only by the
          // base-READ-FAILURE catch above, which leaves this variable at its
          // declared `undefined`. See the JSDoc on `baseGraphForInvariants` in
          // `persist-graph-write.ts`; both branches are pinned by identity in
          // this route's suite.
          baseGraphForInvariants,
          source: "graph_registration",
          write: {
            scenario_id: scenarioId,
            turn_id: turnId,
            // DL-7 PR B precedent (system-events/dispatch.ts): a server-initiated
            // commit that composes no assistant prose is a `direct_answer` with a
            // null handler_id. The DB CHECK enforces
            // `(turn_class = 'handler') = (handler_id IS NOT NULL)`.
            turn_class: "direct_answer",
            handler_id: null,
            request_hash: requestHash,
            response_emitted: false,
            llm_calls_used: 0,
            duration_ms: Date.now() - startedAt,
            handler_facts: [],
            graph: graphForStore,
            // Present only when the carrier says this graph is versionable; a
            // `none`/`skip` outcome leaves the write byte-identical to before.
            ...(versionPlan.kind === "plan" ? { modelVersion: versionPlan.write } : {}),
            ...(brief.value === undefined ? {} : { briefText: brief.value }),
            expectedGraphIdentityHash,
            expectedGraphAnalysisHash,
            // The caller's empty-model precondition is held INSIDE the atomic write, whatever
            // the global CAS posture: the empty read above can go stale before the fence
            // claim and the append (independent review of #1786, 5805649773).
            ...(callerExpectsEmptyModel ? { requireAtomicExpectedBase: true as const } : {}),
          },
          });
        });
      } catch (err) {
        if (err instanceof TurnFenceRejectedError) {
          // A later-started write on this scenario owns the graph now, or the
          // user stopped it: nothing was written, and saying so is a 409 the
          // caller can act on (re-read, then import again). A fence we could
          // not claim or read is OUR outage, not a conflict — a retryable 503.
          const conflict = err.verdict === "superseded" || err.verdict === "stopped";
          log.warn(
            {
              event: "v5.scenario_graph_register.fence_refused",
              request_id: requestId,
              scenario_id: scenarioId,
              verdict: err.verdict,
              generation: err.generation,
              max_generation: err.maxGeneration,
            },
            "Graph registration — refused by the turn fence; nothing written",
          );
          if (!conflict) return unavailable();
          return reply
            .code(409)
            .send(
              buildErrorV1(
                "BAD_INPUT",
                err.verdict === "stopped"
                  ? "This change was stopped, so nothing was imported."
                  : "A newer change to this model started while you were importing. Nothing was written — reload and import again.",
                { code: err.verdict === "stopped" ? "TURN_STOPPED" : "TURN_SUPERSEDED" },
                requestId,
              ),
            );
        }
        if (err instanceof PersistedGraphInvariantError) {
          // The caller supplied these bytes, so name what is wrong with them —
          // the `invalid()` doctrine. A 503 would be actively misleading: it
          // invites a retry of a payload that can never succeed.
          log.warn(
            {
              event: "v5.scenario_graph_register.invariant_violation",
              request_id: requestId,
              scenario_id: scenarioId,
              introduced: err.violations.map((v) => ({
                code: v.code,
                count: v.count,
                entity_ids: v.entity_ids,
              })),
            },
            "Graph registration — refused: this graph introduces a structural violation; nothing written",
          );
          return invalid(
            "GRAPH_INVARIANT_VIOLATION",
            "This model has a structural problem and was not imported.",
            {
              violations: err.violations.map((v) => ({
                code: v.code,
                count: v.count,
                entity_ids: v.entity_ids,
              })),
            },
          );
        }
        if (err instanceof AtomicPreconditionUnenforceableError) {
          // The writer could not hold the caller's precondition atomically, so it wrote
          // nothing. Refused as OUR limitation (503), never downgraded to an unconditional write.
          log.warn(
            {
              event: "v5.scenario_graph_register.precondition_unenforceable",
              request_id: requestId,
              scenario_id: scenarioId,
              err: err.message,
            },
            "Graph registration — the caller's precondition cannot be enforced atomically; nothing written",
          );
          return reply
            .code(503)
            .send(
              buildErrorV1(
                "INTERNAL",
                "This model could not be saved safely right now. Nothing was written.",
                { code: "PRECONDITION_UNENFORCEABLE" },
                requestId,
              ),
            );
        }
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
                // See the `invalid()` note: the shared `ErrorCode` family has
                // no CONFLICT member, so 409 is carried by the HTTP status and
                // the reason by `details.code`.
                "BAD_INPUT",
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

      /**
       * ⛔ A REUSED OPERATION ID WITH A DIFFERENT GRAPH IS A REFUSAL, NOT A SUCCESS.
       *
       * The durable key held: the RPC's `(scenario_id, turn_id)` arm returned the
       * row already there and wrote nothing. Answering 200 `registered: true`
       * with THIS request's identity hash would tell the caller its graph is
       * stored when the stored graph is the earlier one — the exact false
       * "Updated X" the store's classifier docblock measured on the turn path.
       */
      if (appendOutcome?.priorTurnConflict === true) {
        log.warn(
          {
            event: "v5.scenario_graph_register.operation_id_reused",
            request_id: requestId,
            scenario_id: scenarioId,
          },
          "Graph registration — operation_id reused with a different graph; nothing written",
        );
        return reply
          .code(409)
          .send(
            buildErrorV1(
              "BAD_INPUT",
              "This import was already recorded with a different model. Nothing was changed.",
              { code: "OPERATION_ID_REUSED" },
              requestId,
            ),
          );
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
        // ADDITIVE: present only when this request replayed a registration that
        // was already committed under the same operation id. The receipt below
        // is then the ORIGINAL one, not a second version.
        ...(appendOutcome?.replayedPriorTurn === true ? { replayed: true } : {}),
        // The ACKNOWLEDGEMENT. This is what lets a client stop saying
        // "cannot confirm": the server has the graph, and this token names it.
        graph_identity_hash: identity,
        // ADDITIVE: the ANALYSIS-space hash of the bytes this registration
        // stored — the same value the read route will report as `graph_hash`.
        // A caller chaining a further CAS-gated edit on its OWN write needs
        // exactly this, and re-reading to obtain it would absorb any foreign
        // change made in between.
        graph_hash: computeExpectedGraphCasHashes(graphForStore).expectedGraphAnalysisHash,
        // ADDITIVE and optional: present only when this registration actually
        // wrote a version. The skip arm omits the KEY rather than sending null,
        // so a client never has to tell "no version written" apart from
        // "version unknown". Identity only — attribution is deliberately not
        // exposed on a service-key-reachable route.
        ...(appendOutcome?.modelVersionReceipt === undefined
          ? {}
          : {
              model_version: {
                mutation_id: appendOutcome.modelVersionReceipt.mutation_id,
                version_id: appendOutcome.modelVersionReceipt.version_id,
                version_number: appendOutcome.modelVersionReceipt.version_number,
                creation_kind: appendOutcome.modelVersionReceipt.creation_kind,
                graph_identity_hash: appendOutcome.modelVersionReceipt.graph_identity_hash,
                analysis_affecting_hash:
                  appendOutcome.modelVersionReceipt.analysis_affecting_hash,
              },
            }),
        node_count: parsed.data.nodes.length,
        edge_count: parsed.data.edges.length,
        kind_fields_normalised: normalised.changedNodeCount,
        request_id: requestId,
      });
    },
  );
}
