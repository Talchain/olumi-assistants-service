import { RunInputSnapshotSchema, type HandlerFact } from '@talchain/schemas/orchestrator';
import { buildCanonicalAnalysisReadyFromGraph } from '../../orchestrator/tools/analysis-ready-helper.js';
import { ANALYSIS_PROJECTION_VERSION } from './graph-identity.js';
import { computeAnalysisAffectingGraphHash } from './graph-hash.js';
import { computeLegacyAnalysisAffectingGraphHash } from './graph-hash-legacy.js';
import type { GraphStateIngress } from '../boundary/request-extensions.js';

/** Existing persisted JSON record; no column or schema-package change. */
export const RUN_ANALYSIS_PROJECTION_KEY = '__cee_analysis_projection_version';

export function stampRunAnalysisProjection(enrichment: Record<string, unknown>): Record<string, unknown> {
  return { ...enrichment, [RUN_ANALYSIS_PROJECTION_KEY]: ANALYSIS_PROJECTION_VERSION };
}

/** Hash equality alone cannot identify a pre-gap Run's admission.
 * Legacy acceptance requires BOTH projection hashes and NO gap carrier on
 * any option node/mirror (including empty, invalid or shadowed carriers).
 * Deleting every carrier erases this evidence; without contradictory Run-input
 * evidence that case is
 * indistinguishable from a genuinely gap-free legacy Run. Never infer a
 * version from timestamps, analysed namespaces, or request residual digests.
 */
export function runProjectionAllowsFreshness(fact: HandlerFact, storedHash: string, graph: unknown): boolean {
  if (fact.fact_type !== 'run_analysis') return false;
  const version = fact.result.enrichment?.[RUN_ANALYSIS_PROJECTION_KEY];
  if (version === ANALYSIS_PROJECTION_VERSION) return true;
  if (version !== undefined) return false;
  if (graph === null || typeof graph !== 'object' || Array.isArray(graph)) return false;
  const raw = graph as Record<string, unknown>;
  if (!Array.isArray(raw.nodes) || !Array.isArray(raw.edges)
    || (raw.options !== undefined && !Array.isArray(raw.options))) return false;
  // Existing admission evidence can REJECT a contradiction, but cannot
  // attest every consumed gap: a held baseline can be sent with gaps. These
  // request-input ids are distinct from enrichment's result namespaces.
  if (fact.result.input_snapshot !== undefined) {
    const snapshot = RunInputSnapshotSchema.safeParse(fact.result.input_snapshot);
    if (!snapshot.success) return false;
    const notAnalysable = snapshot.data.options_not_sent.filter(option => option.reason === 'not_analysable');
    if (notAnalysable.length > 0) {
      const ready = buildCanonicalAnalysisReadyFromGraph(raw);
      if (ready === undefined || notAnalysable.some(excluded => ready.options.some(option =>
        option.option_id === excluded.option_id && option.status === 'ready'))) return false;
    }
  }
  const hasGapCarrier = (value: unknown): boolean => value !== null && typeof value === 'object'
    && ['unresolved_targets', 'user_questions'].some(key => Object.prototype.hasOwnProperty.call(value, key));
  if (raw.nodes.some(node => node !== null && typeof node === 'object'
    && (node as Record<string, unknown>).kind === 'option' && hasGapCarrier(node))
    || (Array.isArray(raw.options) && raw.options.some(hasGapCarrier))) return false;
  try {
    const current = raw as GraphStateIngress;
    return computeLegacyAnalysisAffectingGraphHash(current) === storedHash
      && computeAnalysisAffectingGraphHash(current) === storedHash;
  } catch {
    return false;
  }
}
