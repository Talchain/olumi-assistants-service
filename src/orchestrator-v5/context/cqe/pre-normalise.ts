// CQE input pre-normalisation per CQE Design v1.1 §4.1 step 1.
//
// Produces a single normalised string that is:
//  - truncated to <= 2000 chars on a word boundary (fallback: char boundary
//    if no whitespace in the last 50 chars before the cap)
//  - NFKC unicode-normalised (smart quotes -> straight; currency symbols
//    preserved; compat forms folded)
//  - whitespace-collapsed (runs of whitespace -> single space)
//  - thousand-separator stripped inside numbers ("150,000" -> "150000" only
//    when the comma sits strictly between digits)
//
// Case is NOT altered: all pattern rules use the case-insensitive flag.
// Preserving case keeps raw_text extraction positionally aligned with the
// normalised string the regex rules scan.

export const MAX_INPUT_LENGTH = 2000;
const WORD_BOUNDARY_SEARCH_WINDOW = 50;

export interface NormalisedInput {
  readonly text: string;
  readonly messageTooLong: boolean;
  readonly originalLength: number;
}

export function preNormalise(rawMessage: string): NormalisedInput {
  const originalLength = rawMessage.length;
  const truncated = truncateToCap(rawMessage);
  const normalised = normaliseText(truncated.text);
  return {
    text: normalised,
    messageTooLong: truncated.messageTooLong,
    originalLength,
  };
}

function truncateToCap(input: string): { text: string; messageTooLong: boolean } {
  if (input.length <= MAX_INPUT_LENGTH) {
    return { text: input, messageTooLong: false };
  }
  const searchStart = MAX_INPUT_LENGTH - WORD_BOUNDARY_SEARCH_WINDOW;
  const window = input.slice(searchStart, MAX_INPUT_LENGTH);
  const lastWhitespace = window.search(/\s(?=\S*$)/);
  const cutAt =
    lastWhitespace >= 0 ? searchStart + lastWhitespace : MAX_INPUT_LENGTH;
  return { text: input.slice(0, cutAt), messageTooLong: true };
}

function normaliseText(input: string): string {
  const nfkc = input.normalize('NFKC');
  const whitespaceCollapsed = nfkc.replace(/\s+/g, ' ').trim();
  return stripThousandSeparators(whitespaceCollapsed);
}

function stripThousandSeparators(input: string): string {
  return input.replace(/(\d),(?=\d{3}(?:\D|$))/g, '$1');
}
