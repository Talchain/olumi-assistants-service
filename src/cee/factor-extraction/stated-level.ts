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
 * The CLOSED present-state qualifier/hedge vocabulary. One list, two
 * grammars (trap 12 — derive, don't mirror): the statement grammar's FILLER
 * (between verb and number) and the elicited-answer grammar's leading and
 * trailing qualifiers are all built from THIS array. Anything else ("above",
 * "under", "down", "not", "probably targeted", …) breaks the match, which is
 * exactly the fail-closed behaviour the corpus pins. `about/around/roughly`
 * are the same hedge vocabulary the shipped goal-pair patterns 2/3 already
 * accept as statement-compatible ("currently at|around|about"). `right` is
 * admitted for the "right now" / "right around" hedge family (2.918 — the
 * elicitation question's own copy says "right now", so answers echo it).
 */
const PRESENT_STATE_QUALIFIERS: readonly string[] = [
  "currently",
  "now",
  "presently",
  "today",
  "still",
  "at",
  "around",
  "about",
  "roughly",
  "right",
];
const QUALIFIER_ALT = `(?:${PRESENT_STATE_QUALIFIERS.join("|")})`;

/**
 * What may sit between the verb and the number — the closed qualifier
 * vocabulary above, zero or more times.
 */
const FILLER = `(?:\\s+${QUALIFIER_ALT})*`;

/**
 * R2918B — THE UNIT TOKENS AN ANSWER MAY CARRY. The ask
 * (`formatBaselineElicitation`) reads "Roughly what percentage is <target> at
 * right now?", so the user's echo of the question's OWN noun is a unit
 * statement exactly as the symbol is. CLOSED, like every vocabulary here.
 */
const PERCENT_UNIT = "(?:%|percent(?:age)?|per\\s+cent|pct)";

/**
 * R2918B — the CLOSED "this is an ATTEMPTED answer" vocabulary. It exists for
 * ONE purpose: to tell an answer the product cannot READ ("10-15%", "maybe
 * 12%", "it was 12%") apart from a message that is not answering the question
 * at all ("run the analysis", "Win rate is 12% today"). The first earns a
 * re-ask; the second must leave the flow exactly as it was, because the
 * elicitation is additive by contract.
 *
 * DELIBERATELY WIDER than the binding grammar and DELIBERATELY CLOSED: a word
 * outside this set means the message carries content only the full grammar (or
 * the model) is entitled to judge, so classification returns `not_an_answer`
 * and the caller stays silent. Membership NEVER binds a value: every member
 * beyond the shared qualifiers is, by construction, a word that makes an
 * answer UNUSABLE as a present-state level.
 */
const ATTEMPT_VOCABULARY: ReadonlySet<string> = new Set<string>([
  ...PRESENT_STATE_QUALIFIERS,
  // hedge / guesswork
  "maybe",
  "perhaps",
  "probably",
  "possibly",
  "guess",
  "think",
  "reckon",
  "ish",
  "approx",
  "approximately",
  "circa",
  "say",
  "like",
  // pronoun leads and copulas (the elliptical grammar's own lead, unbound)
  "i",
  "we",
  "it",
  "its",
  "that",
  "is",
  "are",
  "am",
  "s",
  "re",
  "m",
  // tense that states a level for the WRONG time
  "was",
  "were",
  // range / alternation connectives
  "or",
  "and",
  "to",
  "between",
  "somewhere",
  "range",
  // bound and delta words: a real attempt whose CLAIM is not a level
  "under",
  "over",
  "above",
  "below",
  "more",
  "less",
  "than",
  "higher",
  "lower",
  "up",
  "down",
  // spelled units
  "percent",
  "percentage",
  "per",
  "cent",
  "pct",
]);

/**
 * The most tokens a message may carry and still count as an ATTEMPTED answer.
 * A reply to "Roughly what percentage is X at right now?" is short; past this
 * the message is doing something else and a closed vocabulary is no longer
 * sufficient evidence of intent. Fail direction: silence.
 */
const ATTEMPT_TOKEN_CAP = 10;

/**
 * Is the WHOLE message a short, number-bearing reply built only from the
 * closed attempt vocabulary? Punctuation is stripped and range / alternation
 * separators are split on, so "10-15%" tokenises as two numbers rather than as
 * one unknown word (without that split it would read as "not an answer" and
 * the user would get silence for a genuine attempt).
 */
function isAttemptedAnswerShape(message: string): boolean {
  const tokens = message
    .toLowerCase()
    .replace(/[\u2013\u2014/-]+/g, " ")
    .replace(/[.,!?;:"'\u2018\u2019\u201c\u201d()%]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);
  if (tokens.length === 0 || tokens.length > ATTEMPT_TOKEN_CAP) return false;
  const isNumber = (t: string): boolean => /^\d+(?:\.\d+)?$/.test(t);
  if (!tokens.some(isNumber)) return false;
  return tokens.every((t) => isNumber(t) || ATTEMPT_VOCABULARY.has(t));
}


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
 * Clause-frame markers that make the statement HYPOTHETICAL, DESIRED,
 * PROJECTED, DOUBTED, or DENIED rather than observed — scanned over the WHOLE
 * clause containing the match, both sides (adversarial review of #868, B1/B3:
 * a prefix-only scan let "Churn is 12%? That cannot be right." mint, because
 * the disqualifying context sat AFTER the match). Families:
 *   - conditionals: "if churn is 12%…" states nothing about today;
 *   - desire/projection: "we want…", "our target…", "by next year…", modals —
 *     the number is an aspiration wearing a copula;
 *   - doubt/denial: "I doubt…", "it is false that…" — the copula is quoted to
 *     be argued with, not asserted.
 * Over-matching (e.g. the month "May", or a marker in the clause's other
 * half) only ever costs a mint, never truth.
 *
 * 2.960 R1 — FUTURE-DATED POST-QUALIFIERS. "Churn is 12% by Q4" states where
 * churn is EXPECTED to be at a future date — an aspiration wearing a copula
 * (both review repro strings minted at pristine 060e9ed9, proven by
 * execution). The `by <date>` family joins the marker set: quarters (Q1–Q4),
 * month names, "year-end" / "year end", and 4-digit years. The qualifier must
 * be DATE-SHAPED — an instrumental "by" ("by our own measurement") stays a
 * genuine statement, pinned by the spec suite's precondition pair. Bare "by
 * May" was already refused by the modal `may` marker; it is listed here so
 * the family does not depend on that coincidence.
 */
const CLAUSE_FRAME_MARKERS = new RegExp(
  "\\b(?:if|when|whenever|unless|suppose|supposing|assuming|assume|imagine|whether|" +
    "in\\s+case|what\\s+if|want(?:s|ed)?|wish(?:es|ed)?|aim(?:s|ed|ing)?|goal|" +
    "target(?:s|ed|ing)?|hope(?:s|d|ing)?|expect(?:s|ed|ing)?|forecast(?:s|ed|ing)?|" +
    "project(?:s|ed|ing)?|plan(?:s|ned|ning)?|should|would|could|will|might|may|" +
    "going\\s+to|used\\s+to|next\\s+(?:year|quarter|month|week)|" +
    "by\\s+(?:Q[1-4]|January|February|March|April|May|June|July|August|" +
    "September|October|November|December|year[-\\s]end|\\d{4})|" +
    "doubt(?:s|ed)?|false|untrue|deny|denies|denied)\\b",
  "i",
);

/**
 * Quote characters CARRY context rather than severing it (review B1(b)): a
 * quote character in the clause means the copula is someone's REPORTED words
 * ("The analyst said \"churn is 12%\"", a document title) — and, mechanically,
 * the quote is exactly what cut the attribution off from the subject capture.
 * Straight/curly double quotes, guillemets and backticks always count; an
 * apostrophe counts only when it OPENS a quotation (whitespace/start before
 * it), so possessives and contractions ("competitor's") do not trip it.
 * Refusing the whole clause is deliberate over-refusal: it costs a mint,
 * never truth.
 */
const QUOTE_CONTEXT = /["“”«»`]|(?:^|\s)'/;

/**
 * Sentence/clause boundary candidates. `!`/`?`/`;` are always boundaries. A
 * dot is NOT a boundary when it is:
 *   - a decimal point (digit follows — "£1.5M", "12.5%"; the truncation class
 *     CLAUDE.md trap 22 records), or
 *   - an abbreviation dot (single-letter word before it — "e.g.", "i.e.",
 *     initials — or a known abbreviation token; review B1(c): the dots in
 *     "If, e.g., churn is 12%…" were read as clause ends, hiding the "If").
 * Misclassifying a real boundary as an abbreviation only WIDENS the clause —
 * more disqualifying context is scanned, so the failure direction is refusal.
 */
const BOUNDARY_CANDIDATE = /[.!?;]/g;
const DOT_ABBREVIATIONS = new Set([
  "eg",
  "ie",
  "etc",
  "approx",
  "vs",
  "cf",
  "no",
  "rev",
  "est",
  "dept",
  "inc",
  "ltd",
  "co",
  "mr",
  "mrs",
  "ms",
  "dr",
  "st",
]);

function isRealBoundary(text: string, at: number): boolean {
  if (text[at] !== ".") return true;
  const next = text[at + 1];
  if (next !== undefined && /\d/.test(next)) return false; // decimal point
  // The word immediately before the dot (letters only).
  let i = at - 1;
  let word = "";
  while (i >= 0 && /[A-Za-z]/.test(text[i]!)) {
    word = text[i]! + word;
    i -= 1;
  }
  if (word.length === 1) return false; // e.g. / i.e. / initials
  if (DOT_ABBREVIATIONS.has(word.toLowerCase())) return false;
  return true;
}

/**
 * The full clause containing `index` — text between the nearest REAL
 * boundaries on each side — and the boundary character that terminates it
 * (undefined at end-of-text).
 */
function clauseAround(
  text: string,
  index: number,
): { readonly clause: string; readonly terminator: string | undefined } {
  let start = 0;
  let end = text.length;
  let terminator: string | undefined;
  BOUNDARY_CANDIDATE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BOUNDARY_CANDIDATE.exec(text)) !== null) {
    if (!isRealBoundary(text, m.index)) continue;
    if (m.index < index) {
      start = m.index + 1;
    } else {
      end = m.index;
      terminator = text[m.index];
      break;
    }
  }
  return { clause: text.slice(start, end), terminator };
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
    const { clause, terminator } = clauseAround(text, m.index);
    // A clause that ends in '?' is a QUESTION — a disbelief echo ("Churn is
    // 12%? That cannot be right.") asserts nothing (review B1(a): the '?'
    // sits after the match, where the old prefix-only scan never looked).
    if (terminator === "?") continue;
    // Reported speech / titles: the copula is someone's quoted words.
    if (QUOTE_CONTEXT.test(clause)) continue;
    // A framed clause states nothing about today — reject. Scanned over the
    // WHOLE clause, both sides of the match.
    if (CLAUSE_FRAME_MARKERS.test(clause)) continue;

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
 * `competingLabels` (review B2) are the labels of the OTHER candidate targets
 * in the same pass — for the chat path, every other outcome/risk node in the
 * graph; for the draft pass, the same population. A statement whose subject
 * ALSO binds a competitor ("The rate is 12%" against both 'Churn rate' and
 * 'Win rate') describes an AMBIGUOUS metric: at most one of the candidate
 * baselines can be true and CEE cannot say which, so the statement attests
 * none of them — unanimity applied one level up. Absent/blank competitor
 * labels are ignored, never matched.
 *
 * EXTRACTION ONLY — never infers, defaults, or rounds. Every refusal path
 * returns `undefined` and the caller mints nothing (ISL keeps refusing with
 * `missing_target_baseline`, which is the honest state).
 */
export function deriveStatedTargetBaselinePercent(
  message: string | null | undefined,
  targetLabel: string | null | undefined,
  competingLabels: readonly (string | null | undefined)[] = [],
): number | undefined {
  if (typeof message !== "string" || message.trim() === "") return undefined;
  if (typeof targetLabel !== "string" || targetLabel.trim() === "") return undefined;

  const competitors = competingLabels.filter(
    (l): l is string => typeof l === "string" && l.trim() !== "",
  );
  const binding = extractStatedCurrentLevels(message).filter(
    (l) =>
      subjectBindsToLabel(l.subjectWords, targetLabel) &&
      !competitors.some((c) => subjectBindsToLabel(l.subjectWords, c)),
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

/**
 * ROADMAP 2.918 — the ELLIPTICAL ANSWER grammar. In reply to a pending
 * baseline question that NAMES the target ("Roughly what percentage is Churn
 * rate at right now?"), the natural answer carries no subject: "about 12%",
 * "it's 12%", "we're at 12% today". The statement grammar above demands a
 * subject and therefore cannot see these — deliberately, because without a
 * question in flight a bare number attests nothing.
 *
 * The WHOLE message must be the answer: an optional pronoun lead (a CLOSED
 * set — it/that + copula, we + are (+ at); pronouns carry no metric identity,
 * which is exactly why the question context must supply it), qualifiers drawn
 * from the SAME `PRESENT_STATE_QUALIFIERS` vocabulary as the statement
 * grammar, ONE unsigned number with a literal '%', optional trailing
 * qualifiers, and at most a closing '.' or '!'. Anything else refuses:
 * a '?' (question echo), a quote, a delta or bound word, a second number, a
 * conditional tail, "maybe" — every one of these may change the claim, and
 * only the full grammar (which demands a subject) is entitled to judge a
 * longer utterance. Percent-only and [0,100] for the same reasons as the
 * parent (the mint cell it feeds is unchanged).
 */
const ELLIPTICAL_ANSWER_PATTERN = new RegExp(
  "^\\s*" +
    "(?:(?:it|that)(?:['’]s|\\s+is)\\s+|we(?:['’]re|\\s+are)\\s+(?:at\\s+)?)?" +
    `(?:${QUALIFIER_ALT}\\s+)*` +
    `(?<value>\\d+(?:\\.\\d+)?)\\s*(?<unit>${PERCENT_UNIT})?` +
    `(?:\\s+${QUALIFIER_ALT})*` +
    "\\s*[.!]?\\s*$",
  "i",
);

/**
 * The single raw percent an ANSWER TURN states for the pending question's
 * target, or `undefined`. This is the #868 extractor with a bounded
 * question-context carry, NOT a second parser:
 *
 *   1. the full-sentence limb IS `deriveStatedTargetBaselinePercent` — a
 *      subject-bearing answer ("Churn rate is about 12%") binds by identity
 *      and competitor unanimity exactly as on any other turn;
 *   2. the elliptical limb accepts ONLY a whole-message bare answer (grammar
 *      above). Its subject binding is the QUESTION's: callers MUST gate this
 *      function on a live `elicit_target_baseline` pending whose target is
 *      `targetLabel`'s node — no pending question ⇒ this function must not be
 *      called ⇒ no elliptical binding. The add_constraint handler enforces
 *      that gate (exactly one live pending, matching target id, server-minted
 *      so no LLM proposal can fabricate it).
 *
 * EXTRACTION ONLY — never infers, defaults, or rounds; every refusal path
 * returns `undefined` and the caller mints nothing.
 */
/**
 * R2918B — WHAT THE ANSWER TURN ACTUALLY DID, as a three-way verdict.
 *
 * The 2.918 shipping shape was BINARY: bind, or fall through in silence. That
 * made two very different messages indistinguishable to the caller, and the
 * product could not tell them apart either:
 *
 *   - "10-15%" / "maybe 12%" / "120%" — the user is plainly ANSWERING, and the
 *     product cannot read the answer. Silence here is the defect: the reply
 *     lands nowhere and nothing ever says why;
 *   - "run the analysis" / "Win rate is 12% today" — the user is not answering
 *     this question at all. Silence here is CORRECT and contractual: the
 *     elicitation is additive, so an ignored question must leave the flow
 *     exactly as it was.
 *
 * Separating them is what lets the caller re-ask the first WITHOUT hijacking
 * the second. `unresolved` NEVER carries a value: it is the refusal, told.
 */
/**
 * ⭐⭐ WHERE A BOUND ANSWER GOT ITS SUBJECT — the second two-meanings-one-value
 * collapse in this chain, and the one that made the collision fix over-narrow.
 *
 * `outcome: "bound"` was true of two replies that carry completely different
 * authority, and a caller could not tell them apart:
 *
 *   - `"subject"` — the reply NAMES its own subject ("Churn rate is 30%",
 *     "Churn is about 12%."). It bound through the full-sentence limb, which is
 *     `deriveStatedTargetBaselinePercent`: identity match against the target's
 *     label plus competitor unanimity. That limb needs NO pending question at
 *     all — it is the same rule that binds on any other turn. A competing ask
 *     is IRRELEVANT to it, because there is nothing to borrow.
 *   - `"elliptical"` — the reply carries no subject ("30%", "about 12%") and
 *     borrows the pending question's. THIS is the limb the sole-pending gate
 *     licenses, and the only one a competing ask can make ambiguous.
 *
 * Sole-pending permission is needed for ELLIPTICAL CARRY, not for every reply
 * that happens to be answer-shaped. Collapsing the two is how the product came
 * to refuse its own offered disambiguating example: it prints
 * `Naming it is enough, for example "Churn rate is 30%"` and then declined that
 * exact sentence, because the sentence was `bound` and the gate could see only
 * `bound`.
 *
 * DERIVED, NOT A NEW TEST. This field records WHICH LIMB produced the value —
 * it is not a second predicate over user text and it tunes nothing. There is no
 * threshold here to drift.
 */
export type ElicitedBaselineAnswerAuthority = "subject" | "elliptical";

export type ElicitedBaselineAnswer =
  | {
      readonly outcome: "bound";
      readonly percent: number;
      readonly authority: ElicitedBaselineAnswerAuthority;
    }
  | {
      readonly outcome: "unresolved";
      readonly reason: "out_of_range" | "ambiguous_scale" | "unreadable";
    }
  | { readonly outcome: "not_an_answer" };

/**
 * Classify an answer turn against the pending baseline question. Limbs, in
 * order, all fail-closed:
 *
 *   1. the full-sentence limb IS `deriveStatedTargetBaselinePercent` — a
 *      subject-bearing answer ("Churn rate is about 12%") binds by identity and
 *      competitor unanimity exactly as on any other turn;
 *   2. the elliptical limb accepts a whole-message bare answer. Its subject
 *      binding is the QUESTION's, and so is its UNIT: the ask states
 *      "percentage", which is why an answer may omit the symbol. Callers MUST
 *      gate this on a live `elicit_target_baseline` pending whose target is
 *      `targetLabel`'s node, and on that pending being the SOLE live ask a bare
 *      number could be answering (`findSoleLiveElicitBaselinePending`) — no
 *      pending question, or a competing one, means no elliptical binding;
 *   3. anything else that is SHAPED like an answer is `unresolved`;
 *   4. everything else is `not_an_answer`.
 *
 * THE SCALE CARVE-OUT. A UNIT-LESS decimal below 1 ("0.3") is genuinely
 * ambiguous between "0.3 percent" and the fraction 0.3, i.e. 30 percent — a
 * hundredfold difference, and nothing in the message decides it. It returns
 * `unresolved`, never a guess. With an explicit unit ("0.3%") the user has said
 * which they meant and it binds unchanged. A binder that accepts everything
 * writes wrong values confidently; this is the one place the widened grammar
 * would have done exactly that.
 *
 * EXTRACTION ONLY — never infers, defaults, or rounds.
 */
export function classifyElicitedBaselineAnswer(
  message: string | null | undefined,
  targetLabel: string | null | undefined,
  competingLabels: readonly (string | null | undefined)[] = [],
): ElicitedBaselineAnswer {
  if (typeof message !== "string" || message.trim() === "") {
    return { outcome: "not_an_answer" };
  }
  // No target label ⇒ no identity to bind ⇒ nothing, same rule as the parent.
  if (typeof targetLabel !== "string" || targetLabel.trim() === "") {
    return { outcome: "not_an_answer" };
  }

  // LIMB 1 — the reply names its own subject. Independent authority: this is
  // the plain #868 grammar, which binds by identity and competitor unanimity
  // with no pending question in play at all.
  const full = deriveStatedTargetBaselinePercent(message, targetLabel, competingLabels);
  if (full !== undefined) return { outcome: "bound", percent: full, authority: "subject" };

  const m = ELLIPTICAL_ANSWER_PATTERN.exec(message);
  if (m !== null) {
    const raw = m.groups?.["value"] ?? "";
    const value = Number(raw);
    const hasExplicitUnit = m.groups?.["unit"] !== undefined;
    if (!Number.isFinite(value)) return { outcome: "unresolved", reason: "unreadable" };
    // Same [0,100] rule as the parent — the mint cell this feeds is unchanged.
    // Told, not swallowed: the user answered, and the answer is off the scale.
    if (!(value >= 0 && value <= 100)) {
      return { outcome: "unresolved", reason: "out_of_range" };
    }
    if (!hasExplicitUnit && raw.includes(".") && value < 1) {
      return { outcome: "unresolved", reason: "ambiguous_scale" };
    }
    // LIMB 2 — no subject of its own; the binding is BORROWED from the pending
    // question. This is the carry the sole-pending gate licenses.
    return { outcome: "bound", percent: value, authority: "elliptical" };
  }

  if (isAttemptedAnswerShape(message)) {
    return { outcome: "unresolved", reason: "unreadable" };
  }
  return { outcome: "not_an_answer" };
}

/**
 * The single raw percent an ANSWER TURN states for the pending question's
 * target, or `undefined`. The BINDING view of
 * {@link classifyElicitedBaselineAnswer} and nothing more: one classifier, no
 * twin to drift (trap 12). Every non-`bound` outcome is `undefined` here, so
 * both mint callers keep exactly the semantics they had — the new information
 * is available only to callers that ask for it.
 */
export function deriveElicitedBaselineAnswerPercent(
  message: string | null | undefined,
  targetLabel: string | null | undefined,
  competingLabels: readonly (string | null | undefined)[] = [],
): number | undefined {
  const verdict = classifyElicitedBaselineAnswer(message, targetLabel, competingLabels);
  return verdict.outcome === "bound" ? verdict.percent : undefined;
}
