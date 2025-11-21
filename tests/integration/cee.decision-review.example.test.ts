import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";

import { build } from "../../src/server.js";
import { expectNoSecretLikeKeys } from "../utils/no-secret-like-keys.js";
import { expectNoBannedSubstrings } from "../utils/telemetry-banned-substrings.js";

describe("GET /assist/v1/decision-review/example", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("ASSIST_API_KEYS", "cee-decision-review-example-key");
    vi.stubEnv("LLM_PROVIDER", "fixtures");

    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  it("returns a CeeDecisionReviewPayloadV1-like payload and remains metadata-only", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/assist/v1/decision-review/example",
      headers: {
        "X-Olumi-Assist-Key": "cee-decision-review-example-key",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");

    const body = res.json() as Record<string, unknown>;

    // Structural spot-checks against CeeDecisionReviewPayloadV1
    expect(body.story).toBeDefined();
    const story = body.story as Record<string, unknown>;
    expect(typeof story.headline).toBe("string");
    expect(Array.isArray(story.key_drivers)).toBe(true);
    expect(Array.isArray(story.risks_and_gaps)).toBe(true);
    expect(Array.isArray(story.next_actions)).toBe(true);
    expect(typeof story.any_truncated).toBe("boolean");

    expect(body.journey).toBeDefined();
    const journey = body.journey as Record<string, any>;
    expect(journey.story).toBeDefined();
    expect(journey.health).toBeDefined();
    expect(["ok", "warning", "risk"]).toContain(journey.health.overallStatus);
    expect(["success", "warning", "danger"]).toContain(journey.health.overallTone);

    expect(body.uiFlags).toBeDefined();
    const uiFlags = body.uiFlags as Record<string, unknown>;
    expect(typeof uiFlags.is_journey_complete).toBe("boolean");

    // Privacy guards: no secret-like keys or banned substrings
    expectNoSecretLikeKeys(body);
    expectNoBannedSubstrings(body as Record<string, any>);
  });
});
