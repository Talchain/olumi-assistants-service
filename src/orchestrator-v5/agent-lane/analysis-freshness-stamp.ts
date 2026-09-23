/**
 * ⭐⭐ SAY WHICH MODEL A READINESS DESCRIBES.
 *
 * `AnalysisReadyPayload` carries a freshness contract and tells the client
 * exactly what to do with it:
 *
 *   graph_hash_at_run   "Hash of the analysis-affecting graph fields at the
 *                        moment run_analysis executed."
 *   current_graph_hash  "Hash … on this turn. UI compares against
 *                        graph_hash_at_run to confirm freshness independently."
 *
 * ⛔ THE GAP THIS CLOSES, MEASURED. The AGENT route carried NONE of the three
 * freshness fields, while the Conventional path handles `graph_hash_at_run` in
 * `orchestrator/route-v2.ts`. Contrast control: the agent route references
 * `graph_hash` thirteen times, so the absence was real rather than a blind
 * probe. After an edit, an Agent turn could hand the UI a readiness computed
 * against an older model with nothing marking it stale — the UI had one side of
 * a two-sided comparison and no way to know.
 *
 * ⭐ IT COSTS NO EXTRA IO, and that is what makes it trustworthy: the caller
 * takes `graph_hash` and `analysis_ready` from the SAME dispatch, so the two
 * cannot describe different states. A second read could.
 *
 * ⛔ `graph_hash_at_run` IS NEVER SET HERE. Only the run itself can say what it
 * was computed against; deriving it from a read would manufacture a provenance
 * this code does not have, and a wrong freshness verdict is worse than an absent
 * one.
 *
 * ⚠ ADDITIVE, AND IT NEVER OVERWRITES. The payload is `.passthrough()`, so an
 * added field survives; an existing `current_graph_hash` is left exactly as it
 * arrived, because a value the producer set is better evidence than one stamped
 * by a reader.
 */
export function withCurrentGraphHash(analysisReady: unknown, graphHash: string | undefined): unknown {
  if (graphHash === undefined || graphHash === '') return analysisReady;
  if (analysisReady === null || typeof analysisReady !== 'object' || Array.isArray(analysisReady)) {
    return analysisReady;
  }
  const rec = analysisReady as Record<string, unknown>;
  if (rec.current_graph_hash !== undefined) return analysisReady;
  return { ...rec, current_graph_hash: graphHash };
}
