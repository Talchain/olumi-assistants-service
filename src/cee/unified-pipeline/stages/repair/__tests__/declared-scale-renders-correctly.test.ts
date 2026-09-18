/**
 * ⛔⛔ PIN THE STRING THE USER READS, NOT THE FIELD THE CODE SETS.
 *
 * This file exists because a regression shipped to staging with a fully green
 * suite. The unit tests asserted whether `unit` was PRESENT and whether
 * `declared_scale` held the right literal — and every one passed while the card
 * the user reads said something 100x wrong:
 *
 *   {value: 4,    unit: "%", value_scale: "unit_interval"}  "2 to 6"   -> "200% to 600%"
 *   {value: 0.34, unit: "%", value_scale: "ratio"}          "17% to 51%" -> "0.17 to 0.51"
 *
 * Both were found by an adversarial review running the real repair stage and the
 * real V3 transform end to end, not by reading. And when the first fix was
 * applied, the unit suite went green again while case A was STILL "200% to 600%"
 * — because the fix keyed on the raw declaration rather than the admissible one.
 * **Only a rendered-string assertion caught that.**
 *
 * ⭐ THE RULE THIS FILE ENCODES: a seam whose whole purpose is what a user sees
 * must be pinned on what a user sees. Field-presence assertions on such a seam
 * are necessary and they are not sufficient, and a green suite made entirely of
 * them is exactly as green when the rendering inverts.
 *
 * The five rows below are the complete decision table for the precedence:
 * a declaration that is admissible, one that is not, in both scale directions,
 * plus the no-declaration control that proves the inference path is untouched.
 */
import { describe, it, expect } from "vitest";
import { handleUnreachableFactors } from "../unreachable-factors.js";
import { transformGraphToV3 } from "../../../../transforms/schema-v3.js";
import type { GraphT } from "../../../../../schemas/graph.js";

function statedFactor(opts: { value: number; unit: string; declared_scale?: string }): GraphT {
  return {
    nodes: [
      { id: "goal_x", kind: "goal", label: "Goal" },
      { id: "dec_x", kind: "decision", label: "Decision" },
      { id: "opt_x", kind: "option", label: "Option" },
      {
        id: "f_probe",
        kind: "factor",
        label: "Probe Factor",
        ...(opts.declared_scale !== undefined && { declared_scale: opts.declared_scale }),
        data: { value: opts.value, unit: opts.unit, extractionType: "explicit" },
      },
    ],
    edges: [
      { from: "dec_x", to: "opt_x", edge_type: "structural" },
      { from: "opt_x", to: "goal_x", edge_type: "causal" },
    ],
  } as unknown as GraphT;
}

function rendered(opts: { value: number; unit: string; declared_scale?: string }): unknown {
  const graph = statedFactor(opts);
  handleUnreachableFactors(graph, "edge_type" as never);
  const v3 = transformGraphToV3(graph as never) as unknown as {
    graph?: { nodes?: Array<Record<string, unknown>> };
    nodes?: Array<Record<string, unknown>>;
  };
  const nodes = v3.graph?.nodes ?? v3.nodes ?? [];
  const node = nodes.find((n) => n.id === "f_probe");
  // A carrier error here must be LOUD, not a plausible undefined.
  if (!node) throw new Error("CARRIER ERROR: no f_probe node on the V3 graph");
  return node.display_value;
}

describe("the declared scale renders the string the user should read", () => {
  it.each([
    // declaration ADMISSIBLE under its own contract bounds -> it wins.
    { name: "ratio declared inside [0,1] keeps its percentage", value: 0.34, unit: "%", declared_scale: "ratio", want: "17% to 51%" },
    { name: "unit_interval declared inside [0,1] is honoured", value: 0.04, unit: "%", declared_scale: "unit_interval", want: "0% to 14%" },
    // declaration INADMISSIBLE -> declined, falls through to inference.
    { name: "unit_interval declared on 4 is declined, not believed", value: 4, unit: "%", declared_scale: "unit_interval", want: "2 to 6" },
    { name: "unit_interval declared on 1.12 is declined, not believed", value: 1.12, unit: "%", declared_scale: "unit_interval", want: "0.56 to 1.68" },
    // no declaration at all -> the inference path, unchanged. The control.
    { name: "no declaration leaves the inference path untouched", value: 1.12, unit: "%", declared_scale: undefined, want: "0.56 to 1.68" },
  ])("$name", ({ value, unit, declared_scale, want }) => {
    expect(rendered({ value, unit, declared_scale })).toBe(want);
  });

  /**
   * THE PRECONDITION, PINNED IN-TEST. Every row above could pass on a harness
   * that rendered nothing at all. This asserts the harness produces a DIFFERENT
   * string for two of the rows, so a uniform result would fail rather than agree.
   */
  it("pins that the harness discriminates, so agreement is not vacuous", () => {
    const a = rendered({ value: 0.34, unit: "%", declared_scale: "ratio" });
    const b = rendered({ value: 4, unit: "%", declared_scale: "unit_interval" });
    expect(a).not.toBe(b);
    expect(a).toBeTypeOf("string");
    expect(b).toBeTypeOf("string");
  });
});
