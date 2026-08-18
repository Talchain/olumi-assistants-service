/**
 * Structural Graph Validator (Pre-validation)
 *
 * Validates the structural integrity of a candidate graph after
 * applying PatchOperations, before the patch is proposed to the user.
 *
 * Checks run exhaustively (no short-circuit) — all violations are reported.
 *
 * ⚠ ABSOLUTE GRAPH SIZE IS NOT THIS VALIDATOR'S AUTHORITY, and never was.
 *
 * This file used to carry a `checkLimits` clause refusing any graph with more
 * than `CEE_GRAPH_MAX_NODES` (20) nodes or `CEE_GRAPH_MAX_EDGES` (30) edges,
 * while this very header declared *"PLoT remains the canonical validation
 * authority for absolute graph size"*. The clause tested `graph.nodes.length`
 * — the size of the WHOLE MODEL — on the Run-admission path, including on the
 * first draft, before any mutation existed. Its documented purpose (keeping a
 * per-turn PATCH reviewable) and its implementation (an absolute whole-model
 * ceiling) were two different questions under one name.
 *
 * Removed 2026-08-18. The evidence, all measured, is in
 * `olumi-docs/feedback-2026-08-16/GRAPH-SIZE-AUTHORITY-DERIVATION.md`:
 *   - 20/30 had NO recorded rationale. Minted as 12/20 on 9 Mar 2026
 *     (`2720f626`) with a stated justification — "match
 *     graph-validator.types.ts" — that was FALSE when written (that file held
 *     50/200 at the same SHA), then changed to 20/30 hours later (`89b89aaf`)
 *     inside a commit headlined about a different number, with no reason given
 *     for either value.
 *   - Compute is not the constraint. Running ISL's own `compute_weighted_cost`,
 *     a 24-node/46-edge draft prices at 5,903,760 of 24,000,000 units — 24.6%
 *     of budget. Even the 50-node platform wall is only 63.1%.
 *   - ISL deletes decision/option/constraint nodes from every graph it
 *     computes (`filter_inference_graph`). 20 of 21 real captured drafts that
 *     this clause refused land INSIDE 20/30 after that projection — CEE was
 *     refusing models for a size nothing downstream ever sees.
 *   - CEE's own draft prompt asks the model for up to 50 nodes / 100 edges
 *     (`prompts/defaults-v22.ts` ← `config/graphCaps.ts`) and then refused the
 *     output it had asked for.
 *
 * WHAT STILL BOUNDS SIZE, stated per PATH rather than in general — the general
 * form of this sentence was wrong in review, and being wrong about which
 * authority is live is the exact defect this deletion exists to remove.
 *
 * `src/config/graphCaps.ts` (`GRAPH_MAX_NODES` 50 / `GRAPH_MAX_EDGES` 100)
 * matches PLoT's canonical limits and the shared contract (verified across the
 * pin skew: CEE's vendored 0.46.0 and PLoT's 0.40.0 both carry 50/100). It is
 * ENFORCED on:
 *   - ingress — `routes/assist.v1.scenario-graph-register.ts:268-277`,
 *     `GRAPH_TOO_LARGE`, and the response names `max_nodes`/`max_edges`;
 *   - draft output — `adapters/llm/{anthropic,openai}.ts` trim to 50/100;
 *   - dual-draft merge — `cee/dual-draft/merge.ts:382`, `graph_cap_exceeded`.
 *
 * ⚠ IT IS NOT ENFORCED ON THE EDIT PATH, AND THAT IS A RESIDUAL OF THIS CHANGE.
 * `edit-graph.ts` has a PLoT semantic gate, but it is `if (plotClient)` over
 * `opts?.plotClient ?? null` (`:1855`), and NEITHER live call site passes one —
 * `edit-graph-dispatch.ts:1108` passes `{preComposedOperations}` only, `:2248`
 * passes no opts. The codebase says so itself at `edit-graph.ts:3331-3334`
 * ("V5 dispatch does not couple to PLoT infrastructure, so PLoT never runs"),
 * and dispatch runs emit `plot_outcome: "skipped"` on every edit turn. This is a
 * CALL-SITE fact: configuring PLoT on staging does not change it. So after this
 * change no CEE authority bounds absolute size on the edit path — growth is
 * bounded only by `MAX_NODE_OPS = 4` per turn, which is a rate, not a ceiling.
 * Two things keep that in proportion: the deleted clause was ALREADY leaky in
 * precisely this case (the post-mutation gate subtracts baseline violations, so
 * an existing 24-node model's size violation was absorbed and the edit admitted
 * anyway — it bit only on the ≤20 → 21 crossing), and a PLoT *throw* still hard-
 * rejects. Bounding the edit path deliberately is a decision owed, not an
 * oversight to be papered over here.
 *
 * ⚠ AND THE DOWNSTREAM WALL IS NOT WHERE IT LOOKS. PLoT's run-side validation
 * executes on the FILTERED causal graph (`run.ts:6069` →
 * `runPreflightValidation(filteredGraph, …)`) and its admission caps count
 * `causalNodeCount` — so a 60-node CEE model that filters to 40 causal nodes
 * analyses without complaint. Separately, `RUN_CRITIQUE_NODE_LIMIT = 40` means
 * the 41–50 band this change newly admits emits a `GRAPH_TOO_LARGE` blocker
 * with "Results marked approximate" — not a crash, but not clean acceptance.
 *
 * What this validator DOES own is unchanged: required node kinds, orphans,
 * option→factor and decision→option connectivity, reachability to the goal,
 * and acyclicity.
 */

import type { GraphV3T } from "../schemas/cee-v3.js";
import { GRAPH_MAX_NODES, GRAPH_MAX_EDGES } from "../config/graphCaps.js";

// ============================================================================
// Types
// ============================================================================

export type StructuralViolationCode =
  | 'ORPHAN_NODE'
  | 'NO_PATH_TO_GOAL'
  | 'CYCLE_DETECTED'
  | 'NODE_LIMIT_EXCEEDED'
  | 'EDGE_LIMIT_EXCEEDED'
  | 'NO_GOAL'
  | 'NO_DECISION'
  | 'FEWER_THAN_TWO_OPTIONS'
  | 'OPTION_NO_FACTOR_EDGES'
  | 'OPTION_NOT_LINKED_TO_DECISION';

export interface StructuralViolation {
  code: StructuralViolationCode;
  detail: string;
}

export interface StructuralValidationResult {
  valid: boolean;
  violations: StructuralViolation[];
}

// ============================================================================
// Constants
// ============================================================================

// ⚠ There is deliberately no local node/edge ceiling here, and no
// `CEE_GRAPH_MAX_NODES` / `CEE_GRAPH_MAX_EDGES` read. A second pair of size
// constants in this file is what let a 20/30 ceiling act as the absolute
// authority while `graphCaps.ts` advertised 50/100 to the drafting prompt and
// to `/v1/limits`.
//
// ⚠ THE NARROW CLAIM, and it is deliberately narrower than the one first
// written here. "Size resolves against `graphCaps` and nowhere else" is FALSE:
// `src/validators/graph-validator.ts:396-414` is live (six production
// importers) with hardcoded `NODE_LIMIT = 50` / `EDGE_LIMIT = 200`, emits THESE
// SAME TWO violation codes under its own `ValidationErrorCode` union, and its
// own comment says CEE intentionally diverges from the platform on edges. That
// is a second live CEE size authority and a differently-named twin — the
// estate's chronic defect, and it very nearly got asserted away inside the
// correction written to remove a twin. Rowed, not fixed here.
// The true claim is only this: THIS VALIDATOR no longer holds a size clause.
const MIN_OPTIONS = 2;

// ============================================================================
// User-facing violation messages
// ============================================================================

export const VIOLATION_MESSAGES: Record<StructuralViolationCode, string> = {
  ORPHAN_NODE: 'This change would leave a node with no connections.',
  // 1.16 item C: the message and the predicate now agree — checkPathToGoal's
  // second loop flags nodes that cannot REACH the goal via forward directed
  // edges (reverse-BFS from the goal), not nodes unreachable FROM the
  // decision. Loop 1 (goal reachable from the decision) also reports under
  // this code; "cannot reach the goal" reads correctly for both.
  NO_PATH_TO_GOAL: 'This change would leave a node that cannot reach the goal.',
  CYCLE_DETECTED: 'This change would create a circular dependency in the model.',
  // ⚠⚠ THESE TWO ENTRIES CURRENTLY HAVE NO PRODUCER. THE COPY BELOW IS LATENT,
  // NOT USER-FACING — do not cite it as a shipped copy fix.
  //
  // Complete reader manifest for `VIOLATION_MESSAGES[code]`:
  // `analysis-ready-helper.ts:630`, `edit-graph.ts:3000` and `:3012`. All three
  // are driven exclusively by `validateGraphStructure().violations`, and after
  // the deletion above that function can never emit these two codes. So nothing
  // renders these strings today. (Contrast control: the same three lookups ARE
  // live for `CYCLE_DETECTED` and `ORPHAN_NODE` — the readers work; only these
  // two entries are orphaned.) They stay because `StructuralViolationCode` is
  // shared vocabulary — `analysis-ready-core.ts:69` folds it into
  // `ReadinessReasonCode`, and the add-risk preflight below classifies against
  // these code STRINGS at `edit-graph-dispatch.ts:2031`.
  //
  // ⚠ The string a user CAN still hit is `edit-graph-dispatch.ts:2016`, which
  // still says "too complex to analyse reliably". Fixing it is out of this
  // lane's fence and is rowed; nothing below changes what that user sees.
  //
  // The previous EDGE copy here carried the same claim, and measurement refutes
  // it: at the 50-node/100-edge ceiling a full analysis costs 63.1% of ISL's
  // budget, and at a typical refused draft (24/46) it costs 24.6%. Nothing about
  // a model this size is unreliable to analyse. The copy now states the one
  // thing that IS true — the size Olumi accepts — and names the number, derived
  // from the authority rather than mirroring it, so that IF a producer is ever
  // reattached the string is already honest.
  NODE_LIMIT_EXCEEDED: `Olumi can analyse models of up to ${GRAPH_MAX_NODES} nodes. This one goes past that — remove a node to make room.`,
  EDGE_LIMIT_EXCEEDED: `Olumi can analyse models of up to ${GRAPH_MAX_EDGES} connections. This one goes past that — remove a connection to make room.`,
  NO_GOAL: 'The model would have no goal node.',
  NO_DECISION: 'The model would have no decision node.',
  FEWER_THAN_TWO_OPTIONS: 'The model would have fewer than two options.',
  OPTION_NO_FACTOR_EDGES: 'An option has no factor connections and cannot be analysed. Add at least one factor edge.',
  // PR #413 review FIXUP 3 — distinct from NO_PATH_TO_GOAL: a floating
  // option can reach the goal, but nothing selects it.
  OPTION_NOT_LINKED_TO_DECISION: 'This change would leave an option that is not connected from the decision. Link the decision to it.',
};

// ============================================================================
// Validator
// ============================================================================

/**
 * Validate the structural integrity of a graph.
 *
 * All checks run exhaustively — no short-circuit.
 * Returns all violations found.
 */
/**
 * Pre-LLM preflight for add-risk: would adding one risk node plus the
 * minimal connecting edges push the graph past CEE's size authority?
 *
 * Conservative edge projection: the deterministic add-risk path creates
 * one risk node plus typically TWO edges (factor → risk inbound; risk
 * → option outbound). The LLM-driven path may create more. We project
 * +2 edges as the floor — matches what the deterministic path actually
 * emits and avoids false positives that would block valid adds.
 *
 * ⚠ REBOUND 2026-08-18, and the rebinding is load-bearing. This used to read
 * the same local 20/30 constants as `checkLimits`, and its contract was
 * *"a positive preflight here implies the post-mutation validator would also
 * reject"*. `checkLimits` is gone, so left alone this would have refused an
 * add that the rest of CEE would happily have accepted: the product declining
 * an action it could honour, which is the same defect as asking a question it
 * cannot accept an answer to. It now reads `graphCaps` (50/100), so it refuses
 * only where CEE's advertised cap genuinely does.
 *
 * ⚠ BE PRECISE ABOUT WHAT THAT BUYS, because the first version of this note
 * overclaimed. On the EDIT path this is now the ONLY absolute size bound left
 * in CEE: the post-mutation size clause is gone, and the PLoT semantic gate in
 * `edit-graph.ts` never executes from V5 dispatch (`if (plotClient)` over
 * `opts?.plotClient ?? null` — neither live call site passes one; see the file
 * header). So this preflight no longer ANTICIPATES a downstream refusal on the
 * add-risk branch — for that one branch it IS the refusal. It remains a genuine
 * LLM-call saver: past 50/100 the model would be refused at ingress on any
 * re-registration and is beyond what CEE advertises. Every other edit branch
 * has no absolute ceiling at all, which is a decision owed rather than a
 * property of this function.
 */
export interface AddRiskPreflight {
  readonly over_node_limit: boolean;
  readonly over_edge_limit: boolean;
  readonly current_nodes: number;
  readonly projected_nodes: number;
  readonly current_edges: number;
  readonly projected_edges: number;
  readonly node_limit: number;
  readonly edge_limit: number;
}

const PROJECTED_EDGES_FOR_ADD_RISK = 2;

export function wouldExceedAddRiskLimits(graph: GraphV3T): AddRiskPreflight {
  const current_nodes = graph.nodes.length;
  const current_edges = graph.edges.length;
  const projected_nodes = current_nodes + 1;
  const projected_edges = current_edges + PROJECTED_EDGES_FOR_ADD_RISK;
  return {
    over_node_limit: projected_nodes > GRAPH_MAX_NODES,
    over_edge_limit: projected_edges > GRAPH_MAX_EDGES,
    current_nodes,
    projected_nodes,
    current_edges,
    projected_edges,
    node_limit: GRAPH_MAX_NODES,
    edge_limit: GRAPH_MAX_EDGES,
  };
}

export function validateGraphStructure(graph: GraphV3T): StructuralValidationResult {
  const violations: StructuralViolation[] = [];

  checkRequiredNodeKinds(graph, violations);
  // No size check. Absolute graph size is `graphCaps`' question, not this
  // validator's — see the file header for the measurement that settled it.
  checkOrphanNodes(graph, violations);
  checkOptionFactorEdges(graph, violations);
  checkOptionDecisionEdges(graph, violations);
  checkPathToGoal(graph, violations);
  checkCycles(graph, violations);

  return {
    valid: violations.length === 0,
    violations,
  };
}

// ============================================================================
// Individual Checks
// ============================================================================

function checkRequiredNodeKinds(graph: GraphV3T, violations: StructuralViolation[]): void {
  const hasGoal = graph.nodes.some((n) => n.kind === 'goal');
  const hasDecision = graph.nodes.some((n) => n.kind === 'decision');
  const optionCount = graph.nodes.filter((n) => n.kind === 'option').length;

  if (!hasGoal) {
    violations.push({ code: 'NO_GOAL', detail: 'No goal node in graph' });
  }
  if (!hasDecision) {
    violations.push({ code: 'NO_DECISION', detail: 'No decision node in graph' });
  }
  if (optionCount < MIN_OPTIONS) {
    violations.push({
      code: 'FEWER_THAN_TWO_OPTIONS',
      detail: `Only ${optionCount} option node(s) — minimum is ${MIN_OPTIONS}`,
    });
  }
}

function checkOrphanNodes(graph: GraphV3T, violations: StructuralViolation[]): void {
  // Build set of nodes that have at least one edge (directed or bidirected)
  const connected = new Set<string>();
  for (const edge of graph.edges) {
    connected.add(edge.from);
    connected.add(edge.to);
  }

  for (const node of graph.nodes) {
    if (!connected.has(node.id)) {
      violations.push({
        code: 'ORPHAN_NODE',
        detail: `Node "${node.id}" (${node.label}) has no edges`,
      });
    }
  }
}

function isDirected(edge: GraphV3T['edges'][number]): boolean {
  // Treat absent edge_type as 'directed' (backward compat, matches schemas/graph.ts)
  return (edge as Record<string, unknown>).edge_type !== 'bidirected';
}

/**
 * Every option node must have at least one outbound directed edge to a
 * factor node. An option without a factor connection cannot be analysed —
 * the prompt (edit-graph-v6) already states this rule, but the validator
 * was not enforcing it. An LLM that emits only `add_node opt_*` plus the
 * decision→option structural edge would otherwise produce a non-functional
 * option that passes structural validation.
 *
 * Inbound `decision → option` edges and outbound `option → outcome|risk`
 * edges do not satisfy the rule — the connection must be option → factor.
 */
function checkOptionFactorEdges(graph: GraphV3T, violations: StructuralViolation[]): void {
  const factorIds = new Set<string>();
  for (const node of graph.nodes) {
    if (node.kind === 'factor') factorIds.add(node.id);
  }

  for (const node of graph.nodes) {
    if (node.kind !== 'option') continue;
    const hasFactorEdge = graph.edges.some(
      (edge) => isDirected(edge) && edge.from === node.id && factorIds.has(edge.to),
    );
    if (!hasFactorEdge) {
      violations.push({
        code: 'OPTION_NO_FACTOR_EDGES',
        detail: `Option "${node.id}" (${node.label}) has no outbound edge to a factor — it cannot be analysed. Add at least one option → factor edge.`,
      });
    }
  }
}

/**
 * PR #413 review FIXUP 3 — every option node must have at least one INBOUND
 * directed edge from a decision node. The item-C reachability flip (loop 2
 * now checks "can the node REACH the goal", not "is it reachable FROM the
 * decision") opened a gap the old loop 2 happened to cover: a FLOATING
 * option (outbound option → factor edge, no decision → option inbound)
 * reaches the goal and would pass every remaining check — but an option no
 * decision can select is structurally meaningless. Skipped entirely when
 * the graph has no decision node (NO_DECISION owns that failure; flagging
 * every option as well would be noise).
 */
function checkOptionDecisionEdges(graph: GraphV3T, violations: StructuralViolation[]): void {
  const decisionIds = new Set<string>();
  for (const node of graph.nodes) {
    if (node.kind === 'decision') decisionIds.add(node.id);
  }
  if (decisionIds.size === 0) return; // Already caught by NO_DECISION.

  for (const node of graph.nodes) {
    if (node.kind !== 'option') continue;
    const hasDecisionInbound = graph.edges.some(
      (edge) => isDirected(edge) && edge.to === node.id && decisionIds.has(edge.from),
    );
    if (!hasDecisionInbound) {
      violations.push({
        code: 'OPTION_NOT_LINKED_TO_DECISION',
        detail: `Option "${node.id}" (${node.label}) has no inbound edge from a decision — nothing selects it. Add a decision → option edge.`,
      });
    }
  }
}

function checkPathToGoal(graph: GraphV3T, violations: StructuralViolation[]): void {
  const goalNodes = graph.nodes.filter((n) => n.kind === 'goal');
  if (goalNodes.length === 0) return; // Already caught by NO_GOAL check

  const decisionNodes = graph.nodes.filter((n) => n.kind === 'decision');
  if (decisionNodes.length === 0) return; // Already caught by NO_DECISION check

  // Build forward adjacency list — skip bidirected edges (unmeasured confounders)
  const forward = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    if (!isDirected(edge)) continue;
    if (!forward.has(edge.from)) forward.set(edge.from, new Set());
    forward.get(edge.from)!.add(edge.to);
  }

  // BFS from each decision node to find all reachable nodes
  const reachable = new Set<string>();
  const queue: string[] = [];

  for (const dec of decisionNodes) {
    queue.push(dec.id);
    reachable.add(dec.id);
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    const neighbours = forward.get(current);
    if (neighbours) {
      for (const next of neighbours) {
        if (!reachable.has(next)) {
          reachable.add(next);
          queue.push(next);
        }
      }
    }
  }

  // Check if every goal is reachable
  for (const goal of goalNodes) {
    if (!reachable.has(goal.id)) {
      violations.push({
        code: 'NO_PATH_TO_GOAL',
        detail: `Goal node "${goal.id}" (${goal.label}) not reachable from decision node`,
      });
    }
  }

  // Loop 2 (1.16 item C — reachability predicate flip): every edged
  // non-goal node must be able to REACH the goal via forward directed
  // edges. The previous predicate required every edged node to be
  // reachable FROM the decision, which wrongly rejected legitimate
  // exogenous influences — e.g. a new risk node whose only edge is an
  // outbound edge into a factor that reaches the goal has a valid
  // forward path to the goal, but nothing points at it from the
  // decision side. One reverse-BFS from the goal nodes over the same
  // forward adjacency computes the honest set; true dead-ends (edged
  // nodes with no forward path to the goal) still fail.
  const reverse = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    if (!isDirected(edge)) continue;
    if (!reverse.has(edge.to)) reverse.set(edge.to, new Set());
    reverse.get(edge.to)!.add(edge.from);
  }

  const canReachGoal = new Set<string>();
  const reverseQueue: string[] = [];
  for (const goal of goalNodes) {
    canReachGoal.add(goal.id);
    reverseQueue.push(goal.id);
  }
  while (reverseQueue.length > 0) {
    const current = reverseQueue.shift()!;
    const predecessors = reverse.get(current);
    if (predecessors) {
      for (const prev of predecessors) {
        if (!canReachGoal.has(prev)) {
          canReachGoal.add(prev);
          reverseQueue.push(prev);
        }
      }
    }
  }

  // Suppress the redundant flag for options already reported by
  // OPTION_NO_FACTOR_EDGES: an option with no outbound factor edge
  // trivially cannot reach the goal, so both codes would fire on the SAME
  // defect. The specific violation subsumes the generic one — and the edit
  // repair loop gates on "ALL new violations repairable"
  // (STRUCTURAL_REPAIRABLE_CODES = {OPTION_NO_FACTOR_EDGES}), so the
  // redundant NO_PATH_TO_GOAL would make the orphan-option repair path
  // unreachable. Same predicate as checkOptionFactorEdges.
  const factorIds = new Set(
    graph.nodes.filter((n) => n.kind === 'factor').map((n) => n.id),
  );
  const optionsMissingFactorEdge = new Set(
    graph.nodes
      .filter(
        (n) =>
          n.kind === 'option' &&
          !graph.edges.some(
            (edge) => isDirected(edge) && edge.from === n.id && factorIds.has(edge.to),
          ),
      )
      .map((n) => n.id),
  );

  for (const node of graph.nodes) {
    if (node.kind === 'goal') continue; // Trivially reaches itself; loop 1 owns the goal.
    if (node.kind === 'decision') continue; // Loop 1 owns the decision→goal relationship.
    if (canReachGoal.has(node.id)) continue;
    if (node.kind === 'option' && optionsMissingFactorEdge.has(node.id)) continue;
    // Already caught by orphan check if it has no edges at all —
    // but an edged node can still be a dead-end with no path to the goal.
    const hasAnyEdge = graph.edges.some((e) => e.from === node.id || e.to === node.id);
    if (hasAnyEdge) {
      violations.push({
        code: 'NO_PATH_TO_GOAL',
        detail: `Node "${node.id}" (${node.label}) cannot reach the goal via directed paths`,
      });
    }
  }
}

function checkCycles(graph: GraphV3T, violations: StructuralViolation[]): void {
  // Build forward adjacency list — skip bidirected edges (not directed paths)
  const forward = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (!isDirected(edge)) continue;
    if (!forward.has(edge.from)) forward.set(edge.from, []);
    forward.get(edge.from)!.push(edge.to);
  }

  // DFS cycle detection
  const WHITE = 0; // unvisited
  const GRAY = 1;  // in current path
  const BLACK = 2; // fully processed

  const color = new Map<string, number>();
  for (const node of graph.nodes) {
    color.set(node.id, WHITE);
  }

  let cycleFound = false;

  function dfs(nodeId: string): void {
    if (cycleFound) return; // One cycle is sufficient evidence
    color.set(nodeId, GRAY);

    const neighbours = forward.get(nodeId) ?? [];
    for (const next of neighbours) {
      const c = color.get(next) ?? WHITE;
      if (c === GRAY) {
        cycleFound = true;
        return;
      }
      if (c === WHITE) {
        dfs(next);
        if (cycleFound) return;
      }
    }

    color.set(nodeId, BLACK);
  }

  for (const node of graph.nodes) {
    if (color.get(node.id) === WHITE) {
      dfs(node.id);
      if (cycleFound) break;
    }
  }

  if (cycleFound) {
    violations.push({
      code: 'CYCLE_DETECTED',
      detail: 'Directed cycle detected in graph',
    });
  }
}
