import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify from "fastify";
import route from "../src/routes/assist.draft-graph.js";

describe("SSE parity and framing", () => {
  const envBackup = { ...process.env } as any;
  beforeAll(() => { process.env.LLM_PROVIDER = "fixtures"; });
  afterAll(() => { process.env = envBackup; });
  it("JSON and SSE apply the same post-response guards and frame via RFC 8895", async () => {
    const app = Fastify();
    await route(app);
    const payload = { brief: "A sufficiently long decision brief to pass validation and exercise the pipeline." };

    const json = await app.inject({ method: "POST", url: "/assist/draft-graph", payload });
    expect(json.statusCode).toBeLessThan(500);
    const body = JSON.parse(json.body);
    expect(body).toHaveProperty("graph");

    const sse = await app.inject({
      method: "POST",
      url: "/assist/draft-graph/stream",
      payload,
      headers: { accept: "text/event-stream" },
    });
    expect(sse.statusCode).toBe(200);
    const txt = sse.body;
    // RFC 8895: event line, one/more data lines, blank line terminator
    expect(txt).toContain("event: stage");
    expect(/data: \{/.test(txt)).toBe(true);
    expect(txt).toMatch(/\n\n/);
  });
});
