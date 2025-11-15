/**
 * SSE Resume Token Tests
 *
 * Tests HMAC-signed resume token generation and verification:
 * - Token generation with all fields
 * - Token verification (valid/invalid/expired)
 * - Signature tampering detection
 * - Base64url encoding/decoding
 * - TTL expiration
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  generateResumeToken,
  verifyResumeToken,
  createResumeToken,
  type ResumeTokenPayload,
} from "../../src/utils/sse-resume-token.js";

describe("SSE Resume Token", () => {
  const originalSecret = process.env.SSE_RESUME_SECRET;
  const originalHmacSecret = process.env.HMAC_SECRET;

  beforeEach(() => {
    // Set a test secret
    process.env.SSE_RESUME_SECRET = "test-resume-secret-for-unit-tests";
  });

  afterEach(() => {
    // Restore original secrets
    if (originalSecret) {
      process.env.SSE_RESUME_SECRET = originalSecret;
    } else {
      delete process.env.SSE_RESUME_SECRET;
    }
    if (originalHmacSecret) {
      process.env.HMAC_SECRET = originalHmacSecret;
    }
  });

  describe("generateResumeToken", () => {
    it("should generate a valid token with all fields", () => {
      const payload: ResumeTokenPayload = {
        request_id: "req-123",
        step: "DRAFTING",
        seq: 42,
        expires_at: Date.now() + 900000, // 15 min
      };

      const token = generateResumeToken(payload);

      expect(token).toBeDefined();
      expect(typeof token).toBe("string");
      expect(token.length).toBeGreaterThan(0);

      // Token should be base64url encoded (no +, /, or =)
      expect(token).not.toMatch(/[+/=]/);
    });

    it("should generate different tokens for different payloads", () => {
      const now = Date.now();
      const payload1: ResumeTokenPayload = {
        request_id: "req-1",
        step: "DRAFTING",
        seq: 1,
        expires_at: now + 900000,
      };
      const payload2: ResumeTokenPayload = {
        request_id: "req-2",
        step: "DRAFTING",
        seq: 1,
        expires_at: now + 900000,
      };

      const token1 = generateResumeToken(payload1);
      const token2 = generateResumeToken(payload2);

      expect(token1).not.toBe(token2);
    });

    it("should generate deterministic tokens for same payload", () => {
      const payload: ResumeTokenPayload = {
        request_id: "req-123",
        step: "DRAFTING",
        seq: 42,
        expires_at: 1234567890000,
      };

      const token1 = generateResumeToken(payload);
      const token2 = generateResumeToken(payload);

      expect(token1).toBe(token2);
    });
  });

  describe("verifyResumeToken", () => {
    it("should verify a valid token", () => {
      const payload: ResumeTokenPayload = {
        request_id: "req-123",
        step: "DRAFTING",
        seq: 42,
        expires_at: Date.now() + 900000, // 15 min future
      };

      const token = generateResumeToken(payload);
      const result = verifyResumeToken(token);

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.payload.request_id).toBe(payload.request_id);
        expect(result.payload.step).toBe(payload.step);
        expect(result.payload.seq).toBe(payload.seq);
        expect(result.payload.expires_at).toBe(payload.expires_at);
      }
    });

    it("should reject expired token", () => {
      const payload: ResumeTokenPayload = {
        request_id: "req-123",
        step: "DRAFTING",
        seq: 42,
        expires_at: Date.now() - 1000, // Expired 1 second ago
      };

      const token = generateResumeToken(payload);
      const result = verifyResumeToken(token);

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toBe("TOKEN_EXPIRED");
      }
    });

    it("should reject tampered token", () => {
      const payload: ResumeTokenPayload = {
        request_id: "req-123",
        step: "DRAFTING",
        seq: 42,
        expires_at: Date.now() + 900000,
      };

      const token = generateResumeToken(payload);

      // Tamper with token by changing a character
      const tampered = token.slice(0, -1) + (token.slice(-1) === "a" ? "b" : "a");
      const result = verifyResumeToken(tampered);

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toMatch(/INVALID_SIGNATURE|DECODE_ERROR|INVALID_FORMAT/);
      }
    });

    it("should reject malformed token", () => {
      const result = verifyResumeToken("not-a-valid-token");

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toMatch(/INVALID_FORMAT|DECODE_ERROR/);
      }
    });

    it("should reject empty token", () => {
      const result = verifyResumeToken("");

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toMatch(/INVALID_FORMAT|DECODE_ERROR/);
      }
    });

    it("should reject token with missing parts", () => {
      const payload: ResumeTokenPayload = {
        request_id: "req-123",
        step: "DRAFTING",
        seq: 42,
        expires_at: Date.now() + 900000,
      };

      const token = generateResumeToken(payload);
      const decoded = Buffer.from(token, "base64url").toString("utf-8");
      const parts = decoded.split(":");

      // Remove signature
      const tamperedDecoded = parts.slice(0, -1).join(":");
      const tampered = Buffer.from(tamperedDecoded, "utf-8").toString("base64url");

      const result = verifyResumeToken(tampered);

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toMatch(/INVALID_FORMAT|DECODE_ERROR/);
      }
    });

    it("should handle different sequence numbers", () => {
      const sequences = [0, 1, 42, 100, 1000];

      for (const seq of sequences) {
        const payload: ResumeTokenPayload = {
          request_id: "req-123",
          step: "DRAFTING",
          seq,
          expires_at: Date.now() + 900000,
        };

        const token = generateResumeToken(payload);
        const result = verifyResumeToken(token);

        expect(result.valid).toBe(true);
        if (result.valid) {
          expect(result.payload.seq).toBe(seq);
        }
      }
    });
  });

  describe("createResumeToken", () => {
    it("should create token with default TTL", () => {
      const requestId = "req-123";
      const step = "DRAFTING";
      const seq = 42;

      const token = createResumeToken(requestId, step, seq);

      expect(token).toBeDefined();
      expect(typeof token).toBe("string");

      const result = verifyResumeToken(token);
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.payload.request_id).toBe(requestId);
        expect(result.payload.step).toBe(step);
        expect(result.payload.seq).toBe(seq);
        // Check that expires_at is in the future (default TTL: 15 min)
        expect(result.payload.expires_at).toBeGreaterThan(Date.now());
        expect(result.payload.expires_at).toBeLessThanOrEqual(Date.now() + 900000 + 1000);
      }
    });

    it("should create different tokens for different request IDs", () => {
      const token1 = createResumeToken("req-1", "DRAFTING", 1);
      const token2 = createResumeToken("req-2", "DRAFTING", 1);

      expect(token1).not.toBe(token2);
    });

    it("should create different tokens for different steps", () => {
      const token1 = createResumeToken("req-1", "DRAFTING", 1);
      const token2 = createResumeToken("req-1", "COMPLETE", 1);

      expect(token1).not.toBe(token2);
    });

    it("should create different tokens for different sequences", () => {
      const token1 = createResumeToken("req-1", "DRAFTING", 1);
      const token2 = createResumeToken("req-1", "DRAFTING", 2);

      expect(token1).not.toBe(token2);
    });
  });

  describe("Secret fallback", () => {
    it("should fallback to HMAC_SECRET when SSE_RESUME_SECRET not set", () => {
      delete process.env.SSE_RESUME_SECRET;
      process.env.HMAC_SECRET = "fallback-hmac-secret";

      const payload: ResumeTokenPayload = {
        request_id: "req-123",
        step: "DRAFTING",
        seq: 42,
        expires_at: Date.now() + 900000,
      };

      const token = generateResumeToken(payload);
      const result = verifyResumeToken(token);

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.payload.request_id).toBe(payload.request_id);
      }
    });

    it("should throw error when no secret is configured", () => {
      delete process.env.SSE_RESUME_SECRET;
      delete process.env.HMAC_SECRET;

      const payload: ResumeTokenPayload = {
        request_id: "req-123",
        step: "DRAFTING",
        seq: 42,
        expires_at: Date.now() + 900000,
      };

      expect(() => generateResumeToken(payload)).toThrow(
        "SSE_RESUME_SECRET or HMAC_SECRET must be configured"
      );
    });
  });

  describe("Base64url encoding", () => {
    it("should not contain URL-unsafe characters", () => {
      const payload: ResumeTokenPayload = {
        request_id: "req-123",
        step: "DRAFTING",
        seq: 42,
        expires_at: Date.now() + 900000,
      };

      const token = generateResumeToken(payload);

      // Should not contain +, /, or =
      expect(token).not.toMatch(/[+/=]/);
      // Should only contain URL-safe characters
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it("should be decodable from base64url", () => {
      const payload: ResumeTokenPayload = {
        request_id: "req-123",
        step: "DRAFTING",
        seq: 42,
        expires_at: Date.now() + 900000,
      };

      const token = generateResumeToken(payload);

      // Should be decodable
      expect(() => Buffer.from(token, "base64url")).not.toThrow();

      const decoded = Buffer.from(token, "base64url").toString("utf-8");
      expect(decoded).toContain("req-123");
      expect(decoded).toContain("DRAFTING");
    });
  });
});
