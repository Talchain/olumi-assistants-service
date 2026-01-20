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
  stage?: string;  // Pipeline stage where error occurred (for debugging)
}

/**
 * Options for building error responses
 */
export interface BuildErrorV1Options {
  details?: Record<string, unknown>;
  requestId?: string;
  stage?: string;  // Pipeline stage for debugging (e.g., 'llm_draft', 'repair', 'validation')
}

/**
 * Build a structured error response
 */
export function buildErrorV1(
  code: ErrorCode,
  message: string,
  detailsOrOptions?: Record<string, unknown> | BuildErrorV1Options,
  requestId?: string
): ErrorV1 {
  // Handle both old signature (details, requestId) and new signature (options)
  let details: Record<string, unknown> | undefined;
  let reqId: string | undefined;
  let stage: string | undefined;

  if (detailsOrOptions && 'stage' in detailsOrOptions) {
    // New signature with options object
    const opts = detailsOrOptions as BuildErrorV1Options;
    details = opts.details;
    reqId = opts.requestId;
    stage = opts.stage;
  } else {
    // Legacy signature
    details = detailsOrOptions as Record<string, unknown> | undefined;
    reqId = requestId;
  }

  const error: ErrorV1 = {
    schema: 'error.v1',
    code,
    message,
  };

  if (details && Object.keys(details).length > 0) {
    error.details = details;
  }

  if (reqId) {
    error.request_id = reqId;
  }

  if (stage) {
    error.stage = stage;
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
 * Options for converting errors to ErrorV1
 */
export interface ToErrorV1Options {
  request?: FastifyRequest;
  stage?: string;  // Pipeline stage where error occurred
}

/**
 * Convert any error to ErrorV1 (safe, never leaks stack/PII)
 *
 * @param error The error to convert
 * @param requestOrOptions Optional Fastify request or options object
 * @returns ErrorV1 response object
 */
export function toErrorV1(error: unknown, requestOrOptions?: FastifyRequest | ToErrorV1Options): ErrorV1 {
  // Handle both old signature (request) and new signature (options)
  let request: FastifyRequest | undefined;
  let stage: string | undefined;

  if (requestOrOptions && 'stage' in requestOrOptions) {
    const opts = requestOrOptions as ToErrorV1Options;
    request = opts.request;
    stage = opts.stage;
  } else {
    request = requestOrOptions as FastifyRequest | undefined;
  }

  const requestId = request ? getRequestId(request) : undefined;

  // Zod validation errors
  if (error instanceof ZodError) {
    const result = zodErrorToErrorV1(error, requestId);
    if (stage) result.stage = stage;
    return result;
  }

  // Standard Error objects
  if (error instanceof Error) {
    const err = error as any;

    // Rate limit errors - check status code first
    if (err.statusCode === 429 || err.status === 429 || error.message.toLowerCase().includes('rate limit')) {
      const retryAfter = err.retryAfter || err.retry_after || 60;
      const result = buildErrorV1(
        'RATE_LIMITED',
        'Too many requests',
        { retry_after_seconds: retryAfter },
        requestId
      );
      if (stage) result.stage = stage;
      return result;
    }

    // Body limit errors
    if (
      err.code === 'FST_ERR_CTP_BODY_TOO_LARGE' ||
      error.message.includes('Body limit exceeded') ||
      error.message.includes('payload too large')
    ) {
      const result = buildErrorV1(
        'BAD_INPUT',
        'Request body too large',
        { max_size_bytes: 1048576 },
        requestId
      );
      if (stage) result.stage = stage;
      return result;
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
    const result = buildErrorV1('INTERNAL', message, undefined, requestId);
    if (stage) result.stage = stage;
    return result;
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

    const result = buildErrorV1('INTERNAL', message, undefined, requestId);
    if (stage) result.stage = stage;
    return result;
  }

  // Unknown error type - minimal info
  const result = buildErrorV1('INTERNAL', 'An unexpected error occurred', undefined, requestId);
  if (stage) result.stage = stage;
  return result;
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
