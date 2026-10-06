/**
 * ⭐ AN OPTION THAT CREATES A QUANTITY — THE ONE RULE (Science d5 #87 6007736377 (i)).
 *
 * Creation evidence ONLY: an option whose own label opens with a creation verb (launch / introduce / start / new) and
 * whose path reaches the quantity, or a stored typed 0 the caller already holds. An option that merely TARGETS a
 * quantity ("Offer a 10% discount") changes an existing level nobody gave, so it is never creation evidence. "Keep the
 * new pricing" opens with "Keep": "new" counts only as the option's own opening word (Codex buddy r1 P1, #2633).
 *
 * Read by construction (`admit-model.ts`, a created product part is 0 today) and by the ask (`identity-not-evaluated-
 * ask.ts`), so the two can never disagree about which options create a part.
 */
export const CREATION_VERB = /^\s*(?:launch(?:es|ed|ing)?|introduc(?:e|es|ed|ing)|start(?:s|ed|ing)?|(?:an? )?new)\b/i;

interface OptionLike { readonly id: string; readonly kind?: unknown; readonly label?: unknown }
interface EdgeLike { readonly from: string; readonly to: string }

/** True when `from` reaches `to` along `edges` (any number of steps). */
export function reachesAlong(edges: readonly EdgeLike[], from: string, to: string): boolean {
  const seen = new Set<string>([from]);
  const walk = [from];
  while (walk.length > 0) {
    const at = walk.pop()!;
    for (const e of edges) {
      if (e.from !== at || seen.has(e.to)) continue;
      if (e.to === to) return true;
      seen.add(e.to);
      walk.push(e.to);
    }
  }
  return false;
}

/** The labels of the options (never a status quo) whose own words create `quantityId` and whose path reaches it, in node order. */
export function optionsCreating(
  nodes: readonly OptionLike[],
  edges: readonly EdgeLike[],
  quantityId: string,
  statusQuoIds: ReadonlySet<string>,
): string[] {
  return nodes
    .filter((o) => o.kind === 'option' && !statusQuoIds.has(o.id) && typeof o.label === 'string' && CREATION_VERB.test(o.label))
    .filter((o) => reachesAlong(edges, o.id, quantityId))
    .map((o) => (o.label as string).trim());
}
