/**
 * orchestrator-eval — D5 held-science vocabulary detector (eval assertion).
 *
 * THE ORIGINAL PLAN (RUBRIC-EXPANSION-SPEC.md D5) was to import the runtime's
 * `HELD_SCIENCE_VOCABULARY_PATTERN` wholesale, the same way D1/D2/D6 import
 * their production guards. That plan does not survive contact with the
 * orchestrator's own terminology map: verified 2026-07-08 (prompt-workstream
 * co-owner finding, corroborated independently while wiring this fixture),
 * `HELD_SCIENCE_VOCABULARY_PATTERN` bans `influence` and `vulnerable` — but
 * the orchestrator's terminology map REQUIRES exactly those words as the
 * mandated plain-language replacement ("has the biggest influence on the
 * outcome", "the most vulnerable assumption"). The runtime pattern was built
 * for a different surface entirely: Cap-1 safe-now / Cap-2A add-risk
 * REJECTION copy, where the science words are banned outright with no
 * plain-language substitute expected. Importing it here would fail every
 * terminology-map-compliant orchestrator response — the opposite of a
 * regression gate.
 *
 * D5 is therefore this pack's own worked EVAL-ASSERTION (like D3 goal-fit
 * conflation), not a production-guard re-export: the narrow raw-metric-token
 * / raw-decimal leak the terminology map actually forbids (never surface the
 * SCORE — "sensitivity value 0.42", "robustness", "fragile edge",
 * "elasticity", "EVPI"/"VOI" — only the plain-language EFFECT).
 *
 * Known limitation (disclosed): the raw-decimal check (`\b0\.\d{1,3}\b`) is a
 * blunt heuristic — it does not distinguish a held-science score from an
 * unrelated small decimal in prose (e.g. a currency amount). Acceptable for
 * the seed fixture; narrowing it is a documented follow-up if it proves noisy
 * against the real corpus.
 */

/** Raw held-science metric-name tokens the terminology map forbids in prose. */
const HELD_SCIENCE_TOKEN_PATTERN =
  /\b(?:sensitivit(?:y|ies)|robustness|elasticity|evpi|voi|fragile\s+edge)\b/i;

/** A raw 0.xx-style decimal — the shape a held-science score is reported in. */
const RAW_DECIMAL_PATTERN = /\b0\.\d{1,3}\b/;

export interface HeldScienceResult {
  readonly held: boolean;
  /** The offending token or decimal, verbatim, when held-science surfaces. */
  readonly evidence: string | null;
}

/** Detect raw held-science vocabulary or a raw score decimal in prose. */
export function detectHeldScience(text: string): HeldScienceResult {
  const tokenMatch = HELD_SCIENCE_TOKEN_PATTERN.exec(text);
  if (tokenMatch) return { held: true, evidence: tokenMatch[0] };
  const decimalMatch = RAW_DECIMAL_PATTERN.exec(text);
  if (decimalMatch) return { held: true, evidence: decimalMatch[0] };
  return { held: false, evidence: null };
}
