/**
 * CQE Verbose Pattern Trace
 *
 * Emits one structured JSON line to stderr per pattern evaluated when
 * CQE_VERBOSE_TRACE=true. Enabled by feature flag only — never couples to
 * NODE_ENV, so staging can enable it with NODE_ENV=production.
 *
 * Default off. No-ops unconditionally when CQE_VERBOSE_TRACE is unset.
 * Output goes to stderr only — never Datadog, never stdout.
 *
 * Gate 5: CQE_VERBOSE_TRACE in config is always false when config reads
 * booleanString.default(false), so the flag cannot be set without an explicit
 * env var override.
 */

import { config } from '../../../config/index.js';

export interface PatternTraceEvent {
  readonly event: 'cqe.pattern_trace';
  readonly pattern_id: string;
  readonly matched: boolean;
  readonly match_count: number;
  readonly duration_ms: number;
}

/**
 * Emit one pattern-trace line to stderr.
 * No-op when CQE_VERBOSE_TRACE is not enabled.
 * Never throws — any serialisation failure is silently swallowed.
 */
export function tracePattern(
  pattern_id: string,
  matched: boolean,
  match_count: number,
  duration_ms: number,
): void {
  if (!config.cee.cqeVerboseTrace) return;
  try {
    const line: PatternTraceEvent = {
      event: 'cqe.pattern_trace',
      pattern_id,
      matched,
      match_count,
      duration_ms,
    };
    process.stderr.write(JSON.stringify(line) + '\n');
  } catch {
    // Swallow serialisation or write errors — tracing must never affect CQE output
  }
}
