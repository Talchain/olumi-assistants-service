/**
 * Graceful composer for "routing proposed an action that isn't registered
 * in this deployment".
 *
 * Contract: returns a clean OlumiResponse (no error block) with contextual
 * coaching text and a chip pointing at an available action. The caller
 * (TurnExecutor) commits this as a direct_answer turn so the HTTP layer
 * returns 200, not 500. This is the "not yet available" path: the user
 * asked for something sensible that this deployment can't do through chat
 * yet, and we reply with a pointer to what they can do instead.
 *
 * Category mapping drives the phrasing:
 *   - structural       add_option, add_factor, remove_factor, edit_graph
 *                      add_node, remove_node, add_edge, remove_edge
 *   - value_change     set_factor_value, adjust_edge_strength, add_constraint
 *                      remove_constraint, set_edge_strength
 *   - analysis_dep     explain_result, explain_results, compare_options,
 *                      what_would_flip, generate_brief
 *
 * Handler IDs outside those buckets fall through to a generic template.
 *
 * Why a distinct composer rather than reusing composeValidationFailure:
 *   - validation-failure-responses.ts wraps everything in an error block
 *     (FEATURE_NOT_ENABLED wire code). That block cues the UI to render the
 *     "Something went wrong" fallback when the route returns 500. Here we
 *     want a normal conversational response body — no error block — so the
 *     UI surfaces the coaching text and chip as a regular turn.
 *   - The text quality bar is higher here (must reference the specific
 *     handler_id and avoid developer terminology), which calls for template
 *     dispatch rather than the generic per-code branches.
 */

import type { OlumiResponse, StageType } from '@talchain/schemas/boundary';

import { curatedHandlerChips, sanitiseForUser } from './helpers.js';
import { GRAPH_MUTATING_HANDLER_IDS } from '../routing/mutation-consent.js';
import type { HandlerValidationRegistry } from '../routing/validator.js';
import type { ComposeContext, SuggestedAction } from './types.js';

/**
 * ⭐ ROADMAP 2.663 rider — WHAT CHAT CAN ACTUALLY DO, in the user's words.
 *
 * Keyed by handler id so the sentence is DERIVED from the live registry
 * (`supportedMutationPhrases`) rather than written out beside it. The
 * structural template used to deny structural editing outright; on a
 * deployment where these three are registered that sentence is false, and the
 * consent-witness walk caught a user reading it two turns after chat had added
 * a constraint for them.
 *
 * ⚠ THIS TABLE IS A HAND-WRITTEN LIST AND THEREFORE THE PART THAT CAN GO SHORT
 * (CLAUDE.md trap 12d: derivation proves agreement, never completeness). It is
 * pinned BOTH WAYS against `GRAPH_MUTATING_HANDLER_IDS` in
 * `__tests__/unsupported-action-capability-honesty.test.ts` — a new mutating
 * handler with no phrase REDs, and a phrase for a non-mutating handler REDs —
 * so it cannot drift out of the sentence silently.
 */
export const MUTATION_CAPABILITY_PHRASES: Readonly<Record<string, string>> = {
  add_constraint: 'add a limit',
  set_factor_value: "set a factor's value",
  adjust_edge_strength: 'change how strongly one factor affects another',
};

/**
 * The phrases for the mutating handlers this deployment actually registers,
 * in the table's declared order. Empty when none are registered — in which
 * case the blanket denial below is TRUE and is kept.
 */
function supportedMutationPhrases(
  registry: HandlerValidationRegistry,
): readonly string[] {
  return Object.entries(MUTATION_CAPABILITY_PHRASES)
    .filter(([id]) => GRAPH_MUTATING_HANDLER_IDS.has(id))
    // `HandlerValidationRegistry` IS `Readonly<Record<string, …>>`, so this
    // indexes directly. (An `as unknown as Record<string, unknown>` cast here
    // was pointless and tripped the forbidden-boundary ratchet, correctly.)
    .filter(([id]) => registry[id] != null)
    .map(([, phrase]) => phrase);
}

/** "a, b or c" — house style, no Oxford comma, no em dash. */
function joinPhrases(phrases: readonly string[]): string {
  if (phrases.length <= 1) return phrases[0] ?? '';
  return `${phrases.slice(0, -1).join(', ')} or ${phrases[phrases.length - 1]!}`;
}

/**
 * ⭐ THE `draft_graph` LIMB OF THE SAME HONESTY RULE (25 Aug 2026).
 *
 * Capabilities this deployment GENUINELY PROVIDES, but through a dispatch
 * path that is not the validator's handler registry. `draft_graph` is
 * dispatched by route-v2 BEFORE routing (`dispatchDraftGraph`, no flag), so
 * it is deliberately absent from both `HANDLER_VALIDATION_REGISTRY` and the
 * routing tool-schema enum. When the routing model proposes it anyway — an
 * out-of-enum proposal, which is the ONLY way this composer is reachable —
 * the validator returns HANDLER_NOT_FOUND and the generic template used to
 * assert a version-level capability limit.
 *
 * WITNESSED on deployed staging, 25 Aug 2026 (1 of 14 fresh-guest runs;
 * drafting succeeded in 12 of the other 13 on the same deploy):
 *   "I can't do draft graph through chat in this version."
 * Drafting from a brief is the product's PRIMARY capability. The sentence
 * denied a capability the deployment has, and offered no route to a model.
 *
 * The values are the USER-FACING phrasing of the capability, so the honest
 * copy is DERIVED from this table rather than written out beside it.
 *
 * ⚠ HAND-WRITTEN LIST — the part that can go short (CLAUDE.md trap 12d).
 * Pinned BOTH WAYS in `__tests__/unsupported-action-draft-capability-honesty
 * .test.ts`: every id here must be ABSENT from the validation registry AND
 * from the tool-schema enum, so an id that becomes a real handler REDs
 * instead of keeping a dead honesty branch.
 */
export const SYSTEM_DISPATCHED_CAPABILITY_PHRASES: Readonly<Record<string, string>> = {
  draft_graph: 'build a model from your decision brief',
};

/** Coarse category used to pick copy. */
type HandlerCategory =
  | 'structural'
  | 'value_change'
  | 'analysis_dep'
  | 'system_dispatched'
  | 'generic';

const STRUCTURAL_HANDLERS = new Set([
  'add_option',
  'add_factor',
  'remove_factor',
  'edit_graph',
  'add_node',
  'remove_node',
  'add_edge',
  'remove_edge',
]);

const VALUE_HANDLERS = new Set([
  'set_factor_value',
  'adjust_edge_strength',
  'add_constraint',
  'remove_constraint',
  'set_edge_strength',
]);

const ANALYSIS_DEP_HANDLERS = new Set([
  'explain_result',
  'explain_results',
  'compare_options',
  'what_would_flip',
  'generate_brief',
  'summarise_decision',
]);

function categorise(handlerId: string): HandlerCategory {
  // Order is load-bearing and deliberately ADDITIVE: the three named buckets
  // keep first claim, so no existing categorisation moves (the 2.663
  // structural branch owns `edit_graph` and must keep it — pinned by the
  // regression twin). `system_dispatched` intercepts ONLY what would
  // otherwise have fallen through to the generic version-limit denial.
  if (STRUCTURAL_HANDLERS.has(handlerId)) return 'structural';
  if (VALUE_HANDLERS.has(handlerId)) return 'value_change';
  if (ANALYSIS_DEP_HANDLERS.has(handlerId)) return 'analysis_dep';
  if (SYSTEM_DISPATCHED_CAPABILITY_PHRASES[handlerId] != null) return 'system_dispatched';
  return 'generic';
}

export interface ComposeUnsupportedActionInput {
  readonly handlerId: string;
  readonly context: ComposeContext;
  readonly stage: StageType;
  /**
   * True when an analysis envelope is available on this turn. Drives the
   * analysis-dependent path: if analysis exists, suggest the user retry the
   * request now that results are present; if not, suggest running analysis
   * first.
   */
  readonly hasAnalysis: boolean;
}

export interface ComposedUnsupportedAction {
  readonly response: OlumiResponse;
  readonly templateId: string;
  readonly category: HandlerCategory;
}

export function composeUnsupportedActionResponse(
  input: ComposeUnsupportedActionInput,
): ComposedUnsupportedAction {
  const { handlerId, context, stage, hasAnalysis } = input;
  const category = categorise(handlerId);
  const safeHandlerId = sanitiseForUser(handlerId);

  const chips = buildChips(context, category, hasAnalysis);
  const assistantText = buildText(
    category,
    safeHandlerId,
    hasAnalysis,
    supportedMutationPhrases(context.handlerRegistry),
    // Looked up on the RAW handler id: the table is keyed by wire ids, and
    // `sanitiseForUser` is a user-facing transform, not an identity.
    SYSTEM_DISPATCHED_CAPABILITY_PHRASES[handlerId] ?? null,
  );

  return {
    response: {
      response_version: 2,
      assistant_text: assistantText,
      blocks: [],
      suggested_actions: [...chips],
      insights: [],
      stage_indicator: stage,
    },
    templateId: `unsupported_action_${category}`,
    category,
  };
}

function buildText(
  category: HandlerCategory,
  safeHandlerId: string,
  hasAnalysis: boolean,
  supportedMutations: readonly string[],
  systemDispatchedPhrase: string | null,
): string {
  switch (category) {
    case 'system_dispatched': {
      // The capability EXISTS; it simply is not reachable as a validator
      // handler, which is an implementation fact and never a product limit.
      //
      // Three constraints this copy is written against, in order:
      //  1. It must not claim a version-level capability limit.
      //  2. It must offer a next action the user can actually take. That
      //     action is TYPED TEXT, deliberately not a chip: route-v2's draft
      //     heuristic excludes `source === 'chip_click'` outright, so a chip
      //     can never reach the draft dispatch. Offering one would be a
      //     second dead-end affordance dressed as a fix.
      //  3. It must assert NOTHING about model or analysis state. This
      //     composer has no view of the persisted graph, and the same path is
      //     reachable on a continuation scenario that already holds a model —
      //     so "nothing was built" would be false exactly where it mattered.
      const phrase = systemDispatchedPhrase ?? 'do that';
      return (
        `I can ${phrase}. I couldn't read that message as a brief, though. ` +
        "Tell me the decision you're weighing and the options you're choosing " +
        "between, and I'll draft it."
      );
    }
    case 'structural': {
      const canvasFallback =
        `You can make this change (${safeHandlerId.replace(/_/g, ' ')}) directly on the canvas, ` +
        'then come back and I can run the analysis on the updated model.';
      // ROADMAP 2.663 rider. The blanket denial is only true when this
      // deployment registers NO graph-mutating handler. When it does, deny the
      // NARROW thing that is genuinely unavailable and say what is not — the
      // witnessed defect was a user reading "I can't make structural changes
      // through chat" two turns after chat had added a constraint for them.
      if (supportedMutations.length === 0) {
        return (
          "I can't make structural changes to the model through chat in this version. " +
          canvasFallback
        );
      }
      return (
        `I can't do that one (${safeHandlerId.replace(/_/g, ' ')}) through chat yet. ` +
        `Through chat I can ${joinPhrases(supportedMutations)}. ` +
        canvasFallback
      );
    }
    case 'value_change':
      return (
        `Direct value updates like ${safeHandlerId.replace(/_/g, ' ')} aren't available through chat yet. ` +
        'You can adjust values in the inspector panel on the right, and once updated ' +
        "I can run the analysis with your new numbers."
      );
    case 'analysis_dep':
      if (hasAnalysis) {
        return (
          `I can't run ${safeHandlerId.replace(/_/g, ' ')} as a separate step yet, but the analysis ` +
          'has already produced results for this decision. Ask a follow-up question about the options ' +
          "or drivers and I'll work from those results."
        );
      }
      return (
        `That needs analysis results first. Run the analysis, and then I can dig into ` +
        `${safeHandlerId.replace(/_/g, ' ')} for you.`
      );
    case 'generic':
    default:
      return (
        `I can't do ${safeHandlerId.replace(/_/g, ' ')} through chat in this version. ` +
        "Here's what I can help with right now — ask a follow-up, or try one of the suggestions below."
      );
  }
}

/**
 * The text-prompt chip for a category, used wherever a handler chip would be
 * wrong or unavailable. Free text, no `action_type`: it goes back through
 * routing rather than firing a handler, so it is live on every scenario state.
 */
function textPromptChip(category: HandlerCategory, hasAnalysis: boolean): SuggestedAction {
  if (category === 'system_dispatched') {
    // Agrees with the sentence beside it, which asks the user to describe
    // their decision. Deliberately a QUESTION ABOUT the brief, never a canned
    // brief: a canned brief would arrive as `source: 'chip_click'` and be
    // excluded from the draft heuristic, which is the dead end this branch
    // exists to avoid.
    return {
      id: chipId('prompt', `unsupported_${category}`),
      label: 'What should I include?',
      message: 'What should I include when I describe my decision?',
    };
  }
  if (category === 'analysis_dep' && !hasAnalysis) {
    return {
      id: chipId('prompt', `unsupported_${category}`),
      label: 'Tell me what you want to know',
      message: 'I want to run the analysis first.',
    };
  }
  return {
    id: chipId('prompt', `unsupported_${category}`),
    label: 'Ask a different question',
    message: "Let's try a different approach.",
  };
}

function buildChips(
  context: ComposeContext,
  category: HandlerCategory,
  hasAnalysis: boolean,
): readonly SuggestedAction[] {
  // ⭐ THE `system_dispatched` LIMB — A CHIP MUST NOT PROMISE WHAT THE CLICK
  // CANNOT DELIVER (25 Aug 2026).
  //
  // Every other category's next step is `run_analysis`, and it is a real one:
  // the user was editing or interrogating a model, so a model exists. This
  // branch is the exception. It is reached when the routing model proposes
  // `draft_graph` out of its own enum — i.e. the user asked for a MODEL TO BE
  // BUILT — and the reachable population includes the user who has none.
  // `curatedHandlerChips` can only ever return `run_analysis`
  // (`USER_FACING_HANDLERS`), so this path was handing that user a button
  // whose only possible outcome is a refusal: there is nothing to analyse.
  //
  // The chip is not merely re-pointed at drafting, because no chip can draft
  // from here. Drafting is chip-reachable ONLY through the draft-offer
  // pending-action resume (`resolveDraftOfferResume`, `copy_replay`), which
  // needs a COMMITTED `draft_graph` pending carrying a brief seed. This
  // composer commits nothing and — by construction — holds no usable seed:
  // the message failed to read as a brief, which is why we are here. Absent
  // that pending, a click falls through to the draft HEURISTIC, whose
  // `draftShapedTurn` conjunction excludes `source === 'chip_click'` outright.
  //
  // Note what is deliberately NOT done: no model-state view is consulted. The
  // composer has none (see `buildText` constraint 3), and it needs none — on
  // this path the user asked to DRAFT, so `run_analysis` answers a question
  // they did not ask in EITHER direction. The continuation that DOES hold a
  // model gets the same live text prompt rather than a chip aimed elsewhere,
  // and is pinned that way in
  // `__tests__/unsupported-action-draft-chip-honesty.test.ts`.
  if (category === 'system_dispatched') {
    return [textPromptChip(category, hasAnalysis)];
  }

  // Only surface chips for handlers actually in the registry. For every
  // remaining category the primary next step is run_analysis when it's
  // registered — that's the only handler the UI can currently fire end-to-end.
  const curated = curatedHandlerChips(context.handlerRegistry);
  if (curated.length === 0) {
    // Registry has nothing to offer — fall back to a text-prompt chip so the
    // user still has a visible next step. The compose layer's contract is
    // "every path produces at least one chip".
    return [textPromptChip(category, hasAnalysis)];
  }
  return curated.map(
    (h): SuggestedAction => ({
      id: chipId('action', h.handler_id),
      label: h.label,
      message: `${h.label}.`,
      action_type: h.handler_id as SuggestedAction['action_type'],
    }),
  );
}

function chipId(scope: 'action' | 'entity' | 'prompt', discriminator: string): string {
  return `chip_${scope}_${discriminator}`.toLowerCase().replace(/[^a-z0-9_]/g, '_');
}
