import { RunInputSnapshotSchema, type HandlerFact } from '@talchain/schemas/orchestrator';
import { buildCanonicalAnalysisReadyFromGraph } from '../../orchestrator/tools/analysis-ready-helper.js';
import { ANALYSIS_PROJECTION_VERSION, RUN_ANALYSIS_PROJECTION_KEY } from './graph-identity.js';

export { RUN_ANALYSIS_PROJECTION_KEY } from './graph-identity.js';

export function stampRunAnalysisProjection(enrichment: Record<string, unknown>): Record<string, unknown> {
  return { ...enrichment, [RUN_ANALYSIS_PROJECTION_KEY]: ANALYSIS_PROJECTION_VERSION };
}

function optionCarriers(graph: unknown): Record<string, unknown>[] {
  if (graph === null || typeof graph !== 'object' || Array.isArray(graph)) return [];
  const raw = graph as Record<string, unknown>;
  const record = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);
  return [
    ...(Array.isArray(raw.nodes) ? raw.nodes.filter(record).filter(node => node.kind === 'option') : []),
    ...(Array.isArray(raw.options) ? raw.options.filter(record) : []),
  ];
}

/** A healthy gap-free producer preserves the original provider/fact bytes.
 * Nonempty or malformed target carriers need a stamp, even on a shadowed
 * mirror or a held baseline; an empty array carries no unresolved effect. */
export function runAnalysisProjectionNeedsStamp(graph: unknown): boolean {
  return optionCarriers(graph).some(option =>
    ['unresolved_targets', 'user_questions'].some(key =>
      Object.prototype.hasOwnProperty.call(option, key)
      && (!Array.isArray(option[key]) || option[key].some(value => typeof value !== 'string')
        || (key === 'unresolved_targets' && option[key].length > 0))));
}

/** Hash equality alone cannot identify a pre-gap Run's admission when gap
 * evidence survives. Nonempty/invalid targets need the stamp. Empty arrays
 * and valid question wording do not assert a gap; a Run-input exclusion can
 * still prove contradictory admission independently of those carriers.
 * The established hash-only API retains its verdict when no Run-input
 * exclusion supplies evidence requiring the graph to be inspected.
 * Deleting every carrier erases this evidence; without contradictory Run-input
 * evidence that case is
 * indistinguishable from a genuinely gap-free legacy Run. Never infer a
 * version from timestamps, analysed namespaces, or request residual digests.
 * Called only after the caller has established matching stored/current
 * hashes; the stored-hash argument is retained for API compatibility.
 */
export function runProjectionAllowsFreshness(fact: HandlerFact, _storedHash: string, graph: unknown): boolean {
  if (fact.fact_type !== 'run_analysis') return false;
  const version = fact.result.enrichment?.[RUN_ANALYSIS_PROJECTION_KEY];
  if (version === ANALYSIS_PROJECTION_VERSION) return true;
  if (version !== undefined) return false;
  // Existing admission evidence can REJECT a contradiction, but cannot
  // attest every consumed gap: a held baseline can be sent with gaps. These
  // request-input ids are distinct from enrichment's result namespaces.
  // Historical SC-24 readers can carry only input_snapshot.goal. Do not
  // impose today's full snapshot schema on that independent unit contract.
  const input = fact.result.input_snapshot as unknown;
  if (input !== undefined && (input === null || typeof input !== 'object' || Array.isArray(input))) return false;
  const hasAdmissionSnapshot = input !== undefined
    && (input as Record<string, unknown>).options_not_sent !== undefined;
  const snapshot = hasAdmissionSnapshot ? RunInputSnapshotSchema.safeParse(input) : undefined;
  if (snapshot !== undefined && !snapshot.success) return false;
  const notAnalysable = snapshot?.success
    ? snapshot.data.options_not_sent.filter(option => option.reason === 'not_analysable') : [];
  // Both null and undefined are the established "graph not supplied" form.
  // A recorded exclusion still needs the graph, and fails closed without it.
  if (graph == null) return notAnalysable.length === 0;
  if (typeof graph !== 'object' || Array.isArray(graph)) return false;
  const raw = graph as Record<string, unknown>;
  if (!Array.isArray(raw.nodes) || !Array.isArray(raw.edges)
    || (raw.options !== undefined && !Array.isArray(raw.options))) return false;
  if (notAnalysable.length > 0) {
    const ready = buildCanonicalAnalysisReadyFromGraph(raw);
    if (ready === undefined || notAnalysable.some(excluded => ready.options.some(option =>
      option.option_id === excluded.option_id && option.status === 'ready'))) return false;
  }
  // On a gap-free graph, the caller's equal hashes remain the authority.
  // Rehashing here breaks hash-only callers and creates a second hash verdict.
  return !runAnalysisProjectionNeedsStamp(raw);
}
