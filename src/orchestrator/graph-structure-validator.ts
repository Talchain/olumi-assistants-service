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

import { limitSinkBranch } from '../graph/limit-sink-branch.js';
import { inertRiskBranch, preconditionRiskIds } from '../graph/inert-risk.js';
import { NodeV3, type GraphV3T } from "../schemas/cee-v3.js";
import { GRAPH_MAX_NODES, GRAPH_MAX_EDGES } from "../config/graphCaps.js";
import { isDecisionFreeShape } from "../validators/decision-free-shape.js";

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
  | 'OPTION_NOT_LINKED_TO_DECISION'
  | 'PRECONDITION_RISK_LINKED';

export interface StructuralViolation {
  code: StructuralViolationCode;
  detail: string;
  /** (B4) The option a per-option violation is about, when there is one, so a
   *  readiness blocker can name it by id instead of only in `detail` prose. */
  option_id?: string;
  option_label?: string;
  /** (B4, the whole class) The factor a per-node violation is about. */
  factor_id?: string;
  factor_label?: string;
}

/**
 * (B4, the whole class) — the id-scope of a per-NODE violation: an option names
 * `option_id`, a factor names `factor_id`, and any other kind names nothing
 * (never an invented scope). Every per-node check spreads this, so a new check
 * cannot name its node in prose only.
 */
function elementScope(node: { id: string; kind: string; label?: string }): Partial<StructuralViolation> {
  if (node.kind === 'option') {
    return { option_id: node.id, ...(node.label ? { option_label: node.label } : {}) };
  }
  if (node.kind === 'factor') {
    return { factor_id: node.id, ...(node.label ? { factor_label: node.label } : {}) };
  }
  return {};
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

/**
 * ⭐ THE SINGLE OWNER OF STRUCTURAL-VIOLATION COPY — TWO VOICES, ONE TABLE.
 *
 * The same structural finding is reported on two surfaces that are asking two
 * DIFFERENT QUESTIONS, and for a long time both were served one string:
 *
 *   · PREVIEW  — `edit-graph.ts:3000/:3012`. A patch was validated and
 *     REJECTED; it was never applied. The honest voice is conditional:
 *     "This change would leave a node with no connections."
 *
 *   · CURRENT  — `analysis-ready-helper.ts` `structuralIssue()`. A graph the
 *     user already has was loaded and assessed. NOTHING WAS PROPOSED. The
 *     conditional voice is a false statement here: it describes an edit that
 *     does not exist, and `summariseReadiness` then wraps it in "Here's what's
 *     still open before this can run cleanly: …" — a frame whose entire job is
 *     to describe the model AS IT STANDS.
 *
 * Two questions under one name is this estate's chronic defect (trap 21), and
 * the wrong fix is to reword one voice — that just moves the lie to the other
 * surface. The fix is to name them apart and KEY THEM OFF ONE OWNER. Both
 * exported records are PROJECTIONS of this table, so there is no second string
 * table to drift: adding a code is a type error here, and the two voices cannot
 * go out of sync because neither is hand-maintained against the other.
 *
 * ⚠ IF YOU ADD A SURFACE, ASK WHICH QUESTION IT ANSWERS before picking a
 * projection. A surface that describes a proposal takes `preview`; a surface
 * that describes the model as it stands takes `current`.
 */
/**
 * ⚠ THESE STRINGS ARE SAID TO THE USER, VERBATIM — in the chat (the unblock answer
 * quotes them) and on the UI's Run gate. The UI's jargon guard (DGAI
 * `ceeTextGuard.ts` `isSafeCeeText`) withholds a WHOLE blocker list when any one
 * message says "node", "edge" or "graph", and the gate then degrades to a label
 * rung that names no remedy ('"New option" and "New option" are not ready for
 * analysis yet', served 26 Sep, UI c3c2d539, after a canvas "+ Add option").
 * Pinned by `graph-structure-validator.copy.test.ts`.
 */
export const VIOLATION_COPY: Record<
  StructuralViolationCode,
  { readonly preview: string; readonly current: string }
> = {
  ORPHAN_NODE: {
    preview: 'This change would leave a part of the model with no connections.',
    current: 'A part of the model has no connections.',
  },
  // 1.16 item C: the message and the predicate now agree — checkPathToGoal's
  // second loop flags nodes that cannot REACH the goal via forward directed
  // edges (reverse-BFS from the goal), not nodes unreachable FROM the
  // decision. Loop 1 (goal reachable from the decision) also reports under
  // this code; "cannot reach the goal" reads correctly for both.
  NO_PATH_TO_GOAL: {
    preview: 'This change would leave a part of the model that cannot reach the goal.',
    current: 'A part of the model cannot reach the goal.',
  },
  CYCLE_DETECTED: {
    preview: 'This change would create a circular dependency in the model.',
    current: 'The model has a circular dependency.',
  },
  // ⚠⚠ THESE TWO ENTRIES CURRENTLY HAVE NO PRODUCER. THE COPY BELOW IS LATENT,
  // NOT USER-FACING — do not cite it as a shipped copy fix.
  //
  // Complete reader manifest for the two projections below:
  // `analysis-ready-helper.ts:641` (CURRENT), `edit-graph.ts:3000` and `:3012`
  // (PREVIEW). All three are driven exclusively by
  // `validateGraphStructure().violations`, and after the size-clause deletion
  // that function can never emit these two codes. So nothing renders these
  // strings today. (Contrast control: the same three lookups ARE live for
  // `CYCLE_DETECTED` and `ORPHAN_NODE` — the readers work; only these two
  // entries are orphaned.) They stay because `StructuralViolationCode` is
  // shared vocabulary — `analysis-ready-core.ts:69` folds it into
  // `ReadinessReasonCode`, and the add-risk preflight below classifies against
  // these code STRINGS at `edit-graph-dispatch.ts:2031`.
  //
  // ⚠ The string a user CAN still hit is `edit-graph-dispatch.ts:2016`, which
  // still says "too complex to analyse reliably". Fixing it is out of this
  // lane's fence and is rowed; nothing here changes what that user sees.
  //
  // Both voices are IDENTICAL for these two, and deliberately so: the copy
  // already states a standing fact about what Olumi accepts rather than a
  // consequence of a proposed change, so there is no conditional to remove. A
  // divergence invented for symmetry's sake would be a second string nobody
  // needs.
  NODE_LIMIT_EXCEEDED: {
    preview: `Olumi can analyse models of up to ${GRAPH_MAX_NODES} parts. This one goes past that — remove one to make room.`,
    current: `Olumi can analyse models of up to ${GRAPH_MAX_NODES} parts. This one goes past that — remove one to make room.`,
  },
  EDGE_LIMIT_EXCEEDED: {
    preview: `Olumi can analyse models of up to ${GRAPH_MAX_EDGES} connections. This one goes past that — remove a connection to make room.`,
    current: `Olumi can analyse models of up to ${GRAPH_MAX_EDGES} connections. This one goes past that — remove a connection to make room.`,
  },
  NO_GOAL: {
    preview: 'The model would have no goal.',
    current: 'The model has no goal.',
  },
  NO_DECISION: {
    preview: 'The model would have no decision.',
    current: 'The model has no decision.',
  },
  FEWER_THAN_TWO_OPTIONS: {
    preview: 'The model would have fewer than two options.',
    current: 'The model has fewer than two options.',
  },
  // Already present-tense and true of both surfaces — a rejected patch that
  // leaves an option unwired and a loaded model with an unwired option are the
  // same sentence. Kept identical rather than split for the sake of it.
  OPTION_NO_FACTOR_EDGES: {
    preview: 'An option has no factor connections and cannot be analysed. Connect it to at least one factor.',
    current: 'An option has no factor connections and cannot be analysed. Connect it to at least one factor.',
  },
  // PR #413 review FIXUP 3 — distinct from NO_PATH_TO_GOAL: a floating
  // option can reach the goal, but nothing selects it.
  OPTION_NOT_LINKED_TO_DECISION: {
    preview: 'This change would leave an option that is not connected from the decision. Link the decision to it.',
    current: 'An option is not connected from the decision. Link the decision to it.',
  },
  PRECONDITION_RISK_LINKED: {
    preview: "A risk tied to one option is left out of the Run; this model can't link it yet.",
    current: "A risk tied to one option is left out of the Run; this model can't link it yet.",
  },
};

function projectVoice(voice: 'preview' | 'current'): Record<StructuralViolationCode, string> {
  return Object.fromEntries(
    Object.entries(VIOLATION_COPY).map(([code, copy]) => [code, copy[voice]]),
  ) as Record<StructuralViolationCode, string>;
}

/**
 * PREVIEW voice — for surfaces describing a PROPOSED change that was rejected
 * and never applied. Consumed by `edit-graph.ts:3000` and `:3012`.
 *
 * ⚠ Not for readiness. A readiness surface asserting this copy tells a user who
 * changed nothing what a change *would* do.
 */
export const VIOLATION_MESSAGES: Record<StructuralViolationCode, string> = projectVoice('preview');

/**
 * CURRENT-STATE voice — for surfaces describing THE MODEL AS IT STANDS.
 * Consumed by `structuralIssue()` in `analysis-ready-helper.ts`, and from there
 * carried onto the wire as `analysis_ready.readiness_issues[].message` and into
 * `summariseReadiness`'s "what's still open" prose.
 */
export const CURRENT_STATE_VIOLATION_MESSAGES: Record<StructuralViolationCode, string> =
  projectVoice('current');

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

export function validateGraphStructure(
  graph: GraphV3T,
  // ⭐ K3 (`graph/inert-risk.ts`): READINESS ONLY (`analysis-ready-helper.ts`) leaves an inert risk out of the Run rather
  // than refusing it. The chat-edit gate (`edit-graph.ts`) does not pass it: an edit that dead-ends a risk is still refused,
  // exactly as before (DL condition 2 on lease #85 5945974225). RC3 a′'s server-stamped precondition is exempt on BOTH
  // gates: zero edges is its authorised representation, not a dead-ending edit.
  opts: { readonly leaveOutInertRisks?: boolean } = {},
): StructuralValidationResult {
  const violations: StructuralViolation[] = [];
  const leftOut = opts.leaveOutInertRisks === true
    ? inertRiskBranch(graph.nodes, graph.edges, limitIdsOf(graph))
    : preconditionRiskIds(graph.nodes, graph.edges, limitIdsOf(graph));

  checkRequiredNodeKinds(graph, violations);
  violations.push(...preconditionRiskLinkViolations(graph));
  // No size check. Absolute graph size is `graphCaps`' question, not this
  // validator's — see the file header for the measurement that settled it.
  checkOrphanNodes(graph, violations, leftOut);
  checkOptionFactorEdges(graph, violations);
  checkOptionDecisionEdges(graph, violations);
  optionsWithoutGoalPath(graph, leftOut, violations);
  checkCycles(graph, violations);

  return {
    valid: violations.length === 0,
    violations,
  };
}

// ============================================================================
// Individual Checks
// ============================================================================

/**
 * RC3 a′: the stamp is an option precondition, not a causal effect shared by
 * every option. Its authorised representation has no incident link. This is
 * the single rule owner: default structural validation, the patch applier,
 * direct mutation validation and the persistence floor all read this check.
 * Writers select this violation independently of unrelated drafting gaps.
 * The server stamp owns the precondition identity even if a generic writer
 * retypes its carrier: changing kind cannot authorise its causal linkage.
 */
export function preconditionRiskLinkViolations(
  graph: Pick<GraphV3T, 'nodes' | 'edges'>,
): StructuralViolation[] {
  const linked = new Set(graph.edges.flatMap((edge) => [edge.from, edge.to]));
  return graph.nodes.flatMap((risk): StructuralViolation[] => {
    if (risk.relies_on === undefined || !linked.has(risk.id)) return [];
    // The persistence floor also reads raw object supersets. Use the schema's
    // existing stamp parser: malformed metadata is not an authored stamp.
    const parsed = NodeV3.shape.relies_on.safeParse(risk.relies_on);
    const stamp = parsed.success ? parsed.data : undefined;
    if (stamp === undefined) return [];
    const option = graph.nodes.find((node) => node.id === stamp.option_id && node.kind === 'option');
    const riskLabel = typeof risk.label === 'string' ? risk.label : 'This risk';
    const optionLabel = typeof option?.label === 'string' ? option.label : 'its option';
    return [{
      code: 'PRECONDITION_RISK_LINKED',
      detail: `‘${riskLabel}’ is tied to ‘${optionLabel}’ and left out of the Run; this model can't link it yet.`,
      option_id: stamp.option_id,
      ...(option?.label === undefined ? {} : { option_label: option.label }),
    }];
  });
}

function checkRequiredNodeKinds(graph: GraphV3T, violations: StructuralViolation[]): void {
  const hasGoal = graph.nodes.some((n) => n.kind === 'goal');
  const hasDecision = graph.nodes.some((n) => n.kind === 'decision');
  const decisionCount = graph.nodes.filter((n) => n.kind === 'decision').length;
  const optionCount = graph.nodes.filter((n) => n.kind === 'option').length;

  // ⭐ THE DIFFERENTLY-NAMED TWIN of `graph-validator.ts`'s MISSING_DECISION /
  // INSUFFICIENT_OPTIONS. Same question, different code vocabulary — and
  // READINESS reads THIS validator, not that one. Fixing one and missing the
  // other is this estate's chronic defect, so both import the SAME predicate
  // from `validators/decision-free-shape.ts` and cannot drift apart.
  const decisionFree = isDecisionFreeShape({ decisionCount, optionCount });

  if (!hasGoal) {
    violations.push({ code: 'NO_GOAL', detail: 'No goal node in graph' });
  }
  if (!hasDecision && !decisionFree) {
    violations.push({ code: 'NO_DECISION', detail: 'No decision node in graph' });
  }
  if (optionCount < MIN_OPTIONS && !decisionFree) {
    violations.push({
      code: 'FEWER_THAN_TWO_OPTIONS',
      detail: `Only ${optionCount} option node(s) — minimum is ${MIN_OPTIONS}`,
    });
  }
}

function checkOrphanNodes(graph: GraphV3T, violations: StructuralViolation[], leftOut: ReadonlySet<string>): void {
  // Build set of nodes that have at least one edge (directed or bidirected)
  const connected = new Set<string>();
  for (const edge of graph.edges) {
    connected.add(edge.from);
    connected.add(edge.to);
  }
  // ⭐ K3: `leftOut` (readiness only) — a risk nobody has said the direction of is left out of the Run and said.

  for (const node of graph.nodes) {
    if (!connected.has(node.id) && !leftOut.has(node.id)) {
      violations.push({
        code: 'ORPHAN_NODE',
        detail: `Node "${node.id}" (${node.label}) has no edges`,
        ...elementScope(node),
      });
    }
  }
}

/** The nodes a limit names (`goal_constraints`): never left out as an inert risk, and the limit-sink branch's roots. */
function limitIdsOf(graph: Pick<GoalPathGraph, 'goal_constraints'>): Set<string> {
  return new Set(
    (graph.goal_constraints ?? []).map((c) => c.node_id).filter((id): id is string => typeof id === 'string'),
  );
}

function isDirected(edge: { readonly edge_type?: unknown }): boolean {
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
        ...elementScope(node),
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
        ...elementScope(node),
      });
    }
  }
}

/** Directed reachability shared by construction and structural validation; bidirected edges are not paths. */
export function reachableNodeIds(
  edges: readonly { readonly from: string; readonly to: string; readonly edge_type?: string }[],
  roots: readonly string[],
  reverse = false,
): Set<string> {
  const adjacency = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (edge.edge_type === 'bidirected') continue;
    const from = reverse ? edge.to : edge.from;
    const to = reverse ? edge.from : edge.to;
    if (!adjacency.has(from)) adjacency.set(from, new Set());
    adjacency.get(from)!.add(to);
  }
  const reachable = new Set(roots);
  const queue = [...reachable];
  for (let i = 0; i < queue.length; i++) {
    for (const next of adjacency.get(queue[i]!) ?? []) {
      if (!reachable.has(next)) {
        reachable.add(next);
        queue.push(next);
      }
    }
  }
  return reachable;
}

/** The admitted data needed by the existing path referee; no schema projection or guessed constraints. */
export interface GoalPathGraph {
  readonly nodes: readonly { readonly id: string; readonly kind: string; readonly label: string; readonly category?: unknown; readonly relies_on?: unknown }[];
  readonly edges: readonly { readonly from: string; readonly to: string; readonly edge_type?: string }[];
  readonly goal_constraints?: readonly { readonly node_id?: string }[];
}

/**
 * The validator's option-path refusals, with its limit sinks, left-out set and specific-violation suppression.
 * The validator also collects its unchanged decision/other-node violations here. Construction reads only option ids.
 */
export function optionsWithoutGoalPath(
  graph: GoalPathGraph,
  leftOut: ReadonlySet<string> = inertRiskBranch(graph.nodes, graph.edges, limitIdsOf(graph)),
  violations: StructuralViolation[] = [],
): Set<string> {
  const refusedOptions = new Set<string>();
  const goalNodes = graph.nodes.filter((n) => n.kind === 'goal');
  if (goalNodes.length === 0) return refusedOptions; // Already caught by NO_GOAL check

  const decisionNodes = graph.nodes.filter((n) => n.kind === 'decision');

  // Scoped to the class being admitted, exactly as in `graph-validator.ts` — see
  // the note there. `options > 0 && decisions === 0` keeps its prior behaviour
  // (skip both loops); it is already refused by NO_DECISION.
  const decisionFree = isDecisionFreeShape({
    decisionCount: decisionNodes.length,
    optionCount: graph.nodes.filter((n) => n.kind === 'option').length,
  });
  if (decisionNodes.length === 0 && !decisionFree) return refusedOptions;

  // ⭐⭐ THE SPLIT, mirroring `graph-validator.ts`'s `validateReachability`.
  //
  // This used to be a single `if (decisionNodes.length === 0) return`, which
  // skipped BOTH loops below. That was harmless only while a decision-free graph
  // was refused outright; now that the deliberate exploratory map is ADMITTED, it
  // would leave that class with no connectivity enforcement in this validator
  // either — and READINESS reads this one.
  //
  // Loop 1 (goal reachable FROM the decision) genuinely needs a decision root.
  // Loop 2 (every edged node can REACH the goal) is a reverse BFS from the goal
  // and needs none, so it must keep running.
  if (decisionNodes.length > 0) {
    const reachable = reachableNodeIds(graph.edges, decisionNodes.map((n) => n.id));

    // Check if every goal is reachable
    for (const goal of goalNodes) {
      if (!reachable.has(goal.id)) {
        violations.push({
          code: 'NO_PATH_TO_GOAL',
          detail: `Goal node "${goal.id}" (${goal.label}) not reachable from decision node`,
        });
      }
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
  const canReachGoal = reachableNodeIds(graph.edges, goalNodes.map((n) => n.id), true);

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

  // ⭐ A LIMIT-ONLY DECISION TALLY IS A VALID TERMINAL (AIQ ruling #70 5858730290 (a); P2 re-measure 5858749394).
  // Served: Paul's budget brief (journey C) never ran — its spend total carries "≤ £30,000", is a sum of the levers'
  // spends, and has no outgoing edge, so this loop refused the whole model on the node the limit watches. A tally bound
  // by a limit is a cost constraint scored against its limit, never a cause of the goal; drafting a tally → goal link to
  // pass this check would invent the false cause A4b removed.
  // ⭐ …AND SO IS A LIMIT'S WHOLE BRANCH WHEN THE DECISION MOVES IT (R3 pre-flight #75 5903589565; AIQ 5903604206; DL
  // lease 5903604509). Served cut-costs (`9f75612`, guest `15f48f0b`): planning quality (a lever) and migration duration
  // (observable, set by the GCP-share lever) → expected migration downtime "≤ 2 weeks", with no downtime → spend link —
  // downtime is not a cause of the bill. Every Run was blocked, and 3 of 4 first drafts invented that link to pass here.
  // A live arm on the corrected prompt then drew downtime's own uncertain causes as roots ("Migration complexity",
  // observable, no parent) — sound science, and refused by a parents-only rule. Exempt ONLY when all hold: a
  // `goal_constraints` row names the node; it has no outgoing directed edge (a terminal) and at least one parent; and a
  // lever (an option or a controllable factor) is among its ancestors — the decision moves it. Exempt are the limited node
  // and every ancestor of it. Any other dead end — one reaching no limit, a limited node with an onward edge that misses
  // the goal, or a limited island no lever reaches — is still refused. Journey C's all-lever parents is a case of this;
  // an exogenous cause of a limited quantity is part of its branch (this supersedes #2129's parents-only contrast).
  const limitTargetIds = limitIdsOf(graph);
  const limitSinkBranchIds = limitSinkBranch(graph.nodes, graph.edges.filter(isDirected), limitTargetIds);

  for (const node of graph.nodes) {
    if (node.kind === 'goal') continue; // Trivially reaches itself; loop 1 owns the goal.
    if (node.kind === 'decision') continue; // Loop 1 owns the decision→goal relationship.
    if (canReachGoal.has(node.id)) continue;
    if (limitSinkBranchIds.has(node.id)) continue;
    // ⭐ K3 (readiness only): a risk nobody has said the direction of, and a cause drawn only into it, is left out.
    if (leftOut.has(node.id)) continue;
    if (node.kind === 'option' && optionsMissingFactorEdge.has(node.id)) continue;
    // Already caught by orphan check if it has no edges at all —
    // but an edged node can still be a dead-end with no path to the goal.
    const hasAnyEdge = graph.edges.some((e) => e.from === node.id || e.to === node.id);
    if (hasAnyEdge) {
      if (node.kind === 'option') refusedOptions.add(node.id);
      violations.push({
        code: 'NO_PATH_TO_GOAL',
        detail: `Node "${node.id}" (${node.label}) cannot reach the goal via directed paths`,
        ...elementScope(node),
      });
    }
  }
  return refusedOptions;
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
