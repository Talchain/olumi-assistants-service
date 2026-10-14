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

/**
 * 0.67.0 `unit_reading` (`goal-unit-reading.ts`): every graph served before it holds no reading on its goal. A goal's
 * reading is removed ONLY when the served goal holds none and it is the writer's closed shape — `{unit, source,
 * source_quote}` with a non-empty quote and a known source — so a malformed or extra member still fails the compare.
 * What the writer derives is pinned by `goal-unit-reading.test.ts` and `construction-goal-unit-reading.test.ts`.
 */
const isWrittenUnitReading = (r: unknown): boolean =>
  isDict(r) && Object.keys(r).length === 3 && typeof r.unit === 'string' && r.unit !== ''
  && (r.source === 'olumi_reading' || r.source === 'user_stated') && typeof r.source_quote === 'string' && r.source_quote !== '';

export function asServedBeforeOneForm<G>(graph: G, served: unknown): G {
  const out = structuredClone(graph);
  const nodes = isDict(out) && Array.isArray(out.nodes) ? (out.nodes as unknown[]).filter(isDict) : [];
  const servedNodes = isDict(served) && Array.isArray(served.nodes) ? (served.nodes as unknown[]).filter(isDict) : [];
  const servedById = new Map(servedNodes.map((n) => [n.id, n] as const));
  for (const node of nodes) {
    if (node.kind === 'goal' && isWrittenUnitReading(node.unit_reading) && servedById.get(node.id)?.unit_reading === undefined) {
      delete node.unit_reading;
    }
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

/**
 * MC P0 R13 / DL 0df0e1 (#2613): registration now marks a projected mean separately from a sized link.
 * The served captures predate that carrier. Their only edge delta is `mean_projected: true` on the exact
 * default strength; source, direction, spread, existence, authored sizes and every other field remain pinned.
 */
function capturedProjectedMean(edge: unknown): edge is Dict {
  if (!isDict(edge) || !isDict(edge.strength) || !isDict(edge.provenance)) return false;
  return edge.defaulted === true && typeof edge.strength.mean === 'number' && Math.abs(edge.strength.mean) === 0.5 && edge.strength.std === 0.125
    && edge.provenance.source === 'cee_hypothesis' && (edge.provenance.magnitude === undefined || (edge.provenance.magnitude === 'olumi_placeholder' && edge.provenance.mean_projected === true && edge.provenance.natural_effect === undefined));
}

/**
 * Add the one authorised carrier to a served expectation. Capture eligibility BEFORE the magnitude-delta
 * normaliser removes a converted link's magnitude and restores its old ±0.5; that restored value is not a
 * newly projected mean. Eligibility never reads the live carrier, so an absent or incorrect carrier still fails.
 */
export function asProjectedMeanCapture<G>(graph: G, beforeMagnitudeSubtraction: unknown = graph): G {
  const out = structuredClone(graph);
  if (!isDict(out) || !Array.isArray(out.edges)) return out;
  const rawEdges = isDict(beforeMagnitudeSubtraction) && Array.isArray(beforeMagnitudeSubtraction.edges)
    ? beforeMagnitudeSubtraction.edges : [];
  const projectedPairs = new Set(rawEdges.filter(capturedProjectedMean).map((edge) => `${String(edge.from)}::${String(edge.to)}`));
  const capture: Dict = out;
  capture.edges = out.edges.map((edge: unknown) => capturedProjectedMean(edge) && isDict(edge.provenance)
    && projectedPairs.has(`${String(edge.from)}::${String(edge.to)}`)
    ? { ...edge, provenance: { ...edge.provenance, mean_projected: true } } : edge);
  return out;
}

/** Digest-only capture: subtract exactly that carrier before comparing with the unchanged recorded digest. */
export function asServedBeforeProjectedMeans<G>(graph: G): G {
  const out = structuredClone(graph);
  if (!isDict(out) || !Array.isArray(out.edges)) return out;
  for (const edge of out.edges) {
    // Science 393023 LICENCE (a): subtract only the new door tag before the unchanged served digest check.
    if (isDict(edge) && isDict(edge.provenance) && isDict(edge.strength)
      && edge.provenance.magnitude === 'olumi_placeholder' && edge.provenance.mean_projected === true
      && Math.abs(Number(edge.strength.mean)) === 0.5 && edge.strength.std === 0.125 && edge.provenance.natural_effect === undefined) {
      delete edge.provenance.magnitude;
    }
    if (capturedProjectedMean(edge) && isDict(edge.provenance) && edge.provenance.mean_projected === true) {
      delete edge.provenance.mean_projected;
    }
  }
  return out;
}
