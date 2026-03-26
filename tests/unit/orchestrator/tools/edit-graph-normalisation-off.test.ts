import { describe, it, expect, vi } from "vitest";

/**
 * Tests that normalisation is skipped when CEE_EDIT_NORMALISATION_ENABLED=false.
 * Separate file because vi.mock config is module-scoped.
 */

vi.mock("../../../../src/adapters/llm/prompt-loader.js", () => ({
  getSystemPrompt: vi.fn().mockResolvedValue("You are editing a graph."),
}));

vi.mock("../../../../src/config/index.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../../src/config/index.js")>();
  return {
    ...original,
    config: new Proxy(original.config, {
      get(target, prop) {
        if (prop === "cee") {
          return new Proxy(Reflect.get(target, prop) as object, {
            get(ceeTarget, ceeProp) {
              if (ceeProp === "editNormalisationEnabled") return false;
              return Reflect.get(ceeTarget, ceeProp);
            },
          });
        }
        return Reflect.get(target, prop);
      },
    }),
  };
});

import {
  normaliseEditOpsForPlot,
  mapOpsForPlot,
} from "../../../../src/orchestrator/tools/edit-graph.js";
import type { PatchOperation } from "../../../../src/orchestrator/types.js";

describe("normalisation flag off", () => {
  it("normaliseEditOpsForPlot passes through non-canonical ops unchanged", () => {
    const ops: PatchOperation[] = [
      {
        op: "add_edge",
        path: "fac_1->goal_1",
        value: {
          from: "fac_1",
          to: "goal_1",
          strength_mean: 0.6,
          strength_std: 0.1,
          belief_exists: 0.85,
          effect_direction: "positive",
        },
      },
    ];

    const result = normaliseEditOpsForPlot(ops);
    // Should return the same array reference — no normalisation
    expect(result).toBe(ops);
    const v = result[0].value as Record<string, unknown>;
    expect(v.belief_exists).toBe(0.85);
    expect(v).not.toHaveProperty("exists_probability");
  });

  it("mapOpsForPlot does NOT re-nest strength when flag is off", () => {
    const ops: PatchOperation[] = [
      {
        op: "add_edge",
        path: "fac_1::goal_1",
        value: {
          from: "fac_1",
          to: "goal_1",
          strength_mean: 0.6,
          strength_std: 0.1,
          exists_probability: 0.9,
          effect_direction: "positive",
        },
      },
    ];

    const mapped = mapOpsForPlot(ops);
    const v = mapped[0].value as Record<string, unknown>;
    // Flat fields should pass through — no nesting
    expect(v.strength_mean).toBe(0.6);
    expect(v.strength_std).toBe(0.1);
    expect(v).not.toHaveProperty("strength");
    // Path conversion still happens (not gated)
    expect(mapped[0].path).toBe("fac_1->goal_1");
  });
});
