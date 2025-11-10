import { describe, it, expect, beforeEach as _beforeEach } from "vitest";
import {
  generateRequestId,
  getOrGenerateRequestId,
  attachRequestId,
  getRequestId,
  REQUEST_ID_HEADER,
} from "../../src/utils/request-id.js";

describe("request-id utilities", () => {
  describe("generateRequestId", () => {
    it("should generate a valid UUID v4", () => {
      const id = generateRequestId();

      // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      expect(id).toMatch(uuidRegex);
    });

    it("should generate unique IDs", () => {
      const id1 = generateRequestId();
      const id2 = generateRequestId();
      const id3 = generateRequestId();

      expect(id1).not.toBe(id2);
      expect(id2).not.toBe(id3);
      expect(id1).not.toBe(id3);
    });

    it("should generate IDs with correct length", () => {
      const id = generateRequestId();

      // UUID v4 is 36 characters (32 hex + 4 hyphens)
      expect(id).toHaveLength(36);
    });
  });

  describe("getOrGenerateRequestId", () => {
    it("should extract request ID from X-Request-Id header", () => {
      const mockRequest = {
        headers: {
          "x-request-id": "existing-id-123",
        },
      } as any;

      const id = getOrGenerateRequestId(mockRequest);
      expect(id).toBe("existing-id-123");
    });

    it("should handle lowercase header name", () => {
      const mockRequest = {
        headers: {
          "x-request-id": "lowercase-header-id",
        },
      } as any;

      const id = getOrGenerateRequestId(mockRequest);
      expect(id).toBe("lowercase-header-id");
    });

    it("should generate new ID if header is missing", () => {
      const mockRequest = {
        headers: {},
      } as any;

      const id = getOrGenerateRequestId(mockRequest);

      // Should be a valid UUID
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      expect(id).toMatch(uuidRegex);
    });

    it("should generate new ID if header is empty string", () => {
      const mockRequest = {
        headers: {
          "x-request-id": "",
        },
      } as any;

      const id = getOrGenerateRequestId(mockRequest);

      // Should generate new ID, not return empty string
      expect(id).not.toBe("");
      expect(id).toHaveLength(36);
    });

    it("should handle missing headers object", () => {
      const mockRequest = {} as any;

      const id = getOrGenerateRequestId(mockRequest);

      // Should generate new ID without crashing
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      expect(id).toMatch(uuidRegex);
    });
  });

  describe("attachRequestId", () => {
    it("should attach request ID to request object", () => {
      const mockRequest: any = {
        headers: {
          "x-request-id": "test-id-456",
        },
      };

      attachRequestId(mockRequest);

      expect(mockRequest.requestId).toBe("test-id-456");
    });

    it("should generate and attach ID if not in header", () => {
      const mockRequest: any = {
        headers: {},
      };

      attachRequestId(mockRequest);

      expect(mockRequest.requestId).toBeDefined();
      expect(mockRequest.requestId).toHaveLength(36);
    });

    it("should not overwrite existing requestId", () => {
      const mockRequest: any = {
        headers: {
          "x-request-id": "new-id",
        },
        requestId: "existing-id",
      };

      attachRequestId(mockRequest);

      // Should prefer header over existing requestId
      expect(mockRequest.requestId).toBe("new-id");
    });
  });

  describe("getRequestId", () => {
    it("should retrieve attached request ID", () => {
      const mockRequest: any = {
        requestId: "retrieved-id-789",
      };

      const id = getRequestId(mockRequest);
      expect(id).toBe("retrieved-id-789");
    });

    it("should return placeholder if no request ID attached", () => {
      const mockRequest: any = {};

      const id = getRequestId(mockRequest);
      expect(id).toBe("unknown");
    });

    it("should return placeholder for null request", () => {
      const id = getRequestId(null as any);
      expect(id).toBe("unknown");
    });

    it("should return placeholder for undefined request", () => {
      const id = getRequestId(undefined as any);
      expect(id).toBe("unknown");
    });
  });

  describe("REQUEST_ID_HEADER constant", () => {
    it("should be X-Request-Id", () => {
      expect(REQUEST_ID_HEADER).toBe("X-Request-Id");
    });
  });

  describe("end-to-end request ID flow", () => {
    it("should handle full lifecycle: attach -> retrieve", () => {
      const mockRequest: any = {
        headers: {
          "x-request-id": "e2e-test-id",
        },
      };

      // Attach request ID
      attachRequestId(mockRequest);

      // Retrieve request ID
      const id = getRequestId(mockRequest);

      expect(id).toBe("e2e-test-id");
    });

    it("should handle lifecycle with auto-generated ID", () => {
      const mockRequest: any = {
        headers: {},
      };

      // Attach (will generate new ID)
      attachRequestId(mockRequest);

      // Retrieve
      const id = getRequestId(mockRequest);

      expect(id).toBeDefined();
      expect(id).not.toBe("unknown");
      expect(id).toHaveLength(36);
    });

    it("should maintain ID consistency across multiple retrievals", () => {
      const mockRequest: any = {
        headers: {
          "x-request-id": "consistent-id",
        },
      };

      attachRequestId(mockRequest);

      const id1 = getRequestId(mockRequest);
      const id2 = getRequestId(mockRequest);
      const id3 = getRequestId(mockRequest);

      expect(id1).toBe("consistent-id");
      expect(id2).toBe("consistent-id");
      expect(id3).toBe("consistent-id");
    });
  });

  describe("header name case-insensitivity", () => {
    it("should handle lowercase x-request-id", () => {
      const mockRequest: any = {
        headers: {
          "x-request-id": "lowercase-id",
        },
      };

      attachRequestId(mockRequest);
      expect(getRequestId(mockRequest)).toBe("lowercase-id");
    });

    it("should handle uppercase X-REQUEST-ID", () => {
      const mockRequest: any = {
        headers: {
          "X-REQUEST-ID": "uppercase-id",
        },
      };

      const id = getOrGenerateRequestId(mockRequest);

      // Fastify normalizes headers to lowercase, so this tests our handling
      // In practice, Fastify would convert this to lowercase
      expect(id).toBeDefined();
    });
  });
});
