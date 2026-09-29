/**
 * NO_PATH_TO_GOAL duplicate-suppression guard — path-format mirror regression.
 *
 * The repair sweep's Step 8 ("proactive disconnected-option check") pushes a
 * synthetic NO_PATH_TO_GOAL violation for every still-disconnected option, and
 * carries a guard that is supposed to suppress the push when the authoritative
 * validator has ALREADY flagged that option. The guard compared two literal
 * path formats that had drifted apart:
 *
 *   producer  `src/validators/graph-validator.ts`  → `nodesById.<id>`
 *   guard     `deterministic-sweep.ts` Step 8      → `nodes[<id>]`
 *
 * `"nodes[opt_alpha]"` never equals `"nodesById.opt_alpha"`, so the guard was
 * STRUCTURALLY INCAPABLE of suppressing anything and every already-flagged
 * option was reported twice.
 *
 * These tests are a POSITIVE CONTROL FOR THE GUARD, not merely a duplicate
 * count: each duplicate-suppression case first proves (a) that the guard's loop
 * actually ran for the node (`disconnected_options_after` names it) and (b) that
 * the validator-produced entry the guard must suppress against is present. Only
 * then does it assert that exactly one entry survives. The third test is the
 * discrimination control: it proves the guard still lets a genuinely-new
 * proactive violation through, so "suppress everything" cannot pass.
 */

import { describe, it, expect, vi } from "vitest";

// Spread the real module (platform trap 12: a vi.mock factory REPLACES the
// module, so a hand-listed allowlist silently drops every export added later).
vi.mock("../../src/utils/telemetry.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
}));

import { runDeterministicSweep } from "../../src/cee/unified-pipeline/stages/repair/deterministic-sweep.js";
import { attemptOptionsIdenticalGracefulDedup } from "../../src/cee/unified-pipeline/stages/repair/options-identical-graceful-dedup.js";
import { validatorNodePath, sweepNodePath, pathsNameNode } from "../../src/validators/violation-paths.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

const EDGE = { strength_mean: 0.7, strength_std: 0.15, belief_exists: 0.9, effect_direction: "positive" as const };

/**
 * Two options that are BOTH disconnected from the goal: they have no outbound
 * edges at all, so no directed path option → … → goal exists. The status-quo
 * fix cannot rescue them either — it wires disconnected options to the
 * intervention targets of the CONNECTED options, and here there are none.
 */
function makeDisconnectedOptionsGraph(): any {
  return {
    version: "1",
    default_seed: 42,
    nodes: [
      { id: "dec_1", kind: "decision", label: "Decision" },
      { id: "opt_alpha", kind: "option", label: "Alpha" },
      { id: "opt_beta", kind: "option", label: "Beta" },
      { id: "fac_price", kind: "factor", label: "Price", category: "controllable", data: { value: 0.5, factor_type: "cost", extractionType: "explicit", uncertainty_drivers: ["market"] } },
      { id: "out_revenue", kind: "outcome", label: "Revenue" },
      { id: "goal_1", kind: "goal", label: "Maximise Revenue" },
    ],
    edges: [
      { from: "dec_1", to: "opt_alpha", ...EDGE, strength_mean: 1, strength_std: 0.01, belief_exists: 1 },
      { from: "dec_1", to: "opt_beta", ...EDGE, strength_mean: 1, strength_std: 0.01, belief_exists: 1 },
      { from: "fac_price", to: "out_revenue", ...EDGE },
      { from: "out_revenue", to: "goal_1", ...EDGE, strength_mean: 0.8, strength_std: 0.1, belief_exists: 0.95 },
    ],
    meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
  };
}

/** NO_PATH_TO_GOAL entries mentioning `nodeId`, matched format-agnostically. */
function noPathEntriesFor(ctx: any, nodeId: string): Array<{ path?: string; message?: string }> {
  return ((ctx.remainingViolations ?? []) as Array<{ code: string; path?: string; message?: string }>)
    .filter((v) => v.code === "NO_PATH_TO_GOAL" && typeof v.path === "string" && v.path.includes(nodeId));
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("deterministic sweep — Step 8 duplicate NO_PATH_TO_GOAL suppression", () => {
  it("emits ONE NO_PATH_TO_GOAL per option the validator already flagged (guard proven to run)", async () => {
    const ctx: any = { graph: makeDisconnectedOptionsGraph(), requestId: "t-dup-sweep", repairTrace: {} };
    await runDeterministicSweep(ctx);

    const trace = ctx.repairTrace?.deterministic_sweep as any;

    // Positive control (a): the guard's loop body actually executed for these
    // options. `disconnected_options_after` IS the array Step 8 iterates.
    expect(trace.disconnected_options_after).toEqual(expect.arrayContaining(["opt_alpha", "opt_beta"]));

    for (const optId of ["opt_alpha", "opt_beta"]) {
      const entries = noPathEntriesFor(ctx, optId);

      // Positive control (b): the validator-produced entry the guard is meant
      // to suppress against is present. Without this the assertion below could
      // pass on a graph where the validator said nothing at all.
      expect(entries.some((v) => v.path === `nodesById.${optId}`)).toBe(true);

      // The guard did its job: no second, synthetic copy of the same finding.
      expect(entries).toHaveLength(1);
    }
  });

  it("still adds the proactive NO_PATH_TO_GOAL when the validator did NOT flag it (guard discriminates)", async () => {
    // No decision node → graph-validator returns early from its whole
    // connectivity section (`decisions.length === 0` guard), so it emits no
    // NO_PATH_TO_GOAL. Step 8 is then the ONLY source of the finding and must
    // not be suppressed — this is the work the push exists to do.
    const graph = makeDisconnectedOptionsGraph();
    graph.nodes = graph.nodes.filter((n: any) => n.kind !== "decision");
    graph.edges = graph.edges.filter((e: any) => e.from !== "dec_1");

    const ctx: any = { graph, requestId: "t-discriminate", repairTrace: {} };
    await runDeterministicSweep(ctx);

    const trace = ctx.repairTrace?.deterministic_sweep as any;
    expect(trace.disconnected_options_after).toEqual(expect.arrayContaining(["opt_alpha", "opt_beta"]));

    for (const optId of ["opt_alpha", "opt_beta"]) {
      // Precondition: the validator really is silent here.
      expect(noPathEntriesFor(ctx, optId).some((v) => v.path === `nodesById.${optId}`)).toBe(false);
      // …so the proactive entry must survive.
      expect(noPathEntriesFor(ctx, optId)).toHaveLength(1);
      expect(noPathEntriesFor(ctx, optId)[0]!.message).toContain("proactive check");
    }
  });
});

describe("options-identical graceful dedup — same Step 8 block, second copy", () => {
  it("emits ONE NO_PATH_TO_GOAL per option the validator already flagged", () => {
    // Three options, all disconnected from the goal. Two share BOTH an
    // intervention signature and a label (the dedup's guard 3b declines on a
    // label mismatch), so exactly one is dropped; a third distinct option keeps
    // the post-drop count at 2 (guard 4 declines a 1-option decision).
    const graph = makeDisconnectedOptionsGraph();
    for (const n of graph.nodes) {
      if (n.id === "opt_alpha" || n.id === "opt_beta") {
        n.label = "Alpha";
        n.data = { interventions: { fac_price: 0.8 } };
      }
    }
    graph.nodes.push({ id: "opt_gamma", kind: "option", label: "Gamma", data: { interventions: { fac_price: 0.2 } } });
    graph.edges.push({ from: "dec_1", to: "opt_gamma", ...EDGE, strength_mean: 1, strength_std: 0.01, belief_exists: 1 });

    const ctx: any = { graph, requestId: "t-dup-dedup", repairTrace: {}, pipelineOutcome: { warnings: [] } };
    const report = attemptOptionsIdenticalGracefulDedup(ctx);

    // Precondition: the dedup actually ran and dropped a duplicate. If this is
    // null the assertions below would be vacuous.
    expect(report).not.toBeNull();

    const survivors = (ctx.graph.nodes as any[]).filter((n) => n.kind === "option").map((n) => n.id);
    expect(survivors.length).toBeGreaterThan(0);

    for (const optId of survivors) {
      const entries = noPathEntriesFor(ctx, optId);
      // Positive control: the validator-produced entry is present…
      expect(entries.some((v) => v.path === `nodesById.${optId}`)).toBe(true);
      // …and was suppressed rather than duplicated.
      expect(entries).toHaveLength(1);
    }
  });
});

describe("violation-paths — the shared builders the guards derive from", () => {
  it("pathsNameNode matches a node named in EITHER path family", () => {
    // Built from the builders, not from hand-written literals: if either
    // builder changes shape, the membership test moves with it.
    for (const build of [validatorNodePath, sweepNodePath]) {
      expect(pathsNameNode(new Set([build("opt_alpha")]), "opt_alpha")).toBe(true);
      expect(pathsNameNode(new Set([build("opt_alpha")]), "opt_beta")).toBe(false);
    }
    expect(pathsNameNode(new Set<string>(), "opt_alpha")).toBe(false);
  });

  it("is exact for ids containing path punctuation (an inverse parser would not be)", () => {
    // Node ids are `z.string().min(1)` — no character class — so `.` and `]`
    // are legal. `nodesById.a.b` is ambiguous to any parser; alias membership
    // is not. This is why the fix compares aliases instead of extracting ids.
    for (const id of ["a.b", "opt]x", "opt[1]", "a.b.c"]) {
      expect(pathsNameNode(new Set([validatorNodePath(id)]), id)).toBe(true);
      expect(pathsNameNode(new Set([sweepNodePath(id)]), id)).toBe(true);
    }
    // The ambiguity a parser would fall into, proven not to bite here.
    expect(pathsNameNode(new Set([validatorNodePath("a.b")]), "a")).toBe(false);
  });

  it("keeps the sweep path readable by the boundary parser it feeds", () => {
    // stages/boundary.ts turns a repair path back into a user-visible
    // `model_adjustments[].node_id` with exactly this regex. Pinning it here
    // means a change to `sweepNodePath` cannot silently break that consumer.
    const BOUNDARY_NODE_ID = /^nodes\[([^\]]+)\]/;
    for (const id of ["fac_price", "opt_alpha"]) {
      expect(BOUNDARY_NODE_ID.exec(sweepNodePath(id))?.[1]).toBe(id);
      expect(BOUNDARY_NODE_ID.exec(`${sweepNodePath(id)}.category`)?.[1]).toBe(id);
    }
  });
});
