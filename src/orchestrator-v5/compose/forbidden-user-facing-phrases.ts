/**
 * Single source of truth for phrases that must never appear in user-facing
 * prose ("hard-fail prose"), regardless of source (LLM output, deterministic
 * templates, fallback copy, recoverable-handler recovery text).
 *
 * Defined by the V5 stale-aware explain recovery brief. Consumers:
 *   - Runtime finaliser-level egress guard (turn-executor.ts +
 *     edit-graph-dispatch.ts + chip-click-dispatch.ts) — strips/replaces
 *     any assistant_text containing a match before commit.
 *   - Unit tests for state-query-guard, explain-results, chip-generator,
 *     no-op-helpers, staleness-prefix — assert deterministic copy never
 *     contains a forbidden phrase.
 *   - Replay harness (tools/v5-journey-replay/forbidden-terms.ts) — imports
 *     and threads through findForbiddenMatches so the harness and runtime
 *     agree on the contradiction list.
 *
 * Drift guard: add forbidden phrases here, NOT in downstream consumers.
 * The single source of truth is what prevents replay assertions and
 * runtime checks from diverging.
 *
 * British English where relevant. Word-boundary anchored so common
 * sub-string mishits are avoided ("no changes" matches at word boundaries
 * only — "innocuous changes" does not trip).
 */

export const FORBIDDEN_USER_FACING_PHRASES: readonly RegExp[] = [
  // "I haven't applied any changes" — straight apostrophe AND curly
  // apostrophe variants. Anchoring on `\b` after `changes` allows for
  // trailing punctuation ("any changes.", "any changes in this session").
  /\bI\s+haven['’]t\s+applied\s+any\s+changes\b/i,
  /\bI\s+have\s+not\s+applied\s+any\s+changes\b/i,
  // "nothing changed" — denial of state mutation.
  /\bnothing\s+changed\b/i,
  // "no changes" — generic denial when used as a state assertion. The
  // word-boundary anchors keep this from tripping on "innocuous changes"
  // or "no changes were necessary" sub-strings nested in benign prose.
  /\bno\s+changes\b/i,
  // "unknown freshness" — internal/telemetry term that must never reach
  // user prose; the wire envelope's `analysis_ready.freshness: 'unknown'`
  // is separate, and the UI renders it without verbatim quoting.
  /\bunknown\s+freshness\b/i,
  // "loaded from a prior run" — legacy staleness phrasing (was emitted
  // by an earlier analysis-projection fallback) that the brief now
  // explicitly forbids.
  /\bloaded\s+from\s+a\s+prior\s+run\b/i,
  // "cached result" — implies stale state but does not name the
  // remediation; replaced by the brief's "may be out of date" copy.
  /\bcached\s+result\b/i,
  // "previous analysis" / "prior analysis" — both describe an analysis
  // run that the user no longer trusts; the brief's stale copy uses
  // "the model has changed since the last analysis" instead.
  /\bprevious\s+analysis\b/i,
  /\bprior\s+analysis\b/i,
];

/**
 * Return the first forbidden phrase that hits in `text`, or null when
 * clean. Used by the egress guard for both the detection signal and the
 * telemetry payload. Returns the matched substring (not the source regex)
 * so dashboards can group hits by phrase verbatim.
 */
export function findForbiddenPhraseHit(text: string): string | null {
  if (!text || text.length === 0) return null;
  for (const re of FORBIDDEN_USER_FACING_PHRASES) {
    const m = re.exec(text);
    if (m) return m[0];
  }
  return null;
}
