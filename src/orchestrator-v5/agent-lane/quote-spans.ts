/**
 * Where quoted words occur in the user's own text, on their own so a reader of the user's words (`quote-confirmation.ts`, which
 * the proposal store loads) needs none of the figure readers in `stated-by-user.ts` (W5, alpha wall). `stated-by-user.ts`
 * re-exports it; nothing changed.
 */

/**
 * Where `quote` occurs in the user's text as whole words and whole numbers (Codex buddy r1 HIGH): never starting or ending
 * inside a word or a number, so "1 percentage points…" is not the user's words when they wrote "11 percentage points…",
 * and "5 points" is not cut from "0.5 points" or "1,5 points".
 */
export function quoteSpansIn(userText: string, quote: string): number[] {
  if (quote === '') return [];
  const isWordChar = (c: string | undefined): boolean => c !== undefined && /[\p{L}\p{N}]/u.test(c);
  const spans: number[] = [];
  for (let at = userText.indexOf(quote); at >= 0; at = userText.indexOf(quote, at + 1)) {
    const before = userText[at - 1]; const first = quote[0]; const last = quote[quote.length - 1];
    const after = userText[at + quote.length];
    // A separator inside a number is never an edge either: ",500 …" from "1,500" (Codex r2 HIGH), "… 1," from "1,500".
    const cutBefore = (isWordChar(before) && isWordChar(first)) || (/[.,]/.test(before ?? '') && /\d/.test(userText[at - 2] ?? '') && /\d/.test(first ?? ''))
      || (/\d/.test(before ?? '') && /[.,]/.test(first ?? '') && /\d/.test(quote[1] ?? ''));
    const cutAfter = (isWordChar(after) && isWordChar(last)) || (/\d/.test(last ?? '') && /[.,]/.test(after ?? '') && /\d/.test(userText[at + quote.length + 1] ?? ''))
      || (/[.,]/.test(last ?? '') && /\d/.test(after ?? '') && /\d/.test(quote[quote.length - 2] ?? ''));
    if (!cutBefore && !cutAfter) spans.push(at);
  }
  return spans;
}
