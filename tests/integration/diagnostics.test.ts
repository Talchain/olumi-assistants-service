import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";

import { build } from "../../src/server.js";
import { fastHash } from "../../src/utils/hash.js";
import { expectNoBannedSubstrings } from "../utils/telemetry-banned-substrings.js";

describe("GET /diagnostics", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("ASSIST_API_KEYS", "diagnostics-test-key,non-operator-key");
    vi.stubEnv("CEE_DIAGNOSTICS_ENABLED", "true");
    const operatorKeyId = fastHash("diagnostics-test-key", 8);
    vi.stubEnv("CEE_DIAGNOSTICS_KEY_IDS", operatorKeyId);
    vi.stubEnv("LLM_PROVIDER", "fixtures");

    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  it("returns diagnostics payload when enabled and authorised", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/diagnostics",
      headers: {
        "X-Olumi-Assist-Key": "diagnostics-test-key",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(body.service).toBe("assistants");
    expect(typeof body.version).toBe("string");
    expect(typeof body.timestamp).toBe("string");

    expect(body).toHaveProperty("feature_flags");
    expect(typeof body.feature_flags).toBe("object");

    expect(body).toHaveProperty("cee");
    expect(body.cee).toHaveProperty("config");
    expect(body.cee).toHaveProperty("recent_errors");
    expect(Array.isArray(body.cee.recent_errors)).toBe(true);

    // ISL circuit breaker diagnostics
    expect(body).toHaveProperty("isl");
    expect(body.isl).toHaveProperty("circuit_breaker");
    const cb = body.isl.circuit_breaker;
    expect(cb).toHaveProperty("state");
    expect(["open", "closed"]).toContain(cb.state);
    expect(typeof cb.consecutive_failures).toBe("number");
    expect(typeof cb.threshold).toBe("number");
    expect(typeof cb.pause_ms).toBe("number");
    expect(typeof cb.reset_ms).toBe("number");
    expect(cb.paused_until === null || typeof cb.paused_until === "string").toBe(true);

    // Ensure diagnostics payload does not contain obvious secrets or headers
    expectNoBannedSubstrings(body as Record<string, any>);
  });

  it("returns 403 FORBIDDEN for non-operator keys when diagnostics is operator-gated", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/diagnostics",
      headers: {
        "X-Olumi-Assist-Key": "non-operator-key",
      },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);

    expect(body.schema).toBe("error.v1");
    expect(body.code).toBe("FORBIDDEN");
  });
});

describe("GET /diagnostics - Security: Mandatory Authentication", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("ASSIST_API_KEYS", "test-key");
    vi.stubEnv("CEE_DIAGNOSTICS_ENABLED", "true");
    // Intentionally NOT setting CEE_DIAGNOSTICS_KEY_IDS to test mandatory auth
    vi.stubEnv("LLM_PROVIDER", "fixtures");

    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  it("returns 403 when CEE_DIAGNOSTICS_KEY_IDS is not configured", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/diagnostics",
      headers: {
        "X-Olumi-Assist-Key": "test-key",
      },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);

    expect(body.schema).toBe("error.v1");
    expect(body.code).toBe("FORBIDDEN");
    expect(body.message).toContain("CEE_DIAGNOSTICS_KEY_IDS");
  });

  it("returns 401 without any authentication headers (caught by auth plugin)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/diagnostics",
    });

    // Auth plugin rejects before reaching diagnostics endpoint
    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);

    expect(body.schema).toBe("error.v1");
    expect(body.code).toBe("FORBIDDEN"); // Auth plugin uses FORBIDDEN for missing auth
  });
});
