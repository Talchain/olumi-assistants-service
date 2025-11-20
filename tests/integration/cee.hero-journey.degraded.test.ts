/**
 * CEE v1 Hero Journey Integration Test (Engine Degraded)
 *
 * Exercises a CEE journey where the upstream engine is marked as degraded via
 * the X-Olumi-Degraded header. Asserts that:
 * - CEE propagates the degraded flag into trace.engine.degraded and a
 *   ENGINE_DEGRADED validation issue.
 * - The SDK buildCeeEngineStatus helper reports a degraded engine without
 *   leaking any brief or graph text.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  SSE_DEGRADED_HEADER_NAME,
  SSE_DEGRADED_REDIS_REASON,
} from "../../src/utils/degraded-mode.js";

// Use fixtures provider for deterministic graphs and zero cost
vi.stubEnv("LLM_PROVIDER", "fixtures");

import { build } from "../../src/server.js";
import {
  buildCeeEngineStatus,
  type CeeEngineStatus,
  type CeeJourneyEnvelopes,
} from "../../sdk/typescript/src/ceeHelpers.js";

describe("CEE hero journey: engine degraded mode", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("ASSIST_API_KEYS", "cee-hero-degraded-key");
    vi.stubEnv("CEE_DRAFT_FEATURE_VERSION", "draft-hero-degraded-test");
    vi.stubEnv("CEE_DRAFT_RATE_LIMIT_RPM", "5");

    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  it("surfaces engine degraded mode in trace and SDK engine status helper", async () => {
    const SECRET = "DO_NOT_LEAK_DEGRADED";

    const draftRes = await app.inject({
      method: "POST",
      url: "/assist/v1/draft-graph",
      headers: {
        "X-Olumi-Assist-Key": "cee-hero-degraded-key",
        [SSE_DEGRADED_HEADER_NAME]: SSE_DEGRADED_REDIS_REASON,
      },
      payload: {
        brief: `Degraded journey decision with secret marker ${SECRET}`,
      },
    });

    expect(draftRes.statusCode).toBe(200);
    const draftBody = draftRes.json() as any;

    // Engine degraded should be reflected in trace.engine.degraded
    expect(draftBody.trace).toBeDefined();
    expect(draftBody.trace.engine).toBeDefined();
    expect(draftBody.trace.engine.degraded).toBe(true);

    // And a warning-level ENGINE_DEGRADED validation issue should be present
    const issues = Array.isArray(draftBody.validation_issues)
      ? (draftBody.validation_issues as any[])
      : [];

    expect(issues.some((i) => i.code === "ENGINE_DEGRADED" && i.severity === "warning")).toBe(
      true,
    );

    const envelopes: CeeJourneyEnvelopes = { draft: draftBody };
    const status: CeeEngineStatus | undefined = buildCeeEngineStatus(envelopes);

    expect(status).toBeDefined();
    expect(status?.degraded).toBe(true);
    expect(typeof status?.provider === "string" || status?.provider === undefined).toBe(true);
    expect(typeof status?.model === "string" || status?.model === undefined).toBe(true);

    // Privacy: ensure the secret marker does not leak into the engine status summary
    const serialized = JSON.stringify(status).toLowerCase();
    expect(serialized.includes(SECRET.toLowerCase())).toBe(false);
  });
});
