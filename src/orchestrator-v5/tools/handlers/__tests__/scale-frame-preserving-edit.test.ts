/**
 * THE EDIT SEAM IS FRAME-PRESERVING — closure of PR #926 review BLOCKER 1.
 *
 * ── THE DEFECT THIS PINS (measured by the adversarial review at the real
 * seams, REVIEW-926.md Q2) ──────────────────────────────────────────────────
 * Pass 3d writes capless framed baselines ({value: 0.5, raw_value: 50000}).
 * Both post-draft baseline writers destroyed the frame on the first accepted
 * bare-number edit:
 *   · D1 `normaliseFactorValue`: "when cap is absent, value = raw_value" →
 *     wrote {74000, 74000};
 *   · edit_graph's `reconcileObservedValuePair`: re-derived `raw_value` from
 *     the new value but never rescaled `value` → same raw shape.
 * The scale guard gates INTERVENTIONS only, so the post-edit graph computed
 * with w×74000 where the draft contributed w×0.5 — silent corruption under a
 * green scale self-report (`wire_all_within_unit_interval: true`).
 *
 * ── THE FIX, AND ITS SPEC ───────────────────────────────────────────────────
 * At edit time the frame is still RECOVERABLE from the factor's before-pair:
 * `frame = raw_value / value` (50000 / 0.5 = 100000) — preconditions mirror
 * `buildFactorScaleMap`'s normalised-convention proof (value ∈ (0,1],
 * raw_value > value, frame finite > 1), so recovery can never fire on an
 * unframed factor (raw == value) or fabricate a frame from a zero/negative
 * pair. An accepted edit then writes the SAME shape the draft wrote:
 * {value: raw/frame, raw_value: raw}. Semantics deliberately MIRROR the
 * capped-factor convention with frame in place of cap (D1 treats rawInput as
 * user-unit raw, exactly as the capped branch divides by cap; the reconcile
 * path classifies by the same rule `resolveExistingRawValue` uses for capped
 * factors: outside [0,1] = raw, within = level).
 *
 * ── WRITER ENUMERATION (trap 22 — the whole domain, not the measured path) ──
 * Swept `src/orchestrator*` for observed_state writers
 * (`rg "observed_state\s*=|observed_state:\s*\{|observed_state\.value\s*="`,
 * plus the user_override stamp sweep). Reachable post-draft for
 * records-drafted factors:
 *   1. set-factor-value.ts:423 via normaliseFactorValue      → FIXED here
 *   2. edit-graph.ts patch path via reconcileObservedValuePair → FIXED here
 * Not writers / not reachable for records factors: turn-executor (read),
 * graph-hash (read), plot-intervention-scale (pure), system-events/
 * factor-value-edit (documented non-writer), display-anchor-reconcile
 * (display anchor only), renormalise-interventions-for-cap-change (capped
 * only), add-constraint / propose-structural-edit (create NEW nodes — no
 * frame exists to preserve; disclosed in the PR as the adjacent rowable
 * class), draft-pipeline enrichment/schema-v3 (rebuild observed_state FROM
 * data, carrying the framed values through — witnessed on the wire).
 * Known pre-existing hole, recorded not absorbed: a literal nested
 * `{observed_state: {value}}` op bypasses the canonicaliser's merge and the
 * applier's whole-object replace wipes unit/raw_value siblings outright
 * (canonicalise-value-ops.ts's own "NARROW BY DESIGN" note) — that path
 * destroys raw display truth as well and predates this PR.
 */
import { describe, expect, it } from "vitest";
import { recoverScaleFrame } from "../d1-shared/scale-frame.js";
import { normaliseFactorValue } from "../d1-shared/normalise-factor-value.js";
import { reconcileObservedValuePair } from "../../../../orchestrator/canonicalise-value-ops.js";
import { projectRecordsToGraph } from "../../../../cee/draft/records/projector.js";
import {
  buildFactorScaleMap,
  projectRequestInterventionsToWireScale,
} from "../../plot-intervention-scale.js";
import type { DraftRecordSet } from "../../../../cee/draft/records/grammar.js";

// ── recoverScaleFrame: the spec, not the failure mode (trap 13d) ────────────

describe("recoverScaleFrame recovers exactly the draft-written frame shape and nothing else", () => {
  it("recovers the frame from a framed pair", () => {
    expect(recoverScaleFrame({ value: 0.5, raw_value: 50000 })).toBe(100000);
    expect(recoverScaleFrame({ value: 0.4, raw_value: 20000 })).toBe(50000);
    expect(recoverScaleFrame({ value: 0.03, raw_value: 3 })).toBe(100);
  });

  it("refuses the unframed shape (raw == value) — the capless non-records factor", () => {
    expect(recoverScaleFrame({ value: 74000, raw_value: 74000 })).toBeUndefined();
    expect(recoverScaleFrame({ value: 0.65, raw_value: 0.65 })).toBeUndefined();
  });

  it("refuses pairs that prove nothing: zero, negative, raw < value, missing, non-finite", () => {
    expect(recoverScaleFrame({ value: 0, raw_value: 0 })).toBeUndefined(); // zero is scale-ambiguous
    expect(recoverScaleFrame({ value: -0.5, raw_value: -50000 })).toBeUndefined(); // sign-symmetric refusal
    expect(recoverScaleFrame({ value: 0.5, raw_value: 0.25 })).toBeUndefined(); // raw < value: not a downscale
    // ⚠ ROUND-3 PIN MOVE (review order): {value: 2, raw_value: 50000} was
    // refused here in round 2 and that refusal WAS the U2 defect — the
    // over-frame pair the writer itself creates encodes frame 25000 exactly.
    // Its recovery is now pinned in scale-frame-round3.test.ts.
    expect(recoverScaleFrame({ value: 0.5 })).toBeUndefined();
    expect(recoverScaleFrame({ raw_value: 50000 })).toBeUndefined();
    expect(recoverScaleFrame({ value: Number.NaN, raw_value: 50000 })).toBeUndefined();
    expect(recoverScaleFrame({ value: 0.5, raw_value: Number.POSITIVE_INFINITY })).toBeUndefined();
    expect(recoverScaleFrame({})).toBeUndefined();
  });
});

// ── Writer 1: D1 normaliseFactorValue ───────────────────────────────────────

describe("D1 set_factor_value writes are frame-preserving on framed capless factors", () => {
  it("the golden edit: 74000 on a {0.5, 50000} factor writes {value: 0.74, raw_value: 74000}", () => {
    const result = normaliseFactorValue({
      rawInput: 74000,
      inputHasUnit: false,
      factorObservedValue: 0.5,
      factorObservedRawValue: 50000,
    });
    expect(result).toEqual({ raw_value: 74000, value: 0.74 });
  });

  it("an UNFRAMED capless factor keeps today's behaviour exactly (value === raw_value)", () => {
    const result = normaliseFactorValue({
      rawInput: 0.8,
      inputHasUnit: false,
      factorObservedValue: 0.65,
      factorObservedRawValue: 0.65,
    });
    expect(result).toEqual({ raw_value: 0.8, value: 0.8 });
  });

  it("a capless factor with NO recorded pair keeps today's behaviour exactly", () => {
    expect(normaliseFactorValue({ rawInput: 42, inputHasUnit: false })).toEqual({
      raw_value: 42,
      value: 42,
    });
  });

  it("capped factors are untouched by frame recovery (cap wins, as before)", () => {
    const result = normaliseFactorValue({
      rawInput: 50000,
      inputHasUnit: false,
      factorCap: 200000,
      factorObservedValue: 0.5,
      factorObservedRawValue: 50000,
    });
    expect(result).toEqual({ raw_value: 50000, value: 0.25 });
  });

  it("an over-frame edit divides honestly rather than clamping (level > 1, raw kept)", () => {
    // 150000 on a 100000 frame is 1.5 of the frame — the truth. Nothing is
    // clamped or re-framed silently; the out-of-domain level is the honest
    // representation and is disclosed in the PR as the residual over-frame
    // posture (the capped branch clamps because PLoT clamps at cap; a frame
    // is not a cap and inventing a new one mid-edit would silently rescale
    // every sibling intervention on the factor).
    const result = normaliseFactorValue({
      rawInput: 150000,
      inputHasUnit: false,
      factorObservedValue: 0.5,
      factorObservedRawValue: 50000,
    });
    expect(result).toEqual({ raw_value: 150000, value: 1.5 });
  });
});

// ── Writer 2: edit_graph's reconcileObservedValuePair ───────────────────────

/** The exact payload shape the canonicaliser hands reconcile: the node's
 * existing observed_state MERGED under the new value (stale raw_value rides
 * along — that carry-forward is reconcile's trigger). */
function mergedOp(nodeObserved: Record<string, unknown>, newValue: number) {
  return {
    op: "update_node" as const,
    path: "annual-cost",
    value: { observed_state: { ...nodeObserved, value: newValue } },
  };
}

function graphWith(nodeObserved: Record<string, unknown>) {
  return {
    nodes: [{ id: "annual-cost", kind: "factor", label: "Annual CRM Licence Cost", observed_state: nodeObserved }],
    edges: [],
  };
}

describe("edit_graph value ops are frame-preserving on framed capless factors", () => {
  const FRAMED = { value: 0.5, raw_value: 50000 };

  it("a raw-looking new value (74000) is rescaled onto the factor's own frame", () => {
    const [out] = reconcileObservedValuePair(
      [mergedOp(FRAMED, 74000) as never],
      graphWith(FRAMED),
    );
    const observed = (out as { value: { observed_state: Record<string, unknown> } }).value.observed_state;
    expect(observed.value).toBe(0.74);
    expect(observed.raw_value).toBe(74000);
  });

  it("a bare sub-1 new value is AMBIGUOUS and refused — round 3 replaced the round-2 level guess with the ask", () => {
    // ⚠ DELIBERATE ORACLE CHANGE (round-2 re-review blocker R2-1). Round 2
    // had this path GUESS "level" (×frame) while the D1 writer guessed "raw"
    // (÷frame) — the same utterance, 10^5 apart, measured. Neither guess was
    // defensible; the ambiguity is now the product: the callers prescreen via
    // findAmbiguousScaleValueOps and ASK, and reconcile throws as the
    // fail-loud backstop (pinned in scale-frame-round3.test.ts).
    expect(() =>
      reconcileObservedValuePair([mergedOp(FRAMED, 0.42) as never], graphWith(FRAMED)),
    ).toThrow(/ambiguous/i);
  });

  it("an UNFRAMED capless factor keeps today's behaviour exactly (raw_value re-derived, value untouched)", () => {
    const before = { value: 20000, raw_value: 20000 };
    const [out] = reconcileObservedValuePair(
      [mergedOp(before, 74000) as never],
      graphWith(before),
    );
    const observed = (out as { value: { observed_state: Record<string, unknown> } }).value.observed_state;
    expect(observed.value).toBe(74000);
    expect(observed.raw_value).toBe(74000);
  });

  it("a CAPPED factor keeps today's behaviour exactly (cap authority unchanged)", () => {
    const before = { value: 0.5, raw_value: 50000, cap: 100000 };
    const [out] = reconcileObservedValuePair(
      [mergedOp(before, 74000) as never],
      graphWith(before),
    );
    const observed = (out as { value: { observed_state: Record<string, unknown> } }).value.observed_state;
    // Capped semantics are resolveExistingRawValue's: 74000 > 1 → already-raw.
    expect(observed.raw_value).toBe(74000);
    // value untouched by reconcile on the capped path (its authority is the
    // handler/canonicaliser, unchanged by this PR).
    expect(observed.value).toBe(74000);
  });
});

// ── The end-to-end pin: draft → edit → re-analysis stays coherent ───────────

describe("post-edit re-analysis computes on the SAME frame the draft established", () => {
  const GOLDEN: DraftRecordSet = {
    stated_items: [
      { kind: "goal", source_quote: "higher sales productivity without blowing the budget" },
      { kind: "option", source_quote: "replace our current CRM with HubSpot next quarter" },
      { kind: "option", source_quote: "keep what we have" },
    ],
    claims: [
      { claim_kind: "factor", label: "Annual CRM Licence Cost", value: 50000 },
      { claim_kind: "factor", label: "CRM Adoption and Usability", value: 0.5 },
      { claim_kind: "causal_link", label: "switching changes licence cost", from_stated: 1, to_claim: 0, effect: "negative", sets_to: 50000 },
      { claim_kind: "causal_link", label: "switching moves adoption", from_stated: 1, to_claim: 1, effect: "positive", sets_to: 0.75 },
      { claim_kind: "causal_link", label: "staying holds licence cost", from_stated: 2, to_claim: 0, effect: "positive", sets_to: 35000 },
      { claim_kind: "causal_link", label: "staying holds adoption", from_stated: 2, to_claim: 1, effect: "negative", sets_to: 0.65 },
      { claim_kind: "causal_link", label: "licence cost bears on the goal", from_claim: 0, to_stated: 0, effect: "negative" },
      { claim_kind: "causal_link", label: "adoption bears on the goal", from_claim: 1, to_stated: 0, effect: "positive" },
    ],
  };

  it("edit £50,000 → £74,000 through the D1 writer: baseline carries the LEVEL 0.74 with raw 74000, and the guard still admits the request", () => {
    const { graph } = projectRecordsToGraph(GOLDEN);
    const annual = graph.nodes.find((n) => n.label === "Annual CRM Licence Cost")!;
    const before = annual.observed_state as { value: number; raw_value: number };
    expect(before).toMatchObject({ value: 0.5, raw_value: 50000 }); // draft precondition, pinned

    // The D1 writer's exact value computation (set-factor-value.ts threads the
    // observed pair into normaliseFactorValue since 2.159; the handler then
    // merges the result into observed_state — replicated here).
    const written = normaliseFactorValue({
      rawInput: 74000,
      inputHasUnit: false,
      factorObservedValue: before.value,
      factorObservedRawValue: before.raw_value,
    });
    annual.observed_state = { ...annual.observed_state, ...written };
    annual.data = { ...(annual.data ?? {}), value: written.value, raw_value: written.raw_value };

    // THE ASSERTION IS THE ACTUAL LEVEL, not merely "computes" (review order).
    expect(annual.observed_state).toMatchObject({ value: 0.74, raw_value: 74000 });

    const options = graph.nodes.filter((n) => n.kind === "option");
    const perOption = options.map(
      (o) => ((o.data as { interventions?: Record<string, number> })?.interventions ?? {}),
    );
    const verdict = projectRequestInterventionsToWireScale(perOption, buildFactorScaleMap(graph.nodes));
    expect(verdict.mixedUnresolved).toBe(false);
    expect(verdict.allWithinUnitInterval).toBe(true);
    // And the baseline itself sits inside the unit interval, so PLoT's linear
    // kernel receives w×0.74 where the draft contributed w×0.5 — the edit
    // moved the number by the user's ratio, not by a scale accident. (At the
    // pre-fix head this flow wrote {74000, 74000}: the review measured the
    // corrupted request shipping under this same green verdict.)
    expect((annual.observed_state as { value: number }).value).toBeLessThanOrEqual(1);
  });
});
