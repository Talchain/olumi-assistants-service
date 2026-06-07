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
import { getAdapter } from '../../adapters/llm/router.js';
import type {
  ConversationContext,
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
import { buildTurnContext, loadMostRecentPendingActions } from '../build-turn-context.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
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
  | 'ambiguous';

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

export async function dispatchEditGraph(
  params: DispatchEditGraphParams,
): Promise<DispatchEditGraphResult> {
  const { payload, requestId, graphState, analysisState } = params;
  const startedAt = Date.now();

  const { graph: parsedGraph, strict: graphStrictlyCanonical } =
    graphStateToGraphV3WithParseResult(graphState, requestId);
  const context: ConversationContext = {
    graph: parsedGraph,
    analysis_response: analysisState ? analysisIngressToV2Envelope(analysisState) : null,
    framing: { stage: mapStageToDecisionStage(payload.stage) },
    messages: [{ role: 'user', content: payload.message }],
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
    throw err;
  }

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

  // V5 Context Management v1 — derive freshness + load prior facts
  // EARLIER than the original (Codex round-2 P1) position, so the no-op
  // recovery layer below can read `freshness` and `priorFactsForRecovery`
  // without re-loading state. The block's I/O surface and telemetry are
  // unchanged from the original position; only the order moved.
  //
  // On error the catch branch synthesises a `derivation_failed` verdict
  // and leaves `priorFactsForRecovery` empty so the no-op recovery falls
  // back to the bland fallback rather than re-throwing.
  const persistedPostEditGraph = successfulAppliedMutation
    ? editResult.appliedGraph
    : graphState;

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
    freshness = deriveAnalysisFreshness(turnContext.prior_facts, currentGraphHash);
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
  const analysisReady: AnalysisReadyPayload | undefined = successfulAppliedMutation
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
      editGraphFact = buildEditGraphHandlerFact(factBuilderInput);
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
    if (!editGraphFact && successfulAppliedMutation) {
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
    if (!editGraphFact && successfulAppliedMutation) {
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
    const graphForCommit = successfulAppliedMutation
      ? editResult.appliedGraph ?? undefined
      : undefined;
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
      ...(pendingActionsForCommit !== undefined
        ? { pending_actions: pendingActionsForCommit }
        : {}),
      // V5 Stage 2B-1b: the route-v2 edit path never runs buildTurnContext,
      // so no coaching_state is derived for this turn — persist NULL explicitly.
      coaching_state: null,
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
      // V5 H5 (Codex round-2 P1): returned `graph` matches what
      // was actually persisted. Null when no successful applied
      // mutation, so route-v2 doesn't stamp a non-persisted graph
      // onto the wire envelope.
      graph: successfulAppliedMutation ? editResult.appliedGraph ?? null : null,
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
  }
}
