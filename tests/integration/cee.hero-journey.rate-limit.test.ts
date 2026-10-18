/**
 * CEE v1 Hero Journey Integration Test (partial journey)
 *
 * Runs a real Draft, then builds a partial CeeJourneySummary via the SDK helper
 * with a synthetic options envelope (the options and evidence-helper routes were
 * deleted with R2). Asserts the journey is incomplete and that no brief text
 * leaks into journey metadata.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";

// Use fixtures provider for deterministic graphs and zero cost
vi.stubEnv("LLM_PROVIDER", "fixtures");

import { build } from "../../src/server.js";
import { cleanBaseUrl } from "../helpers/env-setup.js";
import {
  buildCeeJourneySummary,
  type CeeJourneySummary,
} from "../../sdk/typescript/src/ceeHelpers.js";

describe("CEE SDK partial journey with a synthetic legacy envelope", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("ASSIST_API_KEYS", "cee-hero-rate-limit-key");
    vi.stubEnv("CEE_DRAFT_FEATURE_VERSION", "draft-hero-rate-limit-test");
    vi.stubEnv("CEE_DRAFT_RATE_LIMIT_RPM", "5");

    cleanBaseUrl();
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  it("builds an incomplete journey without leaking brief text", async () => {
    const SECRET = "DO_NOT_LEAK_RATE_LIMIT";

    // 1) Draft My Model
    const draftRes = await app.inject({
      method: "POST",
      url: "/assist/v1/draft-graph?schema=v1",
      headers: { "X-Olumi-Assist-Key": "cee-hero-rate-limit-key" },
      payload: {
        brief: `Rate-limit journey decision with secret marker ${SECRET}`,
      },
    });

    expect(draftRes.statusCode).toBe(200);
    const draftBody = draftRes.json();
    // Synthetic legacy envelope keeps the retained SDK contract checks.
    const optionsBody: any = { options: [{ id: "option-fixture" }], quality: { overall: 7 }, trace: { request_id: "sdk-fixture" } };

    // Build a journey summary from the envelopes that succeeded (draft + options).
    const journey: CeeJourneySummary = buildCeeJourneySummary({
      draft: draftBody,
      options: optionsBody,
    });

    expect(typeof journey.story.headline).toBe("string");
    expect(journey.story.headline.length).toBeGreaterThan(0);
    expect(journey.is_complete).toBe(false);
    expect(journey.missing_envelopes).toContain("evidence");

    // Privacy: ensure the secret marker does not leak into error or journey metadata
    const serialized = JSON.stringify({ journey }).toLowerCase();
    expect(serialized.includes(SECRET.toLowerCase())).toBe(false);
  });
});
