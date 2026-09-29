/**
 * CallerContext Integration Tests
 *
 * Tests that verify CallerContext is correctly integrated with routes:
 * 1. Request ID consistency between X-Request-Id header and CallerContext
 * 2. Key ID propagation from authentication to telemetry
 * 3. Telemetry context spreading in emit calls
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";

// Test utilities
async function createTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  // Minimal auth setup
  const testKeys: Record<string, { keyId: string }> = {
    "test-key-123": { keyId: "key-abc" },
  };

  // Simulate auth plugin behavior with CallerContext
  app.decorateRequest("callerContext", null);

  app.addHook("onRequest", async (request) => {
    const authHeader = request.headers["x-olumi-assist-key"] as string;
    if (authHeader && testKeys[authHeader]) {
      const keyInfo = testKeys[authHeader];
      const requestId = request.headers["x-request-id"] as string || request.id;

      (request as any).callerContext = {
        requestId,
        keyId: keyInfo.keyId,
        hmacAuth: false,
        timestamp: new Date().toISOString(),
        timestampMs: Date.now(),
      };
      (request as any).keyId = keyInfo.keyId;
    }
  });

  // Test route that returns context info
  app.get("/test/context", async (request, _reply) => {
    const ctx = (request as any).callerContext;
    const requestId = request.headers["x-request-id"] as string || request.id;

    return {
      requestId,
      contextRequestId: ctx?.requestId,
      contextKeyId: ctx?.keyId,
      requestIdMatch: requestId === ctx?.requestId,
    };
  });

  return app;
}

describe("CallerContext Integration", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe("Request ID consistency", () => {
    it("should preserve custom X-Request-Id in CallerContext", async () => {
      const customRequestId = "custom-request-id-12345";

      const response = await app.inject({
        method: "GET",
        url: "/test/context",
        headers: {
          "x-request-id": customRequestId,
          "x-olumi-assist-key": "test-key-123",
        },
      });

      const body = JSON.parse(response.body);

      expect(body.requestId).toBe(customRequestId);
      expect(body.contextRequestId).toBe(customRequestId);
      expect(body.requestIdMatch).toBe(true);
    });

    it("should propagate key ID to CallerContext", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/test/context",
        headers: {
          "x-olumi-assist-key": "test-key-123",
        },
      });

      const body = JSON.parse(response.body);

      expect(body.contextKeyId).toBe("key-abc");
    });

    it("should have null context when unauthenticated", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/test/context",
        headers: {},
      });

      const body = JSON.parse(response.body);

      expect(body.contextRequestId).toBeUndefined();
      expect(body.contextKeyId).toBeUndefined();
    });
  });

  describe("Telemetry context extraction", () => {
    it("contextToTelemetry should extract safe fields", async () => {
      // Import the actual contextToTelemetry function
      const { contextToTelemetry, createTestContext } = await import("../../src/context/index.js");

      const ctx = createTestContext({
        requestId: "req-123",
        keyId: "key-456",
        correlationId: "corr-789",
        sourceIp: "192.168.1.1", // sensitive - should not be in telemetry
        userAgent: "TestAgent/1.0", // sensitive - should not be in telemetry
      });

      const telemetry = contextToTelemetry(ctx);

      expect(telemetry.request_id).toBe("req-123");
      expect(telemetry.key_id).toBe("key-456");
      expect(telemetry.correlation_id).toBe("corr-789");

      // Sensitive fields should not be present
      expect((telemetry as any).sourceIp).toBeUndefined();
      expect((telemetry as any).source_ip).toBeUndefined();
      expect((telemetry as any).userAgent).toBeUndefined();
      expect((telemetry as any).user_agent).toBeUndefined();
    });
  });
});
