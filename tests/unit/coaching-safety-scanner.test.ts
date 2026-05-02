/**
 * Coaching output-safety scanner tests (v0.11.0 schema amendment).
 *
 * Pins the contract: scanner flags raw node-ID prefixes in user-facing
 * coaching prose; never flags structural ID fields (widening_log.elements_added).
 */
import { describe, it, expect } from "vitest";
import {
  scanCoachingForIdLeakage,
  COACHING_SAFETY_SCANNED_FIELDS,
} from "../../src/cee/validation/coaching-safety-scanner.js";

describe("scanCoachingForIdLeakage", () => {
  it("returns no hits for a clean coaching object", () => {
    const hits = scanCoachingForIdLeakage({
      summary: "Acquisition trades faster customer growth for higher runway risk.",
      strengthen_items: [
        {
          id: "strengthen_1",
          label: "Stress synergy",
          detail: "Recast the synergy estimate as a range to expose downside.",
          action_type: "add_constraint",
        },
      ],
      widening_log: {
        elements_added: ["fac_alpha", "risk_beta"],
        elements_considered_but_excluded: ["No FX exposure in horizon"],
        brief_completeness: "partial",
      },
      bias_signals: [{ type: "anchoring", detail: "Synergy figure anchored on 50M without basis." }],
    });
    expect(hits).toEqual([]);
  });

  it("flags fac_*, opt_*, out_*, risk_*, goal_*, dec_*, node_* in coaching.summary", () => {
    const hits = scanCoachingForIdLeakage({
      summary: "fac_acquisition drives out_growth toward goal_target via risk_runway.",
      strengthen_items: [],
    });
    expect(hits).toHaveLength(4);
    expect(hits.every((h) => h.path === "coaching.summary")).toBe(true);
    expect(hits.map((h) => h.match)).toEqual([
      "fac_acquisition",
      "out_growth",
      "goal_target",
      "risk_runway",
    ]);
  });

  it("flags ID leakage in strengthen_items[*].label and .detail", () => {
    const hits = scanCoachingForIdLeakage({
      summary: "x",
      strengthen_items: [
        { id: "s1", label: "Add constraint on fac_x", detail: "ok", action_type: "add_constraint" },
        { id: "s2", label: "ok", detail: "consider opt_b alongside dec_main", action_type: "add_option" },
      ],
    });
    expect(hits.map((h) => h.path)).toEqual([
      "coaching.strengthen_items[0].label",
      "coaching.strengthen_items[1].detail",
      "coaching.strengthen_items[1].detail",
    ]);
    expect(hits.map((h) => h.match)).toEqual(["fac_x", "opt_b", "dec_main"]);
  });

  it("flags ID leakage in widening_log.elements_considered_but_excluded[*]", () => {
    const hits = scanCoachingForIdLeakage({
      summary: "x",
      strengthen_items: [],
      widening_log: {
        elements_added: [],
        elements_considered_but_excluded: ["risk_currency_volatility was rejected"],
        brief_completeness: "thin",
      },
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.path).toBe("coaching.widening_log.elements_considered_but_excluded[0]");
    expect(hits[0]!.match).toBe("risk_currency_volatility");
  });

  it("flags ID leakage in bias_signals[*].detail", () => {
    const hits = scanCoachingForIdLeakage({
      summary: "x",
      strengthen_items: [],
      bias_signals: [
        { type: "anchoring", detail: "Estimate anchored at fac_target without basis." },
      ],
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.path).toBe("coaching.bias_signals[0].detail");
    expect(hits[0]!.match).toBe("fac_target");
  });

  it("does NOT flag widening_log.elements_added (structural by contract)", () => {
    const hits = scanCoachingForIdLeakage({
      summary: "x",
      strengthen_items: [],
      widening_log: {
        elements_added: ["fac_alpha", "risk_beta", "goal_zeta"],
        elements_considered_but_excluded: [],
        brief_completeness: "partial",
      },
    });
    expect(hits).toEqual([]);
  });

  it("does NOT flag strengthen_items[*].id (internal identifier)", () => {
    const hits = scanCoachingForIdLeakage({
      summary: "x",
      strengthen_items: [
        { id: "fac_lookalike", label: "ok", detail: "ok", action_type: "add_option" },
      ],
    });
    expect(hits).toEqual([]);
  });

  it("returns empty array for invalid input (permissive)", () => {
    expect(scanCoachingForIdLeakage(null)).toEqual([]);
    expect(scanCoachingForIdLeakage(undefined)).toEqual([]);
    expect(scanCoachingForIdLeakage("string")).toEqual([]);
  });

  it("exports the canonical scanned-fields list", () => {
    expect(COACHING_SAFETY_SCANNED_FIELDS).toEqual([
      "coaching.summary",
      "coaching.strengthen_items[*].label",
      "coaching.strengthen_items[*].detail",
      "coaching.widening_log.elements_considered_but_excluded[*]",
      "coaching.bias_signals[*].detail",
    ]);
  });
});
