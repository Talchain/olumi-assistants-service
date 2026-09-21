/**
 * Deterministic scorer for repair_graph LLM responses.
 *
 * Eleven dimensions:
 * 1.  valid_json              (0.15) - response parses as JSON with nodes/edges/rationales
 * 2.  correct_schema          (0.10) - top-level keys match schema; no extra keys
 * 3.  violations_addressed    (0.15) - rationales cover every input violation code
 * 4.  ids_preserved           (0.10) - all input node IDs still present in output
 * 5.  forbidden_edges_removed (0.10) - prohibited edges no longer appear
 * 6.  required_edges_present  (0.10) - required edges appear in output
 * 7.  no_bridge_edges         (0.05) - no outcome->goal or risk->goal edges (pre-sweep)
 * 8.  bidirected_preserved    (0.05) - bidirected edges unchanged (same params)
 * 9.  external_prior_present  (0.05) - new external factor nodes carry prior field
 * 10. inbound_sum_valid        (0.05) - after INBOUND_STRENGTH_SUM_EXCEEDED, sum <= 1.0
 * 11. no_json_comments         (0.10) - raw text contains no // or block comments
 */

import type {
  RepairGraphFixture,
  RepairGraphScore,
  GraphNode,
  GraphEdge,
} from "./types.js";

// =============================================================================
// Helpers
// =============================================================================

function getNodeKind(nodes: GraphNode[], id: string): string | undefined {
  return nodes.find((n) => n.id === id)?.kind;
}

/** Returns true if this edge is an outcome->goal or risk->goal bridge edge. */
function isBridgeEdge(nodes: GraphNode[], edge: { from: string; to: string }): boolean {
  const fromKind = getNodeKind(nodes, edge.from);
  const toKind = getNodeKind(nodes, edge.to);
  return (
    (fromKind === "outcome" || fromKind === "risk") && toKind === "goal"
  );
}

/** Normalise an edge key for comparison. */
function edgeKey(from: string, to: string): string {
  return `${from}->${to}`;
}

// =============================================================================
// Main scorer
// =============================================================================

export function scoreRepairGraph(
  fixture: RepairGraphFixture,
  parsed: Record<string, unknown> | null,
  rawText: string
): RepairGraphScore {
  const nullScore: RepairGraphScore = {
    valid_json: false,
    correct_schema: false,
    violations_addressed: false,
    ids_preserved: false,
    forbidden_edges_removed: false,
    required_edges_present: false,
    no_bridge_edges: false,
    bidirected_preserved: false,
    external_prior_present: false,
    inbound_sum_valid: false,
    no_json_comments: false,
    overall: 0,
  };

  // -- 1. valid_json --------------------------------------------------------
  if (!parsed) return nullScore;
  const valid_json = true;

  const nodes = (parsed.nodes as GraphNode[] | undefined) ?? [];
  const edges = (parsed.edges as GraphEdge[] | undefined) ?? [];
  const rationales = (parsed.rationales as Array<Record<string, unknown>> | undefined) ?? [];

  // -- 2. correct_schema ----------------------------------------------------
  const topKeys = new Set(Object.keys(parsed));
  const allowedTopKeys = new Set(["nodes", "edges", "rationales"]);
  const hasRequiredKeys =
    Array.isArray(parsed.nodes) &&
    Array.isArray(parsed.edges) &&
    Array.isArray(parsed.rationales);
  const noExtraKeys = [...topKeys].every((k) => allowedTopKeys.has(k));
  const correct_schema = hasRequiredKeys && noExtraKeys;

  // -- 3. violations_addressed ----------------------------------------------
  // Every violation code in fixture.violations must appear in at least one rationale.
  const rationaleCodesFound = new Set(
    rationales.map((r) => (r.violation_code as string | undefined) ?? "")
  );
  const violations_addressed = fixture.violations.every((v) =>
    rationaleCodesFound.has(v.code)
  );

  // -- 4. ids_preserved -----------------------------------------------------
  // All node IDs from fixture.expected.preserve_node_ids must be present in output.
  const outputNodeIds = new Set(nodes.map((n) => n.id));
  const ids_preserved = fixture.expected.preserve_node_ids.every((id) =>
    outputNodeIds.has(id)
  );

  // -- 5. forbidden_edges_removed -------------------------------------------
  const outputEdgeKeys = new Set(edges.map((e) => edgeKey(e.from, e.to)));
  let forbidden_edges_removed = true;
  for (const fe of fixture.expected.forbidden_edges ?? []) {
    if (outputEdgeKeys.has(edgeKey(fe.from, fe.to))) {
      forbidden_edges_removed = false;
      break;
    }
  }

  // -- 6. required_edges_present --------------------------------------------
  let required_edges_present = true;
  for (const re of fixture.expected.required_edges ?? []) {
    if (!outputEdgeKeys.has(edgeKey(re.from, re.to))) {
      required_edges_present = false;
      break;
    }
  }

  // -- 7. no_bridge_edges ---------------------------------------------------
  // Only fail if the model ADDED a NEW bridge edge not present in the input graph.
  // Pre-existing bridge edges in the input are preserved by the model correctly.
  let no_bridge_edges = true;
  if (fixture.expected.no_bridge_edges) {
    const inputBridgeKeys = new Set(
      (fixture.graph.edges ?? [])
        .filter((e) => isBridgeEdge(fixture.graph.nodes ?? [], e))
        .map((e) => edgeKey(e.from, e.to))
    );
    for (const edge of edges) {
      if (isBridgeEdge(nodes, edge) && !inputBridgeKeys.has(edgeKey(edge.from, edge.to))) {
        no_bridge_edges = false;
        break;
      }
    }
  }

  // -- 8. bidirected_preserved ----------------------------------------------
  let bidirected_preserved = true;
  if (fixture.expected.preserve_bidirected) {
    const inputBidirected = (fixture.graph.edges ?? []).filter(
      (e) => e.edge_type === "bidirected"
    );
    for (const bie of inputBidirected) {
      const outputEdge = edges.find(
        (e) => e.from === bie.from && e.to === bie.to && e.edge_type === "bidirected"
      );
      if (!outputEdge) {
        bidirected_preserved = false;
        break;
      }
      // Verify sentinel params preserved
      if (
        outputEdge.strength?.mean !== bie.strength?.mean ||
        outputEdge.strength?.std !== bie.strength?.std ||
        outputEdge.exists_probability !== bie.exists_probability
      ) {
        bidirected_preserved = false;
        break;
      }
    }
  }

  // -- 9. external_prior_present --------------------------------------------
  let external_prior_present = true;
  if (fixture.expected.check_external_prior) {
    // Collect IDs of external factors in the INPUT (they should already have prior).
    const inputExternalIds = new Set(
      (fixture.graph.nodes ?? [])
        .filter((n) => n.kind === "factor" && n.category === "external")
        .map((n) => n.id)
    );
    // Check new external factors added in output (not in input).
    for (const n of nodes) {
      if (
        n.kind === "factor" &&
        n.category === "external" &&
        !inputExternalIds.has(n.id)
      ) {
        if (!n.prior) {
          external_prior_present = false;
          break;
        }
      }
    }
  }

  // -- 10. inbound_sum_valid ------------------------------------------------
  let inbound_sum_valid = true;
  const targetNode = fixture.expected.check_inbound_sum_node;
  if (targetNode) {
    const inboundMeans = edges
      .filter(
        (e) =>
          e.to === targetNode &&
          e.edge_type !== "bidirected" &&
          e.strength?.mean != null
      )
      .map((e) => Math.abs(e.strength.mean));
    const inboundSum = inboundMeans.reduce((a, b) => a + b, 0);
    if (inboundMeans.length > 0 && inboundSum > 1.0 + 1e-9) {
      inbound_sum_valid = false;
    }
  }

  // -- 11. no_json_comments -------------------------------------------------
  // Check the raw response text for any // or /* */ patterns.
  // We only check the portion that is the JSON object (after any leading whitespace).
  // A conservative check: presence of "//" or "/*" anywhere in the raw response.
  const no_json_comments =
    !fixture.expected.no_json_comments ||
    (!rawText.includes("//") && !rawText.includes("/*"));

  // -- Overall weighted score ------------------------------------------------
  const overall =
    (valid_json ? 0.15 : 0) +
    (correct_schema ? 0.10 : 0) +
    (violations_addressed ? 0.15 : 0) +
    (ids_preserved ? 0.10 : 0) +
    (forbidden_edges_removed ? 0.10 : 0) +
    (required_edges_present ? 0.10 : 0) +
    (no_bridge_edges ? 0.05 : 0) +
    (bidirected_preserved ? 0.05 : 0) +
    (external_prior_present ? 0.05 : 0) +
    (inbound_sum_valid ? 0.05 : 0) +
    (no_json_comments ? 0.10 : 0);

  return {
    valid_json,
    correct_schema,
    violations_addressed,
    ids_preserved,
    forbidden_edges_removed,
    required_edges_present,
    no_bridge_edges,
    bidirected_preserved,
    external_prior_present,
    inbound_sum_valid,
    no_json_comments,
    overall,
  };
}
