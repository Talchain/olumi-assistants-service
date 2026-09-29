/**
 * Deterministic scorer for validate_graph LLM responses.
 *
 * Nine dimensions:
 * 1.  valid_json              (0.15) - response parses as JSON with edges[] and model_notes[]
 * 2.  edge_coverage           (0.15) - every in-scope input edge has exactly one output edge (no omissions, no additions)
 * 3.  budget_constraint       (0.15) - for every target node: sum of |mean| across inbound edges <= 1.0
 * 4.  uncertainty_constraint  (0.10) - every edge: std <= |mean|
 * 5.  basis_consistency       (0.15) - weak_guess: ep<=0.75, std>=0.15, needs_user_input=true; domain_prior: ep<=0.95
 * 6.  no_zero_means           (0.05) - no edge with mean exactly 0.00
 * 7.  differentiation         (0.10) - >=3 distinct |mean| values, >=2 distinct exists_probability values
 * 8.  edge_ordering           (0.05) - output edges in same relative order as in-scope input edges
 * 9.  precision               (0.10) - all mean, std, exists_probability values have <=2 decimal places
 */

import type { ValidateGraphFixture, ValidateGraphScore } from "./types.js";

// =============================================================================
// Helpers
// =============================================================================

interface OutputEdge {
  from: string;
  to: string;
  strength: { mean: number; std: number };
  exists_probability: number;
  reasoning?: string;
  basis?: string;
  needs_user_input?: boolean;
  scaling_applied?: boolean;
}

function edgeKey(from: string, to: string): string {
  return `${from}->${to}`;
}

/** Check if a number has at most 2 decimal places. */
function hasAtMost2Decimals(n: number): boolean {
  // Multiply by 100, round, and check if equal
  return Math.abs(Math.round(n * 100) - n * 100) < 1e-6;
}

// =============================================================================
// Main scorer
// =============================================================================

export function scoreValidateGraph(
  fixture: ValidateGraphFixture,
  parsed: Record<string, unknown> | null,
): ValidateGraphScore {
  const nullScore: ValidateGraphScore = {
    valid_json: false,
    edge_coverage: false,
    budget_constraint: false,
    uncertainty_constraint: false,
    basis_consistency: false,
    no_zero_means: false,
    differentiation: false,
    edge_ordering: false,
    precision: false,
    overall: 0,
  };

  // -- 1. valid_json ----------------------------------------------------------
  if (!parsed) return nullScore;
  const edges = parsed.edges as OutputEdge[] | undefined;
  const modelNotes = parsed.model_notes;
  if (!Array.isArray(edges) || !Array.isArray(modelNotes)) return nullScore;
  const valid_json = true;

  // -- 2. edge_coverage -------------------------------------------------------
  const expectedEdges = fixture.expected.in_scope_edges;
  const expectedKeys = new Set(expectedEdges.map((e) => edgeKey(e.from, e.to)));
  const outputKeys = new Set(edges.map((e) => edgeKey(e.from, e.to)));

  // Every expected edge must appear in output and no extra edges
  const allExpectedPresent = [...expectedKeys].every((k) => outputKeys.has(k));
  const noExtras = [...outputKeys].every((k) => expectedKeys.has(k));
  const edge_coverage = allExpectedPresent && noExtras && edges.length === expectedEdges.length;

  // -- 3. budget_constraint ---------------------------------------------------
  // For every target node EXCEPT goal nodes, sum of |mean| across inbound edges must be <= 1.0.
  // Goal nodes are exempt because they receive bridge edges from multiple outcomes/risks.
  const goalNodeIds = new Set(
    (fixture.graph.nodes ?? [])
      .filter((n) => n.kind === "goal")
      .map((n) => n.id),
  );
  const inboundSums = new Map<string, number>();
  for (const edge of edges) {
    const mean = edge.strength?.mean;
    if (mean == null) continue;
    const current = inboundSums.get(edge.to) ?? 0;
    inboundSums.set(edge.to, current + Math.abs(mean));
  }
  let budget_constraint = true;
  for (const [nodeId, sum] of inboundSums) {
    if (goalNodeIds.has(nodeId)) continue; // goal nodes exempt
    if (sum > 1.0 + 1e-9) {
      budget_constraint = false;
      break;
    }
  }

  // -- 4. uncertainty_constraint ----------------------------------------------
  // Every edge: std <= |mean|
  let uncertainty_constraint = true;
  for (const edge of edges) {
    const mean = edge.strength?.mean;
    const std = edge.strength?.std;
    if (mean == null || std == null) {
      uncertainty_constraint = false;
      break;
    }
    if (std > Math.abs(mean) + 1e-9) {
      uncertainty_constraint = false;
      break;
    }
  }

  // -- 5. basis_consistency ---------------------------------------------------
  let basis_consistency = true;
  for (const edge of edges) {
    const basis = edge.basis;
    const ep = edge.exists_probability;
    const std = edge.strength?.std;
    const nui = edge.needs_user_input;

    if (basis === "weak_guess") {
      if (ep > 0.75 + 1e-9 || (std != null && std < 0.15 - 1e-9) || nui !== true) {
        basis_consistency = false;
        break;
      }
    }
    if (basis === "domain_prior") {
      if (ep > 0.95 + 1e-9) {
        basis_consistency = false;
        break;
      }
    }
    // basis field must be one of the valid values
    if (
      basis !== "brief_explicit" &&
      basis !== "structural_inference" &&
      basis !== "domain_prior" &&
      basis !== "weak_guess"
    ) {
      basis_consistency = false;
      break;
    }
  }

  // -- 6. no_zero_means -------------------------------------------------------
  let no_zero_means = true;
  for (const edge of edges) {
    const mean = edge.strength?.mean;
    if (mean != null && Math.abs(mean) < 1e-9) {
      no_zero_means = false;
      break;
    }
  }

  // -- 7. differentiation -----------------------------------------------------
  const distinctMeans = new Set(edges.map((e) => Math.round(Math.abs(e.strength?.mean ?? 0) * 100)));
  const distinctEps = new Set(edges.map((e) => Math.round((e.exists_probability ?? 0) * 100)));
  const differentiation = distinctMeans.size >= 3 && distinctEps.size >= 2;

  // -- 8. edge_ordering -------------------------------------------------------
  // Output edges should be in same relative order as in-scope input edges
  let edge_ordering = true;
  if (edge_coverage) {
    // Build the expected order from fixture's in_scope_edges
    const expectedOrder = expectedEdges.map((e) => edgeKey(e.from, e.to));
    const outputOrder = edges.map((e) => edgeKey(e.from, e.to));

    // Check that the output is in the same relative order
    let oi = 0;
    for (const ek of expectedOrder) {
      // Find this key in output starting from oi
      const idx = outputOrder.indexOf(ek, oi);
      if (idx === -1) {
        edge_ordering = false;
        break;
      }
      oi = idx + 1;
    }
  } else {
    // If edge_coverage failed, ordering is N/A — don't penalize twice
    edge_ordering = true;
  }

  // -- 9. precision -----------------------------------------------------------
  let precision = true;
  for (const edge of edges) {
    const mean = edge.strength?.mean;
    const std = edge.strength?.std;
    const ep = edge.exists_probability;
    if (mean != null && !hasAtMost2Decimals(mean)) {
      precision = false;
      break;
    }
    if (std != null && !hasAtMost2Decimals(std)) {
      precision = false;
      break;
    }
    if (ep != null && !hasAtMost2Decimals(ep)) {
      precision = false;
      break;
    }
  }

  // -- Overall weighted score -------------------------------------------------
  const overall =
    (valid_json ? 0.15 : 0) +
    (edge_coverage ? 0.15 : 0) +
    (budget_constraint ? 0.15 : 0) +
    (uncertainty_constraint ? 0.10 : 0) +
    (basis_consistency ? 0.15 : 0) +
    (no_zero_means ? 0.05 : 0) +
    (differentiation ? 0.10 : 0) +
    (edge_ordering ? 0.05 : 0) +
    (precision ? 0.10 : 0);

  return {
    valid_json,
    edge_coverage,
    budget_constraint,
    uncertainty_constraint,
    basis_consistency,
    no_zero_means,
    differentiation,
    edge_ordering,
    precision,
    overall,
  };
}
