/**
 * CEE v1 Team Perspectives Integration Tests
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";

vi.stubEnv("LLM_PROVIDER", "fixtures");

import { build } from "../../src/server.js";
import { cleanBaseUrl } from "../helpers/env-setup.js";

describe("POST /assist/v1/team-perspectives (CEE v1)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv(
      "ASSIST_API_KEYS",
      ["cee-team-key-1", "cee-team-key-2", "cee-team-key-rate"].join(","),
    );
    vi.stubEnv("CEE_TEAM_PERSPECTIVES_FEATURE_VERSION", "team-perspectives-test");
    vi.stubEnv("CEE_TEAM_PERSPECTIVES_RATE_LIMIT_RPM", "2");

    cleanBaseUrl();
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  const headersKey1 = { "X-Olumi-Assist-Key": "cee-team-key-1" } as const;
  const headersKey2 = { "X-Olumi-Assist-Key": "cee-team-key-2" } as const;
  const headersRate = { "X-Olumi-Assist-Key": "cee-team-key-rate" } as const;

  it("returns CEETeamPerspectivesResponseV1 for valid request", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/team-perspectives",
      headers: headersKey1,
      payload: {
        perspectives: [
          { id: "p1", stance: "for", confidence: 0.8 },
          { id: "p2", stance: "for", confidence: 0.9 },
          { id: "p3", stance: "against", confidence: 0.7 },
        ],
      },
    });

    expect(res.statusCode).toBe(200);

    expect(res.headers["x-cee-api-version"]).toBe("v1");
    expect(res.headers["x-cee-feature-version"]).toBe("team-perspectives-test");
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

    expect(body.summary).toBeDefined();
    expect(body.summary.participant_count).toBe(3);
    expect(body.summary.for_count).toBe(2);
    expect(body.summary.against_count).toBe(1);
    expect(body.summary.neutral_count).toBe(0);
    expect(body.summary.disagreement_score).toBeGreaterThanOrEqual(0);
    expect(body.summary.disagreement_score).toBeLessThanOrEqual(1);
    expect(typeof body.summary.has_team_disagreement).toBe("boolean");
    expect(body.summary.has_team_disagreement).toBe(false);
    if (body.summary.weighted_for_fraction !== undefined) {
      expect(body.summary.weighted_for_fraction).toBeGreaterThanOrEqual(0);
      expect(body.summary.weighted_for_fraction).toBeLessThanOrEqual(1);
    }

    // Guidance block should be present and derived from quality/validation_issues
    expect(body.guidance).toBeDefined();
    expect(typeof body.guidance.summary).toBe("string");
  });

  it("applies weight semantics: non-positive weights have no influence", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/team-perspectives",
      headers: headersKey1,
      payload: {
        perspectives: [
          { id: "p1", stance: "for", weight: 0 },
          { id: "p2", stance: "for", weight: 2 },
          { id: "p3", stance: "against", weight: 1 },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.summary.participant_count).toBe(3);
    expect(body.summary.for_count).toBe(2);
    expect(body.summary.against_count).toBe(1);
    expect(body.summary.neutral_count).toBe(0);
    if (body.summary.weighted_for_fraction !== undefined) {
      // Only the positive weights (2 for "for", 1 for "against") should contribute.
      expect(body.summary.weighted_for_fraction).toBeCloseTo(2 / 3, 5);
    }
    expect(body.summary.disagreement_score).toBeGreaterThanOrEqual(0);
    expect(body.summary.disagreement_score).toBeLessThanOrEqual(1);
  });

  it("returns CEE_VALIDATION_FAILED for invalid input", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/team-perspectives",
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
      perspectives: [
        { id: "p1", stance: "for" },
        { id: "p2", stance: "against" },
      ],
    };

    const first = await app.inject({
      method: "POST",
      url: "/assist/v1/team-perspectives",
      headers: headersRate,
      payload,
    });
    const second = await app.inject({
      method: "POST",
      url: "/assist/v1/team-perspectives",
      headers: headersRate,
      payload,
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);

    const limited = await app.inject({
      method: "POST",
      url: "/assist/v1/team-perspectives",
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
