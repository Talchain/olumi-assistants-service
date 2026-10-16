/**
 * Tier A #1 (edit-reliability, 2026-07-09) — FIX 1: structured-output
 * enforcement for edit_graph.
 *
 * Live-reproduced defect (4x, 9 Jul, acceptance-evidence/edit-lane-conversation/):
 * the free-form edit LLM returns PROSE instead of a JSON operations array on
 * ~50% of live attempts. edit_graph had structured outputs (Anthropic
 * grammar enforcement) DISABLED entirely (commit 24ddf9d8f) because
 * operations[].value carries arbitrary patch payloads that cannot be
 * represented as a closed schema — with additionalProperties:false and no
 * declared slot for `value`/`old_value`, the LLM was structurally forbidden
 * from ever emitting them.
 *
 * FIX: apply Lane 26's (PR #367) verified v8 stringified-aux-field trick —
 * declare `value`/`old_value` as `{ type: "string" }` JSON-encoded fields.
 * The grammar can now enforce the FULL envelope shape (eliminating the
 * prose failure mode structurally, not by out-parsing prose after the
 * fact), while `parseStringifiedOperationPayload()` unwraps the JSON string
 * back into its real shape before Zod/PLoT ever see it.
 *
 * RED (pre-fix): `editGraphOutputSchema` was hardcoded to `undefined` —
 * `adapter.chat` never received `outputSchema`, so the model had no
 * grammar-level guarantee against a prose response. These tests fail
 * against the pre-fix code (asserting outputSchema is undefined) and pass
 * post-fix.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

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

let patchPreValidationEnabledForTest = false;
let patchBudgetEnabledForTest = false;

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

import { parseStringifiedOperationPayload } from "../../../../src/orchestrator/tools/edit-graph.js";

beforeEach(() => {
  patchPreValidationEnabledForTest = false;
  patchBudgetEnabledForTest = false;
});

// ============================================================================
// parseStringifiedOperationPayload — unit coverage
// ============================================================================

describe("parseStringifiedOperationPayload", () => {
  it("parses a JSON-encoded object string into a real object", () => {
    const raw = { op: "add_node", path: "/nodes/x", value: JSON.stringify({ id: "x", kind: "factor", label: "X" }) };
    const result = parseStringifiedOperationPayload(raw);
    expect(result.value).toEqual({ id: "x", kind: "factor", label: "X" });
  });

  it("parses a JSON-encoded scalar string into the real scalar", () => {
    const raw = { op: "update_node", path: "/nodes/x/label", value: JSON.stringify(0.8) };
    const result = parseStringifiedOperationPayload(raw);
    expect(result.value).toBe(0.8);
  });

  it("does NOT re-parse a legitimate string scalar end-value (no double-unwrap)", () => {
    // A single JSON-encoding pass of the string "Unit Price" parses to the
    // plain string "Unit Price" — this must NOT be treated as evidence of
    // double-encoding and re-parsed (that would throw on ordinary text).
    const raw = { op: "update_node", path: "/nodes/x/label", value: JSON.stringify("Unit Price") };
    const result = parseStringifiedOperationPayload(raw);
    expect(result.value).toBe("Unit Price");
  });

  it("leaves a malformed object-looking JSON string untouched (does not crash, does not drop)", () => {
    const raw = { op: "add_node", path: "/nodes/x", value: "{not valid json" };
    const result = parseStringifiedOperationPayload(raw);
    // Left exactly as received — Zod rejects the wrong-shaped string
    // downstream (add_node needs an object) and drives the repair loop,
    // same as today's behaviour for any malformed value.
    expect(result.value).toBe("{not valid json");
  });

  it("leaves a bare (non-JSON) scalar string untouched — the prompt-only path's convention", () => {
    // This is the DOMINANT existing case: on the prompt-only fallback path
    // the LLM emits the real scalar directly (e.g. renaming a label to
    // "New"), never JSON-encoded. `JSON.parse("New")` throws — the field
    // MUST be preserved unchanged, or every ordinary label/value update on
    // the prompt-only path would silently lose its value.
    const raw = { op: "update_node", path: "/nodes/x/label", value: "New", old_value: "Old" };
    const result = parseStringifiedOperationPayload(raw);
    expect(result.value).toBe("New");
    expect(result.old_value).toBe("Old");
  });

  it("leaves an already-object value untouched (prompt-only fallback path)", () => {
    const raw = { op: "add_node", path: "/nodes/x", value: { id: "x", kind: "factor", label: "X" } };
    const result = parseStringifiedOperationPayload(raw);
    expect(result.value).toEqual({ id: "x", kind: "factor", label: "X" });
  });

  it("is a no-op when neither value nor old_value is a string", () => {
    const raw = { op: "remove_node", path: "/nodes/x" };
    const result = parseStringifiedOperationPayload(raw);
    expect(result).toEqual(raw);
  });
});
