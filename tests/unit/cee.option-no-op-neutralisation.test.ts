/**
 * OPTION_NO_OP — THE CONSEQUENCE, NOT THE PREDICATE.
 *
 * ## What this pins
 *
 * `#1446` shipped the right predicate with the wrong consequence. An option
 * whose interventions equal the baseline on every factor it touches is not a
 * genuine alternative — true, measured, and unchanged here. But the verdict was
 * an `error`, so the post-enforcement gate set `earlyReturn` and the whole DRAFT
 * died. A wire walk on the deployed build (`ccb7188`, n=10, Paul's demo brief)
 * measured **3 in 10 drafts refused outright** after two auto-retries, with
 * recovery copy telling the user to reword a brief that was never at fault.
 *
 * **Options are a list. One bad member must not destroy the list.**
 *
 * ## The consequence chosen: NEUTRALISE, then let the ratified gate exclude
 *
 * The no-op option's MODEL-AUTHORED intervention map is deleted, so the option
 * ships in the user's graph as UNCONFIGURED. Everything downstream already
 * exists and is already ruled on:
 *
 *   - `analysable-option-gate.ts` EXCLUDES an option with no interventions from
 *     the PLoT submission — "no rank, no win probability, by construction rather
 *     than by suppression downstream" (Paul's ruling, 2026-08-14). So the
 *     catastrophe `#1446` closed stays closed: the arm cannot be compared and
 *     cannot be named a leader.
 *   - the exclusion is disclosed BY NAME through the existing omitted-suffix
 *     machinery, and the all-unconfigured case is owned by `run-analysis.ts`
 *     §2.5, whose copy already reads *"…doesn't say what it changes yet, so I
 *     can't score it — it won't appear in the comparison until you tell me."*
 *
 * ## The two hazards this file exists to catch
 *
 * 1. **`{}` IS NOT THE SAME AS ABSENT.** `OPTIONS_IDENTICAL` skips an option
 *    with no `interventions` key (`graph-validator.ts:1011`) but SIGNS an empty
 *    object as `""` — so neutralising two no-ops to `{}` would trade
 *    `OPTION_NO_OP` for `OPTIONS_IDENTICAL` and refuse the draft anyway, one
 *    code to the left. The property must be DELETED.
 * 2. **THE FAIL-SAFE DIRECTIONS MUST SURVIVE.** The predicate sets
 *    `changesNothing = false` on a dangling ref, a non-finite level and an
 *    undefined baseline — refusing to accuse, because a false positive
 *    WITHDRAWS a real alternative. Neutralisation inherits that or it becomes
 *    the very harm it was built to avoid.
 *
 * Assertions bind by OPTION ID, never by a count or a value predicate another
 * option could satisfy (trap 19).
 */

import { describe, it, expect, vi } from "vitest";
import type { GraphT, NodeT } from "../../src/schemas/graph.js";

// Telemetry: `importOriginal` spread, never a hand-listed allowlist — a
// `vi.mock` factory REPLACES the module, so a listed mirror of `TelemetryEvents`
// silently omits every event added after it was written (CLAUDE.md trap 12).
vi.mock("../../src/utils/telemetry.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/utils/telemetry.js")>();
  return {
    ...actual,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    emit: vi.fn(),
  };
});

vi.mock("../../src/config/index.js", () => ({
  config: { cee: { deterministicEnforcementEnabled: true }, features: {} },
  isProduction: vi.fn().mockReturnValue(true),
}));

// ⚠ `graph-validator.js` is deliberately NOT mocked. The acceptance condition is
// a claim about the REAL post-enforcement validator: five sibling specs mock it
// wholesale, and under those mocks this file would assert nothing at all.
vi.mock("../../src/cee/validation/pipeline.js", () => ({
  buildCeeErrorResponse: vi.fn((code: string, msg: string) => ({ error: { code, message: msg } })),
  isAdminAuthorized: vi.fn(() => false),
}));

import { applyDeterministicEnforcement } from "../../src/cee/unified-pipeline/stages/repair/graph-enforcement.js";
import { neutraliseNoOpOptions } from "../../src/cee/unified-pipeline/stages/repair/no-op-neutralisation.js";
import { validateGraph } from "../../src/validators/graph-validator.js";
import { gateAnalysableOptions } from "../../src/orchestrator-v5/tools/handlers/analysable-option-gate.js";

/** The factor baseline in Paul's session, on the model's 0-1 scale. */
const BASELINE = 0.49;

/**
 * Paul's measured graph (`olumi-debug-5b41f0eb-20260911.json`), the same shape
 * `src/validators/__tests__/option-no-op-invariant.test.ts` pins the predicate
 * on. Every other validator tier is satisfied, so a failure here is about the
 * CONSEQUENCE and not about a malformed fixture.
 */
function paulsGraph(): GraphT {
  return {
    version: "1",
    default_seed: 17,
    nodes: [
      { id: "decision_1", kind: "decision", label: "Which option?" },
      {
        id: "opt_noop",
        kind: "option",
        label: "increase the Pro plan price from £49 to £59 per month",
        data: { interventions: { fac_price: BASELINE } },
      },
      {
        id: "opt_59",
        kind: "option",
        label: "Raise Price to £59 at Feature Launch",
        data: { interventions: { fac_price: 0.59 } },
      },
      {
        id: "opt_54",
        kind: "option",
        label: "Raise Price to £54 (Soft Increase)",
        data: { interventions: { fac_price: 0.54 } },
      },
      {
        id: "fac_price",
        kind: "factor",
        label: "Pro Plan Monthly Price",
        category: "controllable",
        observed_state: { value: BASELINE, raw_value: 49 },
        data: { value: BASELINE, raw_value: 49, extractionType: "explicit" },
      },
      { id: "outcome_1", kind: "outcome", label: "MRR" },
      { id: "goal_1", kind: "goal", label: "£20k MRR" },
    ] as NodeT[],
    edges: [
      { from: "decision_1", to: "opt_noop", strength_mean: 1, belief_exists: 1 },
      { from: "decision_1", to: "opt_59", strength_mean: 1, belief_exists: 1 },
      { from: "decision_1", to: "opt_54", strength_mean: 1, belief_exists: 1 },
      { from: "opt_noop", to: "fac_price", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
      { from: "opt_59", to: "fac_price", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
      { from: "opt_54", to: "fac_price", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
      { from: "fac_price", to: "outcome_1", strength_mean: 0.8, belief_exists: 0.9 },
      { from: "outcome_1", to: "goal_1", strength_mean: 0.9, belief_exists: 1 },
    ],
    meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
  } as GraphT;
}

function node(graph: GraphT, id: string): NodeT {
  const found = graph.nodes.find((n) => n.id === id);
  if (!found) throw new Error(`fixture has no node ${id}`);
  return found as NodeT;
}

function interventionsOf(graph: GraphT, id: string): unknown {
  return (node(graph, id).data as { interventions?: unknown } | undefined)?.interventions;
}

function makeCtx(graph: GraphT): Record<string, unknown> {
  return { graph, requestId: "req-noop-test", detectedEdgeFormat: "V1_FLAT" };
}

describe("OPTION_NO_OP consequence — the draft survives a no-op option", () => {
  // ── THE ACCEPTANCE CONDITION ────────────────────────────────────────────
  it("does NOT set earlyReturn: the user ends the turn holding a graph", () => {
    const ctx = makeCtx(paulsGraph());
    applyDeterministicEnforcement(ctx as never);
    expect(ctx.earlyReturn).toBeUndefined();
  });

  it("the post-enforcement validator finds no blocking error on the enforced graph", () => {
    const ctx = makeCtx(paulsGraph());
    applyDeterministicEnforcement(ctx as never);
    const after = validateGraph({ graph: ctx.graph as GraphT, phase: "post_enforcement" });
    expect(after.errors.map((e) => e.code)).toEqual([]);
  });

  // ── THE PREDICATE IS UNCHANGED ──────────────────────────────────────────
  it("the predicate still DETECTS the no-op on the untouched graph, by id", () => {
    // Detection is not weakened — only its consequence changed. If this ever
    // goes green-by-absence the fix has become the regression.
    const errors = validateGraph({ graph: paulsGraph() }).errors;
    const noOp = errors.filter((e) => e.code === "OPTION_NO_OP");
    expect(noOp.map((e) => String((e.context as { optionId?: unknown }).optionId))).toEqual([
      "opt_noop",
    ]);
  });

  // ── WHAT NEUTRALISATION DOES, BOUND BY ID ───────────────────────────────
  it("deletes the no-op option's interventions and names it in the result", () => {
    const graph = paulsGraph();
    const result = neutraliseNoOpOptions(graph);
    expect(result.neutralisedOptionIds).toEqual(["opt_noop"]);
    expect(interventionsOf(graph, "opt_noop")).toBeUndefined();
  });

  it("DELETES the property rather than emptying it — an empty object would sign as OPTIONS_IDENTICAL", () => {
    const graph = paulsGraph();
    neutraliseNoOpOptions(graph);
    const data = node(graph, "opt_noop").data as Record<string, unknown>;
    expect("interventions" in data).toBe(false);
  });

  it("leaves the two genuine alternatives byte-identical, by id", () => {
    const graph = paulsGraph();
    neutraliseNoOpOptions(graph);
    expect(interventionsOf(graph, "opt_59")).toEqual({ fac_price: 0.59 });
    expect(interventionsOf(graph, "opt_54")).toEqual({ fac_price: 0.54 });
  });

  it("two no-op options do NOT become OPTIONS_IDENTICAL after neutralisation", () => {
    // The specific way this fix could re-refuse the draft one code to the left.
    const graph = paulsGraph();
    (node(graph, "opt_54").data as Record<string, unknown>).interventions = { fac_price: BASELINE };
    const ctx = makeCtx(graph);
    applyDeterministicEnforcement(ctx as never);
    const after = validateGraph({ graph: ctx.graph as GraphT, phase: "post_enforcement" });
    expect(after.errors.map((e) => e.code)).not.toContain("OPTIONS_IDENTICAL");
    expect(ctx.earlyReturn).toBeUndefined();
  });

  // ── THE CATASTROPHE STAYS CLOSED ────────────────────────────────────────
  it("the neutralised option is EXCLUDED from the PLoT submission — no rank, no win probability", () => {
    const graph = paulsGraph();
    neutraliseNoOpOptions(graph);
    const options = (graph.nodes as NodeT[])
      .filter((n) => n.kind === "option")
      .map((n) => ({
        option_id: n.id,
        label: (n as { label?: string }).label ?? null,
        interventions: (n.data as { interventions?: unknown } | undefined)?.interventions ?? {},
      }));
    const gate = gateAnalysableOptions({ options, graph, rawPersistedGraph: graph, scaleNetEnabled: true });
    expect(gate.excluded.map((e) => e.option_id)).toEqual(["opt_noop"]);
    expect(gate.options.map((o) => (o as { option_id: string }).option_id)).not.toContain("opt_noop");
  });

  // ── THE FAIL-SAFE DIRECTIONS SURVIVE ────────────────────────────────────
  it("does NOT neutralise the option that declares itself the baseline", () => {
    const graph = paulsGraph();
    (node(graph, "opt_noop").data as Record<string, unknown>).is_baseline = true;
    expect(neutraliseNoOpOptions(graph).neutralisedOptionIds).toEqual([]);
    expect(interventionsOf(graph, "opt_noop")).toEqual({ fac_price: BASELINE });
  });

  it("does NOT neutralise on a dangling intervention reference", () => {
    const graph = paulsGraph();
    (node(graph, "opt_noop").data as Record<string, unknown>).interventions = { fac_missing: BASELINE };
    expect(neutraliseNoOpOptions(graph).neutralisedOptionIds).toEqual([]);
  });

  it("does NOT neutralise when the factor carries no readable baseline", () => {
    const graph = paulsGraph();
    const factor = node(graph, "fac_price") as Record<string, unknown>;
    delete factor.observed_state;
    factor.data = { extractionType: "explicit" };
    expect(neutraliseNoOpOptions(graph).neutralisedOptionIds).toEqual([]);
  });

  it("does NOT neutralise on a non-finite intervention level", () => {
    const graph = paulsGraph();
    (node(graph, "opt_noop").data as Record<string, unknown>).interventions = { fac_price: Number.NaN };
    expect(neutraliseNoOpOptions(graph).neutralisedOptionIds).toEqual([]);
  });

  it("is a byte-stable no-op when every option genuinely differs", () => {
    const graph = paulsGraph();
    (node(graph, "opt_noop").data as Record<string, unknown>).interventions = { fac_price: 0.7 };
    const result = neutraliseNoOpOptions(graph);
    expect(result.neutralisedOptionIds).toEqual([]);
    expect(result.repairs).toEqual([]);
    expect(interventionsOf(graph, "opt_noop")).toEqual({ fac_price: 0.7 });
  });

  // ── THE DEGENERATE CASE: EVERY NON-BASELINE OPTION IS A NO-OP ───────────
  it("all-no-op still ships a graph, and every option ends unconfigured", () => {
    const graph = paulsGraph();
    for (const id of ["opt_59", "opt_54"]) {
      (node(graph, id).data as Record<string, unknown>).interventions = { fac_price: BASELINE };
    }
    const ctx = makeCtx(graph);
    applyDeterministicEnforcement(ctx as never);

    // Never a refusal on this predicate alone.
    expect(ctx.earlyReturn).toBeUndefined();

    // All three neutralised, by id — so `run-analysis.ts` §2.5's
    // `options_not_configured` guard owns the turn and says, in its own words,
    // "doesn't say what it changes yet … it won't appear in the comparison
    // until you tell me". That is an honest, actionable message; a 500 is not.
    for (const id of ["opt_noop", "opt_59", "opt_54"]) {
      expect(interventionsOf(ctx.graph as GraphT, id)).toBeUndefined();
    }

    // The §2.5 predicate, mirrored exactly: options exist, none configured.
    const options = (ctx.graph as GraphT).nodes.filter((n) => n.kind === "option");
    const anyConfigured = options.some((n) => {
      const iv = (n.data as { interventions?: unknown } | undefined)?.interventions;
      return iv !== null && typeof iv === "object" && !Array.isArray(iv)
        && Object.keys(iv as Record<string, unknown>).length > 0;
    });
    expect(options.length).toBeGreaterThan(0);
    expect(anyConfigured).toBe(false);
  });

  // ── THE REPAIR IS RECORDED ──────────────────────────────────────────────
  it("records the neutralisation in the repair trace, naming the option", () => {
    const ctx = makeCtx(paulsGraph());
    applyDeterministicEnforcement(ctx as never);
    const repairs = (ctx.deterministicRepairs ?? []) as Array<{ code: string; path: string }>;
    const mine = repairs.filter((r) => r.code === "OPTION_NO_OP");
    expect(mine).toHaveLength(1);
    expect(mine[0].path).toContain("opt_noop");
  });
});
