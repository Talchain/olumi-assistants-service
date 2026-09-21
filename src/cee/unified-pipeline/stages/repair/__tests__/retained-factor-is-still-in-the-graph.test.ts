/**
 * A FACTOR THE PIPELINE SAYS IT *RETAINED* MUST STILL BE IN THE GRAPH.
 *
 * ── THE USER OUTCOME ───────────────────────────────────────────────────────
 * "A factor that is kept in the model but left out of the calculation can be
 * identified by the node it refers to." That is the whole point of
 * `UNREACHABLE_FACTOR_RETAINED`: `unreachable-factors.ts:878` marks a factor
 * droppable **but does NOT remove it**, and writes `nodes[<id>]` so a surface
 * can point at it.
 *
 * ── THE DEFECT THIS PINS, MEASURED ─────────────────────────────────────────
 * Across 32 real staging responses (`olumi-evidence-v202-measure-20260917`),
 * **0 of 34** `UNREACHABLE_FACTOR_RETAINED` node references resolved to any
 * `draft_graph.nodes[].id`. The reason is not an id rewrite and not a wrapper
 * mismatch — it is that **the node is gone**: all 34 also appear under
 * `DISCONNECTED_OBSERVABLE_PRUNED`, emitted by `fixDisconnectedObservables`
 * twenty-nine lines later in the SAME sweep. The word "retained" is false for
 * every one of them.
 *
 * Contrast control on that sweep, same run: `CONTROLLABLE_MISSING_DATA`
 * resolved 102/102 and `STATUS_QUO_NO_TARGETS` 4/4 — the probe could see.
 *
 * ── WHY ONE CODE PRODUCES TWO OPPOSITE OUTCOMES (trap 21) ──────────────────
 * `UNREACHABLE_FACTOR_RETAINED` is emitted for "no path to goal". The prune
 * removes on a DIFFERENT predicate — `category ∈ {observable, external}` AND
 * **zero edges**. Those are two questions, and the code answers as though they
 * were one:
 *
 *   • a factor with an edge that leads nowhere  → retained, node SURVIVES  ✅
 *   • a factor with no edges at all             → retained, node DELETED   ❌
 *
 * Both arms are driven below through the real `runDeterministicSweep`. The
 * corpus contains only the second — which is why the measured rate is 0/34 and
 * not something in between.
 *
 * ── SCOPE, STATED SO IT CANNOT BE OVER-READ ────────────────────────────────
 * Every assertion here is a PRODUCER assertion about the sweep's own repair
 * list. Nothing claims anything about `model_adjustments[]` (this code is
 * deliberately NOT on that allowlist — see `boundary.test.ts`'s
 * `ADJUDICATED_EXCLUDED`), about PLoT, or about what the UI paints.
 * Status-ladder rung reached by this file alone: TESTED.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../../../../../utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  calculateCost: vi.fn().mockReturnValue(0),
  TelemetryEvents: {},
}));
vi.mock("../../../../../config/index.js", () => ({
  config: { cee: {}, features: { optionShortcutRepair: true } },
  isProduction: vi.fn().mockReturnValue(true),
}));

import { runDeterministicSweep } from "../deterministic-sweep.js";

type Repairish = { code: string; path: string; action: string };

/** A structurally valid decision graph: decision → options → outcome → goal. */
function decisionGraph(): { nodes: any[]; edges: any[] } {
  return {
    nodes: [
      { id: "dec_1", kind: "decision", label: "Which way" },
      { id: "opt_a", kind: "option", label: "Do it" },
      { id: "opt_b", kind: "option", label: "Do nothing" },
      { id: "out_1", kind: "outcome", label: "Revenue" },
      { id: "goal_1", kind: "goal", label: "Grow revenue" },
    ],
    edges: [
      edge("dec_1", "opt_a", 1),
      edge("dec_1", "opt_b", 1),
      edge("opt_a", "out_1", 0.5),
      edge("opt_b", "out_1", 0.4),
      edge("out_1", "goal_1", 0.8),
    ],
  };
}

function edge(from: string, to: string, mean: number) {
  return {
    from,
    to,
    strength_mean: mean,
    strength_std: 0.1,
    belief_exists: 0.9,
    effect_direction: "positive",
  };
}

async function sweep(mutate: (g: { nodes: any[]; edges: any[] }) => void) {
  const g = decisionGraph();
  mutate(g);
  const ctx: any = {
    graph: { nodes: g.nodes, edges: g.edges, meta: { roots: [], leaves: [] } },
    requestId: "retained-factor-spec",
    repairTrace: {},
  };
  await runDeterministicSweep(ctx);

  const repairs = (ctx.deterministicRepairs ?? []) as Repairish[];
  const liveIds = new Set<string>((ctx.graph.nodes as any[]).map((n) => n.id));

  // POSITIVE CONTROL — a sweep that silently did nothing would make every
  // assertion below vacuous and would look exactly like a clean pass.
  expect(repairs.length).toBeGreaterThan(0);
  expect(liveIds.size).toBeGreaterThan(0);

  const nodeIdOf = (r: Repairish) => /^nodes\[([^\]]+)\]$/.exec(r.path)?.[1];
  const byCode = (code: string) => repairs.filter((r) => r.code === code);

  return { ctx, repairs, liveIds, nodeIdOf, byCode };
}

/** A factor with an edge whose target also fails to reach the goal. */
function chainedDeadEnd(g: { nodes: any[]; edges: any[] }) {
  g.nodes.push({ id: "fac_up", kind: "factor", label: "Upstream", category: "external", data: { value: 0.4 } });
  g.nodes.push({ id: "fac_down", kind: "factor", label: "Downstream", category: "external", data: { value: 0.3 } });
  g.edges.push(edge("fac_up", "fac_down", 0.5));
}

/** A factor with no edges at all — the shape behind all 34 corpus records. */
function orphanFactor(g: { nodes: any[]; edges: any[] }) {
  g.nodes.push({ id: "fac_orphan", kind: "factor", label: "Budget", category: "external", data: { value: 0.4 } });
}

describe("a retained factor can be identified by the node it refers to", () => {
  // ── THE ACCEPTANCE ───────────────────────────────────────────────────────
  it("ACCEPTANCE: every retained-factor reference resolves to a node in the same graph", async () => {
    for (const [name, mutate] of [
      ["edge-bearing dead end", chainedDeadEnd],
      ["zero-edge orphan", orphanFactor],
      ["both at once", (g: any) => { chainedDeadEnd(g); orphanFactor(g); }],
    ] as const) {
      const { repairs, liveIds, nodeIdOf } = await sweep(mutate as any);
      const unresolved = repairs
        .filter((r) => r.code === "UNREACHABLE_FACTOR_RETAINED")
        .map((r) => ({ path: r.path, id: nodeIdOf(r) }))
        .filter((x) => x.id === undefined || !liveIds.has(x.id));

      expect(
        unresolved,
        `[${name}] UNREACHABLE_FACTOR_RETAINED names node(s) that are not in the ` +
          `graph: ${unresolved.map((u) => u.path).join(", ")}. "Retained" is a claim ` +
          "that the node is still there.",
      ).toEqual([]);
    }
  });

  // ── ARM A: the genuine class. Must keep working. ─────────────────────────
  it("keeps the record for a factor whose edge leads nowhere, and it resolves", async () => {
    const { liveIds, nodeIdOf, byCode } = await sweep(chainedDeadEnd);
    const retained = byCode("UNREACHABLE_FACTOR_RETAINED");

    // Non-vacuity: the arm must actually produce the record under test.
    expect(retained.length).toBeGreaterThan(0);
    const ids = retained.map(nodeIdOf);
    expect(ids).toContain("fac_up");
    for (const id of ids) expect(liveIds.has(id!)).toBe(true);
    // The node really is still in the graph the user receives.
    expect(liveIds.has("fac_up")).toBe(true);
  });

  // ── ARM B: the defect. ───────────────────────────────────────────────────
  it("does not claim it retained a factor the same sweep deleted", async () => {
    const { liveIds, byCode } = await sweep(orphanFactor);

    // Precondition, pinned IN-TEST: this arm's node really is deleted. Without
    // this the assertion below could pass because the prune never fired.
    expect(liveIds.has("fac_orphan")).toBe(false);

    const retained = byCode("UNREACHABLE_FACTOR_RETAINED");
    expect(
      retained.map((r) => r.path),
      'The sweep deleted "fac_orphan" and still reported it as retained.',
    ).toEqual([]);
  });

  // ── CONTRAST: only the FALSE claim is withdrawn, not the true one. ────────
  it("CONTRAST: the truthful prune record for that same node survives", async () => {
    const { byCode } = await sweep(orphanFactor);
    const pruned = byCode("DISCONNECTED_OBSERVABLE_PRUNED");
    expect(pruned.map((r) => r.path)).toContain("nodes[fac_orphan]");
    // And the reclassification receipt it already amends is untouched here.
    expect(byCode("UNREACHABLE_FACTOR_RECLASSIFIED").length).toBeGreaterThan(0);
  });

  // ── TWIN: a graph with both shapes keeps exactly the true half. ───────────
  it("TWIN: with both shapes present, keeps the surviving one and drops only the deleted one", async () => {
    const { liveIds, nodeIdOf, byCode } = await sweep((g) => {
      chainedDeadEnd(g);
      orphanFactor(g);
    });
    const ids = byCode("UNREACHABLE_FACTOR_RETAINED").map(nodeIdOf);
    expect(ids).toContain("fac_up");
    expect(ids).not.toContain("fac_orphan");
    for (const id of ids) expect(liveIds.has(id!)).toBe(true);
  });

  // ── TWIN: no pruning, nothing withdrawn. ─────────────────────────────────
  it("TWIN: a graph with no prunable factor is byte-identical to before", async () => {
    const { byCode, repairs } = await sweep(chainedDeadEnd);
    expect(byCode("DISCONNECTED_OBSERVABLE_PRUNED")).toEqual([]);
    // Nothing was withdrawn, so both retained records are still present.
    expect(byCode("UNREACHABLE_FACTOR_RETAINED").length).toBe(2);
    expect(repairs.length).toBeGreaterThan(0);
  });
});
