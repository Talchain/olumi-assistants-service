/**
 * F3 (Codex deep-review) — ONE boot-resolved graph-CAS capability.
 *
 * The defect: `CEE_V5_GRAPH_CAS_MODE` (app hook) and `CEE_V5_GRAPH_CAS_RPC`
 * (atomic RPC) were orthogonal, so `RPC=enforce` + `MODE=off` deployed happily
 * while callers derived NO expected hash → the enforcing RPC received a NULL
 * expected → the DB update fell through to UNCONDITIONAL (enforcement theatre).
 *
 * The fix resolves both into one capability at parse and BOOT-REJECTS the
 * foot-gun combo at startup (validateConfig). Staging runs MODE=observe +
 * RPC=enforce, which MUST pass (the REFUTE gate).
 *
 * RED-first: the boot-reject assertions FAIL against the pre-fix tree (no
 * `assertGraphCasCapabilityValid`, no `validateConfig` boot check — the
 * foot-gun combo booted silently).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  config,
  _resetConfigCache,
  validateConfig,
  resolveGraphCasCapability,
  assertGraphCasCapabilityValid,
} from "../../src/config/index.js";

describe("resolveGraphCasCapability — pure config matrix", () => {
  it("off/off (defaults) → no enforcement, no expected hash required", () => {
    const cap = resolveGraphCasCapability("off", "off");
    expect(cap).toEqual({
      appMode: "off",
      rpcMode: "off",
      rpcEnforce: false,
      requiresExpectedHash: false,
    });
  });

  it("off/shadow (the shipped default) → stamps only, no expected hash required", () => {
    const cap = resolveGraphCasCapability("off", "shadow");
    expect(cap.rpcEnforce).toBe(false);
    expect(cap.requiresExpectedHash).toBe(false);
  });

  it("observe/shadow → app hook derives an expected base", () => {
    expect(resolveGraphCasCapability("observe", "shadow").requiresExpectedHash).toBe(true);
  });

  it("observe/enforce (the LIVE STAGING posture) → enforcing AND derives", () => {
    const cap = resolveGraphCasCapability("observe", "enforce");
    expect(cap.rpcEnforce).toBe(true);
    expect(cap.requiresExpectedHash).toBe(true);
  });

  it("enforce/enforce → enforcing AND derives", () => {
    const cap = resolveGraphCasCapability("enforce", "enforce");
    expect(cap.rpcEnforce).toBe(true);
    expect(cap.requiresExpectedHash).toBe(true);
  });

  it("off/enforce (the FOOT-GUN) → RPC enforces but the app hook is off", () => {
    const cap = resolveGraphCasCapability("off", "enforce");
    expect(cap.rpcEnforce).toBe(true);
    // requiresExpectedHash is still forced true (belt-and-suspenders) so even
    // if the boot guard were relaxed the caller would derive — never null.
    expect(cap.requiresExpectedHash).toBe(true);
  });

  it("enforce/off (app-side enforce, RPC off) → app hook derives", () => {
    const cap = resolveGraphCasCapability("enforce", "off");
    expect(cap.rpcEnforce).toBe(false);
    expect(cap.requiresExpectedHash).toBe(true);
  });
});

describe("assertGraphCasCapabilityValid — boot-reject (RED-first)", () => {
  it("REJECTS the foot-gun: RPC=enforce + MODE=off", () => {
    expect(() =>
      assertGraphCasCapabilityValid(resolveGraphCasCapability("off", "enforce")),
    ).toThrow(/CEE_V5_GRAPH_CAS_RPC=enforce requires/i);
  });

  it.each([
    ["off", "off"],
    ["off", "shadow"],
    ["observe", "shadow"],
    ["observe", "enforce"], // ← the live staging combo — must PASS
    ["enforce", "enforce"],
    ["enforce", "shadow"],
    ["enforce", "off"],
  ] as const)("ACCEPTS %s/%s", (appMode, rpcMode) => {
    expect(() =>
      assertGraphCasCapabilityValid(resolveGraphCasCapability(appMode, rpcMode)),
    ).not.toThrow();
  });
});

describe("validateConfig() — startup boot-reject wired end-to-end (RED-first)", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    _resetConfigCache();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
    _resetConfigCache();
    vi.restoreAllMocks();
  });

  it("the foot-gun combo FAILS boot (RPC=enforce + MODE=off default)", () => {
    process.env.OLUMI_ENV = "staging";
    process.env.CEE_V5_GRAPH_CAS_RPC = "enforce";
    delete process.env.CEE_V5_GRAPH_CAS_MODE; // default 'off'
    _resetConfigCache();
    expect(() => validateConfig()).toThrow(/graph-CAS configuration/i);
  });

  it("the LIVE STAGING combo PASSES boot (RPC=enforce + MODE=observe)", () => {
    process.env.OLUMI_ENV = "staging";
    process.env.CEE_V5_GRAPH_CAS_RPC = "enforce";
    process.env.CEE_V5_GRAPH_CAS_MODE = "observe";
    _resetConfigCache();
    expect(() => validateConfig()).not.toThrow();
    // The capability is resolved once at parse and available to callers.
    expect(config.features.graphCas).toEqual({
      appMode: "observe",
      rpcMode: "enforce",
      rpcEnforce: true,
      requiresExpectedHash: true,
    });
  });

  it("the shipped default PASSES boot (MODE=off + RPC=shadow)", () => {
    process.env.OLUMI_ENV = "staging";
    delete process.env.CEE_V5_GRAPH_CAS_RPC; // default 'shadow'
    delete process.env.CEE_V5_GRAPH_CAS_MODE; // default 'off'
    _resetConfigCache();
    expect(() => validateConfig()).not.toThrow();
    expect(config.features.graphCas.requiresExpectedHash).toBe(false);
  });
});
