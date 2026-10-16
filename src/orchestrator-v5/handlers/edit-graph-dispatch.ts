/** Shared edit helpers retained for held-card and canvas writers. The retired natural-language executor has been removed. */
import { hasReliesOnRiskStampChange } from '../routing/relies-on-risk.js';
import type { FastifyRequest } from 'fastify';
import type { MessageTurnPayload, OlumiResponse } from '@talchain/schemas/boundary';
import { log } from '../../utils/telemetry.js';
import { type EditGraphResult } from '../../orchestrator/tools/edit-graph.js';
import { type EditGraphLlmCallTelemetry } from '../diagnostics/v5-diagnostic-trace.js';
import type { GraphV3T } from '../../orchestrator/types.js';
import type { AnalysisStateIngress, GraphStateIngress, SelectedElementsIngress } from '../boundary/request-extensions.js';
import type { AnalysisReadyPayload } from '../compose/analysis-ready-emit.js';
import { loadPersistedScenarioStateStrict } from '../build-turn-context.js';
import { isSuccessfulRunAnalysisFact } from '../context/freshness.js';
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import { classifyAnalyticalIntent, hasMutationSignal, looksLikeAnaphoricEdit, looksLikeVagueEdit } from '../routing/analytical-intent.js';
import { buildAnaphoricBindingDisclosure, buildLabelChip, resolveAnaphoricReferent } from '../compose/edit-clarify-response.js';
import { nodeIdFromRef, type TurnReferents } from '../context/turn-referents.js';
import { decideProposalContinuation } from '../coaching/proposal-continuation.js';
import { type RecordedEffectAnswer } from '../routing/repair-value-binding.js';


// ConversationContext.framing.stage is a V4/DSK DecisionStage: the turn's wire
// stage crosses the ONE stage edge (`dsk/stage-edge.ts`) on the way in.
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
 *   - `analytical_none`         — analytical intent + no run_analysis fact,
 *                                  and the freshness authority CONFIRMS there
 *                                  is none (`freshness: 'none'`).
 *   - `analytical_indeterminate`— analytical intent + no run_analysis fact,
 *                                  but `freshness: 'unknown'` — the read
 *                                  failed, so absence is UNPROVEN. Discloses
 *                                  that we cannot confirm; never claims the
 *                                  user has not analysed (ROADMAP 2.1237).
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
  // ROADMAP 2.1237 — analytical intent, no run_analysis fact, AND the
  // freshness authority could not determine whether one exists. Distinct from
  // `analytical_none` on purpose: that branch CLAIMS the absence, this one
  // discloses that we cannot see.
  | 'analytical_indeterminate'
  | 'vague_edit'
  // Spec §4.2 — the three outcomes for an ANAPHORIC edit ("update it").
  // Named apart from `vague_edit` because they answer a different question:
  // vague_edit means "no target", these mean "a target to be resolved".
  // There is deliberately no fourth, reset-shaped outcome.
  | 'anaphoric_edit_bound'
  | 'anaphoric_edit_ask_candidates'
  | 'anaphoric_edit_ask_unresolved'
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
  /**
   * Spec §4 — the referent register for this turn (`turn_referents`), used ONLY
   * by the `anaphoric_edit_*` branches to resolve `it` / `this` / `that`.
   *
   * Optional on the type (mirroring `most_recent_pending_actions` and
   * `pendingProposedConcept`) so existing callers and tests that do not supply
   * it keep compiling. ⚠ Omitting it is NOT the same as supplying an empty
   * register: when the field is absent the anaphoric branches treat the
   * register as UNAVAILABLE and ASK, which is the safe outcome. They never fall
   * back to the reset.
   */
  readonly referents?: TurnReferents | null;
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


// ROADMAP 2.1237 — the DEGRADED-READ copy. Says what we know ("I haven't
// changed the model") and what we do not ("I can't confirm whether an
// analysis has run"), and asserts nothing about the user's history. No
// internal vocabulary: the user never hears "degraded" or "freshness".
const NO_OP_INDETERMINATE_GRAPH_READY_TEXT =
  "I haven't changed the model. I can't confirm whether an analysis has "
  + "already run for this decision. Running one now will give us a result "
  + 'either way.';


const NO_OP_INDETERMINATE_GRAPH_NOT_READY_TEXT =
  "I haven't changed the model. I can't confirm whether an analysis has "
  + 'already run for this decision. Once the model is ready we can run one '
  + 'and find out.';


// PR #218 smoke follow-up (Fix B): the prior copy said "Tell me which
// factor or edge you want to adjust" — "factor or edge" leaks internal
// schema vocabulary the copy contract forbids, and the smoke showed it
// reaching the user whenever a genuine proposal fell through extraction.
// Reworded to keep the meaning (nothing changed yet; ask what to change)
// without naming schema concepts (edge/node/graph/schema/patch).
const NO_OP_VAGUE_EDIT_TEXT =
  'I have not changed the model yet. Tell me what you want to change, '
  + 'and I will help apply it.';


/**
 * Spec §4.2 — copy for the three ANAPHORIC outcomes.
 *
 * Copy contract, checked against `FORBIDDEN_USER_FACING_PHRASES` and the
 * branch rules above: British English; no emoji; no em dashes; no internal
 * terms (`validator` / `patch` / `schema` / `operation` / `node` / `edge` /
 * `graph`); no raw ids; a POSITIVE statement of mutation status, never a
 * denial like "nothing changed". The lead sentence is the one already shipping
 * at `NO_OP_VAGUE_EDIT_TEXT`, so it is known to clear the egress guard.
 *
 * ⚠ EVERY ONE OF THESE ASKS A QUESTION. That is the contract, not a style
 * choice: the branch these replace asserted nothing and asked nothing, which is
 * the one state where the product holds more information than the user and
 * volunteers less.
 */
const ANAPHORIC_LEAD_TEXT = 'I have not changed the model yet.';


/**
 * Chip cap for the ambiguous-candidates ask. Matches the 3 that
 * `selectEditClarifyTargets` offers, so the two clarify surfaces do not present
 * visibly different budgets for the same kind of question.
 */
const ANAPHORIC_CANDIDATE_CHIP_CAP = 3;


/**
 * Exactly one candidate: BIND, and disclose the binding in its own sentence,
 * immediately after the mutation-status lead — sentence index 1, asserted by
 * position in `edit-graph-anaphoric-recovery.test.ts` so this sentence cannot
 * drift from the copy. Never silently — the user must be able to see what was
 * assumed and correct it, which is also what makes the next turn's "no, the
 * other one" resolvable. The disclosure sentence itself is the composer's
 * `buildAnaphoricBindingDisclosure`, shared with the value pre-route's receipt.
 */
function buildAnaphoricBoundText(label: string): string {
  return (
    `${ANAPHORIC_LEAD_TEXT} ${buildAnaphoricBindingDisclosure(label)} `
    + 'What value would you like it set to?'
  );
}


/** More than one candidate: ASK, with the candidates offered as chips. */
const ANAPHORIC_ASK_CANDIDATES_TEXT =
  `${ANAPHORIC_LEAD_TEXT} I am not sure which one you mean. `
  + 'Which of these would you like to change?';


/**
 * Nothing to bind to, or the register could not be read: ASK, and say what was
 * looked at.
 *
 * ⚠ THE SECOND SENTENCE IS A CLAIM ABOUT THIS BUILD'S WHOLE DOMAIN, so it names
 * ONLY what is actually consulted today. Spec §4.2's example copy also offers
 * "I looked at what you have selected", and that would be FALSE here: the
 * selection rank of the register has no producer yet (§3.5 needs a UI-side
 * "selection last changed" signal). Saying it would be a notice whose truth
 * condition the code does not meet. When that producer lands, this sentence is
 * the thing that must change with it.
 */
const ANAPHORIC_ASK_UNRESOLVED_TEXT =
  `${ANAPHORIC_LEAD_TEXT} I am not sure which part of your model you mean. `
  + 'I looked back at what I last told you about and could not pin it down. '
  // ⚠ THIS ENDS IN A QUESTION, and the first draft did not — it read "Tell me
  // which one to change, and I will apply it.", which TELLS rather than ASKS.
  // The test asserting every anaphoric reply contains a question mark caught it.
  // That is a milder form of the exact failure this whole branch removes, and it
  // reappeared inside the fix for it, so the assertion stays.
  + 'Which part would you like to change?';


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
      // ⚠ 2026-08-16 (P1, ROADMAP 2.1237) — AN EMPTY FACT ARRAY IS NOT
      // EVIDENCE OF ABSENCE WHEN THE READ ITSELF FAILED.
      //
      // `hasRunAnalysisFact` is a RAW `priorFacts.some(...)`. When the facts
      // read came back DEGRADED, `priorFacts` is empty because the lookup
      // failed — not because nothing is there — and this branch then told the
      // user "Run analysis first", a claim about their history we had no
      // evidence for.
      //
      // ⭐ THE HONEST VERDICT WAS ALREADY IN THIS INPUT OBJECT. The freshness
      // authority emits `'unknown'` precisely when it could not determine the
      // answer, and it is passed in beside the facts. This branch simply did
      // not read it.
      //
      // ⭐ `'none'` AND `'unknown'` MUST NOT COLLAPSE — they are different
      // facts. `'none'` means we looked and there is no successful run, so
      // `analytical_none` is TRUE and stays exactly as it was. `'unknown'`
      // means we could not look. Suppressing on empty facts alone would take
      // BOTH out and stop telling a genuinely-new user to run their first
      // analysis — the opposite harm, and the one-directional trade CLAUDE.md
      // trap 22b exists to prevent. Both directions are pinned by test.
      if (input.freshness === 'unknown') {
        return {
          branch: 'analytical_indeterminate',
          intent_class: intentClass,
          has_run_analysis_fact: false,
          assistantText: input.graphReady
            ? NO_OP_INDETERMINATE_GRAPH_READY_TEXT
            : NO_OP_INDETERMINATE_GRAPH_NOT_READY_TEXT,
          // Same readiness gating as `analytical_none` below: a run_analysis
          // chip that would fail on click is worse than no chip. Running an
          // analysis is a safe way forward either way — it asserts nothing
          // about whether one has already happened.
          suggestedActions: input.graphReady ? [RUN_ANALYSIS_CHIP] : [],
        };
      }
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

  // ⭐ SPEC §4 — ANAPHORIC EDIT. Placed BEFORE the vague-edit branch because it
  // is the more specific class: the two predicates are disjoint on their object
  // (`it`/`this`/`that` vs `something`/`stuff`/`the model`), but a message that
  // somehow satisfied both should be RESOLVED rather than reset.
  //
  // The three outcomes are exhaustive and none of them is a reset:
  //   exactly 1 candidate  → BIND and disclose it
  //   more than 1          → ASK, offering the candidates
  //   0, or no/degraded    → ASK, and say what was looked at
  //     register
  if (intentClass === null && !mutationSignal && looksLikeAnaphoricEdit(input.message)) {
    // ⭐ THE DECISION IS THE COMPOSER'S `resolveAnaphoricReferent`, not a
    // predicate of this branch: top populated rank, the composer's own
    // eligibility set (`factor|option` — the first version of this branch left
    // that filter behind and bound the `outcome` MRR Growth on turn 8 of the
    // 5 Sep founder capture), and the count. The value pre-route in
    // `turn-executor.ts` calls the same function for "Set it to 100000.", so
    // the two surfaces cannot resolve one pronoun two ways.
    //
    // ⚠ ABSENCE SEMANTICS. An omitted register and a `degraded` one both mean
    // "could not look", which is NOT the same as "looked and found nothing" —
    // but all three ASK, so the distinction changes telemetry, not the user's
    // outcome. An empty `complete` register is an authoritative zero.
    //
    // ⚠ AN INELIGIBLE CANDIDATE IS NOT A RESET. Filtering to zero resolves to
    // `unresolved`, which still asks. The banned outcome stays unreachable —
    // measured, not assumed.
    const resolution = resolveAnaphoricReferent(input.referents ?? null);

    if (resolution.outcome === 'bound') {
      const bound = resolution.referent;
      return {
        branch: 'anaphoric_edit_bound',
        intent_class: null,
        has_run_analysis_fact: hasRunAnalysisFact,
        assistantText: buildAnaphoricBoundText(bound.label),
        // The chip carries the SAME message convention as every other
        // label chip, via the composer's own exported builder.
        suggestedActions: [buildLabelChip(nodeIdFromRef(bound.ref), bound.label)],
      };
    }

    if (resolution.outcome === 'ask_candidates') {
      return {
        branch: 'anaphoric_edit_ask_candidates',
        intent_class: null,
        has_run_analysis_fact: hasRunAnalysisFact,
        assistantText: ANAPHORIC_ASK_CANDIDATES_TEXT,
        suggestedActions: resolution.candidates
          .slice(0, ANAPHORIC_CANDIDATE_CHIP_CAP)
          .map((c) => buildLabelChip(nodeIdFromRef(c.ref), c.label)),
      };
    }

    return {
      branch: 'anaphoric_edit_ask_unresolved',
      intent_class: null,
      has_run_analysis_fact: hasRunAnalysisFact,
      assistantText: ANAPHORIC_ASK_UNRESOLVED_TEXT,
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


export interface DispatchEditGraphParams {
  readonly payload: MessageTurnPayload;
  readonly requestId: string;
  readonly request: FastifyRequest;
  /** Permissive ingress shape. Adapter inside converts to GraphV3T. */
  readonly graphState: GraphStateIngress;
  /** Internal combined server snapshot, consumed only by the dormant v6 path. */
  readonly persistedEditBase?: Awaited<ReturnType<typeof loadPersistedScenarioStateStrict>>;
  /** Permissive ingress shape. Adapter inside converts to V2RunResponseEnvelope. */
  readonly analysisState: AnalysisStateIngress | null;
  /**
   * Canvas selection at send time, normalised to identities by the boundary.
   * The dispatcher resolves node IDs against the same strict graph snapshot it
   * hands to edit_graph; client labels and edge inference never enter context.
   */
  readonly selectedElements?: SelectedElementsIngress | null;
  /**
   * ROADMAP 2.684 — wall-clock baseline of the HTTP request (`routeStartedAt`),
   * against which the structural-edit composer's remaining budget is derived.
   * Same thread and same rationale as `dispatchDraftGraph`'s `requestStartMs`:
   * pre-flight, ingress parse and scenario upsert all spend the turn's deadline
   * before this dispatcher is entered, so measuring from the dispatcher's own
   * start under-charges the turn.
   *
   * ⚠ OPTIONAL ONLY BECAUSE 128 TEST CALL SITES PREDATE IT — never because a
   * caller may reasonably omit it. Omitting it falls back to the dispatcher's
   * own `startedAt`, which is CONSERVATIVE (it can only over-estimate what is
   * left, never under-estimate it), so the fallback is a real hazard and not a
   * neutral default. `structural-edit-deadline-plumbing.test.ts` asserts the
   * ONE production call site (route-v2.ts) passes it, so the fallback cannot
   * become the live path without a RED.
   */
  readonly requestStartMs?: number;
  /**
   * ⭐ ROADMAP 2.1261 — repair-leg bare-value binding. When set, THIS string
   * (the advised-format instruction binding the user's bare value to the sole
   * missing option×factor pair — probe P1 verbatim, with the user's value) is
   * what the edit LLM is asked to perform, INSTEAD of `payload.message`.
   *
   * ⚠ SCOPE, deliberately narrow: it substitutes ONLY the instruction handed
   * to `handleEditGraph`. `payload.message` remains the record everywhere else
   * — the commit's `userMessage`, part-accounting decomposition, the GM
   * protection-scope extraction, telemetry — so the persisted conversation
   * carries the user's own bytes, never a synthesised sentence (trap 14b:
   * rewriting the record falsifies evidence). The route sets it only after the
   * whole-message claim anchor matched and the persisted graph derived exactly
   * one missing pair; no other caller may pass it.
   */
  readonly editInstructionOverride?: string;
  /** Server-resolved recorded question. Revalidated below; never copied from ingress. */
  readonly recordedEffectAnswer?: RecordedEffectAnswer;
}


export interface DispatchEditGraphResult {
  readonly response: OlumiResponse;
  readonly commitPerformed: boolean;
  /**
   * V5 finaliser contract: pre-computed canonical readiness from the
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
  /**
   * S3-L6 / F-5 — edit-lane LLM call attribution for `_diagnostic_trace`.
   * Present only when this edit turn actually invoked the LLM; route-v2
   * threads it into the minimal trace's `llm_calls[]` (role `edit_graph`).
   * Undefined on deterministic (no-LLM) edit exits and on the commit-failure
   * path (that path returns a 500 before route-v2 builds a trace). See
   * `extractEditLlmCallTelemetry`.
   */
  readonly editLlmCall?: EditGraphLlmCallTelemetry;
  /**
   * ⭐ THE EDIT LANE IS NON-TERMINAL WHEN IT RESOLVED NOTHING.
   *
   * `true` when this dispatch applied nothing, proposed nothing, and could do
   * no more than ask "which one?" with NO alternatives to offer — the
   * `resolutionMode === 'clarify'` branch whose target resolution carried an
   * empty alternatives list. Route-v2 treats it as a hand-back: it does NOT
   * return the edit 200, and the turn falls through to `runTurnExecutor`, which
   * holds the context pack and therefore `run_delta`.
   *
   * ⚠ WHY THIS IS RETURNED **PRE-COMMIT**, and it is the whole reason the flag
   * exists rather than route-v2 inspecting `graph`/`commitPerformed`: this
   * function commits via `commitDirectAnswer` below, and `runTurnExecutor`
   * commits too. A fall-through decided AFTER that commit would write TWO turn
   * rows for ONE turn — fail-open, silent, no exception, green suite. So the
   * early return happens BEFORE the commit region and this result carries
   * `commitPerformed: false` with nothing persisted. Route-v2's fall-through
   * branch therefore sits ABOVE its `!commitPerformed` 500.
   *
   * ⛔ DELIBERATELY NARROW, and derived from the PRODUCER rather than
   * re-asserted: `pendingClarification` is assigned at exactly ONE site
   * (`orchestrator/tools/edit-graph.ts:2033/2045`) and its `candidate_labels`
   * IS `targetResolution.alternatives.map(a => a.label)`. Of the thirteen
   * `appliedGraph: null` returns in that file, exactly one sets it — so this
   * condition is provably exhaustive AND provably narrow. Ambiguous GENUINE
   * edits that resolve alternatives keep their current route: they get a useful
   * "Which option: A or B?" with chips, and that is worth more than a run
   * delta. Absent (never `false`) on every other exit.
   */
  readonly unresolvedClarificationFellThrough?: true;
}


type BoundaryAction = OlumiResponse['suggested_actions'][number];


/**
 * ROADMAP 2.1003 — the sentence that lied.
 *
 * The prior fallback was
 *   `Applied edit. Graph now has N nodes and M edges.`
 * whose truth condition was `appliedGraph != null` — PRESENCE OF A GRAPH, not
 * occurrence of a change and not identity of the object changed. Measured on
 * deployed staging: an identical replay produced no new graph identity and
 * still read "Applied edit. Graph now has 21 nodes and 43 edges."
 *
 * Three properties this composer now has, in order of precedence:
 *  1. An UNCHANGED model is stated as unchanged, explicitly, and never
 *     described as an application. `modelUnchanged === true` is a positive
 *     verdict from one local comparator over both graphs; `undefined` means
 *     "could not tell" and deliberately does NOT reach this branch (a guess is
 *     not a verdict).
 *  2. A real change is described by the DETERMINISTIC RECEIPT
 *     (`appliedChanges.summary`, built by `buildAppliedChanges` from the
 *     operation list AND both graphs — "<Label>: <old> -> <new>"), not by a
 *     node/edge count. The count was true of a no-change apply and true of a
 *     wrong-object apply; the receipt names the entity and the transition.
 *  3. Only when neither is available does it fall back to the count.
 *
 * Wholesale replacement, per the discipline already recorded at the 2.427
 * site: a success sentence followed by a correction is still a success
 * sentence.
 */
export function composeEditFallbackText(result: EditGraphResult): string {
  if (result.wasRejected) return 'The proposed edit was rejected.';
  if (!result.appliedGraph) return 'Edit processed.';

  if (result.modelUnchanged === true) {
    return 'No change: the model already matched that. Nothing was updated.';
  }

  const receipt = result.appliedChanges?.summary;
  if (typeof receipt === 'string' && receipt.trim().length > 0) {
    return receipt.trim();
  }

  return `Applied edit. Graph now has ${result.appliedGraph.nodes?.length ?? 0} nodes and ${result.appliedGraph.edges?.length ?? 0} edges.`;
}


/**
 * ROADMAP 2.1003 — WHOLESALE REPLACEMENT on a proven no-change turn.
 *
 * The discipline is already recorded at the 2.427 site: "REFUSE, rather than
 * confirm-with-a-caveat. The text is replaced WHOLESALE: a success sentence
 * followed by a correction is still a success sentence."
 *
 * The LLM's prose is authored BEFORE the applied graph comes back, so it
 * cannot know the model did not move — on the measured replay it happily said
 * the graph had changed. On `modelUnchanged === true` it is therefore
 * REPLACED, never appended to. `undefined` (no verdict) leaves today's
 * behaviour byte-identical.
 *
 * Named and exported rather than inlined so the rule is a concept with its own
 * test, not an expression nobody can point a mutant at.
 */
export function selectEditAssistantText(result: EditGraphResult, fallback: string): string {
  if (result.modelUnchanged === true) return fallback;
  return result.assistantText ?? fallback;
}


/**
 * ⭐⭐ AN EDIT ON A STRUCTURALLY-INVALID BASE NEVER WRITES (writer audit
 * 27 Sep 2026, `field_loss` #5; reproduced at CEE staging `ec90bc88`).
 *
 * `buildStructuralFallback` hands `handleEditGraph` bare `{id, kind, label}`
 * nodes and inert-default edges. The handler applies the edit to THAT, skips
 * strict validation because the base is invalid, and
 * `mergeAppliedGraphForPersistence` replaced the stored `nodes`/`edges` with
 * the result — so one rename wiped `observed_state`, `interventions`,
 * `goal_threshold*`, `category`, provenance … from EVERY element, and the
 * `std: 0` it wrote kept the base invalid, so every later edit wiped again.
 * Measured on a real served graph with one `std: 0` edge: one rename changed
 * 10/10 nodes and 12/12 edges (GM mode `shadow`/`off`); in GM mode `live` the
 * same wipe committed through a batch that projects to zero referee envelopes,
 * under the reply "No change … Nothing was updated."
 *
 * WHY WITHHOLD, NOT MERGE. Carrying the stored raw form for the untouched
 * elements would stop their wipe, but the TARGETED element's result is itself
 * computed against the fallback, and is lossy in ways no merge can repair.
 * Measured on the same graph: a value write the valid path refuses as
 * scale-ambiguous ("0.05 reads as a proportion, but … is recorded as an
 * amount") APPLIED on the fallback — the screen reads the `scale_frame` /
 * `raw_value` the fallback had dropped — and landed as `{value, source}` with
 * no `raw_value`, so a merge would pair the new `value` with the stored
 * `raw_value` (which the formatter reads first). A strength write landed as the
 * inert `{mean: 0, std: 0}`. So the one safe rule is the one the sibling
 * writers already keep on an unparseable persisted graph
 * (`applyAndValidateMutation`, `edge_strength_edit`): fail closed, write
 * nothing, and say so — with a typed code and the NOTHING-FAILS-SILENTLY
 * disclosure (request id, fault `olumi`, plain English).
 *
 * @internal Exported for testing.
 */
export const BASE_GRAPH_INVALID_REJECTION_CODE = 'BASE_GRAPH_INVALID' as const;

export const BASE_GRAPH_INVALID_ASSISTANT_TEXT =
  "I haven't changed anything. The saved copy of this model has a fault on our side, " +
  "and editing it now could erase details you didn't ask me to touch. " +
  'This model needs a repair before it can be edited.';


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
 * ⚠ NOT INTERCHANGEABLE with its near-identical twin
 * `mergeMutatedGraphForPersistence` (d1-shared/apply-graph-mutation.ts). Each is
 * WRONG on the other's path, in opposite directions: this one PRUNES deleted
 * `options[]` entries (rule 4 above) and does NOT overlay top-level
 * `goal_constraints`; the D1 twin does the exact opposite. Swapping them
 * reproduces a real defect one field over. The difference is pinned by
 * `orchestrator-v5/__tests__/persist-merge-twins-are-not-interchangeable.test.ts`
 * — change either twin and read that file first.
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

  // Generic edit/system-event merges have no authority to mint or rebind the
  // stamp. Compare with the same stored base the merge will actually use.
  if (hasReliesOnRiskStampChange(base, appliedGraph)) {
    throw new Error('A precondition risk needs its dedicated proposal and approval; nothing was changed.');
  }

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
