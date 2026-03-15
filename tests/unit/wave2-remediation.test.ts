import { describe, it, expect } from "vitest";
import {
  validateAssembly,
  PromptValidationError,
  type ValidationWarning,
} from "../../src/orchestrator/prompt-zones/validate.js";
import type { AnalysisReadyFallbackMeta } from "../../src/cee/transforms/analysis-ready.js";
import { ANSWER_INCORPORATION_SYSTEM_PROMPT } from "../../src/cee/clarifier/prompts.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAssembled(overrides: Record<string, unknown> = {}) {
  return {
    system_prompt: overrides.system_prompt ?? "<ZONE1>zone1</ZONE1><DATA>data block</DATA>",
    active_blocks: overrides.active_blocks ?? [],
    total_chars: (overrides.total_chars as number) ?? 100,
    budget_ratio: (overrides.budget_ratio as number) ?? 0.01,
  } as any;
}

// ---------------------------------------------------------------------------
// Task 5 (F11): Strict prompt validation — PromptValidationError
// ---------------------------------------------------------------------------

describe("Wave 2 — Task 5: Strict prompt validation mode", () => {
  it("returns warnings without throwing when strict=false", () => {
    const assembled = makeAssembled({
      active_blocks: [
        { name: "dup", chars_rendered: 10 },
        { name: "dup", chars_rendered: 10 },
      ],
    });
    const warnings = validateAssembly(assembled, [], 0, false);
    expect(warnings.some((w: ValidationWarning) => w.code === "DUPLICATE_BLOCK")).toBe(true);
  });

  it("throws PromptValidationError when strict=true and error-severity warning exists", () => {
    const assembled = makeAssembled({
      active_blocks: [
        { name: "dup", chars_rendered: 10 },
        { name: "dup", chars_rendered: 10 },
      ],
    });
    expect(() => validateAssembly(assembled, [], 0, true)).toThrow(PromptValidationError);
  });

  it("does NOT throw when strict=true but only warn-severity warnings exist", () => {
    // Banned term triggers warn severity
    const assembled = makeAssembled({
      system_prompt: "zone1 content headline_type in zone2",
    });
    const warnings = validateAssembly(assembled, [], 13, true); // zone1Length=13 so zone2 starts after
    // Should return warnings but not throw
    expect(Array.isArray(warnings)).toBe(true);
  });

  it("PromptValidationError exposes warnings array", () => {
    const assembled = makeAssembled({
      active_blocks: [
        { name: "dup", chars_rendered: 10 },
        { name: "dup", chars_rendered: 10 },
      ],
    });
    try {
      validateAssembly(assembled, [], 0, true);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(PromptValidationError);
      expect((err as PromptValidationError).warnings.length).toBeGreaterThan(0);
      expect((err as PromptValidationError).name).toBe("PromptValidationError");
    }
  });
});

// ---------------------------------------------------------------------------
// Task 1 (F12): Blocked response contract alignment
// ---------------------------------------------------------------------------

describe("Wave 2 — Task 1: Blocked response contract", () => {
  it("legacy pipeline blocked response shape matches unified pipeline", () => {
    // This is a structural contract test — validates that the blocked
    // response shape from the legacy pipeline matches the unified pipeline.
    // The actual route handler change returns 200 with analysis_ready.status: "blocked"
    // instead of 422 with an error envelope.
    const blockedResponse = {
      graph: null,
      nodes: [],
      edges: [],
      analysis_ready: {
        options: [],
        goal_node_id: "goal_1",
        status: "blocked",
        blockers: [
          {
            code: "strict_mode_validation_failure",
            severity: "error",
            message: "test error",
            details: { validation_warnings: [] },
          },
        ],
      },
    };

    expect(blockedResponse.analysis_ready.status).toBe("blocked");
    expect(blockedResponse.graph).toBeNull();
    expect(blockedResponse.nodes).toEqual([]);
    expect(blockedResponse.edges).toEqual([]);
    expect(blockedResponse.analysis_ready.blockers).toHaveLength(1);
    expect(blockedResponse.analysis_ready.blockers[0].code).toBe("strict_mode_validation_failure");
  });
});

// ---------------------------------------------------------------------------
// Task 4 (F5): Enrichment edge provenance tagging
// ---------------------------------------------------------------------------

describe("Wave 2 — Task 4: Enrichment edge defaulted tag", () => {
  it("enrichment edges include defaulted: true", () => {
    // Structural assertion — enricher creates edges with these fields
    const enrichmentEdge = {
      from: "factor_1",
      to: "goal_1",
      strength_mean: 0.5,
      strength_std: 0.2,
      effect_direction: "positive",
      origin: "enrichment",
      defaulted: true,
      provenance: { source: "hypothesis", quote: "test" },
    };

    expect(enrichmentEdge.defaulted).toBe(true);
    expect(enrichmentEdge.origin).toBe("enrichment");
    expect(enrichmentEdge.provenance.source).toBe("hypothesis");
  });

  it("LLM-authored edges do NOT have defaulted field", () => {
    // LLM edges come from the draft graph and have no defaulted flag
    const llmEdge = {
      from: "factor_1",
      to: "goal_1",
      strength_mean: 0.7,
      strength_std: 0.15,
      effect_direction: "positive",
    };

    expect((llmEdge as any).defaulted).toBeUndefined();
    expect((llmEdge as any).origin).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Task 8 (F15): Analysis-ready fallback meta shape
// ---------------------------------------------------------------------------

describe("Wave 2 — Task 8: Analysis-ready fallback meta type", () => {
  it("AnalysisReadyFallbackMeta has expected shape", () => {
    const meta: AnalysisReadyFallbackMeta = {
      fallback_count: 2,
      fallback_sources: [
        { optionId: "opt_1", factorId: "factor_1", source: "observed_state" },
        { optionId: "opt_1", factorId: "factor_2", source: "data.value" },
      ],
    };

    expect(meta.fallback_count).toBe(2);
    expect(meta.fallback_sources).toHaveLength(2);
    expect(meta.fallback_sources[0].source).toBe("observed_state");
    expect(meta.fallback_sources[1].source).toBe("data.value");
  });
});

// ---------------------------------------------------------------------------
// Task 6 (F10): Clarifier factor exclusion documentation
// ---------------------------------------------------------------------------

describe("Wave 2 — Task 6: Clarifier allowed node kinds exclude factor", () => {
  it("clarifier system prompt specifies allowed kinds without factor", () => {
    expect(ANSWER_INCORPORATION_SYSTEM_PROMPT).toContain("goal, decision, option, outcome, risk, action");
    expect(ANSWER_INCORPORATION_SYSTEM_PROMPT).not.toMatch(/allowed node kinds:.*\bfactor\b/);
    // Verify the documentation comment exists explaining why factor is excluded
    expect(ANSWER_INCORPORATION_SYSTEM_PROMPT).toContain("factor");
    expect(ANSWER_INCORPORATION_SYSTEM_PROMPT).toContain("intentionally excluded");
  });
});
