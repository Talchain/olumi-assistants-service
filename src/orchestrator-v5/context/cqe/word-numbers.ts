// Word-number lexicon pre-pass per CQE Design v1.1 §4.1 step 2.
//
// Replaces one..ten with numerals before the rule table scans. Word fractions
// (half/quarter/third, two thirds, three quarters) are NOT replaced here.
// they carry operator/multiplier semantics that P5 preserves.
//
// Position tracking: every substituted digit's position in the new string is
// recorded so downstream rules can stamp value_origin: "word_number" when a
// match overlaps a replacement.

const WORD_NUMBER_LEXICON: ReadonlyArray<readonly [string, string]> = [
  ['one', '1'],
  ['two', '2'],
  ['three', '3'],
  ['four', '4'],
  ['five', '5'],
  ['six', '6'],
  ['seven', '7'],
  ['eight', '8'],
  ['nine', '9'],
  ['ten', '10'],
];

export interface WordNumberReplacement {
  readonly start: number;
  readonly end: number;
}

export interface WordNumberPrePassResult {
  readonly text: string;
  readonly replacements: readonly WordNumberReplacement[];
}

// Skip replacement when the word-number is immediately followed (after
// whitespace or hyphen) by a fraction word. "one third", "two thirds",
// "three quarters" are word fractions owned by P5. Converting their lead
// number to a digit ("1 third") breaks P5 matching.
//
// Also covers the MIXED-fraction "and a <fraction>" tail ("one and a half" =
// 1.5, "two and a quarter" = 2.25): folding the lead to a digit committed the
// whole part ("1") and dropped the fraction — the same silent wrong-value bug.
// The "and a" prefix keeps this narrow: a bare "and" (ranges/lists) is NOT a
// fraction cue, so it is deliberately excluded.
const FRACTION_FOLLOW =
  /^[\s-]+(?:(?:thirds?|quarters?|halves?|half)\b|and\s+a\s+(?:half|quarter|third)\b)/i;

// Skip replacement when the word-number is part of a larger COMPOUND number
// — i.e. it is immediately adjacent (across whitespace or a hyphen) to another
// number token: a magnitude word (hundred/thousand/million/…/grand), a tens
// word (twenty…ninety), or a digit. Folding one FRAGMENT of a compound to a
// digit is the silent-corruption bug this guards: "one hundred and forty" would
// become "1 hundred and forty" and the deterministic value-update would commit
// 1. Leaving the whole phrase as words lets the compromise backstop (and,
// failing that, the LLM) read the compound correctly. The failure mode is
// therefore always "no partial-compound digit" → correct value or LLM, never a
// wrong number.
//
// Note "thousand"/"million" are guarded even though their digit path
// ("2 thousand" → 2000) happens to be correct: the compromise backstop reads
// the intact word compound to the same value, so the guard keeps the correct
// answer while removing the whole partial-fragment hazard class uniformly
// rather than enumerating which magnitudes are safe (a mirror we won't keep).
// ⚠ EXPORTED SOLELY SO THE CANONICAL ALPHABET'S UNION GUARD CAN READ IT
// (ROADMAP 2.330). This is a magnitude VOCABULARY, not a value lookup — it
// answers "is this token a magnitude word?" for compound detection, never "how
// many thousands is it?". It is still a sibling list of magnitude words, and it
// is the only place in `src/` that spells `grand` and `hundred` as magnitudes,
// so the union guard reads it and the canonical alphabet must account for every
// token in it — either by carrying the key, or by excluding it EXPLICITLY with
// a stated reason.
export const MAGNITUDE_ALT = 'hundred|thousand|million|billion|trillion|grand';
const TENS_ALT = 'twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety';
// "point" is the spoken decimal separator ("one point five" = 1.5). A
// word-number on EITHER side of it is a decimal fragment, never a standalone
// value — folding "one" to a digit committed 1 and dropped the ".5". Adjacency
// to "point" therefore leaves the whole phrase as words → correct value or LLM.
const CONNECTOR_ALT = 'point';
const NUMBER_WORD_ALT = `${MAGNITUDE_ALT}|${TENS_ALT}|${CONNECTOR_ALT}`;

// Tail (text after the matched word) begins with a number word or a digit.
// No "and" bridge here: English only connects with "and" AFTER a magnitude
// ("one hundred AND forty"), which the PRECEDE side handles for the trailing
// fragment; a bare word-number is never "and"-connected on its leading side.
const COMPOUND_FOLLOW = new RegExp(
  `^[\\s-]+(?:(?:${NUMBER_WORD_ALT})\\b|\\d)`,
  'i',
);
// Head (text before the matched word) ends with EITHER a number word / digit
// then the separator ("twenty five", "forty-five", "5 five"), OR a MAGNITUDE
// word + "and" + the separator ("hundred and six", the trailing ones of a
// "N hundred and M" compound). The "and" bridge is magnitude-ONLY on purpose:
// a range like "between five and ten" (which folds to "between 5 and ten") must
// NOT be misread as a compound — its "and" follows a digit, not a magnitude.
const COMPOUND_PRECEDE = new RegExp(
  `(?:(?:\\b(?:${NUMBER_WORD_ALT})|\\d)[\\s-]+|\\b(?:${MAGNITUDE_ALT})\\s+and[\\s-]+)$`,
  'i',
);

export function applyWordNumberPrePass(input: string): WordNumberPrePassResult {
  let text = input;
  const replacements: WordNumberReplacement[] = [];
  for (const [word, numeral] of WORD_NUMBER_LEXICON) {
    const pattern = new RegExp(`\\b${word}\\b`, 'gi');
    let scan = '';
    let cursor = 0;
    for (;;) {
      pattern.lastIndex = cursor;
      const match = pattern.exec(text);
      if (!match) {
        scan += text.slice(cursor);
        break;
      }
      const followTail = text.slice(match.index + match[0].length);
      const precedeHead = text.slice(0, match.index);
      if (
        FRACTION_FOLLOW.test(followTail) ||
        COMPOUND_FOLLOW.test(followTail) ||
        COMPOUND_PRECEDE.test(precedeHead)
      ) {
        // Leave the word in place: P5 owns the fraction phrases, and a partial
        // compound must never be folded to a lead digit (see COMPOUND_* above).
        scan += text.slice(cursor, match.index + match[0].length);
        cursor = match.index + match[0].length;
        continue;
      }
      scan += text.slice(cursor, match.index);
      const newStart = scan.length;
      scan += numeral;
      replacements.push({ start: newStart, end: newStart + numeral.length });
      cursor = match.index + match[0].length;
    }
    text = scan;
  }
  return { text, replacements };
}

export function overlapsWordNumberReplacement(
  replacements: readonly WordNumberReplacement[],
  spanStart: number,
  spanEnd: number,
): boolean {
  for (const { start, end } of replacements) {
    if (start < spanEnd && end > spanStart) return true;
  }
  return false;
}
