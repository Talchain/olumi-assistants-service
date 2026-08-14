/**
 * ⭐⭐ THE SCAFFOLDING MINT IS GATED ON A GENUINE GAP, AND WHAT IT MINTS SAYS SO.
 *
 * ── THE DEFECT, MEASURED ───────────────────────────────────────────────────
 * `fixFactorGoalEdges` ran UNCONDITIONALLY on every `factor → goal` edge and
 * minted a `"<Factor> Impact"` outcome for each one. That was written when the
 * drafter could not emit an outcome at all, so it was the only bridge layer
 * available — and it worked. What it also did was make the scaffolding
 * INDISTINGUISHABLE from an authored outcome: five live draws on the pinned
 * brief produced four outcomes each, ALL of them minted here, all badged
 * `ai_inferred`, none marked, and nothing anywhere said the outcome layer was
 * the machine's (`analysis-outage-2026-08-14/summary.json`,
 * `fixed-input-replay.json`).
 *
 * ── TWO CHANGES, EACH A DIFFERENT QUESTION (trap 21) ──────────────────────
 *  1. GAP GATE — *is there anything to bridge?* The mint fires only where the
 *     graph carries no authored outcome/risk layer FOR THAT PATH. Where the
 *     model already drew `factor → outcome → goal`, a redundant `factor → goal`
 *     shortcut is dropped rather than duplicated by a second, synthetic
 *     mediator.
 *  2. MARKER — *whose node is this?* Every node these repairs mint carries
 *     `provenance.provenance_class = "projector_structural"`, the projector's
 *     EXISTING third class for "neither the user's nor the model's — ours".
 *
 * The sweep itself is NOT removed. It is a legitimate safety net that became
 * dominant only because the grammar starved it; with `outcome` expressible the
 * net should catch a residue, and the marker is what lets anyone tell the
 * residue from the model's own work.
 *
 * ── THE DISCRIMINATION THIS SUITE MUST MAKE ───────────────────────────────
 * A gate that suppressed every mint would pass a "no synthetic outcome" test
 * and destroy the safety net. So the gap case and the no-gap case are asserted
 * as a PAIR on the same graph shape, and the third test proves the gate is
 * decided PER PATH rather than graph-wide — one authored bridge must not
 * suppress the mint a different, genuinely gapped factor needs.
 */
import { describe, expect, it } from "vitest";

import { fixFactorGoalEdges, fixOptionGoalShortcut } from "../deterministic-sweep.js";
import { fixTerminalBridge, SYNTHETIC_BRIDGE_NODE_ID } from "../terminal-bridge.js";
import { detectEdgeFormat } from "../../../utils/edge-format.js";
import { PROJECTOR_STRUCTURAL_CLASS } from "../../../../draft/records/projector.js";

const CAUSAL = { strength_mean: 0.6, strength_std: 0.15, belief_exists: 0.9, effect_direction: "positive" as const };

interface TestNode {
  id: string;
  kind: string;
  label?: string;
  category?: string;
  provenance?: { provenance_class?: string };
}
interface TestGraph {
  version: string;
  default_seed: number;
  nodes: TestNode[];
  edges: Record<string, unknown>[];
  meta: Record<string, unknown>;
}

function graphOf(nodes: TestNode[], edges: Record<string, unknown>[]): TestGraph {
  return {
    version: "1",
    default_seed: 42,
    nodes,
    edges,
    meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
  };
}

const format = (g: TestGraph) => detectEdgeFormat(g.edges as never);

const outcomesOf = (g: TestGraph) => g.nodes.filter((n) => n.kind === "outcome");
const nodeById = (g: TestGraph, id: string) => g.nodes.find((n) => n.id === id);
const hasEdge = (g: TestGraph, from: string, to: string) =>
  g.edges.some((e) => e.from === from && e.to === to);

describe("fixFactorGoalEdges — the gap gate", () => {
  it("MINTS a marked outcome when the graph has no bridge layer for that path", () => {
    // The genuine gap. This is the case the repair exists for, and it must keep
    // working: a gate that suppressed this would delete the safety net and make
    // the goal unreachable by construction.
    const graph = graphOf(
      [
        { id: "fac_a", kind: "factor", label: "Throughput", category: "controllable" },
        { id: "goal_1", kind: "goal", label: "Grow ARR" },
      ],
      [{ from: "fac_a", to: "goal_1", ...CAUSAL }],
    );

    const result = fixFactorGoalEdges(graph as never, format(graph));

    expect(result.splitCount).toBe(1);
    const minted = nodeById(graph, "out_fac_a_impact");
    expect(minted?.kind).toBe("outcome");
    // THE MARKER — machine-readable, on the existing axis, not a new vocabulary.
    expect(minted?.provenance?.provenance_class).toBe(PROJECTOR_STRUCTURAL_CLASS);
    // …and the illegal shortcut is gone, replaced by the two-limb path.
    expect(hasEdge(graph, "fac_a", "goal_1")).toBe(false);
    expect(hasEdge(graph, "fac_a", "out_fac_a_impact")).toBe(true);
    expect(hasEdge(graph, "out_fac_a_impact", "goal_1")).toBe(true);
  });

  it("MINTS NOTHING when the model already authored `factor → outcome → goal` for that path", () => {
    // The authored layer. The `factor → goal` edge here is a redundant shortcut
    // over a path the model already drew — minting a second mediator for it is
    // what made 100 % of the outcome layer scaffolding.
    const graph = graphOf(
      [
        { id: "fac_a", kind: "factor", label: "Throughput", category: "controllable" },
        { id: "out_delivery", kind: "outcome", label: "Feature Delivery Rate" },
        { id: "goal_1", kind: "goal", label: "Grow ARR" },
      ],
      [
        { from: "fac_a", to: "out_delivery", ...CAUSAL },
        { from: "out_delivery", to: "goal_1", ...CAUSAL },
        { from: "fac_a", to: "goal_1", ...CAUSAL },
      ],
    );

    fixFactorGoalEdges(graph as never, format(graph));

    // Bound by IDENTITY: the specific id this repair would have minted, and the
    // authored outcome's own id — not by a bare count, which a differently-named
    // mint would still satisfy.
    expect(nodeById(graph, "out_fac_a_impact")).toBeUndefined();
    expect(outcomesOf(graph).map((n) => n.id)).toEqual(["out_delivery"]);
    // The authored path is untouched…
    expect(hasEdge(graph, "fac_a", "out_delivery")).toBe(true);
    expect(hasEdge(graph, "out_delivery", "goal_1")).toBe(true);
    // …and the illegal shortcut is still removed, because leaving it would
    // trade a scaffolding defect for an INVALID_EDGE_TYPE.
    expect(hasEdge(graph, "fac_a", "goal_1")).toBe(false);
  });

  it("DISCLOSES the dropped shortcut rather than removing it silently", () => {
    const graph = graphOf(
      [
        { id: "fac_a", kind: "factor", label: "Throughput", category: "controllable" },
        { id: "out_delivery", kind: "outcome", label: "Feature Delivery Rate" },
        { id: "goal_1", kind: "goal", label: "Grow ARR" },
      ],
      [
        { from: "fac_a", to: "out_delivery", ...CAUSAL },
        { from: "out_delivery", to: "goal_1", ...CAUSAL },
        { from: "fac_a", to: "goal_1", ...CAUSAL },
      ],
    );

    const result = fixFactorGoalEdges(graph as never, format(graph));

    const disclosure = result.repairs.find((r) => r.code === "FACTOR_GOAL_SHORTCUT_REDUNDANT");
    expect(disclosure).toBeDefined();
    expect(disclosure?.path).toBe("edges[fac_a→goal_1]");
    // User-visible copy: a node LABEL, never a raw id.
    expect(disclosure?.action).toContain("Feature Delivery Rate");
    expect(disclosure?.action).not.toContain("out_delivery");
  });

  it("decides PER PATH — one authored bridge does not suppress a different factor's mint", () => {
    // THE DISCRIMINATING CASE. A graph-wide gate ("does any outcome exist?")
    // passes the previous test and silently starves `fac_b`, leaving its
    // `factor → goal` edge to be rejected downstream. Only a per-path gate gets
    // both of these right.
    const graph = graphOf(
      [
        { id: "fac_a", kind: "factor", label: "Throughput", category: "controllable" },
        { id: "fac_b", kind: "factor", label: "Hiring Cost", category: "external" },
        { id: "out_delivery", kind: "outcome", label: "Feature Delivery Rate" },
        { id: "goal_1", kind: "goal", label: "Grow ARR" },
      ],
      [
        { from: "fac_a", to: "out_delivery", ...CAUSAL },
        { from: "out_delivery", to: "goal_1", ...CAUSAL },
        { from: "fac_a", to: "goal_1", ...CAUSAL },
        { from: "fac_b", to: "goal_1", ...CAUSAL },
      ],
    );

    fixFactorGoalEdges(graph as never, format(graph));

    // fac_a: suppressed (authored path).
    expect(nodeById(graph, "out_fac_a_impact")).toBeUndefined();
    // fac_b: minted, and marked.
    expect(nodeById(graph, "out_fac_b_impact")?.kind).toBe("outcome");
    expect(nodeById(graph, "out_fac_b_impact")?.provenance?.provenance_class).toBe(
      PROJECTOR_STRUCTURAL_CLASS,
    );
    expect(hasEdge(graph, "fac_b", "out_fac_b_impact")).toBe(true);
    expect(hasEdge(graph, "out_fac_b_impact", "goal_1")).toBe(true);
  });

  it("treats an authored RISK bridge as an outcome layer — `risk → goal` is a legal terminus too", () => {
    // `ALLOWED_EDGES` carries `factor → risk` and `risk → goal`, so a model that
    // routes its chain through a risk has authored a complete bridge. Reading
    // only `outcome` here would mint scaffolding beside a perfectly good path —
    // the gate must be written against the VALIDATOR's bridge vocabulary, not
    // against the word in the repair's own name (trap 13d).
    const graph = graphOf(
      [
        { id: "fac_a", kind: "factor", label: "Throughput", category: "controllable" },
        { id: "risk_attrition", kind: "risk", label: "Engineering Attrition" },
        { id: "goal_1", kind: "goal", label: "Grow ARR" },
      ],
      [
        { from: "fac_a", to: "risk_attrition", ...CAUSAL },
        { from: "risk_attrition", to: "goal_1", ...CAUSAL },
        { from: "fac_a", to: "goal_1", ...CAUSAL },
      ],
    );

    fixFactorGoalEdges(graph as never, format(graph));

    expect(nodeById(graph, "out_fac_a_impact")).toBeUndefined();
    expect(hasEdge(graph, "fac_a", "goal_1")).toBe(false);
  });
});

describe("fixOptionGoalShortcut — the same gate, the second mint site", () => {
  it("MINTS a marked outcome when the option's factor has no bridge", () => {
    const graph = graphOf(
      [
        { id: "dec_1", kind: "decision", label: "Decision" },
        { id: "opt_a", kind: "option", label: "Hire a lead" },
        { id: "fac_a", kind: "factor", label: "Throughput", category: "controllable" },
        { id: "goal_1", kind: "goal", label: "Grow ARR" },
      ],
      [
        { from: "dec_1", to: "opt_a", ...CAUSAL },
        { from: "opt_a", to: "fac_a", ...CAUSAL },
        { from: "opt_a", to: "goal_1", ...CAUSAL },
      ],
    );

    fixOptionGoalShortcut(graph as never, format(graph));

    const minted = nodeById(graph, "out_fac_a_impact");
    expect(minted?.kind).toBe("outcome");
    expect(minted?.provenance?.provenance_class).toBe(PROJECTOR_STRUCTURAL_CLASS);
  });

  it("MINTS NOTHING when the option's factor already reaches the goal through an authored outcome", () => {
    const graph = graphOf(
      [
        { id: "dec_1", kind: "decision", label: "Decision" },
        { id: "opt_a", kind: "option", label: "Hire a lead" },
        { id: "fac_a", kind: "factor", label: "Throughput", category: "controllable" },
        { id: "out_delivery", kind: "outcome", label: "Feature Delivery Rate" },
        { id: "goal_1", kind: "goal", label: "Grow ARR" },
      ],
      [
        { from: "dec_1", to: "opt_a", ...CAUSAL },
        { from: "opt_a", to: "fac_a", ...CAUSAL },
        { from: "fac_a", to: "out_delivery", ...CAUSAL },
        { from: "out_delivery", to: "goal_1", ...CAUSAL },
        { from: "opt_a", to: "goal_1", ...CAUSAL },
      ],
    );

    fixOptionGoalShortcut(graph as never, format(graph));

    expect(nodeById(graph, "out_fac_a_impact")).toBeUndefined();
    expect(outcomesOf(graph).map((n) => n.id)).toEqual(["out_delivery"]);
  });
});

describe("terminal-bridge synthesis — the third mint site", () => {
  it("marks the node it mints", () => {
    const graph = graphOf(
      [
        { id: "dec_1", kind: "decision", label: "Decision" },
        { id: "opt_a", kind: "option", label: "Hire a lead" },
        { id: "fac_a", kind: "factor", label: "Throughput", category: "controllable" },
        { id: "goal_1", kind: "goal", label: "Grow ARR" },
      ],
      [
        { from: "dec_1", to: "opt_a", ...CAUSAL },
        { from: "opt_a", to: "fac_a", ...CAUSAL },
      ],
    );

    const result = fixTerminalBridge(graph as never, format(graph));

    expect(result.bridgeNodeId).toBe(SYNTHETIC_BRIDGE_NODE_ID);
    expect(nodeById(graph, SYNTHETIC_BRIDGE_NODE_ID)?.provenance?.provenance_class).toBe(
      PROJECTOR_STRUCTURAL_CLASS,
    );
  });

  it("still declines when an authored bridge exists — its gap gate is unchanged", () => {
    // The pre-existing gate (`needsTerminalBridge`: no outcome AND no risk) is
    // NOT re-litigated by this lane; this pins that the marker change left it
    // alone, so a reader can tell the two apart.
    const graph = graphOf(
      [
        { id: "dec_1", kind: "decision", label: "Decision" },
        { id: "opt_a", kind: "option", label: "Hire a lead" },
        { id: "fac_a", kind: "factor", label: "Throughput", category: "controllable" },
        { id: "out_delivery", kind: "outcome", label: "Feature Delivery Rate" },
        { id: "goal_1", kind: "goal", label: "Grow ARR" },
      ],
      [
        { from: "dec_1", to: "opt_a", ...CAUSAL },
        { from: "opt_a", to: "fac_a", ...CAUSAL },
        { from: "fac_a", to: "out_delivery", ...CAUSAL },
      ],
    );

    const result = fixTerminalBridge(graph as never, format(graph));

    expect(result.bridgeNodeId).toBeUndefined();
    expect(nodeById(graph, SYNTHETIC_BRIDGE_NODE_ID)).toBeUndefined();
  });
});
