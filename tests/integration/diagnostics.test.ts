import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";

import { build } from "../../src/server.js";
import { expectNoBannedSubstrings } from "../utils/telemetry-banned-substrings.js";

describe("GET /diagnostics", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("ASSIST_API_KEYS", "diagnostics-test-key");
    vi.stubEnv("CEE_DIAGNOSTICS_ENABLED", "true");
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

    // Ensure diagnostics payload does not contain obvious secrets or headers
    expectNoBannedSubstrings(body as Record<string, any>);
  });
});
