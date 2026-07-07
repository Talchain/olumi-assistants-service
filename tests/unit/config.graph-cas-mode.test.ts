/**
 * CEE_V5_GRAPH_CAS_MODE — A3 graph CAS mode flag (createEnvEnforcedMode).
 *
 * Pins:
 *  - code default 'off' in every environment;
 *  - 'observe' honoured everywhere (including prod);
 *  - 'enforce' honoured in staging/local/test, AUTO-DOWNGRADED to 'observe'
 *    in prod with an [AUDIT] warning + a production_lockdown override event;
 *  - invalid / empty values fall back to the default with a console warning —
 *    never a boot failure;
 *  - lowercase/trim tolerance.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { config, _resetConfigCache, emitConfigOverrideTelemetry } from "../../src/config/index.js";
import * as telemetry from "../../src/utils/telemetry.js";

describe("CEE_V5_GRAPH_CAS_MODE (A3 graph CAS observe-mode)", () => {
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
      delete process.env.CEE_V5_GRAPH_CAS_MODE;
      _resetConfigCache();
      expect(config.features.graphCasMode).toBe("off");
    });
  });

  describe("'observe' is honoured in every environment", () => {
    it.each(["prod", "staging", "test", "local"])("observe stays observe in %s", (env) => {
      process.env.OLUMI_ENV = env;
      process.env.CEE_V5_GRAPH_CAS_MODE = "observe";
      _resetConfigCache();
      expect(config.features.graphCasMode).toBe("observe");
    });
  });

  describe("'enforce' — allowed outside prod, downgraded in prod", () => {
    it.each(["staging", "test", "local"])("enforce stays enforce in %s", (env) => {
      process.env.OLUMI_ENV = env;
      process.env.CEE_V5_GRAPH_CAS_MODE = "enforce";
      _resetConfigCache();
      expect(config.features.graphCasMode).toBe("enforce");
    });

    it("prod + enforce → parses to 'observe' (auto-downgrade, never a boot failure)", async () => {
      process.env.OLUMI_ENV = "prod";
      process.env.CEE_V5_GRAPH_CAS_MODE = "enforce";
      _resetConfigCache();

      expect(config.features.graphCasMode).toBe("observe");

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringMatching(/\[AUDIT\].*CEE_V5_GRAPH_CAS_MODE.*enforce.*production.*observe/i),
      );

      // Mirrors the production_lockdown override-event pattern.
      await emitConfigOverrideTelemetry();
      expect(emitSpy).toHaveBeenCalledWith(
        telemetry.TelemetryEvents.CeeConfigRawIoOverridden,
        expect.objectContaining({
          setting_name: "CEE_V5_GRAPH_CAS_MODE",
          requested_value: "enforce",
          actual_value: "observe",
          env: "prod",
          reason: "production_lockdown",
        }),
      );
    });

    it("prod + observe emits NO override event (only enforce downgrades)", async () => {
      process.env.OLUMI_ENV = "prod";
      process.env.CEE_V5_GRAPH_CAS_MODE = "observe";
      _resetConfigCache();
      expect(config.features.graphCasMode).toBe("observe");
      await emitConfigOverrideTelemetry();
      expect(emitSpy).not.toHaveBeenCalledWith(
        telemetry.TelemetryEvents.CeeConfigRawIoOverridden,
        expect.objectContaining({ setting_name: "CEE_V5_GRAPH_CAS_MODE" }),
      );
    });
  });

  describe("invalid / degenerate values never fail boot", () => {
    it("invalid value → default 'off' with a console warning", () => {
      process.env.OLUMI_ENV = "staging";
      process.env.CEE_V5_GRAPH_CAS_MODE = "banana";
      _resetConfigCache();
      expect(config.features.graphCasMode).toBe("off");
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringMatching(/CEE_V5_GRAPH_CAS_MODE.*invalid value "banana".*off/),
      );
    });

    it("empty string → default 'off' without warning noise", () => {
      process.env.OLUMI_ENV = "local";
      process.env.CEE_V5_GRAPH_CAS_MODE = "";
      _resetConfigCache();
      expect(config.features.graphCasMode).toBe("off");
    });

    it("values are lowercased and trimmed ('  OBSERVE  ' → observe)", () => {
      process.env.OLUMI_ENV = "staging";
      process.env.CEE_V5_GRAPH_CAS_MODE = "  OBSERVE  ";
      _resetConfigCache();
      expect(config.features.graphCasMode).toBe("observe");
    });

    it("'true'/'1' (boolean habits) are invalid → default 'off', not observe", () => {
      process.env.OLUMI_ENV = "staging";
      process.env.CEE_V5_GRAPH_CAS_MODE = "true";
      _resetConfigCache();
      expect(config.features.graphCasMode).toBe("off");
    });
  });
});
