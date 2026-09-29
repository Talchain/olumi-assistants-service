/**
 * Lane F (2026-07-23) — boot fail-loud assert for the resolved draft model
 * (DRAFTING-COMPONENT-DESIGN Q4 D10, derive-don't-mirror). The assert reads the
 * model registry directly; it must FIRE (return an error) on an unregistered or
 * disabled draft model and stay SILENT on a registered+enabled one. Positive +
 * negative controls so the assert genuinely discriminates (not vacuously green).
 */

import { describe, it, expect } from "vitest";
import { validateDraftModelRegistered } from "../../src/config/models.js";

describe("validateDraftModelRegistered (Lane F boot assert)", () => {
  it("is SILENT for a registered, enabled draft model (positive control)", () => {
    // claude-sonnet-4-6 is the live default draft model and is enabled.
    expect(validateDraftModelRegistered("claude-sonnet-4-6")).toEqual([]);
  });

  it("FIRES for a model that is not in the registry (typo / retired id)", () => {
    const errors = validateDraftModelRegistered("claude-sonnet-does-not-exist");
    expect(errors.length).toBe(1);
    expect(errors[0]).toMatch(/neither an enabled registry id nor an explicit alias/);
    expect(errors[0]).toContain("claude-sonnet-does-not-exist");
  });

  it("FIRES for a registered-but-DISABLED model", () => {
    // test-disabled-model is present in the registry with enabled:false.
    const errors = validateDraftModelRegistered("test-disabled-model");
    expect(errors.length).toBe(1);
    expect(errors[0]).toMatch(/DISABLED/);
  });

  it("FIRES for an empty / missing resolution (no draft model configured)", () => {
    expect(validateDraftModelRegistered(null)[0]).toMatch(/empty/);
    expect(validateDraftModelRegistered(undefined)[0]).toMatch(/empty/);
    expect(validateDraftModelRegistered("")[0]).toMatch(/empty/);
  });
});
