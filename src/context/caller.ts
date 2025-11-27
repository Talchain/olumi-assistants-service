/**
 * Caller Context
 *
 * Provides a structured type for request caller information.
 * Used to propagate authentication and telemetry context through
 * the request lifecycle.
 *
 * @example
 * ```typescript
 * import { getCallerContext, CallerContext } from '../context/caller.js';
 *
 * // In a route handler
 * const ctx = getCallerContext(request);
 * if (ctx) {
 *   console.log(`Request ${ctx.requestId} from key ${ctx.keyId}`);
 * }
 *
 * // Pass context to services
 * await myService.doSomething({ context: ctx });
 * ```
 */

import type { FastifyRequest } from 'fastify';
import { getRequestId } from '../utils/request-id.js';

/**
 * Caller context attached to authenticated requests
 */
export interface CallerContext {
  /** Unique request identifier for tracing */
  requestId: string;

  /** API key identifier (truncated hash for privacy) */
  keyId: string;

  /** Original API key (only available in auth plugin, not propagated) */
  // Note: We intentionally don't expose the full key to services

  /** Optional correlation ID for distributed tracing */
  correlationId?: string;

  /** Request timestamp (ISO 8601) */
  timestamp: string;

  /** Request timestamp (Unix milliseconds) */
  timestampMs: number;

  /** Whether the request used HMAC authentication */
  hmacAuth: boolean;

  /** Source IP address (for audit logging) */
  sourceIp?: string;

  /** User agent (for audit logging) */
  userAgent?: string;
}

/**
 * Symbol key for storing context on request object
 * Using a symbol prevents accidental collision with other properties
 */
const CALLER_CONTEXT_KEY = Symbol.for('olumi.callerContext');

/**
 * Attach caller context to a request
 * Called by auth plugin after successful authentication
 *
 * @internal
 */
export function attachCallerContext(
  request: FastifyRequest,
  context: Omit<CallerContext, 'requestId' | 'timestamp' | 'timestampMs'>
): CallerContext {
  const now = Date.now();
  const fullContext: CallerContext = {
    ...context,
    requestId: getRequestId(request),
    timestamp: new Date(now).toISOString(),
    timestampMs: now,
  };

  (request as any)[CALLER_CONTEXT_KEY] = fullContext;

  return fullContext;
}

/**
 * Get caller context from a request
 *
 * Returns undefined for unauthenticated requests or public routes.
 * Always check for undefined before using context properties.
 *
 * @param request - Fastify request object
 * @returns Caller context if authenticated, undefined otherwise
 */
export function getCallerContext(request: FastifyRequest): CallerContext | undefined {
  return (request as any)[CALLER_CONTEXT_KEY];
}

/**
 * Get caller context or throw if not authenticated
 *
 * Use in handlers where authentication is guaranteed.
 *
 * @param request - Fastify request object
 * @returns Caller context
 * @throws Error if context is not available
 */
export function requireCallerContext(request: FastifyRequest): CallerContext {
  const ctx = getCallerContext(request);
  if (!ctx) {
    throw new Error('Caller context not available. Ensure route requires authentication.');
  }
  return ctx;
}

/**
 * Create a minimal context for testing or internal operations
 *
 * @param overrides - Optional overrides for context fields
 * @returns A CallerContext suitable for testing
 */
export function createTestContext(
  overrides?: Partial<CallerContext>
): CallerContext {
  const now = Date.now();
  return {
    requestId: `test-${now}`,
    keyId: 'test-key',
    timestamp: new Date(now).toISOString(),
    timestampMs: now,
    hmacAuth: false,
    ...overrides,
  };
}

/**
 * Extract context fields for telemetry
 * Returns a subset of fields safe for logging
 */
export function contextToTelemetry(ctx: CallerContext): {
  request_id: string;
  key_id: string;
  correlation_id?: string;
} {
  return {
    request_id: ctx.requestId,
    key_id: ctx.keyId,
    correlation_id: ctx.correlationId,
  };
}
