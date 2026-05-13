/**
 * POST /orchestrate/v2/turn — V5 orchestrator endpoint.
 *
 * ─────────────────────────────────────────────────────────────────
 * HTTP status / body matrix (Group 3 Task B + P0 follow-up)
 * ─────────────────────────────────────────────────────────────────
 *
 *   422 + BoundaryError    INGRESS_CONTRACT_VIOLATION
 *                          - B1 ingress validation failed, OR
 *                          - upsert-on-append pre-flight detected that
 *                            the scenarios row exists but is owned by a
 *                            different user_id than the caller supplied
 *                            (cross-tenant attempt). A missing scenario
 *                            is NOT a 422 anymore — pre-flight INSERTs
 *                            it on-demand when user_id is present.
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
 *   1. Shared pre-flight via `runPreFlight` (see route-v2-preflight.ts):
 *        a. Extension parse (graph_state / analysis_state / user_id)
 *        b. B1 ingress (core payload)
 *        c. Upsert-on-append scenario pre-flight — idempotently creates
 *           the scenarios row from caller-supplied user_id; rejects with
 *           422 only on cross-tenant ownership mismatch. See ⚠ block on
 *           SessionStore.ensureScenarioExists for the PoC security posture.
 *      Helper returns a discriminated outcome; on failure the route emits
 *      422. Every dispatch branch below runs AFTER pre-flight has passed,
 *      enforced structurally by the helper extraction plus the file-scoped
 *      ESLint rule. See Docs/v5/route-v2-branch-audit.md.
 *
 *   2. Dispatch branch — one of:
 *        a. system_event (deterministic, no LLM)
 *        b. chip_click run_analysis (deterministic handler)
 *        c. draft_graph (pre-Sonnet pipeline)
 *        d. edit_graph (pre-Sonnet pipeline)
 *        e. TurnExecutor fallthrough (Sonnet routing)
 *
 *   3. Branch-local commit-status check (each branch owns a subtly different
 *      shape — see per-branch comments below) — BEFORE egress so the fail-
 *      closed invariant is total; a run whose output AND commit both fail
 *      takes the 500 path, not the 200-fallback path.
 *
 *   4. B1 egress validator → 200 + OlumiResponse (success OR schema-drift
 *      fallback), else 500 + BoundaryError.
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
import type { BoundaryError, OrchestratorTurnPayload } from '@talchain/schemas/boundary';

import { emit, log, TelemetryEvents } from '../utils/telemetry.js';
import { validateEgress } from '../validators/b1.js';
import { runTurnExecutor } from '../orchestrator-v5/turn-executor.js';
import { dispatchSystemEvent } from '../orchestrator-v5/system-events/dispatch.js';
import { dispatchDraftGraph } from '../orchestrator-v5/handlers/draft-graph-dispatch.js';
import { dispatchEditGraph } from '../orchestrator-v5/handlers/edit-graph-dispatch.js';
import { finaliseV5Response, isFinalisedV5Response, type FinalisedV5Response } from '../orchestrator-v5/response-finaliser.js';
import { sanitiseOlumiResponseForEgress } from '../orchestrator-v5/compose/output-safety.js';
import type { GraphV3T } from './types.js';
import { GraphV3 } from '../schemas/cee-v3.js';
import { getRequestId } from '../utils/request-id.js';
import {
  dispatchDeterministicChipClick,
  isDeterministicChipClickActionType,
} from '../orchestrator-v5/handlers/chip-click-dispatch.js';
import { DRAFT_GRAPH_MIN_BRIEF_LENGTH } from '../schemas/assist.js';
import { runPreFlight } from './route-v2-preflight.js';
import {
  GraphStateIngressSchema,
  type GraphStateIngress,
} from '../orchestrator-v5/boundary/request-extensions.js';
import { loadPersistedGraphStrict } from '../orchestrator-v5/build-turn-context.js';
import { composeDirectAnswerResponse } from '../orchestrator-v5/compose.js';
import { isValueUpdatePhrasing } from './routing/value-update-gate.js';

// ───────────────────────────────────────────────────────────────────
// Chip-click resume-intent detector
// ───────────────────────────────────────────────────────────────────
//
// Wave 5b/5d-1 chip-click parity for `what_would_flip`. Exported pure
// function so the route-boundary contract can be unit-tested directly
// without spinning up Fastify. The route handler invokes this once
// per ingress and threads the result into runTurnExecutor's
// `chipClickResumeIntent` option — see runTurnExecutor invocation
// below. A null return means the chip-click ingress is NOT one we
// special-case; TurnExecutor handles the message normally.
//
// Currently only `what_would_flip` is mapped here. The
// `run_analysis` chip-click takes its own dispatcher upstream
// (`dispatchChipClickRunAnalysis`) and never reaches this point.
// New action_types added here in the future must also gain a
// short-confirm resumer dispatch path AND a TurnExecutor synthesis
// branch — the typed flag is a no-op without those.
export function detectChipClickResumeIntent(
  ingress: OrchestratorTurnPayload,
): 'what_would_flip' | undefined {
  if (ingress.kind !== 'message') return undefined;
  if (ingress.source !== 'chip_click') return undefined;
  if (ingress.chip?.action_type !== 'what_would_flip') return undefined;
  return 'what_would_flip';
}

// ───────────────────────────────────────────────────────────────────
// Commit-failure BoundaryError helper
// ───────────────────────────────────────────────────────────────────
//
// Every 500 path in this file ends in the same wire contract: a
// BoundaryError envelope with `boundary: 'B1'`, `direction: 'egress'`,
// and `retryable` duplicated at both the top level and inside `details`
// (the former is the canonical Zod-schema field; the latter preserves
// historic UI parsing). The V5 holistic audit (UU-15) flagged six-plus
// inline constructors that drifted from each other on details-key
// ordering and extras. This helper is a pure refactor: it produces the
// same JSON shape and insertion order as the original inline objects.
//
// `preStageExtras` and `postStageExtras` preserve the two historical
// positions of per-site extras relative to `stage` inside `details`:
//   - `preStageExtras`  goes after `reason` and before `stage`
//     (used for `event_kind`, `cause_kind`, `failure_type`).
//   - `postStageExtras` goes after `stage`
//     (used for `stages_completed`).
// Sites that emit neither keep empty buckets. Key insertion order
// matters for JSON.stringify determinism — the UI parser and contract
// fixtures depend on it.

type V5ExitPath =
  | 'system_event'
  | 'chip_click'
  | 'draft_graph'
  | 'edit_graph'
  | 'turn_executor';

/**
 * V5 200-OK exit helper — the SOLE sanctioned `reply.code(200).send` site
 * in this file (per the response-finaliser contract). All five dispatch
 * families (system-event, chip-click, draft-graph, edit-graph,
 * TurnExecutor) route their 200-OK exits through here. Adding a new path
 * that calls `reply.code(200).send` directly is a contract violation
 * caught by the grep gate at scripts/check-no-direct-analysis-ready.sh.
 *
 * Behaviour:
 *   1. Finalise the candidate response — stamp `analysis_ready` (with a
 *      fresh `computed_at`) when the dispatch path supplied a payload.
 *   2. Validate the post-finalise shape against OlumiResponseSchema.
 *   3. On schema failure, finalise the egress fallback too — the
 *      validator-built fallback is a hard-coded schema-valid envelope
 *      with no `analysis_ready` field, so the user would otherwise lose
 *      readiness on egress drift. We trust the fallback to remain
 *      schema-valid after finalisation because the finaliser only adds
 *      the passthrough `analysis_ready` field; re-validating would
 *      introduce recursive-failure complexity for negligible safety gain.
 *   4. Emit `v5.response.finalised` telemetry with the actual wire shape.
 *   5. Send.
 *
 * Why finaliser BEFORE validateEgress: the schema check sees the post-
 * stamped shape, so a future schema tightening (e.g. requiring
 * computed_at to be ISO-formatted) catches drift in the finaliser itself
 * rather than letting bad timestamps through.
 */
function sendFinalised200(
  reply: import('fastify').FastifyReply<{ Reply: V5RouteReply }>,
  requestId: string,
  exitPath: V5ExitPath,
  candidate: import('@talchain/schemas/boundary').OlumiResponse,
  ctx: {
    readonly analysisReady?: import('../orchestrator-v5/compose/analysis-ready-emit.js').AnalysisReadyPayload;
    readonly graph: GraphV3T | null;
    /** V5 state-trust freshness derivation. Threaded into the finaliser
     *  so the analysisReady payload carries freshness fields and
     *  computed_at reflects the selected fact's timestamp. Populated on
     *  every CEE dispatch path that produces an analysisReady payload
     *  (turn_executor, chip_click, draft_graph, edit_graph). system_event
     *  omits today; graph-mutating system events are scoped narrowly and
     *  most do not ship the readiness field. */
    readonly freshness?: import('../orchestrator-v5/context/freshness.js').FreshnessDerivation;
  },
): import('fastify').FastifyReply<{ Reply: V5RouteReply }> {
  // Mechanism A in action — the route's `Reply: V5RouteReply` makes
  // `reply.code(200).send(<non-branded>)` a tsc error. To satisfy that,
  // `wireBody` MUST be the finaliser's output. There's a subtle wrinkle:
  // `validateEgress` runs the response through Zod's safeParse, which
  // returns a fresh object — losing the WeakSet membership and (for the
  // type-checker) the brand. So we run the validator on a finalised
  // candidate to surface schema drift, but the wire body is always a
  // FRESH finalise call against the validated value (or fallback). This
  // double-finalisation is cheap (WeakSet add + shallow spread + ISO
  // stamp) and idempotent in observable behaviour; the second computed_at
  // is sub-ms-different from the first.
  // Output safety — central egress entity-ID leak guard. Runs BEFORE
  // validateEgress so the validator sees the cleaned envelope. Also runs on
  // the post-validate value (and the fallback) so re-finalisation cannot
  // re-introduce a leak via a future validator transform. The fallback is
  // currently hard-coded clean; scrubbing it is defence-in-depth against
  // future fallback drift. See output-safety.ts for the design rationale.
  const candidateFinalised = finaliseV5Response(candidate, ctx);
  const candidateSanitised = sanitiseOlumiResponseForEgress(candidateFinalised, {
    graph: ctx.graph,
    requestId,
    exitPath,
  });
  const egress = validateEgress(candidateSanitised, requestId);
  const wireBody = egress.ok
    ? finaliseV5Response(
        sanitiseOlumiResponseForEgress(egress.value, { graph: ctx.graph, requestId, exitPath }),
        ctx,
      )
    : finaliseV5Response(
        sanitiseOlumiResponseForEgress(egress.fallback, { graph: ctx.graph, requestId, exitPath }),
        ctx,
      );
  if (!egress.ok) {
    log.error(
      { request_id: requestId, exit_path: exitPath },
      'V5 egress validation failed — returning typed fallback envelope (post-finalised)',
    );
  }
  logFinalisedResponse(requestId, exitPath, wireBody, egress.ok);
  return reply.code(200).send(wireBody);
}

/**
 * V5 finaliser-emission telemetry. Fires once per request after
 * `finaliseV5Response` runs (and after egress validation). Replaces the
 * per-turn `v5.analysis_ready.emit` log that previously lived inside
 * TurnExecutor (which had to fire pre-finalisation, before the wire
 * stamping was visible). The exit_path field tags which dispatch family
 * produced the response so the soak metric can disaggregate by path.
 *
 * This is the canonical signal for confirming the finaliser contract holds
 * across all 200-OK exits. Filter Render logs for
 * `event: 'v5.response.finalised' AND analysis_ready_emitted: false` to
 * spot any path that should be carrying readiness but isn't.
 */
function logFinalisedResponse(
  requestId: string,
  exitPath: V5ExitPath,
  finalisedResponse: unknown,
  egressOk: boolean,
): void {
  const ar = (finalisedResponse as { analysis_ready?: { status?: string; computed_at?: string } } | undefined)
    ?.analysis_ready;
  log.info(
    {
      event: 'v5.response.finalised',
      request_id: requestId,
      exit_path: exitPath,
      analysis_ready_emitted: ar != null,
      analysis_ready_status: ar?.status ?? null,
      computed_at: ar?.computed_at ?? null,
      egress_ok: egressOk,
    },
    'V5 response finalised',
  );
}

export function buildCommitFailureBoundaryError(params: {
  readonly validator: string;
  readonly reason: string;
  readonly retryable: boolean;
  readonly requestId: string;
  readonly stage: OrchestratorTurnPayload['stage'];
  readonly errorCode?: BoundaryError['error'];
  readonly preStageExtras?: Record<string, unknown>;
  readonly postStageExtras?: Record<string, unknown>;
}): BoundaryError {
  return {
    error: params.errorCode ?? 'INTERNAL_ERROR',
    boundary: 'B1',
    direction: 'egress',
    validator: params.validator,
    details: {
      retryable: params.retryable,
      reason: params.reason,
      ...(params.preStageExtras ?? {}),
      stage: params.stage,
      ...(params.postStageExtras ?? {}),
    },
    request_id: params.requestId,
    retryable: params.retryable,
  };
}

// ────────────────────────────────────────────────────────────────────
// Edit_graph typed-recovery helper (V5 Phase 2.5 Defect A Part 1)
// ────────────────────────────────────────────────────────────────────
//
// Three failure branches in the edit-intent recovery path emit the same
// wire shape: a direct_answer 200 with a fixed recovery message and a
// telemetry event tagged with the failure reason. Centralised here so
// the message text and the response shape cannot drift between branches.
//
// The wire `turn_class` is `direct_answer` (the only schema-permitted
// option for non-handler 200s — `ConversationTurnClassSchema` is strict
// and has no `'recovery'` literal). The exit_path label on
// `sendFinalised200` stays `'edit_graph'` so dashboards see these
// recoveries within the edit_graph telemetry stream rather than mixed in
// with TurnExecutor fallthroughs.

// Exported so the V5 stale-aware explain recovery shared forbidden-
// phrase test (compose/__tests__/forbidden-user-facing-phrases.test.ts)
// can pin this constant against FORBIDDEN_USER_FACING_PHRASES. The
// hardcoded recovery copy is audit-only and currently lives outside
// the per-dispatch egress hook surface; the follow-up route-level
// chokepoint workstream will add dynamic guarding. Until then, the
// shared test is the contract that this string contains no
// forbidden phrase.
export const EDIT_GRAPH_RECOVERY_TEXT =
  "I can see you want to update the model, but I couldn't access the current graph. Please try again in a moment.";

type EditGraphRecoveryReason =
  | 'no_persisted_graph'
  | 'persisted_graph_invalid'
  | 'session_store_failed';

function sendEditGraphRecovery(
  reply: import('fastify').FastifyReply<{ Reply: V5RouteReply }>,
  requestId: string,
  scenarioId: string,
  stage: import('@talchain/schemas/boundary').StageType,
  reason: EditGraphRecoveryReason,
): import('fastify').FastifyReply<{ Reply: V5RouteReply }> {
  emit(TelemetryEvents.V5EditGraphGraphStateUnavailable, {
    request_id: requestId,
    scenario_id: scenarioId,
    reason,
  });
  return sendFinalised200(reply, requestId, 'edit_graph', composeDirectAnswerResponse({
    assistant_text: EDIT_GRAPH_RECOVERY_TEXT,
    stage,
  }), { graph: null });
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
 * these phrases it is a meta-question or conversational/figurative use of
 * an edit verb, NOT an edit command, and must NOT dispatch even if a
 * positive edit-verb also appears. Mutating the graph on a meta-question
 * is the worst failure mode.
 *
 * Pattern groups:
 *   1. Meta-question markers: "explain", "compare", "what would", "flip",
 *      "why", "how does", "tell me", "show me", "describe".
 *   2. Phrasal verbs that turn an edit verb into a non-mutation: "set up",
 *      "set aside" (procedural framing / deprioritisation, not delete).
 *   3. Figurative / idiomatic uses of edit verbs: "add context",
 *      "remove doubt", "change my mind", "reduce complexity",
 *      "delete this thread", "update our approach", "modify thinking".
 *      These were exposed when the frame-stage gate was removed —
 *      conversational discourse at frame stage previously fell through
 *      to Sonnet only because the stage gate blocked dispatch entirely.
 */
const EDIT_GRAPH_NEGATIVE_REGEX =
  /\b(?:explain|compare|what would|flip|why|how does|tell me|show me|describe|set up|set aside|add (?:some |any |more )?(?:context|information|detail|details|background)|remove (?:any |the )?(?:doubt|confusion|uncertainty|ambiguity)|change (?:my |our |their )?mind|reduce (?:complexity|scope|noise|clutter)|delete (?:this |the )?(?:thread|conversation|chat|message)|update (?:my |our |their |the )?(?:approach|thinking|understanding|view|perspective)|modify (?:my |our |their )?(?:view|mind|thinking|approach))\b/i;

// Value-update negative gate (P0 fix, 2026-05) lives in
// `src/orchestrator/routing/value-update-gate.ts` as a dedicated module
// with named subpatterns and table-driven keyword arrays. It is
// table-driven so future edits are localised, and is wired here via
// `isValueUpdatePhrasing` below.

/**
 * V5 status-keyed Reply contract — the type-system half of the response
 * finaliser's defence in depth (mechanism A in
 * src/orchestrator-v5/response-finaliser.ts).
 *
 * Fastify 5 supports status-code-keyed Reply types via
 * `ReplyKeysToCodes<keyof RouteGeneric['Reply']>` and
 * `ResolveReplyTypeWithRouteGeneric`. Declaring the route with this shape
 * makes the type-checker enforce status↔body pairing at every send site:
 *
 *   - `reply.code(200).send(raw)`           — type error: raw is not branded
 *   - `reply.code(200).send(boundaryError)` — type error: 200 wants brand
 *   - `reply.code(500).send(brand)`         — type error: 500 wants BoundaryError
 *   - `reply.code(500).send(boundaryError)` — OK
 *   - `reply.send(raw)` (default 200)       — type error: 200 wants brand
 *
 * The pre-flight 422 path uses `pre.status` which is typed as the
 * pre-flight failure status. The `400 | 422 | 500: BoundaryError` mapping
 * covers every possible pre-status output (per buildBoundaryError /
 * runPreFlight definitions).
 */
export type V5RouteReply = {
  200: FinalisedV5Response;
  400: BoundaryError;
  422: BoundaryError;
  500: BoundaryError;
};

/**
 * Mechanism B body (runtime defence in depth): preSerialization hook that
 * asserts every 200-OK response body on the V5 route has been processed
 * by `finaliseV5Response` (WeakSet membership). Catches any cast that
 * evaded the type-system enforcement of mechanism A. On detection, logs
 * a violation event and substitutes the egress-violation fallback so the
 * wire response stays product-safe; production observability fires.
 *
 * Extracted as a named function (rather than inline in the hook
 * registration) so it can be unit-tested directly without spinning up a
 * Fastify instance. See response-finaliser-hook.test.ts.
 */
export const v5FinaliserPreSerializationHook = async (
  request: import('fastify').FastifyRequest,
  reply: import('fastify').FastifyReply,
  payload: unknown,
): Promise<unknown> => {
  if (request.routeOptions.url !== '/orchestrate/v2/turn') return payload;
  if (reply.statusCode !== 200) return payload;
  if (isFinalisedV5Response(payload)) return payload;
  log.error(
    {
      event: 'v5.finaliser.bypass_detected',
      request_id: getRequestId(request),
      route: request.routeOptions.url,
      status: reply.statusCode,
    },
    'V5 200-OK response bypassed finaliser — substituting egress-violation fallback',
  );
  // Fail safe: substitute a typed fallback rather than ship the bypassing
  // body. The fallback envelope is hard-coded schema-valid; no readiness
  // is set (the bypass means we don't know what readiness should be).
  return {
    response_version: 2,
    assistant_text: 'The server produced a response that failed validation.',
    blocks: [
      { type: 'error', error_code: 'EGRESS_CONTRACT_VIOLATION', severity: 'error' },
    ],
    suggested_actions: [],
    insights: [],
    stage_indicator: 'frame',
  };
};

export async function ceeOrchestratorRouteV2(app: FastifyInstance): Promise<void> {
  // Scoped to `/orchestrate/v2/turn` only via the URL check inside the
  // hook function — global registration is simpler than route-scoped
  // and the cost (one URL comparison per non-V5 send) is negligible.
  app.addHook('preSerialization', v5FinaliserPreSerializationHook);

  app.post<{ Reply: V5RouteReply }>('/orchestrate/v2/turn', async (req, reply) => {
    // Shared pre-flight: extension parse → B1 ingress → scenario upsert.
    // Every dispatch branch in this handler runs AFTER this call. The
    // helper is the only site that may invoke those three primitives in
    // this file; a file-scoped ESLint rule (see eslint.config.js) enforces
    // that new branches cannot reintroduce them directly. See
    // Docs/v5/route-v2-branch-audit.md for the rationale and audit.
    const pre = await runPreFlight(req);
    if (!pre.ok) {
      // 4xx: pre-flight failure — request never reached dispatch, no graph
      // state to compute readiness from; no analysis_ready stamped.
      return reply.code(pre.status).send(pre.error);
    }
    const { requestId, ingress, extensions } = pre.context;

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
    if (ingress.kind === 'system_event') {
      const sysResult = await dispatchSystemEvent({
        payload: ingress,
        requestId,
      });
      if (!sysResult.commitPerformed && sysResult.commitSkippedReason !== 'client_only_event') {
        const boundaryError: BoundaryError = buildCommitFailureBoundaryError({
          validator: 'turn_commit',
          reason: 'system_event_commit_failed',
          retryable: true,
          requestId,
          stage: ingress.stage,
          preStageExtras: { event_kind: ingress.event.kind },
        });
        log.error(
          {
            request_id: requestId,
            event_kind: ingress.event.kind,
          },
          'V5 system event commit failed — returning 500 with BoundaryError envelope',
        );
        // 500: infrastructure failure — no analysis_ready stamped (UI retains prior store value)
        return reply.code(500).send(boundaryError);
      }
      return sendFinalised200(reply, requestId, 'system_event', sysResult.response, {
        analysisReady: sysResult.analysisReady,
        graph: sysResult.graph,
      });
    }

    // ────────────────────────────────────────────────────────────────────
    // Chip-click deterministic dispatch (Phase 2b: v5-handler-surface brief
    // Task 4 + chip-click router bypass workstream)
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
    // Scope: source='chip_click' + chip.action_type ∈ whitelist
    // (`DETERMINISTIC_CHIP_ACTION_TYPES` in chip-click-dispatch.ts). Each
    // entry must be a registered V5 handler ID that can produce a useful
    // answer without ORIENT context (validated per-handler before
    // inclusion). source='chip' (inline chip metadata on a normal message)
    // falls through to TurnExecutor. Other chip action types — including
    // mutation handlers (set_factor_value, etc.) that need validated
    // proposal parameters — fall through to TurnExecutor which routes via
    // Sonnet ORIENT or returns a typed FEATURE_NOT_ENABLED via the
    // existing UNSUPPORTED_ACTION path.
    const chipActionType = ingress.chip?.action_type;
    const isDeterministicChipClick =
      ingress.source === 'chip_click' &&
      chipActionType !== undefined &&
      isDeterministicChipClickActionType(chipActionType);
    if (isDeterministicChipClick && chipActionType) {
      try {
        const cc = await dispatchDeterministicChipClick(chipActionType, {
          payload: ingress,
          requestId,
        });
        // Discriminated outcome — each case maps to a distinct wire
        // response. Parallels TurnExecutor's catch ladder so chip-click
        // errors surface with the same typed granularity.
        if (cc.outcome === 'handler_failure') {
          const boundaryError: BoundaryError = buildCommitFailureBoundaryError({
            validator: 'chip_click_dispatch',
            reason: `chip_click_${chipActionType}_handler_failed`,
            retryable: cc.retryable,
            requestId,
            stage: ingress.stage,
            preStageExtras: { cause_kind: cc.causeKind, action_type: chipActionType },
          });
          // 500: infrastructure failure — no analysis_ready stamped (UI retains prior store value)
          return reply.code(500).send(boundaryError);
        }
        if (cc.outcome === 'handler_result_invalid') {
          const boundaryError: BoundaryError = buildCommitFailureBoundaryError({
            validator: 'chip_click_dispatch',
            reason: `chip_click_${chipActionType}_handler_result_invalid`,
            retryable: false,
            requestId,
            stage: ingress.stage,
            preStageExtras: { action_type: chipActionType },
          });
          // 500: infrastructure failure — no analysis_ready stamped (UI retains prior store value)
          return reply.code(500).send(boundaryError);
        }
        if (cc.outcome === 'commit_failed') {
          const boundaryError: BoundaryError = buildCommitFailureBoundaryError({
            validator: 'turn_commit',
            reason: `chip_click_${chipActionType}_commit_failed`,
            retryable: true,
            requestId,
            stage: ingress.stage,
            preStageExtras: { action_type: chipActionType },
          });
          // 500: infrastructure failure — no analysis_ready stamped (UI retains prior store value)
          return reply.code(500).send(boundaryError);
        }
        // outcome === 'ok'
        return sendFinalised200(reply, requestId, 'chip_click', cc.response, {
          analysisReady: cc.analysisReady,
          graph: cc.graph,
          ...(cc.freshness ? { freshness: cc.freshness } : {}),
        });
      } catch (err) {
        log.error(
          {
            request_id: requestId,
            action_type: chipActionType,
            err: err instanceof Error ? { name: err.name, message: err.message } : { message: String(err) },
          },
          'V5 chip_click deterministic dispatch threw — returning 500 BoundaryError',
        );
        const boundaryError: BoundaryError = buildCommitFailureBoundaryError({
          validator: 'chip_click_dispatch',
          reason: `chip_click_${chipActionType}_handler_threw`,
          retryable: true,
          requestId,
          stage: ingress.stage,
          preStageExtras: { action_type: chipActionType },
        });
        // 500: infrastructure failure — no analysis_ready stamped (UI retains prior store value)
        return reply.code(500).send(boundaryError);
      }
    }

    // ────────────────────────────────────────────────────────────────────
    // Chip-click parity for `what_would_flip`
    // ────────────────────────────────────────────────────────────────────
    //
    // Brief contract: clicking the "Explore what would change this" chip
    // must produce the same outcome as typing "yes" in the same context.
    // Wave 1's derive-pending-actions persists a what_would_flip pending
    // action whenever the chip is emitted; the deterministic short-
    // confirm pre-route inside TurnExecutor reads the most-recent-
    // pending-actions and resumes deterministically.
    //
    // We thread the chip-click intent into TurnExecutor as a typed
    // option (`chipClickResumeIntent`) rather than rewriting the user-
    // visible message. A bare message rewrite to "yes" loses the
    // chip's semantic label: if the pending action is missing or
    // expired, the resumer would fall through to the LLM with a bare
    // "yes" and the LLM has no idea what the user meant. The typed
    // flag lets TurnExecutor route a no-pending chip click to the
    // rerun-analysis-required recovery instead of bare-yes-LLM-
    // passthrough.
    //
    // STALE-COMMENT FIX (Phase 2b round-2): the prior comment here said
    // "No new dispatcher: the run_analysis chip-click takes a separate
    // shortcut … what_would_flip is a no-op explanation handler so
    // TurnExecutor's existing short-confirm path covers it." That is no
    // longer accurate. As of Phase 2b, `what_would_flip` (and
    // `explain_results`) ARE in the deterministic-chip-click whitelist
    // (`DETERMINISTIC_CHIP_ACTION_TYPES`) and route via
    // `dispatchDeterministicChipClick` upstream of this resume-intent
    // detection. The `chipClickResumeIntent` path below now applies
    // only to short-confirm "yes" resumptions of pending actions —
    // chip clicks themselves no longer reach this point for whitelisted
    // action_types.
    const chipClickResumeIntent = detectChipClickResumeIntent(ingress);

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
      ingress.stage === 'frame' &&
      extensions.graphState == null &&
      ingress.message.length >= DRAFT_GRAPH_MIN_BRIEF_LENGTH &&
      DRAFT_GRAPH_DECISION_BRIEF_REGEX.test(ingress.message);
    if (isDraftGraphShape) {
      // V4 cordon: dispatchDraftGraph delegates to the V4 graph-synthesis
      // pipeline. V5 has no deterministic draft_graph handler yet. See
      // Docs/v5/v5-cordon.md §1 for trigger conditions and replacement plan.
      try {
        const dg = await dispatchDraftGraph({
          payload: ingress,
          requestId,
          request: req,
        });
        if (!dg.commitPerformed) {
          const boundaryError: BoundaryError = buildCommitFailureBoundaryError({
            validator: 'turn_commit',
            reason: 'draft_graph_commit_failed',
            retryable: true,
            requestId,
            stage: ingress.stage,
          });
          // 500: infrastructure failure — no analysis_ready stamped (UI retains prior store value)
          return reply.code(500).send(boundaryError);
        }
        return sendFinalised200(reply, requestId, 'draft_graph', dg.response, {
          analysisReady: dg.analysisReady,
          graph: dg.graph,
          ...(dg.freshness ? { freshness: dg.freshness } : {}),
        });
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
        const boundaryError: BoundaryError = buildCommitFailureBoundaryError({
          validator: 'draft_graph_pipeline',
          reason: 'draft_graph_pipeline_threw',
          retryable: true,
          requestId,
          stage: ingress.stage,
        });
        // 500: infrastructure failure — no analysis_ready stamped (UI retains prior store value)
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
    //   - graph_state present (something to edit). The presence of a
    //     graph is the load-bearing precondition, not the stage.
    //   - EDIT_INTENT_REGEX: positive match on edit verbs.
    //   - EDIT_GRAPH_NEGATIVE_REGEX: NO match. Explicit guards against
    //     "explain this", "compare options", "what would" — those are
    //     meta-questions that might contain an edit verb incidentally.
    //
    // The stage check was removed — stages continue to influence
    // Sonnet's coaching tone via `stage_indicator` and the context
    // pack, but they no longer block deterministic edit dispatch when
    // a graph is already present.
    //
    // ────────────────────────────────────────────────────────────────────
    // V5 Phase 2.5 Defect A — edit-intent recovery on missing graphState.
    // ────────────────────────────────────────────────────────────────────
    //
    // Pre-correction: when the regex matched but `extensions.graphState`
    // was null (e.g. the UI did not echo graph_state on this turn even
    // though a draft existed in `scenarios.graph`), `isEditGraphShape`
    // evaluated to false and the turn fell through to TurnExecutor.
    // Sonnet's L1 enum has no `edit_graph`, so the turn was routed to
    // `explain_from_structure` and the user's mutation intent was lost
    // silently. This violated the routing-contract invariant:
    //
    //     "When edit intent is detected, the turn must end in mutation
    //      committed, clarification requested, or typed recovery —
    //      never explain_from_structure or unflagged direct_answer."
    //
    // The block below restores that invariant for the missing-graphState
    // failure mode. It does NOT close the referential-resolution gap
    // ("let's add this" vs. "add opportunity cost as a risk"); that is
    // Part 2 of the fix and lives in the context pack assembler.
    //
    // Local resolution variable: we never mutate `extensions.graphState`
    // because later route branches (TurnExecutor fallthrough) read the
    // same object; mutating it would create cross-branch side effects.
    //
    // The recovery message is centralised in `EDIT_GRAPH_RECOVERY_TEXT`
    // and threaded through `composeDirectAnswerResponse` so all three
    // failure branches emit identical wire shape. The wire `turn_class`
    // is `direct_answer` (no `'recovery'` literal exists in
    // ConversationTurnClassSchema; introducing one would break ingress
    // validation across the boundary).
    const editIntentDetected =
      EDIT_GRAPH_POSITIVE_REGEX.test(ingress.message) &&
      !EDIT_GRAPH_NEGATIVE_REGEX.test(ingress.message) &&
      // P0 fix (2026-05): suppress dispatch when the message is a clear
      // value/factor update (`set X to Y`, `increase X by N`, etc.). These
      // belong on the deterministic D1 / Sonnet tool-use path, not the
      // fragile edit_graph LLM JSON path. The narrow gate is documented at
      // src/orchestrator/routing/value-update-gate.ts (preserves
      // structural edits like "update the model to include market
      // dynamics", kind changes like "set goal to be a factor", and A4
      // requests like "Add team dynamics as a risk").
      !isValueUpdatePhrasing(ingress.message);
    let resolvedGraphState: GraphStateIngress | null = null;
    if (editIntentDetected) {
      if (extensions.graphState != null) {
        emit(TelemetryEvents.V5EditGraphGraphStatePresent, {
          request_id: requestId,
          scenario_id: ingress.scenario_id,
        });
      } else {
        // Edit intent detected but graphState absent on the request.
        // Attempt reload from `scenarios.graph` rather than silently
        // falling through to Sonnet (which cannot propose edit_graph).
        let persisted: unknown = null;
        try {
          // `loadPersistedGraphStrict` (vs the swallowing
          // `loadPersistedGraph`) lets the catch below distinguish
          // `session_store_failed` from `no_persisted_graph` for
          // telemetry. Both export from build-turn-context.ts so the
          // `getSessionStore` import surface stays bounded to the
          // three sites the state-write-invariant check allows.
          persisted = await loadPersistedGraphStrict(ingress.scenario_id);
        } catch (err) {
          // Session-store / Supabase failure. Distinct from
          // "no_persisted_graph" so dashboards can separate
          // infrastructure issues from a genuine empty-state.
          log.error(
            {
              request_id: requestId,
              scenario_id: ingress.scenario_id,
              err: err instanceof Error ? { name: err.name, message: err.message } : { message: String(err) },
            },
            'V5 edit_graph graphState reload failed — returning typed recovery',
          );
          return sendEditGraphRecovery(reply, requestId, ingress.scenario_id, ingress.stage, 'session_store_failed');
        }
        if (persisted == null) {
          return sendEditGraphRecovery(reply, requestId, ingress.scenario_id, ingress.stage, 'no_persisted_graph');
        }
        // Validate the reloaded graph through the same ingress schema the
        // request body would have gone through. A persisted-but-invalid
        // shape is a different operational signal than absence — write a
        // distinct telemetry reason so it can be alerted on.
        const parsed = GraphStateIngressSchema.safeParse(persisted);
        if (!parsed.success) {
          log.error(
            {
              request_id: requestId,
              scenario_id: ingress.scenario_id,
              issue_count: parsed.error.issues.length,
            },
            'V5 edit_graph reloaded graph failed ingress validation — returning typed recovery',
          );
          return sendEditGraphRecovery(reply, requestId, ingress.scenario_id, ingress.stage, 'persisted_graph_invalid');
        }
        resolvedGraphState = parsed.data;
        emit(TelemetryEvents.V5EditGraphGraphStateReloaded, {
          request_id: requestId,
          scenario_id: ingress.scenario_id,
        });
      }
    }
    const effectiveGraphState = resolvedGraphState ?? extensions.graphState;
    const isEditGraphShape = effectiveGraphState != null && editIntentDetected;
    if (isEditGraphShape) {
      // V4 cordon: dispatchEditGraph delegates to the V4 graph-edit pipeline
      // for free-form edit intents that do not match a typed V5 mutation
      // handler (set_factor_value, add_constraint, adjust_edge_strength).
      // See Docs/v5/v5-cordon.md §2 for trigger conditions and replacement
      // plan (per-mutation handlers + Workstream 2 apply_proposed_change).
      try {
        // graphState confirmed non-null by the `isEditGraphShape` guard.
        // Pass ingress types through directly — the dispatcher owns the
        // conversion to V4 internal envelopes (see graphStateToGraphV3 and
        // analysisIngressToV2Envelope in edit-graph-dispatch.ts). No
        // `as unknown as` casts leak across this boundary.
        const eg = await dispatchEditGraph({
          payload: ingress,
          requestId,
          request: req,
          graphState: effectiveGraphState!,
          analysisState: extensions.analysisState ?? null,
        });
        if (!eg.commitPerformed) {
          const boundaryError: BoundaryError = buildCommitFailureBoundaryError({
            validator: 'turn_commit',
            reason: 'edit_graph_commit_failed',
            retryable: true,
            requestId,
            stage: ingress.stage,
          });
          // 500: infrastructure failure — no analysis_ready stamped (UI retains prior store value)
          return reply.code(500).send(boundaryError);
        }
        return sendFinalised200(reply, requestId, 'edit_graph', eg.response, {
          analysisReady: eg.analysisReady,
          graph: eg.graph,
          ...(eg.freshness ? { freshness: eg.freshness } : {}),
        });
      } catch (err) {
        log.error(
          {
            request_id: requestId,
            err: err instanceof Error ? { name: err.name, message: err.message } : { message: String(err) },
          },
          'V5 edit_graph pipeline threw — returning 500 BoundaryError',
        );
        const boundaryError: BoundaryError = buildCommitFailureBoundaryError({
          validator: 'edit_graph_pipeline',
          reason: 'edit_graph_pipeline_threw',
          retryable: true,
          requestId,
          stage: ingress.stage,
        });
        // 500: infrastructure failure — no analysis_ready stamped (UI retains prior store value)
        return reply.code(500).send(boundaryError);
      }
    }

    // TurnExecutor returns a well-formed OlumiResponse envelope on every
    // path (success, typed error block, or commit failure). The HTTP
    // status on the wire is decided here by the route, NOT by the
    // TurnExecutor — see the status/body matrix in the file header. The
    // executor never throws past this boundary.
    const run = await runTurnExecutor(ingress, requestId, {
      graphState: extensions.graphState,
      analysisState: extensions.analysisState,
      selectedElements: extensions.selectedElements,
      ...(chipClickResumeIntent
        ? { chipClickResumeIntent }
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
      // failure_type is either a BoundaryErrorCode enum member or null
      // (for successful turns — unreachable here because commit_performed
      // is false). Fall back to INTERNAL_ERROR if null to keep the wire
      // shape honest.
      //
      // Note: `stage` aids client-side triage — a commit failure in
      // `analyse` stage vs `frame` stage has different user implications
      // ("the analysis ran but didn't save" vs "we couldn't frame the
      // decision"). `stages_completed` is positioned *after* stage inside
      // details, preserving the pre-refactor insertion order.
      const boundaryError: BoundaryError = buildCommitFailureBoundaryError({
        validator: 'turn_commit',
        reason: 'state_commit_failed_or_turn_runtime_failure',
        retryable,
        requestId,
        stage: ingress.stage,
        errorCode: failureType ?? 'INTERNAL_ERROR',
        preStageExtras: { failure_type: failureType },
        postStageExtras: { stages_completed: run.telemetry.stages_completed },
      });
      log.error(
        {
          request_id: requestId,
          failure_type: failureType,
          stages_completed: run.telemetry.stages_completed,
        },
        'V5 turn completed without commit — returning 500 with BoundaryError envelope',
      );
      // 500: infrastructure failure — no analysis_ready stamped (UI retains prior store value)
      return reply.code(500).send(boundaryError);
    }

    // Safe-parse the ingress graphState into a strict GraphV3T for the
    // egress sanitiser's label resolution. Parse failure (or absent
    // graphState) → null; the sanitiser falls back to prefix-aware
    // generic wording without throwing.
    const turnGraph: GraphV3T | null = extensions.graphState
      ? (() => {
          const parsed = GraphV3.safeParse(extensions.graphState);
          return parsed.success ? parsed.data : null;
        })()
      : null;
    return sendFinalised200(reply, requestId, 'turn_executor', run.response, {
      analysisReady: run.analysisReady,
      graph: turnGraph,
      ...(run.freshness ? { freshness: run.freshness } : {}),
    });
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

