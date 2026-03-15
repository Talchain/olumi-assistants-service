/**
 * Repair Pipeline Test
 *
 * Loads failed v2 challenger response JSONs, runs them through the production
 * repair layers (simpleRepair + STRP), then re-validates with the evaluator's
 * structural validator.
 *
 * Usage:
 *   npx tsx tools/graph-evaluator/scripts/repair-test.ts
 */

import fs from "node:fs";
import path from "node:path";
import { validateStructural } from "../src/validator.js";
import type { ParsedGraph } from "../src/types.js";

// ---------------------------------------------------------------------------
// Forbidden edge removal (production deterministic sweep, Bucket A)
// ---------------------------------------------------------------------------

const ALLOWED_EDGE_PATTERNS: Array<{ from: string; to: string }> = [
  { from: "decision", to: "option" },
  { from: "option", to: "factor" },
  { from: "factor", to: "outcome" },
  { from: "factor", to: "risk" },
  { from: "factor", to: "factor" },
  { from: "outcome", to: "goal" },
  { from: "risk", to: "goal" },
];

function isEdgeAllowed(fromKind: string, toKind: string): boolean {
  return ALLOWED_EDGE_PATTERNS.some(
    (p) => p.from === fromKind && p.to === toKind
  );
}

// ---------------------------------------------------------------------------
// Cycle breaking (deterministic: remove back-edges via topological order)
// ---------------------------------------------------------------------------

function breakCycles(graph: ParsedGraph): { removed: number } {
  const { nodes, edges } = graph;
  const nodeSet = new Set(nodes.map((n) => n.id));
  // Compute topological order using Kahn's algorithm
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const n of nodes) {
    inDegree.set(n.id, 0);
    adj.set(n.id, []);
  }
  for (const e of edges) {
    if (e.edge_type === "bidirected") continue;
    if (!nodeSet.has(e.from) || !nodeSet.has(e.to)) continue;
    adj.get(e.from)!.push(e.to);
    inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1);
  }
  const order: string[] = [];
  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }
  while (queue.length > 0) {
    const cur = queue.shift()!;
    order.push(cur);
    for (const nb of adj.get(cur) ?? []) {
      const nd = (inDegree.get(nb) ?? 0) - 1;
      inDegree.set(nb, nd);
      if (nd === 0) queue.push(nb);
    }
  }
  if (order.length === nodes.length) return { removed: 0 }; // No cycle

  // Use topological rank to identify back-edges
  const rank = new Map<string, number>();
  order.forEach((id, i) => rank.set(id, i));
  // Nodes not in order are in cycles — give them max rank
  for (const n of nodes) {
    if (!rank.has(n.id)) rank.set(n.id, nodes.length);
  }

  let removed = 0;
  graph.edges = edges.filter((e) => {
    if (e.edge_type === "bidirected") return true;
    const rFrom = rank.get(e.from) ?? nodes.length;
    const rTo = rank.get(e.to) ?? nodes.length;
    // Remove back-edges (from higher rank to lower or equal rank within cycle nodes)
    if (rFrom >= nodes.length && rTo >= nodes.length && rFrom >= rTo) {
      // Both in cycle — need to break one direction
      // Keep the first edge seen, remove reversals
      removed++;
      return false;
    }
    if (rFrom > rTo) {
      removed++;
      return false;
    }
    return true;
  });
  return { removed };
}

// ---------------------------------------------------------------------------
// Orphan wiring (adapted from production simpleRepair)
// ---------------------------------------------------------------------------

function wireOrphansToGoal(graph: ParsedGraph): { wired: number } {
  const goalNode = graph.nodes.find((n) => n.kind === "goal");
  if (!goalNode) return { wired: 0 };

  const outcomeRiskIds = new Set(
    graph.nodes.filter((n) => n.kind === "outcome" || n.kind === "risk").map((n) => n.id)
  );
  const alreadyWired = new Set<string>();
  for (const e of graph.edges) {
    if (e.to === goalNode.id && outcomeRiskIds.has(e.from)) {
      alreadyWired.add(e.from);
    }
  }

  let wired = 0;
  for (const id of outcomeRiskIds) {
    if (!alreadyWired.has(id)) {
      const node = graph.nodes.find((n) => n.id === id);
      graph.edges.push({
        from: id,
        to: goalNode.id,
        strength: { mean: node?.kind === "risk" ? -0.5 : 0.7, std: 0.15 },
        exists_probability: 0.9,
        effect_direction: node?.kind === "risk" ? "negative" : "positive",
      } as any);
      wired++;
    }
  }
  return { wired };
}

function wireOrphansFromCausalChain(graph: ParsedGraph): { wired: number } {
  const outcomeRiskIds = new Set(
    graph.nodes.filter((n) => n.kind === "outcome" || n.kind === "risk").map((n) => n.id)
  );
  const hasInbound = new Set<string>();
  for (const e of graph.edges) {
    const fromNode = graph.nodes.find((n) => n.id === e.from);
    if (fromNode?.kind === "factor" && outcomeRiskIds.has(e.to)) {
      hasInbound.add(e.to);
    }
  }

  const factors = graph.nodes.filter((n) => n.kind === "factor");
  const sourceFactor = factors.find((n) => n.category === "controllable") ?? factors[0];
  if (!sourceFactor) return { wired: 0 };

  let wired = 0;
  for (const id of outcomeRiskIds) {
    if (!hasInbound.has(id)) {
      graph.edges.push({
        from: sourceFactor.id,
        to: id,
        strength: { mean: 0.5, std: 0.2 },
        exists_probability: 0.75,
        effect_direction: "positive",
      } as any);
      wired++;
    }
  }
  return { wired };
}

// ---------------------------------------------------------------------------
// Forbidden edge removal
// ---------------------------------------------------------------------------

function removeForbiddenEdges(graph: ParsedGraph): { removed: number } {
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
  const before = graph.edges.length;
  graph.edges = graph.edges.filter((e) => {
    if (e.edge_type === "bidirected") return true;
    const fromNode = nodeMap.get(e.from);
    const toNode = nodeMap.get(e.to);
    if (!fromNode || !toNode) return false; // dangling
    return isEdgeAllowed(fromNode.kind, toNode.kind);
  });
  return { removed: before - graph.edges.length };
}

// ---------------------------------------------------------------------------
// Wire controllable factors missing option edges
// ---------------------------------------------------------------------------

function wireControllableFactors(graph: ParsedGraph): { wired: number } {
  const factorsWithOptionEdge = new Set<string>();
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
  for (const e of graph.edges) {
    const fromNode = nodeMap.get(e.from);
    const toNode = nodeMap.get(e.to);
    if (fromNode?.kind === "option" && toNode?.kind === "factor") {
      factorsWithOptionEdge.add(e.to);
    }
  }

  const controllableFactors = graph.nodes.filter(
    (n) => n.kind === "factor" && n.category === "controllable" && !factorsWithOptionEdge.has(n.id)
  );

  if (controllableFactors.length === 0) return { wired: 0 };

  // Wire from first option
  const firstOption = graph.nodes.find((n) => n.kind === "option");
  if (!firstOption) return { wired: 0 };

  let wired = 0;
  for (const factor of controllableFactors) {
    graph.edges.push({
      from: firstOption.id,
      to: factor.id,
      strength: { mean: 0.5, std: 0.1 },
      exists_probability: 0.9,
      effect_direction: "positive",
    } as any);
    wired++;
  }
  return { wired };
}

// ---------------------------------------------------------------------------
// Drop completely disconnected observable/external factors
// (Production deterministic sweep reclassifies unreachable factors as
//  external/droppable. For evaluator validation, removing zero-edge
//  observable/external factors is the equivalent deterministic repair.)
// ---------------------------------------------------------------------------

function dropDisconnectedObservables(graph: ParsedGraph): { dropped: string[] } {
  const edgeNodes = new Set<string>();
  for (const e of graph.edges) {
    edgeNodes.add(e.from);
    edgeNodes.add(e.to);
  }

  const dropped: string[] = [];
  graph.nodes = graph.nodes.filter((n) => {
    if (n.kind !== "factor") return true;
    if (n.category !== "observable" && n.category !== "external") return true;
    if (edgeNodes.has(n.id)) return true;
    dropped.push(n.id);
    return false;
  });
  return { dropped };
}

// ---------------------------------------------------------------------------
// Full repair pipeline
// ---------------------------------------------------------------------------

interface RepairResult {
  preRepairViolations: string[];
  postRepairViolations: string[];
  repairActions: string[];
  repaired: boolean;
}

function runRepairPipeline(graph: ParsedGraph): RepairResult {
  const actions: string[] = [];

  // Step 0: Pre-repair validation
  const preResult = validateStructural(graph);

  // Step 1: Remove forbidden edges (deterministic sweep Bucket A)
  const forbiddenResult = removeForbiddenEdges(graph);
  if (forbiddenResult.removed > 0) {
    actions.push(`Removed ${forbiddenResult.removed} forbidden edge(s)`);
  }

  // Step 2: Break cycles (deterministic sweep)
  const cycleResult = breakCycles(graph);
  if (cycleResult.removed > 0) {
    actions.push(`Removed ${cycleResult.removed} back-edge(s) to break cycles`);
  }

  // Step 3: Wire orphaned outcomes/risks to goal
  const wireGoalResult = wireOrphansToGoal(graph);
  if (wireGoalResult.wired > 0) {
    actions.push(`Wired ${wireGoalResult.wired} orphaned outcome/risk → goal`);
  }

  // Step 4: Wire orphaned outcomes/risks from causal chain
  const wireCausalResult = wireOrphansFromCausalChain(graph);
  if (wireCausalResult.wired > 0) {
    actions.push(`Wired ${wireCausalResult.wired} orphaned outcome/risk ← factor`);
  }

  // Step 5: Wire controllable factors missing option edges
  const wireControllableResult = wireControllableFactors(graph);
  if (wireControllableResult.wired > 0) {
    actions.push(`Wired ${wireControllableResult.wired} controllable factor(s) ← option`);
  }

  // Step 6: Drop disconnected observable/external factors
  const dropResult = dropDisconnectedObservables(graph);
  if (dropResult.dropped.length > 0) {
    actions.push(`Dropped ${dropResult.dropped.length} disconnected observable(s): ${dropResult.dropped.join(", ")}`);
  }

  // Step 7: Post-repair validation
  const postResult = validateStructural(graph);

  return {
    preRepairViolations: preResult.violations,
    postRepairViolations: postResult.violations,
    repairActions: actions,
    repaired: !preResult.valid && postResult.valid,
  };
}

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

interface FailedBrief {
  model: string;
  runId: string;
  briefId: string;
  violations: string[];
}

const FAILED_BRIEFS: FailedBrief[] = [
  // gpt-4.1 v2 failures
  { model: "gpt-4.1", runId: "dg4-gpt41-v2", briefId: "09-nested-subdecision", violations: ["ORPHAN_NODE"] },
  { model: "gpt-4.1", runId: "dg4-gpt41-v2", briefId: "11-feedback-loop-trap", violations: ["CYCLE_DETECTED"] },
  { model: "gpt-4.1", runId: "dg4-gpt41-v2", briefId: "13-forced-binary", violations: ["FORBIDDEN_EDGE"] },
  // gpt-4o v2 failures
  { model: "gpt-4o", runId: "dg4-gpt4o-v2", briefId: "02-multi-option-constrained", violations: ["ORPHAN_NODE"] },
  { model: "gpt-4o", runId: "dg4-gpt4o-v2", briefId: "09-nested-subdecision", violations: ["CONTROLLABLE_NO_OPTION_EDGE", "ORPHAN_NODE"] },
  { model: "gpt-4o", runId: "dg4-gpt4o-v2", briefId: "10-many-observables", violations: ["ORPHAN_NODE"] },
  { model: "gpt-4o", runId: "dg4-gpt4o-v2", briefId: "11-feedback-loop-trap", violations: ["FORBIDDEN_EDGE", "FORBIDDEN_EDGE"] },
];

const resultsDir = path.resolve(import.meta.dirname!, "../results");

console.log("=== Draft Graph Pipeline Repair Test ===\n");

const results: Array<{
  brief: FailedBrief;
  result: RepairResult;
  nodeCount: number;
  edgeCount: number;
}> = [];

for (const brief of FAILED_BRIEFS) {
  const responseFile = path.join(resultsDir, brief.runId, brief.model, brief.briefId, "response.json");

  if (!fs.existsSync(responseFile)) {
    console.log(`SKIP: ${brief.model} × ${brief.briefId} — response.json not found`);
    continue;
  }

  const raw = JSON.parse(fs.readFileSync(responseFile, "utf-8"));

  // Extract graph from response — evaluator stores parsed_graph alongside raw_text
  const pg = raw.parsed_graph ?? raw;
  const graph: ParsedGraph = {
    nodes: pg.nodes ?? [],
    edges: pg.edges ?? [],
  };

  if (graph.nodes.length === 0) {
    console.log(`SKIP: ${brief.model} × ${brief.briefId} — empty graph`);
    continue;
  }

  // Deep clone for repair (mutations are in-place)
  const repairGraph: ParsedGraph = JSON.parse(JSON.stringify(graph));
  const result = runRepairPipeline(repairGraph);

  results.push({
    brief,
    result,
    nodeCount: repairGraph.nodes.length,
    edgeCount: repairGraph.edges.length,
  });

  const status = result.repaired ? "✓ REPAIRED" : "✗ STILL INVALID";
  console.log(`${status}: ${brief.model} × ${brief.briefId}`);
  console.log(`  Pre:  [${result.preRepairViolations.join(", ")}]`);
  console.log(`  Post: [${result.postRepairViolations.join(", ")}]`);
  if (result.repairActions.length > 0) {
    console.log(`  Actions: ${result.repairActions.join("; ")}`);
  }
  console.log(`  Graph: ${repairGraph.nodes.length} nodes, ${repairGraph.edges.length} edges`);
  console.log();
}

// Summary
console.log("=== Summary ===\n");
const repaired = results.filter((r) => r.result.repaired);
const stillInvalid = results.filter((r) => !r.result.repaired);

console.log(`Repaired: ${repaired.length}/${results.length}`);
if (repaired.length > 0) {
  for (const r of repaired) {
    console.log(`  ✓ ${r.brief.model} × ${r.brief.briefId} (was: ${r.brief.violations.join("+")})`);
  }
}
console.log();

console.log(`Still invalid: ${stillInvalid.length}/${results.length}`);
if (stillInvalid.length > 0) {
  for (const r of stillInvalid) {
    console.log(`  ✗ ${r.brief.model} × ${r.brief.briefId} — remaining: [${r.result.postRepairViolations.join(", ")}]`);
  }
}

// Post-repair pass rate calculation
console.log("\n=== Post-Repair Pass Rate (by model) ===\n");
const modelStats = new Map<string, { total: number; originalPass: number; postRepairPass: number }>();

// Total briefs per model = 14
for (const model of ["gpt-4.1", "gpt-4o"]) {
  const modelFailures = results.filter((r) => r.brief.model === model);
  const repairedCount = modelFailures.filter((r) => r.result.repaired).length;
  const originalFailed = modelFailures.length;
  const originalPass = 14 - originalFailed;
  const postRepairPass = originalPass + repairedCount;

  console.log(`${model}:`);
  console.log(`  Original:    ${originalPass}/14 (${Math.round(originalPass / 14 * 100)}%)`);
  console.log(`  Post-repair: ${postRepairPass}/14 (${Math.round(postRepairPass / 14 * 100)}%)`);
  console.log(`  Recovered:   ${repairedCount}/${originalFailed} failures`);
  console.log();
}
