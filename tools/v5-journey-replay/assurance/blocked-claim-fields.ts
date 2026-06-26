/**
 * V5 staging assurance — Tier-2 / Tier-3 claim-safety negative guard.
 *
 * AUDIT BOUNDARY 7 (non-negotiable). PR #301 (Brief 4 claim-safety &
 * provenance contract) is merged as DOCTRINE ONLY — there is no runtime
 * enforcement. Therefore Tier-2 and Tier-3 fields/concepts are NOT
 * runtime-safe to surface in user-visible claims.
 *
 * This guard is the assurance suite's NEGATIVE assertion: it scans
 * user-facing `assistant_text` and chip labels/messages and FAILS the run
 * if any blocked field name or scientific-claim vocabulary appears. It is
 * deliberately separate from `../forbidden-terms.ts` (which guards internal
 * identifiers / raw IDs / graph-hash leaks) — this module guards the
 * *claim-permission* axis of the Brief 4 contract, not the
 * transport-cleanliness axis.
 *
 * The suite must NEVER assert these fields as present, displayed, correct,
 * or safe. An assurance suite that blessed an unenforced field would
 * manufacture false confidence on the most sensitive surface.
 *
 * False-positive discipline: these patterns target the FIELD identifiers
 * and the scientific JARGON that only appears when the system surfaces a
 * blocked field — NOT common English adjectives. e.g. `\brobustness\b`
 * matches the metric noun but not "a robust decision" ("robust" ≠
 * "robustness"); `bias` is matched only in warning/score/cognitive
 * contexts, never the bare word. Both directions are locked by fixture
 * tests (a leaking output fails; normal coaching prose passes).
 */

/**
 * Exact field/identifier substrings (case-insensitive). These are
 * snake_case wire/field names from the Brief 4 tier map and the PLoT V2
 * enrichment keep-list — there is no legitimate user-facing prose that
 * contains them, so a plain case-insensitive substring match is safe.
 */
export const BLOCKED_FIELD_IDENTIFIERS: readonly string[] = [
  'factor_sensitivity',
  'confidence_tier',
  'edge_e_values',
  'edge_e_value',
  'inference_warnings',
  'inference_warning',
  'flip_thresholds',
  'flip_threshold',
  'e_values',
  'dominant_factor',
  'm1_coaching',
  'isl_engine',
  'evidence_quality',
  'report_confidence',
];

/**
 * Scientific / claim vocabulary (word-bounded regex, case-insensitive).
 * Each pattern indicates a Tier-2/Tier-3 field being surfaced as a claim:
 * sensitivity, confidence tiers, robustness scoring, inference/scientific
 * warnings, evidence-quality grading, report-level confidence, EVPI /
 * Monte-Carlo method vocabulary, and bias-finding vocabulary. Tuned to
 * avoid common-adjective false positives (see module header).
 */
export const BLOCKED_CLAIM_PATTERNS: readonly RegExp[] = [
  /\bconfidence tier\b/i,
  /\bfactor sensitivity\b/i,
  /\bsensitivity analysis\b/i,
  /\binference warnings?\b/i,
  /\bscientific(?:ally)? (?:warning|warnings|confidence|caveat)\b/i,
  /\bedge e[-\s]?values?\b/i,
  /\bevidence quality\b/i,
  /\bquality of (?:the )?evidence\b/i,
  /\brobustness\b/i,
  /\bflip threshold/i,
  /\bconfidence (?:score|level|interval|band)\b/i,
  /\bEVPI\b/,
  /\bexpected value of (?:perfect )?information\b/i,
  /\bmonte[-\s]?carlo\b/i,
  /\b(?:cognitive )?bias (?:warning|warnings|score|signal|signals|flag|flags|detected|finding|findings)\b/i,
  /\bdominant factor\b/i,
];

/**
 * Scan a single user-facing string for blocked Tier-2/Tier-3 claim
 * surfaces. Returns matched tokens prefixed so the report can distinguish
 * identifier leaks (`blocked_field:`) from claim-vocabulary leaks
 * (`blocked_claim:`). Empty array = clean.
 */
export function findBlockedClaimMatches(text: string): readonly string[] {
  if (!text) return [];
  const matches: string[] = [];
  const lower = text.toLowerCase();
  for (const id of BLOCKED_FIELD_IDENTIFIERS) {
    if (lower.includes(id.toLowerCase())) matches.push(`blocked_field:${id}`);
  }
  for (const re of BLOCKED_CLAIM_PATTERNS) {
    const m = text.match(re);
    if (m) matches.push(`blocked_claim:${m[0]}`);
  }
  return matches;
}

/**
 * Convenience: scan an assistant_text plus a list of chip label/message
 * strings in one call. Returns the de-duplicated set of matches across all
 * surfaces so the assurance check can fail-closed on any of them.
 */
export function scanUserFacingSurfaces(
  assistantText: string | undefined,
  chipStrings: readonly string[],
): readonly string[] {
  const all = new Set<string>();
  for (const m of findBlockedClaimMatches(assistantText ?? '')) all.add(m);
  for (const s of chipStrings) {
    for (const m of findBlockedClaimMatches(s)) all.add(m);
  }
  return [...all];
}
