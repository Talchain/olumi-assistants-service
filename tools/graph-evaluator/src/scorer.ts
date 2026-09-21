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

import type {
  LLMResponse,
  ParsedGraph,
  GraphEdge,
  GraphNode,
  GoalConstraint,
  Brief,
  ScoreResult,
} from "./types.js";
import {
  validateStructural,
  buildNodeMap,
  buildInterventionSignature,
} from "./validator.js";
import {
  classifyProvenance,
  findLaunderedNumbers,
  locateExpectedUserValues,
  readInterventions,
} from "./trust-gates.js";

// =============================================================================
// Rubric version
// =============================================================================

/**
 * Identifier for the SCORING RUBRIC — distinct from the tool version in cli.ts.
 * Stamped onto every ScoreResult and emitted as a column in scores.csv.
 *
 * ⚠ SCORES CARRYING DIFFERENT RUBRIC VERSIONS ARE DIFFERENT MEASURES. Never
 * plot, average, or regression-check them as one series. See the Rubric
 * changelog in README.md.
 *
 * `draft-graph-rubric-2.0.0` (2026-08-02, ROADMAP 2.285a) — the rubric scores
 * ONLY fields the model is PERMITTED to emit. PR #789 cut the goal-threshold
 * quad from the sent grammar and added an ingress strip, so the model can no
 * longer author `goal_threshold*`; the enricher mints it after extraction.
 * Rubric 1 rewarded that quad, which post-#789 made a sub-dimension unearnable
 * on every numeric-target brief and gave enricher output a score advantage no
 * model draft could close.
 *
 * ⚠ Rubric 2 is NOT a bug-fix that restores the old numbers. It asks partly
 * different questions (see scoreNumericTargetCapture). Old and new scores are
 * DIFFERENT MEASURES.
 *
 * `draft-graph-rubric-1` — everything before this commit. Results predating
 * this constant carry NO rubric_version column; treat an absent column as
 * rubric 1 and do not compare it with rubric 2.
 */
/**
 * `draft-graph-rubric-2.1.0` (2026-09-21, WP1 — freeze the evaluation contract).
 *
 * ⚠ RUBRIC 2.1 IS A DIFFERENT MEASURE FROM 2.0, not a bug-fix of it. Five
 * dimensions were added and `coaching_quality` went to WEIGHT ZERO. Never plot,
 * average or regression-check 2.0 and 2.1 numbers as one series.
 *
 * WEIGHTS (sum asserted == 1.0 by tests/scorer.test.ts):
 *
 *   param_quality               0.20   unchanged
 *   option_diff                 0.20   unchanged
 *   completeness                0.20   unchanged
 *   constraint_retention        0.15   unchanged
 *   external_factor_presence    0.10   unchanged
 *   ratio_encoding              0.05   unchanged
 *   coaching_quality            0.00   was 0.10 — the whole 0.10 was reallocated
 *   numeric_provenance          0.05   NEW
 *   decision_enrichment         0.02   NEW
 *   controllability             0.01   NEW
 *   temporal_preservation       0.01   NEW
 *   qualitative_preservation    0.01   NEW
 *
 * WHY THE SPLIT IS SHAPED THIS WAY, stated so it can be argued with:
 *   - `numeric_provenance` takes half the reallocated weight because all four
 *     banked CEE failures are provenance failures — it is the dimension the arms
 *     exist to discriminate on, and it is the only one that is TWO-SIDED (you
 *     cannot win by dropping numbers, nor by stamping everything `user`).
 *   - `decision_enrichment` is the hypothesis Arms C/D test, but its
 *     deterministic part is a FLOOR check that saturates (see below), so it
 *     carries little weight; richness ranking is the blind judge's job.
 *   - `controllability` is near-binary and the structural validator already
 *     covers most of the topology, so it discriminates rarely.
 *   - the two preservation dimensions are NA on most briefs and score 1.0 when
 *     NA; weighting them heavily would move scores for briefs that declare
 *     nothing.
 *   - `coaching_quality` keeps being COMPUTED and REPORTED (continuity with 2.0
 *     and with the governed pack's diagnostics) but no longer moves `overall`:
 *     draft coaching is a separate surface with its own evaluator, and its 0.10
 *     was the only weight available without changing a dimension the plan froze.
 *
 * `draft-graph-rubric-2.0.0` (2026-08-02, ROADMAP 2.285a) — the rubric scores
 * ONLY fields the model is PERMITTED to emit. PR #789 cut the goal-threshold
 * quad from the sent grammar and added an ingress strip, so the model can no
 * longer author `goal_threshold*`; the enricher mints it after extraction.
 * Rubric 1 rewarded that quad, which post-#789 made a sub-dimension unearnable
 * on every numeric-target brief and gave enricher output a score advantage no
 * model draft could close. Every 2.1 dimension honours the same rule.
 *
 * `draft-graph-rubric-1` — everything before that. Results predating the
 * constant carry NO rubric_version column; treat an absent column as rubric 1.
 */
export const DRAFT_RUBRIC_VERSION = "draft-graph-rubric-2.1.0";

/** The weight vector, exported so a test can assert it sums to 1.0. */
export const RUBRIC_WEIGHTS = {
  param_quality: 0.20,
  option_diff: 0.20,
  completeness: 0.20,
  constraint_retention: 0.15,
  external_factor_presence: 0.10,
  ratio_encoding: 0.05,
  coaching_quality: 0.00,
  numeric_provenance: 0.05,
  decision_enrichment: 0.02,
  controllability: 0.01,
  temporal_preservation: 0.01,
  qualitative_preservation: 0.01,
} as const;

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

  // ⚠ RUBRIC 2: `goal_threshold_unit` is DELIBERATELY NOT CONSULTED. Rubric 1
  // preferred it ahead of every other channel, but post-#789 the model cannot
  // emit it — so that preference rewarded a field only the enricher can mint,
  // handing pipeline output a currency score no model draft could match.
  // Model-permitted channels only, in preference order:
  //   goal-node data.unit → goal_constraints[].unit → any node's data.unit.
  const goalNode = graph.nodes.find((n) => n.kind === "goal");
  const goalUnit = goalNode?.data?.unit?.toLowerCase();
  if (goalUnit && normalised.has(goalUnit)) return 1.0;

  let hasAnyUnit = Boolean(goalUnit);

  for (const gc of graph.goal_constraints ?? []) {
    const unit = gc.unit?.toLowerCase();
    if (!unit) continue;
    hasAnyUnit = true;
    if (normalised.has(unit)) return 1.0;
  }

  for (const node of graph.nodes) {
    const unit = node.data?.unit?.toLowerCase();
    if (!unit) continue;
    hasAnyUnit = true;
    if (normalised.has(unit)) return 1.0;
  }

  return hasAnyUnit ? 0.5 : 0.0;
}

// =============================================================================
// Numeric-target capture (completeness sub-dimension)
// =============================================================================

/** Operators the sent grammar permits on a goal_constraints[] entry. */
const CONSTRAINT_OPERATORS = new Set([">=", "<="]);

/** A constraint the model actually filled in: finite value + a legal operator. */
function isWellFormedNumericConstraint(gc: GoalConstraint): boolean {
  return (
    gc.value != null &&
    Number.isFinite(gc.value) &&
    gc.operator != null &&
    CONSTRAINT_OPERATORS.has(gc.operator)
  );
}

/**
 * Did the model capture the brief's numeric target in machine-readable form?
 *
 * ⚠ RUBRIC 2 re-points this sub-dimension, and it is a CHANGE OF QUESTION —
 * not the same question relocated. Say so plainly:
 *
 *   rubric 1 asked — "did the model set the goal node's threshold?"
 *   rubric 2 asks  — "did the model record the brief's numeric target as a
 *                     machine-readable constraint?"
 *
 * Rubric 1's question is UNANSWERABLE post-#789: the quad is cut from the sent
 * grammar and stripped at ingress, so no model can score. Worse, the capability
 * it named is no longer the model's at all — the enricher derives the threshold
 * from BRIEF TEXT by regex (src/cee/factor-extraction/enricher.ts:649-740,
 * value from extractGoalTargetWithBaseline), not from anything the model wrote.
 * Scoring it would therefore measure CEE's extractor, not the draft.
 *
 * `goal_constraints[]` is what remains: REQUIRED in the sent grammar
 * (src/cee/draft/anthropic-graph-schema.ts — `required: [... "goal_constraints" ...]`,
 * items requiring node_id/constraint_id/operator/value/label), not stripped at
 * ingress, and genuinely consumed downstream (parse.ts → compound-goals →
 * package.ts, forwarded to PLoT). ⚠ It does NOT become the goal threshold —
 * nothing maps a constraint into the quad — so this sub-dimension must not be
 * read as a proxy for threshold extraction.
 *
 *   1.0 — a well-formed numeric constraint attached to the GOAL node
 *         (the model identified the target AND whose threshold it is)
 *   0.5 — a well-formed numeric constraint attached to some other node
 *         (target retained, misattached)
 *   0.0 — no well-formed numeric constraint at all
 */
function scoreNumericTargetCapture(
  graph: ParsedGraph,
  goalNode: GraphNode | undefined
): number {
  const constraints = (graph.goal_constraints ?? []).filter(isWellFormedNumericConstraint);
  if (constraints.length === 0) return 0.0;
  if (goalNode && constraints.some((gc) => gc.node_id === goalNode.id)) return 1.0;
  return 0.5;
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

  // 0.20: Numeric target captured when the brief carries one.
  // ⚠ RUBRIC 2 — was "goal node has goal_threshold set" (rubric 1); the model
  // is forbidden that field post-#789. See scoreNumericTargetCapture().
  if (!brief.meta.has_numeric_target) {
    score += 0.20; // Not required — full marks
  } else {
    score += scoreNumericTargetCapture(graph, goalNode) * 0.20;
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
  // preserve it in model-permitted unit metadata (node data.unit,
  // goal_constraints[].unit). NOT goal_threshold_unit — see rubric 2 note below.
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

      // ⚠ RUBRIC 2 — the `goal_threshold` arm that stood here is REMOVED.
      // Confirmed at the bytes before removal: it was presence-gated
      // (`node.goal_threshold != null`), so ABSENCE never hard-zeroed a draft
      // and rubric 1 did not mis-penalise post-#789 model output here. But the
      // model cannot emit the field at all, so on a model draft the arm was
      // simply DEAD, and on enriched/pipeline output it hard-zeroed the whole
      // dimension for an encoding decision the model never made. Ratio encoding
      // is still scored on model-permitted channels: node data.value above and
      // goal_constraints[].value below.
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
// Dimensions 9-13 (rubric 2.1) — WP1
// =============================================================================

/**
 * Dimension 9: NUMERIC PROVENANCE — TWO-SIDED.
 *
 *   side A (retention)   fraction of the brief's declared user values that the
 *                        candidate still carries at NATIVE magnitude + unit with
 *                        USER provenance.              (G1, graded)
 *   side B (no laundering) 1 - fraction of the candidate's user-provenance
 *                        numbers that the brief does not support.
 *                                                      (G2, graded)
 *   score = 0.5*A + 0.5*B
 *
 * Two-sidedness is the point: dropping every number makes A collapse, and
 * stamping every number `user` makes B collapse. Neither half can be gamed by
 * the move that wins the other.
 *
 * ⚠ It NEVER reads `goal_threshold*` — the fields are enricher-minted and
 * ingress-stripped, so reading them would score CEE's regex extractor instead of
 * the candidate (see `rubric-invariant.test.ts` and trust-gates.ts).
 *
 * Both halves delegate to the TRUST GATES' own helpers, so the gate and the
 * score can never answer the same question differently.
 */
function scoreNumericProvenance(graph: ParsedGraph, brief: Brief): number {
  const input = { rich: null, graph, brief };

  const located = locateExpectedUserValues(input);
  const sideA = located.length === 0
    ? 1.0 // brief declares none — not applicable, full marks for this half
    : located.filter((l) => l.found != null).length / located.length;

  const { violations, inspected } = findLaunderedNumbers(input);
  const sideB = inspected === 0 ? 1.0 : Math.max(0, 1 - violations.length / inspected);

  return 0.5 * sideA + 0.5 * sideB;
}

/**
 * Dimension 10: CONTROLLABILITY — an intervention may only set a factor the
 * decision maker actually controls (`category: "controllable"`).
 *
 * Score = interventions landing on a controllable factor / all interventions.
 * 1.0 when the graph has no interventions (not applicable).
 */
function scoreControllability(graph: ParsedGraph): number {
  const categoryOf = new Map<string, string | undefined>();
  for (const n of graph.nodes) categoryOf.set(n.id, n.kind === "factor" ? n.category : n.kind);

  let total = 0;
  let ok = 0;
  for (const node of graph.nodes) {
    if (node.kind !== "option") continue;
    for (const iv of readInterventions(node)) {
      total++;
      if (categoryOf.get(iv.factorId) === "controllable") ok++;
    }
  }
  return total === 0 ? 1.0 : ok / total;
}

/**
 * Dimension 11: DECISION ENRICHMENT (deterministic part).
 *
 * Counts AI-proposed options/factors/outcomes/risks that ADD something and
 * LAUNDER nothing: AI provenance, a non-generic label, at least one incident
 * edge, and no number on the item stamped with USER provenance.
 *
 * ⚠ STATED HONESTLY: this SATURATES. Any candidate contributing CAP (8) clean
 * AI items scores 1.0, and the Arm A control already contributes nine. It is a
 * FLOOR CHECK — "did the candidate enrich at all, without laundering?" — not a
 * richness ranking. Ranking richness is the blind LLM judge's job (plan §WP1.3),
 * which is why this dimension carries only 0.02.
 */
const ENRICHMENT_CAP = 8;

function scoreDecisionEnrichment(graph: ParsedGraph): number {
  const incident = new Set<string>();
  for (const e of graph.edges) {
    incident.add(e.from);
    incident.add(e.to);
  }

  const interventionsByTarget = new Map<string, ReturnType<typeof readInterventions>>();
  for (const node of graph.nodes) {
    for (const iv of readInterventions(node)) {
      const list = interventionsByTarget.get(iv.factorId) ?? [];
      list.push(iv);
      interventionsByTarget.set(iv.factorId, list);
    }
  }

  let qualifying = 0;
  let launderers = 0;

  for (const node of graph.nodes) {
    if (!["option", "factor", "outcome", "risk"].includes(node.kind)) continue;
    if (classifyProvenance(node.provenance) !== "ai") continue;

    const label = (node.label ?? "").toLowerCase().trim();
    if (label.length < 4 || GENERIC_FACTOR_LABELS.has(label)) continue;
    if (!incident.has(node.id)) continue;

    // Does this AI item carry a number stamped with USER authority?
    const ownNumbers = [
      ...readInterventions(node).map((iv) => iv.source),
      node.observed_state?.source ?? null,
      node.data?.extractionType ?? null,
    ];
    const launders = ownNumbers.some((src) => src != null && classifyProvenance(src) === "user");
    if (launders) {
      launderers++;
      continue;
    }
    qualifying++;
  }

  const base = Math.min(qualifying, ENRICHMENT_CAP) / ENRICHMENT_CAP;
  const purity = qualifying + launderers === 0 ? 1.0 : qualifying / (qualifying + launderers);
  return base * purity;
}

/**
 * Dimensions 12 & 13: TEMPORAL / QUALITATIVE PRESERVATION.
 *
 * Keyword-based, from the brief's front-matter oracle. Returns `null` when the
 * brief declares none — NOT APPLICABLE, which the composite scores as 1.0 while
 * the result carries the null so a reader can tell "not measured" from "measured
 * and perfect" (an NA and a 1.0 are otherwise byte-identical in a CSV).
 *
 * The surface searched is what a GraphV3 body can actually carry: node labels,
 * the coaching summary and strengthen-item labels/details. A graph has no
 * temporal block, so a candidate that only ever emits a graph will usually score
 * low here — that loss is real, and the projection report is where it is
 * explained (WP6), not hidden.
 */
function scoreKeywordPreservation(graph: ParsedGraph, keywords: string[] | undefined): number | null {
  if (!keywords || keywords.length === 0) return null;
  const surface = [
    ...graph.nodes.map((n) => n.label ?? ""),
    graph.coaching?.summary ?? "",
    ...(graph.coaching?.strengthen_items ?? []).flatMap((i) => [i.label ?? "", i.detail ?? ""]),
  ]
    .join("\n")
    .toLowerCase();
  const found = keywords.filter((k) => surface.includes(k.toLowerCase())).length;
  return found / keywords.length;
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
      rubric_version: DRAFT_RUBRIC_VERSION,
      structural_valid: false,
      violation_codes: ["NO_GRAPH"],
      param_quality: null,
      option_diff: null,
      completeness: null,
      constraint_retention: null,
      ratio_encoding: null,
      external_factor_presence: null,
      coaching_quality: null,
      numeric_provenance: null,
      controllability: null,
      decision_enrichment: null,
      temporal_preservation: null,
      qualitative_preservation: null,
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
  // ── rubric 2.1 ─────────────────────────────────────────────────────────────
  const numericProvenance = scoreNumericProvenance(graph, brief);
  const controllability = scoreControllability(graph);
  const decisionEnrichment = scoreDecisionEnrichment(graph);
  const temporalPreservation = scoreKeywordPreservation(graph, brief.meta.expected_temporal);
  const qualitativePreservation = scoreKeywordPreservation(graph, brief.meta.expected_qualitative);

  // If structurally invalid, overall_score is null per spec.
  // All per-dimension scores are still returned for diagnostics.
  if (!valid) {
    return {
      rubric_version: DRAFT_RUBRIC_VERSION,
      structural_valid: false,
      violation_codes: violations,
      param_quality: paramQuality,
      option_diff: optionDiff,
      completeness: completeness,
      constraint_retention: constraintRetention,
      ratio_encoding: ratioEncoding,
      external_factor_presence: externalFactorPresence,
      coaching_quality: coachingQuality,
      numeric_provenance: numericProvenance,
      controllability: controllability,
      decision_enrichment: decisionEnrichment,
      temporal_preservation: temporalPreservation,
      qualitative_preservation: qualitativePreservation,
      overall_score: null,
      node_count: nodeCount,
      edge_count: edgeCount,
    };
  }

  // Composite score, rubric 2.1. NA preservation dimensions score 1.0 and are
  // still REPORTED as null — see scoreKeywordPreservation.
  const overallScore =
    paramQuality * RUBRIC_WEIGHTS.param_quality +
    optionDiff * RUBRIC_WEIGHTS.option_diff +
    completeness * RUBRIC_WEIGHTS.completeness +
    constraintRetention * RUBRIC_WEIGHTS.constraint_retention +
    externalFactorPresence * RUBRIC_WEIGHTS.external_factor_presence +
    coachingQuality * RUBRIC_WEIGHTS.coaching_quality +
    ratioEncoding * RUBRIC_WEIGHTS.ratio_encoding +
    numericProvenance * RUBRIC_WEIGHTS.numeric_provenance +
    decisionEnrichment * RUBRIC_WEIGHTS.decision_enrichment +
    controllability * RUBRIC_WEIGHTS.controllability +
    (temporalPreservation ?? 1.0) * RUBRIC_WEIGHTS.temporal_preservation +
    (qualitativePreservation ?? 1.0) * RUBRIC_WEIGHTS.qualitative_preservation;

  return {
    rubric_version: DRAFT_RUBRIC_VERSION,
    structural_valid: true,
    violation_codes: [],
    param_quality: paramQuality,
    option_diff: optionDiff,
    completeness: completeness,
    constraint_retention: constraintRetention,
    ratio_encoding: ratioEncoding,
    external_factor_presence: externalFactorPresence,
    coaching_quality: coachingQuality,
    numeric_provenance: numericProvenance,
    controllability: controllability,
    decision_enrichment: decisionEnrichment,
    temporal_preservation: temporalPreservation,
    qualitative_preservation: qualitativePreservation,
    overall_score: overallScore,
    node_count: nodeCount,
    edge_count: edgeCount,
  };
}
