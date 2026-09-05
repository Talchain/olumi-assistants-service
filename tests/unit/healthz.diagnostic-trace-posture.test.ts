/**
 * /healthz must REPORT the diagnostic-trace posture, so it can be OBSERVED
 * from outside the service instead of inferred.
 *
 * WHY THIS FILE EXISTS — measured, not hypothesised.
 * -------------------------------------------------
 * `CEE_DIAGNOSTIC_TRACE_ENABLED` was set to "false" on the Render staging
 * service. Every staging witness in the estate depends on the trace it gates:
 * `exit_path` (which path served this turn), `build_sha` (which build answered
 * it) and `prompt_identity` (which prompt produced the graph). The live-journey
 * gate went red 101 consecutive times across 5 days 3 hours with all three
 * null, and nobody could name the cause from the alarm, because:
 *
 *   1. The flag is DASHBOARD-ONLY. Measured at this tip: `rg -a
 *      CEE_DIAGNOSTIC_TRACE_ENABLED render.yaml render-staging.yaml` returns
 *      ZERO hits, with the contrast control `NODE_ENV|CEE_` returning 2 and 1
 *      in the same run — the probe is not blind. Nothing in the repository
 *      records, or can record, its value.
 *   2. The posture IS computed correctly at boot and logged — `event:
 *      config.startup_health`, `diagnostic_trace: <the real gate>`, after the
 *      ISSUE-9020 fix at src/server.ts. But a log line lives inside Render's
 *      log stream. It is not reachable from CI, from a reviewer, or from
 *      anything that could turn it into a finding.
 *
 * So the derivation was never wrong — it was UNOBSERVABLE. `/healthz` is the
 * one surface a remote reader already polls (the live-journey gate's Phase 1
 * polls it on every push to `staging`), and it did not carry the posture.
 *
 * ⚠ DIFFERENTLY-NAMED TWIN — the defect class this estate keeps paying for.
 * `/healthz/detail` already reports `diagnostics_enabled`, which reads a
 * DIFFERENT variable (`CEE_DIAGNOSTICS_ENABLED`). A reader who takes one for
 * the other gets a confident wrong answer. The discrimination is asserted
 * below by driving the two variables in OPPOSITE directions: the field must
 * follow the trace flag and must NOT follow its twin.
 *
 * This exercises the REAL route via `build()`, not a replica. A replicated
 * handler (as in tests/integration/healthz.test.ts) proves only that the test
 * agrees with itself; it is blind to a route that never wires the field up —
 * this repo's dominant defect class.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { build } from "../../src/server.js";
import { _resetConfigCache } from "../../src/config/index.js";
import { cleanBaseUrl } from "../helpers/env-setup.js";

const MANAGED_KEYS = ["CEE_DIAGNOSTIC_TRACE_ENABLED", "CEE_DIAGNOSTICS_ENABLED"] as const;

describe("/healthz — the diagnostic-trace posture is OBSERVABLE, not inferred", () => {
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

  async function healthz(env: Record<string, string>) {
    for (const [k, v] of Object.entries(env)) process.env[k] = v;
    _resetConfigCache();
    const res = await app.inject({ method: "GET", url: "/healthz" });
    return { status: res.statusCode, body: res.json() as Record<string, unknown> };
  }

  it("reports TRUE when the trace flag is on", async () => {
    const { status, body } = await healthz({ CEE_DIAGNOSTIC_TRACE_ENABLED: "true" });
    expect(status).toBe(200);
    expect(body.diagnostic_trace_enabled).toBe(true);
  });

  it("reports FALSE when the trace flag is explicitly off — the measured staging posture", async () => {
    const { status, body } = await healthz({ CEE_DIAGNOSTIC_TRACE_ENABLED: "false" });
    expect(status).toBe(200);
    expect(body.diagnostic_trace_enabled).toBe(false);
  });

  it("reports FALSE when the flag is ABSENT, because the gate DEFAULTS FALSE", async () => {
    // The field must report the gate the code actually consults, never the
    // variable's presence. ISSUE-9020 was exactly this defect one surface over:
    // the startup log derived its own value and printed `true` while the trace
    // was off. There is no second value to keep in step.
    const { status, body } = await healthz({});
    expect(status).toBe(200);
    expect(body.diagnostic_trace_enabled).toBe(false);
  });

  it("⭐ TWIN DISCRIMINATION: it follows the TRACE flag, not the similarly-named CEE_DIAGNOSTICS_ENABLED", async () => {
    // Driven in OPPOSITE directions. A field wired to the wrong variable would
    // agree with a same-direction test perfectly.
    const a = await healthz({ CEE_DIAGNOSTIC_TRACE_ENABLED: "true", CEE_DIAGNOSTICS_ENABLED: "false" });
    expect(a.body.diagnostic_trace_enabled).toBe(true);

    _resetConfigCache();
    const b = await healthz({ CEE_DIAGNOSTIC_TRACE_ENABLED: "false", CEE_DIAGNOSTICS_ENABLED: "true" });
    expect(b.body.diagnostic_trace_enabled).toBe(false);
  });

  it("is a BOOLEAN, so an absent field is distinguishable from a false one", async () => {
    // The live-journey gate reads three states off this: on / off /
    // not-reported-by-this-build. Collapsing "this build does not say" into
    // "it is off" would let the alarm name a deploy-config cause on a build
    // that cannot speak to it.
    const { body } = await healthz({ CEE_DIAGNOSTIC_TRACE_ENABLED: "true" });
    expect(typeof body.diagnostic_trace_enabled).toBe("boolean");
  });
});
