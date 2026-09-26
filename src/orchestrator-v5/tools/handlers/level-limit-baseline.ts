/**
 * ⭐ A LEVEL LIMIT ON A NODE THE OPTIONS MOVE IS CHECKED AGAINST THAT NODE'S CURRENT LEVEL — carried on the WIRE graph at
 * run time, NEVER persisted (#70 5841905430 / 5841918509; #1919 review 5842183627 B2).
 *
 * ISL checks a level limit on a NON-ROOT target as `baseline + (option − status quo)` per draw and refuses without
 * `observed_state.baseline` (`missing_target_baseline`), so Paul's churn limit read "could not be checked". The node's
 * current level is already on it — `observed_state.value`, in the node's own frame — so the carrier is THAT value, never
 * a new number.
 *
 * ⛔ WHY AT RUN TIME. A persisted copy is a snapshot of `value`: `set_factor_value` and the rescale writers rewrite
 * `value` and leave `baseline` alone, so a user who corrects Olumi's 7% estimate to 12% would be checked against the 7%
 * they just replaced. Derived from the graph the run reads, the level the limit is checked against is the level on the
 * model at that moment, by construction. The persisted graph, its hash and every reader of it are untouched.
 *
 * Conditions, each a RED row in `run-analysis-level-limit-baseline.test.ts`:
 *   · the limit is framed `level` (a delta needs no baseline; an unframed limit keeps failing closed at the frame hop);
 *   · the target is not the goal (#1840 owns the goal's baseline and its attestation rule);
 *   · the target is NON-ROOT on the model PLoT scores (an in-edge from a node that is not an option or the decision —
 *     PLoT strips those): ISL reads a root at its own level, so a baseline there buys nothing;
 *   · FILL-ONLY: an existing baseline, whoever wrote it, is never overwritten;
 *   · PLoT reads the limit and the level on one scale, decision-grade (`levelLimitReadsOnNodeLevel`, review B1).
 * Where the level is Olumi's estimate, the run says so (`inferred-value-disclosure.ts`: "I supplied the value behind this").
 */
import { levelLimitReadsOnNodeLevel } from '../../agent-lane/admit-constraint.js';

type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The ids of the nodes whose current level a level limit is checked against on this run. */
export function levelLimitBaselineNodeIds(graph: unknown, goalConstraints: unknown, goalNodeId?: string): Set<string> {
  const out = new Set<string>();
  if (!isRec(graph) || !Array.isArray(graph.nodes) || !Array.isArray(goalConstraints)) return out;
  const nodes = graph.nodes.filter(isRec);
  const edges = Array.isArray(graph.edges) ? graph.edges.filter(isRec) : [];
  const kindById = new Map(nodes.map((n) => [n.id, n.kind] as const));
  const scoredTargets = new Set(
    edges
      .filter((e) => {
        const k = kindById.get(e.from);
        return typeof k === 'string' && k !== 'option' && k !== 'decision';
      })
      .map((e) => e.to),
  );
  for (const c of goalConstraints) {
    if (!isRec(c) || c.value_frame !== 'level' || typeof c.value !== 'number') continue;
    const node = nodes.find((n) => n.id === c.node_id);
    if (node === undefined || typeof node.id !== 'string') continue;
    if (node.kind === 'goal' || node.id === goalNodeId || !scoredTargets.has(node.id)) continue;
    const os = node.observed_state;
    if (!isRec(os) || typeof os.value !== 'number' || !Number.isFinite(os.value) || os.baseline !== undefined) continue;
    const unit = typeof c.unit === 'string' ? c.unit : undefined;
    const target = {
      value: os.value,
      ...(typeof os.unit === 'string' ? { unit: os.unit } : {}),
      ...(typeof os.cap === 'number' ? { cap: os.cap } : {}),
      ...(typeof os.raw_value === 'number' ? { raw_value: os.raw_value } : {}),
      ...(typeof node.scale_frame === 'number' ? { scale_frame: node.scale_frame } : {}),
    };
    if (!levelLimitReadsOnNodeLevel(c.value, unit, target)) continue;
    out.add(node.id);
  }
  return out;
}

/** The wire graph with each such node's current level carried as its baseline. Returns `graph` itself when none. */
export function carryLevelLimitBaselines<G>(graph: G, goalConstraints: unknown, goalNodeId?: string): G {
  const ids = levelLimitBaselineNodeIds(graph, goalConstraints, goalNodeId);
  if (ids.size === 0 || !isRec(graph) || !Array.isArray(graph.nodes)) return graph;
  return {
    ...graph,
    nodes: graph.nodes.map((n: unknown) =>
      isRec(n) && typeof n.id === 'string' && ids.has(n.id) && isRec(n.observed_state)
        ? { ...n, observed_state: { ...n.observed_state, baseline: n.observed_state.value } }
        : n,
    ),
  } as G;
}
