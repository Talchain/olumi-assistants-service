/**
 * ⭐ A LEVEL LIMIT ON A FACTOR THE OPTIONS MOVE IS CHECKED AGAINST THAT FACTOR'S CURRENT LEVEL — carried on the WIRE graph
 * at run time, NEVER persisted (#70 5841905430 / 5841918509; #1919 reviews 5842183627 B1/B2, 5842400886 B3).
 *
 * ISL checks a level limit on a NON-ROOT target as `baseline + (option − status quo)` per draw and refuses without
 * `observed_state.baseline` (`missing_target_baseline`), so Paul's churn limit read "could not be checked". The node's
 * current level is already on it — `observed_state.value`, in the node's own frame — so the carrier is THAT value, never
 * a new number.
 *
 * ⛔ WHY AT RUN TIME (B2). A persisted copy is a snapshot of `value`: `set_factor_value` and the rescale writers rewrite
 * `value` and leave `baseline` alone, so a user who corrects Olumi's 7% estimate to 12% would be checked against the 7%
 * they just replaced. Derived from the graph the run reads, the level the limit is checked against is the level on the
 * model at that moment, by construction. The persisted graph, its hash and every reader of it are untouched.
 *
 * ⛔ WHY A FACTOR, AND ONLY ONE WHOSE LEVEL HAS AN AUTHOR (B3). This runs for every scenario, so it must not reach a cell
 * another path owns or a level nobody can vouch for:
 *   · `add_constraint` mints a baseline for an OUTCOME/RISK target only from the user's own statement and otherwise ASKS
 *     for it (`mintEligible` → `elicitBaseline`: "no statement ⇒ no mint"). Filling that cell from a model-authored value
 *     would answer the question for the user. Factors only — the cell is outcome/risk, so the two never meet.
 *   · the level is either the user's (`brief_extraction`, `user*`) or Olumi's in the form the run DISCLOSES —
 *     `deriveInferredValues`, the disclosure's own predicate, not a copy of it ("I supplied the value behind this").
 *     A level with no author marker carries nothing.
 *
 * Conditions, each a RED row in `run-analysis-level-limit-baseline.test.ts`:
 *   · the limit is framed `level` (a delta needs no baseline; an unframed limit keeps failing closed at the frame hop);
 *   · the target is a FACTOR, not the goal (#1840 owns the goal's), NON-ROOT on the model PLoT scores (an in-edge from a
 *     node that is not an option or the decision — PLoT strips those; ISL reads a root at its own level);
 *   · FILL-ONLY: an existing baseline, whoever wrote it, is never overwritten;
 *   · its level has an author, as above;
 *   · PLoT reads the limit and the level on one scale, decision-grade (`levelLimitReadsOnNodeLevel`, B1).
 */
import { valuesMatch } from '../../../utils/reduction-framing.js';
import { deriveInferredValues } from '../../coaching/inferred-value-disclosure.js';

type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * ⛔ PLoT READS THE LIMIT AND THE LEVEL ON ONE SCALE, DECISION-GRADE — one shape, proven end to end (B1, B3):
 *   · the limit is spelled exactly `"%"` with 1 < value ≤ 100. PLoT normalises constraints only when some value leaves
 *     [0,1] (`constraintsNeedNormalisation`); value > 1 guarantees THIS row takes the unit_percent rung (`[0,100]`,
 *     decision-grade) in every batch. A `"%"` row ≤ 1 is forwarded raw OR read as a fraction depending on its batch-mates
 *     — "0.5%" certified as 50% beside a £ budget — so it never carries (`add-constraint.ts` refuses the same row for the
 *     same reason). ≤ 100 keeps it unclamped;
 *   · the node's level is ATTESTED to be that percentage ÷ 100: framed on exactly 100 (`cap`, or the agent-lane estimate's
 *     `scale_frame`) AND `value` = `raw_value` ÷ 100 on the node itself. A unitless level in [0, 1) is NOT proof of a
 *     proportion on the `"%"` scale, and a node framed on 20 is read "≤ 10%" against raw/20 — neither carries.
 * Every other shape — unitless, currency, a percent phrasing PLoT does not read as `"%"` — carries nothing and fails
 * closed at ISL's `missing_target_baseline`: an honest "could not be checked", never a guessed frame.
 */
export function levelLimitReadsOnNodeLevel(value: number, unit: string | undefined, node: Rec, os: Rec): boolean {
  if (unit === undefined || unit.trim() !== '%') return false;
  if (!(Number.isFinite(value) && value > 1 && value <= 100)) return false;
  if (!(os.cap === 100 || (os.cap === undefined && node.scale_frame === 100))) return false;
  return typeof os.value === 'number' && typeof os.raw_value === 'number' && valuesMatch(os.value, os.raw_value / 100);
}

/** The level's author is known: the user's own figure, or Olumi's in the form the run discloses. */
function levelHasAnAuthor(node: Rec, os: Rec): boolean {
  const source = typeof os.source === 'string' ? os.source : undefined;
  if (source !== undefined && (source === 'brief_extraction' || source.startsWith('user'))) return true;
  return deriveInferredValues({ nodes: [node] }).length === 1;
}

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
    if (node.kind !== 'factor' || node.id === goalNodeId || !scoredTargets.has(node.id)) continue;
    const os = node.observed_state;
    if (!isRec(os) || typeof os.value !== 'number' || !Number.isFinite(os.value) || os.baseline !== undefined) continue;
    if (!levelHasAnAuthor(node, os)) continue;
    if (!levelLimitReadsOnNodeLevel(c.value, typeof c.unit === 'string' ? c.unit : undefined, node, os)) continue;
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
