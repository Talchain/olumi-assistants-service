/** The method-turn word fold, also used for exact label equality at the factor gate and transaction door. */
export const foldWords = (s: string): string => s
  .replace(/[‘’]/gu, "'")
  .replace(/[“”]/gu, '"')
  .replace(/\s+/gu, ' ')
  .trim()
  .toLowerCase();

/** Exact name equality after typographic quotes, case and whitespace are folded. */
export const sameFoldedLabel = (a: string | undefined, b: string): boolean => foldWords(a ?? '') === foldWords(b);
