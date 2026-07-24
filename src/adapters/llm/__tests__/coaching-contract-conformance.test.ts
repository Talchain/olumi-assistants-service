/**
 * Coaching contract conformance — unit + drift pins (draft-honesty lane, 2026-07-24).
 *
 * THE LIVE DEFECT: 8 of 9 successful drafts on build `3c544b8` shipped
 * `verification_status: failed_degraded` ("Response does not conform to expected
 * schema"). The alarm was HONEST — the coaching block genuinely violated
 * `StrengthenItemActionType` / `BiasType`, because the coaching-pass prompt
 * hand-typed a vocabulary that had drifted from the contract.
 *
 * MUTATION MAP (each must go RED when the named change is reverted):
 *  - M1  remove the `enforceCoachingContract` call from package.ts Step 2c
 *        → "live capture … verification_status passed" (verification-honesty spec) RED
 *  - M2  restore the hand-typed prompt vocabulary in coaching-pass.ts
 *        → "prompt vocabulary is DERIVED from the contract" RED
 *  - M3  change the bias handling from drop to re-label
 *        → "never re-labels an unrecognised bias" RED
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  TelemetryEvents: {
    DraftGraphLegacyCoachingValueNormalised: "cee.draft_graph.legacy_coaching_value_normalised",
  },
}));

import { BiasType, StrengthenItemActionType } from "@talchain/schemas";
import {
  enforceCoachingContract,
  CANONICAL_ACTION_TYPES,
  CANONICAL_BIAS_TYPES,
  GENERIC_ACTION_TYPE,
} from "../coaching-contract-conformance.js";
import { COACHING_SYSTEM } from "../../../cee/unified-pipeline/stages/coaching-pass.js";
import { emit } from "../../../utils/telemetry.js";

/**
 * The EXACT coaching block returned by the live staging draft captured at
 * 2026-07-24T20:06Z (`scratchpad/captures/d3_moderate_2.json`, build `3c544b8`,
 * prompt `draft_graph_default@v195`). Verbatim shape — this is the payload that
 * tripped the alarm in production, not a hand-written approximation.
 */
function liveOffContractCoaching() {
  return {
    summary: "The model covers the core cost factors well and includes a status-quo option.",
    strengthen_items: [
      {
        id: "connect-options-to-missing-factors",
        label: "Link all options to maintenance, mileage, and resale factors",
        detail: "Those relationships are absent.",
        action_type: "add_edge", // ← not in the contract enum
        bias_category: "availability", // ← not a BiasType
      },
      {
        id: "quantify-mileage-threshold",
        label: "Quantify the mileage needs that make leasing uneconomical",
        detail: "Lease contracts impose mileage caps.",
        action_type: "quantify", // ← not in the contract enum
        bias_category: "overconfidence", // ← valid, must survive untouched
      },
      {
        id: "add-tax-depreciation-factor",
        label: "Add a tax/depreciation factor that affects total cost",
        detail: "Depreciation deductions change the true cost comparison.",
        action_type: "add_factor", // ← not in the contract enum
      },
      {
        id: "clarify-goal-flexibility",
        label: "Clarify whether flexibility is part of the goal",
        detail: "Leasing's main non-cost advantage is the upgrade path.",
        action_type: "clarify_goal", // ← the one faithful map → reframe_goal
        bias_category: "anchoring", // ← valid, must survive untouched
      },
    ],
    widening_log: {
      elements_added: [],
      elements_considered_but_excluded: ["Insurance cost"],
      brief_completeness: "partial",
    },
    bias_signals: [
      { type: "availability", detail: "Recent breakdowns dominate the framing." }, // ← dropped
      { type: "anchoring", detail: "The upfront price anchors the comparison." }, // ← kept
    ],
  };
}

beforeEach(() => {
  vi.mocked(emit).mockClear();
});

describe("derive-don't-mirror pins", () => {
  // A hand-listed allowlist inside this module would be a second mirror and
  // would drift exactly like the prompt did. These assert it is derived.
  it("canonical vocabularies ARE the contract enums, not a local copy", () => {
    expect([...CANONICAL_ACTION_TYPES]).toEqual([...StrengthenItemActionType.options]);
    expect([...CANONICAL_BIAS_TYPES]).toEqual([...BiasType.options]);
    // Positive control: the lists are non-empty, so "everything is canonical"
    // is not vacuously true.
    expect(CANONICAL_ACTION_TYPES.length).toBeGreaterThan(0);
    expect(CANONICAL_BIAS_TYPES.length).toBeGreaterThan(0);
  });

  it("the generic fallback is itself a contract member", () => {
    expect(StrengthenItemActionType.options).toContain(GENERIC_ACTION_TYPE);
  });

  it("the coaching-pass prompt vocabulary is DERIVED from the contract (M2)", () => {
    // Every contract member must be offered to the model…
    for (const t of StrengthenItemActionType.options) {
      expect(COACHING_SYSTEM).toContain(t);
    }
    for (const t of BiasType.options) {
      expect(COACHING_SYSTEM).toContain(t);
    }
    // …and the drifted vocabulary that caused the live defect must be GONE.
    // These are the exact tokens the hand-typed prompt offered.
    for (const stale of ["add_factor", "add_edge", "clarify_goal", "quantify", "availability"]) {
      expect(COACHING_SYSTEM).not.toContain(stale);
    }
  });
});

describe("enforceCoachingContract — the live off-contract payload", () => {
  it("makes every action_type a contract member", () => {
    const c = liveOffContractCoaching();
    // Positive control: the fixture really is non-conformant to begin with —
    // ALL FOUR of its action types are outside the contract enum.
    expect(
      c.strengthen_items.filter((i) => !StrengthenItemActionType.options.includes(i.action_type as never)),
    ).toHaveLength(4);

    const r = enforceCoachingContract(c, "req-live");

    for (const item of c.strengthen_items) {
      expect(StrengthenItemActionType.options).toContain(item.action_type);
    }
    expect(r.action_types_coerced).toBe(4); // 3 unmapped + clarify_goal
  });

  it("maps clarify_goal → reframe_goal (the one faithful map) and everything else to the generic member", () => {
    const c = liveOffContractCoaching();
    enforceCoachingContract(c, "req-live");
    const byId = Object.fromEntries(c.strengthen_items.map((i) => [i.id, i.action_type]));
    expect(byId["clarify-goal-flexibility"]).toBe("reframe_goal");
    expect(byId["connect-options-to-missing-factors"]).toBe(GENERIC_ACTION_TYPE);
    expect(byId["quantify-mileage-threshold"]).toBe(GENERIC_ACTION_TYPE);
    expect(byId["add-tax-depreciation-factor"]).toBe(GENERIC_ACTION_TYPE);
  });

  it("NEVER re-labels an unrecognised bias — it drops it (M3)", () => {
    const c = liveOffContractCoaching();
    const r = enforceCoachingContract(c, "req-live");

    const first = c.strengthen_items[0] as Record<string, unknown>;
    // The whole point: `availability` must not become `anchoring` (or anything
    // else). Asserting absence, not merely "not availability" — a re-label
    // would pass a "not availability" check.
    expect("bias_category" in first).toBe(false);
    expect(r.bias_categories_dropped).toBe(1);

    // …while the two VALID bias categories survive byte-identical.
    expect((c.strengthen_items[1] as Record<string, unknown>).bias_category).toBe("overconfidence");
    expect((c.strengthen_items[3] as Record<string, unknown>).bias_category).toBe("anchoring");
  });

  it("drops a whole bias_signal whose type cannot be named, keeps the nameable one", () => {
    const c = liveOffContractCoaching();
    const r = enforceCoachingContract(c, "req-live");
    expect(c.bias_signals).toHaveLength(1);
    expect(c.bias_signals[0]!.type).toBe("anchoring");
    expect(r.bias_signals_dropped).toBe(1);
    // Never re-labelled into the surviving set.
    expect(c.bias_signals.map((s) => s.type)).not.toContain("availability");
  });

  it("emits observable telemetry for every substitution and drop", () => {
    const c = liveOffContractCoaching();
    enforceCoachingContract(c, "req-obs");
    const calls = vi.mocked(emit).mock.calls;
    // 4 action_type coercions + 1 bias_category drop + 1 bias_signal drop
    expect(calls).toHaveLength(6);
    const fields = calls.map((c2) => (c2[1] as Record<string, unknown>).field);
    expect(fields.filter((f) => f === "coaching.strengthen_items[*].action_type")).toHaveLength(4);
    expect(fields).toContain("coaching.strengthen_items[*].bias_category");
    expect(fields).toContain("coaching.bias_signals[*].type");
    // The ORIGINAL value is preserved in telemetry, so prompt-vs-contract drift
    // is diagnosable from the event alone.
    const originals = calls.map((c2) => (c2[1] as Record<string, unknown>).original_value);
    expect(originals).toContain("add_edge");
    expect(originals).toContain("availability");
  });
});

describe("enforceCoachingContract — invariants", () => {
  it("is a no-op on an already-conformant block (idempotent, zero telemetry)", () => {
    const conformant = {
      summary: "ok",
      strengthen_items: [
        { id: "a", label: "L", detail: "D", action_type: "add_option", bias_category: "anchoring" },
        { id: "b", label: "L", detail: "D", action_type: "reframe_goal" },
      ],
      widening_log: { elements_added: [], elements_considered_but_excluded: [], brief_completeness: "thin" },
      bias_signals: [{ type: "overconfidence", detail: "d" }],
    };
    const before = JSON.stringify(conformant);
    const r = enforceCoachingContract(conformant, "req-noop");
    expect(JSON.stringify(conformant)).toBe(before);
    expect(r).toEqual({ action_types_coerced: 0, bias_categories_dropped: 0, bias_signals_dropped: 0 });
    expect(vi.mocked(emit)).not.toHaveBeenCalled();
  });

  it("running it twice changes nothing the second time", () => {
    const c = liveOffContractCoaching();
    enforceCoachingContract(c, "r1");
    const afterFirst = JSON.stringify(c);
    const second = enforceCoachingContract(c, "r2");
    expect(JSON.stringify(c)).toBe(afterFirst);
    expect(second).toEqual({ action_types_coerced: 0, bias_categories_dropped: 0, bias_signals_dropped: 0 });
  });

  it("subsumes the old missing-action_type default", () => {
    const c = { strengthen_items: [{ id: "a", label: "L", detail: "D" }] } as Record<string, unknown>;
    enforceCoachingContract(c, "req-missing");
    expect((c.strengthen_items as Array<Record<string, unknown>>)[0]!.action_type).toBe(GENERIC_ACTION_TYPE);
  });

  it("no-ops safely on absent / shape-invalid coaching", () => {
    expect(() => enforceCoachingContract(undefined, "r")).not.toThrow();
    expect(() => enforceCoachingContract(null, "r")).not.toThrow();
    expect(() => enforceCoachingContract("nonsense", "r")).not.toThrow();
    expect(() => enforceCoachingContract({ strengthen_items: "no" }, "r")).not.toThrow();
    expect(() => enforceCoachingContract({ bias_signals: [null, 3] }, "r")).not.toThrow();
  });
});
