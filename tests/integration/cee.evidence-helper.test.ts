import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";

vi.stubEnv("LLM_PROVIDER", "fixtures");

import { build } from "../../src/server.js";
import { cleanBaseUrl } from "../helpers/env-setup.js";

describe("POST /assist/v1/evidence-helper (CEE v1)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv(
      "ASSIST_API_KEYS",
      ["cee-evidence-key-1", "cee-evidence-key-2", "cee-evidence-key-rate"].join(","),
    );
    vi.stubEnv("CEE_EVIDENCE_HELPER_FEATURE_VERSION", "evidence-helper-test");
    vi.stubEnv("CEE_EVIDENCE_HELPER_RATE_LIMIT_RPM", "2");

    cleanBaseUrl();
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  const headersKey1 = { "X-Olumi-Assist-Key": "cee-evidence-key-1" } as const;
  const headersKey2 = { "X-Olumi-Assist-Key": "cee-evidence-key-2" } as const;
  const headersRate = { "X-Olumi-Assist-Key": "cee-evidence-key-rate" } as const;

  it("returns CEEEvidenceHelperResponseV1 for valid request", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/evidence-helper",
      headers: headersKey1,
      payload: {
        evidence: [
          { id: "e1", type: "experiment", source: "exp1" },
          { id: "e2", type: "user_research" },
          { id: "e3", type: "other" },
        ],
      },
    });

    expect(res.statusCode).toBe(200);

    expect(res.headers["x-cee-api-version"]).toBe("v1");
    expect(res.headers["x-cee-feature-version"]).toBe("evidence-helper-test");
    const ceeRequestId = res.headers["x-cee-request-id"];
    expect(typeof ceeRequestId).toBe("string");

    const body = res.json();

    expect(body.trace).toBeDefined();
    expect(body.trace.request_id).toBe(ceeRequestId);
    expect(body.trace.verification).toBeDefined();
    expect(body.trace.verification.schema_valid).toBe(true);
    expect(typeof body.trace.verification.total_stages).toBe("number");

    expect(body.quality).toBeDefined();
    expect(typeof body.quality.overall).toBe("number");
    expect(body.quality.overall).toBeGreaterThanOrEqual(1);
    expect(body.quality.overall).toBeLessThanOrEqual(10);

    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBe(3);

    const byId = new Map<string, any>(body.items.map((i: any) => [i.id as string, i as any]));

    const e1 = byId.get("e1") as any;
    const e2 = byId.get("e2") as any;
    const e3 = byId.get("e3") as any;

    expect(e1.strength).toBe("strong");
    expect(e1.relevance).toBe("high");

    expect(e2.strength).toBe("medium");
    expect(e2.relevance).toBe("medium");

    expect(e3.strength).toBe("weak");
    expect(e3.relevance).toBe("low");

    expect(e1.freshness).toBeUndefined();
    expect(e2.freshness).toBeUndefined();
    expect(e3.freshness).toBeUndefined();

    expect(body.response_limits).toEqual({
      items_max: 20,
      items_truncated: false,
    });

    // Guidance block should be present and derived from quality/limits
    expect(body.guidance).toBeDefined();
    expect(typeof body.guidance.summary).toBe("string");
  });

  it("returns CEE_VALIDATION_FAILED for invalid input", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/evidence-helper",
      headers: headersKey2,
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();

    expect(body.schema).toBe("cee.error.v1");
    expect(body.code).toBe("CEE_VALIDATION_FAILED");
    expect(body.retryable).toBe(false);
    expect(body.trace).toBeDefined();
  });

  it("enforces per-feature rate limiting with CEE_RATE_LIMIT", async () => {
    const payload = {
      evidence: [{ id: "e1", type: "experiment" }],
    };

    const first = await app.inject({
      method: "POST",
      url: "/assist/v1/evidence-helper",
      headers: headersRate,
      payload,
    });
    const second = await app.inject({
      method: "POST",
      url: "/assist/v1/evidence-helper",
      headers: headersRate,
      payload,
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);

    const limited = await app.inject({
      method: "POST",
      url: "/assist/v1/evidence-helper",
      headers: headersRate,
      payload,
    });

    expect(limited.statusCode).toBe(429);
    const body = limited.json();

    expect(body.schema).toBe("cee.error.v1");
    expect(body.code).toBe("CEE_RATE_LIMIT");
    expect(body.retryable).toBe(true);
    expect(body.details?.retry_after_seconds).toBeGreaterThan(0);

    const retryAfter = limited.headers["retry-after"];
    expect(retryAfter).toBeDefined();
    expect(Number(retryAfter)).toBeGreaterThan(0);
  });
});
