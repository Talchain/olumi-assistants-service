/**
 * F3 (Codex, 2026-08-13) — AN OPTION'S RECEIPT MUST DESCRIBE ITS OWN LEVER.
 *
 * THE DEFECT. `buildInterventionDetail` returned the FACTOR's
 * `observed_state.raw_value` — and, in its second branch, the FACTOR's
 * `display_value` — for EVERY option that touches the factor. On the brief
 * "Plan A sets the support headcount to 80. Plan B sets it to 50. It is
 * currently 40", Plan A (level .8) and Plan B (level .5) both showed
 * `raw_value: 40` and the display "40": the STATUS QUO, presented as each
 * option's proposal. `synthesiseDisplayValue` prioritises `raw_value` over
 * `value` (display-value.ts:176), so the factor's raw won even though the
 * option's own level was passed beside it.
 *
 * ── WHY 21 `intervention_details` AND 18 `display_value` ASSERTIONS COULD NOT
 * SEE IT (CLAUDE.md trap 22) ────────────────────────────────────────────────
 * Every pre-existing fixture sets the intervention level EQUAL to the factor's
 * observed value — 0.5 on a {0.5, 5} factor, 0.4 on a {0.4, 200000} factor. At
 * equal levels the borrowed value and the derived value COINCIDE, so the whole
 * corpus was green while the defect was live. **The corpus never varied two
 * options on one factor**, which is the single thing that exhibits the bug —
 * so every fixture here does exactly that.
 *
 * ── THE INVARIANT IS WRITTEN AGAINST THE SPEC, NOT THE SYMPTOM (trap 13d) ───
 * **A display value must describe ITS OWN intervention.** Not "raw_value must
 * not be 40" — that is the failure mode. The spec form catches the class,
 * including the mirror defect where an option borrows a SIBLING option's value.
 *
 * BINDING IS BY IDENTITY (trap 19): every assertion names THE option id and THE
 * factor id. `opt_plan_c` exists in the fixture and is deliberately NOT
 * asserted, so a mutation scoped to it must leave this suite GREEN — the
 * discriminating half of the pair.
 */

import { describe, it, expect } from "vitest";

import { buildAnalysisReadyPayload } from "../analysis-ready.js";
import type { OptionV3T, GraphV3T, NodeV3T } from "../../../schemas/cee-v3.js";

/** The framed, capless pair the records projector writes: 40 at frame 100. */
const FRAMED_HEADCOUNT = {
  value: 0.4,
  raw_value: 40,
  unit: "people",
  source: "brief_extraction",
};

function makeGraph(nodes: NodeV3T[]): GraphV3T {
  return {
    nodes: [{ id: "goal_1", kind: "goal", label: "Improve support" }, ...nodes],
    edges: [],
  } as unknown as GraphV3T;
}

function makeFactor(id: string, label: string, extra?: Record<string, unknown>): NodeV3T {
  return { id, kind: "factor", label, ...extra } as unknown as NodeV3T;
}

function makeOption(id: string, label: string, factorId: string, value: number): OptionV3T {
  return {
    id,
    label,
    status: "ready",
    interventions: {
      [factorId]: {
        value,
        source: "brief_extraction",
        target_match: { node_id: factorId, match_type: "exact_id", confidence: "high" },
      },
    },
  } as unknown as OptionV3T;
}

/** Three options on ONE factor at THREE different levels — the shape the old corpus lacked. */
function threeOptionsOnOneFactor(factorExtra: Record<string, unknown>) {
  const factor = makeFactor("fac_support_headcount", "Support headcount", factorExtra);
  const options = [
    makeOption("opt_plan_a", "Plan A", "fac_support_headcount", 0.8),
    makeOption("opt_plan_b", "Plan B", "fac_support_headcount", 0.5),
    makeOption("opt_plan_c", "Plan C", "fac_support_headcount", 0.9),
  ];
  return buildAnalysisReadyPayload(options, "goal_1", makeGraph([factor]));
}

function detailOf(
  payload: ReturnType<typeof buildAnalysisReadyPayload>,
  optionId: string,
  factorId = "fac_support_headcount",
) {
  const option = payload.options.find((o) => o.id === optionId);
  if (!option) throw new Error(`fixture precondition failed: option ${optionId} absent`);
  const detail = option.intervention_details?.[factorId];
  if (!detail) {
    throw new Error(`fixture precondition failed: detail ${optionId}→${factorId} absent`);
  }
  return detail;
}

describe("F3 — each option's receipt is derived from its OWN intervention", () => {
  it("gives opt_plan_a raw_value 80 and opt_plan_b raw_value 50 from the SAME factor observed at 40", () => {
    const payload = threeOptionsOnOneFactor({ observed_state: FRAMED_HEADCOUNT });

    const planA = detailOf(payload, "opt_plan_a");
    const planB = detailOf(payload, "opt_plan_b");

    // PRECONDITION PINNED IN-TEST: the two options really do differ, so a
    // green result cannot come from a fixture that never exercised the seam.
    expect(planA.normalised_value).toBe(0.8);
    expect(planB.normalised_value).toBe(0.5);

    // THE SPEC: the receipt describes its own lever. 0.8 × frame 100 = 80.
    expect(planA.raw_value).toBe(80);
    expect(planB.raw_value).toBe(50);

    // …and neither is the factor's observed state, which is what shipped.
    expect(planA.raw_value).not.toBe(40);
    expect(planB.raw_value).not.toBe(40);
    expect(planA.raw_value).not.toBe(planB.raw_value);
  });

  it("renders each option's display from its own magnitude, not the status quo", () => {
    const payload = threeOptionsOnOneFactor({ observed_state: FRAMED_HEADCOUNT });

    expect(detailOf(payload, "opt_plan_a").display_value).toBe("80 people");
    expect(detailOf(payload, "opt_plan_b").display_value).toBe("50 people");
  });

  it("keeps the factor's `unit` on every receipt (the UI reads it, and it is not per-option)", () => {
    const payload = threeOptionsOnOneFactor({ observed_state: FRAMED_HEADCOUNT });
    expect(detailOf(payload, "opt_plan_a").unit).toBe("people");
    expect(detailOf(payload, "opt_plan_b").unit).toBe("people");
  });
});

describe("F3 — a factor-scoped display string is only used where it is TRUE", () => {
  it("does NOT lend the factor's display_value to an option sitting elsewhere", () => {
    const payload = threeOptionsOnOneFactor({
      display_value: "40 people",
      observed_state: FRAMED_HEADCOUNT,
    });

    // "40 people" describes the factor's observed state. Plan A proposes 80.
    expect(detailOf(payload, "opt_plan_a").display_value).not.toBe("40 people");
    expect(detailOf(payload, "opt_plan_a").display_value).toBe("80 people");
  });

  it("OPPOSITE-DIRECTION TWIN: an option sitting AT the observed state still uses it", () => {
    // The status-quo option's lever IS the factor's observed state, so the
    // factor's display string is a true description of it. Withdrawing it there
    // would be the mirror harm — silently degrading an honest receipt.
    const factor = makeFactor("fac_support_headcount", "Support headcount", {
      display_value: "40 people",
      observed_state: FRAMED_HEADCOUNT,
    });
    const payload = buildAnalysisReadyPayload(
      [makeOption("opt_status_quo", "Keep as is", "fac_support_headcount", 0.4)],
      "goal_1",
      makeGraph([factor]),
    );

    expect(detailOf(payload, "opt_status_quo").display_value).toBe("40 people");
    expect(detailOf(payload, "opt_status_quo").raw_value).toBe(40);
  });

  it("keeps a per-INTERVENTION display_value verbatim — it is already the option's own", () => {
    const factor = makeFactor("fac_support_headcount", "Support headcount", {
      observed_state: FRAMED_HEADCOUNT,
    });
    const option = makeOption("opt_plan_a", "Plan A", "fac_support_headcount", 0.8);
    (option.interventions as Record<string, Record<string, unknown>>)["fac_support_headcount"]
      .display_value = "80 support staff";

    const payload = buildAnalysisReadyPayload([option], "goal_1", makeGraph([factor]));
    const detail = detailOf(payload, "opt_plan_a");

    expect(detail.display_value).toBe("80 support staff");
    // …and its raw_value is still the option's own, not the factor's.
    expect(detail.raw_value).toBe(80);
  });
});

describe("F3 — where the scale is unrecoverable the receipt OMITS rather than borrows", () => {
  it("omits raw_value on a zero-baseline factor instead of lending the option a 0", () => {
    const payload = threeOptionsOnOneFactor({
      observed_state: { value: 0, raw_value: 0, unit: "people" },
    });

    const planA = detailOf(payload, "opt_plan_a");
    // Visible absence over confident wrongness: nothing in the record says
    // whether 0.8 denotes 0.8 people or 80.
    expect(planA.raw_value).toBeUndefined();
    // The display still describes THIS option's own lever, borrowing nothing.
    expect(planA.normalised_value).toBe(0.8);
    expect(planA.display_value).not.toContain("0 people");
  });

  it("omits raw_value when the factor records no observed_state at all", () => {
    const payload = threeOptionsOnOneFactor({});
    expect(detailOf(payload, "opt_plan_a").raw_value).toBeUndefined();
  });

  it("REGRESSION GUARD: the qualitative-band fallback still fires (it is the option's own level, not a borrow)", () => {
    // The pre-existing suite pins `display_value === "High (0.7)"` for a factor
    // recorded as `{value: 0.7}` with no raw and no cap. That string is derived
    // from the OPTION's own level and borrows nothing, so the F3 fix must NOT
    // withdraw it. (The brief for this lane proposed omitting display_value
    // wherever the frame is unrecoverable; that would have broken this, which
    // is why the narrower rule — never borrow OBSERVED STATE — is the one
    // implemented. Corrected premise, recorded here so it stays corrected.)
    const factor = makeFactor("fac_risk", "Delivery risk", {
      observed_state: { value: 0.15, source: "brief_extraction" },
      factor_type: "risk",
    });
    const payload = buildAnalysisReadyPayload(
      [makeOption("opt_plan_a", "Plan A", "fac_risk", 0.7)],
      "goal_1",
      makeGraph([factor]),
    );

    const detail = detailOf(payload, "opt_plan_a", "fac_risk");
    expect(detail.display_value).toBe("High (0.7)");
    expect(detail.raw_value).toBeUndefined();
  });
});

describe("F3 — the CAPPED convention keeps working, and equal-level fixtures are byte-identical", () => {
  it("derives each option's own magnitude through a persisted cap", () => {
    const payload = threeOptionsOnOneFactor({
      observed_state: { value: 0.4, raw_value: 40, unit: "people", cap: 100 },
    });

    expect(detailOf(payload, "opt_plan_a").raw_value).toBe(80);
    expect(detailOf(payload, "opt_plan_b").raw_value).toBe(50);
  });

  it("an option at the factor's own level is unchanged from pre-fix behaviour (5 people)", () => {
    // This is the shape of every pre-existing fixture. It must not move.
    const factor = makeFactor("fac_dev_headcount", "Developer Headcount", {
      observed_state: { value: 0.5, raw_value: 5, unit: "people", source: "brief_extraction" },
    });
    const payload = buildAnalysisReadyPayload(
      [makeOption("opt_a", "Hire team", "fac_dev_headcount", 0.5)],
      "goal_1",
      makeGraph([factor]),
    );

    const detail = detailOf(payload, "opt_a", "fac_dev_headcount");
    expect(detail.display_value).toBe("5 people");
    expect(detail.raw_value).toBe(5);
    expect(detail.unit).toBe("people");
  });
});
