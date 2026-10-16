/**
 * Lane CEE-D (edit-loop reliability) — RED fixtures from the live LLM-path
 * failures two nights ago (Lane-3 Mission-D investigation), then GREEN.
 *
 * Defect cluster A — edit_graph response parsing:
 *
 *  A1. `extractJson` does greedy `/\{[\s\S]*\}/` object extraction with an
 *      UNGUARDED `JSON.parse` BEFORE the array fallback. A prose-wrapped
 *      legacy-array response with 2+ operations mis-extracts
 *      `{op1}, {op2}` (first `{` → last `}`), throws SyntaxError, and the
 *      array branch is never reached.
 *  A2. The same greedy extraction on a prose-wrapped SINGLE-operation
 *      legacy array successfully parses the first operation object, which
 *      then fails with the live error
 *      `v2 response missing required "operations" array`.
 *  A3. A bare single-operation object (no array, no envelope) fails with
 *      the same live error instead of being wrapped into
 *      `operations: [op]`.
 *  A4. `PatchOperationSchema` requires `value` for add/update ops but
 *      `normaliseOperation` never lifts inline / alternate-key payloads
 *      into `value` → live zod error `value — Required`.
 *  A5. The repair prompt embeds previous ops as a BARE ARRAY while the
 *      repair prompt mandates a `{ "operations": [...] }` object, and
 *      resets `lastRawOps` to `[]` on parse failures — priming repeat
 *      failures.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let patchPreValidationEnabledForTest = false;
let patchBudgetEnabledForTest = false;

vi.mock("../../../../src/adapters/llm/prompt-loader.js", () => ({
  getSystemPrompt: vi.fn().mockResolvedValue("You edit causal decision graphs"),
  getSystemPromptMeta: vi.fn().mockReturnValue({ source: 'default', prompt_version: 'v2' }),
  // The edit/review lanes resolve prompt bytes AND identity in ONE bound
  // `getSystemPromptSnapshot` call. A mock factory REPLACES the module, so
  // omitting this export hands the code under test `undefined` (trap 12).
  // Content and meta mirror the two mocks above deliberately: production
  // binds them to one resolution, and the mock must not model them as
  // independently divergent.
  getSystemPromptSnapshot: vi.fn().mockResolvedValue({
    content: "You edit causal decision graphs",
    meta: { source: 'default', prompt_version: 'v2' },
  }),
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
              if (ceeProp === "maxRepairRetries") return 1;
              if (ceeProp === "patchPreValidationEnabled") return patchPreValidationEnabledForTest;
              if (ceeProp === "patchBudgetEnabled") return patchBudgetEnabledForTest;
              return Reflect.get(ceeTarget, ceeProp);
            },
          });
        }
        return Reflect.get(target, prop);
      },
    }),
  };
});

import { parseEditGraphResponse } from "../../../../src/orchestrator/tools/edit-graph.js";

beforeEach(() => {
  patchPreValidationEnabledForTest = false;
  patchBudgetEnabledForTest = false;
});

const SINGLE_OP = {
  op: "update_node",
  path: "/nodes/factor_1/label",
  value: "Unit Price",
  old_value: "Price",
  impact: "low",
  rationale: "Rename for clarity",
};

const SECOND_OP = {
  op: "update_edge",
  path: "/edges/factor_1->out_1/strength.mean",
  value: 0.6,
  old_value: 0.5,
  impact: "low",
  rationale: "Stronger effect",
};

// ============================================================================
// A1 — prose-wrapped multi-op legacy array
// ============================================================================

describe("A1: prose-wrapped legacy array (multi-op)", () => {
  it("parses a legacy array wrapped in prose instead of throwing from the greedy object extraction", () => {
    const prose = [
      "Here are the operations to apply:",
      JSON.stringify([SINGLE_OP, SECOND_OP], null, 2),
      "Let me know if you need anything else.",
    ].join("\n");

    const result = parseEditGraphResponse(prose);
    expect(result.operations).toHaveLength(2);
    expect(result.operations[0]!.op).toBe("update_node");
    expect(result.operations[1]!.op).toBe("update_edge");
  });
});

// ============================================================================
// A2 — prose-wrapped single-op legacy array (live error:
//      'v2 response missing required "operations" array')
// ============================================================================

describe("A2: prose-wrapped legacy array (single op) — live 'missing operations array' repro", () => {
  it("recovers the single operation instead of failing with 'missing required \"operations\" array'", () => {
    const prose = [
      "I'll update the price factor as requested.",
      JSON.stringify([SINGLE_OP], null, 2),
      "This keeps the rest of the model unchanged.",
    ].join("\n");

    const result = parseEditGraphResponse(prose);
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0]!.op).toBe("update_node");
    // Field-level path is normalised and the scalar is wrapped for update ops.
    expect(result.operations[0]!.path).toBe("factor_1");
    expect(result.operations[0]!.value).toEqual({ label: "Unit Price" });
  });
});

// ============================================================================
// A3 — bare single-operation object
// ============================================================================

describe("A3: bare single-operation object", () => {
  it("wraps a bare single-op object into operations:[op]", () => {
    const result = parseEditGraphResponse(JSON.stringify(SINGLE_OP));
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0]!.op).toBe("update_node");
    expect(result.operations[0]!.value).toEqual({ label: "Unit Price" });
    // Safe coaching defaults (same contract as the legacy-array branch).
    expect(result.coaching).not.toBeNull();
    expect(result.coaching!.summary).toBe("Proposed graph edit.");
  });

  it("still rejects an object that is neither an envelope nor a patch operation", () => {
    expect(() => parseEditGraphResponse('{ "warnings": ["bad"] }')).toThrow("missing required");
  });
});

// ============================================================================
// A4 — alternate-key / inline payloads lifted into `value`
//      (live zod error: 'value — Required')
// ============================================================================

describe("A4: alternate-key and inline payloads lifted into value", () => {
  it("lifts a payload under new_value into value for update_node", () => {
    const response = {
      operations: [
        {
          op: "update_node",
          path: "/nodes/factor_1",
          new_value: { label: "Unit Price" },
          impact: "low",
          rationale: "Rename",
        },
      ],
      removed_edges: [],
      warnings: [],
      coaching: { summary: "Renamed the factor.", rerun_recommended: false },
    };
    const result = parseEditGraphResponse(JSON.stringify(response));
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0]!.value).toEqual({ label: "Unit Price" });
  });

  it("lifts an inline top-level payload into value for add_node", () => {
    const response = {
      operations: [
        {
          op: "add_node",
          path: "/nodes/fac_y",
          id: "fac_y",
          kind: "factor",
          label: "Yield",
          category: "external",
          impact: "moderate",
          rationale: "Adds yield factor",
        },
      ],
      removed_edges: [],
      warnings: [],
      coaching: { summary: "Added a factor.", rerun_recommended: true },
    };
    const result = parseEditGraphResponse(JSON.stringify(response));
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0]!.value).toEqual({
      id: "fac_y",
      kind: "factor",
      label: "Yield",
      category: "external",
    });
    // impact/rationale stay op-level metadata, not payload.
    expect((result.operations[0] as { impact?: string }).impact).toBe("moderate");
  });

  it("does NOT lift when two alternate keys are present (ambiguous)", () => {
    const response = {
      operations: [
        {
          op: "update_node",
          path: "/nodes/factor_1",
          new_value: { label: "A" },
          data: { label: "B" },
        },
      ],
    };
    const result = parseEditGraphResponse(JSON.stringify(response));
    expect(result.operations[0]!.value).toBeUndefined();
  });

  it("leaves ops that legitimately omit value untouched (remove_edge)", () => {
    const response = {
      operations: [
        { op: "remove_edge", path: "/edges/factor_1->out_1", impact: "low", rationale: "Remove" },
      ],
    };
    const result = parseEditGraphResponse(JSON.stringify(response));
    expect(result.operations[0]!.value).toBeUndefined();
  });
});
