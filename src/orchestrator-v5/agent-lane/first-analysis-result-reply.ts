import { RUN_RESULT_READY_TEXT } from './run-explanation.js';

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

/** Only the selector's typed coverage ends a build request; final canonical read still governs readiness. */
export function firstAnalysisResultReply(args: unknown, result: unknown, ranThisRequest: boolean): string | null {
  const built = record(result);
  if (record(args)?.whole_request !== true || !ranThisRequest
    || built?.ok !== true || built.mutated !== true || built.replayed === true
    || record(built.first_analysis)?.ran !== true) return null;
  return RUN_RESULT_READY_TEXT;
}
