/**
 * Production-deployment gates: security gates hold on the production DEPLOYMENT,
 * whatever behaviour labels (OLUMI_ENV, NODE_ENV) that deployment runs under.
 *
 * Every row runs with BOTH labels set to a non-production value, and differs only in
 * OLUMI_DEPLOYMENT. The "declared" rows must close each gate; the "undeclared" rows are
 * the controls and must leave today's behaviour untouched (the predicate only ever adds
 * a restriction). Model versions are exempt by design and are pinned by identity.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isProductionDeployment } from "../../src/config/env-resolver.js";
import { config, _resetConfigCache } from "../../src/config/index.js";
import { promptCaptureMayRideTheWire } from "../../src/orchestrator-v5/debug/turn-debug-store.js";
import { createObservabilityCollector } from "../../src/cee/observability/collector.js";
import { isRawOutputPermitted } from "../../src/routes/assist.v1.draft-graph.js";
import { runConnectivity } from "../../src/cee/unified-pipeline/stages/repair/connectivity.js";
import type { StageContext } from "../../src/cee/unified-pipeline/types.js";

const LABELS = { OLUMI_ENV: "staging", NODE_ENV: "staging" } as const;
const KEYS = ["OLUMI_ENV", "NODE_ENV", "OLUMI_DEPLOYMENT", "RENDER_SERVICE_NAME", "CEE_TURN_DEBUG_ENABLED",
  "CEE_OBSERVABILITY_RAW_IO", "CEE_MODEL_VERSIONS_ENABLED"] as const;

let saved: Record<string, string | undefined>;
function setEnv(env: Partial<Record<(typeof KEYS)[number], string>>) {
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, env);
  _resetConfigCache();
}

beforeEach(() => { saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]])); });
afterEach(() => {
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  _resetConfigCache();
});

const DECLARED = { ...LABELS, OLUMI_DEPLOYMENT: "production" };
const UNDECLARED = { ...LABELS };

describe("isProductionDeployment()", () => {
  it.each([
    ["production", true],
    [" Production ", true],
    ["staging", false],
    ["prod", false],
    ["", false],
  ])("OLUMI_DEPLOYMENT=%j → %s", (value, want) => {
    setEnv({ ...LABELS, OLUMI_DEPLOYMENT: value });
    expect(isProductionDeployment()).toBe(want);
  });

  it("is independent of the behaviour labels: OLUMI_ENV=prod or a Render service name alone does not declare it", () => {
    setEnv({ OLUMI_ENV: "prod", NODE_ENV: "production", RENDER_SERVICE_NAME: "cee-production" });
    expect(isProductionDeployment()).toBe(false);
  });
});

describe("gates close on a declared production deployment, and only there", () => {
  it.each([
    ["declared", DECLARED, false],
    ["undeclared (control)", UNDECLARED, true],
  ])("turn prompt capture on the wire (debug enabled) — %s", (_name, env, want) => {
    setEnv({ ...env, CEE_TURN_DEBUG_ENABLED: "true" });
    expect(config.cee.turnDebugEnabled).toBe(true);
    expect(promptCaptureMayRideTheWire()).toBe(want);
  });

  it.each([
    ["declared", DECLARED, false],
    ["undeclared (control)", UNDECLARED, true],
  ])("env-enforced raw IO flag set true — %s", (_name, env, want) => {
    setEnv({ ...env, CEE_OBSERVABILITY_RAW_IO: "true" });
    expect(config.cee.observabilityRawIO).toBe(want);
  });

  it.each([
    ["declared", DECLARED, false],
    ["undeclared (control)", UNDECLARED, true],
  ])("observability collector raw IO (capture requested) — %s", (_name, env, want) => {
    setEnv({ ...env });
    const collector = createObservabilityCollector({ requestId: "req-gate", captureRawIO: true } as any);
    expect((collector.build() as { raw_io_included: boolean }).raw_io_included).toBe(want);
  });

  it.each([
    ["declared, no admin", DECLARED, false, false],
    ["declared, admin", DECLARED, true, true],
    ["undeclared, no admin (control)", UNDECLARED, false, true],
  ])("draft-graph raw_output requested — %s", (_name, env, admin, want) => {
    setEnv({ ...env });
    expect(isRawOutputPermitted(true, admin)).toBe(want);
    expect(isRawOutputPermitted(false, true)).toBe(false);
  });

  it.each([
    ["declared", DECLARED, true],
    ["undeclared (control)", UNDECLARED, false],
  ])("fault-injection header on the repair stage — %s", (_name, env, riskSurvives) => {
    setEnv({ ...env });
    const ctx = {
      requestId: "req-gate",
      request: { headers: { "x-debug-force-missing-kinds": "risk" } },
      input: { brief: "Should we raise prices to grow revenue?" },
      graph: {
        nodes: [
          { id: "d1", kind: "decision", label: "Pricing" },
          { id: "o1", kind: "option", label: "Raise" },
          { id: "o2", kind: "option", label: "Hold" },
          { id: "f1", kind: "factor", label: "Price" },
          { id: "out1", kind: "outcome", label: "Revenue" },
          { id: "r1", kind: "risk", label: "Churn" },
          { id: "g1", kind: "goal", label: "Grow revenue" },
        ],
        edges: [
          { from: "d1", to: "o1" }, { from: "d1", to: "o2" },
          { from: "o1", to: "f1" }, { from: "o2", to: "f1" },
          { from: "f1", to: "out1" }, { from: "f1", to: "r1" },
          { from: "out1", to: "g1" }, { from: "r1", to: "g1" },
        ],
      },
    } as unknown as StageContext;
    runConnectivity(ctx);
    expect((ctx.graph as any).nodes.some((n: any) => n.id === "r1")).toBe(riskSurvives);
  });
});

describe("exempt: model versions stay as configured on a declared production deployment", () => {
  it.each([
    ["declared", DECLARED],
    ["undeclared", UNDECLARED],
  ])("CEE_MODEL_VERSIONS_ENABLED=true — %s", (_name, env) => {
    setEnv({ ...env, CEE_MODEL_VERSIONS_ENABLED: "true" });
    expect(config.cee.modelVersionsEnabled).toBe(true);
  });

  it("OLUMI_ENV=prod still locks it, unchanged", () => {
    setEnv({ OLUMI_ENV: "prod", NODE_ENV: "production", CEE_MODEL_VERSIONS_ENABLED: "true" });
    expect(config.cee.modelVersionsEnabled).toBe(false);
  });
});
