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
export const PRESENT_STATE_QUALIFIERS: readonly string[] = [
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
 * The percent MARKER an elicited answer may carry, and — since ROADMAP 2.1361
 * — may equally OMIT.
 *
 * ⚠ WHY THIS IS OPTIONAL, and why that is not a loosening of the no-invention
 * rule. The parent statement grammar is percent-only because a bare "churn is
 * 12" on an arbitrary turn states no unit and CEE may not invent one. The
 * elicited limb is a different cell: it is reachable ONLY behind a live
 * server-minted `elicit_target_baseline` pending for THIS target, and that
 * pending's own question is "Roughly what percentage is <target> at right
 * now?". The question supplies the UNIT exactly as it already supplies the
 * REFERENT — both come from the ask, neither from the extractor. Requiring the
 * user to re-state a unit the product just named is not caution, it is a
 * product that cannot hear the answers to its own question: `30`,
 * `roughly 30` and `30 percent` (two of which echo the ask's own words) all
 * refused before this change, while the ask never stated the requirement.
 *
 * The marker itself stays a CLOSED alternation so a stray trailing word is
 * still a refusal; `percent`/`per cent` are the British and American spellings
 * of the ask's own noun.
 */
const PERCENT_MARKER = "(?:\\s*%|\\s+per\\s*cent|\\s+percent|\\s+percentage)";

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
 * grammar, ONE unsigned number with an OPTIONAL percent marker (2.1361 — see
 * `PERCENT_MARKER`; the ask supplies the unit), optional trailing qualifiers,
 * and at most a closing '.' or '!'. Anything else refuses: a '?' (question
 * echo), a quote, a delta or bound word, a second number, a conditional tail,
 * "maybe" — every one of these may change the claim, and only the full grammar
 * (which demands a subject) is entitled to judge a longer utterance. [0,100]
 * for the same reason as the parent (the mint cell it feeds is unchanged).
 *
 * NOTE the whole-message anchoring is what makes the optional marker safe: a
 * bare number is admitted only when the ENTIRE message is that number plus
 * closed-vocabulary hedging. "12 higher", "under 12", "10-15", "12 or 15" and
 * "-12" all still refuse, because no limb of this pattern can consume the
 * extra token — they are refusals of the GRAMMAR, not of the '%'.
 */
const ELLIPTICAL_ANSWER_PATTERN = new RegExp(
  "^\\s*" +
    "(?:(?:it|that)(?:['’]s|\\s+is)\\s+|we(?:['’]re|\\s+are)\\s+(?:at\\s+)?)?" +
    `(?:${QUALIFIER_ALT}\\s+)*` +
    "(?<value>\\d+(?:\\.\\d+)?)" +
    `${PERCENT_MARKER}?` +
    `(?:\\s+${QUALIFIER_ALT})*` +
    "\\s*[.!]?\\s*$",
  "i",
);

/**
 * ROADMAP 2.1361 — the CLOSED vocabulary that makes a non-binding message
 * recognisable as an ANSWER ATTEMPT rather than a change of subject.
 *
 * WHY THIS EXISTS. Before 2.1361 every non-match fell through in SILENCE: an
 * unreadable answer landed nowhere and the product never said why. Re-asking
 * needs a discriminator, and the one thing this codebase must not build is
 * another natural-language predicate settled by length constants with hard
 * cliffs on either side (CLAUDE.md trap 22f — four rounds of oscillation on
 * exactly that shape). So the discriminator is STRUCTURAL and closed: a
 * message is an answer ATTEMPT when it carries at least one digit AND every
 * alphabetic token in it is a member of this union. Nothing else can reach
 * the re-ask, so a user who has changed the subject is never hijacked, and the
 * fail direction is the pre-2.1361 silence.
 *
 * The union is deliberately small and each group has a stated job:
 *   - pronoun leads and qualifiers: the grammar's own vocabulary, so a
 *     near-miss on a shape the grammar ALMOST accepts is recognised;
 *   - unit words: the ask's own noun;
 *   - hedges and connectors: the vocabulary of the answers that are genuinely
 *     UNUSABLE rather than absent — a guess ("maybe 12%"), a range
 *     ("10 to 15%"), a choice ("12% or 15%"), an aside ("about 12%, I think").
 *     These are the shapes that must ASK rather than bind, and asking is only
 *     possible if they are distinguishable from silence.
 */
export const ANSWER_ATTEMPT_VOCABULARY: ReadonlySet<string> = new Set([
  // The elliptical grammar's own pronoun leads.
  "it",
  "that",
  "we",
  "is",
  "are",
  // The shared present-state qualifier vocabulary (derived, not mirrored).
  ...PRESENT_STATE_QUALIFIERS,
  // The ask's own unit noun, both spellings.
  "percent",
  "percentage",
  "per",
  "cent",
  // Guess hedges: an answer the user is not asserting.
  "maybe",
  "perhaps",
  "possibly",
  "probably",
  "i",
  "think",
  "guess",
  "reckon",
  "say",
  "sure",
  "not",
  // Range / choice connectors: an answer that names more than one value.
  "or",
  "to",
  "and",
  "between",
]);

/** Contraction tails stripped before tokenising, so "it's"/"we're" tokenise cleanly. */
const CONTRACTION_TAIL_RE = /['’](?:s|re|d|ll|m|ve|t)\b/gi;

/**
 * True when the message is structurally an ATTEMPT to answer the pending
 * baseline question: it carries a digit, and every alphabetic token belongs to
 * {@link ANSWER_ATTEMPT_VOCABULARY}. Pure membership over a closed set — no
 * length threshold, no clause-boundary judgement, nothing that can oscillate.
 */
function isAnswerAttempt(message: string): boolean {
  if (!/\d/.test(message)) return false;
  const words = message.replace(CONTRACTION_TAIL_RE, "").toLowerCase().match(/[a-z]+/g);
  if (words === null) return true; // digits and punctuation only, e.g. "10-15%"
  return words.every((w) => ANSWER_ATTEMPT_VOCABULARY.has(w));
}

/**
 * ROADMAP 2.1361 — what the answer turn should DO, in three outcomes.
 *
 * `bound` and `not_an_answer` are the pre-2.1361 behaviour unchanged (mint, or
 * silent fall-through). `unusable` is the new middle: the user plainly TRIED
 * to answer and the extractor may not honour it — a guess, a range, a choice,
 * an out-of-range figure, an aside the grammar cannot judge. The caller
 * RE-ASKS on `unusable` rather than binding, which is the half of the
 * acceptance condition that stops a widened binder writing wrong values
 * confidently: a binder that accepts everything is worse than one that
 * refuses in silence.
 */
export type ElicitedBaselineAnswer =
  | { readonly outcome: "bound"; readonly value: number }
  | { readonly outcome: "unusable" }
  | { readonly outcome: "not_an_answer" };

/**
 * The classifier {@link deriveElicitedBaselineAnswerPercent} is the value-only
 * projection of. ONE parser, two readers — the mint path asks for the number,
 * the routing path asks what to say — so the two can never disagree about
 * whether a message bound (CLAUDE.md trap 21: two authorities under similar
 * names answering different questions).
 *
 * Callers MUST gate this on a live `elicit_target_baseline` pending whose
 * target is `targetLabel`'s node; see
 * {@link deriveElicitedBaselineAnswerPercent} for why, and note that this
 * function itself is REFERENT-BLIND by construction (it cannot check a gate it
 * is not given). The gate is pinned at its two call sites, not here.
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
  // Deliberately NOT `unusable`: with no referent there is no question to
  // re-ask, so silence is the only honest outcome.
  if (typeof targetLabel !== "string" || targetLabel.trim() === "") {
    return { outcome: "not_an_answer" };
  }

  const full = deriveStatedTargetBaselinePercent(message, targetLabel, competingLabels);
  if (full !== undefined) return { outcome: "bound", value: full };

  const m = ELLIPTICAL_ANSWER_PATTERN.exec(message);
  if (m !== null) {
    const value = Number(m.groups?.["value"]);
    // Same [0,100] rule as the parent — the mint cell this feeds is unchanged.
    // A well-formed answer OUTSIDE the range is the clearest `unusable` there
    // is: the product understood it perfectly and still may not use it, so
    // saying so is strictly better than silence.
    if (Number.isFinite(value) && value >= 0 && value <= 100) {
      return { outcome: "bound", value };
    }
    return { outcome: "unusable" };
  }

  return isAnswerAttempt(message) ? { outcome: "unusable" } : { outcome: "not_an_answer" };
}

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
 * ⚠ THIS FUNCTION IS REFERENT-BLIND ON THE ELLIPTICAL LIMB, BY CONSTRUCTION.
 * `targetLabel` is consulted by the full-sentence limb and is otherwise only a
 * presence check: an elliptical "about 12%" binds under ANY non-empty label,
 * because the label is not what licenses it — the live pending is, and this
 * function is not given one. That is the contract, not a defect, but it means
 * NO TEST HERE CAN OBSERVE A REFERENT MIS-BINDING, and a "positive control"
 * in this file that passes the genuine label proves only that the function
 * runs. The referent discrimination lives at the two GATES
 * (`add-constraint.ts` and `tryBaselineElicitationResume`) and is pinned there
 * by rot-mutant pairs that move the pending's target and assert the bound
 * referent moves with it.
 *
 * EXTRACTION ONLY — never infers, defaults, or rounds; every refusal path
 * returns `undefined` and the caller mints nothing.
 */
export function deriveElicitedBaselineAnswerPercent(
  message: string | null | undefined,
  targetLabel: string | null | undefined,
  competingLabels: readonly (string | null | undefined)[] = [],
): number | undefined {
  const classified = classifyElicitedBaselineAnswer(message, targetLabel, competingLabels);
  return classified.outcome === "bound" ? classified.value : undefined;
}
