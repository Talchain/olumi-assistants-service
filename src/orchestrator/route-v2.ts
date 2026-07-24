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
import {
  GraphStateIngressSchema,
  type GraphStateIngress,
} from '../orchestrator-v5/boundary/request-extensions.js';
import {
  buildTurnContext,
  loadHasPriorTurns,
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
import { detectConfigureOptionIntent } from '../orchestrator-v5/routing/configure-option-intent.js';
import { detectStructuralRestructureIntent } from '../orchestrator-v5/routing/structural-restructure-intent.js';
import { classifyAnalyticalIntent } from '../orchestrator-v5/routing/analytical-intent.js';
import { tryChipSimplifyIntercept } from '../orchestrator-v5/routing/chip-simplify-intercept.js';
import {
  composePostAnalysisLabelInterceptResponse,
  tryPostAnalysisLabelIntercept,
} from '../orchestrator-v5/routing/post-analysis-label-intercept.js';
import { tryVagueEditGuard } from '../orchestrator-v5/routing/vague-edit-guard.js';
import {
  isProcessMetaIntake,
  composeProcessMetaIntakeResponse,
} from '../orchestrator-v5/routing/process-meta-intake.js';
import { composeReadinessIntakeResponse } from '../orchestrator-v5/routing/readiness-intake.js';
import { shouldSuppressEditDispatchForValueUpdate } from './routing/value-update-gate.js';

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

/** C3 — frame-guard offer chip (no action_type: text-replay chip). */
const DRAFT_OFFER_CHIP_LABEL = 'Build the model';
const DRAFT_OFFER_CHIP_MESSAGE = 'Yes, build the model from what I have shared.';
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
    // (same defence-in-depth posture as `_reasoning`): the re-attach block
    // below is the sole authority, and the strict `OlumiResponseSchema` must
    // not see an unknown key.
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
  // Re-attach `_answer_shape` post-validation on the success path (ROADMAP
  // 1.132, same re-attach shape as `_reasoning` above; UNCONDITIONAL since
  // the F1 flag deletion). `ctx.answerShape` is threaded from
  // `run.answerShape` (turn-executor) — the VALIDATED coach/converse shape
  // whose derived text was the final assistant_text when the executor
  // finalised. The fallback envelope never carries it; an upstream
  // body-attach was dropped by the strip step above. Re-finalise for WeakSet
  // membership, same as the other surfaces.
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
  if (egress.ok && ctx.answerShape) {
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
        sanitiseOlumiResponseForEgress(augmented, { graph: ctx.graph, requestId, exitPath, userMessage: ctx.userMessage }),
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
    answerKind: 'functional',
    assistant_text: EDIT_GRAPH_RECOVERY_TEXT,
    stage,
  }), { graph: null, answerKind: 'functional', userMessage });
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
        // (NOT a 500), mirroring the TurnExecutor handler-recovery path. No
        // analysis_ready is stamped — no analysis ran and the graph was not
        // mutated, so the UI retains its prior store value (failure semantics).
        if (cc.outcome === 'handler_recovered') {
          return sendFinalised200(reply, requestId, 'chip_click', cc.response, {
            graph: cc.graph,
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
      const readiness = composeReadinessIntakeResponse(persistedGraph, ingress.stage);
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
      // No commit: parity with the process-meta intake answer (no chip, no
      // commit, scenario stays fresh). graph:null — the composed text carries
      // option LABELS (via summariseReadiness), never raw node ids, so the
      // egress label sanitiser has nothing to resolve.
      return sendFinalised200(reply, requestId, 'readiness_intake', readiness.response, {
        graph: null,
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
    const isContinuationScenario = frameStageNoGraph
      ? await loadHasPriorTurns(ingress.scenario_id, requestId)
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
      (!isContinuationScenario || draftOfferMarker !== null) &&
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
          readonly pipelineRecovery?: Record<string, unknown> | null;
          readonly pipelineDetails?: Record<string, unknown> | null;
        };
        const pipelineStatusCode =
          typeof meta.pipelineStatusCode === 'number' ? meta.pipelineStatusCode : null;
        const pipelineErrorCode =
          typeof meta.pipelineErrorCode === 'string' ? meta.pipelineErrorCode : null;
        const pipelineReason =
          typeof meta.pipelineReason === 'string' ? meta.pipelineReason : null;
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
          ? mapDraftGraphPipelineReason(pipelineStatusCode, pipelineErrorCode, pipelineReason)
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
    const configureOptionDetection = detectConfigureOptionIntent(
      ingress.message,
      (extensions.graphState?.nodes ?? [])
        .filter((n) => n.kind === 'option' && typeof n.label === 'string')
        .map((n) => n.label as string),
    );
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
        // ROADMAP 1.132 (F1) — EGRESS-DEFAULT INVERSION: edit_graph intercept
        // copy is functional and must ship plain.
        answerKind: 'functional',
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
    // ROADMAP 2.11 / P0-2: configure-option intent is an edit-lane candidate
    // in its own right (see the detection block above) — same suppressors,
    // same proposal-confirm resolution, same dispatch.
    const editIntentDetected =
      (editVerbCandidate || configureOptionIntent || structuralRestructureIntent) &&
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
 * F4 — pull the graph-CAS-conflict recovery metadata (recovery_action,
 * conflict_category, expected_base_graph_hash) out of the failure response's
 * error-block details so it can be forwarded onto the 409 BoundaryError
 * envelope (A2's UI refresh/reconfirm leg reads it). Returns undefined on any
 * shape drift — the 409 status alone still carries the recoverable signal.
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
  if (typeof d.recovery_action === 'string') out.recovery_action = d.recovery_action;
  if (typeof d.conflict_category === 'string') out.conflict_category = d.conflict_category;
  if ('expected_base_graph_hash' in d) {
    out.expected_base_graph_hash = d.expected_base_graph_hash;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

