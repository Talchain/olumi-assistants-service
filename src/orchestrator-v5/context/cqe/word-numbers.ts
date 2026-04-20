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
const FRACTION_FOLLOW = /^[\s-]+(?:thirds?|quarters?|halves?|half)\b/i;

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
      if (FRACTION_FOLLOW.test(followTail)) {
        // Leave the word in place; P5 owns this phrase.
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
