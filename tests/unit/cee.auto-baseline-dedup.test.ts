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

import { runAutoBaselineDedup } from "../../src/cee/unified-pipeline/stages/repair/auto-baseline-dedup.js";
import type { StageContext, PipelineOutcome } from "../../src/cee/unified-pipeline/types.js";

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
  opts: { is_baseline?: boolean; label?: string } = {},
): Record<string, unknown> {
  return {
    id,
    kind: "option",
    label: opts.label ?? id,
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

  // ── Baseline detection: label heuristic only when no explicit flags ──
  it("falls back to label heuristic when no option has explicit is_baseline flag", () => {
    const graph = {
      nodes: [
        { id: "dec", kind: "decision" },
        optionNode("opt_explicit", { fac_x: 0.5 }),
        optionNode("opt_baseline_via_label", { fac_x: 0.5 }, { label: "Status Quo" }),
      ],
      edges: [],
    };
    const ctx = makeCtx(graph);
    const report = runAutoBaselineDedup(ctx);
    expect(report.dropped_option_ids).toEqual(["opt_baseline_via_label"]);
  });

  // ── Baseline detection: id-suffix heuristic ──
  it("falls back to id-suffix heuristic when no option has explicit flag or matching label", () => {
    const graph = {
      nodes: [
        { id: "dec", kind: "decision" },
        optionNode("opt_explicit", { fac_x: 0.5 }),
        optionNode("opt_keep_current_status_quo", { fac_x: 0.5 }, { label: "Keep current" }),
      ],
      edges: [],
    };
    const ctx = makeCtx(graph);
    const report = runAutoBaselineDedup(ctx);
    expect(report.dropped_option_ids).toEqual(["opt_keep_current_status_quo"]);
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
    expect(report.dropped_option_ids.sort()).toEqual(["opt_a1_baseline", "opt_a2_baseline"]);
    expect(report.groups_evaluated).toBe(2);
  });
});
