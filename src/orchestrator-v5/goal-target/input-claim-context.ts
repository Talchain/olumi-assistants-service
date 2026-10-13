import { bandTheUserWrote, clausesOf, factorTheUserNamed, linkEffectQuoteContextMiss } from '../agent-lane/stated-by-user.js';

type Entity = { readonly id: string; readonly label: string };
type Band = Parameters<typeof bandTheUserWrote>[0];

/** Verified conversation evidence for this directed pair, never a band found elsewhere in history. */
export function linkBandTheUserStated(
  band: Band, verifiedText: string | undefined, nodes: readonly Entity[], from: string, to: string,
): boolean {
  if (!verifiedText || from === to) return false;
  return clausesOf(verifiedText).some(clause => {
    if (!bandTheUserWrote(band, clause) || linkEffectQuoteContextMiss(clause, verifiedText) !== null) return false;
    const names = (node: Entity, text: string): boolean => factorTheUserNamed(node.label, text,
      { options: [], others: nodes.filter(other => other.id !== node.id).map(other => other.label) });
    const ends = nodes.filter(node => names(node, clause));
    if (ends.length !== 2 || !ends.some(node => node.id === from) || !ends.some(node => node.id === to)) return false;
    // Resolve each end at its first mention using the existing entity matcher. Reversed statements do not
    // license the proposed direction; ambiguous or passive readings can stay Olumi's estimate.
    const firstMention = (node: Entity): number => {
      for (const word of clause.matchAll(/[\p{L}\p{N}]+/gu)) {
        const end = word.index! + word[0].length;
        if (names(node, clause.slice(0, end))) return end;
      }
      return Infinity;
    };
    const sourceAt = firstMention(ends.find(node => node.id === from)!);
    const targetAt = firstMention(ends.find(node => node.id === to)!);
    if (sourceAt >= targetAt) return false;
    // Mention order is not causal order in "Price is affected by MRR" or "Price gets its effect from MRR".
    // Without an affirmative reading of this direction, keep the staging estimate fallback.
    return !/\b(?:by|from|due\s+to|because\s+of)\b/i.test(clause.slice(sourceAt, targetAt));
  });
}
