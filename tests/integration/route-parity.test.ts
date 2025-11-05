/**
 * Route-Level JSON↔SSE Parity Integration Tests
 *
 * Verifies that both /assist/draft-graph (JSON) and /assist/draft-graph/stream (SSE)
 * enforce identical guards and emit telemetry with provider/cost fallbacks.
 *
 * Uses fixtures adapter to avoid live LLM calls.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import draftRoute from "../../src/routes/assist.draft-graph.js";
import { emit } from "../../src/utils/telemetry.js";

describe("Route-Level Parity (JSON vs SSE)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    // Use fixtures provider to avoid live LLM calls
    process.env.LLM_PROVIDER = "fixtures";

    app = Fastify({ logger: false });
    await draftRoute(app);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe("JSON Route (/assist/draft-graph)", () => {
    it("returns 200 with valid brief", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload: { brief: "Should we hire or contract for this project?" },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.graph).toBeDefined();
      expect(body.graph.nodes.length).toBeLessThanOrEqual(12);
      expect(body.graph.edges.length).toBeLessThanOrEqual(24);
    });

    it("rejects brief that is too short", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload: { brief: "short" },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.schema).toBe("error.v1");
    });
  });

  describe("SSE Route (/assist/draft-graph/stream)", () => {
    it("returns SSE stream with DRAFTING and COMPLETE events", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/assist/draft-graph/stream",
        payload: { brief: "Should we hire or contract for this project?" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toBe("text/event-stream");

      // Parse SSE events from response body
      const events = parseSSEEvents(res.body);
      expect(events.length).toBeGreaterThanOrEqual(2); // At least DRAFTING + COMPLETE

      // Verify DRAFTING event
      const draftingEvent = events.find((e) => e.event === "stage");
      expect(draftingEvent).toBeDefined();

      // Verify COMPLETE event with graph
      const completeEvent = events[events.length - 1];
      expect(completeEvent.data.stage).toBe("COMPLETE");
      expect(completeEvent.data.payload.graph).toBeDefined();
      expect(completeEvent.data.payload.graph.nodes.length).toBeLessThanOrEqual(12);
      expect(completeEvent.data.payload.graph.edges.length).toBeLessThanOrEqual(24);
    });

    it("handles multi-line JSON data per RFC 8895", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/assist/draft-graph/stream",
        payload: { brief: "Analyze vendor selection for cloud infrastructure" },
      });

      expect(res.statusCode).toBe(200);

      // Verify SSE format: each line should start with "data: " or be blank
      const lines = res.body.split("\n");
      for (const line of lines) {
        if (line.trim() === "") continue; // blank lines OK
        if (line.startsWith("event:")) continue; // event lines OK
        expect(line.startsWith("data: ")).toBe(true);
      }
    });

    it("rejects brief that is too short via SSE", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/assist/draft-graph/stream",
        payload: { brief: "short" },
      });

      expect(res.statusCode).toBe(400);
      expect(res.headers["content-type"]).toBe("text/event-stream");

      const events = parseSSEEvents(res.body);
      const completeEvent = events.find((e) => e.data.stage === "COMPLETE");
      expect(completeEvent?.data.payload.schema).toBe("error.v1");
    });
  });

  describe("Telemetry Parity with Fallbacks", () => {
    it("emits telemetry with provider and cost_usd for JSON route", async () => {
      const emitSpy = vi.spyOn(await import("../../src/utils/telemetry.js"), "emit");

      await app.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload: { brief: "Should we build or buy analytics platform?" },
      });

      // Check that assist.draft.completed was emitted with provider and cost
      const completedCalls = emitSpy.mock.calls.filter((call) => call[0] === "assist.draft.completed");
      expect(completedCalls.length).toBeGreaterThan(0);

      const telemetryData = completedCalls[0][1];
      expect(telemetryData.draft_source).toBeDefined(); // provider
      expect(telemetryData.cost_usd).toBeDefined(); // cost
      expect(typeof telemetryData.cost_usd).toBe("number");

      emitSpy.mockRestore();
    });

    it("emits SSE telemetry with provider and cost_usd fallbacks", async () => {
      const emitSpy = vi.spyOn(await import("../../src/utils/telemetry.js"), "emit");

      await app.inject({
        method: "POST",
        url: "/assist/draft-graph/stream",
        payload: { brief: "Vendor risk assessment for supply chain" },
      });

      // Check that assist.draft.sse_completed was emitted with provider and cost
      const sseCompletedCalls = emitSpy.mock.calls.filter((call) => call[0] === "assist.draft.sse_completed");
      expect(sseCompletedCalls.length).toBeGreaterThan(0);

      const telemetryData = sseCompletedCalls[0][1];
      expect(telemetryData.provider).toBeDefined();
      expect(telemetryData.cost_usd).toBeDefined();
      expect(typeof telemetryData.cost_usd).toBe("number");

      // Verify fallback behavior (fixtures should have provider="fixtures", cost=0)
      expect(telemetryData.provider).toBe("fixtures");
      expect(telemetryData.cost_usd).toBe(0);

      emitSpy.mockRestore();
    });
  });
});

/**
 * Parse SSE event stream into structured events
 */
function parseSSEEvents(body: string): Array<{ event: string; data: any }> {
  const events: Array<{ event: string; data: any }> = [];
  const lines = body.split("\n");

  let currentEvent: { event?: string; dataLines: string[] } = { dataLines: [] };

  for (const line of lines) {
    if (line.startsWith("event:")) {
      currentEvent.event = line.substring(6).trim();
    } else if (line.startsWith("data:")) {
      currentEvent.dataLines.push(line.substring(5).trim());
    } else if (line.trim() === "" && currentEvent.dataLines.length > 0) {
      // End of event (blank line)
      const dataStr = currentEvent.dataLines.join("\n");
      try {
        const data = JSON.parse(dataStr);
        events.push({ event: currentEvent.event || "message", data });
      } catch {
        // Ignore parse errors for malformed events
      }
      currentEvent = { dataLines: [] };
    }
  }

  return events;
}
