/**
 * F4 #1b — the observed_state under-report residual (A2-coordinated).
 *
 * #612 closed the readiness↔run scaffold-gate over-report and the
 * configured-value / needs_encoding cases, but left one under-report open: an
 * option the run path scaffolds off a FACTOR's `observed_state` neutral values
 * still reported "blocked" because the /assist/v1/graph-readiness `Graph` input
 * REJECTED a factor observed_state — its `observed_state` was constraint-shaped
 * (required `metadata.operator`). Readiness therefore never received the
 * provenance the run path reads (`buildNeutralFactorValues`, the observed_state
 * rung of scaffold-unconfigured-options.ts).
 *
 * STEP 1 widened `Node.observed_state` to a union that ALSO accepts the factor
 * shape `{ value, raw_value? }`. These tests prove:
 *   1. the schema now PARSES a factor observed_state (was a 400) and PRESERVES
 *      it into the parsed graph, while still REJECTING a malformed constraint
 *      observed_state (union is additive, not loosening);
 *   2. EXACT-VALUE parity: feeding the parsed graph to the ONE shared run-path
 *      predicate scaffolds the unconfigured option with the SAME neutral wire
 *      value the run-path reader (`resolveRawInterventionValue`) computes from
 *      the same observed_state — derived here, never hardcoded;
 *   3. a genuinely-unrunnable graph (no observed_state, no prior) still yields
 *      will_scaffold_options=false (no regression, honest under-approx).
 */

import { describe, it, expect } from "vitest";

import { Graph } from "../../src/schemas/graph.js";
import {
  scaffoldUnconfiguredOptions,
  computeScaffoldPlan,
} from "../../src/orchestrator-v5/tools/handlers/scaffold-unconfigured-options.js";
import {
  buildFactorScaleMap,
  resolveRawInterventionValue,
} from "../../src/orchestrator-v5/tools/plot-intervention-scale.js";

/**
 * A request graph whose factor carries the A2 send shape
 * (`observed_state: { value, raw_value }`) and NO `prior` — so the ONLY
 * scaffold provenance is the observed_state rung. Constructed as the raw request
 * body; parsed through the `Graph` schema in the tests to exercise the exact
 * route boundary.
 */
function makeObservedStateRequestGraph() {
  return {
    version: "1",
    default_seed: 17,
    nodes: [
      { id: "goal", kind: "goal", label: "Goal" },
      { id: "decision", kind: "decision", label: "Decision" },
      {
        id: "fac_price",
        kind: "factor",
        label: "Price",
        category: "controllable",
        observed_state: { value: 0.4, raw_value: 200 },
      },
      { id: "opt_a", kind: "option", label: "Premium" },
      { id: "opt_b", kind: "option", label: "Unconfigured" },
    ],
    edges: [
      { id: "e1", from: "decision", to: "opt_a" },
      { id: "e2", from: "decision", to: "opt_b" },
      { id: "e3", from: "opt_a", to: "fac_price" },
      { id: "e4", from: "opt_b", to: "fac_price" },
    ],
  };
}

const configured = (id: string, interventions: Record<string, number>) => ({
  option_id: id,
  label: id,
  interventions,
});
const unconfigured = (id: string) => ({ option_id: id, label: id, interventions: {} });

describe("F4 #1b schema — factor observed_state parses (additive), constraint stays strict", () => {
  it("accepts and preserves a FACTOR observed_state { value, raw_value }", () => {
    const parsed = Graph.safeParse(makeObservedStateRequestGraph());
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const fac = parsed.data.nodes.find((n) => n.id === "fac_price")!;
    // The parse must not strip the factor observed_state — the run-path reader
    // reads it off the parsed graph.
    expect(fac.observed_state).toEqual({ value: 0.4, raw_value: 200 });
  });

  it("still accepts a valid constraint observed_state byte-identically", () => {
    const parsed = Graph.safeParse({
      version: "1",
      nodes: [
        { id: "goal", kind: "goal", label: "Goal" },
        {
          id: "con",
          kind: "constraint",
          label: "Budget",
          observed_state: { value: 5000, metadata: { operator: ">=" } },
        },
      ],
      edges: [],
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const con = parsed.data.nodes.find((n) => n.id === "con")!;
    expect(con.observed_state).toEqual({ value: 5000, metadata: { operator: ">=" } });
  });

  it("rejects a MALFORMED constraint observed_state (metadata present, bad operator) — union does not loosen constraint validation", () => {
    const parsed = Graph.safeParse({
      version: "1",
      nodes: [
        {
          id: "con",
          kind: "constraint",
          label: "Budget",
          observed_state: { value: 5000, metadata: { operator: "==" } },
        },
      ],
      edges: [],
    });
    // Constraint branch fails (operator enum); factor branch refuses `metadata`.
    expect(parsed.success).toBe(false);
  });
});

describe("F4 #1b EXACT parity — run predicate scaffolds off observed_state with the run-path neutral value", () => {
  const options = [configured("opt_a", { fac_price: 0.9 }), unconfigured("opt_b")];

  it("scaffolds opt_b and its neutral value EQUALS the run-path resolver's observed_state value (derived, not hardcoded)", () => {
    const parsed = Graph.safeParse(makeObservedStateRequestGraph());
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const graph = parsed.data;

    // The run path's own reader for the SAME observed_state on the SAME factor
    // scale evidence.
    //
    // ⚠ REPAIRED 2026-08-13 (row 2.1090). This block used to hand-write the
    // candidate as `{ value: 0.4, raw_value: 200 }` and assert `200` — i.e. a
    // literal COPY of `buildNeutralFactorValues`' construction rule, in the one
    // test whose own header promises "derived here, never hardcoded". When that
    // rule changed (a capless factor's `raw_value` is a DISPLAY magnitude, not a
    // level, and carrying it into a synthesised placeholder blocked the whole
    // analysis) the copy drifted and this test failed — a hand-maintained mirror
    // behaving exactly as CLAUDE.md trap 12 says it will.
    //
    // Now derived from the factor node, with the fixture's scale posture pinned
    // IN-TEST so the reference cannot silently stop meaning what it says.
    const factorScale = buildFactorScaleMap(graph.nodes).get("fac_price");
    expect(
      factorScale?.cap,
      "fixture precondition: fac_price is CAPLESS — that is what makes its raw_value a display magnitude rather than a level",
    ).toBeUndefined();
    const fac = graph.nodes.find((n) => n.id === "fac_price")!;
    const observed = fac.observed_state as { value: number; raw_value?: number };
    expect(observed.raw_value, "fixture precondition: the factor does carry a raw_value to drop").toBe(200);
    // Capless ⇒ the scaffold's candidate is the framed value ALONE ⇒ rule
    // `no_cap` ⇒ the value itself crosses the wire.
    const expected = resolveRawInterventionValue({ value: observed.value }, factorScale);
    expect(expected.value).toBe(observed.value);

    const outcome = scaffoldUnconfiguredOptions({
      options,
      graph,
      rawPersistedGraph: graph,
      scaleNetEnabled: true,
    });

    expect(outcome.scaffolded.map((s) => s.option_id)).toEqual(["opt_b"]);
    const scaffoldedOptB = outcome.options.find(
      (o) => (o as { option_id?: string }).option_id === "opt_b",
    ) as { interventions: Record<string, unknown> };
    // Round 4: the scaffold emits the observed_state CANDIDATE OBJECT (the one
    // request-level projection downstream owns the wire). EXACT parity holds
    // one seam later: the run-path resolver over the emitted object yields the
    // same value as over the observed_state candidate directly.
    const emitted = scaffoldedOptB.interventions.fac_price;
    const viaEmitted = resolveRawInterventionValue(emitted, factorScale);
    expect(viaEmitted.value).toBe(expected.value);

    // The advertised plan (what /graph-readiness returns) agrees.
    const plan = computeScaffoldPlan({
      options,
      graph,
      rawPersistedGraph: graph,
      scaleNetEnabled: true,
    });
    expect(plan.will_scaffold_options).toBe(true);
    expect(plan.option_count).toBe(1);
  });

  it("genuinely-unrunnable graph (factor has NO observed_state and NO prior) → will_scaffold_options=false", () => {
    const bare = makeObservedStateRequestGraph();
    // Strip the only provenance.
    delete (bare.nodes.find((n) => n.id === "fac_price") as Record<string, unknown>).observed_state;
    const parsed = Graph.safeParse(bare);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    const plan = computeScaffoldPlan({
      options,
      graph: parsed.data,
      rawPersistedGraph: parsed.data,
      scaleNetEnabled: true,
    });
    expect(plan.will_scaffold_options).toBe(false);
    expect(plan.option_count).toBe(0);
  });

  it("#612 over-report closure intact: a CONFIGURED opt_b (numeric interventions) is never scaffolded", () => {
    const parsed = Graph.safeParse(makeObservedStateRequestGraph());
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const plan = computeScaffoldPlan({
      options: [configured("opt_a", { fac_price: 0.9 }), configured("opt_b", { fac_price: 0.2 })],
      graph: parsed.data,
      rawPersistedGraph: parsed.data,
      scaleNetEnabled: true,
    });
    expect(plan.will_scaffold_options).toBe(false);
  });
});
