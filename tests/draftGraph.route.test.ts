import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import draftRoute from "../src/routes/assist.draft-graph.js";
import { fixtureGraph } from "../src/utils/fixtures.js";
import { cleanBaseUrl } from "./helpers/env-setup.js";

const getAdapterMock = vi.fn();
const validateGraphMock = vi.fn();
const allowedCostMock = vi.fn();

vi.mock("../src/adapters/llm/router.js", () => ({
  getAdapter: (...args: any[]) => getAdapterMock(...args),
}));

vi.mock("../src/services/validateClientWithCache.js", () => ({
  validateGraph: (...args: any[]) => validateGraphMock(...args),
}));

vi.mock("../src/utils/costGuard.js", () => ({
  estimateTokens: (chars: number) => Math.ceil(chars / 4),
  allowedCostUSD: (...args: any[]) => {
    allowedCostMock(...args);
    return true;
  },
}));

function makeDraftAdapter(resultGraph: any) {
  return {
    name: "test-adapter",
    model: "test-model",
    draftGraph: vi.fn().mockResolvedValue({
      graph: resultGraph,
      rationales: [],
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_read_input_tokens: 0,
      },
    }),
  };
}

describe("POST /assist/draft-graph", () => {
  beforeEach(() => {
    // Ensure BASE_URL does not break config validation inside the route module
    cleanBaseUrl();
    getAdapterMock.mockReset();
    validateGraphMock.mockReset();
    allowedCostMock.mockReset();
  });

  it("rejects bad input (brief too short)", async () => {
    const app = Fastify();
    await draftRoute(app);
    const res = await app.inject({ method: "POST", url: "/assist/draft-graph", payload: { brief: "short" } });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body) as { schema: string };
    expect(body.schema).toBe("error.v1");
  });

  it("includes diagnostics in successful JSON response", async () => {
    const app = Fastify();

    const adapter = makeDraftAdapter(fixtureGraph);
    getAdapterMock.mockReturnValue(adapter);
    validateGraphMock.mockResolvedValue({ ok: true });

    await draftRoute(app);
    const payload = {
      brief: "A sufficiently long decision brief to pass validation and exercise the pipeline.",
    };

    const res = await app.inject({ method: "POST", url: "/assist/draft-graph", payload });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as any;
    expect(body).toHaveProperty("diagnostics");
    expect(body.diagnostics).toMatchObject({
      resumes: expect.any(Number),
      trims: expect.any(Number),
      recovered_events: expect.any(Number),
      correlation_id: expect.any(String),
    });
  });

  it("treats empty drafted graphs as JSON errors with reason=empty_graph", async () => {
    const app = Fastify();

    const emptyGraph = {
      ...fixtureGraph,
      nodes: [],
      edges: [],
      meta: {
        ...fixtureGraph.meta,
        roots: [],
        leaves: [],
      },
    } as any;

    const adapter = makeDraftAdapter(emptyGraph);
    getAdapterMock.mockReturnValue(adapter);
    validateGraphMock.mockResolvedValue({ ok: true });

    await draftRoute(app);
    const payload = {
      brief: "A sufficiently long decision brief to trigger empty graph handling.",
    };

    const res = await app.inject({ method: "POST", url: "/assist/draft-graph", payload });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body) as any;
    expect(body.schema).toBe("error.v1");
    expect(body.code).toBe("BAD_INPUT");
    expect(body.message).toBe("Draft graph is empty after validation and repair");
    expect(body.details).toMatchObject({
      reason: "empty_graph",
      node_count: 0,
      edge_count: 0,
    });
  });

  it("streams empty drafted graphs as SSE COMPLETE error with reason=empty_graph", async () => {
    const app = Fastify();

    const emptyGraph = {
      ...fixtureGraph,
      nodes: [],
      edges: [],
      meta: {
        ...fixtureGraph.meta,
        roots: [],
        leaves: [],
      },
    } as any;

    const adapter = makeDraftAdapter(emptyGraph);
    getAdapterMock.mockReturnValue(adapter);
    validateGraphMock.mockResolvedValue({ ok: true });

    await draftRoute(app);
    const payload = {
      brief: "A sufficiently long decision brief to trigger empty graph handling over SSE.",
    };

    const res = await app.inject({
      method: "POST",
      url: "/assist/draft-graph/stream",
      payload,
    });

    expect(res.statusCode).toBe(200);
    const body = res.body.toString();
    expect(body).toContain("\"schema\":\"error.v1\"");
    expect(body).toContain("\"reason\":\"empty_graph\"");
  });
});
