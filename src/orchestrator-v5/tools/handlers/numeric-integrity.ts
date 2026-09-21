/**
 * Numeric integrity guard for PLoT response ingress (Phase 2 workstream E).
 *
 * Walks the entire envelope and rejects on the first non-finite (`NaN`,
 * `Infinity`, `-Infinity`) value found in any numeric field, anywhere in
 * the structure. Defends downstream consumers (analysis projection,
 * decision-review enricher, format-analysis-value, prose composers) which
 * are not individually required to re-check every numeric value they read.
 *
 * Field coverage is structural — the walker visits every number in the
 * envelope, so adding a new PLoT field to the response cannot regress the
 * guard. This intentionally subsumes the per-field check matrix in the
 * brief (win_probability, factor_sensitivity[*].value, margin, evpi,
 * robustness bands, percentiles, flip thresholds, etc.).
 *
 * On reject the handler emits `PlotResponseInvalidNumeric` and throws
 * `HandlerInvocationFailedError` with `cause_kind: 'analysis_failed'`,
 * matching the existing fatal pattern at run-analysis.ts:530-545. No
 * NaN/Infinity reaches downstream consumers under any path.
 */

export interface InvalidNumericFinding {
  /** Dotted path to the offending field, e.g. `results[0].win_probability`. */
  readonly path: string;
  /** Stable representation for telemetry — never the raw value. */
  readonly value_repr: 'NaN' | 'Infinity' | '-Infinity';
}

const MAX_DEPTH = 16;

function reprOf(value: number): InvalidNumericFinding['value_repr'] | null {
  if (Number.isNaN(value)) return 'NaN';
  if (value === Number.POSITIVE_INFINITY) return 'Infinity';
  if (value === Number.NEGATIVE_INFINITY) return '-Infinity';
  return null;
}

function walk(
  value: unknown,
  path: string,
  depth: number,
): InvalidNumericFinding | null {
  if (depth > MAX_DEPTH) return null;
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    const repr = reprOf(value);
    return repr === null ? null : { path, value_repr: repr };
  }
  if (typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const found = walk(value[i], `${path}[${i}]`, depth + 1);
      if (found !== null) return found;
    }
    return null;
  }
  for (const key of Object.keys(value as Record<string, unknown>)) {
    const child = (value as Record<string, unknown>)[key];
    const childPath = path.length === 0 ? key : `${path}.${key}`;
    const found = walk(child, childPath, depth + 1);
    if (found !== null) return found;
  }
  return null;
}

/**
 * Find the first non-finite numeric value reachable from `value`. Returns
 * the dotted path and a stable string representation, or `null` when every
 * number reachable is finite. Pure function, no side effects, no allocation
 * beyond the path string for any actually-visited node.
 */
export function findFirstInvalidNumeric(
  value: unknown,
): InvalidNumericFinding | null {
  return walk(value, '', 0);
}
