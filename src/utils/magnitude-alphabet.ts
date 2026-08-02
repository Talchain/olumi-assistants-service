/**
 * THE MAGNITUDE ALPHABET — ONE list, every consumer (ROADMAP 2.303, 2.316, 2.322)
 *
 * WHY THIS MODULE EXISTS AT ALL, and why it is a leaf with no imports.
 *
 * "How many thousands is this?" has been answered independently, in a
 * hand-written list, in fifteen places in this service. Three of those lists
 * were folded onto one another by #797 and #799 — and each time, a further
 * copy survived the fold, because the census that scoped the work was itself a
 * hand-maintained list of hand-maintained lists (CLAUDE.md trap 12, applied to
 * the repair for trap 12). The copies were not merely redundant: MEASURED at
 * `497a14e`, eight of them were WRONG, in eight different directions, each
 * producing a number 1,000× to 1,000,000,000,000× away from what the user
 * typed, at full confidence, with nothing behavioural able to see it.
 *
 * So the alphabet moved OUT of `cee/factor-extraction/index.ts` — where it was
 * correct but unreachable from `context/`, `utils/` and `compound-goal/`
 * without dragging a 1,500-line extraction module behind it — and into a leaf
 * that anything may import. A shared list nobody can reach is a shared list
 * that gets copied; the location IS the fix.
 *
 * ⚠ IT IS ALSO WHERE THE CANONICAL LIST'S OWN GAP WAS FOUND. `MAGNITUDE_MULTIPLIERS`
 * carried `k`/`m`/`bn`/`b`/`t` and the words `million`/`billion`/`trillion`, but
 * NOT `thousand` — so `"$5 thousand"` extracted as **5** while `"$5 million"`
 * extracted as 5,000,000. The list that #799 had just finished unifying, and
 * whose comment block says the drift guard "asserts that structurally", was
 * missing a key the whole time.
 *
 * ⚠⚠ AND THE FIRST EXPLANATION OF *WHY* — WRITTEN IN THIS BLOCK, AND WRONG —
 * WAS CAUGHT IN REVIEW WITHIN HOURS. It said "every guard #799 shipped is
 * DERIVED FROM the map, so a key absent from the map is invisible to all of
 * them." That generalised from the guards this lane happened to read. MEASURED
 * at base, in a throwaway worktree, by deleting the key `million` from the map:
 * the one genuinely derived per-key guard stayed **GREEN** (its blindness is
 * real), but **6 HARDCODED CORPUS ASSERTIONS went RED across both of #799's
 * guard files**. #799 shipped substantial hand-written corpora alongside its
 * derived guards, and those corpora are the ONLY things in this estate with any
 * power to notice a short list. `thousand` survived not because everything was
 * derived, but because **no corpus happened to spell it**.
 *
 * THE MEASURED LESSON, which is sharper than the one it replaces:
 *
 *   A derived guard proves AGREEMENT and can never prove COMPLETENESS — and the
 *   only thing that CAN catch a short list is a hand-written corpus, i.e.
 *   exactly the mirror derivation was introduced to abolish. Trap 12 has a
 *   second face.
 *
 * So the two kinds of guard are not redundant and neither supersedes the other:
 * derivation stops the consumers drifting from the list, a corpus is what
 * notices the list is short, and dropping either one leaves a whole defect
 * class unobserved. Keep both, and know which is doing which job.
 *
 * `thousand` and `mn` are added here, both measured against sibling lists that
 * already carried them (`cee/extraction/numeric-parser.ts` had both).
 *
 * ORDERING IS THE SAFETY PROPERTY, and it is guaranteed by construction.
 * Alternation is first-match-wins, so a shorter key that PREFIXES a longer one
 * ("b" before "bn", "m" before "million") would swallow it. Sorting
 * longest-first cannot get that wrong for any key, present or future.
 */

/**
 * Every magnitude suffix this service recognises, and what it multiplies by.
 *
 * Matched case-INSENSITIVELY by every consumer, so `K`, `M`, `BN` and `Million`
 * all resolve through their lower-cased key.
 *
 * ⚠ THIS IS THE ONLY PLACE A MAGNITUDE KEY MAY BE WRITTEN. Everything else —
 * the regex alternation, the lookup, the refusal predicate, the display ladder
 * — is DERIVED below, so a key added here is live on every path the instant it
 * lands, with nothing to remember and nothing to keep in sync.
 */
export const MAGNITUDE_MULTIPLIERS: Readonly<Record<string, number>> = {
  k: 1e3,
  m: 1e6,
  bn: 1e9,
  b: 1e9,
  t: 1e12,
  mn: 1e6,
  thousand: 1e3,
  million: 1e6,
  billion: 1e9,
  trillion: 1e12,
};

/**
 * Escape a key for literal use inside a regex alternation (ROADMAP 2.316).
 *
 * Every key today is plain `[a-z]`, so this is a no-op at present — which is
 * exactly why it is easy to forget and worth spelling out. The alternation is
 * DERIVED from the map, so the day someone adds a key carrying `.`, `+`, `?`
 * or `(`, that character would silently become a REGEX OPERATOR rather than a
 * literal: a key like `"m+"` would turn the branch into "one or more m", and
 * the pattern would start matching text nobody wrote. Deriving a pattern from
 * data means the data must be escaped on the way in.
 */
function escapeRegExpLiteral(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The alternation branch for the alphabet above, longest-first.
 *
 * The tie-break is lexicographic so the string is a pure function of the KEY
 * SET — insertion order cannot change it, and neither can a re-format.
 *
 * ⚠ Sorted by the RAW key length, then escaped. Escaping first would let a
 * key's backslashes inflate its measured length and corrupt the longest-first
 * ordering that stops "bn" being consumed as a bare "b".
 */
export const MAGNITUDE_ALTERNATION: string = Object.keys(MAGNITUDE_MULTIPLIERS)
  .sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0))
  .map(escapeRegExpLiteral)
  .join("|");

/**
 * The SAME alphabet, keyed for lookup — case-folded (ROADMAP 2.316).
 *
 * WHY THIS EXISTS RATHER THAN INDEXING `MAGNITUDE_MULTIPLIERS` DIRECTLY. Every
 * pattern that reads a magnitude carries the `i` flag, so the regex will match
 * ANY casing of ANY key. The lookup must therefore admit any casing of any key
 * too, or the two disagree — and a lookup that disagrees with its own regex
 * does not fail loudly, it takes the `?? 1` branch and publishes a number that
 * is 1,000× to 1,000,000,000,000× wrong at full confidence. That is exactly how
 * `$5MILLION` extracted as 5 before #799.
 *
 * ⚠ AND IT FAILS LOUD ON A CASE-FOLD COLLISION. `new Map(entries)` keeps the
 * LAST entry for a duplicate key, so adding `Bn` beside an existing `bn` would
 * silently produce a shorter lookup than the alphabet: the alternation would
 * still offer both branches, the regex would still match both, and one of them
 * would resolve through `?? 1`. A silent shrink is the estate's dominant
 * failure mode; this one shrinks at MODULE LOAD, where a throw is the loudest
 * and cheapest possible alarm, and where every consumer trips it on import.
 */
const MAGNITUDE_BY_FOLDED_KEY: ReadonlyMap<string, number> = (() => {
  const folded = new Map<string, number>();
  for (const [key, value] of Object.entries(MAGNITUDE_MULTIPLIERS)) {
    const lower = key.toLowerCase();
    const existing = folded.get(lower);
    if (existing !== undefined && existing !== value) {
      throw new Error(
        `MAGNITUDE_MULTIPLIERS: case-fold collision on '${lower}' — keys that differ only ` +
          `by case must not carry different multipliers (${existing} vs ${value}).`,
      );
    }
    folded.set(lower, value);
  }
  if (folded.size !== Object.keys(MAGNITUDE_MULTIPLIERS).length) {
    throw new Error(
      `MAGNITUDE_MULTIPLIERS: ${Object.keys(MAGNITUDE_MULTIPLIERS).length} keys case-folded to ` +
        `${folded.size} lookup entries — a duplicate key was silently dropped.`,
    );
  }
  return folded;
})();

/**
 * The digit grammar shared by every amount this service reads: optional
 * thousands separators, optional decimals. Separators are stripped before
 * parsing (`parseAmountDigits`) — `parseFloat("800,000")` is 800, which is the
 * same silent 1,000× loss as a dropped suffix, arriving through the comma.
 */
export const AMOUNT_DIGITS = "\\d+(?:,\\d{3})*(?:\\.\\d+)?";

/**
 * The alphabet itself, under a caller-chosen group name, with the load-bearing
 * `\b` that closes it. Sole source of the alternation for every pattern that
 * reads a magnitude — the optional and required spellings below differ only in
 * their wrapper, so there is nowhere for another copy to hide.
 */
export function magnitudeSuffixFragment(group: string): string {
  return `(?<${group}>${MAGNITUDE_ALTERNATION})\\b`;
}

/**
 * The magnitude-suffix fragment, OPTIONAL, under a caller-chosen group name.
 *
 * ⚠ THE `\\s*` SITS INSIDE THE OPTIONAL GROUP, not before it. Spelled
 * `\\s*(?<g>ALT)?\\b`, the `\\s*` consumes the separating space of
 * "target is 800 customers" EVEN WHEN NO SUFFIX FOLLOWS, and every
 * `matchedText` in the corpus gains a trailing byte. Spelled
 * `(?:\\s*(?<g>ALT)\\b)?` the space is consumed only when a suffix is actually
 * there, and byte-parity holds.
 *
 * ⚠ THE INNER `\\b` IS LOAD-BEARING, and its absence produced a silent 1e12
 * error in development (#787): without it the `t` alternative matches the "t"
 * of "6000000 THIS year", scaling a 6,000,000 target to 6e18. With it, the `t`
 * branch fails, the whole group matches empty WITHOUT consuming the space, and
 * the amount reads correctly.
 */
export function magnitudeSuffixPattern(group: string): string {
  return `(?:\\s*${magnitudeSuffixFragment(group)})?`;
}

/**
 * The optional magnitude suffix with NO capture group (ROADMAP 2.322).
 *
 * WHY AN ANONYMOUS SPELLING EXISTS AT ALL. A pattern may need the alphabet
 * more than once — `"between £2m and £5bn"` carries two amounts in one regex —
 * and JavaScript rejects a regex with two identically-named groups outright
 * (`SyntaxError: Duplicate capture group name`). Without this spelling the
 * only way to write such a pattern is to hand-spell the alphabet inline, which
 * is precisely the copy this module exists to abolish: `compound-goal` had
 * EIGHTEEN patterns spelling `[kKmMbB]?`, so its amounts could never carry a
 * `t` or a word form no matter what its parser understood. Derived from the
 * same alternation, so it cannot drift from the named spellings.
 */
export const MAGNITUDE_SUFFIX_ANON = `(?:\\s*(?:${MAGNITUDE_ALTERNATION})\\b)?`;

/**
 * The regex form of `isMagnitudeShapedSuffix` (ROADMAP 2.322).
 *
 * Placed immediately AFTER an optional magnitude suffix, this refuses the one
 * shape the service genuinely cannot read: an attached run that BEGINS with a
 * key from the alphabet but is not exactly one of them. `"$5mARR"` may be five
 * million ARR or five m-somethings and those readings are 1,000,000× apart, so
 * the amount does not match at all and the caller emits nothing.
 *
 * ⚠ IT IS DELIBERATELY NARROWER THAN "FOLLOWED BY ANY LETTER". `£49pcm`,
 * `$100pa`, `£20ph`, `£49ea`, `$50s`, `$5USD` and `€500EUR` do NOT begin with a
 * magnitude key, cannot be a mis-read magnitude, and must keep extracting —
 * that is #799's narrowing, and widening this guard to any letter would undo
 * it silently for every consumer at once.
 *
 * Derived from the same alternation as the suffix itself, so the predicate and
 * the thing it guards can never disagree about what a magnitude key is.
 */
export const MAGNITUDE_AMBIGUOUS_TRAILER_GUARD = `(?!(?:${MAGNITUDE_ALTERNATION})[A-Za-z])`;

/**
 * The magnitude suffix REQUIRED, not optional (ROADMAP 2.316).
 *
 * `currencyWithMultiplier` exists to match amounts that DO carry a magnitude —
 * "$5m", not "$100" — and it must keep that meaning. Spelling it with the
 * optional form would make it match every bare currency amount in the corpus
 * and promote each one from the `currency` rule's `inferred` / 0.60 to
 * `explicit` / 0.85. That is an EXPANSION of the extraction surface, not a
 * magnitude repair, so the optionality is the ONE thing that differs between
 * the two spellings — and both are built from the same fragment, so neither can
 * drift from the alphabet.
 */
export function requiredMagnitudeSuffixPattern(group: string): string {
  return `\\s*${magnitudeSuffixFragment(group)}`;
}

/** Parse a captured digit string, separators and all, to a finite number or null. */
export function parseAmountDigits(digits: string | undefined): number | null {
  if (digits === undefined) return null;
  const parsed = Number.parseFloat(digits.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

/** Resolve a captured magnitude suffix to its multiplier; absent suffix ⇒ 1. */
export function resolveMagnitude(suffix: string | undefined): number {
  if (!suffix) return 1;
  return MAGNITUDE_BY_FOLDED_KEY.get(suffix.toLowerCase()) ?? 1;
}

/**
 * Is this string a magnitude the alphabet can read? (ROADMAP 2.316)
 *
 * Used by fallback rules to tell "letters this service UNDERSTANDS, already
 * read by the magnitude-bearing rule" from "letters it CANNOT read", which must
 * refuse rather than emit the bare digits.
 */
export function isKnownMagnitude(suffix: string): boolean {
  return MAGNITUDE_BY_FOLDED_KEY.has(suffix.toLowerCase());
}

/**
 * Does this attached suffix look like it is MODIFYING THE MAGNITUDE of the
 * number it rides on? (ROADMAP 2.316, narrowed in review)
 *
 * ⚠ THIS PREDICATE WAS ONCE "ANY ATTACHED LETTERS AT ALL", AND THAT WAS A LIVE
 * REGRESSION. Measured on the first cut of #799 against its base: `£49pcm`,
 * `$100pa`, `£20ph`, `£49ea`, `$50s`, `$5USD` and `€500EUR` all extracted at
 * base and returned NO FACTOR after it. None of those trailers touches the
 * magnitude — they are per-month / per-annum / per-hour / each / plural /
 * currency-code tags sitting beside a number that is exactly what it says.
 *
 * THE RULE ACTUALLY IMPLEMENTED, stated so the comment cannot describe a
 * narrower one than the code: refuse when the attached run BEGINS WITH a key
 * from the alphabet but is not exactly one of them. That is the only case where
 * the service genuinely cannot tell what it is looking at — "$5mARR" may be
 * five million ARR or five m-somethings, and both readings are 1,000,000×
 * apart. A run that begins with no magnitude key at all ("pcm", "USD") cannot
 * be a mis-read magnitude, so it is left alone and the amount extracts.
 *
 * DERIVED FROM THE MAP, not from a list of "unit-ish" words — a hand-written
 * allow-list of suffixes to tolerate would be another mirror to drift, and
 * would fail closed on every unit nobody thought of.
 *
 * ⚠ DISCLOSED IMPRECISION: `$5tonnes` refuses, because `t` IS the trillion key
 * and "$5t" legitimately means five trillion. That ambiguity is real and lives
 * in the alphabet, not in this predicate; refusing an ambiguous magnitude is
 * the doctrine, and the alternative is publishing a number that may be 1e12×
 * wrong.
 */
export function isMagnitudeShapedSuffix(suffix: string): boolean {
  // A run that IS a key exactly was already read correctly by the
  // magnitude-bearing rule; its companion factor is pristine behaviour.
  if (isKnownMagnitude(suffix)) return false;
  const folded = suffix.toLowerCase();
  for (const key of MAGNITUDE_BY_FOLDED_KEY.keys()) {
    if (folded.startsWith(key)) return true;
  }
  return false;
}

/**
 * THE FORMATTING SIDE OF THE SAME ALPHABET (ROADMAP 2.322).
 *
 * Descending rungs of `[multiplier, canonical short suffix]`, DERIVED from the
 * same map the parsers read, so a magnitude the service can PARSE is a
 * magnitude it can also PRINT. Two ladders were hand-written and both stopped
 * short: `cee/factor-extraction/display-value.ts` stopped at 1e6, rendering
 * `$5t` as the clumsy `"$5000000m"`, and `cee/compound-goal/node-generator.ts`
 * stopped at 1e9. Neither was untruthful — the digits were right — but a
 * formatter that cannot spell a magnitude its own parser accepts is the same
 * list-drift defect wearing a cosmetic mask, and the next rung added to the
 * parser would have silently failed to reach either of them.
 *
 * THE SUFFIX IS THE SHORTEST KEY FOR THAT MULTIPLIER, tie-broken
 * lexicographically. That is a pure function of the key set — `k`, `m`, `b`,
 * `t` today, and whatever the shortest spelling of a future rung is — so no
 * display convention has to be maintained by hand beside the alphabet.
 * Sub-1,000 values have no rung and are formatted plainly by the caller.
 */
export const MAGNITUDE_DISPLAY_LADDER: ReadonlyArray<readonly [number, string]> = (() => {
  const shortestByMultiplier = new Map<number, string>();
  for (const [key, multiplier] of Object.entries(MAGNITUDE_MULTIPLIERS)) {
    if (multiplier < 1e3) continue;
    const existing = shortestByMultiplier.get(multiplier);
    if (
      existing === undefined ||
      key.length < existing.length ||
      (key.length === existing.length && key < existing)
    ) {
      shortestByMultiplier.set(multiplier, key);
    }
  }
  return [...shortestByMultiplier.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([multiplier, key]) => [multiplier, key] as const);
})();
