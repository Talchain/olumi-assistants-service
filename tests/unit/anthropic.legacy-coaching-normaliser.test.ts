/**
 * Legacy bias_category / widening_log normaliser test (v0.11.0 schema
 * amendment). Exercises the REAL production function from
 * `src/adapters/llm/normalise-legacy-coaching.ts` (NOT a re-implemented
 * helper) so a regression in the production seam fails this test.
 *
 * The function is invoked by `src/adapters/llm/anthropic.ts` immediately
 * after the structured-output Zod parse and before any downstream
 * pipeline transform.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Mock telemetry.emit so we can assert the per-substitution events.
const emitSpy = vi.fn();
vi.mock("../../src/utils/telemetry.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/utils/telemetry.js")>(
    "../../src/utils/telemetry.js",
  );
  return {
    ...actual,
    emit: (...args: unknown[]) => emitSpy(...args),
  };
});

// Imported AFTER the mock declaration so the production module picks up
// the spy.
import { normaliseLegacyCoachingValues } from "../../src/adapters/llm/normalise-legacy-coaching.js";
import { BiasType, StrengthenItemActionType } from "@talchain/schemas";

beforeEach(() => {
  emitSpy.mockClear();
});

describe("normaliseLegacyCoachingValues (production export)", () => {
  it("maps strengthen_items[*].bias_category: framing → narrow_framing", () => {
    const parsed = {
      coaching: {
        strengthen_items: [
          { id: "x", label: "y", detail: "z", action_type: "add_option", bias_category: "framing" },
        ],
      },
    };
    normaliseLegacyCoachingValues(parsed, "req-1");
    const item = parsed.coaching.strengthen_items[0]!;
    expect(item.bias_category).toBe("narrow_framing");
    expect(BiasType.safeParse(item.bias_category).success).toBe(true);
    expect(emitSpy).toHaveBeenCalledWith(
      expect.stringContaining("legacy_coaching_value_normalised"),
      expect.objectContaining({
        field: "coaching.strengthen_items[*].bias_category",
        original_value: "framing",
        normalised_value: "narrow_framing",
        request_id: "req-1",
      }),
    );
  });

  it("maps blindspots → narrow_framing and confidence → overconfidence", () => {
    const parsed = {
      coaching: {
        strengthen_items: [
          { id: "a", label: "y", detail: "z", action_type: "add_constraint", bias_category: "blindspots" },
          { id: "b", label: "y", detail: "z", action_type: "add_risk", bias_category: "confidence" },
        ],
      },
    };
    normaliseLegacyCoachingValues(parsed, undefined);
    expect(parsed.coaching.strengthen_items[0]!.bias_category).toBe("narrow_framing");
    expect(parsed.coaching.strengthen_items[1]!.bias_category).toBe("overconfidence");
  });

  it("maps bias_signals[*].type via the same mapping", () => {
    const parsed = {
      coaching: {
        strengthen_items: [],
        bias_signals: [
          { type: "framing", detail: "x" },
          { type: "confidence", detail: "y" },
        ],
      },
    };
    normaliseLegacyCoachingValues(parsed, "req-2");
    expect(parsed.coaching.bias_signals[0]!.type).toBe("narrow_framing");
    expect(parsed.coaching.bias_signals[1]!.type).toBe("overconfidence");
    // Two events emitted, both for bias_signals
    const fields = emitSpy.mock.calls.map((c) => (c[1] as { field: string }).field);
    expect(fields.filter((f) => f === "coaching.bias_signals[*].type")).toHaveLength(2);
  });

  it("converts legacy widening_log array → canonical object", () => {
    const parsed = {
      coaching: {
        strengthen_items: [],
        widening_log: [
          { node_id: "fac_alpha", label: "Alpha", reason: "brief mentions cost but not quantified" },
          { node_id: "risk_beta", label: "Beta", reason: "mid-market churn risk not in brief" },
        ],
      },
    };
    normaliseLegacyCoachingValues(parsed, "req-3");
    const wl = parsed.coaching.widening_log as unknown as {
      elements_added: string[];
      elements_considered_but_excluded: string[];
      brief_completeness: string;
    };
    expect(wl.elements_added).toEqual(["fac_alpha", "risk_beta"]);
    expect(wl.elements_considered_but_excluded).toEqual([
      "brief mentions cost but not quantified",
      "mid-market churn risk not in brief",
    ]);
    expect(wl.brief_completeness).toBe("thin");
    expect(emitSpy).toHaveBeenCalledWith(
      expect.stringContaining("legacy_coaching_value_normalised"),
      expect.objectContaining({
        field: "coaching.widening_log",
        original_value: "legacy_array",
        normalised_value: "canonical_object",
        legacy_entry_count: 2,
      }),
    );
  });

  it("maps strengthen_items[*].action_type: improve → add_constraint", () => {
    const parsed = {
      coaching: {
        strengthen_items: [
          { id: "x", label: "y", detail: "z", action_type: "improve" },
        ],
      },
    };
    normaliseLegacyCoachingValues(parsed, "req-4");
    const item = parsed.coaching.strengthen_items[0]!;
    expect(item.action_type).toBe("add_constraint");
    expect(StrengthenItemActionType.safeParse(item.action_type).success).toBe(true);
  });

  it("does NOT mutate canonical values (no spurious normalisation)", () => {
    const parsed = {
      coaching: {
        strengthen_items: [
          { id: "x", label: "y", detail: "z", action_type: "add_option", bias_category: "anchoring" },
        ],
        bias_signals: [{ type: "status_quo_bias", detail: "x" }],
        widening_log: {
          elements_added: ["fac_x"],
          elements_considered_but_excluded: ["x"],
          brief_completeness: "complete",
        },
      },
    };
    normaliseLegacyCoachingValues(parsed, undefined);
    expect(emitSpy).not.toHaveBeenCalled();
    // Canonical object preserved intact (not converted)
    expect(parsed.coaching.widening_log).toEqual({
      elements_added: ["fac_x"],
      elements_considered_but_excluded: ["x"],
      brief_completeness: "complete",
    });
  });

  it("is a no-op for absent / shape-invalid input", () => {
    const parsed1 = { coaching: undefined };
    const parsed2 = { coaching: null };
    const parsed3 = { coaching: "not-an-object" };
    const parsed4 = {};
    normaliseLegacyCoachingValues(parsed1, undefined);
    normaliseLegacyCoachingValues(parsed2 as { coaching?: unknown }, undefined);
    normaliseLegacyCoachingValues(parsed3 as { coaching?: unknown }, undefined);
    normaliseLegacyCoachingValues(parsed4, undefined);
    expect(emitSpy).not.toHaveBeenCalled();
  });

  it("processes the legacy-survival fixture cleanly — every legacy value normalised", () => {
    const fixture = JSON.parse(
      readFileSync(
        resolve(__dirname, "../../tests/fixtures/cross-service/draft-graph.legacy-v192b.coaching.json"),
        "utf8",
      ),
    );
    normaliseLegacyCoachingValues(fixture, "req-fixture");
    // Every strengthen_item bias_category is now canonical
    for (const item of fixture.coaching.strengthen_items) {
      expect(BiasType.safeParse(item.bias_category).success).toBe(true);
    }
    // Every bias_signal type is now canonical
    for (const sig of fixture.coaching.bias_signals) {
      expect(BiasType.safeParse(sig.type).success).toBe(true);
    }
    // 3 strengthen + 2 bias_signals = 5 substitutions
    expect(emitSpy).toHaveBeenCalledTimes(5);
  });
});
