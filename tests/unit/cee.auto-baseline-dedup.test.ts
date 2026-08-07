/**
 * Unit tests for Stage 4 Substep 0.9 — auto-baseline dedup.
 *
 * Covers the load-bearing safety rules from the user's brief:
 *   - PASSING control fixture: hiring brief (distinct baselines) — NO dedup fires.
 *   - FAILING regression fixture: pricing brief (auto-baseline duplicates explicit) — dedup fires.
 *   - All-baselines duplicate group: NO dedup (fall through to PR #202 bypass).
 *   - All-non-baselines duplicate group: NO dedup (user-explicit collision, bypass surfaces).
 *   - Edges referencing dropped baselines are removed.
 *   - Empty graph / no options / no duplicates: no-op.
 *   - Baseline detection priority matches graph-readiness.ts:206-217.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/utils/telemetry.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/utils/telemetry.js")>();
  return {
    ...original,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    emit: vi.fn(),
  };
});

import {
  runAutoBaselineDedup,
  isExplicitBaseline,
  looksHeuristicallyLikeBaseline,
  buildSignature,
  type OptionLike,
} from "../../src/cee/unified-pipeline/stages/repair/auto-baseline-dedup.js";
import type { StageContext, PipelineOutcome } from "../../src/cee/unified-pipeline/types.js";
import { emit, TelemetryEvents } from "../../src/utils/telemetry.js";

function makeOutcome(): PipelineOutcome {
  return {
    graph_drafted: false,
    graph_structurally_valid: false,
    deterministic_sweep_violations: 0,
    verification_status: "pass",
    validation_status: "pass",
    enrichment_status: "complete",
    coaching_status: "complete",
    warnings: [],
    llm_repair: { applied: false, cost: 0, duration_ms: 0 },
    repair_provenance: [],
  } as unknown as PipelineOutcome;
}

function makeCtx(graph: unknown): StageContext {
  return {
    requestId: "req-dedup-test",
    graph,
    pipelineOutcome: makeOutcome(),
    repairTrace: undefined,
  } as unknown as StageContext;
}

// ──────────────────────────────────────────────────────────────────
// Fixture builders — match the production V4 LLM-output node shape:
// `node.data.interventions: Record<string, number>`,
// `node.data.is_baseline: boolean`.
// ──────────────────────────────────────────────────────────────────

function optionNode(
  id: string,
  interventions: Record<string, number>,
  opts: { is_baseline?: boolean; node_is_baseline?: boolean; label?: string } = {},
): Record<string, unknown> {
  return {
    id,
    kind: "option",
    label: opts.label ?? id,
    // Node-level (legacy) surface — the draft LLM stamps this directly on
    // the node in the split-field emission shape (2026-07-14 rung-2 finding).
    ...(typeof opts.node_is_baseline === "boolean" ? { is_baseline: opts.node_is_baseline } : {}),
    data: {
      interventions,
      ...(typeof opts.is_baseline === "boolean" ? { is_baseline: opts.is_baseline } : {}),
    },
  };
}

function edge(from: string, to: string): Record<string, unknown> {
  return { from, to };
}

describe("runAutoBaselineDedup", () => {
  // ── Load-bearing positive case: failing pricing brief from staging ──
  it("drops auto-baseline duplicating an explicit option (the staging pricing-brief case)", () => {
    const graph = {
      nodes: [
        { id: "dec_pricing", kind: "decision", label: "Pricing decision" },
        { id: "goal_revenue", kind: "goal", label: "Revenue" },
        { id: "fac_onboarding_friction", kind: "factor", label: "Onboarding friction" },
        { id: "fac_price_point", kind: "factor", label: "Price point" },
        { id: "fac_sales_effort", kind: "factor", label: "Sales effort" },
        // The collision: opt_selfserve (explicit) and opt_status_quo (auto-baseline)
        // both end up with the same intervention signature.
        optionNode("opt_selfserve", {
          fac_onboarding_friction: 0.2,
          fac_price_point: 0.32,
          fac_sales_effort: 0.1,
        }),
        optionNode(
          "opt_status_quo",
          { fac_onboarding_friction: 0.2, fac_price_point: 0.32, fac_sales_effort: 0.1 },
          { is_baseline: true, label: "Keep Current Pricing (Status Quo)" },
        ),
        // A second, genuinely distinct explicit option (e.g. partner-led)
        optionNode("opt_partner_led", {
          fac_onboarding_friction: 0.5,
          fac_price_point: 0.6,
          fac_sales_effort: 0.7,
        }),
      ],
      edges: [
        edge("dec_pricing", "opt_selfserve"),
        edge("dec_pricing", "opt_status_quo"),
        edge("dec_pricing", "opt_partner_led"),
        edge("opt_status_quo", "fac_price_point"),
      ],
    };
    const ctx = makeCtx(graph);
    const report = runAutoBaselineDedup(ctx);

    // The baseline was dropped; the explicit option survives.
    expect(report.dropped_option_ids).toEqual(["opt_status_quo"]);
    expect(report.dropped_edge_count).toBe(2); // dec→status_quo + status_quo→fac_price_point
    const finalNodes = (ctx.graph as { nodes: Array<{ id: string }> }).nodes;
    const finalIds = finalNodes.map((n) => n.id);
    expect(finalIds).toContain("opt_selfserve");
    expect(finalIds).toContain("opt_partner_led");
    expect(finalIds).not.toContain("opt_status_quo");

    // Pipeline outcome surfaces the dedup as a non-degraded warning.
    expect(ctx.pipelineOutcome.warnings).toHaveLength(1);
    expect(ctx.pipelineOutcome.warnings[0].degraded).toBe(false);
    expect(ctx.pipelineOutcome.warnings[0].error).toContain("auto_baseline_dedup");

    // Repair trace records the diagnostic detail.
    expect((ctx.repairTrace as Record<string, unknown> | undefined)?.auto_baseline_dedup).toMatchObject({
      ran: true,
      dropped_option_ids: ["opt_status_quo"],
      dropped_edge_count: 2,
    });
  });

  // ── Load-bearing negative case: hiring brief from staging ──
  it("does NOT fire on the hiring brief — baseline has distinct interventions", () => {
    // The hiring brief renders successfully today (15 nodes / 25 edges per
    // staging evidence). Its opt_status_quo has DISTINCT interventions
    // from the explicit options, so the dedup must be a no-op.
    const graph = {
      nodes: [
        { id: "dec_hiring", kind: "decision", label: "Hiring decision" },
        { id: "goal_delivery", kind: "goal", label: "Delivery speed" },
        { id: "fac_dev_capacity", kind: "factor", label: "Dev capacity" },
        { id: "fac_leadership_capacity", kind: "factor", label: "Leadership capacity" },
        optionNode("opt_tech_lead", { fac_leadership_capacity: 1, fac_dev_capacity: 0 }),
        optionNode("opt_two_devs", { fac_leadership_capacity: 0, fac_dev_capacity: 1 }),
        optionNode("opt_one_dev", { fac_leadership_capacity: 0, fac_dev_capacity: 0.5 }),
        optionNode(
          "opt_status_quo",
          { fac_leadership_capacity: 0, fac_dev_capacity: 0 },
          { is_baseline: true, label: "No new hire (Status Quo)" },
        ),
      ],
      edges: [
        edge("dec_hiring", "opt_tech_lead"),
        edge("dec_hiring", "opt_two_devs"),
        edge("dec_hiring", "opt_one_dev"),
        edge("dec_hiring", "opt_status_quo"),
      ],
    };
    const ctx = makeCtx(graph);
    const report = runAutoBaselineDedup(ctx);

    expect(report.dropped_option_ids).toEqual([]);
    expect(report.dropped_edge_count).toBe(0);
    expect(report.groups_evaluated).toBe(0);
    // No warning recorded, no trace.
    expect(ctx.pipelineOutcome.warnings).toHaveLength(0);
    expect(ctx.repairTrace).toBeUndefined();
    // All 4 option nodes survive.
    const finalNodes = (ctx.graph as { nodes: Array<{ id: string }> }).nodes;
    expect(finalNodes.filter((n) => (n as { kind?: string }).kind === "option")).toHaveLength(4);
  });

  // ── Safety: don't dedup when all duplicates are baselines ──
  it("does NOT dedup when all duplicates in a group are baselines", () => {
    const graph = {
      nodes: [
        { id: "dec", kind: "decision" },
        optionNode(
          "opt_status_quo",
          { fac_x: 0 },
          { is_baseline: true, label: "Status Quo" },
        ),
        optionNode(
          "opt_baseline_alt",
          { fac_x: 0 },
          { is_baseline: true, label: "Baseline alternative" },
        ),
        optionNode("opt_active", { fac_x: 1 }),
      ],
      edges: [],
    };
    const ctx = makeCtx(graph);
    const report = runAutoBaselineDedup(ctx);

    expect(report.dropped_option_ids).toEqual([]);
    expect(report.groups_evaluated).toBe(1); // duplicate group existed but skipped
    expect(ctx.pipelineOutcome.warnings).toHaveLength(0);
    // Both baselines preserved — fall through to PR #202 bypass.
    const finalIds = (ctx.graph as { nodes: Array<{ id: string }> }).nodes.map((n) => n.id);
    expect(finalIds).toContain("opt_status_quo");
    expect(finalIds).toContain("opt_baseline_alt");
  });

  // ── Safety: don't dedup when both duplicates are non-baselines ──
  it("does NOT dedup when duplicate group contains only non-baselines (user-explicit collision)", () => {
    // Two user-explicit options happened to have identical interventions.
    // This is a real LLM error worth raising to the user via the PR #202
    // bypass — NOT something this dedup should silently fix.
    const graph = {
      nodes: [
        { id: "dec", kind: "decision" },
        optionNode("opt_explicit_a", { fac_x: 0.5, fac_y: 0.3 }),
        optionNode("opt_explicit_b", { fac_x: 0.5, fac_y: 0.3 }),
        optionNode("opt_distinct", { fac_x: 0.1, fac_y: 0.2 }),
      ],
      edges: [],
    };
    const ctx = makeCtx(graph);
    const report = runAutoBaselineDedup(ctx);

    expect(report.dropped_option_ids).toEqual([]);
    expect(report.groups_evaluated).toBe(1);
    expect(ctx.pipelineOutcome.warnings).toHaveLength(0);
    // All three options preserved.
    const finalIds = (ctx.graph as { nodes: Array<{ id: string }> }).nodes.map((n) => n.id);
    expect(finalIds).toEqual(expect.arrayContaining(["opt_explicit_a", "opt_explicit_b", "opt_distinct"]));
  });

  // ── Edge cleanup: dropped baseline's edges go too ──
  it("removes all edges referencing dropped baseline option ids", () => {
    const graph = {
      nodes: [
        { id: "dec", kind: "decision" },
        { id: "goal", kind: "goal" },
        { id: "fac_x", kind: "factor" },
        optionNode("opt_explicit", { fac_x: 0.5 }),
        optionNode("opt_status_quo", { fac_x: 0.5 }, { is_baseline: true, label: "Status Quo" }),
      ],
      edges: [
        edge("dec", "opt_explicit"),
        edge("dec", "opt_status_quo"), // → drops
        edge("opt_status_quo", "fac_x"), // → drops
        edge("opt_explicit", "fac_x"),
        edge("fac_x", "goal"),
      ],
    };
    const ctx = makeCtx(graph);
    const report = runAutoBaselineDedup(ctx);

    expect(report.dropped_option_ids).toEqual(["opt_status_quo"]);
    expect(report.dropped_edge_count).toBe(2);
    const finalEdges = (ctx.graph as { edges: Array<{ from?: string; to?: string }> }).edges;
    // No surviving edge references opt_status_quo.
    expect(finalEdges.some((e) => e.from === "opt_status_quo" || e.to === "opt_status_quo")).toBe(false);
    // Other edges preserved.
    expect(finalEdges).toContainEqual(edge("dec", "opt_explicit"));
    expect(finalEdges).toContainEqual(edge("opt_explicit", "fac_x"));
    expect(finalEdges).toContainEqual(edge("fac_x", "goal"));
  });

  // ── Baseline detection: explicit is_baseline === true takes priority ──
  it("uses explicit is_baseline === true over label/id heuristics (priority alignment with graph-readiness)", () => {
    // One option has is_baseline=true with a non-status-quo label;
    // another has a status-quo label but is_baseline=false.
    // The explicit flag wins.
    const graph = {
      nodes: [
        { id: "dec", kind: "decision" },
        optionNode(
          "opt_marked_explicit_baseline",
          { fac_x: 0.5 },
          { is_baseline: true, label: "Some marketing strategy" },
        ),
        optionNode(
          "opt_named_status_quo",
          { fac_x: 0.5 },
          { is_baseline: false, label: "Status Quo" }, // false flag → not a baseline
        ),
      ],
      edges: [],
    };
    const ctx = makeCtx(graph);
    const report = runAutoBaselineDedup(ctx);

    // The is_baseline=true option is dropped; the labelled-as-status-quo
    // option survives (because its explicit flag is false).
    expect(report.dropped_option_ids).toEqual(["opt_marked_explicit_baseline"]);
  });

  // ── ROUND-2 REVIEW SAFETY TESTS — heuristic-only matches MUST NOT delete ──
  //
  // The reviewer caught a real safety issue: a user-explicit option
  // labelled "Status Quo" / "No Change" / etc., or with id ending in
  // `_status_quo` / `_baseline`, may be a deliberate user-supplied
  // decision option. Deleting it silently when it collides with another
  // option is unsafe. The strict-flag rule: deletion requires
  // `is_baseline === true`; heuristic matches generate diagnostic
  // telemetry only.

  it("does NOT delete a user-provided 'Status Quo' label without explicit is_baseline flag", () => {
    // User typed "Status Quo" as a deliberate, distinct option. The LLM
    // forgot to set is_baseline=true (prompt drift). The collision must
    // flow to PR #202's OPTIONS_IDENTICAL bypass, NOT silently delete
    // the user's option.
    const graph = {
      nodes: [
        { id: "dec", kind: "decision" },
        optionNode("opt_explicit", { fac_x: 0.5 }),
        optionNode("opt_user_status_quo", { fac_x: 0.5 }, { label: "Status Quo" }),
      ],
      edges: [],
    };
    const ctx = makeCtx(graph);
    const report = runAutoBaselineDedup(ctx);

    // CRITICAL: no deletion. Both options survive intact.
    expect(report.dropped_option_ids).toEqual([]);
    expect(report.dropped_edge_count).toBe(0);
    const finalIds = (ctx.graph as { nodes: Array<{ id: string }> }).nodes.map((n) => n.id);
    expect(finalIds).toContain("opt_explicit");
    expect(finalIds).toContain("opt_user_status_quo");

    // Diagnostic-only telemetry IS emitted so operators can see the
    // LLM prompt drift (prompt mandates is_baseline=true).
    expect(report.heuristic_only_collisions).toBe(1);
  });

  it("does NOT delete an option whose id ends in '_status_quo' without explicit flag", () => {
    const graph = {
      nodes: [
        { id: "dec", kind: "decision" },
        optionNode("opt_explicit", { fac_x: 0.5 }),
        // id-suffix matches heuristic, but no explicit flag.
        optionNode("opt_keep_current_status_quo", { fac_x: 0.5 }, { label: "Keep current" }),
      ],
      edges: [],
    };
    const ctx = makeCtx(graph);
    const report = runAutoBaselineDedup(ctx);

    expect(report.dropped_option_ids).toEqual([]);
    expect(report.heuristic_only_collisions).toBe(1);
    const finalIds = (ctx.graph as { nodes: Array<{ id: string }> }).nodes.map((n) => n.id);
    expect(finalIds).toContain("opt_keep_current_status_quo");
  });

  it("does NOT delete an option labelled 'No Change' / 'Baseline' / 'Do Nothing' without explicit flag", () => {
    // The full heuristic label set must NOT authorise deletion alone.
    // Use neutral ids (no _status_quo / _baseline suffix) so only the
    // labelled option matches the heuristic — proves the LABEL alone
    // is insufficient for deletion.
    const labelsToTest = ["No Change", "Baseline", "Do Nothing"];
    for (const label of labelsToTest) {
      const graph = {
        nodes: [
          { id: "dec", kind: "decision" },
          optionNode("opt_active", { fac_x: 0.5 }),
          optionNode("opt_heuristic", { fac_x: 0.5 }, { label }),
        ],
        edges: [],
      };
      const ctx = makeCtx(graph);
      const report = runAutoBaselineDedup(ctx);
      expect(report.dropped_option_ids).toEqual([]);
      // Exactly one option in the group is heuristic-baseline → diagnostic fires.
      expect(report.heuristic_only_collisions).toBe(1);
    }
  });

  it("heuristic-only collision still emits diagnostic telemetry (operator visibility)", () => {
    // Even though no mutation occurred, the event fires so ops can see
    // LLM prompt drift (missing is_baseline flag on a status-quo-shaped
    // option).
    const graph = {
      nodes: [
        { id: "dec", kind: "decision" },
        optionNode("opt_explicit", { fac_x: 0.5 }),
        optionNode("opt_user_status_quo", { fac_x: 0.5 }, { label: "Status Quo" }),
      ],
      edges: [],
    };
    const ctx = makeCtx(graph);
    const report = runAutoBaselineDedup(ctx);
    expect(report.heuristic_only_collisions).toBe(1);
    // pipelineOutcome.warnings is NOT populated for heuristic-only
    // (no mutation = no warning).
    expect(ctx.pipelineOutcome.warnings).toHaveLength(0);
    // repairTrace is NOT populated for heuristic-only (no mutation = no trace).
    expect(ctx.repairTrace).toBeUndefined();
  });

  it("emits CeeAutoBaselineHeuristicOnlyCollision event directly on heuristic-only collision (round-2 review test #3)", () => {
    // Reviewer specifically requested: assert the diagnostic telemetry
    // is emitted, not just that `report.heuristic_only_collisions` is
    // incremented. The emit call surfaces the drift signal to the
    // observability layer (datadog/sentry/etc.).
    vi.mocked(emit).mockClear();
    const graph = {
      nodes: [
        { id: "dec", kind: "decision" },
        optionNode("opt_explicit", { fac_x: 0.5 }),
        optionNode("opt_user_status_quo", { fac_x: 0.5 }, { label: "Status Quo" }),
      ],
      edges: [],
    };
    runAutoBaselineDedup(makeCtx(graph));

    // Direct assertion: the emit call landed.
    const calls = vi.mocked(emit).mock.calls;
    const heuristicEvent = calls.find(
      (c) => c[0] === TelemetryEvents.CeeAutoBaselineHeuristicOnlyCollision,
    );
    expect(heuristicEvent).toBeDefined();
    // Payload is count-only (no IDs in the emitted event — IDs are in
    // the structured log line for operator diagnostics).
    expect(heuristicEvent![1]).toMatchObject({
      heuristic_only_groups: 1,
      heuristic_only_option_ids_count: 1,
    });
    expect(heuristicEvent![1]).not.toHaveProperty("heuristic_only_option_ids");

    // The dedup-applied event is NOT emitted on heuristic-only paths.
    const appliedEvent = calls.find(
      (c) => c[0] === TelemetryEvents.CeeAutoBaselineDedupApplied,
    );
    expect(appliedEvent).toBeUndefined();
  });

  it("emits CeeAutoBaselineDedupApplied event directly on successful dedup (round-2 review test #3)", () => {
    // Paired test: when dedup DOES fire, the applied event lands with
    // count-only payload.
    vi.mocked(emit).mockClear();
    const graph = {
      nodes: [
        { id: "dec", kind: "decision" },
        optionNode("opt_explicit", { fac_x: 0.5 }),
        optionNode(
          "opt_status_quo",
          { fac_x: 0.5 },
          { is_baseline: true, label: "Status Quo" },
        ),
      ],
      edges: [edge("dec", "opt_explicit"), edge("dec", "opt_status_quo")],
    };
    runAutoBaselineDedup(makeCtx(graph));

    const calls = vi.mocked(emit).mock.calls;
    const appliedEvent = calls.find(
      (c) => c[0] === TelemetryEvents.CeeAutoBaselineDedupApplied,
    );
    expect(appliedEvent).toBeDefined();
    expect(appliedEvent![1]).toMatchObject({
      dropped_option_ids_count: 1,
      dropped_edge_count: 1,
      groups_evaluated: 1,
    });
    // Count-only — IDs in the structured log, not the emit event.
    expect(appliedEvent![1]).not.toHaveProperty("dropped_option_ids");

    // Heuristic-only event is NOT emitted on the applied path.
    const heuristicEvent = calls.find(
      (c) => c[0] === TelemetryEvents.CeeAutoBaselineHeuristicOnlyCollision,
    );
    expect(heuristicEvent).toBeUndefined();
  });

  it("explicit is_baseline=true takes priority over a non-baseline-flagged 'Status Quo' label", () => {
    // Existing precedence test: when ANY option has explicit
    // is_baseline=true, only that option is droppable. A separate
    // option labelled "Status Quo" with is_baseline=false (or absent)
    // is NOT a deletion target.
    const graph = {
      nodes: [
        { id: "dec", kind: "decision" },
        optionNode(
          "opt_real_baseline",
          { fac_x: 0.5 },
          { is_baseline: true, label: "Some marketing strategy" },
        ),
        optionNode(
          "opt_user_status_quo",
          { fac_x: 0.5 },
          { is_baseline: false, label: "Status Quo" },
        ),
      ],
      edges: [],
    };
    const ctx = makeCtx(graph);
    const report = runAutoBaselineDedup(ctx);

    // The explicit-flagged option IS dropped (safe — known LLM-injected baseline).
    expect(report.dropped_option_ids).toEqual(["opt_real_baseline"]);
    // The user's labelled-as-Status-Quo option survives (no explicit flag).
    const finalIds = (ctx.graph as { nodes: Array<{ id: string }> }).nodes.map((n) => n.id);
    expect(finalIds).toContain("opt_user_status_quo");
  });

  // ── No-op edge cases ──
  it("no-op when graph has no options", () => {
    const ctx = makeCtx({ nodes: [{ id: "goal", kind: "goal" }], edges: [] });
    const report = runAutoBaselineDedup(ctx);
    expect(report.dropped_option_ids).toEqual([]);
    expect(report.groups_evaluated).toBe(0);
  });

  it("no-op when graph has only one option", () => {
    const ctx = makeCtx({
      nodes: [{ id: "dec", kind: "decision" }, optionNode("opt_only", { fac_x: 0.5 })],
      edges: [],
    });
    const report = runAutoBaselineDedup(ctx);
    expect(report.dropped_option_ids).toEqual([]);
  });

  it("no-op when ctx.graph is undefined", () => {
    const ctx = makeCtx(undefined);
    const report = runAutoBaselineDedup(ctx);
    expect(report.dropped_option_ids).toEqual([]);
  });

  it("no-op when no duplicate signatures exist", () => {
    const ctx = makeCtx({
      nodes: [
        optionNode("opt_a", { fac_x: 0.1 }),
        optionNode("opt_b", { fac_x: 0.2 }),
        optionNode("opt_c", { fac_x: 0.3 }, { is_baseline: true }),
      ],
      edges: [],
    });
    const report = runAutoBaselineDedup(ctx);
    expect(report.dropped_option_ids).toEqual([]);
    expect(report.groups_evaluated).toBe(0);
  });

  // ── SPLIT-FIELD baseline flag (2026-07-14 rung-2 finding, live variant (b)) ──
  //
  // Measured offline 5/30 across BOTH prompt versions: the draft LLM emits
  // node-level `is_baseline: true` but `data.is_baseline: false` on the same
  // status-quo option. The old data-first read let data:false MASK the
  // explicit node:true, so the option was treated as non-explicit, the #203
  // dedup could not fire, and the collision fell to the #452 heuristic
  // decline (Guard 2) → fail-fast → HTTP 500. An explicit `true` on EITHER
  // surface must win so the collision is absorbed at substep 0.9.

  it("absorbs the live current-CHANNEL-1 split-field shape via the explicit-baseline dedup path (no fall-through to the bypass)", () => {
    // Exact option ids / labels / vectors from
    // acceptance-evidence/behavioural-retest-2026-07-14/rung2-prompt-candidate/
    // samples/current-CHANNEL-1.json, in repair-stage shape
    // (interventions normalised to Record<string, number>).
    const graph = {
      nodes: [
        { id: "dec_channel", kind: "decision", label: "Channel decision" },
        { id: "goal_profit", kind: "goal", label: "Profit" },
        { id: "fac_channel_focus", kind: "factor", label: "Channel focus" },
        { id: "fac_cac_spend", kind: "factor", label: "CAC spend" },
        { id: "fac_margin_rate", kind: "factor", label: "Margin rate" },
        optionNode(
          "opt_own_site",
          { fac_channel_focus: 1, fac_cac_spend: 0.7, fac_margin_rate: 0.75 },
          { is_baseline: false, node_is_baseline: false, label: "Go All-In on Own Webshop" },
        ),
        optionNode(
          "opt_amazon",
          { fac_channel_focus: 0, fac_cac_spend: 0.3, fac_margin_rate: 0.4 },
          { is_baseline: false, node_is_baseline: false, label: "Double Down on Amazon" },
        ),
        optionNode(
          "opt_split",
          { fac_channel_focus: 0.5, fac_cac_spend: 0.5, fac_margin_rate: 0.58 },
          { is_baseline: false, node_is_baseline: false, label: "Split Focus Across Both Channels" },
        ),
        // THE SPLIT-FIELD EMISSION: node-level true, data-level false —
        // colliding with opt_split on {0.5, 0.5, 0.58}.
        optionNode(
          "opt_status_quo",
          { fac_channel_focus: 0.5, fac_cac_spend: 0.5, fac_margin_rate: 0.58 },
          { is_baseline: false, node_is_baseline: true, label: "Continue Current Mix (Status Quo)" },
        ),
      ],
      edges: [
        edge("dec_channel", "opt_own_site"),
        edge("dec_channel", "opt_amazon"),
        edge("dec_channel", "opt_split"),
        edge("dec_channel", "opt_status_quo"),
        edge("opt_status_quo", "fac_channel_focus"),
      ],
    };
    const ctx = makeCtx(graph);
    const report = runAutoBaselineDedup(ctx);

    // The explicit-baseline dedup path absorbs the collision: the
    // node-level-flagged status quo is dropped, the non-explicit
    // colliding option survives.
    expect(report.dropped_option_ids).toEqual(["opt_status_quo"]);
    expect(report.dropped_edge_count).toBe(2);
    // NOT misclassified as heuristic-only prompt drift — the flag IS explicit.
    expect(report.heuristic_only_collisions).toBe(0);

    const finalNodes = (ctx.graph as { nodes: Array<Record<string, unknown>> }).nodes;
    const finalIds = finalNodes.map((n) => n.id);
    expect(finalIds).toContain("opt_own_site");
    expect(finalIds).toContain("opt_amazon");
    expect(finalIds).toContain("opt_split");
    expect(finalIds).not.toContain("opt_status_quo");

    // No OPTIONS_IDENTICAL collision remains for the downstream sweep —
    // i.e. the draft can never reach the fail-fast bypass (the 500 path)
    // on this shape. Verified with the validator's own identity definition.
    const survivingSignatures = finalNodes
      .filter((n) => n.kind === "option")
      .map((n) => buildSignature((n.data as { interventions?: Record<string, unknown> }).interventions));
    expect(new Set(survivingSignatures).size).toBe(survivingSignatures.length);
  });

  // ── Truth table for the explicit-baseline read (data.is_baseline × node.is_baseline) ──
  //
  // The dangerous cell is (data:false, node:true): an explicit true must
  // never be masked by the sibling surface's false. Explicit-false-only and
  // absent cells keep their previous semantics.
  it("isExplicitBaseline: explicit true on EITHER surface wins; false/absent cells unchanged", () => {
    const cell = (data: boolean | undefined, node: boolean | undefined): OptionLike => ({
      id: "opt_x",
      kind: "option",
      label: "opt_x",
      ...(node !== undefined ? { is_baseline: node } : {}),
      data: { interventions: { fac_x: 0.5 }, ...(data !== undefined ? { is_baseline: data } : {}) },
    });

    // [data, node, expected isExplicitBaseline]
    const table: Array<[boolean | undefined, boolean | undefined, boolean]> = [
      [true, true, true], // both true → explicit (unchanged)
      [true, false, true], // data true wins (unchanged)
      [true, undefined, true], // canonical surface alone (unchanged)
      [false, true, true], // THE FIX: node-level explicit true no longer masked by data:false
      [false, false, false], // explicit false on both → not baseline (unchanged)
      [false, undefined, false], // explicit false, no node flag (unchanged)
      [undefined, true, true], // node-level fallback (unchanged)
      [undefined, false, false], // node-level explicit false (unchanged)
      [undefined, undefined, false], // absent both → not explicit (heuristics' territory, unchanged)
    ];
    for (const [data, node, expected] of table) {
      expect(isExplicitBaseline(cell(data, node)), `data=${data} node=${node}`).toBe(expected);
    }
  });

  it("looksHeuristicallyLikeBaseline: split-field explicit true is NOT heuristic; absent/false-flag heuristics unchanged", () => {
    const sq = (data: boolean | undefined, node: boolean | undefined): OptionLike => ({
      id: "opt_status_quo",
      kind: "option",
      label: "Status Quo",
      ...(node !== undefined ? { is_baseline: node } : {}),
      data: { interventions: { fac_x: 0.5 }, ...(data !== undefined ? { is_baseline: data } : {}) },
    });

    // Split-field shape is now EXPLICIT, so the heuristic classifier must
    // not claim it (it feeds Guard 2 in the #452 graceful dedup and the
    // heuristic-only drift telemetry).
    expect(looksHeuristicallyLikeBaseline(sq(false, true))).toBe(false);
    // GREEN-PINS: absent-flag and explicit-false shapes keep their previous
    // heuristic classification (label/id vocabulary untouched).
    expect(looksHeuristicallyLikeBaseline(sq(undefined, undefined))).toBe(true);
    expect(looksHeuristicallyLikeBaseline(sq(false, false))).toBe(true);
    expect(looksHeuristicallyLikeBaseline(sq(false, undefined))).toBe(true);
  });

  // ── GREEN-PIN: explicit false on BOTH surfaces still never authorises deletion ──
  it("does NOT delete on collision when is_baseline is explicitly false on both surfaces (heuristic-only telemetry fires)", () => {
    const graph = {
      nodes: [
        { id: "dec", kind: "decision" },
        optionNode("opt_explicit", { fac_x: 0.5 }),
        optionNode(
          "opt_user_status_quo",
          { fac_x: 0.5 },
          { is_baseline: false, node_is_baseline: false, label: "Status Quo" },
        ),
      ],
      edges: [],
    };
    const ctx = makeCtx(graph);
    const report = runAutoBaselineDedup(ctx);

    expect(report.dropped_option_ids).toEqual([]);
    expect(report.dropped_edge_count).toBe(0);
    // Still surfaces as heuristic-only drift (unchanged from pre-fix).
    expect(report.heuristic_only_collisions).toBe(1);
    const finalIds = (ctx.graph as { nodes: Array<{ id: string }> }).nodes.map((n) => n.id);
    expect(finalIds).toContain("opt_user_status_quo");
  });

  it("handles multiple distinct duplicate groups (drops baselines in each)", () => {
    // Two separate collision groups, each with an auto-baseline duplicate.
    const graph = {
      nodes: [
        { id: "dec", kind: "decision" },
        optionNode("opt_a1_explicit", { fac_x: 0.5 }),
        optionNode("opt_a1_baseline", { fac_x: 0.5 }, { is_baseline: true }),
        optionNode("opt_a2_explicit", { fac_x: 0.9 }),
        optionNode("opt_a2_baseline", { fac_x: 0.9 }, { is_baseline: true }),
      ],
      edges: [],
    };
    const ctx = makeCtx(graph);
    const report = runAutoBaselineDedup(ctx);
    expect([...report.dropped_option_ids].sort()).toEqual(["opt_a1_baseline", "opt_a2_baseline"]);
    expect(report.groups_evaluated).toBe(2);
  });
});
