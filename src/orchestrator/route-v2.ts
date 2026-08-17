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
import type {
  V5DiagnosticExitPath,
  V5DiagnosticTrace,
} from '../orchestrator-v5/diagnostics/v5-diagnostic-trace.js';
import { buildMinimalV5DiagnosticTrace } from '../orchestrator-v5/diagnostics/v5-diagnostic-trace.js';
import {
  GRAPH_CONFLICT_RECOVERY_KEYS,
  GRAPH_CONFLICT_RECOVERY_COPY_MODE,
} from '../orchestrator-v5/graph-conflict-recovery-keys.js';
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
import { runTurnExecutor } from '../orchestrator-v5/turn-executor.js';
import { dispatchSystemEvent } from '../orchestrator-v5/system-events/dispatch.js';
import { dispatchDraftGraph } from '../orchestrator-v5/handlers/draft-graph-dispatch.js';
// R2 — post-draft auto-run scheduler (fires AFTER the draft response is
// handed to the transport; see the draft_graph branch below).
import { scheduleAutoRunAfterFreshDraft } from '../orchestrator-v5/handlers/auto-run-after-draft.js';
// ROADMAP 2.735 — did THIS turn hand the client a graph to render? The one
// fact that separates a lost model from a draft that never existed.
import { graphPreviewEmitted } from '../cee/unified-pipeline/stage-stream-context.js';
import { dispatchEditGraph } from '../orchestrator-v5/handlers/edit-graph-dispatch.js';
import { finaliseV5Response, isFinalisedV5Response, type FinalisedV5Response } from '../orchestrator-v5/response-finaliser.js';
import { sanitiseOlumiResponseForEgress } from '../orchestrator-v5/compose/output-safety.js';
import type { MayNameLeadingOptionProvenance } from '../orchestrator-v5/context/claim-safety-read.js';
import { createTurnClaimSafetyResolver } from '../orchestrator-v5/context/turn-claim-safety.js';
import type { TurnClaimSafetyResolver } from '../orchestrator-v5/context/turn-claim-safety.js';
// T1 claim safety, LAYER 3 — armed ONCE at the send point (1.272 E1). It used
// to be called from inside `sanitiseOlumiResponseForEgress`, which this file
// re-enters 2–8 times per response and always upstream of `finaliseV5Response`.
import { guardLeadingOptionClaimsAtEgress } from '../orchestrator-v5/compose/leading-option-egress-guard.js';
import { enforceLeadingOptionClaimsAtWire } from '../orchestrator-v5/compose/leading-option-wire-enforcement.js';
import {
  deriveAnswerTextFromShape,
  synthesiseAnswerShapeFromText,
} from '../orchestrator-v5/routing/answer-shape.js';
import type { GraphV3T } from './types.js';
import { GraphV3 } from '../schemas/cee-v3.js';
import { getRequestId } from '../utils/request-id.js';
import {
  dispatchDeterministicChipClick,
  isDeterministicChipClickActionType,
} from '../orchestrator-v5/handlers/chip-click-dispatch.js';
import {
  DRAFT_GRAPH_MIN_BRIEF_LENGTH,
  isDraftShapedText,
} from '../schemas/assist.js';
import { runPreFlight } from './route-v2-preflight.js';
import { admitCurrentTurnFence, turnFencePreHandler } from './turn-fence-prehandler.js';
import { recordExplicitTurnStop } from '../routes/turn-stop.js';
import {
  GraphStateIngressSchema,
  type GraphStateIngress,
} from '../orchestrator-v5/boundary/request-extensions.js';
import {
  buildTurnContext,
  loadDraftLossStands,
  loadHasOtherAdmittedLiveTurn,
  loadHasPriorTurns,
  markDraftGraphWriteFailed,
  loadMostRecentPendingActions,
  loadMostRecentPendingActionsStrict,
  loadPersistedGraphStrict,
  loadPersistedScenarioStateStrict,
  loadRecentConversationTurns,
} from '../orchestrator-v5/build-turn-context.js';
import { deriveAnalysisFreshness } from '../orchestrator-v5/context/freshness.js';
import { dispatchAddOptionTransaction } from '../orchestrator-v5/handlers/add-option-dispatch.js';
import { buildHeldSupersessionNotice } from '../orchestrator-v5/handlers/edit-graph-referee-gate.js';
import { appendLapseNotice } from '../orchestrator-v5/handlers/hold-thread-through.js';
import type { FrameFreshness } from '../orchestrator-v5/graph-management/types.js';
import {
  assembleExplicitGenerateBrief,
  type AssembledExplicitGenerateBrief,
} from '../orchestrator-v5/routing/assemble-explicit-generate-brief.js';
import { composeDirectAnswerResponse } from '../orchestrator-v5/compose.js';
import { composeEditClarifyResponse } from '../orchestrator-v5/compose/edit-clarify-response.js';
import { computeAnalysisAffectingGraphHash } from '../orchestrator-v5/context/graph-hash.js';
import type {
  PendingAction,
  PendingActionAction,
} from '../orchestrator-v5/session/pending-action.js';
import {
  isPendingActionExpired,
  PENDING_ACTION_DEFAULT_TURN_TTL,
  PENDING_ACTION_DEFAULT_WALL_TTL_MS,
} from '../orchestrator-v5/session/pending-action.js';
import { randomUUID } from 'node:crypto';
import {
  commitDirectAnswer,
  computeRequestHash,
  computeSurvivingPriorPendings,
} from '../orchestrator-v5/commit.js';
import { normaliseBriefText } from '../orchestrator-v5/session/normalise-brief-text.js';
import { normaliseReplayMessage } from '../orchestrator-v5/compose/looping-chip-guard.js';
import { isAnalyticalQuestion } from '../orchestrator-v5/routing/analytical-question-guard.js';
import {
  PROPOSAL_CONFIRM_PATTERN,
  SHORT_CONFIRM_PATTERN,
} from '../orchestrator-v5/routing/deterministic-short-confirm.js';
import { findExactProposalCopyMatchIndexes } from '../orchestrator-v5/routing/proposal-ordinal-select.js';
import { resolveProposalRenderCopy } from '../orchestrator-v5/compose/proposed-change.js';
import { isStateQueryQuestionShape } from '../orchestrator-v5/routing/state-query-guard.js';
import {
  projectOptionLabels,
  resolveConfigureOptionIntent,
} from '../orchestrator-v5/routing/configure-option-intent.js';
import { detectStructuralRestructureIntent } from '../orchestrator-v5/routing/structural-restructure-intent.js';
import { classifyAnalyticalIntent } from '../orchestrator-v5/routing/analytical-intent.js';
import { tryChipSimplifyIntercept } from '../orchestrator-v5/routing/chip-simplify-intercept.js';
import {
  composePostAnalysisLabelInterceptResponse,
  tryPostAnalysisLabelIntercept,
} from '../orchestrator-v5/routing/post-analysis-label-intercept.js';
import { tryVagueEditGuard } from '../orchestrator-v5/routing/vague-edit-guard.js';
// L16 / N16 — deterministic remedy for a bare configure-option turn.
import { shouldInterceptBeforeEditLane } from '../orchestrator-v5/routing/configure-option-clarify.js';
import { composeConfigureOptionClarifyResponse } from '../orchestrator-v5/compose/configure-option-clarify-response.js';
// ⭐ ROADMAP 2.1261 — repair-leg bare-value binding ("Set it to 0.12.").
import {
  matchBareRepairValue,
  resolveRepairValueBinding,
  type RepairValueBindingResolution,
} from '../orchestrator-v5/routing/repair-value-binding.js';
import { composeRepairValueAskResponse } from '../orchestrator-v5/compose/repair-value-ask-response.js';
import { buildCanonicalAnalysisReadyFromGraph } from './tools/analysis-ready-helper.js';
import {
  isProcessMetaIntake,
  composeProcessMetaIntakeResponse,
} from '../orchestrator-v5/routing/process-meta-intake.js';
import { composeReadinessIntakeResponse } from '../orchestrator-v5/routing/readiness-intake.js';
import { buildReadinessRepairOffer } from '../orchestrator-v5/handlers/readiness-repair-proposal.js';
import { shouldSuppressEditDispatchForValueUpdate } from './routing/value-update-gate.js';
import {
  EDIT_GRAPH_NEGATIVE_REGEX,
  EDIT_GRAPH_POSITIVE_REGEX,
} from './routing/edit-graph-intent-regex.js';

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
// F2 CHANGE A — forced explanation-intent detector (typed analytical pill)
// ───────────────────────────────────────────────────────────────────
//
// `explain_results` and `what_would_flip` are no longer in the
// deterministic-chip whitelist (chip-click-dispatch.ts) — they must reach the
// conversation-aware coach. This pure detector maps a typed analytical
// chip_click to the FORCED explanation handler threaded into
// `runTurnExecutor` as `chipClickForcedIntent`. TurnExecutor passes it to
// `routeWithToolUse` (thinking disabled, tool forced, handler pinned) so the
// pill answer sees the loaded conversation window and the coach cannot
// re-route the typed intent.
//
// HAZARD 3 (the `explain_result` singular alias): the alias is NOT a
// registered handler id (`resolveHandler(registry, 'explain_result')` is null),
// so letting it reach the coach as a proposed handler_id would surface
// HANDLER_NOT_FOUND / UNSUPPORTED_ACTION — a broken pill. We canonicalise it to
// `explain_results` HERE, at the typed door, so the alias is pinned to the real
// handler and never 400s.
//
// F2 CHANGE B — `what_changed` is a THIRD forced analytical intent. Unlike the
// two explanation intents it does NOT route to an explanation handler; it owns
// the run-comparison mechanism (freshness fail-closed + the real two-run
// `RunDelta` via `compareRuns`), answered DETERMINISTICALLY by `composeComparison`
// (0-LLM) in EVERY case — the confirmed-fresh compared delta and the fail-closed
// verdicts alike. Coach-narration of the confirmed-fresh delta is DEFERRED to its
// own review: its precondition is registering `what_changed` as a PINNED
// explanation-class handler + threading the `RunDelta` as ground truth, with
// `composeComparison` kept as the fallback. TurnExecutor branches on this value BEFORE the generic
// forced-explanation `routeWithToolUse` call, so `forcedExplanationHandlerId` is
// NEVER set to `what_changed` (it is not an explanation handler id). Typing the
// pill is the point: it reaches the comparison mechanism WITHOUT depending on
// the free-text `classifyAnalyticalIntent` regex (which is for typed-chat only).
//
// A chip_click of any OTHER typed action_type returns undefined and reaches
// TurnExecutor unforced (Sonnet routes it normally / UNSUPPORTED_ACTION).
export function detectChipClickForcedIntent(
  ingress: OrchestratorTurnPayload,
): 'explain_results' | 'what_would_flip' | 'what_changed' | undefined {
  if (ingress.kind !== 'message') return undefined;
  if (ingress.source !== 'chip_click') return undefined;
  const actionType = ingress.chip?.action_type;
  if (actionType === 'explain_results' || actionType === 'explain_result') {
    return 'explain_results';
  }
  if (actionType === 'what_would_flip') return 'what_would_flip';
  if (actionType === 'what_changed') return 'what_changed';
  return undefined;
}

// ───────────────────────────────────────────────────────────────────
// ROADMAP 2.63 C3/C4 — deterministic draft/redraft offer
// ───────────────────────────────────────────────────────────────────
//
// `draft_graph` is not in the wire ActionType enum, so the offer chip is a
// plain text-replay chip and the pending action is server-only (explicit
// `CommitMetadata.pending_actions`, mirroring `proposed_concept`). The offer
// resumes HERE at the route (never in TurnExecutor, which cannot draft) via
// the SAME primitives as the existing consent machinery: the persisted
// public copy exact-match (`findExactProposalCopyMatchIndexes` — the
// held-proposal replay matcher) and `SHORT_CONFIRM_PATTERN` (the
// deterministic short-confirm pattern), with the shared read-time liveness
// authority (`isPendingActionExpired`). Fixed copy, British English, no em
// dashes (house style — this text bypasses no sanitise seam but must not
// depend on one either).

/**
 * C3 — frame-guard offer chip (no action_type: text-replay chip).
 *
 * EXPORTED so route-level tests can bind to the chip by IDENTITY rather than
 * retyping the copy (CLAUDE.md trap 12 — a hand-copied constant is a mirror
 * that drifts silently, and trap 19 — an assertion must name its object).
 * `route-v2-no-persisted-graph-fallthrough.test.ts` is the current consumer.
 */
export const DRAFT_OFFER_CHIP_LABEL = 'Build the model';
export const DRAFT_OFFER_CHIP_MESSAGE = 'Yes, build the model from what I have shared.';

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
/**
 * C3 — appended to the frame-guard copy ONLY when a usable brief seed was
 * captured (so the offer is never made with nothing to build from). The
 * guard's original first sentence is preserved verbatim: existing tests and
 * dashboards key on it.
 *
 * P1-1 (adversarial review, #488): the ", or just reply yes" clause is
 * DERIVED from the pendings state (`willDraftOfferBeSoleLivePending`), never
 * asserted unconditionally — see that helper's doc for the mechanism.
 */
function draftOfferGuardSentence(offerWillBeSoleLive: boolean): string {
  const base =
    "Or I can draft a first model from what you've shared so far: choose 'Build the model' below";
  return offerWillBeSoleLive ? `${base}, or just reply yes.` : `${base}.`;
}

/** C4 — graph-present decline offer chip (text-replay chip). */
const REDRAFT_OFFER_CHIP_LABEL = 'Redraft the model';
const REDRAFT_OFFER_CHIP_MESSAGE = 'Yes, redraft the model from my brief.';
/**
 * C4 — alternate replay copy, used when the INCOMING message already equals
 * the standard copy (a hash-changed re-offer answering the user's own click
 * of the previous offer chip). The egress looping-chip guard rightly drops
 * any text-replay chip whose message normalise-equals the user's message
 * (no-dead-end invariant); alternating the copy keeps the re-offer clickable
 * without weakening that guard. Equality is checked with the guard's OWN
 * `normaliseReplayMessage` — never a hand-mirrored predicate.
 */
const REDRAFT_OFFER_CHIP_MESSAGE_ALT = 'Yes, start the redraft from my brief.';
/**
 * C4 — deterministic decline for an explicit generate on a scenario that
 * already has a graph (request `graph_state` or persisted). Ratified
 * doctrine (Paul, 16 Jul): decline-with-redraft-offer, consistent with the
 * held-proposal consent posture (never a silent replace, never a silent
 * ignore). Consenting to the offer chip / replying yes REPLACES the model.
 *
 * P1-1 (adversarial review, #488): the "or reply yes" clause is DERIVED from
 * the pendings state (`willDraftOfferBeSoleLivePending`), never asserted
 * unconditionally — see that helper's doc for the mechanism.
 */
function explicitGenerateGraphPresentText(offerWillBeSoleLive: boolean): string {
  return (
    'This decision already has a model, so I have not replaced it. ' +
    (offerWillBeSoleLive
      ? "If you want a fresh draft instead, choose 'Redraft the model' below or reply yes, " +
        'and I will rebuild it from your brief. '
      : "If you want a fresh draft instead, choose 'Redraft the model' below and I will " +
        'rebuild it from your brief. ') +
    'Otherwise tell me what to change and I will edit the existing model.'
  );
}

/**
 * P1-1 (adversarial review, #488) — will the freshly-minted draft/redraft
 * offer be the SOLE live pending after this commit?
 *
 * `resolveDraftOfferResume` accepts a bare confirmation ("yes") ONLY when the
 * offer is the sole live pending; with any other live pending (a
 * chip-suggestion `run_analysis` / `what_would_flip`, TTL 2 turns, which
 * SURVIVES this commit's carry-forward) the next turn's "yes" falls to the
 * deterministic-short-confirm machinery's RESUMABLE_KINDS and executes THAT
 * action instead — so copy promising "reply yes" would promise the wrong
 * action (reproduced in review: dispatchDraftGraph 0 calls, analysis ran).
 *
 * MECHANISM (ratified direction — derive the promise from the state, never
 * mirror it): reuse the commit seam's OWN carry-forward
 * (`computeSurvivingPriorPendings`) with the same inputs the emit site's
 * `commitDirectAnswer` call will pass (no consumed refs, no
 * `metadata.graph_hash` at either offer-emit site), so the survivor set here
 * IS the set the next turn's resume will read. Any survivor is
 * non-`draft_graph` by construction (a fresh offer supersedes carried offers
 * kind-level), so zero survivors ⟺ the offer stands alone. This also covers
 * the live `proposed_concept` case (review P2-a): a surviving concept hold
 * suppresses the "reply yes" clause the same way.
 *
 * Error direction is safe by construction: a survivor counted here that
 * wall-expires before the next read (or is cap-evicted at persist) only makes
 * the copy OMIT "reply yes" where it would in fact have worked — the named
 * chip route always works.
 */
function willDraftOfferBeSoleLivePending(
  priorPendings: readonly PendingAction[],
  offer: PendingAction,
  nowMs: number,
): boolean {
  return (
    computeSurvivingPriorPendings(priorPendings, [offer], [], undefined, nowMs)
      .length === 0
  );
}

/**
 * P1-2 (adversarial review, #488) — is the ingress `graph_state` a POPULATED
 * graph? `GraphStateIngressSchema` accepts `{nodes:[],edges:[]}` (a
 * structurally-valid EMPTY canvas), and the C4 arms must treat that as "no
 * model": declining with "This decision already has a model" over zero nodes
 * is false, and the redraft offer it seeds would target a model that does not
 * exist. LOCAL twin of `isPopulatedGraphCandidate` (#473's run_analysis
 * adopt-on-empty lane — same judgement: plain object with a non-empty `nodes`
 * array), not importable while that lane is unmerged; when both land, keep
 * one and delete the other.
 */
function isPopulatedIngressGraph(g: unknown): boolean {
  return (
    g !== null &&
    typeof g === 'object' &&
    !Array.isArray(g) &&
    Array.isArray((g as { nodes?: unknown }).nodes) &&
    (g as { nodes: unknown[] }).nodes.length > 0
  );
}

type DraftOfferAction = Extract<PendingActionAction, { readonly kind: 'draft_graph' }>;

interface DraftOfferResume {
  readonly pending: PendingAction;
  readonly action: DraftOfferAction;
  readonly trigger: 'copy_replay' | 'bare_confirm';
}

/**
 * Most-recent draft_graph offer among the prior turn's pendings, or null.
 * Presence (regardless of expiry) is the structural MARKER that the last
 * committed turn was a draft/redraft offer turn — used to un-strand the
 * brief-shape heuristic and to let the frame guard re-fire on continuation
 * scenarios it created. LIVENESS (non-expired) additionally gates CONSENT
 * (bare confirm / copy replay actually dispatching a draft).
 */
function findDraftOfferPending(
  pendings: readonly PendingAction[],
): PendingAction | null {
  const offers = pendings.filter((pa) => pa.action.kind === 'draft_graph');
  if (offers.length === 0) return null;
  if (offers.length === 1) return offers[0]!;
  const emittedMs = (pa: PendingAction): number => {
    const ms = Date.parse(pa.emitted_at_iso);
    return Number.isFinite(ms) ? ms : 0;
  };
  return [...offers].sort((a, b) => emittedMs(b) - emittedMs(a))[0]!;
}

/**
 * Resolve whether this message CONSENTS to a live draft/redraft offer.
 *
 *   1. Exact replay of the offer's persisted public copy (our chip click, or
 *      the same text typed) names the target: resumes regardless of other
 *      live pendings — same posture as the held-proposal replay pre-route.
 *   2. A bare short-confirmation ("yes", "ok", "go ahead") resumes ONLY when
 *      the draft offer is the SOLE live pending kind. With any other live
 *      pending (a consent hold, a chip suggestion) the message falls through
 *      untouched, so the existing short-confirm machinery keeps owning it —
 *      the F-HELD consent-priority and consent-clarity rulings are never
 *      shadowed from here.
 *
 * Expired offers never consent (the caller's re-offer paths own recovery).
 */
function resolveDraftOfferResume(
  message: string,
  pendings: readonly PendingAction[],
  nowMs: number,
): DraftOfferResume | null {
  const offer = findDraftOfferPending(pendings);
  if (offer === null || isPendingActionExpired(offer, nowMs)) return null;
  const action = offer.action as DraftOfferAction;
  const copyMatches = findExactProposalCopyMatchIndexes(message, [
    { label: action.public_label, message: action.public_message },
  ]);
  if (copyMatches.length > 0) {
    return { pending: offer, action, trigger: 'copy_replay' };
  }
  const otherLivePendingExists = pendings.some(
    (pa) => pa.action.kind !== 'draft_graph' && !isPendingActionExpired(pa, nowMs),
  );
  if (!otherLivePendingExists && SHORT_CONFIRM_PATTERN.test(message)) {
    return { pending: offer, action, trigger: 'bare_confirm' };
  }
  return null;
}

/**
 * Capture a brief seed from the offering turn's message: typed sources only
 * (a chip_click's canned text carries zero decision content — same rule as
 * C2's `message_unshaped` bar), normalised and length-floored. Undefined
 * when unusable — the offer is then not made (C3) or made without a seed
 * (C4, where the persisted brief usually exists).
 */
function deriveDraftOfferSeed(
  message: string,
  source: string,
): string | undefined {
  if (source === 'chip_click') return undefined;
  const value = normaliseBriefText(message).value ?? '';
  if (value.length < DRAFT_GRAPH_MIN_BRIEF_LENGTH) return undefined;
  // Never seed a TYPED replay of an offer's own copy: "Yes, build the model
  // from what I have shared." is long enough to pass the floor but is a
  // consent phrase, not decision content — seeding it would make a later
  // resume draft a model ABOUT the confirmation sentence.
  const normalised = normaliseReplayMessage(value);
  if (
    normalised === normaliseReplayMessage(DRAFT_OFFER_CHIP_MESSAGE) ||
    normalised === normaliseReplayMessage(REDRAFT_OFFER_CHIP_MESSAGE) ||
    normalised === normaliseReplayMessage(REDRAFT_OFFER_CHIP_MESSAGE_ALT)
  ) {
    return undefined;
  }
  return value;
}

function buildDraftOfferPending(input: {
  readonly scenarioId: string;
  readonly chipId: string;
  readonly publicLabel: string;
  readonly publicMessage: string;
  readonly briefSeed?: string;
  readonly redraft?: boolean;
  readonly graphHash?: string | null;
  readonly nowMs: number;
}): PendingAction {
  return {
    id: randomUUID(),
    scenario_id: input.scenarioId,
    chip_id: input.chipId,
    action: {
      kind: 'draft_graph',
      ...(input.briefSeed !== undefined ? { brief_seed: input.briefSeed } : {}),
      ...(input.redraft === true ? { redraft: true } : {}),
      public_label: input.publicLabel,
      public_message: input.publicMessage,
    },
    // The redraft offer pins the persisted graph's analysis-affecting hash
    // (when computable) so the commit carry-forward's existing hash rule
    // invalidates the offer if an edit lands between offer and consent —
    // consent must never silently cover a graph the user changed since.
    preconditions:
      typeof input.graphHash === 'string' && input.graphHash.length > 0
        ? { graph_hash: input.graphHash }
        : {},
    expires_at_turn_count: PENDING_ACTION_DEFAULT_TURN_TTL,
    expires_at_iso: new Date(input.nowMs + PENDING_ACTION_DEFAULT_WALL_TTL_MS).toISOString(),
    emitted_at_iso: new Date(input.nowMs).toISOString(),
  };
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
    readonly mayNameLeadingOption: boolean;
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
  },
): Promise<import('fastify').FastifyReply<{ Reply: V5RouteReply }>> {
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
  if (exitPath !== 'system_event' && ctx.graph == null && ctx.scenarioId !== undefined) {
    const lossStands = await loadDraftLossStands(ctx.scenarioId, requestId);
    if (lossStands) {
      candidateForFinalise = {
        ...candidate,
        assistant_text: `${DRAFT_LOSS_NOTICE}\n\n${candidate.assistant_text ?? ''}`.trimEnd(),
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
  const candidateFinalised = finaliseV5Response(candidateForFinalise, ctx);
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
    if (
      !hasTimings &&
      !hasTrace &&
      !hasContextSummary &&
      !hasReasoning &&
      !hasAnswerShape &&
      !hasGroundedSelection
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
  });
  const egress = validateEgress(candidateSanitised, requestId);
  let wireBody = egress.ok
    ? finaliseV5Response(
        sanitiseOlumiResponseForEgress(egress.value, { graph: ctx.graph, requestId, exitPath, userMessage: ctx.userMessage, mayNameLeadingOption: ctx.mayNameLeadingOption }),
        ctx,
      )
    : finaliseV5Response(
        sanitiseOlumiResponseForEgress(egress.fallback, { graph: ctx.graph, requestId, exitPath, userMessage: ctx.userMessage, mayNameLeadingOption: ctx.mayNameLeadingOption }),
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
      sanitiseOlumiResponseForEgress(augmented, { graph: ctx.graph, requestId, exitPath, userMessage: ctx.userMessage, mayNameLeadingOption: ctx.mayNameLeadingOption }),
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
    };
    const augmented: OlumiResponseWithDebugFields = {
      ...wireBody,
      _diagnostic_trace: stampedTrace,
    };
    wireBody = finaliseV5Response(
      sanitiseOlumiResponseForEgress(augmented, { graph: ctx.graph, requestId, exitPath, userMessage: ctx.userMessage, mayNameLeadingOption: ctx.mayNameLeadingOption }),
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
        sanitiseOlumiResponseForEgress(augmented, { graph: ctx.graph, requestId, exitPath, userMessage: ctx.userMessage, mayNameLeadingOption: ctx.mayNameLeadingOption }),
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
      sanitiseOlumiResponseForEgress(augmented, { graph: ctx.graph, requestId, exitPath, userMessage: ctx.userMessage, mayNameLeadingOption: ctx.mayNameLeadingOption }),
      ctx,
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
  if (egress.ok && ctx.answerShape) {
    const augmented: OlumiResponseWithDebugFields = {
      ...wireBody,
      _answer_shape: ctx.answerShape,
    };
    const withShape = finaliseV5Response(
      sanitiseOlumiResponseForEgress(augmented, { graph: ctx.graph, requestId, exitPath, userMessage: ctx.userMessage, mayNameLeadingOption: ctx.mayNameLeadingOption }),
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
    ctx.answerKind !== 'functional' &&
    !responseCarriesDraftGraphBlock(wireBody) &&
    !('_answer_shape' in (wireBody as Record<string, unknown>)) &&
    typeof wireBody.assistant_text === 'string' &&
    wireBody.assistant_text.trim().length > 0
  ) {
    const synth = synthesiseAnswerShapeFromText(wireBody.assistant_text);
    if (synth !== null) {
      const derived = deriveAnswerTextFromShape(synth);
      const augmented: OlumiResponseWithDebugFields = {
        ...wireBody,
        assistant_text: derived,
        _answer_shape: synth,
      };
      const withSynth = finaliseV5Response(
        sanitiseOlumiResponseForEgress(augmented, { graph: ctx.graph, requestId, exitPath, userMessage: ctx.userMessage, mayNameLeadingOption: ctx.mayNameLeadingOption }),
        ctx,
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
  // THE POPULATION. Eighteen of this file's nineteen `sendFinalised200` call
  // sites return BEFORE `runTurnExecutor` (`:4427`), so eighteen never pass
  // through `finalizeRun`'s `enforceWithheldLeaderClaimGuard` (#755) — which is
  // a function NESTED inside `runTurnExecutor`, closed over run-local state, and
  // therefore not callable from here even deliberately. Three of the eighteen
  // can carry model-authored text (`chip_click` ok, `draft_graph`, and the MAIN
  // edit exit), and the main edit exit is where the 28 Jul live confirmation
  // caught a withheld leader claim shipping at HTTP 200.
  //
  // WHY HERE AND NOT PER-EXIT. Eighteen per-exit edits is eighteen places for
  // the nineteenth exit to be forgotten — the hand-maintained mirror
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
  const wireEnforcement = enforceLeadingOptionClaimsAtWire(wireBody, {
    requestId,
    exitPath,
    mayNameLeadingOption: ctx.mayNameLeadingOption,
    // Read ONLY for the option ROSTER — "which options exist", never "which one
    // leads". The gate enters only when the prose NAMES one of this scenario's
    // own options, which is what spares "sales leads improved" and every other
    // ordinary use of the shared vocabulary. `null` here disarms the gate for
    // this turn and is REPORTED, not silent — see the opts docstring.
    graph: ctx.graph,
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
    wireBody = finaliseV5Response(projected, ctx);
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
  if (egress.ok && ctx.groundedSelection) {
    const augmented: OlumiResponseWithDebugFields = {
      ...wireBody,
      _grounded_selection: ctx.groundedSelection,
    };
    // Re-finalise: the spread breaks WeakSet membership (finaliser Mechanism B).
    wireBody = finaliseV5Response(augmented, ctx);
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
  // OBSERVE-ONLY (`enforce: false`): it reports and returns the response
  // unchanged, and the return value is discarded. It cannot alter a single wire
  // byte — which is why this move is byte-neutral by construction, not merely
  // by test.
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
  guardLeadingOptionClaimsAtEgress(wireBody, {
    requestId,
    exitPath,
    mayNameLeadingOption: ctx.mayNameLeadingOption,
    enforce: false,
  });
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
 * — the canonical field is `body.code`. Ten known CEE codes are emitted
 * across the codebase: CEE_LLM_VALIDATION_FAILED, CEE_TIMEOUT,
 * CEE_LLM_UPSTREAM_ERROR, CEE_RATE_LIMIT, CEE_COST_CAP,
 * CEE_BUDGET_EXCEEDED, CEE_INTERNAL_ERROR, CEE_GRAPH_INVALID,
 * CEE_VALIDATION_FAILED, CEE_SERVICE_UNAVAILABLE.
 */
export function mapDraftGraphPipelineReason(
  pipelineStatusCode: number,
  pipelineErrorCode: string,
  pipelineReason?: string | null,
  // ROADMAP 2.718 — the pipeline body's OWN top-level `retryable`, threaded
  // by handleDraftGraph as `pipelineRetryable`. `null` = producer silent
  // (or a pre-2.718 caller): the static map below decides alone.
  producerRetryable?: boolean | null,
): { reason: string; retryable: boolean } {
  const mapped = mapDraftGraphPipelineReasonStatic(
    pipelineStatusCode,
    pipelineErrorCode,
    pipelineReason,
  );
  // Producer-authoritative promotion (ROADMAP 2.718). An emitter that
  // EXPLICITLY declares `retryable: true` on its error body is believed —
  // this map is a hand-maintained mirror of producer semantics and had
  // drifted: the post-enforcement gate declares its CEE_GRAPH_INVALID
  // retryable (stochastic model topology — the same brief drafts cleanly on
  // rerun; see graph-enforcement.ts "HONEST RETRY", 2026-07-24) while this
  // map said "retrying reproduces" and flipped it to false on the wire,
  // beside recovery copy reading "Try again" (witnessed 2026-08-06, runs
  // de79da/39cf53). Promotion is MONOTONE: an explicit producer `false` is
  // indistinguishable from buildCeeErrorResponse's omission default, so it
  // never demotes a mapped true (a timeout stays retryable even when its
  // body carries the default false).
  if (producerRetryable === true && !mapped.retryable) {
    return { ...mapped, retryable: true };
  }
  return mapped;
}

function mapDraftGraphPipelineReasonStatic(
  pipelineStatusCode: number,
  pipelineErrorCode: string,
  pipelineReason?: string | null,
): { reason: string; retryable: boolean } {
  switch (pipelineErrorCode) {
    case 'CEE_LLM_VALIDATION_FAILED':
      // Sub-case split off by the pipeline body's typed `details.reason`
      // (2026-07-23 firefight): a max_tokens TRUNCATION is transient model
      // over-generation, not a bad brief — RETRY is the honest lever, so it is
      // retryable even though the parent code otherwise is not. Telling a
      // truncation user to refine the brief drives output-token demand UP and
      // reproduces the failure (the cruel inversion). All other
      // CEE_LLM_VALIDATION_FAILED causes (vague/nonsensical brief, schema
      // mismatch) stay non-retryable — retrying the same input reproduces them.
      if (pipelineReason === 'llm_truncated_max_tokens') {
        return { reason: 'draft_graph_cee_llm_validation_failed', retryable: true };
      }
      // Client-actionable: brief was too vague or LLM output didn't validate.
      // Not retryable without changing the input.
      return { reason: 'draft_graph_cee_llm_validation_failed', retryable: false };
    case 'CEE_TIMEOUT':
      return { reason: 'draft_graph_cee_timeout', retryable: true };
    case 'CEE_LLM_UPSTREAM_ERROR':
      return { reason: 'draft_graph_cee_llm_upstream_error', retryable: true };
    // ── 429 family — one shared wire reason, three distinct causes ───────
    // CEE_COST_CAP (spend cap) and CEE_BUDGET_EXCEEDED (elapsed-time
    // deadline) were split out of CEE_RATE_LIMIT on 2026-07-20 so on-call
    // can tell a throttle from a budget breach. They deliberately share
    // this case arm: the wire `reason` must stay byte-identical to what
    // consumers already handle, so the rename is observable in CEE logs
    // and telemetry only, never on the wire. Pinned by
    // tests/unit/cee.error-code-taxonomy.test.ts — the raw code is still
    // available to dashboards via `details.pipeline_error_code`.
    case 'CEE_RATE_LIMIT':
    case 'CEE_COST_CAP':
    case 'CEE_BUDGET_EXCEEDED':
      return { reason: 'draft_graph_cee_rate_limit', retryable: true };
    case 'CEE_INTERNAL_ERROR':
      // Pipeline catch-all — likely a true internal bug. Retryable so the user
      // isn't blocked, but logs should flag it for investigation.
      return { reason: 'draft_graph_cee_internal_error', retryable: true };
    case 'CEE_GRAPH_INVALID':
      // Emitted when enrichment or repair determines the LLM produced a
      // graph that cannot be made structurally valid. ⚠ CORRECTED 2026-08-06
      // (ROADMAP 2.718): this arm previously asserted "retrying with the
      // same input reproduces" — FALSE for two of the code's emitters. The
      // post-enforcement gate (graph-enforcement.ts) and the
      // OPTIONS_IDENTICAL bypass both fail on STOCHASTIC model topology and
      // declare `retryable: true` with retry-first recovery copy; the
      // witnessed 2026-08-06 runs drafted the SAME brief cleanly in
      // neighbouring runs of the same hour. `false` here is only the FLOOR
      // for emitters that declare nothing (enrichment crash, structural
      // parse) — an explicit producer `retryable: true` promotes it via the
      // wrapper above.
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

/**
 * ⚠ ROADMAP 2.388 — `'no_persisted_graph'` IS NOW REACHABLE ONLY OFF THE FRAME
 * STAGE, and that narrowing is the fix, not a side effect.
 *
 * "There is no graph yet" is not a failure to recover from — it is an empty
 * canvas, and this copy ("…I couldn't access the current graph. Please try
 * again in a moment.") told users to retry the one thing that could not work.
 * At `stage: 'frame'` — which is what the UI sends on a first message, and
 * where every MEASURED dead end arrived — that branch now falls through to the
 * frame-no-brief guard's coaching instead.
 *
 * It stays in this union because the `analyse`-stage case is deliberately NOT
 * changed: the frame guard cannot catch a turn there, so falling through would
 * hand the turn to a broad TurnExecutor LLM call and break the edit-lane
 * routing contract. See the SCOPE 2 note at the branch.
 *
 * The other two are genuinely transient: the session store was unreachable, or
 * the stored graph could not be parsed. For those, "try again in a moment" is
 * honest advice at every stage.
 */
type EditGraphRecoveryReason =
  | 'no_persisted_graph'
  | 'persisted_graph_invalid'
  | 'session_store_failed';

async function sendEditGraphRecovery(
  reply: import('fastify').FastifyReply<{ Reply: V5RouteReply }>,
  requestId: string,
  scenarioId: string,
  stage: import('@talchain/schemas/boundary').StageType,
  reason: EditGraphRecoveryReason,
  userMessage: string | null,
  claimSafety: TurnClaimSafetyResolver,
  turnId: string,
  routeStartedAt: number,
): Promise<import('fastify').FastifyReply<{ Reply: V5RouteReply }>> {
  emit(TelemetryEvents.V5EditGraphGraphStateUnavailable, {
    request_id: requestId,
    scenario_id: scenarioId,
    reason,
  });
  return sendFinalised200(reply, requestId, 'edit_graph', composeDirectAnswerResponse({
    answerKind: 'functional',
    assistant_text: EDIT_GRAPH_RECOVERY_TEXT,
    stage,
  }), {
    graph: null,
    answerKind: 'functional',
    userMessage,
    // T1 claim safety — INHERITED from the turn-entry read. Never a literal:
    // the permission belongs to the fact this response DISPLAYS, not to
    // whether this turn ran an analysis. See turn-claim-safety.ts.
    ...(await claimSafety.forExit()),
    // ⚠ THE TRACE INPUTS ARE NEW, AND THEY ARE NOT COSMETIC. Without them the
    // minimal-trace builder never runs, so this exit shipped NO
    // `_diagnostic_trace` at all — which meant its claim-safety permission was
    // UNOBSERVABLE at the wire and no acceptance walk could falsify it. An
    // exit whose guarantee cannot be measured is the guarantee-theatre shape
    // this workstream exists to remove, so the stamp and its instrument land
    // together. Flag-gated exactly like every other family's.
    requestStartedAt: routeStartedAt,
    scenarioId,
    turnId,
  });
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

// Positive decision-brief regex for draft_graph dispatch — canonical
// definition now lives in src/schemas/assist.ts (ROADMAP 2.63: was a
// module-local twin of derive-brief-seed's BRIEF_SEED_DECISION_REGEX;
// both now derive from the single export). Imported above alongside
// DRAFT_GRAPH_MIN_BRIEF_LENGTH.

// The two edit-intent regexes now live in
// `src/orchestrator/routing/edit-graph-intent-regex.ts` (ROADMAP 2.308 / S2)
// so the product's own chip and prompt copy can be tested against the gates it
// must pass without importing this module. Imported at the top of the file.

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
 * message shapes ("Yes, add 'Wasted time' and update 'Marketing'.") that a user
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
  // F4 — a graph CAS write conflict (GRAPH_DIVERGED) returns 409, not the
  // uniform 500, so the UI can branch to refresh-and-reconfirm rather than a
  // generic infra-failure retry.
  409: BoundaryError;
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

  // ══════════════════════════════════════════════════════════════════════════
  // POST /orchestrate/v2/turn/stop — the service-key ingress for the explicit
  // user Stop. Auth is the file's global hook, exactly as for the buffered turn.
  //
  // Reached by the UI's Netlify edge rung: the UI derives its stop URL as
  // `<buffered endpoint>/stop`, and when VITE_V5_ENDPOINT is not baked the
  // buffered endpoint is `/bff/orchestrate/v2/turn`, which the edge function
  // rewrites onto this route with the service key injected. The browser-facing
  // twin is `/proxy/v5/turn/stop`. They differ ONLY in ingress; the handler is
  // `recordExplicitTurnStop`, once — see src/routes/turn-stop.ts.
  //
  // NOT fenced by turnFencePreHandler: a stop request is not a turn and must
  // never claim a generation of its own.
  // ══════════════════════════════════════════════════════════════════════════
  app.post('/orchestrate/v2/turn/stop', async (req, reply) => {
    const requestId =
      (typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'] : null) ??
      randomUUID();
    const result = await recordExplicitTurnStop(req, requestId);
    return reply.code(result.status).send(result.body as never);
  });

  // V5 TURN FENCE (Codex P0) — claim this turn's place in the scenario's start
  // order BEFORE any dispatch, and run the whole request inside the fence
  // context so the commit chokepoint can read it ~50 s later. Route-scoped
  // rather than app-wide: this is the only ingress that writes scenarios.graph,
  // and app.inject() from the proxy/streamed routes runs this hook too, so
  // every graph-writing lane is covered by construction. See
  // turn-fence-prehandler.ts (why a hook, why callback style) and turn-fence.ts
  // (the defect, and the arrival enumeration).
  app.post<{ Reply: V5RouteReply }>('/orchestrate/v2/turn', { preHandler: turnFencePreHandler }, async (req, reply) => {
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
    // criterion 2 / 1.349 P1-2). Constructed HERE, before the first dispatch
    // branch, so EVERY exit below can inherit ONE answer.
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
    const claimSafety: TurnClaimSafetyResolver = createTurnClaimSafetyResolver(
      ingress.kind === 'message' ? ingress : null,
      requestId,
    );

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
          'V5 system event graph conflict — returning 409 with refresh-reconfirm BoundaryError envelope',
        );
        return reply.code(409).send(boundaryError);
      }
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
          return sendFinalised200(reply, requestId, 'chip_click', cc.response, {
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
          });
        }
        if (cc.outcome === 'handler_failure') {
          const boundaryError: BoundaryError = buildCommitFailureBoundaryError({
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
    // S2-L1 — typed readiness/coaching pre-heuristic arm + §2g totality
    // ────────────────────────────────────────────────────────────────────
    //
    // Runs immediately AFTER the deterministic-chip-click block and BEFORE the
    // entire heuristic ladder (resume-intent, draft dispatch, clarify gate,
    // process-meta answer, frame guard). This is the correct pre-route
    // insertion point: a typed chip_click is routed by its TYPE, ahead of every
    // string/shape heuristic.
    //
    // It cannot shadow the held-proposal / short-confirm / value-update text
    // ladders: those key on composer TEXT (AFFIRMATIVE_PREFIX_PATTERN +
    // rendered-copy match, SHORT_CONFIRM_PATTERN, deterministic-value-update)
    // and run inside / just ahead of TurnExecutor. This arm keys on
    // `source==='chip_click'` + a typed `action_type` — a disjoint
    // discriminant. It also does not collide with the what_would_flip
    // chip-click resume below (gated on `action_type==='what_would_flip'`, a
    // whitelisted literal that already returned above).
    //
    // By the time control reaches here, every WHITELISTED chip_click
    // (`DETERMINISTIC_CHIP_ACTION_TYPES`) has already returned from the block
    // above. What remains, for `source==='chip_click'` with a defined typed
    // `action_type`, is: `analysis_readiness` (→ the readiness arm) and every
    // other valid-but-non-whitelisted type (→ TurnExecutor via the §2g
    // totality below).
    const isTypedChipClick =
      ingress.source === 'chip_click' && chipActionType !== undefined;
    const isReadinessChipClick =
      isTypedChipClick && chipActionType === 'analysis_readiness';
    // §2g fix (fold-in): a typed chip_click with a defined action_type that was
    // neither deterministically dispatched (returned above) nor claimed by the
    // readiness arm. The #575 commit message always intended these to reach
    // TurnExecutor ("the rest belong to TurnExecutor"); today the chip_click
    // exclusion forces draftShapedTurn=false and the frame-stage no-brief guard
    // wrongly CLAIMS a draft-shaped one with the canned framing prompt
    // (documented + test-pinned as a live misfire). This flag makes the
    // chip_click region TOTAL over typed chip clicks: whitelisted →
    // deterministic; analysis_readiness → readiness arm; every other valid type
    // → TurnExecutor. It is threaded as an exclusion into the process-meta
    // answer branch and the frame-stage no-brief guard below so neither claims
    // it, and control falls through to the single runTurnExecutor call site.
    // ROADMAP 1.203 R2(a) / A2-ASKS 1.193a — executor-door widening to INTENT-only
    // chips. An `add_option` chip carries `chip.intent='add_option'` and NO
    // `action_type`, so `isTypedChipClick` is false and the door guard would not
    // see it. When the deterministic add-option transaction DECLINES a chip (a
    // stale / diverged baseline → the structural referee fails closed and the
    // add-option arm falls through with `fell_through:not_held`), the declined chip
    // would then be CLAIMED by the free-text edit LLM lane (`editIntentDetected`
    // below, 13.6s, `llm_calls:['edit_graph']`) rather than reaching TurnExecutor —
    // because the 1.187 door guard keys on `action_type` only, which is undefined
    // for an intent-only chip (A2 Lane-U evidence: stale req b3c552bf took the LLM
    // edit lane, fresh req 19ba5dd1 took the 1.7s deterministic transaction).
    // Widening the guard to the intent-only add_option chip routes a
    // declined/fell-through add_option to the executor, not the LLM edit lane.
    // Safe across all three consumers (editIntentDetected · process-meta-intake ·
    // frame-no-brief) — each uses this flag as an executor-routing EXCLUSION; and
    // the held/fresh add_option path RETURNS in the add-option arm below before
    // reaching any of them, so only the decline/fall-through path is affected.
    const isAddOptionIntentChip =
      (ingress.source === 'chip_click' || ingress.source === 'chip') &&
      ingress.chip?.intent === 'add_option';
    // egress-F1 (2026-07-24) — NARROW the #658 door widening. Routing a
    // fell-through add_option to the executor is correct ONLY for the
    // stale/diverged referee decline (`fell_through:not_held`): the executor has
    // no add-option capability, so for the gm_off / commit_failed / malformed-spec
    // / turn-context-read-failure legs the executor is a DEAD END — those legs
    // regain their pre-#658 fallback, the free-text edit LLM lane. `let` so the
    // add-option arm below can promote it to `true` for the `not_held` leg only.
    // A typed action_type chip click stays unconditionally executor-bound.
    let isNonReadinessTypedChipClickForExecutor =
      isTypedChipClick && !isReadinessChipClick;

    if (isReadinessChipClick) {
      // Read the PERSISTED scenario graph (the same authority the run_analysis
      // chip uses — never the HTTP body). A store/RPC failure degrades to the
      // honest fresh-canvas answer (persistedGraph=null path) rather than a
      // 500: a readiness coaching turn should not brick on a transient read.
      let persistedGraph: unknown | null = null;
      let readinessPriorPendings: readonly PendingAction[] = [];
      let readinessPendingReadOk = false;
      try {
        const state = await loadPersistedScenarioStateStrict(ingress.scenario_id);
        persistedGraph = state.graph;
      } catch (err) {
        log.warn(
          {
            request_id: requestId,
            scenario_id: ingress.scenario_id,
            err: err instanceof Error ? { name: err.name, message: err.message } : { message: String(err) },
          },
          'S2-L1 readiness arm — persisted-graph read failed; degrading to fresh-canvas answer',
        );
      }
      try {
        readinessPriorPendings = await loadMostRecentPendingActionsStrict(
          ingress.scenario_id,
          requestId,
        );
        readinessPendingReadOk = true;
      } catch (err) {
        log.warn(
          {
            request_id: requestId,
            scenario_id: ingress.scenario_id,
            err: err instanceof Error ? { name: err.name, message: err.message } : { message: String(err) },
          },
          'S2-L1 readiness arm — pending read failed; readiness remains available without an apply control',
        );
      }
      const readiness = composeReadinessIntakeResponse(persistedGraph, ingress.stage);
      let readinessResponse = readiness.response;
      let readinessOffer: ReturnType<typeof buildReadinessRepairOffer> = null;
      if (readiness.assessment && readinessPendingReadOk && persistedGraph !== null) {
        try {
          const graphHash = computeAnalysisAffectingGraphHash(
            persistedGraph as GraphStateIngress,
          );
          if (graphHash === null) throw new Error('readiness graph hash unavailable');
          readinessOffer = buildReadinessRepairOffer({
            assessment: readiness.assessment,
            currentGraphHash: graphHash,
            scenarioId: ingress.scenario_id,
          });
        } catch {
          readinessOffer = null;
        }
      }
      if (readinessOffer) {
        readinessResponse = {
          ...readinessResponse,
          suggested_actions: [
            ...readinessResponse.suggested_actions,
            {
              id: readinessOffer.chip.id,
              label: readinessOffer.chip.label,
              message: readinessOffer.chip.message,
              ...(readinessOffer.chip.detail ? { detail: readinessOffer.chip.detail } : {}),
            },
          ],
        };
        try {
          const committed = await commitDirectAnswer(readinessResponse, {
            scenario_id: ingress.scenario_id,
            turn_id: ingress.turn_id,
            turn_class: 'direct_answer',
            handler_id: null,
            request_hash: computeRequestHash(ingress),
            llm_calls_used: 0,
            duration_ms: Date.now() - routeStartedAt,
            handler_facts: [],
            pending_actions: [readinessOffer.pending],
            priorPendingActions: readinessPriorPendings,
            coaching_state: null,
            userMessage: ingress.message,
          });
          readinessResponse = committed.response;
        } catch (err) {
          // A review control without a durable pending would be a dead control.
          // Keep the complete issue explanation, but remove the apply action.
          readinessResponse = readiness.response;
          readinessOffer = null;
          log.warn(
            {
              request_id: requestId,
              scenario_id: ingress.scenario_id,
              err: err instanceof Error ? { name: err.name, message: err.message } : { message: String(err) },
            },
            'S2-L1 readiness arm — repair proposal commit failed; omitting apply control',
          );
        }
      }
      log.info(
        {
          event: 'v5.readiness_intake',
          request_id: requestId,
          outcome: readiness.outcome,
          message_length: ingress.message.length,
        },
        'S2-L1 typed readiness/coaching arm fired — answering by type, not by the string mirror',
      );
      emit(TelemetryEvents.V5ReadinessIntakeArm, {
        request_id: requestId,
        outcome: readiness.outcome,
        message_length: ingress.message.length,
      });
      // A multi-blocker plan with safe canonicalisations persists exactly one
      // review pending above. Every other readiness answer remains graph-free.
      return sendFinalised200(reply, requestId, 'readiness_intake', readinessResponse, {
        graph: null,
        ...(readiness.assessment?.analysisReady
          ? { analysisReady: readiness.assessment.analysisReady }
          : {}),
        // T1 claim safety — INHERITED from the turn-entry read. Never a literal:
        // the permission belongs to the fact this response DISPLAYS, not to
        // whether this turn ran an analysis. See turn-claim-safety.ts.
        ...(await claimSafety.forExit()),
        // ROADMAP 1.132 (F1) — EGRESS-DEFAULT INVERSION: readiness-intake copy is
        // functional (receipt / question) and must ship plain.
        answerKind: 'functional',
        requestStartedAt: routeStartedAt,
        scenarioId: ingress.scenario_id,
        turnId: ingress.turn_id,
        userMessage: ingress.message,
      });
    }

    // ────────────────────────────────────────────────────────────────────
    // S3 §5 / Lane C3 — typed add-option compound transaction
    // ────────────────────────────────────────────────────────────────────
    //
    // A typed `add_option` intent (`chip.intent='add_option'`, schemas 0.22.0)
    // carries a pre-resolved spec in `chip.parameters`. Route it on its TYPE
    // into the atomic add-option transaction (option node + parent/factor edges
    // + effect VALUES as ONE held proposal) HERE — BEFORE the message-text
    // `editIntentDetected` below can claim the same turn for the free-text edit
    // LLM (Fable residual i, preemption). `add_option` is an `Intent`, not an
    // `ActionType`, so it is not caught by the typed-chip-click arms above.
    //
    // The transaction reuses the SAME referee gate + `graph_management_held_v1`
    // pending + `executeGmHeldResume` confirm the free-text edit uses. The
    // fall-through destination is per-leg (egress-F1, 2026-07-24): a
    // stale/diverged referee decline (`fell_through:not_held`) routes to the
    // EXECUTOR (the #658 intent — an LLM edit against a diverged frame is unsafe),
    // set via `isNonReadinessTypedChipClickForExecutor` below; every other leg
    // (GM not live, missing/malformed/unresolved spec, turn-context read failure,
    // failed commit) falls through to the existing free-text EDIT path — its
    // only working fallback, since the executor cannot add an option. Never a
    // silent coercion, never a dead end.
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
          addOptionPriorPendings = turnContext.most_recent_pending_actions ?? [];
          try {
            addOptionGraphHash = computeAnalysisAffectingGraphHash(
              addOptionFrameGraph as GraphStateIngress | null | undefined,
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
            turnContext.prior_facts_read_ok === undefined
              ? undefined
              : { priorFactsReadOk: turnContext.prior_facts_read_ok },
          ).freshness;
        } catch (err) {
          log.warn(
            {
              request_id: requestId,
              scenario_id: ingress.scenario_id,
              err: err instanceof Error ? { name: err.name, message: err.message } : { message: String(err) },
            },
            'S3-C3 add-option — turn-context read failed; deferring to the edit path',
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
            Date.now(),
          );
          if (supersessionNotice !== null) {
            addOptionResponse = {
              ...addOptionResponse,
              assistant_text: appendLapseNotice(
                addOptionResponse.assistant_text,
                supersessionNotice,
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
                err: err instanceof Error ? { name: err.name, message: err.message } : { message: String(err) },
              },
              'S3-C3 add-option — held-pending commit failed; deferring to the edit path',
            );
          }
          if (addOptionCommitted) {
            emit(TelemetryEvents.V5AddOptionTransaction, {
              request_id: requestId,
              outcome: 'held',
              configured: addOptionOutcome.configured,
            });
            return sendFinalised200(reply, requestId, 'add_option_transaction', addOptionWire, {
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
            });
          }
          emit(TelemetryEvents.V5AddOptionTransaction, {
            request_id: requestId,
            outcome: 'fell_through:commit_failed',
          });
          // commit_failed keeps its pre-#658 fallback: the free-text edit path
          // (leave the executor-door flag false).
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
          if (addOptionOutcome.reason === 'not_held') {
            isNonReadinessTypedChipClickForExecutor = true;
          }
          // else: fall through to the existing edit path below.
        }
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
    // F2 CHANGE A — a typed analytical pill (`explain_results` /
    // `what_would_flip` / the `explain_result` alias) forces its explanation
    // intent through the coach. This MUST take precedence over the
    // `what_would_flip` resume-intent: with those two action_types removed from
    // the deterministic-chip whitelist, a `what_would_flip` chip_click now
    // reaches `detectChipClickResumeIntent` (which was dead for chip clicks
    // while they were whitelisted) and would otherwise be diverted to the
    // deterministic short-confirm "yes" resume instead of the coach. Suppressing
    // the resume-intent when a forced intent is present keeps the pill on the
    // coach path; the resume-intent stays live for its real caller (typed "yes"
    // short-confirm, which is not a chip_click and so never sets a forced
    // intent).
    const chipClickForcedIntent = detectChipClickForcedIntent(ingress);
    const chipClickResumeIntent = chipClickForcedIntent
      ? undefined
      : detectChipClickResumeIntent(ingress);

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
    // ROADMAP 2.709 invariant 3 — continuation detection must SEE in-flight
    // turns. Committed rows alone cannot: a draft turn's atomic commit lands
    // ~50-80 s after admission, and the fresh-journey P0's S2 was exactly a
    // question arriving inside that window being intake-captured as a NEW
    // brief (zero committed rows, phantom state). The fence table holds the
    // draft's ADMITTED claim from the first seconds, so it is consulted as
    // the second disjunct — only when the committed-rows answer is false,
    // which is precisely the phantom-shaped state. Failure-marked rows are
    // excluded by the read so a scenario whose only draft LOST its commit
    // classifies fresh and a re-sent brief can redraft.
    const isContinuationScenario = frameStageNoGraph
      ? (await loadHasPriorTurns(ingress.scenario_id, requestId)) ||
        (await loadHasOtherAdmittedLiveTurn(ingress.scenario_id, ingress.turn_id, requestId))
      : false;
    // ROADMAP 2.709 invariant 6 — the draft-shortcut UNSTRANDING term. While
    // a draft loss stands (a failure-marked fence row + no committed graph),
    // the loss notice tells the user "send your decision brief again and
    // I'll redraft it" — so a shaped brief must be ALLOWED to draft even on
    // a continuation scenario (e.g. the mid-draft interrupt committed a
    // conversational row). Same unstranding pattern as the C3 draft-offer
    // marker. Read only on frame-stage continuation turns; heals itself the
    // moment any graph commits.
    const draftLossRedraftUnstrand =
      frameStageNoGraph && isContinuationScenario
        ? await loadDraftLossStands(ingress.scenario_id, requestId)
        : false;
    if (isContinuationScenario) {
      const wouldDraft = isDraftShapedText(ingress.message);
      emit(TelemetryEvents.V5ContinuationGuardApplied, {
        request_id: requestId,
        scenario_id: ingress.scenario_id,
        guard: wouldDraft ? 'draft_graph' : 'frame_no_brief',
        prior_turns_present: true,
      });
    }
    // ────────────────────────────────────────────────────────────────────
    // ROADMAP 2.63 C3/C4 — draft-offer pre-route: narrow pendings read.
    // ────────────────────────────────────────────────────────────────────
    // Paid ONLY by (a) frame-stage no-graph CONTINUATION turns — the state
    // a committed C3/C4 offer turn creates; a FRESH scenario cannot carry
    // an offer, so the hot first-turn path is unchanged — and (b) turns
    // whose message shape could consent to a C4 redraft offer: chip clicks,
    // bare short-confirms and affirmative-prefixed replies, the same
    // classes that already pay the held-proposal replay pendings read
    // (see AFFIRMATIVE_PREFIX_PATTERN's field note). Degrades to [] on a
    // read failure (store-layer telemetry fires): every draft-offer
    // behaviour then falls back to the pre-C3 routing — no silent draft,
    // no swallowed turn.
    const couldCarryDraftOffer =
      (frameStageNoGraph && isContinuationScenario) ||
      ingress.source === 'chip_click' ||
      SHORT_CONFIRM_PATTERN.test(ingress.message) ||
      AFFIRMATIVE_PREFIX_PATTERN.test(ingress.message);
    let draftOfferPendingsLoaded = false;
    let draftOfferPriorPendings: readonly PendingAction[] = [];
    if (couldCarryDraftOffer) {
      draftOfferPriorPendings = await loadMostRecentPendingActions(
        ingress.scenario_id,
        requestId,
      );
      draftOfferPendingsLoaded = true;
    }
    /** Lazy variant for paths that commit but did not pay the read above. */
    const ensureDraftOfferPriorPendings = async (): Promise<readonly PendingAction[]> => {
      if (!draftOfferPendingsLoaded) {
        draftOfferPriorPendings = await loadMostRecentPendingActions(
          ingress.scenario_id,
          requestId,
        );
        draftOfferPendingsLoaded = true;
      }
      return draftOfferPriorPendings;
    };
    // Presence marker (any liveness) vs consent resume (live only) — see
    // the helper docs above the route handler.
    const draftOfferMarker = findDraftOfferPending(draftOfferPriorPendings);
    const draftOfferResume =
      draftOfferMarker !== null
        ? resolveDraftOfferResume(ingress.message, draftOfferPriorPendings, Date.now())
        : null;
    // ────────────────────────────────────────────────────────────────────
    // ROADMAP 2.63 C1+C2 — explicit-generate wire flag.
    // ────────────────────────────────────────────────────────────────────
    //
    // `generate_model` / `explicit_generate` are boolean fields on
    // MessageTurnPayload at the 0.16.0 pin (both parse through B1 ingress —
    // zero contract change) that until now NO live V5 code read: their only
    // consumers were the dead V4 pipeline (request-normalization.ts /
    // turn-contract.ts). The stage-2 "Generate model" intent therefore never
    // crossed the wire in any form, and the confirm-chip flow was
    // structurally unable to draft (2.63 diagnosis, live-reproduced P1–P5).
    //
    // C1 — the flag is a DETERMINISTIC draft trigger. Unlike the
    // shape-heuristic below it bypasses the brief-keyword regex AND the
    // continuation guard: an explicit generate on a no-graph continuation
    // scenario is precisely the stage-2 "converse → confirm → generate"
    // flow the continuation guard otherwise strands (Finding 3 corollary).
    // It fires ONLY when no graph exists anywhere — neither on the request
    // (`extensions.graphState`) nor persisted server-side.
    //
    // C2 — the message on a confirm click is canned chip text, not the
    // brief, so the brief is assembled server-side (persisted
    // scenarios.brief_text → recent user turns → the message itself; see
    // assemble-explicit-generate-brief.ts for the priority order). When
    // nothing usable exists the turn gets a deterministic HONEST decline
    // naming what is missing — never a silent fall-through to
    // frame_no_brief_guard or the routing LLM. Like frame_no_brief_guard,
    // the decline commits no turn, so the scenario stays draftable.
    //
    // C4 (ROADMAP 2.63, Paul-ratified 16 Jul — decline-with-redraft-offer):
    // when the flag arrives on a scenario that ALREADY has a graph (request
    // graph_state or persisted), the turn gets a deterministic decline that
    // says a model already exists and OFFERS the redraft route — a
    // "Redraft the model" chip plus a persisted `draft_graph` pending with
    // `redraft: true`, so the consent click / a typed yes on the NEXT turn
    // resumes through the draft-offer pre-route above into this same
    // deterministic dispatch, REPLACING the model with the user's explicit
    // consent (held-proposal consent doctrine: never a silent replace,
    // never a silent ignore). On a failed persisted-state read graph
    // presence is unknown, so today's routing is preserved (the flag path
    // must neither draft over an unknown graph nor claim one exists).
    const explicitGenerateRequested =
      ingress.generate_model === true || ingress.explicit_generate === true;
    let explicitGenerateBrief: AssembledExplicitGenerateBrief | null = null;
    let explicitGenerateDraft = false;
    let explicitGenerateDeclined = false;
    /**
     * C4 — non-null when this turn must get the deterministic
     * graph-present decline (+ redraft offer seed). Carries the graph the
     * offer's hash precondition pins.
     */
    let explicitGenerateGraphPresent: { readonly graphForHash: unknown } | null = null;
    /** C3/C4 — offer pending honoured by this turn's draft (consumed at commit). */
    let draftOfferConsumedRefs: readonly string[] | undefined;
    if (explicitGenerateRequested) {
      let outcome:
        | 'dispatch_draft'
        | 'declined_no_brief'
        | 'declined_graph_present'
        | 'state_read_failed_fallthrough';
      // P1-2 — a zero-node request graph_state is ABSENT here: the schema
      // accepts {nodes:[],edges:[]} and declining over an empty canvas would
      // be false ("already has a model"). The persisted read below still
      // decides graph presence server-side.
      if (isPopulatedIngressGraph(extensions.graphState)) {
        outcome = 'declined_graph_present';
        explicitGenerateGraphPresent = { graphForHash: extensions.graphState };
      } else {
        try {
          // STRICT read, deliberately: the swallowing variant collapses a
          // store outage into "no graph", which would let the flag path
          // draft over an existing graph during an outage — C4 territory.
          // On a read failure we preserve today's routing instead.
          const persisted = await loadPersistedScenarioStateStrict(ingress.scenario_id);
          if (persisted.graph != null) {
            outcome = 'declined_graph_present';
            explicitGenerateGraphPresent = { graphForHash: persisted.graph };
          } else {
            explicitGenerateBrief = assembleExplicitGenerateBrief({
              message: ingress.message,
              source: ingress.source,
              persistedBriefText: persisted.briefText,
              recentTurns: [],
            });
            if (
              explicitGenerateBrief === null ||
              explicitGenerateBrief.source === 'message_unshaped'
            ) {
              // Only read the conversation chain when the message and the
              // persisted brief cannot settle it — a prior user turn may
              // carry the brief (and ranks above the unshaped message).
              const recentTurns = await loadRecentConversationTurns(
                ingress.scenario_id,
                requestId,
              );
              explicitGenerateBrief =
                assembleExplicitGenerateBrief({
                  message: ingress.message,
                  source: ingress.source,
                  persistedBriefText: persisted.briefText,
                  recentTurns,
                }) ?? explicitGenerateBrief;
            }
            if (explicitGenerateBrief !== null) {
              explicitGenerateDraft = true;
              outcome = 'dispatch_draft';
            } else {
              explicitGenerateDeclined = true;
              outcome = 'declined_no_brief';
            }
          }
        } catch (err) {
          outcome = 'state_read_failed_fallthrough';
          log.warn(
            {
              request_id: requestId,
              scenario_id: ingress.scenario_id,
              err: err instanceof Error ? err.message : String(err),
            },
            'V5 explicit-generate — persisted-state read failed; preserving pre-flag routing',
          );
        }
      }
      emit(TelemetryEvents.V5ExplicitGenerateReceived, {
        request_id: requestId,
        scenario_id: ingress.scenario_id,
        message_length: ingress.message.length,
        continuation: isContinuationScenario,
        had_chip: ingress.chip != null,
        source: ingress.source,
        outcome,
        brief_source: explicitGenerateBrief?.source ?? null,
      });
    } else if (draftOfferResume !== null) {
      // ────────────────────────────────────────────────────────────────
      // ROADMAP 2.63 C3/C4 — consent turn for a prior draft/redraft offer.
      // ────────────────────────────────────────────────────────────────
      // The user clicked the offer chip (its copy replays verbatim) or
      // typed a bare confirmation while the offer was the sole live
      // pending. Same deterministic posture as the flag path: dispatch,
      // honest decline, or honest re-offer — never a silent LLM
      // fall-through once the consent named this offer. A persisted-state
      // read failure falls back to the pre-offer routing (fail-safe: never
      // draft without knowing whether a graph exists).
      const offerAction = draftOfferResume.action;
      const isRedraftOffer = offerAction.redraft === true;
      let resumeOutcome:
        | 'dispatch_draft'
        | 'declined_no_brief'
        | 'reoffered_graph_changed'
        | 'reoffered_graph_present'
        | 'state_read_failed_fallthrough';
      try {
        const persisted = await loadPersistedScenarioStateStrict(ingress.scenario_id);
        // P1-2 — same emptiness rule as the flag arm above: a zero-node
        // request graph_state never counts as a present model here.
        const graphNow: unknown = isPopulatedIngressGraph(extensions.graphState)
          ? extensions.graphState
          : persisted.graph ?? null;
        const assembleResumeBrief = async (): Promise<AssembledExplicitGenerateBrief | null> => {
          let assembled = assembleExplicitGenerateBrief({
            message: ingress.message,
            source: ingress.source,
            persistedBriefText: persisted.briefText,
            pendingBriefSeed: offerAction.brief_seed ?? null,
            recentTurns: [],
          });
          if (assembled === null || assembled.source === 'message_unshaped') {
            const recentTurns = await loadRecentConversationTurns(
              ingress.scenario_id,
              requestId,
            );
            assembled =
              assembleExplicitGenerateBrief({
                message: ingress.message,
                source: ingress.source,
                persistedBriefText: persisted.briefText,
                pendingBriefSeed: offerAction.brief_seed ?? null,
                recentTurns,
              }) ?? assembled;
          }
          return assembled;
        };
        if (graphNow == null) {
          // First draft. (A redraft offer whose graph has since vanished
          // reduces to the same action — nothing exists to replace.)
          explicitGenerateBrief = await assembleResumeBrief();
          if (explicitGenerateBrief !== null) {
            explicitGenerateDraft = true;
            draftOfferConsumedRefs = [draftOfferResume.pending.chip_id];
            resumeOutcome = 'dispatch_draft';
          } else {
            explicitGenerateDeclined = true;
            resumeOutcome = 'declined_no_brief';
          }
        } else if (!isRedraftOffer) {
          // A build-offer consent arriving AFTER a graph appeared (e.g. a
          // parallel tab drafted meanwhile): never silently replace on a
          // consent that predates the graph — re-offer as a redraft.
          explicitGenerateGraphPresent = { graphForHash: graphNow };
          resumeOutcome = 'reoffered_graph_present';
        } else {
          // Redraft consent with a graph present — verify the offer's hash
          // precondition against the CURRENT graph when both are known.
          // The commit carry-forward already invalidates a hash-diverged
          // offer at the intervening edit's own commit; this is
          // belt-and-braces for writes that bypassed it.
          const offerHash = draftOfferResume.pending.preconditions.graph_hash;
          const currentHash = ((): string | null => {
            try {
              return computeAnalysisAffectingGraphHash(
                graphNow as GraphStateIngress | null | undefined,
              );
            } catch {
              return null;
            }
          })();
          if (
            typeof offerHash === 'string' &&
            offerHash.length > 0 &&
            typeof currentHash === 'string' &&
            currentHash.length > 0 &&
            offerHash !== currentHash
          ) {
            // The model moved between offer and consent — decline and
            // re-offer against the graph as it stands now.
            explicitGenerateGraphPresent = { graphForHash: graphNow };
            resumeOutcome = 'reoffered_graph_changed';
          } else {
            explicitGenerateBrief = await assembleResumeBrief();
            if (explicitGenerateBrief !== null) {
              explicitGenerateDraft = true;
              draftOfferConsumedRefs = [draftOfferResume.pending.chip_id];
              resumeOutcome = 'dispatch_draft';
            } else {
              explicitGenerateDeclined = true;
              resumeOutcome = 'declined_no_brief';
            }
          }
        }
      } catch (err) {
        resumeOutcome = 'state_read_failed_fallthrough';
        log.warn(
          {
            request_id: requestId,
            scenario_id: ingress.scenario_id,
            err: err instanceof Error ? err.message : String(err),
          },
          'V5 draft-offer resume — persisted-state read failed; preserving pre-offer routing',
        );
      }
      emit(TelemetryEvents.V5DraftOfferResumed, {
        request_id: requestId,
        scenario_id: ingress.scenario_id,
        trigger: draftOfferResume.trigger,
        redraft: isRedraftOffer,
        outcome: resumeOutcome,
        brief_source: explicitGenerateBrief?.source ?? null,
      });
    }
    if (explicitGenerateDeclined) {
      // C2 honest decline — deterministic, zero LLM calls, no commit. Names
      // what is missing (a decision brief) and how to proceed. Deliberately
      // NOT the frame_no_brief_guard copy: the user explicitly asked to
      // generate, so "I need a single decision question to start" would
      // misread their intent as a first-time framing turn.
      const declineText =
        "You asked me to build the model, but I don't have a decision brief to build it from yet — " +
        'nothing in this conversation contains one. ' +
        'Tell me the decision in one sentence, including the options you are comparing — for example: ' +
        '“Should we hire a tech lead or two developers?” — and I will draft the model from that.';
      const declineResponse: import('@talchain/schemas/boundary').OlumiResponse = {
        response_version: 2,
        assistant_text: declineText,
        blocks: [],
        suggested_actions: [],
        insights: [],
        stage_indicator: 'frame',
      } as import('@talchain/schemas/boundary').OlumiResponse;
      return sendFinalised200(reply, requestId, 'explicit_generate_no_brief', declineResponse, {
        graph: null,
        // T1 claim safety — INHERITED from the turn-entry read. Never a literal:
        // the permission belongs to the fact this response DISPLAYS, not to
        // whether this turn ran an analysis. See turn-claim-safety.ts.
        ...(await claimSafety.forExit()),
        // ROADMAP 1.132 (F1) — EGRESS-DEFAULT INVERSION: decline copy is
        // functional and must ship plain.
        answerKind: 'functional',
        requestStartedAt: routeStartedAt,
        scenarioId: ingress.scenario_id,
        turnId: ingress.turn_id,
        userMessage: ingress.message,
      });
    }
    if (explicitGenerateGraphPresent !== null) {
      // ────────────────────────────────────────────────────────────────
      // C4 — deterministic graph-present decline + redraft offer.
      // ────────────────────────────────────────────────────────────────
      // Zero LLM calls. Unlike the no-brief decline this turn COMMITS: the
      // redraft offer's `draft_graph` pending must persist for the consent
      // turn to resume (pendings live on committed turn rows). The chip is
      // only rendered when the pending persisted — a chip whose consent
      // cannot resume would be guarantee-theatre — so on a commit failure
      // the decline is sent chip-less and the user can simply re-click
      // Generate.
      const offerNowMs = Date.now();
      const offerSeed = deriveDraftOfferSeed(ingress.message, ingress.source);
      const offerGraphHash = ((): string | null => {
        try {
          return computeAnalysisAffectingGraphHash(
            explicitGenerateGraphPresent.graphForHash as GraphStateIngress | null | undefined,
          );
        } catch {
          return null;
        }
      })();
      const offerChip = {
        id: `redraft-offer-${randomUUID()}`,
        label: REDRAFT_OFFER_CHIP_LABEL,
        // See REDRAFT_OFFER_CHIP_MESSAGE_ALT: a re-offer answering the
        // user's own click of the previous offer chip must not replay the
        // exact message they just sent, or the egress looping-chip guard
        // (correctly) strips it and the offer becomes type-only.
        message:
          normaliseReplayMessage(ingress.message) ===
          normaliseReplayMessage(REDRAFT_OFFER_CHIP_MESSAGE)
            ? REDRAFT_OFFER_CHIP_MESSAGE_ALT
            : REDRAFT_OFFER_CHIP_MESSAGE,
      };
      const offerPending = buildDraftOfferPending({
        scenarioId: ingress.scenario_id,
        chipId: offerChip.id,
        publicLabel: offerChip.label,
        publicMessage: offerChip.message,
        ...(offerSeed !== undefined ? { briefSeed: offerSeed } : {}),
        redraft: true,
        graphHash: offerGraphHash,
        nowMs: offerNowMs,
      });
      // P1-1 — read the carried pendings BEFORE composing the copy: the
      // "or reply yes" promise is derived from the very set this commit's
      // carry-forward will persist (the same array is threaded to the
      // commit below, so copy and state cannot diverge).
      const offerPriorPendings = await ensureDraftOfferPriorPendings();
      const offerWillBeSoleLive = willDraftOfferBeSoleLivePending(
        offerPriorPendings,
        offerPending,
        offerNowMs,
      );
      const declineCandidate: import('@talchain/schemas/boundary').OlumiResponse = {
        response_version: 2,
        assistant_text: explicitGenerateGraphPresentText(offerWillBeSoleLive),
        blocks: [],
        suggested_actions: [offerChip],
        insights: [],
        stage_indicator: ingress.stage,
      } as import('@talchain/schemas/boundary').OlumiResponse;
      let wireResponse = declineCandidate;
      let offerPersisted = false;
      try {
        const commitResult = await commitDirectAnswer(declineCandidate, {
          scenario_id: ingress.scenario_id,
          turn_id: ingress.turn_id,
          turn_class: 'clarify',
          handler_id: null,
          request_hash: computeRequestHash(ingress),
          llm_calls_used: 0,
          duration_ms: Date.now() - routeStartedAt,
          handler_facts: [],
          pending_actions: [offerPending],
          // Never wipe live holds: thread the prior pendings through this
          // commit's carry-forward (HOLD-WIPE fix pattern). Same array the
          // copy derivation above consumed (read lazily there — a composer
          // flag turn may not have paid the pre-route read).
          priorPendingActions: offerPriorPendings,
          coaching_state: null,
          userMessage: ingress.message,
          contentGraph: explicitGenerateGraphPresent.graphForHash,
        });
        // Carry-forward may have attached a lapse notice — send what was
        // committed (stored copy == wire copy).
        wireResponse = commitResult.response;
        offerPersisted = true;
      } catch (err) {
        log.warn(
          {
            request_id: requestId,
            scenario_id: ingress.scenario_id,
            err: err instanceof Error ? { name: err.name, message: err.message } : { message: String(err) },
          },
          'V5 explicit-generate graph-present decline — offer commit failed; sending chip-less decline',
        );
        wireResponse = {
          ...declineCandidate,
          suggested_actions: [],
        } as import('@talchain/schemas/boundary').OlumiResponse;
      }
      emit(TelemetryEvents.V5DraftOfferSeeded, {
        request_id: requestId,
        scenario_id: ingress.scenario_id,
        site: 'explicit_generate_graph_present',
        redraft: true,
        had_seed: offerSeed !== undefined,
        graph_hash_pinned: offerGraphHash !== null,
        persisted: offerPersisted,
      });
      return sendFinalised200(
        reply,
        requestId,
        'explicit_generate_graph_present',
        wireResponse,
        {
          graph: null,
          // T1 claim safety — INHERITED from the turn-entry read. Never a literal:
          // the permission belongs to the fact this response DISPLAYS, not to
          // whether this turn ran an analysis. See turn-claim-safety.ts.
          ...(await claimSafety.forExit()),
          // ROADMAP 1.132 (F1) — EGRESS-DEFAULT INVERSION: this decline/offer
          // copy is functional and must ship plain.
          answerKind: 'functional',
          requestStartedAt: routeStartedAt,
          scenarioId: ingress.scenario_id,
          turnId: ingress.turn_id,
          userMessage: ingress.message,
        },
      );
    }
    // 1.152(i) maintained-twin fix: the stage / continuation / text-shape
    // terms are computed ONCE here; `isDraftGraphShape` adds the no-graph
    // NULLNESS term, and the clarify-v2 gate below applies its POPULATION
    // judgement instead (A5) — previously it hand-duplicated all four
    // terms minus nullness.
    const draftShapedTurn =
      ingress.stage === 'frame' &&
      // V5 Signature Loop — a scenario with prior committed turns is a
      // continuation, not a first brief; let it reach TurnExecutor's memory.
      // ROADMAP 2.63 C3 — EXCEPT when the last committed turn was a
      // draft-offer turn (the marker): the guard's own committed turns must
      // not strand the very reply they asked for ("here is my decision
      // question" after the framing prompt). Marker presence, not liveness:
      // drafting a full shaped brief the user just typed carries no consent
      // risk, so a wall-expired offer still un-strands it.
      // ROADMAP 2.709 — AND except while a draft loss stands (third
      // disjunct): the loss notice promises "send your brief again and I'll
      // redraft it", and a promise the classifier does not keep is a
      // dead-end. Self-limiting — the term is false again the moment a
      // graph commits.
      (!isContinuationScenario || draftOfferMarker !== null || draftLossRedraftUnstrand) &&
      // META-DECISION-DIAGNOSIS-2026-07-20 — a chip_click carries EXPLICIT
      // product-intent metadata; the draft heuristic exists to classify
      // anonymous free text and must never capture product-authored canned
      // text. Whitelisted action_types were dispatched upstream; the rest
      // belong to TurnExecutor (Sonnet ORIENT / typed unsupported-action),
      // never to a graph drafted ABOUT the chip's own wording. (`source:
      // 'chip'` — inline chip metadata without an action_type — is NOT
      // excluded here: the wire's 0.19.0 action_type enum has no coaching
      // intent value yet, so spark taps arrive that way and are handled by
      // the narrower process-meta guard below.)
      ingress.source !== 'chip_click' &&
      isDraftShapedText(ingress.message) &&
      // META-DECISION-DIAGNOSIS-2026-07-20 — round-1 process-meta guard:
      // a question TO the assistant about the process ("What should I
      // check before running the first analysis?" — the product's own
      // pre-analysis spark) is never a decision brief. The clarify RESUME
      // path already refuses to fold such questions into the working brief
      // (CLARIFY_V2_QUESTION_REPLY_PATTERN); this term gives round-1
      // intake the same protection, and (via `clarifyDraftShaped` below)
      // bars a mid-round meta-question from REPLACING a live round's
      // working brief. Deflected turns are ANSWERED by the deterministic
      // process-meta branch ahead of the frame guard — never captured,
      // never silently dropped.
      !isProcessMetaIntake(ingress.message);
    const isDraftGraphShape = extensions.graphState == null && draftShapedTurn;
    // ── Clarify v2 (E0-B, ROADMAP 1.94 Option A replacement) — DARK behind
    // CEE_CLARIFY_V2_ENABLED (default off; flag-off skips the import
    // entirely, same containment as V6 dual-draft). Two deterministic
    // claims, zero LLM calls: (1) draft preflight — a thin brief gets up to
    // 3 tap-able clarifying questions instead of the draft; (2) resume — a
    // live clarify_v2_round pending claims the user's answer and either
    // asks a follow-up or proceeds to the ordinary draft dispatch below
    // with the answer-augmented briefOverride. Fail-open: any internal
    // failure returns null and this turn routes exactly as with the flag
    // off. See handlers/clarify-v2-dispatch.ts.
    let clarifyV2DraftBrief: string | null = null;
    // TRACK-1 INTAKE FIX (2026-08-13, INTAKE-FUNNEL §5b): the single-gap
    // draft-first disclosure — composed by the clarify dispatch, appended to
    // the draft response's assistant_text AFTER a successful draft commit
    // (and only when a graph actually landed). The draft turn's STORED
    // assistant_message is null by existing design (draft-graph-dispatch.ts
    // commit comment: the narrative is built post-commit and reconstructable
    // from the persisted graph), so this append introduces no new
    // wire-vs-store divergence class.
    let clarifyV2DeferredDisclosure: string | null = null;
    // Review fix A5 (17 Jul): an EMPTY canvas ({nodes:[],edges:[]}) passes
    // ingress as non-null but is 'no model' by this file's own predicate —
    // gate on POPULATION, not nullness, so clarify v2 engages for exactly
    // the empty-canvas users it was built for.
    // NO-DARK-LAUNCH (Paul, 19 Jul): clarify v2 runs unconditionally; the
    // former CEE_CLARIFY_V2_ENABLED gate is deleted (was live `true` on staging).
    if (!isPopulatedIngressGraph(extensions.graphState)) {
      const { tryClarifyV2Turn } = await import(
        '../orchestrator-v5/handlers/clarify-v2-dispatch.js'
      );
      // A5 completion (1.152 behavioural pin): `isDraftGraphShape` collapses
      // to false whenever ANY graph_state object is on the wire (its own
      // `== null` term), so with only the gate fix above an EMPTY canvas
      // still defeated round 1 via draftShaped:false — the pin went RED on
      // exactly the target audience. Inside this flag-gated block the shape
      // judgement is `draftShapedTurn` WITHOUT the nullness term — the
      // enclosing `!isPopulatedIngressGraph` gate already made the
      // POPULATION judgement; the flag-off wire (and `isDraftGraphShape`
      // itself) is untouched. (1.152(i): previously a hand-maintained
      // re-derivation of the same four terms.)
      const clarifyDraftShaped = draftShapedTurn;
      const cv2 = await tryClarifyV2Turn({
        payload: ingress,
        requestId,
        draftShaped: clarifyDraftShaped,
        explicitGenerateBrief:
          explicitGenerateDraft && explicitGenerateBrief !== null
            ? explicitGenerateBrief.brief
            : null,
      });
      if (cv2 !== null && cv2.kind === 'respond') {
        return sendFinalised200(reply, requestId, 'clarify_v2', cv2.response, {
          graph: null,
          // T1 claim safety — INHERITED from the turn-entry read. Never a literal:
          // the permission belongs to the fact this response DISPLAYS, not to
          // whether this turn ran an analysis. See turn-claim-safety.ts.
          ...(await claimSafety.forExit()),
          // ROADMAP 1.132 (F1) — EGRESS-DEFAULT INVERSION: a clarify QUESTION is
          // functional and must ship plain, never behind progressive disclosure.
          answerKind: 'functional',
          requestStartedAt: routeStartedAt,
          scenarioId: ingress.scenario_id,
          turnId: ingress.turn_id,
          userMessage: ingress.message,
        });
      }
      if (cv2 !== null && cv2.kind === 'draft') {
        clarifyV2DraftBrief = cv2.briefOverride;
        clarifyV2DeferredDisclosure = cv2.deferredAsk?.disclosure ?? null;
      }
    }
    if (isDraftGraphShape || explicitGenerateDraft || clarifyV2DraftBrief !== null) {
      // V4 cordon: dispatchDraftGraph delegates to the V4 graph-synthesis
      // pipeline. V5 has no deterministic draft_graph handler yet. See
      // Docs/v5/v5-cordon.md §1 for trigger conditions and replacement plan.
      try {
        const dg = await dispatchDraftGraph({
          payload: ingress,
          requestId,
          request: req,
          // Review-576 condition 2: the draft retry-affordability gate and
          // the Step-11 budget guard measure elapsed time from THIS baseline
          // (request start), not from LLM start — pre-LLM turn time (routing
          // tool-use call, context assembly) now counts against the budget.
          requestStartMs: routeStartedAt,
          // C2 — on the explicit-generate path the pipeline drafts from the
          // server-assembled brief, not the (possibly canned-chip) wire
          // message. The committed turn's user_message stays verbatim
          // (`payload.message`) — the override redirects only the brief
          // consumers inside the dispatcher. Absent on the heuristic path:
          // behaviour there is bit-identical to before. Clarify v2's
          // answer-augmented brief (flag-gated resume) takes precedence —
          // when set, it already incorporates the explicit-generate brief.
          ...(clarifyV2DraftBrief !== null
            ? { briefOverride: clarifyV2DraftBrief }
            : explicitGenerateDraft && explicitGenerateBrief !== null
              ? { briefOverride: explicitGenerateBrief.brief }
              : {}),
          // ROADMAP 2.63 C3/C4 — a draft retires any outstanding draft
          // offer: the honoured pending on a consent resume, or the stale
          // marker when a shaped brief drafted alongside one. Without this
          // the offer survives its own fulfilment and a later bare "yes"
          // re-triggers a draft (zombie re-offer).
          ...(draftOfferConsumedRefs !== undefined
            ? { consumedPendingRefs: draftOfferConsumedRefs }
            : draftOfferMarker !== null
              ? { consumedPendingRefs: [draftOfferMarker.chip_id] }
              : {}),
        });
        if (!dg.commitPerformed) {
          // ROADMAP 2.709 invariant 6 — the trace, BEFORE the 500. The
          // client that triggered this failure may have aborted the socket
          // (the streamed-preempt path delivers this 500 to a closed
          // connection), so the loss must be readable by the scenario's
          // NEXT turn, whichever client sends it.
          //
          // 2.735 disclosure — `draft_loss`, and it is DERIVED from the
          // dispatcher's contract rather than assumed: `commitPerformed:
          // false` is returned only from the catch that wraps the commit
          // block, i.e. the pipeline had produced its result and the append
          // was attempted. A model existed and was being saved when it was
          // lost, so the user is owed the disclosure whether or not they had
          // been shown a preview.
          await markDraftGraphWriteFailed(
            ingress.scenario_id,
            ingress.turn_id,
            'draft_graph_commit_failed',
            requestId,
            'draft_loss',
          );
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
        // TRACK-1 INTAKE FIX: append the single-gap disclosure to the draft
        // narrative — commit succeeded (the 500 branch returned above) and a
        // graph is actually on the canvas (`dg.graph !== null`; a disclosure
        // about a model that never landed would be a false statement). Ships
        // through sendFinalised200's central egress sanitiser like the rest
        // of the narrative. Deterministic template text — no graph labels.
        const draftResponse =
          clarifyV2DeferredDisclosure !== null && dg.graph !== null
            ? {
                ...dg.response,
                assistant_text: `${dg.response.assistant_text.trimEnd()}\n\n${clarifyV2DeferredDisclosure}`,
              }
            : dg.response;
        const sentDraft = await sendFinalised200(reply, requestId, 'draft_graph', draftResponse, {
          analysisReady: dg.analysisReady,
          graph: dg.graph,
          // T1 claim safety — INHERITED from the turn-entry read. Never a literal:
          // the permission belongs to the fact this response DISPLAYS, not to
          // whether this turn ran an analysis. See turn-claim-safety.ts.
          ...(await claimSafety.forExit()),
          // ROADMAP 1.132 (F1) — EGRESS-DEFAULT INVERSION: a draft-graph turn's
          // artifact is the GRAPH (draft_graph block), not the intro prose. Mark
          // functional AND rely on the draft_graph block-primary egress guard.
          answerKind: 'functional',
          ...(dg.freshness ? { freshness: dg.freshness } : {}),
          ...(dg.diagnosticTrace ? { diagnosticTrace: dg.diagnosticTrace } : {}),
          requestStartedAt: routeStartedAt,
          scenarioId: ingress.scenario_id,
          turnId: ingress.turn_id,
        userMessage: ingress.message,
        });
        // R2 (2026-08-16, Paul's ruling) — auto-run a PROVISIONAL analysis
        // AFTER the draft response has been handed to the transport
        // (`sendFinalised200` awaited above), NEVER on the draft's critical
        // path: #995's delivery latency is untouchable. `scheduleAutoRun
        // AfterFreshDraft` returns synchronously and runs the admission-gated
        // dispatch on a later tick under the commit-seam hooks' non-blocking
        // contract; the try/catch is belt-and-braces so a scheduling fault can
        // never surface on a turn that already succeeded. Fresh drafts only:
        // this is the single call site, edit/chip/reload paths never reach it,
        // and `dg.graph != null` excludes the graphless-draft commit (which
        // has nothing to analyse; loose null-check by house idiom — it also
        // keeps test doubles that omit the field from scheduling).
        if (dg.graph != null) {
          try {
            scheduleAutoRunAfterFreshDraft({
              scenarioId: ingress.scenario_id,
              draftTurnId: ingress.turn_id,
              draftGraph: dg.graph,
              draftGraphHash: dg.freshness?.current_graph_hash ?? null,
              requestId,
            });
          } catch (scheduleErr) {
            log.error(
              {
                request_id: requestId,
                scenario_id: ingress.scenario_id,
                err:
                  scheduleErr instanceof Error
                    ? { name: scheduleErr.name, message: scheduleErr.message }
                    : { message: String(scheduleErr) },
              },
              'V5 draft_graph — auto-run scheduling threw; delivered draft unaffected',
            );
          }
        }
        return sentDraft;
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
          readonly pipelineReason?: string | null;
          readonly pipelineRetryable?: boolean | null;
          readonly pipelineRecovery?: Record<string, unknown> | null;
          readonly pipelineDetails?: Record<string, unknown> | null;
        };
        const pipelineStatusCode =
          typeof meta.pipelineStatusCode === 'number' ? meta.pipelineStatusCode : null;
        const pipelineErrorCode =
          typeof meta.pipelineErrorCode === 'string' ? meta.pipelineErrorCode : null;
        const pipelineReason =
          typeof meta.pipelineReason === 'string' ? meta.pipelineReason : null;
        // ROADMAP 2.718 — the producer's own retryability declaration.
        // Strict boolean; anything else = producer silent (null).
        const pipelineRetryable =
          typeof meta.pipelineRetryable === 'boolean' ? meta.pipelineRetryable : null;
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
        // ROADMAP 2.709 invariant 6, CORRECTED BY 2.735 — the second
        // draft-500 entry fault.
        //
        // ⚠ THIS SITE SHIPPED A FALSE CLAIM TO THE USER, and the shape of the
        //   mistake is worth keeping visible. `dispatchDraftGraph` rethrows
        //   EVERY unified-pipeline failure through here: a provider rate
        //   limit, an LLM timeout, a parse failure, a brief that never
        //   reached the model — as well as the case this comment used to name
        //   (CEE_GRAPH_INVALID after GRAPH_READY has already streamed). One
        //   `catch`, one mark, one disclosure. So the scenario's next turn
        //   greeted a user whose draft had died at the FIRST LLM call with
        //   "your last draft didn't save … the graph you saw was never
        //   saved" — a graph they had never been shown, described as lost.
        //   Found by an external audit (Codex, 2026-08-08) after our own
        //   review passed it; it was dark only because the migration that
        //   creates the columns has not executed.
        //
        // The disclosure is now DERIVED FROM WHAT THE CLIENT ACTUALLY
        // RECEIVED: `graphPreviewEmitted()` is true iff this turn streamed a
        // GRAPH_READY frame, recorded at the emission itself (see
        // stage-stream-context.ts). Not an allowlist of "late" error codes —
        // that would be a hand-maintained mirror (trap 12) whose first stale
        // entry re-opens exactly this defect. A buffered turn streams no
        // frames at all, so it reads false, which is the honest answer: no
        // client saw a preview from it.
        const previewWasStreamed = graphPreviewEmitted();
        await markDraftGraphWriteFailed(
          ingress.scenario_id,
          ingress.turn_id,
          previewWasStreamed
            ? 'draft_graph_pipeline_threw_after_preview'
            : 'draft_graph_pipeline_threw_before_preview',
          requestId,
          previewWasStreamed ? 'draft_loss' : 'turn_dead_only',
        );
        const { reason, retryable } = pipelineStatusCode != null && pipelineErrorCode != null
          ? mapDraftGraphPipelineReason(
              pipelineStatusCode,
              pipelineErrorCode,
              pipelineReason,
              pipelineRetryable,
            )
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
        // PINNED FLAT MIRROR (2026-07-25). `/assist/v1/draft-graph` already ships
        // `recovery_suggestion` at the top level of its error body — the field
        // name pinned by @talchain/schemas 0.19.0 (Wave-2 ask 7, DGAI #383) so
        // consumers stop passthrough-sniffing fallback names for the one
        // user-facing sentence. The turn route carried the nested
        // `details.recovery` object but NOT that pinned name, so a consumer
        // implemented against the assist contract found nothing here. Same
        // sentence, same field name, both routes — derived from `recovery`, not
        // restated, so the two cannot drift.
        //
        // ⚠ WHAT THIS DOES NOT FIX, stated plainly: this route still answers a
        // failed draft with HTTP 500 + a BoundaryError, which has no
        // `assistant_text` — so the copy is on the wire but the user sees
        // nothing until DGAI renders it. Making the failure speak in the
        // conversation is a UI-side render change (or a turn-committing
        // direct_answer 200 here, which would need the turn/state commit this
        // path deliberately skips on failure); both are outside this lane's
        // write slot and are NOT claimed as done.
        if (pipelineRecovery && typeof pipelineRecovery.suggestion === 'string') {
          postStageExtras.recovery_suggestion = pipelineRecovery.suggestion;
        }
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
    // ────────────────────────────────────────────────────────────────
    // ROADMAP 2.308 / S1 — ONE persisted-graph read per turn, shared.
    //
    // Two sites now need `scenarios.graph`: the configure-option label anchor
    // (immediately below) and the edit-lane graphState reload (~340 lines
    // down). Memoised here so the pair costs ONE Supabase round-trip, not two
    // — the diagnosis's explicit instruction was "re-use the loaded value …
    // one read per turn, not two".
    //
    // The memo caches the FAILURE as well as the value, deliberately: the
    // label-anchor caller swallows errors (a labels read must never fail a
    // turn that would otherwise succeed), while the edit-lane reload below
    // re-throws the SAME error and produces the SAME typed recovery it
    // produced before this change. Caching the rejection is what keeps those
    // two policies from becoming two reads with two different outcomes.
    // ────────────────────────────────────────────────────────────────
    let persistedGraphMemo:
      | { readonly ok: true; readonly value: unknown }
      | { readonly ok: false; readonly error: unknown }
      | null = null;
    const loadPersistedGraphOnce = async (): Promise<unknown> => {
      if (persistedGraphMemo === null) {
        try {
          persistedGraphMemo = {
            ok: true,
            // `loadPersistedGraphStrict` (vs the swallowing
            // `loadPersistedGraph`) lets the edit-lane consumer distinguish
            // `session_store_failed` from `no_persisted_graph`.
            value: await loadPersistedGraphStrict(ingress.scenario_id),
          };
        } catch (err) {
          persistedGraphMemo = { ok: false, error: err };
        }
      }
      if (!persistedGraphMemo.ok) throw persistedGraphMemo.error;
      return persistedGraphMemo.value;
    };
    const analyticalQuestionDetected = isAnalyticalQuestion(ingress.message);
    const positiveEditRegexHit = EDIT_GRAPH_POSITIVE_REGEX.test(ingress.message);
    const negativeEditRegexHit = EDIT_GRAPH_NEGATIVE_REGEX.test(ingress.message);
    // Part-accounting conservation law (2026-07-20): the suppressor stands
    // DOWN for mixed value+structural messages so both halves reach the
    // edit_graph lane together — see shouldSuppressEditDispatchForValueUpdate.
    const valueUpdatePhrasingHit = shouldSuppressEditDispatchForValueUpdate(ingress.message);
    // ROADMAP 2.11 / P0-2 (deterministic half) — configure-option intent
    // ("configure {option}", "set {option}'s {factor} intervention to X",
    // and the system's OWN options_not_configured recovery-chip message)
    // must reach the edit lane: it is the only chat path that WRITES option
    // interventions (update_node → data/interventions/<factor_id>, already
    // sanctioned end-to-end). Before this gate these messages carried no
    // positive edit verb (or were value-update gated), fell through to the
    // LLM router, and live-routed to adjust_edge_strength — a field PLoT's
    // preflight ignores — closing the infinite recovery-chip loop the 2.11
    // diagnosis captured (scenario A, A5–A7). Negative gates shared with
    // the edit-verb candidate: meta-questions, analytical questions and
    // state queries never dispatch. Deliberately NOT gated on the
    // value-update phrasing (an option-intervention "set …" must not go to
    // set_factor_value, whose misroute guard can only refuse-to-clarify).
    //
    // ⭐ ROADMAP 2.308 / S1 — THE LABEL ANCHOR IS NOW REACHABLE.
    // Until this change the label list came solely from `extensions.graphState`,
    // which is NULL ON EVERY LIVE TURN (the platform invariant: the UI sends a
    // turn, never a graph — verified at the bytes across all eight captured
    // request bodies in the 2.308 diagnosis). The persisted graph that carries
    // the labels was loaded ~340 lines below, INSIDE `if (editIntentDetected)`,
    // and `editIntentDetected` is computed FROM this detection: circular, so
    // triggers 4 (`effect_vocab`) and 5 (`option_value_set`) — which sit below
    // the detector's mandatory anchor guard — were DEAD CODE in production.
    // `resolveConfigureOptionIntent` takes the persisted read ONLY when the
    // detector itself reports a label anchor would decide the verdict, and
    // shares that read with the edit-lane reload below (`loadPersistedGraphOnce`)
    // so the edit lane pays no extra round-trip.
    const configureOptionResolution = await resolveConfigureOptionIntent({
      message: ingress.message,
      requestOptionLabels: projectOptionLabels(extensions.graphState?.nodes),
      loadPersistedOptionLabels: async () => {
        const persisted = await loadPersistedGraphOnce();
        return projectOptionLabels((persisted as { nodes?: unknown } | null)?.nodes);
      },
    });
    const configureOptionDetection = configureOptionResolution.detection;
    // Emitted on EVERY read ATTEMPT, not only the ones that yielded labels —
    // otherwise a failed or option-less read is invisible and this counter
    // under-reports the read frequency it exists to measure (review #796).
    if (configureOptionResolution.persistedRead !== 'not_attempted') {
      emit(TelemetryEvents.V5EditGraphConfigureOptionLabelsLoaded, {
        request_id: requestId,
        scenario_id: ingress.scenario_id,
        outcome: configureOptionResolution.persistedRead,
        matched: configureOptionDetection.matched,
      });
    }
    // State-query suppressor (behaviour #3): a question containing an edit verb
    // ("what did you just change?", "what did that update do?") must NOT edit.
    const stateQuerySuppressed = isStateQueryQuestionShape(ingress.message);
    const configureOptionIntent =
      configureOptionDetection.matched &&
      !negativeEditRegexHit &&
      !analyticalQuestionDetected &&
      !stateQuerySuppressed;
    if (configureOptionIntent && !positiveEditRegexHit) {
      // Emit ONLY when this gate is the deciding factor (an edit-verb-
      // bearing configure message would have dispatched anyway).
      emit(TelemetryEvents.V5EditGraphConfigureOptionRouted, {
        request_id: requestId,
        scenario_id: ingress.scenario_id,
        trigger: configureOptionDetection.trigger,
      });
    }
    // Structural-restructure intent (LATENCY-RECAPTURE finding 3; probe
    // 69a2f44f). A free-text restructure request ("split the shared factor
    // into per-option links") carries no EDIT_GRAPH_POSITIVE_REGEX verb, so
    // without this gate it falls through to the coach, which DESCRIBES the
    // change without seeding an apply action — leaving a following "Yes, apply
    // it now" nothing to resume. Routing it to the edit lane (the sole
    // structural-proposal producer) mints the STRUCTURAL_APPLY_HELD /
    // REMOVE_UNCONFIRMED held proposal + confirm chip; the bare consent then
    // resumes via the existing short-confirm → executeGmHeldResume path. Same
    // shared negative gates as the configure-option sibling above.
    const structuralRestructureDetection = detectStructuralRestructureIntent(
      ingress.message,
    );
    const structuralRestructureIntent =
      structuralRestructureDetection.matched &&
      !negativeEditRegexHit &&
      !analyticalQuestionDetected &&
      !stateQuerySuppressed;
    if (structuralRestructureIntent && !positiveEditRegexHit) {
      // Emit ONLY when this gate is the deciding factor (an edit-verb-bearing
      // restructure message would have dispatched via editVerbCandidate).
      emit(TelemetryEvents.V5EditGraphStructuralRestructureRouted, {
        request_id: requestId,
        scenario_id: ingress.scenario_id,
        trigger: structuralRestructureDetection.trigger,
      });
    }
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
    // NAMED hold chip copy ("Add 'X', change 'Y' to 0.8 and link 'Z' to
    // 'W'" — changeset honesty 1.134 enumerates every op) carries an edit
    // verb by construction, so it can never be confirmation-shaped
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
    // #644 adversarial P2-2 (KNOWN ASYMMETRY, currently zero blast radius —
    // deliberately NOT folded in): `structuralRestructureIntent` is absent from
    // this proposal-confirm resolution gate, so a structural-restructure REPLAY
    // (a chip_click / affirmative-prefixed message that matches
    // detectStructuralRestructureIntent) skips resolveProposalConfirmAtRoute
    // and re-dispatches the edit lane instead of resuming the exact live hold.
    // This is unreachable today: every structural hold's rendered chip copy is
    // built by describe-changeset.ts, whose per-op verbs lead with
    // add/remove/change/update/adjust — ALL in EDIT_GRAPH_POSITIVE_REGEX — so
    // `editVerbCandidate` already claims the replay here; and the only edit-verb-
    // free copy it emits ("link 'X' to 'Y'", "rename 'X' to 'Y'") never carries a
    // per-option / each-option-own clause, so it never matches the structural
    // detector either. The omission would only bite if a FUTURE hold rendered a
    // restructure-phrased, edit-verb-free chip label (e.g. "Split 'Cost' into
    // per-option links"). Folding `|| structuralRestructureIntent` in now would
    // be symmetry with no discriminating (non-vacuous) mutation-pin — rowed for
    // ROADMAP follow-up (add it in the SAME change that introduces such copy).
    if ((editVerbCandidate || configureOptionIntent) && (isConfirmationShaped || isProposalReplayCandidate)) {
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
          answerKind: 'functional',
          assistant_text: NO_LIVE_PROPOSAL_TEXT,
          stage: ingress.stage,
          suggested_actions: [],
        });
        return sendFinalised200(reply, requestId, 'edit_graph', noProposalResponse, {
          graph: null,
          // T1 claim safety — INHERITED from the turn-entry read. Never a literal:
          // the permission belongs to the fact this response DISPLAYS, not to
          // whether this turn ran an analysis. See turn-claim-safety.ts.
          ...(await claimSafety.forExit()),
          // ROADMAP 1.132 (F1) — EGRESS-DEFAULT INVERSION: edit_graph receipt is
          // functional and must ship plain.
          answerKind: 'functional',
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
        // T1 claim safety — INHERITED from the turn-entry read. Never a literal:
        // the permission belongs to the fact this response DISPLAYS, not to
        // whether this turn ran an analysis. See turn-claim-safety.ts.
        ...(await claimSafety.forExit()),
        // ROADMAP 1.132 (F1) — EGRESS-DEFAULT INVERSION: edit_graph intercept
        // copy is functional and must ship plain.
        answerKind: 'functional',
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
        // T1 claim safety — INHERITED from the turn-entry read. Never a literal:
        // the permission belongs to the fact this response DISPLAYS, not to
        // whether this turn ran an analysis. See turn-claim-safety.ts.
        ...(await claimSafety.forExit()),
        // ROADMAP 1.132 (F1) — EGRESS-DEFAULT INVERSION: edit_graph intercept
        // copy is functional and must ship plain.
        answerKind: 'functional',
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
        // T1 claim safety — INHERITED from the turn-entry read. Never a literal:
        // the permission belongs to the fact this response DISPLAYS, not to
        // whether this turn ran an analysis. See turn-claim-safety.ts.
        ...(await claimSafety.forExit()),
        // ROADMAP 1.132 (F1) — EGRESS-DEFAULT INVERSION: edit_graph intercept
        // copy is functional and must ship plain.
        answerKind: 'functional',
        requestStartedAt: routeStartedAt,
        scenarioId: ingress.scenario_id,
        turnId: ingress.turn_id,
      userMessage: ingress.message,
      });
    }

    // ────────────────────────────────────────────────────────────────────
    // ⭐ L16 / walk finding N16 — BARE configure-option is a first-class
    // typed action, not a prompt for the edit LLM to guess at.
    //
    // "Configure {option}" and the configure chip's own message name NO factor
    // and NO value. They route here correctly (2.11 / 2.308), and then the
    // edit LLM has nothing to write, so it invents an operation. On the 3 Aug
    // walk the invention did not survive canonicalisation: 200 /
    // `OPERATION_DID_NOT_LAND` / "I wasn't able to make that change safely."
    // — the product unable to execute the chip it had just offered, on the
    // turn immediately after a successful add-option.
    //
    // Everything the user is missing is derivable server-side, so answer it
    // deterministically: the blocked option by name, the factor it is linked
    // to by name, and the one phrasing proven to reach the honest writer
    // (`buildConfigureOptionAdvisedFormat` = probe P1). No LLM call, no
    // invented value, no new vocabulary.
    //
    // Placed AFTER the Stage-4A intercepts (so chip-simplify / label / vague
    // keep precedence) and BEFORE the edit dispatch. `configureOptionIntent`
    // already carries the shared negative gates (meta-question, analytical,
    // state-query); `bypassEditHandling` keeps confirmations and state
    // queries out, exactly as its siblings above do.
    //
    // Strictly additive: `shouldInterceptBeforeEditLane` declines — and the
    // pre-existing route runs untouched — unless it can name a concrete next
    // step. In particular a configure message that DOES carry a factor and a
    // value (walk remedy #5, the path that worked) is declined on
    // `value_payload_present` and goes to the edit lane as before.
    if (configureOptionIntent && !bypassEditHandling) {
      let persistedForClarify: unknown = null;
      try {
        // Memoised: the configure label anchor above already paid for this
        // read on most of these turns, and the edit-lane reload below shares
        // the same memo — so the remedy costs no extra round-trip.
        persistedForClarify = await loadPersistedGraphOnce();
      } catch {
        // A labels/graph read must never fail a turn that would otherwise
        // succeed (same policy as `resolveConfigureOptionIntent`). Declining
        // here just leaves the pre-existing route in charge.
        persistedForClarify = null;
      }
      const configureClarify = shouldInterceptBeforeEditLane({
        message: ingress.message,
        detection: configureOptionDetection,
        graph: persistedForClarify,
      });
      if (configureClarify.matched) {
        emit(TelemetryEvents.V5ConfigureOptionClarifyIntercept, {
          request_id: requestId,
          scenario_id: ingress.scenario_id,
          trigger: configureOptionDetection.trigger,
          option_source: configureClarify.optionSource,
          factor_count: configureClarify.factorLabels.length,
        });
        const response = composeConfigureOptionClarifyResponse({
          optionLabel: configureClarify.optionLabel,
          factorLabels: configureClarify.factorLabels,
          stage: ingress.stage,
        });
        return sendFinalised200(reply, requestId, 'edit_graph', response, {
          // ⭐ GATE-REASON INTEGRITY. On the walk, the turns that took the
          // edit-lane non-apply path were the ONLY ones of seven to ship no
          // `analysis_ready`, and they are exactly the turns on which the run
          // gate's copy degraded from the specific reason ("'Launch Customer
          // Retention Programme' has no effect values yet") to the generic
          // one. Readiness is derived from the UNCHANGED persisted graph, so
          // it is current truth, not a guess — and the remedy turn is not the
          // turn the user loses their specific blocker.
          analysisReady: configureClarify.readiness,
          graph: null,
          // T1 claim safety — INHERITED from the turn-entry read. Never a literal:
          // the permission belongs to the fact this response DISPLAYS, not to
          // whether this turn ran an analysis. See turn-claim-safety.ts.
          ...(await claimSafety.forExit()),
          // ROADMAP 1.132 (F1) — EGRESS-DEFAULT INVERSION: edit_graph intercept
          // copy is functional and must ship plain.
          answerKind: 'functional',
          requestStartedAt: routeStartedAt,
          scenarioId: ingress.scenario_id,
          turnId: ingress.turn_id,
          userMessage: ingress.message,
        });
      }
    }

    // ────────────────────────────────────────────────────────────────────
    // ⭐ ROADMAP 2.1261 — repair-leg BARE-VALUE BINDING pre-route.
    //
    // Wire-witnessed on deployed #998 (scenario a05fefcd…, req b90d62e0): a
    // MISSING_OPTION_VALUE blocker asked the user to choose a value; the
    // unit-free, fully compliant reply "Set it to 0.12." fell through every
    // deterministic route (no label to anchor), reached the LLM router, was
    // re-proposed with the PRIOR turn's % unit, and re-served the
    // byte-identical unit refusal — a loop the user cannot exit without
    // guessing the explicit phrasing. The binding is derivable server-side:
    // the missing option×factor pairs are facts of the persisted graph, read
    // off the SAME canonical readiness payload that composed the blocker.
    //
    //   - exactly ONE pair missing  → BIND: dispatch the edit lane (the one
    //     chat path that writes option interventions) with the advised-format
    //     instruction carrying the user's value verbatim; the user's own
    //     message is what gets persisted as the turn record.
    //   - two or more pairs missing → ASK: deterministic disambiguation
    //     naming each pair, one chip per pair (trap 22f — the ambiguity is
    //     the product; never guess).
    //   - nothing missing / any doubt → DECLINE, byte-identical route.
    //
    // FAIL-CLOSED GATES, in order: the whole-message claim anchor (a named
    // target, a unit, a trailing clause or a question never matches); the
    // shared negative gates via `bypassEditHandling`; a CANVAS SELECTION on
    // the ingress (review #1000 B1 — see below); a live `set_factor_value`
    // pending (an open value-clarification makes the referent ambiguous —
    // decline rather than steal the resumer's turn); a pendings/graph read
    // failure; a persisted graph that fails the SAME ingress parse the edit
    // dispatch below would apply.
    //
    // ⭐ THE SELECTION GATE (review #1000 B1, execution-proven both ways):
    // "this one" / "that one" already HAVE a deterministic meaning when a
    // canvas selection exists — `DEICTIC_REFERENCE_PATTERN` (Path B,
    // deterministic-value-update.ts) resolves them to the SELECTED node in
    // the turn-executor. This pre-route runs BEFORE the executor sees
    // `selected_elements`, so without this gate a selection-carrying
    // "Set this one to 0.4." would bind the NON-selected sole-missing-pair
    // factor — a silent wrong-factor mutation, the exact harm the deictic
    // module's header names. ANY non-empty selection therefore withdraws the
    // claim wholesale (not just for the deictic referents): a user pointing
    // at the canvas has named their referent, and the established
    // selection-aware paths own the turn. The witnessed trapped request
    // (a2-turn3-request.json) carries NO selected_elements key, so the
    // witnessed journey is untouched.
    // ────────────────────────────────────────────────────────────────────
    const repairSelectionPresent =
      (extensions.selectedElements?.node_ids.length ?? 0) > 0 ||
      (extensions.selectedElements?.edge_ids.length ?? 0) > 0;
    let repairValueBinding: (RepairValueBindingResolution & { kind: 'bind' }) | null = null;
    if (
      !bypassEditHandling &&
      !configureOptionIntent &&
      !structuralRestructureIntent &&
      !repairSelectionPresent &&
      matchBareRepairValue(ingress.message) !== null
    ) {
      let repairClaimBlocked = false;
      try {
        const pendings = await loadMostRecentPendingActionsStrict(ingress.scenario_id, requestId);
        const nowMs = Date.now();
        repairClaimBlocked = pendings.some(
          (pa) => pa.action.kind === 'set_factor_value' && !isPendingActionExpired(pa, nowMs),
        );
      } catch {
        // A pendings read must never fail the turn; it only withdraws this
        // claim (the turn proceeds exactly as before this pre-route existed).
        repairClaimBlocked = true;
      }
      let persistedForRepair: unknown = null;
      if (!repairClaimBlocked) {
        try {
          persistedForRepair = await loadPersistedGraphOnce();
        } catch {
          persistedForRepair = null;
        }
      }
      if (
        !repairClaimBlocked &&
        persistedForRepair != null &&
        // The bind path re-enters the edit dispatch below, whose reload runs
        // this SAME parse on this SAME memoised graph — pre-checking it here
        // means a claim can never convert today's fall-through into a typed
        // recovery error.
        GraphStateIngressSchema.safeParse(persistedForRepair).success
      ) {
        const repairReadiness = buildCanonicalAnalysisReadyFromGraph(persistedForRepair);
        const resolution = resolveRepairValueBinding({
          message: ingress.message,
          readiness: repairReadiness,
        });
        if (resolution.matched) {
          emit(TelemetryEvents.V5RepairValueBindingResolved, {
            request_id: requestId,
            scenario_id: ingress.scenario_id,
            outcome: resolution.kind,
            pair_count: resolution.kind === 'ask' ? resolution.pairs.length : 1,
          });
        }
        if (resolution.matched && resolution.kind === 'ask') {
          const response = composeRepairValueAskResponse({
            pairs: resolution.pairs,
            valueText: resolution.valueText,
            stage: ingress.stage,
          });
          return sendFinalised200(reply, requestId, 'edit_graph', response, {
            // Gate-reason integrity (same rule as the L16 intercept above):
            // readiness is derived from the UNCHANGED persisted graph, so the
            // disambiguation turn is not the turn the blocker disappears.
            ...(repairReadiness !== undefined ? { analysisReady: repairReadiness } : {}),
            graph: null,
            ...(await claimSafety.forExit()),
            answerKind: 'functional',
            requestStartedAt: routeStartedAt,
            scenarioId: ingress.scenario_id,
            turnId: ingress.turn_id,
            userMessage: ingress.message,
          });
        }
        if (resolution.matched && resolution.kind === 'bind') {
          repairValueBinding = resolution;
        }
      }
    }

    // Predicates, state-query suppression, and the proposal-confirmation
    // resolution were computed ABOVE (hoisted before the Stage-4A intercepts so
    // a confirmation / state-query cannot be claimed by tryVagueEditGuard et al.
    // before it is applied / answered). Edit intent is the candidate minus a
    // suppressed proposal confirmation.
    // ROADMAP 2.11 / P0-2: configure-option intent is an edit-lane candidate
    // in its own right (see the detection block above) — same suppressors,
    // same proposal-confirm resolution, same dispatch.
    const editIntentDetected =
      // ⭐ ROADMAP 2.1261: a resolved bare-value BIND is an edit-lane intent in
      // its own right — the claim anchor + the sole-missing-pair derivation
      // above ARE its gates (bypassEditHandling was already required to claim).
      (editVerbCandidate || configureOptionIntent || structuralRestructureIntent ||
        repairValueBinding !== null) &&
      !proposalConfirmSuppressed &&
      // Edge-chip door (ROADMAP 1.187 / #30, HARD GATE before Lane U). A typed
      // mutation chip_click (source==='chip_click' with a defined, non-readiness
      // `action_type` — e.g. `adjust_edge_strength`/`set_factor_value`) whose
      // rendered copy is edge-edit-shaped hits EDIT_GRAPH_POSITIVE_REGEX and
      // would be claimed here by the V4 edit lane BEFORE runTurnExecutor — so
      // the C2 typed-chip reader (buildTypedChipMutationProposal in
      // turn-executor) never sees the chip's typed parameters. Excluding the
      // typed chip from this gate (the SAME guard already threaded into the
      // process-meta / frame-no-brief guards above) routes it by its TYPE to
      // turn-executor, where the C2 pre-route + #639 fall-through contract own
      // it. Genuine typed-TEXT edits (source!=='chip_click') are unaffected.
      !isNonReadinessTypedChipClickForExecutor;
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
          // ROADMAP 2.308 / S1: via the turn-scoped memo, so a turn whose
          // configure-option label anchor already read the graph does not
          // read it twice. Identical semantics — the memo re-throws the
          // original error.
          persisted = await loadPersistedGraphOnce();
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
          return await sendEditGraphRecovery(reply, requestId, ingress.scenario_id, ingress.stage, 'session_store_failed', ingress.message, claimSafety, ingress.turn_id, routeStartedAt);
        }
        if (persisted == null) {
          // ══════════════════════════════════════════════════════════════
          // ROADMAP 2.388 — THE MINUTE-ONE DEAD END. AT FRAME STAGE, FALL
          // THROUGH INSTEAD OF ERRORING.
          // ══════════════════════════════════════════════════════════════
          // There is no graph because the user has not built one yet. That is
          // not a failure of anything — it is the empty canvas, and it is
          // overwhelmingly a FIRST message: an edit verb (`increase` / `add` /
          // `raise` / `reduce`) in a sentence that happens to miss the
          // decision-brief regex. `editIntentDetected` is decided from the
          // message TEXT ALONE, before anything asks whether there is
          // something to edit, so the shape is reachable on turn one.
          //
          // The previous behaviour returned EDIT_GRAPH_RECOVERY_TEXT — "I
          // couldn't access the current graph. Please try again in a moment."
          // — which is both untrue (nothing was inaccessible) and
          // UNRECOVERABLE: the retry it invites re-enters this same branch.
          // Measured on staging `672b634`: 3/3 on a repeated message here,
          // 10/10 on the acceptance walk, with `llm_calls: []` and
          // `suggested_actions: []` — no model ran and no affordance shipped.
          //
          // Falling through costs nothing extra: `effectiveGraphState` below
          // is `resolvedGraphState ?? extensions.graphState`, and BOTH are
          // null on this branch, so `isEditGraphShape` is already false. The
          // turn therefore lands on `frame_no_brief_guard`, which is exactly
          // what the SAME user gets today when their sentence misses the
          // edit-verb list — the framing coaching PLUS a "Build the model"
          // chip. Shipped copy, shipped affordance, no new surface.
          //
          // ⚠ SCOPE 1, deliberately narrow. `session_store_failed` (the catch
          // above) and `persisted_graph_invalid` (below) KEEP the recovery
          // copy. Those are genuine transient / infrastructure failures where
          // "try again in a moment" is honest advice — which is the whole
          // reason `sendEditGraphRecovery` discriminates three reasons.
          //
          // ⚠ SCOPE 2 — `stage === 'frame'` ONLY, and this is a DISCLOSED
          // CARVE-OUT rather than an oversight. The fall-through's whole
          // justification is that the frame guard is waiting to catch it; at
          // `analyse` stage that guard does not fire (`isFrameNoBriefShape`
          // requires `stage === 'frame'`), so the turn would reach
          // `runTurnExecutor` instead — a broad LLM call, and a violation of
          // the standing edit-lane routing contract that
          // `tests/integration/orchestrator/route-v2-edit-graph-recovery.ts`
          // asserts (exactly one of dispatch / clarification / typed recovery,
          // never a fall-through to Sonnet). Every dead end L56 MEASURED
          // arrived at `stage: 'frame'` — it is what the UI sends on a first
          // message — so this scoping fixes 100% of the observed defect with
          // ZERO blast radius on the analyse-stage contract. An analyse-stage
          // turn with no persisted graph at all is a different (and much
          // rarer) state; it keeps today's typed recovery, and whether that
          // copy is right THERE is rowed separately rather than changed blind.
          //
          // The counter moves with the behaviour rather than disappearing: a
          // class that stops erroring must not also stop being measurable.
          if (ingress.stage !== 'frame') {
            return await sendEditGraphRecovery(reply, requestId, ingress.scenario_id, ingress.stage, 'no_persisted_graph', ingress.message, claimSafety, ingress.turn_id, routeStartedAt);
          }
          emit(TelemetryEvents.V5EditGraphNoPersistedGraphFallthrough, {
            request_id: requestId,
            scenario_id: ingress.scenario_id,
            message_length: ingress.message.length,
          });
          log.info(
            {
              request_id: requestId,
              scenario_id: ingress.scenario_id,
              message_length: ingress.message.length,
            },
            'V5 edit intent on an empty canvas — falling through to the frame guard instead of the typed recovery',
          );
        } else {
          // Validate the reloaded graph through the same ingress schema the
          // request body would have gone through. A persisted-but-invalid
          // shape is a different operational signal than absence — write a
          // distinct telemetry reason so it can be alerted on. UNCHANGED by
          // 2.388: this one really is a failure, and it really is retryable.
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
            return await sendEditGraphRecovery(reply, requestId, ingress.scenario_id, ingress.stage, 'persisted_graph_invalid', ingress.message, claimSafety, ingress.turn_id, routeStartedAt);
          }
          resolvedGraphState = parsed.data;
          emit(TelemetryEvents.V5EditGraphGraphStateReloaded, {
            request_id: requestId,
            scenario_id: ingress.scenario_id,
          });
        }
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
          // ⭐ ROADMAP 2.1261 — the BIND path's instruction. The edit LLM
          // receives the advised-format sentence (probe P1 verbatim) carrying
          // the user's value bound to the sole missing option×factor pair;
          // `payload.message` stays the user's own bytes everywhere it is
          // recorded (commit `userMessage`, wire echo, telemetry).
          ...(repairValueBinding !== null
            ? { editInstructionOverride: repairValueBinding.instruction }
            : {}),
          // ROADMAP 2.684 — the turn's wall-clock baseline, threaded so the
          // structural-edit composer can derive what is LEFT of the turn rather
          // than a static ceiling. Same baseline `dispatchDraftGraph` already
          // receives, and for the same reason: pre-flight, ingress parse and
          // scenario upsert spend the deadline before either dispatcher starts.
          //
          // ⚠ This one line is the difference between the composer getting the
          // turn's real remaining time and getting a number derived from
          // constants the deployed box does not hold. Witness #3 measured that
          // difference as a 5.0s kill. Removing it is caught by
          // `structural-edit-deadline-plumbing.test.ts`.
          requestStartMs: routeStartedAt,
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
          // T1 claim safety — INHERITED from the turn-entry read. Never a literal:
          // the permission belongs to the fact this response DISPLAYS, not to
          // whether this turn ran an analysis. See turn-claim-safety.ts.
          ...(await claimSafety.forExit()),
          // ROADMAP 1.132 (F1) — EGRESS-DEFAULT INVERSION: edit_graph receipt is
          // functional (add-option / edit confirmation) and must ship plain.
          answerKind: 'functional',
          ...(eg.freshness ? { freshness: eg.freshness } : {}),
          // S3-L6 / F-5: edit-lane LLM call → `_diagnostic_trace.llm_calls[]`.
          ...(eg.editLlmCall ? { editLlmCall: eg.editLlmCall } : {}),
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
    // Round-1 process-meta intake answer (META-DECISION-DIAGNOSIS-2026-07-20)
    // ────────────────────────────────────────────────────────────────────
    // A question TO the assistant about the process — the product's own
    // pre-analysis spark prompts ("What should I check before running the
    // first analysis?"), or a narrowly-matched typed variant — on the
    // empty-canvas frame state. The `draftShapedTurn` exclusion above
    // already kept it out of the draft dispatch and the clarify round;
    // this branch gives it an ANSWER. It must run BEFORE the frame-stage
    // no-brief guard below: that guard's canned reply ignores the user's
    // question, and its C3 offer path would seed a "Build the model" chip
    // with the meta-question as the brief seed — re-creating the exact
    // poisoned-brief defect one tap later.
    //
    // Scope (deliberately the defect state and nothing else):
    //   - frame stage, canvas not populated (nullness OR {nodes:[]} — the
    //     clarify gate's A5 population judgement, so both defect entry
    //     points are covered);
    //   - not a continuation (a mid-conversation meta-question already
    //     reaches TurnExecutor's LLM with memory — richer than this canned
    //     answer), EXCEPT the frame guard's own offer-loop continuation
    //     (marker), which would otherwise re-fire the canned framing
    //     prompt over the user's question.
    // COMMIT POSTURE: none — same as the plain frame guard ("no chip, no
    // commit, scenario stays fresh"). A committed turn here would make the
    // NEXT message a continuation and strand the user's real brief (the
    // Signature-Loop guard would suppress its draft) — the exact dead-end
    // class C3 exists to prevent, and no non-poisoned offer seed exists on
    // this state. Cost accepted: the exchange is not in turn memory.
    const isProcessMetaIntakeTurn =
      ingress.stage === 'frame' &&
      !isPopulatedIngressGraph(extensions.graphState) &&
      (!isContinuationScenario || draftOfferMarker !== null) &&
      // S2-L1 §2g: a typed chip_click bound for TurnExecutor is routed BY TYPE
      // and must never be intercepted by the string mirror (the whole point of
      // S2 — the type wins over the canned wording).
      !isNonReadinessTypedChipClickForExecutor &&
      isProcessMetaIntake(ingress.message);
    if (isProcessMetaIntakeTurn) {
      log.info(
        {
          event: 'v5.process_meta_intake_guard',
          request_id: requestId,
          message_length: ingress.message.length,
          source: ingress.source,
        },
        'Round-1 process-meta intake guard fired — answering the process question instead of drafting/clarifying',
      );
      emit(TelemetryEvents.V5ProcessMetaIntakeGuard, {
        request_id: requestId,
        message_length: ingress.message.length,
        source: ingress.source,
      });
      return sendFinalised200(
        reply,
        requestId,
        'process_meta_intake',
        composeProcessMetaIntakeResponse(),
        {
          graph: null,
          // T1 claim safety — INHERITED from the turn-entry read. Never a literal:
          // the permission belongs to the fact this response DISPLAYS, not to
          // whether this turn ran an analysis. See turn-claim-safety.ts.
          ...(await claimSafety.forExit()),
          // ROADMAP 1.132 (F1) — EGRESS-DEFAULT INVERSION: process-meta intake
          // copy is functional and must ship plain.
          answerKind: 'functional',
          requestStartedAt: routeStartedAt,
          scenarioId: ingress.scenario_id,
          turnId: ingress.turn_id,
          userMessage: ingress.message,
        },
      );
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
    // brief-shaped messages; whitelisted chip_click and system_event
    // branches handled those above. What reaches here at stage=frame + no
    // graph on a FRESH scenario is a non-brief ANONYMOUS message (source
    // 'composer'/'chip', no typed action_type).
    //
    // S2-L1 §2g FIX (2026-07-20): a `source='chip_click'` with a valid but
    // non-whitelisted, non-readiness `action_type` no longer reaches this
    // guard. Previously the chip_click exclusion forced `draftShapedTurn`
    // false even for draft-shaped canned text, so this guard CLAIMED it and
    // answered with the framing prompt — a misfire that contradicted the
    // #575 commit message's "the rest belong to TurnExecutor". The
    // `isNonReadinessTypedChipClickForExecutor` exclusion above now routes
    // every such typed chip_click to TurnExecutor, making the chip_click
    // region total. The formerly-pinning test
    // (route-v2-process-meta-intake.test.ts "chip_click with valid
    // non-whitelisted action_type") now asserts TurnExecutor routing.
    // Guide genuine anonymous frame-stage text back to the flow
    // deterministically with no LLM call.
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
    // ROADMAP 2.63 C3 — the guard may RE-FIRE on a continuation scenario the
    // guard itself created (marker = the last committed turn was a draft
    // offer): a second unshaped, non-confirm message keeps the deterministic
    // framing loop (fresh copy, fresh offer, refreshed TTL) instead of
    // paying a broad TurnExecutor LLM call. Confirm-shaped messages are
    // EXCLUDED from the re-fire: a "yes" that did not resume above (offer
    // expired, or another live pending exists) belongs to TurnExecutor's
    // short-confirm machinery (recovery_expired / consent-priority), never
    // to a canned framing prompt that would swallow it.
    const isDraftOfferRefire =
      isContinuationScenario &&
      draftOfferMarker !== null &&
      !SHORT_CONFIRM_PATTERN.test(ingress.message) &&
      !AFFIRMATIVE_PREFIX_PATTERN.test(ingress.message);
    const isFrameNoBriefShape =
      ingress.stage === 'frame' &&
      extensions.graphState == null &&
      // V5 Signature Loop — a continuation (prior committed turns) must NOT get
      // the "start over" framing prompt; let it reach TurnExecutor's memory.
      // C3 re-fire (above) is the one exception: the continuation consists of
      // the guard's own offer turns.
      (!isContinuationScenario || isDraftOfferRefire) &&
      // S2-L1 §2g fix: a typed chip_click with a valid non-whitelisted,
      // non-readiness action_type must reach TurnExecutor, not the canned
      // framing prompt. This retires the documented misfire (a draft-shaped
      // such chip_click was CLAIMED here because the chip_click exclusion
      // forces draftShapedTurn=false → isDraftGraphShape=false → this guard
      // consumed it). With the exclusion, the chip_click region is total.
      !isNonReadinessTypedChipClickForExecutor &&
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
      // ────────────────────────────────────────────────────────────────
      // ROADMAP 2.63 C3 — seed the deterministic draft offer.
      // ────────────────────────────────────────────────────────────────
      // Only when the guard-firing message carries a usable brief seed
      // (typed, ≥ min length after normalisation): a "Build the model"
      // chip is added, and a `draft_graph` pending action carrying the
      // seed is COMMITTED with the turn (pendings live on committed turn
      // rows), so the next turn's chip click / typed "yes" resumes through
      // the draft-offer pre-route into the C1/C2 deterministic dispatch.
      // Unusable-seed turns (short messages, chip_click canned text) keep
      // the pre-C3 guard byte-identically: no chip, no commit, scenario
      // stays fresh. On a commit failure the chip-less pre-C3 response is
      // sent (a chip whose consent cannot resume would be
      // guarantee-theatre) and the loop stays recoverable.
      const guardOfferSeed = deriveDraftOfferSeed(ingress.message, ingress.source);
      if (guardOfferSeed !== undefined) {
        const guardNowMs = Date.now();
        const guardChip = {
          id: `draft-offer-${randomUUID()}`,
          label: DRAFT_OFFER_CHIP_LABEL,
          message: DRAFT_OFFER_CHIP_MESSAGE,
        };
        const guardPending = buildDraftOfferPending({
          scenarioId: ingress.scenario_id,
          chipId: guardChip.id,
          publicLabel: guardChip.label,
          publicMessage: guardChip.message,
          briefSeed: guardOfferSeed,
          nowMs: guardNowMs,
        });
        // P1-1 — same derivation as the C4 site (one derivation, two
        // consumers): `draftOfferPriorPendings` is exactly what the commit
        // below threads, so the ", or just reply yes" clause is only made
        // when the offer will stand alone after this commit.
        const guardOfferWillBeSoleLive = willDraftOfferBeSoleLivePending(
          draftOfferPriorPendings,
          guardPending,
          guardNowMs,
        );
        const offerResponse: import('@talchain/schemas/boundary').OlumiResponse = {
          ...guardResponse,
          assistant_text: `${assistantText} ${draftOfferGuardSentence(guardOfferWillBeSoleLive)}`,
          suggested_actions: [guardChip],
        } as import('@talchain/schemas/boundary').OlumiResponse;
        try {
          const commitResult = await commitDirectAnswer(offerResponse, {
            scenario_id: ingress.scenario_id,
            turn_id: ingress.turn_id,
            turn_class: 'clarify',
            handler_id: null,
            request_hash: computeRequestHash(ingress),
            llm_calls_used: 0,
            duration_ms: Date.now() - routeStartedAt,
            handler_facts: [],
            pending_actions: [guardPending],
            // Fresh scenarios have no prior pendings ([]); on a re-fire the
            // pre-route read already loaded them — threading keeps the
            // carry-forward honest either way (the fresh offer supersedes
            // the carried one kind-level).
            priorPendingActions: draftOfferPriorPendings,
            coaching_state: null,
            userMessage: ingress.message,
          });
          emit(TelemetryEvents.V5DraftOfferSeeded, {
            request_id: requestId,
            scenario_id: ingress.scenario_id,
            site: 'frame_no_brief_guard',
            redraft: false,
            had_seed: true,
            refire: isDraftOfferRefire,
            persisted: true,
          });
          return sendFinalised200(reply, requestId, 'frame_no_brief_guard', commitResult.response, {
            graph: null,
            // T1 claim safety — INHERITED from the turn-entry read. Never a literal:
            // the permission belongs to the fact this response DISPLAYS, not to
            // whether this turn ran an analysis. See turn-claim-safety.ts.
            ...(await claimSafety.forExit()),
            // ROADMAP 1.132 (F1) — EGRESS-DEFAULT INVERSION: guard/commit copy is
            // functional and must ship plain.
            answerKind: 'functional',
            requestStartedAt: routeStartedAt,
            scenarioId: ingress.scenario_id,
            turnId: ingress.turn_id,
            userMessage: ingress.message,
          });
        } catch (err) {
          log.warn(
            {
              request_id: requestId,
              scenario_id: ingress.scenario_id,
              err: err instanceof Error ? { name: err.name, message: err.message } : { message: String(err) },
            },
            'V5 frame-guard draft offer — commit failed; sending chip-less framing prompt (pre-C3 behaviour)',
          );
          emit(TelemetryEvents.V5DraftOfferSeeded, {
            request_id: requestId,
            scenario_id: ingress.scenario_id,
            site: 'frame_no_brief_guard',
            redraft: false,
            had_seed: true,
            refire: isDraftOfferRefire,
            persisted: false,
          });
        }
      }
      return sendFinalised200(reply, requestId, 'frame_no_brief_guard', guardResponse, {
        graph: null,
        // T1 claim safety — INHERITED from the turn-entry read. Never a literal:
        // the permission belongs to the fact this response DISPLAYS, not to
        // whether this turn ran an analysis. See turn-claim-safety.ts.
        ...(await claimSafety.forExit()),
        // ROADMAP 1.132 (F1) — EGRESS-DEFAULT INVERSION: guard decline copy is
        // functional and must ship plain.
        answerKind: 'functional',
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
      // F2 CHANGE A — forced explanation intent for a typed analytical pill.
      ...(chipClickForcedIntent
        ? { chipClickForcedIntent }
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
      // F4 — a graph CAS conflict (GRAPH_DIVERGED) is NOT an infra failure: it
      // is a recoverable divergence. Return HTTP 409 with the explicit
      // refresh-and-reconfirm recovery metadata (lifted from the failure
      // response's error block) instead of the uniform 500, so the UI can
      // refresh canonical state and reconfirm rather than blind-retrying the
      // same stale base. All other commit failures keep the uniform 500.
      const isGraphConflict = failureType === 'GRAPH_DIVERGED';
      const conflictRecovery = isGraphConflict
        ? extractGraphConflictRecovery(run.response)
        : undefined;
      const boundaryError: BoundaryError = buildCommitFailureBoundaryError({
        validator: 'turn_commit',
        reason: isGraphConflict
          ? 'graph_write_conflict'
          : 'state_commit_failed_or_turn_runtime_failure',
        retryable,
        requestId,
        stage: ingress.stage,
        errorCode: failureType ?? 'INTERNAL_ERROR',
        preStageExtras: {
          failure_type: failureType,
          ...(conflictRecovery ?? {}),
        },
        postStageExtras: { stages_completed: run.telemetry.stages_completed },
      });
      if (isGraphConflict) {
        log.warn(
          {
            request_id: requestId,
            failure_type: failureType,
            stages_completed: run.telemetry.stages_completed,
          },
          'V5 turn — graph CAS conflict; returning 409 with refresh-reconfirm BoundaryError envelope',
        );
        // 409: recoverable divergence — nothing clobbered (txn rolled back).
        return reply.code(409).send(boundaryError);
      }
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
      // T1 claim safety — READ off the executor's run result, which took it
      // from the stamp the run_analysis handler persisted on the fact.
      // Never re-derived at the route (CLAUDE.md trap #12).
      //
      // F6 — the `?? true` is GONE and cannot regrow: the field is REQUIRED on
      // `TurnExecutorRunResult`, so an exit that fails to carry it fails to
      // compile. The default was dead (the ROADMAP 1.233 hoist populates the
      // field on every exit) and that is exactly why it was dangerous: a
      // latent, unexercised re-arming point that would have silently licensed
      // the next exit family to ship unguarded.
      mayNameLeadingOption: run.mayNameLeadingOption,
      // …and its evidence. REQUIRED on the run result for the same reason the
      // boolean is: a value reported without its provenance is a value no walk
      // can falsify.
      mayNameLeadingOptionProvenance: run.mayNameLeadingOptionProvenance,
      // ROADMAP 1.233 — the Layer-2 gate's own verdict, for the diagnostic
      // trace only. Absent ⇒ stamped `null` ("the gate did not run"), which is
      // the honest reading for a permitted turn or a non-explanation handler.
      ...(run.withheldExplanationReason !== undefined
        ? { withheldExplanationReason: run.withheldExplanationReason }
        : {}),
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
      // SELECTION-AWARE ANSWERING (hop 4b) — ⚠ THIS LINE IS THE WIRE'S SECOND
      // HALF. `projectGroundedSelection` and the executor capture can both be
      // fully green while the capability is DARK if this line is missing:
      // that is chronic failure #1, one dispatch-thread further down than the
      // hop-4 line it mirrors. Neutering it MUST turn the route-level wire
      // test red.
      ...(run.groundedSelection ? { groundedSelection: run.groundedSelection } : {}),
      // ROADMAP 1.132 (F1): thread the turn-executor's declared answer kind so
      // the egress synthesiser shapes ONLY substantive answers (coach / converse /
      // text_only model prose AND the deterministic post-analysis advice-gate /
      // run-comparison explanations) — never the deterministic clarify / receipt /
      // recovery / decline copy this same path can emit. Verified fail-closed
      // against the FINAL text at the executor's finalise seam.
      ...(run.answerKind ? { answerKind: run.answerKind } : {}),
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

/**
 * F4 — pull the graph-conflict recovery metadata out of the failure
 * response's error-block details so it can be forwarded onto the 409
 * BoundaryError envelope (A2's UI refresh/reconfirm leg reads it). Returns
 * undefined on any shape drift — the 409 status alone still carries the
 * recoverable signal.
 *
 * A-2: DERIVED from `GRAPH_CONFLICT_RECOVERY_KEYS`, the same manifest the
 * producers are compile-bound to (`satisfies GraphConflictFailureDetails` in
 * turn-executor.ts). The old hand allowlist here FAILED SILENT — a key added
 * at a producer never reached the wire (`fence_verdict` had to be hand-added
 * when the fence landed). Now a new key is either in the manifest (and flows
 * end-to-end) or a compile error at the producer; there is no silent third
 * state. Per-key copy semantics live beside the manifest.
 */
function extractGraphConflictRecovery(
  response: unknown,
): Record<string, unknown> | undefined {
  if (!response || typeof response !== 'object') return undefined;
  const blocks = (response as { blocks?: unknown }).blocks;
  if (!Array.isArray(blocks) || blocks.length === 0) return undefined;
  const errBlock = blocks.find(
    (b: unknown) =>
      b != null && typeof b === 'object' && (b as { type?: unknown }).type === 'error',
  );
  if (!errBlock || typeof errBlock !== 'object') return undefined;
  const details = (errBlock as { details?: unknown }).details;
  if (!details || typeof details !== 'object') return undefined;
  const d = details as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of GRAPH_CONFLICT_RECOVERY_KEYS) {
    if (GRAPH_CONFLICT_RECOVERY_COPY_MODE[key] === 'string') {
      if (typeof d[key] === 'string') out[key] = d[key];
    } else if (key in d) {
      out[key] = d[key];
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
