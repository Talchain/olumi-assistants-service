import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";

vi.stubEnv("LLM_PROVIDER", "fixtures");

import { build } from "../../src/server.js";
import { cleanBaseUrl } from "../helpers/env-setup.js";
import { SERVICE_VERSION } from "../../src/version.js";

describe("GET /assist/v1/health (CEE service health)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("ASSIST_API_KEYS", "cee-health-key");
    cleanBaseUrl();
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  const headers = { "X-Olumi-Assist-Key": "cee-health-key" } as const;

  it("returns a CeeServiceHealthSummaryV1-shaped payload", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/assist/v1/health",
      headers,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(typeof body).toBe("object");

    expect(body.service).toBe("assistants");
    expect(body.version).toBe(SERVICE_VERSION);
    expect(body.deterministic_sweep_version).toBe("v3");
    expect(["openai", "anthropic", "fixtures"]).toContain(body.provider);
    expect(typeof body.model).toBe("string");

    expect(["engine", "config"]).toContain(body.limits_source);

    expect(body.feature_flags).toBeDefined();
    expect(typeof body.feature_flags).toBe("object");

    expect(body.cee_config).toBeDefined();
    expect(typeof body.cee_config).toBe("object");
    expect(body.cee_config).toHaveProperty("draft_graph");
    expect(body.cee_config).toHaveProperty("options");
    expect(body.cee_config).toHaveProperty("bias_check");
  });

  it("requires authentication (no API key yields 401/403)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/assist/v1/health",
    });

    expect([401, 403]).toContain(res.statusCode);
  });
});
