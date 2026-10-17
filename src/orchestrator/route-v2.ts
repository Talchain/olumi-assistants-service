import { buildCommitFailureBoundaryError, failedTurnReply } from '../orchestrator-v5/commit-failure-boundary.js';
/** Internal canvas writes, stored-card approval and Run dispatch. Conversation uses /agent/v1/turn. */
import { prepareHorizonBasisForWrite } from '../orchestrator-v5/goal-target/horizon-basis-provenance.js';

import { legacyEditFactsForFreshness } from '../orchestrator-v5/context/reconcile-scenario-analysis-facts.js';

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
 * Route registration is UNCONDITIONAL (server.ts) since 2026-07-20 — the
 * ENABLE_V5_ORCHESTRATOR flag was deleted in O-7 wave 2.
 *
 * Transport invariant: buffered JSON only (no raw-stream writes, no SSE
 * Content-Type). Checked by scripts/validate-transport-invariants.sh, which runs
 * ONLY from the manually-installed pre-push hook (scripts/install-hooks.sh) —
 * it is in no CI workflow, so it does not gate merges. Do not cite it as CI
 * enforcement; tests/meta/guard-liveness.test.ts pins that distinction.
 *
 * No imports from V4 pipeline (pipeline-v4, response-assembler, handlers).
 */

import { readGoalScopeClaimInput } from '../orchestrator-v5/compose/goal-scope-claim-input.js';

import type { FastifyInstance } from 'fastify';

import type {
  BoundaryError,
} from '@talchain/schemas/boundary';

import { emit, log, TelemetryEvents } from '../utils/telemetry.js';

import { config } from '../config/index.js';

import {
  debugFieldRequested,
  type OlumiResponseWithDebugFields,
} from './debug-fields.js';

import {
  getTurnDebugPromptCaptures,
  promptCaptureMayRideTheWire,
} from '../orchestrator-v5/debug/turn-debug-store.js';

import type {
  TurnTimingsBlock,
  V5TurnTimings,
} from '../orchestrator-v5/telemetry/turn-timings.js';

import type {
  V5DiagnosticExitPath,
  V5DiagnosticTrace,
  V5HandlerRefusal,
} from '../orchestrator-v5/diagnostics/v5-diagnostic-trace.js';

import { buildMinimalV5DiagnosticTrace } from '../orchestrator-v5/diagnostics/v5-diagnostic-trace.js';


// ROADMAP 1.233 — the Layer-2 gate's own reason type. Imported so the
// `claim_safety.withheld_projection_reason` stamp below is checked against the
// REAL union at compile time: the diagnostics module declares that member as a
// string literal union to stay dependency-free, and this import is what makes
// the two fail `pnpm typecheck` together if either drifts (CLAUDE.md trap #12 —
// a mirror must break at build time, not silently).
import type { WithheldExplanationReason } from '../orchestrator-v5/compose/withheld-explanation-answer.js';

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

import {
  guidedSizingOnWire,
  guidedSizingWireAction,
  parseGuidedSizingPress,
  type GuidedSizing,
} from '../orchestrator-v5/agent-lane/guided-sizing.js';

import { runHeldProposalApproval } from '../orchestrator-v5/handlers/approve-held-proposal.js';

import {
  MODEL_WRITE_OWNERSHIP_REFUSAL_BODY,
  ModelWriteOwnershipRefused,
} from '../orchestrator-v5/ownership/door-ownership.js';

// ⚠ The ADAPTER and the MINTER, not the writer beneath them. The
// consent-coverage guard pins that writer's production consumers at exactly
// one and its detector is a whole-file source-spelling scan including
// comments — so this file must not name it. Both default the session store
// internally, so no store import is needed and rule 3 is untouched.

import {
  dispatchSystemEvent,
  type DispatchSystemEventResult,
} from '../orchestrator-v5/system-events/dispatch.js';

import {
  modelReadFailedWire,
  withRevisionConflictWire,
} from '../orchestrator-v5/graph-revision-conflict.js';

// R2 — post-draft auto-run scheduler (fires AFTER the draft response is
// handed to the transport; see the draft_graph branch below).

// ROADMAP 2.1271 — the SAME two-term admission predicate the auto-run scheduler
// gates on. Imported (never re-implemented) so the `running` claim on the draft
// wire and the decision to run cannot come from two different rules.

// ROADMAP 2.735 — did THIS turn hand the client a graph to render? The one
// fact that separates a lost model from a draft that never existed.

import {
  finaliseV5Response,
  isFinalisedV5Response,
  type FinalisedV5Response,
} from '../orchestrator-v5/response-finaliser.js';

import { sanitiseOlumiResponseForEgress } from '../orchestrator-v5/compose/output-safety.js';

import type { MayNameLeadingOptionProvenance } from '../orchestrator-v5/context/claim-safety-read.js';

import { createTurnClaimSafetyResolver } from '../orchestrator-v5/context/turn-claim-safety.js';

import type { TurnClaimSafetyResolver } from '../orchestrator-v5/context/turn-claim-safety.js';

// T1 claim safety, LAYER 3 — armed ONCE at the send point (1.272 E1). It used
// to be called from inside `sanitiseOlumiResponseForEgress`, which this file
// re-enters 2–8 times per response and always upstream of `finaliseV5Response`.
import { guardLeadingOptionClaimsAtEgress } from '../orchestrator-v5/compose/leading-option-egress-guard.js';

import { enforceLeadingOptionClaimsAtWire } from '../orchestrator-v5/compose/leading-option-wire-enforcement.js';

import { classifyUserVisibleRefusal } from '../orchestrator-v5/compose/user-visible-refusal.js';

import {
  ANALYSIS_AUTHORITY_UNAVAILABLE_FRESHNESS,
  enforceAnalysisAuthorityUnavailableAtEgress,
  type AnalysisAuthorityUnavailableEgressMode,
} from '../orchestrator-v5/compose/analysis-authority-unavailable-notice.js';

// G3 — the one-way scenario-over-window precedence, applied at the finaliser
// seam beside the arm above. See that module for why the two derivations are
// named apart rather than reconciled.
import { resolveScenarioAnalysisSupersession } from '../orchestrator-v5/context/scenario-analysis-supersession.js';

import {
  ANSWER_SHAPE_COLLAPSE_FLOOR_CHARS,
  classifyAnswerShape,
  deriveAnswerTextFromShape,
  synthesiseAnswerShapeFromText,
  warrantsProgressiveDisclosure,
} from '../orchestrator-v5/routing/answer-shape.js';

import type { GraphV3T } from './types.js';

import { GraphV3 } from '../schemas/cee-v3.js';

import { getRequestId } from '../utils/request-id.js';

import {
  dispatchDeterministicChipClick,
  isDeterministicChipClickActionType,
} from '../orchestrator-v5/handlers/chip-click-dispatch.js';

import { runPreFlight } from './route-v2-preflight.js';

import {
  admitCurrentTurnFence,
  turnFencePreHandler,
} from './turn-fence-prehandler.js';

import { type GraphStateIngress } from '../orchestrator-v5/boundary/request-extensions.js';

import {
  buildTurnContext,
  loadDraftLossStands,
  loadMostRecentPendingActionsIntegrityStrict,
  loadMostRecentPendingActionsStrict,
  markDraftGraphWriteFailed,
} from '../orchestrator-v5/build-turn-context.js';

import { deriveAnalysisFreshness } from '../orchestrator-v5/context/freshness.js';

import { deriveAuthoritativeStage } from '../orchestrator-v5/context/derive-stage.js';

import { extractGraphOptionIds } from '../orchestrator-v5/context/option-identity.js';

import { dispatchAddOptionTransaction } from '../orchestrator-v5/handlers/add-option-dispatch.js';

import {
  statedTodayLevelsFor,
  userNamedOptionIdsFor,
} from '../orchestrator-v5/handlers/add-option-authorship-context.js';

import {
  GM_HELD_HANDLER_ID,
  buildHeldSupersessionNotice,
} from '../orchestrator-v5/handlers/edit-graph-referee-gate.js';

import { appendLapseNotice } from '../orchestrator-v5/handlers/hold-thread-through.js';

import type { FrameFreshness } from '../orchestrator-v5/graph-management/types.js';

import { computeAnalysisAffectingGraphHash } from '../orchestrator-v5/context/graph-hash.js';

import {
  isPendingActionExpired,
  type PendingAction,
} from '../orchestrator-v5/session/pending-action.js';
import { resolveProposalRenderCopy } from '../orchestrator-v5/compose/proposed-change.js';


import {
  commitDirectAnswer,
  computeRequestHash,
} from '../orchestrator-v5/commit.js';

// L16 / N16 — deterministic remedy for a bare configure-option turn.

// ⭐ ROADMAP 2.1266 — the ASK half of the option-effect write path (the WRITE
// half binds inside `dispatchEditGraph`, against the graph it applies to).

// ⭐ ROADMAP 2.1261 — repair-leg bare-value binding ("Set it to 0.12.").

// ⭐⭐ ROADMAP 2.1353 — every exit that solicits a reply persists the question.
// The fail-closed ordering (proposal ≫ memory ≫ referent) lives in ONE place;
// each site below derives its own referent and hands it in.

// ⭐ ROADMAP 2.1266 / A2 — the ONE owner of "is this message an answer to the
// missing-value ask?". Used HERE only as the cheap text gate that decides
// whether the pre-route pays for its reads; the slot resolution belongs to the
// resolvers below, never to this site.

// ⭐ C5 (6 Sep 2026) — the executor's OWN definition of "this message points at
// the canvas selection", consulted so the recorded-ask claim is withdrawn only
// when the selection genuinely owns the referent. Imported, never re-spelled.

/**
 * ROADMAP 2.709 invariant 6 — the draft-loss disclosure. Prepended by
 * `sendFinalised200` to any graph-less 200 on a scenario whose draft loss
 * STANDS (an UNRESOLVED, DISCLOSABLE loss mark + no committed graph), because
 * the client that lost the draft may be gone — this is the receipt channel
 * that does not depend on the socket the client aborted. Every clause is true
 * by construction of the gate that fires it: the loss is proven by the trace,
 * the emptiness by the graph read, and the redraft promise is kept by the
 * draft-shortcut unstranding term. Exported for the route test and for the
 * UI, which may key on this copy arriving as ordinary assistant text (no
 * wire-shape change — schema-skew hazard 1 avoided by construction).
 *
 * ⚠ 2.735 REMOVED the clause "— the graph you saw was never saved", and the
 *   reason is the second half of the same defect. Even with the marking gate
 *   fixed, a `draft_loss` can be marked on a turn whose commit was attempted
 *   WITHOUT any preview ever reaching a client (a buffered turn streams no
 *   GRAPH_READY frame at all). "The graph you saw" was therefore false for a
 *   whole class of genuine losses. Gating the marking and softening the copy
 *   are not alternatives: the first stops us disclosing non-events, the
 *   second stops us describing real events wrongly. What remains asserts only
 *   what the gate proves — a draft did not save, and nothing is stored.
 */
export const DRAFT_LOSS_NOTICE =
  "Heads-up: your last draft didn't save, so no model is stored for this " +
  "conversation yet. Send your decision brief again and I'll redraft it.";

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

// DERIVED from the diagnostics union (ROADMAP 2.63: this was a hand-synced
// twin of V5DiagnosticExitPath minus its error member — a silent-drift
// hazard). `draft_graph_error` is the only diagnostics-only member: it tags
// the 500 BoundaryError trace path, never a 200-OK exit through
// sendFinalised200. Adding a new 200-OK exit path now happens ONCE, in
// v5-diagnostic-trace.ts.
type V5ExitPath = Exclude<V5DiagnosticExitPath, 'draft_graph_error'>;

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
async function sendFinalised200(
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
     *  (turn_executor, chip_click, draft_graph, edit_graph, and value-carrying
     *  system-event writers). Reader/acknowledgement events omit it. */
    readonly freshness?: import('../orchestrator-v5/context/freshness.js').FreshnessDerivation;
    /**
     * G3 — the SCENARIO-BOUND freshness verdict, over the durable analysis
     * history rather than this turn's bounded window. Supplied by the
     * turn_executor exit from `TurnExecutorRunResult.scenarioFreshness`, and by
     * no other exit: it is the only dispatch that loads the durable carrier.
     *
     * ⚠ NOT A BETTER `freshness` — a DIFFERENT QUESTION (trap 21). Consumed
     * only through `resolveScenarioAnalysisSupersession` at the finaliser seam
     * below, which may correct a hot-window `none` and may correct nothing else.
     * Absent ⇒ no durable reasoning authority licensed it, and the seam changes
     * nothing.
     */
    readonly scenarioFreshness?: import('../orchestrator-v5/context/freshness.js').FreshnessDerivation;
    /**
     * The COMPLETED RERUN's fact window, threaded into `finaliseV5Response` so
     * it can stamp the run-over-run consequence block (`run_delta`). Supplied
     * by the turn_executor exit via `TurnExecutorRunResult.priorFacts`, which
     * sets it ONLY on a turn that completed a run and sets it to the canonical
     * post-dispatch window `[...handlerFactsForCommit, ...context.prior_facts]`
     * — see that field's docblock for why the turn-ENTRY window was the wrong
     * array (it omits the run the turn just produced).
     *
     * ⚠ THIS HOP IS A PASSTHROUGH AND MUST STAY ONE. The two questions —
     * "did a run complete?" and "is there an honest pair?" — are answered
     * upstream (the executor's gate) and downstream (the producer's refusals)
     * respectively. Re-deciding either here would be a third authority over one
     * answer (CLAUDE.md trap #12).
     *
     * ⚠ ABSENCE IS THE FAIL-CLOSED PATH AND IS FULLY SUPPORTED: a run result
     * that omits it stamps no `run_delta`, which is exactly what the contract
     * models ("absent on every non-rerun turn ... a consumer renders NO delta
     * card"). Never default it — `?? []` would assert "there were no prior
     * runs", which is a different and false claim from "this turn completed no
     * run". Pinned by `route-v2-run-delta-threading.test.ts`.
     */
    readonly priorFacts?: readonly import('@talchain/schemas/orchestrator').HandlerFact[];
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
     * S3-L6 / F-5 — edit-lane LLM call attribution threaded by the edit_graph
     * path from `eg.editLlmCall`. Folded into the flag-gated minimal
     * diagnostic trace below so an edit turn's `_diagnostic_trace.llm_calls[]`
     * carries the edit LLM call (model, tokens, wall-clock) instead of the
     * empty array the minimal builder emitted before. Undefined on
     * deterministic (no-LLM) edits; the builder then records nothing for it.
     * Never reaches the wire body outside the trace.
     */
    readonly editLlmCall?: import('../orchestrator-v5/diagnostics/v5-diagnostic-trace.js').EditGraphLlmCallTelemetry;
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
     * (UNCONDITIONAL since the F1 flag deletion) — same re-attach mechanic as
     * `_reasoning` — and NEVER on the fallback envelope.
     */
    readonly answerShape?: import('../orchestrator-v5/routing/answer-shape.js').AnswerShape;
    /**
     * SELECTION-AWARE ANSWERING (hop 4b) — the elements this turn's answer was
     * grounded on, threaded from `run.groundedSelection` and attached to the
     * wire body as `_grounded_selection` AFTER egress validation (same
     * re-attach mechanic as `_answer_shape`). Never on the fallback envelope.
     */
    readonly groundedSelection?: import('../orchestrator-v5/context/grounded-selection.js').GroundedSelection;
    /**
     * ROADMAP 1.132 (F1) — SUBSTANTIVE/FUNCTIONAL classification driving the
     * egress answer-shape synthesiser below. EGRESS-DEFAULT INVERSION (fourth F1
     * fix): the synthesiser now shapes UNLESS `answerKind === 'functional'`, so
     * a substantive / unclassified / explanation-handler answer shapes BY
     * DEFAULT. Threaded from `run.answerKind` (turn_executor, re-verified
     * fail-closed against the FINAL text at the finalise seam — its default is
     * `'substantive'`, so a NEW executor answer path shapes without per-site
     * wiring) and `cc.answerKind` (chip_click). CONSEQUENCE OF THE INVERSION:
     * every OTHER dispatch family that is functional copy (edit_graph /
     * clarify_v2 / readiness_intake / system_event / declines / guards / the
     * draft_graph intro) MUST now EXPLICITLY thread `answerKind: 'functional'` at
     * its `sendFinalised200` callsite — omission means SHAPE (the inverted
     * default), not skip. A functional site that forgets its mark ships one long
     * message behind Show-more (mild, and caught by the functional-marking
     * fail-loud guard — `route-egress-functional-marking.drift.test.ts`), never a
     * substantive answer silently un-shaped. See `responseCarriesDraftGraphBlock`
     * for the block-primary (draft_graph) exclusion.
     */
    readonly answerKind?: import('../orchestrator-v5/compose.js').AnswerKind;
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
    /**
     * T1 claim safety, LAYER 3 — may THIS turn name a leading option?
     *
     * `false` means the constraint verdict withheld the claim, so any copy on
     * the envelope naming or presuming a leader contradicts the turn's own
     * confirmation. Threaded straight to the egress sanitiser, which reports it
     * (observe-only) — see `orchestrator-v5/compose/leading-option-egress-guard.ts`.
     *
     * REQUIRED, same rationale as `userMessage` above: every dispatch path must
     * state the permission, so no path can disarm the guard by omission.
     *
     * ⚠ THE SENTENCE THAT USED TO SIT HERE IS NOW FALSE AND IS REPLACED RATHER
     * THAN QUIETLY DELETED (CLAUDE.md trap #14). It read: "Paths that ran no
     * analysis pass `true` — the honest 'nothing was withheld on this turn'."
     * That is the exact premise ROADMAP 1.233's finish-line criterion 2
     * refuted: the permission belongs to the fact the response DISPLAYS, not
     * to the work this turn performed, and an edit turn displays the prior
     * analysis. Seventeen exits shipped that `true` and thereby handed the
     * Layer-3 guard an explicit licence not to look.
     *
     * EVERY exit now READS it — never a literal:
     *   - `turn_executor` from `run.mayNameLeadingOption` (the verdict the
     *     run_analysis handler stamped, re-read post-dispatch by #737),
     *   - `chip_click` from `cc.mayNameLeadingOption`,
     *   - every other exit from the turn-entry resolver
     *     (`context/turn-claim-safety.ts`), which calls the SAME canonical
     *     `readMayNameLeadingOptionVerdict`.
     * Never re-derived here (CLAUDE.md trap #12).
     */
    /**
     * The caller has already removed identifiers from `assistant_text` by
     * IDENTITY against this turn's graph, so the pattern scrub must not run
     * over it again.
     *
     * Set by the replacement controller only. Absent everywhere else, so the
     * retired path is byte-identical. See `EgressSanitiseOpts` for the
     * measurement that made it necessary: the pattern arm rewrites ordinary
     * English, and it is unconditional.
     */
    readonly assistantTextAlreadyIdentifierSafe?: boolean;
    readonly mayNameLeadingOption: boolean;
    /** Same selected claim fact as mayNameLeadingOption on the executor path. */
    readonly claimConstraintVerdictState?: import('./context/constraint-feasibility.js').ConstraintVerdictState | null;
    readonly leaderWithheldBecauseUnsizedPath?: import('../orchestrator-v5/agent-lane/unsized-path-cause.js').UnsizedPathLeaderCause;
    readonly leaderWithheldBecauseUnrequested?: boolean;
    /**
     * WHERE the permission above came from (2026-07-27).
     *
     * ⚠ ALSO CORRECTED. It used to read: "Optional and absent on the
     * hardcoded-`true` exits by design: those turns consulted no analysis, so
     * `null` at the wire is the honest statement." There are no hardcoded
     * exits left, so that rationale describes nothing — and while it stood it
     * made a `null` provenance look principled at exactly the exits whose
     * permission was fabricated. Optional only so the two 500-adjacent
     * fallback shapes keep compiling; every 200 exit now carries a real one.
     * Threaded from the read, never re-derived here (CLAUDE.md trap #12).
     */
    // Derived from the source union, not re-listed — see the note in
    // v5-diagnostic-trace.ts. Two hand-typed copies of this union existed and
    // both went stale the moment a provenance state was added.
    readonly mayNameLeadingOptionProvenance?: MayNameLeadingOptionProvenance;
    /**
     * ROADMAP 1.233 — which branch the Layer-2 withheld-explanation gate took,
     * when the dispatch family HAS that gate and it ran. Optional and absent
     * everywhere else: the turn-executor is the only producer today, and an
     * absent value is stamped as `null` ("did not run"), which is honest for
     * every other family rather than a fabricated `'unchanged'`.
     *
     * Diagnostic only — it reaches the wire solely inside the flag-gated
     * `_diagnostic_trace.claim_safety`, never `response`.
     */
    readonly withheldExplanationReason?: WithheldExplanationReason;
    /**
     * WHICH handler declined this turn, and why, in stable codes. Present only
     * when the recoverable-handler composer answered; the turn-executor is the
     * only producer, and an absent value is stamped as nothing at all — there
     * is deliberately no "unknown" placeholder, because "this turn did not
     * refuse" and "it refused for a reason nobody can name" are different
     * claims and the second is the state this field exists to abolish.
     *
     * Diagnostic only — it reaches the wire solely inside the flag-gated
     * `_diagnostic_trace.handler_refusal`, never `response`.
     */
    readonly handlerRefusal?: V5HandlerRefusal;
    /**
     * ROADMAP 2.1271 — THIS turn started a provisional analysis and it is in
     * flight. Threaded by exactly ONE exit (draft_graph) and consumed only by
     * `composeAnalysisStateV1`'s `running` arm. Absent everywhere else, which is
     * the honest state: no other exit starts a run it can vouch for.
     *
     * Passed through to the finaliser as part of `ctx`; see
     * `orchestrator-v5/response-finaliser.ts::FinaliserContext.autoRunInFlight`
     * for why it deliberately does NOT join the freshness precedence chain.
     */
    readonly autoRunInFlight?: { readonly startedAt: string };
  },
): Promise<import('fastify').FastifyReply<{ Reply: V5RouteReply }>> {
  // System A-approved fail-closed arm: unreadable persisted analysis is not
  // the healthy "no analysis exists" state. Project the distinction at this
  // one 200-response seam so every dispatch family says what happened.
  const analysisAuthorityUnavailable =
    ctx.mayNameLeadingOptionProvenance === 'fail_closed_unavailable';
  // Provenance names where the canonical state supplied by the dispatch came
  // from. The fail-closed projection below may synthesise an unknown state for
  // the wire, but that must not relabel a route fallback as turn-executor.
  const canonicalStateSourceForSummary = ctx.canonicalState
    ? 'turn_executor'
    : 'route_fallback';
  // G3 — THE HEALTHY TWIN OF THE ARM BELOW, at the same seam and by design.
  //
  // The `analysisAuthorityUnavailable` arm substitutes a whole derivation when
  // the durable analysis authority could NOT BE READ, *"so a hot-window `none`
  // verdict cannot reappear as `never_run` after egress copy has already
  // disclosed that the scenario-wide read failed"*
  // (`compose/analysis-authority-unavailable-notice.ts`). G3 is the same harm
  // from the other direction: the durable authority COULD be read and holds a
  // `run_analysis` fact the bounded hot window has since lost, so the wire says
  // `none` — "never run" — about an analysis that exists.
  //
  // Evaluated only on the healthy arm, and the two are mutually exclusive by
  // construction besides: `fail_closed_unavailable` means no durable reasoning
  // authority, and the producer populates `scenarioFreshness` only when one was
  // licensed. The `? undefined :` is therefore belt-and-braces, and it is here
  // so the precedence cannot be reached from a state that has already declared
  // its read failed.
  const scenarioSupersession = analysisAuthorityUnavailable
    ? undefined
    : resolveScenarioAnalysisSupersession({
        windowFreshness: ctx.freshness,
        scenarioFreshness: ctx.scenarioFreshness,
        ...(ctx.analysisReady ? { readiness: ctx.analysisReady } : {}),
      });
  const analysisFinaliserContext = analysisAuthorityUnavailable
    ? {
        ...ctx,
        freshness: ANALYSIS_AUTHORITY_UNAVAILABLE_FRESHNESS,
        canonicalState: canonicalStateFromFreshness(
          ANALYSIS_AUTHORITY_UNAVAILABLE_FRESHNESS,
          ctx.analysisReady ? { readiness: ctx.analysisReady } : {},
        ),
      }
    : scenarioSupersession !== undefined
      ? {
          ...ctx,
          // ⚠ ADDITIVE, NEVER AN OVERWRITE. `ctx.freshness` and
          // `ctx.canonicalState` are left exactly as the dispatch supplied them,
          // so the authoritative top-level `graph_hash` stamp, the
          // `_context_summary` diagnostic below, and every other reader are
          // byte-identical. Only `analysis_ready.freshness` and `analysis_state`
          // read the two members added here — see `FinaliserContext`.
          analysisStateFreshness: scenarioSupersession.freshness,
          analysisStateCanonical: scenarioSupersession.canonicalState,
        }
      : ctx;
  const scopeInput = ctx.scenarioId === undefined ? undefined : await readGoalScopeClaimInput(
    ctx.graph,
    () => loadMostRecentPendingActionsIntegrityStrict(ctx.scenarioId!, requestId),
  );
  const finaliserContext = { ...analysisFinaliserContext, goalScopeClaimInput: scopeInput };
  let analysisAuthorityUnavailableEgressMode: AnalysisAuthorityUnavailableEgressMode =
    'substantive_replaced';
  // ── ROADMAP 2.709 invariant 6 — surface a STANDING draft loss ─────────
  // Persistence failure is never dark: when a scenario carries a
  // failure-marked fence row and no committed graph (the phantom state's
  // server half), every graph-less 200 tells the user plainly, because the
  // client that triggered the loss may have aborted its socket and gone.
  // Gated OFF for: system events (no user is reading), exits that carry a
  // graph (the loss just healed — `ctx.graph` is the committed graph of
  // THIS turn), and exits without a scenario id. The read degrades to
  // no-notice on any failure (loadDraftLossStands). This is the ONE async
  // step of this finaliser; every call site already `return`s it from an
  // async handler.
  let candidateForFinalise = candidate;
  let draftLossNoticeSurfaced = false;
  if (exitPath !== 'system_event' && ctx.graph == null && ctx.scenarioId !== undefined) {
    const lossStands = await loadDraftLossStands(ctx.scenarioId, requestId);
    if (lossStands) {
      draftLossNoticeSurfaced = true;
      candidateForFinalise = {
        ...candidateForFinalise,
        assistant_text: `${DRAFT_LOSS_NOTICE}\n\n${candidateForFinalise.assistant_text ?? ''}`.trimEnd(),
      } as import('@talchain/schemas/boundary').OlumiResponse;
      emit(TelemetryEvents.V5DraftLossNoticeSurfaced, {
        request_id: requestId,
        scenario_id: ctx.scenarioId,
        exit_path: exitPath,
      });
    }
  }
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
  const candidateFinalised = finaliseV5Response(
    candidateForFinalise,
    finaliserContext,
  );
  // Display-only guided data follows the existing post-validation sidecar
  // transport. The published Action schema has no parameters member yet.
  const guidedSizingForWire = (candidateFinalised as typeof candidateFinalised & { guided_sizing?: GuidedSizing }).guided_sizing;
  const guidedActionsForWire = new Set<string>();
  if (guidedSizingForWire?.v === 1 && guidedSizingForWire.graph_hash && guidedSizingForWire.run_key
    && Array.isArray(guidedSizingForWire.links)) {
    for (const link of guidedSizingForWire.links) {
      const action = candidateFinalised.suggested_actions.find(a => a.id === link.press?.id);
      const selected = parseGuidedSizingPress(link.press);
      if (action !== undefined && selected !== null
        && selected.from === link.from && selected.to === link.to
        && (link.id === undefined || selected.edge_id === link.id)) guidedActionsForWire.add(action.id);
    }
  }
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
    // (same defence-in-depth posture as `_reasoning`): the re-attach block
    // below is the sole authority, and the strict `OlumiResponseSchema` must
    // not see an unknown key.
    const hasAnswerShape = '_answer_shape' in asRecord;
    // Hop 4b — `_grounded_selection` is threaded via `ctx`, never body-attached
    // by any dispatch path today. Stripped defensively anyway (same
    // defence-in-depth posture as `_answer_shape`): the re-attach block below
    // is the sole authority, and the strict `OlumiResponseSchema` must not see
    // an unknown key.
    const hasGroundedSelection = '_grounded_selection' in asRecord;
    // HARNESS VISIBILITY — `_prompt_capture` is READ FROM THE TURN-DEBUG
    // STORE at the re-attach gate below, never body-attached by any dispatch
    // path. Stripped defensively anyway (same defence-in-depth posture as
    // `_context_summary`): the re-attach gate is the sole authority, and the
    // strict `OlumiResponseSchema` must not see an unknown key.
    const hasPromptCapture = '_prompt_capture' in asRecord;
    const hasGuidedSizing = 'guided_sizing' in asRecord;
    if (
      !hasTimings &&
      !hasTrace &&
      !hasContextSummary &&
      !hasReasoning &&
      !hasAnswerShape &&
      !hasGroundedSelection &&
      !hasPromptCapture &&
      !hasGuidedSizing &&
      guidedActionsForWire.size === 0
    ) {
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
    delete cloned._grounded_selection;
    delete cloned._prompt_capture;
    delete cloned.guided_sizing;
    cloned.suggested_actions = candidateFinalised.suggested_actions.map(guidedSizingWireAction);
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
          // S3-L6 / F-5: thread the edit-lane LLM call so the edit turn's trace
          // records it in `llm_calls[]` (previously always empty on this path).
          ...(ctx.editLlmCall ? { editLlmCall: ctx.editLlmCall } : {}),
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
    mayNameLeadingOption: ctx.mayNameLeadingOption,
    ...(ctx.assistantTextAlreadyIdentifierSafe === true ? { assistantTextAlreadyIdentifierSafe: true } : {}),
  });
  const egress = validateEgress(candidateSanitised, requestId);
  let wireBody = egress.ok
    ? finaliseV5Response(
        sanitiseOlumiResponseForEgress(egress.value, { graph: ctx.graph, requestId, exitPath, userMessage: ctx.userMessage, mayNameLeadingOption: ctx.mayNameLeadingOption,
    ...(ctx.assistantTextAlreadyIdentifierSafe === true ? { assistantTextAlreadyIdentifierSafe: true } : {}) }),
        finaliserContext,
      )
    : finaliseV5Response(
        sanitiseOlumiResponseForEgress(egress.fallback, { graph: ctx.graph, requestId, exitPath, userMessage: ctx.userMessage, mayNameLeadingOption: ctx.mayNameLeadingOption,
    ...(ctx.assistantTextAlreadyIdentifierSafe === true ? { assistantTextAlreadyIdentifierSafe: true } : {}) }),
        finaliserContext,
      );
  if (!egress.ok) {
    log.error(
      { request_id: requestId, exit_path: exitPath },
      'V5 egress validation failed — returning typed fallback envelope (post-finalised)',
    );
  }
  // Persisted analysis being unreadable is distinct from a healthy empty
  // history. Apply the user-visible projection immediately after validation,
  // before any debug/product sidecar re-attach, so every later surface is
  // derived from the truthful replacement rather than from stale model prose.
  // Functional receipts and typed fallbacks keep their validated content and
  // receive the limitation; arbitrary substantive output is replaced.
  if (analysisAuthorityUnavailable) {
    const projected = enforceAnalysisAuthorityUnavailableAtEgress(wireBody, {
      answerKind: ctx.answerKind,
      egressOk: egress.ok,
    });
    analysisAuthorityUnavailableEgressMode = projected.mode;
    const responseWithStandingDraftLoss =
      draftLossNoticeSurfaced &&
      !projected.response.assistant_text?.includes(DRAFT_LOSS_NOTICE)
        ? {
            ...projected.response,
            assistant_text:
              `${DRAFT_LOSS_NOTICE}\n\n${projected.response.assistant_text ?? ''}`.trimEnd(),
          }
        : projected.response;
    wireBody = finaliseV5Response(responseWithStandingDraftLoss, finaliserContext);
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
      sanitiseOlumiResponseForEgress(augmented, { graph: ctx.graph, requestId, exitPath, userMessage: ctx.userMessage, mayNameLeadingOption: ctx.mayNameLeadingOption,
    ...(ctx.assistantTextAlreadyIdentifierSafe === true ? { assistantTextAlreadyIdentifierSafe: true } : {}) }),
      finaliserContext,
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
      // ROADMAP 1.233 — T1 claim safety, made readable by an HTTP acceptance
      // walk. Stamped HERE because this is the ONE place every dispatch
      // family's trace passes through on its way to the wire; wiring it into
      // each builder instead would be the per-site enumeration that CLAUDE.md
      // trap #12 (and this file's own EGRESS-DEFAULT INVERSION comment) says
      // always misses a sibling.
      //
      // NOT a second derivation: `may_name_leading_option` is the SAME
      // `ctx.mayNameLeadingOption` handed to `sanitiseOlumiResponseForEgress`
      // on the lines above and below, so the trace cannot disagree with the
      // guard it reports on. `withheld_projection_reason` is the gate's own
      // returned `reason`, threaded through the run result — not re-inferred
      // from the text.
      claim_safety: {
        may_name_leading_option: ctx.mayNameLeadingOption,
        // The provenance discriminator (2026-07-27). Same single-derivation
        // rule as the boolean beside it: threaded from the exit's own read,
        // never re-inferred here — the trace must not be able to disagree with
        // the read it reports on.
        //
        // ⚠ THE `null` RATIONALE THAT USED TO SIT HERE IS GONE WITH THE THING
        // IT DESCRIBED. It said `null` was honest "on the exits that hand the
        // route a hardcoded permission rather than a read one … those turns
        // did not consult a fact". Every 200 exit now consults one, so a
        // `null` here no longer means "nothing to report" — it means an exit
        // reached this stamp without a provenance, which is a defect worth
        // seeing rather than a state worth explaining away.
        verdict_provenance: ctx.mayNameLeadingOptionProvenance ?? null,
        withheld_projection_reason: ctx.withheldExplanationReason ?? null,
      },
      // ⭐⭐ WHICH THROW DECLINED THIS TURN. Stamped HERE for exactly the reason
      // `claim_safety` above is: this is the ONE place every dispatch family's
      // trace passes through on its way to the wire, so wiring it into each
      // builder instead would be the per-site enumeration that always misses a
      // sibling.
      //
      // OMITTED, not nulled, on a turn that did not refuse — an absent key
      // honestly means "no handler declined", and a present one is always a
      // real refusal. Threaded from the turn-executor's own catch and never
      // re-derived here, so the trace cannot disagree with the error it
      // reports on.
      ...(ctx.handlerRefusal ? { handler_refusal: ctx.handlerRefusal } : {}),
    };
    const augmented: OlumiResponseWithDebugFields = {
      ...wireBody,
      _diagnostic_trace: stampedTrace,
    };
    wireBody = finaliseV5Response(
      sanitiseOlumiResponseForEgress(augmented, { graph: ctx.graph, requestId, exitPath, userMessage: ctx.userMessage, mayNameLeadingOption: ctx.mayNameLeadingOption,
    ...(ctx.assistantTextAlreadyIdentifierSafe === true ? { assistantTextAlreadyIdentifierSafe: true } : {}) }),
      finaliserContext,
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
      ctx.frame !== undefined && !analysisAuthorityUnavailable
        ? contextSummaryFromFrame(
            ctx.frame,
            config.cee.coachingStatePackEnabled ? ctx.canonicalState : undefined,
          )
        : null;
    if (contextSummary === null) {
      const canonical: CanonicalAnalysisState | null =
        finaliserContext.canonicalState ??
        (finaliserContext.freshness !== undefined
          ? canonicalStateFromFreshness(
              finaliserContext.freshness,
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
          canonicalStateSource: canonicalStateSourceForSummary,
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
        sanitiseOlumiResponseForEgress(augmented, { graph: ctx.graph, requestId, exitPath, userMessage: ctx.userMessage, mayNameLeadingOption: ctx.mayNameLeadingOption,
    ...(ctx.assistantTextAlreadyIdentifierSafe === true ? { assistantTextAlreadyIdentifierSafe: true } : {}) }),
        finaliserContext,
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
  if (
    egress.ok &&
    !analysisAuthorityUnavailable &&
    config.features.reasoningCaptureEnabled &&
    ctx.reasoning
  ) {
    const augmented: OlumiResponseWithDebugFields = {
      ...wireBody,
      _reasoning: ctx.reasoning,
    };
    wireBody = finaliseV5Response(
      sanitiseOlumiResponseForEgress(augmented, { graph: ctx.graph, requestId, exitPath, userMessage: ctx.userMessage, mayNameLeadingOption: ctx.mayNameLeadingOption,
    ...(ctx.assistantTextAlreadyIdentifierSafe === true ? { assistantTextAlreadyIdentifierSafe: true } : {}) }),
      finaliserContext,
    );
  }
  // Re-attach `_answer_shape` post-validation on the success path (ROADMAP
  // 1.132, same re-attach shape as `_reasoning` above; UNCONDITIONAL since
  // the F1 flag deletion). `ctx.answerShape` is threaded from
  // `run.answerShape` (turn-executor) — the VALIDATED coach/converse shape
  // whose derived text was the final assistant_text when the executor
  // finalised. The fallback envelope never carries it; an upstream
  // body-attach was dropped by the strip step above. Re-finalise for WeakSet
  // membership, same as the other surfaces.
  //
  // Stale-sidecar fail-closed (P1 hardening): the tie between the shape and the
  // text the user actually receives is verified HERE — covering every rewriter
  // between the executor's compose-time capture and this point (the executor's
  // own STEP 6.6 / goal-receipt / backstop / finaliser guards are re-checked in
  // finalizeRun; THIS check additionally covers the route-level
  // sanitiseOlumiResponseForEgress entity-id scrub). Mismatch ⇒ ship the body
  // WITHOUT the sidecar, never a shape describing text the user never sees. The
  // comparison runs on the POST-sanitise augmented body.
  //
  // ⚠ THIS BLOCK IS NO LONGER "THE LAST BODY MUTATION BEFORE SEND" — corrected
  // 2026-07-31, and the old sentence is quoted rather than deleted (CLAUDE.md
  // trap #14) because it was load-bearing for the argument above: it read
  // *"this block is the LAST body mutation before send, so the tie … is verified
  // HERE, at the true final egress"*. ROADMAP 2.149 added the claim-safety wire
  // gate DOWNSTREAM of both shape passes, and that gate can rewrite
  // `assistant_text`. The tie check here is therefore no longer sufficient on
  // its own, which is exactly why the wire gate DROPS `_answer_shape` whenever
  // it edits the answer rather than relying on this comparison to notice.
  // Neither guard is now the last word alone; read them together.
  //
  // ⭐ THE COLLAPSE FLOOR (added 18 Sep 2026). The sidecar is a WIRE DIRECTIVE
  // to collapse: `MessageBubble.tsx` renders `<AnswerBody>` INSTEAD of the
  // free-text body whenever it arrives. Below the floor the deployed UI would
  // have shown the answer WHOLE, so attaching it there replaces "the user reads
  // all of it" with "the user reads one sentence" — the measured founder
  // defect. `warrantsProgressiveDisclosure` is applied to `derivedText`, the
  // exact string `assistant_text` carries on the wire, because that is what the
  // UI's own clamp measures. Rationale, the deployed-bundle derivation and the
  // drift analysis: `answer-shape.ts` → ANSWER_SHAPE_COLLAPSE_FLOOR_CHARS.
  //
  // Note the ORDER: the floor is checked BEFORE the fail-closed tie
  // verification below, never instead of it. Declining to collapse ships
  // `wireBody` untouched — the executor already set `assistant_text` to this
  // same derived text, so nothing is lost and no new text/shape pair is minted.
  const shapeDerivedText = ctx.answerShape ? deriveAnswerTextFromShape(ctx.answerShape) : '';
  if (
    egress.ok &&
    !analysisAuthorityUnavailable &&
    ctx.answerShape &&
    !warrantsProgressiveDisclosure(shapeDerivedText)
  ) {
    // Announced, never silent — see V5AnswerShapeDeclinedBelowFloor. This is
    // the positive witness that the egress DID reach a shapeable answer here.
    emit(TelemetryEvents.V5AnswerShapeDeclinedBelowFloor, {
      request_id: requestId,
      exit_path: exitPath,
      dispatch_path: 'route_egress_model_shape',
      final_text_length: shapeDerivedText.length,
      floor_chars: ANSWER_SHAPE_COLLAPSE_FLOOR_CHARS,
    });
  }
  if (
    egress.ok &&
    !analysisAuthorityUnavailable &&
    ctx.answerShape &&
    warrantsProgressiveDisclosure(shapeDerivedText)
  ) {
    const augmented: OlumiResponseWithDebugFields = {
      ...wireBody,
      _answer_shape: ctx.answerShape,
    };
    const withShape = finaliseV5Response(
      sanitiseOlumiResponseForEgress(augmented, { graph: ctx.graph, requestId, exitPath, userMessage: ctx.userMessage, mayNameLeadingOption: ctx.mayNameLeadingOption,
    ...(ctx.assistantTextAlreadyIdentifierSafe === true ? { assistantTextAlreadyIdentifierSafe: true } : {}) }),
      finaliserContext,
    );
    const derivedText = shapeDerivedText;
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
  // ROADMAP 1.132 (F1) — EGRESS-DEFAULT INVERSION (fourth F1 fix). Progressive
  // disclosure for long ANSWER prose. The previous three fixes SCOPED shaping to
  // sites explicitly declared `answerKind === 'substantive'` and each MISSED a
  // sibling substantive site (advice gate, then the LLM EXPLANATION HANDLER
  // answers — explain_results / what_would_flip: d9ac487d "bottom line" /
  // 86654fd0 "pre-mortem" — which compose via `composeToolCallResponse` and were
  // never declared substantive). Each miss passed every test yet shipped
  // un-shaped on the live wire. This ends the whack-a-mole by INVERTING the
  // default: shape ANY answer UNLESS it is explicitly FUNCTIONAL.
  //
  // GATE — shape when ALL hold:
  //   1. `ctx.answerKind !== 'functional'` — substantive/unclassified/
  //      explanation-handler/any-new answer path shapes BY DEFAULT (fails toward
  //      the goal). Only the small, stable FUNCTIONAL set (clarify questions,
  //      add-option / edit receipts, declines, recovery copy, and the
  //      edit_graph / clarify_v2 / readiness_intake / system_event dispatch
  //      families) is marked `'functional'` and stays plain. `answerKind` is
  //      threaded from `run.answerKind` (turn_executor, re-verified fail-closed
  //      at the finalise seam), `cc.answerKind` (chip_click), and the explicit
  //      functional mark on every other dispatch family's `sendFinalised200`.
  //   2. NO `draft_graph` block — a draft-graph response's user-facing artifact
  //      is the GRAPH, not the prose; its brief intro must not be reshaped. This
  //      is the ONE block type that means "the block is the answer". Phase-3
  //      lifecycle blocks (review_card / coaching / evidence / analysis_result)
  //      ACCOMPANY a substantive prose answer — the explanation handlers carry
  //      them on a fresh post-analysis turn — and MUST NOT suppress shaping, so
  //      the guard is draft_graph-specific, NOT "any non-empty blocks".
  //   3. no `_answer_shape` already present (the executor/chip already shaped it).
  //   4. non-blank assistant_text; and `synthesiseAnswerShapeFromText` returns a
  //      shape only when there is a remainder after the first sentence — a terse
  //      single-sentence functional one-liner is skipped (returns null).
  //
  // Byte-equality is preserved BY CONSTRUCTION (approach b): we SET
  // `assistant_text := deriveAnswerTextFromShape(synth)`, so the tie the
  // sidecar contract requires holds by identity. Approach (a) — find a shape
  // whose derive() equals the ORIGINAL bytes — is provably impossible for the
  // hard case (single-paragraph prose has zero `\n\n`, but every derived text
  // joins a non-blank headline and detail with `\n\n`), so (b) is the only
  // general solution.
  //
  // Fail-closed net: the shape is synthesised BEFORE the egress sanitiser,
  // then we re-verify the tie on the POST-sanitise body. If the sanitiser
  // perturbed the derived text (entity-id scrub), we REVERT to the original
  // `wireBody` entirely — never ship a mutated assistant_text without its
  // matching sidecar.
  if (
    egress.ok &&
    !analysisAuthorityUnavailable &&
    ctx.answerKind !== 'functional' &&
    !responseCarriesDraftGraphBlock(wireBody) &&
    !('_answer_shape' in (wireBody as Record<string, unknown>)) &&
    typeof wireBody.assistant_text === 'string' &&
    wireBody.assistant_text.trim().length > 0
  ) {
    const synth = synthesiseAnswerShapeFromText(wireBody.assistant_text);
    // ⭐ THE COLLAPSE FLOOR (18 Sep 2026) — see
    // ANSWER_SHAPE_COLLAPSE_FLOOR_CHARS in `answer-shape.ts` for the measured
    // defect, the deployed-bundle derivation of 3,000 and why the cross-service
    // drift is benign in both directions.
    //
    // Declining here leaves `wireBody` COMPLETELY untouched — no sidecar AND no
    // blank-line reflow — so a short answer ships exactly as its author composed
    // it. The reflow is part of the disclosure treatment, not a free readability
    // win, and applying half a treatment is how a text/shape pair drifts apart.
    //
    // ⚠ The floor is checked on `derived`, NOT on `wireBody.assistant_text`.
    // They differ: derivation re-joins headline/bullets/detail with `\n\n`. The
    // UI's clamp measures the RENDERED string, so the derived text is the only
    // one that answers the same question the UI is asking.
    if (synth !== null && !warrantsProgressiveDisclosure(deriveAnswerTextFromShape(synth))) {
      // Announced, never silent — see V5AnswerShapeDeclinedBelowFloor. The
      // answer WAS shapeable and the egress DID run: this event is what stops
      // a future silent dispatch-path miss reading as "short answer".
      emit(TelemetryEvents.V5AnswerShapeDeclinedBelowFloor, {
        request_id: requestId,
        exit_path: exitPath,
        dispatch_path: 'route_egress_synthesised',
        final_text_length: wireBody.assistant_text.length,
        floor_chars: ANSWER_SHAPE_COLLAPSE_FLOOR_CHARS,
      });
    }
    if (synth !== null && warrantsProgressiveDisclosure(deriveAnswerTextFromShape(synth))) {
      const derived = deriveAnswerTextFromShape(synth);
      const augmented: OlumiResponseWithDebugFields = {
        ...wireBody,
        assistant_text: derived,
        _answer_shape: synth,
      };
      const withSynth = finaliseV5Response(
        sanitiseOlumiResponseForEgress(augmented, { graph: ctx.graph, requestId, exitPath, userMessage: ctx.userMessage, mayNameLeadingOption: ctx.mayNameLeadingOption,
    ...(ctx.assistantTextAlreadyIdentifierSafe === true ? { assistantTextAlreadyIdentifierSafe: true } : {}) }),
        finaliserContext,
      );
      const synthFinalText =
        typeof withSynth.assistant_text === 'string' ? withSynth.assistant_text : '';
      if (synthFinalText === derived) {
        wireBody = withSynth;
        emit(TelemetryEvents.V5AnswerShapeEmitted, {
          request_id: requestId,
          exit_path: exitPath,
          source: 'route_egress_synthesised',
          headline_length: synth.headline.length,
          bullet_count: synth.bullets.length,
          detail_length: synth.detail.length,
          answer_shape_kind: classifyAnswerShape(synth),
        });
      } else {
        // Sanitiser perturbed the derived text — fail closed, keep the
        // un-shaped prose rather than ship a sidecar describing text the
        // user never sees.
        emit(TelemetryEvents.V5AnswerShapeDroppedStale, {
          request_id: requestId,
          exit_path: exitPath,
          dispatch_path: 'route_egress_synthesised',
          final_text_length: synthFinalText.length,
          derived_text_length: derived.length,
        });
      }
    }
  }
  // ═══════════════════════════════════════════════════════════════════════════
  // T1 claim safety — ENFORCEMENT AT THE WIRE. (ROADMAP 2.149.)
  //
  // THE POPULATION. This file's `sendFinalised200` call sites — however many
  // there are TODAY. The number is deliberately NOT written here.
  //
  // ⚠ THIS COMMENT HAS NOW CARRIED A WRONG COUNT TWICE. It read "nineteen",
  // was corrected to "twenty-one" on 2026-08-17 in the very same edit that said
  // "do not re-type a number here" — and by 2026-08-18 it was twenty-two. The
  // second correction was the same defect as the first: UPDATING a hand-typed
  // number resets the clock on the mirror instead of removing it (trap 12). So
  // the figure is gone rather than refreshed. The population is DERIVED by a
  // balanced-paren enumeration in
  // `__tests__/route-egress-analysis-state-freshness.drift.test.ts` (and the
  // claim-safety marking guard beside it), which fails loud on a new exit.
  // Read the guard; do not restore a number here.
  //
  // ALL BUT THE EXECUTE EXIT return BEFORE `runTurnExecutor`, so they never pass
  // through `finalizeRun`'s `enforceWithheldLeaderClaimGuard` (#755) — which is
  // a function NESTED inside `runTurnExecutor`, closed over run-local state, and
  // therefore not callable from here even deliberately. ⚠ THE EXACT SPLIT WAS
  // NOT RE-DERIVED by the 2.1264 lane: it is a CONTROL-FLOW property and the
  // lane only measured the call-site count, so "eighteen of nineteen" has been
  // replaced with the qualitative statement rather than with a number nobody
  // measured. The conclusion is untouched either way. Some of those exits carry
  // model-authored text (`chip_click` ok, `draft_graph`, and the MAIN edit
  // exit), and the main edit exit is where the 28 Jul live confirmation caught a
  // withheld leader claim shipping at HTTP 200.
  //
  // WHY HERE AND NOT PER-EXIT. A per-exit edit is one place per exit for the
  // next exit to be forgotten — the hand-maintained mirror
  // (CLAUDE.md trap #12). This is the file's SOLE `reply.code(200).send`, it is
  // type-branded and grep-gated, and every exit already threads a REAL verdict
  // (#737 / ROADMAP 1.233 — no literal survives, pinned by
  // `claim-safety-non-execute-exits-route-level.test.ts`'s drift guard). So the
  // guard consumes `ctx.mayNameLeadingOption` and covers every exit by
  // construction, including exits that do not exist yet.
  //
  // ORDERING — THREE CONSTRAINTS, ALL SATISFIED AT THIS LINE:
  //   1. AFTER every pass that can edit user-facing prose. `compose/
  //      terminology-rewrite.ts` MANUFACTURES "leading option"; a gate upstream
  //      of it reads clean prose and passes the banned string through.
  //   2. AFTER both `_answer_shape` passes above, which rewrite
  //      `assistant_text` wholesale. Hence the sidecar drop below.
  //   3. BEFORE the Layer-3 alarm, and that is deliberate — see the alarm's own
  //      block, which now explains why.
  //
  // BYTE-NEUTRAL WHEN PERMITTED. `enforceLeadingOptionClaimsAtWire` returns the
  // input BY REFERENCE on a permitted turn and on a withheld turn whose prose
  // designates nothing, so `wireBody` is not even reassigned. Over-suppression
  // is a failure here, not a safe default (#755's first cut destroyed an honest
  // receipt); the PERMIT-WINS arms in the route-level suite are what pin it.
  //
  // NO RE-SANITISE. The projection only REMOVES text and substitutes one fixed,
  // module-load-probed constant, so it cannot introduce the entity-ID leak
  // `sanitiseOlumiResponseForEgress` exists to catch. Re-finalising is still
  // required: the spread breaks WeakSet membership (the finaliser brand).
  // ═══════════════════════════════════════════════════════════════════════════
  // Read ONCE from the composed claim on this body and handed to BOTH rails, so the enforcer and the Layer-3
  // alarm cannot disagree about which turns keep the leader with the provisional caveat (DL #77 5913488508 item 2).
  const wireSeparationEstablished =
    (
      wireBody as {
        readonly analysis_state?: {
          readonly leader_claim?: { readonly separation?: unknown };
        };
      }
    ).analysis_state?.leader_claim?.separation === 'separated';
  const wireEnforcement = enforceLeadingOptionClaimsAtWire(wireBody, {
    requestId,
    exitPath,
    mayNameLeadingOption: ctx.mayNameLeadingOption,
    ...(ctx.assistantTextAlreadyIdentifierSafe === true ? { assistantTextAlreadyIdentifierSafe: true } : {}),
    // Read ONLY for the option ROSTER — "which options exist", never "which one
    // leads". The gate enters only when the prose NAMES one of this scenario's
    // own options, which is what spares "sales leads improved" and every other
    // ordinary use of the shared vocabulary. `null` here disarms the gate for
    // this turn and is REPORTED, not silent — see the opts docstring.
    graph: ctx.graph,
    // ⭐ THE ROSTER FALLBACK, AND IT IS THE MAJORITY PATH — NOT A CORNER.
    // `graph: null` disarmed this gate on 17 of the 23 `sendFinalised200` exits
    // (measured at `0d070df0` with the balanced-paren scan in
    // `__tests__/route-egress-analysis-state-freshness.drift.test.ts`; a FLOOR,
    // because the other six pass nullable expressions — `turnGraph` is
    // `GraphV3T | null`). On every one of those a withheld leader claim shipped
    // intact while the record correctly said `permitted:false`.
    //
    // Same read as the graph: WHICH OPTIONS EXIST, never which one leads. The
    // verdict above (`mayNameLeadingOption`) is untouched and still owns that
    // question — this only gives the gate the names it needs to act on the
    // answer it already has.
    //
    // Threaded HERE, at the one call site every exit funnels through, so a new
    // dispatch family inherits it by construction rather than by anyone
    // remembering to add it. The population assertions in
    // `compose/__tests__/leader-roster-fallback.test.ts` RED if that stops
    // being true.
    analysisReady: ctx.analysisReady,
    // ⭐ READ, NOT RE-DERIVED. `composeLeaderClaim` remains the sole author of
    // the separation question; this threads the value it ALREADY published on
    // the very body being enforced, so the enforcer and every structured
    // consumer read one interpretation rather than two. Absent field ⇒ absent
    // operand ⇒ today's behaviour exactly.
    separationEstablished: wireSeparationEstablished,
    // ⭐ THE NARROWING OPERAND, from the SAME already-composed claim on this
    // very body — so the enforcer and every structured consumer read ONE
    // interpretation of the separation question rather than two. Absent field
    // ⇒ absent operand ⇒ today's behaviour exactly.
    //
    // ⚠ The RAW REASON is threaded, not a boolean derived here. Classifying it
    // is `leaderClaimReasonKind`'s job and it lives with the producer that
    // mints the codes; deriving a second opinion at this call site is how one
    // subsystem ends up with two answers to one question.
    leaderClaimWithheldReason: (() => {
      const reason = (
        wireBody as {
          readonly analysis_state?: {
            readonly leader_claim?: { readonly withheld_reason?: unknown };
          };
        }
      ).analysis_state?.leader_claim?.withheld_reason;
      return typeof reason === 'string' ? reason : undefined;
    })(),
  });
  if (wireEnforcement.changed) {
    let projected: import('@talchain/schemas/boundary').OlumiResponse =
      wireEnforcement.response;
    // ⚠ THE SIDECAR MUST GO WITH THE EDIT, and this is the whole reason the
    // guard can sit downstream of the shape passes. `_answer_shape`
    // RECONSTRUCTS the answer verbatim (`deriveAnswerTextFromShape` rejoins
    // headline + bullets + detail). Left attached after a claim-safety edit it
    // would (a) describe text the user never sees and (b) carry the removed
    // designation in its own fields — the suppression would be undone by its
    // own sidecar. The two exact-equality checks above fail closed on a
    // mismatch, but neither is a test and neither knows about this edit, so the
    // drop is explicit here rather than inherited from another guard's
    // unpinned invariant. Pinned by the route-level suite: `_answer_shape` must
    // be ABSENT from the wire body whenever this gate edited the ANSWER.
    //
    // SCOPED TO `assistant_text`, deliberately. The sidecar describes THAT
    // field and no other, so a `framing_question`-only edit leaves a sidecar
    // that is still exactly true — dropping it there would be over-suppression
    // of a debug surface for no honesty gain.
    if (wireEnforcement.editedFields.includes('assistant_text')) {
      const { _answer_shape: droppedShape, ...withoutShape } =
        wireEnforcement.response as OlumiResponseWithDebugFields;
      if (droppedShape !== undefined) {
        emit(TelemetryEvents.V5AnswerShapeDroppedStale, {
          request_id: requestId,
          exit_path: exitPath,
          dispatch_path: 'route_egress_claim_safety',
          final_text_length: wireEnforcement.response.assistant_text.length,
          derived_text_length: deriveAnswerTextFromShape(droppedShape).length,
        });
      }
      projected = withoutShape;
    }
    wireBody = finaliseV5Response(projected, finaliserContext);
  }
  // ═══════════════════════════════════════════════════════════════════════════
  // SELECTION-AWARE ANSWERING (hop 4b) — re-attach `_grounded_selection`.
  //
  // UNCONDITIONAL on the success path (no flag, no debug token): this is
  // product content, and Paul's standing ruling is to ship capabilities ON.
  // The fallback envelope never carries it — an egress-violation body is not
  // an answer about the user's selected element. An upstream body-attach was
  // already dropped by the strip step above, so `ctx.groundedSelection` is the
  // sole authority.
  //
  // WHY HERE, and it is a deliberate position, not the family's habit:
  //   · AFTER the claim-safety wire gate, because that gate's `withoutShape`
  //     destructure and re-finalise rebuild the body, and a sidecar attached
  //     upstream would survive only by accident.
  //   · BEFORE the Layer-3 scan, which is pinned by
  //     `single-pass-egress-byte-identity.test.ts` to sit after the LAST
  //     `wireBody` write. This block is that last write; the scan still reads
  //     the exact object handed to `reply.send`.
  //
  // NO TIE-CHECK, and the reason is the whole point of the field's docstring:
  // `_answer_shape` needs one because it RECONSTRUCTS `assistant_text` and can
  // therefore describe text the user never sees. This sidecar describes the
  // answer's CONTEXT — which elements the prompt was grounded on — a fact
  // fixed before the model ever replied and unaffected by any prose rewrite
  // downstream of it. A claim-safety edit changes what the answer SAYS about
  // the element; it does not change WHICH element the answer is about.
  // ═══════════════════════════════════════════════════════════════════════════
  if (
    egress.ok &&
    ctx.groundedSelection &&
    (!analysisAuthorityUnavailable ||
      analysisAuthorityUnavailableEgressMode !== 'substantive_replaced')
  ) {
    const augmented: OlumiResponseWithDebugFields = {
      ...wireBody,
      _grounded_selection: ctx.groundedSelection,
    };
    // Re-finalise: the spread breaks WeakSet membership (finaliser Mechanism B).
    wireBody = finaliseV5Response(augmented, finaliserContext);
  }
  // ═══════════════════════════════════════════════════════════════════════════
  // HARNESS VISIBILITY — re-attach `_prompt_capture` post-validation.
  //
  // Single-flag gating (`CEE_TURN_DEBUG_ENABLED`, default FALSE, forced off in
  // production), same re-attach shape as `_context_summary` / `_reasoning`.
  //
  // READ FROM THE STORE, NOT THREADED. Every sibling sidecar above rides a
  // `ctx` member that some dispatch path had to remember to populate — the
  // failure mode `prompt-attribution.ts` documents at length: "a call the
  // builder was never told about is invisible by construction, and silently
  // so". The capture is written at the prompt-resolution seam keyed by the
  // same request id this route already holds, so reading it back here needs no
  // threading and cannot be silently skipped by a dispatch path that forgot.
  //
  // NO TIE-CHECK, for the reason `_grounded_selection` gives directly above:
  // this describes a fact fixed BEFORE the model replied — which prompt bytes
  // went out — and no downstream prose rewrite can make it untrue.
  //
  // Empty array ⇒ attach nothing, so a turn that made no LLM call stays
  // byte-identical on the wire rather than carrying an empty diagnostic.
  // ═══════════════════════════════════════════════════════════════════════════
  // ⛔ PRODUCTION HARD-STOP, and it is NOT belt-and-braces. Unlike
  // `CEE_OBSERVABILITY_RAW_IO` — the estate's other raw-prompt flag, declared
  // `createEnvEnforcedBoolean(..., "CEE_OBSERVABILITY_RAW_IO")` so prod forces
  // it false — `turnDebugEnabled` is a plain `booleanString.default(false)`
  // (`config/index.ts:1156`) with NO prod enforcement. Before this change that
  // flag exposed CQE counters and a trace shape; it now decides whether prompt
  // BYTES ride the wire, so the same env value carries a materially larger
  // consequence than it did when it was declared. Refuse in prod at the
  // attach site rather than trust an operator never to set it there.
  //
  // The admin route is deliberately NOT gated this way: it is admin-key
  // gated, so the same bytes stay reachable to an operator who holds the key.
  if (egress.ok && promptCaptureMayRideTheWire()) {
    const promptCaptures = getTurnDebugPromptCaptures(requestId);
    if (promptCaptures.length > 0) {
      const augmented: OlumiResponseWithDebugFields = {
        ...wireBody,
        _prompt_capture: promptCaptures,
      };
      // Re-finalise: the spread breaks WeakSet membership (finaliser Mechanism B).
      wireBody = finaliseV5Response(augmented, finaliserContext);
    }
  }
  // ═══════════════════════════════════════════════════════════════════════════
  // T1 claim safety, LAYER 3 — THE SINGLE EGRESS SCAN. (ROADMAP 1.272 E1.)
  //
  // Placed here, and only here, for two reasons — one of which is correctness
  // and was not the reason the move was proposed:
  //
  //   1. THIS IS THE ONLY POSITION THAT SCANS WHAT THE USER RECEIVES. The scan
  //      used to live inside `sanitiseOlumiResponseForEgress`, but every call
  //      to that function is WRAPPED in `finaliseV5Response(...)`, which then
  //      deletes transport-banned enrichment members, rewrites enrichment prose
  //      and overrides `graph_hash`. The alarm therefore reported on a
  //      pre-finalise draft, never on the wire bytes. And the `_answer_shape`
  //      and synthesised-shape re-attach passes can FAIL CLOSED and DISCARD the
  //      object that was scanned last, so the final scan was not even
  //      guaranteed to be of a live envelope. `wireBody` on this line is the
  //      exact object handed to `reply.send`.
  //   2. It runs ONCE. `sendFinalised200` re-enters the sanitiser 2–8 times per
  //      response (1 validate pass + 1 of {validated, fallback} + up to 6
  //      conditional re-attach passes), and the guard fired on every pass that
  //      found hits — so `hit_count` on the dashboard carried an undeclared
  //      multiplier that varied with which debug surfaces were enabled.
  //
  // ORDERING: the guard must sit after every pass that can edit user-facing
  // prose, because `compose/terminology-rewrite.ts` MANUFACTURES the banned
  // vocabulary ("recommendation" → "leading option"). Nothing edits prose
  // between here and `reply.send`, so this satisfies that rule strictly better
  // than the old position did.
  //
  // OBSERVE-ONLY, AND NOW STRUCTURALLY SO (ROADMAP 2.1264): it reports and
  // returns the response unchanged, and the return value is discarded. It
  // cannot alter a single wire byte — which is why this move is byte-neutral by
  // construction, not merely by test.
  //
  // ⚠ THIS CALL USED TO PASS `enforce: false`, AND THAT OPTION IS GONE. It
  // gated nothing in the guard — only the `enforced` log field and the `dropped`
  // telemetry tag — so "flipping it to enforcing" would have changed no wire
  // byte and made the dashboard claim drops that never happened. Enforcement
  // is the call immediately ABOVE this one
  // (`enforceLeadingOptionClaimsAtWire`), which is unconditional, per-field and
  // per-sentence. See the guard module's docstring.
  //
  // `ctx.mayNameLeadingOption` is the SAME value that was previously handed to
  // every sanitiser call on this path (it is passed to each of them from this
  // ctx, unmodified), so the permission the alarm is armed with is unchanged.
  //
  // ⚠ WHAT THIS ALARM MEASURES CHANGED ON 2026-07-31 (ROADMAP 2.149), AND THE
  // CHANGE IS RECORDED HERE RATHER THAN LEFT FOR A DASHBOARD READER TO DISCOVER
  // AS A DROP IN THE GRAPH.
  //
  // The ENFORCING wire gate now runs immediately above, so this scan reports
  // the RESIDUE THAT STILL SHIPS, not everything the producers emitted. The
  // enforcer covers `assistant_text` and `framing_question`; block prose,
  // enrichment blobs and structured key designations are producer-owned
  // (`compose/withheld-claim-projection.ts`) and are NOT edited here — so a hit
  // on this alarm after 2.149 names a surface the wire gate does not cover, or
  // a phrasing the wide ALARM reader sees and the narrow ENFORCER reader
  // deliberately spares. Both are real signal; neither is the old signal.
  //
  // WHY THE ALARM RUNS SECOND AND NOT FIRST. Two reasons, and only the first is
  // about doctrine:
  //   1. E1's position pin (`compose/__tests__/single-pass-egress-byte-
  //      identity.test.ts`) requires this scan to sit after the LAST `wireBody`
  //      write and immediately before the send, because that is the only
  //      position that scans the bytes the user receives. An enforcing pass
  //      downstream of the alarm would make the alarm's report a report about
  //      an object that no longer ships.
  //   2. The ordering rule this block states above — "after every pass that can
  //      edit user-facing prose" — is about passes that can MANUFACTURE the
  //      banned vocabulary (terminology-rewrite). The wire gate is
  //      monotone-REMOVING and its replacement copy is module-load-probed
  //      leader-free under BOTH readers, so it cannot introduce a claim for
  //      this scan to miss.
  // ═══════════════════════════════════════════════════════════════════════════
  // Attach the identity-bound hook before the single scan of the bytes that ship.
  if (egress.ok && !analysisAuthorityUnavailable && guidedSizingForWire !== undefined
    && (guidedSizingForWire.progress_line === undefined || wireBody.assistant_text.includes(guidedSizingForWire.progress_line))) {
    const offered = new Set(wireBody.suggested_actions.filter(action => guidedActionsForWire.has(action.id)).map(action => action.id));
    const boundGuidedSizing = guidedSizingOnWire(guidedSizingForWire, wireBody.graph_hash);
    if (boundGuidedSizing !== undefined && guidedSizingForWire.links.every(link => offered.has(link.press.id))) {
      const augmented: import('@talchain/schemas/boundary').OlumiResponse & { guided_sizing: GuidedSizing } = {
        ...wireBody, guided_sizing: boundGuidedSizing,
      };
      wireBody = finaliseV5Response(augmented, finaliserContext);
    }
  }
  guardLeadingOptionClaimsAtEgress(wireBody, {
    requestId,
    exitPath,
    mayNameLeadingOption: ctx.mayNameLeadingOption,
    ...(ctx.assistantTextAlreadyIdentifierSafe === true ? { assistantTextAlreadyIdentifierSafe: true } : {}),
    // Threaded so the ALARM's scope matches the ENFORCER's exactly. The enforcer
    // above conjoins `analysis_admission.permitted_analysis_mode`; an alarm that
    // did not would short-circuit on the entitlement alone and report nothing on
    // the very turns the enforcer just edited — a detector narrower than the
    // thing it measures. Same object, same field, one shared reader.
    analysisReady: ctx.analysisReady,
    // …and the enforcer's permit-with-caveat arm, from the same read: without it the alarm logged ERROR over a leader
    // the enforcer had deliberately kept (Paul's funding test, runs 2 and 3).
    separationEstablished: wireSeparationEstablished,
  });
  // Count the client-visible fail-closed outcome at the same exactly-once seam
  // as the response. Derivation-level reads may retry or recover, so emitting
  // there would overcount and would not prove that a user received the state.
  // Content-free by contract: exit_path is the closed V5ExitPath union.
  if (analysisAuthorityUnavailable) {
    emit(TelemetryEvents.V5ClaimSafetyFailClosedUnavailable, {
      exit_path: exitPath,
      outcome: analysisAuthorityUnavailableEgressMode,
    });
  }
  // ── A REFUSAL THE USER CAN SEE IS COUNTED AS A REFUSAL ────────────────────
  //
  // Same exactly-once seam and the same argument as the fail-closed counter
  // immediately above: the question is "what did the USER receive?", and
  // `wireBody` is the only artefact that answers it. A producer-side emit
  // would count refusals that were recovered upstream and never shipped.
  //
  // Read AFTER every pass that can edit the body, so this classifies the bytes
  // that are about to be sent rather than an object that no longer ships.
  // Observe-only: it cannot alter a wire byte.
  const refusal = classifyUserVisibleRefusal(wireBody);
  if (refusal) {
    emit(TelemetryEvents.CeeTurnRefused, {
      request_id: requestId,
      // Honest null, never a placeholder: the system-event exit can reach here
      // without a scenario, and "we do not know which session" must not be
      // spelled the same way as a real id.
      scenario_id: ctx.scenarioId ?? null,
      exit_path: exitPath,
      error_code: refusal.error_code,
      severity: refusal.severity,
      refusal_source: refusal.source,
      refusal_code: refusal.refusal_code,
    });
  }
  logFinalisedResponse(requestId, exitPath, wireBody, egress.ok, ctx.analysisReady == null);
  return reply.code(200).send(wireBody);
}

/**
 * ROADMAP 1.132 (F1) — EGRESS-DEFAULT INVERSION block-primary guard.
 *
 * True when the response carries a `draft_graph` block — the one block type
 * whose user-facing artifact IS the block (the drafted decision graph), not the
 * `assistant_text` prose. A draft-graph turn's prose is a brief intro that must
 * NOT be reshaped behind progressive disclosure, so the egress synthesiser skips
 * it (the draft_graph dispatch is ALSO functional-marked; this is defence in
 * depth against a future path that emits a draft_graph block without a mark).
 *
 * DELIBERATELY draft_graph-ONLY, not "any non-empty blocks": the Phase-3
 * lifecycle blocks (review_card / coaching / evidence / analysis_result /
 * graph_patch / comparison / flip_analysis) ACCOMPANY a substantive prose answer
 * — the explanation handlers (explain_results / what_would_flip) carry them on a
 * fresh post-analysis turn — and that prose IS the F1 target. A broad
 * "blocks-empty" gate would wrongly exclude exactly the d9ac487d / 86654fd0
 * answers this fix must shape.
 */
function responseCarriesDraftGraphBlock(
  response: import('@talchain/schemas/boundary').OlumiResponse,
): boolean {
  const blocks = (response as { blocks?: unknown }).blocks;
  if (!Array.isArray(blocks)) return false;
  return blocks.some(
    (b) =>
      b !== null &&
      typeof b === 'object' &&
      (b as { type?: unknown }).type === 'draft_graph',
  );
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

export { buildCommitFailureBoundaryError } from '../orchestrator-v5/commit-failure-boundary.js';

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
  403: { error: ModelWriteOwnershipRefused['code']; message: string };
  // F4 — a graph CAS write conflict (GRAPH_DIVERGED) returns 409, not the
  // uniform 500, so the UI can branch to refresh-and-reconfirm rather than a
  // generic infra-failure retry.
  409: BoundaryError;
  410: BoundaryError;
  422: BoundaryError;
  500: BoundaryError;
  503: ReturnType<typeof modelReadFailedWire>;
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
  payload: unknown
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
    'V5 200-OK response bypassed finaliser — substituting egress-violation fallback'
  );
  // Fail safe: substitute a typed fallback rather than ship the bypassing
  // body. The fallback envelope is hard-coded schema-valid; no readiness
  // is set (the bypass means we don't know what readiness should be).
  return {
    response_version: 2,
    assistant_text: 'The server produced a response that failed validation.',
    blocks: [
      {
        type: 'error',
        error_code: 'EGRESS_CONTRACT_VIOLATION',
        severity: 'error',
      },
    ],
    suggested_actions: [],
    insights: [],
    stage_indicator: 'frame',
  };
};

export async function ceeOrchestratorRouteV2(
  app: FastifyInstance
): Promise<void> {
  // Scoped to `/orchestrate/v2/turn` only via the URL check inside the
  // hook function — global registration is simpler than route-scoped
  // and the cost (one URL comparison per non-V5 send) is negligible.
  app.addHook('preSerialization', v5FinaliserPreSerializationHook);

  // V5 TURN FENCE (Codex P0) — claim this turn's place in the scenario's start
  // order BEFORE any dispatch, and run the whole request inside the fence
  // context so the commit chokepoint can read it ~50 s later. Route-scoped
  // rather than app-wide: this is the only ingress that writes scenarios.graph,
  // and app.inject() from the proxy/streamed routes runs this hook too, so
  // every graph-writing lane is covered by construction. See
  // turn-fence-prehandler.ts (why a hook, why callback style) and turn-fence.ts
  // (the defect, and the arrival enumeration).
  app.post<{ Reply: V5RouteReply }>(
    '/orchestrate/v2/turn',
    {
      config: { scenarioId: { from: 'body', key: 'scenario_id' } },
      preHandler: turnFencePreHandler,
    },
    async (req, reply) => {
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
        // state to compute readiness from; no analysis_ready stamped. The
        // fence was NOT claimed for this request (see admission below), so a
        // rejected request is fence-neutral: it cannot supersede a live turn
        // and it grows no fence rows.
        return reply.code(pre.status).send(pre.error);
      }
      const admitted = pre.context.ingress;
      const typedChip =
        admitted.kind === 'message' &&
        (admitted.source === 'chip' || admitted.source === 'chip_click');
      const keptMessage =
        typedChip &&
        admitted.kind === 'message' &&
        ((admitted.source === 'chip_click' &&
          admitted.chip?.action_type === 'run_analysis') ||
          admitted.chip?.intent === 'add_option' ||
          /^gmh_/.test(admitted.chip?.id ?? ''));
      if (admitted.kind === 'message' && !keptMessage) {
        return reply.code(410).send(
          buildCommitFailureBoundaryError({
            validator: 'conversation_route',
            reason: 'conventional_conversation_retired',
            retryable: false,
            requestId: pre.context.requestId,
            stage: admitted.stage,
            errorCode: 'INGRESS_CONTRACT_VIOLATION',
            preStageExtras: {
              recovery: {
                suggestion:
                  'This conversation route is no longer available. Please use Olumi’s current conversation.',
              },
            },
          })
        );
      }
      if (
        req.scenarioAccess?.provisionIfMissing &&
        !(await req.scenarioAccess.provisionIfMissing())
      )
        return;
      // V5 TURN FENCE — ADMISSION (2.174 fix b). The request has passed auth,
      // B1 validation and the scenario upsert, so NOW it claims its place in
      // the scenario's start order. This is the single claim call site; it
      // sits BEHIND the admission gate by construction, which is what makes
      // 401/422-bound requests unable to advance the fence. Before any
      // dispatch branch, so the whole ~50 s of work runs with the admitted
      // handle bound. See turn-fence-prehandler.ts.
      await admitCurrentTurnFence();
      const { requestId, ingress, extensions } = pre.context;

      // ═══════════════════════════════════════════════════════════════════════
      // ⭐ T1 CLAIM SAFETY — THE TURN-ENTRY READ (ROADMAP 1.233 finish-line
      // criterion 2 / 1.349 P1-2). Constructed at the top of the handler, before
      // the FIRST dispatch branch — which since the replacement controller
      // landed means above it, not here — so EVERY exit below can inherit ONE
      // answer, and so the replacement branch can share the same memoised
      // context read instead of opening a second one.
      //
      // Until this landed, seventeen exits handed the finaliser a hardcoded
      // permission of `true` on the premise that "this path runs no
      // analysis, so it withheld no claim". That premise is false: the
      // permission belongs to the fact the response DISPLAYS, not to the work
      // this turn performed — and an edit turn is handed the prior analysis as
      // context. Live-confirmed 28 Jul (a withheld analysis, then an edit turn
      // that came back `true`). Because the Layer-3 guard short-circuits on
      // `true`, that literal was an explicit licence for the alarm not to look.
      //
      // LAZY: the resolver reads nothing until an exit asks. The `turn_executor`
      // path never asks (it carries its own post-dispatch verdict via
      // `run.mayNameLeadingOption`), so the hot path is unchanged.
      //
      // `null` for system events, and that is DERIVED rather than chosen:
      // `buildTurnContext` is typed `MessageTurnPayload` and reads
      // `payload.message`, which the `system_event` union member does not have —
      // which is itself why this file dispatches that family before the
      // TurnExecutor. The resolver answers `false` /
      // `fail_closed_no_turn_context` there: we could not look, so we withhold.
      // ═══════════════════════════════════════════════════════════════════════
      const claimSafety: TurnClaimSafetyResolver =
        createTurnClaimSafetyResolver(
          ingress.kind === 'message' ? ingress : null,
          requestId
        );
      // Only a submitted basis needs this lazy context read before request hashes.
      if (
        ingress.kind === 'message' &&
        extensions.graphState?.nodes.some((node) =>
          Object.prototype.hasOwnProperty.call(node, 'horizon_basis')
        )
      ) {
        const basisContext = await claimSafety.turnContext();
        const storedBasisReadAvailable =
          basisContext?.persistedGraphRead?.status === 'ok_present' ||
          basisContext?.persistedGraphRead?.status === 'ok_absent';
        extensions.graphState = structuredClone(extensions.graphState);
        prepareHorizonBasisForWrite(
          extensions.graphState,
          storedBasisReadAvailable ? basisContext?.persistedGraph : undefined,
          ingress.scenario_id
        );
      }

      if (ingress.kind === 'system_event') {
        const rawSysResult = await dispatchSystemEvent({
          payload: ingress,
          requestId,
        });

        // ═══════════════════════════════════════════════════════════════════
        // ⭐ THE SYSTEM-EVENT FAMILY'S ONE STAGE-AUTHORITY APPLICATION POINT
        // ═══════════════════════════════════════════════════════════════════
        //
        // ── THE DEFECT THIS CLOSES ────────────────────────────────────────
        // `deriveAuthoritativeStage` (orchestrator-v5/context/derive-stage.ts)
        // carries a TWIN: a `decide` request over a model whose analysis has
        // gone stale is corrected back to `analyse`, so the stage pill cannot
        // outlive the analysis that earned it. That twin ran in exactly one
        // place — `buildTurnContext` — and the system-event family never calls
        // it (SystemEventTurnPayload has no `message` field, which is why this
        // branch dispatches before the TurnExecutor at all). So every
        // system-event writer stamped `stage_indicator: payload.stage` RAW, and
        // a user editing a factor value got their own stale `decide` echoed
        // back over a model CEE could no longer vouch for — the exact lie the
        // twin exists to prevent, on the one path the twin could not see.
        //
        // ── WHY HERE, AND NOWHERE ELSE ────────────────────────────────────
        // `dispatchSystemEvent` has exactly ONE call site — this one — and its
        // result carries all three derivation inputs together: the requested
        // stage (on `ingress`), the freshness derivation, and the committed
        // graph. No individual writer holds all three, and there are six of
        // them plus two acknowledgement composers. Correcting once, here, is
        // the single-authority move; correcting at each writer would be eight
        // hand-maintained mirrors of one rule (CLAUDE.md trap 12).
        //
        // ── FAIL-CLOSED: NO READ, NO VERDICT ──────────────────────────────
        // On an acknowledgement or refusal floor nothing was read: `freshness`
        // is undefined (→ `'unknown'`, which cannot promote) and `graph` is
        // null (→ `hasGraph: false`, which the twin's own bound refuses to fire
        // on). Both inputs therefore degrade to "the requested stage passes
        // through untouched". That is CORRECT, not a gap: a floor that
        // inspected no model must not deliver a verdict about one.
        //
        // ── ONLY `stage_indicator` ────────────────────────────────────────
        // Nothing else about the response is touched, and the result is rebuilt
        // IMMUTABLY (every field on `DispatchSystemEventResult` is `readonly`).
        // The corrected object is bound to `sysResult`, so EVERY downstream
        // read below — today's `sendFinalised200` and any added later — sees
        // the corrected value by construction rather than by remembering to.
        const authoritativeSystemEventStage = deriveAuthoritativeStage({
          requestedStage: ingress.stage,
          freshness: rawSysResult.freshness?.freshness ?? 'unknown',
          optionCount:
            extractGraphOptionIds(rawSysResult.graph)?.length ?? null,
          hasGraph: rawSysResult.graph != null,
        });
        const sysResult: DispatchSystemEventResult =
          rawSysResult.response.stage_indicator ===
          authoritativeSystemEventStage
            ? rawSysResult
            : {
                ...rawSysResult,
                response: {
                  ...rawSysResult.response,
                  stage_indicator: authoritativeSystemEventStage,
                },
              };
        if (sysResult.graphConflict !== undefined) {
          const boundaryError: BoundaryError = buildCommitFailureBoundaryError({
            validator: 'turn_commit',
            reason: 'graph_write_conflict',
            retryable: false,
            requestId,
            stage: ingress.stage,
            errorCode: 'GRAPH_DIVERGED',
            preStageExtras: {
              failure_type: 'GRAPH_DIVERGED',
              event_kind: ingress.event.kind,
              recovery_action: sysResult.graphConflict.recovery_action,
              conflict_category: sysResult.graphConflict.conflict_category,
              ...(sysResult.graphConflict.conflict_category ===
              'revision_conflict'
                ? {
                    expected: sysResult.graphConflict.expected,
                    current: sysResult.graphConflict.current,
                  }
                : {}),
              expected_base_graph_hash:
                sysResult.graphConflict.expected_base_graph_hash,
              ...(sysResult.graphConflict.edge !== undefined
                ? { edge: sysResult.graphConflict.edge }
                : {}),
            },
          });
          log.warn(
            {
              request_id: requestId,
              event_kind: ingress.event.kind,
              conflict_category: sysResult.graphConflict.conflict_category,
            },
            'V5 system event graph conflict — returning 409 with refresh-reconfirm BoundaryError envelope'
          );
          return reply
            .code(409)
            .send(
              withRevisionConflictWire(boundaryError, sysResult.graphConflict)
            );
        }
        // ⭐ A VERIFIED NO-OP IS A SUCCESS, NOT A FAILURE. The server looked and the
        // model already holds what was asked for. Nothing committed, nothing
        // broken, nothing for the client to do — so it takes the ordinary 200
        // path below rather than being reported as an infrastructure failure.
        // `analysis_ready` is deliberately not stamped: the graph did not move, so
        // the client's prior value is still the truth.
        //
        // ⚠ A REFUSAL THAT WROTE NOTHING IS NOT RETRYABLE, and saying it is was the
        // defect. A permanently unhonourable request — an unresolvable id, an
        // option and factor that are not linked, a value outside the model scale —
        // cannot succeed by being repeated. It gets a non-retryable 422 with the
        // ingress-contract code, so the client corrects the request instead of
        // hammering it. A STALE BASE does not come here at all: it is a
        // `graphConflict` and was answered with 409 refresh-and-reconfirm above.
        //
        // ⚠ AND "UNVERIFIED" DELIBERATELY FALLS THROUGH TO THE RETRYABLE 500. A
        // writer that could not confirm what happened must not be described as a
        // skip — a commit may have landed, and the retry is idempotent on
        // (scenario_id, turn_id). "We do not know" stays "we do not know".
        if (sysResult.commitSkippedReason === 'refused_no_write') {
          const boundaryError: BoundaryError = buildCommitFailureBoundaryError({
            validator: 'turn_commit',
            reason: 'system_event_refused_no_write',
            retryable: false,
            requestId,
            stage: ingress.stage,
            errorCode: 'INGRESS_CONTRACT_VIOLATION',
            preStageExtras: { event_kind: ingress.event.kind },
          });
          log.warn(
            {
              request_id: requestId,
              event_kind: ingress.event.kind,
            },
            'V5 system event refused with no write — returning non-retryable 422 BoundaryError envelope'
          );
          return reply.code(422).send(boundaryError);
        }
        if (
          !sysResult.commitPerformed &&
          sysResult.commitSkippedReason !== 'client_only_event' &&
          sysResult.commitSkippedReason !== 'verified_no_op'
        ) {
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
            'V5 system event commit failed — returning 500 with BoundaryError envelope'
          );
          // 500: infrastructure failure — no analysis_ready stamped (UI retains prior store value)
          return reply.code(500).send(boundaryError);
        }
        return sendFinalised200(
          reply,
          requestId,
          'system_event',
          sysResult.response,
          {
            analysisReady: sysResult.analysisReady,
            graph: sysResult.graph,
            ...(sysResult.freshness !== undefined
              ? { freshness: sysResult.freshness }
              : {}),
            // T1 claim safety — INHERITED from the turn-entry read. Never a literal:
            // the permission belongs to the fact this response DISPLAYS, not to
            // whether this turn ran an analysis. See turn-claim-safety.ts.
            ...(await claimSafety.forExit()),
            // ROADMAP 1.132 (F1) — EGRESS-DEFAULT INVERSION: system-event copy is
            // functional (receipts/notices) and must ship plain (omission now shapes).
            answerKind: 'functional',
            requestStartedAt: routeStartedAt,
            scenarioId: ingress.scenario_id,
            turnId: ingress.turn_id,
            // System events carry no user message (the ingress union's
            // 'system_event' variant has no `message` field), so the
            // looping-chip guard has nothing to compare against and is
            // explicitly inert here rather than accidentally omitted.
            userMessage: null,
          }
        );
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
          // (NOT a 500), mirroring the TurnExecutor handler-recovery path.
          //
          // ⚠ THIS EXIT USED TO STAMP NOTHING, on the reasoning "no analysis ran
          // and the graph was not mutated, so the UI retains its prior store
          // value". ROADMAP 2.1085 (root 2.1041) / golden-journey EXT-2 measured the result on
          // staging (2026-08-13): the post-add-option `run_analysis` chip shipped
          // 200 with honest refusal prose and NO `analysis_ready` KEY — the run
          // was neither admitted nor typed-blocked, so nothing machine-readable
          // reached any consumer. The prior store value said READY; the model no
          // longer was. The dispatcher now returns the typed refusal
          // (`status: 'blocked'` + a specific `blocked_reason`) and it is stamped
          // here, by the same finaliser that stamps the `ok` exit.
          if (cc.outcome === 'handler_recovered') {
            return sendFinalised200(
              reply,
              requestId,
              'chip_click',
              cc.response,
              {
                analysisReady: cc.analysisReady,
                // ROADMAP 2.1085 (root 2.1041) D2 — threaded exactly as the `ok` exit below
                // does. Omitting it made `attachComputedAt` stamp a block with no
                // freshness fields, and the deployed UI reads their absence as
                // "cannot confirm whether this analysis is current" — a refusal
                // turn would have degraded the freshness strip as a side effect.
                freshness: cc.freshness,
                graph: cc.graph,
                // T1 claim safety — INHERITED from the turn-entry read. Never a literal:
                // the permission belongs to the fact this response DISPLAYS, not to
                // whether this turn ran an analysis. See turn-claim-safety.ts.
                ...(await claimSafety.forExit()),
                // ROADMAP 1.132 (F1) — EGRESS-DEFAULT INVERSION: chip-click recovery
                // copy is functional and must ship plain (omission would now SHAPE).
                answerKind: 'functional',
                requestStartedAt: routeStartedAt,
                scenarioId: ingress.scenario_id,
                turnId: ingress.turn_id,
                userMessage: ingress.message,
              }
            );
          }
          if (cc.outcome === 'handler_failure') {
            const boundaryError: BoundaryError =
              buildCommitFailureBoundaryError({
                validator: 'chip_click_dispatch',
                reason: `chip_click_${chipActionType}_handler_failed`,
                retryable: cc.retryable,
                requestId,
                stage: ingress.stage,
                // P0 (analysis-500 diagnosis §8 FIX B, 2026-08-14) — STOP DISCARDING
                // THE DIAGNOSTIC.
                //
                // This spread used to be `{ cause_kind, action_type }` and nothing
                // else, while the handler had ALREADY assembled PLoT's status,
                // critique codes and parse outcome into `err.details`. The cost was
                // measured, not theoretical: all three banked 500s came back
                // byte-identical at 1126 B, two entirely different PLoT dispositions
                // were indistinguishable on the wire, and settling which one fired
                // needed Render log access (DIAGNOSIS §3 "THE OBSERVABILITY DEFECT",
                // §7.1). It cost a whole diagnosis a day.
                //
                // `cc.diagnostics` is an ALLOWLISTED, shape-checked projection built
                // in `chip-click-dispatch.ts` — never the raw `details`, which carry
                // PLoT prose interpolating the user's own option labels.
                //
                // Order matters: diagnostics are spread FIRST so `cause_kind` and
                // `action_type` remain the authoritative last word on their own keys
                // and cannot be shadowed by a handler detail of the same name.
                preStageExtras: {
                  ...(cc.diagnostics ?? {}),
                  cause_kind: cc.causeKind,
                  action_type: chipActionType,
                },
              });
            // 500: infrastructure failure — no analysis_ready stamped (UI retains prior store value)
            return reply.code(500).send(boundaryError);
          }
          if (cc.outcome === 'handler_result_invalid') {
            const boundaryError: BoundaryError =
              buildCommitFailureBoundaryError({
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
            const boundaryError: BoundaryError =
              buildCommitFailureBoundaryError({
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
            // T1 claim safety — READ off the chip dispatch's own run_analysis fact
            // stamp (see DispatchChipClickRunAnalysisResult).
            //
            // ⚠ THE `?? true` THAT USED TO BE HERE IS GONE (WALK-2026-07-27-FINAL
            // §11.6). It was an instance of the default an exit falls into when
            // it cannot read a verdict: it shipped `true` to the Layer-3 guard,
            // which then had
            // an explicit permission to ignore whatever the response said. The
            // ⚠ AND THE SENTENCE THAT CALLED THIS "the LAST surviving instance"
            // WAS FALSE WHEN IT WAS WRITTEN — corrected here rather than
            // deleted, because it is this file's own instance of CLAUDE.md trap
            // #12. It claimed the ROADMAP 1.233 hoist "removed [the default]
            // everywhere else"; the hoist had in fact only ever covered the
            // turn_executor path, and SEVENTEEN other exits still hardcoded
            // `true` at that moment. A good-faith status line about a sibling's
            // work became the reason nobody re-checked the siblings. It is true
            // NOW, and it is true because the exits DERIVE rather than because
            // this comment says so.
            //
            // The field is REQUIRED on the `ok` outcome, so this exit carries the
            // producer's real answer and a future `ok` producer that forgets to
            // derive one fails to compile instead of failing open.
            mayNameLeadingOption: cc.mayNameLeadingOption,
            ...(cc.freshness ? { freshness: cc.freshness } : {}),
            // D1 — the run-over-run block's input, a passthrough exactly as on the turn_executor exit: present only
            // when the chip Run completed one (the dispatcher's gate), absent otherwise, never defaulted.
            ...(cc.priorFacts ? { priorFacts: cc.priorFacts } : {}),
            // ROADMAP 1.132 (F1) — EGRESS-DEFAULT INVERSION: thread the chip
            // answer's declared kind, DEFAULTING to 'functional' when the dispatch
            // did not declare one. Post-inversion an omitted kind would SHAPE, so a
            // chip path that returns no answerKind (today every chip answer,
            // including the deferred-functional explain_results / what_would_flip
            // explanations) must stay plain by default; a chip site that later opts
            // into shaping sets `answerKind: 'substantive'` explicitly.
            answerKind: cc.answerKind ?? 'functional',
            // ROADMAP 2.73 Fix C — decision_review call attribution from the
            // chip dispatch (present only when the call returned under an
            // enabled timings/trace gate). The minimal-trace builder folds it
            // into `_diagnostic_trace.llm_calls`, matching the routed path.
            ...(cc.turnTimings ? { turnTimings: cc.turnTimings } : {}),
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
              err:
                err instanceof Error
                  ? { name: err.name, message: err.message }
                  : { message: String(err) },
            },
            'V5 chip_click deterministic dispatch threw — returning 500 BoundaryError'
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

      const isAddOptionIntentChip =
        (ingress.source === 'chip' || ingress.source === 'chip_click') &&
        ingress.chip?.intent === 'add_option';
      const isTypedAddOptionChip = isAddOptionIntentChip;
      if (isTypedAddOptionChip) {
        const addOptionGmMode = config.features.graphManagementMode;
        if (addOptionGmMode === 'off') {
          emit(TelemetryEvents.V5AddOptionTransaction, {
            request_id: requestId,
            outcome: 'fell_through:gm_off',
          });
        } else {
          // Frame authority = the PERSISTED graph (the same authority
          // run_analysis/readiness use), so the held pending's `graph_hash`
          // precondition matches the persisted graph at confirm time. A read
          // failure degrades to an unreadable frame → the handler skips.
          let addOptionFrameGraph: unknown = null;
          let addOptionGraphHash: string | null = null;
          let addOptionFreshness: FrameFreshness = 'unknown';
          // Prior live consent holds — threaded into the commit's carry-forward so
          // a fresh add-option hold NEVER silently retires an earlier consent hold
          // (the store reads pendings from only the latest turn row).
          let addOptionPriorPendings: readonly PendingAction[] = [];
          try {
            const turnContext = await buildTurnContext(ingress, requestId);
            addOptionFrameGraph = turnContext.persistedGraph;
            addOptionPriorPendings =
              turnContext.most_recent_pending_actions ?? [];
            try {
              addOptionGraphHash = computeAnalysisAffectingGraphHash(
                addOptionFrameGraph as GraphStateIngress | null | undefined
              );
            } catch {
              addOptionGraphHash = null;
            }
            addOptionFreshness = deriveAnalysisFreshness(
              turnContext.prior_facts,
              addOptionGraphHash,
              undefined,
              // CONTEXT/MEMORY V5 defect 4 — the add-option route performs its own
              // `buildTurnContext` read, independent of the turn-executor's. A
              // thrown fact read does NOT reject that promise (the catch inside
              // `fetchPriorFacts` swallows it and reports `readOk: false`), so the
              // surrounding catch below never fires and `prior_facts` is `[]`.
              // Without this flag that empty reads as "never analysed" and feeds
              // `dispatchAddOptionTransaction`'s gate.
              {
                currentGraph: addOptionFrameGraph,
                currentScenarioRevision:
                  turnContext.persistedGraph != null
                    ? turnContext.persistedRevision
                    : undefined,
                analysisInvalidatedAt: turnContext.analysis_invalidated_at,
                priorFactsWithTurn: turnContext.prior_facts_with_turn,
                legacyEditFacts: legacyEditFactsForFreshness(
                  turnContext.scenario_analysis_fact_set
                ),
                ...(turnContext.prior_facts_read_ok === undefined
                  ? {}
                  : { priorFactsReadOk: turnContext.prior_facts_read_ok }),
              }
            ).freshness;
          } catch (err) {
            log.warn(
              {
                request_id: requestId,
                scenario_id: ingress.scenario_id,
                err:
                  err instanceof Error
                    ? { name: err.name, message: err.message }
                    : { message: String(err) },
              },
              'S3-C3 add-option — turn-context read failed; leaving the typed add-option request unapplied'
            );
          }
          const addOptionOutcome = dispatchAddOptionTransaction({
            parameters: ingress.chip?.parameters,
            currentGraph: addOptionFrameGraph,
            currentGraphHash: addOptionGraphHash,
            freshness: addOptionFreshness,
            mode: addOptionGmMode,
            scenarioId: ingress.scenario_id,
            turnId: ingress.turn_id,
            requestId,
            stage: ingress.stage,
            // ⭐ A6b (DL CR on #2131, option (a)) — the options the USER named, from the Agent's in-process context for
            // THIS scenario and turn only; never from the chip's wire parameters. Empty for every UI chip.
            userStatedOptionIds: userNamedOptionIdsFor(
              ingress.scenario_id,
              ingress.turn_id
            ),
            // ⭐ PJ-A1 £49 (DL #70 5860365834) — a new graded factor's today level the user's own words state, from the same
            // in-process context for THIS scenario and turn only; never from the chip's wire. Empty for every UI chip.
            statedTodayLevels: statedTodayLevelsFor(
              ingress.scenario_id,
              ingress.turn_id
            ),
          });
          if (addOptionOutcome.kind === 'held') {
            // Honest supersession (edit-graph-dispatch precedent): a fresh hold
            // minted while an earlier consent hold is still live must SAY what
            // happens to the earlier one (same target → retired by the carry-
            // forward; different target → both stay live, named). Appended BEFORE
            // the commit so the stored copy == the wire copy.
            let addOptionResponse = addOptionOutcome.response;
            const supersessionNotice = buildHeldSupersessionNotice(
              addOptionOutcome.pendingActions[0]!,
              addOptionPriorPendings,
              Date.now()
            );
            if (supersessionNotice !== null) {
              addOptionResponse = {
                ...addOptionResponse,
                assistant_text: appendLapseNotice(
                  addOptionResponse.assistant_text,
                  supersessionNotice
                ),
              };
            }
            let addOptionCommitted = false;
            let addOptionWire = addOptionResponse;
            try {
              const commitResult = await commitDirectAnswer(addOptionResponse, {
                scenario_id: ingress.scenario_id,
                turn_id: ingress.turn_id,
                turn_class: 'direct_answer',
                handler_id: null,
                request_hash: computeRequestHash(ingress),
                llm_calls_used: 0,
                duration_ms: Date.now() - routeStartedAt,
                handler_facts: [],
                pending_actions: [...addOptionOutcome.pendingActions],
                // Thread prior live holds so the commit carry-forward retires the
                // same-target hold / keeps a different-target one — never a silent
                // consent wipe (the hold-wipe class).
                priorPendingActions: addOptionPriorPendings,
                coaching_state: null,
                userMessage: ingress.message,
              });
              addOptionWire = commitResult.response;
              addOptionCommitted = true;
            } catch (err) {
              // The held pending could not be persisted — the confirm turn would
              // have nothing to resume. Do NOT ship an un-resumable held
              // proposal; fall through to the existing edit path instead.
              log.warn(
                {
                  request_id: requestId,
                  scenario_id: ingress.scenario_id,
                  err:
                    err instanceof Error
                      ? { name: err.name, message: err.message }
                      : { message: String(err) },
                },
                'S3-C3 add-option — held-pending commit failed; leaving the typed add-option request unapplied'
              );
            }
            if (addOptionCommitted) {
              emit(TelemetryEvents.V5AddOptionTransaction, {
                request_id: requestId,
                outcome: 'held',
                configured: addOptionOutcome.configured,
              });
              return sendFinalised200(
                reply,
                requestId,
                'add_option_transaction',
                addOptionWire,
                {
                  graph: null,
                  // T1 claim safety — INHERITED from the turn-entry read. Never a literal:
                  // the permission belongs to the fact this response DISPLAYS, not to
                  // whether this turn ran an analysis. See turn-claim-safety.ts.
                  ...(await claimSafety.forExit()),
                  // ROADMAP 1.132 (F1) — held-proposal copy is functional
                  // (a receipt/question) and must ship plain.
                  answerKind: 'functional',
                  requestStartedAt: routeStartedAt,
                  scenarioId: ingress.scenario_id,
                  turnId: ingress.turn_id,
                  userMessage: ingress.message,
                }
              );
            }
            emit(TelemetryEvents.V5AddOptionTransaction, {
              request_id: requestId,
              outcome: 'fell_through:commit_failed',
            });
          } else if (addOptionOutcome.kind === 'refused') {
            // (A) — a typed batch the hold cannot carry (too many options, or past
            // the hold payload cap). ANSWERED here, with no pending and no graph
            // write: re-parsing typed parameters through the free-text edit lane is
            // the "typed chip re-inferred from text" class S2 exists to kill. Prior
            // live holds are threaded so this answer wipes no consent.
            let refusedWire = addOptionOutcome.response;
            try {
              const commitResult = await commitDirectAnswer(
                addOptionOutcome.response,
                {
                  scenario_id: ingress.scenario_id,
                  turn_id: ingress.turn_id,
                  turn_class: 'direct_answer',
                  handler_id: null,
                  request_hash: computeRequestHash(ingress),
                  llm_calls_used: 0,
                  duration_ms: Date.now() - routeStartedAt,
                  handler_facts: [],
                  pending_actions: [],
                  priorPendingActions: addOptionPriorPendings,
                  coaching_state: null,
                  userMessage: ingress.message,
                }
              );
              refusedWire = commitResult.response;
            } catch (err) {
              log.warn(
                {
                  request_id: requestId,
                  scenario_id: ingress.scenario_id,
                  reason: addOptionOutcome.reason,
                  err:
                    err instanceof Error
                      ? { name: err.name, message: err.message }
                      : { message: String(err) },
                },
                'S3-C3 add-option — refusal commit failed; answering without a turn row'
              );
            }
            emit(TelemetryEvents.V5AddOptionTransaction, {
              request_id: requestId,
              outcome: `refused:${addOptionOutcome.reason}`,
            });
            return sendFinalised200(
              reply,
              requestId,
              'add_option_transaction',
              refusedWire,
              {
                graph: null,
                ...(await claimSafety.forExit()),
                answerKind: 'functional',
                requestStartedAt: routeStartedAt,
                scenarioId: ingress.scenario_id,
                turnId: ingress.turn_id,
                userMessage: ingress.message,
              }
            );
          } else {
            emit(TelemetryEvents.V5AddOptionTransaction, {
              request_id: requestId,
              outcome: `fell_through:${addOptionOutcome.reason}`,
            });
            // Route ONLY the stale/diverged referee decline (`not_held`) to the
            // executor (egress-F1): an LLM edit against a diverged frame is the
            // exact unsafe case #658 closed. Every other skip reason (gm_not_live,
            // no_graph_hash, unreadable_graph, malformed/unresolved spec) keeps its
            // pre-#658 fallback — the free-text edit lane — so it is not stranded at
            // the executor, which has no add-option capability.

            // else: fall through to the existing edit path below.
          }
        }
      }

      // A typed add-option that could not be held must never fall back to text routing.
      if (isTypedAddOptionChip) {
        return reply.code(422).send(
          buildCommitFailureBoundaryError({
            validator: 'add_option_transaction',
            reason: 'add_option_not_prepared',
            retryable: false,
            requestId,
            stage: ingress.stage,
            errorCode: 'INGRESS_CONTRACT_VIOLATION',
          })
        );
      }

      // A chip-shaped payload is not authority to reopen conversation. Only the
      // exact displayed copy of the named, stored, live hold can reach its writer.
      const storedHolds = await loadMostRecentPendingActionsStrict(
        ingress.scenario_id,
        requestId
      );
      const confirmedHold = storedHolds.find(
        (pending) =>
          pending.chip_id === ingress.chip?.id &&
          pending.action.kind === 'apply_proposed_change' &&
          pending.action.inline_patch?.handler_id === GM_HELD_HANDLER_ID &&
          !isPendingActionExpired(pending, Date.now()) &&
          resolveProposalRenderCopy(pending.action).message === ingress.message
      );
      if (
        confirmedHold === undefined ||
        config.features.graphManagementMode !== 'live'
      ) {
        return reply.code(422).send(
          buildCommitFailureBoundaryError({
            validator: 'held_card',
            reason: 'held_card_not_available',
            retryable: false,
            requestId,
            stage: ingress.stage,
            errorCode: 'INGRESS_CONTRACT_VIOLATION',
          })
        );
      }

      // Stored card confirmations still use the existing apply/CAS/receipt path.
      // The conventional composer and explanation paths have no entry here.
      // The route decides the HTTP status for executor results and preserved
      // ownership refusals; see the status/body matrix in the file header.
      let run: Awaited<ReturnType<typeof runHeldProposalApproval>>;
      try {
        run = await runHeldProposalApproval(ingress, requestId, { graphState: extensions.graphState, selectedElements: extensions.selectedElements });
      } catch (error) {
        if (error instanceof ModelWriteOwnershipRefused) {
          await markDraftGraphWriteFailed(
            ingress.scenario_id,
            ingress.turn_id,
            error.code,
            requestId,
            'turn_dead_only'
          );
          return reply
            .code(403)
            .send(MODEL_WRITE_OWNERSHIP_REFUSAL_BODY[error.reason]);
        }
        throw error;
      }

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
        const failure = failedTurnReply(run, ingress.stage, requestId);
        return reply.code(failure.status).send(failure.json);
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
        analysisReady: run.analysisReady, graph: turnGraph,
        mayNameLeadingOption: run.mayNameLeadingOption,
        claimConstraintVerdictState: run.mayNameLeadingOptionConstraintVerdictState,
        leaderWithheldBecauseUnsizedPath: run.leaderWithheldBecauseUnsizedPath,
        leaderWithheldBecauseUnrequested: run.leaderWithheldBecauseUnrequested,
        mayNameLeadingOptionProvenance: run.mayNameLeadingOptionProvenance,
        priorFacts: run.priorFacts, freshness: run.freshness, scenarioFreshness: run.scenarioFreshness,
        requestStartedAt: routeStartedAt, scenarioId: ingress.scenario_id,
        turnId: ingress.turn_id, userMessage: ingress.message, answerKind: run.answerKind,
      });
    }
  );
}

/**
 * Pull the boolean `retryable` flag out of a failure-response envelope's
 * first error-block details. `buildFailureResponse` stamps this (Group 3
 * Task B) and the set of retryable internal classes lives in
 * `src/orchestrator-v5/failure-response.ts`. Defensive: returns false on
 * any shape drift, which is the safer default (don't advertise retryability
 * we're not sure about).
 */
