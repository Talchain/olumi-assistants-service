/**
 * Graceful dedup of AI-inferred duplicate options at the OPTIONS_IDENTICAL
 * bypass (ROADMAP 2.53, mitigation rung 1).
 *
 * OBSERVED DEFECT (staging 2026-07-14, build 73b2129): the draft LLM emits a
 * "hybrid" option whose interventions are identical to the SMB pole's
 * ({fac_enterprise_focus:0, fac_smb_focus:1}); both options are AI-inferred
 * (no explicit is_baseline), so the #203 auto-baseline dedup cannot fire, the
 * #202 bypass skips LLM repair, and the whole ~55s draft dies as an HTTP 500
 * INTERNAL_ERROR retryable:false. 12/18 drafts on one brief failed this way.
 *
 * FIX UNDER TEST (failure-path only): when the duplicate group that reaches
 * the bypass consists entirely of AI-inferred options (no explicit
 * is_baseline, no baseline-shaped label/id, no from_brief extraction marker),
 * drop the later-listed duplicate(s), keep the first, remove edges referencing
 * the dropped ids (the exact mechanism #203 uses), and let the draft continue
 * — but ONLY when >=2 usable options remain.
 *
 * GREEN-PINS (behaviour that must NOT change):
 *  - explicit is_baseline duplicate groups still take #203's doctrine
 *    (all-explicit groups keep today's fail-fast error);
 *  - heuristic-baseline-shaped duplicates (label "Status Quo" etc., no flag)
 *    keep today's error (#203 deliberately routes them to the typed
 *    clarification);
 *  - a full collision that would leave <2 options keeps today's error;
 *  - non-colliding drafts are byte-identical (no graph mutation at all).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/utils/telemetry.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/utils/telemetry.js")>();
  return {
    ...original,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    emit: vi.fn(),
  };
});

import { emit } from "../../src/utils/telemetry.js";
import {
  runOptionsIdenticalBypass,
} from "../../src/cee/unified-pipeline/stages/repair/options-identical-bypass.js";
import type { StageContext, PipelineOutcome } from "../../src/cee/unified-pipeline/types.js";
import type { GraphT } from "../../src/schemas/graph.js";

const DROPPED_DUPLICATE_EVENT = "cee.options_identical.dropped_duplicate";
const BYPASS_EVENT = "cee.options_identical.pre_repair_bypass";

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

/**
 * Graph mirroring the exact observed failing shape: two-pole brief, the model
 * invents a hybrid whose interventions collapse onto the SMB pole
 * ({fac_enterprise_focus:0, fac_smb_focus:1}); a third distinct option
 * (enterprise pole) is present. Both colliding options are plain AI-drafted
 * options — no is_baseline flag, no baseline-shaped label/id, no
 * extractionType marker.
 */
function makeObservedShapeGraph(): GraphT {
  return {
    version: "1",
    default_seed: 42,
    nodes: [
      { id: "decision_1", kind: "decision", label: "Enterprise vs SMB focus?" },
      {
        id: "opt_enterprise",
        kind: "option",
        label: "Focus on enterprise",
        data: { interventions: { fac_enterprise_focus: 1, fac_smb_focus: 0 } },
      },
      {
        id: "opt_smb",
        kind: "option",
        label: "Focus on SMB",
        data: { interventions: { fac_enterprise_focus: 0, fac_smb_focus: 1 } },
      },
      {
        id: "opt_hybrid",
        kind: "option",
        label: "Hybrid approach",
        // Identical to opt_smb — the observed collision.
        data: { interventions: { fac_enterprise_focus: 0, fac_smb_focus: 1 } },
      },
      {
        id: "fac_enterprise_focus",
        kind: "factor",
        label: "Enterprise focus",
        category: "controllable" as any,
        data: {
          value: 0.5,
          extractionType: "explicit",
          factor_type: "other",
          uncertainty_drivers: ["market"],
        },
      },
      {
        id: "fac_smb_focus",
        kind: "factor",
        label: "SMB focus",
        category: "controllable" as any,
        data: {
          value: 0.5,
          extractionType: "explicit",
          factor_type: "other",
          uncertainty_drivers: ["market"],
        },
      },
      { id: "outcome_1", kind: "outcome", label: "Revenue" },
      { id: "goal_1", kind: "goal", label: "Grow revenue" },
    ],
    edges: [
      { from: "decision_1", to: "opt_enterprise", strength_mean: 1, belief_exists: 1 },
      { from: "decision_1", to: "opt_smb", strength_mean: 1, belief_exists: 1 },
      { from: "decision_1", to: "opt_hybrid", strength_mean: 1, belief_exists: 1 },
      { from: "opt_enterprise", to: "fac_enterprise_focus", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
      { from: "opt_enterprise", to: "fac_smb_focus", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
      { from: "opt_smb", to: "fac_enterprise_focus", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
      { from: "opt_smb", to: "fac_smb_focus", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
      { from: "opt_hybrid", to: "fac_enterprise_focus", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
      { from: "opt_hybrid", to: "fac_smb_focus", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
      { from: "fac_enterprise_focus", to: "outcome_1", strength_mean: 0.8, belief_exists: 0.9 },
      { from: "fac_smb_focus", to: "outcome_1", strength_mean: 0.8, belief_exists: 0.9 },
      { from: "outcome_1", to: "goal_1", strength_mean: 0.9, belief_exists: 1 },
    ],
    meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
  } as unknown as GraphT;
}

const OBSERVED_SIGNATURE = "fac_enterprise_focus:0.0000|fac_smb_focus:1.0000";

function observedViolation() {
  return {
    code: "OPTIONS_IDENTICAL",
    message: "Options have identical intervention signatures: opt_smb, opt_hybrid",
    context: { optionIds: ["opt_smb", "opt_hybrid"], signature: OBSERVED_SIGNATURE },
  };
}

function makeCtx(overrides: Partial<StageContext> = {}): StageContext {
  return {
    requestId: "req-graceful-dedup-test",
    graph: makeObservedShapeGraph(),
    pipelineOutcome: makeOutcome(),
    remainingViolations: [observedViolation()],
    llmRepairNeeded: true,
    ...overrides,
  } as StageContext;
}

function graphNodes(ctx: StageContext): Array<{ id: string; kind: string }> {
  return ((ctx.graph as any)?.nodes ?? []) as Array<{ id: string; kind: string }>;
}

function graphEdges(ctx: StageContext): Array<{ from: string; to: string }> {
  return ((ctx.graph as any)?.edges ?? []) as Array<{ from: string; to: string }>;
}

const emitMock = vi.mocked(emit);

describe("OPTIONS_IDENTICAL graceful dedup of AI-inferred duplicates (observed 2026-07-14 shape)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("RED→GREEN: drops the AI-inferred duplicate and continues instead of erroring", () => {
    const ctx = makeCtx();

    const fired = runOptionsIdenticalBypass(ctx);

    // The draft continues — no fail-fast error.
    expect(fired).toBe(false);
    expect(ctx.earlyReturn).toBeUndefined();

    // The later-listed duplicate (the invented hybrid) is dropped; the
    // first-listed colliding option (the SMB pole) and the distinct
    // enterprise pole survive.
    const ids = graphNodes(ctx).map((n) => n.id);
    expect(ids).not.toContain("opt_hybrid");
    expect(ids).toContain("opt_smb");
    expect(ids).toContain("opt_enterprise");

    // No dangling references: no edge touches the dropped id.
    for (const e of graphEdges(ctx)) {
      expect(e.from).not.toBe("opt_hybrid");
      expect(e.to).not.toBe("opt_hybrid");
    }
    // The survivor's edges are intact.
    expect(graphEdges(ctx).some((e) => e.from === "decision_1" && e.to === "opt_smb")).toBe(true);
    expect(graphEdges(ctx).some((e) => e.from === "opt_smb" && e.to === "fac_smb_focus")).toBe(true);
  });

  it("re-derives remainingViolations and llmRepairNeeded from the post-drop graph (no stale OPTIONS_IDENTICAL, no pointless LLM repair)", () => {
    const ctx = makeCtx();

    runOptionsIdenticalBypass(ctx);

    const codes = (ctx.remainingViolations ?? []).map((v) => v.code);
    expect(codes).not.toContain("OPTIONS_IDENTICAL");
    // The fixture is fully valid once the duplicate is gone.
    expect(ctx.remainingViolations).toEqual([]);
    expect(ctx.llmRepairNeeded).toBe(false);
  });

  it("emits the dropped_duplicate telemetry variant (not the bypass event) and records an observable trace", () => {
    const ctx = makeCtx();

    runOptionsIdenticalBypass(ctx);

    const eventNames = emitMock.mock.calls.map((c) => c[0] as string);
    expect(eventNames).toContain(DROPPED_DUPLICATE_EVENT);
    expect(eventNames).not.toContain(BYPASS_EVENT);

    const payload = emitMock.mock.calls.find((c) => c[0] === DROPPED_DUPLICATE_EVENT)?.[1] as Record<string, unknown>;
    expect(payload.dropped_option_ids_count).toBe(1);

    // pipelineOutcome carries a non-degraded informational warning.
    expect(ctx.pipelineOutcome.warnings).toHaveLength(1);
    expect(ctx.pipelineOutcome.warnings[0].stage).toBe("repair");
    expect(ctx.pipelineOutcome.warnings[0].degraded).toBe(false);
    expect(ctx.pipelineOutcome.warnings[0].error).toContain("opt_hybrid");

    // repairTrace records the drop for debug bundles.
    const trace = (ctx.repairTrace ?? {}) as Record<string, any>;
    expect(trace.options_identical_dedup?.dropped_option_ids).toEqual(["opt_hybrid"]);
    expect(trace.options_identical_dedup?.kept_option_ids).toEqual(["opt_smb"]);
  });

  it("keeps a from_brief-marked option over an earlier-listed AI-inferred duplicate", () => {
    const graph = makeObservedShapeGraph() as any;
    // Reorder: hybrid (AI-inferred) listed BEFORE smb; smb carries a
    // from_brief extraction marker. The from_brief option must survive.
    const byId = new Map(graph.nodes.map((n: any) => [n.id, n]));
    const smb: any = byId.get("opt_smb");
    smb.data.extractionType = "explicit";
    graph.nodes = graph.nodes.filter((n: any) => n.id !== "opt_smb");
    const hybridIdx = graph.nodes.findIndex((n: any) => n.id === "opt_hybrid");
    graph.nodes.splice(hybridIdx + 1, 0, smb);

    const ctx = makeCtx({ graph });
    const fired = runOptionsIdenticalBypass(ctx);

    expect(fired).toBe(false);
    const ids = graphNodes(ctx).map((n) => n.id);
    expect(ids).toContain("opt_smb");
    expect(ids).not.toContain("opt_hybrid");
  });

  // ── Green-pins: today's error behaviour is preserved ────────────────────

  it("GREEN-PIN: an all-explicit-is_baseline duplicate group still fails fast (#203 doctrine untouched)", () => {
    const graph = makeObservedShapeGraph() as any;
    for (const n of graph.nodes) {
      if (n.id === "opt_smb" || n.id === "opt_hybrid") {
        n.data.is_baseline = true;
      }
    }
    const before = JSON.stringify(graph);
    const ctx = makeCtx({ graph });

    const fired = runOptionsIdenticalBypass(ctx);

    expect(fired).toBe(true);
    expect(ctx.earlyReturn?.statusCode).toBe(400);
    const body = ctx.earlyReturn?.body as Record<string, unknown>;
    expect(body.code).toBe("CEE_GRAPH_INVALID");
    expect(body.reason).toBe("options_identical_unrepairable_by_llm");
    // No mutation on the declined path.
    expect(JSON.stringify(ctx.graph)).toBe(before);
    const eventNames = emitMock.mock.calls.map((c) => c[0] as string);
    expect(eventNames).toContain(BYPASS_EVENT);
    expect(eventNames).not.toContain(DROPPED_DUPLICATE_EVENT);
  });

  it("GREEN-PIN: a heuristic-baseline-shaped duplicate (label 'Status Quo', no flag) still fails fast", () => {
    const graph = makeObservedShapeGraph() as any;
    for (const n of graph.nodes) {
      if (n.id === "opt_hybrid") n.label = "Status Quo";
    }
    const before = JSON.stringify(graph);
    const ctx = makeCtx({ graph });

    const fired = runOptionsIdenticalBypass(ctx);

    expect(fired).toBe(true);
    expect(ctx.earlyReturn?.statusCode).toBe(400);
    expect(JSON.stringify(ctx.graph)).toBe(before);
  });

  it("GREEN-PIN: a 2-option graph that collides entirely (drop would leave 1 option) still fails fast", () => {
    const graph = makeObservedShapeGraph() as any;
    // Remove the distinct enterprise option: only the colliding pair remains.
    graph.nodes = graph.nodes.filter((n: any) => n.id !== "opt_enterprise");
    graph.edges = graph.edges.filter(
      (e: any) => e.from !== "opt_enterprise" && e.to !== "opt_enterprise",
    );
    const before = JSON.stringify(graph);
    const ctx = makeCtx({ graph });

    const fired = runOptionsIdenticalBypass(ctx);

    expect(fired).toBe(true);
    expect(ctx.earlyReturn?.statusCode).toBe(400);
    const body = ctx.earlyReturn?.body as Record<string, unknown>;
    expect(body.reason).toBe("options_identical_unrepairable_by_llm");
    // A 1-option decision graph is not a decision — no drop happened.
    expect(JSON.stringify(ctx.graph)).toBe(before);
    const eventNames = emitMock.mock.calls.map((c) => c[0] as string);
    expect(eventNames).not.toContain(DROPPED_DUPLICATE_EVENT);
  });

  it("GREEN-PIN: no OPTIONS_IDENTICAL violation → untouched graph, byte-identical (success path never enters dedup)", () => {
    const graph = makeObservedShapeGraph() as any;
    // Make the hybrid genuinely distinct — a draft that succeeds today.
    const hybrid = graph.nodes.find((n: any) => n.id === "opt_hybrid");
    hybrid.data.interventions = { fac_enterprise_focus: 0.6, fac_smb_focus: 0.4 };
    const before = JSON.stringify(graph);
    const ctx = makeCtx({ graph, remainingViolations: [] });

    const fired = runOptionsIdenticalBypass(ctx);

    expect(fired).toBe(false);
    expect(ctx.earlyReturn).toBeUndefined();
    expect(JSON.stringify(ctx.graph)).toBe(before);
    expect(ctx.pipelineOutcome.warnings).toHaveLength(0);
    expect(emitMock).not.toHaveBeenCalled();
  });

  it("GREEN-PIN: violation present but graph lacks the flagged options (inconsistent state) → fail-fast preserved", () => {
    // Mirrors the pre-existing unit tests that call the bypass with a
    // context-only violation and no matching graph content.
    const ctx = makeCtx({
      graph: { nodes: [{ id: "n", kind: "goal", label: "g" }], edges: [], version: "1.2" } as any,
    });

    const fired = runOptionsIdenticalBypass(ctx);

    expect(fired).toBe(true);
    expect(ctx.earlyReturn?.statusCode).toBe(400);
  });
});
