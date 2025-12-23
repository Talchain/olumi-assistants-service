/**
 * Boundary Logging Tests
 *
 * Tests for cross-service tracing headers and boundary events.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { boundaryLoggingPlugin } from "../../src/plugins/boundary-logging.js";
import { responseHashPlugin } from "../../src/plugins/response-hash.js";
import { attachRequestId } from "../../src/utils/request-id.js";
import { setTestSink, TelemetryEvents } from "../../src/utils/telemetry.js";

describe("boundaryLoggingPlugin", () => {
  let app: FastifyInstance;
  let emittedEvents: Array<{ event: string; data: Record<string, any> }>;

  beforeEach(async () => {
    emittedEvents = [];
    setTestSink((event, data) => {
      emittedEvents.push({ event, data });
    });

    app = Fastify({ logger: false });

    // Register request ID hook (normally done in server.ts)
    app.addHook("onRequest", async (request) => {
      attachRequestId(request);
    });

    // Register response hash plugin (provides responseHash for boundary logging)
    await app.register(responseHashPlugin);

    // Register boundary logging plugin
    await app.register(boundaryLoggingPlugin);

    // Add a simple test route
    app.get("/test", async () => {
      return { message: "ok" };
    });

    app.post("/test", async () => {
      return { result: "posted" };
    });

    // Add an SSE route for testing response_hash_skipped
    app.get("/test/stream", async (_request, reply) => {
      reply.header("content-type", "text/event-stream");
      return reply.send("data: test\n\n");
    });

    await app.ready();
  });

  afterEach(async () => {
    setTestSink(null);
    await app.close();
  });

  describe("response headers", () => {
    it("should add x-olumi-service header to all responses", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/test",
      });

      expect(response.headers["x-olumi-service"]).toBe("cee");
    });

    it("should add x-olumi-service-build header to all responses", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/test",
      });

      const buildHeader = response.headers["x-olumi-service-build"];
      expect(buildHeader).toBeDefined();
      expect(typeof buildHeader).toBe("string");
      // Should be 7 characters (short git SHA)
      expect((buildHeader as string).length).toBe(7);
    });

    it("should include x-olumi-response-hash header", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/test",
      });

      const hashHeader = response.headers["x-olumi-response-hash"];
      expect(hashHeader).toBeDefined();
      // Should be 12 characters
      expect((hashHeader as string).length).toBe(12);
    });
  });

  describe("boundary.request event", () => {
    it("should emit boundary.request on request received", async () => {
      await app.inject({
        method: "GET",
        url: "/test",
      });

      const boundaryRequest = emittedEvents.find(
        (e) => e.event === TelemetryEvents.BoundaryRequest
      );
      expect(boundaryRequest).toBeDefined();
    });

    it("should include required fields in boundary.request", async () => {
      await app.inject({
        method: "GET",
        url: "/test",
      });

      const boundaryRequest = emittedEvents.find(
        (e) => e.event === TelemetryEvents.BoundaryRequest
      );

      expect(boundaryRequest?.data.timestamp).toBeDefined();
      expect(boundaryRequest?.data.request_id).toBeDefined();
      expect(boundaryRequest?.data.service).toBe("cee");
      expect(boundaryRequest?.data.endpoint).toBe("/test");
      expect(boundaryRequest?.data.method).toBe("GET");
    });

    it("should include payload_hash when provided", async () => {
      await app.inject({
        method: "POST",
        url: "/test",
        headers: {
          "x-olumi-payload-hash": "abc123def456",
        },
      });

      const boundaryRequest = emittedEvents.find(
        (e) => e.event === TelemetryEvents.BoundaryRequest
      );

      expect(boundaryRequest?.data.payload_hash).toBe("abc123def456");
    });

    it("should include client_build when provided", async () => {
      await app.inject({
        method: "GET",
        url: "/test",
        headers: {
          "x-olumi-client-build": "ad0df38",
        },
      });

      const boundaryRequest = emittedEvents.find(
        (e) => e.event === TelemetryEvents.BoundaryRequest
      );

      expect(boundaryRequest?.data.client_build).toBe("ad0df38");
    });

    it("should include payload_bytes from Content-Length header", async () => {
      await app.inject({
        method: "POST",
        url: "/test",
        headers: {
          "content-type": "application/json",
        },
        payload: { foo: "bar", baz: 123 },
      });

      const boundaryRequest = emittedEvents.find(
        (e) => e.event === TelemetryEvents.BoundaryRequest
      );

      // Content-Length should be included as payload_bytes
      expect(boundaryRequest?.data.payload_bytes).toBeGreaterThan(0);
    });
  });

  describe("boundary.response event", () => {
    it("should emit boundary.response on response sent", async () => {
      await app.inject({
        method: "GET",
        url: "/test",
      });

      const boundaryResponse = emittedEvents.find(
        (e) => e.event === TelemetryEvents.BoundaryResponse
      );
      expect(boundaryResponse).toBeDefined();
    });

    it("should include required fields in boundary.response", async () => {
      await app.inject({
        method: "GET",
        url: "/test",
      });

      const boundaryResponse = emittedEvents.find(
        (e) => e.event === TelemetryEvents.BoundaryResponse
      );

      expect(boundaryResponse?.data.timestamp).toBeDefined();
      expect(boundaryResponse?.data.request_id).toBeDefined();
      expect(boundaryResponse?.data.service).toBe("cee");
      expect(boundaryResponse?.data.endpoint).toBe("/test");
      expect(boundaryResponse?.data.status).toBe(200);
      expect(typeof boundaryResponse?.data.elapsed_ms).toBe("number");
    });

    it("should include response_hash from response-hash plugin", async () => {
      await app.inject({
        method: "GET",
        url: "/test",
      });

      const boundaryResponse = emittedEvents.find(
        (e) => e.event === TelemetryEvents.BoundaryResponse
      );

      expect(boundaryResponse?.data.response_hash).toBeDefined();
      expect((boundaryResponse?.data.response_hash as string).length).toBe(12);
    });

    it("should track elapsed time", async () => {
      await app.inject({
        method: "GET",
        url: "/test",
      });

      const boundaryResponse = emittedEvents.find(
        (e) => e.event === TelemetryEvents.BoundaryResponse
      );

      expect(boundaryResponse?.data.elapsed_ms).toBeGreaterThanOrEqual(0);
    });

    it("should include payload_hash from request for end-to-end tracing", async () => {
      await app.inject({
        method: "POST",
        url: "/test",
        headers: {
          "x-olumi-payload-hash": "client-hash-123",
        },
      });

      const boundaryResponse = emittedEvents.find(
        (e) => e.event === TelemetryEvents.BoundaryResponse
      );

      expect(boundaryResponse?.data.payload_hash).toBe("client-hash-123");
    });

    it("should include client_build from request for end-to-end tracing", async () => {
      await app.inject({
        method: "GET",
        url: "/test",
        headers: {
          "x-olumi-client-build": "ui-build-789",
        },
      });

      const boundaryResponse = emittedEvents.find(
        (e) => e.event === TelemetryEvents.BoundaryResponse
      );

      expect(boundaryResponse?.data.client_build).toBe("ui-build-789");
    });
  });

  describe("request/response correlation", () => {
    it("should use same request_id in both boundary events", async () => {
      await app.inject({
        method: "GET",
        url: "/test",
      });

      const boundaryRequest = emittedEvents.find(
        (e) => e.event === TelemetryEvents.BoundaryRequest
      );
      const boundaryResponse = emittedEvents.find(
        (e) => e.event === TelemetryEvents.BoundaryResponse
      );

      expect(boundaryRequest?.data.request_id).toBe(
        boundaryResponse?.data.request_id
      );
    });

    it("should have boundary.response.response_hash match X-Olumi-Response-Hash header", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/test",
      });

      const hashHeader = response.headers["x-olumi-response-hash"];
      const boundaryResponse = emittedEvents.find(
        (e) => e.event === TelemetryEvents.BoundaryResponse
      );

      expect(boundaryResponse?.data.response_hash).toBe(hashHeader);
    });
  });

  describe("SSE/non-JSON response handling", () => {
    it("should set response_hash_skipped for SSE responses", async () => {
      await app.inject({
        method: "GET",
        url: "/test/stream",
      });

      const boundaryResponse = emittedEvents.find(
        (e) => e.event === TelemetryEvents.BoundaryResponse
      );

      expect(boundaryResponse?.data.response_hash_skipped).toBe(true);
      expect(boundaryResponse?.data.response_hash).toBeUndefined();
    });

    it("should NOT set response_hash_skipped for JSON responses", async () => {
      await app.inject({
        method: "GET",
        url: "/test",
      });

      const boundaryResponse = emittedEvents.find(
        (e) => e.event === TelemetryEvents.BoundaryResponse
      );

      expect(boundaryResponse?.data.response_hash_skipped).toBeUndefined();
      expect(boundaryResponse?.data.response_hash).toBeDefined();
    });
  });
});
