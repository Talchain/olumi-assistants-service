import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import draftRoute from "../src/routes/assist.draft-graph.js";

describe("POST /assist/draft-graph", () => {
  it("rejects bad input", async () => {
    const app = Fastify();
    await draftRoute(app);
    const res = await app.inject({ method: "POST", url: "/assist/draft-graph", payload: { brief: "short" } });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body) as { schema: string };
    expect(body.schema).toBe("error.v1");
  });
});
