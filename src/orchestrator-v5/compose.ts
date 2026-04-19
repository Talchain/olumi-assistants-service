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
}

export function composeToolCallResponse(input: ComposeToolCallInput): OlumiResponse {
  const pieces: string[] = [];
  const trimmedOrientation = input.orientation.trim();
  const trimmedConfirmation = input.confirmation.trim();
  if (trimmedOrientation) pieces.push(trimmedOrientation);
  if (trimmedConfirmation) pieces.push(trimmedConfirmation);
  if (input.coaching) pieces.push(input.coaching.trim());

  return {
    response_version: 2,
    assistant_text: pieces.join('\n\n'),
    blocks: [],
    suggested_actions: [],
    insights: [],
    stage_indicator: input.stage,
  };
}
