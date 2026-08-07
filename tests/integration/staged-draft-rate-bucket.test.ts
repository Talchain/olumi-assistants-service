/**
 * ROADMAP 1.204 M1 — the staged route SHARES the pre-existing stream route's
 * rate-limit bucket.
 *
 * Why this test exists: the route originally passed `feature: "draft_graph_staged"`
 * while carrying a comment promising a *"shared draft-tier bucket … so a client
 * cannot use the staged sibling to sidestep the draft budget"*. That promise was
 * false. `enforceRateBuckets` keys its bucket map by the `feature` STRING
 * (cee/config/limits.ts), so a distinct name mints a SEPARATE bucket and hands a
 * client a whole extra allowance of the most expensive operation in the service.
 * Only the RPM *value* was shared, not the bucket.
 *
 * A comment is not a mechanism. This is the mechanism.
 *
 * The test discriminates: with the draft tier set to 2 RPM, two staged calls
 * exhaust the shared allowance and the third call — made against the OTHER
 * route — must be refused. If the two routes had separate buckets that third
 * call would be the first in its own bucket and would succeed.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";

vi.stubEnv("LLM_PROVIDER", "fixtures");
// Two requests per minute, so the boundary is reachable in a fast test.
vi.stubEnv("CEE_RATE_BUCKET_DRAFT_RPM", "2");

vi.mock("../../src/utils/fixtures.js", async (importOriginal) => {
  const mod = (await importOriginal()) as Record<string, unknown>;
  const pristineGraph = structuredClone(mod.fixtureGraph);
  return { ...mod, get fixtureGraph() { return structuredClone(pristineGraph); } };
});

vi.mock("../../src/services/validateClient.js", () => ({
  validateGraph: vi.fn().mockResolvedValue({ ok: true, violations: [], normalized: undefined }),
}));

import { build } from "../../src/server.js";
import { cleanBaseUrl } from "../helpers/env-setup.js";

const PAYLOAD = { brief: "A sufficiently long decision brief to pass validation and exercise the pipeline." };

describe("staged draft rate limiting", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    delete process.env.ASSIST_API_KEY;
    delete process.env.ASSIST_API_KEYS;
    cleanBaseUrl();
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  const call = (url: string) =>
    app.inject({ method: "POST", url, payload: PAYLOAD, headers: { accept: "text/event-stream" } });

  it("consumes the SAME bucket as the pre-existing stream route", async () => {
    // Spend the whole allowance on the staged sibling.
    expect((await call("/assist/v1/draft-graph/staged")).statusCode).toBe(200);
    expect((await call("/assist/v1/draft-graph/staged")).statusCode).toBe(200);

    // Now the OTHER route must be refused. This is the discriminating
    // assertion: it can only pass if both routes draw on one allowance.
    const spillover = await call("/assist/v1/draft-graph/stream");
    expect(
      spillover.statusCode,
      "the staged route minted its own rate-limit bucket — a client gets a second full streaming allowance",
    ).toBe(429);
  });
});
