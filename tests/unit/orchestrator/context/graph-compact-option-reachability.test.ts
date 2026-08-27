/**
 * compactGraph — per-option structural reachability projection.
 *
 * ── THE WITNESSED DEFECT THIS PINS ──────────────────────────────────────────
 * Deployed build, one session, quantities independently verified against the
 * canonical edges. The assistant said:
 *
 *   "The Berlin option concentrates risk through this single point in a way the
 *    UK path doesn't, SINCE THE STATUS QUO AND UK EXPANSION ROUTES DON'T RUN
 *    THROUGH CASH RUNWAY BREACH AT ALL in your current structure."
 *
 * The canonical graph carries `Status Quo -> Berlin office investment` at mean
 * 1.0 / exists_p 1.0, then `-> Cash runway breach` at mean 0.5. A two-hop path
 * whose first edge is CERTAIN. Every number in that answer was true; the
 * TOPOLOGY was false.
 *
 * ⭐ The cause is not a prompt failure. `orchestrator-cf-v28` rule 3 (GROUND)
 * and its STATE_GROUNDING block instruct the model to ground structural claims
 * in Zone 2 structured data — and Zone 2 carried a FLAT EDGE LIST with no
 * reachability, so "which routes pass through X" was a question it was
 * instructed to answer from a surface that does not contain the answer. These
 * tests pin the missing projection, not a caveat: with the reachable set in the
 * pack, the false sentence CONTRADICTS Zone 2, which rule 1 (SAFETY) already
 * forbids. A caveat cannot do that.
 *
 * ── WHAT IS DELIBERATELY NOT ASSERTED HERE ──────────────────────────────────
 * `reaches` is a claim about STRUCTURE — "is there a directed route in the
 * model as drawn" — and nothing else. It is NOT gated on `exists_probability`
 * and carries no certainty. See the decision note on `buildOptionReachability`
 * in `graph-compact.ts` for why gating it would manufacture the same class of
 * defect in the opposite direction.
 */

import { describe, it, expect } from "vitest";
import { compactGraph } from "../../../../src/orchestrator/context/graph-compact.js";
import type { GraphV3T } from "../../../../src/orchestrator/types.js";

// ============================================================================
// Fixtures
// ============================================================================

function node(id: string, kind: string, label?: string) {
  return { id, kind, label: label ?? `Label ${id}` };
}

function edge(from: string, to: string, overrides?: Record<string, unknown>) {
  return {
    from,
    to,
    strength: { mean: 0.5, std: 0.1 },
    exists_probability: 0.9,
    effect_direction: "positive" as const,
    ...overrides,
  };
}

function graph(nodes: unknown[], edges: unknown[]): GraphV3T {
  return { nodes, edges } as unknown as GraphV3T;
}

/**
 * The witnessed shape, with the canonical quantities from the capture.
 * `opt_status_quo` reaches `fac_cash_runway_breach` in TWO HOPS.
 */
function witnessedBerlinGraph(): GraphV3T {
  return graph(
    [
      node("dec_root", "decision", "Berlin expansion"),
      node("opt_status_quo", "option", "Status Quo"),
      node("opt_uk", "option", "UK expansion"),
      node("opt_berlin", "option", "Berlin office investment"),
      node("fac_cash_runway_breach", "factor", "Cash runway breach"),
      node("goal_growth", "goal", "Growth"),
    ],
    [
      edge("dec_root", "opt_status_quo"),
      edge("dec_root", "opt_uk"),
      edge("dec_root", "opt_berlin"),
      // The certain first hop the deployed answer denied existed.
      edge("opt_status_quo", "opt_berlin", {
        strength: { mean: 1.0, std: 0.05 },
        exists_probability: 1.0,
      }),
      edge("opt_berlin", "fac_cash_runway_breach", {
        strength: { mean: 0.5, std: 0.1 },
      }),
      edge("fac_cash_runway_breach", "goal_growth", {
        strength: { mean: -0.6, std: 0.1 },
        effect_direction: "negative",
      }),
    ],
  );
}

function reachesOf(result: ReturnType<typeof compactGraph>, id: string) {
  const found = result.nodes.find((n) => n.id === id);
  expect(found, `node ${id} must be present in the compact projection`).toBeDefined();
  return found!.reaches;
}

// ============================================================================
// Tests
// ============================================================================

describe("compactGraph — per-option structural reachability", () => {
  it("OPTION_REACHES_TWO_HOP_TARGET — status quo lists cash runway breach (the witnessed false claim)", () => {
    const result = compactGraph(witnessedBerlinGraph());

    // Bound by IDENTITY (node id), never by a value predicate another node
    // could satisfy: this asserts about opt_status_quo specifically.
    expect(reachesOf(result, "opt_status_quo")).toContain("fac_cash_runway_breach");
    // The intermediate hop is reachable too — the route is real, not a shortcut.
    expect(reachesOf(result, "opt_status_quo")).toContain("opt_berlin");
  });

  it("REACHES_IS_TRANSITIVE_NOT_ADJACENT — the goal three hops away is listed", () => {
    const result = compactGraph(witnessedBerlinGraph());
    expect(reachesOf(result, "opt_status_quo")).toContain("goal_growth");
  });

  it("TRUE_NON_REACH_STAYS_ABSENT — UK expansion genuinely does not reach the breach", () => {
    const result = compactGraph(witnessedBerlinGraph());
    const uk = reachesOf(result, "opt_uk");
    expect(uk).toBeDefined();
    expect(uk).not.toContain("fac_cash_runway_breach");
    expect(uk).not.toContain("opt_berlin");
  });

  it("BIDIRECTED_EDGE_IS_NOT_A_PATH — an unmeasured common cause never licenses reachability", () => {
    // Same topology, but the load-bearing hop is bidirected. A bidirected edge
    // is an unmeasured common cause (Pearl's ADMG notation), NOT a directed
    // path — the estate's declared position, applied by the shared kernel.
    const g = graph(
      [
        node("opt_status_quo", "option", "Status Quo"),
        node("opt_berlin", "option", "Berlin office investment"),
        node("fac_cash_runway_breach", "factor", "Cash runway breach"),
      ],
      [
        edge("opt_status_quo", "opt_berlin", { edge_type: "bidirected" }),
        edge("opt_berlin", "fac_cash_runway_breach"),
      ],
    );
    const result = compactGraph(g);
    expect(reachesOf(result, "opt_status_quo")).not.toContain("fac_cash_runway_breach");
    expect(reachesOf(result, "opt_status_quo")).not.toContain("opt_berlin");
  });

  it("ABSENT_EDGE_TYPE_IS_DIRECTED — backward compatibility with unstamped edges", () => {
    const g = graph(
      [node("opt_a", "option"), node("fac_b", "factor")],
      [{ from: "opt_a", to: "fac_b", strength: { mean: 0.4, std: 0.1 }, exists_probability: 0.8, effect_direction: "positive" }],
    );
    expect(reachesOf(compactGraph(g), "opt_a")).toContain("fac_b");
  });

  it("REACHES_IS_NOT_GATED_ON_EXISTS_PROBABILITY — a low-probability edge still forms a route", () => {
    // Deliberate: gating would convert uncertainty into a FALSE NEGATIVE, which
    // is the exact direction of the harm being fixed, and would mint a second
    // threshold authority. `reaches` is structural; certainty is not its claim.
    const g = graph(
      [node("opt_a", "option"), node("fac_b", "factor")],
      [edge("opt_a", "fac_b", { exists_probability: 0.01 })],
    );
    expect(reachesOf(compactGraph(g), "opt_a")).toContain("fac_b");
  });

  it("NON_OPTION_NODES_CARRY_NO_REACHES — the key's absence means 'not an option', never 'unknown'", () => {
    const result = compactGraph(witnessedBerlinGraph());
    for (const id of ["dec_root", "fac_cash_runway_breach", "goal_growth"]) {
      const found = result.nodes.find((n) => n.id === id);
      expect(found).toBeDefined();
      expect(found!.reaches, `${id} is not an option and must carry no reaches`).toBeUndefined();
    }
  });

  it("DEAD_END_OPTION_EMITS_AN_EMPTY_SET_NOT_AN_ABSENT_KEY", () => {
    // An empty array is a POSITIVE fact ("this option is a dead end"). Omitting
    // the key instead would make absence ambiguous between "reaches nothing"
    // and "not computed" — the estate's standing absence-means-unknown trap.
    const g = graph([node("opt_lonely", "option")], []);
    expect(reachesOf(compactGraph(g), "opt_lonely")).toEqual([]);
  });

  it("REACHES_EXCLUDES_THE_OPTION_ITSELF", () => {
    const g = graph(
      [node("opt_a", "option"), node("fac_b", "factor")],
      [edge("opt_a", "fac_b"), edge("fac_b", "opt_a")],
    );
    expect(reachesOf(compactGraph(g), "opt_a")).not.toContain("opt_a");
  });

  it("CYCLE_TERMINATES_AND_STAYS_DETERMINISTIC", () => {
    const g = graph(
      [node("opt_a", "option"), node("fac_b", "factor"), node("fac_c", "factor")],
      [edge("opt_a", "fac_b"), edge("fac_b", "fac_c"), edge("fac_c", "fac_b")],
    );
    expect(reachesOf(compactGraph(g), "opt_a")).toEqual(["fac_b", "fac_c"]);
  });

  it("REACHES_IS_SORTED_FOR_BYTE_DETERMINISM", () => {
    const g = graph(
      [node("opt_a", "option"), node("fac_z", "factor"), node("fac_m", "factor"), node("fac_b", "factor")],
      [edge("opt_a", "fac_z"), edge("opt_a", "fac_m"), edge("opt_a", "fac_b")],
    );
    expect(reachesOf(compactGraph(g), "opt_a")).toEqual(["fac_b", "fac_m", "fac_z"]);
  });

  it("REACHES_DOES_NOT_INVENT_IDS — every entry is a node in the same graph", () => {
    const result = compactGraph(witnessedBerlinGraph());
    const ids = new Set(result.nodes.map((n) => n.id));
    for (const n of result.nodes) {
      for (const target of n.reaches ?? []) {
        expect(ids.has(target), `reaches entry ${target} must be a node in this graph`).toBe(true);
      }
    }
  });
});
