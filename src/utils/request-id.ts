import { randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';

/**
 * Request ID header name (standard X-Request-Id)
 */
export const REQUEST_ID_HEADER = 'X-Request-Id';
export const REQUEST_ID_HEADER_LOWER = 'x-request-id';

/**
 * Safe request ID pattern - alphanumeric with dots, underscores, hyphens
 * Max 64 characters to prevent header injection and log pollution
 */
export const SAFE_REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * Check if request ID matches safe pattern
 */
export function isValidRequestId(id: string | undefined | null): boolean {
  if (!id || typeof id !== "string") return false;
  return SAFE_REQUEST_ID_PATTERN.test(id);
}

/**
 * Generate a new request ID (UUID v4)
 */
export function generateRequestId(): string {
  return randomUUID();
}

/**
 * Extract request ID from incoming headers or generate a new one
 * Validates against SAFE_REQUEST_ID_PATTERN and regenerates on violation
 *
 * @param request Fastify request object
 * @param logger Optional logger for warnings on invalid IDs
 * @returns Request ID string (always safe)
 */
export function getOrGenerateRequestId(request: FastifyRequest): string {
  if (!request || !request.headers) {
    return generateRequestId();
  }

  // Check headers in priority order: X-Request-Id → X-CEE-Request-ID → x-correlation-id
  const candidates = [
    request.headers[REQUEST_ID_HEADER_LOWER] || request.headers[REQUEST_ID_HEADER],
    request.headers['x-cee-request-id'],
    request.headers['x-correlation-id'],
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      if (isValidRequestId(trimmed)) {
        return trimmed;
      }
      // Log warning for invalid request ID (header injection attempt or malformed)
      if (trimmed.length > 0 && request.log) {
        request.log.warn(
          { invalidRequestId: trimmed.substring(0, 100) },
          'Invalid request ID rejected, trying next header'
        );
      }
    }
  }

  // Generate new ID if not provided or invalid
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
