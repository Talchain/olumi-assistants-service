import { classifyValueSource } from '../../cee/graph-readiness/obligation-provenance.js';

// Science §(ab): a user-stated or user-ratified rate has ±25% spread at 90%.
const USER_RATE_SIGMA_LOG = 0.136;
// Science §(ab): Olumi's rate has ±50% spread at 90%.
const OLUMI_RATE_SIGMA_LOG = 0.246;

type Rec = Record<string, unknown>;
const isRec = (value: unknown): value is Rec => typeof value === 'object' && value !== null && !Array.isArray(value);

function rateSigma(node: Rec | undefined): number | undefined {
  const state = node?.observed_state;
  if (!isRec(state) || typeof state.value !== 'number' || !Number.isFinite(state.value)) return undefined;
  const source = classifyValueSource(state.source);
  return source === 'user_stated' || source === 'user_ratified' ? USER_RATE_SIGMA_LOG : OLUMI_RATE_SIGMA_LOG;
}

/** Run-only copy: read current rate authorship, never stamp the stored graph or use operand std. */
export function withAccumulationRateSpread<G>(graph: G): G {
  if (!isRec(graph) || !Array.isArray(graph.nodes)) return graph;
  const byId = new Map(graph.nodes.filter(isRec).map((node) => [node.id, node]));
  let changed = false;
  const nodes = graph.nodes.map((node: unknown) => {
    if (!isRec(node)) return node;
    const carrier = node.nonlinear_identity;
    if (!isRec(carrier) || carrier.operation !== 'accumulation' || !Array.isArray(carrier.factor_ids)) return node;
    const churnSigma = rateSigma(byId.get(carrier.factor_ids[1]));
    const inflowSigma = rateSigma(byId.get(carrier.factor_ids[2]));
    if (churnSigma === undefined || inflowSigma === undefined) return node;
    const prior = carrier.rate_sigma_log;
    if (Array.isArray(prior) && prior.length === 2 && prior[0] === churnSigma && prior[1] === inflowSigma) return node;
    changed = true;
    return { ...node, nonlinear_identity: { ...carrier, rate_sigma_log: [churnSigma, inflowSigma] } };
  });
  return changed ? { ...graph, nodes } as G : graph;
}
