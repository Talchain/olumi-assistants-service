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
import { config } from '../config/index.js';
import { debugFieldRequested, type OlumiResponseWithDebugFields } from './debug-fields.js';
import type { TurnTimingsBlock, V5TurnTimings } from '../orchestrator-v5/telemetry/turn-timings.js';
import type { V5DiagnosticTrace } from '../orchestrator-v5/diagnostics/v5-diagnostic-trace.js';
import { buildMinimalV5DiagnosticTrace } from '../orchestrator-v5/diagnostics/v5-diagnostic-trace.js';
import {
  canonicalStateFromFreshness,
  type CanonicalAnalysisState,
} from '../orchestrator-v5/context/canonical-analysis-state.js';
import {
  buildV5ContextSummary,
  summariseGraphCounts,
  type V5ContextSummary,
} from '../orchestrator-v5/context/build-context-summary.js';
// T4 Slice 2 — frame-first context-summary projection (the first live frame
// consumer). When the turn-executor threads the canonical frame, the summary
// is projected from the FRAME ALONE (no per-part re-assembly at this seam).
import { contextSummaryFromFrame } from '../orchestrator-v5/context/context-summary-from-frame.js';
import type { CanonicalContextFrame } from '../orchestrator-v5/context/frame/index.js';
import { computeResponseHash } from '../utils/response-hash.js';
import { validateEgress } from '../validators/b1.js';
import { runTurnExecutor } from '../orchestrator-v5/turn-executor.js';
import { dispatchSystemEvent } from '../orchestrator-v5/system-events/dispatch.js';
import { dispatchDraftGraph } from '../orchestrator-v5/handlers/draft-graph-dispatch.js';
import { dispatchEditGraph } from '../orchestrator-v5/handlers/edit-graph-dispatch.js';
import { finaliseV5Response, isFinalisedV5Response, type FinalisedV5Response } from '../orchestrator-v5/response-finaliser.js';
import { sanitiseOlumiResponseForEgress } from '../orchestrator-v5/compose/output-safety.js';
import { deriveAnswerTextFromShape } from '../orchestrator-v5/routing/answer-shape.js';
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
import {
  loadHasPriorTurns,
  loadMostRecentPendingActionsStrict,
  loadPersistedGraphStrict,
} from '../orchestrator-v5/build-turn-context.js';
import { composeDirectAnswerResponse } from '../orchestrator-v5/compose.js';
import { composeEditClarifyResponse } from '../orchestrator-v5/compose/edit-clarify-response.js';
import { computeAnalysisAffectingGraphHash } from '../orchestrator-v5/context/graph-hash.js';
import type { PendingAction } from '../orchestrator-v5/session/pending-action.js';
import { isPendingActionExpired } from '../orchestrator-v5/session/pending-action.js';
import { isAnalyticalQuestion } from '../orchestrator-v5/routing/analytical-question-guard.js';
import {
  PROPOSAL_CONFIRM_PATTERN,
  SHORT_CONFIRM_PATTERN,
} from '../orchestrator-v5/routing/deterministic-short-confirm.js';
import { findExactProposalCopyMatchIndexes } from '../orchestrator-v5/routing/proposal-ordinal-select.js';
import { resolveProposalRenderCopy } from '../orchestrator-v5/compose/proposed-change.js';
import { isStateQueryQuestionShape } from '../orchestrator-v5/routing/state-query-guard.js';
import { classifyAnalyticalIntent } from '../orchestrator-v5/routing/analytical-intent.js';
import { tryChipSimplifyIntercept } from '../orchestrator-v5/routing/chip-simplify-intercept.js';
import {
  composePostAnalysisLabelInterceptResponse,
  tryPostAnalysisLabelIntercept,
} from '../orchestrator-v5/routing/post-analysis-label-intercept.js';
import { tryVagueEditGuard } from '../orchestrator-v5/routing/vague-edit-guard.js';
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
  | 'frame_no_brief_guard'
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
    /**
     * V5 diagnostic trace (additive observability). Threaded in by paths
     * that build the trace out-of-band on the dispatch result
     * (draft_graph). For paths that attach the trace on the candidate
     * response body (turn_executor, edit_graph, chip_click, system_event),
     * leave this undefined — the strip step below will lift the trace off
     * the body. Either source path lands in the same re-attach gate.
     *
     * When set AND `config.features.diagnosticTraceEnabled` is true, the
     * trace is stripped before egress validation (so the strict
     * `OlumiResponseSchema` never sees it), then re-attached on the
     * wire body after validation passes. `finalisation_ms` and
     * `response_hash` are stamped during re-attach.
     */
    readonly diagnosticTrace?: V5DiagnosticTrace;
    /**
     * V5 diagnostic trace (additive observability) — minimal-trace
     * fallback. When the dispatch path did NOT provide its own full
     * trace (no `ctx.diagnosticTrace`, no body-attached
     * `_diagnostic_trace`) AND `requestStartedAt` is set AND the flag is
     * on, `sendFinalised200` builds a minimal trace inline from
     * `requestStartedAt` + `scenarioId` + `turnId` + the optional graph.
     * This covers edit_graph / chip_click / system_event without needing
     * to touch their dispatch handlers (avoids overlap with P0 work in
     * those files).
     */
    readonly requestStartedAt?: number;
    readonly scenarioId?: string;
    readonly turnId?: string;
    /**
     * V5 copy-source delivery diagnostics (Scope C, additive). Threaded in by
     * the turn_executor path from `run.coachingDelivery` when the deterministic
     * post-analysis advice gate produced the response. Folded into the
     * flag-gated minimal diagnostic trace below; never reaches the wire body
     * outside the trace.
     */
    readonly coachingDelivery?: import('../orchestrator-v5/diagnostics/v5-diagnostic-trace.js').V5CoachingDelivery;
    /**
     * V5 per-stage turn timings threaded by the turn_executor path from
     * `run.turnTimings`. Folded into the flag-gated minimal diagnostic trace
     * below so `_diagnostic_trace.llm_calls` carries the turn's REAL routing
     * call (model, tokens, wall-clock) instead of the empty array the minimal
     * builder emitted when this input was omitted. Undefined for paths that do
     * not capture per-stage timings; the builder then emits an empty
     * `llm_calls[]` honestly. Never reaches the wire body outside the trace.
     */
    readonly turnTimings?: V5TurnTimings;
    /**
     * V5 canonical analysis state for the redacted `_context_summary`
     * surface. When a dispatch path threads the FULL verdict (with degraded
     * detection — M5, turn-executor), it is used verbatim. Otherwise the
     * route composes a partial state from `freshness` + `analysisReady` via
     * `canonicalStateFromFreshness`. Only consumed when
     * `config.cee.contextSummaryEnabled` is set; never reaches the wire
     * body outside the gated `_context_summary` block.
     */
    readonly canonicalState?: CanonicalAnalysisState;
    /**
     * T4 Slice 2 — the turn-executor's once-per-turn canonical context frame.
     * When present, the flag-gated context-summary diagnostic is projected
     * from the frame ALONE (`contextSummaryFromFrame`) instead of being
     * re-assembled from parts at this seam. Absent ⇒ the pre-frame paths
     * below apply unchanged. Never reaches the wire itself.
     *
     * INVARIANT: a caller that threads `frame` MUST also thread the
     * `canonicalState` the frame wrapped (the executor's finalise seam
     * guarantees this pairing). Frame-without-canonicalState would silently
     * omit the `coaching_state_pack` sub-block on the frame path — a
     * fail-closed diagnostic drop, but a divergence from the pre-frame
     * behaviour; do not introduce such a caller.
     */
    readonly frame?: CanonicalContextFrame;
    /**
     * ROADMAP 1.42 — VERBATIM Sonnet-5 extended-thinking reasoning, threaded
     * from `run.reasoning` (turn-executor). Populated only when
     * `config.features.reasoningCaptureEnabled` (env
     * `CEE_REASONING_CAPTURE_ENABLED=true`) is set AND the model emitted
     * thinking blocks. Attached to the wire body as `_reasoning` AFTER
     * egress validation — same re-attach mechanic as `_context_summary` /
     * `_diagnostic_trace` — and NEVER on the fallback envelope. Paul ruling
     * (ROADMAP 1.42): VERBATIM reasoning bypasses the egress claim-safety /
     * forbidden-phrase cage by design; containment is flag-default-off +
     * collapsed-default UI + explicit label, not a wire-level scrub.
     */
    readonly reasoning?: string;
    /**
     * ROADMAP 1.132 (F2) — validated coach/converse answer shape, threaded
     * from `run.answerShape` (turn-executor; fail-closed capture — only
     * present when the final assistant_text IS the shape-derived text).
     * Attached to the wire body as `_answer_shape` AFTER egress validation
     * when `config.features.answerShapeEnforced` is set — same re-attach
     * mechanic as `_reasoning` — and NEVER on the fallback envelope.
     */
    readonly answerShape?: import('../orchestrator-v5/routing/answer-shape.js').AnswerShape;
    /**
     * The user's message for THIS turn, verbatim, or `null` when the turn
     * carries none (system events). Threaded to the egress sanitiser's
     * looping-chip guard, which drops any pure-text-replay chip that would
     * re-submit this exact message — the no-dead-end invariant (see
     * `orchestrator-v5/compose/looping-chip-guard.ts`).
     *
     * REQUIRED, deliberately: every dispatch path that can emit chips must
     * state what the user said, so no path can opt out of the guard by
     * omission. `null` is the honest value when there is no user message.
     */
    readonly userMessage: string | null;
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
  // Capture wall-clock for the finalisation substage. Stamped on the
  // diagnostic trace at the very bottom of this function (after re-
  // attach) so the trace records the actual time spent in finalisation +
  // egress validation + re-attach + send. Flag-off cost is one
  // `Date.now()` call — the value is discarded if no trace is built.
  const finaliseStart = Date.now();
  const candidateFinalised = finaliseV5Response(candidate, ctx);
  // Fix 4 (observability) + V5 diagnostic trace (Phase A): pluck out the
  // optional `_timings` and `_diagnostic_trace` blocks before egress
  // validation. OlumiResponseSchema is `.strict()` — unknown keys would
  // fail safeParse and trigger the typed-fallback path. We strip
  // unconditionally (defence-in-depth: a stale upstream attach must not
  // leak past this seam), validate the cleaned shape, then re-attach
  // each surface under its own gate model:
  //   - `_timings` re-attaches when BOTH `config.cee.timingDebugEnabled`
  //     AND the per-request `X-Olumi-Debug: timings` header pass (two-
  //     gate, post-PR-181 contract).
  //   - `_diagnostic_trace` re-attaches when `config.features.
  //     diagnosticTraceEnabled` passes (flag-only Phase A — see
  //     plan file for rationale). When the dispatch path provided
  //     `ctx.diagnosticTrace`, that wins over any body-attached trace
  //     (out-of-band threading from draft_graph dispatch supersedes the
  //     body-attached convention used by other paths).
  // The route is the last guard — upstream callers cannot bypass either
  // gate by attaching the field themselves.
  const stripped = ((): {
    timings: unknown;
    diagnosticTrace: unknown;
    body: import('@talchain/schemas/boundary').OlumiResponse;
  } => {
    const asRecord = candidateFinalised as Record<string, unknown>;
    const hasTimings = '_timings' in asRecord;
    const hasTrace = '_diagnostic_trace' in asRecord;
    // `_context_summary` is always built fresh from `ctx` at the re-attach
    // gate below — never read off the body. We still strip any body-attached
    // copy (defence-in-depth: the route's flag gate is the sole authority,
    // and the strict OlumiResponseSchema must not see an unknown key).
    const hasContextSummary = '_context_summary' in asRecord;
    // ROADMAP 1.42 — `_reasoning` is threaded via `ctx`, never body-attached
    // by any dispatch path today. Stripped defensively anyway (same
    // defence-in-depth posture as `_context_summary`): the route's flag
    // gate at the re-attach block below is the sole authority, and the
    // strict `OlumiResponseSchema` must not see an unknown key.
    const hasReasoning = '_reasoning' in asRecord;
    // ROADMAP 1.132 — `_answer_shape` is threaded via `ctx`, never
    // body-attached by any dispatch path today. Stripped defensively anyway
    // (same defence-in-depth posture as `_reasoning`): the route's flag
    // gate at the re-attach block below is the sole authority, and the
    // strict `OlumiResponseSchema` must not see an unknown key.
    const hasAnswerShape = '_answer_shape' in asRecord;
    if (!hasTimings && !hasTrace && !hasContextSummary && !hasReasoning && !hasAnswerShape) {
      return { timings: undefined, diagnosticTrace: undefined, body: candidateFinalised };
    }
    const cloned = { ...asRecord };
    const timings = cloned._timings;
    const diagnosticTrace = cloned._diagnostic_trace;
    delete cloned._timings;
    delete cloned._diagnostic_trace;
    delete cloned._context_summary;
    delete cloned._reasoning;
    delete cloned._answer_shape;
    return {
      timings: hasTimings ? timings : undefined,
      diagnosticTrace: hasTrace ? diagnosticTrace : undefined,
      body: cloned as import('@talchain/schemas/boundary').OlumiResponse,
    };
  })();
  const timingsForWire = stripped.timings;
  // `ctx.diagnosticTrace` (out-of-band, e.g. from dispatchDraftGraph) wins
  // over a body-attached trace (e.g. from turn_executor `finalizeRun`).
  // When both are absent AND ctx.requestStartedAt + scenarioId + turnId
  // are provided AND the flag is on, build a minimal trace inline. This
  // is the fallback path for the 4 non-draft V5 dispatch exits whose
  // handlers we deliberately leave untouched (avoids overlap with P0
  // proposal-memory work in turn-executor.ts / edit-graph-dispatch.ts).
  const minimalTrace: V5DiagnosticTrace | undefined =
    ctx.diagnosticTrace === undefined &&
    stripped.diagnosticTrace === undefined &&
    ctx.requestStartedAt !== undefined &&
    ctx.scenarioId !== undefined &&
    ctx.turnId !== undefined
      ? buildMinimalV5DiagnosticTrace({
          startedAt: ctx.requestStartedAt,
          scenarioId: ctx.scenarioId,
          turnId: ctx.turnId,
          requestId,
          exitPath,
          graph: ctx.graph,
          // Thread the turn's real per-stage timings so the minimal trace
          // records the routing LLM call in `llm_calls[]` (previously always
          // empty — the sole production call site omitted this input).
          ...(ctx.turnTimings ? { turnTimings: ctx.turnTimings } : {}),
          ...(ctx.coachingDelivery ? { coachingDelivery: ctx.coachingDelivery } : {}),
        })
      : undefined;
  const diagnosticTraceForWire: unknown =
    ctx.diagnosticTrace ?? stripped.diagnosticTrace ?? minimalTrace;
  const candidateForValidation = stripped.body;
  const candidateSanitised = sanitiseOlumiResponseForEgress(candidateForValidation, {
    graph: ctx.graph,
    requestId,
    exitPath,
    userMessage: ctx.userMessage,
  });
  const egress = validateEgress(candidateSanitised, requestId);
  let wireBody = egress.ok
    ? finaliseV5Response(
        sanitiseOlumiResponseForEgress(egress.value, { graph: ctx.graph, requestId, exitPath, userMessage: ctx.userMessage }),
        ctx,
      )
    : finaliseV5Response(
        sanitiseOlumiResponseForEgress(egress.fallback, { graph: ctx.graph, requestId, exitPath, userMessage: ctx.userMessage }),
        ctx,
      );
  if (!egress.ok) {
    log.error(
      { request_id: requestId, exit_path: exitPath },
      'V5 egress validation failed — returning typed fallback envelope (post-finalised)',
    );
  }
  // Re-attach `_timings` post-validation only on the success path AND
  // only when BOTH gates pass:
  //   (a) the server permission flag `config.cee.timingDebugEnabled`
  //       (env var `V5_TIMING_DEBUG=true`) — operator opt-in for the
  //       deployment as a whole, AND
  //   (b) the per-request opt-in header `X-Olumi-Debug: timings`
  //       (or a comma-separated token list including `timings`).
  // This two-gate design is the post-PR-181 boundary-hardening fix:
  // the env flag alone leaked `_timings` to ALL authenticated traffic
  // and tripped DGAI's strict `OlumiResponseSchema` parser for normal
  // browser requests. Both gates ON ⇒ replay harness + explicit debug
  // tooling get `_timings`; normal browser traffic does NOT.
  // The fallback envelope never carries a debug surface; an upstream
  // attach with either gate off is silently dropped by the strip
  // above. Spreading breaks WeakSet membership (Mechanism B of the
  // finaliser brand), so we re-finalise the augmented body for the
  // preSerialization hook.
  const timingsBlock = coerceTurnTimingsBlock(timingsForWire);
  if (
    egress.ok &&
    timingsBlock !== null &&
    config.cee.timingDebugEnabled &&
    debugFieldRequested(reply.request.headers, 'timings')
  ) {
    // PR #182 round-2: typed augmentation via `OlumiResponseWithDebugFields`
    // intersection — `OlumiResponse` extended with the optional `_timings`
    // surface. Replaces the prior `as unknown as OlumiResponse` double-
    // cast so tsc catches drift if the boundary schema changes shape.
    //
    // PR #182 round-3: `timingsBlock` is the result of
    // `coerceTurnTimingsBlock(timingsForWire)` — a runtime guard that
    // returns null if the upstream-attached `_timings` is not a plain
    // object. Malformed internal `_timings` is therefore DROPPED at
    // this seam rather than being silently typed as valid and shipped
    // to the wire. The empty-object case `{}` is preserved (a turn that
    // ran no timed stage still emits an empty top-level container).
    const augmented: OlumiResponseWithDebugFields = {
      ...wireBody,
      _timings: timingsBlock,
    };
    wireBody = finaliseV5Response(
      sanitiseOlumiResponseForEgress(augmented, { graph: ctx.graph, requestId, exitPath, userMessage: ctx.userMessage }),
      ctx,
    );
  }
  // Re-attach `_diagnostic_trace` post-validation on the success path AND
  // only when `config.features.diagnosticTraceEnabled` is set (single-flag
  // gating per the Phase A plan). The DebugFieldToken vocabulary includes
  // `'diagnostics'` for forward-compat, but no header check is enforced
  // here today — operators flip the flag at the deployment level to opt
  // in. The fallback envelope never carries a debug surface; an upstream
  // attach with the flag off is silently dropped by the strip step above.
  //
  // Spreading breaks WeakSet membership (Mechanism B of the finaliser
  // brand), so we re-finalise the augmented body for the preSerialization
  // hook just as the `_timings` re-attach does. The trace's
  // `benchmarking.substage_timings.finalisation_ms` is stamped from
  // `finaliseStart` captured at function entry; `correlation_ids.response_hash`
  // is stamped from the hash of the AUGMENTED body minus the trace itself
  // so the hash ties the trace to the actual wire shape the consumer sees.
  const traceForWire = coerceV5DiagnosticTrace(diagnosticTraceForWire);
  if (egress.ok && traceForWire !== null && config.features.diagnosticTraceEnabled) {
    const finalisationMs = Math.max(0, Date.now() - finaliseStart);
    const stampedTrace: V5DiagnosticTrace = {
      ...traceForWire,
      benchmarking: {
        ...traceForWire.benchmarking,
        substage_timings: {
          ...traceForWire.benchmarking.substage_timings,
          finalisation_ms: finalisationMs,
        },
      },
      correlation_ids: {
        ...traceForWire.correlation_ids,
        response_hash: computeResponseHash(wireBody),
      },
    };
    const augmented: OlumiResponseWithDebugFields = {
      ...wireBody,
      _diagnostic_trace: stampedTrace,
    };
    wireBody = finaliseV5Response(
      sanitiseOlumiResponseForEgress(augmented, { graph: ctx.graph, requestId, exitPath, userMessage: ctx.userMessage }),
      ctx,
    );
  }
  // Re-attach `_context_summary` post-validation on the success path AND
  // only when `config.cee.contextSummaryEnabled` is set (single-flag gating,
  // same shape as the `_diagnostic_trace` gate above). Redacted,
  // diagnostic-only surface for the Golden-Journey Harness (A1/A2). Built
  // from the canonical state — `ctx.canonicalState` when a dispatch path
  // threaded the full verdict (with degraded detection — M5), otherwise
  // composed from `ctx.freshness` + `ctx.analysisReady` via
  // `canonicalStateFromFreshness`. The fallback envelope never carries it;
  // an upstream body-attach with the flag off was dropped by the strip
  // above. Spreading breaks WeakSet membership (finaliser brand), so we
  // re-finalise the augmented body for the preSerialization hook.
  if (egress.ok && config.cee.contextSummaryEnabled) {
    // T4 Slice 2 — frame-first, legacy-fallback funnel. When the turn-executor
    // threaded the canonical frame, project the summary from the FRAME ALONE:
    // analysis state, graph counts, provenance and the (previously null /
    // "not threaded" — M5) recent-turn / recent-change counts all read off the
    // one per-turn frame, with no per-part re-assembly at this seam. The
    // coaching sub-block still projects from the full canonical state the
    // frame wrapped (the frame carries only the redacted summary);
    // `ctx.canonicalState` is that same verdict.
    //
    // FALLBACK, not else: if the frame is absent OR its projection returns
    // null (a hand-built frame missing the optional diagnostics summary —
    // impossible from today's builder, but type-legal), the legacy
    // parts-assembled path below still runs, so the diagnostic never silently
    // disappears while the state to build it is in hand.
    let contextSummary: V5ContextSummary | null =
      ctx.frame !== undefined
        ? contextSummaryFromFrame(
            ctx.frame,
            config.cee.coachingStatePackEnabled ? ctx.canonicalState : undefined,
          )
        : null;
    if (contextSummary === null) {
      const canonical: CanonicalAnalysisState | null =
        ctx.canonicalState ??
        (ctx.freshness !== undefined
          ? canonicalStateFromFreshness(
              ctx.freshness,
              ctx.analysisReady ? { readiness: ctx.analysisReady } : {},
            )
          : null);
      if (canonical !== null) {
        contextSummary = buildV5ContextSummary({
          canonicalState: canonical,
          graphCounts: summariseGraphCounts(ctx.graph),
          // Provenance: `ctx.canonicalState` present ⇒ the full graph-authority
          // verdict from turn-executor (execute OR the non-execute fallback);
          // otherwise we composed the partial `canonicalStateFromFreshness`
          // fallback above for a non-turn-executor dispatch path. Lets a future
          // consumer avoid misreading partial state as full graph authority.
          canonicalStateSource: ctx.canonicalState ? 'turn_executor' : 'route_fallback',
          // Second gate (default-off) for the redacted, hash-free
          // `coaching_state_pack` sub-block — projected from the SAME canonical
          // state as `analysis_state` (NOT non-execute-specific); diagnostic-only,
          // never read by prompt/chip/product logic.
          includeCoachingState: config.cee.coachingStatePackEnabled,
        });
      }
    }
    if (contextSummary !== null) {
      const augmented: OlumiResponseWithDebugFields = {
        ...wireBody,
        _context_summary: contextSummary,
      };
      wireBody = finaliseV5Response(
        sanitiseOlumiResponseForEgress(augmented, { graph: ctx.graph, requestId, exitPath, userMessage: ctx.userMessage }),
        ctx,
      );
    }
  }
  // Re-attach `_reasoning` post-validation on the success path AND only
  // when `config.features.reasoningCaptureEnabled` is set (ROADMAP 1.42,
  // same single-flag re-attach shape as `_context_summary` /
  // `_diagnostic_trace` above). `ctx.reasoning` is threaded from
  // `run.reasoning` (turn-executor) — VERBATIM Sonnet-5 extended-thinking
  // text, never derived or re-composed here. The fallback envelope never
  // carries it; an upstream body-attach with the flag off was dropped by
  // the strip step above. Spreading breaks WeakSet membership (finaliser
  // brand), so we re-finalise the augmented body for the preSerialization
  // hook, same as the other debug surfaces.
  if (egress.ok && config.features.reasoningCaptureEnabled && ctx.reasoning) {
    const augmented: OlumiResponseWithDebugFields = {
      ...wireBody,
      _reasoning: ctx.reasoning,
    };
    wireBody = finaliseV5Response(
      sanitiseOlumiResponseForEgress(augmented, { graph: ctx.graph, requestId, exitPath, userMessage: ctx.userMessage }),
      ctx,
    );
  }
  // Re-attach `_answer_shape` post-validation on the success path AND only
  // when `config.features.answerShapeEnforced` is set (ROADMAP 1.132, same
  // single-flag re-attach shape as `_reasoning` above). `ctx.answerShape`
  // is threaded from `run.answerShape` (turn-executor) — the VALIDATED
  // coach/converse shape whose derived text was the final assistant_text
  // when the executor finalised. The fallback envelope never carries it; an
  // upstream body-attach was dropped by the strip step above. Re-finalise
  // for WeakSet membership, same as the other surfaces.
  //
  // Stale-sidecar fail-closed (P1 hardening): this block is the LAST body
  // mutation before send, so the tie between the shape and the text the
  // user actually receives is verified HERE, at the true final egress —
  // covering every rewriter between the executor's compose-time capture and
  // the wire (the executor's own STEP 6.6 / goal-receipt / backstop /
  // finaliser guards are re-checked in finalizeRun; THIS check additionally
  // covers the route-level sanitiseOlumiResponseForEgress entity-id scrub
  // and any future mutator on this path). Mismatch ⇒ ship the body WITHOUT
  // the sidecar, never a shape describing text the user never sees. The
  // comparison runs on the POST-sanitise augmented body, i.e. the exact
  // bytes `reply.send` would carry.
  if (egress.ok && config.features.answerShapeEnforced && ctx.answerShape) {
    const augmented: OlumiResponseWithDebugFields = {
      ...wireBody,
      _answer_shape: ctx.answerShape,
    };
    const withShape = finaliseV5Response(
      sanitiseOlumiResponseForEgress(augmented, { graph: ctx.graph, requestId, exitPath, userMessage: ctx.userMessage }),
      ctx,
    );
    const derivedText = deriveAnswerTextFromShape(ctx.answerShape);
    const finalText =
      typeof withShape.assistant_text === 'string' ? withShape.assistant_text : '';
    if (finalText === derivedText) {
      wireBody = withShape;
    } else {
      emit(TelemetryEvents.V5AnswerShapeDroppedStale, {
        request_id: requestId,
        exit_path: exitPath,
        dispatch_path: 'route_egress',
        final_text_length: finalText.length,
        derived_text_length: derivedText.length,
      });
    }
  }
  logFinalisedResponse(requestId, exitPath, wireBody, egress.ok, ctx.analysisReady == null);
  return reply.code(200).send(wireBody);
}

/**
 * Runtime guard for the upstream-attached `_timings` block.
 *
 * Returns the input as a `TurnTimingsBlock` when it is a PLAIN object
 * (the only shape upstream sites legitimately emit — see
 * `src/orchestrator-v5/telemetry/turn-timings.ts`); returns `null`
 * otherwise. Wrapping a malformed `_timings` (string, number, array,
 * function, Date, Map, class instance, …) in the typed envelope would
 * silently leak garbage to the wire — drop instead. The empty-object
 * case `{}` is preserved so a turn with no timed stages can still emit
 * an empty container.
 *
 * Plain-object check is by prototype: the value must be a literal
 * `{...}` (whose prototype is `Object.prototype`) or
 * `Object.create(null)`. Class instances, Date, Map, Set, Buffer,
 * Promise, etc. are rejected. The upstream writers always emit object
 * literals, so this only ever rejects shapes the type system would
 * already have flagged at compile time — this guard exists for
 * defence in depth against a future regression that bypasses the
 * `TurnTimingsBlock` type at the writer site.
 *
 * Note: structural field-level validation (e.g. `turn.compose_ms` is a
 * number) is the upstream writer's responsibility. This guard checks
 * the shape only.
 */
function coerceTurnTimingsBlock(raw: unknown): TurnTimingsBlock | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object') return null;
  if (Array.isArray(raw)) return null;
  const proto = Object.getPrototypeOf(raw);
  if (proto !== Object.prototype && proto !== null) return null;
  return raw as TurnTimingsBlock;
}

/**
 * Runtime guard for the V5 diagnostic trace at the wire seam.
 *
 * Same defence-in-depth shape as `coerceTurnTimingsBlock`: plain object
 * by prototype, plus a couple of structural sanity checks that the
 * `V5DiagnosticTrace` invariants hold (the `benchmarking` and
 * `correlation_ids` sub-objects exist and look right). Failing any check
 * drops the trace silently — better than shipping a half-shaped trace
 * that confuses the exporter or fails its own consumer-side validation.
 *
 * Field-level depth is intentionally shallow: the upstream builder is
 * the source of truth for the trace shape; this guard only catches
 * shape regressions that bypass the type system (a stale upstream
 * attach via `as unknown as V5DiagnosticTrace`, or a future producer
 * that returns the wrong wrapper).
 */
function coerceV5DiagnosticTrace(raw: unknown): V5DiagnosticTrace | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object') return null;
  if (Array.isArray(raw)) return null;
  const proto = Object.getPrototypeOf(raw);
  if (proto !== Object.prototype && proto !== null) return null;
  const rec = raw as Record<string, unknown>;
  const bench = rec.benchmarking;
  if (bench === null || typeof bench !== 'object' || Array.isArray(bench)) return null;
  const benchRec = bench as Record<string, unknown>;
  if (typeof benchRec.total_duration_ms !== 'number') return null;
  const subst = benchRec.substage_timings;
  if (subst === null || typeof subst !== 'object' || Array.isArray(subst)) return null;
  const corr = rec.correlation_ids;
  if (corr === null || typeof corr !== 'object' || Array.isArray(corr)) return null;
  const corrRec = corr as Record<string, unknown>;
  if (typeof corrRec.request_id !== 'string') return null;
  if (typeof corrRec.scenario_id !== 'string') return null;
  if (typeof corrRec.turn_id !== 'string') return null;
  return raw as V5DiagnosticTrace;
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
  freshnessOnlySynthesised: boolean,
): void {
  const ar = (
    finalisedResponse as
      | { analysis_ready?: { status?: string; computed_at?: string; freshness?: string; freshness_reason?: string } }
      | undefined
  )?.analysis_ready;
  log.info(
    {
      event: 'v5.response.finalised',
      request_id: requestId,
      exit_path: exitPath,
      analysis_ready_emitted: ar != null,
      analysis_ready_status: ar?.status ?? null,
      computed_at: ar?.computed_at ?? null,
      // Mission 3 transport recovery observability. Enum/reason code +
      // boolean only — no graph hashes or content values. Preserves the
      // pre-recovery "should be carrying readiness but isn't" signal that
      // `analysis_ready_emitted: false` used to give on unknown turns.
      // forbidden-exempt: freshness VERDICT enum (fresh|stale|unknown|none), Tier-1 status transport — honest null when no analysis_ready ships, not a science-value fallback
      analysis_ready_freshness: ar?.freshness ?? null,
      // forbidden-exempt: freshness REASON code (stable debug/telemetry string), honest null when absent — not a science-value fallback
      analysis_ready_freshness_reason: ar?.freshness_reason ?? null,
      analysis_ready_freshness_only_synthesised: freshnessOnlySynthesised && ar != null,
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

/**
 * Map the V4 unified-pipeline's category metadata (statusCode + body.code)
 * to a typed `details.reason` + retryable signal for the draft_graph
 * BoundaryError. Strategy B: HTTP status stays at 500; only the wire body's
 * typed reason and retryability change so DGAI can branch on
 * `details.reason` without a status-code contract change.
 *
 * Plain-Error throws with no `pipelineStatusCode` metadata bypass this helper
 * and produce the legacy `draft_graph_pipeline_threw` reason directly (see
 * the catch block in dispatchDraftGraph).
 *
 * Category source: `buildCeeErrorResponse` in src/cee/validation/pipeline.ts
 * — the canonical field is `body.code`. Eight known CEE codes are emitted
 * across the codebase: CEE_LLM_VALIDATION_FAILED, CEE_TIMEOUT,
 * CEE_LLM_UPSTREAM_ERROR, CEE_RATE_LIMIT, CEE_INTERNAL_ERROR,
 * CEE_GRAPH_INVALID, CEE_VALIDATION_FAILED, CEE_SERVICE_UNAVAILABLE.
 */
export function mapDraftGraphPipelineReason(
  pipelineStatusCode: number,
  pipelineErrorCode: string,
): { reason: string; retryable: boolean } {
  switch (pipelineErrorCode) {
    case 'CEE_LLM_VALIDATION_FAILED':
      // Client-actionable: brief was too vague or LLM output didn't validate.
      // Not retryable without changing the input.
      return { reason: 'draft_graph_cee_llm_validation_failed', retryable: false };
    case 'CEE_TIMEOUT':
      return { reason: 'draft_graph_cee_timeout', retryable: true };
    case 'CEE_LLM_UPSTREAM_ERROR':
      return { reason: 'draft_graph_cee_llm_upstream_error', retryable: true };
    case 'CEE_RATE_LIMIT':
      return { reason: 'draft_graph_cee_rate_limit', retryable: true };
    case 'CEE_INTERNAL_ERROR':
      // Pipeline catch-all — likely a true internal bug. Retryable so the user
      // isn't blocked, but logs should flag it for investigation.
      return { reason: 'draft_graph_cee_internal_error', retryable: true };
    case 'CEE_GRAPH_INVALID':
      // Emitted when enrichment or repair determines the LLM produced a
      // graph that cannot be made structurally valid (see
      // unified-pipeline/index.ts:523, orchestrator-validation.ts).
      // Client must refine the brief — retrying with the same input
      // reproduces.
      return { reason: 'draft_graph_cee_graph_invalid', retryable: false };
    case 'CEE_VALIDATION_FAILED':
      // Generic validation failure surface (graph-enforcement and orchestrator
      // validators). Client-actionable, not retryable without input change.
      return { reason: 'draft_graph_cee_validation_failed', retryable: false };
    case 'CEE_SERVICE_UNAVAILABLE':
      // Pipeline incomplete-wiring guard (unified-pipeline/index.ts:750) or
      // a paused project. Service-level failure — retryable once operator
      // restores the underlying state.
      return { reason: 'draft_graph_cee_service_unavailable', retryable: true };
    default:
      // Unknown pipeline error code: surface the status family in `reason`
      // and the raw code in `details.pipeline_error_code` (attached by the
      // catch block) so dashboards can split. Retryable for 5xx;
      // non-retryable for 4xx. Distinct from the legacy
      // `draft_graph_pipeline_threw` reason (which fires only when no
      // pipeline metadata is attached, i.e. a plain Error throw).
      return {
        reason: `draft_graph_pipeline_status_${pipelineStatusCode}`,
        retryable: pipelineStatusCode >= 500,
      };
  }
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
  userMessage: string | null,
): import('fastify').FastifyReply<{ Reply: V5RouteReply }> {
  emit(TelemetryEvents.V5EditGraphGraphStateUnavailable, {
    request_id: requestId,
    scenario_id: scenarioId,
    reason,
  });
  return sendFinalised200(reply, requestId, 'edit_graph', composeDirectAnswerResponse({
    assistant_text: EDIT_GRAPH_RECOVERY_TEXT,
    stage,
  }), { graph: null, userMessage });
}

// ────────────────────────────────────────────────────────────────────
// V5 edit lifecycle recovery v1 — pure freshness derivation for the
// pre-LLM intercepts. PR #194 review correction: the prior version
// of this helper called `buildTurnContext`, which reads facts from
// Supabase — a DB round-trip on a path the brief explicitly asked to
// keep cheap. The replacement reads only fields already on the
// request: `extensions.analysisState.meta.graph_hash_at_run` and the
// current graph state. Verdict:
//   - `true`  → analysisState carries an `analysis_status` in the
//               `SUCCESSFUL_ANALYSIS_STATUSES` allowlist
//               (`completed` | `computed` | `complete` | `success`)
//               AND a `graph_hash_at_run` that equals
//               `computeAnalysisAffectingGraphHash(graphState)`.
//   - `false` → cannot verify from the request alone (no
//               analysisState, missing hash, status not in the
//               successful allowlist, hash diverged, or empty graph).
//
// "Cannot verify" is the right semantic here — when the request
// doesn't prove freshness, the clarification omits the freshness
// sentence rather than restating something we can't ground. This is
// strictly more honest than the previous DB-backed derivation,
// which would have returned `true` for some scenarios the
// stateless caller can't see.
// ────────────────────────────────────────────────────────────────────
// Canonical successful-analysis statuses on the wire. Mirrors the
// allowlist in `src/orchestrator/analysis-state.ts`
// (`isAnalysisExplainable`), which checks
// `'completed' | 'computed' | 'complete'`. `'success'` is included
// for forward-compat with any future producer that uses it. PR #194
// review-2 correction — the previous narrower check (`'success'`
// only) silently omitted the freshness sentence on every real
// production envelope.
const SUCCESSFUL_ANALYSIS_STATUSES: ReadonlySet<string> = new Set([
  'completed',
  'computed',
  'complete',
  'success',
]);

function isPriorAnalysisFreshFromRequest(
  graphState: import('../orchestrator-v5/boundary/request-extensions.js').GraphStateIngress | null | undefined,
  analysisState: import('../orchestrator-v5/boundary/request-extensions.js').AnalysisStateIngress | null | undefined,
): boolean {
  if (!graphState || !analysisState) return false;
  const status = (analysisState as { analysis_status?: unknown }).analysis_status;
  if (typeof status !== 'string' || !SUCCESSFUL_ANALYSIS_STATUSES.has(status)) return false;
  // graph_hash_at_run may live under `meta` (canonical V2 envelope shape)
  // or at the top level (some legacy / passthrough variants). Read both.
  const meta = (analysisState as { meta?: unknown }).meta;
  let graphHashAtRun: unknown =
    meta && typeof meta === 'object'
      ? (meta as { graph_hash_at_run?: unknown }).graph_hash_at_run
      : undefined;
  if (typeof graphHashAtRun !== 'string') {
    graphHashAtRun = (analysisState as { graph_hash_at_run?: unknown }).graph_hash_at_run;
  }
  if (typeof graphHashAtRun !== 'string' || graphHashAtRun.length === 0) return false;
  const currentHash = computeAnalysisAffectingGraphHash(graphState);
  if (typeof currentHash !== 'string' || currentHash.length === 0) return false;
  return currentHash === graphHashAtRun;
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

// ────────────────────────────────────────────────────────────────────
// V5 Signature Loop — route-level proposal-confirmation resolution.
// ────────────────────────────────────────────────────────────────────
//
// A confirmation-shaped, edit-verb-bearing message ("make that update",
// "make that change", "update the model") matches EDIT_GRAPH_POSITIVE_REGEX
// and would dispatch to edit_graph, which no-ops and WIPES the pending
// proposal. This resolves the proposal-vs-edit ambiguity at the route, before
// edit routing, against the most-recent pending actions.

type ProposalConfirmResolution =
  | {
      readonly kind: 'suppress';
      readonly outcome: 'suppressed_live' | 'suppressed_read_failed';
      readonly liveCount: number;
    }
  | {
      readonly kind: 'clarify';
      readonly outcome: 'clarify_none' | 'clarify_expired' | 'clarify_hash_mismatch';
    }
  | {
      /**
       * P0 held-proposal replay (2026-07-15, DGAI #340) — replay-candidate
       * path only: the message did not exactly match any proposal the user
       * was shown, so this is NOT a confirmation. Edit routing proceeds
       * untouched (an unrelated edit-verb chip label or a fresh
       * affirmative-prefixed edit command must never be hijacked by a live
       * hold, and must never get the no-live-proposal clarification).
       */
      readonly kind: 'pass';
      readonly outcome: 'replay_no_match';
    };

/**
 * P0 held-proposal replay (2026-07-15, DGAI #340) — affirmative-prefixed
 * message shapes ("Yes, add 'Wasted time' and 2 more changes.") that a user
 * may type, or that a hold chip's MESSAGE replays. Prefix-anchored only:
 * the exact-match against the proposal's rendered copy is the real gate;
 * this pattern merely bounds which messages pay the pendings read.
 */
const AFFIRMATIVE_PREFIX_PATTERN = /^\s*(?:yes|yeah|yep|ok(?:ay)?|sure|confirm)\b/i;

/**
 * Resolve whether a confirmation-shaped message should SUPPRESS edit routing
 * (a live, graph-safe proposal exists → TurnExecutor will apply it; or the
 * read failed → degrade safely) or trigger the no-live-proposal CLARIFY copy.
 *
 * Graph-safe = `preconditions.graph_hash === requestGraphHash` when the request
 * graph can be hashed. With no request graphState the route cannot hash, so it
 * suppresses conservatively and defers the authoritative hash/idempotency
 * decision to `decideProposedChangeSynthesis` inside TurnExecutor.
 */
async function resolveProposalConfirmAtRoute(
  scenarioId: string,
  requestId: string,
  requestGraphState: GraphStateIngress | null,
  /**
   * P0 held-proposal replay (2026-07-15, DGAI #340): non-null on the
   * REPLAY-CANDIDATE path — a message that is NOT confirmation-shaped but
   * could be a proposal-copy replay (a chip_click ingress, or an
   * affirmative-prefixed reply). The message must then EXACTLY match a
   * proposal's rendered label or message (the same strings + normalisation
   * TurnExecutor's pass-7 pre-route matches) for edit routing to be
   * suppressed; no match returns `pass` and edit routing proceeds
   * untouched. `null` keeps the original confirmation-shaped behaviour
   * byte-identical.
   */
  replayMessage: string | null = null,
): Promise<ProposalConfirmResolution> {
  let pendings: readonly PendingAction[];
  try {
    pendings = await loadMostRecentPendingActionsStrict(scenarioId, requestId);
  } catch (err) {
    // Read failed — degrade safely by SUPPRESSING edit routing. A transient
    // read error must never silently look like "no proposal" + edit no-op
    // (amendment #4). The distinct `suppressed_read_failed` outcome is the
    // observable trace; the executor re-reads pending state downstream.
    log.warn(
      {
        request_id: requestId,
        scenario_id: scenarioId,
        err: err instanceof Error ? { name: err.name, message: err.message } : { message: String(err) },
      },
      'V5 proposal-confirm suppressor — pending read failed; suppressing edit routing (degraded)',
    );
    return { kind: 'suppress', outcome: 'suppressed_read_failed', liveCount: 0 };
  }
  const proposals = pendings.filter((pa) => pa.action.kind === 'apply_proposed_change');
  // ── P0 held-proposal replay path (2026-07-15, DGAI #340) ──────────────
  // The message is edit-verb-bearing and NOT confirmation-shaped, but came
  // from a chip click or starts with an affirmative. It counts as a
  // confirmation ONLY if it exactly matches a live proposal's rendered
  // copy — the strings the user was actually shown. On a match, suppress
  // edit routing so TurnExecutor's exact-match pre-route resolves the SAME
  // proposal (GM holds via the dedicated held-execute resume). The
  // graph-hash precondition is deliberately NOT filtered here: the
  // executor's resume path re-checks it like-for-like and owns the honest
  // superseded recovery — filtering here would misdirect a hash-diverged
  // replay into the edit LLM instead.
  if (replayMessage !== null) {
    if (proposals.length === 0) {
      return { kind: 'pass', outcome: 'replay_no_match' };
    }
    const replayNowMs = Date.now();
    const liveProposals = proposals.filter((pa) => !isPendingActionExpired(pa, replayNowMs));
    const liveMatches = findExactProposalCopyMatchIndexes(
      replayMessage,
      liveProposals.map((pa) => resolveProposalRenderCopy(pa.action)),
    );
    if (liveMatches.length > 0) {
      return { kind: 'suppress', outcome: 'suppressed_live', liveCount: liveMatches.length };
    }
    // Honest expiry: the exact copy of a DEAD hold must resolve to the
    // deterministic clarification, never a silent edit-LLM redraft that
    // pretends the offer never existed.
    const expiredProposals = proposals.filter((pa) => isPendingActionExpired(pa, replayNowMs));
    const expiredMatches = findExactProposalCopyMatchIndexes(
      replayMessage,
      expiredProposals.map((pa) => resolveProposalRenderCopy(pa.action)),
    );
    if (expiredMatches.length > 0) {
      return { kind: 'clarify', outcome: 'clarify_expired' };
    }
    return { kind: 'pass', outcome: 'replay_no_match' };
  }
  if (proposals.length === 0) {
    return { kind: 'clarify', outcome: 'clarify_none' };
  }
  const nowMs = Date.now();
  // Track 2: shared read-time liveness authority (wall AND turn-count),
  // previously an inline mirror of TurnExecutor's `isExpired`.
  // `suppressed_live` does NOT guarantee a mutation: it means route-visible
  // expiry passed and edit handling is safely bypassed so TurnExecutor can
  // make the AUTHORITATIVE apply / supersede / idempotency decision
  // (graph-hash validity is still deferred downstream when the request
  // carried no graphState; already-applied, validator failure, and handler
  // failure can also prevent the mutation). Carry-forward already drops
  // `expires_at_turn_count <= 0` before persistence, so the turn-count leg
  // is defence-in-depth + telemetry accuracy: a turn-count-exhausted
  // proposal that ever reached the read is treated as expired
  // (→ `clarify_expired`) rather than a misleading `suppressed_live`.
  const notExpired = proposals.filter((pa) => !isPendingActionExpired(pa, nowMs));
  if (notExpired.length === 0) {
    return { kind: 'clarify', outcome: 'clarify_expired' };
  }
  const requestGraphHash =
    requestGraphState != null ? computeAnalysisAffectingGraphHash(requestGraphState) : null;
  const graphSafe =
    requestGraphHash == null
      ? notExpired
      : notExpired.filter((pa) => pa.preconditions.graph_hash === requestGraphHash);
  if (graphSafe.length === 0) {
    return { kind: 'clarify', outcome: 'clarify_hash_mismatch' };
  }
  return { kind: 'suppress', outcome: 'suppressed_live', liveCount: graphSafe.length };
}

/**
 * Deterministic copy for a confirmation-shaped message that has NO live,
 * graph-safe pending proposal to apply (amendment #3) — replaces the legacy
 * edit_graph no-op dead-end. British English; concrete next steps. Applies
 * only to anchored confirmation phrases, never to concrete edits like
 * "update market demand to 20" (those reach the value-update path).
 */
const NO_LIVE_PROPOSAL_TEXT =
  "I don't have a pending suggested update to apply. " +
  'Tell me what you want to change, or ask what could change the outcome.';

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
 * The pre-flight 401/422 path uses `pre.status` which is typed as the
 * pre-flight failure status. The `400 | 401 | 422 | 500: BoundaryError`
 * mapping covers every possible pre-status output (per buildBoundaryError /
 * runPreFlight definitions; 401 is the flag-gated sign_in_required refusal
 * from the CEE_REQUIRE_USER_JWT identity step — login 3.4 CEE-half).
 */
export type V5RouteReply = {
  200: FinalisedV5Response;
  400: BoundaryError;
  401: BoundaryError;
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
    // V5 diagnostic trace (Phase A) — route-handler wall-clock baseline.
    // Threaded into `sendFinalised200` via `ctx.requestStartedAt` so the
    // minimal-trace builder can compute `total_duration_ms` from a
    // consistent reference across all V5 exit paths. Captured at the
    // earliest possible moment so it covers pre-flight + dispatch +
    // composition; the trace's `finalisation_ms` substage records the
    // egress-side cost separately.
    const routeStartedAt = Date.now();
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
        requestStartedAt: routeStartedAt,
        scenarioId: ingress.scenario_id,
        turnId: ingress.turn_id,
        // System events carry no user message (the ingress union's
        // 'system_event' variant has no `message` field), so the
        // looping-chip guard has nothing to compare against and is
        // explicitly inert here rather than accidentally omitted.
        userMessage: null,
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
        //
        // V5 C5 — recoverable handler cause (RECOVERABLE_HANDLER_CAUSES, e.g.
        // options_not_configured when an added option is not yet configured for
        // analysis): the dispatcher already composed a clean graceful body via
        // the shared composeRecoverableHandlerResponse machinery. Return a 200
        // (NOT a 500), mirroring the TurnExecutor handler-recovery path. No
        // analysis_ready is stamped — no analysis ran and the graph was not
        // mutated, so the UI retains its prior store value (failure semantics).
        if (cc.outcome === 'handler_recovered') {
          return sendFinalised200(reply, requestId, 'chip_click', cc.response, {
            graph: cc.graph,
            requestStartedAt: routeStartedAt,
            scenarioId: ingress.scenario_id,
            turnId: ingress.turn_id,
          userMessage: ingress.message,
          });
        }
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
          requestStartedAt: routeStartedAt,
          scenarioId: ingress.scenario_id,
          turnId: ingress.turn_id,
        userMessage: ingress.message,
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
    // ────────────────────────────────────────────────────────────────────
    // V5 Signature Loop — refresh-continuation guard.
    // ────────────────────────────────────────────────────────────────────
    // A turn at frame stage with no request graph that nonetheless belongs to a
    // scenario WITH committed turns is a refresh / reconnection of an existing
    // decision, not a fresh brief. After a UI refresh the request carries the
    // same scenario_id but (often) stage='frame' and no graph_state; without
    // this guard it is misclassified as draft_graph (below) or frame-no-brief
    // (further down) and the assistant "starts over" instead of reading
    // server-side memory. Suppress BOTH shortcuts here so the turn falls through
    // to TurnExecutor, which reconstructs memory from server-side state
    // (persisted graph + recent turns via readRecent) — CEE memory does NOT
    // depend on the UI replaying conversation history.
    //
    // The existence read is gated on the ONLY state in which those shortcuts can
    // fire (frame stage + no request graph), so the hot path is unchanged. A
    // brand-new decision uses a fresh scenario_id (0 prior turns →
    // isContinuationScenario=false → draft / frame as before); explicit
    // new-decision / reset / template / import flows likewise allocate a fresh
    // scenario_id, so they are unaffected.
    const frameStageNoGraph = ingress.stage === 'frame' && extensions.graphState == null;
    const isContinuationScenario = frameStageNoGraph
      ? await loadHasPriorTurns(ingress.scenario_id, requestId)
      : false;
    if (isContinuationScenario) {
      const wouldDraft =
        ingress.message.length >= DRAFT_GRAPH_MIN_BRIEF_LENGTH &&
        DRAFT_GRAPH_DECISION_BRIEF_REGEX.test(ingress.message);
      emit(TelemetryEvents.V5ContinuationGuardApplied, {
        request_id: requestId,
        scenario_id: ingress.scenario_id,
        guard: wouldDraft ? 'draft_graph' : 'frame_no_brief',
        prior_turns_present: true,
      });
    }
    const isDraftGraphShape =
      ingress.stage === 'frame' &&
      extensions.graphState == null &&
      // V5 Signature Loop — a scenario with prior committed turns is a
      // continuation, not a first brief; let it reach TurnExecutor's memory.
      !isContinuationScenario &&
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
          ...(dg.diagnosticTrace ? { diagnosticTrace: dg.diagnosticTrace } : {}),
          requestStartedAt: routeStartedAt,
          scenarioId: ingress.scenario_id,
          turnId: ingress.turn_id,
        userMessage: ingress.message,
        });
      } catch (err) {
        // The unified pipeline threw — surface a typed BoundaryError. The
        // dispatcher already logged the details; re-log here with the
        // route-level correlation context.
        //
        // Strategy: preserve HTTP 500 (no DGAI status-code contract change)
        // and enrich `details.reason` + `details.recovery` from the typed
        // pipeline metadata when handleDraftGraph attached it
        // (`pipelineStatusCode` / `pipelineErrorCode` / `pipelineRecovery`).
        // Plain Error throws with no metadata fall through to the legacy
        // wire shape bit-for-bit: `INTERNAL_ERROR / draft_graph_pipeline_threw`.
        const meta = err as {
          readonly pipelineStatusCode?: number;
          readonly pipelineErrorCode?: string | null;
          readonly pipelineRecovery?: Record<string, unknown> | null;
          readonly pipelineDetails?: Record<string, unknown> | null;
        };
        const pipelineStatusCode =
          typeof meta.pipelineStatusCode === 'number' ? meta.pipelineStatusCode : null;
        const pipelineErrorCode =
          typeof meta.pipelineErrorCode === 'string' ? meta.pipelineErrorCode : null;
        const pipelineRecovery =
          meta.pipelineRecovery && typeof meta.pipelineRecovery === 'object'
            ? meta.pipelineRecovery
            : null;
        // Allowlisted diagnostic fields from the CEE pipeline body's
        // `details` (carried by handleDraftGraph per its
        // PIPELINE_DETAILS_ALLOWLIST). Examples for OPTIONS_IDENTICAL
        // bypass: violation_code, identical_option_ids,
        // intervention_signature, repair_skip_reason. Filtering happens
        // upstream in handleDraftGraph so this site can trust the shape;
        // the typeof check is defence-in-depth.
        const pipelineDetails =
          meta.pipelineDetails && typeof meta.pipelineDetails === 'object'
            ? meta.pipelineDetails
            : null;
        log.error(
          {
            request_id: requestId,
            err: err instanceof Error ? { name: err.name, message: err.message } : { message: String(err) },
            pipeline_status_code: pipelineStatusCode,
            pipeline_error_code: pipelineErrorCode,
          },
          'V5 draft_graph pipeline threw — returning 500 BoundaryError',
        );
        const { reason, retryable } = pipelineStatusCode != null && pipelineErrorCode != null
          ? mapDraftGraphPipelineReason(pipelineStatusCode, pipelineErrorCode)
          : { reason: 'draft_graph_pipeline_threw', retryable: true };
        // Build postStageExtras additively: recovery (when present), the
        // raw CEE category code (when present), AND any allowlisted
        // diagnostic fields from the pipeline body's details. Order
        // matters — pipelineDetails is merged FIRST so the explicit
        // top-level fields (recovery, pipeline_error_code) cannot be
        // shadowed by future allowlist additions of the same name.
        // The legacy plain-Error fallback path attaches none of these —
        // `details` carries only `retryable` + `reason` + `stage`,
        // bit-for-bit identical to the pre-fix shape.
        const postStageExtras: Record<string, unknown> = {};
        if (pipelineDetails) Object.assign(postStageExtras, pipelineDetails);
        if (pipelineRecovery) postStageExtras.recovery = pipelineRecovery;
        if (pipelineErrorCode) postStageExtras.pipeline_error_code = pipelineErrorCode;
        const boundaryError: BoundaryError = buildCommitFailureBoundaryError({
          validator: 'draft_graph_pipeline',
          reason,
          retryable,
          requestId,
          stage: ingress.stage,
          ...(Object.keys(postStageExtras).length > 0 ? { postStageExtras } : {}),
        });
        // V5 diagnostic trace — error path. When CEE_DIAGNOSTIC_TRACE_ENABLED
        // is on AND the dispatcher's catch block attached a trace to the
        // thrown error (see draft-graph-dispatch.ts), thread it onto the
        // 500 BoundaryError envelope so debug exports can see the timeout
        // / SO-parse-failure substage timings even on failed turns.
        // Brief test #5 (timeout → `timed_out: true`, `retry_count`) reads
        // this surface. Flag-off / no-trace cases ship the unchanged
        // BoundaryError shape bit-for-bit.
        const errorTrace = coerceV5DiagnosticTrace(
          (err as { diagnosticTrace?: unknown }).diagnosticTrace,
        );
        const wireBoundary: BoundaryError =
          errorTrace !== null && config.features.diagnosticTraceEnabled
            ? ({
                ...boundaryError,
                _diagnostic_trace: errorTrace,
              } as unknown as BoundaryError)
            : boundaryError;
        // HTTP 500 preserved: keep DGAI's status-code semantics unchanged.
        // Wire body carries (each at top level of `details`):
        //   - `reason` (typed reason)
        //   - `recovery` (hints, when present)
        //   - `pipeline_error_code` (raw CEE code, when present)
        //   - any allowlisted diagnostic fields flattened from the
        //     pipeline body's `details` — e.g. for OPTIONS_IDENTICAL bypass:
        //     `identical_option_ids`, `violation_code`,
        //     `intervention_signature`, `repair_skip_reason`.
        // Top-level (alongside `error` / `details`):
        //   - `_diagnostic_trace` when the flag is on AND the dispatcher
        //     attached a trace; absent otherwise.
        return reply.code(500).send(wireBoundary);
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
    // ────────────────────────────────────────────────────────────────
    // V5 edit lifecycle recovery v1 — pre-LLM intercepts (PR #194 +
    // review-correction commit). Run BEFORE `editIntentDetected` is
    // computed, so they catch:
    //
    //   1. The legacy "Simplify the change" chip prompt (exact text)
    //      — chip-text closes a loop even when the chip-side
    //      `action_type` was lost.
    //   2. Vague-improvement messages WITHOUT an edit-positive verb
    //      ("Make the model better", "Try something different",
    //      "Improve this") — these would otherwise miss
    //      `EDIT_GRAPH_POSITIVE_REGEX` and fall through to
    //      TurnExecutor, costing a Sonnet round-trip on a UX the
    //      brief asked to handle deterministically.
    //
    // Freshness derivation is pure — it reads only
    // `extensions.analysisState.meta.graph_hash_at_run` (already on
    // the request payload) and compares against the request's graph
    // hash. NO Supabase round-trip. PR #194 review correction.
    // ────────────────────────────────────────────────────────────────
    const priorAnalysisIsFresh = isPriorAnalysisFreshFromRequest(
      extensions.graphState,
      extensions.analysisState,
    );
    const interceptNodes = extensions.graphState?.nodes ?? null;

    // ────────────────────────────────────────────────────────────────
    // V5 Signature Loop — resolve confirmation / state-query intent BEFORE the
    // Stage-4A edit intercepts AND the edit dispatch. Ordering is load-bearing:
    // `tryVagueEditGuard` matches "update the model" (and similar), so without
    // resolving here a confirmation phrase with a LIVE proposal would be claimed
    // as a vague edit and never applied. Resolving first lets a confirmation
    // bypass the intercepts and fall through to TurnExecutor (which applies the
    // proposal), and lets an edit-verb-bearing state-query fall through to the
    // recent-changes-grounded state-query guard.
    // ────────────────────────────────────────────────────────────────
    const analyticalQuestionDetected = isAnalyticalQuestion(ingress.message);
    const positiveEditRegexHit = EDIT_GRAPH_POSITIVE_REGEX.test(ingress.message);
    const negativeEditRegexHit = EDIT_GRAPH_NEGATIVE_REGEX.test(ingress.message);
    const valueUpdatePhrasingHit = isValueUpdatePhrasing(ingress.message);
    // State-query suppressor (behaviour #3): a question containing an edit verb
    // ("what did you just change?", "what did that update do?") must NOT edit.
    const stateQuerySuppressed = isStateQueryQuestionShape(ingress.message);
    if (
      stateQuerySuppressed
      && positiveEditRegexHit
      && !negativeEditRegexHit
      && !valueUpdatePhrasingHit
      && !analyticalQuestionDetected
    ) {
      emit(TelemetryEvents.V5EditGraphStateQuerySuppressed, {
        request_id: requestId,
        scenario_id: ingress.scenario_id,
      });
    }
    // Base edit-verb candidate: a positive edit verb with NONE of the negative
    // gates (negative regex / value-update / analytical / state-query). The
    // value-update gate keeps `set X to Y` / `increase X by N` on the
    // deterministic D1 path (value-update-gate.ts).
    const editVerbCandidate =
      positiveEditRegexHit &&
      !negativeEditRegexHit &&
      !valueUpdatePhrasingHit &&
      !analyticalQuestionDetected &&
      !stateQuerySuppressed;
    // Proposal-confirmation suppressor (behaviour #1) + no-live-proposal
    // clarification (amendment #3). Only a confirmation-shaped, edit-verb-bearing
    // message pays the pending-actions read (hot path unchanged). Live graph-safe
    // proposal → suppress (TurnExecutor's tryShortConfirmResume applies it); no
    // proposal → return the no-live-proposal clarification (not the legacy edit
    // no-op dead-end); read failure → suppress (degraded, distinct trace).
    let proposalConfirmSuppressed = false;
    const isConfirmationShaped =
      SHORT_CONFIRM_PATTERN.test(ingress.message) ||
      PROPOSAL_CONFIRM_PATTERN.test(ingress.message);
    // P0 held-proposal replay (2026-07-15, DGAI #340): the consent-clarity
    // NAMED hold chip copy ("Add 'X' and 2 more changes") carries an edit
    // verb + digits by construction, so it can never be confirmation-shaped
    // — yet it IS the product's own confirmation affordance (the chip
    // replays its label/message as the user text, with no proposal
    // reference on the wire). A chip_click ingress or an
    // affirmative-prefixed reply therefore also pays the pendings read; the
    // resolver then requires an EXACT match against a proposal's rendered
    // copy before suppressing, so unrelated edit chips and fresh edit
    // commands proceed to the edit path untouched.
    const isProposalReplayCandidate =
      !isConfirmationShaped &&
      (ingress.source === 'chip_click' || AFFIRMATIVE_PREFIX_PATTERN.test(ingress.message));
    if (editVerbCandidate && (isConfirmationShaped || isProposalReplayCandidate)) {
      const resolution = await resolveProposalConfirmAtRoute(
        ingress.scenario_id,
        requestId,
        extensions.graphState ?? null,
        isConfirmationShaped ? null : ingress.message,
      );
      emit(TelemetryEvents.V5EditGraphProposalConfirmResolved, {
        request_id: requestId,
        scenario_id: ingress.scenario_id,
        outcome: resolution.outcome,
        live_candidate_count: resolution.kind === 'suppress' ? resolution.liveCount : 0,
      });
      if (resolution.kind === 'suppress') {
        proposalConfirmSuppressed = true;
      } else if (resolution.kind === 'clarify') {
        // No live, graph-safe proposal — return the deterministic
        // no-live-proposal clarification rather than dispatching an edit that
        // would no-op. This turn does NOT mutate the graph.
        const noProposalResponse = composeDirectAnswerResponse({
          assistant_text: NO_LIVE_PROPOSAL_TEXT,
          stage: ingress.stage,
          suggested_actions: [],
        });
        return sendFinalised200(reply, requestId, 'edit_graph', noProposalResponse, {
          graph: null,
          requestStartedAt: routeStartedAt,
          scenarioId: ingress.scenario_id,
          turnId: ingress.turn_id,
        userMessage: ingress.message,
        });
      }
      // resolution.kind === 'pass' (replay-candidate, no exact copy match):
      // not a confirmation — edit routing proceeds untouched.
    }
    // A confirmation routed to apply, or a state-query question, must bypass the
    // Stage-4A edit intercepts below — otherwise tryVagueEditGuard /
    // chip-simplify / label-intercept would claim the turn before it can be
    // applied (proposal) or answered (state-query guard in TurnExecutor).
    const bypassEditHandling = proposalConfirmSuppressed || stateQuerySuppressed;

    const chipSimplify = tryChipSimplifyIntercept(ingress.message);
    if (chipSimplify.matched && !bypassEditHandling) {
      emit(TelemetryEvents.V5InterceptedChipClarify, {
        request_id: requestId,
        scenario_id: ingress.scenario_id,
        source: chipSimplify.source,
        prior_analysis_is_fresh: priorAnalysisIsFresh,
      });
      const response = composeEditClarifyResponse({
        reason: 'chip_simplify',
        stage: ingress.stage,
        nodes: interceptNodes,
        priorAnalysisIsFresh,
      });
      return sendFinalised200(reply, requestId, 'edit_graph', response, {
        graph: null,
        requestStartedAt: routeStartedAt,
        scenarioId: ingress.scenario_id,
        turnId: ingress.turn_id,
      userMessage: ingress.message,
      });
    }

    // V5 post-analysis exploration intercept — narrow pre-LLM guards
    // for bare-label clicks and the legacy `Change <known label> —`
    // fill-in shape rendered by the pre-Touch-4 `buildLabelChip`. Both
    // shapes would otherwise dispatch to V4 `edit_graph`, the LLM
    // would no-op (no value to operate on), and the user would land
    // in the ambiguous no-op recovery dead end.
    //
    // Strictly gated on:
    //   - fresh prior analysis (no intercept before analysis exists),
    //   - non-empty graph nodes (need labels to match against),
    //   - no explicit edit verb (Predicate A — preserves real edits),
    //   - no mutation signal (defensive — preserves real edits),
    //   - no analytical-intent shape (Predicate A — preserves
    //     analytical questions that mention a label).
    //
    // Predicate B catches the legacy `Change <label> —` shape AND
    // rejects malformed shapes carrying a value after the dash.
    //
    // See src/orchestrator-v5/routing/post-analysis-label-intercept.ts
    // for the predicate and copy contracts.
    const labelIntercept = tryPostAnalysisLabelIntercept(
      ingress.message,
      interceptNodes,
      priorAnalysisIsFresh,
    );
    if (labelIntercept.matched && !bypassEditHandling) {
      emit(TelemetryEvents.V5PostAnalysisLabelIntercept, {
        request_id: requestId,
        scenario_id: ingress.scenario_id,
        predicate: labelIntercept.predicate,
        match_kind: labelIntercept.matchKind,
        node_kind: labelIntercept.matchedNode.kind,
        chips_emitted: 3,
      });
      const response = composePostAnalysisLabelInterceptResponse(
        labelIntercept.matchedNode.label,
        ingress.stage,
      );
      return sendFinalised200(reply, requestId, 'edit_graph', response, {
        graph: null,
        requestStartedAt: routeStartedAt,
        scenarioId: ingress.scenario_id,
        turnId: ingress.turn_id,
      userMessage: ingress.message,
      });
    }

    const vague = tryVagueEditGuard(ingress.message, interceptNodes);
    if (vague.matched && !bypassEditHandling) {
      const response = composeEditClarifyResponse({
        reason: 'vague_edit',
        stage: ingress.stage,
        nodes: interceptNodes,
        priorAnalysisIsFresh,
      });
      emit(TelemetryEvents.V5InterceptedVagueEdit, {
        request_id: requestId,
        scenario_id: ingress.scenario_id,
        prior_analysis_is_fresh: priorAnalysisIsFresh,
        chips_emitted: response.suggested_actions.length,
      });
      return sendFinalised200(reply, requestId, 'edit_graph', response, {
        graph: null,
        requestStartedAt: routeStartedAt,
        scenarioId: ingress.scenario_id,
        turnId: ingress.turn_id,
      userMessage: ingress.message,
      });
    }

    // Predicates, state-query suppression, and the proposal-confirmation
    // resolution were computed ABOVE (hoisted before the Stage-4A intercepts so
    // a confirmation / state-query cannot be claimed by tryVagueEditGuard et al.
    // before it is applied / answered). Edit intent is the candidate minus a
    // suppressed proposal confirmation.
    const editIntentDetected = editVerbCandidate && !proposalConfirmSuppressed;
    // Emit ONLY when the analytical-question guard is THE deciding
    // factor — i.e. the message WOULD have dispatched to edit_graph
    // had the guard not fired. The earlier loose condition (emit on
    // any positive-regex + analytical match) overstated the guard's
    // contribution because `EDIT_GRAPH_NEGATIVE_REGEX` and
    // `isValueUpdatePhrasing` already suppress some of those
    // messages. PR #194 review correction.
    if (
      analyticalQuestionDetected
      && positiveEditRegexHit
      && !negativeEditRegexHit
      && !valueUpdatePhrasingHit
    ) {
      emit(TelemetryEvents.V5EditGraphAnalyticalQuestionSuppressed, {
        request_id: requestId,
        scenario_id: ingress.scenario_id,
        intent_class: classifyAnalyticalIntent(ingress.message),
      });
    }
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
          return sendEditGraphRecovery(reply, requestId, ingress.scenario_id, ingress.stage, 'session_store_failed', ingress.message);
        }
        if (persisted == null) {
          return sendEditGraphRecovery(reply, requestId, ingress.scenario_id, ingress.stage, 'no_persisted_graph', ingress.message);
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
          return sendEditGraphRecovery(reply, requestId, ingress.scenario_id, ingress.stage, 'persisted_graph_invalid', ingress.message);
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
      // V5 edit lifecycle recovery v1 — chip-simplify and vague-edit
      // intercepts have already run BEFORE editIntentDetected (see
      // the block above). If we reach this point, neither matched
      // and we proceed with the V4 edit-graph dispatch.
      //
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
          requestStartedAt: routeStartedAt,
          scenarioId: ingress.scenario_id,
          turnId: ingress.turn_id,
        userMessage: ingress.message,
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

    // ────────────────────────────────────────────────────────────────────
    // Frame-stage no-brief guard — deterministic fallback for messages
    // that arrive at frame stage with no graph yet but do not look like a
    // fresh decision brief. Without this gate, such messages fall through
    // to TurnExecutor's broad routing LLM which (a) costs an extra Sonnet
    // call and (b) often hits max_tokens and emits the generic
    // "I couldn't complete that turn cleanly" fallback — a known
    // user-hostile UX when the user is retrying after a failed
    // draft_graph or sending a follow-up clarification.
    //
    // The previous (draft_graph) dispatch already filtered for the
    // brief-shaped messages; chip_click and system_event branches handled
    // those above. What reaches here at stage=frame + no graph is
    // necessarily a non-brief, non-chip user message. Guide them back to
    // the frame-stage flow deterministically with no LLM call.
    //
    // Pricing-brief retry scenario from staging:
    //   Turn 1: pricing brief → CEE_GRAPH_INVALID (no graph persisted)
    //   Turn 2: user replies "no status quo, just three options"
    //     - stage=frame, no graphState (Turn 1 failed → nothing persisted)
    //     - message does NOT match DRAFT_GRAPH_DECISION_BRIEF_REGEX
    //     - WAS falling through to runTurnExecutor → Sonnet max_tokens
    //       → "I couldn't complete that turn cleanly" generic fallback
    //     - NOW caught here, emits a deterministic framing prompt.
    // ────────────────────────────────────────────────────────────────────
    const isFrameNoBriefShape =
      ingress.stage === 'frame' &&
      extensions.graphState == null &&
      // V5 Signature Loop — a continuation (prior committed turns) must NOT get
      // the "start over" framing prompt; let it reach TurnExecutor's memory.
      !isContinuationScenario &&
      !isDraftGraphShape;
    if (isFrameNoBriefShape) {
      log.info(
        {
          event: 'v5.frame_stage_no_brief_guard',
          request_id: requestId,
          message_length: ingress.message.length,
          had_chip: ingress.chip != null,
        },
        'Frame-stage no-brief guard fired — emitting deterministic framing prompt instead of broad TurnExecutor LLM',
      );
      emit(TelemetryEvents.V5FrameStageNoBriefGuard, {
        request_id: requestId,
        message_length: ingress.message.length,
        had_chip: ingress.chip != null,
      });
      // Deterministic copy: short, directly corrective for retry cases,
      // with concrete examples matching the brief regex's positive
      // verbs. Does NOT echo the user's input (no PII leak risk).
      // Stays in frame stage so the UI remains on the graph-creation
      // path; suggested_actions / analysis_ready intentionally empty
      // (no analysis to surface pre-graph). Round-2 review tightening:
      // shorter than the original draft.
      const assistantText =
        "I need a single decision question to start. " +
        "For example: “Should we hire a tech lead or two developers?” or " +
        "“Whether to launch in Q3 or hold for Q4?” " +
        "Include the options you're comparing.";
      const guardResponse: import('@talchain/schemas/boundary').OlumiResponse = {
        response_version: 2,
        assistant_text: assistantText,
        blocks: [],
        suggested_actions: [],
        insights: [],
        stage_indicator: 'frame',
      } as import('@talchain/schemas/boundary').OlumiResponse;
      return sendFinalised200(reply, requestId, 'frame_no_brief_guard', guardResponse, {
        graph: null,
        requestStartedAt: routeStartedAt,
        scenarioId: ingress.scenario_id,
        turnId: ingress.turn_id,
      userMessage: ingress.message,
      });
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

    // Egress label-resolution graph. Prefer the AUTHORITATIVE graph the turn
    // actually reasoned over (`run.effectiveGraph` = request graphState parsed,
    // or the persisted-graph fallback the executor loaded when the request
    // omitted graphState) so the wire egress sanitiser resolves entity-id
    // labels against the SAME graph the durable assistant-text scrub used at
    // commit — stored text and wire text cannot diverge. Fall back to a local
    // parse of the ingress graphState only if the executor surfaced nothing
    // (defensive; `effectiveGraph` is always set by `finalizeRun`). Parse
    // failure / no graph → null; the sanitiser uses prefix-aware generic
    // wording without throwing.
    const turnGraph: GraphV3T | null =
      run.effectiveGraph !== undefined
        ? run.effectiveGraph
        : extensions.graphState
          ? (() => {
              const parsed = GraphV3.safeParse(extensions.graphState);
              return parsed.success ? parsed.data : null;
            })()
          : null;
    return sendFinalised200(reply, requestId, 'turn_executor', run.response, {
      analysisReady: run.analysisReady,
      graph: turnGraph,
      ...(run.freshness ? { freshness: run.freshness } : {}),
      requestStartedAt: routeStartedAt,
      scenarioId: ingress.scenario_id,
      turnId: ingress.turn_id,
      userMessage: ingress.message,
      ...(run.coachingDelivery ? { coachingDelivery: run.coachingDelivery } : {}),
      // Observability: thread the turn's real per-stage timings so the
      // flag-gated minimal diagnostic trace records the routing LLM call in
      // `_diagnostic_trace.llm_calls` (was structurally always empty on
      // turn_executor turns). Present only when timings capture is enabled.
      ...(run.turnTimings ? { turnTimings: run.turnTimings } : {}),
      // V5 M5 (read-only): thread the turn-executor's full canonical analysis
      // state into the flag-gated `_context_summary` diagnostic. When present
      // it supersedes the route's freshness-derived partial state (adds
      // degraded detection + contradictions over the unified fact chain).
      ...(run.canonicalState ? { canonicalState: run.canonicalState } : {}),
      // T4 Slice 2: the once-per-turn canonical context frame. When present,
      // the context-summary diagnostic is projected from the frame alone.
      ...(run.frame ? { frame: run.frame } : {}),
      // ROADMAP 1.42: thread the turn-executor's VERBATIM captured reasoning
      // into the flag-gated `_reasoning` sidecar (see sendFinalised200 ctx
      // jsdoc). Undefined when the flag was off or no thinking was captured.
      ...(run.reasoning ? { reasoning: run.reasoning } : {}),
      // ROADMAP 1.132: thread the turn-executor's validated answer shape
      // into the flag-gated `_answer_shape` sidecar (see sendFinalised200
      // ctx docs above).
      ...(run.answerShape ? { answerShape: run.answerShape } : {}),
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

