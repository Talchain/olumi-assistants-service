/**
 * Redaction utilities for PII and privacy protection
 *
 * Ensures logs and error responses never leak:
 * - Base64 file contents
 * - CSV row data
 * - Long quotes (truncate to 100 chars)
 * - Authorization headers
 */

const MAX_QUOTE_LENGTH = 100;
const REDACTED_MARKER = '[REDACTED]';
const HASH_PREFIX_LENGTH = 8;

/**
 * Truncate long strings to max length with ellipsis
 */
function truncateString(str: string, maxLength: number): string {
  if (str.length <= maxLength) {
    return str;
  }
  return str.substring(0, maxLength) + '...';
}

/**
 * Create a short hash prefix for identification (not cryptographic)
 */
function hashPrefix(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash = hash & hash; // Convert to 32bit integer
  }
  // Pad with zeros to ensure consistent length
  return Math.abs(hash).toString(16).padStart(HASH_PREFIX_LENGTH, '0').substring(0, HASH_PREFIX_LENGTH);
}

/**
 * Redact attachment payloads (base64 content)
 *
 * Replaces base64 strings with a hash prefix for tracking while removing PII
 */
export function redactAttachments(payload: Record<string, unknown>): Record<string, unknown> {
  const redacted = { ...payload };

  // Redact attachment_payloads
  if (redacted.attachment_payloads && typeof redacted.attachment_payloads === 'object') {
    const payloads = redacted.attachment_payloads as Record<string, unknown>;
    const redactedPayloads: Record<string, string> = {};

    for (const [key, value] of Object.entries(payloads)) {
      if (typeof value === 'string') {
        // Replace with hash prefix for tracking
        redactedPayloads[key] = `${REDACTED_MARKER}:${hashPrefix(value)}`;
      } else {
        redactedPayloads[key] = REDACTED_MARKER;
      }
    }

    redacted.attachment_payloads = redactedPayloads;
  }

  // Redact attachments array (replace content with hash prefix)
  if (Array.isArray(redacted.attachments)) {
    redacted.attachments = redacted.attachments.map((att: any) => {
      if (typeof att === 'object' && att !== null) {
        const redactedAtt = { ...att };
        if (att.content && typeof att.content === 'string') {
          redactedAtt.content = `${REDACTED_MARKER}:${hashPrefix(att.content)}`;
        } else if (att.data && typeof att.data === 'string') {
          redactedAtt.data = `${REDACTED_MARKER}:${hashPrefix(att.data)}`;
        }
        return redactedAtt;
      }
      return att;
    });
  }

  return redacted;
}

/**
 * Redact CSV row data (keep only safe statistics)
 *
 * Safe statistics: count, mean, p50, p90
 * Never expose: row values, column names with data
 */
export function redactCsvData(obj: unknown): unknown {
  if (typeof obj !== 'object' || obj === null) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => redactCsvData(item));
  }

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    // Keep safe statistical fields
    if (
      key === 'count' ||
      key === 'mean' ||
      key === 'median' ||
      key === 'p50' ||
      key === 'p90' ||
      key === 'p95' ||
      key === 'p99' ||
      key === 'min' ||
      key === 'max' ||
      key === 'std' ||
      key === 'variance'
    ) {
      result[key] = value;
      continue;
    }

    // Redact potential row data (completely remove from output)
    if (key === 'rows' || key === 'data' || key === 'values' || key === 'raw_data') {
      // Skip this field entirely (do not add to result)
      continue;
    }

    // Recurse for nested objects
    if (typeof value === 'object' && value !== null) {
      result[key] = redactCsvData(value);
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Truncate long quotes in citations/provenance
 */
export function truncateQuotes(obj: unknown): unknown {
  if (typeof obj !== 'object' || obj === null) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => truncateQuotes(item));
  }

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (key === 'quote' && typeof value === 'string') {
      result[key] = truncateString(value, MAX_QUOTE_LENGTH);
    } else if (typeof value === 'object' && value !== null) {
      result[key] = truncateQuotes(value);
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Redact sensitive headers (Authorization, API keys, etc.)
 * Removes sensitive headers entirely from the output
 */
export function redactHeaders(headers: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  const sensitiveKeys = [
    'authorization',
    'x-api-key',
    'api-key',
    'x-auth-token',
    'cookie',
    'set-cookie',
  ];

  for (const [key, value] of Object.entries(headers)) {
    if (!sensitiveKeys.includes(key.toLowerCase())) {
      redacted[key] = value;
    }
  }

  return redacted;
}

/**
 * Deep clone and redact object for safe logging
 *
 * Removes:
 * - Base64 attachment content
 * - CSV row data
 * - Long quotes (>100 chars)
 * - Sensitive headers
 *
 * Adds `redacted: true` flag to indicate sanitization occurred
 */
export function safeLog(obj: unknown): unknown {
  // Handle null/undefined
  if (obj === null || obj === undefined) {
    return { redacted: true };
  }

  if (typeof obj !== 'object') {
    return obj;
  }

  // Deep clone
  let cloned: any;
  try {
    cloned = JSON.parse(JSON.stringify(obj));
  } catch {
    // If serialization fails, return safe placeholder
    return { error: 'unserializable_object', redacted: true };
  }

  // Apply redactions recursively to handle nested structures
  function recursiveRedact(value: any): any {
    if (value === null || value === undefined) {
      return value;
    }

    if (Array.isArray(value)) {
      return value.map(item => recursiveRedact(item));
    }

    if (typeof value === 'object') {
      // Apply redactions at this level
      if (value.attachment_payloads || value.attachments) {
        value = redactAttachments(value);
      }

      if (value.headers) {
        value.headers = redactHeaders(value.headers);
      }

      // Recurse into all properties
      const result: any = {};
      for (const [key, val] of Object.entries(value)) {
        result[key] = recursiveRedact(val);
      }
      return result;
    }

    return value;
  }

  cloned = recursiveRedact(cloned);

  // Redact CSV data recursively
  cloned = redactCsvData(cloned);

  // Truncate quotes
  cloned = truncateQuotes(cloned);

  // Always add redaction flag for audit trail
  if (typeof cloned === 'object' && cloned !== null && !Array.isArray(cloned)) {
    cloned.redacted = true;
  }

  return cloned;
}
