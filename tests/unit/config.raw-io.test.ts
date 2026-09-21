/**
 * CEE_OBSERVABILITY_RAW_IO Lockdown Tests (Stream F)
 *
 * Tests environment-specific enforcement of raw IO flag.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { config, _resetConfigCache, emitConfigOverrideTelemetry } from "../../src/config/index.js";
import * as telemetry from "../../src/utils/telemetry.js";

describe("CEE_OBSERVABILITY_RAW_IO Lockdown (Stream F)", () => {
  let originalEnv: NodeJS.ProcessEnv;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let emitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    originalEnv = { ...process.env };
    _resetConfigCache();
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    emitSpy = vi.spyOn(telemetry, "emit");
  });

  afterEach(() => {
    process.env = originalEnv;
    _resetConfigCache();
    consoleWarnSpy.mockRestore();
    emitSpy.mockRestore();
  });

  /**
   * Path 1: Default - raw IO is false in all environments
   */
  describe("Default behavior: raw IO is false", () => {
    it("defaults to false in production", () => {
      process.env.OLUMI_ENV = "prod";
      delete process.env.CEE_OBSERVABILITY_RAW_IO;
      _resetConfigCache();

      expect(config.cee.observabilityRawIO).toBe(false);
    });

    it("defaults to false in staging", () => {
      process.env.OLUMI_ENV = "staging";
      delete process.env.CEE_OBSERVABILITY_RAW_IO;
      _resetConfigCache();

      expect(config.cee.observabilityRawIO).toBe(false);
    });

    it("defaults to false in test", () => {
      process.env.OLUMI_ENV = "test";
      delete process.env.CEE_OBSERVABILITY_RAW_IO;
      _resetConfigCache();

      expect(config.cee.observabilityRawIO).toBe(false);
    });

    it("defaults to false in local", () => {
      process.env.OLUMI_ENV = "local";
      delete process.env.CEE_OBSERVABILITY_RAW_IO;
      _resetConfigCache();

      expect(config.cee.observabilityRawIO).toBe(false);
    });
  });

  /**
   * Path 2: Staging override - can enable with warning
   */
  describe("Staging override: can enable with warning", () => {
    it("allows enabling raw IO in staging when explicitly set to true", async () => {
      process.env.OLUMI_ENV = "staging";
      process.env.CEE_OBSERVABILITY_RAW_IO = "true";
      _resetConfigCache();

      expect(config.cee.observabilityRawIO).toBe(true);

      // Should log audit warning
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringMatching(/\[AUDIT\].*CEE_OBSERVABILITY_RAW_IO.*staging/)
      );

      // Should queue telemetry event for emission
      await emitConfigOverrideTelemetry();
      expect(emitSpy).toHaveBeenCalledWith(
        telemetry.TelemetryEvents.CeeConfigRawIoOverridden,
        expect.objectContaining({
          setting_name: "CEE_OBSERVABILITY_RAW_IO",
          requested_value: true,
          actual_value: true,
          env: "staging",
          reason: "staging_override_allowed",
        })
      );
    });

    it("keeps raw IO false in staging when explicitly set to false", () => {
      process.env.OLUMI_ENV = "staging";
      process.env.CEE_OBSERVABILITY_RAW_IO = "false";
      _resetConfigCache();

      expect(config.cee.observabilityRawIO).toBe(false);
    });

    it("allows enabling raw IO in local environment", () => {
      process.env.OLUMI_ENV = "local";
      process.env.CEE_OBSERVABILITY_RAW_IO = "true";
      _resetConfigCache();

      expect(config.cee.observabilityRawIO).toBe(true);
    });

    it("allows enabling raw IO in test environment", () => {
      process.env.OLUMI_ENV = "test";
      process.env.CEE_OBSERVABILITY_RAW_IO = "true";
      _resetConfigCache();

      expect(config.cee.observabilityRawIO).toBe(true);
    });
  });

  /**
   * Path 3: Prod rejection - cannot enable, value forced to false
   */
  describe("Prod rejection: cannot enable, forced to false", () => {
    it("forces false in production even when set to true", async () => {
      process.env.OLUMI_ENV = "prod";
      process.env.CEE_OBSERVABILITY_RAW_IO = "true";
      _resetConfigCache();

      // Should be forced to false in production
      expect(config.cee.observabilityRawIO).toBe(false);

      // Should log security warning
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringMatching(/\[SECURITY\].*CEE_OBSERVABILITY_RAW_IO.*production.*forced to false/)
      );

      // Should queue telemetry event for emission
      await emitConfigOverrideTelemetry();
      expect(emitSpy).toHaveBeenCalledWith(
        telemetry.TelemetryEvents.CeeConfigRawIoOverridden,
        expect.objectContaining({
          setting_name: "CEE_OBSERVABILITY_RAW_IO",
          requested_value: true,
          actual_value: false,
          env: "prod",
          reason: "production_lockdown",
        })
      );
    });

    it("forces false in production when set to '1'", () => {
      process.env.OLUMI_ENV = "prod";
      process.env.CEE_OBSERVABILITY_RAW_IO = "1";
      _resetConfigCache();

      expect(config.cee.observabilityRawIO).toBe(false);
    });

    it("remains false in production when explicitly set to false", () => {
      process.env.OLUMI_ENV = "prod";
      process.env.CEE_OBSERVABILITY_RAW_IO = "false";
      _resetConfigCache();

      expect(config.cee.observabilityRawIO).toBe(false);
    });
  });

  /**
   * Edge cases
   */
  describe("Edge cases", () => {
    it("handles string 'true' case-insensitively", () => {
      process.env.OLUMI_ENV = "local";
      process.env.CEE_OBSERVABILITY_RAW_IO = "TRUE";
      _resetConfigCache();

      expect(config.cee.observabilityRawIO).toBe(true);
    });

    it("handles string 'false' case-insensitively", () => {
      process.env.OLUMI_ENV = "local";
      process.env.CEE_OBSERVABILITY_RAW_IO = "FALSE";
      _resetConfigCache();

      expect(config.cee.observabilityRawIO).toBe(false);
    });

    it("handles numeric 1 as true in non-prod", () => {
      process.env.OLUMI_ENV = "local";
      process.env.CEE_OBSERVABILITY_RAW_IO = "1";
      _resetConfigCache();

      expect(config.cee.observabilityRawIO).toBe(true);
    });

    it("handles numeric 0 as false", () => {
      process.env.OLUMI_ENV = "local";
      process.env.CEE_OBSERVABILITY_RAW_IO = "0";
      _resetConfigCache();

      expect(config.cee.observabilityRawIO).toBe(false);
    });

    it("handles empty string as false", () => {
      process.env.OLUMI_ENV = "local";
      process.env.CEE_OBSERVABILITY_RAW_IO = "";
      _resetConfigCache();

      expect(config.cee.observabilityRawIO).toBe(false);
    });
  });

  /**
   * Boundary allow invalid uses same enforcement
   */
  describe("CEE_BOUNDARY_ALLOW_INVALID uses same enforcement", () => {
    it("defaults to false in all environments", () => {
      process.env.OLUMI_ENV = "prod";
      delete process.env.CEE_BOUNDARY_ALLOW_INVALID;
      _resetConfigCache();

      expect(config.cee.boundaryAllowInvalid).toBe(false);
    });

    it("allows enabling in local/test", () => {
      process.env.OLUMI_ENV = "local";
      process.env.CEE_BOUNDARY_ALLOW_INVALID = "true";
      _resetConfigCache();

      expect(config.cee.boundaryAllowInvalid).toBe(true);
    });

    it("forces false in production", () => {
      process.env.OLUMI_ENV = "prod";
      process.env.CEE_BOUNDARY_ALLOW_INVALID = "true";
      _resetConfigCache();

      expect(config.cee.boundaryAllowInvalid).toBe(false);
    });

    it("forces false in staging even when set to true", () => {
      process.env.OLUMI_ENV = "staging";
      process.env.CEE_BOUNDARY_ALLOW_INVALID = "true";
      _resetConfigCache();

      expect(config.cee.boundaryAllowInvalid).toBe(false);
    });
  });
});
