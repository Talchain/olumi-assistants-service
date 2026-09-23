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
 * ⚠ IT OVERWRITES, AND THAT IS THE POINT — the earlier version did not, and that
 * made this WORSE than the gap it closed.
 *
 * `analysisFromTool` comes from `/orchestrate/v2/turn` (`agent-capabilities.ts:1454`,
 * surfaced at `:1470`), and that finaliser already stamps the field
 * (`compose/analysis-ready-emit.ts:202-203`). So a never-overwrite guard fired on
 * every real turn and preserved the hash AS AT THE MOMENT THE ANALYSIS RAN. When
 * the Agent then wrote in the same turn, the response carried
 * `graph_hash_at_run === current_graph_hash` while the model had moved — and the
 * comparison `schemas/analysis-ready.ts:567-571` instructs the UI to make then
 * reports FRESH over a changed model. `analysis-ready-emit.ts` names that harm:
 * *"`fresh` -> clears the local-edits dirty overlay, so the strip claims 'Analysis
 * reflects the current model' over edits CEE has never seen."*
 *
 * ⭐ WHICH AUTHORITY OWNS WHICH FIELD. `graph_hash_at_run` is "when the run
 * happened" — only the run can say it, and it is still NEVER written here.
 * `current_graph_hash` is "on THIS turn", and at response time the ROUTE is the
 * authority: it read the graph after every write this turn made. The tool's value
 * is a `graph_hash_at_run` wearing the other field's name.
 *
 * Returned BY IDENTITY when the value already equals the route's, so an unmoved
 * model allocates nothing and cannot be made to look stale.
 */
export function withCurrentGraphHash(analysisReady: unknown, graphHash: string | undefined): unknown {
  if (graphHash === undefined || graphHash === '') return analysisReady;
  if (analysisReady === null || typeof analysisReady !== 'object' || Array.isArray(analysisReady)) {
    return analysisReady;
  }
  const rec = analysisReady as Record<string, unknown>;
  if (rec.current_graph_hash === graphHash) return analysisReady;
  return { ...rec, current_graph_hash: graphHash };
}
