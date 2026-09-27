/**
 * P2 A5 — THE BUILD NOW PERSISTS AN OPTION LEVEL IN THE ONE FORM (`admit-model.ts` `constructedLevel`), and every
 * graph SERVED before that change holds the short form `{ value, source }`. A fidelity row that compares a fresh build
 * with those served bytes reads the build back in the served form with `asServedBeforeOneForm`.
 *
 * It removes ONLY members that are exactly what the writer derives from the same graph, and it checks each one before
 * removing it:
 *  · `target_match` equal to `{ node_id: <the cell's own key>, match_type: 'exact_id', confidence: 'high' }`;
 *  · `raw_value` and `unit` on a level whose factor stores `observed_state.cap`, where `raw_value / cap` equals the level
 *    and `unit` is the factor's own `observed_state.unit`.
 * Anything else stays, so the comparison still fails on it: a wrong unit, a wrong figure, a match naming another factor.
 * The rule itself is pinned by `one-intervention-form.test.ts`; this is only the served-bytes reading of it.
 */
type Dict = Record<string, unknown>;
const isDict = (v: unknown): v is Dict => v !== null && typeof v === 'object' && !Array.isArray(v);

const isExactMatchFor = (key: string, tm: unknown): boolean =>
  isDict(tm) && Object.keys(tm).length === 3 && tm.node_id === key && tm.match_type === 'exact_id' && tm.confidence === 'high';

export function asServedBeforeOneForm<G>(graph: G): G {
  const out = structuredClone(graph);
  const nodes = isDict(out) && Array.isArray(out.nodes) ? (out.nodes as unknown[]).filter(isDict) : [];
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  for (const node of nodes) {
    if (node.kind !== 'option' || !isDict(node.interventions)) continue;
    for (const [key, cell] of Object.entries(node.interventions)) {
      if (!isDict(cell)) continue;
      if (isExactMatchFor(key, cell.target_match)) delete cell.target_match;
      const os = byId.get(key)?.observed_state;
      if (!isDict(os) || typeof os.cap !== 'number' || typeof cell.raw_value !== 'number' || typeof cell.value !== 'number') continue;
      if (Math.abs(cell.raw_value / os.cap - cell.value) > 1e-9 || cell.unit !== os.unit) continue;
      delete cell.raw_value;
      delete cell.unit;
    }
  }
  return out;
}
