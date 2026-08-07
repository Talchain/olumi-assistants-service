/**
 * Extended registry drift guard (ROADMAP 1.185(a), rec-2 — model-routing
 * consolidation). The Lane-F draft assert (validateDraftModelRegistered) is
 * generalised to cover EVERY checked-in default model id — all
 * TASK_MODEL_DEFAULTS values plus the two router-bypass defaults
 * (rolling-summary, decision-review decompose). An unregistered or disabled id
 * ANYWHERE surfaces as a boot ERROR (derive-don't-mirror backstop, DRAFTING-
 * COMPONENT-DESIGN Q4 D10 / MODEL-ROUTING-POLICY D10).
 *
 * Positive AND negative controls so the guard genuinely discriminates (never
 * vacuously green — CLAUDE.md trap-13).
 */

import { describe, it, expect } from "vitest";
import {
  validateModelRegistered,
  validateModelsRegistered,
  validateDraftModelRegistered,
} from "../../src/config/models.js";
import { TASK_MODEL_DEFAULTS } from "../../src/config/model-routing.js";
import { DEFAULT_SUMMARY_MODEL } from "../../src/orchestrator-v5/rolling-summary/summary-types.js";
import { DEFAULT_DECOMPOSE_MODEL } from "../../src/cee/decision-review/decompose.js";

/** The exact set the server validates at boot — DERIVED from the real sources
 *  (not a hand-copied list), so a new default with a bad id trips the guard. */
function bootModelDefaults(): Array<{ label: string; modelId: string | null | undefined }> {
  return [
    ...Object.entries(TASK_MODEL_DEFAULTS).map(([task, modelId]) => ({
      label: `task_default:${task}`,
      modelId,
    })),
    { label: "rolling_summary_default", modelId: DEFAULT_SUMMARY_MODEL },
    { label: "decision_review_decompose_default", modelId: DEFAULT_DECOMPOSE_MODEL },
  ];
}

describe("validateModelRegistered (single-model core check)", () => {
  it("is SILENT for a registered, enabled model (positive control)", () => {
    expect(validateModelRegistered("orchestrator", "claude-sonnet-5")).toEqual([]);
  });

  it("FIRES for an unregistered id and names the call site + id", () => {
    const errors = validateModelRegistered("some_task", "model-does-not-exist");
    expect(errors.length).toBe(1);
    expect(errors[0]).toMatch(/NOT in the model registry/);
    expect(errors[0]).toContain("model-does-not-exist");
    expect(errors[0]).toContain("some_task");
  });

  it("FIRES for a registered-but-DISABLED id", () => {
    const errors = validateModelRegistered("x", "test-disabled-model");
    expect(errors.length).toBe(1);
    expect(errors[0]).toMatch(/DISABLED/);
  });

  it("FIRES for an empty / missing id", () => {
    expect(validateModelRegistered("x", null)[0]).toMatch(/empty/);
    expect(validateModelRegistered("x", undefined)[0]).toMatch(/empty/);
    expect(validateModelRegistered("x", "")[0]).toMatch(/empty/);
  });
});

describe("validateModelsRegistered (extended drift guard — the boot batch)", () => {
  it("is SILENT when EVERY checked-in default is registered + enabled (the real boot set)", () => {
    // This is the guard's job: prove the whole default map — including the m2
    // opus-4-8 default and the two bypass haiku defaults — is registry-clean.
    // Goes RED if any default (e.g. an unregistered claude-opus-4-8) drifts.
    expect(validateModelsRegistered(bootModelDefaults())).toEqual([]);
  });

  it("FIRES for a single unregistered id anywhere in a batch (drift positive control)", () => {
    const errors = validateModelsRegistered([
      { label: "task_default:orchestrator", modelId: "claude-sonnet-5" }, // ok
      { label: "task_default:rogue", modelId: "unregistered-model-x" },   // drift
    ]);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("unregistered-model-x");
    expect(errors[0]).toContain("rogue");
  });

  it("collects MULTIPLE drift errors across the batch", () => {
    const errors = validateModelsRegistered([
      { label: "a", modelId: "nope-1" },
      { label: "b", modelId: "claude-sonnet-5" }, // ok
      { label: "c", modelId: "test-disabled-model" },
    ]);
    expect(errors.length).toBe(2);
  });
});

describe("validateDraftModelRegistered still delegates (Lane-F back-compat)", () => {
  it("is SILENT for the live draft model", () => {
    expect(validateDraftModelRegistered("claude-sonnet-4-6")).toEqual([]);
  });
  it("FIRES for an unregistered draft model", () => {
    expect(validateDraftModelRegistered("claude-sonnet-does-not-exist")[0]).toMatch(
      /NOT in the model registry/,
    );
  });
});
