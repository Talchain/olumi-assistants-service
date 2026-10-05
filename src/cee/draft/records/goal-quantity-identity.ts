import type { DraftStatedItem } from './grammar.js';

/** The projector and persisted receipts share the same typed goal/baseline identities. */
export function goalQuantityCanonicaliser(statedItems: ReadonlyMap<number, DraftStatedItem>): (index: number) => number {
  const targets = new Map<number, Set<number>>();
  const addAlias = (from: number, to: number): void => {
    const set = targets.get(from) ?? new Set<number>();
    set.add(to);
    targets.set(from, set);
  };
  for (const [index, item] of statedItems) {
    if (item.kind !== "goal" || item.baseline_ref === undefined) continue;
    const baseline = statedItems.get(item.baseline_ref);
    if (baseline?.role !== "baseline") continue;
    const identity = baseline.quantity ?? item.baseline_ref;
    addAlias(index, identity);
    if (item.quantity !== undefined) addAlias(item.quantity, identity);
  }
  // Conflicting typed aliases are unresolved, never chosen by emission order.
  const aliases = new Map([...targets].flatMap(([from, to]) => to.size === 1 ? [[from, [...to][0]!] as const] : []));
  const canonical = (index: number): number => {
    const seen = new Set<number>();
    let next = index;
    while (aliases.has(next) && aliases.get(next) !== next) {
      if (seen.has(next)) return index; // Conflicting cycles supply no identity.
      seen.add(next);
      next = aliases.get(next)!;
    }
    return next;
  };
  return canonical;
}
