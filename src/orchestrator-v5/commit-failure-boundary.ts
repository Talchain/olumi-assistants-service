/** Shared status/body mapping of an atomic turn commit failure (extracted unchanged from route-v2). */
import type { BoundaryError, OrchestratorTurnPayload } from '@talchain/schemas/boundary';
import { GRAPH_CONFLICT_RECOVERY_KEYS, GRAPH_CONFLICT_RECOVERY_COPY_MODE } from './graph-conflict-recovery-keys.js';
import { withRevisionConflictWire } from './graph-revision-conflict.js';
export function buildCommitFailureBoundaryError(params: {
  readonly validator: string;
  readonly reason: string;
  readonly retryable: boolean;
  readonly requestId: string;
  readonly stage: OrchestratorTurnPayload['stage'];
  readonly errorCode?: BoundaryError['error'];
  readonly preStageExtras?: Record<string, unknown>;
  readonly postStageExtras?: Record<string, unknown>;
}): BoundaryError {
  return {
    error: params.errorCode ?? 'INTERNAL_ERROR',
    boundary: 'B1',
    direction: 'egress',
    validator: params.validator,
    details: {
      retryable: params.retryable,
      reason: params.reason,
      ...(params.preStageExtras ?? {}),
      stage: params.stage,
      ...(params.postStageExtras ?? {}),
    },
    request_id: params.requestId,
    retryable: params.retryable,
  };
}

export function extractRetryableFlag(response: unknown): boolean {
  if (!response || typeof response !== 'object') return false;
  const blocks = (response as { blocks?: unknown }).blocks;
  if (!Array.isArray(blocks) || blocks.length === 0) return false;
  const errBlock = blocks.find(
    (b: unknown) =>
      b != null && typeof b === 'object' && (b as { type?: unknown }).type === 'error',
  );
  if (!errBlock || typeof errBlock !== 'object') return false;
  const details = (errBlock as { details?: unknown }).details;
  if (!details || typeof details !== 'object') return false;
  return (details as { retryable?: unknown }).retryable === true;
}

/**
 * F4 — pull the graph-conflict recovery metadata out of the failure
 * response's error-block details so it can be forwarded onto the 409
 * BoundaryError envelope (A2's UI refresh/reconfirm leg reads it). Returns
 * undefined on any shape drift — the 409 status alone still carries the
 * recoverable signal.
 *
 * A-2: DERIVED from `GRAPH_CONFLICT_RECOVERY_KEYS`, the same manifest the
 * producers are compile-bound to (`satisfies GraphConflictFailureDetails` in
 * turn-executor.ts). The old hand allowlist here FAILED SILENT — a key added
 * at a producer never reached the wire (`fence_verdict` had to be hand-added
 * when the fence landed). Now a new key is either in the manifest (and flows
 * end-to-end) or a compile error at the producer; there is no silent third
 * state. Per-key copy semantics live beside the manifest.
 */
export function extractGraphConflictRecovery(
  response: unknown,
): Record<string, unknown> | undefined {
  if (!response || typeof response !== 'object') return undefined;
  const blocks = (response as { blocks?: unknown }).blocks;
  if (!Array.isArray(blocks) || blocks.length === 0) return undefined;
  const errBlock = blocks.find(
    (b: unknown) =>
      b != null && typeof b === 'object' && (b as { type?: unknown }).type === 'error',
  );
  if (!errBlock || typeof errBlock !== 'object') return undefined;
  const details = (errBlock as { details?: unknown }).details;
  if (!details || typeof details !== 'object') return undefined;
  const d = details as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of GRAPH_CONFLICT_RECOVERY_KEYS) {
    if (GRAPH_CONFLICT_RECOVERY_COPY_MODE[key] === 'string') {
      if (typeof d[key] === 'string') out[key] = d[key];
    } else if (key in d) {
      out[key] = d[key];
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function failedTurnReply(run: { response: unknown; telemetry: { failure_type: BoundaryError['error'] | null; stages_completed: string[] } },
  stage: OrchestratorTurnPayload['stage'], requestId: string) {
  const failureType = run.telemetry.failure_type;
  const isConflict = failureType === 'GRAPH_DIVERGED';
  const recovery = isConflict ? extractGraphConflictRecovery(run.response) : undefined;
  const body = buildCommitFailureBoundaryError({ validator: 'turn_commit',
    reason: isConflict ? 'graph_write_conflict' : 'state_commit_failed_or_turn_runtime_failure',
    retryable: extractRetryableFlag(run.response), requestId, stage, errorCode: failureType ?? 'INTERNAL_ERROR',
    preStageExtras: { failure_type: failureType, ...recovery }, postStageExtras: { stages_completed: run.telemetry.stages_completed } });
  return { status: isConflict ? 409 as const : 500 as const,
    json: isConflict ? withRevisionConflictWire(body, { conflict_category: typeof recovery?.conflict_category === 'string' ? recovery.conflict_category : '',
      expected: typeof recovery?.expected === 'number' ? recovery.expected : undefined,
      current: typeof recovery?.current === 'number' ? recovery.current : undefined }) : body };
}
