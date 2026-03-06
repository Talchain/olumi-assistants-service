/**
 * Deterministic scorer for research_topic LLM responses.
 *
 * Scores are rule-based — no LLM judge. Eight dimensions:
 * 1. valid_json          (0.10) — response parses as JSON with expected fields
 * 2. has_findings        (0.20) — summary field is a non-empty string
 * 3. findings_length_met (0.15) — summary meets min_findings_length chars
 * 4. source_count_met    (0.15) — sources array meets min_source_count
 * 5. keyword_coverage    (0.15) — all must_contain_keywords appear in summary
 * 6. no_forbidden_subs   (0.10) — none of forbidden_substrings appear
 * 7. has_numeric_values  (0.10) — summary contains at least one number when expected
 * 8. has_confidence_note (0.05) — confidence_note field present when expected
 */

import type { ResearchFixture, ResearchScore } from "./types.js";

// ============================================================================
// Numeric detection
// ============================================================================

const NUMBER_RE = /\d+(?:\.\d+)?%?/;

// ============================================================================
// Main scoring function
// ============================================================================

export function scoreResearch(
  fixture: ResearchFixture,
  parsed: Record<string, unknown> | null
): ResearchScore {
  const nullScore: ResearchScore = {
    valid_json: false,
    has_findings: false,
    findings_length_met: false,
    source_count_met: false,
    keyword_coverage: false,
    no_forbidden_substrings: false,
    has_numeric_values: false,
    has_confidence_note: false,
    overall: 0,
  };

  // 1. valid_json — must parse and contain summary field
  if (!parsed) return nullScore;
  const valid_json = typeof parsed.summary === "string";
  if (!valid_json) return { ...nullScore, valid_json: false };

  const summary = parsed.summary as string;
  const sources = Array.isArray(parsed.sources) ? (parsed.sources as unknown[]) : [];
  const confidenceNote = parsed.confidence_note;

  // 2. has_findings — summary is non-empty
  const has_findings = summary.trim().length > 0;

  // 3. findings_length_met — summary meets minimum length
  const findings_length_met =
    summary.trim().length >= fixture.expected.min_findings_length;

  // 4. source_count_met — sources array has enough entries
  const source_count_met = sources.length >= fixture.expected.min_source_count;

  // 5. keyword_coverage — all required keywords appear in summary (case-insensitive)
  const summaryLower = summary.toLowerCase();
  const keyword_coverage =
    fixture.expected.must_contain_keywords.length === 0 ||
    fixture.expected.must_contain_keywords.every((kw) =>
      summaryLower.includes(kw.toLowerCase())
    );

  // 6. no_forbidden_substrings — none of the forbidden phrases appear
  const no_forbidden_substrings =
    fixture.expected.forbidden_substrings.length === 0 ||
    !fixture.expected.forbidden_substrings.some((sub) =>
      summaryLower.includes(sub.toLowerCase())
    );

  // 7. has_numeric_values — when expected, summary must contain at least one number
  const has_numeric_values = fixture.expected.expects_numeric_values
    ? NUMBER_RE.test(summary)
    : true; // Not expected → pass by default

  // 8. has_confidence_note — when expected, confidence_note field must be present and non-empty
  const has_confidence_note = fixture.expected.expects_confidence_note
    ? typeof confidenceNote === "string" && confidenceNote.trim().length > 0
    : true; // Not expected → pass by default

  // Overall weighted score
  const overall =
    (valid_json ? 0.10 : 0) +
    (has_findings ? 0.20 : 0) +
    (findings_length_met ? 0.15 : 0) +
    (source_count_met ? 0.15 : 0) +
    (keyword_coverage ? 0.15 : 0) +
    (no_forbidden_substrings ? 0.10 : 0) +
    (has_numeric_values ? 0.10 : 0) +
    (has_confidence_note ? 0.05 : 0);

  return {
    valid_json,
    has_findings,
    findings_length_met,
    source_count_met,
    keyword_coverage,
    no_forbidden_substrings,
    has_numeric_values,
    has_confidence_note,
    overall,
  };
}
