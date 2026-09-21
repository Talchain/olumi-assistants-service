/**
 * L44 activation lane — the CONFIG half of the six-switch list.
 *
 * Two switches land in `src/config/index.ts`, and each is pinned here at the
 * DEFAULT (env unset), because a default that only holds when a dashboard
 * variable is present is not an activation — it is the env-var gate the
 * no-env-gates doctrine forbids.
 *
 *   ROADMAP 2.146 — `CEE_VALIDATION_PIPELINE_ENABLED` code default false → true.
 *                   The two-pass contested-edge validation pipeline was flipped
 *                   on the Render dashboard on 30 Jul and live-proven (n=5), but
 *                   the CODE default stayed `false`, so the capability was dark
 *                   in every environment that did not carry the variable.
 *                   Rollback is now a code revert, not an env edit.
 *
 *   RESEARCH_ENABLED — DELETED. `orchestrator/tools/research-topic.ts` was
 *                   removed on 2026-07-22 (`f957d6d8`); the surviving
 *                   `config.research` block had ZERO executable readers (the sole
 *                   `\.research\b` hit in the tree was the comment telling the
 *                   next reader to run that grep). A config key nothing consults
 *                   is not a switch — it is a value that reads as one. The
 *                   honest fix is deletion plus a LOUD landing: the eight
 *                   `RESEARCH_*` variables join `DEAD_ENV_VARS`, so a stale
 *                   dashboard entry is reported rather than silently ignored.
 *
 * A default-value assertion on its own is theatre, so each switch below is
 * paired: the default, the precedence that proves the read is real (an explicit
 * env value still wins / still warns), and — for 2.146 — a separate behavioural
 * witness that the pipeline actually RUNS under the default
 * (`tests/unit/cee.validation-pipeline-default-on.test.ts`).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("L44 activation — config defaults", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("ROADMAP 2.146 — contested-edge validation pipeline is ON by default", () => {
    it("defaults ON with CEE_VALIDATION_PIPELINE_ENABLED entirely unset", async () => {
      process.env = { NODE_ENV: "test", LLM_PROVIDER: "fixtures" };
      expect(process.env.CEE_VALIDATION_PIPELINE_ENABLED).toBeUndefined();

      const { config } = await import("../../src/config/index.js");

      expect(config.cee.validationPipelineEnabled).toBe(true);
    });

    it("an explicit kill-switch still wins — the read is real, not a hardcoded true", async () => {
      process.env = {
        NODE_ENV: "test",
        LLM_PROVIDER: "fixtures",
        CEE_VALIDATION_PIPELINE_ENABLED: "false",
      };

      const { config } = await import("../../src/config/index.js");

      expect(config.cee.validationPipelineEnabled).toBe(false);
    });
  });

  describe("RESEARCH_ENABLED — the reader-less flag is deleted", () => {
    it("the config object carries NO `research` key at all", async () => {
      process.env = { NODE_ENV: "test", LLM_PROVIDER: "fixtures" };

      const { getConfig } = await import("../../src/config/index.js");
      const resolved = getConfig() as Record<string, unknown>;

      // `in` rather than a truthiness check: an undefined-valued key would still
      // be a key, and the claim is that the block is GONE.
      expect("research" in resolved).toBe(false);
      expect(Object.keys(resolved)).not.toContain("research");
    });

    it("a stale RESEARCH_* dashboard entry is reported LOUDLY, not silently ignored", async () => {
      process.env = {
        NODE_ENV: "test",
        LLM_PROVIDER: "fixtures",
        RESEARCH_ENABLED: "true",
        RESEARCH_MODEL: "gpt-4o",
      };

      const { checkDeadEnvVars } = await import("../../src/config/index.js");
      const keys = checkDeadEnvVars().map((w) => w.key);

      expect(keys).toContain("RESEARCH_ENABLED");
      expect(keys).toContain("RESEARCH_MODEL");
    });

    it("the whole RESEARCH_* family is registered dead — no partial sweep", async () => {
      const family = [
        "RESEARCH_ENABLED",
        "RESEARCH_MODEL",
        "RESEARCH_WEB_SEARCH_TOOL_TYPE",
        "RESEARCH_RATE_LIMIT",
        "RESEARCH_RATE_LIMIT_WINDOW_MS",
        "RESEARCH_CACHE_TTL_MS",
        "RESEARCH_CACHE_MAX_SIZE",
        "RESEARCH_TIMEOUT_MS",
      ] as const;
      process.env = { NODE_ENV: "test", LLM_PROVIDER: "fixtures" };
      for (const key of family) process.env[key] = "x";

      const { checkDeadEnvVars } = await import("../../src/config/index.js");
      const keys = checkDeadEnvVars().map((w) => w.key);

      for (const key of family) expect(keys).toContain(key);
    });

    it("NEGATIVE CONTROL: with no RESEARCH_* set, none is reported", async () => {
      process.env = { NODE_ENV: "test", LLM_PROVIDER: "fixtures" };

      const { checkDeadEnvVars } = await import("../../src/config/index.js");
      const keys = checkDeadEnvVars().map((w) => w.key);

      expect(keys.filter((k) => k.startsWith("RESEARCH_"))).toStrictEqual([]);
    });
  });
});
