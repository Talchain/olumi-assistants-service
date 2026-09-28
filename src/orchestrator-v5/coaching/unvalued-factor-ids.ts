/**
 * The factors a graph holds NO value for (PJ-B3; R&C root #70 5860314787, DL 5860325629).
 *
 * PLoT ranks `factor_sensitivity` by graph structure alone, so a factor with no value can top it. The headline must
 * then never say "because {X} is the strongest driver" — that presents it as an analysed driver. The graph the run
 * analysed is the authority: a `factor` node with no finite numeric `observed_state.value` / `raw_value`. Option-set
 * levels are not observed values; a lever is suppressed by its own predicate first (`resolveTopDriverLabel`).
 * Pure; empty on anything malformed.
 */
export function collectUnvaluedFactorIds(graph: unknown): ReadonlySet<string> {
  const out = new Set<string>();
  const nodes = graph !== null && typeof graph === 'object' ? (graph as { nodes?: unknown }).nodes : undefined;
  if (!Array.isArray(nodes)) return out;
  for (const n of nodes) {
    if (n === null || typeof n !== 'object') continue;
    const node = n as Record<string, unknown>;
    if (node.kind !== 'factor' || typeof node.id !== 'string' || node.id.length === 0) continue;
    const os = node.observed_state !== null && typeof node.observed_state === 'object'
      ? (node.observed_state as Record<string, unknown>) : null;
    const valued = [os?.value, os?.raw_value].some((v) => typeof v === 'number' && Number.isFinite(v));
    if (!valued) out.add(node.id);
  }
  return out;
}
