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
 *   3. Auth hook — extract caller user_id (Group 3 P0 scaffold;
 *      currently a stub, inert when v5CrossTenantEnforcement is off)
 *   4. Pre-flight scenario check (Task A; ownership-checked when
 *      v5CrossTenantEnforcement is on)
 *   5. runTurnExecutor
 *   6. Commit-status check (Task B — BEFORE egress so the invariant
 *      is total; a TurnExecutor whose output AND commit both fail
 *      takes the 500 path, not the 200-fallback path)
 *   7. B1 egress validator
 *   8. 200 + OlumiResponse
 *
 * Route registration is gated on config.features.orchestratorV5. When the
 * flag is off, this route is not registered and the endpoint returns 404.
 *
 * Transport invariant: buffered JSON only (no raw-stream writes, no SSE
 * Content-Type). Enforced by scripts/validate-transport-invariants.sh in CI.
 *
 * No imports from V4 pipeline (pipeline-v4, response-assembler, handlers).
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { BoundaryError } from '@talchain/schemas/boundary';

import { config } from '../config/index.js';
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

    // Auth hook (Group 3 P0 scaffold): extract the caller's user_id from
    // the request. This is the single seam that future auth plumbing will
    // fill in (Supabase JWT, Fastify auth plugin, signed header, etc.).
    // Today it returns undefined — see extractCallerUserId below for the
    // full TODO. Tests inject a user_id via the X-Olumi-User-Id header so
    // the cross-tenant integration test can exercise the enforced path
    // without a real auth stack.
    const callerUserId = extractCallerUserId(req);
    const enforceCrossTenant = config.features.v5CrossTenantEnforcement === true;

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
    // Ownership mode (Group 3 P0 follow-up): when v5CrossTenantEnforcement
    // is true AND a caller user_id is available, the preflight uses the
    // user-scoped `check_scenario_ownership` RPC instead of the service-
    // role `scenarios` SELECT. Absent owner check falls back to the legacy
    // existence check so we don't accidentally block the happy path if the
    // auth hook isn't wired yet.
    const preflightFailure = await preflightScenarioCheck(
      ingress.value.scenario_id,
      requestId,
      enforceCrossTenant ? callerUserId : undefined,
    );
    if (preflightFailure) {
      return reply.code(422).send(preflightFailure);
    }

    // TurnExecutor returns a well-formed OlumiResponse envelope on every
    // path (success, typed error block, or commit failure). The HTTP
    // status on the wire is decided here by the route, NOT by the
    // TurnExecutor — see the status/body matrix in the file header. The
    // executor never throws past this boundary.
    const run = await runTurnExecutor(ingress.value, requestId, {
      graphState: extensions.value.graphState,
      analysisState: extensions.value.analysisState,
      // Thread caller_user_id to commit only when enforcement is on.
      // The store picks `append_turn_atomic_v2` iff caller_user_id is
      // present on the write; leaving it undefined preserves legacy
      // behaviour.
      ...(enforceCrossTenant && callerUserId !== undefined
        ? { callerUserId }
        : {}),
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
  callerUserId: string | undefined,
): Promise<BoundaryError | null> {
  let exists: boolean;
  const ownershipMode = callerUserId !== undefined;
  try {
    const store = getSessionStore();
    exists = ownershipMode
      ? await store.checkScenarioOwnership(scenarioId, callerUserId as string)
      : await store.checkScenarioExists(scenarioId);
  } catch (e) {
    // Store not configured (missing SUPABASE_*) OR a transient read error
    // OR (in ownership mode) the check_scenario_ownership RPC not installed
    // yet. Do NOT block the turn — the commit RPC is the last line of
    // defence. Log at debug so the absence of pre-flight is observable
    // without noise.
    log.debug(
      {
        request_id: requestId,
        scenario_id: scenarioId,
        ownership_mode: ownershipMode,
        err_name: e instanceof Error ? e.name : 'unknown',
        err_message: e instanceof Error ? e.message : String(e),
      },
      'V5 pre-flight scenario check skipped (store unavailable or read error)',
    );
    return null;
  }

  if (exists) return null;

  log.warn(
    { request_id: requestId, scenario_id: scenarioId, ownership_mode: ownershipMode },
    'V5 pre-flight: scenario not found — rejecting turn with 422',
  );
  return {
    error: 'INGRESS_CONTRACT_VIOLATION',
    boundary: 'B1',
    direction: 'ingress',
    validator: 'scenario_preflight',
    // Uniform reason for both "missing" and "foreign owner" — telling a
    // non-owner "exists but not yours" is a cross-tenant leak.
    details: { reason: 'scenario_not_found', scenario_id: scenarioId },
    request_id: requestId,
    retryable: false,
  };
}

/**
 * Extract the caller's user_id from the request. Group 3 P0 follow-up
 * scaffold — the real auth story is Paul-owned and gated on the
 * v5CrossTenantEnforcement feature flag + the
 * 20260422000000_v5_cross_tenant_enforcement.sql migration.
 *
 * Today this helper reads an `X-Olumi-User-Id` header ONLY when the
 * feature flag is on. In production, that header is trivially
 * spoofable — the real implementation will be one of:
 *
 *   (A) Fastify auth plugin that parses a Supabase JWT from the
 *       `Authorization: Bearer <jwt>` header, validates the signature
 *       against Supabase's JWKS endpoint, and sets `request.user = {
 *       id, ... }`. This helper then returns `(request as any).user.id`.
 *
 *   (B) A shared signed-header contract between the BFF proxy
 *       (Netlify edge function) and CEE, where the BFF rewrites the
 *       UI's JWT into a CEE-trusted signed header. Preserves the
 *       performance of no-JWT-parse in CEE while keeping the auth
 *       source of truth in one place.
 *
 * Either way, this helper becomes the single seam. Tests can override
 * via the header (which is inert in production if the auth plugin sets
 * request.user). Not yet in the test harness — will be wired in the
 * Paul-owned auth commit that accompanies the migration rollout.
 *
 * Returns undefined when the flag is off OR the header is missing.
 */
function extractCallerUserId(req: FastifyRequest): string | undefined {
  // Inert when the flag is off: no auth-source lookup, no header read.
  if (!config.features.v5CrossTenantEnforcement) return undefined;
  const raw = req.headers['x-olumi-user-id'];
  if (typeof raw !== 'string' || raw.length === 0) return undefined;
  // Basic UUID shape check — lets typos fail cleanly at the pre-flight
  // instead of surfacing as an RPC syntax error deeper in the stack.
  // Paul's real auth plugin will replace this with a validated JWT
  // subject claim.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) {
    return undefined;
  }
  return raw;
}
