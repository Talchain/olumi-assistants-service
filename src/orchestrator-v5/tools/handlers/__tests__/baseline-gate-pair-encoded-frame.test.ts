/**
 * ── THE BASELINE GATE MUST READ THE FRAME THE WRITER ALREADY WROTE ─────────
 *
 * WIRE-WITNESSED DEFECT (fresh-guest journey, 2026-08-19T23:15–23:30Z, frozen
 * quartet UI `2b6ec553` · CEE `19a60fd` · PLoT `fb63b03` · ISL `28fe0c9`): a
 * scoped currency edit persisted correctly and the NEXT analysis blocked with
 * `analysis_not_ready` + `reason_code: baseline_scale_unresolved`, naming the
 * factor the user had just edited. The product accepted an edit it then
 * refused to analyse.
 *
 * THE CONTRADICTION IS INTERNAL, BETWEEN TWO MODULES THAT ANSWER THE SAME
 * QUESTION DIFFERENTLY (trap 21):
 *
 *   · THE WRITER (`normalise-factor-value.ts:139-166`, pinned by
 *     `scale-frame-preserving-edit.test.ts:133`) says an over-frame edit
 *     writes an HONEST level > 1 beside the user's kept magnitude — the pair
 *     `{value, raw_value}` encodes the frame EXACTLY (`raw/value`), and
 *     re-framing mid-edit would silently rescale every sibling intervention.
 *
 *   · THE GATE (`plot-intervention-scale.ts:763`) tests only
 *     `baseline >= 0 && baseline <= 1` and never looks at `raw_value`, so it
 *     calls that same pair `baseline_scale_unresolved`.
 *
 * The gate's own doc justifies its out/none default on the premise that "the
 * 13-real-capture corpus contains ZERO capless out-of-unit baselines of ANY
 * quadrant, so no legitimate shape is known to occupy it". That premise is
 * REFUTED by CEE's own writer, which manufactures exactly that shape by
 * design on every over-frame edit. Round 2 already learned this once at the
 * writer level (R2-2: "the pair still encodes the frame EXACTLY; refusing it
 * was the defect"); the gate is the third consumer that was never put on
 * `recoverScaleFrame`, the canonical owner of that question.
 *
 * ⚠ THIS IS NOT A WIDENING OF THE GATE'S WINDOW. The exemption is a POSITIVE
 * determination that the scale IS resolved — a frame is encoded in the
 * factor's own pair — not a tolerance. Every genuinely unresolvable shape
 * must keep blocking, and the opposite-direction twins below are what prove
 * it: a bare raw baseline (`{74000, 74000}`, no frame encoded) and a negative
 * pair (`{-0.05, -5000}`, no truthful frame exists — both `recoverScaleFrame`
 * and `deriveFactorScaleFrame` refuse negatives sign-symmetrically) must
 * still be refused, on the SAME payload, in the SAME run.
 */
import { describe, expect, it } from "vitest";

import { normaliseFactorValue } from "../d1-shared/normalise-factor-value.js";
import { recoverScaleFrame } from "../d1-shared/scale-frame.js";
import { deriveFactorScaleFrame } from "../../../../cee/draft/records/projector.js";
import { reconcileObservedValuePair } from "../../../../orchestrator/canonicalise-value-ops.js";
import {
  decideAnalysisScaleBlock,
  findScaleIncoherentBaselineFactorIds,
  projectRequestInterventionsToWireScale,
  buildFactorScaleMap,
} from "../../plot-intervention-scale.js";

/**
 * The witnessed journey, reproduced from the PRODUCERS' own derivations — no
 * hand-written pair anywhere in this arrange step (trap 16-inverse: a fixture
 * you wrote yourself is not evidence about the wire).
 *
 * Draft: the records projector frames "Annual CRM Running Cost" from its own
 * stated magnitude. Edit: the user types a larger figure and the canonical
 * writer preserves that frame. The result is the node the gate then judges.
 */
const DRAFT_MAGNITUDE = 40000;
const EDITED_MAGNITUDE = 62000;

function draftFramedPair(): { value: number; raw_value: number } {
  const frame = deriveFactorScaleFrame([DRAFT_MAGNITUDE], "£");
  if (frame === undefined) throw new Error("arrange precondition: draft must frame");
  return { value: DRAFT_MAGNITUDE / frame, raw_value: DRAFT_MAGNITUDE };
}

function afterUserEdit(): { value: number; raw_value: number } {
  const before = draftFramedPair();
  return normaliseFactorValue({
    rawInput: EDITED_MAGNITUDE,
    inputHasUnit: false,
    factorObservedValue: before.value,
    factorObservedRawValue: before.raw_value,
  });
}

describe("the witnessed journey: a scoped currency edit the product then refuses to analyse", () => {
  it("ARRANGE IS THE PRODUCERS' OWN OUTPUT: the draft frames £40,000 at 50,000 and the edit to £62,000 lands over-frame with the magnitude kept", () => {
    // Pins the precondition IN-TEST so the assertions below are provably about
    // the shape CEE writes, not about a shape this file invented (trap 13b).
    expect(deriveFactorScaleFrame([DRAFT_MAGNITUDE], "£")).toBe(50000);
    expect(draftFramedPair()).toEqual({ value: 0.8, raw_value: 40000 });

    const edited = afterUserEdit();
    expect(edited.raw_value).toBe(EDITED_MAGNITUDE);
    expect(edited.value).toBeCloseTo(1.24, 10);
    expect(edited.value).toBeGreaterThan(1);
    // The frame survived the edit exactly — this is what "resolved" means here.
    expect(recoverScaleFrame(edited)).toBe(50000);
  });

  it("the gate must NOT block the factor the edit just wrote — its own pair states the frame", () => {
    const edited = afterUserEdit();
    const nodes = [
      { id: "goal", kind: "goal", label: "Cut total cost of ownership" },
      {
        id: "annual-crm-running-cost",
        kind: "factor",
        label: "Annual CRM Running Cost",
        observed_state: { ...edited, unit: "£" },
      },
    ];

    // Bound BY IDENTITY (the node id), never by a value predicate another
    // object in this graph could satisfy (trap 19).
    expect(findScaleIncoherentBaselineFactorIds(nodes, [])).not.toContain(
      "annual-crm-running-cost",
    );
    expect(findScaleIncoherentBaselineFactorIds(nodes, [])).toEqual([]);
  });

  it("end to end at the decision the handler acts on: the run is NOT blocked", () => {
    const edited = afterUserEdit();
    const nodes = [
      { id: "goal", kind: "goal", label: "Cut total cost of ownership" },
      {
        id: "annual-crm-running-cost",
        kind: "factor",
        label: "Annual CRM Running Cost",
        observed_state: { ...edited, unit: "£" },
      },
    ];
    const projection = projectRequestInterventionsToWireScale([], buildFactorScaleMap(nodes));
    const verdict = decideAnalysisScaleBlock(
      projection,
      findScaleIncoherentBaselineFactorIds(nodes, []),
    );
    expect(verdict.blocked).toBe(false);
  });

  it("writer 2 (the chat/held lane) produces the same over-frame pair, and the gate must treat it identically — one answer, not two", () => {
    const before = draftFramedPair();
    const [out] = reconcileObservedValuePair(
      [
        {
          op: "update_node" as const,
          path: "annual-crm-running-cost",
          value: {
            observed_state: { ...before, value: EDITED_MAGNITUDE },
          },
        } as never,
      ],
      {
        nodes: [
          {
            id: "annual-crm-running-cost",
            kind: "factor",
            label: "Annual CRM Running Cost",
            observed_state: before,
          },
        ],
        edges: [],
      },
    );
    const observed = (out as { value: { observed_state: Record<string, unknown> } }).value
      .observed_state;
    expect(observed.raw_value).toBe(EDITED_MAGNITUDE);
    expect(observed.value).toBeCloseTo(1.24, 10);

    const nodes = [
      {
        id: "annual-crm-running-cost",
        kind: "factor",
        label: "Annual CRM Running Cost",
        observed_state: observed,
      },
    ];
    expect(findScaleIncoherentBaselineFactorIds(nodes, [])).toEqual([]);
  });
});

describe("OPPOSITE-DIRECTION TWINS — the gate still refuses every genuinely unresolvable scale, on the same payload", () => {
  const edited = afterUserEdit();

  /**
   * One graph carrying BOTH directions, so a fix that silences the gate fails
   * here rather than passing quietly: the exempt factor and the refused ones
   * are judged in a single call.
   */
  const nodes = [
    { id: "goal", kind: "goal", label: "Cut total cost of ownership" },
    {
      id: "pair-encoded",
      kind: "factor",
      label: "Annual CRM Running Cost",
      observed_state: { ...edited, unit: "£" },
    },
    // No frame is encoded: raw === value, so `recoverScaleFrame` refuses it.
    // This is the R2-2 silent-corruption class and it MUST keep blocking.
    {
      id: "bare-raw",
      kind: "factor",
      label: "One-Off Migration Cost",
      observed_state: { value: 70000, raw_value: 70000, unit: "£" },
    },
    // A negative magnitude has no truthful frame — refused sign-symmetrically
    // by BOTH canonical derivations. MUST keep blocking.
    {
      id: "negative",
      kind: "factor",
      label: "Net Cash Impact",
      observed_state: { value: -0.05, raw_value: -5000, unit: "£" },
    },
    // A level with no magnitude beside it states no frame. MUST keep blocking.
    {
      id: "value-only",
      kind: "factor",
      label: "Switching Cost",
      observed_state: { value: 12 },
    },
  ];

  it("pins its own precondition: the twins are genuinely frame-less and the exempt one is genuinely framed", () => {
    // Without this the twins could pass by accident on a fixture that stopped
    // discriminating (trap 13b, third face).
    expect(recoverScaleFrame(edited)).toBe(50000);
    expect(recoverScaleFrame({ value: 70000, raw_value: 70000 })).toBeUndefined();
    expect(recoverScaleFrame({ value: -0.05, raw_value: -5000 })).toBeUndefined();
    expect(recoverScaleFrame({ value: 12 })).toBeUndefined();
    expect(deriveFactorScaleFrame([-5000], "£")).toBeUndefined();
  });

  it("refuses the bare raw baseline, the negative and the value-only factor — and exempts ONLY the pair-encoded one", () => {
    const blocked = findScaleIncoherentBaselineFactorIds(nodes, []);
    expect(blocked).toEqual(["bare-raw", "negative", "value-only"]);
    expect(blocked).not.toContain("pair-encoded");
  });

  it("the R2-2 silent-corruption class still blocks beside its own in-unit interventions", () => {
    expect(
      findScaleIncoherentBaselineFactorIds(nodes, [{ "bare-raw": 0.5, "pair-encoded": 0.4 }]),
    ).toContain("bare-raw");
  });

  it("the ratified round-5 astride-1 exemption is untouched: user-authored out-of-unit interventions still self-frame", () => {
    expect(
      findScaleIncoherentBaselineFactorIds([nodes[0], nodes[4]], [{ "value-only": 1.2 }, { "value-only": 0.9 }]),
    ).toEqual([]);
    // ...and provenance still governs it: a SYNTHESISED out-of-unit value is
    // not evidence about the user's scale.
    expect(
      findScaleIncoherentBaselineFactorIds(
        [nodes[0], nodes[4]],
        [{ "value-only": 12 }],
        [new Set(["value-only"])],
      ),
    ).toEqual(["value-only"]);
  });

  it("the block still reaches the handler's decision with its own reason and names the factors", () => {
    const projection = projectRequestInterventionsToWireScale([], buildFactorScaleMap(nodes));
    const verdict = decideAnalysisScaleBlock(
      projection,
      findScaleIncoherentBaselineFactorIds(nodes, []),
    );
    expect(verdict.blocked).toBe(true);
    if (verdict.blocked) {
      expect(verdict.reason_code).toBe("baseline_scale_unresolved");
      expect(verdict.unresolvedFactorIds).toEqual(["bare-raw", "negative", "value-only"]);
    }
  });
});
