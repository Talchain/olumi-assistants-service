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
