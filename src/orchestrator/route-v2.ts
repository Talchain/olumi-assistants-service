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
import { dispatchSystemEvent } from '../orchestrator-v5/system-events/dispatch.js';
import { dispatchDraftGraph } from '../orchestrator-v5/handlers/draft-graph-dispatch.js';
import { dispatchEditGraph } from '../orchestrator-v5/handlers/edit-graph-dispatch.js';
import { dispatchChipClickRunAnalysis } from '../orchestrator-v5/handlers/chip-click-dispatch.js';
import { DRAFT_GRAPH_MIN_BRIEF_LENGTH } from '../schemas/assist.js';

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

// ────────────────────────────────────────────────────────────────────
// Dispatch-trigger regexes (hoisted to module scope — constructing these
// inside the request handler would rebuild RegExp objects on every turn).
// ────────────────────────────────────────────────────────────────────

/**
 * Positive decision-brief regex for draft_graph dispatch. Matches common
 * decision verbs or a trailing question mark. See
 * `tests/integration/orchestrator/route-v2-draft-graph.test.ts` for
 * regression cases including known false negatives.
 */
const DRAFT_GRAPH_DECISION_BRIEF_REGEX =
  /\b(should|shall|whether|versus|vs\.?|choose|decide|expand|invest|launch|hire|fire|buy|sell|acquire|pivot|layoff|restructure)\b|\?$/i;

/** Positive edit-intent regex for edit_graph dispatch. */
const EDIT_GRAPH_POSITIVE_REGEX =
  /\b(change|update|edit|modify|remove|delete|add|adjust|set|reduce|increase|decrease|tweak|raise|lower)\b/i;

/**
 * Negative guard for edit_graph dispatch. If a message contains any of
 * these phrases it is a meta-question, not an edit command, and must NOT
 * dispatch even if a positive edit-verb also appears. Mutating the graph
 * on a meta-question is the worst failure mode.
 */
const EDIT_GRAPH_NEGATIVE_REGEX =
  /\b(explain|compare|what would|flip|why|how does|tell me|show me|describe)\b/i;

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

    // v0.7.0 schema: ingress is a discriminated union on `kind`. System events
    // (patch_accepted / patch_dismissed / direct_graph_edit / chip_click /
    // undo / redo) are Layer 0 deterministic operations — no LLM routing, no
    // handler dispatch. They branch HERE, before TurnExecutor, because
    // SystemEventTurnPayload has no `message` field and TurnExecutor's ORIENT
    // step cannot run without one.
    //
    // Commit semantics (see src/orchestrator-v5/system-events/dispatch.ts):
    //   - Four state-changing events commit via append_turn_atomic.
    //   - undo/redo are client-only and DO NOT commit. The dispatcher
    //     signals that via commitSkippedReason: 'client_only_event'; the
    //     branch below recognises that reason and still returns 200 without
    //     invoking the fail-closed 500 path. This keeps the wire invariant
    //     honest ("commit_performed=false + recognised skip reason ⇒ 200";
    //     "commit_performed=false + no recognised skip reason ⇒ 500").
    if (ingress.value.kind === 'system_event') {
      const sysResult = await dispatchSystemEvent({
        payload: ingress.value,
        requestId,
      });
      if (!sysResult.commitPerformed && sysResult.commitSkippedReason !== 'client_only_event') {
        const boundaryError: BoundaryError = {
          error: 'INTERNAL_ERROR',
          boundary: 'B1',
          direction: 'egress',
          validator: 'turn_commit',
          details: {
            retryable: true,
            reason: 'system_event_commit_failed',
            event_kind: ingress.value.event.kind,
            stage: ingress.value.stage,
          },
          request_id: requestId,
          retryable: true,
        };
        log.error(
          {
            request_id: requestId,
            event_kind: ingress.value.event.kind,
          },
          'V5 system event commit failed — returning 500 with BoundaryError envelope',
        );
        return reply.code(500).send(boundaryError);
      }
      const sysEgress = validateEgress(sysResult.response, requestId);
      if (!sysEgress.ok) {
        log.error(
          { request_id: requestId, event_kind: ingress.value.event.kind },
          'V5 system event egress validation failed — returning typed fallback envelope',
        );
        return reply.code(200).send(sysEgress.fallback);
      }
      return reply.code(200).send(sysEgress.value);
    }

    // ────────────────────────────────────────────────────────────────────
    // Chip-click run_analysis dispatch (v5-handler-surface brief Task 4)
    // ────────────────────────────────────────────────────────────────────
    //
    // This branch runs BEFORE the heuristic-based draft_graph and edit_graph
    // branches because a chip click is an EXPLICIT user signal — no
    // ambiguity, no heuristic. If a chip click arrives with a message that
    // would also match draft_graph's decision-brief regex (e.g. stage=frame
    // + long message + decision keywords), the chip takes precedence. A
    // future refactor that changed dispatch order must keep chip-click
    // first.
    //
    // Scope: ONLY source='chip_click' + chip.action_type='run_analysis'.
    // source='chip' (inline chip metadata on a normal message) falls
    // through to TurnExecutor. Other chip action types fall through to
    // TurnExecutor which returns a typed FEATURE_NOT_ENABLED via the
    // existing UNSUPPORTED_ACTION path (v5-exclusive-cee P0 follow-up).
    const isChipClickRunAnalysis =
      ingress.value.source === 'chip_click' &&
      ingress.value.chip?.action_type === 'run_analysis';
    if (isChipClickRunAnalysis) {
      try {
        const cc = await dispatchChipClickRunAnalysis({
          payload: ingress.value,
          requestId,
        });
        // Discriminated outcome — each case maps to a distinct wire
        // response. Parallels TurnExecutor's catch ladder so chip-click
        // errors surface with the same typed granularity.
        if (cc.outcome === 'handler_failure') {
          const boundaryError: BoundaryError = {
            error: 'INTERNAL_ERROR',
            boundary: 'B1',
            direction: 'egress',
            validator: 'chip_click_dispatch',
            details: {
              retryable: cc.retryable,
              reason: 'chip_click_run_analysis_handler_failed',
              cause_kind: cc.causeKind,
              stage: ingress.value.stage,
            },
            request_id: requestId,
            retryable: cc.retryable,
          };
          return reply.code(500).send(boundaryError);
        }
        if (cc.outcome === 'handler_result_invalid') {
          const boundaryError: BoundaryError = {
            error: 'INTERNAL_ERROR',
            boundary: 'B1',
            direction: 'egress',
            validator: 'chip_click_dispatch',
            details: {
              retryable: false,
              reason: 'chip_click_run_analysis_handler_result_invalid',
              stage: ingress.value.stage,
            },
            request_id: requestId,
            retryable: false,
          };
          return reply.code(500).send(boundaryError);
        }
        if (cc.outcome === 'commit_failed') {
          const boundaryError: BoundaryError = {
            error: 'INTERNAL_ERROR',
            boundary: 'B1',
            direction: 'egress',
            validator: 'turn_commit',
            details: {
              retryable: true,
              reason: 'chip_click_run_analysis_commit_failed',
              stage: ingress.value.stage,
            },
            request_id: requestId,
            retryable: true,
          };
          return reply.code(500).send(boundaryError);
        }
        // outcome === 'ok'
        const ccEgress = validateEgress(cc.response, requestId);
        if (!ccEgress.ok) {
          log.error(
            { request_id: requestId },
            'V5 chip_click run_analysis dispatch egress validation failed — returning typed fallback envelope',
          );
          return reply.code(200).send(ccEgress.fallback);
        }
        return reply.code(200).send(ccEgress.value);
      } catch (err) {
        log.error(
          {
            request_id: requestId,
            err: err instanceof Error ? { name: err.name, message: err.message } : { message: String(err) },
          },
          'V5 chip_click run_analysis handler threw — returning 500 BoundaryError',
        );
        const boundaryError: BoundaryError = {
          error: 'INTERNAL_ERROR',
          boundary: 'B1',
          direction: 'egress',
          validator: 'chip_click_dispatch',
          details: {
            retryable: true,
            reason: 'chip_click_run_analysis_handler_threw',
            stage: ingress.value.stage,
          },
          request_id: requestId,
          retryable: true,
        };
        return reply.code(500).send(boundaryError);
      }
    }

    // ────────────────────────────────────────────────────────────────────
    // Draft_graph pre-Sonnet dispatch (v5-handler-surface brief Task 2)
    // ────────────────────────────────────────────────────────────────────
    //
    // `draft_graph` is NOT in v0.7.0 V5ActionType, so Sonnet's tool-use
    // validator would reject any tool_use proposing it. Detect the
    // first-time brief-submission shape BEFORE TurnExecutor and delegate
    // deterministically to handleDraftGraph (which wraps the shared
    // unified pipeline).
    //
    // Conservative trigger: all of the following must hold.
    //   - kind: 'message'                      — system events branched.
    //   - stage: 'frame'                       — frame-stage starter.
    //   - no graph_state                       — nothing to edit yet.
    //   - message ≥ DRAFT_GRAPH_MIN_BRIEF_LENGTH — matches V4 input schema.
    //   - message looks like a decision brief  — positive keyword regex
    //     below. False negatives (real briefs without keywords) fall
    //     through to TurnExecutor text_only, which is already WORKING
    //     per the matrix. False positives would mis-invoke the pipeline
    //     on a conversational message, so we err on the side of NOT
    //     dispatching.
    const isDraftGraphShape =
      ingress.value.stage === 'frame' &&
      extensions.value.graphState == null &&
      ingress.value.message.length >= DRAFT_GRAPH_MIN_BRIEF_LENGTH &&
      DRAFT_GRAPH_DECISION_BRIEF_REGEX.test(ingress.value.message);
    if (isDraftGraphShape) {
      try {
        const dg = await dispatchDraftGraph({
          payload: ingress.value,
          requestId,
          request: req,
        });
        if (!dg.commitPerformed) {
          const boundaryError: BoundaryError = {
            error: 'INTERNAL_ERROR',
            boundary: 'B1',
            direction: 'egress',
            validator: 'turn_commit',
            details: {
              retryable: true,
              reason: 'draft_graph_commit_failed',
              stage: ingress.value.stage,
            },
            request_id: requestId,
            retryable: true,
          };
          return reply.code(500).send(boundaryError);
        }
        const dgEgress = validateEgress(dg.response, requestId);
        if (!dgEgress.ok) {
          log.error(
            { request_id: requestId },
            'V5 draft_graph dispatch egress validation failed — returning typed fallback envelope',
          );
          return reply.code(200).send(dgEgress.fallback);
        }
        return reply.code(200).send(dgEgress.value);
      } catch (err) {
        // The unified pipeline threw — surface a typed BoundaryError. The
        // dispatcher already logged the details; re-log here with the
        // route-level correlation context.
        log.error(
          {
            request_id: requestId,
            err: err instanceof Error ? { name: err.name, message: err.message } : { message: String(err) },
          },
          'V5 draft_graph pipeline threw — returning 500 BoundaryError',
        );
        // Wire body carries only stable, typed fields. Raw exception text
        // stays in server logs (above).
        const boundaryError: BoundaryError = {
          error: 'INTERNAL_ERROR',
          boundary: 'B1',
          direction: 'egress',
          validator: 'draft_graph_pipeline',
          details: {
            retryable: true,
            reason: 'draft_graph_pipeline_threw',
            stage: ingress.value.stage,
          },
          request_id: requestId,
          retryable: true,
        };
        return reply.code(500).send(boundaryError);
      }
    }

    // ────────────────────────────────────────────────────────────────────
    // Edit_graph pre-Sonnet dispatch (v5-handler-surface brief Task 3)
    // ────────────────────────────────────────────────────────────────────
    //
    // Same reasoning as draft_graph: `edit_graph` is not in v0.7.0
    // V5ActionType, so Sonnet's validator cannot propose it. Detect
    // natural-language edits deterministically BEFORE TurnExecutor.
    //
    // Conservative trigger — false positives mutate the graph, so err
    // toward NOT dispatching. False negatives fall through to Sonnet's
    // text_only branch (WORKING per the matrix).
    //   - kind: 'message' (branched above for system events).
    //   - graph_state present (something to edit).
    //   - stage in {analyse, decide} (edit happens after drafting).
    //   - EDIT_INTENT_REGEX: positive match on edit verbs.
    //   - EDIT_GRAPH_NEGATIVE_REGEX: NO match. Explicit guards against
    //     "explain this", "compare options", "what would" — those are
    //     meta-questions that might contain an edit verb incidentally.
    const isEditGraphShape =
      extensions.value.graphState != null &&
      (ingress.value.stage === 'analyse' || ingress.value.stage === 'decide') &&
      EDIT_GRAPH_POSITIVE_REGEX.test(ingress.value.message) &&
      !EDIT_GRAPH_NEGATIVE_REGEX.test(ingress.value.message);
    if (isEditGraphShape) {
      try {
        // graphState confirmed non-null by the `isEditGraphShape` guard.
        // Pass ingress types through directly — the dispatcher owns the
        // conversion to V4 internal envelopes (see graphStateToGraphV3 and
        // analysisIngressToV2Envelope in edit-graph-dispatch.ts). No
        // `as unknown as` casts leak across this boundary.
        const eg = await dispatchEditGraph({
          payload: ingress.value,
          requestId,
          request: req,
          graphState: extensions.value.graphState!,
          analysisState: extensions.value.analysisState ?? null,
        });
        if (!eg.commitPerformed) {
          const boundaryError: BoundaryError = {
            error: 'INTERNAL_ERROR',
            boundary: 'B1',
            direction: 'egress',
            validator: 'turn_commit',
            details: {
              retryable: true,
              reason: 'edit_graph_commit_failed',
              stage: ingress.value.stage,
            },
            request_id: requestId,
            retryable: true,
          };
          return reply.code(500).send(boundaryError);
        }
        const egEgress = validateEgress(eg.response, requestId);
        if (!egEgress.ok) {
          log.error(
            { request_id: requestId },
            'V5 edit_graph dispatch egress validation failed — returning typed fallback envelope',
          );
          return reply.code(200).send(egEgress.fallback);
        }
        return reply.code(200).send(egEgress.value);
      } catch (err) {
        log.error(
          {
            request_id: requestId,
            err: err instanceof Error ? { name: err.name, message: err.message } : { message: String(err) },
          },
          'V5 edit_graph pipeline threw — returning 500 BoundaryError',
        );
        const boundaryError: BoundaryError = {
          error: 'INTERNAL_ERROR',
          boundary: 'B1',
          direction: 'egress',
          validator: 'edit_graph_pipeline',
          details: {
            retryable: true,
            reason: 'edit_graph_pipeline_threw',
            stage: ingress.value.stage,
          },
          request_id: requestId,
          retryable: true,
        };
        return reply.code(500).send(boundaryError);
      }
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

