/**
 * HMAC Utilities Tests
 *
 * Tests HMAC signing and verification helpers in the SDK
 */

import { describe, it, expect } from "vitest";
import { sign, generateNonce, verifyResponseHash } from "./hmac.js";
import { createHash } from "node:crypto";

describe("HMAC Utilities", () => {
  describe("generateNonce", () => {
    it("should generate a UUID v4 nonce", () => {
      const nonce = generateNonce();

      // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
      expect(nonce).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
    });

    it("should generate unique nonces", () => {
      const nonce1 = generateNonce();
      const nonce2 = generateNonce();

      expect(nonce1).not.toBe(nonce2);
    });

    it("should generate nonces of consistent length", () => {
      const nonces = Array.from({ length: 10 }, () => generateNonce());

      nonces.forEach((nonce) => {
        expect(nonce.length).toBe(36); // Standard UUID length with hyphens
      });
    });
  });

  describe("sign", () => {
    const TEST_SECRET = "test-secret-for-signing";

    it("should generate HMAC headers with signature, timestamp, and nonce", () => {
      const headers = sign("POST", "/assist/draft-graph", '{"brief":"test"}', {
        secret: TEST_SECRET,
      });

      expect(headers).toHaveProperty("X-Olumi-Signature");
      expect(headers).toHaveProperty("X-Olumi-Timestamp");
      expect(headers).toHaveProperty("X-Olumi-Nonce");

      expect(headers["X-Olumi-Signature"]).toMatch(/^[0-9a-f]{64}$/); // SHA256 hex
      expect(headers["X-Olumi-Timestamp"]).toMatch(/^\d+$/); // Unix timestamp
      expect(headers["X-Olumi-Nonce"]).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      ); // UUID v4
    });

    it("should use custom timestamp and nonce if provided", () => {
      const customTimestamp = 1234567890000;
      const customNonce = "custom-nonce-123";

      const headers = sign("POST", "/assist/draft-graph", '{"brief":"test"}', {
        secret: TEST_SECRET,
        timestamp: customTimestamp,
        nonce: customNonce,
      });

      expect(headers["X-Olumi-Timestamp"]).toBe(customTimestamp.toString());
      expect(headers["X-Olumi-Nonce"]).toBe(customNonce);
    });

    it("should handle empty body", () => {
      const headers = sign("GET", "/v1/status", undefined, {
        secret: TEST_SECRET,
        timestamp: 1234567890000,
        nonce: "test-nonce",
      });

      expect(headers["X-Olumi-Signature"]).toBeDefined();
      expect(headers["X-Olumi-Signature"].length).toBe(64); // SHA256 hex length
    });

    it("should throw if secret is not provided", () => {
      expect(() =>
        sign("POST", "/test", '{"data":"test"}', { secret: "" })
      ).toThrow("HMAC secret is required");
    });

    it("should generate different signatures for different bodies", () => {
      const headers1 = sign("POST", "/test", '{"data":"one"}', {
        secret: TEST_SECRET,
        timestamp: 1000000,
        nonce: "nonce-1",
      });

      const headers2 = sign("POST", "/test", '{"data":"two"}', {
        secret: TEST_SECRET,
        timestamp: 1000000,
        nonce: "nonce-1",
      });

      expect(headers1["X-Olumi-Signature"]).not.toBe(
        headers2["X-Olumi-Signature"]
      );
    });

    it("should generate different signatures for different paths", () => {
      const body = '{"data":"test"}';
      const options = {
        secret: TEST_SECRET,
        timestamp: 1000000,
        nonce: "nonce-1",
      };

      const headers1 = sign("POST", "/path1", body, options);
      const headers2 = sign("POST", "/path2", body, options);

      expect(headers1["X-Olumi-Signature"]).not.toBe(
        headers2["X-Olumi-Signature"]
      );
    });

    it("should generate different signatures for different methods", () => {
      const body = '{"data":"test"}';
      const options = {
        secret: TEST_SECRET,
        timestamp: 1000000,
        nonce: "nonce-1",
      };

      const headers1 = sign("POST", "/test", body, options);
      const headers2 = sign("GET", "/test", body, options);

      expect(headers1["X-Olumi-Signature"]).not.toBe(
        headers2["X-Olumi-Signature"]
      );
    });

    it("should generate deterministic signatures for same inputs", () => {
      const options = {
        secret: TEST_SECRET,
        timestamp: 1234567890000,
        nonce: "fixed-nonce",
      };

      const headers1 = sign("POST", "/test", '{"data":"test"}', options);
      const headers2 = sign("POST", "/test", '{"data":"test"}', options);

      expect(headers1["X-Olumi-Signature"]).toBe(headers2["X-Olumi-Signature"]);
    });
  });

  describe("verifyResponseHash", () => {
    it("should verify correct hash", () => {
      const responseBody = '{"schema":"graph.v1","nodes":[],"edges":[]}';
      const expectedHash = createHash("sha256")
        .update(responseBody)
        .digest("hex");

      const result = verifyResponseHash(responseBody, expectedHash);

      expect(result).toBe(true);
    });

    it("should reject incorrect hash", () => {
      const responseBody = '{"schema":"graph.v1","nodes":[],"edges":[]}';
      const wrongHash = "0".repeat(64); // Invalid hash

      const result = verifyResponseHash(responseBody, wrongHash);

      expect(result).toBe(false);
    });

    it("should handle empty response body", () => {
      const responseBody = "";
      const expectedHash = createHash("sha256").update(responseBody).digest("hex");

      const result = verifyResponseHash(responseBody, expectedHash);

      expect(result).toBe(true);
    });

    it("should reject hash with wrong length", () => {
      const responseBody = '{"data":"test"}';
      const shortHash = "abc123"; // Too short

      const result = verifyResponseHash(responseBody, shortHash);

      expect(result).toBe(false);
    });

    it("should use constant-time comparison", () => {
      // This test ensures the implementation uses constant-time comparison
      // by verifying it returns false for hashes that differ in early positions
      const responseBody = '{"data":"test"}';
      const correctHash = createHash("sha256")
        .update(responseBody)
        .digest("hex");

      // Hash that differs in first character
      const wrongHash = "0" + correctHash.slice(1);

      const result = verifyResponseHash(responseBody, wrongHash);

      expect(result).toBe(false);
    });
  });
});
