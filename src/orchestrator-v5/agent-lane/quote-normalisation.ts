/** Fold quote glyphs for matching without changing source offsets or the words that ship. */
export const foldQuotes = (text: string): string => text.replace(/[‘’]/gu, "'").replace(/[“”]/gu, '"');
