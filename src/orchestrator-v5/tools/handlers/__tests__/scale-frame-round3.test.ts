/**
 * ROUND 3 — closures for the round-2 re-review blockers (REVIEW-926.md,
 * "ROUND 2 COMPLETION"), both MEASURED there at e6f717b4:
 *
 * R2-1 — the two baseline writers DISAGREED on a bare [0,1] input against a
 *   framed factor (writer 1 read it as RAW ÷frame → {0.000007, 0.7}; writer 2
 *   as LEVEL ×frame → {0.7, 70000}; 10^5 divergence, both reachable, neither
 *   asked). RULED CLOSURE: the ambiguity IS the product (trap 22f) — the
 *   stated-value ambiguity gate now fires on FRAME-RECOVERABLE factors (it was
 *   structurally blind to the records population because its predicate keyed
 *   on a unit string records factors can never carry), and writer 2 refuses
 *   the same class rather than guessing (typed throw as the fail-loud
 *   backstop; both callers prescreen and surface an ask). Neither writer
 *   picks a winner silently.
 *
 * R2-2 — an over-frame first edit ({value: 5, raw_value: 500000}) DISARMED
 *   frame recovery (`value ≤ 1` precondition), so the second bare edit
 *   resurrected the exact B1 raw write ({74000, 74000}) on BOTH writers and
 *   the analysis computed silently. RULED CLOSURES, both: (a) recovery
 *   extended to over-frame pairs — the pair still encodes the frame EXACTLY
 *   (raw/value); (b) the BASELINE GATE at the analysis seam (row 2.1085):
 *   a capless factor whose observed baseline sits outside [0,1] blocks the
 *   analysis with the guard's honest ask, NEVER computes — the durable
 *   closure that does not depend on writer enumeration (covers add-node raw
 *   magnitudes and any writer everyone missed).
 *
 * ── PRODUCER ENUMERATION FOR THE RECOVERY PREDICATE (re-derived, not
 * inherited from the review's sketch — trap 13d) ────────────────────────────
 * Pairs the producers can create on a capless factor:
 *   draft pass 3d:            {raw/frame, raw}, frame > max ⇒ value ∈ (0,1);
 *                             zero baseline {0,0}; percent/bps ≤ 1.
 *   writer, in-frame edit:    {raw/frame, raw}, value ∈ (0,1).
 *   writer, over-frame edit:  {raw/frame, raw}, value > 1 (raw = value×frame).
 *   unframed writers:         {x, x}.
 * The predicate `value > 0 ∧ raw > value ∧ frame finite > 1` recovers exactly
 * the framed classes and refuses {x,x} (raw > value fails) and {0,0}/negatives
 * (value > 0 fails) — the two shapes where recovery would fabricate a frame.
 */
import { describe, expect, it } from "vitest";
import { recoverScaleFrame } from "../d1-shared/scale-frame.js";
import { normaliseFactorValue } from "../d1-shared/normalise-factor-value.js";
import { evaluateFactorValueProposal } from "../d1-shared/evaluate-factor-value-proposal.js";
import {
  reconcileObservedValuePair,
  findAmbiguousScaleValueOps,
  AmbiguousScaleValueError,
} from "../../../../orchestrator/canonicalise-value-ops.js";
import {
  findScaleIncoherentBaselineFactorIds,
  decideAnalysisScaleBlock,
  projectRequestInterventionsToWireScale,
  buildFactorScaleMap,
} from "../../plot-intervention-scale.js";

// ── R2-2a: recovery survives the over-frame state ───────────────────────────

describe("recoverScaleFrame recovers over-frame pairs — the frame is encoded exactly, refusing it was the defect", () => {
  it("recovers the frame from the over-frame pair the writer itself creates", () => {
    expect(recoverScaleFrame({ value: 5, raw_value: 500000 })).toBe(100000);
    expect(recoverScaleFrame({ value: 1.5, raw_value: 150000 })).toBe(100000);
    // ⚠ DELIBERATE PIN MOVE (review order): {value: 2, raw_value: 50000} was
    // pinned `undefined` in round 2 (MR-B's discriminating case). Under the
    // extended predicate it is a consistent over-frame pair of a 25,000 frame
    // and recovery is correct. The refusal duty MR-B guarded now lives on the
    // {x,x} and negative pins below.
    expect(recoverScaleFrame({ value: 2, raw_value: 50000 })).toBe(25000);
  });

  it("still refuses the shapes where a frame would be fabricated", () => {
    expect(recoverScaleFrame({ value: 74000, raw_value: 74000 })).toBeUndefined(); // unframed
    expect(recoverScaleFrame({ value: 0.65, raw_value: 0.65 })).toBeUndefined(); // unframed unit-scale
    expect(recoverScaleFrame({ value: 0, raw_value: 0 })).toBeUndefined(); // zero: scale-ambiguous
    expect(recoverScaleFrame({ value: -5, raw_value: -500000 })).toBeUndefined(); // sign-symmetric
    expect(recoverScaleFrame({ value: 0.5, raw_value: 0.25 })).toBeUndefined(); // raw < value: no downscale
  });
});

// ── R2-2: the exact two-edit sequence the review measured, both writers ─────

describe("the two-edit sequence (500000 then 74000) no longer resurrects the raw write", () => {
  const FRAMED = { value: 0.5, raw_value: 50000 }; // frame 100000

  it("writer 1: edit 1 writes the honest over-frame pair; edit 2 lands back INSIDE the same frame", () => {
    const afterFirst = normaliseFactorValue({
      rawInput: 500000,
      inputHasUnit: false,
      factorObservedValue: FRAMED.value,
      factorObservedRawValue: FRAMED.raw_value,
    });
    expect(afterFirst).toEqual({ raw_value: 500000, value: 5 });

    const afterSecond = normaliseFactorValue({
      rawInput: 74000,
      inputHasUnit: false,
      factorObservedValue: afterFirst.value,
      factorObservedRawValue: afterFirst.raw_value,
    });
    // At e6f717b4 this was {74000, 74000} — the resurrected B1 corruption.
    expect(afterSecond).toEqual({ raw_value: 74000, value: 0.74 });
  });

  it("writer 2: the same second edit through reconcile lands inside the frame too", () => {
    const overFrame = { value: 5, raw_value: 500000 };
    const op = {
      op: "update_node" as const,
      path: "annual-cost",
      value: { observed_state: { ...overFrame, value: 74000 } },
    };
    const graph = {
      nodes: [{ id: "annual-cost", kind: "factor", label: "Annual CRM Licence Cost", observed_state: overFrame }],
      edges: [],
    };
    const [out] = reconcileObservedValuePair([op as never], graph);
    const observed = (out as { value: { observed_state: Record<string, unknown> } }).value.observed_state;
    expect(observed.value).toBe(0.74);
    expect(observed.raw_value).toBe(74000);
  });
});

// ── R2-1: the ambiguity is the product — the gate asks, no writer guesses ───

describe("a bare [0,1] input on a frame-recoverable factor ASKS instead of either writer guessing", () => {
  const FRAMED = { value: 0.5, raw_value: 50000 };

  it("the stated-value ambiguity gate fires on framed factors (it keyed on a unit string records factors never carry)", () => {
    const verdict = evaluateFactorValueProposal({
      rawInput: 0.7,
      operator: "set",
      inputHasUnit: false,
      factorObservedValue: FRAMED.value,
      factorObservedRawValue: FRAMED.raw_value,
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toBe("bare_ratio_on_unit_factor");
  });

  it("the gate stays silent where it was silent before: unframed capless unitless factors", () => {
    const verdict = evaluateFactorValueProposal({
      rawInput: 0.7,
      operator: "set",
      inputHasUnit: false,
      factorObservedValue: 0.65,
      factorObservedRawValue: 0.65,
    });
    expect(verdict.ok).toBe(true);
  });

  it("a raw magnitude on a framed factor is NOT ambiguous and still passes the gate", () => {
    const verdict = evaluateFactorValueProposal({
      rawInput: 74000,
      operator: "set",
      inputHasUnit: false,
      factorObservedValue: FRAMED.value,
      factorObservedRawValue: FRAMED.raw_value,
    });
    expect(verdict.ok).toBe(true);
  });

  it("findAmbiguousScaleValueOps names exactly the ambiguous op, for the callers' prescreen", () => {
    const graph = {
      nodes: [
        { id: "framed", kind: "factor", label: "Annual CRM Licence Cost", observed_state: FRAMED },
        { id: "unframed", kind: "factor", label: "Adoption", observed_state: { value: 0.65, raw_value: 0.65 } },
      ],
      edges: [],
    };
    const ops = [
      { op: "update_node", path: "framed", value: { observed_state: { ...FRAMED, value: 0.7 } } },
      { op: "update_node", path: "framed", value: { observed_state: { ...FRAMED, value: 74000 } } },
      { op: "update_node", path: "unframed", value: { observed_state: { value: 0.7, raw_value: 0.65 } } },
    ];
    const ambiguous = findAmbiguousScaleValueOps(ops as never, graph);
    expect(ambiguous).toHaveLength(1);
    expect(ambiguous[0]).toMatchObject({ path: "framed", newValue: 0.7 });
  });

  it("reconcile THROWS the typed error on the ambiguous class — the fail-loud backstop for any future caller that skips the prescreen", () => {
    const op = {
      op: "update_node" as const,
      path: "framed",
      value: { observed_state: { ...FRAMED, value: 0.7 } },
    };
    const graph = {
      nodes: [{ id: "framed", kind: "factor", label: "Annual CRM Licence Cost", observed_state: FRAMED }],
      edges: [],
    };
    expect(() => reconcileObservedValuePair([op as never], graph)).toThrow(AmbiguousScaleValueError);
  });
});

// ── R2-1: the cross-writer parity pin — fails if a future writer diverges ───

describe("cross-writer parity: the same input class yields the same state, or the ask, on BOTH writers", () => {
  const FRAMED = { value: 0.5, raw_value: 50000 };
  const writer1 = (v: number) =>
    normaliseFactorValue({
      rawInput: v,
      inputHasUnit: false,
      factorObservedValue: FRAMED.value,
      factorObservedRawValue: FRAMED.raw_value,
    });
  const writer2 = (v: number) => {
    const op = { op: "update_node" as const, path: "f", value: { observed_state: { ...FRAMED, value: v } } };
    const graph = { nodes: [{ id: "f", kind: "factor", label: "F", observed_state: FRAMED }], edges: [] };
    const [out] = reconcileObservedValuePair([op as never], graph);
    const observed = (out as { value: { observed_state: Record<string, unknown> } }).value.observed_state;
    return { raw_value: observed.raw_value, value: observed.value };
  };

  it.each([[74000], [500000], [1], [0], [-5000]])(
    "unambiguous input %d: both writers land the identical framed state",
    (v) => {
      expect(writer2(v)).toEqual(writer1(v));
    },
  );

  it.each([[0.7], [-0.5]])("ambiguous input %d: writer 1's gate refuses AND writer 2 refuses to guess", (v) => {
    const gate = evaluateFactorValueProposal({
      rawInput: v,
      operator: "set",
      inputHasUnit: false,
      factorObservedValue: FRAMED.value,
      factorObservedRawValue: FRAMED.raw_value,
    });
    expect(gate.ok).toBe(false);
    expect(() => writer2(v)).toThrow(AmbiguousScaleValueError);
  });
});

// ── R2-2b: the baseline gate at the analysis seam (row 2.1085) ──────────────

describe("the baseline gate is the WITHIN-FACTOR scale-coherence test — all four quadrants pinned (trap 13d)", () => {
  const nodes = [
    { id: "goal", kind: "goal", label: "the goal" },
    { id: "raw-baseline", kind: "factor", label: "Annual CRM Licence Cost", observed_state: { value: 74000, raw_value: 74000 } },
    { id: "over-frame", kind: "factor", label: "Overframed Cost", observed_state: { value: 1.5, raw_value: 150000 } },
    { id: "negative", kind: "factor", label: "Net Cash Impact", observed_state: { value: -0.05, raw_value: -5000 } },
    { id: "framed", kind: "factor", label: "Framed Cost", observed_state: { value: 0.74, raw_value: 74000 } },
    { id: "capped", kind: "factor", label: "Legacy Capped", observed_state: { value: 74000, raw_value: 74000, cap: 100000 } },
    { id: "valueless", kind: "factor", label: "No Value Yet" },
    { id: "astride", kind: "factor", label: "Switching Cost", observed_state: { value: 12 } },
    { id: "constraint", kind: "constraint", label: "budget", observed_state: { value: 100000, metadata: { operator: "<=" } } },
  ];

  it("OUT-baseline / IN-interventions → BLOCKED (the R2-2 silent-corruption class)", () => {
    // raw-baseline carries in-unit interventions: internally incoherent.
    expect(
      findScaleIncoherentBaselineFactorIds(nodes, [{ "raw-baseline": 0.5, framed: 0.74 }]),
    ).toContain("raw-baseline");
  });

  it("OUT-baseline / OUT user-authored interventions → COMPUTES (the ratified round-5 astride-1 class)", () => {
    // 'astride' mirrors the ⭐ ratified pin exactly: capless baseline 12,
    // user-authored interventions {1.2, 0.9} astride 1 — its own values define
    // its frame. The gate must stay silent on it.
    const perOption = [{ astride: 1.2 }, { astride: 0.9 }];
    expect(findScaleIncoherentBaselineFactorIds([nodes[0], nodes[7]], perOption)).toEqual([]);
  });

  it("IN-baseline / IN-interventions → computes (nothing to gate)", () => {
    expect(findScaleIncoherentBaselineFactorIds([nodes[4]], [{ framed: 0.74 }])).toEqual([]);
  });

  it("OUT-baseline / NO interventions → the ASK (no self-frame evidence either way — the add-node class; corpus-derived default: the 13 real captures contain ZERO capless out-of-unit baselines, so no legitimate shape is known to occupy this quadrant)", () => {
    // 'astride' has no interventions in THIS request either, so here it
    // genuinely occupies out/none too — the quadrant is decided per request,
    // not per node identity.
    expect(findScaleIncoherentBaselineFactorIds(nodes, [{ framed: 0.74 }])).toEqual([
      "raw-baseline",
      "over-frame",
      "negative",
      "astride",
    ]);
  });

  it("user-authored is bound by PROVENANCE, not value shape: a SYNTHESISED out-of-unit intervention grants no self-frame", () => {
    // Same values as the ratified quadrant, but the out-of-unit intervention
    // is the scaffold's own placeholder (marked synthesised). A value CEE
    // manufactured is not evidence about the user's scale — round-5's own
    // provenance rule, extended to the baseline gate.
    const perOption = [{ astride: 12 }];
    const synthesised = [new Set(["astride"])];
    expect(findScaleIncoherentBaselineFactorIds([nodes[0], nodes[7]], perOption, synthesised)).toEqual([
      "astride",
    ]);
    // Positive control: the identical call WITHOUT the synthesised marker is
    // the ratified class and stays silent.
    expect(findScaleIncoherentBaselineFactorIds([nodes[0], nodes[7]], perOption)).toEqual([]);
  });

  it("stays silent on framed, capped, valueless and non-factor nodes", () => {
    const clean = nodes.filter((n) => !["raw-baseline", "over-frame", "negative", "astride"].includes(n.id));
    expect(findScaleIncoherentBaselineFactorIds(clean, [{ framed: 0.74 }])).toEqual([]);
  });

  it("decideAnalysisScaleBlock blocks on baselines alone, with its own reason, naming the factors", () => {
    const projection = projectRequestInterventionsToWireScale(
      [{ framed: 0.74 }],
      buildFactorScaleMap(nodes),
    );
    expect(projection.mixedUnresolved).toBe(false); // interventions alone are coherent
    const verdict = decideAnalysisScaleBlock(projection, ["raw-baseline"]);
    expect(verdict.blocked).toBe(true);
    if (verdict.blocked) {
      expect(verdict.reason_code).toBe("baseline_scale_unresolved");
      expect(verdict.unresolvedFactorIds).toEqual(["raw-baseline"]);
    }
  });

  it("keeps the mixed-intervention reason when interventions are the problem, and does not block a coherent request", () => {
    const projection = projectRequestInterventionsToWireScale(
      [{ framed: 0.74 }],
      buildFactorScaleMap(nodes),
    );
    const clean = decideAnalysisScaleBlock(projection, []);
    expect(clean.blocked).toBe(false);

    const mixed = projectRequestInterventionsToWireScale(
      [{ "raw-baseline": 74000, framed: 0.74 }],
      buildFactorScaleMap(nodes.filter((n) => n.id !== "capped")),
    );
    expect(mixed.mixedUnresolved).toBe(true);
    const verdict = decideAnalysisScaleBlock(mixed, []);
    expect(verdict.blocked).toBe(true);
    if (verdict.blocked) expect(verdict.reason_code).toBe("mixed_scale_unresolved");
  });
});
