import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import route from "../src/routes/assist.critique-graph.js";
import * as router from "../src/adapters/llm/router.js";

describe("Critique ordering", () => {
  it("sorts issues BLOCKER→IMPROVEMENT→OBSERVATION", async () => {
    vi.spyOn(router, "getAdapter").mockReturnValue({
      name: "fixtures",
      model: "fixture-v1",
      critiqueGraph: async () => ({
        issues: [
          { level: "OBSERVATION", note: "observation note c" },
          { level: "BLOCKER", note: "blocker note a" },
          { level: "IMPROVEMENT", note: "improvement note b" },
        ],
        suggested_fixes: [],
        usage: { input_tokens: 0, output_tokens: 0 },
      }),
    } as any);

    const app = Fastify();
    await route(app);
    const res = await app.inject({
      method: "POST",
      url: "/assist/critique-graph",
      payload: { graph: { version: "1", default_seed: 17, nodes: [], edges: [], meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" } } },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    const levels = body.issues.map((i: any) => i.level);
    expect(levels).toEqual(["BLOCKER", "IMPROVEMENT", "OBSERVATION"]);
  });
});
