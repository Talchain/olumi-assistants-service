/**
 * V5 pre-Sonnet dispatch for edit_graph turns.
 *
 * Mirrors draft-graph-dispatch.ts for natural-language graph edits.
 * `edit_graph` is NOT in v0.7.0 V5ActionType, so Sonnet's tool-use validator
 * cannot propose it. Route-v2 detects the edit shape (message-kind, graph
 * present, positive edit-intent regex, no non-edit phrasing regex) and
 * delegates deterministically to handleEditGraph.
 *
 * Adapter decision (same reasoning as draft-graph-dispatch): v0.7.0's
 * OlumiResponse.graph_patch block is narrow (single-target operation on
 * ['set_factor_value','add_constraint','adjust_edge_strength']), whereas
 * V4's edit_graph emits richer patch descriptions including multi-op
 * patches, pending clarifications, and route metadata. The adapter
 * produces a text-only OlumiResponse; the applied graph persists via
 * the pipeline's own side channels.
 */

import type { FastifyRequest } from 'fastify';

import type { MessageTurnPayload, OlumiResponse } from '@talchain/schemas/boundary';

import { emit, log, TelemetryEvents } from '../../utils/telemetry.js';
import { handleEditGraph, type EditGraphResult } from '../../orchestrator/tools/edit-graph.js';
import { classifyAddRiskIntent } from './edit-templates/classify-add-risk.js';
import { buildAddRiskClarification } from './edit-templates/add-risk-template.js';
import { wouldExceedAddRiskLimits } from '../../orchestrator/graph-structure-validator.js';
import { commitDirectAnswer, computeRequestHash } from '../commit.js';
import {
  buildEditGraphHandlerFact,
  buildGenericEditGraphHandlerFact,
  isSuccessfulAppliedMutation,
} from './edit-graph-fact-builder.js';
import {
  applyEgressForbiddenPhraseGuard,
  EGRESS_FORBIDDEN_PHRASE_FALLBACK_TEXT,
  findSuccessClaimHit,
} from '../compose/forbidden-user-facing-phrases.js';
import {
  decideGoalTargetReceipt,
  GOAL_TARGET_NOT_SAVED_TEXT,
} from '../compose/goal-target-receipt-guard.js';
import { getAdapter } from '../../adapters/llm/router.js';
import { getSystemPromptMeta } from '../../adapters/llm/prompt-loader.js';
import {
  classifyThrownFailureCode,
  deriveEditTurnFieldsFromResult,
  finaliseEditTurnEvent,
  type EditTurnEventAccumulator,
} from './edit-graph-turn-event.js';
import type {
  ConversationContext,
  ConversationMessage,
  DecisionStage,
  GraphPatchBlockData,
  GraphV3T,
  PendingClarificationState,
  SuggestedAction,
  V2RunResponseEnvelope,
} from '../../orchestrator/types.js';
import { GraphV3 } from '../../schemas/cee-v3.js';
import type { AnalysisStateIngress, GraphStateIngress } from '../boundary/request-extensions.js';
import { computeStructuralReadiness } from '../../orchestrator/tools/analysis-ready-helper.js';
import type { AnalysisReadyPayload } from '../compose/analysis-ready-emit.js';
import {
  buildTurnContext,
  loadMostRecentPendingActions,
  loadPersistedGraphStrict,
  loadRecentConversationTurns,
} from '../build-turn-context.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import { projectConversation } from '../context/context-pack-assembler.js';
import { computeExpectedGraphCasHashes } from '../context/graph-cas-conflict.js';
import { extractGraphOptionIds } from '../context/option-identity.js';
import { config } from '../../config/index.js';
import {
  deriveAnalysisFreshness,
  emitFreshnessTelemetry,
  isSuccessfulRunAnalysisFact,
  type FreshnessDerivation,
} from '../context/freshness.js';
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import {
  classifyAnalyticalIntent,
  hasMutationSignal,
  looksLikeVagueEdit,
} from '../routing/analytical-intent.js';
import {
  buildProposalPendingAction,
  decideProposalContinuation,
  findProposedConceptAction,
  resolveProposalResume,
} from '../coaching/proposal-continuation.js';
import {
  evaluateEditGraphMutations,
  type EditGmDecision,
} from './edit-graph-referee-gate.js';
import type { FrameFreshness } from '../graph-management/types.js';
import { derivePendingActionsFromFinalizedChips } from '../compose/derive-pending-actions.js';
import type { SuggestedAction as BoundarySuggestedAction } from '../compose/types.js';

// v0.7.0's Stage enum (frame | analyse | decide | review) does not align with
// V4's DecisionStage (frame | ideate | evaluate | decide | optimise). Map
// across the boundary so ConversationContext.framing.stage is a valid V4
// DecisionStage. Unmapped values fall back to 'frame' — edit_graph is a
// structural operation that doesn't branch on stage, so a broad default is
// safe here.
/**
 * V5 Context Management v1 — no-op recovery decision.
 *
 * Pure function. Given the user's message, the prior fact chain, and
 * the post-edit freshness verdict, decide whether to upgrade a bland
 * no-op response into context-aware copy. Returns either a non-null
 * `assistantText` to overwrite + optional suggested-action chips, or
 * `assistantText: null` to leave the existing response unchanged.
 *
 * Branches:
 *   - `analytical_fresh`        — analytical intent + fresh run_analysis fact.
 *   - `analytical_stale`        — analytical intent + stale run_analysis fact.
 *   - `analytical_none`         — analytical intent + no run_analysis fact.
 *   - `vague_edit`              — no analytical intent, no concrete mutation
 *                                  signal (message looks edit-like but vague).
 *   - `explore_factor`          — message contains a known graph node label,
 *                                  no mutation signal, fresh run_analysis
 *                                  fact present. Three exploration chips
 *                                  (explain / what-would-flip / pre-mortem).
 *   - `explore_factor_stale`    — same as `explore_factor` but the prior
 *                                  analysis is stale. Single rerun chip;
 *                                  exploration chips suppressed to avoid
 *                                  silent stale-context UX.
 *   - `ambiguous`               — anything else; preserve existing copy.
 *
 * Freshness precedence for the explore_factor pair:
 *   - 'fresh'           → explore_factor
 *   - 'stale'           → explore_factor_stale
 *   - 'unknown' / 'none'→ defer to ambiguous (cannot prove freshness;
 *                          safer to preserve V4 copy than nudge with
 *                          analysis-grounded chips).
 *
 * Copy contract: British English, calm, concise. No emoji, no em dashes,
 * no raw IDs, no internal terms ("validator", "patch", "schema",
 * "operation", "dispatcher", "tool call"), no "winner" / "winning" /
 * "recommendation".
 */
type NoOpRecoveryBranch =
  | 'analytical_fresh'
  | 'analytical_stale'
  | 'analytical_none'
  | 'vague_edit'
  | 'explore_factor'
  | 'explore_factor_stale'
  | 'proposal_stage_one'
  | 'proposal_stage_two'
  | 'ambiguous'
  // R10 — no-op clarification-preservation outcomes. Feed the R7 event's
  // `branch` field so the preservation-vs-fallback rate is measurable.
  | 'noop_clarification_preserved'
  | 'noop_fallback_copy';

interface NoOpRecoveryDecision {
  readonly branch: NoOpRecoveryBranch;
  readonly intent_class: ReturnType<typeof classifyAnalyticalIntent>;
  readonly has_run_analysis_fact: boolean;
  readonly assistantText: string | null;
  readonly suggestedActions: readonly BoundaryAction[];
}

interface DecideNoOpRecoveryInput {
  readonly message: string;
  readonly priorFacts: readonly HandlerFact[];
  readonly freshness: 'fresh' | 'stale' | 'unknown' | 'none';
  /**
   * Whether the current graph is ready for analysis (has nodes and
   * edges). Mirrors the predicate used by `tryNoAnalysisGuard` so the
   * `analytical_none` branch only offers a `run_analysis` chip when
   * clicking it would actually work. When false, the chip is
   * suppressed and the copy nudges getting the model ready first.
   */
  readonly graphReady: boolean;
  /**
   * V5 P0 — Most-recent-turn proposed concept, if any. Populated by the
   * caller from `EnrichedTurnContext.most_recent_pending_actions` via
   * `findProposedConceptAction`. When non-null, this enables the
   * `proposal_stage_one` / `proposal_stage_two` branches that resume
   * a Sonnet-emitted proposal as a deterministic clarifier instead of
   * dead-ending in `vague_edit`.
   *
   * Optional on the type so existing callers / tests that did not
   * receive the field continue to compile; behaviour is identical to
   * the prior implementation when this is undefined or null.
   */
  readonly pendingProposedConcept?: {
    readonly concept: string;
    readonly preferred_kind: 'risk' | 'factor' | 'either';
  } | null;
  /**
   * V5 P0 staging-smoke follow-up (PR #212): when the pre-LLM
   * proposal-continuation intercept in `dispatchEditGraph` has already
   * emitted Stage 1 / Stage 2 deterministic chips on this turn, the
   * no-op recovery layer MUST NOT also fire its `proposal_stage_one`
   * / `_two` branches — that produced 6 chips instead of 3 on staging.
   *
   * When `true`, the proposal-resume ladder is skipped here entirely;
   * existing branches (analytical_*, vague_edit, explore_factor*,
   * ambiguous) still run as defence-in-depth. When `undefined` or
   * `false`, behaviour is identical to the prior implementation.
   *
   * The flag is set by the dispatch call site, not by the resumer.
   */
  readonly proposalAlreadyEmittedInThisTurn?: boolean;
  /**
   * R10 — set when the V4 no-op branch already preserved a scrubbed LLM
   * clarifying question. When true, `decideNoOpRecovery` returns a fully inert
   * decision so no branch (notably vague-edit) can clobber the preserved text.
   */
  readonly noOpClarificationPreserved?: boolean;
  /**
   * Current graph nodes — used by:
   *   1. the `explore_factor` safety-net branch to detect a no-op message
   *      that references a known graph label without an edit verb / value
   *      (the symptom of a label-chip click that slipped past the upstream
   *      `tryPostAnalysisLabelIntercept` in route-v2.ts);
   *   2. the V5 P0 `proposal_stage_two` clarifier to pick candidate
   *      affect-target labels from the existing model (goal / outcome
   *      kinds first, then other factors).
   *
   * An empty array is acceptable — the explore branch never fires and the
   * Stage 2 clarifier falls back to a free-text prompt. Each entry needs
   * `label`; `kind` is optional and used only by Stage 2's ordering.
   */
  readonly nodes?: readonly { readonly label: string; readonly kind?: string }[] | null;
}

const NO_OP_FRESH_TEXT =
  "I haven't changed the model. This looks like an analysis question. "
  + "I can walk you through the latest result.";

const NO_OP_STALE_TEXT =
  "I haven't changed the model. The analysis is based on an earlier "
  + "version of the graph. Re-run analysis and I'll walk you through "
  + 'the latest result.';

const NO_OP_NONE_GRAPH_READY_TEXT =
  "I haven't changed the model. Run analysis first and I'll walk you "
  + 'through the result.';

const NO_OP_NONE_GRAPH_NOT_READY_TEXT =
  "I haven't changed the model. Once the model is ready, run analysis "
  + "and I'll explain what drove the outcome.";

// PR #218 smoke follow-up (Fix B): the prior copy said "Tell me which
// factor or edge you want to adjust" — "factor or edge" leaks internal
// schema vocabulary the copy contract forbids, and the smoke showed it
// reaching the user whenever a genuine proposal fell through extraction.
// Reworded to keep the meaning (nothing changed yet; ask what to change)
// without naming schema concepts (edge/node/graph/schema/patch).
const NO_OP_VAGUE_EDIT_TEXT =
  'I have not changed the model yet. Tell me what you want to change, '
  + 'and I will help apply it.';

const NO_OP_EXPLORE_FACTOR_TEXT =
  "I haven't changed the model. It looks like you would like to "
  + 'explore this. I can walk you through the analysis, look at '
  + 'what could change the outcome, or run a pre-mortem.';

const NO_OP_EXPLORE_FACTOR_STALE_TEXT =
  "I haven't changed the model. The analysis is based on an earlier "
  + 'version of the graph. Re-run analysis to explore this against '
  + 'the latest result.';

const EXPLAIN_RESULTS_CHIP: BoundaryAction = Object.freeze({
  id: 'chip_action_explain_results',
  label: 'Walk me through the analysis',
  message: 'Walk me through the analysis.',
  // Plural — matches the registered V5 handler in `tools/registry.ts`
  // and the deterministic chip-click whitelist. Using the singular
  // `'explain_result'` would fall through as a deprecated alias and
  // miss the fast chip-click dispatch.
  action_type: 'explain_results' as const,
});

const RERUN_ANALYSIS_CHIP: BoundaryAction = Object.freeze({
  id: 'chip_action_rerun_analysis',
  label: 'Re-run analysis',
  message: 'Re-run the analysis.',
  action_type: 'run_analysis' as const,
});

const RUN_ANALYSIS_CHIP: BoundaryAction = Object.freeze({
  id: 'chip_action_run_analysis',
  label: 'Run analysis',
  message: 'Run analysis.',
  action_type: 'run_analysis' as const,
});

/**
 * What-would-flip exploration chip. Carries `action_type:
 * 'what_would_flip'` so a click hits the deterministic chip-click
 * fast path in route-v2.ts:819 — zero Sonnet round-trip. Used by the
 * `explore_factor` safety-net branch as one of three exploration
 * affordances.
 */
const WHAT_WOULD_FLIP_CHIP: BoundaryAction = Object.freeze({
  id: 'chip_action_what_would_flip',
  label: 'What could change the outcome?',
  message: 'What could change the outcome of this analysis?',
  action_type: 'what_would_flip' as const,
});

/**
 * Pre-mortem prompt chip. No `action_type` because there is no
 * registered handler for the pre-mortem flow; the click routes
 * through TurnExecutor as a normal user turn. Mirrors the
 * decide-stage rule pattern in
 * `compose/chip-generator.ts:541-546`.
 */
const RUN_PRE_MORTEM_CHIP: BoundaryAction = Object.freeze({
  id: 'chip_action_run_pre_mortem',
  label: 'Run a pre-mortem',
  message: 'Imagine this decision went wrong. What would have caused it?',
});

/**
 * Escape regex metacharacters in a literal label string so it can be
 * embedded inside a custom-boundary pattern safely. Labels are
 * user-authored and may contain `.()*+?[]{}^$|\` etc.
 */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Case-insensitive ALPHANUMERIC-BOUNDARY check: does `message`
 * contain any of `nodes`'s labels as a complete token?
 *
 * The pre-round-3 implementation used JS `\b` which is defined as a
 * word/non-word transition where `\w = [A-Za-z0-9_]`. That rejects
 * labels whose first or last character is non-word — e.g.
 * `Revenue (%)` (ends with `)`) or `C++` (ends with `+`) — because
 * the leading / trailing `\b` cannot fire when the label itself ends
 * with a non-word character (no word→non-word transition is
 * possible). Round-3 reviewer flagged this as a false-negative class
 * the corpus could realistically hit.
 *
 * The custom boundary `(^|[^A-Za-z0-9])` / `(?=$|[^A-Za-z0-9])`
 * fires on start-of-string / end-of-string or any non-alphanumeric
 * character around the literal label. This:
 *   - still rejects "costs" / "costliness" for label "Cost" (the
 *     character AFTER "cost" is alphanumeric `s` / `l`),
 *   - still matches standalone "cost" with surrounding punctuation
 *     ("Explore the Cost!"),
 *   - now matches "Revenue (%)" inside "Look at Revenue (%) here"
 *     (the `)` is the label's own trailing char; the lookahead sees
 *     the following space as non-alphanumeric).
 *
 * Labels shorter than 3 characters are still skipped — single- and
 * two-letter labels would false-positive on common words even with
 * alphanumeric boundaries (e.g. a label "AI" matching "wait" — the
 * `A` after `w` is alphanumeric so the leading boundary fails, but
 * a label "X" inside a numeric context could leak).
 *
 * Underscore (`_`) is intentionally treated as alphanumeric by
 * `[^A-Za-z0-9]` (i.e. as a boundary character). Labels do not use
 * underscores in practice; if they did, this would NOT match
 * "foo_label" against label "label" — same conservative behaviour as
 * `\b`.
 */
function messageContainsKnownLabel(
  message: string,
  nodes: readonly { readonly label: string }[] | null | undefined,
): boolean {
  if (!nodes || nodes.length === 0) return false;
  for (const node of nodes) {
    if (typeof node.label !== 'string') continue;
    const label = node.label.trim();
    if (label.length < 3) continue;
    const pattern = new RegExp(
      `(^|[^A-Za-z0-9])${escapeRegex(label)}(?=$|[^A-Za-z0-9])`,
      'i',
    );
    if (pattern.test(message)) return true;
  }
  return false;
}

export function decideNoOpRecovery(input: DecideNoOpRecoveryInput): NoOpRecoveryDecision {
  const hasRunAnalysisFact = input.priorFacts.some(
    (f) => f.fact_type === 'run_analysis' && isSuccessfulRunAnalysisFact(f),
  );

  // V5 P0 — early-emit authority guard (PR #216 review BLOCKER fix).
  //
  // When the pre-LLM proposal intercept has ALREADY emitted a Stage 1
  // / Stage 2 response this turn (`proposalAlreadyEmittedInThisTurn ===
  // true`), that response is authoritative: it carries the clean
  // concept and exactly the right chips. The no-op recovery layer must
  // NOT touch it via ANY branch.
  //
  // A narrower "suppress only the proposal_stage_* branches" guard was
  // insufficient: the SAME agreement message can also satisfy
  // `looksLikeVagueEdit` / `classifyAnalyticalIntent` (e.g. the staging
  // transcript "...how should we update the decision model?" matches
  // the vague-edit signal), so after the proposal branch was suppressed
  // the recovery returned `vague_edit` copy — "I haven't changed the
  // model yet. Tell me which factor or edge..." — which the dispatch
  // then applied over the Stage 1 text, reintroducing the exact failure
  // this feature removes AND leaking the forbidden "factor or edge"
  // phrasing. Returning a fully INERT decision here makes it
  // structurally impossible for any current or future recovery branch
  // to overwrite or append to the authoritative early-emit response.
  // The dispatch still refreshes the pending-action TTL on the
  // early-emit path independently of this return value.
  if (input.proposalAlreadyEmittedInThisTurn === true) {
    return {
      branch: 'ambiguous',
      intent_class: null,
      has_run_analysis_fact: hasRunAnalysisFact,
      assistantText: null,
      suggestedActions: [],
    };
  }

  // R10 — no-op clarification-preservation authority guard. When the V4 no-op
  // branch already preserved a scrubbed LLM clarifying question
  // (`noOpClarificationPreserved === true`), that question is authoritative for
  // this turn. Return a fully INERT decision (assistantText: null = keep the
  // upstream text) so no recovery branch — in particular the vague-edit branch,
  // which fires precisely on the ambiguous-target messages that PRODUCE a
  // clarifying question — can overwrite it. Mirrors the early-emit guard above.
  if (input.noOpClarificationPreserved === true) {
    return {
      branch: 'noop_clarification_preserved',
      intent_class: null,
      has_run_analysis_fact: hasRunAnalysisFact,
      assistantText: null,
      suggestedActions: [],
    };
  }

  const intentClass = classifyAnalyticalIntent(input.message);
  const mutationSignal = hasMutationSignal(input.message);

  // V5 P0 proposal-memory continuation — Stage 2 / Stage 1 ladder.
  //
  // Defence-in-depth for the case where the pre-LLM intercept did NOT
  // fire (e.g. graph parse failure made it unsafe, or this is the
  // add-risk branch where the intercept is skipped). When the intercept
  // DID fire, the early-emit authority guard above has already returned;
  // we never reach here. Pending exists but neither Stage 1 nor Stage 2
  // matched → null return → fall through to the existing branch ladder.
  {
    const proposalDecision = decideProposalContinuation({
      message: input.message,
      pendingProposedConcept: input.pendingProposedConcept ?? null,
      nodes: input.nodes ?? null,
    });
    if (proposalDecision !== null) {
      return {
        branch:
          proposalDecision.stage === 'stage_two'
            ? 'proposal_stage_two'
            : 'proposal_stage_one',
        intent_class: intentClass,
        has_run_analysis_fact: hasRunAnalysisFact,
        assistantText: proposalDecision.assistantText,
        suggestedActions: proposalDecision.suggestedActions.map((a) => ({
          id: a.id,
          label: a.label,
          message: a.message,
        })),
      };
    }
  }

  if (intentClass !== null && !mutationSignal) {
    if (hasRunAnalysisFact && input.freshness === 'fresh') {
      return {
        branch: 'analytical_fresh',
        intent_class: intentClass,
        has_run_analysis_fact: true,
        assistantText: NO_OP_FRESH_TEXT,
        suggestedActions: [EXPLAIN_RESULTS_CHIP],
      };
    }
    if (hasRunAnalysisFact && input.freshness === 'stale') {
      return {
        branch: 'analytical_stale',
        intent_class: intentClass,
        has_run_analysis_fact: true,
        assistantText: NO_OP_STALE_TEXT,
        suggestedActions: [RERUN_ANALYSIS_CHIP],
      };
    }
    if (!hasRunAnalysisFact) {
      // Mirror `tryNoAnalysisGuard`'s graph-readiness gating: suppress
      // the `run_analysis` chip when the graph is not ready (clicking
      // it would fail), and use the matching copy variant.
      return {
        branch: 'analytical_none',
        intent_class: intentClass,
        has_run_analysis_fact: false,
        assistantText: input.graphReady
          ? NO_OP_NONE_GRAPH_READY_TEXT
          : NO_OP_NONE_GRAPH_NOT_READY_TEXT,
        suggestedActions: input.graphReady ? [RUN_ANALYSIS_CHIP] : [],
      };
    }
    // analytical intent + (unknown freshness or has_run_analysis_fact
    // with non-fresh/stale verdict): treat as ambiguous and preserve
    // existing copy. The freshness verdict ladder is exhaustive
    // (fresh/stale/unknown/none); `unknown` falls here.
    return {
      branch: 'ambiguous',
      intent_class: intentClass,
      has_run_analysis_fact: hasRunAnalysisFact,
      assistantText: null,
      suggestedActions: [],
    };
  }

  if (intentClass === null && !mutationSignal && looksLikeVagueEdit(input.message)) {
    // Message carries a positive vague-edit signal (imperative edit
    // verb with an abstract target). Ask a calm clarification.
    return {
      branch: 'vague_edit',
      intent_class: null,
      has_run_analysis_fact: hasRunAnalysisFact,
      assistantText: NO_OP_VAGUE_EDIT_TEXT,
      suggestedActions: [],
    };
  }

  // Safety-net branches — `explore_factor` / `explore_factor_stale`.
  //
  // Fires when:
  //   - no analytical intent matched (handled above),
  //   - no mutation signal (the user did not supply a value),
  //   - no vague-edit phrasing (handled above),
  //   - BUT the message contains a known graph node label, AND
  //   - a successful prior `run_analysis` fact exists.
  //
  // This is the second line of defence behind
  // `tryPostAnalysisLabelIntercept` in route-v2.ts: if anything still
  // dispatches into the V4 LLM and no-ops with a message that mentions
  // a known label (e.g. a chip with an unusual submit shape, or a
  // user typing a factor name plus a stray word), we turn the dead
  // end into a useful affordance rather than surfacing the bland
  // deterministic fallback with no chips.
  //
  // Freshness handling mirrors the analytical branches above:
  //   - 'fresh' → three exploration chips (explain / what-would-flip /
  //               pre-mortem). The analysis is current; explore freely.
  //   - 'stale' → single re-run chip. The current analysis no longer
  //               reflects the graph; offering exploration chips would
  //               silently feed the user stale-context UX. Code+chip
  //               mirror the existing `analytical_stale` branch.
  //   - 'unknown' / 'none' → defer to ambiguous. With an unverifiable
  //               freshness verdict the safest thing is to preserve
  //               the V4 handler's existing copy rather than risk a
  //               stale exploration nudge.
  //
  // Copy + chips are duplicated rather than imported from
  // `compose/post-analysis-label-intercept.ts` to keep this module's
  // no-circular-dependency contract intact.
  if (
    !mutationSignal
    && hasRunAnalysisFact
    && messageContainsKnownLabel(input.message, input.nodes ?? null)
  ) {
    if (input.freshness === 'fresh') {
      return {
        branch: 'explore_factor',
        intent_class: intentClass,
        has_run_analysis_fact: true,
        assistantText: NO_OP_EXPLORE_FACTOR_TEXT,
        suggestedActions: [EXPLAIN_RESULTS_CHIP, WHAT_WOULD_FLIP_CHIP, RUN_PRE_MORTEM_CHIP],
      };
    }
    if (input.freshness === 'stale') {
      return {
        branch: 'explore_factor_stale',
        intent_class: intentClass,
        has_run_analysis_fact: true,
        assistantText: NO_OP_EXPLORE_FACTOR_STALE_TEXT,
        suggestedActions: [RERUN_ANALYSIS_CHIP],
      };
    }
    // freshness === 'unknown' | 'none' — fall through to the ambiguous
    // branch below. We have a fact but cannot prove freshness; offering
    // analysis-exploration chips would risk a silent stale-context UX.
  }

  // Everything else (analytical intent + mutation signal, or no
  // analytical intent + mutation signal): preserve existing copy.
  // The mutation signal means the user genuinely wanted to edit; if
  // V4 produced a no-op, the response already explains why or asks for
  // clarification. Better to leave it than to rewrite from too little
  // signal.
  return {
    branch: 'ambiguous',
    intent_class: intentClass,
    has_run_analysis_fact: hasRunAnalysisFact,
    assistantText: null,
    suggestedActions: [],
  };
}

function mapStageToDecisionStage(stage: MessageTurnPayload['stage']): DecisionStage {
  switch (stage) {
    case 'frame':
      return 'frame';
    case 'analyse':
      return 'evaluate';
    case 'decide':
      return 'decide';
    case 'review':
      return 'optimise';
    default:
      return 'frame';
  }
}

export interface DispatchEditGraphParams {
  readonly payload: MessageTurnPayload;
  readonly requestId: string;
  readonly request: FastifyRequest;
  /** Permissive ingress shape. Adapter inside converts to GraphV3T. */
  readonly graphState: GraphStateIngress;
  /** Permissive ingress shape. Adapter inside converts to V2RunResponseEnvelope. */
  readonly analysisState: AnalysisStateIngress | null;
}

export interface DispatchEditGraphResult {
  readonly response: OlumiResponse;
  readonly commitPerformed: boolean;
  /**
   * V5 finaliser contract: pre-computed structural readiness from the
   * post-edit `appliedGraph`. Surfaced so the response-finaliser in
   * route-v2.ts can stamp `analysis_ready` after composition. Undefined
   * when there is no `appliedGraph` — the canvas is unchanged so the UI's
   * prior `ceeAnalysisReady` remains correct.
   */
  readonly analysisReady?: AnalysisReadyPayload;
  /**
   * V5 state-trust freshness derivation. Edit_graph mutates the graph
   * but does not produce a run_analysis fact, so post-edit freshness is
   * determined by comparing the prior fact chain's recorded
   * graph_hash_at_run against the post-edit graph hash. Expected to be
   * `stale` after an accepted substantive edit, `fresh`/`unknown`/`none`
   * otherwise. Surfaced on `analysis_ready` via response-finaliser.
   */
  readonly freshness?: import('../context/freshness.js').FreshnessDerivation;
  /**
   * Post-edit graph used for label resolution by the central egress
   * sanitiser (sanitiseOlumiResponseForEgress). Null when no graph was
   * applied — sanitiser falls back to prefix-aware generic wording.
   */
  readonly graph: GraphV3T | null;
}

/**
 * Map the V4 internal `SuggestedAction` shape (`{ label, prompt, role,
 * action_type? }`) to the boundary `Action` shape (`{ id, label, message,
 * action_type? }`). The boundary `action_type` enum is closed to v0.7.0
 * V5ActionType values, so internal action_types that don't fit are dropped
 * (the resulting chip still works as a prompt-replay button via `message`).
 */
const BOUNDARY_ACTION_TYPES: ReadonlySet<string> = new Set([
  'run_analysis',
  'set_factor_value',
  'add_constraint',
  'adjust_edge_strength',
  'explain_result',
  'compare_options',
  'what_would_flip',
]);

type BoundaryAction = OlumiResponse['suggested_actions'][number];

function mapSuggestedActionToBoundary(
  action: SuggestedAction,
  index: number,
): BoundaryAction {
  const base: BoundaryAction = {
    id: `edit_graph_action_${index}`,
    label: action.label,
    message: action.prompt,
  };
  if (action.action_type && BOUNDARY_ACTION_TYPES.has(action.action_type)) {
    base.action_type = action.action_type as BoundaryAction['action_type'];
  }
  return base;
}

function chipsFromPendingClarification(
  pending: PendingClarificationState,
): SuggestedAction[] {
  return pending.candidate_labels.map((label) => ({
    label,
    prompt: `Update ${label}.`,
    role: 'facilitator' as const,
  }));
}

// NOTE — pendingProposal accept/cancel chips intentionally NOT rendered.
//
// The V4 `handleEditGraph` reads `invocationInput.pending_proposal`
// (edit-graph.ts around line 1274) to deterministically apply a stored
// proposal on the next turn. The V5 pre-Sonnet dispatcher, however, does
// NOT currently:
//   (a) persist `pendingProposal` to session storage,
//   (b) read it back on the next turn,
//   (c) thread it via `handleEditGraph(..., { invocationInput: { ... } })`.
//
// Without (a)+(b)+(c), an "Apply this change" chip would replay as a plain
// user prompt that the LLM has to re-resolve — not a byte-for-byte replay
// of the original proposal. Presenting non-deterministic accept/cancel
// chips is worse UX than no chips at all (the user expects clicking
// "Apply" to apply exactly the shown proposal).
//
// Until the deterministic-replay plumbing is wired (separate brief), the
// composer simply does not surface pending-proposal chips. The V4
// `assistant_text` still describes the proposal and the user can confirm
// in natural language.

/**
 * Build wire-shaped `suggested_actions` from `EditGraphResult`.
 *
 * Sources merged (not exclusive precedence) and deduped by `message`:
 *   1. `result.suggestedActions` — explicit chips from edit-graph.ts
 *      (clarification chips from `buildClarificationActions`, "Try a
 *      simpler change" / "Start fresh" recovery chips, "Re-run analysis"
 *      rerun_recommended chip).
 *   2. `result.pendingClarification` candidate-label chips — defensively
 *      included so a result that carries pendingClarification without
 *      explicit actions still surfaces chips.
 *
 * `pendingProposal` accept/cancel chips are intentionally NOT rendered —
 * see comment on `chipsFromPendingProposal` removal.
 *
 * First occurrence wins on dedupe, so explicit `suggestedActions` take
 * priority over pending-state-derived chips when prompts collide.
 */
function buildBoundarySuggestedActions(
  result: EditGraphResult,
): BoundaryAction[] {
  const collected: SuggestedAction[] = [];

  if (result.suggestedActions && result.suggestedActions.length > 0) {
    collected.push(...result.suggestedActions);
  }
  if (result.pendingClarification) {
    collected.push(...chipsFromPendingClarification(result.pendingClarification));
  }

  // Dedupe by message.
  const seen = new Set<string>();
  const unique: SuggestedAction[] = [];
  for (const action of collected) {
    if (seen.has(action.prompt)) continue;
    seen.add(action.prompt);
    unique.push(action);
  }

  return unique.map((a, i) => mapSuggestedActionToBoundary(a, i));
}

/**
 * Surface rejection metadata on the wire as a boundary `error` block.
 *
 * The internal V4 `GraphPatchBlock` uses `data.status: 'rejected'` with
 * rejection.code/reason/attempts. The boundary `graph_patch` block schema
 * has no rejected status (only `'applied' | 'noop'`) and a narrow
 * `operation` enum, so V4 rejection blocks cannot pass through unmodified.
 *
 * Mapping rejection → `error` block (with `details` carrying the rejection
 * code AND the specific structural violation codes) preserves the
 * rejection signal without widening the boundary schema. The UI can read
 * `details.rejection_code` and `details.violation_codes` to render a
 * specific recovery affordance.
 *
 * Two rejection-emit paths exist in the V4 handler:
 *   1. `buildRejectionResult` (final-attempt repair exhaustion / max-ops /
 *      budget) → returns `result.blocks: [GraphPatchBlock with rejection]`.
 *   2. Structural-violation immediate reject for structural intents
 *      (edit-graph.ts:1950) → returns `result.blocks: []`. Violation codes
 *      live on `result.diagnostics.validation_violation_codes` and the
 *      umbrella code on `result.diagnostics.failure_code`.
 *
 * Both paths are handled here so a structural-validation rejection (e.g.
 * the new OPTION_NO_FACTOR_EDGES code) reaches the wire even when the V4
 * block is absent.
 *
 * Successful (non-rejected) edits return `[]` — the V4 GraphPatchBlock
 * with `operations: PatchOperation[]` does not fit the narrow boundary
 * `graph_patch` operation enum, and the applied graph reaches the UI via
 * `analysis_ready` + the persisted scenarios.graph row.
 *
 * COMPATIBILITY NOTE on `error_code: 'INTERNAL_ERROR'` (P0 fix, 2026-05):
 * `BoundaryErrorCode` is a closed enum (olumi-schemas/src/boundary/
 * error-codes.ts; "extend additively, do not rename") with no recoverable-
 * rejection member, so we ship `INTERNAL_ERROR` + `severity: 'warn'` as a
 * documented short-term combination. The severity-aware UI router treats
 * the warn-level block as advisory and renders the friendly assistant_text
 * + chips. Operators read `details.rejection_code` for the specific cause.
 *
 * TODO(schemas): additive bump to introduce `RECOVERABLE_EDIT_REJECTION`
 * (or equivalent) so the wire signal is self-describing without relying
 * on severity-aware parsing. Tracked separately; coordinate with UI.
 */
function buildBoundaryBlocks(result: EditGraphResult): OlumiResponse['blocks'] {
  if (!result.wasRejected) return [];

  // Path 1: V4 GraphPatchBlock with rejection metadata (from buildRejectionResult).
  const rejectionBlock = result.blocks.find(
    (b) => b.block_type === 'graph_patch'
      && (b.data as GraphPatchBlockData).status === 'rejected',
  );

  if (rejectionBlock) {
    const data = rejectionBlock.data as GraphPatchBlockData;
    const rej = data.rejection;
    if (rej) {
      // Stable codes only on the wire. Raw validator detail (rej.reason
      // text, failure messages, free-form descriptions) stays in server
      // logs and never crosses the boundary. The UI renders specific
      // recovery affordances from the codes, not the text.
      const details: Record<string, unknown> = { source: 'edit_graph' };
      if (rej.code) details.rejection_code = rej.code;
      if (rej.plot_code) details.plot_code = rej.plot_code;
      if (rej.attempts != null) details.attempts = rej.attempts;
      // Promote diagnostics violation_codes when present so OPTION_NO_FACTOR_EDGES
      // and similar specific codes reach the wire alongside the umbrella rejection_code.
      const violationCodes = result.diagnostics?.validation_violation_codes;
      if (violationCodes && violationCodes.length > 0) {
        details.violation_codes = violationCodes;
      }
      return [
        {
          type: 'error',
          error_code: 'INTERNAL_ERROR',
          severity: 'warn',
          details,
        },
      ];
    }
  }

  // Path 2: structural-violation immediate reject — V4 returns blocks: [] but
  // surfaces the failure on diagnostics. Synthesize an error block so the
  // wire still carries rejection_code + violation_codes (e.g. for the
  // OPTION_NO_FACTOR_EDGES rule).
  //
  // Stable codes only — `failure_message` may contain raw validator output
  // ("Option opt_x has no outbound edge to a factor — cannot be analysed")
  // which we do NOT want on the wire. Logs retain it via diagnostics; the
  // wire surface is just `rejection_code` + `failure_branch` + optional
  // `violation_codes`.
  const diag = result.diagnostics;
  if (diag?.failure_code || (diag?.validation_violation_codes && diag.validation_violation_codes.length > 0)) {
    const details: Record<string, unknown> = { source: 'edit_graph' };
    if (diag.failure_code) details.rejection_code = diag.failure_code;
    if (diag.failure_branch) details.failure_branch = diag.failure_branch;
    if (diag.validation_violation_codes && diag.validation_violation_codes.length > 0) {
      details.violation_codes = diag.validation_violation_codes;
    }
    return [
      {
        type: 'error',
        error_code: 'INTERNAL_ERROR',
        severity: 'warn',
        details,
      },
    ];
  }

  return [];
}

function editResultToOlumiResponse(
  result: EditGraphResult,
  payload: MessageTurnPayload,
): OlumiResponse {
  const fallback = result.wasRejected
    ? 'The proposed edit was rejected.'
    : result.appliedGraph
      ? `Applied edit. Graph now has ${result.appliedGraph.nodes?.length ?? 0} nodes and ${result.appliedGraph.edges?.length ?? 0} edges.`
      : 'Edit processed.';

  // V5 finaliser contract: this composer must NOT set `analysis_ready`. The
  // dispatcher computes structural readiness from `editResult.appliedGraph`
  // and surfaces it on `DispatchEditGraphResult.analysisReady`; the
  // response-finaliser stamps it onto the wire envelope after composition.
  return {
    response_version: 2,
    assistant_text: result.assistantText ?? fallback,
    blocks: buildBoundaryBlocks(result),
    suggested_actions: buildBoundarySuggestedActions(result),
    insights: [],
    stage_indicator: payload.stage,
  };
}

/**
 * Adapter: permissive `GraphStateIngress` (v0.7.0 wire shape) → strict
 * `GraphV3T` (V4 internal type) for `ConversationContext.graph`.
 *
 * Ingress has already been Zod-validated by `parseRequestExtensions`, but its
 * schema uses `.passthrough()` and weaker field types than GraphV3. Rather
 * than `as unknown as` (erasing type safety), this adapter runs `GraphV3`
 * through `safeParse`. Outcomes:
 *   - parse success → return the parsed GraphV3T (nodes/edges preserved).
 *   - parse failure → construct a minimal GraphV3T-compatible value from
 *     the ingress fields `handleEditGraph` actually reads (nodes[id,kind,
 *     label], edges[from,to]). Failure is logged at warn so the operator
 *     sees the drift; the edit still proceeds because handleEditGraph
 *     internally re-casts to a weaker structural type (see edit-graph.ts
 *     lines 1662/1712/1766).
 *
 * Callers of this module MUST NOT apply `as unknown as GraphV3T` themselves
 * — see the banner comment in src/orchestrator-v5/boundary/request-extensions.ts.
 */
/**
 * V5 A4 Commit 6 — strict parse signal for the deterministic classifier
 * gate. Callers that need to know whether the returned graph is the
 * canonical strict-parsed form vs the structural fallback (with inert
 * default edge fields) can use `graphStateToGraphV3WithParseResult`.
 * The deterministic add_risk clarification path runs only against strictly
 * parsed graphs so non-canonical ingress keeps the pre-existing LLM path.
 */
function graphStateToGraphV3WithParseResult(
  graphState: GraphStateIngress,
  requestId: string,
): { graph: GraphV3T; strict: boolean } {
  const parsed = GraphV3.safeParse(graphState);
  if (parsed.success) {
    return { graph: parsed.data, strict: true };
  }
  return { graph: buildStructuralFallback(graphState, requestId, parsed.error), strict: false };
}
function buildStructuralFallback(
  graphState: GraphStateIngress,
  requestId: string,
  error: import('zod').ZodError,
): GraphV3T {
  log.warn(
    {
      request_id: requestId,
      issue_count: error.issues.length,
      first_issue_path: error.issues[0]?.path.join('.') ?? null,
    },
    'V5 edit_graph dispatch — graph ingress did not pass strict GraphV3 parse; using structural fallback',
  );
  // Structural fallback: build a GraphV3T-shaped object from the ingress
  // fields handleEditGraph actually reads. Required GraphV3 fields that
  // the ingress does NOT carry (edge.effect_direction, edge.strength
  // object, edge.exists_probability) are stamped with inert defaults so
  // the returned value satisfies GraphV3T's type without fabricating
  // semantically meaningful values. handleEditGraph re-casts graph
  // internally (edit-graph.ts:1662/1712/1766 cast to a weaker
  // { nodes: Array<{id,kind?}>, edges?: unknown[] } type), so these
  // defaults never influence the edit logic itself.
  const fallbackNodes: GraphV3T['nodes'] = graphState.nodes.map((n) => {
    const node = n as { id: string; kind: string; label?: string };
    return {
      id: node.id,
      kind: node.kind as GraphV3T['nodes'][number]['kind'],
      label: node.label ?? node.id,
    };
  });
  const fallbackEdges: GraphV3T['edges'] = graphState.edges.map((e) => {
    const edge = e as { from: string; to: string };
    return {
      from: edge.from,
      to: edge.to,
      strength: { mean: 0, std: 0 },
      exists_probability: 1,
      effect_direction: 'positive',
    };
  });
  return { nodes: fallbackNodes, edges: fallbackEdges };
}

/**
 * Adapter: permissive `AnalysisStateIngress` → `V2RunResponseEnvelope`.
 *
 * Mirrors `coerceIngressAnalysis` in turn-executor.ts (the existing V5
 * convention for ingress→V4 envelope conversion). Only `analysis_status` is
 * structurally required in the ingress schema; everything else is
 * passthrough. We fill `meta` and normalise `results` so handleEditGraph's
 * downstream consumers receive the shape they expect without this module
 * applying a type-erasing `as unknown as` cast.
 */
// `loadMostRecentPendingActions` lives in `build-turn-context.ts` so the
// state-write-invariant pre-push guard (SessionStore imports restricted to
// session/, commit.ts, build-turn-context.ts) stays satisfied. The
// pre-LLM intercept below calls it directly.

function analysisIngressToV2Envelope(a: AnalysisStateIngress): V2RunResponseEnvelope {
  const raw = a as AnalysisStateIngress & {
    meta?: V2RunResponseEnvelope['meta'];
    results?: unknown;
    [k: string]: unknown;
  };
  const results: unknown[] = Array.isArray(raw.results)
    ? raw.results
    : raw.results && typeof raw.results === 'object'
      ? Object.values(raw.results as Record<string, unknown>)
      : [];
  return {
    ...raw,
    meta: raw.meta ?? { seed_used: 0, n_samples: 0, response_hash: '' },
    results,
  };
}

/**
 * V5-PERSIST-FIX-01 (H1) — merge the applied edit back onto the
 * server-authoritative persisted graph shape before persistence.
 *
 * Why this exists: `GraphV3.safeParse` strips top-level `goal_node_id`
 * and `options[]` (neither is declared on GraphV3), and `NodeV3` strips
 * undeclared `node.data`. The edit pipeline parses its ingress through
 * GraphV3, so `appliedGraph` can NEVER carry those fields — committing
 * it wholesale replaced the rich draft-persisted `scenarios.graph` with
 * a stripped `{nodes, edges}` shape. Fleet evidence at investigation
 * time: 43/43 scenarios with an applied edit_graph fact had lost BOTH
 * `goal_node_id` and `options[]`.
 *
 * Merge base precedence (deliberate, per V5-PERSIST-FIX-01):
 *   1. The PERSISTED `scenarios.graph` (pre-edit) is the base. NOT the
 *      ingress echo: the real DGAI echo cannot carry `options[]` /
 *      `goal_node_id` (the draft wire block omits them), so an
 *      ingress-base merge would pass synthetic tests while live edits
 *      still lose both fields. This is the one caveat of the D1
 *      `apply-graph-mutation.ts` merge-back we must NOT copy.
 *   2. `appliedGraph` wins for what the edit actually changed: `nodes`
 *      and `edges` (every edit_graph operation — add/update/remove
 *      node/edge, incl. the constraint shortcut which writes
 *      `goal_constraints` onto the goal NODE — lives inside those two
 *      arrays). Top-level `goal_constraints` is NOT overlaid: no edit
 *      operation writes it, so the base keeps its own (D1
 *      `add_constraint` owns that field).
 *   3. Everything else top-level (`goal_node_id`, `options[]`, `meta`,
 *      `schema_version`, draft-pipeline fields, …) is preserved from
 *      the base verbatim. Nothing is invented.
 *   4. Option deletion is honoured, not resurrected: an `options[]`
 *      entry is dropped IFF its id was a node id in the base graph and
 *      that node is absent from `appliedGraph.nodes` (i.e. this edit
 *      provably removed the option node). Entries whose ids never
 *      matched a base node are preserved (fail-open to preservation).
 *
 * Fallback to the RAW ingress graph (the D1-style merge) covers the two
 * cases the dispatcher legitimately passes — NOT a degraded read. A
 * degraded/unavailable persisted read FAILS CLOSED upstream in
 * `dispatchEditGraph` (the strict loader throws → retryable 500) and
 * never reaches this helper, so "unavailable" is deliberately absent here:
 *   - `persistedBase === null` — a GENUINELY-empty `scenarios.graph` (the
 *     strict read succeeded and returned no graph). There is nothing to
 *     lose; the ingress-merged graph is the first valid write.
 *   - non-null but structurally unusable (not an object / missing
 *     nodes+edges arrays) — a malformed-but-READABLE persisted graph. We
 *     deliberately HEAL FORWARD via the ingress base (commit a valid
 *     shape) rather than fail closed: a 500 on permanently-malformed data
 *     would trap the user with no in-app recovery, and a malformed graph
 *     holds no parseable rich top-level fields to preserve, so this is not
 *     the H1 corruption class (that shape keeps both arrays → is "usable"
 *     → merged onto, not replaced). This sub-case is logged at WARN.
 *     (A future tightening could fail closed here too for maximum
 *     fail-closed semantics — deferred; see Codex review note.)
 * Either way the merge is strictly better than the pre-fix stripped
 * commit and only loses fields the server never validly had.
 *
 * Nested `node.data` (e.g. `data.interventions`) is NOT addressed here:
 * node content is owned by `appliedGraph`, whose nodes were already
 * NodeV3-parsed at ingress. That remains a prompt/schema-lane issue.
 *
 * @internal Exported for testing.
 */
export function mergeAppliedGraphForPersistence(args: {
  readonly appliedGraph: GraphV3T;
  /**
   * Raw persisted `scenarios.graph` (pre-edit), or null for a
   * GENUINELY-empty scenario. A degraded read never reaches here — it
   * fails closed in `dispatchEditGraph` before this helper is called.
   */
  readonly persistedBase: unknown;
  /** Raw request/reloaded ingress graph — fallback base only. */
  readonly ingressBase: GraphStateIngress;
  readonly requestId: string;
  readonly scenarioId: string;
}): Record<string, unknown> {
  const { appliedGraph, persistedBase, ingressBase, requestId, scenarioId } = args;
  const persistedUsable =
    persistedBase !== null &&
    persistedBase !== undefined &&
    typeof persistedBase === 'object' &&
    !Array.isArray(persistedBase) &&
    Array.isArray((persistedBase as Record<string, unknown>).nodes) &&
    Array.isArray((persistedBase as Record<string, unknown>).edges);
  // A non-null persisted base that is NOT usable = a malformed-but-readable
  // scenarios.graph. We heal forward via ingress (see docstring) but flag it
  // loudly so the anomaly is never silent — it should be vanishingly rare.
  const persistedMalformed =
    persistedBase !== null && persistedBase !== undefined && !persistedUsable;
  const base = (
    persistedUsable ? persistedBase : ingressBase
  ) as Record<string, unknown>;

  const merged: Record<string, unknown> = {
    ...base,
    nodes: appliedGraph.nodes,
    edges: appliedGraph.edges,
  };

  // Precedence rule 4 — drop options[] entries provably deleted by THIS
  // edit (id was a base node, node gone from the applied graph). All
  // other entries are preserved byte-for-byte.
  const baseOptions = base.options;
  let optionsDropped = 0;
  if (Array.isArray(baseOptions)) {
    const baseNodeIds = new Set(
      (base.nodes as unknown[])
        .map((n) => (n && typeof n === 'object' ? (n as { id?: unknown }).id : undefined))
        .filter((id): id is string => typeof id === 'string'),
    );
    const appliedNodeIds = new Set(appliedGraph.nodes.map((n) => n.id));
    const survivors = baseOptions.filter((opt) => {
      const id =
        opt && typeof opt === 'object' ? (opt as { id?: unknown }).id : undefined;
      if (typeof id !== 'string') return true;
      return !(baseNodeIds.has(id) && !appliedNodeIds.has(id));
    });
    optionsDropped = baseOptions.length - survivors.length;
    if (optionsDropped > 0) {
      merged.options = survivors;
    }
  }

  const logPayload = {
    event: 'v5.edit_graph.persist_merge_back',
    request_id: requestId,
    scenario_id: scenarioId,
    base: persistedUsable
      ? 'persisted'
      : persistedMalformed
        ? 'ingress_fallback_malformed_base'
        : 'ingress_fallback_genuine_empty',
    base_has_goal_node_id: typeof base.goal_node_id === 'string',
    base_options_count: Array.isArray(baseOptions) ? baseOptions.length : null,
    options_dropped_as_deleted: optionsDropped,
    applied_node_count: appliedGraph.nodes.length,
    applied_edge_count: appliedGraph.edges.length,
  };
  if (persistedMalformed) {
    log.warn(
      logPayload,
      'V5 edit_graph — persisted scenarios.graph was non-null but structurally unusable; healing forward via the ingress base (no rich top-level fields recoverable from a malformed graph)',
    );
  } else {
    log.info(
      logPayload,
      'V5 edit_graph — applied mutation merged onto persisted graph shape for persistence',
    );
  }

  return merged;
}

/**
 * ROADMAP 1.33 — edit-lane conversation starvation.
 *
 * Convert the same 5-turn conversation-slice projection
 * `context-pack-assembler.ts`'s `projectConversation` builds for the
 * coaching/draft LLM path into `ConversationContext.messages` (prior turns
 * ONLY — the current turn's `payload.message` is sent separately as the
 * edit LLM's `userMessage`, see `edit-graph.ts`, so it is deliberately not
 * appended here).
 *
 * `recentTurns` arrives most-recent-first (context-pack-assembler
 * convention); reversed to chronological order so the rendered section
 * reads as a narrative. Per-turn `user_message`/`assistant_message` are
 * already length-capped at persist time (`CONVERSATION_TEXT_CAP` in
 * commit.ts) — this function does no further per-message bounding, only
 * ordering. Overall-section bounding + disclosed truncation happens at
 * render time in `serialiseEditContextForLLM`.
 */
function conversationSliceToMessages(
  recentTurns: readonly { user_message: string | null; assistant_message: string | null }[],
): ConversationMessage[] {
  const chronological = [...recentTurns].reverse();
  const messages: ConversationMessage[] = [];
  for (const turn of chronological) {
    if (turn.user_message) messages.push({ role: 'user', content: turn.user_message });
    if (turn.assistant_message) messages.push({ role: 'assistant', content: turn.assistant_message });
  }
  return messages;
}

export async function dispatchEditGraph(
  params: DispatchEditGraphParams,
): Promise<DispatchEditGraphResult> {
  const { payload, requestId, graphState, analysisState } = params;
  const startedAt = Date.now();

  const { graph: parsedGraph, strict: graphStrictlyCanonical } =
    graphStateToGraphV3WithParseResult(graphState, requestId);
  // ROADMAP 1.33: feed the same 5-turn conversation slice the
  // coaching/draft LLM path already builds into the edit-LLM request, so a
  // user who clarified details over several turns then asks for an edit
  // gets an edit that sees what they already established (Brief G).
  // Read failures degrade to an empty slice (see
  // `loadRecentConversationTurns`) — never fail the turn over a
  // conversation-history read.
  const priorConversationTurns = await loadRecentConversationTurns(payload.scenario_id, requestId);
  const { recent_turns: recentConversationSlice } = projectConversation(priorConversationTurns, false);
  const context: ConversationContext = {
    graph: parsedGraph,
    analysis_response: analysisState ? analysisIngressToV2Envelope(analysisState) : null,
    framing: { stage: mapStageToDecisionStage(payload.stage) },
    messages: conversationSliceToMessages(recentConversationSlice),
    scenario_id: payload.scenario_id,
  };

  const adapter = getAdapter('edit_graph');

  let editResult: EditGraphResult;
  // Track the deterministic clarification path independently so
  // llm_calls_used records 0 when no adapter call was made.
  let deterministicAddRiskAttempted = false;
  // V5 P0 staging-smoke follow-up (PR #212): set true when the
  // pre-LLM proposal-continuation intercept emits Stage 1 / Stage 2
  // chips. Read by the downstream no-op recovery layer's
  // `decideNoOpRecovery` call to suppress its parallel proposal
  // branches so the wire response carries one chip set, not two.
  let proposalEarlyEmitted = false;
  // PR #216 review follow-up: set true when the pre-LLM intercept
  // already emitted a `V5ProposalContinuationInvalidated` event for an
  // expired / diverged pending. The recovery block re-runs the same
  // resume gate against the same most-recent pending and would emit a
  // SECOND identical invalidation when `handleEditGraph` no-ops after
  // the intercept rejected — double-counting the metric. The recovery
  // block reads this to skip its own invalidation emit. It does NOT
  // suppress a recovery-only invalidation (the case where the
  // intercept's graph-hash compute failed but the recovery's
  // succeeded) because that path leaves this flag false.
  let interceptEmittedInvalidation = false;
  // PR #216 round-3 review (SHOULD-FIX): refreshed proposed_concept
  // pending action to persist with the commit. Declared at function
  // scope so the pre-LLM intercept can build it directly from the
  // concept it just resolved — making the early-emit refresh
  // independent of the LATER `buildTurnContext` pending read. If that
  // second read degrades (returns no pending / throws), the early-emit
  // response is still authoritative AND its pending is still refreshed,
  // so the next Stage 1 → Stage 2 click resumes. Stays null on paths
  // that emit no proposal; the commit then falls back to chip-derived
  // pending actions.
  let proposalPendingForCommit:
    | import('../session/pending-action.js').PendingAction
    | null = null;

  // R7 — single per-turn observability event. Each branch fills the accumulator
  // as it resolves; `emitEditTurnEventOnce` is invoked from the commit-try
  // `finally` (covers both returns) and from the handler-threw catch (covers the
  // rethrow), guarded so it fires exactly once. The emit is isolated in its own
  // try/catch so a telemetry fault can never mask the handler's return/error.
  const ev: EditTurnEventAccumulator = {
    scenario_id: payload.scenario_id,
    turn_id: payload.turn_id,
    graph_nodes_before: parsedGraph.nodes.length,
    graph_edges_before: parsedGraph.edges.length,
  };
  try {
    const meta = getSystemPromptMeta('edit_graph');
    ev.prompt_source = meta.source;
    ev.prompt_key = meta.promptId ?? null;
    ev.prompt_task_id = meta.taskId;
    ev.prompt_version = meta.version ?? null;
    ev.prompt_hash = meta.prompt_hash ?? null;
    ev.prompt_fallback_used = meta.source === 'default';
  } catch {
    // Prompt-meta is best-effort; leave the prompt_* fields at their defaults.
  }
  let eventEmitted = false;
  const emitEditTurnEventOnce = (): void => {
    if (eventEmitted) return;
    eventEmitted = true;
    try {
      ev.latency_ms = Date.now() - startedAt;
      emit(TelemetryEvents.V5EditGraphTurn, finaliseEditTurnEvent(ev));
    } catch (telemetryErr) {
      // R7: a telemetry fault must never replace the handler's original return
      // or rethrown error — swallow locally and degrade to a log.
      log.warn(
        {
          request_id: requestId,
          scenario_id: payload.scenario_id,
          err: telemetryErr instanceof Error ? telemetryErr.message : String(telemetryErr),
        },
        'V5 edit_graph turn-event emit failed; continuing',
      );
    }
  };

  try {
    // V5 A4 — deterministic clarification intercept. Pre-LLM classifier
    // catches high-confidence bare "add X as a risk" patterns, but the
    // request does not state what drives the risk. Creating a risk node
    // would require inventing graph structure, so this path asks for the
    // missing driver and intentionally leaves the graph unchanged.
    // The deterministic classifier MUST NOT run against a structural
    // fallback graph. When the ingress did not pass strict GraphV3 parse,
    // fall through to the LLM path unconditionally (handleEditGraph re-casts
    // internally and is the pre-existing behaviour for non-canonical ingress).
    const classified = graphStrictlyCanonical
      ? classifyAddRiskIntent(payload.message, parsedGraph)
      : ({ intent: 'llm_required' } as const);

    if (classified.intent === 'add_risk') {
      deterministicAddRiskAttempted = true;
      // Pre-LLM preflight: would adding this risk push the model past
      // its analysis limits? If so, return a structured rejection now
      // and skip the LLM. The LLM call would otherwise spend 16–18s
      // before the post-mutation validator rejected with the same
      // limit code. Specific recovery copy + executable chips give the
      // user a real next step instead of generic failure copy.
      const preflight = wouldExceedAddRiskLimits(parsedGraph);
      if (preflight.over_node_limit || preflight.over_edge_limit) {
        const rejectionCode = preflight.over_edge_limit
          ? 'EDGE_LIMIT_EXCEEDED_PREFLIGHT'
          : 'NODE_LIMIT_EXCEEDED_PREFLIGHT';
        emit(TelemetryEvents.EditGraphPreflightSkippedLlm, {
          request_id: requestId,
          scenario_id: payload.scenario_id,
          reason: preflight.over_edge_limit ? 'edge_limit' : 'node_limit',
          projected_nodes: preflight.projected_nodes,
          projected_edges: preflight.projected_edges,
          node_limit: preflight.node_limit,
          edge_limit: preflight.edge_limit,
          label_length: classified.label.length,
        });
        // Recovery surface: assistant text describes the next steps
        // inline. We do NOT emit prompt-replay chips here — they
        // would have been dishonest about what clicking does (no
        // deterministic rebuild or replace flow exists in this
        // tranche). The brief contract is "every chip must be
        // actionable"; rather than rename or fake actionability we
        // omit chips entirely from this rejection path. The user
        // types their next intent in their own words.
        editResult = {
          blocks: [],
          assistantText:
            "I can't add another risk without making the model too complex to analyse reliably. " +
            "Tell me how to simplify the model so we can fit this in, or which existing risk to replace with " +
            `'${classified.label}'.`,
          latencyMs: Date.now() - startedAt,
          appliedGraph: null,
          wasRejected: true,
          diagnostics: {
            classified_intent: 'structural',
            instruction_mode_applied: 'structural_default',
            edit_instruction_preview: classified.label.slice(0, 80),
            graph_context_node_count: preflight.current_nodes,
            graph_context_edge_count: preflight.current_edges,
            operations_proposed_count: 0,
            operations_proposed_types: [],
            validation_outcome: 'preflight_rejected',
            validation_violation_codes: [
              preflight.over_edge_limit ? 'EDGE_LIMIT_EXCEEDED' : 'NODE_LIMIT_EXCEEDED',
            ],
            recovery_path_chosen: 'preflight_rejection',
            conversational_state_summary: null,
            target_resolution: null,
            resolution_mode: null,
            proposal_returned: false,
            branch_taken: 'rejection',
            branch_reason: 'add_risk_preflight_limit_exceeded',
            failure_branch: 'preflight',
            failure_code: rejectionCode,
            failure_message: preflight.over_edge_limit
              ? `Adding the risk would project ${preflight.projected_edges} edges (limit ${preflight.edge_limit}).`
              : `Adding the risk would project ${preflight.projected_nodes} nodes (limit ${preflight.node_limit}).`,
          },
          // No chips on this rejection path — the suggestions are
          // surfaced inline in assistant_text. See the assistantText
          // construction above for the rationale.
          suggestedActions: [],
        };
        log.info(
          {
            request_id: requestId,
            scenario_id: payload.scenario_id,
            latency_ms: editResult.latencyMs,
            reason: rejectionCode,
            projected_nodes: preflight.projected_nodes,
            projected_edges: preflight.projected_edges,
          },
          'V5 edit_graph add_risk preflight blocked LLM call (limit would be exceeded)',
        );
      } else {
        editResult = {
          blocks: [],
          assistantText: buildAddRiskClarification(classified.label),
          latencyMs: Date.now() - startedAt,
          appliedGraph: null,
          wasRejected: false,
        };
        log.info(
          {
            request_id: requestId,
            scenario_id: payload.scenario_id,
            latency_ms: editResult.latencyMs,
          },
          'V5 edit_graph add_risk clarification returned without graph mutation',
        );
        emit(TelemetryEvents.V5EditGraphAddRiskClarified, {
          request_id: requestId,
          scenario_id: payload.scenario_id,
          latency_ms: editResult.latencyMs,
          label_length: classified.label.length,
        });
      }
    } else {
      // V5 P0 proposal-memory continuation — pre-LLM intercept.
      //
      // Sits between the add-risk fast path and the LLM call so the
      // Stage 1 (agreement) and Stage 2 (add-as-factor) branches emit
      // deterministically without paying the ~16s handleEditGraph LLM
      // round-trip. Add-risk still wins (we only reach here when the
      // add-risk classifier did not match) so the existing fast path
      // is unchanged.
      //
      // Pending actions are loaded inline via the SessionStore factory
      // rather than reusing buildTurnContext to avoid pulling in the
      // full prior_facts + scenario_state load on every edit_graph
      // dispatch. On factory failure the intercept silently returns
      // null and the LLM path runs normally.
      const earlyPending = await loadMostRecentPendingActions(
        payload.scenario_id,
        requestId,
      );
      // Resolve the proposal-resume gate via the shared helper. It runs
      // the no-pending → wall-clock-TTL → graph-hash ladder in that
      // order and either returns a Stage 1 / Stage 2 decision or a
      // typed rejection reason. The wall-clock TTL mirrors the
      // `isExpired` semantics used by tryClarificationResume /
      // tryShortConfirmResume so all three resumers agree.
      let earlyCurrentGraphHash: string | null = null;
      try {
        earlyCurrentGraphHash = computeAnalysisAffectingGraphHash(
          graphState as GraphStateIngress | null | undefined,
        );
      } catch {
        earlyCurrentGraphHash = null;
      }
      const resumeOutcome = resolveProposalResume({
        message: payload.message,
        pendingActions: earlyPending,
        nodes: parsedGraph.nodes,
        currentGraphHash: earlyCurrentGraphHash,
        nowMs: Date.now(),
      });
      if (resumeOutcome.rejection === 'expired_wall' || resumeOutcome.rejection === 'graph_hash_changed') {
        emit(TelemetryEvents.V5ProposalContinuationInvalidated, {
          request_id: requestId,
          scenario_id: payload.scenario_id,
          reason: resumeOutcome.rejection,
        });
        interceptEmittedInvalidation = true;
      } else if (
        resumeOutcome.rejection === null
        && resumeOutcome.decision === null
      ) {
        // Lane 22 — the pre-LLM gate previously declined SILENTLY here: a
        // live, valid pending proposal existed but the agreement matcher
        // said no-match, and nothing was emitted (the live 2026-07-07 miss
        // was invisible until the post-LLM zero-operations sub-case). Emit
        // the no-match outcome from the gate itself so the matcher's miss
        // rate is measurable. `no_pending` (the steady state on most
        // turns) still emits nothing.
        emit(TelemetryEvents.V5ProposalContinuationResumed, {
          request_id: requestId,
          scenario_id: payload.scenario_id,
          outcome: 'no_agreement',
          pre_llm: true,
        });
      }
      const earlyDecision = resumeOutcome.decision;
      if (earlyDecision !== null) {
        editResult = {
          blocks: [],
          assistantText: earlyDecision.assistantText,
          latencyMs: Date.now() - startedAt,
          appliedGraph: null,
          wasRejected: false,
          suggestedActions: earlyDecision.suggestedActions.map((a) => ({
            label: a.label,
            prompt: a.message,
            role: 'facilitator' as const,
          })),
        };
        proposalEarlyEmitted = true;
        // PR #216 round-3 review (SHOULD-FIX): refresh the pending
        // action HERE, from the concept the intercept just resolved
        // (`earlyPending` + `earlyCurrentGraphHash`), rather than
        // relying on the later `buildTurnContext` pending read in the
        // recovery block. The gate already passed (decision !== null →
        // not expired, not diverged), so the concept is safe to carry
        // forward. This keeps the Stage 1 → Stage 2 continuation
        // resumable even if that second read degrades. The graph was
        // not mutated on the early-emit (no-op) path, so the current
        // ingress graph hash is the right precondition.
        const earlyConcept = findProposedConceptAction(earlyPending);
        if (earlyConcept !== null) {
          proposalPendingForCommit = buildProposalPendingAction({
            concept: earlyConcept.concept,
            preferred_kind: earlyConcept.preferred_kind,
            scenario_id: payload.scenario_id,
            emitted_at_iso: new Date().toISOString(),
            ...(earlyCurrentGraphHash ? { graph_hash: earlyCurrentGraphHash } : {}),
          });
        }
        emit(TelemetryEvents.V5ProposalContinuationResumed, {
          request_id: requestId,
          scenario_id: payload.scenario_id,
          outcome: earlyDecision.stage === 'stage_two' ? 'stage_two' : 'stage_one',
          pre_llm: true,
        });
        log.info(
          {
            request_id: requestId,
            scenario_id: payload.scenario_id,
            stage: earlyDecision.stage,
            latency_ms: editResult.latencyMs,
          },
          'V5 edit_graph proposal-continuation intercept emitted deterministic response without LLM call',
        );
      } else {
        editResult = await handleEditGraph(
          context,
          payload.message,
          adapter,
          requestId,
          payload.turn_id,
        );
      }
    }
  } catch (err) {
    log.error(
      {
        request_id: requestId,
        scenario_id: payload.scenario_id,
        err: err instanceof Error ? { name: err.name, message: err.message } : { message: String(err) },
      },
      'V5 edit_graph dispatch — handler threw',
    );
    // R7: the handler-threw path is the only exit that does not reach the
    // commit-try `finally`. Record the structured failure code (no message
    // parsing — see classifyThrownFailureCode) and emit before rethrowing.
    ev.outcome = 'error';
    ev.failure_code = classifyThrownFailureCode(err);
    emitEditTurnEventOnce();
    throw err;
  }

  // R7 (NB-1): outer guard around the whole response-assembly + commit region.
  // The handler-threw path is covered by the catch above; the success/commit
  // returns are covered by the commit-try `finally` below. This outer `finally`
  // closes the remaining gap — an unexpected throw in the assembly region
  // (editResultToOlumiResponse / no-op recovery / computeStructuralReadiness)
  // before the commit-try runs — so a turn still emits exactly one event before
  // the exception propagates. There is intentionally NO catch here: the
  // original error is never caught or masked. `eventEmitted` makes the emit
  // idempotent, so the success path (inner commit-`finally`, then this outer
  // `finally`) emits once, not twice.
  try {
  let response = editResultToOlumiResponse(editResult, payload);

  // V5 H5 (Codex round-2 P1) — unified mutation predicate.
  // `isSuccessfulAppliedMutation()` is the single source of truth
  // for "did the mutation truly apply?". It requires
  // wasRejected=false + operations.length > 0 + appliedGraph present.
  // Computed ONCE here and threaded through every downstream check
  // that previously inspected `editResult.appliedGraph` directly
  // (false-success rewrite, analysisReady, freshness postEditGraph,
  // graphForCommit, returned graph). Closes the asymmetry where
  // `appliedGraph + empty operations` (impossible-but-not-enforced
  // shape) would block fact persistence but still produce wire-side
  // success effects (analysis_ready stamped, freshness derived
  // against the unpersisted graph, response.graph returned to
  // route-v2).
  const successfulAppliedMutation = isSuccessfulAppliedMutation(editResult);

  // R7: populate the per-turn event from the completed handler result. The
  // no-op recovery layer below refines `ev.branch`; the commit-try `finally`
  // emits exactly once.
  Object.assign(
    ev,
    deriveEditTurnFieldsFromResult(editResult, {
      successfulAppliedMutation,
      graphNodesBefore: ev.graph_nodes_before,
      graphEdgesBefore: ev.graph_edges_before,
      proposalEarlyEmitted,
      // R7 (NB-2 follow-on): the deterministic add-risk path is either a
      // preflight rejection (→ 'rejected', wasRejected wins) or a clarification
      // (→ 'clarify'); both set this flag, distinguished by wasRejected.
      deterministicClarify: deterministicAddRiskAttempted,
    }),
  );

  // V5 Context Management v1 — derive freshness + load prior facts
  // EARLIER than the original (Codex round-2 P1) position, so the no-op
  // recovery layer below can read `freshness` and `priorFactsForRecovery`
  // without re-loading state. The block's I/O surface and telemetry are
  // unchanged from the original position; only the order moved.
  //
  // On error the catch branch synthesises a `derivation_failed` verdict
  // and leaves `priorFactsForRecovery` empty so the no-op recovery falls
  // back to the bland fallback rather than re-throwing.
  // V5-PERSIST-FIX-01 (H1): for an applied mutation `persistedPostEditGraph`
  // is the MERGED graph — the applied nodes/edges laid onto the
  // server-authoritative persisted base. It is BOTH what gets persisted
  // (`graphForCommit` below) AND what every current-graph-hash in this
  // dispatch derives from (freshness, recovery pending refresh); all three
  // must agree with what the NEXT turn computes from `scenarios.graph`.
  //
  // Codex P0 — the base is resolved via the STRICT persisted loader, NOT
  // buildTurnContext's `persistedGraph`. buildTurnContext swallows
  // `scenarios.*` read failures into `graph: null`, so relying on it cannot
  // distinguish a genuinely-empty scenario from a transient/degraded read —
  // and committing the ingress fallback on a degraded read would overwrite a
  // rich persisted graph with the lossy client echo (the exact corruption
  // this fix removes). `loadPersistedGraphStrict` returns the graph, returns
  // null ONLY for a genuinely-empty `scenarios.graph`, and THROWS on a
  // degraded read:
  //   - graph present  → merge onto it (server-only top-level fields survive).
  //   - null (genuine) → ingress-base fallback: the no-persisted-graph case
  //     (e.g. a client that sent graph_state for a never-persisted scenario);
  //     there is nothing to lose, and the edit must still persist.
  //   - degraded read  → FAIL CLOSED: refuse to persist (throw → route maps it
  //     to a retryable 500) rather than risk corrupting canonical state. A
  //     transient blip fails the edit (retryable) instead of silently
  //     overwriting `scenarios.graph`; mirrors route-v2's no-graph_state
  //     reload-failure handling, which also refuses to proceed. Throwing here
  //     also fails fast — it avoids buildTurnContext's extra read against the
  //     already-degraded store — while the outer assembly `finally` still
  //     emits the single edit turn event.
  let persistedPostEditGraph: unknown = graphState;
  // A3 graph CAS observe-mode: expected-base hashes for this dispatch's
  // graph-bearing commit. Derived ONLY from the strict SERVER-SIDE persisted
  // read below (`loadPersistedGraphStrict`) — the same trusted base the merge
  // uses — NEVER from the request-supplied `graphState` (which is untrusted
  // and may be the graph being written; trusted base rule, see
  // graph-cas-conflict.ts). Stays `undefined` (→ `no_expected`, never a
  // conflict) when there is no applied mutation to persist or the mode is
  // 'off'. A degraded strict read throws below (pre-existing fail-closed
  // behaviour), so no expected hash is ever manufactured from a failed read.
  let expectedGraphCasHashes:
    | ReturnType<typeof computeExpectedGraphCasHashes>
    | undefined;
  // Graph Management (lane 8): frame-authority PRE-edit base for the referee
  // gate — the strict persisted read when available, else the ingress echo
  // (the same fallback rule the persistence merge applies).
  let gmFrameBase: unknown = graphState;
  if (successfulAppliedMutation) {
    let strictBase: unknown;
    try {
      strictBase = await loadPersistedGraphStrict(payload.scenario_id);
    } catch (err) {
      log.warn(
        {
          event: 'v5.edit_graph.persist_base_unavailable',
          request_id: requestId,
          scenario_id: payload.scenario_id,
          err:
            err instanceof Error
              ? { name: err.name, message: err.message }
              : { message: String(err) },
        },
        'V5 edit_graph — persisted merge base unavailable (degraded read); failing closed to avoid overwriting canonical scenarios.graph with the lossy ingress echo',
      );
      throw new Error(
        'edit_graph: refusing to persist applied mutation — persisted merge base unavailable (degraded read)',
      );
    }
    // A3 graph CAS: hash the strict server base for the commit's expected
    // fields — reusing the read this path already performs (no extra I/O).
    // `strictBase` null = genuinely-empty scenarios.graph → expected hashes
    // {null, null} ("server base read, no graph") → `first_write` when the
    // graph is still absent at write time, `no_expected` otherwise.
    if (config.features.graphCasMode !== 'off') {
      expectedGraphCasHashes = computeExpectedGraphCasHashes(strictBase ?? null);
    }
    gmFrameBase = strictBase ?? graphState;
    persistedPostEditGraph = mergeAppliedGraphForPersistence({
      appliedGraph: editResult.appliedGraph!,
      // null here = a GENUINELY empty scenarios.graph (the strict read
      // succeeded); merge() then uses the ingress fallback base. A degraded
      // read never reaches this line — it threw above.
      persistedBase: strictBase ?? null,
      ingressBase: graphState,
      requestId,
      scenarioId: payload.scenario_id,
    });
  }

  let freshness: FreshnessDerivation;
  let priorFactsForRecovery: readonly HandlerFact[] = [];
  // V5 P0 — captured proposed concept from the prior turn's pending
  // actions, used by the no-op recovery layer to drive the deterministic
  // Stage 1 / Stage 2 clarifier. Null when no prior proposal exists, when
  // it was invalidated by graph divergence, or when the buildTurnContext
  // catch branch fired.
  let pendingProposedConceptForRecovery:
    | { readonly concept: string; readonly preferred_kind: 'risk' | 'factor' | 'either' }
    | null = null;
  // The current graph hash, surfaced out of the try so the resume path
  // can use it to construct the refreshed pending action.
  let currentGraphHashForRecovery: string | null = null;
  // `proposalPendingForCommit` is declared at the top of the function
  // (above the intercept) so the early-emit path can populate it
  // directly. The recovery-path resume below assigns it for the
  // non-early-emit Stage 1 / Stage 2 case.
  try {
    const turnContext = await buildTurnContext(payload, requestId);
    priorFactsForRecovery = turnContext.prior_facts;
    // V5-PERSIST-FIX-01: the merge base was already resolved above via the
    // strict persisted read (so a degraded read fails closed). buildTurnContext
    // is used here only for prior_facts / pending actions — NOT for the base.
    const currentGraphHash = computeAnalysisAffectingGraphHash(
      persistedPostEditGraph as GraphStateIngress | null | undefined,
    );
    currentGraphHashForRecovery = currentGraphHash;
    // V5 P0 — resolve the proposal-resume gate via the shared helper.
    // It runs the no-pending → wall-clock-TTL → graph-hash ladder in
    // that order and either returns a Stage 1 / Stage 2 decision or a
    // typed rejection. We only need the concept itself here (the
    // decision will be re-derived inside `decideNoOpRecovery` after
    // intent classification); a non-null decision means the gate is
    // satisfied and the concept is safe to pass through. The wall-clock
    // TTL mirrors the `isExpired` semantics used by
    // tryClarificationResume / tryShortConfirmResume.
    const priorPending = turnContext.most_recent_pending_actions ?? [];
    const recoveryGateOutcome = resolveProposalResume({
      message: payload.message,
      pendingActions: priorPending,
      nodes: null,
      currentGraphHash,
      nowMs: Date.now(),
    });
    if (
      (recoveryGateOutcome.rejection === 'expired_wall'
        || recoveryGateOutcome.rejection === 'graph_hash_changed')
      // PR #216 review follow-up: suppress the duplicate emit when the
      // pre-LLM intercept already reported this same invalidation this
      // turn. The intercept and this block both run the resume gate
      // against the same most-recent pending; without this guard an
      // expired / diverged pending that then no-ops through
      // `handleEditGraph` would emit the metric twice. When the
      // intercept did NOT emit (e.g. its graph-hash compute failed but
      // this block's succeeded), the flag is false and we still emit
      // exactly once.
      && !interceptEmittedInvalidation
    ) {
      emit(TelemetryEvents.V5ProposalContinuationInvalidated, {
        request_id: requestId,
        scenario_id: payload.scenario_id,
        reason: recoveryGateOutcome.rejection,
      });
    }
    if (recoveryGateOutcome.rejection === null) {
      // Gate satisfied — surface the concept to the no-op recovery
      // layer. (decideNoOpRecovery may still return a non-proposal
      // branch if the message does not match agreement / add-as-factor.)
      const concept = findProposedConceptAction(priorPending);
      pendingProposedConceptForRecovery = concept;
    }
    freshness = deriveAnalysisFreshness(
      turnContext.prior_facts,
      currentGraphHash,
      // Option-identity guard (CEE_OPTION_IDENTITY_FRESHNESS_GUARD): option IDs
      // from the post-edit persisted graph (same source as the hash). When an
      // option is added/removed the hash already diverges; the guard adds the
      // hash-impossible coverage. undefined when off → byte-identical.
      config.cee.optionIdentityFreshnessGuard
        ? extractGraphOptionIds(persistedPostEditGraph)
        : undefined,
    );
    emitFreshnessTelemetry(
      freshness,
      {
        request_id: requestId,
        scenario_id: payload.scenario_id,
        dispatch_path: 'edit_graph',
      },
      {
        prior_fact_count: turnContext.prior_facts.length,
        current_turn_fact_count: 0,
        edit_was_rejected: editResult.wasRejected,
      },
    );
  } catch (err) {
    log.warn(
      {
        request_id: requestId,
        scenario_id: payload.scenario_id,
        err: err instanceof Error ? { name: err.name, message: err.message } : { message: String(err) },
      },
      'V5 edit_graph dispatch — freshness derivation failed; emitting derivation_failed verdict',
    );
    let currentGraphHash: string | null = null;
    try {
      currentGraphHash = computeAnalysisAffectingGraphHash(
        persistedPostEditGraph as GraphStateIngress | null | undefined,
      );
    } catch {
      // Hash computation failure is rare (input validation upstream)
      // but if it does happen we still synthesise the verdict.
    }
    freshness = {
      freshness: 'unknown',
      reason: 'derivation_failed',
      selected_fact_index: null,
      graph_hash_at_run: null,
      current_graph_hash: currentGraphHash,
      computed_at: null,
    };
    emitFreshnessTelemetry(
      freshness,
      {
        request_id: requestId,
        scenario_id: payload.scenario_id,
        dispatch_path: 'edit_graph',
      },
      {
        prior_fact_count: 0,
        current_turn_fact_count: 0,
        edit_was_rejected: editResult.wasRejected,
        derivation_error: err instanceof Error ? err.message : String(err),
      },
    );
  }

  // Lane 22 — missed-resume visibility on the ops-produced paths. When a
  // live, valid pending proposal existed (the resume gate passed) but the
  // turn went to the LLM and produced an edit outcome — applied OR
  // rejected — the missed resume was previously invisible: the
  // zero-operations recovery sub-case below is the ONLY place that
  // emitted `no_agreement`. Emit it here for the complementary paths so
  // dashboards see every turn where a pending proposal coexisted with an
  // LLM edit outcome. `ops_produced` distinguishes this emit from the
  // zero-ops one; the pre-LLM gate's own no-match emit is distinguished
  // by `pre_llm: true`.
  if (
    pendingProposedConceptForRecovery !== null
    && !proposalEarlyEmitted
    && (editResult.wasRejected || (editResult.operations?.length ?? 0) > 0)
  ) {
    emit(TelemetryEvents.V5ProposalContinuationResumed, {
      request_id: requestId,
      scenario_id: payload.scenario_id,
      outcome: 'no_agreement',
      pre_llm: false,
      ops_produced: true,
      edit_was_rejected: editResult.wasRejected,
    });
  }

  // ── Graph Management referee gate (lane 8, CEE_GRAPH_MANAGEMENT_MODE) ──
  // off: zero referee calls, byte-identical path (pinned by
  // edit-graph-dispatch-graph-management-modes.test.ts). shadow: the referee
  // evaluates every envelope and emits redacted v5.candidate_mutation.*
  // telemetry; the existing path proceeds UNCHANGED. live: blocked verdicts
  // route below — the mutation is NOT persisted, no ack prose, no edit fact,
  // no analysis_ready stamp (structural honesty). GM never writes graph
  // state itself; the single durable writer remains commitDirectAnswer.
  const gmMode = config.features.graphManagementMode;
  let gmDecision: EditGmDecision | null = null;
  let gmCurrentHash: string | null = null;
  if (gmMode !== 'off' && successfulAppliedMutation && (editResult.operations?.length ?? 0) > 0) {
    try {
      gmCurrentHash = computeAnalysisAffectingGraphHash(
        gmFrameBase as GraphStateIngress | null | undefined,
      );
    } catch {
      gmCurrentHash = null; // frame gate fails closed (unreadable → held)
    }
    let gmBaseHash: string | null = null;
    try {
      // The hash of the graph the candidate ops were generated against (the
      // ingress echo handleEditGraph edited). When the frame base IS the
      // ingress (no persisted graph), the two are identical by construction.
      gmBaseHash =
        gmFrameBase === graphState
          ? gmCurrentHash
          : computeAnalysisAffectingGraphHash(graphState as GraphStateIngress | null | undefined);
    } catch {
      gmBaseHash = null;
    }
    // PRE-edit freshness for the frame: was the last analysis current
    // against the graph the candidates were generated on? Re-uses the SAME
    // prior facts the post-edit derivation loaded (pure re-projection, no
    // extra I/O). A degraded prior-fact load fails closed to 'unknown'.
    const gmFreshness: FrameFreshness =
      freshness.reason === 'derivation_failed'
        ? 'unknown'
        : deriveAnalysisFreshness(priorFactsForRecovery, gmCurrentHash).freshness;
    gmDecision = evaluateEditGraphMutations({
      mode: gmMode,
      operations: editResult.operations!,
      rationales: editResult.operation_meta?.map((m) => m?.rationale),
      currentGraph: gmFrameBase,
      currentGraphHash: gmCurrentHash,
      baseGraphHash: gmBaseHash,
      freshness: gmFreshness,
      scenarioId: payload.scenario_id,
      turnId: payload.turn_id,
      requestId,
    });
  }
  const gmBlockedApply = gmDecision !== null && gmDecision.blockApply;
  // Structural honesty: every downstream success effect (persist, edit fact,
  // analysis_ready, returned graph) gates on the EFFECTIVE predicate so a
  // live-blocked verdict can never surface an applied-mutation signal.
  const effectiveAppliedMutation = successfulAppliedMutation && !gmBlockedApply;
  if (gmBlockedApply && gmDecision !== null) {
    // Replace the V4 success narration wholesale: verdict template text
    // (provisional_doctrine_v0), verdict-appropriate chips, and a redacted
    // public-reason details block (codes + fixed readables only — never
    // RefereeVerdict.candidate internals). The finaliser egress guard below
    // still backstops this copy like every other emit path.
    response = {
      ...response,
      assistant_text: gmDecision.assistantText ?? response.assistant_text,
      suggested_actions: (gmDecision.suggestedActions ?? []).map((c) => ({
        id: c.id,
        label: c.label,
        message: c.message,
        ...(c.action_type !== undefined ? { action_type: c.action_type } : {}),
      })),
      ...(gmDecision.publicReason !== null
        ? {
            blocks: [
              {
                type: 'error',
                error_code: 'INTERNAL_ERROR',
                severity: 'warn',
                details: gmDecision.publicReason,
              },
            ] as OlumiResponse['blocks'],
          }
        : {}),
    };
    // The graph did NOT change this turn — re-derive the wire freshness
    // against the UNCHANGED frame base so staleness is never claimed off an
    // unpersisted mutation. A derivation_failed verdict is kept as-is
    // (honest degradation beats a fabricated re-derivation).
    if (freshness.reason !== 'derivation_failed') {
      freshness = deriveAnalysisFreshness(
        priorFactsForRecovery,
        gmCurrentHash,
        config.cee.optionIdentityFreshnessGuard
          ? extractGraphOptionIds(gmFrameBase)
          : undefined,
      );
    }
    // R7 per-turn event honesty: the mutation did not apply.
    ev.branch = `graph_management_${gmDecision.governing}`;
    ev.outcome =
      gmDecision.governing === 'rejected'
        ? 'rejected'
        : gmDecision.governing === 'held'
          ? 'proposal'
          : 'clarify';
    log.info(
      {
        request_id: requestId,
        scenario_id: payload.scenario_id,
        mode: gmMode,
        governing: gmDecision.governing,
        verdict_counts: gmDecision.verdictCounts,
        pending_emitted: (gmDecision.pendingActions?.length ?? 0) > 0,
      },
      'V5 edit_graph — Graph Management live gate blocked the apply path (mutation NOT persisted)',
    );
  }

  // V5 H5 — false-success invariant (defence-in-depth).
  // Runs BEFORE the forbidden-phrase guard. Two distinct sub-cases
  // both gated on `!wasRejected && !successfulAppliedMutation`:
  //
  //   A. Structural mismatch — operations exist but appliedGraph is
  //      missing. The prose cannot be trusted regardless of phrasing
  //      because no graph state was persisted to commit. This is the
  //      shape the staging Layer-B replay surfaced (PR #164 round-3
  //      follow-up): V4 returns operations + appliedChanges + LLM-
  //      authored success-style coaching prose, but `appliedGraph`
  //      stayed null because PLoT wasn't wired into V5 dispatch. The
  //      regex-based `findSuccessClaimHit` can't enumerate every
  //      phrasing the LLM produces ("Strengthened the X edge from Y
  //      to Z..." doesn't match the existing pattern set). Rewrite
  //      UNCONDITIONALLY whenever the structural signature fires.
  //      The V4 source fix below (Step 2) makes this case impossible
  //      in normal operation; this backstop catches future
  //      regressions in the source.
  //
  //   B. No-operations no-op with success-claim language. Mode B
  //      regression backstop — V4 already drops both warnings and
  //      coaching on no-op paths (PR #164 round-1 P0), so this only
  //      fires if a future emit path re-introduces LLM prose on the
  //      no-op branch. Uses the regex set because operations=[] is
  //      the legitimate no-op shape and the prose IS the only signal
  //      that something inappropriate slipped through.
  if (!editResult.wasRejected && !successfulAppliedMutation) {
    const operationsCount = editResult.operations?.length ?? 0;
    const hasAppliedGraph = editResult.appliedGraph !== null
      && editResult.appliedGraph !== undefined;

    if (operationsCount > 0 && !hasAppliedGraph) {
      // Sub-case A — structural mismatch. Unconditional rewrite.
      emit(TelemetryEvents.V5EditGraphAppliedGraphMissingWithOperations, {
        request_id: requestId,
        scenario_id: payload.scenario_id,
        operations_count: operationsCount,
        dispatch_path: 'edit_graph_finalise',
      });
      response = { ...response, assistant_text: EGRESS_FORBIDDEN_PHRASE_FALLBACK_TEXT };
    } else {
      // Sub-case B — regex-based no-op + success-claim backstop.
      const successHit = findSuccessClaimHit(response.assistant_text ?? '');
      if (successHit !== null) {
        emit(TelemetryEvents.V5EditGraphFalseSuccessRewritten, {
          request_id: requestId,
          scenario_id: payload.scenario_id,
          original_phrase: successHit,
          dispatch_path: 'edit_graph_finalise',
        });
        response = { ...response, assistant_text: EGRESS_FORBIDDEN_PHRASE_FALLBACK_TEXT };
      }

      // V5 Context Management v1 — no-op recovery layer.
      //
      // Sub-case B is a legitimate no-op (zero operations, no applied
      // graph, no false-success language). The default response copy
      // is bland or echoes V4 confirmation framing that drops useful
      // context. Upgrade it when we can do better:
      //
      //   - Message is analytical AND a successful run_analysis fact
      //     exists → acknowledge no change + redirect to the analysis.
      //   - Message is analytical AND no run_analysis fact exists →
      //     nudge the user to run analysis first; chip is gated on
      //     graph-readiness (matches tryNoAnalysisGuard).
      //   - Message carries a positive vague-edit signal (imperative
      //     edit verb with an abstract target) → ask a concise
      //     clarification instead of leaving bland fallback copy.
      //   - Anything else (including general conversational messages
      //     with no edit signal) → leave existing copy. Safer than
      //     rewriting from too little signal.
      //
      // Preserves existing response blocks, suggested actions, and
      // safe coaching payloads where present. Does not introduce
      // internal terms or claim a change happened.
      const graphReadyForRecovery =
        parsedGraph.nodes.length > 0 && parsedGraph.edges.length > 0;
      const recoveryOutcome = decideNoOpRecovery({
        message: payload.message,
        priorFacts: priorFactsForRecovery,
        freshness: freshness.freshness,
        graphReady: graphReadyForRecovery,
        // Pass the post-parse graph nodes so the `explore_factor`
        // safety-net branch can detect a no-op message that mentions a
        // known label (the symptom of any path that slips past the
        // upstream `tryPostAnalysisLabelIntercept` in route-v2.ts).
        nodes: parsedGraph.nodes,
        // V5 P0 proposal-memory continuation. Null when no fresh prior
        // proposal exists or graph hash has diverged since emit. The
        // proposal_stage_one / _two branches only fire when this is
        // non-null AND the corresponding agreement / add-as-factor
        // signal matches the user's message.
        pendingProposedConcept: pendingProposedConceptForRecovery,
        // V5 P0 staging-smoke follow-up (PR #212): suppress the
        // recovery's proposal_stage_* branches when the pre-LLM
        // intercept already emitted Stage 1 / Stage 2 chips. Without
        // this guard both layers fire and the wire response carries
        // 6 chips instead of 3.
        proposalAlreadyEmittedInThisTurn: proposalEarlyEmitted,
        // R10 — when the V4 no-op branch preserved a scrubbed clarifying
        // question, the recovery layer must stay inert (no vague-edit clobber).
        noOpClarificationPreserved: editResult.noOpClarificationPreserved === true,
      });
      // V5 P0 — surface stage outcome telemetry independently of the
      // existing V5EditGraphNoOpRecovery event so dashboards can track
      // proposal-resume rate without joining on branch_taken.
      if (pendingProposedConceptForRecovery !== null) {
        // Emit the post-recovery telemetry ONLY when the recovery
        // layer was authoritative for the outcome on this turn.
        // PR #212 staging-smoke follow-up: when the pre-LLM intercept
        // already emitted Stage 1 / Stage 2 the recovery's proposal
        // branch is suppressed (proposalAlreadyEmittedInThisTurn=true)
        // so recoveryOutcome.branch would compute as something other
        // than proposal_stage_*. Reporting `outcome: 'no_agreement'`
        // here would be misleading — the proposal DID resume via the
        // early-emit path, which already emitted its own
        // `V5ProposalContinuationResumed{pre_llm: true}` event with
        // the correct stage_one / stage_two outcome.
        if (!proposalEarlyEmitted) {
          const stageOutcome: 'stage_one' | 'stage_two' | 'no_agreement' =
            recoveryOutcome.branch === 'proposal_stage_two'
              ? 'stage_two'
              : recoveryOutcome.branch === 'proposal_stage_one'
              ? 'stage_one'
              : 'no_agreement';
          emit(TelemetryEvents.V5ProposalContinuationResumed, {
            request_id: requestId,
            scenario_id: payload.scenario_id,
            outcome: stageOutcome,
            pre_llm: false,
          });
        }
        // V5 P0 — refresh the pending action on the RECOVERY-path Stage 1
        // / Stage 2 emits so the user has another TTL window to walk
        // through Stage 1 → Stage 2 → Stage 3 without expiry surprises.
        // Stage 3 ("affecting X" disambiguated) falls through to existing
        // edit_graph dispatch with full context, and the pending decays
        // naturally there.
        //
        // The early-emit path is NOT handled here: it refreshes the
        // pending in the intercept itself (PR #216 round-3), independent
        // of this block's `buildTurnContext` pending read — so the
        // refresh survives a degraded second read. On the early-emit
        // path `recoveryOutcome.branch` is 'ambiguous' (inert), so this
        // condition is correctly false.
        if (
          recoveryOutcome.branch === 'proposal_stage_one'
          || recoveryOutcome.branch === 'proposal_stage_two'
        ) {
          const refreshGraphHash =
            currentGraphHashForRecovery !== null
              ? currentGraphHashForRecovery
              : computeAnalysisAffectingGraphHash(
                  persistedPostEditGraph as GraphStateIngress | null | undefined,
                );
          proposalPendingForCommit = buildProposalPendingAction({
            concept: pendingProposedConceptForRecovery.concept,
            preferred_kind: pendingProposedConceptForRecovery.preferred_kind,
            scenario_id: payload.scenario_id,
            emitted_at_iso: new Date().toISOString(),
            ...(refreshGraphHash ? { graph_hash: refreshGraphHash } : {}),
          });
        }
      }
      if (recoveryOutcome.assistantText !== null) {
        response = { ...response, assistant_text: recoveryOutcome.assistantText };
      }
      // Strip existing chips whose intent is incompatible with the
      // recovery decision BEFORE the dedupe-and-append step. The only
      // case in v1 is `analytical_none` with `graphReady=false`: a
      // pre-existing V4 `run_analysis` chip would fail when clicked,
      // so it must be removed. Without this strip the recovery would
      // suppress its own chip (correct) but the V4 chip would survive
      // (wrong) and the user would still see an actionable
      // run_analysis affordance that cannot succeed.
      let strippedActions = 0;
      if (
        recoveryOutcome.branch === 'analytical_none'
        && !graphReadyForRecovery
        && response.suggested_actions
        && response.suggested_actions.length > 0
      ) {
        const before = response.suggested_actions;
        const after = before.filter((a) => a.action_type !== 'run_analysis');
        if (after.length !== before.length) {
          strippedActions = before.length - after.length;
          response = { ...response, suggested_actions: after };
        }
      }
      // Dedupe by action_type: if the existing response already has a
      // chip with the same action_type as a recovery chip, suppress
      // the recovery one. Two chips with identical intent in the same
      // response are bad UX. Chips without an `action_type` (no
      // wire-level handler binding) are never deduped against because
      // their click semantics are message-replay only.
      let appendedActions = 0;
      if (recoveryOutcome.suggestedActions.length > 0) {
        const existing = response.suggested_actions ?? [];
        const existingIntents = new Set<string>();
        for (const a of existing) {
          if (a.action_type) existingIntents.add(a.action_type);
        }
        const recoveryFiltered = recoveryOutcome.suggestedActions.filter(
          (a) => !a.action_type || !existingIntents.has(a.action_type),
        );
        appendedActions = recoveryFiltered.length;
        if (recoveryFiltered.length > 0) {
          response = {
            ...response,
            suggested_actions: [...existing, ...recoveryFiltered],
          };
        }
      }
      // Emit AFTER strip + dedupe so `appended_actions` honestly
      // reports what landed on the response, not what the recovery
      // would have appended in isolation. `stripped_actions` reports
      // existing-chip removals so observability covers both edges of
      // the merge logic.
      //
      // PR #216 round-3 review (NICE-TO-HAVE): suppress on the
      // early-emit path. There the recovery decision is inert by
      // construction (branch 'ambiguous', no rewrite, no append), so
      // emitting `V5EditGraphNoOpRecovery{branch:ambiguous,
      // rewrote_text:false, appended:0}` is pure noise that conflates
      // "recovery ran and did nothing" with "early-emit was
      // authoritative". The `V5ProposalContinuationResumed{pre_llm:
      // true}` event already records the early-emit outcome.
      // R7: the recovery branch is the user-visible no-op outcome; surface it
      // on the per-turn event. R10 (task 7) adds the preserve/fallback values.
      // R10 — `noop_clarification_preserved` when the question was kept,
      // `noop_fallback_copy` when the V4 no-op fell back and recovery did not
      // upgrade the copy, otherwise the recovery branch that rewrote the text.
      ev.branch =
        recoveryOutcome.assistantText === null && editResult.noOpClarificationPreserved !== true
          ? 'noop_fallback_copy'
          : recoveryOutcome.branch;
      if (!proposalEarlyEmitted) {
        emit(TelemetryEvents.V5EditGraphNoOpRecovery, {
          request_id: requestId,
          scenario_id: payload.scenario_id,
          intent_class: recoveryOutcome.intent_class,
          has_run_analysis_fact: recoveryOutcome.has_run_analysis_fact,
          freshness: freshness.freshness,
          branch_taken: recoveryOutcome.branch,
          rewrote_text: recoveryOutcome.assistantText !== null,
          appended_actions: appendedActions,
          stripped_actions: strippedActions,
        });
      }
    }
  }

  // V5 stale-aware explain recovery — finaliser-level egress guard.
  // Runs as the LAST step before the response is committed and
  // returned, so it backstops EVERY edit_graph emit path: V4
  // confirmation text, clarification copy, recovery copy, the
  // generic "Proposed graph edit." fallback. An upstream hook would
  // miss new emit paths added later; the finaliser hook cannot.
  {
    const guarded = applyEgressForbiddenPhraseGuard(response.assistant_text ?? '');
    if (guarded.rewritten) {
      emit(TelemetryEvents.V5EgressForbiddenPhraseDetected, {
        request_id: requestId,
        scenario_id: payload.scenario_id,
        phrase: guarded.hit,
        dispatch_path: 'edit_graph_finalise',
      });
      response = { ...response, assistant_text: guarded.text };
    }
  }

  // V5 finaliser contract: compute structural readiness from the post-edit
  // graph here so route-v2.ts can stamp it onto the wire envelope.
  // computeStructuralReadiness is intervention-shape-tolerant
  // (mergeInterventionSources handles the V3 shape that the UI legacy
  // fallback could not read). Undefined when no successful mutation
  // committed — gated by `successfulAppliedMutation` (Codex round-2
  // P1) so an impossible appliedGraph+empty-operations shape cannot
  // stamp analysis_ready from an unpersisted graph.
  // Lane 8: gated on the EFFECTIVE predicate — a GM-live-blocked mutation
  // must not stamp analysis_ready from a graph that was never persisted.
  // `let` — overnight review F6: the goal-target receipt guard below can
  // withhold this turn's graph write AFTER this initial computation; when
  // it does, `analysisReady` is re-set to `undefined` alongside it so the
  // wire never stamps readiness derived from a graph that never persisted.
  let analysisReady: AnalysisReadyPayload | undefined = effectiveAppliedMutation
    ? computeStructuralReadiness(editResult.appliedGraph!)
    : undefined;

  // V5 state-trust freshness derivation moved earlier in this function
  // (just after `successfulAppliedMutation` is computed) so the no-op
  // recovery layer can read it. The behaviour, telemetry, and
  // dispatch_path are unchanged from the original position.

  try {
    // llm_calls_used: handleEditGraph makes at least one LLM call for the
    // edit classification + repair loop. Using 1 as an honest minimum.
    //
    // graph: when a true successful applied mutation occurred
    // (`successfulAppliedMutation`), EditGraphResult.appliedGraph carries
    // the post-edit GraphV3T and is passed as p_graph so
    // append_turn_atomic writes scenarios.graph in the same transaction
    // as the turn row. When NOT a successful applied mutation (rejected,
    // noop, zero-ops, no appliedGraph, OR the impossible-but-not-enforced
    // shape appliedGraph+operations=[]), `graphForCommit` resolves to
    // undefined, the RPC receives p_graph = null, and scenarios.graph is
    // left unchanged. The gate matches every other downstream check that
    // depends on "did a mutation truly apply" (false-success rewrite,
    // analysisReady, freshness postEditGraph, returned graph).
    // DL-7 PR B: emit a canonical EditGraphHandlerFact for every
    // successful applied mutation. Two-tier construction:
    //
    //   1. Rich path (buildEditGraphHandlerFact) — uses
    //      appliedChanges + operations + operation_meta to construct
    //      a fact with display-safe `safe_summary`, projected
    //      `affected_entities`, and accurate `impact`.
    //   2. Generic fallback (buildGenericEditGraphHandlerFact) —
    //      kicks in when the rich path returns null (e.g. missing
    //      appliedChanges) OR throws. Emits a minimal-but-valid fact
    //      with safe_summary='Updated the decision model.' and
    //      affected_entities=[]. War-room correction: a successful
    //      applied mutation MUST NOT commit with handler_facts: [].
    //
    // No-fact path (rejected, noop, zero-ops, no appliedGraph) is
    // gated by `isSuccessfulAppliedMutation` — those legitimately
    // commit with handler_facts: [] and handler_id: null.
    //
    // turn_class STAYS 'direct_answer' per War Room correction. The
    // append_turn_atomic RPC accepts handler_facts non-empty alongside
    // turn_class='direct_answer' (verified via SQL inspection).
    //
    // turn-row handler_id ALSO STAYS null. Setting it to 'edit_graph'
    // would require expanding `V5ActionType` in @talchain/schemas
    // (schemas-vendor change like PR A — out of PR B scope). The
    // fact-level `fact_type === 'edit_graph'` is the canonical
    // discriminator for downstream consumers (recent_changes
    // projector, state-query guard, prior_facts readers).
    const factBuilderInput = {
      editResult,
      preEditGraph: parsedGraph,
      hasExistingAnalysis: context.analysis_response !== null,
    };
    let editGraphFact: ReturnType<typeof buildEditGraphHandlerFact> = null;
    let richBuilderThrew = false;
    let richBuilderError: Error | undefined;
    try {
      // Lane 8: a GM-live-blocked mutation persists NO graph, so it must
      // also emit NO edit receipt fact (the builders derive "applied" from
      // editResult alone and cannot see the block).
      editGraphFact = gmBlockedApply ? null : buildEditGraphHandlerFact(factBuilderInput);
    } catch (err) {
      richBuilderThrew = true;
      richBuilderError = err instanceof Error ? err : new Error(String(err));
      editGraphFact = null;
    }

    // Generic fallback: only kicks in for successful applied mutations
    // where the rich path didn't produce a fact. Legitimate no-fact
    // outcomes (rejected, noop, zero-ops) skip this entirely.
    let genericBuilderThrew = false;
    let genericBuilderError: Error | undefined;
    if (!editGraphFact && effectiveAppliedMutation) {
      try {
        editGraphFact = buildGenericEditGraphHandlerFact(factBuilderInput);
      } catch (fallbackErr) {
        genericBuilderThrew = true;
        genericBuilderError =
          fallbackErr instanceof Error ? fallbackErr : new Error(String(fallbackErr));
        editGraphFact = null;
      }
      if (editGraphFact) {
        // Telemetry: clear, distinct event for the generic-fallback
        // path so dashboards can attribute "rich rate vs fallback rate"
        // and operators can see when the rich path is degrading.
        log.warn(
          {
            request_id: requestId,
            scenario_id: payload.scenario_id,
            event: 'v5.edit_graph.fact_generic_fallback',
            rich_builder_threw: richBuilderThrew,
            rich_err: richBuilderError && {
              name: richBuilderError.name,
              message: richBuilderError.message,
            },
            applied_changes_present: editResult.appliedChanges !== undefined,
            operations_count: editResult.operations?.length ?? 0,
          },
          richBuilderThrew
            ? 'V5 edit_graph dispatch — rich fact builder threw; emitting generic fallback fact'
            : 'V5 edit_graph dispatch — rich fact builder unavailable (no appliedChanges); emitting generic fallback fact',
        );
      }
    }

    // ── DEEPEST FALLBACK GATE (DL-7 invariant) ────────────────────────
    // For a successful applied mutation, BOTH the rich AND the generic
    // builder must produce a fact. If both fail, refuse to commit the
    // graph mutation rather than persisting a receipt-less mutation.
    //
    // Rationale: a graph mutation persisted without `handler_facts`
    // becomes downstream-invisible — `recent_changes`, the state-query
    // guard, and `prior_facts` would all silently miss it. An applied
    // mutation that produces no readable receipt violates DL-7 War
    // Room Decision 1 ("successful mutations must be turn-linked and
    // surfaced"). Better to surface the failure loudly via the
    // dispatcher's outer catch (`v5.edit_graph.dispatch_failed` →
    // FailureKind.HANDLER_INVOCATION_FAILED → safe recovery chip) than
    // to commit a silently-broken state.
    //
    // Invariant: if `successfulAppliedMutation` is true, we either
    // commit with a non-empty `handler_facts` array or we throw
    // before reaching `commitDirectAnswer`. We never commit the
    // pair {graph: appliedGraph, handler_facts: []} for an applied
    // mutation.
    if (!editGraphFact && effectiveAppliedMutation) {
      log.error(
        {
          request_id: requestId,
          scenario_id: payload.scenario_id,
          event: 'v5.edit_graph.fact_emission_failed',
          rich_builder_threw: richBuilderThrew,
          rich_err: richBuilderError && {
            name: richBuilderError.name,
            message: richBuilderError.message,
          },
          generic_builder_threw: genericBuilderThrew,
          generic_err: genericBuilderError && {
            name: genericBuilderError.name,
            message: genericBuilderError.message,
          },
          applied_changes_present: editResult.appliedChanges !== undefined,
          operations_count: editResult.operations?.length ?? 0,
        },
        'V5 edit_graph dispatch — BOTH rich and generic fact builders failed for an applied mutation; refusing to commit receipt-less graph mutation',
      );
      throw new Error(
        'edit_graph: applied mutation cannot be committed — both rich and generic fact builders failed (rich threw=' +
          String(richBuilderThrew) +
          ', generic threw=' +
          String(genericBuilderThrew) +
          ').',
      );
    }

    // V5 H5 — graph persistence backstop. Uses the unified
    // `successfulAppliedMutation` predicate (Codex round-2 P1) so
    // the gate is identical across the false-success rewrite, the
    // analysisReady computation, the freshness postEditGraph
    // selection, this commit, and the function's returned `graph`.
    // The rich/generic fact-builders use the same predicate, so a
    // graph cannot persist without a receipt fact and a receipt
    // fact cannot exist without persistable graph state.
    // V5-PERSIST-FIX-01 (H1): persist the MERGED graph — the applied
    // nodes/edges on the persisted-base shape — not the GraphV3-stripped
    // `appliedGraph`. `persistedPostEditGraph` is that merge for an
    // applied mutation (see its construction above); committing the
    // same object every hash in this dispatch derived from keeps
    // wire freshness, pending-action hashes and the next turn's
    // persisted-graph hash in lockstep.
    let graphForCommit = effectiveAppliedMutation
      ? persistedPostEditGraph ?? undefined
      : undefined;
    // ROADMAP 1.19(b) — swap-vs-commit: set when the goal-target receipt
    // guard below withholds a graph WRITTEN this turn because it doesn't
    // back the claim. Also gates the function's RETURNED `graph` (wired
    // straight to the client by route-v2's `sendFinalised200`, NOT merely
    // used for internal label-resolution) so the wire never ships the
    // unbacked mutation alongside the honest "I couldn't register" text.
    let goalTargetSwapWithheldGraph = false;
    // Lane 20 — goal-target receipt honesty guard (STEP 6.6-class swap
    // discipline for success-target claims). The live 313e7b61 leak: the
    // edit LLM stamped non-contract fields onto the goal node and shipped
    // "Success target … set …" while the canonical registration contract
    // (`goal_threshold_raw` — the field `has_goal_target` / the UI goal
    // chip / PLoT's explicit-threshold path read) was never written. A
    // registration claim may ship ONLY when the graph committed THIS turn
    // registers the target; a non-mutating turn may describe an
    // already-registered target (backed by the frame base — the strict
    // persisted read when loaded, else the ingress echo). Swap happens
    // BEFORE commit so the stored assistant_message equals the honest
    // wire copy. Fallback copy is pre-swept against the forbidden-phrase
    // and success-claim guards (goal-target-receipt-guard.test.ts).
    const goalReceiptDecision = decideGoalTargetReceipt({
      assistantText: response.assistant_text,
      commitGraph: graphForCommit ?? null,
      persistedGraph: gmFrameBase,
    });
    if (goalReceiptDecision.verdict === 'swap') {
      const graphWasWrittenThisTurn = graphForCommit !== undefined;
      log.warn(
        {
          event: 'v5.edit_graph.goal_target_receipt_swapped',
          request_id: requestId,
          scenario_id: payload.scenario_id,
          reason: goalReceiptDecision.reason,
          applied_mutation: effectiveAppliedMutation,
          graph_committed: graphWasWrittenThisTurn,
          graph_write_withheld: graphWasWrittenThisTurn,
        },
        'V5 edit_graph — success-target receipt claimed a registration the committed graph does not carry (no goal_threshold_raw on a goal node); swapped for the honest fallback before commit',
      );
      response = { ...response, assistant_text: GOAL_TARGET_NOT_SAVED_TEXT };
      // Swapping the TEXT for the honest fallback while still persisting
      // (and returning to the client) the unbacked mutation would commit
      // junk — the exact live shape that opened this guard (the LLM's
      // non-contract fields on the goal node). Withhold the write AND the
      // wire graph entirely so stored/returned state matches the honest
      // "I couldn't register that" text, same as any other turn that
      // writes no graph.
      if (graphWasWrittenThisTurn) {
        graphForCommit = undefined;
        goalTargetSwapWithheldGraph = true;
        // Overnight review F5+F6 — a withheld write must be coherent
        // across EVERY downstream signal, not just the graph itself:
        //
        //  (F5) The "applied" edit receipt FACT was already built (above,
        //       from `editResult`/`factBuilderInput`) before this guard
        //       ran, so it still narrates a registration this graph never
        //       carries. Committing it unchanged grounds the NEXT turn's
        //       LLM on a phantom edit (DL-7 violation) — `recent_changes`
        //       / prior_facts readers have no persisted graph to
        //       cross-check it against. Null it: a withheld-write turn is
        //       a non-mutating turn, same as any other turn that writes
        //       no graph and emits no facts.
        //
        //  (F6) `analysisReady` was computed from `editResult.appliedGraph`
        //       — the same unpersisted graph — before this guard ran.
        //       Re-set to undefined so the wire never stamps readiness
        //       derived from a graph that never persisted.
        //
        //  (F6) `freshness.current_graph_hash` was derived from
        //       `persistedPostEditGraph` — again the unpersisted graph —
        //       so it is a phantom hash the next turn's client can never
        //       actually observe. Re-derive against `gmFrameBase`, the
        //       PRE-edit persisted base that is what will actually still
        //       be in `scenarios.graph` after this turn — mirroring the
        //       GM-blocked branch above (line ~1958), which re-derives
        //       freshness the same way when IT withholds a write. A
        //       `derivation_failed` verdict is left as-is (honest
        //       degradation beats a fabricated re-derivation).
        editGraphFact = null;
        analysisReady = undefined;
        if (freshness.reason !== 'derivation_failed') {
          let withheldCurrentHash: string | null = null;
          try {
            withheldCurrentHash = computeAnalysisAffectingGraphHash(
              gmFrameBase as GraphStateIngress | null | undefined,
            );
          } catch {
            withheldCurrentHash = null;
          }
          freshness = deriveAnalysisFreshness(
            priorFactsForRecovery,
            withheldCurrentHash,
            config.cee.optionIdentityFreshnessGuard
              ? extractGraphOptionIds(gmFrameBase)
              : undefined,
          );
        }
      }
    }
    // V5 P0 — when the early-emit intercept or the no-op recovery
    // produced a refreshed `proposed_concept` pending action, persist
    // it so the next turn can resume. Combine it with the chip-derived
    // list and pass the combined list explicitly, capped at
    // PENDING_ACTIONS_PER_TURN_CAP=3 (also enforced by the DB CHECK).
    //
    // Proposal FIRST so the cap never drops it (PR #217 round-4 review):
    // mirrors `buildPendingActionsWithProposalCapture` in
    // proposal-continuation.ts. In practice the proposal-path response
    // carries only text-prompt chips (no `action_type`), so chipDerived
    // is empty here and ordering is moot — but proposal-first is the
    // correct policy and removes the latent drop if a chip-derivable
    // action is ever co-emitted on this path.
    let pendingActionsForCommit:
      | readonly import('../session/pending-action.js').PendingAction[]
      | undefined = undefined;
    if (proposalPendingForCommit !== null) {
      const chipDerived = derivePendingActionsFromFinalizedChips(
        (response.suggested_actions ?? []) as readonly BoundarySuggestedAction[],
        {
          scenario_id: payload.scenario_id,
          emitted_at_iso: new Date().toISOString(),
          ...(currentGraphHashForRecovery
            ? { graph_hash: currentGraphHashForRecovery }
            : {}),
        },
      );
      pendingActionsForCommit = [proposalPendingForCommit, ...chipDerived].slice(0, 3);
    }
    // Lane 8: a GM-live HELD verdict persists its REAL pending confirmation
    // (apply_proposed_change; resume is structurally decline-with-clarify —
    // see edit-graph-referee-gate.ts). Mutually exclusive with the proposal
    // path above (that path requires a non-applied editResult; GM only
    // engages on applied ones), but GM wins deterministically if both ever
    // co-occur.
    if (
      gmBlockedApply &&
      gmDecision !== null &&
      gmDecision.pendingActions !== null &&
      gmDecision.pendingActions.length > 0
    ) {
      pendingActionsForCommit = [...gmDecision.pendingActions].slice(0, 3);
    }
    await commitDirectAnswer(response, {
      scenario_id: payload.scenario_id,
      turn_id: payload.turn_id,
      turn_class: 'direct_answer',
      // handler_id stays null even on successful fact emission — see
      // the long comment above for the V5ActionType-expansion rationale.
      handler_id: null,
      request_hash: computeRequestHash(payload),
      // Deterministic paths make zero LLM calls; the LLM path makes at
      // least one (handleEditGraph drives the classification + repair
      // loop). Both the add-risk clarification (`deterministicAddRisk
      // Attempted`) and the proposal-continuation pre-LLM intercept
      // (`proposalEarlyEmitted`) short-circuit BEFORE handleEditGraph,
      // so neither spends an LLM call. PR #216 review (SHOULD-FIX):
      // the early-emit path was previously counted as 1, overcounting
      // LLM cost for the new deterministic path. Distinguish so
      // dashboards attribute cost honestly.
      llm_calls_used: deterministicAddRiskAttempted || proposalEarlyEmitted ? 0 : 1,
      duration_ms: Date.now() - startedAt,
      handler_facts: editGraphFact ? [editGraphFact] : [],
      graph: graphForCommit,
      // A3 graph CAS: expected-base hashes from the strict server read above
      // (undefined when no applied mutation / mode off — the CAS hook only
      // runs for graph-bearing writes, and `graph` is only set on applied
      // mutations, so coverage is complete on this path). Lane 8: omitted on
      // a GM-live-blocked turn — no graph is written, so no CAS observation.
      ...(expectedGraphCasHashes !== undefined && !gmBlockedApply
        ? expectedGraphCasHashes
        : {}),
      ...(pendingActionsForCommit !== undefined
        ? { pending_actions: pendingActionsForCommit }
        : {}),
      // V5 Stage 2B-1b: the route-v2 edit path never runs buildTurnContext,
      // so no coaching_state is derived for this turn — persist NULL explicitly.
      coaching_state: null,
      // V5 Conversation Context Reliability: persist the user's turn text; the
      // assistant answer auto-derives from `response.assistant_text`. This path
      // covers successful mutations, no-ops, add-risk clarifications AND
      // preflight rejections — so a rejected "add a risk" and its rejection
      // reply are both available when the next turn asks "why did that fail?".
      userMessage: payload.message,
      // Resolve entity-id labels in the stored assistant answer against the
      // SAME graph the route egress uses for this exit — `graphForCommit` (the
      // post-edit appliedGraph on a successful mutation, else undefined → the
      // egress is graph-free too), keeping stored == wire.
      contentGraph: graphForCommit,
    });
    log.info(
      {
        request_id: requestId,
        scenario_id: payload.scenario_id,
        latency_ms: editResult.latencyMs,
        was_rejected: editResult.wasRejected,
      },
      'V5 edit_graph dispatch committed',
    );
    return {
      response,
      commitPerformed: true,
      analysisReady,
      // V5 H5 (Codex round-2 P1, amended by V5-PERSIST-FIX-01): the
      // returned `graph` is the typed applied graph whose nodes/edges
      // are IDENTICAL to what was persisted; the persisted object is
      // the merged superset that additionally preserves
      // server-authoritative top-level fields (goal_node_id,
      // options[], …). Route-v2 consumes this only for egress
      // label-resolution and the diagnostic-trace hash — both read
      // nodes/edges — so the typed value is kept rather than casting
      // the raw merged object. Null when no successful applied
      // mutation, so route-v2 doesn't stamp a non-persisted graph
      // onto the wire envelope. Lane 8: EFFECTIVE predicate — a GM-live
      // blocked mutation never surfaces its unpersisted graph. ROADMAP
      // 1.19(b): also null when the goal-target receipt guard withheld
      // this turn's graph write (`goalTargetSwapWithheldGraph`) — the
      // SAME predicate that gates the actual commit above, so a swapped
      // turn never surfaces its unpersisted mutation here either.
      graph:
        effectiveAppliedMutation && !goalTargetSwapWithheldGraph
          ? editResult.appliedGraph ?? null
          : null,
      freshness,
    };
  } catch (err) {
    log.error(
      {
        request_id: requestId,
        scenario_id: payload.scenario_id,
        err: err instanceof Error ? { name: err.name, message: err.message } : { message: String(err) },
      },
      'V5 edit_graph dispatch — commit failed',
    );
    return {
      response,
      commitPerformed: false,
      analysisReady,
      // V5 H5 (Codex round-3 cleanup): commit failure means
      // `commitDirectAnswer` threw — the post-edit graph was NOT
      // persisted to storage regardless of `successfulAppliedMutation`.
      // Returning `editResult.appliedGraph` here would imply a
      // persistence outcome that didn't happen. Route-v2 returns a 500
      // before consuming this field today, so this is not user-facing,
      // but the object should be self-consistent with
      // `commitPerformed=false`.
      graph: null,
      freshness,
    };
  } finally {
    // R7: emit the single per-turn event exactly once. This finally covers both
    // the success return and the commit-failure return; the handler-threw
    // rethrow is covered by the catch above. `emitEditTurnEventOnce` is
    // idempotent and self-isolating, so it never alters the returned value.
    emitEditTurnEventOnce();
  }
  } finally {
    // R7 (NB-1): outer guard closing the assembly-region gap. Reached when the
    // response-assembly code above threw before the commit-try ran. Idempotent
    // via `eventEmitted`, so the normal success path (inner finally already
    // emitted) is a no-op here. No catch — the original exception still
    // propagates out of dispatchEditGraph unchanged.
    emitEditTurnEventOnce();
  }
}
