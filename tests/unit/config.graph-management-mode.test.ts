/**
 * CEE_GRAPH_MANAGEMENT_MODE — Graph Management live-wiring mode flag
 * (createEnvEnforcedGraphManagementMode; mirrors the A3 CAS-mode pins).
 *
 * ⚠ THE DEFAULT MOVED 'off' → 'live' (ROADMAP 2.474 / amendment A10, Paul's
 * Option A ruling). This file's pins are updated at the SOURCE rather than
 * relaxed: the default assertions below now assert the NEW default, and the
 * prod-lockdown / kill-switch / tolerance pins are UNCHANGED, because those are
 * the properties that must survive the promotion.
 *
 * Why the default moved, recorded here so the next reader does not "restore"
 * it: every hold the Graph Management design relies on exists only while the
 * mode resolves to 'live', and the resume path re-reads the mode AT RESUME
 * TIME. With the repo default 'off' and staging supplying 'live' from the
 * Render dashboard, one env reset silently bypassed every consent hold
 * (ARCH-REVIEW-2 S2S3 R-7) and nothing in this codebase would have failed.
 * Doctrine: no env-var gates, no dark launches, rollback = code revert.
 *
 * Pins:
 *  - code default 'live' outside prod, and 'shadow' in prod (the lockdown
 *    below applies to the default exactly as it applies to an explicit value);
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

  describe("default: 'live' outside prod, 'shadow' in prod", () => {
    it.each(["staging", "test", "local"])("defaults to 'live' in %s", (env) => {
      process.env.OLUMI_ENV = env;
      delete process.env.CEE_GRAPH_MANAGEMENT_MODE;
      _resetConfigCache();
      expect(config.features.graphManagementMode).toBe("live");
    });

    it("defaults to 'shadow' in prod — the lockdown governs the DEFAULT too", () => {
      // The stated consequence of the promotion, asserted rather than
      // discovered: an unconfigured prod boot used to resolve 'off' (no referee
      // calls) and now resolves 'shadow' (the referee evaluates and emits
      // telemetry, and by the mode's definition never blocks). Added
      // observability, not a production behaviour change — and 'live' remains
      // unreachable in prod, which is the property that matters.
      process.env.OLUMI_ENV = "prod";
      delete process.env.CEE_GRAPH_MANAGEMENT_MODE;
      _resetConfigCache();
      expect(config.features.graphManagementMode).toBe("shadow");
    });

    it("THE KILL-SWITCH SURVIVES — an explicit 'off' still wins over the new default", () => {
      // A default that could not be turned off would be a worse gate than the
      // one it replaced.
      process.env.OLUMI_ENV = "staging";
      process.env.CEE_GRAPH_MANAGEMENT_MODE = "off";
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
    it("invalid value → the code default with a console warning naming it", () => {
      process.env.OLUMI_ENV = "staging";
      process.env.CEE_GRAPH_MANAGEMENT_MODE = "banana";
      _resetConfigCache();
      expect(config.features.graphManagementMode).toBe("live");
      // The warning must name the fallback it actually took — a warning that
      // says "off" while resolving "live" is a broken alarm.
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringMatching(/CEE_GRAPH_MANAGEMENT_MODE.*invalid value "banana".*live/),
      );
    });

    it("empty string → the code default without warning noise", () => {
      process.env.OLUMI_ENV = "local";
      process.env.CEE_GRAPH_MANAGEMENT_MODE = "";
      _resetConfigCache();
      expect(config.features.graphManagementMode).toBe("live");
    });

    it("values are lowercased and trimmed ('  LIVE  ' → live outside prod)", () => {
      process.env.OLUMI_ENV = "staging";
      process.env.CEE_GRAPH_MANAGEMENT_MODE = "  LIVE  ";
      _resetConfigCache();
      expect(config.features.graphManagementMode).toBe("live");
    });

    it("'observe' (the CAS vocabulary) is invalid here → the code default, not shadow", () => {
      process.env.OLUMI_ENV = "staging";
      process.env.CEE_GRAPH_MANAGEMENT_MODE = "observe";
      _resetConfigCache();
      expect(config.features.graphManagementMode).toBe("live");
    });
  });
});
