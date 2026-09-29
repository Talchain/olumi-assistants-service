/**
 * HMAC Authentication Tests
 *
 * Tests HMAC signature validation, replay protection, and clock skew tolerance
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { verifyHmacSignature, clearAllNonces } from '../../src/utils/hmac-auth.js';
import { randomUUID } from 'crypto';
import { createHash, createHmac } from 'crypto';

const TEST_SECRET = 'test-hmac-secret-for-testing';

// Helper to create canonical string and signature
function signRequest(
  method: string,
  path: string,
  body: string,
  timestamp?: string,
  nonce?: string
): { signature: string; timestamp?: string; nonce?: string } {
  // Match implementation: empty body => empty string (not SHA256 of empty)
  const bodyHash = (!body || body.length === 0)
    ? ''
    : createHash('sha256').update(body).digest('hex');

  let canonical: string;
  if (timestamp && nonce) {
    canonical = `${method}\n${path}\n${timestamp}\n${nonce}\n${bodyHash}`;
  } else {
    // Legacy format
    canonical = `${method}\n${path}\n${bodyHash}`;
  }

  const signature = createHmac('sha256', TEST_SECRET).update(canonical).digest('hex');

  return { signature, timestamp, nonce };
}

describe('HMAC Authentication', () => {
  beforeEach(() => {
    process.env.HMAC_SECRET = TEST_SECRET;
    process.env.HMAC_MAX_SKEW_MS = '300000'; // 5 minutes
  });

  afterEach(async () => {
    delete process.env.HMAC_SECRET;
    delete process.env.HMAC_MAX_SKEW_MS;
    await clearAllNonces();
  });

  describe('Signature Validation', () => {
    it('should accept valid signature with timestamp and nonce', async () => {
      const method = 'POST';
      const path = '/assist/draft-graph';
      const body = '{"brief":"test"}';
      const timestamp = Date.now().toString();
      const nonce = randomUUID();

      const { signature } = signRequest(method, path, body, timestamp, nonce);

      const result = await verifyHmacSignature(method, path, body, {
        'x-olumi-signature': signature,
        'x-olumi-timestamp': timestamp,
        'x-olumi-nonce': nonce,
      });

      expect(result.valid).toBe(true);
      expect(result.legacy).toBe(false);
    });

    it('should accept valid legacy signature without timestamp/nonce', async () => {
      const method = 'POST';
      const path = '/assist/draft-graph';
      const body = '{"brief":"test"}';

      const { signature } = signRequest(method, path, body);

      const result = await verifyHmacSignature(method, path, body, {
        'x-olumi-signature': signature,
      });

      expect(result.valid).toBe(true);
      expect(result.legacy).toBe(true);
    });

    it('should reject invalid signature', async () => {
      const method = 'POST';
      const path = '/assist/draft-graph';
      const body = '{"brief":"test"}';
      const timestamp = Date.now().toString();
      const nonce = randomUUID();

      const result = await verifyHmacSignature(method, path, body, {
        'x-olumi-signature': 'invalid-signature-here',
        'x-olumi-timestamp': timestamp,
        'x-olumi-nonce': nonce,
      });

      expect(result.valid).toBe(false);
      expect(result.error).toBe('INVALID_SIGNATURE');
    });

    it('should reject when signature is missing', async () => {
      const result = await verifyHmacSignature('POST', '/test', '', {});

      expect(result.valid).toBe(false);
      expect(result.error).toBe('MISSING_SIGNATURE');
    });

    it('should reject when HMAC_SECRET is not configured', async () => {
      delete process.env.HMAC_SECRET;

      const result = await verifyHmacSignature('POST', '/test', '', {
        'x-olumi-signature': 'some-signature',
      });

      expect(result.valid).toBe(false);
      expect(result.error).toBe('NO_SECRET');
    });
  });

  describe('Clock Skew Tolerance', () => {
    it('should accept signature within skew window', async () => {
      const method = 'POST';
      const path = '/test';
      const body = '';
      // 2 minutes in the past (within 5 minute window)
      const timestamp = (Date.now() - 2 * 60 * 1000).toString();
      const nonce = randomUUID();

      const { signature } = signRequest(method, path, body, timestamp, nonce);

      const result = await verifyHmacSignature(method, path, body, {
        'x-olumi-signature': signature,
        'x-olumi-timestamp': timestamp,
        'x-olumi-nonce': nonce,
      });

      expect(result.valid).toBe(true);
    });

    it('should reject signature outside skew window', async () => {
      const method = 'POST';
      const path = '/test';
      const body = '';
      // 10 minutes in the past (outside 5 minute window)
      const timestamp = (Date.now() - 10 * 60 * 1000).toString();
      const nonce = randomUUID();

      const { signature } = signRequest(method, path, body, timestamp, nonce);

      const result = await verifyHmacSignature(method, path, body, {
        'x-olumi-signature': signature,
        'x-olumi-timestamp': timestamp,
        'x-olumi-nonce': nonce,
      });

      expect(result.valid).toBe(false);
      expect(result.error).toBe('SIGNATURE_SKEW');
    });

    it('should accept signature from future within skew window', async () => {
      const method = 'POST';
      const path = '/test';
      const body = '';
      // 2 minutes in the future (within 5 minute window)
      const timestamp = (Date.now() + 2 * 60 * 1000).toString();
      const nonce = randomUUID();

      const { signature } = signRequest(method, path, body, timestamp, nonce);

      const result = await verifyHmacSignature(method, path, body, {
        'x-olumi-signature': signature,
        'x-olumi-timestamp': timestamp,
        'x-olumi-nonce': nonce,
      });

      expect(result.valid).toBe(true);
    });
  });

  describe('Replay Protection', () => {
    it('should reject reused nonce (replay attack)', async () => {
      const method = 'POST';
      const path = '/test';
      const body = '';
      const timestamp = Date.now().toString();
      const nonce = randomUUID();

      const { signature } = signRequest(method, path, body, timestamp, nonce);

      // First request should succeed
      const result1 = await verifyHmacSignature(method, path, body, {
        'x-olumi-signature': signature,
        'x-olumi-timestamp': timestamp,
        'x-olumi-nonce': nonce,
      });

      expect(result1.valid).toBe(true);

      // Second request with same nonce should be blocked
      const result2 = await verifyHmacSignature(method, path, body, {
        'x-olumi-signature': signature,
        'x-olumi-timestamp': timestamp,
        'x-olumi-nonce': nonce,
      });

      expect(result2.valid).toBe(false);
      expect(result2.error).toBe('REPLAY_BLOCKED');
    });

    it('should allow different nonces', async () => {
      const method = 'POST';
      const path = '/test';
      const body = '';
      const timestamp = Date.now().toString();

      // First request
      const nonce1 = randomUUID();
      const { signature: sig1 } = signRequest(method, path, body, timestamp, nonce1);

      const result1 = await verifyHmacSignature(method, path, body, {
        'x-olumi-signature': sig1,
        'x-olumi-timestamp': timestamp,
        'x-olumi-nonce': nonce1,
      });

      expect(result1.valid).toBe(true);

      // Second request with different nonce
      const nonce2 = randomUUID();
      const { signature: sig2 } = signRequest(method, path, body, timestamp, nonce2);

      const result2 = await verifyHmacSignature(method, path, body, {
        'x-olumi-signature': sig2,
        'x-olumi-timestamp': timestamp,
        'x-olumi-nonce': nonce2,
      });

      expect(result2.valid).toBe(true);
    });
  });

  describe('Body Hash Validation', () => {
    it('should detect body tampering', async () => {
      const method = 'POST';
      const path = '/test';
      const originalBody = '{"brief":"original"}';
      const tamperedBody = '{"brief":"tampered"}';
      const timestamp = Date.now().toString();
      const nonce = randomUUID();

      // Sign with original body
      const { signature } = signRequest(method, path, originalBody, timestamp, nonce);

      // Verify with tampered body
      const result = await verifyHmacSignature(method, path, tamperedBody, {
        'x-olumi-signature': signature,
        'x-olumi-timestamp': timestamp,
        'x-olumi-nonce': nonce,
      });

      expect(result.valid).toBe(false);
      expect(result.error).toBe('INVALID_SIGNATURE');
    });

    it('should handle empty body', async () => {
      const method = 'GET';
      const path = '/test';
      const body = '';
      const timestamp = Date.now().toString();
      const nonce = randomUUID();

      const { signature } = signRequest(method, path, body, timestamp, nonce);

      const result = await verifyHmacSignature(method, path, body, {
        'x-olumi-signature': signature,
        'x-olumi-timestamp': timestamp,
        'x-olumi-nonce': nonce,
      });

      expect(result.valid).toBe(true);
    });

    it('should handle undefined body', async () => {
      const method = 'GET';
      const path = '/test';
      const timestamp = Date.now().toString();
      const nonce = randomUUID();

      const { signature } = signRequest(method, path, '', timestamp, nonce);

      const result = await verifyHmacSignature(method, path, undefined, {
        'x-olumi-signature': signature,
        'x-olumi-timestamp': timestamp,
        'x-olumi-nonce': nonce,
      });

      expect(result.valid).toBe(true);
    });
  });
});
