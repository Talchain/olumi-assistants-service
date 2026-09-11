/**
 * Graph Validator
 *
 * Deterministic graph validation that runs after Zod schema validation,
 * before enrichment. Extracts rules from the LLM prompt into code for
 * faster validation and precise repair feedback.
 *
 * @module validators/graph-validator
 */

import { log } from "../utils/telemetry.js";
import type { GraphT, NodeT, EdgeT, FactorDataT, OptionDataT } from "../schemas/graph.js";
import { isDirectedEdge } from "../schemas/graph.js";
import { validatorNodePath } from "./violation-paths.js";
import { isDecisionFreeShape } from "./decision-free-shape.js";
import { factorHasExpressiblePrior } from "../cee/provenance/unquantified-factor.js";
import { readIsBaseline, type BaselineFlagSurfaces } from "../cee/baseline-identity.js";
// The estate's ONE owner of "what frame is this factor on?" — a leaf module
// with no imports of its own. Consulted rather than re-derived so this file
// cannot hold a private opinion about the divisor (trap 12).
import { resolveScaleFrame } from "../orchestrator-v5/tools/handlers/d1-shared/scale-frame.js";
import {
  type GraphValidationInput,
  type GraphValidationResult,
  type ControllabilitySummary,
  type ValidationIssue,
  type NodeMap,
  type AdjacencyLists,
  type FactorCategory,
  type FactorCategoryInfo,
  NODE_LIMIT,
  EDGE_LIMIT,
  MIN_OPTIONS,
  MAX_OPTIONS,
  ALLOWED_EDGES,
  CANONICAL_EDGE,
} from "./graph-validator.types.js";

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Build node lookup maps for efficient access.
 */
function buildNodeMap(nodes: NodeT[]): NodeMap {
  const byId = new Map<string, NodeT>();
  const byKind = new Map<string, NodeT[]>();

  for (const node of nodes) {
    byId.set(node.id, node);
    const kindList = byKind.get(node.kind) ?? [];
    kindList.push(node);
    byKind.set(node.kind, kindList);
  }

  return { byId, byKind };
}

/**
 * Build forward and reverse adjacency lists.
 */
function buildAdjacencyLists(edges: EdgeT[]): AdjacencyLists {
  const forward = new Map<string, string[]>();
  const reverse = new Map<string, string[]>();

  for (const edge of edges) {
    // Bidirected edges represent unmeasured confounders, not directed paths.
    // Exclude them from adjacency so they don't affect reachability or semantic checks.
    if (!isDirectedEdge(edge)) continue;

    const fwdList = forward.get(edge.from) ?? [];
    fwdList.push(edge.to);
    forward.set(edge.from, fwdList);

    const revList = reverse.get(edge.to) ?? [];
    revList.push(edge.from);
    reverse.set(edge.to, revList);
  }

  return { forward, reverse };
}

/**
 * Infer factor category from graph structure.
 * - controllable: Has incoming edge from option node
 * - observable: No option edge but has data.value
 * - external: No option edge, no data.value
 */
function inferFactorCategories(
  nodes: NodeT[],
  edges: EdgeT[],
  nodeMap: NodeMap
): Map<string, FactorCategoryInfo> {
  const categories = new Map<string, FactorCategoryInfo>();

  // Find option node IDs
  const optionIds = new Set(
    (nodeMap.byKind.get("option") ?? []).map((n) => n.id)
  );

  // Find factor IDs with incoming directed edges from options
  const factorsWithOptionEdge = new Set<string>();
  for (const edge of edges) {
    if (!isDirectedEdge(edge)) continue; // Bidirected edges don't indicate controllability
    if (optionIds.has(edge.from)) {
      factorsWithOptionEdge.add(edge.to);
    }
  }

  // Categorize each factor
  const factors = nodeMap.byKind.get("factor") ?? [];
  for (const node of factors) {
    const hasOptionEdge = factorsWithOptionEdge.has(node.id);
    const data = node.data as FactorDataT | undefined;
    const hasValue = data?.value !== undefined;

    // Read explicit category from node.category (V12.4+ schema field)
    const explicitCategory = node.category as FactorCategory | undefined;

    // Infer category from structure
    let category: FactorCategory;
    if (hasOptionEdge) {
      category = "controllable";
    } else if (hasValue) {
      category = "observable";
    } else {
      category = "external";
    }

    categories.set(node.id, {
      nodeId: node.id,
      category,
      hasOptionEdge,
      hasValue,
      explicitCategory,
    });
  }

  return categories;
}

/**
 * BFS forward traversal from a set of starting nodes.
 * Returns all reachable node IDs.
 */
function bfsForward(
  startNodes: string[],
  adjacency: AdjacencyLists
): Set<string> {
  const visited = new Set<string>();
  const queue = [...startNodes];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    const neighbors = adjacency.forward.get(current) ?? [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        queue.push(neighbor);
      }
    }
  }

  return visited;
}

/**
 * BFS reverse traversal from a set of starting nodes.
 * Returns all nodes that can reach the starting nodes.
 */
function bfsReverse(
  startNodes: string[],
  adjacency: AdjacencyLists
): Set<string> {
  const visited = new Set<string>();
  const queue = [...startNodes];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    const neighbors = adjacency.reverse.get(current) ?? [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        queue.push(neighbor);
      }
    }
  }

  return visited;
}

/**
 * Detect cycles using Kahn's algorithm (topological sort).
 * Returns true if cycle exists.
 */
function hasCycle(nodes: NodeT[], edges: EdgeT[]): boolean {
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  // Initialize
  for (const node of nodes) {
    inDegree.set(node.id, 0);
    adjacency.set(node.id, []);
  }

  // Build adjacency and count in-degrees — only directed edges can form cycles.
  // Bidirected edges represent unmeasured confounders, not directed paths.
  for (const edge of edges) {
    if (!isDirectedEdge(edge)) continue; // Skip bidirected edges
    const list = adjacency.get(edge.from);
    if (list) list.push(edge.to);
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
  }

  // Find all nodes with in-degree 0
  const queue: string[] = [];
  for (const [nodeId, degree] of inDegree) {
    if (degree === 0) queue.push(nodeId);
  }

  // Process nodes
  let processedCount = 0;
  while (queue.length > 0) {
    const current = queue.shift()!;
    processedCount++;

    const neighbors = adjacency.get(current) ?? [];
    for (const neighbor of neighbors) {
      const newDegree = (inDegree.get(neighbor) ?? 0) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) queue.push(neighbor);
    }
  }

  // If not all nodes processed, there's a cycle
  return processedCount !== nodes.length;
}

/**
 * Build canonical intervention signature for an option.
 * Sort by factor_id, canonicalise floats to 4 decimal places for stability;
 * differences beyond 4dp treated as negligible for identity comparison.
 *
 * EXPORTED because it is the product's definition of the very defect the
 * A/B measurement harnesses exist to measure (an empty signature on >1 option
 * IS the OPTIONS_IDENTICAL outage). Those harnesses previously RETYPED these
 * semantics — a measurement instrument calibrated against a copy of the thing
 * it measures can silently drift out of agreement with it.
 */
export function buildInterventionSignature(interventions: Record<string, number>): string {
  const entries = Object.entries(interventions)
    .map(([factorId, value]) => `${factorId}:${value.toFixed(4)}`)
    .sort();
  return entries.join("|");
}

/**
 * The resolution at which two model levels are THE SAME NUMBER.
 *
 * Half the 4-decimal quantum `buildInterventionSignature` canonicalises to,
 * spelled numerically because this comparison must be SIGN-SYMMETRIC and
 * `toFixed` is not: `(-0.00001).toFixed(4)` is `"-0.0000"` while
 * `(0.00001).toFixed(4)` is `"0.0000"`. An invariant written with the same
 * asymmetry as its neighbour is a guard agreeing with itself (trap 13d), and
 * the intervention map is a bare `z.record(z.string(), z.number())`
 * (`schemas/graph.ts:200`) — it admits negatives.
 *
 * ⚠ TWO DIFFERENT QUESTIONS AT ONE RESOLUTION, NOT ONE PREDICATE SHARED
 * (trap 21). The signature above decides "are these two options the same as
 * each other?"; this decides "is this option the same as the status quo?".
 * They must not drift apart on what counts as the same number, so the
 * agreement is ASSERTED in `__tests__/option-no-op-invariant.test.ts` rather
 * than enforced by making one call the other.
 */
export const LEVEL_IDENTITY_EPSILON = 5e-5;

/** Whether two model levels are indistinguishable at the identity resolution. */
export function levelsAreIdentical(a: number, b: number): boolean {
  return Math.abs(a - b) <= LEVEL_IDENTITY_EPSILON;
}

/** The three fields that between them say where a factor sits, on one surface. */
type FactorLevelSurface = {
  readonly value?: unknown;
  readonly raw_value?: unknown;
  readonly baseline?: unknown;
};

/** The number itself, or `undefined` for anything that is not a finite one. */
function finiteOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * ⭐⭐ THE STATED CURRENT LEVEL — `baseline`, put onto the frame `value` is on.
 *
 * ── THE DEFECT ─────────────────────────────────────────────────────────────
 * A `from X to Y` brief is extracted as `{value: Y, baseline: X}`
 * (`factor-extraction/index.ts:2203`, measured by execution: Paul's price
 * brief yields `{value: 59, baseline: 49, unit: "£"}`). `value` therefore
 * holds the PROPOSED level and `baseline` holds the current one — the
 * interface's own comment admits it, calling `value` *"Current or proposed
 * value"*, which is two questions under one name (trap 21). The factor is born
 * at its target, so an option that raises the price to £59 changes nothing and
 * `OPTION_NO_OP` refuses a draft that is describing a real alternative. The
 * check is right; the data is wrong.
 *
 * ── WHY `baseline` IS SAFE TO BELIEVE HERE ─────────────────────────────────
 * Every writer that puts a number in `baseline` means the same thing by it —
 * derived at the bytes across CEE staging `77d11382`, not inferred from the
 * name. The regex from-to extractors write the FROM number
 * (`index.ts:1851/2203/2227/2275`); the LLM factor extractor is instructed
 * *"baseline: (optional) Starting value for from-to patterns"*
 * (`llm-extractor.ts:78`); the structural-edit tool declares it to the model as
 * *"The amount before any change, when it differs"*
 * (`propose-structural-edit.ts:1029`). The draft prompt never asks for it at
 * all — it says *"data.value is baseline (pre-intervention)"*
 * (`defaults-v187.ts:420`) — and `anthropic-graph-schema.ts` declares no such
 * property, so no LLM draft can write one.
 *
 * ── THE SCALE, WHICH IS THE WHOLE HAZARD ───────────────────────────────────
 * `baseline` is in the units of the `value` it was written BESIDE: raw for a
 * currency from-to (49 beside 59), already fractional for a percent one (0.85
 * beside 0.95). The records projector reframes `value` afterwards
 * (`projector.ts:3503` — `value: raw/frame`, `raw_value: raw`) and does not
 * touch `baseline`, which is how `{value: 0.59, raw_value: 59, baseline: 49}`
 * arises. Dividing is therefore mandatory where a frame exists and FORBIDDEN
 * where one does not, and reading `baseline` raw against framed interventions
 * would swap an inverted graph for a 100×-wrong one.
 *
 * The divisor is not re-derived here. `resolveScaleFrame` is the estate's one
 * owner of *"what frame is this factor on?"* — stored `scale_frame` first, the
 * `{value, raw_value}` pair second — and a private opinion about the frame is
 * exactly the hand-maintained mirror of trap 12.
 *
 * ── WHY A BASELINE EQUAL TO `value` IS DELIBERATELY IGNORED ────────────────
 * Goal and constraint-target writers stamp `{value: B, baseline: B}` in MODEL
 * units beside a raw `raw_value` (`add-constraint.ts:906`, `schema-v3.ts:354`,
 * `compound-goals.ts:844`) — there the two names carry one number and a frame
 * IS recoverable from the pair, so dividing would be the 100× error. Requiring
 * the two to DIFFER keeps this to the case where `baseline` states something
 * `value` does not, and the equal case falls through to today's answer, which
 * is already correct.
 *
 * ── FAILURE DIRECTION ──────────────────────────────────────────────────────
 * Where no frame resolves, the baseline is returned in its own units. Against
 * framed interventions that cannot match, so the verdict is "this option
 * changes something" — the safe direction this predicate already documents
 * ("Refusing to accuse is the safe direction here", trap 22b). It can withhold
 * a no-op finding; it cannot manufacture one.
 */
function readStatedCurrentLevel(node: NodeT): number | undefined {
  const observed = (node as { observed_state?: FactorLevelSurface }).observed_state;
  const data = node.data as FactorLevelSurface | undefined;

  // ONE SURFACE AT A TIME. `baseline` means what it means relative to the
  // `value` written beside it, so pairing `observed_state.baseline` with
  // `data.value` would compare two numbers from different writes.
  const surface: FactorLevelSurface | undefined =
    finiteOrUndefined(observed?.baseline) !== undefined
      ? observed
      : finiteOrUndefined(data?.baseline) !== undefined
        ? data
        : undefined;
  if (surface === undefined) return undefined;

  const baseline = finiteOrUndefined(surface.baseline);
  const value = finiteOrUndefined(surface.value);
  if (baseline === undefined || value === undefined) return undefined;
  if (baseline === value) return undefined;

  const frame = resolveScaleFrame({
    storedFrame: (node as { scale_frame?: unknown }).scale_frame,
    value,
    raw_value: surface.raw_value,
  });
  return frame === undefined ? baseline : baseline / frame;
}

/**
 * The level the ANALYSIS treats as "where this factor is today".
 *
 * ⚠ TWO SENSES OF ONE WORD MEET IN THIS FUNCTION, AND THEY ARE NAMED APART
 * (trap 21). This function's own "baseline" is *the level an intervention is
 * compared against*; the FIELD `baseline` it now consults is *the level the
 * user stated the factor is at today*. They are the same quantity only when the
 * graph is not inverted, which is precisely the bug — so the stated level wins
 * where it exists and says something the value does not.
 *
 * ⭐ PRECEDENCE, STATED: a stated current level
 * (`readStatedCurrentLevel` — `baseline`, on `value`'s frame) first, then
 * `FactorObservedState.value`, documented at `schemas/graph.ts:263` as *"The
 * factor's current position on the model 0-1 scale (PLoT normalises)"* and
 * carried by the run payload, then `data.value`.
 *
 * `data.value` is the FALLBACK, not a rival: the projector's scale pass writes
 * both (`projector.ts:3505-3506`) and `schema-v3.ts` rebuilds `observed_state`
 * FROM `data`, so on a fully-projected graph they agree by construction. A
 * graph that carries only one is still readable, and the precedence is pinned
 * by a test rather than left to whichever happens to be present.
 *
 * Returns `undefined` when no surface carries a finite number. That is
 * NOT a no-op verdict: a factor the brief states no value for cannot prove an
 * option changes nothing.
 */
export function readFactorBaselineLevel(node: NodeT): number | undefined {
  const stated = readStatedCurrentLevel(node);
  if (stated !== undefined) return stated;
  const observed = (node as { observed_state?: { value?: unknown } }).observed_state;
  if (typeof observed?.value === "number" && Number.isFinite(observed.value)) {
    return observed.value;
  }
  const data = node.data as { value?: unknown } | undefined;
  if (typeof data?.value === "number" && Number.isFinite(data.value)) {
    return data.value;
  }
  return undefined;
}

/**
 * Check if a number is NaN or Infinity.
 */
function isInvalidNumber(value: unknown): boolean {
  if (typeof value !== "number") return false;
  return !Number.isFinite(value);
}

/**
 * Goal-number detection patterns.
 * Matches factor labels that appear to be goal target values, not causal factors.
 * E.g., "£20k MRR", "$50k revenue target", "target of £100k"
 *
 * Patterns are intentionally specific to reduce false positives:
 * - Require currency symbols (£$€) OR specific financial terms (MRR/ARR/revenue/sales)
 * - Avoid matching generic factors like "target customer segments" or "objective function"
 */
const GOAL_NUMBER_PATTERNS = [
  // "goal of reaching £20k" or "goal of $1M"
  /goal of (?:reaching |achieving )?[£$€]?[\d,]+[kKmM]?/i,
  // "target of £100k" - requires currency symbol to avoid "target 5 segments"
  /target (?:of )?[£$€][\d,]+[kKmM]?/i,
  // "target of 100k revenue" or "revenue target of 50k" - requires financial keyword
  /(?:revenue|sales|MRR|ARR)\s*target\s*(?:of\s*)?[\d,]+[kKmM]?/i,
  /target\s*(?:of\s*)?[\d,]+[kKmM]?\s*(?:revenue|sales|MRR|ARR)/i,
  // Standalone currency amounts like "£20k MRR" or "$50k"
  /^[£$€][\d,]+[kKmM]?\s*(?:MRR|ARR|revenue|sales)?$/i,
  // "50k MRR" or "100k revenue target"
  /^\d+[kKmM]\s*(?:MRR|ARR|revenue|sales|target|goal)/i,
  // "$50k revenue target"
  /[£$€]\d+[kKmM]?\s*(?:revenue|sales)?\s*target/i,
];

/**
 * Patterns that indicate a REFERENCE to a target, not THE target itself.
 * These are used to exclude false positives like "share of £20k target".
 */
const GOAL_REFERENCE_EXCLUSIONS = [
  // "share of £20k target" or "fraction of $100k goal"
  /(?:share|fraction|portion|percentage|%)\s+of\s+[£$€]?[\d,]+[kKmM]?\s*(?:target|goal)?/i,
  // "progress toward £20k" or "progress to $100k"
  /progress\s+(?:toward|towards|to)\s+[£$€]?[\d,]+[kKmM]?/i,
  // "(0-1, share of £20k target)" - normalized metric description
  /\([\d.]+[-–][\d.]+,?\s*(?:share|fraction|portion)\s+of\s+[£$€]?[\d,]+[kKmM]?\s*(?:target|goal)?\)/i,
  // "relative to £20k target" or "compared to $50k goal"
  /(?:relative|compared)\s+to\s+[£$€]?[\d,]+[kKmM]?\s*(?:target|goal)?/i,
  // "as % of £20k" or "as fraction of $100k"
  /as\s+(?:%|percent|percentage|fraction|share)\s+of\s+[£$€]?[\d,]+[kKmM]?/i,
];

/**
 * Check if a factor label appears to be a goal target value.
 * Excludes cases where the target is just a reference point (e.g., "share of £20k target").
 */
function isGoalNumberLabel(label: string): boolean {
  if (!label) return false;

  // First check if this is a reference to a target (not the target itself)
  const isReference = GOAL_REFERENCE_EXCLUSIONS.some((pattern) => pattern.test(label));
  if (isReference) return false;

  // Then check if it matches goal number patterns
  return GOAL_NUMBER_PATTERNS.some((pattern) => pattern.test(label));
}

// =============================================================================
// Tier 1: Structural Validation
// =============================================================================

function validateStructural(
  graph: GraphT,
  nodeMap: NodeMap
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // MISSING_GOAL: Exactly 1 goal node
  const goals = nodeMap.byKind.get("goal") ?? [];
  if (goals.length === 0) {
    issues.push({
      code: "MISSING_GOAL",
      severity: "error",
      message: "Graph must have exactly 1 goal node",
      context: { goalCount: 0 },
    });
  } else if (goals.length > 1) {
    issues.push({
      code: "MISSING_GOAL",
      severity: "error",
      message: `Graph must have exactly 1 goal node, found ${goals.length}`,
      context: { goalCount: goals.length, goalIds: goals.map((g) => g.id) },
    });
  }

  // MISSING_DECISION: Exactly 1 decision node
  const decisions = nodeMap.byKind.get("decision") ?? [];
  const options = nodeMap.byKind.get("option") ?? [];

  // ⭐ THE DELIBERATE EXPLORATORY MAP. A brief with nothing being chosen between
  // ("I want to map out what is going on rather than jump to an answer") has no
  // decision AND no options, and both cardinality errors below would fire on it
  // — together they were the 422 that refused those users a model at all.
  //
  // The predicate is EXACT and is the single authority in
  // `decision-free-shape.ts`; see that file for why the two adjacent shapes
  // (`options>0, decisions===0` and `decisions>=1, options<2`) must keep
  // erroring, and for the 48-cell corpus that pins every other cell unchanged.
  const decisionFree = isDecisionFreeShape({
    decisionCount: decisions.length,
    optionCount: options.length,
  });

  if (decisions.length === 0) {
    if (!decisionFree) {
      issues.push({
        code: "MISSING_DECISION",
        severity: "error",
        message: "Graph must have exactly 1 decision node",
        context: { decisionCount: 0 },
      });
    }
  } else if (decisions.length > 1) {
    issues.push({
      code: "MISSING_DECISION",
      severity: "error",
      message: `Graph must have exactly 1 decision node, found ${decisions.length}`,
      context: { decisionCount: decisions.length, decisionIds: decisions.map((d) => d.id) },
    });
  }

  // INSUFFICIENT_OPTIONS: 2-6 options
  // (`options` is hoisted above, next to `decisions`, because the decision-free
  // predicate is a conjunction over BOTH counts.)
  if (options.length < MIN_OPTIONS) {
    // Suppressed ONLY for the deliberate exploratory map. A decision that exists
    // with fewer than two options is still an error: that user IS choosing, and
    // a choice with one alternative is not a comparison.
    if (!decisionFree) {
      issues.push({
        code: "INSUFFICIENT_OPTIONS",
        severity: "error",
        message: `Graph must have at least ${MIN_OPTIONS} options, found ${options.length}`,
        context: { optionCount: options.length, min: MIN_OPTIONS },
      });
    }
  } else if (options.length > MAX_OPTIONS) {
    issues.push({
      code: "INSUFFICIENT_OPTIONS",
      severity: "error",
      message: `Graph must have at most ${MAX_OPTIONS} options, found ${options.length}`,
      context: { optionCount: options.length, max: MAX_OPTIONS },
    });
  }

  // MISSING_BRIDGE: >=1 outcome or risk
  const outcomes = nodeMap.byKind.get("outcome") ?? [];
  const risks = nodeMap.byKind.get("risk") ?? [];
  if (outcomes.length === 0 && risks.length === 0) {
    issues.push({
      code: "MISSING_BRIDGE",
      severity: "error",
      message: "Graph must have at least 1 outcome or risk node",
      context: { outcomeCount: 0, riskCount: 0 },
    });
  }

  // NODE_LIMIT_EXCEEDED: <=50 nodes
  if (graph.nodes.length > NODE_LIMIT) {
    issues.push({
      code: "NODE_LIMIT_EXCEEDED",
      severity: "error",
      message: `Graph exceeds node limit of ${NODE_LIMIT}, found ${graph.nodes.length}`,
      context: { nodeCount: graph.nodes.length, limit: NODE_LIMIT },
    });
  }

  // EDGE_LIMIT_EXCEEDED: <=200 edges
  if (graph.edges.length > EDGE_LIMIT) {
    issues.push({
      code: "EDGE_LIMIT_EXCEEDED",
      severity: "error",
      message: `Graph exceeds edge limit of ${EDGE_LIMIT}, found ${graph.edges.length}`,
      context: { edgeCount: graph.edges.length, limit: EDGE_LIMIT },
    });
  }

  // INVALID_EDGE_REF: from/to must reference existing node IDs
  for (let i = 0; i < graph.edges.length; i++) {
    const edge = graph.edges[i];
    if (!nodeMap.byId.has(edge.from)) {
      issues.push({
        code: "INVALID_EDGE_REF",
        severity: "error",
        message: `Edge references non-existent node: ${edge.from}`,
        path: `edges[${i}]`,
        context: { field: "from", nodeId: edge.from },
      });
    }
    if (!nodeMap.byId.has(edge.to)) {
      issues.push({
        code: "INVALID_EDGE_REF",
        severity: "error",
        message: `Edge references non-existent node: ${edge.to}`,
        path: `edges[${i}]`,
        context: { field: "to", nodeId: edge.to },
      });
    }
  }

  return issues;
}

// =============================================================================
// Tier 2: Topology Validation
// =============================================================================

function validateTopology(
  graph: GraphT,
  nodeMap: NodeMap,
  adjacency: AdjacencyLists,
  factorCategories: Map<string, FactorCategoryInfo>
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // GOAL_HAS_OUTGOING: Goal must be sink
  const goals = nodeMap.byKind.get("goal") ?? [];
  for (const goal of goals) {
    const outgoing = adjacency.forward.get(goal.id) ?? [];
    if (outgoing.length > 0) {
      issues.push({
        code: "GOAL_HAS_OUTGOING",
        severity: "error",
        message: `Goal node "${goal.id}" must not have outgoing edges`,
        path: validatorNodePath(goal.id),
        context: { outgoingTo: outgoing },
      });
    }
  }

  // DECISION_HAS_INCOMING: Decision must be source
  const decisions = nodeMap.byKind.get("decision") ?? [];
  for (const decision of decisions) {
    const incoming = adjacency.reverse.get(decision.id) ?? [];
    if (incoming.length > 0) {
      issues.push({
        code: "DECISION_HAS_INCOMING",
        severity: "error",
        message: `Decision node "${decision.id}" must not have incoming edges`,
        path: validatorNodePath(decision.id),
        context: { incomingFrom: incoming },
      });
    }
  }

  // INVALID_EDGE_TYPE: Edge violates allowed matrix
  // Bidirected edges are trust annotations (unmeasured confounders) — they don't
  // follow directed topology rules. Skip them in edge-type validation.
  for (let i = 0; i < graph.edges.length; i++) {
    const edge = graph.edges[i];
    if (!isDirectedEdge(edge)) continue; // Skip bidirected edges

    const fromNode = nodeMap.byId.get(edge.from);
    const toNode = nodeMap.byId.get(edge.to);

    if (!fromNode || !toNode) continue; // Already caught by INVALID_EDGE_REF

    const fromKind = fromNode.kind;
    const toKind = toNode.kind;

    // Get factor categories if applicable
    const fromFactorCat = factorCategories.get(edge.from)?.category;
    const toFactorCat = factorCategories.get(edge.to)?.category;

    // Check if edge matches any allowed rule
    let isAllowed = false;
    for (const rule of ALLOWED_EDGES) {
      if (rule.fromKind !== fromKind || rule.toKind !== toKind) continue;

      // Check factor category constraints
      if (rule.toFactorCategory && toFactorCat !== rule.toFactorCategory) continue;
      if (rule.fromFactorCategory && fromFactorCat !== rule.fromFactorCategory) continue;

      isAllowed = true;
      break;
    }

    if (!isAllowed) {
      issues.push({
        code: "INVALID_EDGE_TYPE",
        severity: "error",
        message: `Invalid edge from ${fromKind} to ${toKind}`,
        path: `edges[${i}]`,
        context: {
          fromKind,
          toKind,
          fromId: edge.from,
          toId: edge.to,
          fromFactorCategory: fromFactorCat,
          toFactorCategory: toFactorCat,
        },
      });
    }
  }

  // CYCLE_DETECTED: DAG required
  if (hasCycle(graph.nodes, graph.edges)) {
    issues.push({
      code: "CYCLE_DETECTED",
      severity: "error",
      message: "Graph contains a cycle; must be a DAG",
    });
  }

  return issues;
}

// =============================================================================
// Tier 3: Reachability Validation
// =============================================================================

function validateReachability(
  graph: GraphT,
  nodeMap: NodeMap,
  adjacency: AdjacencyLists,
  factorCategories: Map<string, FactorCategoryInfo>
): { errors: ValidationIssue[]; infoIssues: ValidationIssue[] } {
  const errors: ValidationIssue[] = [];
  const infoIssues: ValidationIssue[] = [];

  const decisions = nodeMap.byKind.get("decision") ?? [];
  const goals = nodeMap.byKind.get("goal") ?? [];

  // ⭐⭐ THE EARLY RETURN IS SPLIT, AND THE SPLIT IS LOAD-BEARING.
  //
  // This used to be `if (decisions.length === 0 || goals.length === 0) return`,
  // which was harmless only while a decision-free graph was refused outright.
  // Now that the deliberate exploratory map is ADMITTED, that single return
  // would have handed those users a model with NO CONNECTIVITY ENFORCEMENT AT
  // ALL — trading a 422 for a silently disconnected graph, which is the worse
  // of the two failures because nothing reports it.
  //
  // The two checks below answer DIFFERENT questions and need different roots
  // (platform trap 21 — two questions under one predicate):
  //   - UNREACHABLE_FROM_DECISION is a FORWARD BFS from the decision. With no
  //     decision there is no root and the question is meaningless, so it stays
  //     skipped.
  //   - NO_PATH_TO_GOAL is a REVERSE BFS from the GOAL. It never reads the
  //     decision, so it is fully answerable without one and MUST still fire.
  //
  // ⚠ AND THE SPLIT IS SCOPED TO THE CLASS BEING ADMITTED, not to "no decision".
  // The first version of this ran NO_PATH_TO_GOAL for EVERY decision-less graph,
  // which is wider than this change needs and perturbs a shape that is already
  // refused: `options > 0 && decisions === 0` is real in persisted graphs here
  // and is blocked by MISSING_DECISION regardless. Widening it there bought no
  // enforcement and broke the deterministic sweep's Step-8 discrimination
  // (`cee.no-path-to-goal-duplicate-suppression.test.ts`), which relies on the
  // validator staying silent so its own proactive entry is the only one.
  // Exactly one cell moves in this tier too.
  const decisionFree = isDecisionFreeShape({
    decisionCount: decisions.length,
    optionCount: (nodeMap.byKind.get("option") ?? []).length,
  });

  // Only the goal is structurally required for this tier; `MISSING_GOAL` owns
  // the no-goal failure.
  if (goals.length === 0) {
    return { errors, infoIssues };
  }
  if (decisions.length === 0 && !decisionFree) {
    // Unchanged prior behaviour for the already-refused shape.
    return { errors, infoIssues };
  }

  const goalId = goals[0].id;

  // Reverse BFS from goal (nodes that can reach goal) — needs no decision.
  const canReachGoal = bfsReverse([goalId], adjacency);

  // UNREACHABLE_FROM_DECISION: Must be reachable from decision
  // Exception: observable/external factors may be exogenous roots IF they have path to goal
  // Exception: outcome/risk nodes are exempt (emit info instead of error)
  if (decisions.length > 0) {
    // Forward BFS from decision.
    const reachableFromDecision = bfsForward([decisions[0].id], adjacency);
    for (const node of graph.nodes) {
      if (node.kind === "decision" || node.kind === "goal") continue;

      if (!reachableFromDecision.has(node.id)) {
        // Check exemption for exogenous factors
        const factorInfo = factorCategories.get(node.id);
        const isExogenousFactor =
          factorInfo &&
          (factorInfo.category === "observable" || factorInfo.category === "external");

        if (isExogenousFactor && canReachGoal.has(node.id)) {
          // Exempted: exogenous factor with path to goal
          continue;
        }

        // Exempt outcome/risk nodes: emit info instead of error
        if ((node.kind === "outcome" || node.kind === "risk") && canReachGoal.has(node.id)) {
          // Determine exemption reason: exogenous (has ancestors outside decision path) vs isolated
          const ancestors = adjacency.reverse.get(node.id) ?? [];
          const reason = ancestors.length > 0 ? "exogenous" : "isolated";

          infoIssues.push({
            code: "EXEMPT_UNREACHABLE_OUTCOME_RISK",
            severity: "info",
            message: `Outcome/risk "${node.label ?? node.id}" has no controllable path from decision — decision influence is limited`,
            path: validatorNodePath(node.id),
            context: { kind: node.kind, nodeId: node.id, reason },
          });
          continue;
        }

        errors.push({
          code: "UNREACHABLE_FROM_DECISION",
          severity: "error",
          message: `Node "${node.id}" is not reachable from decision`,
          path: validatorNodePath(node.id),
          context: { kind: node.kind },
        });
      }
    }
  }

  // NO_PATH_TO_GOAL: All nodes (except decision) must reach goal
  // Runs unconditionally — the reverse BFS above is rooted at the GOAL, so this
  // is exactly as answerable for a decision-free map as for any other graph.
  for (const node of graph.nodes) {
    if (node.kind === "decision") continue; // Exempt decision from reverse check

    if (!canReachGoal.has(node.id)) {
      errors.push({
        code: "NO_PATH_TO_GOAL",
        severity: "error",
        message: `Node "${node.id}" has no path to goal`,
        path: validatorNodePath(node.id),
        context: { kind: node.kind },
      });
    }
  }

  return { errors, infoIssues };
}

// =============================================================================
// Controllability Summary
// =============================================================================

/**
 * Compute controllable ancestry for each outcome/risk node.
 * Uses reverse BFS from each outcome/risk, stopping when a controllable factor is found.
 */
function computeControllabilitySummary(
  graph: GraphT,
  nodeMap: NodeMap,
  adjacency: AdjacencyLists,
  factorCategories: Map<string, FactorCategoryInfo>,
  exemptNodeIds: string[]
): ControllabilitySummary {
  const outcomeRiskNodes = [
    ...(nodeMap.byKind.get("outcome") ?? []),
    ...(nodeMap.byKind.get("risk") ?? []),
  ];

  let withControllable = 0;
  let withoutControllable = 0;

  for (const node of outcomeRiskNodes) {
    // Reverse BFS from this node to find controllable ancestors
    const visited = new Set<string>();
    const queue = [node.id];
    let foundControllable = false;

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      const info = factorCategories.get(current);
      if (info?.category === "controllable") {
        foundControllable = true;
        break;
      }

      // Traverse reverse edges (parents)
      const parents = adjacency.reverse.get(current) ?? [];
      for (const parent of parents) {
        if (!visited.has(parent)) {
          queue.push(parent);
        }
      }
    }

    if (foundControllable) {
      withControllable++;
    } else {
      withoutControllable++;
    }
  }

  return {
    total_outcome_risk_nodes: outcomeRiskNodes.length,
    with_controllable_ancestry: withControllable,
    without_controllable_ancestry: withoutControllable,
    exempt_count: exemptNodeIds.length,
    exempt_node_ids: exemptNodeIds,
  };
}

// =============================================================================
// Tier 4: Factor Data Consistency
// =============================================================================

function validateFactorData(
  nodeMap: NodeMap,
  factorCategories: Map<string, FactorCategoryInfo>
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const factors = nodeMap.byKind.get("factor") ?? [];

  for (const factor of factors) {
    const info = factorCategories.get(factor.id);
    if (!info) continue;

    const data = factor.data as FactorDataT | undefined;

    // ⭐⭐ "UNKNOWN" IS A LEGAL STATE — AND THIS GATE IS WHY IT WAS NOT.
    //
    // `data?.value === undefined` at error severity made a factor with no
    // numeric level an INVALID GRAPH. The repair machinery therefore had no
    // honest option: every writer that could satisfy this gate could only do so
    // by inventing a number. Measured 29 Aug 2026: 60 of 60 present factor
    // values were exactly `0.5` across 18 drafts and all three brief classes —
    // distinct value set literally `[0.5]`. This line is the forcing function
    // behind that figure.
    //
    // A factor that STATES ITS LEVEL AS A DISTRIBUTION is now a complete answer
    // to "what is this factor's level?". It is not a missing field; it is a
    // stated one. That covers BOTH of the remaining legitimate states:
    //   · a defensible estimate WITH its uncertainty — the model's own
    //     `uniform(0.6, 1.0)`; and
    //   · a genuine unknown — `uniform(0,1)` carrying `prior_is_unquantified`.
    //
    // ⚠ THE GATE ASKS THE WIDER QUESTION ON PURPOSE, AND THE TWO PREDICATES ARE
    // NOT INTERCHANGEABLE (CLAUDE.md trap 21). `factorHasExpressiblePrior` asks
    // "has the level been stated?"; `factorIsExplicitlyUnquantified` asks "is
    // that statement an admission of ignorance?". Gating on the NARROW one
    // would refuse a model's informative prior, and `fixControllableMissingData`
    // would then repair the refusal by writing `0.5` — reinstating the exact
    // placeholder this change removes, for precisely the population that
    // carries the most information.
    //
    // ⚠ THE GATE IS NOT DELETED, AND THE DIFFERENCE IS THE WHOLE SAFETY
    // ARGUMENT. A factor carrying NEITHER a value NOR an explicit unknown is
    // still an error, because that is a structurally broken node rather than an
    // honest one. `factorIsExplicitlyUnquantified` requires POSITIVE evidence
    // (the flag present and literally `true`); it is deliberately not "has a
    // prior", which would exempt every genuine external prior — two of which
    // sit in the captured wire corpus with a real `uniform(0,1)` range and no
    // flag (`fac_nrr`, `fac_legal_clearance`). Widening a predicate that guards
    // two opposite harms is how this estate loses gates (CLAUDE.md trap 22b).
    //
    // The relaxation is scoped to `value` ALONE. `extractionType`,
    // `factor_type` and `uncertainty_drivers` are separate requirements and an
    // explicit unknown says nothing about any of them.
    const statesLevelAsDistribution = factorHasExpressiblePrior(factor);

    if (info.category === "controllable") {
      // CONTROLLABLE_MISSING_DATA: Must have value, extractionType, factor_type, uncertainty_drivers
      const missing: string[] = [];
      if (data?.value === undefined && !statesLevelAsDistribution) missing.push("value");
      if (!data?.extractionType) missing.push("extractionType");
      if (!data?.factor_type) missing.push("factor_type");
      if (!data?.uncertainty_drivers) missing.push("uncertainty_drivers");

      if (missing.length > 0) {
        issues.push({
          code: "CONTROLLABLE_MISSING_DATA",
          severity: "error",
          message: `Controllable factor "${factor.id}" missing required data: ${missing.join(", ")}`,
          path: validatorNodePath(factor.id),
          context: { missing },
        });
      }
    } else if (info.category === "observable") {
      // OBSERVABLE_MISSING_DATA: Must have value and extractionType
      // Same relaxation, same discriminator — see the block above. Observables
      // are a DISJOINT population (`ensureControllableFactorBaselines` gates on
      // the option→factor edge set and never reaches them), so the two arms are
      // written out rather than shared.
      const missing: string[] = [];
      if (data?.value === undefined && !statesLevelAsDistribution) missing.push("value");
      if (!data?.extractionType) missing.push("extractionType");

      if (missing.length > 0) {
        issues.push({
          code: "OBSERVABLE_MISSING_DATA",
          severity: "error",
          message: `Observable factor "${factor.id}" missing required data: ${missing.join(", ")}`,
          path: validatorNodePath(factor.id),
          context: { missing },
        });
      }

      // OBSERVABLE_EXTRA_DATA: Must NOT have factor_type or uncertainty_drivers
      const extra: string[] = [];
      if (data?.factor_type) extra.push("factor_type");
      if (data?.uncertainty_drivers) extra.push("uncertainty_drivers");

      if (extra.length > 0) {
        issues.push({
          code: "OBSERVABLE_EXTRA_DATA",
          severity: "error",
          message: `Observable factor "${factor.id}" should not have: ${extra.join(", ")}`,
          path: validatorNodePath(factor.id),
          context: { extra },
        });
      }
    } else if (info.category === "external") {
      // EXTERNAL_HAS_DATA: Must NOT have value, factor_type, or uncertainty_drivers
      const extra: string[] = [];
      if (data?.value !== undefined) extra.push("value");
      if (data?.factor_type) extra.push("factor_type");
      if (data?.uncertainty_drivers) extra.push("uncertainty_drivers");

      if (extra.length > 0) {
        issues.push({
          code: "EXTERNAL_HAS_DATA",
          severity: "error",
          message: `External factor "${factor.id}" should not have: ${extra.join(", ")}`,
          path: validatorNodePath(factor.id),
          context: { extra },
        });
      }
    }

    // CATEGORY_MISMATCH: If explicit category (V12.4+) exists, must match inferred
    if (info.explicitCategory && info.explicitCategory !== info.category) {
      issues.push({
        code: "CATEGORY_MISMATCH",
        severity: "error",
        message: `Factor "${factor.id}" declares category "${info.explicitCategory}" but structure indicates "${info.category}"`,
        path: validatorNodePath(factor.id),
        context: { explicit: info.explicitCategory, inferred: info.category },
      });
    }
  }

  return issues;
}

// =============================================================================
// Tier 5: Semantic Integrity
// =============================================================================

function validateSemantic(
  graph: GraphT,
  nodeMap: NodeMap,
  adjacency: AdjacencyLists,
  factorCategories: Map<string, FactorCategoryInfo>
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const options = nodeMap.byKind.get("option") ?? [];
  const goals = nodeMap.byKind.get("goal") ?? [];

  if (goals.length === 0) return issues;
  const goalId = goals[0].id;

  // Build reachability from goal (reverse)
  const canReachGoal = bfsReverse([goalId], adjacency);

  // NO_EFFECT_PATH: Each option must have >=1 controllable factor with path to goal
  for (const option of options) {
    const optionTargets = adjacency.forward.get(option.id) ?? [];
    const controllableWithPath = optionTargets.filter((targetId) => {
      const factorInfo = factorCategories.get(targetId);
      return factorInfo?.category === "controllable" && canReachGoal.has(targetId);
    });

    if (controllableWithPath.length === 0) {
      issues.push({
        code: "NO_EFFECT_PATH",
        severity: "error",
        message: `Option "${option.id}" has no controllable factors with path to goal`,
        path: validatorNodePath(option.id),
        context: { targets: optionTargets },
      });
    }
  }

  // OPTIONS_IDENTICAL: Options must have different intervention signatures
  const signatureToOptions = new Map<string, string[]>();
  for (const option of options) {
    const data = option.data as OptionDataT | undefined;
    if (!data?.interventions) continue;

    const signature = buildInterventionSignature(data.interventions);
    const existing = signatureToOptions.get(signature) ?? [];
    existing.push(option.id);
    signatureToOptions.set(signature, existing);
  }

  for (const [signature, optionIds] of signatureToOptions) {
    if (optionIds.length > 1) {
      issues.push({
        code: "OPTIONS_IDENTICAL",
        severity: "error",
        message: `Options have identical intervention signatures: ${optionIds.join(", ")}`,
        context: { optionIds, signature },
      });
    }
  }

  // ⭐⭐⭐ OPTION_NO_OP: a non-baseline option must actually change something.
  //
  // ── THE MEASURED DEFECT THIS CLOSES ───────────────────────────────────────
  // Paul's session, 11 Sep 2026 (`olumi-debug-5b41f0eb-20260911.json`). The
  // brief asked whether to raise the Pro plan price "from £49 to £59". Three
  // options were drafted against a factor whose baseline is 0.49, and the
  // first — labelled with the question sentence verbatim — carried
  // `sets_to` 0.49. It modelled changing nothing. Raising the price hurts in
  // that model, so the do-nothing arm had the least downside: ISL returned
  // −0.0226 / −0.1358 / −0.0792, the user was shown 73.4% / 25.1% / 1.5%, and
  // the assistant said *"increase the Pro plan price from £49 to £59 …
  // currently leads"*. The product recommended raising the price while
  // modelling not raising it, at `warnings_count: 0`.
  //
  // ── WRITTEN AGAINST THE SPEC, NOT AGAINST THE FAILURE MODE (trap 13d) ─────
  // The phrasing that produced it is where we came in, not the property.
  // Nothing here reads a label, a verb or a number in a sentence: a predicate
  // over the wording would have to be right about natural language in both
  // directions, and four consecutive rounds on one such predicate have already
  // proved this estate cannot bound one (trap 22f). What an option DOES is
  // decidable, so that is what is decided.
  //
  // ── NAMED APART FROM `OPTIONS_IDENTICAL` (trap 21) ────────────────────────
  // That code answers *"are these two options the same as each other?"*; this
  // answers *"is this option the same as the status quo?"*. Paul's graph
  // raised neither: its three options were pairwise distinct, and the defect
  // was invisible to a predicate that only ever compares options to siblings.
  // Reconciling the two would lose exactly the case that shipped.
  //
  // ── WHY REFUSAL, AND NOT "DROP IT" OR "MARK IT THE BASELINE" ──────────────
  // Dropping asserts *this alternative does not matter*; marking it baseline
  // asserts *these words describe the status quo*. Both put words in the
  // user's mouth about a sentence the user wrote, and this file's siblings
  // refuse rather than guess for exactly that reason (`projector.ts:2250`
  // *"DO NOT GUESS A DIRECTION. ASK"*; `objective-label.ts`'s refusal set;
  // `utils/amount-range.ts`'s two refusals).
  //
  // ⭐ AND MARKING IT BASELINE WAS CHECKED AGAINST THE HARM, NOT REASONED
  // ABOUT: it does not remove it. `analysable-option-gate.ts` HOLDS an
  // `is_baseline` option at its factors' observed values and still submits it,
  // so the same arm would still have been compared and still have won — now
  // under a flag saying "current arrangement" while its label says "increase
  // the price". A remedy that relabels the lie is not a remedy.
  //
  // Refusal claims only what is true: we could not build a model whose options
  // differ from the status quo. It is not a dead end — the enforcement gate
  // this feeds carries `retryable: true` with a recovery envelope, and
  // `unified-pipeline/retry-directive.ts` tells attempt 2 both ways out.
  for (const option of options) {
    const data = option.data as OptionDataT | undefined;
    const interventions = data?.interventions;
    // No stated magnitude is a DIFFERENT question, with different owners
    // (NO_EFFECT_PATH, OPTIONS_IDENTICAL). An absent map is not a no-op.
    if (!interventions) continue;
    const entries = Object.entries(interventions);
    if (entries.length === 0) continue;

    // The status quo is ALLOWED to equal the status quo. Read through the one
    // authority for the two surfaces this flag can arrive on — the draft model
    // emits them disagreeing in 5 of 30 measured samples, and a second copy of
    // the reconciliation rule here is how the same option becomes a baseline on
    // one code path and not on another (`cee/baseline-identity.ts`).
    if (readIsBaseline(option as BaselineFlagSurfaces) === true) continue;

    const matchedFactorIds: string[] = [];
    let changesNothing = true;
    for (const [factorId, level] of entries) {
      const target = nodeMap.byId.get(factorId);
      // A dangling or non-factor reference is INVALID_INTERVENTION_REF's
      // question, raised below. Not ours, and not evidence of a no-op.
      if (!target || target.kind !== "factor") { changesNothing = false; break; }
      if (typeof level !== "number" || !Number.isFinite(level)) { changesNothing = false; break; }
      const baseline = readFactorBaselineLevel(target);
      // A factor the brief states no value for cannot prove an option changes
      // nothing. Refusing to accuse is the safe direction here: a false
      // OPTION_NO_OP withdraws a real alternative, which is the worse harm of
      // the two this one predicate stands between (trap 22b).
      if (baseline === undefined) { changesNothing = false; break; }
      if (!levelsAreIdentical(level, baseline)) { changesNothing = false; break; }
      matchedFactorIds.push(factorId);
    }

    if (changesNothing) {
      issues.push({
        code: "OPTION_NO_OP",
        severity: "error",
        message:
          `Option "${option.id}" changes nothing: every factor it intervenes on is already at that level`,
        path: `${validatorNodePath(option.id)}.data.interventions`,
        // Ids only — no magnitudes, per the same rule `schema-v3.ts:1095`
        // states for its own diagnostic.
        context: { optionId: option.id, factorIds: matchedFactorIds },
      });
    }
  }

  // INVALID_INTERVENTION_REF: Option intervention references non-existent or non-factor node
  for (const option of options) {
    const data = option.data as OptionDataT | undefined;
    if (!data?.interventions) continue;

    for (const factorId of Object.keys(data.interventions)) {
      const targetNode = nodeMap.byId.get(factorId);
      if (!targetNode) {
        issues.push({
          code: "INVALID_INTERVENTION_REF",
          severity: "error",
          message: `Option "${option.id}" references non-existent node: ${factorId}`,
          path: `${validatorNodePath(option.id)}.data.interventions`,
          context: { factorId },
        });
      } else if (targetNode.kind !== "factor") {
        issues.push({
          code: "INVALID_INTERVENTION_REF",
          severity: "error",
          message: `Option "${option.id}" intervention references non-factor node: ${factorId} (kind: ${targetNode.kind})`,
          path: `${validatorNodePath(option.id)}.data.interventions`,
          context: { factorId, actualKind: targetNode.kind },
        });
      }
    }
  }

  // GOAL_NUMBER_AS_FACTOR: Factor labels should not be goal target values
  // E.g., "£20k MRR" is a goal target, not a causal factor
  const factors = nodeMap.byKind.get("factor") ?? [];
  for (const factor of factors) {
    const label = factor.label ?? factor.id;
    if (isGoalNumberLabel(label)) {
      // Determine controllability using EITHER:
      // 1. category === 'controllable' (declared in factor data), OR
      // 2. Presence of option→factor edges
      // Only flag if BOTH indicate "not controllable"
      const factorInfo = factorCategories.get(factor.id);
      const hasOptionEdge = factorInfo?.hasOptionEdge ?? false;
      const declaredControllable = (factor as any).category === "controllable";
      const isControllable = hasOptionEdge || declaredControllable;

      if (!isControllable) {
        issues.push({
          code: "GOAL_NUMBER_AS_FACTOR",
          severity: "error",
          message: `Factor "${label}" appears to be a goal target value, not a causal factor`,
          path: validatorNodePath(factor.id),
          context: {
            label,
            factorId: factor.id,
            hasOptionEdge,
            category: (factor as any).category ?? null,
          },
        });
      }
    }
  }

  // STRUCTURAL_EDGE_NOT_CANONICAL_ERROR: option→factor edges must have canonical values
  // This is an ERROR for option→factor (triggering repair), WARNING for decision→option
  for (let i = 0; i < graph.edges.length; i++) {
    const edge = graph.edges[i];
    const fromNode = nodeMap.byId.get(edge.from);
    const toNode = nodeMap.byId.get(edge.to);

    if (!fromNode || !toNode) continue;

    // Only check option→factor edges (structural edges that require canonical values)
    if (fromNode.kind === "option" && toNode.kind === "factor") {
      const mean = edge.strength_mean ?? edge.weight;
      const std = edge.strength_std;
      const prob = edge.belief_exists ?? edge.belief;
      const direction = edge.effect_direction;

      // T2: Strict canonical - exactly mean=1.0, std=0.01, prob=1.0, direction="positive"
      // undefined values trigger error (will be repaired by fixNonCanonicalStructuralEdges)
      const isCanonical =
        mean === CANONICAL_EDGE.mean &&
        std === CANONICAL_EDGE.std &&
        prob === CANONICAL_EDGE.prob &&
        direction === CANONICAL_EDGE.direction;

      if (!isCanonical) {
        issues.push({
          code: "STRUCTURAL_EDGE_NOT_CANONICAL_ERROR",
          severity: "error",
          message: `Option→factor structural edge must have canonical values (mean=1.0, std=0.01, prob=1.0, direction="positive")`,
          path: `edges[${i}]`,
          context: {
            from: edge.from,
            to: edge.to,
            expected: { mean: CANONICAL_EDGE.mean, std: CANONICAL_EDGE.std, prob: CANONICAL_EDGE.prob, direction: CANONICAL_EDGE.direction },
            actual: { mean, std, prob, direction },
          },
        });
      }
    }
  }

  return issues;
}

// =============================================================================
// Tier 6: Numeric Validation
// =============================================================================

function validateNumeric(graph: GraphT): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Check nodes for NaN/Infinity in data.value
  for (const node of graph.nodes) {
    if (node.kind === "factor" && node.data) {
      const data = node.data as FactorDataT;
      if (isInvalidNumber(data.value)) {
        issues.push({
          code: "NAN_VALUE",
          severity: "error",
          message: `Factor "${node.id}" has invalid numeric value: ${data.value}`,
          path: `${validatorNodePath(node.id)}.data.value`,
          context: { value: data.value },
        });
      }
      if (isInvalidNumber(data.baseline)) {
        issues.push({
          code: "NAN_VALUE",
          severity: "error",
          message: `Factor "${node.id}" has invalid baseline: ${data.baseline}`,
          path: `${validatorNodePath(node.id)}.data.baseline`,
          context: { value: data.baseline },
        });
      }
    }

    if (node.kind === "option" && node.data) {
      const data = node.data as OptionDataT;
      if (data.interventions) {
        for (const [factorId, value] of Object.entries(data.interventions)) {
          if (isInvalidNumber(value)) {
            issues.push({
              code: "NAN_VALUE",
              severity: "error",
              message: `Option "${node.id}" has invalid intervention value for ${factorId}: ${value}`,
              path: `${validatorNodePath(node.id)}.data.interventions.${factorId}`,
              context: { factorId, value },
            });
          }
        }
      }
    }
  }

  // Check edges for NaN/Infinity in strength_mean, strength_std, belief_exists
  for (let i = 0; i < graph.edges.length; i++) {
    const edge = graph.edges[i];
    if (isInvalidNumber(edge.strength_mean)) {
      issues.push({
        code: "NAN_VALUE",
        severity: "error",
        message: `Edge has invalid strength_mean: ${edge.strength_mean}`,
        path: `edges[${i}]`,
        context: { field: "strength_mean", value: edge.strength_mean },
      });
    }
    if (isInvalidNumber(edge.strength_std)) {
      issues.push({
        code: "NAN_VALUE",
        severity: "error",
        message: `Edge has invalid strength_std: ${edge.strength_std}`,
        path: `edges[${i}]`,
        context: { field: "strength_std", value: edge.strength_std },
      });
    }
    if (isInvalidNumber(edge.belief_exists)) {
      issues.push({
        code: "NAN_VALUE",
        severity: "error",
        message: `Edge has invalid belief_exists: ${edge.belief_exists}`,
        path: `edges[${i}]`,
        context: { field: "belief_exists", value: edge.belief_exists },
      });
    }
  }

  return issues;
}

// =============================================================================
// Warnings
// =============================================================================

function collectWarnings(
  graph: GraphT,
  nodeMap: NodeMap,
  factorCategories: Map<string, FactorCategoryInfo>
): ValidationIssue[] {
  const warnings: ValidationIssue[] = [];

  // Edge warnings
  for (let i = 0; i < graph.edges.length; i++) {
    const edge = graph.edges[i];
    const fromNode = nodeMap.byId.get(edge.from);
    const toNode = nodeMap.byId.get(edge.to);

    if (!fromNode || !toNode) continue;

    // STRENGTH_OUT_OF_RANGE: mean outside [-1, +1]
    if (edge.strength_mean !== undefined) {
      if (edge.strength_mean < -1 || edge.strength_mean > 1) {
        warnings.push({
          code: "STRENGTH_OUT_OF_RANGE",
          severity: "warn",
          message: `Edge strength_mean ${edge.strength_mean} outside [-1, +1]`,
          path: `edges[${i}]`,
          context: { value: edge.strength_mean },
        });
      }
    }

    // PROBABILITY_OUT_OF_RANGE: prob outside [0, 1]
    if (edge.belief_exists !== undefined) {
      if (edge.belief_exists < 0 || edge.belief_exists > 1) {
        warnings.push({
          code: "PROBABILITY_OUT_OF_RANGE",
          severity: "warn",
          message: `Edge belief_exists ${edge.belief_exists} outside [0, 1]`,
          path: `edges[${i}]`,
          context: { value: edge.belief_exists },
        });
      }
    }

    // OUTCOME_NEGATIVE_POLARITY: outcome->goal with negative mean
    if (fromNode.kind === "outcome" && toNode.kind === "goal") {
      if (edge.strength_mean !== undefined && edge.strength_mean < 0) {
        warnings.push({
          code: "OUTCOME_NEGATIVE_POLARITY",
          severity: "warn",
          message: `Outcome->goal edge has negative strength_mean (${edge.strength_mean})`,
          path: `edges[${i}]`,
          context: { from: edge.from, to: edge.to, value: edge.strength_mean },
        });
      }
    }

    // RISK_POSITIVE_POLARITY: risk->goal with positive mean
    if (fromNode.kind === "risk" && toNode.kind === "goal") {
      if (edge.strength_mean !== undefined && edge.strength_mean > 0) {
        warnings.push({
          code: "RISK_POSITIVE_POLARITY",
          severity: "warn",
          message: `Risk->goal edge has positive strength_mean (${edge.strength_mean})`,
          path: `edges[${i}]`,
          context: { from: edge.from, to: edge.to, value: edge.strength_mean },
        });
      }
    }

    // LOW_EDGE_CONFIDENCE: exists_probability < 0.3
    if (edge.belief_exists !== undefined && edge.belief_exists < 0.3) {
      warnings.push({
        code: "LOW_EDGE_CONFIDENCE",
        severity: "warn",
        message: `Edge has low confidence (belief_exists: ${edge.belief_exists})`,
        path: `edges[${i}]`,
        context: { value: edge.belief_exists },
      });
    }

    // STRUCTURAL_EDGE_NOT_CANONICAL: decision->option or option->factor not canonical
    const isStructuralEdge =
      (fromNode.kind === "decision" && toNode.kind === "option") ||
      (fromNode.kind === "option" && toNode.kind === "factor");

    if (isStructuralEdge) {
      const mean = edge.strength_mean ?? edge.weight;
      const std = edge.strength_std;
      const prob = edge.belief_exists ?? edge.belief;
      const direction = edge.effect_direction;

      const isCanonical =
        mean === CANONICAL_EDGE.mean &&
        (std === undefined || std <= CANONICAL_EDGE.stdMax) &&
        prob === CANONICAL_EDGE.prob &&
        (direction === undefined || direction === CANONICAL_EDGE.direction);

      if (!isCanonical) {
        warnings.push({
          code: "STRUCTURAL_EDGE_NOT_CANONICAL",
          severity: "warn",
          message: `Structural edge ${fromNode.kind}->${toNode.kind} is not canonical`,
          path: `edges[${i}]`,
          context: {
            expected: CANONICAL_EDGE,
            actual: { mean, std, prob, direction },
          },
        });
      }
    } else {
      // LOW_STD_NON_STRUCTURAL: Non-structural edges should have std >= 0.05
      const std = edge.strength_std;
      if (std !== undefined && std < 0.05) {
        warnings.push({
          code: "LOW_STD_NON_STRUCTURAL",
          severity: "warn",
          message: `Non-structural edge has low std (${std}); causal edges should have std >= 0.05`,
          path: `edges[${i}]`,
          context: { from: edge.from, to: edge.to, std, threshold: 0.05 },
        });
      }
    }
  }

  // Factor warnings
  for (const factor of nodeMap.byKind.get("factor") ?? []) {
    const info = factorCategories.get(factor.id);
    if (!info || info.category !== "controllable") continue;

    const data = factor.data as FactorDataT | undefined;

    // EMPTY_UNCERTAINTY_DRIVERS: Controllable has empty array
    if (data?.uncertainty_drivers && data.uncertainty_drivers.length === 0) {
      warnings.push({
        code: "EMPTY_UNCERTAINTY_DRIVERS",
        severity: "warn",
        message: `Controllable factor "${factor.id}" has empty uncertainty_drivers`,
        path: `${validatorNodePath(factor.id)}.data.uncertainty_drivers`,
      });
    }
  }

  return warnings;
}

// =============================================================================
// Post-Normalisation Validation
// =============================================================================

/**
 * Validate graph after normalisation (clamping).
 * Checks for sign mismatch between effect_direction and strength_mean.
 */
export function validateGraphPostNormalisation(
  input: GraphValidationInput
): GraphValidationResult {
  const { graph, requestId } = input;
  const issues: ValidationIssue[] = [];

  for (let i = 0; i < graph.edges.length; i++) {
    const edge = graph.edges[i];

    // SIGN_MISMATCH: effect_direction contradicts sign(strength_mean)
    if (edge.effect_direction && edge.strength_mean !== undefined && edge.strength_mean !== 0) {
      const signIsPositive = edge.strength_mean > 0;
      const directionIsPositive = edge.effect_direction === "positive";

      if (signIsPositive !== directionIsPositive) {
        issues.push({
          code: "SIGN_MISMATCH",
          severity: "error",
          message: `Edge effect_direction "${edge.effect_direction}" contradicts strength_mean sign (${edge.strength_mean})`,
          path: `edges[${i}]`,
          context: {
            effect_direction: edge.effect_direction,
            strength_mean: edge.strength_mean,
          },
        });
      }
    }
  }

  if (issues.length > 0) {
    log.warn(
      {
        event: "graph_validator.post_norm.issues",
        requestId,
        issueCount: issues.length,
      },
      "Post-normalisation validation found issues"
    );
  }

  return {
    valid: issues.length === 0,
    errors: issues,
    warnings: [],
  };
}

// =============================================================================
// Main Validation Function
// =============================================================================

/**
 * Validate a graph for structural, topological, and semantic correctness.
 * Runs after Zod schema validation, before enrichment.
 *
 * @param input - The graph to validate with optional request ID
 * @returns Validation result with errors and warnings
 */
/**
 * Coaching + causal-claims referential integrity (v0.11.0 schema amendment).
 *
 * Checks (all warning-level — never reject, just emit):
 *  (a) `causal_claims[*].from`/`to`/`via` exist in `nodes[]`
 *      → CAUSAL_CLAIM_INVALID_REF
 *  (b) `causal_claims[*].between` (unmeasured_confounder) contains exactly
 *      two distinct IDs, both pointing at factor-kind nodes
 *      → CAUSAL_CLAIM_BETWEEN_INVALID
 *  (c) `coaching.widening_log.elements_added[*]` exist in `nodes[]`
 *      → WIDENING_LOG_INVALID_REF
 *  (d) direct_effect / mediation_only / no_direct_effect claims should not
 *      target the goal node when the claim type implies an intermediate
 *      causal relation (warn only — goal-edge structural validator already
 *      rejects most cases)
 *      → CAUSAL_CLAIM_GOAL_TARGET
 *  (e) Cardinality: when graph has 5+ causal-typed edges,
 *      `causal_claims.length` outside `[3, 8]` warns
 *      → CAUSAL_CLAIMS_CARDINALITY_OFF
 */
function validateCoachingAndCausalClaimsRefs(
  nodeMap: NodeMap,
  edges: EdgeT[],
  coaching: unknown,
  causalClaims: unknown,
): ValidationIssue[] {
  const warnings: ValidationIssue[] = [];

  // Goal node ID for check (d). Validator earlier tiers ensure exactly one
  // goal; pick whichever first.
  const goalNode = (nodeMap.byKind.get("goal") ?? [])[0];
  const goalId = goalNode?.id;

  // (a)–(b)–(d) Causal claim references
  if (Array.isArray(causalClaims)) {
    for (const claim of causalClaims) {
      if (!claim || typeof claim !== "object") continue;
      const c = claim as Record<string, unknown>;
      const claimType = c.type;

      if (
        claimType === "direct_effect" ||
        claimType === "mediation_only" ||
        claimType === "no_direct_effect"
      ) {
        for (const fieldName of ["from", "to", "via"]) {
          const v = c[fieldName];
          if (typeof v !== "string") continue;
          if (!nodeMap.byId.has(v)) {
            warnings.push({
              code: "CAUSAL_CLAIM_INVALID_REF",
              severity: "warn",
              message: `causal_claims[*].${fieldName}="${v}" does not match any node id`,
              context: { claim_type: claimType, field: fieldName, value: v },
            });
          }
        }
        // (d) goal targeting — warn only, goal-edge validator handles errors
        if (goalId) {
          for (const fieldName of ["from", "via"]) {
            const v = c[fieldName];
            if (typeof v === "string" && v === goalId) {
              warnings.push({
                code: "CAUSAL_CLAIM_GOAL_TARGET",
                severity: "warn",
                message: `causal_claims[*].${fieldName}="${v}" targets the goal node, but type="${claimType}" implies an intermediate causal relation`,
                context: { claim_type: claimType as string, field: fieldName, value: v },
              });
            }
          }
        }
      } else if (claimType === "unmeasured_confounder") {
        const between = c.between;
        if (Array.isArray(between)) {
          if (between.length !== 2) {
            warnings.push({
              code: "CAUSAL_CLAIM_BETWEEN_INVALID",
              severity: "warn",
              message: `unmeasured_confounder.between must contain exactly two ids, got ${between.length}`,
              context: { length: between.length },
            });
          } else {
            const [a, b] = between as [unknown, unknown];
            if (typeof a === "string" && typeof b === "string") {
              if (a === b) {
                warnings.push({
                  code: "CAUSAL_CLAIM_BETWEEN_INVALID",
                  severity: "warn",
                  message: `unmeasured_confounder.between contains the same id twice ("${a}")`,
                  context: { value: a },
                });
              }
              for (const id of [a, b]) {
                const node = nodeMap.byId.get(id);
                if (!node) {
                  warnings.push({
                    code: "CAUSAL_CLAIM_INVALID_REF",
                    severity: "warn",
                    message: `unmeasured_confounder.between id "${id}" does not match any node id`,
                    context: { value: id },
                  });
                } else if (node.kind !== "factor") {
                  warnings.push({
                    code: "CAUSAL_CLAIM_BETWEEN_INVALID",
                    severity: "warn",
                    message: `unmeasured_confounder.between id "${id}" must be a factor-kind node (got kind="${node.kind}")`,
                    context: { value: id, kind: node.kind },
                  });
                }
              }
            }
          }
        }
      }
    }

    // (e) Cardinality diagnostic — count causal-typed edges (directed
    // edges between non-structural nodes). Decision→option and
    // option→factor are structural; we count factor→outcome / risk /
    // goal etc. Approximation: any directed edge whose endpoints are
    // not the decision node or option-kind nodes counts as causal.
    const decisionNodes = nodeMap.byKind.get("decision") ?? [];
    const decisionIds = new Set(decisionNodes.map((n) => n.id));
    const optionIds = new Set((nodeMap.byKind.get("option") ?? []).map((n) => n.id));
    const causalEdgeCount = edges.filter((e) => {
      if (!isDirectedEdge(e)) return false;
      if (decisionIds.has(e.from) && optionIds.has(e.to)) return false; // structural
      if (optionIds.has(e.from)) return false; // option→factor structural
      return true;
    }).length;
    if (causalEdgeCount >= 5) {
      const claimsLen = causalClaims.length;
      if (claimsLen < 3 || claimsLen > 8) {
        warnings.push({
          code: "CAUSAL_CLAIMS_CARDINALITY_OFF",
          severity: "warn",
          message: `causal_claims.length=${claimsLen} is outside [3, 8] for graph with ${causalEdgeCount} causal-typed edges`,
          context: { claims_length: claimsLen, causal_edge_count: causalEdgeCount },
        });
      }
    }
  }

  // (c) widening_log.elements_added refs
  if (coaching && typeof coaching === "object") {
    const c = coaching as Record<string, unknown>;
    const wl = c.widening_log;
    if (wl && typeof wl === "object") {
      const added = (wl as Record<string, unknown>).elements_added;
      if (Array.isArray(added)) {
        for (const v of added) {
          if (typeof v !== "string") continue;
          if (!nodeMap.byId.has(v)) {
            warnings.push({
              code: "WIDENING_LOG_INVALID_REF",
              severity: "warn",
              message: `coaching.widening_log.elements_added contains "${v}" which does not match any node id`,
              context: { value: v },
            });
          }
        }
      }
    }
  }

  return warnings;
}

export function validateGraph(input: GraphValidationInput): GraphValidationResult {
  const { graph, requestId, phase, coaching, causalClaims } = input;
  const startTime = Date.now();

  log.info(
    {
      event: "graph_validator.start",
      requestId,
      phase,
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
    },
    "Starting graph validation"
  );

  // Build lookup structures
  const nodeMap = buildNodeMap(graph.nodes);
  const adjacency = buildAdjacencyLists(graph.edges);
  const factorCategories = inferFactorCategories(graph.nodes, graph.edges, nodeMap);

  // Collect all errors (don't short-circuit)
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  // Tier 1: Structural
  errors.push(...validateStructural(graph, nodeMap));

  // Tier 2: Topology
  errors.push(...validateTopology(graph, nodeMap, adjacency, factorCategories));

  // Tier 3: Reachability
  const reachabilityResult = validateReachability(graph, nodeMap, adjacency, factorCategories);
  errors.push(...reachabilityResult.errors);

  // Tier 4: Factor Data Consistency
  errors.push(...validateFactorData(nodeMap, factorCategories));

  // Tier 5: Semantic Integrity
  errors.push(...validateSemantic(graph, nodeMap, adjacency, factorCategories));

  // Tier 6: Numeric
  errors.push(...validateNumeric(graph));

  // Collect warnings
  warnings.push(...collectWarnings(graph, nodeMap, factorCategories));

  // v0.11.0 schema amendment: coaching + causal-claims referential integrity
  // (warning-level only; never reject). When coaching/causalClaims absent
  // from input, this is a no-op.
  warnings.push(
    ...validateCoachingAndCausalClaimsRefs(nodeMap, graph.edges, coaching, causalClaims),
  );

  // Append outcome/risk reachability exemption info issues
  warnings.push(...reachabilityResult.infoIssues);

  // Compute controllability summary metadata
  const exemptNodeIds = reachabilityResult.infoIssues
    .map((i) => i.context?.nodeId as string)
    .filter(Boolean);
  const controllability_summary = computeControllabilitySummary(
    graph, nodeMap, adjacency, factorCategories, exemptNodeIds
  );

  const durationMs = Date.now() - startTime;

  log.info(
    {
      event: "graph_validator.complete",
      requestId,
      phase,
      errorCount: errors.length,
      warningCount: warnings.length,
      controllability_summary,
      durationMs,
      valid: errors.length === 0,
    },
    errors.length === 0 ? "Graph validation passed" : "Graph validation failed"
  );

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    controllability_summary,
  };
}
