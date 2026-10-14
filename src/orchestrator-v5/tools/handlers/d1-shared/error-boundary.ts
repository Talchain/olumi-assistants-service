/**
 * Boundary wrapper that translates D1HandlerError → HandlerInvocationFailedError.
 *
 * Each D1 handler runs its body inside `runD1Handler(handlerId, () => …)`.
 * On a D1HandlerError throw, the boundary maps the typed code to a
 * canonical `HandlerInvocationFailedCause` and re-throws as
 * `HandlerInvocationFailedError` so the turn-executor's existing catch
 * ladder produces the right wire mapping (INTERNAL_ERROR with cause_kind
 * preserved for telemetry / chip selection).
 *
 * A held deadline-forecast definition also refuses through the recoverable
 * precondition path, with specific recovery words. The wrapper is transparent
 * for every other thrown class — Zod errors,
 * `HandlerResultInvalidError`, `HandlerInvocationFailedError`, and plain
 * Errors propagate unchanged.
 */

import type { HandlerOutcome } from '../../registry.js';
import {
  HandlerInvocationFailedError,
  type HandlerInvocationFailedCause,
} from '../../handler-errors.js';
import { D1HandlerError, SHARE_BY_DATE_OWNERSHIP_GUIDANCE, type D1ErrorCode } from './errors.js';
import { ShareByDateOwnershipError } from '../../../goal-target/share-by-date-carrier.js';

const CAUSE_BY_D1_CODE: Record<D1ErrorCode, HandlerInvocationFailedCause> = {
  PARAMETER_INVALID: 'parameter_invalid_at_execute',
  ENTITY_NOT_FOUND: 'entity_not_found_in_graph',
  ENTITY_KIND_MISMATCH: 'entity_kind_mismatch_at_execute',
  PRECONDITION_UNMET: 'precondition_unmet_at_execute',
  GRAPH_INVARIANT_VIOLATED: 'graph_invariant_violated',
};

export async function runD1Handler(
  handlerId: string,
  body: () => Promise<HandlerOutcome>,
): Promise<HandlerOutcome> {
  try {
    return await body();
  } catch (err) {
    if (err instanceof ShareByDateOwnershipError) {
      throw new HandlerInvocationFailedError(err.message, {
        cause_kind: 'precondition_unmet_at_execute',
        retryable: false,
        details: {
          handler_id: handlerId,
          reason_code: 'SHARE_BY_DATE_SERVER_OWNED',
          specific_issue: SHARE_BY_DATE_OWNERSHIP_GUIDANCE,
        },
        cause: err,
      });
    }
    if (err instanceof D1HandlerError) {
      throw new HandlerInvocationFailedError(err.message, {
        cause_kind: CAUSE_BY_D1_CODE[err.code],
        retryable: false,
        details: {
          handler_id: handlerId,
          d1_code: err.code,
          ...(err.userGuidance ? { specific_issue: err.userGuidance } : {}),
          ...(err.details ?? {}),
        },
        cause: err,
      });
    }
    throw err;
  }
}
