/**
 * ROADMAP 2.877 (link 2) — THE USER-STATED CURRENT LEVEL, extracted
 * deterministically, or nothing.
 *
 * WHAT THIS ANSWERS. "Did the user's own words state the CURRENT LEVEL of the
 * named metric, as a percentage?" It is the evidence gate for minting
 * `observed_state.baseline` on a level-framed constraint's target node — the
 * field ISL's level→sample-frame conversion reads, and refuses without
 * (`CONSTRAINT_NOT_CONVERTIBLE / missing_target_baseline`).
 *
 * THE INVIOLABLE RULE — NO INVENTION. A baseline may be minted ONLY from an
 * actual statement of the target's current level. This module therefore FAILS
 * CLOSED in every ambiguous direction: no present-state verb, a bound word
 * ("above 12%"), a delta ("down 12%", "12% higher"), a conditional or
 * projection frame ("if…", "we want…", "by next year…"), a subject that does
 * not bind to the target's label ("competitor churn"), conflicting statements,
 * a value outside [0,100], or no '%' at all ⇒ `undefined`. The cost of
 * `undefined` is one honest ISL refusal and an elicitation opportunity (row
 * 2.918); the cost of a false positive is a level threshold converted against
 * a fiction — the fabrication class the 2.877 chain exists to remove.
 *
 * PERCENT-ONLY BY DESIGN (v1). For a '%'-stated level the downstream scale is
 * deterministic end-to-end (PLoT's unit_percent rung is a fixed [0,100];
 * `raw / 100` is the same arithmetic `resolveGoalThresholdCap`'s '%' rule
 * uses). For currency/count levels the divisor PLoT would apply to the
 * threshold is resolved by a multi-rung ladder CEE cannot honestly replicate
 * (a mirrored copy would be CLAUDE.md trap 12), so no baseline is minted and
 * ISL keeps refusing honestly.
 *
 * SHARED by both mint sites so they cannot drift (the same reason
 * `extractGoalTargetWithBaseline` is shared): the chat path
 * (`orchestrator-v5/tools/handlers/add-constraint.ts`) and the draft path
 * (`cee/unified-pipeline/stages/repair/compound-goals.ts`).
 */

import { valuesMatch } from "../../utils/reduction-framing.js";

/** One present-state percent statement found in the text. */
export interface StatedCurrentLevel {
  /** The stated level as a RAW PERCENT NUMBER (12 for "12%"). */
  readonly rawPercent: number;
  /**
   * The words immediately before the stative verb, leading function words
   * stripped. The binding predicate requires EVERY one of these to appear in
   * the target's label — a word the label does not carry ("competitor",
   * "monthly") may name a DIFFERENT metric, so it refuses. Deliberately
   * fail-closed: over-refusal costs coverage, never truth.
   */
  readonly subjectWords: readonly string[];
  readonly matchedText: string;
  /** Match offset in the source text (consumed by the clause-frame guard). */
  readonly index: number;
}

/**
 * The stative cores that assert a PRESENT state. Simple present copula
 * ("churn is 12%") asserts present state in plain English; the at-verbs
 * ("sits/stands at") are its idiomatic equivalents. Deliberately CLOSED:
 * "was/were" (past), "will be" (future), "should/would/could be" (modal),
 * "get/want/reach" (aspiration) are all absent, so those shapes cannot match
 * at all — the failure direction is no-mint.
 */
const STATIVE_VERB =
  "(?:is|are|sits?\\s+at|stands?\\s+at|is\\s+(?:currently\\s+)?running\\s+at|are\\s+(?:currently\\s+)?running\\s+at)";

/**
 * What may sit between the verb and the number — a CLOSED set of
 * present-state qualifiers and hedges. Anything else ("above", "under",
 * "down", "not", "probably targeted", …) breaks the match, which is exactly
 * the fail-closed behaviour the corpus pins. `about/around/roughly` are the
 * same hedge vocabulary the shipped goal-pair patterns 2/3 already accept as
 * statement-compatible ("currently at|around|about").
 */
const FILLER = "(?:\\s+(?:currently|now|presently|today|still|at|around|about|roughly))*";

/**
 * Words that may follow the '%' and CHANGE the claim from a level to a delta
 * or comparison ("12% higher", "12% up on last year"). Their presence rejects
 * the match.
 */
const DELTA_POST =
  "(?:higher|lower|more|less|up|down|above|below|over|under|greater|smaller|better|worse)";

/**
 * The statement grammar. Subject = 1–4 plain word tokens immediately before
 * the stative verb (lazy, so the shortest subject that reaches a verb wins at
 * each start position; the scan is leftmost-first, so a disqualifying word
 * touching the verb phrase is always captured, never skipped).
 *
 * The value admits no sign: "-12%" cannot match, so negative levels refuse by
 * construction rather than by a guard that could be dropped.
 */
const STATEMENT_PATTERN = new RegExp(
  "(?<subject>[A-Za-z][A-Za-z'-]*(?:\\s+[A-Za-z][A-Za-z'-]*){0,3}?)" +
    `\\s+${STATIVE_VERB}${FILLER}` +
    "\\s+(?<value>\\d+(?:\\.\\d+)?)\\s*%" +
    `(?<post>\\s*${DELTA_POST}\\b)?`,
  "gi",
);

/**
 * Leading subject tokens that are function words rather than metric identity:
 * determiners/possessives (the goal-pair grammar's own set), present-time
 * qualifiers, and clause-leading conjunctions. Stripped BEFORE binding, so
 * "our churn" binds where "competitor churn" does not.
 */
const SUBJECT_LEADING_STOPWORDS = new Set([
  "the",
  "our",
  "my",
  "your",
  "its",
  "their",
  "a",
  "an",
  "this",
  "that",
  "and",
  "but",
  "so",
  "while",
  "since",
  "because",
  "current",
  "currently",
  "today",
  "now",
  "presently",
  "overall",
]);

/**
 * Clause-frame markers that make the statement HYPOTHETICAL, DESIRED, or
 * PROJECTED rather than observed — scanned over the clause PREFIX (from the
 * last sentence boundary to the match). Two families:
 *   - conditionals: "if churn is 12%…" states nothing about today;
 *   - desire/projection: "we want…", "our target…", "by next year…", modals —
 *     the number is an aspiration wearing a copula.
 * Over-matching here (e.g. the month "May") only ever costs a mint, never
 * truth.
 */
const CLAUSE_FRAME_MARKERS = new RegExp(
  "\\b(?:if|when|whenever|unless|suppose|supposing|assuming|assume|imagine|whether|" +
    "in\\s+case|what\\s+if|want(?:s|ed)?|wish(?:es|ed)?|aim(?:s|ed|ing)?|goal|" +
    "target(?:s|ed|ing)?|hope(?:s|d|ing)?|expect(?:s|ed|ing)?|forecast(?:s|ed|ing)?|" +
    "project(?:s|ed|ing)?|plan(?:s|ned|ning)?|should|would|could|will|might|may|" +
    "going\\s+to|used\\s+to|next\\s+(?:year|quarter|month|week))\\b",
  "i",
);

/**
 * Sentence/clause boundary for the frame guard. `(?!\d)` keeps a decimal
 * point INSIDE a number ("£1.5M", "12.5%") from terminating the clause — the
 * exact truncation class CLAUDE.md trap 22 records ("the window was cut at
 * the first [.!?], which is also the decimal point"). A dot followed by a
 * non-digit IS a boundary even after a digit ("…was 12. Churn is…").
 */
const CLAUSE_BOUNDARY = /[.!?;](?!\d)/g;

/** The clause prefix: text from the last boundary before `index` to `index`. */
function clausePrefix(text: string, index: number): string {
  let start = 0;
  CLAUSE_BOUNDARY.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CLAUSE_BOUNDARY.exec(text)) !== null) {
    if (m.index >= index) break;
    start = m.index + m[0].length;
  }
  return text.slice(start, index);
}

/**
 * Every present-state percent statement in the text whose clause frame is
 * OBSERVATIONAL (not conditional/desired/projected) and whose claim is a
 * LEVEL (no delta-post word). Subject binding and unanimity are the caller's
 * (`deriveStatedTargetBaselinePercent`) — this function reports what was
 * SAID; that one decides what it ATTESTS.
 */
export function extractStatedCurrentLevels(text: string): StatedCurrentLevel[] {
  const results: StatedCurrentLevel[] = [];
  const scanner = new RegExp(STATEMENT_PATTERN.source, STATEMENT_PATTERN.flags);
  scanner.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = scanner.exec(text)) !== null) {
    if (m[0] === "") {
      scanner.lastIndex += 1;
      continue;
    }
    const groups = m.groups ?? {};
    // A delta-post word converts the claim from a level to a change — reject.
    if (groups["post"] !== undefined) continue;
    // A framed clause states nothing about today — reject.
    if (CLAUSE_FRAME_MARKERS.test(clausePrefix(text, m.index))) continue;

    const value = Number(groups["value"]);
    if (!Number.isFinite(value)) continue;

    const rawSubject = (groups["subject"] ?? "").trim();
    const tokens = rawSubject.split(/\s+/).filter((t) => t.length > 0);
    while (tokens.length > 0 && SUBJECT_LEADING_STOPWORDS.has(tokens[0]!.toLowerCase())) {
      tokens.shift();
    }
    if (tokens.length === 0) continue; // no bindable subject ⇒ no identity ⇒ nothing

    results.push({
      rawPercent: value,
      subjectWords: tokens,
      matchedText: m[0],
      index: m.index,
    });
  }
  return results;
}

/**
 * Conservative singular fold, mirroring `pluraliseUnit`'s caution
 * (d1-shared/format-confirmation.ts): only a regular trailing "-s" on a word
 * of 4+ letters, never "-ss"/"-us"/"-is" endings. Applied to BOTH sides so
 * "churn rates" binds "Churn rate".
 */
function singularise(word: string): string {
  if (/[a-z]{3,}s$/.test(word) && !/(?:ss|us|is)$/.test(word)) {
    return word.slice(0, -1);
  }
  return word;
}

/** The label's word set, lowercased and singular-folded. */
function labelWordSet(label: string): Set<string> {
  return new Set(
    label
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 0)
      .map(singularise),
  );
}

/**
 * Does this statement's subject describe the TARGET, by identity? Requires
 * EVERY subject word to appear in the label's word set (after stopword strip
 * and singular fold on both sides). The direction is deliberate: label ⊆
 * subject would let "competitor churn rate" bind a "Churn rate" node —
 * someone else's number wearing the target's name.
 */
function subjectBindsToLabel(subjectWords: readonly string[], label: string): boolean {
  const labelWords = labelWordSet(label);
  if (labelWords.size === 0) return false;
  return subjectWords.every((w) => labelWords.has(singularise(w.toLowerCase())));
}

/**
 * The single raw percent the user stated as the TARGET's current level, or
 * `undefined` when no unambiguous statement binds to it.
 *
 * EXTRACTION ONLY — never infers, defaults, or rounds. Every refusal path
 * returns `undefined` and the caller mints nothing (ISL keeps refusing with
 * `missing_target_baseline`, which is the honest state).
 */
export function deriveStatedTargetBaselinePercent(
  message: string | null | undefined,
  targetLabel: string | null | undefined,
): number | undefined {
  if (typeof message !== "string" || message.trim() === "") return undefined;
  if (typeof targetLabel !== "string" || targetLabel.trim() === "") return undefined;

  const binding = extractStatedCurrentLevels(message).filter((l) =>
    subjectBindsToLabel(l.subjectWords, targetLabel),
  );
  if (binding.length === 0) return undefined;

  // UNANIMITY, not first-match: two statements that disagree mean CEE cannot
  // say which the user meant, and picking one would be a manufactured
  // attestation (the same rule `deriveStatedConstraintFrame` applies to
  // frames, for the same reason).
  const value = binding[0]!.rawPercent;
  for (const l of binding) {
    if (!valuesMatch(l.rawPercent, value)) return undefined;
  }

  // [0,100] keeps the normalised baseline inside ISL's NORMALISED_DOMAIN_LIMIT
  // and inside the [0,100] percent scale PLoT's unit_percent rung declares.
  // >100% levels exist in the wild (net revenue retention) but their
  // THRESHOLD would clamp on that rung, so the whole cell refuses.
  if (!(value >= 0 && value <= 100)) return undefined;

  return value;
}
