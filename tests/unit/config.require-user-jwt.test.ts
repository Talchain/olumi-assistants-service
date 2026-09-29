/**
 * CEE_REQUIRE_USER_JWT × service-auth presence — fail-closed boot refine.
 *
 * The user-identity carve-out (src/orchestrator/user-identity.ts) treats a
 * JWT-less request under CEE_REQUIRE_USER_JWT=true as a key-authed service
 * caller — an assumption the auth plugin only upholds when at least one
 * assist key or an HMAC secret is configured (src/plugins/auth.ts). With no
 * service auth at all the plugin skips every check, so flag-on + keyless
 * would silently reopen the x-user-id IDOR on /orchestrate/v2/turn.
 *
 * Pins:
 *  - flag ON + no ASSIST_API_KEY / ASSIST_API_KEYS / HMAC secret → boot
 *    fails ("Configuration validation failed");
 *  - flag ON + any single service-auth source → boots;
 *  - whitespace-only keys do NOT count as service auth (trim semantics
 *    match server.ts's production fail-fast);
 *  - flag OFF + keyless → boots (today's default posture, unchanged).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { config, _resetConfigCache } from "../../src/config/index.js";

const SERVICE_AUTH_ENV_VARS = [
  "ASSIST_API_KEY",
  "ASSIST_API_KEYS",
  "CEE_HMAC_SECRET",
  "HMAC_SECRET",
] as const;

function clearServiceAuthEnv(): void {
  for (const key of SERVICE_AUTH_ENV_VARS) delete process.env[key];
}

function touchConfig(): void {
  // Any property access triggers the lazy parse.
  void config.auth.requireUserJwt;
}

describe("CEE_REQUIRE_USER_JWT requires configured service auth (fail-closed boot)", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    _resetConfigCache();
  });

  afterEach(() => {
    process.env = originalEnv;
    _resetConfigCache();
  });

  it("flag ON + no API keys and no HMAC → boot fails closed", () => {
    clearServiceAuthEnv();
    process.env.CEE_REQUIRE_USER_JWT = "true";
    _resetConfigCache();

    expect(touchConfig).toThrow("Configuration validation failed");
    expect(touchConfig).toThrow(/CEE_REQUIRE_USER_JWT/);
  });

  it("flag ON + whitespace-only key material → still fails closed", () => {
    clearServiceAuthEnv();
    process.env.CEE_REQUIRE_USER_JWT = "true";
    process.env.ASSIST_API_KEY = "   ";
    process.env.ASSIST_API_KEYS = " , ,";
    _resetConfigCache();

    expect(touchConfig).toThrow("Configuration validation failed");
  });

  it("flag ON + legacy single ASSIST_API_KEY → boots", () => {
    clearServiceAuthEnv();
    process.env.CEE_REQUIRE_USER_JWT = "true";
    process.env.ASSIST_API_KEY = "test-key-1";
    _resetConfigCache();

    expect(touchConfig).not.toThrow();
    expect(config.auth.requireUserJwt).toBe(true);
  });

  it("flag ON + ASSIST_API_KEYS list → boots", () => {
    clearServiceAuthEnv();
    process.env.CEE_REQUIRE_USER_JWT = "true";
    process.env.ASSIST_API_KEYS = "key-a,key-b";
    _resetConfigCache();

    expect(touchConfig).not.toThrow();
  });

  it.each(["CEE_HMAC_SECRET", "HMAC_SECRET"])(
    "flag ON + %s only → boots",
    (hmacVar) => {
      clearServiceAuthEnv();
      process.env.CEE_REQUIRE_USER_JWT = "true";
      process.env[hmacVar] = "shared-secret";
      _resetConfigCache();

      expect(touchConfig).not.toThrow();
    },
  );

  it("flag OFF (default) + keyless → boots (legacy posture unchanged)", () => {
    clearServiceAuthEnv();
    delete process.env.CEE_REQUIRE_USER_JWT;
    _resetConfigCache();

    expect(touchConfig).not.toThrow();
    expect(config.auth.requireUserJwt).toBe(false);
  });

  it("flag explicitly 'false' + keyless → boots", () => {
    clearServiceAuthEnv();
    process.env.CEE_REQUIRE_USER_JWT = "false";
    _resetConfigCache();

    expect(touchConfig).not.toThrow();
  });
});
