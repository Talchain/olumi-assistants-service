/**
 * MC PROBE (design note, 6 Oct 2026) — NOT FOR MERGE AS-IS.
 *
 * Pins what PLoT's factor-review callback gets back from this route.
 * The payload below is PLoT's `factorReviewV2` body shape, copied from the
 * producer (`plot-lite-service` staging 0f21df07, `src/cee/client.ts:384-405`):
 * `{ brief, graph: { nodes: [{id,label,kind}], edges: [{from,to}] } }`,
 * posted to `/assist/v1/review?schema=v2`. PLoT's own test pins that the body
 * carries no `factor_sensitivity` (`tests/cee-factor-review.test.ts:71-79`).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";

vi.stubEnv("LLM_PROVIDER", "fixtures");

const extractionCalls = vi.hoisted(() => ({ count: 0 }));

vi.mock("../../src/adapters/llm/extraction.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/adapters/llm/extraction.js")>();
  return {
    ...original,
    callLLMForExtraction: async (...args: Parameters<typeof original.callLLMForExtraction>) => {
      extractionCalls.count += 1;
      return original.callLLMForExtraction(...args);
    },
  };
});

import { build } from "../../src/server.js";

describe("MC probe: PLoT factor-review callback on /assist/v1/review", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("ASSIST_API_KEYS", "test-key");
    vi.stubEnv("CEE_REVIEW_RATE_LIMIT_RPM", "100");
    app = await build();
  });

  afterAll(async () => {
    await app.close();
  });

  // PLoT's stripped graph: id/label/kind nodes, from/to edges, nothing else.
  const plotStrippedGraph = {
    nodes: [
      { id: "goal_1", label: "Monthly revenue", kind: "goal" },
      { id: "decision_1", label: "Pricing", kind: "decision" },
      { id: "option_1", label: "Raise prices", kind: "option" },
      { id: "option_2", label: "Hold prices", kind: "option" },
      { id: "factor_1", label: "Price per seat", kind: "factor" },
    ],
    edges: [
      { from: "decision_1", to: "option_1" },
      { from: "decision_1", to: "option_2" },
      { from: "option_1", to: "factor_1" },
      { from: "option_2", to: "factor_1" },
      { from: "factor_1", to: "goal_1" },
    ],
  };
  const brief = "We need to decide whether to raise prices to lift monthly revenue to at least 50000.";

  const post = (payload: unknown) =>
    app.inject({
      method: "POST",
      url: "/assist/v1/review?schema=v2",
      headers: { "content-type": "application/json", "x-olumi-assist-key": "test-key" },
      payload: payload as Record<string, unknown>,
    });

  it("TARGET: PLoT's exact body (brief + stripped graph, no sensitivity) yields no factor_enrichments and no extraction call", async () => {
    extractionCalls.count = 0;
    const response = await post({ brief, graph: plotStrippedGraph });
    const body = JSON.parse(response.body) as Record<string, unknown>;
    // eslint-disable-next-line no-console
    console.log("PROBE target", JSON.stringify({
      status: response.statusCode,
      has_key: "factor_enrichments" in body,
      factor_enrichments: body.factor_enrichments ?? null,
      error: (body as { error?: unknown }).error ?? null,
      extraction_calls: extractionCalls.count,
    }));
    expect(body.factor_enrichments).toBeUndefined();
    expect(extractionCalls.count).toBe(0);
  });

  it("CONTRAST: the same body plus robustness_data.factor_sensitivity reaches the extraction call", async () => {
    extractionCalls.count = 0;
    const response = await post({
      brief,
      graph: plotStrippedGraph,
      robustness_data: {
        factor_sensitivity: [
          { factor_id: "factor_1", factor_label: "Price per seat", elasticity: 0.6, importance_rank: 1 },
        ],
      },
    });
    const body = JSON.parse(response.body) as Record<string, unknown>;
    // eslint-disable-next-line no-console
    console.log("PROBE contrast", JSON.stringify({
      status: response.statusCode,
      has_key: "factor_enrichments" in body,
      enrichment_count: Array.isArray(body.factor_enrichments) ? body.factor_enrichments.length : null,
      error: (body as { error?: unknown }).error ?? null,
      extraction_calls: extractionCalls.count,
    }));
    expect(response.statusCode).toBe(200);
    expect(extractionCalls.count).toBeGreaterThan(0);
  });
});
