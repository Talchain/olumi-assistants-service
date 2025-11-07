import { randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';

/**
 * Request ID header name (standard X-Request-Id)
 */
export const REQUEST_ID_HEADER = 'X-Request-Id';
export const REQUEST_ID_HEADER_LOWER = 'x-request-id';

/**
 * Generate a new request ID (UUID v4)
 */
export function generateRequestId(): string {
  return randomUUID();
}

/**
 * Extract request ID from incoming headers or generate a new one
 *
 * @param request Fastify request object
 * @returns Request ID string
 */
export function getOrGenerateRequestId(request: FastifyRequest): string {
  if (!request || !request.headers) {
    return generateRequestId();
  }

  // Check for incoming X-Request-Id header (case-insensitive)
  const incomingId = request.headers[REQUEST_ID_HEADER_LOWER]
    || request.headers[REQUEST_ID_HEADER];

  if (typeof incomingId === 'string' && incomingId.trim().length > 0) {
    return incomingId.trim();
  }

  // Generate new ID if not provided
  return generateRequestId();
}

/**
 * Attach request ID to Fastify request object
 * Sets both request.id (Fastify standard) and request.requestId (our field)
 */
export function attachRequestId(request: FastifyRequest): void {
  const requestId = getOrGenerateRequestId(request);
  (request as any).id = requestId;
  (request as any).requestId = requestId;
}

/**
 * Get request ID from Fastify request (assumes it was attached)
 * Checks multiple possible locations for backwards compatibility
 */
export function getRequestId(request?: FastifyRequest): string {
  if (!request) {
    return 'unknown';
  }

  return (request as any).requestId || (request as any).id || 'unknown';
}
