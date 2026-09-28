/**
 * P2 A5 — THE BUILD NOW PERSISTS AN OPTION LEVEL IN THE ONE FORM (`admit-model.ts` `constructedLevel`), and every
 * graph SERVED before that change holds the short form `{ value, source }`. A fidelity row that compares a fresh build
 * with those served bytes reads the build back in the served form with `asServedBeforeOneForm`.
 *
 * It removes ONLY members that are exactly what the writer derives, and it checks each one before removing it:
 *  · `target_match` equal to `{ node_id: <the cell's own key>, match_type: 'exact_id', confidence: 'high' }`;
 *  · `raw_value` and `unit` on a level whose factor has a frame — its `observed_state.cap`, else its node `scale_frame`
 *    (AIQ Q2) — where `raw_value / frame` equals the level and `unit` is the factor's own `observed_state.unit`.
 *
 * ⭐ THE FRAME AND THE UNIT ARE READ OFF THE SERVED GRAPH, never off the build being checked (AIC 5859799717). Read off
 * the build, a consistent wrong (raw, cap) pair would re-derive itself and be stripped, so a row that excludes that
 * factor's node from its own compare could pass on a wrong figure. Read off the served bytes, a wrong figure, a wrong
 * frame or a wrong unit all stay, so the comparison fails on them. A factor the served graph does not hold keeps
 * everything.
 * The rule itself is pinned by `one-intervention-form.test.ts`; this is only the served-bytes reading of it.
 */
type Dict = Record<string, unknown>;
const isDict = (v: unknown): v is Dict => v !== null && typeof v === 'object' && !Array.isArray(v);

const isExactMatchFor = (key: string, tm: unknown): boolean =>
  isDict(tm) && Object.keys(tm).length === 3 && tm.node_id === key && tm.match_type === 'exact_id' && tm.confidence === 'high';

/** The served factor's own frame: `observed_state.cap`, else the node's `scale_frame`. */
function servedFrameOf(factor: Dict | undefined): { frame: number; unit: unknown } | undefined {
  if (factor === undefined) return undefined;
  const os = isDict(factor.observed_state) ? factor.observed_state : undefined;
  if (typeof os?.cap === 'number') return { frame: os.cap, unit: os.unit };
  if (typeof factor.scale_frame === 'number') return { frame: factor.scale_frame, unit: os?.unit };
  return undefined;
}

export function asServedBeforeOneForm<G>(graph: G, served: unknown): G {
  const out = structuredClone(graph);
  const nodes = isDict(out) && Array.isArray(out.nodes) ? (out.nodes as unknown[]).filter(isDict) : [];
  const servedNodes = isDict(served) && Array.isArray(served.nodes) ? (served.nodes as unknown[]).filter(isDict) : [];
  const servedById = new Map(servedNodes.map((n) => [n.id, n] as const));
  for (const node of nodes) {
    if (node.kind !== 'option' || !isDict(node.interventions)) continue;
    for (const [key, cell] of Object.entries(node.interventions)) {
      if (!isDict(cell)) continue;
      if (isExactMatchFor(key, cell.target_match)) delete cell.target_match;
      const f = servedFrameOf(servedById.get(key));
      if (f === undefined || typeof cell.raw_value !== 'number' || typeof cell.value !== 'number') continue;
      if (Math.abs(cell.raw_value / f.frame - cell.value) > 1e-9 || cell.unit !== f.unit) continue;
      delete cell.raw_value;
      delete cell.unit;
    }
  }
  return out;
}
