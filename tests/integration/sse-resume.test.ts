/**
 * Integration tests for SSE Resume functionality (v1.8.0)
 *
 * Tests end-to-end resume flow:
 * - Token generation during streaming
 * - Resume with valid token
 * - Snapshot fallback for completed streams
 * - Error handling for expired/invalid tokens
 * - Graceful degradation when secrets not configured
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "../../src/server.js";
import type { FastifyInstance } from "fastify";
import { getRedis } from "../../src/platform/redis.js";
import { randomUUID } from "node:crypto";
import { createResumeToken } from "../../src/utils/sse-resume-token.js";
import { expectNoBannedSubstrings } from "../utils/telemetry-banned-substrings.js";

describe("SSE Resume Integration", () => {
  let app: FastifyInstance;
  let redisAvailable = false;
  let secretsConfigured = false;

  beforeAll(async () => {
    // Check if Redis is available
    const redis = await getRedis();
    redisAvailable = redis !== null;

    // Check if secrets are configured
    secretsConfigured = !!(process.env.SSE_RESUME_SECRET || process.env.HMAC_SECRET);

    // Set test environment
    process.env.LLM_PROVIDER = "fixtures";
    // Disable auth for tests
    delete process.env.ASSIST_API_KEY;
    delete process.env.ASSIST_API_KEYS;

    // Build app
    delete process.env.BASE_URL;
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe("Resume Token Generation", () => {
    it("should generate resume token on first SSE event", { skip: !redisAvailable || !secretsConfigured }, async () => {
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
      expect(response.headers["content-type"]).toContain("text/event-stream");

      // Parse SSE events
      const body = response.body;
      const events = body.split("\n\n").filter(Boolean);

      // Should have a resume event with token
      const resumeEvent = events.find(e => e.includes("event: resume"));
      expect(resumeEvent).toBeDefined();
      expect(resumeEvent).toContain("data: ");

      // Extract token from event
      const dataLine = resumeEvent?.split("\n").find(line => line.startsWith("data: "));
      expect(dataLine).toBeDefined();
      const data = JSON.parse(dataLine!.substring(6)); // Skip "data: "
      expect(data.token).toBeDefined();
      expect(typeof data.token).toBe("string");
      expect(data.token.length).toBeGreaterThan(0);
    });

    it("should continue streaming without resume token when secrets not configured", { skip: !redisAvailable || secretsConfigured }, async () => {
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

      // Should still stream successfully, just without resume token
      const body = response.body;
      const events = body.split("\n\n").filter(Boolean);

      // Should have stage events
      const stageEvents = events.filter(e => e.includes("event: stage"));
      expect(stageEvents.length).toBeGreaterThan(0);

      // Should NOT have resume event when secrets not configured
      const resumeEvent = events.find(e => e.includes("event: resume"));
      expect(resumeEvent).toBeUndefined();
    });
  });

  describe("Resume Endpoint", () => {
    it("should return 400 when X-Resume-Token header missing", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/assist/draft-graph/resume",
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.code).toBe("BAD_INPUT");
      expect(body.message).toContain("Missing or invalid X-Resume-Token");
    });

    it("should return 401 for malformed tokens when secrets not configured", { skip: secretsConfigured }, async () => {
      // When secrets aren't configured, malformed tokens still fail at decode step (401)
      // The 426 response only occurs if decoding succeeds but secret is missing
      const response = await app.inject({
        method: "POST",
        url: "/assist/draft-graph/resume",
        headers: {
          "x-resume-token": "fake-token-value",
        },
      });

      // Malformed token fails at decode step before secret check
      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.code).toBe("BAD_INPUT");
      expect(body.message).toContain("Invalid resume token");
    });

    it("should return 401 for invalid token signature", { skip: !secretsConfigured }, async () => {
      // Construct a malformed token
      const fakeToken = "invalid.token.signature";

      const response = await app.inject({
        method: "POST",
        url: "/assist/draft-graph/resume",
        headers: {
          "x-resume-token": fakeToken,
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.code).toBe("BAD_INPUT");
      expect(body.message).toContain("Invalid resume token");
    });

    it("should return 426 for expired stream state", { skip: !redisAvailable || !secretsConfigured }, async () => {
      // Create a valid resume token for a non-existent request_id
      const fakeRequestId = `expired-${randomUUID()}`;
      const resumeToken = createResumeToken(fakeRequestId, "DRAFTING", 1);

      const response = await app.inject({
        method: "POST",
        url: "/assist/draft-graph/resume",
        headers: {
          "x-resume-token": resumeToken,
        },
      });

      // Should return 426 because state doesn't exist (no snapshot either)
      expect(response.statusCode).toBe(426);
      const body = JSON.parse(response.body);
      expect(body.code).toBe("INTERNAL");
      expect(body.message).toContain("Stream state expired");
      expect(body.details?.upgrade).toBe("resume=unsupported");
    });
  });

  describe("End-to-End Resume Flow", () => {
    it("should successfully resume a stream with buffered events", {
      skip: !redisAvailable || !secretsConfigured,
      timeout: 10000
    }, async () => {
      // Step 1: Start a stream
      const streamResponse = await app.inject({
        method: "POST",
        url: "/assist/draft-graph/stream",
        headers: {
          "content-type": "application/json",
        },
        payload: {
          brief: "Create a simple todo app",
        },
      });

      expect(streamResponse.statusCode).toBe(200);

      // Step 2: Extract resume token
      const body = streamResponse.body;
      const events = body.split("\n\n").filter(Boolean);
      const resumeEvent = events.find(e => e.includes("event: resume"));
      expect(resumeEvent).toBeDefined();

      const dataLine = resumeEvent?.split("\n").find(line => line.startsWith("data: "));
      const data = JSON.parse(dataLine!.substring(6));
      const resumeToken = data.token;

      // Step 3: Attempt resume (should work if stream still active, or get snapshot)
      const resumeResponse = await app.inject({
        method: "POST",
        url: "/assist/draft-graph/resume",
        headers: {
          "content-type": "application/json",
          "x-resume-token": resumeToken,
        },
      });

      // Should be 200 with SSE content
      expect(resumeResponse.statusCode).toBe(200);
      expect(resumeResponse.headers["content-type"]).toContain("text/event-stream");

      // Should have X-Correlation-ID header
      const resumeCorrelationId = resumeResponse.headers["x-correlation-id"] as string | undefined;
      expect(resumeCorrelationId).toBeDefined();

      // Parse SSE events from resume response
      const resumeBody = resumeResponse.body;
      const resumeEvents = resumeBody.split("\n\n").filter(Boolean);

      // Count replayed stage events
      const replayedStageEvents = resumeEvents.filter(e => e.includes("event: stage"));
      const replayedCount = replayedStageEvents.length;
      expect(replayedCount).toBeGreaterThanOrEqual(1);

      // The final snapshot is sent as a dedicated "complete" event with diagnostics
      const completeEvent = resumeEvents.find(e => e.includes("event: complete"));
      expect(completeEvent).toBeDefined();

      const completeDataLine = completeEvent
        ?.split("\n")
        .find(line => line.startsWith("data: "));
      expect(completeDataLine).toBeDefined();

      const completePayload = JSON.parse(completeDataLine!.substring(6));
      expect(completePayload).toHaveProperty("diagnostics");
      expect(completePayload.diagnostics).toMatchObject({
        resumes: 1,
        recovered_events: replayedCount,
      });

      if (resumeCorrelationId) {
        expect(completePayload.diagnostics.correlation_id).toBe(resumeCorrelationId);
      }

      expectNoBannedSubstrings(completePayload.diagnostics);
    });
  });

  describe("Snapshot Fallback", () => {
    it("should return snapshot for completed stream", {
      skip: !redisAvailable || !secretsConfigured,
      timeout: 10000
    }, async () => {
      // Step 1: Complete a full stream
      const streamResponse = await app.inject({
        method: "POST",
        url: "/assist/draft-graph/stream",
        headers: {
          "content-type": "application/json",
        },
        payload: {
          brief: "Create a simple todo app",
        },
      });

      expect(streamResponse.statusCode).toBe(200);

      // Extract resume token
      const body = streamResponse.body;
      const events = body.split("\n\n").filter(Boolean);
      const resumeEvent = events.find(e => e.includes("event: resume"));
      expect(resumeEvent).toBeDefined();

      const dataLine = resumeEvent?.split("\n").find(line => line.startsWith("data: "));
      const data = JSON.parse(dataLine!.substring(6));
      const resumeToken = data.token;

      // Wait a bit to ensure stream is complete
      await new Promise(resolve => setTimeout(resolve, 100));

      // Step 2: Resume after completion (should get snapshot)
      const resumeResponse = await app.inject({
        method: "POST",
        url: "/assist/draft-graph/resume",
        headers: {
          "content-type": "application/json",
          "x-resume-token": resumeToken,
        },
      });

      expect(resumeResponse.statusCode).toBe(200);
      expect(resumeResponse.headers["content-type"]).toContain("text/event-stream");

      // Should have complete event in response
      const resumeBody = resumeResponse.body;
      expect(resumeBody).toContain("event: complete");

      // Parse complete event payload and verify diagnostics
      const resumeEvents = resumeBody.split("\n\n").filter(Boolean);
      const completeEvent = resumeEvents.find(e => e.includes("event: complete"));
      expect(completeEvent).toBeDefined();

      const completeDataLine = completeEvent
        ?.split("\n")
        .find(line => line.startsWith("data: "));
      expect(completeDataLine).toBeDefined();

      const completePayload = JSON.parse(completeDataLine!.substring(6));
      expect(completePayload).toHaveProperty("diagnostics");
      expect(completePayload.diagnostics).toMatchObject({
        resumes: 1,
        recovered_events: 0,
      });

      const correlationId = resumeResponse.headers["x-correlation-id"] as string | undefined;
      if (correlationId) {
        expect(completePayload.diagnostics.correlation_id).toBe(correlationId);
      }

      expectNoBannedSubstrings(completePayload.diagnostics);
    });
  });

  describe("Graceful Degradation", () => {
    it("should handle Redis unavailability gracefully during streaming", { skip: redisAvailable }, async () => {
      const response = await app.inject({
        method: "POST",
        url: "/assist/draft-graph/stream",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          brief: "Create a simple todo app with user authentication and task management",
        }),
      });

      // Should still succeed without resume capability
      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toContain("text/event-stream");

      // Should have stage events
      const body = response.body;
      const events = body.split("\n\n").filter(Boolean);
      const stageEvents = events.filter(e => e.includes("event: stage"));
      expect(stageEvents.length).toBeGreaterThan(0);
    });

    it("should handle Redis unavailability gracefully in resume endpoint", { skip: redisAvailable }, async () => {
      const response = await app.inject({
        method: "POST",
        url: "/assist/draft-graph/resume",
        headers: {
          "x-resume-token": "fake-token",
        },
      });

      // Should return appropriate error (426 for secrets, 401 for invalid token)
      expect([400, 401, 426]).toContain(response.statusCode);
    });
  });

  describe("Security", () => {
    it("should reject tampered tokens", { skip: !secretsConfigured }, async () => {
      // Create a token-like string with tampered signature
      const tamperedToken = "eyJyZXF1ZXN0X2lkIjoidGVzdCIsInN0ZXAiOiJEUkFGVElORyIsInNlcSI6MX0.invalid-signature";

      const response = await app.inject({
        method: "POST",
        url: "/assist/draft-graph/resume",
        headers: {
          "x-resume-token": tamperedToken,
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.code).toBe("BAD_INPUT");
      expect(body.message).toContain("Invalid resume token");
    });

    it("should use constant-time comparison for signature verification", { skip: !secretsConfigured }, async () => {
      // This test verifies that the signature comparison doesn't leak timing information
      // In practice, this is tested by the unit tests for verifyHmacSha256
      // Here we just verify that invalid signatures are rejected consistently

      const tokens = [
        "invalid.token.1",
        "invalid.token.2",
        "invalid.token.3",
      ];

      const responses = await Promise.all(
        tokens.map(token =>
          app.inject({
            method: "POST",
            url: "/assist/draft-graph/resume",
            headers: {
              "x-resume-token": token,
            },
          })
        )
      );

      // All should fail with 401
      responses.forEach(response => {
        expect(response.statusCode).toBe(401);
      });
    });
  });

  describe("E2E: Replay-Only Behavior", () => {
    it("should replay events then close, requiring reconnect for live stream",
       { skip: !redisAvailable || !secretsConfigured },
       async () => {
      // Step 1: Start initial stream and capture resume token
      const initialStream = await app.inject({
        method: "POST",
        url: "/assist/draft-graph/stream",
        headers: {
          "content-type": "application/json",
        },
        payload: {
          brief: "Test replay-only behavior",
        },
      });

      expect(initialStream.statusCode).toBe(200);
      const initialBody = initialStream.body;

      // Parse SSE events from initial stream
      const initialEvents = initialBody.split("\n\n").filter(Boolean);

      // Extract resume token from second event
      let resumeToken: string | null = null;
      for (const event of initialEvents) {
        if (event.includes('event: resume')) {
          const dataLine = event.split('\n').find(line => line.startsWith('data: '));
          if (dataLine) {
            const jsonData = dataLine.substring(6); // Remove "data: " prefix
            const parsed = JSON.parse(jsonData);
            resumeToken = parsed.token;
            break;
          }
        }
      }

      expect(resumeToken).toBeTruthy();
      expect(typeof resumeToken).toBe("string");

      // Step 2: Simulate disconnection (we already have the token)
      // In real scenario, connection would drop here

      // Step 3: Resume with token (replay-only behavior)
      const resumeResponse = await app.inject({
        method: "POST",
        url: "/assist/draft-graph/resume",
        headers: {
          "x-resume-token": resumeToken!,
        },
      });

      expect(resumeResponse.statusCode).toBe(200);
      const resumeBody = resumeResponse.body;

      // Step 4: Verify replay-only behavior
      // Resume endpoint should:
      // 1. Replay buffered events
      // 2. Send heartbeat (optional)
      // 3. Close connection

      const resumeEvents = resumeBody.split("\n\n").filter(Boolean);

      // Should have at least some replayed events
      expect(resumeEvents.length).toBeGreaterThanOrEqual(1);

      // Verify events are replay of stage/complete events
      let hasStageEvent = false;
      for (const event of resumeEvents) {
        if (event.includes('event: stage') || event.includes('event: complete')) {
          hasStageEvent = true;
        }
      }
      expect(hasStageEvent).toBe(true);

      // Step 5: Verify that resume connection has closed
      // (In real client, this would be detected by connection close event)
      // The response should be complete (not streaming further)

      // Step 6: Client would now reconnect to /stream endpoint for live updates
      // (Demonstrated by ability to make new stream request)
      const reconnectStream = await app.inject({
        method: "POST",
        url: "/assist/draft-graph/stream",
        headers: {
          "content-type": "application/json",
        },
        payload: {
          brief: "Continue after resume",
        },
      });

      expect(reconnectStream.statusCode).toBe(200);
      // New stream starts successfully, demonstrating client must reconnect
      // for live events after resume replay completes
    });

    it("should demonstrate full resilient pattern: stream -> disconnect -> resume -> reconnect",
       { skip: !redisAvailable || !secretsConfigured },
       async () => {
      // This test demonstrates the recommended resilient streaming pattern:
      // 1. Start stream
      // 2. Save resume token on first event
      // 3. Simulate disconnect
      // 4. Resume to replay missed events
      // 5. Reconnect to main stream for live events

      let resumeToken: string | null = null;
      let replayedEventCount = 0;

      // Phase 1: Initial stream (before disconnect)
      const phase1 = await app.inject({
        method: "POST",
        url: "/assist/draft-graph/stream",
        headers: { "content-type": "application/json" },
        payload: { brief: "Resilient pattern test" },
      });

      expect(phase1.statusCode).toBe(200);

      // Extract token
      const phase1Events = phase1.body.split("\n\n").filter(Boolean);
      for (const event of phase1Events) {
        if (event.includes('event: resume')) {
          const dataLine = event.split('\n').find(line => line.startsWith('data: '));
          if (dataLine) {
            resumeToken = JSON.parse(dataLine.substring(6)).token;
          }
        }
      }

      expect(resumeToken).toBeTruthy();

      // Phase 2: Resume after disconnect
      const phase2 = await app.inject({
        method: "POST",
        url: "/assist/draft-graph/resume",
        headers: { "x-resume-token": resumeToken! },
      });

      expect(phase2.statusCode).toBe(200);

      // Count replayed events
      const phase2Events = phase2.body.split("\n\n").filter(Boolean);
      replayedEventCount = phase2Events.filter(e =>
        e.includes('event: stage') || e.includes('event: complete')
      ).length;

      expect(replayedEventCount).toBeGreaterThanOrEqual(1);

      // Phase 3: Reconnect for live events (resume closed after replay)
      const phase3 = await app.inject({
        method: "POST",
        url: "/assist/draft-graph/stream",
        headers: { "content-type": "application/json" },
        payload: { brief: "Reconnected stream" },
      });

      expect(phase3.statusCode).toBe(200);

      // Verify we can establish new stream after resume
      expect(phase3.body).toContain('event:');
    });
  });

  describe("Live Resume Mode (v1.9)", () => {
    it("should accept live mode query parameter", { skip: !redisAvailable || !secretsConfigured }, async () => {
      // Start stream and get resume token
      const streamResp = await app.inject({
        method: "POST",
        url: "/assist/draft-graph/stream",
        payload: { brief: "test" },
      });

      expect(streamResp.statusCode).toBe(200);

      // Extract token
      const events = streamResp.body.split("\n\n").filter(Boolean);
      let resumeToken: string | null = null;
      for (const event of events) {
        if (event.includes('event: resume')) {
          const dataLine = event.split('\n').find(line => line.startsWith('data: '));
          if (dataLine) {
            resumeToken = JSON.parse(dataLine.substring(6)).token;
          }
        }
      }
      expect(resumeToken).toBeTruthy();

      // Try live resume with query parameter (should fall back to replay-only without flag)
      const resumeResp = await app.inject({
        method: "POST",
        url: "/assist/draft-graph/resume?mode=live",
        headers: { "x-resume-token": resumeToken! },
      });

      expect(resumeResp.statusCode).toBe(200);
      expect(resumeResp.headers["content-type"]).toContain("text/event-stream");
    });

    it("should accept live mode via X-Resume-Mode header", { skip: !redisAvailable || !secretsConfigured }, async () => {
      // Start stream and get resume token
      const streamResp = await app.inject({
        method: "POST",
        url: "/assist/draft-graph/stream",
        payload: { brief: "test" },
      });

      expect(streamResp.statusCode).toBe(200);

      // Extract token
      const events = streamResp.body.split("\n\n").filter(Boolean);
      let resumeToken: string | null = null;
      for (const event of events) {
        if (event.includes('event: resume')) {
          const dataLine = event.split('\n').find(line => line.startsWith('data: '));
          if (dataLine) {
            resumeToken = JSON.parse(dataLine.substring(6)).token;
          }
        }
      }
      expect(resumeToken).toBeTruthy();

      // Try live resume with header (should still fall back to replay-only without flag)
      const resumeResp = await app.inject({
        method: "POST",
        url: "/assist/draft-graph/resume",
        headers: {
          "x-resume-token": resumeToken!,
          "x-resume-mode": "live"
        },
      });

      expect(resumeResp.statusCode).toBe(200);
      expect(resumeResp.headers["content-type"]).toContain("text/event-stream");
    });

    it("should verify telemetry events are defined for live mode", async () => {
      // Verify the telemetry events are defined
      const { TelemetryEvents } = await import("../../src/utils/telemetry.js");

      expect(TelemetryEvents.SseResumeLiveStart).toBeDefined();
      expect(TelemetryEvents.SseResumeLiveContinue).toBeDefined();
      expect(TelemetryEvents.SseResumeLiveEnd).toBeDefined();
      expect(TelemetryEvents.SseSnapshotRenewed).toBeDefined();
    });
  });
});
