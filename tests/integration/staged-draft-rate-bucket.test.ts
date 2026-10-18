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

  it("refuses the third staged call once the draft-tier allowance is spent", async () => {
    // Spend the whole allowance (2 RPM) on the staged route.
    expect((await call("/assist/v1/draft-graph/staged")).statusCode).toBe(200);
    expect((await call("/assist/v1/draft-graph/staged")).statusCode).toBe(200);

    // The third call in the same minute must be refused at the draft-tier boundary.
    const third = await call("/assist/v1/draft-graph/staged");
    expect(third.statusCode, "the staged route is not rate-limited at the draft tier").toBe(429);
  });
});
