import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  buildErrorV1,
  zodErrorToErrorV1,
  toErrorV1,
  getStatusCodeForErrorCode,
  type ErrorCode,
} from "../../src/utils/errors.js";

describe("error utilities", () => {
  describe("buildErrorV1", () => {
    it("should build basic error with code and message", () => {
      const error = buildErrorV1("BAD_INPUT", "Invalid request");

      expect(error.schema).toBe("error.v1");
      expect(error.code).toBe("BAD_INPUT");
      expect(error.message).toBe("Invalid request");
      expect(error.details).toBeUndefined();
      expect(error.request_id).toBeUndefined();
    });

    it("should include details when provided", () => {
      const error = buildErrorV1("BAD_INPUT", "Validation failed", {
        field: "brief",
        reason: "Too short",
      });

      expect(error.details).toEqual({
        field: "brief",
        reason: "Too short",
      });
    });

    it("should include request_id when provided", () => {
      const error = buildErrorV1(
        "INTERNAL",
        "Server error",
        undefined,
        "req-123"
      );

      expect(error.request_id).toBe("req-123");
    });
  });

  describe("zodErrorToErrorV1", () => {
    it("should convert Zod validation error to ErrorV1", () => {
      const schema = z.object({
        brief: z.string().min(30),
        round: z.number().min(0).max(2),
      });

      try {
        schema.parse({ brief: "short", round: 5 });
      } catch (zodError) {
        const error = zodErrorToErrorV1(zodError as z.ZodError);

        expect(error.schema).toBe("error.v1");
        expect(error.code).toBe("BAD_INPUT");
        expect(error.message).toBe("Validation failed");
        expect(error.details).toHaveProperty("validation_errors");
      }
    });

    it("should include request_id when provided", () => {
      const schema = z.object({ field: z.string() });

      try {
        schema.parse({ field: 123 });
      } catch (zodError) {
        const error = zodErrorToErrorV1(
          zodError as z.ZodError,
          "req-456"
        );

        expect(error.request_id).toBe("req-456");
      }
    });
  });

  describe("toErrorV1", () => {
    it("should convert Zod error to BAD_INPUT", () => {
      const schema = z.object({ field: z.string() });

      try {
        schema.parse({ field: 123 });
      } catch (zodError) {
        const error = toErrorV1(zodError);

        expect(error.code).toBe("BAD_INPUT");
        expect(error.message).toBe("Validation failed");
      }
    });

    it("should detect rate limit errors", () => {
      const rateLimitError = new Error("Rate limit exceeded");
      (rateLimitError as any).statusCode = 429;

      const error = toErrorV1(rateLimitError);

      expect(error.code).toBe("RATE_LIMITED");
      expect(error.message).toBe("Too many requests");
    });

    it("should detect body limit errors", () => {
      const bodyLimitError = new Error("Body limit exceeded");
      (bodyLimitError as any).code = "FST_ERR_CTP_BODY_TOO_LARGE";

      const error = toErrorV1(bodyLimitError);

      expect(error.code).toBe("BAD_INPUT");
      expect(error.details).toHaveProperty("max_size_bytes");
    });

    it("should use INTERNAL for unknown errors with generic message", () => {
      const unknownError = new Error("Something went wrong");

      const error = toErrorV1(unknownError);

      expect(error.code).toBe("INTERNAL");
      // Error message should be masked for INTERNAL errors
      expect(error.message).toBe("Internal server error");
    });

    it("should mask INTERNAL error messages (no details exposed)", () => {
      const errorWithStack = new Error("Database connection failed");
      errorWithStack.stack = "Error: Database connection failed\n  at db.connect (/app/src/db.ts:123:45)";

      const error = toErrorV1(errorWithStack);

      // INTERNAL errors return generic message, no specific details
      expect(error.message).toBe("Internal server error");
      expect(error.message).not.toContain("Database connection failed");
      expect(error.message).not.toContain("/app/src/db.ts");
      expect(error.message).not.toContain("at db.connect");
      expect(error.details).toBeUndefined();
    });

    it("should handle request object for request_id extraction", () => {
      const err = new Error("Test error");
      const mockRequest = {
        id: "fastify-req-789",
        requestId: "req-789",
      } as any;

      const error = toErrorV1(err, mockRequest);

      expect(error.request_id).toBeDefined();
    });

    it("should handle non-Error objects with generic message", () => {
      const stringError = "String error message";
      const error = toErrorV1(stringError);

      expect(error.code).toBe("INTERNAL");
      // String errors also get masked for INTERNAL errors
      expect(error.message).toBe("Internal server error");
    });

    it("should handle null/undefined errors with generic message", () => {
      const error1 = toErrorV1(null);
      const error2 = toErrorV1(undefined);

      expect(error1.code).toBe("INTERNAL");
      expect(error1.message).toBe("Internal server error");
      expect(error2.code).toBe("INTERNAL");
      expect(error2.message).toBe("Internal server error");
    });
  });

  describe("getStatusCodeForErrorCode", () => {
    it("should map BAD_INPUT to 400", () => {
      expect(getStatusCodeForErrorCode("BAD_INPUT")).toBe(400);
    });

    it("should map RATE_LIMITED to 429", () => {
      expect(getStatusCodeForErrorCode("RATE_LIMITED")).toBe(429);
    });

    it("should map NOT_FOUND to 404", () => {
      expect(getStatusCodeForErrorCode("NOT_FOUND")).toBe(404);
    });

    it("should map FORBIDDEN to 403", () => {
      expect(getStatusCodeForErrorCode("FORBIDDEN")).toBe(403);
    });

    it("should map INTERNAL to 500", () => {
      expect(getStatusCodeForErrorCode("INTERNAL")).toBe(500);
    });

    it("should default to 500 for unknown codes", () => {
      expect(getStatusCodeForErrorCode("UNKNOWN_CODE" as ErrorCode)).toBe(500);
    });
  });

  describe("error privacy (INTERNAL errors hardened)", () => {
    it("should never expose stack traces or original message", () => {
      const error = new Error("Test error with sensitive info");
      error.stack = "Stack trace with sensitive paths";

      const errorV1 = toErrorV1(error);

      // INTERNAL errors return generic message only
      expect(errorV1.message).toBe("Internal server error");
      expect(JSON.stringify(errorV1)).not.toContain("Stack trace");
      expect(JSON.stringify(errorV1)).not.toContain("sensitive");
      expect(errorV1.details).toBeUndefined();
    });

    it("should never expose environment variables", () => {
      const error = new Error("API_KEY=secret123 failed");

      const errorV1 = toErrorV1(error);

      // INTERNAL errors return generic message
      expect(errorV1.message).toBe("Internal server error");
      expect(errorV1.message).not.toContain("secret123");
      expect(errorV1.message).not.toContain("API_KEY");
    });

    it("should never expose file paths", () => {
      const error = new Error("Failed at /Users/admin/app/src/db.ts");

      const errorV1 = toErrorV1(error);

      // INTERNAL errors return generic message
      expect(errorV1.message).toBe("Internal server error");
      expect(errorV1.message).not.toContain("/Users/admin");
      expect(errorV1.message).not.toContain("db.ts");
    });

    it("should preserve specific messages for client-facing error codes", () => {
      // Rate limit errors keep their specific message
      const rateLimitError = new Error("Rate limit exceeded");
      (rateLimitError as any).statusCode = 429;
      const rateErrorV1 = toErrorV1(rateLimitError);
      expect(rateErrorV1.code).toBe("RATE_LIMITED");
      expect(rateErrorV1.message).toBe("Too many requests");

      // Body limit errors keep their specific message
      const bodyLimitError = new Error("Body limit exceeded");
      (bodyLimitError as any).code = "FST_ERR_CTP_BODY_TOO_LARGE";
      const bodyErrorV1 = toErrorV1(bodyLimitError);
      expect(bodyErrorV1.code).toBe("BAD_INPUT");
      expect(bodyErrorV1.message).toBe("Request body too large");
    });
  });
});
