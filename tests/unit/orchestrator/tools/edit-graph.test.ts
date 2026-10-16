import { describe, it, expect, vi } from "vitest";

// ============================================================================
// Mocks — must be declared before imports
// ============================================================================

vi.mock("../../../../src/adapters/llm/prompt-loader.js", () => ({
  getSystemPrompt: vi.fn().mockResolvedValue("You are editing a graph."),
  // The edit/review lanes resolve prompt bytes AND identity in ONE bound
  // `getSystemPromptSnapshot` call. A mock factory REPLACES the module, so
  // omitting this export hands the code under test `undefined` (trap 12).
  // Content and meta mirror the two mocks above deliberately: production
  // binds them to one resolution, and the mock must not model them as
  // independently divergent.
  getSystemPromptSnapshot: vi.fn().mockResolvedValue({
    content: "You are editing a graph.",
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
              // Disable cf-v11.1 pre-validation for legacy tests (tested separately in patch-budget/validator tests).
              // V5 H5 follow-up decoupled `candidateGraph` computation
              // from `patchPreValidationEnabled`, so the V4 success
              // branch can still synthesise `appliedGraph` from the
              // candidate even when validation is disabled here.
              if (ceeProp === "patchPreValidationEnabled") return false;
              if (ceeProp === "patchBudgetEnabled") return false;
              // CEE_EDIT_CAP_SPLIT went DEFAULT-ON 18 Jul (Paul-ratified). This
              // legacy suite asserts the BARE whole-batch MAX_OPERATIONS_EXCEEDED
              // dead-end, so it pins the split flag OFF (the kill-switch path).
              // The default-ON split behaviour is covered by
              // trust-spine-red-edit-cap-split.test.ts.
              if (ceeProp === "editCapSplitEnabled") return false;
              return Reflect.get(ceeTarget, ceeProp);
            },
          });
        }
        return Reflect.get(target, prop);
      },
    }),
  };
});

import { mapOpsForPlot, determineEditResolutionMode } from "../../../../src/orchestrator/tools/edit-graph.js";
import type { EditTargetResolutionResult } from "../../../../src/orchestrator/tools/edit-graph.js";
import type { ConversationContext, PatchOperation } from "../../../../src/orchestrator/types.js";

// ============================================================================
// Helpers
// ============================================================================

function makeContext(overrides?: Partial<ConversationContext>): ConversationContext {
  return {
    graph: {
      nodes: [
        { id: "goal_1", kind: "goal", label: "Revenue" },
        { id: "factor_1", kind: "factor", label: "Price" },
      ],
      edges: [
        {
          from: "factor_1",
          to: "goal_1",
          strength: { mean: 0.5, std: 0.1 },
          exists_probability: 0.9,
          effect_direction: "positive",
        },
      ],
    } as unknown as ConversationContext["graph"],
    analysis_response: null,
    framing: null,
    messages: [],
    scenario_id: "test-scenario",
    ...overrides,
  };
}

// ============================================================================
// mapOpsForPlot — edge path format conversion (Issue 4)
// ============================================================================

describe("mapOpsForPlot", () => {
  it("converts from::to edge paths to from->to for PLoT", () => {
    const ops: PatchOperation[] = [
      { op: "add_edge", path: "price_1::churn_5", value: { from: "price_1", to: "churn_5", strength: { mean: 0.5, std: 0.1 } } },
      { op: "remove_edge", path: "rev_2::cost_3", old_value: {} },
    ];
    const mapped = mapOpsForPlot(ops);
    expect(mapped[0].path).toBe("price_1->churn_5");
    expect(mapped[1].path).toBe("rev_2->cost_3");
  });

  it("preserves node-only paths unchanged", () => {
    const ops: PatchOperation[] = [
      { op: "add_node", path: "factor_new", value: { id: "factor_new", kind: "factor", label: "New" } },
      { op: "remove_node", path: "opt_old", old_value: {} },
    ];
    const mapped = mapOpsForPlot(ops);
    expect(mapped[0].path).toBe("factor_new");
    expect(mapped[1].path).toBe("opt_old");
  });

  it("does not convert :: in node paths even if present (defensive)", () => {
    // Node IDs should never contain :: (canonical regex collapses them),
    // but guard against corruption if they somehow do.
    const ops: PatchOperation[] = [
      { op: "update_node", path: "some::id", value: { label: "X" } },
    ];
    const mapped = mapOpsForPlot(ops);
    expect(mapped[0].path).toBe("some::id");
  });

  it("maps old_value to previous for PLoT field naming", () => {
    const ops: PatchOperation[] = [
      { op: "update_edge", path: "a::b", value: 0.8, old_value: 0.5 },
    ];
    const mapped = mapOpsForPlot(ops);
    expect(mapped[0].previous).toBe(0.5);
    expect(mapped[0].value).toBe(0.8);
    expect((mapped[0] as Record<string, unknown>).old_value).toBeUndefined();
  });
});

// ============================================================================
// H6 — label-aware compound-edit detection
//
// Failure shape on staging (PR #167 follow-up, 5/8 replays):
//   Step 1's LLM-drafted graph sometimes contains a factor whose label
//   includes "and", "also", "then", or a comma (e.g. "Headcount and
//   Scaling Spend"). The replay harness injects that label into Step 2's
//   message: "Edit the model: make Headcount and Scaling Spend more
//   important." `resolveEditTarget` correctly returns
//   confidence='high' + single resolved_target, but the old
//   `isCompoundEditRequest` returned true because the description
//   contained "and" — and the deciding gate at line 678-684 routed to
//   `propose_and_confirm` (Mode A), producing
//   "I have changes in mind for **Headcount and Scaling Spend** and
//   **Scaling Spend more important.**"
//
// Fix: strip the resolved label from the description before testing for
// compound-edit separators. Only applies when confidence='high' AND
// resolved_target is non-null (non-ambiguous match_type is already
// routed at line 664).
// ============================================================================

describe("H6 — determineEditResolutionMode label-aware compound detection", () => {
  function makeResolution(overrides: Partial<EditTargetResolutionResult> = {}): EditTargetResolutionResult {
    return {
      match_type: 'exact_label',
      resolved_target: { id: 'fac_test', label: 'Test Factor', type: 'factor' },
      confidence: 'high',
      alternatives: [],
      candidate_labels: ['Test Factor'],
      ...overrides,
    };
  }

  it("single-target label with 'and' → auto_apply", () => {
    const mode = determineEditResolutionMode(
      "make Headcount and Scaling Spend more important",
      makeContext(),
      'parameter_update',
      makeResolution({
        resolved_target: { id: 'fac_h', label: 'Headcount and Scaling Spend', type: 'factor' },
        candidate_labels: ['Headcount and Scaling Spend'],
      }),
    );
    expect(mode).toBe('auto_apply');
  });

  it("single-target label with comma → auto_apply", () => {
    const mode = determineEditResolutionMode(
      "make Capacity, Quality more important",
      makeContext(),
      'parameter_update',
      makeResolution({
        resolved_target: { id: 'fac_cq', label: 'Capacity, Quality', type: 'factor' },
        candidate_labels: ['Capacity, Quality'],
      }),
    );
    expect(mode).toBe('auto_apply');
  });

  it("single-target label with 'also' → auto_apply", () => {
    const mode = determineEditResolutionMode(
      "make Hiring also Scaling more important",
      makeContext(),
      'parameter_update',
      makeResolution({
        resolved_target: { id: 'fac_hs', label: 'Hiring also Scaling', type: 'factor' },
        candidate_labels: ['Hiring also Scaling'],
      }),
    );
    expect(mode).toBe('auto_apply');
  });

  it("single-target label with 'then' → auto_apply", () => {
    const mode = determineEditResolutionMode(
      "make Capacity then Quality more important",
      makeContext(),
      'parameter_update',
      makeResolution({
        resolved_target: { id: 'fac_cq', label: 'Capacity then Quality', type: 'factor' },
        candidate_labels: ['Capacity then Quality'],
      }),
    );
    expect(mode).toBe('auto_apply');
  });

  it("label with regex metacharacters does not corrupt the strip", () => {
    // Defensive: a factor named with regex specials must be escaped before
    // being plugged into a literal-strip RegExp.
    const mode = determineEditResolutionMode(
      "make Throughput (per hour) more important",
      makeContext(),
      'parameter_update',
      makeResolution({
        resolved_target: { id: 'fac_t', label: 'Throughput (per hour)', type: 'factor' },
        candidate_labels: ['Throughput (per hour)'],
      }),
    );
    expect(mode).toBe('auto_apply');
  });

  it("case-insensitive label strip", () => {
    // User typed the label in different case than the canonical label.
    const mode = determineEditResolutionMode(
      "make HEADCOUNT AND SCALING SPEND more important",
      makeContext(),
      'parameter_update',
      makeResolution({
        resolved_target: { id: 'fac_h', label: 'Headcount and Scaling Spend', type: 'factor' },
        candidate_labels: ['Headcount and Scaling Spend'],
      }),
    );
    expect(mode).toBe('auto_apply');
  });

  it("genuine compound edit preserved (and outside the resolved label) → propose_and_confirm", () => {
    // The resolved label is `Headcount and Scaling Spend`, but the
    // description also asks to edit a second target after the label.
    // Stripping the label leaves "make  more important and Hiring Pace
    // less important" — still contains a real "and" → compound → Mode A.
    const mode = determineEditResolutionMode(
      "make Headcount and Scaling Spend more important and Hiring Pace less important",
      makeContext(),
      'parameter_update',
      makeResolution({
        resolved_target: { id: 'fac_h', label: 'Headcount and Scaling Spend', type: 'factor' },
        candidate_labels: ['Headcount and Scaling Spend'],
      }),
    );
    expect(mode).toBe('propose_and_confirm');
  });

  it("genuine compound edit preserved with 'also' connector outside label", () => {
    const mode = determineEditResolutionMode(
      "make Hiring also Scaling more important and Delivery Capacity less risky",
      makeContext(),
      'parameter_update',
      makeResolution({
        resolved_target: { id: 'fac_hs', label: 'Hiring also Scaling', type: 'factor' },
        candidate_labels: ['Hiring also Scaling'],
      }),
    );
    expect(mode).toBe('propose_and_confirm');
  });

  it("low-confidence + parameter_update → propose_and_confirm (unchanged)", () => {
    const mode = determineEditResolutionMode(
      "make X more important",
      makeContext(),
      'parameter_update',
      makeResolution({
        match_type: 'none',
        resolved_target: null,
        confidence: 'low',
        candidate_labels: [],
      }),
    );
    expect(mode).toBe('propose_and_confirm');
  });

  it("ambiguous match → clarify (unchanged; routed before compound check)", () => {
    const mode = determineEditResolutionMode(
      "make Headcount more important",
      makeContext(),
      'parameter_update',
      makeResolution({
        match_type: 'ambiguous',
        resolved_target: null,
        confidence: 'medium',
        candidate_labels: ['Headcount Investment', 'Headcount Cost'],
        alternatives: [
          { id: 'fac_hi', label: 'Headcount Investment' },
          { id: 'fac_hc', label: 'Headcount Cost' },
        ],
      }),
    );
    expect(mode).toBe('clarify');
  });
});
