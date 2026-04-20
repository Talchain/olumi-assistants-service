/**
 * Compose a successful OlumiResponse for A2 turn classes.
 *
 * Per Pre-impl A and Paul's constraint 6: OlumiResponse is strictly the 6
 * schema-required fields — no `updated_session_state`, no extra keys. The
 * schema requires arrays so we emit [] for `blocks`, `suggested_actions`,
 * `insights`.
 *
 * A2 adds `composeClarifyResponse`. Its output is structurally identical to
 * `composeDirectAnswerResponse` (text-only). A2 emits no chips, no blocks —
 * widening to chips lands in E2.
 */

import type { OlumiResponse, StageType } from '@talchain/schemas/boundary';
import type { HandlerFact } from '@talchain/schemas/orchestrator';

export interface ComposeInput {
  assistant_text: string;
  stage: StageType;
}

export function composeDirectAnswerResponse(input: ComposeInput): OlumiResponse {
  return {
    response_version: 2,
    assistant_text: input.assistant_text,
    blocks: [],
    suggested_actions: [],
    insights: [],
    stage_indicator: input.stage,
  };
}

export function composeClarifyResponse(input: ComposeInput): OlumiResponse {
  return {
    response_version: 2,
    assistant_text: input.assistant_text,
    blocks: [],
    suggested_actions: [],
    insights: [],
    stage_indicator: input.stage,
  };
}

/**
 * V5 Phase 1 — composeToolCallResponse.
 *
 * Assembles the final OlumiResponse from three deterministic inputs on an
 * execute turn (spec §4.1 step 6):
 *
 *  - orientation: pre-action text from Sonnet (context, not outcomes)
 *  - confirmation: deterministic "what happened" text rendered from the
 *                  handler outcome via the handler's registered
 *                  confirmationTemplate (brief correction 5)
 *  - coaching: null stub for Phase 1a (spec step 5 is a no-op in this brief)
 *
 * Output shape is identical to composeDirectAnswerResponse — only the
 * assistant_text composition differs. Text fragments are joined with a
 * single blank line when both orientation and confirmation are non-empty;
 * otherwise the non-empty one stands alone.
 */
export interface ComposeToolCallInput {
  readonly orientation: string;
  readonly confirmation: string;
  readonly coaching: string | null;
  readonly stage: StageType;
  /**
   * V5 Group 1 Task B: when the turn's handler facts include a run_analysis
   * fact, compose emits an `analysis_result` block carrying the minimal
   * result fields plus the opaque enrichment (which may carry
   * `decision_review` under enrichment when the auto-fire completed).
   * Undefined for handler turns that do not produce this fact shape.
   */
  readonly handlerFacts?: readonly HandlerFact[];
}

export function composeToolCallResponse(input: ComposeToolCallInput): OlumiResponse {
  const pieces: string[] = [];
  const trimmedOrientation = input.orientation.trim();
  const trimmedConfirmation = input.confirmation.trim();
  if (trimmedOrientation) pieces.push(trimmedOrientation);
  if (trimmedConfirmation) pieces.push(trimmedConfirmation);
  if (input.coaching) pieces.push(input.coaching.trim());

  const blocks = input.handlerFacts ? buildBlocksFromFacts(input.handlerFacts) : [];

  return {
    response_version: 2,
    assistant_text: pieces.join('\n\n'),
    blocks,
    suggested_actions: [],
    insights: [],
    stage_indicator: input.stage,
  };
}

/**
 * Map recognised handler facts to OlumiResponse blocks. Only the shapes
 * listed in the boundary-schema discriminated union are emitted; unknown
 * or composer-irrelevant fact types (e.g. set_factor_value) do not produce
 * blocks on this path (graph-patch emission stays elsewhere).
 */
function buildBlocksFromFacts(
  facts: readonly HandlerFact[],
): OlumiResponse['blocks'] {
  const blocks: OlumiResponse['blocks'] = [];
  for (const fact of facts) {
    if (fact.fact_type === 'run_analysis') {
      const { leading_option_id, summary, win_probabilities, enrichment } = fact.result;
      blocks.push({
        type: 'analysis_result',
        summary,
        leading_option_id,
        ...(win_probabilities !== undefined ? { win_probabilities } : {}),
        ...(enrichment !== undefined ? { enrichment } : {}),
      });
    }
  }
  return blocks;
}
