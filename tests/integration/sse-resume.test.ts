/**
 * Integration tests for v1 SSE streaming (migrated from legacy resume tests)
 *
 * Tests the /assist/v1/draft-graph/stream endpoint SSE contract:
 * - Successful streaming with stage events
 * - No resume token emission (v1 has no resume endpoint)
 * - Graceful degradation when Redis is unavailable
 * - Error event emission on validation failures
 * - SSE content-type header
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "../../src/server.js";
import type { FastifyInstance } from "fastify";
import { getRedis } from "../../src/platform/redis.js";
import { expectNoBannedSubstrings } from "../utils/telemetry-banned-substrings.js";
import { cleanBaseUrl } from "../helpers/env-setup.js";

describe("v1 SSE Stream Integration", () => {
  let app: FastifyInstance;
  let redisAvailable = false;

  beforeAll(async () => {
    const redis = await getRedis();
    redisAvailable = redis !== null;

    process.env.LLM_PROVIDER = "fixtures";
    delete process.env.ASSIST_API_KEY;
    delete process.env.ASSIST_API_KEYS;

    cleanBaseUrl();
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe("v1 stream endpoint", () => {
    it("should stream SSE events on /assist/v1/draft-graph/stream", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/assist/v1/draft-graph/stream",
        headers: { "content-type": "application/json" },
        payload: { brief: "Choose between React and Vue for a new dashboard application" },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toContain("text/event-stream");

      const events = response.body.split("\n\n").filter(Boolean);
      const stageEvents = events.filter(e => e.includes("event: stage"));
      expect(stageEvents.length).toBeGreaterThan(0);
    });

    it("should not emit event: resume (v1 has no resume endpoint)", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/assist/v1/draft-graph/stream",
        headers: { "content-type": "application/json" },
        payload: { brief: "Choose between React and Vue for a new dashboard application" },
      });

      expect(response.statusCode).toBe(200);

      const resumeEvent = response.body.split("\n\n").find(e => e.includes("event: resume"));
      expect(resumeEvent).toBeUndefined();
    });

    it("should emit event: error for invalid input (schema validation)", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/assist/v1/draft-graph/stream",
        headers: { "content-type": "application/json" },
        payload: { brief: "too short" }, // fails min(30) validation
      });

      // v1 stream returns 200 with SSE error event for schema failures
      expect([200, 400]).toContain(response.statusCode);

      if (response.statusCode === 200) {
        expect(response.headers["content-type"]).toContain("text/event-stream");
        const hasErrorEvent = response.body.includes("event: error");
        expect(hasErrorEvent).toBe(true);
      }
    });

    it("should return 410 for legacy /assist/draft-graph/stream", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/assist/draft-graph/stream",
        headers: { "content-type": "application/json" },
        payload: { brief: "Should get 410" },
      });

      expect(response.statusCode).toBe(410);
    });

    it("should return 410 for legacy /assist/draft-graph/resume", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/assist/draft-graph/resume",
        headers: { "x-resume-token": "any-token" },
      });

      expect(response.statusCode).toBe(410);
    });
  });

  describe("Graceful Degradation (Redis unavailable)", () => {
    it("should stream successfully when Redis is unavailable", { skip: redisAvailable }, async () => {
      const response = await app.inject({
        method: "POST",
        url: "/assist/v1/draft-graph/stream",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          brief: "Create a simple todo app with user authentication and task management",
        }),
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toContain("text/event-stream");

      const events = response.body.split("\n\n").filter(Boolean);
      const stageEvents = events.filter(e => e.includes("event: stage"));
      expect(stageEvents.length).toBeGreaterThan(0);

      // Should not emit resume event in degraded mode
      const resumeEvent = events.find(e => e.includes("event: resume"));
      expect(resumeEvent).toBeUndefined();
    });
  });

  describe("SSE Telemetry", () => {
    it("should verify SSE-related telemetry events are defined", async () => {
      const { TelemetryEvents } = await import("../../src/utils/telemetry.js");

      expect(TelemetryEvents.SseResumeLiveStart).toBeDefined();
      expect(TelemetryEvents.SseResumeLiveContinue).toBeDefined();
      expect(TelemetryEvents.SseResumeLiveEnd).toBeDefined();
      expect(TelemetryEvents.SseSnapshotRenewed).toBeDefined();
    });
  });
});
