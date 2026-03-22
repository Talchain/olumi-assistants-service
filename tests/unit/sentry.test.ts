/**
 * Sentry middleware tests.
 *
 * Verifies:
 * - Sentry does not initialise when SENTRY_DSN is unset
 * - request_id tag is attached
 * - Sensitive headers are filtered in beforeSend
 * - request.data is stripped from events
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================================
// Mock setup
// ============================================================================

const mockInit = vi.fn();
const mockSetTag = vi.fn();
const mockSetupFastifyErrorHandler = vi.fn();
const mockWithIsolationScope = vi.fn((cb: (scope: any) => void) => cb({ setTag: vi.fn() }));
const mockGetCurrentScope = vi.fn(() => ({ setTag: mockSetTag }));

vi.mock('@sentry/node', () => ({
  init: mockInit,
  setTag: mockSetTag,
  getCurrentScope: mockGetCurrentScope,
  withIsolationScope: mockWithIsolationScope,
  setupFastifyErrorHandler: mockSetupFastifyErrorHandler,
}));

// ============================================================================
// Tests
// ============================================================================

describe('sentry middleware', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    mockInit.mockClear();
    mockSetTag.mockClear();
    mockGetCurrentScope.mockClear();
    mockWithIsolationScope.mockClear();
    mockSetupFastifyErrorHandler.mockClear();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('initSentry', () => {
    it('does not initialise when SENTRY_DSN is unset', async () => {
      delete process.env.SENTRY_DSN;
      const { initSentry } = await import('../../src/middleware/sentry.js');
      initSentry();
      expect(mockInit).not.toHaveBeenCalled();
    });

    it('initialises with correct config when SENTRY_DSN is set', async () => {
      process.env.SENTRY_DSN = 'https://test@sentry.io/123';
      process.env.NODE_ENV = 'test';
      process.env.CEE_BUILD_HASH = 'abc123';
      const { initSentry } = await import('../../src/middleware/sentry.js');
      initSentry();

      expect(mockInit).toHaveBeenCalledTimes(1);
      const config = mockInit.mock.calls[0][0];
      expect(config.dsn).toBe('https://test@sentry.io/123');
      expect(config.environment).toBe('test');
      expect(config.release).toBe('abc123');
      expect(config.tracesSampleRate).toBe(0.5);
      expect(typeof config.beforeSend).toBe('function');
    });
  });

  describe('beforeSend hook', () => {
    let beforeSend: (event: Record<string, unknown>) => Record<string, unknown>;

    beforeEach(async () => {
      process.env.SENTRY_DSN = 'https://test@sentry.io/123';
      const { initSentry } = await import('../../src/middleware/sentry.js');
      initSentry();
      beforeSend = mockInit.mock.calls[0][0].beforeSend;
    });

    it('strips sensitive headers', () => {
      const event = {
        request: {
          headers: {
            'x-olumi-assist-key': 'secret-key',
            'x-admin-key': 'admin-secret',
            'authorization': 'Bearer token123',
            'cookie': 'session=abc',
            'content-type': 'application/json',
            'x-request-id': 'req-123',
          },
          url: '/assist/v1/draft-graph',
        },
      };

      const result = beforeSend(event) as typeof event;
      expect(result.request.headers).not.toHaveProperty('x-olumi-assist-key');
      expect(result.request.headers).not.toHaveProperty('x-admin-key');
      expect(result.request.headers).not.toHaveProperty('authorization');
      expect(result.request.headers).not.toHaveProperty('cookie');
      // Non-sensitive headers preserved
      expect(result.request.headers['content-type']).toBe('application/json');
      expect(result.request.headers['x-request-id']).toBe('req-123');
    });

    it('strips request body entirely', () => {
      const event = {
        request: {
          data: '{"brief": "Should we acquire company X?"}',
          url: '/assist/v1/draft-graph',
        },
      };

      const result = beforeSend(event) as typeof event;
      expect(result.request.data).toBeUndefined();
    });

    it('redacts extra values with sensitive keys', () => {
      const event = {
        extra: {
          prompt_text: 'system prompt content here',
          brief_content: 'user decision brief',
          error_code: 'BAD_INPUT',
        },
      };

      const result = beforeSend(event) as typeof event;
      expect(result.extra!.prompt_text).toBe('[Redacted]');
      expect(result.extra!.brief_content).toBe('[Redacted]');
      // Non-sensitive extra preserved
      expect(result.extra!.error_code).toBe('BAD_INPUT');
    });

    it('redacts extra values with long strings', () => {
      const event = {
        extra: {
          some_field: 'x'.repeat(201),
          short_field: 'ok',
        },
      };

      const result = beforeSend(event) as typeof event;
      expect(result.extra!.some_field).toBe('[Redacted — long string]');
      expect(result.extra!.short_field).toBe('ok');
    });

    it('strips contexts with sensitive keys', () => {
      const event = {
        contexts: {
          llm_response: { model: 'gpt-4o', tokens: 100 },
          prompt_cache: { hit: true },
          runtime: { name: 'node', version: '20' },
        },
      };

      const result = beforeSend(event) as typeof event;
      expect(result.contexts).not.toHaveProperty('llm_response');
      expect(result.contexts).not.toHaveProperty('prompt_cache');
      expect(result.contexts!.runtime).toEqual({ name: 'node', version: '20' });
    });
  });

  describe('setSentryRequestTag', () => {
    it('sets tag when DSN is configured', async () => {
      process.env.SENTRY_DSN = 'https://test@sentry.io/123';
      const { setSentryRequestTag } = await import('../../src/middleware/sentry.js');
      setSentryRequestTag('req-abc');
      expect(mockSetTag).toHaveBeenCalledWith('request_id', 'req-abc');
    });

    it('is a no-op when DSN is not configured', async () => {
      delete process.env.SENTRY_DSN;
      const { setSentryRequestTag } = await import('../../src/middleware/sentry.js');
      setSentryRequestTag('req-abc');
      expect(mockSetTag).not.toHaveBeenCalled();
    });
  });

  describe('setupSentryFastify', () => {
    it('is a no-op when DSN is not configured', async () => {
      delete process.env.SENTRY_DSN;
      const { setupSentryFastify } = await import('../../src/middleware/sentry.js');
      const mockApp = {} as any;
      setupSentryFastify(mockApp);
      expect(mockSetupFastifyErrorHandler).not.toHaveBeenCalled();
    });
  });
});
