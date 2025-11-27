/**
 * CallerContext unit tests
 *
 * Tests the request context module that propagates authentication
 * and telemetry context through the request lifecycle.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  attachCallerContext,
  getCallerContext,
  requireCallerContext,
  createTestContext,
  contextToTelemetry,
  type CallerContext,
} from "../../src/context/caller.js";

describe("CallerContext", () => {
  describe("attachCallerContext", () => {
    it("should attach context to request object", () => {
      const mockRequest: any = {
        requestId: "test-request-123",
      };

      const ctx = attachCallerContext(mockRequest, {
        keyId: "key-abc",
        hmacAuth: false,
      });

      expect(ctx).toBeDefined();
      expect(ctx.keyId).toBe("key-abc");
      expect(ctx.hmacAuth).toBe(false);
      expect(ctx.requestId).toBe("test-request-123");
    });

    it("should populate timestamp fields automatically", () => {
      const mockRequest: any = {
        requestId: "test-request-456",
      };

      const before = Date.now();
      const ctx = attachCallerContext(mockRequest, {
        keyId: "key-def",
        hmacAuth: true,
      });
      const after = Date.now();

      expect(ctx.timestampMs).toBeGreaterThanOrEqual(before);
      expect(ctx.timestampMs).toBeLessThanOrEqual(after);
      expect(ctx.timestamp).toBeDefined();
      // ISO 8601 format check
      expect(ctx.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it("should include optional fields when provided", () => {
      const mockRequest: any = {
        requestId: "test-request-789",
      };

      const ctx = attachCallerContext(mockRequest, {
        keyId: "key-ghi",
        hmacAuth: false,
        sourceIp: "192.168.1.100",
        userAgent: "TestClient/1.0",
        correlationId: "corr-xyz-123",
      });

      expect(ctx.sourceIp).toBe("192.168.1.100");
      expect(ctx.userAgent).toBe("TestClient/1.0");
      expect(ctx.correlationId).toBe("corr-xyz-123");
    });

    it("should return the attached context", () => {
      const mockRequest: any = {
        requestId: "test-request-return",
      };

      const returned = attachCallerContext(mockRequest, {
        keyId: "key-return",
        hmacAuth: false,
      });

      const retrieved = getCallerContext(mockRequest);

      expect(returned).toBe(retrieved);
    });
  });

  describe("getCallerContext", () => {
    it("should retrieve attached context", () => {
      const mockRequest: any = {
        requestId: "test-get-123",
      };

      attachCallerContext(mockRequest, {
        keyId: "key-get",
        hmacAuth: true,
      });

      const ctx = getCallerContext(mockRequest);

      expect(ctx).toBeDefined();
      expect(ctx?.keyId).toBe("key-get");
      expect(ctx?.hmacAuth).toBe(true);
    });

    it("should return undefined for request without context", () => {
      const mockRequest: any = {
        requestId: "test-no-context",
      };

      const ctx = getCallerContext(mockRequest);

      expect(ctx).toBeUndefined();
    });

    it("should throw for null request", () => {
      // getCallerContext doesn't guard against null/undefined - callers
      // should ensure they have a valid request object
      expect(() => getCallerContext(null as any)).toThrow();
    });

    it("should throw for undefined request", () => {
      // getCallerContext doesn't guard against null/undefined - callers
      // should ensure they have a valid request object
      expect(() => getCallerContext(undefined as any)).toThrow();
    });
  });

  describe("requireCallerContext", () => {
    it("should return context when available", () => {
      const mockRequest: any = {
        requestId: "test-require-123",
      };

      attachCallerContext(mockRequest, {
        keyId: "key-require",
        hmacAuth: false,
      });

      const ctx = requireCallerContext(mockRequest);

      expect(ctx).toBeDefined();
      expect(ctx.keyId).toBe("key-require");
    });

    it("should throw when context is not available", () => {
      const mockRequest: any = {
        requestId: "test-require-missing",
      };

      expect(() => requireCallerContext(mockRequest)).toThrow(
        "Caller context not available"
      );
    });

    it("should throw with descriptive error message", () => {
      const mockRequest: any = {};

      expect(() => requireCallerContext(mockRequest)).toThrow(
        /authentication/i
      );
    });
  });

  describe("createTestContext", () => {
    it("should create context with default values", () => {
      const ctx = createTestContext();

      expect(ctx.requestId).toMatch(/^test-/);
      expect(ctx.keyId).toBe("test-key");
      expect(ctx.hmacAuth).toBe(false);
      expect(ctx.timestamp).toBeDefined();
      expect(ctx.timestampMs).toBeDefined();
    });

    it("should allow overriding default values", () => {
      const ctx = createTestContext({
        keyId: "custom-key",
        hmacAuth: true,
        correlationId: "custom-corr",
      });

      expect(ctx.keyId).toBe("custom-key");
      expect(ctx.hmacAuth).toBe(true);
      expect(ctx.correlationId).toBe("custom-corr");
    });

    it("should allow overriding requestId", () => {
      const ctx = createTestContext({
        requestId: "fixed-request-id",
      });

      expect(ctx.requestId).toBe("fixed-request-id");
    });

    it("should create contexts with timestamp-based requestIds", () => {
      const ctx1 = createTestContext();
      const ctx2 = createTestContext();

      // Both IDs should have the test- prefix and timestamp
      expect(ctx1.requestId).toMatch(/^test-\d+$/);
      expect(ctx2.requestId).toMatch(/^test-\d+$/);
      // Note: If called within the same millisecond, IDs may be identical
      // which is acceptable for test contexts
    });
  });

  describe("contextToTelemetry", () => {
    it("should extract telemetry-safe fields", () => {
      const ctx = createTestContext({
        requestId: "req-telemetry-123",
        keyId: "key-telemetry-456",
        correlationId: "corr-telemetry-789",
      });

      const telemetry = contextToTelemetry(ctx);

      expect(telemetry).toEqual({
        request_id: "req-telemetry-123",
        key_id: "key-telemetry-456",
        correlation_id: "corr-telemetry-789",
      });
    });

    it("should omit correlation_id when not present", () => {
      const ctx = createTestContext({
        requestId: "req-no-corr",
        keyId: "key-no-corr",
      });
      // Remove correlationId if it was set
      delete (ctx as any).correlationId;

      const telemetry = contextToTelemetry(ctx);

      expect(telemetry.request_id).toBe("req-no-corr");
      expect(telemetry.key_id).toBe("key-no-corr");
      expect(telemetry.correlation_id).toBeUndefined();
    });

    it("should not include sensitive fields like sourceIp", () => {
      const ctx = createTestContext({
        sourceIp: "192.168.1.1",
        userAgent: "SensitiveAgent/1.0",
      });

      const telemetry = contextToTelemetry(ctx);

      // Telemetry should only have safe fields
      expect(Object.keys(telemetry)).toEqual(
        expect.arrayContaining(["request_id", "key_id"])
      );
      expect((telemetry as any).sourceIp).toBeUndefined();
      expect((telemetry as any).source_ip).toBeUndefined();
      expect((telemetry as any).userAgent).toBeUndefined();
      expect((telemetry as any).user_agent).toBeUndefined();
    });
  });

  describe("end-to-end context flow", () => {
    it("should handle full lifecycle: attach -> retrieve -> telemetry", () => {
      const mockRequest: any = {
        requestId: "e2e-flow-123",
      };

      // Attach context (simulates auth plugin)
      const attached = attachCallerContext(mockRequest, {
        keyId: "e2e-key",
        hmacAuth: true,
        correlationId: "e2e-corr",
        sourceIp: "10.0.0.1",
        userAgent: "E2ETest/1.0",
      });

      // Retrieve context (simulates route handler)
      const retrieved = getCallerContext(mockRequest);

      // Extract telemetry (simulates logging)
      const telemetry = contextToTelemetry(retrieved!);

      // Verify full flow
      expect(attached).toBe(retrieved);
      expect(telemetry).toEqual({
        request_id: "e2e-flow-123",
        key_id: "e2e-key",
        correlation_id: "e2e-corr",
      });
    });

    it("should maintain context across multiple retrievals", () => {
      const mockRequest: any = {
        requestId: "multi-retrieve",
      };

      attachCallerContext(mockRequest, {
        keyId: "multi-key",
        hmacAuth: false,
      });

      const ctx1 = getCallerContext(mockRequest);
      const ctx2 = getCallerContext(mockRequest);
      const ctx3 = requireCallerContext(mockRequest);

      expect(ctx1).toBe(ctx2);
      expect(ctx2).toBe(ctx3);
    });
  });

  describe("type safety", () => {
    it("should have all required CallerContext fields", () => {
      const ctx = createTestContext();

      // Verify all required fields exist and have correct types
      expect(typeof ctx.requestId).toBe("string");
      expect(typeof ctx.keyId).toBe("string");
      expect(typeof ctx.timestamp).toBe("string");
      expect(typeof ctx.timestampMs).toBe("number");
      expect(typeof ctx.hmacAuth).toBe("boolean");
    });

    it("should allow optional fields to be undefined", () => {
      const ctx = createTestContext();

      // Optional fields may or may not be present
      expect(ctx.correlationId === undefined || typeof ctx.correlationId === "string").toBe(true);
      expect(ctx.sourceIp === undefined || typeof ctx.sourceIp === "string").toBe(true);
      expect(ctx.userAgent === undefined || typeof ctx.userAgent === "string").toBe(true);
    });
  });
});
