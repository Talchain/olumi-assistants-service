/**
 * Gate 0 — the prompt environment must never be selected by an OBSERVABILITY
 * label.
 *
 * THE DEFECT (pre-fix): `config/index.ts` derived the prompt environment as
 * `PROMPTS_ENVIRONMENT ?? DD_ENV`, and `shouldUseStagingPrompts()` rule 2
 * returned `promptEnv === 'staging'`. The PRODUCTION Render service carries
 * `NODE_ENV=production`, `DD_ENV=staging` (a Datadog tag), and NO explicit
 * `PROMPTS_ENVIRONMENT` / `PROMPTS_USE_STAGING`. So production would resolve
 * `shouldUseStagingPrompts() === true` and serve the PMS **staging_version**
 * pointer — a prompt promoted only to staging would silently change
 * production behaviour.
 *
 * WHY `NODE_ENV` CANNOT BE THE DISCRIMINATOR — two independent reasons:
 *   1. Both `render.yaml` (prod) and `render-staging.yaml` (staging) declare
 *      `NODE_ENV=production`, so the blueprints alone cannot tell the services
 *      apart.
 *   2. Stronger: the blueprint and the LIVE dashboard env DISAGREE. Live
 *      `cee-staging` actually runs `NODE_ENV=staging` while
 *      `render-staging.yaml` declares `NODE_ENV=production`. NODE_ENV is not
 *      merely non-discriminating — its declared and deployed values diverge,
 *      so nothing safety-critical may be derived from it.
 *
 * The runtime SSOT that DOES discriminate is `getRuntimeEnv()`
 * (src/config/env-resolver.ts) — OLUMI_ENV → RENDER_SERVICE_NAME → NODE_ENV.
 * That is what the prompt environment now derives from, and `DD_ENV` is out of
 * the chain entirely.
 *
 * MUTATION-CHECK: restore `?? env.DD_ENV` on the `prompts.environment` line
 * and the "production shape" test below goes RED.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  config,
  _resetConfigCache,
  shouldUseStagingPrompts,
  resolvePromptEnvironment,
} from "../../src/config/index.js";
import {
  RENDER_PROD_SERVICE_NAME,
  RENDER_STAGING_SERVICE_NAME,
  BLUEPRINT_PROD_SERVICE_NAME,
  BLUEPRINT_STAGING_SERVICE_NAME,
} from "../helpers/render-service-names.js";

/**
 * Env keys this suite manipulates; cleared before each case so no ambient
 * value (CI, .env, a previous case) can make an assertion vacuous.
 *
 * `VITEST` is deliberately NOT in this list. It is the test runner's own
 * marker and it is what keeps `optionalUrl` lenient (src/config/index.ts
 * ~L346); deleting it makes every `_resetConfigCache()` throw
 * "server.baseUrl: Invalid url", which would turn this whole suite RED for a
 * reason that has nothing to do with the defect under test. Nothing in the
 * prompt-environment chain reads `VITEST` — `getRuntimeEnv()` reads only
 * OLUMI_ENV → RENDER_SERVICE_NAME → NODE_ENV — so leaving it set cannot mask
 * the defect. (Proven by the positive control below: with VITEST set, the
 * production-shape case still goes RED on unfixed HEAD.)
 */
const MANAGED_KEYS = [
  "NODE_ENV",
  "DD_ENV",
  "OLUMI_ENV",
  "RENDER_SERVICE_NAME",
  "PROMPTS_ENVIRONMENT",
  "PROMPTS_USE_STAGING",
] as const;

describe("prompt environment resolution (Gate 0: DD_ENV decoupling)", () => {
  let originalEnv: NodeJS.ProcessEnv;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    originalEnv = { ...process.env };
    for (const k of MANAGED_KEYS) delete process.env[k];
    _resetConfigCache();
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
    _resetConfigCache();
    consoleWarnSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // THE RED TEST — the exact production shape.
  // -------------------------------------------------------------------------
  describe("the production shape (NODE_ENV=production, DD_ENV=staging, no explicit prompt env)", () => {
    /** Reproduces the live production Render service byte-for-byte. */
    function applyProductionShape(): void {
      process.env.NODE_ENV = "production";
      process.env.DD_ENV = "staging"; // Datadog tag — observability ONLY
      process.env.RENDER_SERVICE_NAME = RENDER_PROD_SERVICE_NAME;
      delete process.env.PROMPTS_ENVIRONMENT;
      delete process.env.PROMPTS_USE_STAGING;
      _resetConfigCache();
    }

    it("resolves the prompt environment to PRODUCTION, not staging", () => {
      applyProductionShape();
      expect(resolvePromptEnvironment().environment).toBe("production");
    });

    it("shouldUseStagingPrompts() is FALSE — production must serve the active_version pointer", () => {
      applyProductionShape();
      expect(shouldUseStagingPrompts()).toBe(false);
    });

    it("DD_ENV does not leak into config.prompts.environment", () => {
      applyProductionShape();
      expect(config.prompts?.environment).toBeUndefined();
    });

    it("still resolves to production when RENDER_SERVICE_NAME is absent (NODE_ENV=production fallback)", () => {
      // Proves the fix does NOT depend on Render setting RENDER_SERVICE_NAME:
      // the NODE_ENV fallback in getRuntimeEnv() also yields 'prod'.
      applyProductionShape();
      delete process.env.RENDER_SERVICE_NAME;
      _resetConfigCache();
      expect(resolvePromptEnvironment().environment).toBe("production");
      expect(shouldUseStagingPrompts()).toBe(false);
    });

    it("reports the resolution source as derived-from-runtime (not an explicit override)", () => {
      applyProductionShape();
      const r = resolvePromptEnvironment();
      expect(r.source).toBe("derived_runtime_env");
      expect(r.runtimeEnv).toBe("prod");
    });
  });

  // -------------------------------------------------------------------------
  // POSITIVE CONTROL — the harness can SEE an env change.
  //
  // Every "DD_ENV is inert" assertion below is an ABSENCE claim. An absence
  // claim is vacuous unless the harness is first shown to detect a PRESENCE.
  // These two cases prove that mutating process.env + _resetConfigCache()
  // really does move the resolved value, so a later "did not move" result is
  // evidence rather than an artefact of a dead harness.
  // -------------------------------------------------------------------------
  describe("positive control: the harness detects env changes", () => {
    it("flipping OLUMI_ENV moves the resolved prompt environment", () => {
      process.env.OLUMI_ENV = "prod";
      _resetConfigCache();
      expect(resolvePromptEnvironment().environment).toBe("production");

      process.env.OLUMI_ENV = "staging";
      _resetConfigCache();
      expect(resolvePromptEnvironment().environment).toBe("staging");
    });

    it("setting PROMPTS_ENVIRONMENT moves shouldUseStagingPrompts()", () => {
      process.env.OLUMI_ENV = "prod";
      _resetConfigCache();
      expect(shouldUseStagingPrompts()).toBe(false);

      process.env.PROMPTS_ENVIRONMENT = "staging";
      _resetConfigCache();
      expect(shouldUseStagingPrompts()).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // DD_ENV is inert for prompt selection in EVERY direction.
  // -------------------------------------------------------------------------
  describe("DD_ENV is inert for prompt selection", () => {
    it("DD_ENV=staging on a prod runtime does not select staging prompts", () => {
      process.env.OLUMI_ENV = "prod";
      process.env.DD_ENV = "staging";
      _resetConfigCache();
      expect(shouldUseStagingPrompts()).toBe(false);
    });

    it("DD_ENV=production on a staging runtime does not select production prompts", () => {
      process.env.OLUMI_ENV = "staging";
      process.env.DD_ENV = "production";
      _resetConfigCache();
      expect(shouldUseStagingPrompts()).toBe(true);
      expect(resolvePromptEnvironment().environment).toBe("staging");
    });

    it("changing DD_ENV alone never changes the resolved prompt environment", () => {
      process.env.OLUMI_ENV = "prod";
      _resetConfigCache();
      const withoutDdEnv = resolvePromptEnvironment().environment;

      for (const ddEnv of ["staging", "production", "dev", "", "STAGING"]) {
        process.env.DD_ENV = ddEnv;
        _resetConfigCache();
        expect(resolvePromptEnvironment().environment).toBe(withoutDdEnv);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Explicit overrides still win.
  // -------------------------------------------------------------------------
  describe("explicit override wins over derivation", () => {
    it("PROMPTS_ENVIRONMENT=staging on a prod runtime selects staging prompts", () => {
      process.env.OLUMI_ENV = "prod";
      process.env.PROMPTS_ENVIRONMENT = "staging";
      _resetConfigCache();
      const r = resolvePromptEnvironment();
      expect(r.environment).toBe("staging");
      expect(r.source).toBe("explicit_prompts_environment");
      expect(shouldUseStagingPrompts()).toBe(true);
    });

    it("PROMPTS_ENVIRONMENT=production on a staging runtime selects production prompts", () => {
      process.env.OLUMI_ENV = "staging";
      process.env.PROMPTS_ENVIRONMENT = "production";
      _resetConfigCache();
      const r = resolvePromptEnvironment();
      expect(r.environment).toBe("production");
      expect(r.source).toBe("explicit_prompts_environment");
      expect(shouldUseStagingPrompts()).toBe(false);
    });

    it("PROMPTS_USE_STAGING outranks PROMPTS_ENVIRONMENT", () => {
      process.env.OLUMI_ENV = "prod";
      process.env.PROMPTS_ENVIRONMENT = "production";
      process.env.PROMPTS_USE_STAGING = "true";
      _resetConfigCache();
      const r = resolvePromptEnvironment();
      expect(r.environment).toBe("staging");
      expect(r.source).toBe("explicit_prompts_use_staging");
      expect(shouldUseStagingPrompts()).toBe(true);
    });

    it("a BLANK PROMPTS_USE_STAGING means 'not set' and does NOT override PROMPTS_ENVIRONMENT", () => {
      // P1 (found in adversarial review of #523). `booleanString` maps "" to
      // FALSE, and useStaging sits at the top of the precedence chain, so a
      // blank value used to silently force the PRODUCTION pointer on the
      // STAGING service — defeating the whole fix, with no mismatch and no
      // degraded reason, because staging-serving-production is the
      // deliberately-unflagged safe direction.
      //
      // Not hypothetical: tools/conversation-harness/staging-parity.env.example:85
      // ships `PROMPTS_USE_STAGING=`.
      process.env.OLUMI_ENV = "staging";
      process.env.PROMPTS_ENVIRONMENT = "staging";
      process.env.PROMPTS_USE_STAGING = "";
      _resetConfigCache();

      const r = resolvePromptEnvironment();
      expect(r.environment).toBe("staging");
      // Must fall THROUGH to the explicit PROMPTS_ENVIRONMENT, not consume
      // the blank as an explicit `false`.
      expect(r.source).toBe("explicit_prompts_environment");
      expect(shouldUseStagingPrompts()).toBe(true);
    });

    it("a WHITESPACE-ONLY PROMPTS_USE_STAGING is also treated as 'not set'", () => {
      process.env.OLUMI_ENV = "staging";
      process.env.PROMPTS_ENVIRONMENT = "staging";
      process.env.PROMPTS_USE_STAGING = "   ";
      _resetConfigCache();
      expect(resolvePromptEnvironment().source).toBe("explicit_prompts_environment");
      expect(shouldUseStagingPrompts()).toBe(true);
    });

    it("a blank PROMPTS_USE_STAGING on a prod runtime still derives production", () => {
      process.env.OLUMI_ENV = "prod";
      process.env.PROMPTS_USE_STAGING = "";
      _resetConfigCache();
      const r = resolvePromptEnvironment();
      expect(r.environment).toBe("production");
      expect(r.source).toBe("derived_runtime_env");
    });

    it("DISCRIMINATOR: an EXPLICIT 'false' still overrides PROMPTS_ENVIRONMENT=staging", () => {
      // The blank-handling above must not blunt the real override. If this
      // ever goes green with the blank case, the normalisation has swallowed
      // legitimate explicit values too.
      process.env.OLUMI_ENV = "staging";
      process.env.PROMPTS_ENVIRONMENT = "staging";
      process.env.PROMPTS_USE_STAGING = "false";
      _resetConfigCache();
      const r = resolvePromptEnvironment();
      expect(r.environment).toBe("production");
      expect(r.source).toBe("explicit_prompts_use_staging");
      expect(shouldUseStagingPrompts()).toBe(false);
    });

    it("PROMPTS_ENVIRONMENT is case- and whitespace-tolerant", () => {
      process.env.OLUMI_ENV = "prod";
      process.env.PROMPTS_ENVIRONMENT = "  STAGING  ";
      _resetConfigCache();
      expect(resolvePromptEnvironment().environment).toBe("staging");
    });

    it("an unrecognised PROMPTS_ENVIRONMENT falls back to the derived value and warns (never a boot failure)", () => {
      process.env.OLUMI_ENV = "prod";
      process.env.PROMPTS_ENVIRONMENT = "banana";
      _resetConfigCache();
      const r = resolvePromptEnvironment();
      expect(r.environment).toBe("production");
      expect(r.source).toBe("derived_runtime_env");
      expect(consoleWarnSpy).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // CONTROL — local dev, test and CI keep resolving sensibly.
  // -------------------------------------------------------------------------
  describe("control: dev / test / CI are undisturbed", () => {
    it("local development (NODE_ENV=development, nothing explicit) → staging prompts", () => {
      process.env.NODE_ENV = "development";
      _resetConfigCache();
      const r = resolvePromptEnvironment();
      expect(r.environment).toBe("staging");
      expect(r.runtimeEnv).toBe("local");
      expect(shouldUseStagingPrompts()).toBe(true);
    });

    it("no NODE_ENV at all → local → staging prompts", () => {
      _resetConfigCache();
      expect(shouldUseStagingPrompts()).toBe(true);
      expect(resolvePromptEnvironment().runtimeEnv).toBe("local");
    });

    it("test (NODE_ENV=test) → staging prompts", () => {
      process.env.NODE_ENV = "test";
      _resetConfigCache();
      const r = resolvePromptEnvironment();
      expect(r.environment).toBe("staging");
      expect(r.runtimeEnv).toBe("test");
      expect(shouldUseStagingPrompts()).toBe(true);
    });

    it("staging Render service → staging prompts (the promotion workflow keeps working)", () => {
      process.env.NODE_ENV = "production";
      process.env.RENDER_SERVICE_NAME = RENDER_STAGING_SERVICE_NAME;
      _resetConfigCache();
      const r = resolvePromptEnvironment();
      expect(r.environment).toBe("staging");
      expect(r.runtimeEnv).toBe("staging");
      expect(shouldUseStagingPrompts()).toBe(true);
    });

    it("dev/test/local never raise a mismatch", () => {
      for (const nodeEnv of ["development", "test"]) {
        process.env.NODE_ENV = nodeEnv;
        _resetConfigCache();
        const r = resolvePromptEnvironment();
        expect(r.mismatch).toBe(false);
        expect(r.blocksReadiness).toBe(false);
      }
    });
  });

  // -------------------------------------------------------------------------
  // MISMATCH DETECTION — a prod runtime serving staging prompts must be loud.
  // -------------------------------------------------------------------------
  describe("mismatch detection (prod runtime + staging prompts)", () => {
    it("flags a mismatch when an explicit override forces staging prompts on a confident prod runtime", () => {
      process.env.OLUMI_ENV = "prod";
      process.env.PROMPTS_ENVIRONMENT = "staging";
      _resetConfigCache();
      const r = resolvePromptEnvironment();
      expect(r.mismatch).toBe(true);
      expect(r.reasons).toContain("prompt_env_conflicts_with_runtime");
    });

    it("BLOCKS readiness when the prod verdict came from an EXPLICIT signal (OLUMI_ENV)", () => {
      process.env.OLUMI_ENV = "prod";
      process.env.PROMPTS_USE_STAGING = "true";
      _resetConfigCache();
      expect(resolvePromptEnvironment().blocksReadiness).toBe(true);
    });

    it("BLOCKS readiness when the prod verdict came from RENDER_SERVICE_NAME", () => {
      process.env.NODE_ENV = "production";
      process.env.RENDER_SERVICE_NAME = RENDER_PROD_SERVICE_NAME;
      process.env.PROMPTS_ENVIRONMENT = "staging";
      _resetConfigCache();
      const r = resolvePromptEnvironment();
      expect(r.runtimeEnvSource).toBe("render_service_name");
      expect(r.blocksReadiness).toBe(true);
    });

    it("does NOT block readiness when the prod verdict came only from the AMBIGUOUS NODE_ENV fallback", () => {
      // Both Render services set NODE_ENV=production, so a bare NODE_ENV
      // 'prod' verdict cannot distinguish the staging service from the
      // production one. Refusing readiness here would brick the STAGING
      // deploy if Render ever stopped injecting RENDER_SERVICE_NAME.
      // Loud, but not fatal.
      process.env.NODE_ENV = "production";
      process.env.PROMPTS_ENVIRONMENT = "staging";
      _resetConfigCache();
      const r = resolvePromptEnvironment();
      expect(r.runtimeEnvSource).toBe("node_env");
      expect(r.mismatch).toBe(true);
      expect(r.blocksReadiness).toBe(false);
    });

    it("no mismatch when a prod runtime serves production prompts", () => {
      process.env.OLUMI_ENV = "prod";
      process.env.PROMPTS_ENVIRONMENT = "production";
      _resetConfigCache();
      const r = resolvePromptEnvironment();
      expect(r.mismatch).toBe(false);
      expect(r.blocksReadiness).toBe(false);
    });

    it("no mismatch when a staging runtime serves production prompts (safe direction)", () => {
      process.env.OLUMI_ENV = "staging";
      process.env.PROMPTS_ENVIRONMENT = "production";
      _resetConfigCache();
      expect(resolvePromptEnvironment().mismatch).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // EXPLICITNESS on deployed environments.
  // -------------------------------------------------------------------------
  describe("deployed environments should declare the prompt environment explicitly", () => {
    it("flags a prod deployment with no explicit prompt environment", () => {
      process.env.OLUMI_ENV = "prod";
      _resetConfigCache();
      const r = resolvePromptEnvironment();
      expect(r.reasons).toContain("prompt_env_unset_on_deployed_env");
      // Still resolves SAFELY — the missing declaration is a warning, not a
      // fallback to staging.
      expect(r.environment).toBe("production");
      expect(r.blocksReadiness).toBe(false);
    });

    it("flags a staging deployment with no explicit prompt environment", () => {
      process.env.OLUMI_ENV = "staging";
      _resetConfigCache();
      expect(resolvePromptEnvironment().reasons).toContain(
        "prompt_env_unset_on_deployed_env",
      );
    });

    it("does NOT flag once PROMPTS_ENVIRONMENT is declared", () => {
      process.env.OLUMI_ENV = "prod";
      process.env.PROMPTS_ENVIRONMENT = "production";
      _resetConfigCache();
      expect(resolvePromptEnvironment().reasons).not.toContain(
        "prompt_env_unset_on_deployed_env",
      );
    });

    it("does NOT flag local/test (they legitimately have no explicit setting)", () => {
      for (const nodeEnv of ["development", "test"]) {
        process.env.NODE_ENV = nodeEnv;
        _resetConfigCache();
        expect(resolvePromptEnvironment().reasons).not.toContain(
          "prompt_env_unset_on_deployed_env",
        );
      }
    });
  });

  // -------------------------------------------------------------------------
  // REAL Render service names.
  //
  // The blueprints declare `olumi-assistants-service` / `olumi-assistants-
  // staging`, but Render injects the DEPLOYED names: `cee-production` /
  // `cee-staging`. Both families classify identically today, which is exactly
  // why testing only the blueprint names was invisible drift — green
  // assertions over inputs that never occur. Both are pinned here so a rename
  // in either direction still has coverage.
  // -------------------------------------------------------------------------
  describe("real Render service names (RENDER_SERVICE_NAME as actually injected)", () => {
    it("live `cee-production` → prod runtime → PRODUCTION pointer, discriminating", () => {
      process.env.NODE_ENV = "production";
      process.env.DD_ENV = "staging";
      process.env.RENDER_SERVICE_NAME = RENDER_PROD_SERVICE_NAME;
      _resetConfigCache();

      const r = resolvePromptEnvironment();
      expect(r.runtimeEnv).toBe("prod");
      expect(r.runtimeEnvSource).toBe("render_service_name");
      expect(r.environment).toBe("production");
      expect(r.mismatch).toBe(false);
    });

    it("live `cee-staging` → staging runtime → STAGING pointer", () => {
      // Live cee-staging runs NODE_ENV=staging (which the blueprint does NOT
      // declare); the service-name check must carry the verdict either way.
      process.env.NODE_ENV = "staging";
      process.env.DD_ENV = "staging";
      process.env.RENDER_SERVICE_NAME = RENDER_STAGING_SERVICE_NAME;
      _resetConfigCache();

      const r = resolvePromptEnvironment();
      expect(r.runtimeEnv).toBe("staging");
      expect(r.runtimeEnvSource).toBe("render_service_name");
      expect(r.environment).toBe("staging");
    });

    it("live `cee-production` with NO explicit prompt env is READY-SAFE (the first-deploy shape)", () => {
      // Production today carries neither PROMPTS_ENVIRONMENT nor
      // PROMPTS_USE_STAGING. It must derive `production` and must NOT block
      // readiness, or the first July deploy would 503.
      process.env.NODE_ENV = "production";
      process.env.DD_ENV = "staging";
      process.env.RENDER_SERVICE_NAME = RENDER_PROD_SERVICE_NAME;
      _resetConfigCache();

      const r = resolvePromptEnvironment();
      expect(r.environment).toBe("production");
      expect(r.blocksReadiness).toBe(false);
      expect(r.reasons).toContain("prompt_env_unset_on_deployed_env");
    });

    it("blueprint names classify the same way (secondary fixtures)", () => {
      process.env.RENDER_SERVICE_NAME = BLUEPRINT_PROD_SERVICE_NAME;
      _resetConfigCache();
      expect(resolvePromptEnvironment().runtimeEnv).toBe("prod");

      process.env.RENDER_SERVICE_NAME = BLUEPRINT_STAGING_SERVICE_NAME;
      _resetConfigCache();
      expect(resolvePromptEnvironment().runtimeEnv).toBe("staging");
    });

    it("DISCRIMINATOR: the staging classifier keys on the 'staging' substring, not an exact name", () => {
      // Guards the assumption that makes BOTH name families work. If the
      // classifier were ever changed to an exact-match allowlist, this fails
      // and the real names would silently start classifying as prod.
      expect(RENDER_STAGING_SERVICE_NAME).toContain("staging");
      expect(RENDER_PROD_SERVICE_NAME).not.toContain("staging");

      process.env.RENDER_SERVICE_NAME = "some-unrelated-staging-box";
      _resetConfigCache();
      expect(resolvePromptEnvironment().runtimeEnv).toBe("staging");
    });
  });

  // -------------------------------------------------------------------------
  // The graph-management production lockdown must be undisturbed.
  // -------------------------------------------------------------------------
  describe("graph-management production lockdown is independent of this change", () => {
    it("GM live→shadow downgrade still fires in prod regardless of DD_ENV", () => {
      for (const ddEnv of ["staging", "production", undefined]) {
        if (ddEnv === undefined) delete process.env.DD_ENV;
        else process.env.DD_ENV = ddEnv;
        process.env.OLUMI_ENV = "prod";
        process.env.CEE_GRAPH_MANAGEMENT_MODE = "live";
        _resetConfigCache();
        expect(config.features.graphManagementMode).toBe("shadow");
      }
      delete process.env.CEE_GRAPH_MANAGEMENT_MODE;
    });

    it("GM live is still honoured in staging regardless of the prompt environment", () => {
      process.env.OLUMI_ENV = "staging";
      process.env.PROMPTS_ENVIRONMENT = "production";
      process.env.CEE_GRAPH_MANAGEMENT_MODE = "live";
      _resetConfigCache();
      expect(config.features.graphManagementMode).toBe("live");
      delete process.env.CEE_GRAPH_MANAGEMENT_MODE;
    });
  });
});
