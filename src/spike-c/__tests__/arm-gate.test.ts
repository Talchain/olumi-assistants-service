/**
 * SPIKE ARM C — the arm gate.
 *
 * ⚠ THROWAWAY. Spike branch only.
 *
 * ── ⭐ WHY THIS FILE IS THE MOST IMPORTANT ONE IN THE ARM ──────────────────
 * Arm A is the control, and §2 says all three arms run from the SAME base with
 * the SAME capture instrument, differing only in "the named intervention".
 * `spike/arm-c-records` is the branch arm C runs from — but arm A runs from
 * `spike/capture-common`, which shares this lineage. If ANY arm-C code executed
 * with `SPIKE_ARM` unset, the control would silently carry part of the
 * treatment and the whole comparison would be invalid — while every test in
 * the suite stayed green, because nothing else asserts the off-path.
 *
 * That is the failure this file exists to prevent, and it is why the gate is
 * asserted in BOTH directions: OFF must be inert, and ON must actually bite.
 * An off-path assertion alone would pass on a gate that is stuck off (arm C
 * never runs, and the arm-C runs would silently be arm-A runs — the more
 * dangerous direction, because the arm would report a null result rather than
 * an obvious failure).
 */

import { afterEach, describe, expect, it } from "vitest";
import { isSpikeArmC, spikeCPreRegistration, SPIKE_C_SYSTEM_APPENDIX } from "../arm.js";

const ORIGINAL = process.env.SPIKE_ARM;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.SPIKE_ARM;
  else process.env.SPIKE_ARM = ORIGINAL;
});

describe("the arm gate reads the env per call, in both directions", () => {
  it("is OFF when SPIKE_ARM is absent — the status-quo default", () => {
    delete process.env.SPIKE_ARM;
    expect(isSpikeArmC()).toBe(false);
  });

  it("is ON only for exactly `C`", () => {
    process.env.SPIKE_ARM = "C";
    expect(isSpikeArmC()).toBe(true);
  });

  it("is OFF for every other value, including near-misses", () => {
    for (const v of ["", "A", "B", "c", "C ", " C", "CC", "true", "1"]) {
      process.env.SPIKE_ARM = v;
      expect(isSpikeArmC(), `SPIKE_ARM=${JSON.stringify(v)} must not arm the spike`).toBe(false);
    }
  });

  it("is NOT captured at module load — flipping the env flips the answer", () => {
    // A module-level `const armed = process.env.SPIKE_ARM === "C"` would freeze
    // the first read. That would make the arm untestable in-process AND make a
    // mid-session flip invisible, which §3 requires be detectable.
    delete process.env.SPIKE_ARM;
    expect(isSpikeArmC()).toBe(false);
    process.env.SPIKE_ARM = "C";
    expect(isSpikeArmC()).toBe(true);
    delete process.env.SPIKE_ARM;
    expect(isSpikeArmC()).toBe(false);
  });
});

describe("pre-registration stamps (§8) are stable and non-empty", () => {
  it("emits both hashes with real content", () => {
    const reg = spikeCPreRegistration();
    expect(reg.arm).toBe("C");
    expect(reg.appendix_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(reg.schema_sha256).toMatch(/^[0-9a-f]{64}$/);
    // Non-vacuity: hashes of empty strings are also 64 hex chars.
    expect(reg.appendix_bytes).toBeGreaterThan(500);
    expect(reg.schema_bytes).toBeGreaterThan(500);
  });

  it("the two hashes are DIFFERENT — they are hashing different artefacts", () => {
    const reg = spikeCPreRegistration();
    expect(reg.appendix_sha256).not.toBe(reg.schema_sha256);
  });

  it("hashes are stable across calls (they are what pins the frozen bytes)", () => {
    expect(spikeCPreRegistration()).toEqual(spikeCPreRegistration());
  });

  it("the appendix does not instruct the model to emit a graph", () => {
    // The one substantive claim about the appendix's content: it must redirect
    // the output shape. If this string were ever edited back toward graph
    // language the arm would silently stop being arm C.
    expect(SPIKE_C_SYSTEM_APPENDIX).toContain("Do not emit a graph");
    expect(SPIKE_C_SYSTEM_APPENDIX).toContain("stated_items");
    expect(SPIKE_C_SYSTEM_APPENDIX).toContain("claims");
  });

  it("the appendix instructs verbatim quoting and does NOT pressure for claims", () => {
    // F2 (zero false authorship) is the floor arm C defends. An appendix that
    // demanded inferences would manufacture exactly the defect being measured.
    expect(SPIKE_C_SYSTEM_APPENDIX).toContain("VERBATIM");
    expect(SPIKE_C_SYSTEM_APPENDIX).toContain("An empty `claims` list is a valid response.");
  });
});
