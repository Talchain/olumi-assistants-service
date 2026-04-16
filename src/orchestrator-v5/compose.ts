/**
 * Compose a successful OlumiResponse for a direct_answer turn (A1).
 *
 * Per Pre-impl A and Paul's constraint 6: A1 `OlumiResponse` for direct_answer
 * is strictly the 6 schema-required fields — no `updated_session_state`, no
 * `insights`, no `suggested_actions`. The schema requires arrays so we emit [].
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
