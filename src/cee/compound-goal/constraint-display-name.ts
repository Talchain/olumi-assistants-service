/**
 * ROADMAP 2.653 (I-B) — A CONSTRAINT'S DISPLAY NAME IS USER LANGUAGE, NEVER A
 * MACHINE SUFFIX.
 *
 * WHAT THIS CLOSES (walk-2634 J5, reproduced byte-identically in
 * `consent-witness-findings-2026-08-07.md` §2). The extractor named its
 * constraints `${targetName} floor` / `${targetName} ceiling` — the internal
 * direction word, concatenated onto a raw regex capture. On the tester's brief
 * that produced:
 *
 *     "churn could rise floor"
 *
 * which was then quoted back at them, in the primary analysis message, as one
 * of "the conditions you set". The tester's own note: *"A user cannot recognise
 * this as their own constraint."* Two separate leaks in four words — the
 * capture is a verb phrase rather than a subject, and "floor" is an
 * implementation term no user wrote.
 *
 * THE RULE. A display name states, in plain words, WHAT MEASURE and WHICH SIDE
 * of WHAT VALUE — "Churn stays at or below 3%" — and the value is rendered from
 * the USER'S OWN TEXT for that number, never from the normalised model value.
 * That second half matters more than it looks: by the time a constraint reaches
 * the wire its `value` has been unit-normalised (the brief's "3%" is `0.03`),
 * so a name built from the numeric field would either read "0.03" or require
 * this module to re-derive a unit conversion it has no business owning. Quoting
 * the matched text is exact, needs no arithmetic, and cannot drift from what
 * the user typed.
 *
 * WHAT IS DELIBERATELY NOT DONE HERE: no title-casing, no re-wording of the
 * subject, no synonym mapping. The subject is the user's phrase with
 * grammatical scaffold trimmed off the ends; anything more would be this module
 * inventing a name for something the user already named.
 *
 * Pure, no I/O, exported for direct test.
 */

/**
 * Words that carry no measure — the connective tissue a regex subject capture
 * drags in from around the real noun ("while keeping churn" -> "churn").
 *
 * ⚠ HAND-WRITTEN, therefore the part that can go short (CLAUDE.md trap 12d).
 * It is exercised by a hand-written corpus of real captured subjects in
 * `__tests__/constraint-display-name.test.ts` rather than by anything derived
 * from the list itself. Trimming is END-ONLY and non-destructive: a subject that
 * trims to nothing degrades to the value-only phrasing rather than to a wrong
 * name, so a missing word here costs tidiness, never truth.
 */
const SCAFFOLD_WORDS = new Set([
  'while', 'whilst', 'keeping', 'keep', 'maintaining', 'maintain', 'holding', 'hold',
  'ensuring', 'ensure', 'so', 'and', 'but', 'that', 'the', 'our', 'their', 'my',
  'a', 'an', 'of', 'to', 'is', 'are', 'be', 'been', 'we', 'it', 'they', 'then',
  'also', 'with', 'for', 'at', 'in', 'on', 'stays', 'stay', 'staying', 'remains',
  'remain', 'remaining', 'must', 'should', 'need', 'needs', 'want', 'wants',
]);

/**
 * Comparator words and bare amounts that the extractor's fixed-width subject
 * capture drags in from the LEFT when two thresholds share one clause
 * ("Costs might rise above 50000 and NPS must be at least 40" captures the
 * subject "above 50000 and NPS"). Trimming these off the front recovers the
 * real subject; leaving them on puts a stray number in a user-facing name.
 */
const COMPARATOR_WORDS = new Set([
  'above', 'over', 'beyond', 'below', 'under', 'beneath', 'than', 'most',
  'least', 'more', 'less', 'exceed', 'exceeds', 'exceeding', 'past',
]);

/** A bare amount token ("50000", "£50k", "3%", "1,000"). */
const BARE_AMOUNT_RE = /^[£$€]?[\d][\d,.]*[kKmMbBtT]?%?$/;

/**
 * Movement verbs the subject capture picks up on its right-hand edge
 * ("Revenue rises above £500k" captures the subject "Revenue rises"). The
 * measure is the noun; the verb belongs to the sentence, not to the limit's
 * name. Trailing-only — a movement word in the MIDDLE is part of a real
 * measure ("cost of rising interest").
 */
const TRAILING_MOVEMENT_WORDS = new Set([
  'rise', 'rises', 'rising', 'grow', 'grows', 'growing', 'increase', 'increases',
  'increasing', 'climb', 'climbs', 'climbing', 'fall', 'falls', 'falling',
  'drop', 'drops', 'dropping', 'decline', 'declines', 'declining', 'decrease',
  'decreases', 'decreasing', 'exceed', 'exceeds', 'exceeding', 'goes', 'go',
  'going', 'went', 'stays', 'stay', 'staying',
]);

/** The extractor's own placeholder when a pattern captured no subject at all. */
const NO_SUBJECT_PLACEHOLDER = 'unspecified';

/**
 * Trim grammatical scaffold from BOTH ENDS of a captured subject, returning
 * `null` when nothing of substance is left.
 *
 * End-only by design. Stripping scaffold from the MIDDLE would silently rewrite
 * multi-word measures ("cost of goods sold" -> "cost goods sold"), which is the
 * kind of helpful mangling that makes a name unrecognisable — the very defect
 * this module exists to remove.
 */
export function cleanConstraintSubject(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const words = raw.trim().split(/\s+/).filter((w) => w.length > 0);
  const isLeadingNoise = (w: string) =>
    SCAFFOLD_WORDS.has(w.toLowerCase()) ||
    COMPARATOR_WORDS.has(w.toLowerCase()) ||
    BARE_AMOUNT_RE.test(w);
  const isTrailingNoise = (w: string) =>
    SCAFFOLD_WORDS.has(w.toLowerCase()) || TRAILING_MOVEMENT_WORDS.has(w.toLowerCase());
  let start = 0;
  let end = words.length;
  while (start < end && isLeadingNoise(words[start]!)) start++;
  while (end > start && isTrailingNoise(words[end - 1]!)) end--;
  const cleaned = words.slice(start, end).join(' ');
  if (cleaned.length === 0) return null;
  if (cleaned.toLowerCase() === NO_SUBJECT_PLACEHOLDER) return null;
  return cleaned;
}

/** Capitalise the first character only — "NPS" and "MRR" must survive intact. */
function leadCapital(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

/**
 * The direction clause.
 *
 * IMPERATIVE ("Keep X at or below N"), not third-person ("X stays at or below
 * N"), for one measured reason: subject-verb agreement. Half the measures a
 * brief names are plural or mass nouns — costs, sales, returns, churn — and the
 * third-person form produces "Costs stays at or below £50,000" for every one of
 * them. The imperative agrees with any subject, so the name cannot be
 * ungrammatical for a class of measures. Rendering a name a user cannot
 * recognise is the whole defect being closed here; rendering one they can
 * recognise but that reads as broken English is only a smaller version of it.
 */
const BOUND_PHRASE = {
  '<=': 'at or below',
  '>=': 'at or above',
} as const;

/**
 * Name a bound constraint: `"Keep churn at or below 3%"`.
 *
 * @param subject   the raw captured subject; scaffold-trimmed here.
 * @param operator  the constraint's own operator — the name always agrees with
 *                  the operator it ships beside, because both are read from the
 *                  same argument rather than composed at different call sites.
 * @param valueText the user's own text for the number ("3%", "£50k").
 */
export function buildBoundDisplayName(
  subject: string | null | undefined,
  operator: '<=' | '>=',
  valueText: string,
): string {
  const bound = BOUND_PHRASE[operator];
  const cleaned = cleanConstraintSubject(subject);
  const value = valueText.trim();
  // No usable subject: state the bound alone rather than name it "unspecified".
  if (cleaned === null) return leadCapital(`${bound} ${value}`);
  return leadCapital(`Keep ${cleaned} ${bound} ${value}`);
}

/**
 * Name a reduction constraint: `"Reduce churn by at least 5%"`.
 *
 * Separate from {@link buildBoundDisplayName} because a reduction is a CHANGE,
 * not a level — `<=` with a negative value (ROADMAP 1.52). Rendering it with
 * the level phrasing would read "keep churn at or below -5%", which is both
 * unrecognisable and, taken literally, false.
 */
export function buildReductionDisplayName(
  subject: string | null | undefined,
  valueText: string,
): string {
  const cleaned = cleanConstraintSubject(subject);
  const value = valueText.trim();
  if (cleaned === null) return leadCapital(`Reduce by at least ${value}`);
  return leadCapital(`Reduce ${cleaned} by at least ${value}`);
}
