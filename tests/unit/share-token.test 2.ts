import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  generateShareId,
  signShareToken,
  verifyShareToken,
  hashShareId,
} from "../../src/utils/share-token.js";

describe("share-token", () => {
  beforeEach(() => {
    // Set test environment
    vi.stubEnv("SHARE_SECRET", "test-secret-key-for-shares");
  });

  describe("generateShareId()", () => {
    it("should generate random 32-char hex string", () => {
      const id1 = generateShareId();
      const id2 = generateShareId();

      expect(id1).toMatch(/^[a-f0-9]{32}$/);
      expect(id2).toMatch(/^[a-f0-9]{32}$/);
      expect(id1).not.toBe(id2); // Should be random
    });
  });

  describe("signShareToken()", () => {
    it("should create signed token with payload", () => {
      const payload = {
        share_id: "abc123",
        created_at: Date.now(),
        expires_at: Date.now() + 86400000,
      };

      const token = signShareToken(payload);

      expect(token).toContain(".");
      const [encodedPayload, signature] = token.split(".");
      expect(encodedPayload).toBeTruthy();
      expect(signature).toMatch(/^[a-f0-9]{64}$/);
    });

    it("should produce deterministic signature for same payload", () => {
      const payload = {
        share_id: "abc123",
        created_at: 1700000000000,
        expires_at: 1700086400000,
      };

      const token1 = signShareToken(payload);
      const token2 = signShareToken(payload);

      expect(token1).toBe(token2);
    });

    it("should produce different signature for different payload", () => {
      const payload1 = {
        share_id: "abc123",
        created_at: 1700000000000,
        expires_at: 1700086400000,
      };

      const payload2 = {
        share_id: "xyz789",
        created_at: 1700000000000,
        expires_at: 1700086400000,
      };

      const token1 = signShareToken(payload1);
      const token2 = signShareToken(payload2);

      expect(token1).not.toBe(token2);
    });
  });

  describe("verifyShareToken()", () => {
    it("should verify valid token and return payload", () => {
      const payload = {
        share_id: "abc123",
        created_at: Date.now(),
        expires_at: Date.now() + 86400000,
      };

      const token = signShareToken(payload);
      const verified = verifyShareToken(token);

      expect(verified).toEqual(payload);
    });

    it("should reject tampered token", () => {
      const payload = {
        share_id: "abc123",
        created_at: Date.now(),
        expires_at: Date.now() + 86400000,
      };

      const token = signShareToken(payload);
      const tampered = token.replace(/[a-f]/, "x");

      const verified = verifyShareToken(tampered);
      expect(verified).toBeNull();
    });

    it("should reject expired token", () => {
      const payload = {
        share_id: "abc123",
        created_at: Date.now() - 200000,
        expires_at: Date.now() - 100000, // Expired
      };

      const token = signShareToken(payload);
      const verified = verifyShareToken(token);

      expect(verified).toBeNull();
    });

    it("should reject malformed token", () => {
      expect(verifyShareToken("invalid")).toBeNull();
      expect(verifyShareToken("invalid.token")).toBeNull();
      expect(verifyShareToken("")).toBeNull();
    });

    it("should reject token with invalid base64", () => {
      expect(verifyShareToken("!!!invalid!!!.abc123")).toBeNull();
    });
  });

  describe("hashShareId()", () => {
    it("should return 16-char hash", () => {
      const hash = hashShareId("abc123");

      expect(hash).toMatch(/^[a-f0-9]{16}$/);
    });

    it("should produce deterministic hash", () => {
      const hash1 = hashShareId("abc123");
      const hash2 = hashShareId("abc123");

      expect(hash1).toBe(hash2);
    });

    it("should produce different hash for different input", () => {
      const hash1 = hashShareId("abc123");
      const hash2 = hashShareId("xyz789");

      expect(hash1).not.toBe(hash2);
    });
  });
});
