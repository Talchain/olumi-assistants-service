import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify from "fastify";
import route from "../src/routes/assist.draft-graph.js";
import { expectNoBannedSubstrings } from "./utils/telemetry-banned-substrings.js";

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

  it("SSE COMPLETE payload includes diagnostics with matching correlation_id", async () => {
    const app = Fastify();
    await route(app);

    const payload = { brief: "A sufficiently long decision brief to pass validation and exercise the pipeline." };

    const sse = await app.inject({
      method: "POST",
      url: "/assist/draft-graph/stream",
      payload,
      headers: { accept: "text/event-stream" },
    });

    expect(sse.statusCode).toBe(200);
    const txt = sse.body;
    const correlationId = sse.headers["x-correlation-id"] as string | undefined;
    expect(correlationId).toBeDefined();

    const events = txt.split("\n\n").filter(Boolean);
    const stageEvents = events.filter(e => e.includes("event: stage"));
    const completeStage = stageEvents
      .slice()
      .reverse()
      .find(e => e.includes("\"stage\":\"COMPLETE\""));

    expect(completeStage).toBeDefined();
    const dataLine = completeStage!
      .split("\n")
      .find(line => line.startsWith("data: "));
    expect(dataLine).toBeDefined();

    const eventJson = JSON.parse(dataLine!.substring(6));
    expect(eventJson.stage).toBe("COMPLETE");
    const payloadJson = eventJson.payload;

    expect(payloadJson).toHaveProperty("diagnostics");
    expect(payloadJson.diagnostics).toMatchObject({
      resumes: expect.any(Number),
      trims: expect.any(Number),
      recovered_events: expect.any(Number),
      correlation_id: expect.any(String),
    });

    expectNoBannedSubstrings(payloadJson.diagnostics);

    if (correlationId) {
      expect(payloadJson.diagnostics.correlation_id).toBe(correlationId);
    }
  });
});
