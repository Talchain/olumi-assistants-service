/**
 * V5 alpha hardening Phase 2.6 — recoverable handler-cause wrapper.
 *
 * Mirrors `composeRecoverableValidationResponse` (Phase 2.2). The 7
 * locked recoverable handler causes recover as clean-body 200 turns
 * committed as `direct_answer`, instead of returning the
 * `composeHandlerFailure` 500 envelope with an `error` block.
 *
 * Reuses `composeHandlerFailureBody` from `handler-failure-responses.ts`
 * so the per-cause assistant_text and chip stay in one place. The only
 * difference between the recoverable and fatal compositions is the
 * absence of the error-block wrapper — the response shape matches the
 * pattern `composeUnsupportedActionResponse` already returns
 * (committed in Phase 2.2 / 7aa1d8fb).
 *
 * The fatal `composeHandlerFailure` wrapper remains as the safety net
 * for non-recoverable causes and as the impossible-state guard for any
 * `cause_kind` accidentally treated as recoverable without a composer
 * branch (the per-cause switch's `default` produces `template_id:
 * 'fallback'`, which the catch ladder treats as a hard fail).
 */

import type { OlumiResponse, StageType } from '@talchain/schemas/boundary';

import type { HandlerInvocationFailedError } from '../tools/handler-errors.js';

import type { ChipType, ComposeContext } from './types.js';
import { composeHandlerFailureBody } from './handler-failure-responses.js';

export interface ComposedRecoverableHandler {
  readonly response: OlumiResponse;
  readonly template_id: string;
  readonly chip_type: ChipType | null;
}

/**
 * Compose a clean-body (no error block) 200 response for a recoverable
 * handler-invocation failure. The body + template_id + chip_type come
 * from the shared per-cause composer in `handler-failure-responses.ts`
 * so adding a new `HandlerInvocationFailedCause` automatically flows
 * through here once the switch gains an entry.
 *
 * V5 finaliser contract: this composer must NOT set `analysis_ready`.
 * The response-finaliser stamps it from the dispatch path's
 * pre-computed payload after composition. See
 * `src/orchestrator-v5/response-finaliser.ts`.
 */
export function composeRecoverableHandlerResponse(
  error: HandlerInvocationFailedError,
  _ctx: ComposeContext,
  stage: StageType,
): ComposedRecoverableHandler {
  const result = composeHandlerFailureBody(error);
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
