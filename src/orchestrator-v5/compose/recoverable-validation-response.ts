/**
 * V5 alpha hardening Phase 2.2 — recoverable validator-outcome wrapper.
 *
 * Every `ValidationErrorCode` is a Sonnet imperfection: the routing model
 * proposed an action we cannot safely execute. Per principle 1 ("deterministic
 * layer is a safety net, not a cage"), the turn recovers as coaching — a
 * clean, product-voice response with helpful next-step chips, committed as a
 * direct_answer turn so HTTP returns 200. None of the validator outcomes
 * are infrastructure faults; the only genuinely fatal paths are commit
 * failure, dispatch invariants, and upstream bugs (see Part B of the
 * resilience contract).
 *
 * This wrapper reuses `composeBody` from validation-failure-responses.ts so
 * the per-code copy / chip logic stays in one place. The only difference is
 * the absence of the error-block wrapper — recoverable responses ship a
 * clean OlumiResponse, matching the shape `composeUnsupportedActionResponse`
 * already returns for HANDLER_NOT_FOUND (committed pattern since 7aa1d8fb).
 *
 * The legacy `composeValidationFailure` wrapper is kept as the
 * impossible-state 500 safety net: if the composer map is ever missing a
 * `ValidationErrorCode` (compile-time exhaustiveness broken) it still
 * fails loudly with a typed BoundaryError rather than a silent no-op.
 */

import type { OlumiResponse, StageType } from '@talchain/schemas/boundary';

import type { ValidationError } from '../routing/validator.js';

import type { ChipType, ComposeContext } from './types.js';
import { composeBody } from './validation-failure-responses.js';

export interface ComposedRecoverableValidation {
  readonly response: OlumiResponse;
  readonly template_id: string;
  readonly chip_type: ChipType | null;
}

/**
 * Compose a clean-body (no error block) 200 response for a recoverable
 * validator outcome. The body + template_id + chip_type come from the
 * shared per-code composer map, so adding a new `ValidationErrorCode`
 * automatically flows through here once the map gains an entry.
 *
 * V5 finaliser contract: this composer must NOT set `analysis_ready`. The
 * response-finaliser stamps it from the dispatch path's pre-computed
 * payload after composition. See src/orchestrator-v5/response-finaliser.ts.
 */
export function composeRecoverableValidationResponse(
  error: ValidationError,
  ctx: ComposeContext,
  stage: StageType,
): ComposedRecoverableValidation {
  const result = composeBody(error, ctx);
  return {
    response: {
      response_version: 2,
      assistant_text: result.body.assistant_text,
      blocks: [],
      suggested_actions: [...result.body.suggested_actions],
      insights: [],
      stage_indicator: stage,
    },
    template_id: result.template_id,
    chip_type: result.chip_type,
  };
}
