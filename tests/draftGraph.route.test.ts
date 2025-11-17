import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import draftRoute from "../src/routes/assist.draft-graph.js";

describe("POST /assist/draft-graph", () => {
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
    const originalProvider = process.env.LLM_PROVIDER;
    process.env.LLM_PROVIDER = "fixtures";

    try {
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
    } finally {
      if (originalProvider === undefined) {
        delete process.env.LLM_PROVIDER;
      } else {
        process.env.LLM_PROVIDER = originalProvider;
      }
    }
  });
});
