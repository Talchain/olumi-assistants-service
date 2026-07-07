/**
 * CEE_GRAPH_MANAGEMENT_MODE — Graph Management live-wiring mode flag
 * (createEnvEnforcedGraphManagementMode; mirrors the A3 CAS-mode pins).
 *
 * Pins:
 *  - code default 'off' in every environment;
 *  - 'shadow' honoured everywhere (including prod);
 *  - 'live' honoured in staging/local/test, AUTO-DOWNGRADED to 'shadow'
 *    in prod with an [AUDIT] warning + a production_lockdown override event;
 *  - invalid / empty values fall back to the default with a console warning —
 *    never a boot failure;
 *  - lowercase/trim tolerance.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { config, _resetConfigCache, emitConfigOverrideTelemetry } from "../../src/config/index.js";
import * as telemetry from "../../src/utils/telemetry.js";

describe("CEE_GRAPH_MANAGEMENT_MODE (Graph Management live wiring)", () => {
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

  describe("default: 'off' everywhere", () => {
    it.each(["prod", "staging", "test", "local"])("defaults to 'off' in %s", (env) => {
      process.env.OLUMI_ENV = env;
      delete process.env.CEE_GRAPH_MANAGEMENT_MODE;
      _resetConfigCache();
      expect(config.features.graphManagementMode).toBe("off");
    });
  });

  describe("'shadow' is honoured in every environment", () => {
    it.each(["prod", "staging", "test", "local"])("shadow stays shadow in %s", (env) => {
      process.env.OLUMI_ENV = env;
      process.env.CEE_GRAPH_MANAGEMENT_MODE = "shadow";
      _resetConfigCache();
      expect(config.features.graphManagementMode).toBe("shadow");
    });
  });

  describe("'live' — allowed outside prod, downgraded in prod", () => {
    it.each(["staging", "test", "local"])("live stays live in %s", (env) => {
      process.env.OLUMI_ENV = env;
      process.env.CEE_GRAPH_MANAGEMENT_MODE = "live";
      _resetConfigCache();
      expect(config.features.graphManagementMode).toBe("live");
    });

    it("prod + live → parses to 'shadow' (auto-downgrade, never a boot failure)", async () => {
      process.env.OLUMI_ENV = "prod";
      process.env.CEE_GRAPH_MANAGEMENT_MODE = "live";
      _resetConfigCache();

      expect(config.features.graphManagementMode).toBe("shadow");

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringMatching(/\[AUDIT\].*CEE_GRAPH_MANAGEMENT_MODE.*live.*production.*shadow/i),
      );

      // Mirrors the production_lockdown override-event pattern.
      await emitConfigOverrideTelemetry();
      expect(emitSpy).toHaveBeenCalledWith(
        telemetry.TelemetryEvents.CeeConfigRawIoOverridden,
        expect.objectContaining({
          setting_name: "CEE_GRAPH_MANAGEMENT_MODE",
          requested_value: "live",
          actual_value: "shadow",
          env: "prod",
          reason: "production_lockdown",
        }),
      );
    });

    it("prod + shadow emits NO override event (only live downgrades)", async () => {
      process.env.OLUMI_ENV = "prod";
      process.env.CEE_GRAPH_MANAGEMENT_MODE = "shadow";
      _resetConfigCache();
      expect(config.features.graphManagementMode).toBe("shadow");
      await emitConfigOverrideTelemetry();
      expect(emitSpy).not.toHaveBeenCalledWith(
        telemetry.TelemetryEvents.CeeConfigRawIoOverridden,
        expect.objectContaining({ setting_name: "CEE_GRAPH_MANAGEMENT_MODE" }),
      );
    });
  });

  describe("invalid / degenerate values never fail boot", () => {
    it("invalid value → default 'off' with a console warning", () => {
      process.env.OLUMI_ENV = "staging";
      process.env.CEE_GRAPH_MANAGEMENT_MODE = "banana";
      _resetConfigCache();
      expect(config.features.graphManagementMode).toBe("off");
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringMatching(/CEE_GRAPH_MANAGEMENT_MODE.*invalid value "banana".*off/),
      );
    });

    it("empty string → default 'off' without warning noise", () => {
      process.env.OLUMI_ENV = "local";
      process.env.CEE_GRAPH_MANAGEMENT_MODE = "";
      _resetConfigCache();
      expect(config.features.graphManagementMode).toBe("off");
    });

    it("values are lowercased and trimmed ('  LIVE  ' → live outside prod)", () => {
      process.env.OLUMI_ENV = "staging";
      process.env.CEE_GRAPH_MANAGEMENT_MODE = "  LIVE  ";
      _resetConfigCache();
      expect(config.features.graphManagementMode).toBe("live");
    });

    it("'observe' (the CAS vocabulary) is invalid here → default 'off', not shadow", () => {
      process.env.OLUMI_ENV = "staging";
      process.env.CEE_GRAPH_MANAGEMENT_MODE = "observe";
      _resetConfigCache();
      expect(config.features.graphManagementMode).toBe("off");
    });
  });
});
