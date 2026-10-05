/** Same words, ignoring case and spacing — the test for "the same thing". */
export const canonicalLabel = (label: string): string => label.trim().toLowerCase().replace(/\s+/g, ' ');

/** The existing reference level for a signed percentage change stated relative to today. */
export const TODAY_LEVEL = 100;
export const TODAY_UNIT = '% of today';
