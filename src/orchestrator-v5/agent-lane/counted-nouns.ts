/**
 * The things a count is OF that the estate's unit classifier (`unitFamilyOf`) does not list — "1 unit", "300
 * subscribers", "5 customers". A LEAF module (no imports): the switch-level rule (`agent-capabilities.ts`
 * `unitReadsAsQuantity`, #2199) and the stated-figure matcher (`stated-by-user.ts`) share it. Each reader uses it
 * only to REFUSE (a count is not an on-state, and not an amount of money), so a miss here only keeps today's
 * behaviour and the set may stay small.
 */
const COUNTED_NOUNS: ReadonlySet<string> = new Set([
  'unit', 'item', 'piece', 'count', 'number', 'amount', 'quantity', 'customer', 'subscriber', 'account', 'client',
  'member', 'order', 'sale', 'licence', 'license', 'store', 'location', 'product', 'feature',
]);

/** Whether one token names a counted thing (singular or a simple plural). */
export function countedNoun(token: string): boolean {
  const t = token.toLowerCase();
  return COUNTED_NOUNS.has(t) || (t.length > 1 && t.endsWith('s') && COUNTED_NOUNS.has(t.slice(0, -1)));
}
