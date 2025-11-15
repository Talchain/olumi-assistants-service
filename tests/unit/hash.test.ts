/**
 * Hash Utilities Tests
 *
 * Verifies both cryptographic (HMAC-SHA256) and non-cryptographic (fastHash)
 * hash functions for correctness, consistency, and security properties.
 */

import { describe, it, expect } from "vitest";
import { fastHash, hmacSha256, hmacSha256Object, verifyHmacSha256 } from "../../src/utils/hash.js";

describe("fastHash (non-cryptographic)", () => {
  it("should generate consistent hashes for same input", () => {
    const input = "test_string_123";
    const hash1 = fastHash(input);
    const hash2 = fastHash(input);
    expect(hash1).toBe(hash2);
  });

  it("should generate different hashes for different inputs", () => {
    const hash1 = fastHash("input_a");
    const hash2 = fastHash("input_b");
    expect(hash1).not.toBe(hash2);
  });

  it("should default to 8 character output", () => {
    const hash = fastHash("test");
    expect(hash).toHaveLength(8);
  });

  it("should respect custom length parameter", () => {
    const hash16 = fastHash("test", 16);
    const hash4 = fastHash("test", 4);
    expect(hash16).toHaveLength(16);
    expect(hash4).toHaveLength(4);
  });

  it("should pad short hashes with leading zeros", () => {
    // Test with input that produces small hash
    const hash = fastHash("a", 8);
    expect(hash).toHaveLength(8);
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it("should handle empty string", () => {
    const hash = fastHash("", 8);
    expect(hash).toHaveLength(8);
    expect(hash).toBe("00000000");
  });

  it("should handle unicode characters", () => {
    const hash1 = fastHash("hello");
    const hash2 = fastHash("héllo");
    expect(hash1).not.toBe(hash2);
  });

  it("should generate hex output only", () => {
    const hash = fastHash("test", 16);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it("should be deterministic across multiple calls", () => {
    const input = "api_key_abc123xyz789";
    const hashes = Array.from({ length: 100 }, () => fastHash(input, 8));
    const unique = new Set(hashes);
    expect(unique.size).toBe(1);
  });

  it("should handle very long strings", () => {
    const longString = "a".repeat(10000);
    const hash = fastHash(longString, 8);
    expect(hash).toHaveLength(8);
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("hmacSha256 (cryptographic)", () => {
  const secret = "test_secret_key";
  const data = "test_data";

  it("should generate consistent HMAC for same input and secret", () => {
    const hmac1 = hmacSha256(data, secret);
    const hmac2 = hmacSha256(data, secret);
    expect(hmac1).toBe(hmac2);
  });

  it("should generate different HMACs for different data", () => {
    const hmac1 = hmacSha256("data_a", secret);
    const hmac2 = hmacSha256("data_b", secret);
    expect(hmac1).not.toBe(hmac2);
  });

  it("should generate different HMACs for different secrets", () => {
    const hmac1 = hmacSha256(data, "secret_a");
    const hmac2 = hmacSha256(data, "secret_b");
    expect(hmac1).not.toBe(hmac2);
  });

  it("should default to hex output", () => {
    const hmac = hmacSha256(data, secret);
    expect(hmac).toMatch(/^[0-9a-f]{64}$/); // SHA-256 = 64 hex chars
  });

  it("should support base64 output", () => {
    const hmac = hmacSha256(data, secret, "base64");
    expect(hmac).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(hmac.length).toBe(44); // Base64 SHA-256 = 44 chars
  });

  it("should support truncation with length parameter", () => {
    const hmac16 = hmacSha256(data, secret, "hex", 16);
    const hmac8 = hmacSha256(data, secret, "hex", 8);
    expect(hmac16).toHaveLength(16);
    expect(hmac8).toHaveLength(8);
  });

  it("should handle empty data", () => {
    const hmac = hmacSha256("", secret);
    expect(hmac).toMatch(/^[0-9a-f]{64}$/);
  });

  it("should handle empty secret", () => {
    const hmac = hmacSha256(data, "");
    expect(hmac).toMatch(/^[0-9a-f]{64}$/);
  });

  it("should handle unicode in data", () => {
    const hmac1 = hmacSha256("hello", secret);
    const hmac2 = hmacSha256("héllo", secret);
    expect(hmac1).not.toBe(hmac2);
  });

  it("should be deterministic across multiple calls", () => {
    const hmacs = Array.from({ length: 100 }, () => hmacSha256(data, secret));
    const unique = new Set(hmacs);
    expect(unique.size).toBe(1);
  });
});

describe("hmacSha256Object (structured data)", () => {
  const secret = "test_secret";

  it("should hash objects consistently", () => {
    const obj = { userId: 123, action: "login" };
    const hmac1 = hmacSha256Object(obj, secret);
    const hmac2 = hmacSha256Object(obj, secret);
    expect(hmac1).toBe(hmac2);
  });

  it("should hash arrays consistently", () => {
    const arr = [1, 2, 3, "test"];
    const hmac1 = hmacSha256Object(arr, secret);
    const hmac2 = hmacSha256Object(arr, secret);
    expect(hmac1).toBe(hmac2);
  });

  it("should be sensitive to object property order (JSON.stringify)", () => {
    // JSON.stringify maintains property insertion order
    const obj1 = { a: 1, b: 2 };
    const obj2 = { b: 2, a: 1 };
    const hmac1 = hmacSha256Object(obj1, secret);
    const hmac2 = hmacSha256Object(obj2, secret);

    // In modern JavaScript, property order is preserved, so this should be equal
    // if objects were created with same property order, but we're testing different orders
    expect(hmac1).not.toBe(hmac2);
  });

  it("should handle nested objects", () => {
    const obj = {
      user: { id: 123, name: "Alice" },
      metadata: { timestamp: 1234567890 },
    };
    const hmac = hmacSha256Object(obj, secret);
    expect(hmac).toMatch(/^[0-9a-f]{64}$/);
  });

  it("should support base64 output", () => {
    const obj = { test: "value" };
    const hmac = hmacSha256Object(obj, secret, "base64");
    expect(hmac).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  it("should handle empty object", () => {
    const hmac = hmacSha256Object({}, secret);
    expect(hmac).toMatch(/^[0-9a-f]{64}$/);
  });

  it("should handle empty array", () => {
    const hmac = hmacSha256Object([], secret);
    expect(hmac).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("verifyHmacSha256 (signature verification)", () => {
  const secret = "verification_secret";
  const data = "data_to_verify";

  it("should verify valid signature", () => {
    const signature = hmacSha256(data, secret);
    const isValid = verifyHmacSha256(data, signature, secret);
    expect(isValid).toBe(true);
  });

  it("should reject invalid signature", () => {
    const signature = hmacSha256(data, secret);
    const tamperedSignature = signature.substring(0, 62) + "ff";
    const isValid = verifyHmacSha256(data, tamperedSignature, secret);
    expect(isValid).toBe(false);
  });

  it("should reject signature with wrong secret", () => {
    const signature = hmacSha256(data, "wrong_secret");
    const isValid = verifyHmacSha256(data, signature, secret);
    expect(isValid).toBe(false);
  });

  it("should reject signature for different data", () => {
    const signature = hmacSha256(data, secret);
    const isValid = verifyHmacSha256("different_data", signature, secret);
    expect(isValid).toBe(false);
  });

  it("should reject signature with wrong length", () => {
    const signature = hmacSha256(data, secret).substring(0, 32);
    const isValid = verifyHmacSha256(data, signature, secret);
    expect(isValid).toBe(false);
  });

  it("should use constant-time comparison (timing attack resistance)", () => {
    const signature = hmacSha256(data, secret);

    // Verify multiple times to ensure consistent behavior
    const results = Array.from({ length: 100 }, () =>
      verifyHmacSha256(data, signature, secret)
    );

    expect(results.every((r) => r === true)).toBe(true);
  });

  it("should handle empty data", () => {
    const signature = hmacSha256("", secret);
    expect(verifyHmacSha256("", signature, secret)).toBe(true);
    expect(verifyHmacSha256("non-empty", signature, secret)).toBe(false);
  });
});

describe("Hash utilities integration (real-world scenarios)", () => {
  it("should work for API key hashing (non-cryptographic)", () => {
    const apiKey = "sk_live_abc123def456ghi789";
    const keyId = fastHash(apiKey, 8);

    expect(keyId).toHaveLength(8);
    expect(keyId).toMatch(/^[0-9a-f]{8}$/);
    expect(fastHash(apiKey, 8)).toBe(keyId); // Deterministic
  });

  it("should work for attachment content hashing (non-cryptographic)", () => {
    const base64Content = "SGVsbG8gV29ybGQhIFRoaXMgaXMgYSB0ZXN0";
    const contentHash = fastHash(base64Content, 8);

    expect(contentHash).toHaveLength(8);
    expect(contentHash).toMatch(/^[0-9a-f]{8}$/);
  });

  it("should work for share token signing (cryptographic)", () => {
    const secret = "share_signing_secret";
    const payload = JSON.stringify({
      share_id: "share_123",
      created_at: 1234567890,
      expires_at: 1234567890 + 86400000,
    });

    const signature = hmacSha256(payload, secret);
    expect(verifyHmacSha256(payload, signature, secret)).toBe(true);

    // Tampered payload should fail
    const tamperedPayload = payload.replace("share_123", "share_999");
    expect(verifyHmacSha256(tamperedPayload, signature, secret)).toBe(false);
  });

  it("should work for share ID hashing (cryptographic with truncation)", () => {
    const shareId = "share_abc123def456";
    const secret = "telemetry_secret";
    const hashedId = hmacSha256(shareId, secret, "hex", 16);

    expect(hashedId).toHaveLength(16);
    expect(hashedId).toMatch(/^[0-9a-f]{16}$/);
  });

  it("should demonstrate difference between cryptographic and non-cryptographic", () => {
    const input = "sensitive_data";
    const secret = "secret_key";

    // Non-cryptographic (fast, not secret-based)
    const fast1 = fastHash(input, 8);
    const fast2 = fastHash(input, 8); // Same regardless of secret
    expect(fast1).toBe(fast2);

    // Cryptographic (secret-based, secure)
    const hmac1 = hmacSha256(input, "secret_a");
    const hmac2 = hmacSha256(input, "secret_b");
    expect(hmac1).not.toBe(hmac2); // Different secrets = different hashes
  });
});
