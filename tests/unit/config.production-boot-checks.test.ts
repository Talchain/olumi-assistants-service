/**
 * Boot refusals and Redis TLS verification hold on the declared production DEPLOYMENT
 * (OLUMI_DEPLOYMENT=production), whatever label it runs under; unset, the label alone
 * decides, exactly as before. Each declared row has an undeclared control.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assertNoWildcardOrigin, assertAuthConfigured } from "../../src/config/production-boot-checks.js";
import { shouldVerifyRedisTls } from "../../src/platform/redis.js";
import { _resetConfigCache } from "../../src/config/index.js";

const KEYS = ["OLUMI_DEPLOYMENT", "NODE_ENV", "OLUMI_ENV"] as const;
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

const DECLARED = { NODE_ENV: "staging", OLUMI_ENV: "staging", OLUMI_DEPLOYMENT: "production" };
const UNDECLARED = { NODE_ENV: "staging", OLUMI_ENV: "staging" };
const LABELLED = { NODE_ENV: "production" };

/** The exact refusal, or null: another error must not count as the refusal. */
function refusal(fn: () => void, message: string): string | null {
  try { fn(); return null; } catch (e) { return String((e as Error).message) === message ? message : `OTHER: ${String(e)}`; }
}
const CORS = "FATAL: ALLOWED_ORIGINS cannot contain '*' in production";
const AUTH = "FATAL: In production, at least one ASSIST_API_KEY/ASSIST_API_KEYS or HMAC_SECRET must be configured";

describe("wildcard CORS origin refused at boot", () => {
  it.each([
    ["declared deployment, label staging", DECLARED, ["https://olumi.netlify.app", "*"], CORS],
    ["declared deployment, quoted wildcard", DECLARED, ['"*"'], CORS],
    ["production label (unchanged)", LABELLED, ["*"], CORS],
    ["declared deployment, no wildcard", DECLARED, ["https://olumi.netlify.app"], null],
    ["undeclared, label staging (control)", UNDECLARED, ["*"], null],
  ])("%s", (_n, env, origins, want) => {
    setEnv(env);
    expect(refusal(() => assertNoWildcardOrigin(origins, process.env.NODE_ENV), CORS)).toBe(want);
  });
});

describe("missing authentication refused at boot", () => {
  it.each([
    ["declared deployment, no key, no HMAC", DECLARED, false, false, AUTH],
    ["declared deployment, API key", DECLARED, true, false, null],
    ["declared deployment, HMAC only", DECLARED, false, true, null],
    ["production label, no key, no HMAC (unchanged)", LABELLED, false, false, AUTH],
    ["undeclared, label staging, no key, no HMAC (control)", UNDECLARED, false, false, null],
  ])("%s", (_n, env, hasKeys, hasHmac, want) => {
    setEnv(env);
    expect(refusal(() => assertAuthConfigured(process.env.NODE_ENV, hasKeys, hasHmac), AUTH)).toBe(want);
  });
});

describe("Redis TLS certificate verification", () => {
  it.each([
    ["declared deployment, label staging", DECLARED, true],
    ["production label (unchanged)", LABELLED, true],
    ["undeclared, label staging (control)", UNDECLARED, false],
  ])("%s", (_n, env, want) => {
    setEnv(env);
    expect(shouldVerifyRedisTls()).toBe(want);
  });
});

describe("wiring: the boot and TLS sites call the helpers, not a label-only check", () => {
  const server = readFileSync(join(process.cwd(), "src/server.ts"), "utf-8");
  const redis = readFileSync(join(process.cwd(), "src/platform/redis.ts"), "utf-8");
  it("server.ts refuses through assertNoWildcardOrigin and assertAuthConfigured", () => {
    expect(server).toContain("assertNoWildcardOrigin(origins, env.NODE_ENV)");
    expect(server).toContain("assertAuthConfigured(nodeEnv, hasApiKeys, hasHmacSecret)");
    expect(server).not.toMatch(/=== ["']production["'] && origins\.some/);
    expect(server).not.toMatch(/nodeEnv === ['"]production['"] && !hasApiKeys/);
  });
  it("redis.ts verifies TLS through shouldVerifyRedisTls", () => {
    expect(redis).toContain("rejectUnauthorized: shouldVerifyRedisTls()");
  });
});
