/**
 * Sentry middleware unit tests.
 *
 * Covers: deepRedact logic, sensitive header stripping,
 * request body erasure, recursive extra/contexts redaction.
 *
 * We test the exported functions directly and the beforeSend logic
 * by importing the internal deepRedact through a testing seam.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We need to test beforeSend logic. Since initSentry embeds it,
// we'll test the redaction functions by extracting the module's behaviour.
// The key testable export is initSentry, but we can test deepRedact
// indirectly via the Sentry mock's beforeSend capture.

let capturedBeforeSend: ((event: any) => any) | null = null;

vi.mock('@sentry/node', () => ({
  init: (opts: any) => {
    capturedBeforeSend = opts.beforeSend;
  },
  getCurrentScope: () => ({
    setTag: vi.fn(),
  }),
  withIsolationScope: (fn: any) => fn({ setTag: vi.fn() }),
  setupFastifyErrorHandler: vi.fn(),
}));

vi.mock('../../../src/utils/request-id.js', () => ({
  getRequestId: () => 'test-request-id',
}));

import { initSentry, setSentryRequestTag, createSentryRequestHook } from '../../../src/middleware/sentry.js';

describe('sentry middleware', () => {
  const originalEnv = process.env.SENTRY_DSN;

  beforeEach(() => {
    capturedBeforeSend = null;
    process.env.SENTRY_DSN = 'https://test@sentry.io/123';
    initSentry();
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.SENTRY_DSN;
    } else {
      process.env.SENTRY_DSN = originalEnv;
    }
  });

  // -------------------------------------------------------------------------
  // beforeSend — header stripping
  // -------------------------------------------------------------------------

  describe('beforeSend', () => {
    it('strips sensitive headers', () => {
      expect(capturedBeforeSend).toBeTruthy();
      const event = {
        request: {
          headers: {
            'x-olumi-assist-key': 'secret-key',
            'authorization': 'Bearer token',
            'cookie': 'session=abc',
            'x-admin-key': 'admin-secret',
            'content-type': 'application/json',
          },
        },
      };
      const result = capturedBeforeSend!(event);
      expect(result.request.headers['content-type']).toBe('application/json');
      expect(result.request.headers['x-olumi-assist-key']).toBeUndefined();
      expect(result.request.headers['authorization']).toBeUndefined();
      expect(result.request.headers['cookie']).toBeUndefined();
      expect(result.request.headers['x-admin-key']).toBeUndefined();
    });

    it('strips request body entirely', () => {
      const event = {
        request: {
          data: { brief: 'My secret decision', graph: {} },
          headers: {},
        },
      };
      const result = capturedBeforeSend!(event);
      expect(result.request.data).toBeUndefined();
    });

    it('redacts extra values with sensitive keys', () => {
      const event = {
        extra: {
          prompt: 'You are an assistant...',
          brief_content: 'Should I hire?',
          safe_key: 'visible',
          message: 'internal prompt text',
        },
      };
      const result = capturedBeforeSend!(event);
      expect(result.extra.prompt).toBe('[Redacted]');
      expect(result.extra.brief_content).toBe('[Redacted]');
      expect(result.extra.message).toBe('[Redacted]');
      expect(result.extra.safe_key).toBe('visible');
    });

    it('redacts long strings in extra', () => {
      const event = {
        extra: {
          debug_info: 'x'.repeat(201),
        },
      };
      const result = capturedBeforeSend!(event);
      expect(result.extra.debug_info).toBe('[Redacted — long string]');
    });

    it('recursively redacts nested objects in extra', () => {
      const event = {
        extra: {
          metadata: {
            llm_response: 'should be redacted',
            count: 42,
          },
        },
      };
      const result = capturedBeforeSend!(event);
      expect(result.extra.metadata.llm_response).toBe('[Redacted]');
      expect(result.extra.metadata.count).toBe(42);
    });

    it('deletes sensitive context keys entirely', () => {
      const event = {
        contexts: {
          prompt_context: { text: 'secret prompt' },
          runtime: { name: 'node', version: '20' },
        },
      };
      const result = capturedBeforeSend!(event);
      expect(result.contexts.prompt_context).toBeUndefined();
      expect(result.contexts.runtime).toBeDefined();
    });

    it('recursively redacts nested sensitive values within context objects', () => {
      const event = {
        contexts: {
          runtime: {
            name: 'node',
            llm_payload: 'should be redacted',
            nested: { body: 'also redacted', safe: 42 },
          },
        },
      };
      const result = capturedBeforeSend!(event);
      expect(result.contexts.runtime.llm_payload).toBe('[Redacted]');
      expect(result.contexts.runtime.nested.body).toBe('[Redacted]');
      expect(result.contexts.runtime.nested.safe).toBe(42);
      expect(result.contexts.runtime.name).toBe('node');
    });

    it('handles events with no request/extra/contexts gracefully', () => {
      const event = {};
      const result = capturedBeforeSend!(event);
      expect(result).toEqual({});
    });
  });

  // -------------------------------------------------------------------------
  // setSentryRequestTag — no-op without DSN
  // -------------------------------------------------------------------------

  describe('setSentryRequestTag', () => {
    it('does not throw', () => {
      expect(() => setSentryRequestTag('req-123')).not.toThrow();
    });

    it('is a no-op when DSN not set', () => {
      delete process.env.SENTRY_DSN;
      expect(() => setSentryRequestTag('req-456')).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // createSentryRequestHook
  // -------------------------------------------------------------------------

  describe('createSentryRequestHook', () => {
    it('returns an async function', () => {
      const hook = createSentryRequestHook();
      expect(typeof hook).toBe('function');
    });
  });
});
