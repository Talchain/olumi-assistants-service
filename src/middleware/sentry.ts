/**
 * Sentry integration for CEE.
 *
 * Initialises Sentry with DSN from SENTRY_DSN env var.
 * Skips initialisation when DSN is not set (dev/test environments).
 *
 * Privacy: beforeSend strips sensitive headers, request bodies (user briefs,
 * LLM prompts), and recursively redacts any extra/contexts values that may
 * contain prompt content.
 *
 * Request-scoped isolation ensures tags set for one request do not leak
 * into concurrent requests.
 */

import * as Sentry from '@sentry/node';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { getRequestId } from '../utils/request-id.js';

/** Sensitive header names to strip (lower-case for case-insensitive comparison). */
const SENSITIVE_HEADERS = new Set([
  'x-olumi-assist-key',
  'x-admin-key',
  'authorization',
  'cookie',
]);

/** Keys in extra/contexts that likely contain prompt or LLM payload content. */
const SENSITIVE_KEY_PATTERNS = [
  'prompt', 'brief', 'message', 'payload', 'body', 'content', 'llm',
];

function containsSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEY_PATTERNS.some(p => lower.includes(p));
}

/**
 * Recursively redact sensitive values from an object tree.
 * Replaces values matching sensitive key patterns or large strings with '[Redacted]'.
 * Returns a new object — does not mutate the input.
 */
function deepRedact(obj: Record<string, unknown>, depth = 0): Record<string, unknown> {
  if (depth > 8) return { _truncated: true };

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (containsSensitiveKey(key)) {
      result[key] = '[Redacted]';
    } else if (typeof value === 'string' && value.length > 200) {
      result[key] = '[Redacted — long string]';
    } else if (Array.isArray(value)) {
      result[key] = value.map(item =>
        item && typeof item === 'object' && !Array.isArray(item)
          ? deepRedact(item as Record<string, unknown>, depth + 1)
          : item,
      );
    } else if (value && typeof value === 'object') {
      result[key] = deepRedact(value as Record<string, unknown>, depth + 1);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Initialise Sentry. No-op when SENTRY_DSN is not set.
 * Call this early in the server build function.
 */
export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    release: process.env.CEE_BUILD_HASH || process.env.npm_package_version,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE) || 0.5,

    beforeSend(event) {
      // Strip sensitive headers
      if (event.request?.headers) {
        for (const header of Object.keys(event.request.headers)) {
          if (SENSITIVE_HEADERS.has(header.toLowerCase())) {
            delete event.request.headers[header];
          }
        }
      }

      // Strip request body entirely — user decision briefs, LLM prompts, and
      // freetext fields are user data and must not be captured.
      if (event.request) {
        event.request.data = undefined;
      }

      // Recursively redact extra values containing prompt content or LLM payloads
      if (event.extra) {
        event.extra = deepRedact(event.extra);
      }

      // Recursively redact contexts values containing prompt content or LLM payloads
      if (event.contexts) {
        for (const key of Object.keys(event.contexts)) {
          if (containsSensitiveKey(key)) {
            delete event.contexts[key];
          } else if (event.contexts[key] && typeof event.contexts[key] === 'object') {
            event.contexts[key] = deepRedact(
              event.contexts[key] as Record<string, unknown>,
            );
          }
        }
      }

      return event;
    },
  });
}

/**
 * Set the request_id tag on an isolated Sentry scope for this request.
 * Uses withScope to avoid tag leakage between concurrent requests.
 */
export function setSentryRequestTag(requestId: string): void {
  if (!process.env.SENTRY_DSN) return;
  Sentry.getCurrentScope().setTag('request_id', requestId);
}

/**
 * Create a Fastify onRequest hook that isolates Sentry scope per request.
 * Each request gets its own isolation scope so tags/breadcrumbs don't leak.
 */
export function createSentryRequestHook() {
  return async function sentryRequestHook(request: FastifyRequest): Promise<void> {
    if (!process.env.SENTRY_DSN) return;
    const requestId = getRequestId(request);
    Sentry.withIsolationScope((scope) => {
      scope.setTag('request_id', requestId);
      scope.setTag('method', request.method);
      scope.setTag('route', request.url);
    });
  };
}

/**
 * Register the Sentry Fastify error handler.
 * Call after all routes are registered.
 */
export function setupSentryFastify(app: FastifyInstance): void {
  if (!process.env.SENTRY_DSN) return;
  Sentry.setupFastifyErrorHandler(app);
}
