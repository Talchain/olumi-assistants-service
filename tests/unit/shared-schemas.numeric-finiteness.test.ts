/**
 * W2E-2 — finiteness enforcement on LLM draft/repair graph output (path b:
 * LLM structured output → LLMDraftResponse / LLMRepairResponse Zod parse).
 *
 * The draft schemas already enforce/repair the contract-declared ranges
 * (exists_probability [0,1] rejects; strength mean clamp / std floor is the
 * long-standing defence-in-depth convention mirrored by PLoT — unchanged
 * here). The remaining gap is NON-FINITE numbers: Zod's z.number() rejects
 * NaN but accepts Infinity, so `weight: Infinity` or
 * `goal_threshold: Infinity` sailed through to the pipeline.
 *
 * A parse failure here throws `*_response_invalid_schema` in the adapter,
 * which rides the existing retry convention — no silent drop, no clamp for
 * contract-silent fields.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  LLMDraftResponse,
  LLMRepairResponse,
} from "../../src/adapters/llm/shared-schemas.js";
import { log } from "../../src/utils/telemetry.js";

const VALID_DRAFT = {
  nodes: [
    { id: "goal_1", kind: "goal", label: "Goal" },
    {
      id: "fac_1",
      kind: "factor",
      label: "Factor",
      category: "observable",
      data: { value: 0.4, baseline: 0.4 },
    },
  ],
  edges: [
    {
      from: "fac_1",
      to: "goal_1",
      strength: { mean: 0.6, std: 0.2 },
      exists_probability: 0.9,
    },
  ],
};

describe("LLM draft/repair response numeric finiteness (W2E-2)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(log, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("rejects an edge with Infinity weight (legacy field, contract-silent → finite only)", () => {
    const draft = {
      ...VALID_DRAFT,
      edges: [{ ...VALID_DRAFT.edges[0], weight: Number.POSITIVE_INFINITY }],
    };
    const result = LLMDraftResponse.safeParse(draft);
    expect(result.success).toBe(false);
  });

  it("rejects an edge with Infinity belief_exists", () => {
    const draft = {
      ...VALID_DRAFT,
      edges: [{ ...VALID_DRAFT.edges[0], belief_exists: Number.POSITIVE_INFINITY }],
    };
    expect(LLMDraftResponse.safeParse(draft).success).toBe(false);
  });

  it("rejects a node with Infinity goal_threshold (Infinity value)", () => {
    const draft = {
      ...VALID_DRAFT,
      nodes: [
        { ...VALID_DRAFT.nodes[0], goal_threshold: Number.POSITIVE_INFINITY },
        VALID_DRAFT.nodes[1],
      ],
    };
    expect(LLMDraftResponse.safeParse(draft).success).toBe(false);
  });

  it("rejects a node with -Infinity inside a passthrough data field", () => {
    const draft = {
      ...VALID_DRAFT,
      nodes: [
        VALID_DRAFT.nodes[0],
        {
          ...VALID_DRAFT.nodes[1],
          data: { value: 0.4, baseline: Number.NEGATIVE_INFINITY },
        },
      ],
    };
    expect(LLMDraftResponse.safeParse(draft).success).toBe(false);
  });

  it("rejects a repair response carrying non-finite numbers", () => {
    const repair = {
      ...VALID_DRAFT,
      nodes: [
        { ...VALID_DRAFT.nodes[0], goal_threshold_raw: Number.POSITIVE_INFINITY },
        VALID_DRAFT.nodes[1],
      ],
      rationales: [],
    };
    expect(LLMRepairResponse.safeParse(repair).success).toBe(false);
  });

  it("does not echo raw offending values or labels in the Zod issues (PII invariant)", () => {
    const draft = {
      ...VALID_DRAFT,
      nodes: [
        { ...VALID_DRAFT.nodes[0], label: "SensitiveGoalLabel", goal_threshold: Number.POSITIVE_INFINITY },
        VALID_DRAFT.nodes[1],
      ],
    };
    const result = LLMDraftResponse.safeParse(draft);
    expect(result.success).toBe(false);
    if (!result.success) {
      const serialised = JSON.stringify(result.error.issues);
      expect(serialised).not.toContain("SensitiveGoalLabel");
    }
  });

  // ── Regression: valid drafts are untouched ────────────────────────────────

  it("accepts a valid draft and round-trips it byte-identically", () => {
    const result = LLMDraftResponse.safeParse(VALID_DRAFT);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(JSON.stringify(result.data)).toBe(JSON.stringify(VALID_DRAFT));
    }
  });

  it("keeps the existing clamp/floor convention for strength fields (unchanged behaviour)", () => {
    // Contract-declared range with an established repair convention:
    // out-of-range strength.mean clamps (with warn), std floors — NOT a reject.
    const draft = {
      ...VALID_DRAFT,
      edges: [
        {
          from: "fac_1",
          to: "goal_1",
          strength: { mean: 1.5, std: 0 },
          exists_probability: 0.9,
        },
      ],
    };
    const result = LLMDraftResponse.safeParse(draft);
    expect(result.success).toBe(true);
    if (result.success) {
      const edge = (result.data.edges as Array<{ strength?: { mean: number; std: number } }>)[0];
      expect(edge.strength?.mean).toBe(1);
      expect(edge.strength?.std).toBeGreaterThan(0);
    }
  });

  it("still rejects out-of-range exists_probability (already-enforced contract range)", () => {
    const draft = {
      ...VALID_DRAFT,
      edges: [{ ...VALID_DRAFT.edges[0], exists_probability: 1.4 }],
    };
    expect(LLMDraftResponse.safeParse(draft).success).toBe(false);
  });
});
