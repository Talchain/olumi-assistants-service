import { ZodError } from 'zod';
import type { FastifyRequest } from 'fastify';
import { getRequestId } from './request-id.js';
import { redactLogMessage } from './redaction.js';

/**
 * Error codes for structured error responses
 */
export type ErrorCode = 'BAD_INPUT' | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND' | 'RATE_LIMITED' | 'INTERNAL';

/**
 * Structured error response (error.v1 schema)
 */
export interface ErrorV1 {
  schema: 'error.v1';
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
  request_id?: string;
}

/**
 * Build a structured error response
 */
export function buildErrorV1(
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
  requestId?: string
): ErrorV1 {
  const error: ErrorV1 = {
    schema: 'error.v1',
    code,
    message,
  };

  if (details && Object.keys(details).length > 0) {
    error.details = details;
  }

  if (requestId) {
    error.request_id = requestId;
  }

  return error;
}

/**
 * Convert Zod validation error to ErrorV1
 */
export function zodErrorToErrorV1(error: ZodError, requestId?: string): ErrorV1 {
  return buildErrorV1(
    'BAD_INPUT',
    'Validation failed',
    {
      validation_errors: error.flatten(),
    },
    requestId
  );
}

/**
 * Convert any error to ErrorV1 (safe, never leaks stack/PII)
 *
 * @param error The error to convert
 * @param request Optional Fastify request for context
 * @returns ErrorV1 response object
 */
export function toErrorV1(error: unknown, request?: FastifyRequest): ErrorV1 {
  const requestId = request ? getRequestId(request) : undefined;

  // Zod validation errors
  if (error instanceof ZodError) {
    return zodErrorToErrorV1(error, requestId);
  }

  // Standard Error objects
  if (error instanceof Error) {
    const err = error as any;

    // Rate limit errors - check status code first
    if (err.statusCode === 429 || err.status === 429 || error.message.toLowerCase().includes('rate limit')) {
      const retryAfter = err.retryAfter || err.retry_after || 60;
      return buildErrorV1(
        'RATE_LIMITED',
        'Too many requests',
        { retry_after_seconds: retryAfter },
        requestId
      );
    }

    // Body limit errors
    if (
      err.code === 'FST_ERR_CTP_BODY_TOO_LARGE' ||
      error.message.includes('Body limit exceeded') ||
      error.message.includes('payload too large')
    ) {
      return buildErrorV1(
        'BAD_INPUT',
        'Request body too large',
        { max_size_bytes: 1048576 },
        requestId
      );
    }

    // Sanitize error message - remove potential PII and paths
    let message = error.message || 'An unexpected error occurred';

    // Remove file paths
    message = message.replace(/\/[\w/.@-]+/g, '[path]');
    // Remove potential secrets
    message = message.replace(/[A-Z_]+_?KEY=\S+/gi, '[KEY_REDACTED]');
    message = message.replace(/[A-Z_]+_?SECRET=\S+/gi, '[SECRET_REDACTED]');
    // Remove email addresses
    message = message.replace(/[\w.-]+@[\w.-]+\.\w+/g, '[email]');

    message = redactLogMessage(message);

    // Generic error - safe message only, no stack
    return buildErrorV1('INTERNAL', message, undefined, requestId);
  }

  // Handle string errors
  if (typeof error === 'string') {
    let message = error;
    // Apply same sanitization
    message = message.replace(/\/[\w/.@-]+/g, '[path]');
    message = message.replace(/[A-Z_]+_?KEY=\S+/gi, '[KEY_REDACTED]');
    message = message.replace(/[A-Z_]+_?SECRET=\S+/gi, '[SECRET_REDACTED]');
    message = message.replace(/[\w.-]+@[\w.-]+\.\w+/g, '[email]');

    message = redactLogMessage(message);

    return buildErrorV1('INTERNAL', message, undefined, requestId);
  }

  // Unknown error type - minimal info
  return buildErrorV1('INTERNAL', 'An unexpected error occurred', undefined, requestId);
}

/**
 * Get HTTP status code for error code
 */
export function getStatusCodeForErrorCode(code: ErrorCode): number {
  switch (code) {
    case 'BAD_INPUT':
      return 400;
    case 'UNAUTHENTICATED':
      return 401;
    case 'FORBIDDEN':
      return 403;
    case 'NOT_FOUND':
      return 404;
    case 'RATE_LIMITED':
      return 429;
    case 'INTERNAL':
    default:
      return 500;
  }
}
