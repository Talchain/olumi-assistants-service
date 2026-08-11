/**
 * WS-A ITEM 1(b) — THE WIRING HALF: the invariant must reach the WIRE, not
 * just return a value in a unit test.
 *
 * CLAUDE.md's dominant failure mode is a capability that is built and never
 * plugged in — 42 roadmap items of working code no user could reach. A
 * detector nobody calls is exactly that shape, and a green unit test on the
 * detector says nothing about it. So this file drives the REAL commit point,
 * `transformResponseToV3`, with a V1 graph in the shape the pipeline hands it,
 * and asserts the disclosure lands on `validation_warnings` — the channel that
 * already carries `CONSTRAINT_DIRECTION_HEURISTIC` and
 * `STRENGTH_DEFAULT_APPLIED` and is witnessed on the persisted graph.
 *
 * The graph below reproduces arm A run r9 of the 11 August capture: the run
 * whose `pipeline_outcome` reported `verification_status: passed`,
 * `validation_status: passed`, `deterministic_sweep_violations: 0` and
 * `warnings: []` **while committing the user's £6,000 of training as £1,440**.
 * Every green light was green. This test is the light that is not.
 */

import { describe, it, expect } from "vitest";

import { transformResponseToV3 } from "../../transforms/schema-v3.js";
import { L2B_CAPTURED_RUNS } from "./fixtures/l2b-arch-decision-captures.js";

const CAPTURE = L2B_CAPTURED_RUNS.find((r) => r.arm === "A" && r.run === "r9")!;

/**
 * The V1 graph the transform consumes. Factor state rides `data` (the
 * transform maps it onto `observed_state`) and option levers ride
 * `data.interventions`, which is the V4 prompt shape the extractor reads.
 */
function v1GraphFromCapture() {
  const factorNodes = (CAPTURE.factors ?? []).map((f) => ({
    id: f.id,
    kind: "factor",
    label: f.label,
    category: "controllable",
    ...(f.observed_state !== null ? { data: { ...f.observed_state } } : {}),
  }));
  const optionNodes = (CAPTURE.options ?? []).map((o) => ({
    id: o.id,
    kind: "option",
    label: o.label,
    data: { interventions: o.interventions },
  }));
  const edges = (CAPTURE.factors ?? []).map((f) => ({
    from: f.id,
    to: "goal",
    edge_type: "causal",
  }));
  return {
    graph: {
      nodes: [
        { id: "goal", kind: "goal", label: "Higher sales productivity within budget" },
        ...factorNodes,
        ...optionNodes,
      ],
      edges,
    },
  } as any;
}

function warningsOf(body: any) {
  return (body.validation_warnings ?? []) as Array<Record<string, unknown>>;
}

describe("WS-A 1(b) wiring — the disclosure reaches validation_warnings at the commit point", () => {
  it("ships STATED_MAGNITUDE_UNRECONCILED for fac_training_cost on the A/r9 shape", () => {
    const body: any = transformResponseToV3(v1GraphFromCapture(), { brief: CAPTURE.brief });

    // PRECONDITION PINNED IN-TEST (trap 13b): the transform must actually have
    // built the encoding pair this invariant judges, or a green/red result
    // here is about the fixture rather than about the code.
    const training = (body.nodes ?? []).find((n: any) => n.id === "fac_training_cost");
    expect(training?.observed_state).toMatchObject({ unit: "£", cap: 6000, source: "brief_extraction" });
    const switchOption = (body.options ?? []).find((o: any) => o.id === "opt_switch_hubspot");
    expect(switchOption?.interventions?.fac_training_cost?.value).toBe(0.24);

    const flagged = warningsOf(body).filter((w) => w.code === "STATED_MAGNITUDE_UNRECONCILED");
    expect(flagged.map((w) => w.affected_node_id)).toEqual(["fac_training_cost"]);
    expect(flagged[0]?.severity).toBe("warn");
  });

  it("does NOT flag fac_switch_cost in the same response — 0.72 x 25000 is the stated £18,000", () => {
    // The discriminating twin at the wire. A detector wired in "for every
    // currency factor" passes the assertion above and fails this one.
    const body: any = transformResponseToV3(v1GraphFromCapture(), { brief: CAPTURE.brief });
    const flagged = warningsOf(body)
      .filter((w) => w.code === "STATED_MAGNITUDE_UNRECONCILED")
      .map((w) => w.affected_node_id);
    expect(flagged).not.toContain("fac_switch_cost");
  });

  it("commits the graph UNCHANGED — disclosure never rewrites a magnitude", () => {
    // The half that makes this a disclosure and not a repair (#853's defect
    // class). Every level and every cap must survive the transform byte-for-
    // byte, warning or no warning.
    const body: any = transformResponseToV3(v1GraphFromCapture(), { brief: CAPTURE.brief });
    const training = (body.nodes ?? []).find((n: any) => n.id === "fac_training_cost");
    expect(training?.observed_state?.value).toBe(0);
    expect(training?.observed_state?.cap).toBe(6000);
    const switchOption = (body.options ?? []).find((o: any) => o.id === "opt_switch_hubspot");
    expect(switchOption?.interventions?.fac_training_cost?.value).toBe(0.24);
    expect(switchOption?.interventions?.fac_switch_cost?.value).toBe(0.72);
  });

  it("emits nothing when the transform is given no brief — the question has no answer", () => {
    const body: any = transformResponseToV3(v1GraphFromCapture(), {});
    expect(warningsOf(body).filter((w) => w.code === "STATED_MAGNITUDE_UNRECONCILED")).toEqual([]);
  });
});
