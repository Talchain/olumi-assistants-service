/**
 * Maps an internal failure class to a well-formed OlumiResponse with an
 * ErrorBlock, using `FAILURE_USER_TEXT` for the user-visible string.
 *
 * Every runtime failure → HTTP 200 + typed `OlumiResponse` per addendum §2.1.5.
 * B1 contract failures (ingress/egress Zod parse) are handled by `validators/b1.ts`
 * and return HTTP 422 — this module is for TurnExecutor runtime failures only.
 */

import type { OlumiResponse, FailureTypeLiteral } from '@talchain/schemas/boundary';
import { FAILURE_USER_TEXT } from '@talchain/schemas/boundary';
import type { StageType } from '@talchain/schemas/boundary';

import { INTERNAL_TO_WIRE, type InternalFailure } from './types.js';

export function buildFailureResponse(
  internal: InternalFailure,
  stage: StageType,
  details?: Record<string, unknown>,
): OlumiResponse {
  const wireCode: FailureTypeLiteral = INTERNAL_TO_WIRE[internal];
  return {
    response_version: 2,
    assistant_text: FAILURE_USER_TEXT[wireCode],
    blocks: [
      {
        type: 'error',
        error_code: wireCode,
        severity: 'error',
        ...(details ? { details } : {}),
      },
    ],
    suggested_actions: [],
    insights: [],
    stage_indicator: stage,
  };
}
