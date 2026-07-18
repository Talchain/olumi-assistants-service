/**
 * Gate 0 — /healthz must REFUSE READINESS when a production runtime would
 * serve the PMS staging pointer.
 *
 * WHY THIS FILE EXISTS. The 503 is the actual safety mechanism: `/healthz` is
 * Render's `healthCheckPath`, so a 503 stops a misconfigured production deploy
 * from ever taking traffic. The DECISION (`resolvePromptEnvironment().
 * blocksReadiness`) is unit-tested and mutation-checked in
 * tests/unit/config.prompt-environment.test.ts — but nothing proved the
 * ENDPOINT honours it. A refactor could sever the wiring while every
 * decision-logic test stayed green. That is this repo's dominant defect class
 * (machinery that reads as a guarantee but never executes), so the mechanism
 * gets its own test that exercises the real route.
 *
 * (An earlier revision of this change claimed such a test was impossible
 * because `src/server.ts` "builds Fastify in a closure with no export". That
 * was FALSE — `export async function build()` is at src/server.ts:144 and
 * dozens of tests already use it. The claim came from grepping a hand-written
 * list of export SHAPES that never included a factory function.)
 *
 * The handler resolves the prompt environment PER REQUEST, so the app is built
 * once and the environment is varied between injects.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { build } from "../../src/server.js";
import { _resetConfigCache } from "../../src/config/index.js";
import { cleanBaseUrl } from "../helpers/env-setup.js";
import {
  RENDER_PROD_SERVICE_NAME,
  RENDER_STAGING_SERVICE_NAME,
} from "../helpers/render-service-names.js";

const MANAGED_KEYS = [
  "NODE_ENV",
  "DD_ENV",
  "OLUMI_ENV",
  "RENDER_SERVICE_NAME",
  "PROMPTS_ENVIRONMENT",
  "PROMPTS_USE_STAGING",
] as const;

describe("/healthz — prompt-environment readiness gate", () => {
  let app: FastifyInstance;
  let originalEnv: NodeJS.ProcessEnv;

  beforeAll(async () => {
    process.env.LLM_PROVIDER = "fixtures";
    cleanBaseUrl();
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    originalEnv = { ...process.env };
    for (const k of MANAGED_KEYS) delete process.env[k];
    _resetConfigCache();
  });

  afterEach(() => {
    process.env = originalEnv;
    _resetConfigCache();
  });

  /** Apply an env shape and hit the real route. */
  async function healthz(env: Record<string, string>) {
    for (const [k, v] of Object.entries(env)) process.env[k] = v;
    _resetConfigCache();
    const res = await app.inject({ method: "GET", url: "/healthz" });
    return { status: res.statusCode, body: res.json() as Record<string, unknown> };
  }

  // ---------------------------------------------------------------------
  // THE MECHANISM — it must actually fire.
  // ---------------------------------------------------------------------
  it("REFUSES readiness (503) when a discriminating prod runtime resolves the staging pointer", async () => {
    const { status, body } = await healthz({
      NODE_ENV: "production",
      OLUMI_ENV: "prod",
      PROMPTS_ENVIRONMENT: "staging",
    });

    expect(status).toBe(503);
    expect(body.ok).toBe(false);
    expect(body.prompts_ready).toBe(false);
    expect(body.not_ready_reason).toBe("prompt_env_conflicts_with_runtime");
    expect(body.degraded_reasons).toContain("prompt_env_conflicts_with_runtime");
    // The message must tell an operator how to fix it.
    expect(String(body.message)).toContain("PROMPTS_ENVIRONMENT=production");
  });

  it("REFUSES readiness (503) when the prod verdict comes from RENDER_SERVICE_NAME", async () => {
    const { status, body } = await healthz({
      NODE_ENV: "production",
      RENDER_SERVICE_NAME: RENDER_PROD_SERVICE_NAME,
      PROMPTS_USE_STAGING: "true",
    });
    expect(status).toBe(503);
    expect(body.not_ready_reason).toBe("prompt_env_conflicts_with_runtime");
  });

  // ---------------------------------------------------------------------
  // POSITIVE CONTROL — the route returns 200 for every legitimate shape.
  //
  // Without these, the 503 assertions above would still pass if the endpoint
  // simply always returned 503. These prove the gate DISCRIMINATES rather
  // than blanket-failing.
  // ---------------------------------------------------------------------
  it("POSITIVE CONTROL: the real production shape is READY (200) and serves the production pointer", async () => {
    // NODE_ENV=production, DD_ENV=staging, no explicit prompt env — i.e. the
    // production service EXACTLY as it is configured today, BEFORE the env
    // checklist is applied. The first July deploy must not be bricked.
    const { status, body } = await healthz({
      NODE_ENV: "production",
      DD_ENV: "staging",
      RENDER_SERVICE_NAME: RENDER_PROD_SERVICE_NAME,
    });

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.prompt_environment).toBe("production");
    // Loud but not fatal: the undeclared prompt env is surfaced.
    expect(body.degraded_reasons).toContain("prompt_env_unset_on_deployed_env");
  });

  it("POSITIVE CONTROL: production WITH the checklist applied is READY (200), no degraded reasons from prompt env", async () => {
    const { status, body } = await healthz({
      NODE_ENV: "production",
      DD_ENV: "staging",
      OLUMI_ENV: "prod",
      RENDER_SERVICE_NAME: RENDER_PROD_SERVICE_NAME,
      PROMPTS_ENVIRONMENT: "production",
    });

    expect(status).toBe(200);
    expect(body.prompt_environment).toBe("production");
    const reasons = (body.degraded_reasons ?? []) as string[];
    expect(reasons).not.toContain("prompt_env_conflicts_with_runtime");
    expect(reasons).not.toContain("prompt_env_unset_on_deployed_env");
  });

  it("POSITIVE CONTROL: the staging service is READY (200) and serves the staging pointer", async () => {
    const { status, body } = await healthz({
      NODE_ENV: "production",
      DD_ENV: "staging",
      RENDER_SERVICE_NAME: RENDER_STAGING_SERVICE_NAME,
      PROMPTS_ENVIRONMENT: "staging",
    });

    expect(status).toBe(200);
    expect(body.prompt_environment).toBe("staging");
  });

  it("POSITIVE CONTROL: staging with RENDER_SERVICE_NAME ABSENT is READY (200), not bricked", async () => {
    // The load-bearing carve-out: the prod verdict here comes only from the
    // AMBIGUOUS NODE_ENV fallback (both Render services set
    // NODE_ENV=production), so the gate must flag but NOT refuse. If this ever
    // goes 503, the discriminating-source rule has been lost and the staging
    // deploy is bricked.
    const { status, body } = await healthz({
      NODE_ENV: "production",
      DD_ENV: "staging",
      PROMPTS_ENVIRONMENT: "staging",
    });

    expect(status).toBe(200);
    expect(body.prompt_environment).toBe("staging");
    expect(body.degraded_reasons).toContain("prompt_env_conflicts_with_runtime");
  });

  it("POSITIVE CONTROL: local development is READY (200)", async () => {
    const { status, body } = await healthz({ NODE_ENV: "development" });
    expect(status).toBe(200);
    expect(body.prompt_environment).toBe("staging");
  });

  it("blank PROMPTS_USE_STAGING does not flip the staging service to the production pointer", async () => {
    // Endpoint-level guard for the P1 fixed in config/index.ts.
    const { status, body } = await healthz({
      NODE_ENV: "production",
      RENDER_SERVICE_NAME: RENDER_STAGING_SERVICE_NAME,
      PROMPTS_ENVIRONMENT: "staging",
      PROMPTS_USE_STAGING: "",
    });
    expect(status).toBe(200);
    expect(body.prompt_environment).toBe("staging");
  });
});
