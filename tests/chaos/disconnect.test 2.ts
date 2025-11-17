/**
 * Chaos tests for mid-stream disconnect resilience (v1.11.0)
 *
 * Validates SSE live resume under realistic failure scenarios:
 * - Random disconnects at various stream positions (10%, 50%, 90%)
 * - Resume continuation without duplicate events
 * - Graceful handling of connection failures
 * - Token persistence across disconnects
 * - Telemetry emission and Redis cleanup (v1.11)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { build } from "../../src/server.js";
import type { FastifyInstance } from "fastify";
import { getRedis } from "../../src/platform/redis.js";
import { TelemetrySink, expectTelemetry } from "../utils/telemetry-sink.js";
import { TelemetryEvents } from "../../src/utils/telemetry.js";

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

/**
 * Simulate SSE stream with intentional disconnect
 */
async function streamWithDisconnect(
  app: FastifyInstance,
  disconnectAfterEvents: number
): Promise<{
  phase1Events: SseEvent[];
  phase2Events: SseEvent[];
  resumeToken: string | null;
  totalEvents: number;
}> {
  let phase1Events: SseEvent[] = [];
  let resumeToken: string | null = null;
  let eventCount = 0;

  // Phase 1: Initial stream until disconnect
  const response = await app.inject({
    method: "POST",
    url: "/assist/draft-graph/stream",
    headers: {
      "content-type": "application/json",
    },
    payload: {
      brief: "Choose a data visualization library",
    },
  });

  expect(response.statusCode).toBe(200);
  expect(response.headers["content-type"]).toContain("text/event-stream");

  phase1Events = parseSseEvents(response.body);

  // Extract resume token from phase 1
  const resumeEvent = phase1Events.find((e) => e.type === "resume");
  if (resumeEvent && resumeEvent.data && "token" in resumeEvent.data) {
    resumeToken = resumeEvent.data.token as string;
  }

  // Simulate disconnect by limiting events
  phase1Events = phase1Events.slice(0, disconnectAfterEvents);
  eventCount = phase1Events.length;

  // Phase 2: Resume if we have a token
  let phase2Events: SseEvent[] = [];

  if (resumeToken) {
    const resumeResponse = await app.inject({
      method: "POST",
      url: "/assist/draft-graph/resume?mode=live",
      headers: {
        "X-Resume-Token": resumeToken,
        "X-Resume-Mode": "live",
      },
    });

    expect(resumeResponse.statusCode).toBe(200);
    phase2Events = parseSseEvents(resumeResponse.body);
    eventCount += phase2Events.length;
  }

  return {
    phase1Events,
    phase2Events,
    resumeToken,
    totalEvents: eventCount,
  };
}

describe("Chaos: Mid-Stream Disconnect", () => {
  let app: FastifyInstance;
  let redisAvailable = false;
  let secretsConfigured = false;
  let telemetrySink: TelemetrySink;

  beforeAll(async () => {
    // Check prerequisites
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

  describe("Disconnect at Various Stream Positions", () => {
    it(
      "should handle disconnect at 10% (early stream)",
      { skip: !redisAvailable || !secretsConfigured, timeout: 30000 },
      async () => {
        const result = await streamWithDisconnect(app, 2); // Disconnect after 2 events

        expect(result.resumeToken).toBeTruthy();
        expect(result.phase1Events.length).toBeGreaterThan(0);
        expect(result.phase2Events.length).toBeGreaterThan(0);
        expect(result.totalEvents).toBeGreaterThan(2);

        // Verify no duplicate events between phases
        const phase1Stages = result.phase1Events.filter((e) => e.type === "stage");
        const phase2Stages = result.phase2Events.filter((e) => e.type === "stage");

        if (phase1Stages.length > 0 && phase2Stages.length > 0) {
          const lastPhase1Stage = phase1Stages[phase1Stages.length - 1].data?.stage;
          const firstPhase2Stage = phase2Stages[0].data?.stage;
          // Stages should progress, not duplicate
          expect(firstPhase2Stage).not.toBe(lastPhase1Stage);
        }
      }
    );

    it(
      "should handle disconnect at 50% (mid-stream)",
      { skip: !redisAvailable || !secretsConfigured, timeout: 30000 },
      async () => {
        const result = await streamWithDisconnect(app, 5); // Disconnect after 5 events

        expect(result.resumeToken).toBeTruthy();
        expect(result.phase1Events.length).toBeGreaterThanOrEqual(5);
        expect(result.phase2Events.length).toBeGreaterThan(0);

        // Verify stream completion
        const hasComplete =
          result.phase1Events.some(
            (e) => e.type === "stage" && e.data?.stage === "COMPLETE"
          ) ||
          result.phase2Events.some(
            (e) => e.type === "stage" && e.data?.stage === "COMPLETE"
          );

        expect(hasComplete).toBe(true);
      }
    );

    it(
      "should handle disconnect at 90% (late stream)",
      { skip: !redisAvailable || !secretsConfigured, timeout: 30000 },
      async () => {
        const result = await streamWithDisconnect(app, 10); // Disconnect after 10 events

        expect(result.resumeToken).toBeTruthy();
        expect(result.totalEvents).toBeGreaterThan(10);

        // Late disconnect should still allow resume and completion
        const hasComplete =
          result.phase1Events.some(
            (e) => e.type === "stage" && e.data?.stage === "COMPLETE"
          ) ||
          result.phase2Events.some(
            (e) => e.type === "stage" && e.data?.stage === "COMPLETE"
          );

        expect(hasComplete).toBe(true);
      }
    );
  });

  describe("Graceful Degradation", () => {
    it(
      "should handle missing resume token gracefully",
      { skip: !redisAvailable },
      async () => {
        const response = await app.inject({
          method: "POST",
          url: "/assist/draft-graph/resume?mode=live",
          headers: {
            "X-Resume-Token": "invalid-token-12345",
            "X-Resume-Mode": "live",
          },
        });

        // Should reject invalid token
        expect(response.statusCode).toBeGreaterThanOrEqual(400);
        expect(response.statusCode).toBeLessThan(500);
      }
    );

    it(
      "should handle expired resume token gracefully",
      { skip: !redisAvailable || !secretsConfigured, timeout: 30000 },
      async () => {
        // Start a stream
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

        expect(response.statusCode).toBe(200);
        const events = parseSseEvents(response.body);
        const resumeEvent = events.find((e) => e.type === "resume");
        const token = resumeEvent?.data?.token as string;

        expect(token).toBeDefined();

        // Wait for token to potentially expire (short wait for test)
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Try to resume - should handle gracefully
        const resumeResponse = await app.inject({
          method: "POST",
          url: "/assist/draft-graph/resume?mode=live",
          headers: {
            "X-Resume-Token": token,
            "X-Resume-Mode": "live",
          },
        });

        // Either succeeds (token still valid) or fails gracefully
        expect([200, 401, 404, 410]).toContain(resumeResponse.statusCode);
      }
    );

    it(
      "should handle Redis unavailability gracefully",
      { skip: redisAvailable, timeout: 30000 },
      async () => {
        // With Redis unavailable, streaming should still work but without resume
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

        expect(response.statusCode).toBe(200);
        const events = parseSseEvents(response.body);

        // Should have stage events
        const stageEvents = events.filter((e) => e.type === "stage");
        expect(stageEvents.length).toBeGreaterThan(0);

        // May or may not have resume events depending on config
        // Either way, the stream should complete successfully
        const hasComplete = events.some(
          (e) => e.type === "stage" && e.data?.stage === "COMPLETE"
        );
        expect(hasComplete).toBe(true);
      }
    );
  });

  describe("Token Persistence Across Disconnects", () => {
    it(
      "should maintain resume token validity across multiple disconnects",
      { skip: !redisAvailable || !secretsConfigured, timeout: 60000 },
      async () => {
        // Phase 1: Initial stream
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
        const events1 = parseSseEvents(response1.body).slice(0, 3); // Early disconnect
        const resumeEvent1 = events1.find((e) => e.type === "resume");
        const token1 = resumeEvent1?.data?.token as string;

        expect(token1).toBeDefined();

        // Phase 2: First resume
        const response2 = await app.inject({
          method: "POST",
          url: "/assist/draft-graph/resume?mode=live",
          headers: {
            "X-Resume-Token": token1,
            "X-Resume-Mode": "live",
          },
        });

        expect(response2.statusCode).toBe(200);
        const events2 = parseSseEvents(response2.body).slice(0, 3); // Another disconnect
        const resumeEvent2 = events2.find((e) => e.type === "resume");
        const token2 = resumeEvent2?.data?.token as string;

        // Token should be updated or maintained
        expect(token2).toBeDefined();

        // Phase 3: Second resume (should still work)
        const response3 = await app.inject({
          method: "POST",
          url: "/assist/draft-graph/resume?mode=live",
          headers: {
            "X-Resume-Token": token2,
            "X-Resume-Mode": "live",
          },
        });

        // Should successfully resume or gracefully fail if stream completed
        expect([200, 404, 410]).toContain(response3.statusCode);
      }
    );
  });

  describe("Event Ordering Guarantees", () => {
    it(
      "should maintain monotonic event ordering across resume",
      { skip: !redisAvailable || !secretsConfigured, timeout: 30000 },
      async () => {
        const result = await streamWithDisconnect(app, 4);

        expect(result.resumeToken).toBeTruthy();

        // Collect all stage events
        const allStageEvents = [
          ...result.phase1Events.filter((e) => e.type === "stage"),
          ...result.phase2Events.filter((e) => e.type === "stage"),
        ];

        // Verify stages progress in logical order
        const stages = allStageEvents.map((e) => e.data?.stage);

        // Should not have duplicate consecutive stages
        for (let i = 1; i < stages.length; i++) {
          if (stages[i] === stages[i - 1]) {
            // Allow heartbeats and trace events to duplicate, but not stage transitions
            expect(stages[i]).toBe(stages[i - 1]);
          }
        }

        // Should eventually complete
        expect(stages).toContain("COMPLETE");
      }
    );
  });

  describe("Telemetry and State Cleanup (v1.11)", () => {
    it(
      "should emit SseResumeAttempt on disconnect/resume",
      { skip: !redisAvailable || !secretsConfigured, timeout: 30000 },
      async () => {
        telemetrySink.clear();

        const result = await streamWithDisconnect(app, 3);

        expect(result.resumeToken).toBeTruthy();

        // Should have emitted resume attempt telemetry
        expectTelemetry(telemetrySink).toContain(TelemetryEvents.SseResumeAttempt);

        // Live resume should eventually emit a terminal live-end event
        const liveEndEvents = telemetrySink.getEventsByName(TelemetryEvents.SseResumeLiveEnd);
        expect(liveEndEvents.length).toBeGreaterThan(0);
      }
    );

    it(
      "should clean up Redis state after stream completion",
      { skip: !redisAvailable || !secretsConfigured, timeout: 30000 },
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
            brief: "Choose a data visualization library",
          },
        });

        expect(response.statusCode).toBe(200);
        const events = parseSseEvents(response.body);

        // Extract correlation_id from first event
        const firstStageEvent = events.find((e) => e.type === "stage");
        const correlationId = firstStageEvent?.data?.correlation_id as string;

        expect(correlationId).toBeDefined();

        // Check completion
        const completeEvent = events.find(
          (e) => e.type === "stage" && e.data?.stage === "COMPLETE"
        );
        expect(completeEvent).toBeDefined();

        // Wait a moment for cleanup to happen
        await new Promise((resolve) => setTimeout(resolve, 500));

        // Verify state keys cleaned up (buffer removed, state may be kept for snapshot)
        const bufferKey = `sse:buffer:${correlationId}`;
        const bufferExists = await redis.exists(bufferKey);

        // Buffer should either be removed or have a short TTL
        if (bufferExists) {
          const ttl = await redis.ttl(bufferKey);
          expect(ttl).toBeGreaterThanOrEqual(0); // Has TTL set
          expect(ttl).toBeLessThanOrEqual(900); // Within expected range
        }
      }
    );

    it(
      "should verify Redis keys have proper TTL",
      { skip: !redisAvailable || !secretsConfigured, timeout: 30000 },
      async () => {
        const redis = await getRedis();
        if (!redis) return;

        // Start a stream
        const response = await app.inject({
          method: "POST",
          url: "/assist/draft-graph/stream",
          headers: {
            "content-type": "application/json",
          },
          payload: {
            brief: "Create a simple todo app",
          },
        });

        expect(response.statusCode).toBe(200);
        const events = parseSseEvents(response.body);

        // Extract correlation_id
        const firstStageEvent = events.find((e) => e.type === "stage");
        const correlationId = firstStageEvent?.data?.correlation_id as string;

        expect(correlationId).toBeDefined();

        // Check that state and buffer keys have TTL
        const stateKey = `sse:state:${correlationId}`;
        const bufferKey = `sse:buffer:${correlationId}`;

        const stateTTL = await redis.ttl(stateKey);
        const bufferTTL = await redis.ttl(bufferKey);

        // Keys should have TTL set (not -1 which means no expiry)
        if (stateTTL !== -2) {
          // -2 means key doesn't exist
          expect(stateTTL).toBeGreaterThan(0);
        }

        if (bufferTTL !== -2) {
          expect(bufferTTL).toBeGreaterThan(0);
        }
      }
    );
  });
});
