/**
 * Boundary Logging Tests
 *
 * Tests for cross-service tracing headers and boundary events.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { boundaryLoggingPlugin } from "../../src/plugins/boundary-logging.js";
import { responseHashPlugin } from "../../src/plugins/response-hash.js";
import { attachRequestId } from "../../src/utils/request-id.js";
import { setTestSink, TelemetryEvents } from "../../src/utils/telemetry.js";
import { recordDownstreamCall } from "../../src/utils/request-timing.js";

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

    // Add a route that records downstream calls for testing
    app.get("/test/with-downstream", async (request) => {
      recordDownstreamCall(request, "isl", 150, {
        operation: "synthesize",
        status: 200,
        payload_hash: "abc123",
        response_hash: "def456",
      });
      recordDownstreamCall(request, "vector-db", 50, {
        operation: "query",
        status: 200,
        payload_hash: "ghi789",
        response_hash: "jkl012",
      });
      return { message: "ok with downstream" };
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

  describe("x-olumi-trace-received header", () => {
    it("should echo back request-id and payload-hash when both provided", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/test",
        headers: {
          "x-request-id": "upstream-req-123",
          "x-olumi-payload-hash": "upstream-hash-456",
        },
      });

      expect(response.headers["x-olumi-trace-received"]).toBe(
        "upstream-req-123:upstream-hash-456"
      );
    });

    it("should use 'none' when request-id is missing", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/test",
        headers: {
          "x-olumi-payload-hash": "hash-only",
        },
      });

      expect(response.headers["x-olumi-trace-received"]).toBe("none:hash-only");
    });

    it("should use 'none' when payload-hash is missing", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/test",
        headers: {
          "x-request-id": "req-only",
        },
      });

      expect(response.headers["x-olumi-trace-received"]).toBe("req-only:none");
    });

    it("should use 'none:none' when both are missing", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/test",
      });

      expect(response.headers["x-olumi-trace-received"]).toBe("none:none");
    });
  });

  describe("x-olumi-downstream-calls header", () => {
    it("should include downstream calls header when calls are recorded", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/test/with-downstream",
      });

      const header = response.headers["x-olumi-downstream-calls"];
      expect(header).toBeDefined();
      expect(header).toContain("isl:200:150:abc123:def456");
      expect(header).toContain("vector-db:200:50:ghi789:jkl012");
    });

    it("should NOT include downstream calls header when no calls recorded", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/test",
      });

      expect(response.headers["x-olumi-downstream-calls"]).toBeUndefined();
    });
  });

  describe("received_from_header in boundary.request", () => {
    it("should include received_from_header when x-request-id is provided", async () => {
      await app.inject({
        method: "GET",
        url: "/test",
        headers: {
          "x-request-id": "caller-request-id-789",
        },
      });

      const boundaryRequest = emittedEvents.find(
        (e) => e.event === TelemetryEvents.BoundaryRequest
      );

      expect(boundaryRequest?.data.received_from_header).toBe("caller-request-id-789");
    });

    it("should have undefined received_from_header when x-request-id is not provided", async () => {
      await app.inject({
        method: "GET",
        url: "/test",
      });

      const boundaryRequest = emittedEvents.find(
        (e) => e.event === TelemetryEvents.BoundaryRequest
      );

      expect(boundaryRequest?.data.received_from_header).toBeUndefined();
    });
  });

  describe("downstream array in boundary.response", () => {
    it("should include downstream array with full metadata", async () => {
      await app.inject({
        method: "GET",
        url: "/test/with-downstream",
      });

      const boundaryResponse = emittedEvents.find(
        (e) => e.event === TelemetryEvents.BoundaryResponse
      );

      expect(boundaryResponse?.data.downstream).toBeDefined();
      expect(boundaryResponse?.data.downstream).toHaveLength(2);

      // First downstream call
      expect(boundaryResponse?.data.downstream[0].target).toBe("isl");
      expect(boundaryResponse?.data.downstream[0].status).toBe(200);
      expect(boundaryResponse?.data.downstream[0].elapsed_ms).toBe(150);
      expect(boundaryResponse?.data.downstream[0].payload_hash).toBe("abc123");
      expect(boundaryResponse?.data.downstream[0].response_hash).toBe("def456");

      // Second downstream call
      expect(boundaryResponse?.data.downstream[1].target).toBe("vector-db");
      expect(boundaryResponse?.data.downstream[1].status).toBe(200);
      expect(boundaryResponse?.data.downstream[1].elapsed_ms).toBe(50);
      expect(boundaryResponse?.data.downstream[1].payload_hash).toBe("ghi789");
      expect(boundaryResponse?.data.downstream[1].response_hash).toBe("jkl012");
    });

    it("should have undefined downstream when no downstream calls recorded", async () => {
      await app.inject({
        method: "GET",
        url: "/test",
      });

      const boundaryResponse = emittedEvents.find(
        (e) => e.event === TelemetryEvents.BoundaryResponse
      );

      expect(boundaryResponse?.data.downstream).toBeUndefined();
    });
  });
});
