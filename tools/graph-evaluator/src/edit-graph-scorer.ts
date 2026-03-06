/**
 * Deterministic scorer for edit_graph LLM responses.
 *
 * Scores are rule-based — no LLM judge. Nine dimensions:
 * 1. valid_json (0.15)
 * 2. correct_shape (0.10)
 * 3. operation_types_correct (0.15)
 * 4. topology_compliant (0.20)
 * 5. has_impact_rationale (0.10)
 * 6. correct_ordering (0.10)
 * 7. empty_ops_handled (0.10)
 * 8. coaching_present (0.05)
 * 9. path_syntax_valid (0.05)
 */

import type {
  EditGraphFixture,
  EditGraphScore,
  GraphNode,
  GraphEdge,
  ParsedGraph,
} from "./types.js";

// =============================================================================
// Operation ordering ranks
// =============================================================================

const OP_ORDER: Record<string, number> = {
  remove_edge: 0,
  remove_node: 1,
  add_node: 2,
  add_edge: 3,
  update_edge: 4,
  update_node: 5,
};

// =============================================================================
// Forbidden edge kinds (matching validator.ts)
// =============================================================================

const FORBIDDEN_EDGE_KINDS: Array<[string, string]> = [
  ["option", "outcome"],
  ["option", "risk"],
  ["option", "goal"],
  ["factor", "goal"],
  ["decision", "factor"],
  ["decision", "outcome"],
  ["decision", "risk"],
  ["outcome", "outcome"],
  ["risk", "risk"],
  ["outcome", "risk"],
  ["risk", "outcome"],
];

// =============================================================================
// Path syntax pattern
// =============================================================================

const PATH_NODE_RE = /^\/nodes\/[a-z_][a-z0-9_]*$/;
const PATH_EDGE_RE = /^\/edges\/[a-z_][a-z0-9_]*->[a-z_][a-z0-9_]*$/;

// =============================================================================
// Types for parsed edit-graph responses
// =============================================================================

interface EditOperation {
  op_type?: string;
  path?: string;
  value?: Record<string, unknown>;
  impact?: string;
  rationale?: string;
  [key: string]: unknown;
}

interface EditGraphResponse {
  operations?: EditOperation[];
  removed_edges?: unknown[];
  warnings?: string[];
  coaching?: {
    summary?: string;
    rerun_recommended?: boolean;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

// =============================================================================
// Topology compliance checks
// =============================================================================

/**
 * Check whether proposed add_edge operations violate topology rules
 * when applied to the starting graph.
 */
function checkTopologyCompliance(
  response: EditGraphResponse,
  startingGraph: ParsedGraph
): boolean {
  const ops = response.operations ?? [];

  // Build node map from starting graph + add_node ops
  const nodeMap = new Map<string, GraphNode>();
  for (const n of startingGraph.nodes) {
    nodeMap.set(n.id, n);
  }

  // Apply add_node operations
  for (const op of ops) {
    if (op.op_type === "add_node" && op.value) {
      const v = op.value as Record<string, unknown>;
      if (typeof v.id === "string" && typeof v.kind === "string") {
        nodeMap.set(v.id as string, v as unknown as GraphNode);
      }
    }
  }

  // Apply remove_node operations
  for (const op of ops) {
    if (op.op_type === "remove_node" && op.path) {
      const match = op.path.match(/^\/nodes\/(.+)$/);
      if (match) nodeMap.delete(match[1]);
    }
  }

  // Build edge list: starting edges + add_edge - remove_edge
  const edges: Array<{ from: string; to: string }> = [];
  const removedEdgePaths = new Set<string>();

  for (const op of ops) {
    if (op.op_type === "remove_edge" && op.path) {
      removedEdgePaths.add(op.path);
    }
  }

  for (const e of startingGraph.edges) {
    const path = `/edges/${e.from}->${e.to}`;
    if (!removedEdgePaths.has(path)) {
      edges.push({ from: e.from, to: e.to });
    }
  }

  for (const op of ops) {
    if (op.op_type === "add_edge" && op.value) {
      const v = op.value as Record<string, unknown>;
      if (typeof v.from === "string" && typeof v.to === "string") {
        edges.push({ from: v.from as string, to: v.to as string });
      }
    }
  }

  // Check 1: No forbidden edges
  for (const edge of edges) {
    const fromNode = nodeMap.get(edge.from);
    const toNode = nodeMap.get(edge.to);
    if (!fromNode || !toNode) continue;

    for (const [fk, tk] of FORBIDDEN_EDGE_KINDS) {
      if (fromNode.kind === fk && toNode.kind === tk) {
        return false;
      }
    }
  }

  // Check 2: No self-loops
  for (const edge of edges) {
    if (edge.from === edge.to) return false;
  }

  // Check 3: No cycles (Kahn's algorithm)
  const allNodeIds = new Set<string>();
  for (const [id] of nodeMap) allNodeIds.add(id);
  for (const e of edges) {
    allNodeIds.add(e.from);
    allNodeIds.add(e.to);
  }

  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  for (const id of allNodeIds) {
    inDegree.set(id, 0);
    adjacency.set(id, []);
  }

  for (const e of edges) {
    adjacency.get(e.from)?.push(e.to);
    inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  let processed = 0;
  while (queue.length > 0) {
    const current = queue.shift()!;
    processed++;
    for (const neighbor of adjacency.get(current) ?? []) {
      const newDeg = (inDegree.get(neighbor) ?? 0) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  if (processed !== allNodeIds.size) return false;

  // Check 4: update/remove paths reference existing entities
  for (const op of ops) {
    if (op.op_type === "update_edge" || op.op_type === "remove_edge") {
      if (op.path) {
        const match = op.path.match(/^\/edges\/([a-z_][a-z0-9_]*)->([a-z_][a-z0-9_]*)$/);
        if (match) {
          const from = match[1];
          const to = match[2];
          const exists = startingGraph.edges.some(
            (e) => e.from === from && e.to === to
          );
          if (!exists) return false;
        }
      }
    }
    if (op.op_type === "update_node" || op.op_type === "remove_node") {
      if (op.path) {
        const match = op.path.match(/^\/nodes\/(.+)$/);
        if (match) {
          const nodeId = match[1];
          if (!startingGraph.nodes.some((n) => n.id === nodeId)) return false;
        }
      }
    }
  }

  return true;
}

// =============================================================================
// Main scoring function
// =============================================================================

export function scoreEditGraph(
  fixture: EditGraphFixture,
  parsed: Record<string, unknown> | null
): EditGraphScore {
  const nullScore: EditGraphScore = {
    valid_json: false,
    correct_shape: false,
    operation_types_correct: false,
    topology_compliant: false,
    has_impact_rationale: false,
    correct_ordering: false,
    empty_ops_handled: false,
    coaching_present: false,
    path_syntax_valid: false,
    overall: 0,
  };

  // 1. valid_json
  if (!parsed) return nullScore;
  const valid_json = true;

  // 2. correct_shape — must have operations[], warnings[], coaching{}
  const response = parsed as unknown as EditGraphResponse;
  const hasOperations = Array.isArray(response.operations);
  const hasWarnings = Array.isArray(response.warnings);
  const hasCoaching =
    response.coaching !== null &&
    typeof response.coaching === "object" &&
    !Array.isArray(response.coaching);
  const correct_shape = hasOperations && hasWarnings && hasCoaching;

  const ops = response.operations ?? [];
  const warnings = response.warnings ?? [];

  // 3. operation_types_correct
  let operation_types_correct = false;
  if (fixture.expected.has_operations) {
    const actualTypes = new Set(ops.map((o) => o.op_type).filter(Boolean));
    const expectedPresent = (fixture.expected.expected_op_types ?? []).every(
      (t) => actualTypes.has(t)
    );
    const forbiddenAbsent = (fixture.expected.forbidden_op_types ?? []).every(
      (t) => !actualTypes.has(t)
    );
    operation_types_correct = expectedPresent && forbiddenAbsent && ops.length > 0;
  } else {
    // Expected no operations
    operation_types_correct = ops.length === 0;
  }

  // 4. topology_compliant
  let topology_compliant = true;
  if (fixture.expected.topology_must_hold && ops.length > 0) {
    topology_compliant = checkTopologyCompliance(response, fixture.graph);
  }

  // 5. has_impact_rationale — every operation must have impact and rationale
  let has_impact_rationale = true;
  if (ops.length > 0) {
    has_impact_rationale = ops.every(
      (op) =>
        (typeof op.impact === "string" && op.impact.length > 0) &&
        (typeof op.rationale === "string" && op.rationale.length > 0)
    );
  }

  // 6. correct_ordering — remove edges before remove nodes, add nodes before add edges, etc.
  let correct_ordering = true;
  if (ops.length > 1) {
    const ranks = ops
      .map((op) => OP_ORDER[op.op_type ?? ""] ?? 99)
      .filter((r) => r !== 99);
    for (let i = 1; i < ranks.length; i++) {
      if (ranks[i] < ranks[i - 1]) {
        correct_ordering = false;
        break;
      }
    }
  }

  // 7. empty_ops_handled — when no operations expected, warnings should contain expected substrings
  let empty_ops_handled = true;
  if (!fixture.expected.has_operations) {
    if (ops.length > 0) {
      empty_ops_handled = false;
    } else {
      const expectedSubstrings = fixture.expected.expect_warning_substrings ?? [];
      const warningsLower = warnings.map((w) => w.toLowerCase());
      empty_ops_handled = expectedSubstrings.every((sub) =>
        warningsLower.some((w) => w.includes(sub.toLowerCase()))
      );
    }
  }

  // 8. coaching_present — coaching.summary exists, rerun matches expected
  let coaching_present = false;
  if (response.coaching) {
    const summaryExists =
      typeof response.coaching.summary === "string" &&
      response.coaching.summary.trim().length > 0;
    const rerunMatches =
      response.coaching.rerun_recommended === fixture.expected.expect_rerun;
    coaching_present = summaryExists && rerunMatches;
  }

  // 9. path_syntax_valid — all paths match expected patterns
  let path_syntax_valid = true;
  for (const op of ops) {
    if (typeof op.path === "string") {
      if (!PATH_NODE_RE.test(op.path) && !PATH_EDGE_RE.test(op.path)) {
        path_syntax_valid = false;
        break;
      }
    }
  }

  // Overall weighted score
  const overall =
    (valid_json ? 0.15 : 0) +
    (correct_shape ? 0.10 : 0) +
    (operation_types_correct ? 0.15 : 0) +
    (topology_compliant ? 0.20 : 0) +
    (has_impact_rationale ? 0.10 : 0) +
    (correct_ordering ? 0.10 : 0) +
    (empty_ops_handled ? 0.10 : 0) +
    (coaching_present ? 0.05 : 0) +
    (path_syntax_valid ? 0.05 : 0);

  return {
    valid_json,
    correct_shape,
    operation_types_correct,
    topology_compliant,
    has_impact_rationale,
    correct_ordering,
    empty_ops_handled,
    coaching_present,
    path_syntax_valid,
    overall,
  };
}
