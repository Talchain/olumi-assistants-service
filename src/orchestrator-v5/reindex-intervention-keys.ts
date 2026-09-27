/**
 * ⛔ `interventionKeys` IS AN INDEX OF THE NODE'S OWN `interventions`, NOT A STAMP (#2084 review, 27 Sep 2026).
 *
 * The UI's register writes it on option nodes: `mapDraftNodeToCanvas` derives it as
 * `Object.keys(interventions)`, and the UI's reload proof (`serverGraphHydration.ts` `wireNodeValue`) reads a
 * wire node's `interventionKeys` in preference to re-deriving it. `NodeV3` declares it so a D1 re-parse keeps
 * what the register stored. But CEE writers change the MAP and never the index: a structural delete prunes the
 * deleted factor's cell, a value batch adds cells. Kept as an inert stamp, the stored index named a deleted
 * factor on 4/4 options after one delete (3/6 after the value-batch twin), so the reload proof declined the Run.
 *
 * UPDATE-IF-PRESENT, AT THE ONE PERSISTED FORM. A node that carries the index gets `Object.keys(interventions)`
 * whenever the two SETS differ. A node without the index never gains one (CEE does not mint UI state), and a node
 * with no `interventions` record indexes nothing (`[]`). When the sets agree the stored order is kept (the UI
 * compares order-insensitively), so a graph already in step is returned as the ORIGINAL reference and stays a
 * fixed point of `projectGraphForPersistence`: the stored-bytes guards (`isDeepStrictEqual(project(before),
 * before)`) accept every graph the loader registered, whose index is `Object.keys` order by construction.
 */
type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The index a node's own cells imply. */
function derivedIndex(node: Rec): string[] {
  return isRec(node.interventions) ? Object.keys(node.interventions) : [];
}

/**
 * True when the node carries no index, or exactly its cells' keys (any order). A `null` counts as no index (the
 * persisted form drops it). A non-array is NOT in step: `reindexInterventionKeys` deletes it rather than rebuilding
 * it, because CEE never mints UI state (and `GraphV3` reads it as absent anyway).
 */
export function interventionKeysFollowInterventions(node: unknown): boolean {
  if (!isRec(node) || !Object.hasOwn(node, 'interventionKeys') || node.interventionKeys === null) return true;
  const index = node.interventionKeys;
  if (!Array.isArray(index)) return false;
  const want = new Set(derivedIndex(node));
  // Exactly the cells' keys: same count, no repeats (['a','a'] against {a,b} is stale), every one a cell.
  return index.length === want.size && new Set(index).size === index.length
    && index.every((k) => typeof k === 'string' && want.has(k));
}

/**
 * The graph with every present-but-stale `interventionKeys` re-derived; the ORIGINAL reference when none is.
 *
 * ⚠ THE STORED-BYTES GUARDS COMPARE AGAINST THIS, NOT THE RAW BASE (#2084 re-review, major). Before this module,
 * staging's own option-level writer added a cell and kept the index, so saved examples are ALREADY stored with stale
 * indexes (served pricing: 3 keys against 4 cells). Their only drift from the persisted form is this derived field, so
 * `optionInterventionBatchPostimageIsScoped`, `factorValuesPostimageIsScoped`, `isProvenanceOnlyEdgeConfirmation` and
 * the two writer base checks take `normaliseAbsenceOnly(before)` (this pass + the absence-only null drop) as the base.
 * Any OTHER drift still refuses.
 */
export function reindexInterventionKeys<T>(graph: T): T {
  if (!isRec(graph) || !Array.isArray(graph.nodes)) return graph;
  if (graph.nodes.every(interventionKeysFollowInterventions)) return graph;
  return {
    ...graph,
    nodes: graph.nodes.map((node) =>
      interventionKeysFollowInterventions(node) ? node : reindexed(node as Rec)),
  };
}

function reindexed(node: Rec): Rec {
  if (Array.isArray(node.interventionKeys)) return { ...node, interventionKeys: derivedIndex(node) };
  const { interventionKeys: _malformed, ...rest } = node;
  return rest;
}
