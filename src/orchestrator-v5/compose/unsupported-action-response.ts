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
import type { ComposeContext, SuggestedAction } from './types.js';
import {
  attachComputedAt,
  type AnalysisReadyPayload,
} from './analysis-ready-emit.js';

/** Coarse category used to pick copy. */
type HandlerCategory = 'structural' | 'value_change' | 'analysis_dep' | 'generic';

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
  if (STRUCTURAL_HANDLERS.has(handlerId)) return 'structural';
  if (VALUE_HANDLERS.has(handlerId)) return 'value_change';
  if (ANALYSIS_DEP_HANDLERS.has(handlerId)) return 'analysis_dep';
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
  /**
   * V5 analysis_ready contract: when the turn had graph state, TurnExecutor
   * passes the pre-computed structural readiness so the unsupported-action
   * coaching response also carries it on the wire — keeps the contract
   * "every graph-bearing response carries analysis_ready" total.
   */
  readonly analysisReady?: AnalysisReadyPayload;
}

export interface ComposedUnsupportedAction {
  readonly response: OlumiResponse;
  readonly templateId: string;
  readonly category: HandlerCategory;
}

export function composeUnsupportedActionResponse(
  input: ComposeUnsupportedActionInput,
): ComposedUnsupportedAction {
  const { handlerId, context, stage, hasAnalysis, analysisReady } = input;
  const category = categorise(handlerId);
  const safeHandlerId = sanitiseForUser(handlerId);

  const chips = buildChips(context, category, hasAnalysis);
  const assistantText = buildText(category, safeHandlerId, hasAnalysis);

  return {
    response: {
      response_version: 2,
      assistant_text: assistantText,
      blocks: [],
      suggested_actions: [...chips],
      insights: [],
      stage_indicator: stage,
      ...(analysisReady && { analysis_ready: attachComputedAt(analysisReady) }),
    },
    templateId: `unsupported_action_${category}`,
    category,
  };
}

function buildText(
  category: HandlerCategory,
  safeHandlerId: string,
  hasAnalysis: boolean,
): string {
  switch (category) {
    case 'structural':
      return (
        "I can't make structural changes to the model through chat in this version. " +
        `You can make this change (${safeHandlerId.replace(/_/g, ' ')}) directly on the canvas, ` +
        'then come back and I can run the analysis on the updated model.'
      );
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

function buildChips(
  context: ComposeContext,
  category: HandlerCategory,
  hasAnalysis: boolean,
): readonly SuggestedAction[] {
  // Only surface chips for handlers actually in the registry. For every
  // category the primary next step is run_analysis when it's registered —
  // that's the only handler the UI can currently fire end-to-end.
  const curated = curatedHandlerChips(context.handlerRegistry);
  if (curated.length === 0) {
    // Registry has nothing to offer — fall back to a text-prompt chip so the
    // user still has a visible next step. The compose layer's contract is
    // "every path produces at least one chip".
    return [
      {
        id: chipId('prompt', `unsupported_${category}`),
        label:
          category === 'analysis_dep' && !hasAnalysis
            ? 'Tell me what you want to know'
            : 'Ask a different question',
        message:
          category === 'analysis_dep' && !hasAnalysis
            ? 'I want to run the analysis first.'
            : "Let's try a different approach.",
      },
    ];
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
