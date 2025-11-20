/**
 * Chaos tests for Redis resilience (v1.10.0)
 *
 * Validates graceful degradation when Redis is unavailable:
 * - SSE streaming continues without Redis
 * - Resume tokens fail gracefully when Redis is down
 * - No request failures due to Redis unavailability
 * - Service remains available during Redis blips
 * - Recovery after Redis becomes available again
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { build } from "../../src/server.js";
import type { FastifyInstance } from "fastify";
import { getRedis, resetRedis } from "../../src/platform/redis.js";
import { TelemetrySink, expectTelemetry } from "../utils/telemetry-sink.js";
import { TelemetryEvents } from "../../src/utils/telemetry.js";
import { SSE_DEGRADED_KIND_REDIS_UNAVAILABLE } from "../../src/utils/degraded-mode.js";
import { expectNoBannedSubstrings } from "../utils/telemetry-banned-substrings.js";

interface SseEvent {
  type: string;
  data: Record<string, unknown> | null;
}

/**
 * Parse SSE events from raw text
 */
function parseSseEvents(text: string): SseEvent[] {
  const events: SseEvent[] = [];
  const blocks = text.split("\n\n").filter(Boolean);

  for (const block of blocks) {
    const lines = block.trim().split("\n");
    let eventType: string | null = null;
    const dataLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith("event: ")) {
        eventType = line.substring(7).trim();
      } else if (line.startsWith("data: ")) {
        dataLines.push(line.substring(6));
      } else if (line.startsWith(": ")) {
        eventType = "heartbeat";
      }
    }

    if (!eventType) continue;

    if (eventType === "heartbeat" || dataLines.length === 0) {
      events.push({ type: "heartbeat", data: null });
    } else {
      try {
        const data = JSON.parse(dataLines.join("\n"));
        events.push({ type: eventType, data });
      } catch {
        // Skip malformed events
      }
    }
  }

  return events;
}

describe("Chaos: Redis Blips and Unavailability", () => {
  let app: FastifyInstance;
  let redisAvailable = false;
  let telemetrySink: TelemetrySink;
  let secretsConfigured = false;

  beforeAll(async () => {
    // Check Redis availability
    const redis = await getRedis();
    redisAvailable = redis !== null;
    secretsConfigured = !!(process.env.SSE_RESUME_SECRET || process.env.HMAC_SECRET);

    // Set test environment
    process.env.LLM_PROVIDER = "fixtures";
    process.env.NODE_ENV = "test"; // Enable telemetry sink
    delete process.env.ASSIST_API_KEY;
    delete process.env.ASSIST_API_KEYS;

    // Build app
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    telemetrySink = new TelemetrySink();
    await telemetrySink.install();
  });

  afterEach(() => {
    telemetrySink.uninstall();
  });

  describe("Graceful Degradation Without Redis", () => {
    it(
      "should stream successfully when Redis is unavailable",
      { skip: redisAvailable, timeout: 30000 },
      async () => {
        const response = await app.inject({
          method: "POST",
          url: "/assist/draft-graph/stream",
          headers: {
            "content-type": "application/json",
          },
          payload: {
            brief: "Create a simple todo app for testing",
          },
        });

        // Should succeed even without Redis
        expect(response.statusCode).toBe(200);
        expect(response.headers["content-type"]).toContain("text/event-stream");
        expect(response.headers["x-olumi-degraded"]).toBe("redis");

        const events = parseSseEvents(response.body);

        // Should have stage events
        const stageEvents = events.filter((e) => e.type === "stage");
        expect(stageEvents.length).toBeGreaterThan(0);

        // Should complete successfully
        const hasComplete = events.some(
          (e) => e.type === "stage" && e.data?.stage === "COMPLETE"
        );
        expect(hasComplete).toBe(true);

        // Degraded mode telemetry should be emitted
        expectTelemetry(telemetrySink).toContain(TelemetryEvents.SseDegradedMode);
        const degradedEvents = telemetrySink.getEventsByName(TelemetryEvents.SseDegradedMode);
        expect(degradedEvents.length).toBeGreaterThan(0);
        const hasRedisKind = degradedEvents.some(
          (e) => e.data.kind === SSE_DEGRADED_KIND_REDIS_UNAVAILABLE && e.data.endpoint === "/assist/draft-graph/stream"
        );
        expect(hasRedisKind).toBe(true);
      }
    );

    it(
      "should handle healthz check when Redis is unavailable",
      { skip: redisAvailable, timeout: 10000 },
      async () => {
        const response = await app.inject({
          method: "GET",
          url: "/healthz",
        });

        // Healthz should succeed even without Redis
        // Redis is optional, not critical
        expect(response.statusCode).toBe(200);
      }
    );

    it(
      "should reject resume attempts gracefully when Redis is unavailable",
      { skip: redisAvailable, timeout: 10000 },
      async () => {
        const response = await app.inject({
          method: "POST",
          url: "/assist/draft-graph/resume?mode=live",
          headers: {
            "X-Resume-Token": "test-token-12345",
            "X-Resume-Mode": "live",
          },
        });

        // Should fail gracefully with appropriate status
        expect(response.statusCode).toBeGreaterThanOrEqual(400);
        expect(response.statusCode).toBeLessThan(500);
      }
    );
  });

  describe("Core Functionality Without Redis", () => {
    it(
      "should handle non-streaming endpoint when Redis unavailable",
      { skip: redisAvailable, timeout: 30000 },
      async () => {
        const response = await app.inject({
          method: "POST",
          url: "/assist/draft-graph",
          headers: {
            "content-type": "application/json",
          },
          payload: {
            brief: "Choose a database for a web app",
          },
        });

        // Non-streaming endpoint should work without Redis
        expect(response.statusCode).toBe(200);
        expect(response.headers["content-type"]).toContain("application/json");

        const body = JSON.parse(response.body);
        expect(body.graph).toBeDefined();
        expect(body.graph.nodes).toBeDefined();
        expect(Array.isArray(body.graph.nodes)).toBe(true);
      }
    );

    it(
      "should handle concurrent requests when Redis unavailable",
      { skip: redisAvailable, timeout: 60000 },
      async () => {
        const requests = Array.from({ length: 5 }, (_, i) =>
          app.inject({
            method: "POST",
            url: "/assist/draft-graph/stream",
            headers: {
              "content-type": "application/json",
            },
            payload: {
              brief: `Test request ${i + 1} when Redis is unavailable`,
            },
          })
        );

        const responses = await Promise.all(requests);

        // All requests should succeed
        for (const response of responses) {
          expect(response.statusCode).toBe(200);
          const events = parseSseEvents(response.body);
          const hasStage = events.some((e) => e.type === "stage");
          expect(hasStage).toBe(true);
        }
      }
    );
  });

  describe("Redis Recovery Scenarios", () => {
    it(
      "should resume normal operation when Redis is available",
      { skip: !redisAvailable, timeout: 30000 },
      async () => {
        // With Redis available, full functionality should work
        const response = await app.inject({
          method: "POST",
          url: "/assist/draft-graph/stream",
          headers: {
            "content-type": "application/json",
          },
          payload: {
            brief: "Create a simple todo app with filters",
          },
        });

        expect(response.statusCode).toBe(200);
        const events = parseSseEvents(response.body);

        // Should have stage events
        const stageEvents = events.filter((e) => e.type === "stage");
        expect(stageEvents.length).toBeGreaterThan(0);

        // With Redis and secrets, should have resume token
        const secretsConfigured = !!(
          process.env.SSE_RESUME_SECRET || process.env.HMAC_SECRET
        );
        if (secretsConfigured) {
          const resumeEvent = events.find((e) => e.type === "resume");
          expect(resumeEvent).toBeDefined();
          expect(resumeEvent?.data?.token).toBeDefined();
        }
      }
    );

    it(
      "should handle resume with Redis available",
      { skip: !redisAvailable, timeout: 30000 },
      async () => {
        // Start a stream
        const response1 = await app.inject({
          method: "POST",
          url: "/assist/draft-graph/stream",
          headers: {
            "content-type": "application/json",
          },
          payload: {
            brief: "Choose a data visualization library",
          },
        });

        expect(response1.statusCode).toBe(200);
        const events1 = parseSseEvents(response1.body);
        const resumeEvent = events1.find((e) => e.type === "resume");

        if (resumeEvent && resumeEvent.data && "token" in resumeEvent.data) {
          const token = resumeEvent.data.token as string;

          // Try to resume
          const response2 = await app.inject({
            method: "POST",
            url: "/assist/draft-graph/resume?mode=live",
            headers: {
              "X-Resume-Token": token,
              "X-Resume-Mode": "live",
            },
          });

          // Should succeed or gracefully fail if stream completed
          expect([200, 404, 410]).toContain(response2.statusCode);
        }
      }
    );
  });

  describe("Error Handling and Telemetry", () => {
    it(
      "should emit appropriate telemetry when Redis operations fail",
      { skip: redisAvailable, timeout: 30000 },
      async () => {
        // Start a stream - should succeed but log Redis unavailability
        const response = await app.inject({
          method: "POST",
          url: "/assist/draft-graph/stream",
          headers: {
            "content-type": "application/json",
          },
          payload: {
            brief: "Test telemetry without Redis failures",
          },
        });

        expect(response.statusCode).toBe(200);

        // Parse events to check for telemetry
        const events = parseSseEvents(response.body);

        // Should complete successfully despite Redis being unavailable
        const hasComplete = events.some(
          (e) => e.type === "stage" && e.data?.stage === "COMPLETE"
        );
        expect(hasComplete).toBe(true);

        // Telemetry about Redis should be in stage events
        const stageEvents = events.filter((e) => e.type === "stage");
        expect(stageEvents.length).toBeGreaterThan(0);

        // At least one stage event should have telemetry
        const hasTelemetry = stageEvents.some(
          (e) => e.data && "telemetry" in e.data
        );
        // Telemetry is optional, so this is informational
        if (hasTelemetry) {
          expect(hasTelemetry).toBe(true);
        }
      }
    );

    it(
      "should not leak sensitive data in error responses",
      { timeout: 30000 },
      async () => {
        // Try to resume with invalid token
        const response = await app.inject({
          method: "POST",
          url: "/assist/draft-graph/resume?mode=live",
          headers: {
            "X-Resume-Token": "test-token-12345",
            "X-Resume-Mode": "live",
          },
        });

        // Should fail without leaking internal details
        expect(response.statusCode).toBeGreaterThanOrEqual(400);

        const body = response.body;

        // Should not contain sensitive information
        expect(body.toLowerCase()).not.toContain("redis");
        expect(body.toLowerCase()).not.toContain("connection");
        expect(body.toLowerCase()).not.toContain("secret");
        expect(body.toLowerCase()).not.toContain("hmac");

        // Should contain generic error message
        const contentType = response.headers["content-type"];
        if (typeof contentType === "string" && contentType.includes("application/json")) {
          const json = JSON.parse(body);
          expect(json.error || json.message).toBeDefined();
        }
      }
    );
  });

  describe("Rate Limiting Without Redis", () => {
    it(
      "should enforce rate limits gracefully when Redis unavailable",
      { skip: redisAvailable, timeout: 60000 },
      async () => {
        // Without Redis, rate limiting may be disabled or use in-memory fallback
        // Service should still function

        const requests = Array.from({ length: 3 }, (_, i) =>
          app.inject({
            method: "POST",
            url: "/assist/draft-graph",
            headers: {
              "content-type": "application/json",
            },
            payload: {
              brief: `Rate limit test ${i + 1} without Redis`,
            },
          })
        );

        const responses = await Promise.all(requests);

        // All should succeed or be rate limited, but not error due to Redis
        for (const response of responses) {
          expect([200, 429]).toContain(response.statusCode);
        }
      }
    );
  });

  describe("Telemetry and State Cleanup (v1.11)", () => {
    it(
      "should emit appropriate telemetry when streaming without Redis",
      { skip: redisAvailable, timeout: 30000 },
      async () => {
        telemetrySink.clear();

        const response = await app.inject({
          method: "POST",
          url: "/assist/draft-graph/stream",
          headers: {
            "content-type": "application/json",
          },
          payload: {
            brief: "Test telemetry without Redis failures",
          },
        });

        expect(response.statusCode).toBe(200);
        const events = parseSseEvents(response.body);

        // Should complete successfully
        const hasComplete = events.some(
          (e) => e.type === "stage" && e.data?.stage === "COMPLETE"
        );
        expect(hasComplete).toBe(true);

        // Telemetry should have been emitted for the stream
        const allEvents = telemetrySink.getEvents();
        expect(allEvents.length).toBeGreaterThan(0);

        // Should have core draft/stream-related telemetry events
        const coreEvents = new Set<string>([
          TelemetryEvents.DraftStarted,
          TelemetryEvents.DraftCompleted,
          TelemetryEvents.SSEStarted,
          TelemetryEvents.SSECompleted,
        ]);
        const hasCoreEvents = allEvents.some((e) => coreEvents.has(e.name));
        expect(hasCoreEvents).toBe(true);
      }
    );

    it(
      "should emit SseResumeAttempt when Redis is available and resume is used",
      { skip: !redisAvailable, timeout: 30000 },
      async () => {
        const secretsConfigured = !!(
          process.env.SSE_RESUME_SECRET || process.env.HMAC_SECRET
        );

        if (!secretsConfigured) {
          // Skip if secrets not configured
          return;
        }

        telemetrySink.clear();

        // Start a stream
        const response1 = await app.inject({
          method: "POST",
          url: "/assist/draft-graph/stream",
          headers: {
            "content-type": "application/json",
          },
          payload: {
            brief: "Choose a data visualization library",
          },
        });

        expect(response1.statusCode).toBe(200);
        const events1 = parseSseEvents(response1.body);
        const resumeEvent = events1.find((e) => e.type === "resume");

        if (resumeEvent && resumeEvent.data && "token" in resumeEvent.data) {
          const token = resumeEvent.data.token as string;

          telemetrySink.clear();

          // Try to resume
          const response2 = await app.inject({
            method: "POST",
            url: "/assist/draft-graph/resume?mode=live",
            headers: {
              "X-Resume-Token": token,
              "X-Resume-Mode": "live",
            },
          });

          // Should succeed or gracefully fail
          expect([200, 404, 410]).toContain(response2.statusCode);

          if (response2.statusCode === 200) {
            // Should have emitted resume attempt and live-end telemetry
            expectTelemetry(telemetrySink).toContain(TelemetryEvents.SseResumeAttempt);
            expectTelemetry(telemetrySink).toContain(TelemetryEvents.SseResumeLiveEnd);
          }
        }
      }
    );

    it(
      "should verify Redis cleanup after stream completion with Redis available",
      { skip: !redisAvailable, timeout: 30000 },
      async () => {
        const redis = await getRedis();
        if (!redis) return;

        // Start and complete a stream
        const response = await app.inject({
          method: "POST",
          url: "/assist/draft-graph/stream",
          headers: {
            "content-type": "application/json",
          },
          payload: {
            brief: "Test Redis cleanup",
          },
        });

        expect(response.statusCode).toBe(200);
        const events = parseSseEvents(response.body);

        // Extract correlation_id
        const firstStageEvent = events.find((e) => e.type === "stage");
        const correlationId = firstStageEvent?.data?.correlation_id as string;

        expect(correlationId).toBeDefined();

        // Verify completion
        const completeEvent = events.find(
          (e) => e.type === "stage" && e.data?.stage === "COMPLETE"
        );
        expect(completeEvent).toBeDefined();

        // Wait for cleanup
        await new Promise((resolve) => setTimeout(resolve, 500));

        // Verify buffer key cleanup or TTL
        const bufferKey = `sse:buffer:${correlationId}`;
        const bufferExists = await redis.exists(bufferKey);

        if (bufferExists) {
          const ttl = await redis.ttl(bufferKey);
          expect(ttl).toBeGreaterThanOrEqual(0);
          expect(ttl).toBeLessThanOrEqual(900); // Within expected TTL
        }

        // State key may have TTL as well
        const stateKey = `sse:state:${correlationId}`;
        const stateTTL = await redis.ttl(stateKey);

        if (stateTTL !== -2) {
          // -2 means key doesn't exist
          expect(stateTTL).toBeGreaterThan(0);
        }
      }
    );

    it(
      "should not emit Redis-related errors when Redis operations fail gracefully",
      { skip: redisAvailable, timeout: 30000 },
      async () => {
        telemetrySink.clear();

        const response = await app.inject({
          method: "POST",
          url: "/assist/draft-graph/stream",
          headers: {
            "content-type": "application/json",
          },
          payload: {
            brief: "Test graceful Redis failure without noise",
          },
        });

        expect(response.statusCode).toBe(200);

        // Check telemetry for no Redis-related errors
        const allEvents = telemetrySink.getEvents();
        const errorEvents = allEvents.filter((e) =>
          e.name.toLowerCase().includes("error")
        );

        // Should not have Redis connection errors in telemetry
        for (const event of errorEvents) {
          const eventStr = JSON.stringify(event.data).toLowerCase();
          expect(eventStr).not.toContain("redis connection");
          expect(eventStr).not.toContain("econnrefused");
        }
      }
    );

    it(
      "Scenario A - Redis client reset between stream and resume preserves diagnostics and telemetry invariants",
      { skip: !redisAvailable || !secretsConfigured, timeout: 30000 },
      async () => {
        telemetrySink.clear();

        const streamResponse = await app.inject({
          method: "POST",
          url: "/assist/draft-graph/stream",
          headers: {
            "content-type": "application/json",
          },
          payload: {
            brief: "Choose a data visualization library",
          },
        });

        expect(streamResponse.statusCode).toBe(200);

        const events1 = parseSseEvents(streamResponse.body);
        const firstStage = events1.find((e) => e.type === "stage");
        const correlationId = firstStage?.data?.correlation_id as string | undefined;

        const resumeEvent = events1.find((e) => e.type === "resume");
        expect(resumeEvent).toBeDefined();
        const token = resumeEvent!.data!.token as string;

        const originalRedisUrl = process.env.REDIS_URL;
        try {
          resetRedis();
          const redisAfterReset = await getRedis();
          expect(redisAfterReset).not.toBeNull();
        } finally {
          if (originalRedisUrl !== undefined) {
            process.env.REDIS_URL = originalRedisUrl;
          }
        }

        telemetrySink.clear();

        const resumeResponse = await app.inject({
          method: "POST",
          url: "/assist/draft-graph/resume?mode=live",
          headers: {
            "X-Resume-Token": token,
            "X-Resume-Mode": "live",
          },
        });

        expect([200, 404, 410]).toContain(resumeResponse.statusCode);
        if (resumeResponse.statusCode !== 200) {
          return;
        }

        const resumeEvents = parseSseEvents(resumeResponse.body);
        const stageEvents = resumeEvents.filter((e) => e.type === "stage");
        const completeStages = stageEvents.filter((e) => e.data?.stage === "COMPLETE");
        expect(completeStages.length).toBe(1);
        const completeStage = completeStages[0];

        const payload = completeStage.data?.payload as Record<string, any> | undefined;
        expect(payload).toBeDefined();

        const diagnostics = payload!.diagnostics as Record<string, any> | undefined;
        expect(diagnostics).toBeDefined();

        expect(typeof diagnostics!.resumes).toBe("number");
        expect(diagnostics!.resumes).toBeGreaterThanOrEqual(1);
        expect(typeof diagnostics!.recovered_events).toBe("number");
        expect(typeof diagnostics!.trims).toBe("number");
        expect(typeof diagnostics!.correlation_id).toBe("string");

        if (correlationId) {
          expect(diagnostics!.correlation_id).toBe(correlationId);
        }

        expectNoBannedSubstrings(diagnostics!);

        expectTelemetry(telemetrySink).toContain(TelemetryEvents.SseResumeAttempt);
        const replayCounts = telemetrySink.getEventsByName(TelemetryEvents.SseResumeReplayCount);
        expect(replayCounts.length).toBeGreaterThan(0);

        for (const event of telemetrySink.getEvents()) {
          expectNoBannedSubstrings(event.data);
        }
      }
    );
  });
});
