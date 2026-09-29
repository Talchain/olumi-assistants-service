/**
 * Capability 2A — add-risk rejection guidance (conservative, deterministic).
 *
 * Pure helper. NO LLM, NO I/O, NO schema/validator changes.
 *
 * When an `edit_graph` add-risk attempt fails structural validation with a
 * *reachability-class* violation (1.16 item C: the new risk node cannot
 * REACH the goal via forward directed edges — e.g. it was added as a
 * dead-end sink, or left orphaned), the bare rejection currently renders
 * the generic "inconsistency in the model structure" suppression (see
 * patch-rejection-helper.ts). This classifier lets the caller (flag-gated)
 * replace that with a deterministic, structural-only next step grounded
 * ONLY in graph reachability — never in an invented rule.
 *
 * Conservative by design: returns `null` (→ caller keeps the generic copy)
 * unless ALL of the following hold, so it can never broaden a generic rejection:
 *   - every NEW structural violation is reachability-class (NO_PATH_TO_GOAL /
 *     ORPHAN_NODE); a mixed/compound failure falls through;
 *   - a violated node is `kind: 'risk'`;
 *   - that risk has NO inbound directed edge from a `factor` (the defining
 *     "not connected through a factor / dead-end / orphan" shape — a
 *     properly-hosted `factor → risk` is excluded. Note under the corrected
 *     reachability predicate a `risk → option` outbound wiring reaches the
 *     goal and is simply ACCEPTED, so it never produces a violation for
 *     this classifier to see).
 *
 * The guidance the caller renders states the structural fact only: the risk is
 * not yet connected so it has no path through the model to the goal. A factor
 * is offered as an EXAMPLE host (the deterministic add-risk template connects a
 * factor → risk), never as a claimed rule and never with an invented concept
 * name. NO sensitivity / vulnerable-assumption / fragile-edge / influence /
 * robustness / causal-scientific wording.
 */

import type { GraphV3T } from "../schemas/cee-v3.js";
import type {
  StructuralViolation,
  StructuralViolationCode,
} from "./graph-structure-validator.js";

/** Violations meaning "this node is not on a directed path from the decision". */
const REACHABILITY_CODES: ReadonlySet<StructuralViolationCode> = new Set<StructuralViolationCode>([
  'NO_PATH_TO_GOAL',
  'ORPHAN_NODE',
]);

/**
 * Per-node violation detail shape: `Node "<id>" (<label>) …`. The capital-N
 * `Node` deliberately does NOT match the lower-case `Goal node "<id>"`
 * reachability variant, so a goal-not-reachable violation never extracts a
 * goal id here.
 */
const NODE_ID_IN_DETAIL = /Node "([^"]+)"/;

export interface AddRiskRejectionMatch {
  /** Label(s) of the unconnected risk node(s) that triggered the rejection. */
  readonly risk_labels: readonly string[];
  /**
   * Candidate factor labels the risk could connect through — factor-kind nodes
   * that ARE reachable from the decision (so they sit on a path toward the
   * goal). Examples ONLY, for the eventual authored copy; may be empty.
   */
  readonly example_factor_labels: readonly string[];
  /**
   * Whether the supplied patch operations (when provided) clearly add a new
   * risk node. `null` when operations were not supplied or could not be
   * interpreted. Observability only — does NOT gate the match.
   */
  readonly added_new_risk: boolean | null;
}

/**
 * PLACEHOLDER-SAFE copy (NOT final wording — authored separately before any
 * live run / flag enablement). Structural-only, reachability-grounded,
 * concept-free, no invented mechanism, no held-science vocabulary.
 */
export const ADD_RISK_REJECTION_GUIDANCE_PLACEHOLDER =
  "I wasn't able to add that as described, because the new risk isn't connected into the model yet, "
  + "so it has no path through to your goal and can't affect the result. To add it, connect it through "
  + "to your goal — for example by linking it to a factor that already feeds into your goal. Which factor "
  + "should it relate to, or which outcome does it threaten?";

function isDirected(edge: GraphV3T['edges'][number]): boolean {
  // Treat absent edge_type as 'directed' (matches graph-structure-validator).
  return (edge as Record<string, unknown>).edge_type !== 'bidirected';
}

/**
 * Classify whether a structural-validation rejection is the unsupported
 * add-risk / reachability shape. Returns `null` for every other rejection so
 * the caller keeps the existing generic copy.
 */
export function classifyAddRiskToOptionRejection(
  candidateGraph: GraphV3T,
  newViolations: readonly StructuralViolation[],
  operations?: readonly unknown[],
): AddRiskRejectionMatch | null {
  // Gate 1 — only reachability-class failures, and every new violation must be
  // reachability-class. A compound failure (limits, cycles, missing kinds,
  // option-factor, …) is a different problem → fall through to the generic copy.
  if (newViolations.length === 0) return null;
  if (!newViolations.every((v) => REACHABILITY_CODES.has(v.code))) return null;

  // Node ids named in the per-node reachability violations.
  const violatedIds = new Set<string>();
  for (const v of newViolations) {
    const m = NODE_ID_IN_DETAIL.exec(v.detail);
    if (m && m[1]) violatedIds.add(m[1]);
  }
  // Detail format changed / only goal-level reachability → fail safe to generic.
  if (violatedIds.size === 0) return null;

  // Gate 2 — among the violated nodes, find risk-kind nodes with NO inbound
  // directed edge from a factor (the "not connected through a factor" shape).
  const riskMatches: { id: string; label: string }[] = [];
  for (const node of candidateGraph.nodes) {
    if (node.kind !== 'risk') continue;
    if (!violatedIds.has(node.id)) continue;
    const hasFactorInbound = candidateGraph.edges.some(
      (e) =>
        isDirected(e)
        && e.to === node.id
        && candidateGraph.nodes.some((n) => n.id === e.from && n.kind === 'factor'),
    );
    if (hasFactorInbound) continue; // already hosted by a factor — not our shape
    riskMatches.push({ id: node.id, label: node.label });
  }
  if (riskMatches.length === 0) return null;

  // Conservative operations gate: when patch operations are supplied, the edit
  // must have ADDED or WIRED the matched risk THIS turn (an add_node of the
  // risk, or an add_edge touching it). This excludes legitimate NON-add-risk
  // rejections that merely leave a *pre-existing* risk unreachable — e.g. an
  // edit that removes a factor and orphans a risk it used to host (there is no
  // "new risk to add" in that case, so the add-risk copy would misfire). When
  // operations are absent / not interpretable, the candidateGraph + new-violation
  // evidence stands (the production caller always supplies canonical operations).
  const gated = operations === undefined
    ? riskMatches
    : riskMatches.filter((r) => riskWasAddedOrWired(operations, r.id) !== 'no');
  if (gated.length === 0) return null;

  return {
    risk_labels: gated.map((r) => r.label),
    example_factor_labels: decisionReachableFactorLabels(candidateGraph),
    added_new_risk: anyRiskAddNode(operations),
  };
}

/**
 * Factor-kind labels reachable from any decision node via directed edges —
 * valid example hosts for the risk. Capped, de-duplicated, label-clean.
 */
function decisionReachableFactorLabels(graph: GraphV3T): readonly string[] {
  const forward = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    if (!isDirected(edge)) continue;
    if (!forward.has(edge.from)) forward.set(edge.from, new Set());
    forward.get(edge.from)!.add(edge.to);
  }
  const reachable = new Set<string>();
  const queue: string[] = [];
  for (const n of graph.nodes) {
    if (n.kind === 'decision') {
      reachable.add(n.id);
      queue.push(n.id);
    }
  }
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of forward.get(current) ?? []) {
      if (!reachable.has(next)) {
        reachable.add(next);
        queue.push(next);
      }
    }
  }
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const n of graph.nodes) {
    if (n.kind !== 'factor') continue;
    if (!reachable.has(n.id)) continue;
    const label = typeof n.label === 'string' ? n.label.trim() : '';
    if (label.length === 0) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    labels.push(label);
    if (labels.length >= 4) break;
  }
  return labels;
}

type OpVerdict = 'yes' | 'no' | 'unknown';

/**
 * Did the supplied canonical patch operations ADD or WIRE the given risk node
 * this turn? Reads the canonical `{ op, value }` shape (PatchOperationSchema):
 * `add_node` → `value.id`; `add_edge` → `value.from` / `value.to`.
 *   - `'yes'`  — an add_node of the risk, or an add_edge touching it.
 *   - `'no'`   — operations were interpretable but none added/wired the risk
 *               (e.g. a removal/update elsewhere that incidentally orphaned it).
 *   - `'unknown'` — no operation was interpretable; the caller falls back to the
 *               candidateGraph + new-violation evidence.
 */
function riskWasAddedOrWired(operations: readonly unknown[], riskId: string): OpVerdict {
  let interpreted = false;
  for (const op of operations) {
    if (op === null || typeof op !== 'object') continue;
    const rec = op as Record<string, unknown>;
    if (typeof rec.op !== 'string') continue;
    interpreted = true;
    const value = rec.value && typeof rec.value === 'object' ? (rec.value as Record<string, unknown>) : null;
    if (rec.op === 'add_node' && value && value.id === riskId) return 'yes';
    if (rec.op === 'add_edge' && value && (value.from === riskId || value.to === riskId)) return 'yes';
  }
  return interpreted ? 'no' : 'unknown';
}

/**
 * Observability only: whether the operations clearly add a new risk node.
 * `null` when not supplied / not interpretable. Does NOT gate the match.
 */
function anyRiskAddNode(operations?: readonly unknown[]): boolean | null {
  if (operations === undefined || !Array.isArray(operations)) return null;
  let interpreted = false;
  for (const op of operations) {
    if (op === null || typeof op !== 'object') continue;
    const rec = op as Record<string, unknown>;
    if (typeof rec.op !== 'string') continue;
    interpreted = true;
    const value = rec.value && typeof rec.value === 'object' ? (rec.value as Record<string, unknown>) : null;
    if (rec.op === 'add_node' && value && value.kind === 'risk') return true;
  }
  return interpreted ? false : null;
}
