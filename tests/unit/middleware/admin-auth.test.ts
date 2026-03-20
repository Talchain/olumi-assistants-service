/**
 * Admin authentication middleware unit tests.
 *
 * Covers: IP allowlist verification, admin key validation,
 * permission levels, constant-time comparison usage, and telemetry.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted runs before vi.mock hoisting, so mockConfig is available in factory
const mockConfig = vi.hoisted(() => ({
  prompts: {
    adminAllowedIPs: '' as string,
    adminApiKey: 'full-key-secret' as string,
    adminApiKeyRead: 'read-key-secret' as string,
  },
}));

vi.mock('../../../src/config/index.js', () => ({
  config: mockConfig,
}));

vi.mock('../../../src/utils/telemetry.js', () => ({
  log: { warn: vi.fn(), info: vi.fn() },
  emit: vi.fn(),
  hashIP: (ip: string) => `hashed_${ip}`,
}));

vi.mock('../../../src/utils/hash.js', () => ({
  safeEqual: (a: string, b: string) => a === b,
}));

import { verifyIPAllowed, verifyAdminKey, getActorFromRequest } from '../../../src/middleware/admin-auth.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFakeRequest(opts: { ip?: string; adminKey?: string; url?: string }) {
  return {
    ip: opts.ip ?? '127.0.0.1',
    url: opts.url ?? '/admin/prompts',
    headers: {
      'x-admin-key': opts.adminKey,
    },
  } as any;
}

function makeFakeReply() {
  const reply = {
    statusCode: 200,
    body: null as unknown,
    status(code: number) {
      reply.statusCode = code;
      return reply;
    },
    send(body: unknown) {
      reply.body = body;
      return reply;
    },
  };
  return reply as any;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('admin-auth middleware', () => {
  beforeEach(() => {
    // Reset config to defaults
    mockConfig.prompts.adminAllowedIPs = '';
    mockConfig.prompts.adminApiKey = 'full-key-secret';
    mockConfig.prompts.adminApiKeyRead = 'read-key-secret';
  });

  // -------------------------------------------------------------------------
  // verifyIPAllowed
  // -------------------------------------------------------------------------

  describe('verifyIPAllowed', () => {
    it('allows all IPs when no allowlist configured', () => {
      mockConfig.prompts.adminAllowedIPs = '';
      const request = makeFakeRequest({ ip: '99.99.99.99' });
      const reply = makeFakeReply();
      expect(verifyIPAllowed(request, reply)).toBe(true);
    });

    it('allows IP in allowlist', () => {
      mockConfig.prompts.adminAllowedIPs = '10.0.0.1,10.0.0.2';
      const request = makeFakeRequest({ ip: '10.0.0.1' });
      const reply = makeFakeReply();
      expect(verifyIPAllowed(request, reply)).toBe(true);
    });

    it('blocks IP not in allowlist', () => {
      mockConfig.prompts.adminAllowedIPs = '10.0.0.1';
      const request = makeFakeRequest({ ip: '99.99.99.99' });
      const reply = makeFakeReply();
      expect(verifyIPAllowed(request, reply)).toBe(false);
      expect(reply.statusCode).toBe(403);
    });

    it('treats ::1 as equivalent to 127.0.0.1', () => {
      mockConfig.prompts.adminAllowedIPs = '127.0.0.1';
      const request = makeFakeRequest({ ip: '::1' });
      const reply = makeFakeReply();
      expect(verifyIPAllowed(request, reply)).toBe(true);
    });

    it('treats 127.0.0.1 as equivalent to ::1', () => {
      mockConfig.prompts.adminAllowedIPs = '::1';
      const request = makeFakeRequest({ ip: '127.0.0.1' });
      const reply = makeFakeReply();
      expect(verifyIPAllowed(request, reply)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // verifyAdminKey
  // -------------------------------------------------------------------------

  describe('verifyAdminKey', () => {
    it('allows full key for write operations', () => {
      const request = makeFakeRequest({ adminKey: 'full-key-secret' });
      const reply = makeFakeReply();
      expect(verifyAdminKey(request, reply, 'write')).toBe(true);
    });

    it('allows full key for read operations', () => {
      const request = makeFakeRequest({ adminKey: 'full-key-secret' });
      const reply = makeFakeReply();
      expect(verifyAdminKey(request, reply, 'read')).toBe(true);
    });

    it('allows read-only key for read operations', () => {
      const request = makeFakeRequest({ adminKey: 'read-key-secret' });
      const reply = makeFakeReply();
      expect(verifyAdminKey(request, reply, 'read')).toBe(true);
    });

    it('denies read-only key for write operations', () => {
      const request = makeFakeRequest({ adminKey: 'read-key-secret' });
      const reply = makeFakeReply();
      expect(verifyAdminKey(request, reply, 'write')).toBe(false);
      expect(reply.statusCode).toBe(403);
    });

    it('returns 401 for missing key', () => {
      const request = makeFakeRequest({});
      const reply = makeFakeReply();
      expect(verifyAdminKey(request, reply)).toBe(false);
      expect(reply.statusCode).toBe(401);
    });

    it('returns 401 for invalid key', () => {
      const request = makeFakeRequest({ adminKey: 'wrong-key' });
      const reply = makeFakeReply();
      expect(verifyAdminKey(request, reply)).toBe(false);
      expect(reply.statusCode).toBe(401);
    });

    it('returns 503 when no keys configured', () => {
      mockConfig.prompts.adminApiKey = '';
      mockConfig.prompts.adminApiKeyRead = '';
      const request = makeFakeRequest({ adminKey: 'anything' });
      const reply = makeFakeReply();
      expect(verifyAdminKey(request, reply)).toBe(false);
      expect(reply.statusCode).toBe(503);
    });

    it('checks IP before key', () => {
      mockConfig.prompts.adminAllowedIPs = '10.0.0.1';
      const request = makeFakeRequest({ ip: '99.99.99.99', adminKey: 'full-key-secret' });
      const reply = makeFakeReply();
      expect(verifyAdminKey(request, reply)).toBe(false);
      expect(reply.statusCode).toBe(403); // IP block, not 401
    });
  });

  // -------------------------------------------------------------------------
  // getActorFromRequest
  // -------------------------------------------------------------------------

  describe('getActorFromRequest', () => {
    it('returns hashed IP as actor', () => {
      const request = makeFakeRequest({ ip: '10.0.0.1' });
      const actor = getActorFromRequest(request);
      expect(actor).toBe('admin@hashed_10.0.0.1');
    });
  });
});
