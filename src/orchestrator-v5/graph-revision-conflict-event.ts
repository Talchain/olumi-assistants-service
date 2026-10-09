import { log } from '../utils/telemetry.js';

interface RevisionRefusal {
  readonly scenario_id: string;
  readonly turn_id: string;
  readonly handler_id: string | null;
  readonly rpc: 'v6' | 'v4r';
  readonly expected_revision: number | null | undefined;
}

/** One named event at the refusal site; never reread or infer a revision. */
export function logGraphRevisionConflict(refusal: RevisionRefusal, cause?: unknown): void {
  let detail: unknown = cause !== null && typeof cause === 'object' && 'details' in cause
    ? cause.details : undefined;
  if (typeof detail === 'string') {
    try { detail = JSON.parse(detail); } catch { detail = undefined; }
  }
  const current = detail !== null && typeof detail === 'object' && 'current' in detail
    ? detail.current : undefined;
  log.warn({
    event: 'graph_revision_conflict',
    ...refusal,
    expected_revision: refusal.expected_revision ?? null,
    ...(typeof current === 'number' && Number.isSafeInteger(current) && current >= 0
      ? { current_revision: current } : {}),
  }, 'Graph revision refused; nothing was saved');
}
