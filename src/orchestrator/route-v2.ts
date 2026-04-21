/**
 * POST /orchestrate/v2/turn — V5 orchestrator endpoint.
 *
 * ─────────────────────────────────────────────────────────────────
 * HTTP status / body matrix (Group 3 Task B + P0 follow-up)
 * ─────────────────────────────────────────────────────────────────
 *
 *   422 + BoundaryError    INGRESS_CONTRACT_VIOLATION
 *                          - B1 ingress validation failed, OR
 *                          - pre-flight scenario check (Task A) rejected
 *                            the turn (missing scenario; or, when
 *                            v5CrossTenantEnforcement is on, foreign
 *                            scenario)
 *
 *   500 + BoundaryError    ANY runtime failure that left
 *                          commit_performed === false. That is a
 *                          DELIBERATELY UNIFORM STATUS across:
 *                            - STATE_COMMIT_FAILED (RPC failure)
 *                            - UPSTREAM_TIMEOUT   (LLM timeout)
 *                            - TURN_BUDGET_EXCEEDED (outer budget)
 *                            - INTERNAL_ERROR (UNHANDLED, handler
 *                              invocation / result failures)
 *                          Rationale: (a) the UI parser treats every
 *                          non-ok status as BoundaryError — mixing 500
 *                          / 503 / 504 would bifurcate client error-
 *                          handling without adding actionable info the
 *                          user can use; (b) the `retryable` flag on
 *                          the wire already carries the "try again vs
 *                          give up" distinction clients actually need;
 *                          (c) future HTTP-semantic splits (503 for
 *                          upstream, 504 for timeout) can layer on
 *                          without changing the fail-closed invariant.
 *
 *   200 + OlumiResponse    Happy path. Also used for B1 egress
 *                          validator's schema-drift fallback — an
 *                          internal contract violation where the
 *                          TurnExecutor's OWN output drifted from
 *                          OlumiResponseSchema. That fallback body is
 *                          still a well-formed OlumiResponse per
 *                          boundary contract §3.2.3. Reachable ONLY
 *                          when commit_performed === true (see ordering
 *                          below — the commit-status check runs first).
 *
 * ─────────────────────────────────────────────────────────────────
 * Ordering within the handler is deliberate
 * ─────────────────────────────────────────────────────────────────
 *
 *   1. Extension parse (graph_state / analysis_state)
 *   2. B1 ingress (core payload)
 *   3. Pre-flight scenario check (Task A — existence only; cross-tenant
 *      ownership is deferred, see ⚠ block on SupabaseSessionStore.
 *      checkScenarioExists)
 *   4. runTurnExecutor
 *   5. Commit-status check (Task B — BEFORE egress so the invariant
 *      is total; a TurnExecutor whose output AND commit both fail
 *      takes the 500 path, not the 200-fallback path)
 *   6. B1 egress validator
 *   7. 200 + OlumiResponse
 *
 * Route registration is gated on config.features.orchestratorV5. When the
 * flag is off, this route is not registered and the endpoint returns 404.
 *
 * Transport invariant: buffered JSON only (no raw-stream writes, no SSE
 * Content-Type). Enforced by scripts/validate-transport-invariants.sh in CI.
 *
 * No imports from V4 pipeline (pipeline-v4, response-assembler, handlers).
 */

import type { FastifyInstance } from 'fastify';
import type { BoundaryError } from '@talchain/schemas/boundary';

import { getOrGenerateRequestId } from '../utils/request-id.js';
import { log } from '../utils/telemetry.js';
import { validateIngress, validateEgress } from '../validators/b1.js';
import { runTurnExecutor } from '../orchestrator-v5/turn-executor.js';
import { parseRequestExtensions } from '../orchestrator-v5/boundary/request-extensions.js';
import { preflightScenarioCheck } from '../orchestrator-v5/build-turn-context.js';

// Phase 1.5: B1's OrchestratorTurnPayload schema is `strict` (rejects unknown
// keys), so we cannot pass `graph_state` / `analysis_state` straight through
// to `validateIngress`. Extract them first via the Phase 1.5 extension
// validator, then hand a stripped body to B1. Order is deliberate — if the
// extensions parse fails, we want the 422 to name the specific field before
// any other boundary error.
const V5_EXTENSION_FIELDS = ['graph_state', 'analysis_state'] as const;

function stripExtensionFields(body: unknown): unknown {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return body;
  const copy: Record<string, unknown> = { ...(body as Record<string, unknown>) };
  for (const k of V5_EXTENSION_FIELDS) delete copy[k];
  return copy;
}

export async function ceeOrchestratorRouteV2(app: FastifyInstance): Promise<void> {
  app.post('/orchestrate/v2/turn', async (req, reply) => {
    const requestId = getOrGenerateRequestId(req);

    // Phase 1.5: parse graph_state + analysis_state FIRST. @talchain's
    // OrchestratorTurnPayload schema is `strict` and would reject these
    // fields as unrecognized keys if we ran B1 first. See
    // Docs/v5/phase1.5-wire-investigation.md for wire rationale.
    const extensions = parseRequestExtensions(req.body, requestId);
    if (!extensions.ok) {
      log.warn(
        {
          request_id: requestId,
          error: extensions.error.error,
          field: (extensions.error.details as { field?: string }).field,
          issue_count: (extensions.error.details as { issues?: unknown[] }).issues?.length ?? 0,
        },
        'V5 request-extensions validation failed',
      );
      return reply.code(422).send(extensions.error);
    }

    // B1 ingress on the base body (graph/analysis stripped to appease strict mode).
    const strippedBody = stripExtensionFields(req.body);
    const ingress = validateIngress(strippedBody, requestId);
    if (!ingress.ok) {
      log.warn(
        { request_id: requestId, error: ingress.error.error, issue_count: (ingress.error.details as { issues?: unknown[] }).issues?.length ?? 0 },
        'V5 B1 ingress validation failed',
      );
      return reply.code(422).send(ingress.error);
    }

    // Task A pre-flight (Group 3): surface missing scenarios as a typed 422 at
    // ingress rather than letting `append_turn_atomic` surface them as an
    // opaque `STATE_COMMIT_FAILED` → `INTERNAL_ERROR` at commit. V5 depends on
    // the UI having inserted the `scenarios` row during scenario creation
    // (DecisionGuideAI's scenarioService); this check makes that architectural
    // dependency fail loudly for the user. Best-effort by design — if the
    // store is not configured (e.g. local tests without SUPABASE_*), skip; if
    // a transient read error occurs, skip (the commit path is still the last
    // line of defence).
    //
    // ⚠ Does NOT enforce caller ownership. See the ⚠ CROSS-TENANT
    // LIMITATION block on SupabaseSessionStore.checkScenarioExists —
    // closing that gap requires a per-request JWT-scoped Supabase
    // client (so auth.uid() inside RPCs resolves to the real caller),
    // NOT a `p_user_id` parameter (which is an audit tripwire — see
    // scripts/validate-docs-consistency.sh §2).
    const preflight = await preflightScenarioCheck(
      ingress.value.scenario_id,
      requestId,
    );
    if (!preflight.ok) {
      const preflightError: BoundaryError = {
        error: 'INGRESS_CONTRACT_VIOLATION',
        boundary: 'B1',
        direction: 'ingress',
        validator: 'scenario_preflight',
        details: { reason: preflight.reason, scenario_id: ingress.value.scenario_id },
        request_id: requestId,
        retryable: false,
      };
      return reply.code(422).send(preflightError);
    }

    // v0.7.0 schema: ingress is a discriminated union on `kind`. Task 1 of the
    // v5-handler-surface brief adds a pre-TurnExecutor dispatch branch for
    // `kind: 'system_event'`. Until that branch lands (next commit in the
    // brief sequence), surface system_event ingress as a typed
    // FEATURE_NOT_ENABLED so the wire contract stays honest — the v0.7.0
    // schema accepts the payload but the handler isn't wired yet.
    if (ingress.value.kind !== 'message') {
      const notImplemented: BoundaryError = {
        error: 'FEATURE_NOT_ENABLED',
        boundary: 'B1',
        direction: 'ingress',
        validator: 'system_event_dispatch',
        details: {
          reason: 'system_event_dispatch_not_wired',
          event_kind: ingress.value.event.kind,
          retryable: false,
        },
        request_id: requestId,
        retryable: false,
      };
      return reply.code(501).send(notImplemented);
    }

    // TurnExecutor returns a well-formed OlumiResponse envelope on every
    // path (success, typed error block, or commit failure). The HTTP
    // status on the wire is decided here by the route, NOT by the
    // TurnExecutor — see the status/body matrix in the file header. The
    // executor never throws past this boundary.
    const run = await runTurnExecutor(ingress.value, requestId, {
      graphState: extensions.value.graphState,
      analysisState: extensions.value.analysisState,
    });

    // Group 3 Task B — fail-closed invariant: `commit_performed: false` must
    // NEVER appear inside an HTTP 200. When the TurnExecutor did not persist
    // session state the client should see a non-200 + typed BoundaryError,
    // not a 200 that implies success. Prior to Group 3 both produced 200,
    // masking the session corruption.
    //
    // Ordering (P1 follow-up): the commit-status check runs BEFORE egress
    // validation. Otherwise a TurnExecutor whose OWN output drifted from
    // OlumiResponseSchema AND whose commit failed would take the egress
    // fallback branch and emit 200 + fallback envelope — silently violating
    // the invariant. Commit-first keeps the invariant total.
    //
    // Body shape (P0 follow-up): non-2xx V5 responses must be BoundaryError
    // envelopes (BoundaryErrorSchema), not OlumiResponse. The UI parser at
    // [responseParser.ts:35] treats every non-ok status as BoundaryError;
    // sending an OlumiResponse on 500 causes it to degrade to a generic
    // parse_error → INTERNAL_ERROR, losing the typed retryable signal.
    if (run.telemetry.commit_performed === false) {
      const failureType = run.telemetry.failure_type;
      // Retryable per failure class — read from the response envelope's
      // error-block details (populated by buildFailureResponse), with a
      // conservative false default if the shape drifts.
      const retryable = extractRetryableFlag(run.response);
      const boundaryError: BoundaryError = {
        // failure_type is either a BoundaryErrorCode enum member or null
        // (for successful turns — unreachable here because commit_performed
        // is false). Fall back to INTERNAL_ERROR if null to keep the wire
        // shape honest.
        error: failureType ?? 'INTERNAL_ERROR',
        boundary: 'B1',
        direction: 'egress',
        validator: 'turn_commit',
        details: {
          retryable,
          reason: 'state_commit_failed_or_turn_runtime_failure',
          failure_type: failureType,
          // Group 3 follow-up: stage aids client-side triage — a
          // commit failure in `analyse` stage vs `frame` stage has
          // different user implications ("the analysis ran but didn't
          // save" vs "we couldn't frame the decision").
          stage: ingress.value.stage,
          stages_completed: run.telemetry.stages_completed,
        },
        request_id: requestId,
        retryable,
      };
      log.error(
        {
          request_id: requestId,
          failure_type: failureType,
          stages_completed: run.telemetry.stages_completed,
        },
        'V5 turn completed without commit — returning 500 with BoundaryError envelope',
      );
      return reply.code(500).send(boundaryError);
    }

    const egress = validateEgress(run.response, requestId);
    if (!egress.ok) {
      log.error(
        { request_id: requestId, failure_type: run.telemetry.failure_type },
        'V5 B1 egress validation failed — returning typed fallback envelope',
      );
      return reply.code(200).send(egress.fallback);
    }

    return reply.code(200).send(egress.value);
  });
}

/**
 * Pull the boolean `retryable` flag out of a failure-response envelope's
 * first error-block details. `buildFailureResponse` stamps this (Group 3
 * Task B) and the set of retryable internal classes lives in
 * `src/orchestrator-v5/failure-response.ts`. Defensive: returns false on
 * any shape drift, which is the safer default (don't advertise retryability
 * we're not sure about).
 */
function extractRetryableFlag(response: unknown): boolean {
  if (!response || typeof response !== 'object') return false;
  const blocks = (response as { blocks?: unknown }).blocks;
  if (!Array.isArray(blocks) || blocks.length === 0) return false;
  const errBlock = blocks.find(
    (b: unknown) =>
      b != null && typeof b === 'object' && (b as { type?: unknown }).type === 'error',
  );
  if (!errBlock || typeof errBlock !== 'object') return false;
  const details = (errBlock as { details?: unknown }).details;
  if (!details || typeof details !== 'object') return false;
  return (details as { retryable?: unknown }).retryable === true;
}

