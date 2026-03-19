/**
 * Deterministic quality scoring for LLM-generated decision graphs.
 *
 * All scoring is deterministic — no LLM judge. Seven dimensions:
 * 1. Structural validity (pass/fail)
 * 2. Parameter quality (0–1)
 * 3. Option differentiation (0–1)
 * 4. Completeness (0–1)
 * 5. Constraint retention (0–1)
 * 6. Ratio encoding (0–1)
 * 7. External factor presence (0–1)
 * 8. Coaching quality (0–1)
 *
 * overall_score = param_quality(20%) + option_diff(20%) + completeness(20%)
 *               + constraint_retention(15%) + external_factor_presence(10%)
 *               + coaching_quality(10%) + ratio_encoding(5%)
 *
 * Only calculated when structural_valid === true.
 * Structurally invalid results appear in CSV with null overall_score but
 * populated violation_codes and per-dimension diagnostics where calculable.
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

  // Guard: skip edges with missing strength
  const validCausalEdges = causalEdges.filter((e) => e.strength?.mean != null && e.strength?.std != null);
  if (validCausalEdges.length === 0) return 0;

  // Strength diversity: distinct |mean| rounded to 1dp
  const distinctMeans = new Set(
    validCausalEdges.map((e) => Math.abs(e.strength.mean).toFixed(1))
  );
  const strengthDiv = Math.min(distinctMeans.size / 3, 1.0);

  // Exists_probability diversity: distinct values rounded to 1dp
  const distinctProbs = new Set(
    validCausalEdges.map((e) => (e.exists_probability ?? 1.0).toFixed(1))
  );
  const existsDiv = Math.min(distinctProbs.size / 2, 1.0);

  // Std variation: binary — 1.0 if std values are not all identical
  const stds = validCausalEdges.map((e) => e.strength.std);
  const stdVar = stds.every((s) => s === stds[0]) ? 0.0 : 1.0;

  // Default takeover: |mean|===0.5 AND std===0.125
  const defaultEdges = validCausalEdges.filter(
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

  // 0.25: Options are meaningfully differentiated (intervention distinctness).
  //
  // Evaluates distinctness without penalising valid shared-factor structures
  // (e.g. 4 CRM platforms all setting cost/onboarding/integration to
  // different values). Two complementary checks, best score wins:
  //
  // Check A (structural uniqueness): each option has ≥1 factor NOT shared
  //   by all others → 0.25
  //
  // Check B (intervention value spread): measures pairwise intervention
  //   distinctness across all option pairs. Each pair must differ on ≥1
  //   shared factor's value OR on their factor set membership.
  //   Score = proportion of distinct pairs.
  //   This correctly awards full marks when options act on the same levers
  //   with different magnitudes — the fix for the v183 benchmark bug.
  const factorSets = options.map(
    (o) => new Set(Object.keys(o.data?.interventions ?? {}))
  );

  // Find the intersection of all factor sets (factors set by every option)
  const intersection = factorSets.reduce<Set<string>>(
    (acc, set) => new Set([...acc].filter((f) => set.has(f))),
    factorSets[0] ?? new Set()
  );

  // Check A: structural uniqueness
  const allHaveUniqueFactor = factorSets.every((set) => {
    for (const f of set) {
      if (!intersection.has(f)) return true;
    }
    return false;
  });

  // Check B: pairwise intervention distinctness
  // For every pair of options, at least one shared factor must have a
  // different intervention value, OR their factor sets must differ.
  const interventionMaps = options.map(
    (o) => o.data?.interventions ?? {}
  );

  // Collect all factors across all options (union)
  const allFactors = new Set<string>();
  for (const set of factorSets) {
    for (const f of set) allFactors.add(f);
  }

  let distinctPairs = 0;
  let totalPairs = 0;
  for (let i = 0; i < options.length; i++) {
    for (let j = i + 1; j < options.length; j++) {
      totalPairs++;
      // Check if this pair differs on at least one factor they both set
      const sharedFactors = [...allFactors].filter(
        (f) => f in interventionMaps[i] && f in interventionMaps[j]
      );
      const hasDifference = sharedFactors.some(
        (f) => interventionMaps[i][f] !== interventionMaps[j][f]
      );
      // Also count as distinct if they set different factor sets
      const setsDiffer = factorSets[i].size !== factorSets[j].size ||
        [...factorSets[i]].some((f) => !factorSets[j].has(f));

      if (hasDifference || setsDiffer) distinctPairs++;
    }
  }

  const pairwiseScore = totalPairs > 0 ? distinctPairs / totalPairs : 0;

  // Award the best of the two checks
  if (allHaveUniqueFactor) {
    score += 0.25;
  } else {
    score += pairwiseScore * 0.25;
  }

  return score;
}

// =============================================================================
// Currency detection & preservation scoring
// =============================================================================

/** Currency symbols/codes detected in brief text. */
const CURRENCY_PATTERNS: Array<{ symbol: string; regex: RegExp }> = [
  { symbol: "£", regex: /£/ },
  { symbol: "$", regex: /\$/ },
  { symbol: "€", regex: /€/ },
  { symbol: "GBP", regex: /\bGBP\b/i },
  { symbol: "USD", regex: /\bUSD\b/i },
  { symbol: "EUR", regex: /\bEUR\b/i },
];

function detectBriefCurrency(briefBody: string): string | null {
  for (const { symbol, regex } of CURRENCY_PATTERNS) {
    if (regex.test(briefBody)) return symbol;
  }
  return null;
}

function scoreCurrencyPreservation(graph: ParsedGraph, briefBody: string): number | null {
  const briefCurrency = detectBriefCurrency(briefBody);
  if (!briefCurrency) return null;

  const normalised = new Set<string>();
  normalised.add(briefCurrency.toLowerCase());
  if (briefCurrency === "£" || briefCurrency.toUpperCase() === "GBP") {
    normalised.add("£"); normalised.add("gbp");
  }
  if (briefCurrency === "$" || briefCurrency.toUpperCase() === "USD") {
    normalised.add("$"); normalised.add("usd");
  }
  if (briefCurrency === "€" || briefCurrency.toUpperCase() === "EUR") {
    normalised.add("€"); normalised.add("eur");
  }

  const goalNode = graph.nodes.find((n) => n.kind === "goal");
  const goalUnit = goalNode?.goal_threshold_unit?.toLowerCase() ?? goalNode?.data?.unit?.toLowerCase();
  if (goalUnit && normalised.has(goalUnit)) return 1.0;

  let hasAnyUnit = false;
  let hasMatchingUnit = false;
  for (const node of graph.nodes) {
    const unit = node.data?.unit?.toLowerCase();
    if (unit) {
      hasAnyUnit = true;
      if (normalised.has(unit)) { hasMatchingUnit = true; break; }
    }
  }

  if (hasMatchingUnit) return 1.0;
  if (hasAnyUnit) return 0.5;
  return 0.0;
}

// =============================================================================
// Dimension 4: Completeness
// =============================================================================

function scoreCompleteness(graph: ParsedGraph, brief: Brief): number {
  let score = 0;

  const factors = graph.nodes.filter((n) => n.kind === "factor");
  const goalNode = graph.nodes.find((n) => n.kind === "goal");

  // 0.15: Has ≥1 external factor
  const hasExternal = factors.some((f) => f.category === "external");
  if (hasExternal) score += 0.15;

  // 0.15: Coaching array is non-empty
  const coachingItems = graph.coaching?.strengthen_items ?? [];
  const hasCoaching =
    coachingItems.length > 0 ||
    (graph.coaching?.summary?.trim().length ?? 0) > 0;
  if (hasCoaching) score += 0.15;

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

  // 0.10: Currency preservation — when brief mentions currency, graph should
  // preserve it in node unit metadata (goal_threshold_unit, data.unit).
  const currencyScore = scoreCurrencyPreservation(graph, brief.body);
  if (currencyScore === null) {
    score += 0.10; // Not applicable — full marks for this sub-dimension
  } else {
    score += currencyScore * 0.10;
  }

  return score;
}

// =============================================================================
// Dimension 5: Constraint retention
// =============================================================================

/**
 * Check whether every explicit numeric constraint in the brief appears in
 * the graph's goal_constraints[] array.
 *
 * Each expected_constraint in the brief metadata specifies:
 *   - keyword: case-insensitive substring to match against constraint label or node_id
 *   - operator: exact match on <= or >=
 *   - value: within ±0.02 numeric tolerance
 *   - can_exceed_one (optional): if true, verify value >= 1.0 (ratio scale, not 0-1)
 *
 * Score: proportion of expected constraints found. Returns 1.0 when no
 * expected_constraints are specified (not applicable).
 */
function scoreConstraintRetention(graph: ParsedGraph, brief: Brief): number {
  const expected = brief.meta.expected_constraints;
  if (!expected || expected.length === 0) return 1.0;

  const constraints = graph.goal_constraints ?? [];

  let matched = 0;

  for (const exp of expected) {
    const keyword = exp.keyword.toLowerCase();
    const operator = exp.operator;
    const expectedValue = exp.value;
    const mustExceedOne = exp.can_exceed_one === true;

    const found = constraints.some((gc) => {
      // Keyword match: label or node_id
      const labelMatch = (gc.label ?? "").toLowerCase().includes(keyword);
      const nodeIdMatch = (gc.node_id ?? "").toLowerCase().includes(keyword);
      if (!labelMatch && !nodeIdMatch) return false;

      // Operator match
      if (gc.operator !== operator) return false;

      // Value match within ±0.02 tolerance
      if (gc.value == null) return false;
      if (Math.abs(gc.value - expectedValue) > 0.02) return false;

      // Ratio scale check: if can_exceed_one, value must be >= 1.0
      if (mustExceedOne && gc.value < 1.0) return false;

      return true;
    });

    if (found) matched++;
  }

  return expected.length > 0 ? matched / expected.length : 1.0;
}

// =============================================================================
// Dimension 6: Ratio encoding
// =============================================================================

/**
 * Check whether ratio metrics that can exceed 100% (e.g. NRR, growth rate,
 * ROI) are encoded correctly — i.e. as raw ratios (>= 1.0 for 100%+) rather
 * than incorrectly normalised to 0-1.
 *
 * Each ratio_metrics entry in the brief metadata specifies:
 *   - keyword: case-insensitive substring to match against node labels
 *   - expected_min: the minimum plausible value when correctly encoded
 *     (e.g. 1.0 means the value should be >= 1.0 for a 100%+ metric)
 *
 * Scans all nodes and goal_constraints for matching keywords.
 * Score: 1.0 if no encoding errors found, 0.0 if any found.
 * Returns 1.0 when no ratio_metrics are specified (not applicable).
 */
function scoreRatioEncoding(graph: ParsedGraph, brief: Brief): number {
  const ratioMetrics = brief.meta.ratio_metrics;
  if (!ratioMetrics || ratioMetrics.length === 0) return 1.0;

  for (const metric of ratioMetrics) {
    const keyword = metric.keyword.toLowerCase();
    const expectedMin = metric.expected_min;

    // Check nodes
    for (const node of graph.nodes) {
      const label = (node.label ?? "").toLowerCase();
      if (!label.includes(keyword)) continue;

      // Check node data values
      const val = node.data?.value;
      if (val != null && val < expectedMin) return 0.0;

      // Check goal threshold
      if (node.kind === "goal" && node.goal_threshold != null) {
        if (node.goal_threshold < expectedMin) return 0.0;
      }
    }

    // Check goal_constraints
    for (const gc of graph.goal_constraints ?? []) {
      const label = (gc.label ?? "").toLowerCase();
      const nodeId = (gc.node_id ?? "").toLowerCase();
      if (!label.includes(keyword) && !nodeId.includes(keyword)) continue;

      if (gc.value != null && gc.value < expectedMin) return 0.0;
    }
  }

  return 1.0;
}

// =============================================================================
// Dimension 7: External factor presence
// =============================================================================

/**
 * Check whether graphs for strategic/market-facing briefs include at least
 * one external factor.
 *
 * Brief metadata field: expect_external_factor (boolean)
 * Score: 1.0 if external factor present when expected (or not expected),
 *        0.0 if expected but missing.
 */
function scoreExternalFactorPresence(graph: ParsedGraph, brief: Brief): number {
  // If the brief doesn't signal expectation, fall back to completeness logic
  // (existing 0.15 sub-dimension in completeness still applies separately).
  // Here we score 1.0 unless the brief explicitly says expect_external_factor=true.
  if (!brief.meta.expect_external_factor) return 1.0;

  const hasExternal = graph.nodes.some(
    (n) => n.kind === "factor" && n.category === "external"
  );
  return hasExternal ? 1.0 : 0.0;
}

// =============================================================================
// Dimension 8: Coaching quality
// =============================================================================

/**
 * Check coaching summary references actual graph node labels and that
 * strengthen_items are present and well-formed.
 *
 * Sub-scores (0.25 each):
 * 1. coaching.summary exists and is non-empty
 * 2. coaching.summary contains ≥2 node labels as substrings (case-insensitive)
 * 3. coaching.strengthen_items is an array (may be empty — 0-4 items is valid)
 * 4. All items have a valid action_type
 */
const ALLOWED_ACTION_TYPES = new Set([
  "add_option",
  "add_constraint",
  "add_risk",
  "reframe_goal",
]);

function scoreCoachingQuality(graph: ParsedGraph): number {
  let score = 0;

  const coaching = graph.coaching;
  if (!coaching) return 0;

  // 0.25: summary exists and is non-empty
  const summary = coaching.summary?.trim() ?? "";
  if (summary.length > 0) score += 0.25;

  // 0.25: summary contains ≥2 node labels as substrings
  if (summary.length > 0) {
    const summaryLower = summary.toLowerCase();
    const nodeLabels = graph.nodes
      .map((n) => (n.label ?? "").toLowerCase().trim())
      .filter((l) => l.length >= 4); // Skip very short labels to avoid false positives

    const matchCount = nodeLabels.filter((label) => summaryLower.includes(label)).length;
    if (matchCount >= 2) score += 0.25;
  }

  // 0.25: strengthen_items is present (array, even if empty)
  const items = coaching.strengthen_items;
  if (Array.isArray(items)) score += 0.25;

  // 0.25: all items have valid action_type (skip if empty array)
  if (Array.isArray(items)) {
    if (items.length === 0) {
      // Empty is valid — full marks for this sub-dimension
      score += 0.25;
    } else if (items.length <= 4) {
      const allWellFormed = items.every(
        (item) => item.action_type && ALLOWED_ACTION_TYPES.has(item.action_type)
      );
      if (allWellFormed) score += 0.25;
    }
    // >4 items: 0 for this sub-dimension (spec requires 0–4)
  }

  return score;
}

// =============================================================================
// Main scoring entry point
// =============================================================================

/**
 * Score a single LLM response against its brief.
 * Returns all scoring dimensions plus the overall composite score.
 *
 * Structurally invalid results return null overall_score but still include
 * populated violation_codes and per-dimension scores where calculable.
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
      constraint_retention: null,
      ratio_encoding: null,
      external_factor_presence: null,
      coaching_quality: null,
      overall_score: null,
      node_count: nodeCount,
      edge_count: edgeCount,
    };
  }

  const graph = response.parsed_graph;

  // Structural validity check
  const { valid, violations } = validateStructural(graph);

  // Compute all dimensions regardless of structural validity for diagnostics.
  // Dimensions that require a valid graph structure will still run — the
  // structural validator catches topology errors; dimension scorers are
  // independent quality metrics.
  const paramQuality = scoreParameterQuality(graph);
  const optionDiff = scoreOptionDifferentiation(graph, brief);
  const completeness = scoreCompleteness(graph, brief);
  const constraintRetention = scoreConstraintRetention(graph, brief);
  const ratioEncoding = scoreRatioEncoding(graph, brief);
  const externalFactorPresence = scoreExternalFactorPresence(graph, brief);
  const coachingQuality = scoreCoachingQuality(graph);

  // If structurally invalid, overall_score is null per spec.
  // All per-dimension scores are still returned for diagnostics.
  if (!valid) {
    return {
      structural_valid: false,
      violation_codes: violations,
      param_quality: paramQuality,
      option_diff: optionDiff,
      completeness: completeness,
      constraint_retention: constraintRetention,
      ratio_encoding: ratioEncoding,
      external_factor_presence: externalFactorPresence,
      coaching_quality: coachingQuality,
      overall_score: null,
      node_count: nodeCount,
      edge_count: edgeCount,
    };
  }

  // Composite score with new 7-dimension weighting
  const overallScore =
    paramQuality * 0.20 +
    optionDiff * 0.20 +
    completeness * 0.20 +
    constraintRetention * 0.15 +
    externalFactorPresence * 0.10 +
    coachingQuality * 0.10 +
    ratioEncoding * 0.05;

  return {
    structural_valid: true,
    violation_codes: [],
    param_quality: paramQuality,
    option_diff: optionDiff,
    completeness: completeness,
    constraint_retention: constraintRetention,
    ratio_encoding: ratioEncoding,
    external_factor_presence: externalFactorPresence,
    coaching_quality: coachingQuality,
    overall_score: overallScore,
    node_count: nodeCount,
    edge_count: edgeCount,
  };
}
