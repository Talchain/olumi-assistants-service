import { DECLARED_SCALE_BOUNDS, selectFactorQuantity } from '@talchain/schemas';
import { GraphV3, type GraphV3T } from '../../schemas/cee-v3.js';
import { factorSnapshot, knownFactorScale, withoutSystemQuantity, type SelectedGap } from './select.js';
import type { FactorEstimate } from './types.js';

export interface BasisReference {
  id: string;
  text: string;
  /** Context is not evidence. Scope restricts an otherwise valid but irrelevant citation. */
  factor_ids: readonly string[];
  kind: 'brief_context' | 'model_context';
}

export interface AdoptionResult {
  graph: GraphV3T;
  estimated: string[];
  unknown: string[];
  rejected: Array<{ factor_id: string; reason: string }>;
}

/** Recheck identity, whole-model snapshot and authority immediately before writing.
 * This stage never writes evidence-backed provenance: all derived values are inference.
 */
export function adoptFactorEstimates(graph: GraphV3T, gaps: readonly SelectedGap[],
  estimates: readonly FactorEstimate[], basis: readonly BasisReference[]): AdoptionResult {
  const snapshot = factorSnapshot(graph);
  const requested = new Map(gaps.map(g => [g.factor_id, g]));
  const refs = new Map(basis.map(ref => [ref.id, ref]));
  const result: AdoptionResult = { graph, estimated: [], unknown: [], rejected: [] };
  const seen = new Set<string>();
  for (const estimate of estimates) {
    const gap = requested.get(estimate.factor_id);
    const node = graph.nodes.find(n => n.id === estimate.factor_id && n.kind === 'factor');
    const reject = (reason: string): void => { result.rejected.push({ factor_id: estimate.factor_id, reason }); };
    if (!gap || !node || gap.snapshot !== snapshot || seen.has(node.id)) { reject('stale_or_unrequested'); continue; }
    seen.add(node.id);
    if (selectFactorQuantity(node).protected) { reject('protected_quantity'); continue; }
    if (estimate.basis.some(id => !refs.get(id)?.factor_ids.includes(node.id))) { reject('missing_or_irrelevant_basis'); continue; }
    const scale = knownFactorScale(node);
    if (estimate.estimate_type === 'estimated' && scale.declared_scale !== undefined) {
      const bounds = DECLARED_SCALE_BOUNDS[scale.declared_scale];
      const endpoints = estimate.distribution === 'uniform' ? [estimate.range_min, estimate.range_max] : [estimate.value];
      if (endpoints.some(value => (bounds.min !== null && value < bounds.min)
        || (bounds.max !== null && value > bounds.max))) { reject('outside_declared_scale'); continue; }
    }
    const reasoning = { rationale: estimate.reasoning, context_basis: [...estimate.basis] };
    let next = withoutSystemQuantity(node);
    if (estimate.estimate_type === 'unknown') {
      next.prior = { ...scale, prior_is_unquantified: true, source: 'cee_inference', reasoning };
    } else if (estimate.distribution === 'uniform') {
      next.prior = { distribution: 'uniform', range_min: estimate.range_min, range_max: estimate.range_max,
        ...scale, source: 'cee_inference', reasoning };
    } else {
      next.observed_state = { ...scale, value: estimate.value, std: estimate.std, source: 'cee_inference', reasoning,
        extractionType: 'inferred',
        ...(scale.declared_scale === 'unit_interval' && scale.cap !== undefined && scale.cap > 0
          ? { raw_value: estimate.value * scale.cap } : {}),
        ...(node.observed_state?.baseline !== undefined ? { baseline: node.observed_state.baseline } : {}) };
    }
    const candidate = { ...result.graph, nodes: result.graph.nodes.map(n => n.id === node.id ? next : n) };
    const parsed = GraphV3.safeParse(candidate);
    if (!parsed.success) { reject('invalid_canonical_quantity'); continue; }
    result.graph = parsed.data;
    result[estimate.estimate_type === 'estimated' ? 'estimated' : 'unknown'].push(node.id);
  }
  return result;
}

/** An operational failure is unresolved, not a model-authored refusal. */
export function markUnresolved(graph: GraphV3T, gaps: readonly SelectedGap[], resolved: ReadonlySet<string>, baseGraph: GraphV3T = graph): GraphV3T {
  // Validate the original whole-model context before allowing any residue write.
  // baseGraph is separate only because this synchronous adoption may already
  // have accepted other estimates into graph. Callers cannot reuse stale gaps.
  const snapshot = factorSnapshot(baseGraph);
  if (gaps.some(gap => gap.snapshot !== snapshot)) return graph;
  return { ...graph, nodes: graph.nodes.map(node => {
    const gap = gaps.find(g => g.factor_id === node.id);
    if (resolved.has(node.id) || !gap || gap.node_snapshot !== JSON.stringify(node) || selectFactorQuantity(node).protected) return node;
    // Failed retries must not erase a previous model abstention and its reason.
    if (selectFactorQuantity(node).kind === 'unknown') return node;
    return { ...withoutSystemQuantity(node), prior: { ...knownFactorScale(node), prior_is_unquantified: true, source: 'cee_repair' } };
  }) };
}
