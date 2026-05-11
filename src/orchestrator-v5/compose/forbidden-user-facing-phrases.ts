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
 * British English where relevant. Each pattern is case-insensitive
 * and uses word boundaries (or line anchors with /m) so common
 * sub-string mishits are avoided. The "no changes" class is the
 * delicate one: a bare `\bno\s+changes\b` was over-broad (false-
 * positive on legitimate quoted labels like "No Changes Required"
 * embedded in safe_summary) and an under-narrow contextual-only set
 * missed the standalone denial case ("No changes."). The current
 * mix is the compromise — three contextual denial patterns AND a
 * line-anchored standalone pattern, with regression-test coverage
 * for both label-quote false-positive avoidance and standalone
 * denial detection.
 */

export const FORBIDDEN_USER_FACING_PHRASES: readonly RegExp[] = [
  // "I haven't applied any changes" — straight apostrophe AND curly
  // apostrophe variants. Anchoring on `\b` after `changes` allows for
  // trailing punctuation ("any changes.", "any changes in this session").
  /\bI\s+haven['’]t\s+applied\s+any\s+changes\b/i,
  /\bI\s+have\s+not\s+applied\s+any\s+changes\b/i,
  // "nothing changed" — denial of state mutation.
  /\bnothing\s+changed\b/i,
  // "no changes" — contextual denial. The previous bare `\bno\s+changes\b`
  // pattern false-positived on legitimate label-quotes in
  // recent_changes[0].summary — e.g. a user-named option "No Changes
  // Required" embedded in a safe_summary string the state-query guard
  // quotes verbatim would erase the entire response via the egress
  // fallback. The three contextual patterns below catch denial framing
  // without catching quoted labels:
  //   1. "no changes [were/are/have been] [made|applied|necessary|needed|required]"
  //   2. "there [are/were/have been] no changes" (existential denial)
  //   3. "no changes [happened|occurred|emerged|appeared|reflected|to report]"
  // The original "I haven't applied any changes" / "nothing changed"
  // patterns still cover the strongest denial classes; these three are
  // the narrowing of the broader "no changes" rule.
  /\bno\s+changes\s+(?:were|are|have\s+been)\s+(?:made|applied|necessary|needed|required)\b/i,
  /\bthere\s+(?:are|were|have\s+been)\s+no\s+changes\b/i,
  /\bno\s+changes\s+(?:happened|occurred|emerged|appeared|reflected|to\s+report)\b/i,
  // Standalone denial — "No changes." / "No changes" as the entire
  // line/utterance. The /m flag makes ^/$ match line boundaries so
  // a terse LLM paragraph carrying just "No changes." is caught
  // even when wrapped in a longer multi-paragraph response.
  // Optional terminal punctuation covers full-stop / exclamation /
  // question variants. Label-quotes (e.g. "Updated the 'No Changes'
  // factor.") do NOT match because the line is not solely the
  // standalone phrase.
  /^\s*no\s+changes[.!?]?\s*$/im,
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

/**
 * Neutral fallback assistant_text used when the egress guard fires.
 *
 * Property: contains no token from `FORBIDDEN_USER_FACING_PHRASES`. The
 * helper is responsibility-light — it does not name what was wrong with
 * the original text, only invites the user to direct the next action.
 * The chip set and blocks survive the rewrite so the user retains a
 * recovery affordance.
 */
export const EGRESS_FORBIDDEN_PHRASE_FALLBACK_TEXT =
  "Let me know what you'd like me to do next, and I'll take it from there.";

/**
 * Apply the finaliser-level egress guard to a candidate `assistant_text`
 * value. Pure function — returns either the original text unchanged
 * (when clean) or the neutral fallback (when a forbidden phrase fires).
 *
 * Callers MUST emit `v5.egress.forbidden_phrase_detected` telemetry on
 * a rewritten result, tagging the per-emit-path `dispatch_path`. The
 * helper itself is telemetry-free so it stays usable from any module
 * without coupling to the telemetry registry.
 *
 * Idempotent: a second call on a rewritten result is a no-op because
 * the fallback contains no forbidden phrase.
 */
export interface EgressGuardResult {
  readonly rewritten: boolean;
  readonly text: string;
  readonly hit: string | null;
}

export function applyEgressForbiddenPhraseGuard(text: string): EgressGuardResult {
  const hit = findForbiddenPhraseHit(text);
  if (hit === null) return { rewritten: false, text, hit: null };
  return {
    rewritten: true,
    text: EGRESS_FORBIDDEN_PHRASE_FALLBACK_TEXT,
    hit,
  };
}
