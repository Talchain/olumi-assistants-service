/**
 * Reachability-oracle agreement.
 *
 * The deterministic repair sweep and the validators that judge its output must
 * agree on what an edge IS. When they did not, a graph whose only option→goal
 * path ran through a bidirected edge produced a dead end: the validator emitted
 * `NO_PATH_TO_GOAL`, `fixStatusQuoConnectivity` woke up on that exact code,
 * consulted its own oracle, was told nothing was disconnected, and returned
 * `{ fixed: false, repairs: 0 }`.
 *
 * These tests are DERIVED, not mirrored (platform CLAUDE.md trap 12): they run
 * the real validator and the real repair oracles against each other rather than
 * asserting a hand-copied expected list, so a future divergence on ANY axis
 * they both cover turns this file red.
 *
 * Bidirected edges are prompt-legal and expected on live draft graphs —
 * `src/prompts/defaults-v19.ts:76` instructs the model to emit
 * `edge_type: "bidirected"` for an unmeasured common cause between factors,
 * and `:612` gives a worked example.
 */

import { describe, it, expect } from "vitest";

import { canReachAnyGoal } from "../../src/graph/reachability.js";
import { validateGraph } from "../../src/validators/graph-validator.js";
import { validateGraphStructure } from "../../src/orchestrator/graph-structure-validator.js";
import {
  hasPathToGoal,
  findDisconnectedOptions,
  fixStatusQuoConnectivity,
} from "../../src/cee/unified-pipeline/stages/repair/status-quo-fix.js";
import { fixOptionOutcomeShortcut } from "../../src/cee/unified-pipeline/stages/repair/deterministic-sweep.js";
import { handleUnreachableFactors } from "../../src/cee/unified-pipeline/stages/repair/unreachable-factors.js";

// ── Fixtures ────────────────────────────────────────────────────────────────

const node = (id: string, kind: string, extra: Record<string, unknown> = {}) =>
  ({ id, kind, label: id, ...extra }) as any;

const edge = (from: string, to: string, extra: Record<string, unknown> = {}) =>
  ({
    id: `e_${from}_${to}`,
    from,
    to,
    strength: { mean: 0.5, std: 0.1 },
    exists_probability: 1.0,
    effect_direction: "positive",
    ...extra,
  }) as any;

/**
 * The load-bearing graph. Prompt-legal: the bidirected edge sits between two
 * factor-kind nodes, which is the only placement the draft prompt allows.
 *
 *   dec → optA ─┐
 *   dec → optB ─┴→ f1 ⇠⇢[bidirected] f2 → out1 → goal
 *
 * Under DIRECTED-ONLY semantics f1 (and therefore optA/optB) cannot reach the
 * goal. Under all-edges semantics they can. Every oracle must pick the former.
 */
function bidirectedDeadEndGraph(): any {
  return {
    goal_node_id: "goal",
    nodes: [
      node("dec", "decision"),
      node("optA", "option"),
      node("optB", "option"),
      node("f1", "factor", { category: "controllable", data: { value: 3 } }),
      node("f2", "factor", { category: "controllable", data: { value: 4 } }),
      node("out1", "outcome"),
      node("goal", "goal"),
    ],
    edges: [
      edge("dec", "optA"),
      edge("dec", "optB"),
      edge("optA", "f1"),
      edge("optB", "f1"),
      edge("f1", "f2", { edge_type: "bidirected", strength: { mean: 0, std: 0.01 } }),
      edge("f2", "out1"),
      edge("out1", "goal"),
    ],
  };
}

/** Same shape, the bidirected edge replaced by a directed one. Everything reaches. */
function directedControlGraph(): any {
  const g = bidirectedDeadEndGraph();
  g.edges[4] = edge("f1", "f2");
  return g;
}

const GOAL_IDS = new Set(["goal"]);

function optionsFlaggedByValidator(graph: any): Set<string> {
  const result: any = validateGraph({
    graph: structuredClone(graph),
    phase: "post_enforcement" as any,
  });
  const optionIds = new Set<string>(
    graph.nodes.filter((n: any) => n.kind === "option").map((n: any) => n.id),
  );
  const flagged = new Set<string>();
  for (const err of result.errors ?? []) {
    if (err.code !== "NO_PATH_TO_GOAL") continue;
    const id = String(err.path ?? "").replace("nodesById.", "");
    if (optionIds.has(id)) flagged.add(id);
  }
  return flagged;
}

// ── The kernel ──────────────────────────────────────────────────────────────

describe("canReachAnyGoal — the single reachability kernel", () => {
  it("does NOT traverse a bidirected edge (unmeasured confounder, not a causal path)", () => {
    const g = bidirectedDeadEndGraph();
    expect(canReachAnyGoal("f1", g.edges, GOAL_IDS)).toBe(false);
    expect(canReachAnyGoal("optA", g.edges, GOAL_IDS)).toBe(false);
  });

  it("DOES traverse the same edge when it is directed (positive control)", () => {
    const g = directedControlGraph();
    expect(canReachAnyGoal("f1", g.edges, GOAL_IDS)).toBe(true);
    expect(canReachAnyGoal("optA", g.edges, GOAL_IDS)).toBe(true);
  });

  it("treats an absent edge_type as directed (backward compatibility)", () => {
    const edges = [{ id: "e", from: "a", to: "goal" } as any];
    expect(canReachAnyGoal("a", edges, GOAL_IDS)).toBe(true);
  });

  it("a goal reaches itself", () => {
    expect(canReachAnyGoal("goal", [], GOAL_IDS)).toBe(true);
  });

  it("terminates on a cycle", () => {
    const edges = [edge("a", "b"), edge("b", "a")];
    expect(canReachAnyGoal("a", edges, GOAL_IDS)).toBe(false);
  });
});

// ── Agreement: repair oracle vs validators ──────────────────────────────────

describe("the repair sweep's oracle agrees with the validators", () => {
  it("status-quo-fix.hasPathToGoal agrees with graph-validator on the bidirected graph", () => {
    const g = bidirectedDeadEndGraph();
    const flaggedByValidator = optionsFlaggedByValidator(g);

    // Positive control: the validator can SEE the defect at all.
    expect([...flaggedByValidator].sort()).toEqual(["optA", "optB"]);

    for (const optId of ["optA", "optB"]) {
      expect(
        hasPathToGoal(optId, g.edges, GOAL_IDS),
        `hasPathToGoal(${optId}) must agree with the validator`,
      ).toBe(false);
    }
  });

  it("findDisconnectedOptions reports every option the validator flags NO_PATH_TO_GOAL", () => {
    const g = bidirectedDeadEndGraph();
    const flaggedByValidator = optionsFlaggedByValidator(g);
    const flaggedByRepair = new Set(findDisconnectedOptions(structuredClone(g)));

    for (const optId of flaggedByValidator) {
      expect(
        flaggedByRepair.has(optId),
        `the repair oracle must not be blind to ${optId}`,
      ).toBe(true);
    }
  });

  it("agrees with the EDIT lane's structural validator too", () => {
    const g = bidirectedDeadEndGraph();
    const structural = validateGraphStructure(structuredClone(g));
    const flaggedIds = new Set(
      structural.violations
        .filter((v) => v.code === "NO_PATH_TO_GOAL")
        .map((v) => v.detail.match(/"([^"]+)"/)?.[1] ?? ""),
    );
    // Positive control.
    expect(flaggedIds.has("optA")).toBe(true);

    expect(hasPathToGoal("optA", g.edges, GOAL_IDS)).toBe(false);
  });

  it("all three agree the graph is FINE once the edge is directed (no false positives)", () => {
    const g = directedControlGraph();
    expect(optionsFlaggedByValidator(g).size).toBe(0);
    expect(findDisconnectedOptions(structuredClone(g))).toEqual([]);
    expect(
      validateGraphStructure(structuredClone(g)).violations.filter(
        (v) => v.code === "NO_PATH_TO_GOAL",
      ),
    ).toEqual([]);
    expect(hasPathToGoal("optA", g.edges, GOAL_IDS)).toBe(true);
  });
});

// ── The dead end itself ─────────────────────────────────────────────────────

describe("fixStatusQuoConnectivity no longer silently declines on its own trigger", () => {
  it("acts on the violation the validator raised instead of returning a silent no-op", () => {
    const g = bidirectedDeadEndGraph();

    // Drive the repair with the REAL validator's REAL verdict.
    const validation: any = validateGraph({
      graph: structuredClone(g),
      phase: "post_enforcement" as any,
    });
    const violations = (validation.errors ?? [])
      .filter((e: any) => e.code === "NO_PATH_TO_GOAL" || e.code === "NO_EFFECT_PATH")
      .map((e: any) => ({ code: e.code }));

    // Positive control: the repair's own trigger condition is genuinely met.
    expect(violations.length).toBeGreaterThan(0);

    const result = fixStatusQuoConnectivity(structuredClone(g), violations, "from_to" as any);

    // Before the collapse this returned {fixed:false, markedDroppable:false,
    // repairs:0} — the pass saw nothing to do on the very defect that woke it.
    // It must now at minimum REPORT that it cannot fix, never stay silent.
    expect(result.repairs.length).toBeGreaterThan(0);
    expect(result.fixed || result.markedDroppable).toBe(true);
  });
});

// ── The kind-whitelisted variant adopts the same edge policy ────────────────

describe("fixOptionOutcomeShortcut does not delete an edge on a bidirected alibi", () => {
  it("keeps the option→outcome edge when the outcome's only goal path is bidirected", () => {
    // out1's only route to goal is out1 ⇠⇢[bidirected] goal, which is not a
    // causal path — so the option→outcome shortcut is NOT safely removable.
    const graph: any = {
      goal_node_id: "goal",
      nodes: [
        node("dec", "decision"),
        node("optA", "option"),
        node("f1", "factor", { category: "controllable", data: { value: 1 } }),
        node("out1", "outcome"),
        node("goal", "goal"),
      ],
      edges: [
        edge("dec", "optA"),
        edge("optA", "f1"),
        edge("f1", "out1"),
        edge("optA", "out1"), // the forbidden shortcut, candidate for removal
        edge("out1", "goal", { edge_type: "bidirected", strength: { mean: 0, std: 0.01 } }),
      ],
    };

    const before = graph.edges.length;
    const result = fixOptionOutcomeShortcut(graph);

    expect(result.removedCount).toBe(0);
    expect(graph.edges.length).toBe(before);
  });

  it("still removes it when the outcome has a real directed path (positive control)", () => {
    const graph: any = {
      goal_node_id: "goal",
      nodes: [
        node("dec", "decision"),
        node("optA", "option"),
        node("f1", "factor", { category: "controllable", data: { value: 1 } }),
        node("out1", "outcome"),
        node("goal", "goal"),
      ],
      edges: [
        edge("dec", "optA"),
        edge("optA", "f1"),
        edge("f1", "out1"),
        edge("optA", "out1"),
        edge("out1", "goal"),
      ],
    };

    const result = fixOptionOutcomeShortcut(graph);
    expect(result.removedCount).toBe(1);
  });
});

// ── unreachable-factors shares the same edge policy ─────────────────────────

describe("handleUnreachableFactors does not accept a bidirected edge as a goal path", () => {
  /**
   * `fExo` has no inbound option→factor edge, so it is reclassified to
   * "external". Its only route onward is `fExo → out1`, and `out1`'s only route
   * to the goal is BIDIRECTED — i.e. not a causal path. The pass must therefore
   * wire `out1 → goal` rather than conclude the factor is already fine.
   */
  function exogenousFactorBehindBidirectedGoalEdge(): any {
    return {
      goal_node_id: "goal",
      nodes: [
        node("dec", "decision"),
        node("optA", "option"),
        node("f1", "factor", { category: "controllable", data: { value: 1 } }),
        node("fExo", "factor", { data: { value: 42 } }),
        node("out1", "outcome"),
        node("goal", "goal"),
      ],
      edges: [
        edge("dec", "optA"),
        edge("optA", "f1"),
        edge("f1", "out1"),
        edge("fExo", "out1"),
        edge("out1", "goal", { edge_type: "bidirected", strength: { mean: 0, std: 0.01 } }),
      ],
    };
  }

  it("wires the outcome to the goal instead of trusting the bidirected edge", () => {
    const graph = exogenousFactorBehindBidirectedGoalEdge();
    const result = handleUnreachableFactors(graph, "from_to" as any);

    // Positive control: the pass did engage on this factor at all.
    expect(result.reclassified).toContain("fExo");

    expect(result.repairs.map((r) => r.code)).toContain("UNREACHABLE_FACTOR_WIRED_TO_GOAL");
    expect(result.edgesAdded).toHaveLength(1);
    expect(result.edgesAdded[0]).toMatchObject({ from: "out1", to: "goal" });
  });

  it("does NOT wire when the outcome already has a real directed path (positive control)", () => {
    const graph = exogenousFactorBehindBidirectedGoalEdge();
    graph.edges[4] = edge("out1", "goal");

    const result = handleUnreachableFactors(graph, "from_to" as any);
    expect(result.reclassified).toContain("fExo");
    expect(result.repairs.map((r) => r.code)).not.toContain("UNREACHABLE_FACTOR_WIRED_TO_GOAL");
    expect(result.edgesAdded).toHaveLength(0);
  });
});
