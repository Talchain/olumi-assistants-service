/**
 * Deterministic quality scoring for LLM-generated decision graphs.
 *
 * All scoring is deterministic — no LLM judge. Five dimensions:
 * 1. Structural validity (pass/fail)
 * 2. Parameter quality (0–1)
 * 3. Option differentiation (0–1)
 * 4. Completeness (0–1)
 * 5. Efficiency metrics (not scored — reported only)
 *
 * overall_score = param_quality(30%) + option_diff(30%) + completeness(40%)
 * Only calculated when structural_valid === true.
 */

import type { LLMResponse, ParsedGraph, GraphNode, GraphEdge, Brief, ScoreResult } from "./types.js";
import {
  validateStructural,
  buildNodeMap,
  buildInterventionSignature,
} from "./validator.js";

// =============================================================================
// Generic factor label blocklist
// =============================================================================

const GENERIC_FACTOR_LABELS = new Set([
  "market risk",
  "competition",
  "cost",
  "revenue",
  "growth",
  "risk",
  "demand",
  "supply",
]);

// =============================================================================
// Edge classification helpers
// =============================================================================

/**
 * Returns true if an edge is structural.
 * Structural edges connect decision→option or option→factor.
 * Classification is by node kinds — NOT by strength values.
 */
function isStructuralEdge(
  edge: GraphEdge,
  nodeMap: ReturnType<typeof buildNodeMap>
): boolean {
  const fromNode = nodeMap.byId.get(edge.from);
  const toNode = nodeMap.byId.get(edge.to);
  if (!fromNode || !toNode) return false;

  return (
    (fromNode.kind === "decision" && toNode.kind === "option") ||
    (fromNode.kind === "option" && toNode.kind === "factor")
  );
}

/**
 * Returns true if an edge is a causal directed edge.
 * Excludes: structural edges, bidirected edges.
 */
function isCausalEdge(
  edge: GraphEdge,
  nodeMap: ReturnType<typeof buildNodeMap>
): boolean {
  if (edge.edge_type === "bidirected") return false;
  return !isStructuralEdge(edge, nodeMap);
}

// =============================================================================
// Dimension 2: Parameter quality
// =============================================================================

function scoreParameterQuality(graph: ParsedGraph): number {
  const nodeMap = buildNodeMap(graph.nodes);
  const causalEdges = graph.edges.filter((e) => isCausalEdge(e, nodeMap));

  if (causalEdges.length === 0) return 0;

  // Strength diversity: distinct |mean| rounded to 1dp
  const distinctMeans = new Set(
    causalEdges.map((e) => Math.abs(e.strength.mean).toFixed(1))
  );
  const strengthDiv = Math.min(distinctMeans.size / 3, 1.0);

  // Exists_probability diversity: distinct values rounded to 1dp
  const distinctProbs = new Set(
    causalEdges.map((e) => e.exists_probability.toFixed(1))
  );
  const existsDiv = Math.min(distinctProbs.size / 2, 1.0);

  // Std variation: binary — 1.0 if std values are not all identical
  const stds = causalEdges.map((e) => e.strength.std);
  const stdVar = stds.every((s) => s === stds[0]) ? 0.0 : 1.0;

  // Default takeover: |mean|===0.5 AND std===0.125
  const defaultEdges = causalEdges.filter(
    (e) => Math.abs(e.strength.mean) === 0.5 && e.strength.std === 0.125
  );
  const defaultPct = (defaultEdges.length / causalEdges.length) * 100;
  const defaultScore = Math.max(1.0 - defaultPct / 50, 0);

  // Range discipline: for outcome/risk/goal nodes, Σ|inbound mean| ≤ 1.0
  const targetKinds = new Set(["outcome", "risk", "goal"]);
  const targetNodes = graph.nodes.filter((n) => targetKinds.has(n.kind));

  let rangeScore = 0;
  if (targetNodes.length === 0) {
    rangeScore = 0;
  } else {
    let satisfying = 0;
    for (const node of targetNodes) {
      const inbound = causalEdges.filter((e) => e.to === node.id);
      const sum = inbound.reduce(
        (acc, e) => acc + Math.abs(e.strength.mean),
        0
      );
      if (sum <= 1.0) satisfying++;
    }
    rangeScore = satisfying / targetNodes.length;
  }

  return (
    strengthDiv * 0.25 +
    existsDiv * 0.20 +
    stdVar * 0.15 +
    defaultScore * 0.25 +
    rangeScore * 0.15
  );
}

// =============================================================================
// Dimension 3: Option differentiation
// =============================================================================

function scoreOptionDifferentiation(graph: ParsedGraph, brief: Brief): number {
  const options = graph.nodes.filter((n) => n.kind === "option");

  if (options.length === 0) return 0;

  let score = 0;

  // 0.25: Status quo present when expected
  if (brief.meta.expect_status_quo) {
    const hasStatusQuo = options.some((o) =>
      /status[\s_-]?quo|baseline|keep|maintain|do\s+nothing/i.test(o.label ?? "")
    );
    if (hasStatusQuo) score += 0.25;
  } else {
    // Not required — full marks for this sub-dimension
    score += 0.25;
  }

  // 0.25: No two options have identical intervention maps
  const sigs = options.map((o) =>
    buildInterventionSignature(o.data?.interventions ?? {})
  );
  const uniqueSigs = new Set(sigs);
  if (uniqueSigs.size === sigs.length) score += 0.25;

  // 0.25: Each option sets ≥1 controllable factor (non-empty interventions)
  const allSetFactors = options.every(
    (o) => Object.keys(o.data?.interventions ?? {}).length > 0
  );
  if (allSetFactors) score += 0.25;

  // 0.25: Each option affects at least one unique controllable factor that
  // is NOT set by ALL other options — i.e., options don't all touch exactly
  // the same factor set.
  const factorSets = options.map(
    (o) => new Set(Object.keys(o.data?.interventions ?? {}))
  );

  // Find the intersection of all factor sets (factors set by every option)
  const intersection = factorSets.reduce<Set<string>>(
    (acc, set) => new Set([...acc].filter((f) => set.has(f))),
    factorSets[0] ?? new Set()
  );

  // Each option must have at least one factor NOT in the intersection
  // (i.e., a factor unique to this option's path or combination)
  const allHaveUnique = factorSets.every((set) => {
    for (const f of set) {
      if (!intersection.has(f)) return true;
    }
    return false;
  });

  if (allHaveUnique) score += 0.25;

  return score;
}

// =============================================================================
// Dimension 4: Completeness
// =============================================================================

function scoreCompleteness(graph: ParsedGraph, brief: Brief): number {
  let score = 0;

  const factors = graph.nodes.filter((n) => n.kind === "factor");
  const goalNode = graph.nodes.find((n) => n.kind === "goal");

  // 0.20: Has ≥1 external factor
  const hasExternal = factors.some((f) => f.category === "external");
  if (hasExternal) score += 0.20;

  // 0.20: Coaching array is non-empty
  const coachingItems = graph.coaching?.strengthen_items ?? [];
  const hasCoaching =
    coachingItems.length > 0 ||
    (graph.coaching?.summary?.trim().length ?? 0) > 0;
  if (hasCoaching) score += 0.20;

  // 0.20: Goal threshold extracted when brief has numeric target
  if (!brief.meta.has_numeric_target) {
    score += 0.20; // Not required — full marks
  } else {
    if (goalNode?.goal_threshold != null) score += 0.20;
  }

  // 0.20: Factor label specificity (not in generic blocklist)
  if (factors.length === 0) {
    // No factors → no label score
  } else {
    const genericCount = factors.filter((f) =>
      GENERIC_FACTOR_LABELS.has((f.label ?? "").toLowerCase().trim())
    ).length;
    const labelScore = 1 - genericCount / factors.length;
    score += labelScore * 0.20;
  }

  // 0.20: Readability band
  const nodeCount = graph.nodes.length;
  if (nodeCount >= 6 && nodeCount <= 12) {
    score += 0.20;
  } else if (nodeCount >= 13 && nodeCount <= 20) {
    score += 0.10;
  }
  // >20 nodes = 0 points for readability

  return score;
}

// =============================================================================
// Main scoring entry point
// =============================================================================

/**
 * Score a single LLM response against its brief.
 * Returns all scoring dimensions plus the overall composite score.
 */
export function score(response: LLMResponse, brief: Brief): ScoreResult {
  const nodeCount = response.parsed_graph?.nodes.length ?? 0;
  const edgeCount = response.parsed_graph?.edges.length ?? 0;

  // No parsed graph — all scores null
  if (response.status !== "success" || !response.parsed_graph) {
    return {
      structural_valid: false,
      violation_codes: ["NO_GRAPH"],
      param_quality: null,
      option_diff: null,
      completeness: null,
      overall_score: null,
      node_count: nodeCount,
      edge_count: edgeCount,
    };
  }

  const graph = response.parsed_graph;

  // Structural validity check
  const { valid, violations } = validateStructural(graph);

  // If structurally invalid, scores are null per spec
  if (!valid) {
    return {
      structural_valid: false,
      violation_codes: violations,
      param_quality: null,
      option_diff: null,
      completeness: null,
      overall_score: null,
      node_count: nodeCount,
      edge_count: edgeCount,
    };
  }

  // Score each dimension
  const paramQuality = scoreParameterQuality(graph);
  const optionDiff = scoreOptionDifferentiation(graph, brief);
  const completeness = scoreCompleteness(graph, brief);

  // Composite score: param_quality(30%) + option_diff(30%) + completeness(40%)
  const overallScore =
    paramQuality * 0.30 + optionDiff * 0.30 + completeness * 0.40;

  return {
    structural_valid: true,
    violation_codes: [],
    param_quality: paramQuality,
    option_diff: optionDiff,
    completeness: completeness,
    overall_score: overallScore,
    node_count: nodeCount,
    edge_count: edgeCount,
  };
}
