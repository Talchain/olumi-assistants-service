/**
 * POST /orchestrate/v2/turn — V5 orchestrator endpoint.
 *
 * HTTP status / body matrix (Group 3 Task B + P0 follow-up):
 *
 *   422 + BoundaryError      — B1 ingress validation failed, OR pre-flight
 *                              scenario check rejected the turn (Task A)
 *   500 + BoundaryError      — commit_performed === false (Task B); retryable
 *                              flag preserved on the wire so the UI can
 *                              render a typed actionable error
 *   200 + OlumiResponse      — happy path OR schema-drift fallback from
 *                              B1 egress validator (internal contract
 *                              violation; response is still well-formed
 *                              OlumiResponse per boundary contract §3.2.3)
 *
 * Ordering within the handler is deliberate:
 *
 *   1. Extension parse (graph_state / analysis_state)
 *   2. B1 ingress (core payload)
 *   3. Pre-flight scenario check (Task A)
 *   4. runTurnExecutor
 *   5. commit-status check (Task B — BEFORE egress so the invariant is
 *      total; a TurnExecutor whose output AND commit both fail takes
 *      the 500 path, not the 200-fallback path)
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
import { getSessionStore, SessionReadError } from '../orchestrator-v5/session/index.js';

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
    const preflightFailure = await preflightScenarioCheck(ingress.value.scenario_id, requestId);
    if (preflightFailure) {
      return reply.code(422).send(preflightFailure);
    }

    // TurnExecutor produces an OlumiResponse (success or typed error block).
    // It never throws past this boundary — every runtime failure → 200 + envelope.
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

/**
 * Pre-flight check that returns a typed 422 BoundaryError when the requested
 * scenario does not exist in `public.scenarios`. Returns `null` on either
 * "scenario exists" or "check could not run" (store not configured, transient
 * read error) — the TurnExecutor commit path remains the last line of defence.
 *
 * The error code must be a member of the pinned `BoundaryErrorCode` enum from
 * `@talchain/schemas/boundary` (§6.4). We reuse `INGRESS_CONTRACT_VIOLATION`
 * — the payload passed ingress Zod validation but references a row the server
 * cannot act on, which is a contract violation at the ingress boundary. The
 * free-form `details.reason = 'scenario_not_found'` distinguishes it from a
 * Zod shape failure.
 */
async function preflightScenarioCheck(
  scenarioId: string,
  requestId: string,
): Promise<BoundaryError | null> {
  let exists: boolean;
  try {
    const store = getSessionStore();
    exists = await store.checkScenarioExists(scenarioId);
  } catch (e) {
    // Store not configured (missing SUPABASE_*) OR a transient read error.
    // Do NOT block the turn — the RPC will surface genuinely missing rows.
    // Log at debug so the absence of pre-flight is observable without noise.
    log.debug(
      {
        request_id: requestId,
        scenario_id: scenarioId,
        err_name: e instanceof Error ? e.name : 'unknown',
        err_message: e instanceof Error ? e.message : String(e),
      },
      'V5 pre-flight scenario check skipped (store unavailable or read error)',
    );
    return null;
  }

  if (exists) return null;

  log.warn(
    { request_id: requestId, scenario_id: scenarioId },
    'V5 pre-flight: scenario row not found — rejecting turn with 422',
  );
  return {
    error: 'INGRESS_CONTRACT_VIOLATION',
    boundary: 'B1',
    direction: 'ingress',
    validator: 'scenario_preflight',
    details: { reason: 'scenario_not_found', scenario_id: scenarioId },
    request_id: requestId,
    retryable: false,
  };
}
