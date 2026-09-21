/**
 * O-7 (flag-estate wave 2, PR-A) — strict boolean env parsing.
 *
 * THE DEFECT (pre-fix): `booleanString` (src/config/index.ts) recognised only
 * `true|1` / `false|0|""` and then fell through to `Boolean(val)` for every
 * other non-empty string — so `off`, `no`, `disabled`, and any typo ENABLED
 * the capability. The security-enforced sibling `createEnvEnforcedBoolean`
 * repeated the same fallthrough, so `CEE_OBSERVABILITY_RAW_IO=disabled`
 * would turn raw prompt/response capture ON.
 * Proven on unfixed HEAD (o7 RED run, 2026-07-20):
 *   CEE_DEBUG_CATEGORY_TRACE=off      → config.cee.debugCategoryTrace === true
 *   CEE_OBSERVABILITY_RAW_IO=disabled → config.cee.observabilityRawIO  === true
 *
 * THE CONTRACT (post-fix) — exact allowlists, case-insensitive, trimmed:
 *   TRUE  ⟵ "true" | "1" | "yes" | "on"
 *   FALSE ⟵ "false" | "0" | "no" | "off" | "disabled" | "" (and absent → field default)
 *   numbers: exactly 1 → true, exactly 0 → false (anything else rejected)
 *   anything else → STARTUP REJECTION with a named INVALID_BOOLEAN_ENV error
 *   (config parse throws `Configuration validation failed: <field-path>: …`).
 *
 * MUTATION-CHECKS (both ways):
 *   1. Restore the `Boolean(val)` fallback in booleanString → the rejection
 *      cases here go RED ("off" silently → true again).
 *   2. Remove "off"/"disabled" from the FALSE allowlist → the false-set
 *      acceptance cases here go RED (startup rejection where false expected).
 *
 * Probe fields — one per parser:
 *   booleanString            → cee.debugCategoryTrace  (CEE_DEBUG_CATEGORY_TRACE)
 *   createEnvEnforcedBoolean → cee.observabilityRawIO  (CEE_OBSERVABILITY_RAW_IO)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { config, _resetConfigCache } from "../../src/config/index.js";

const PROBE_KEYS = [
  "CEE_DEBUG_CATEGORY_TRACE",
  "CEE_OBSERVABILITY_RAW_IO",
  "NODE_ENV",
  "OLUMI_ENV",
  "RENDER_SERVICE_NAME",
] as const;

describe("strict boolean env parsing (O-7 PR-A)", () => {
  let originalEnv: NodeJS.ProcessEnv;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    originalEnv = { ...process.env };
    for (const k of PROBE_KEYS) delete process.env[k];
    process.env.NODE_ENV = "test";
    _resetConfigCache();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
    _resetConfigCache();
    warnSpy.mockRestore();
  });

  const readBooleanStringProbe = (): boolean => config.cee.debugCategoryTrace;
  const readEnvEnforcedProbe = (): boolean => config.cee.observabilityRawIO;

  describe("booleanString — TRUE allowlist", () => {
    for (const v of ["true", "1", "yes", "on", "TRUE", "Yes", " on "]) {
      it(`accepts ${JSON.stringify(v)} as true`, () => {
        process.env.CEE_DEBUG_CATEGORY_TRACE = v;
        _resetConfigCache();
        expect(readBooleanStringProbe()).toBe(true);
      });
    }
  });

  describe("booleanString — FALSE allowlist", () => {
    for (const v of ["false", "0", "no", "off", "disabled", "", "FALSE", "Off", " disabled "]) {
      it(`accepts ${JSON.stringify(v)} as false`, () => {
        process.env.CEE_DEBUG_CATEGORY_TRACE = v;
        _resetConfigCache();
        expect(readBooleanStringProbe()).toBe(false);
      });
    }
  });

  describe("booleanString — everything else is a NAMED STARTUP REJECTION", () => {
    for (const v of ["enabled", "tru", "yess", "offf", "2", "-1", "null", "undefined", "ON!"]) {
      it(`rejects ${JSON.stringify(v)} at startup with INVALID_BOOLEAN_ENV`, () => {
        process.env.CEE_DEBUG_CATEGORY_TRACE = v;
        _resetConfigCache();
        expect(readBooleanStringProbe).toThrowError(/Configuration validation failed/);
        _resetConfigCache();
        expect(readBooleanStringProbe).toThrowError(/INVALID_BOOLEAN_ENV/);
        _resetConfigCache();
        // The named error must identify the offending field path.
        expect(readBooleanStringProbe).toThrowError(/debugCategoryTrace/);
      });
    }
  });

  describe("createEnvEnforcedBoolean (security sibling) — same strict contract", () => {
    it("accepts 'true' as true (test env allows raw IO)", () => {
      process.env.CEE_OBSERVABILITY_RAW_IO = "true";
      _resetConfigCache();
      expect(readEnvEnforcedProbe()).toBe(true);
    });

    for (const v of ["off", "no", "disabled"]) {
      it(`accepts ${JSON.stringify(v)} as false (was TRUE pre-fix)`, () => {
        process.env.CEE_OBSERVABILITY_RAW_IO = v;
        _resetConfigCache();
        expect(readEnvEnforcedProbe()).toBe(false);
      });
    }

    for (const v of ["enabled", "fasle", "raw"]) {
      it(`rejects ${JSON.stringify(v)} at startup with INVALID_BOOLEAN_ENV`, () => {
        process.env.CEE_OBSERVABILITY_RAW_IO = v;
        _resetConfigCache();
        expect(readEnvEnforcedProbe).toThrowError(/INVALID_BOOLEAN_ENV/);
      });
    }
  });

  describe("absence keeps the field default", () => {
    it("absent CEE_DEBUG_CATEGORY_TRACE → false (schema default)", () => {
      _resetConfigCache();
      expect(readBooleanStringProbe()).toBe(false);
    });
  });
});
