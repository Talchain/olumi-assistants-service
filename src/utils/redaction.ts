/**
 * Redaction utilities for PII and privacy protection
 *
 * Ensures logs and error responses never leak:
 * - Base64 file contents
 * - CSV row data
 * - Long quotes (truncate to 100 chars)
 * - Authorization headers
 * - PII (emails, phones, API keys, etc.) - via PII Guard
 */

import { redactObject as piiRedactObject, getDefaultGuardConfig } from "./pii-guard.js";
import { fastHash } from "./hash.js";

const MAX_QUOTE_LENGTH = 100;
const REDACTED_MARKER = '[REDACTED]';

/**
 * Dangerous prototype keys that should never be set dynamically
 */
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Safely set a property on an object, preventing prototype pollution
 */
function safeSetProperty<T>(obj: Record<string, T>, key: string, value: T): void {
  if (UNSAFE_KEYS.has(key)) {
    return; // Skip dangerous keys
  }
  // Use Object.defineProperty to avoid prototype pollution
  Object.defineProperty(obj, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

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
        safeSetProperty(redactedPayloads, key, `${REDACTED_MARKER}:${fastHash(value, 8)}`);
      } else {
        safeSetProperty(redactedPayloads, key, REDACTED_MARKER);
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
          redactedAtt.content = `${REDACTED_MARKER}:${fastHash(att.content, 8)}`;
        } else if (att.data && typeof att.data === 'string') {
          redactedAtt.data = `${REDACTED_MARKER}:${fastHash(att.data, 8)}`;
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
    // Skip unsafe keys to prevent prototype pollution
    if (UNSAFE_KEYS.has(key)) {
      continue;
    }

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
      safeSetProperty(result, key, value);
      continue;
    }

    // Redact potential row data (completely remove from output)
    if (key === 'rows' || key === 'data' || key === 'values' || key === 'raw_data') {
      // Skip this field entirely (do not add to result)
      continue;
    }

    // Recurse for nested objects
    if (typeof value === 'object' && value !== null) {
      safeSetProperty(result, key, redactCsvData(value));
    } else {
      safeSetProperty(result, key, value);
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
    // Skip unsafe keys to prevent prototype pollution
    if (UNSAFE_KEYS.has(key)) {
      continue;
    }

    if (key === 'quote' && typeof value === 'string') {
      safeSetProperty(result, key, truncateString(value, MAX_QUOTE_LENGTH));
    } else if (typeof value === 'object' && value !== null) {
      safeSetProperty(result, key, truncateQuotes(value));
    } else {
      safeSetProperty(result, key, value);
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
    // Skip sensitive keys and unsafe keys
    if (sensitiveKeys.includes(key.toLowerCase()) || UNSAFE_KEYS.has(key)) {
      continue;
    }
    safeSetProperty(redacted, key, value);
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
        // Skip unsafe keys to prevent prototype pollution
        if (UNSAFE_KEYS.has(key)) {
          continue;
        }
        safeSetProperty(result, key, recursiveRedact(val));
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

/**
 * Redact PII from telemetry events (v1.6 PII Guard)
 *
 * Applies configurable PII redaction based on PII_REDACTION_MODE:
 * - standard: emails, phones, API keys, tokens, SSNs, credit cards
 * - strict: + URLs, IPs, file paths, potential names
 * - off: no redaction
 *
 * Preserves telemetry structure while protecting sensitive data
 */
export function redactTelemetryEvent(event: Record<string, unknown>): Record<string, unknown> {
  const config = getDefaultGuardConfig();

  // Off mode: no redaction
  if (config.mode === "off") {
    return event;
  }

  // Apply PII redaction to the entire event object
  const redacted = piiRedactObject(event, config);

  // Add redaction metadata
  return {
    ...redacted,
    pii_redacted: true,
    redaction_mode: config.mode,
  };
}

/**
 * Redact PII from log messages
 */
export function redactLogMessage(message: string): string {
  const config = getDefaultGuardConfig();
  if (config.mode === "off") {
    return message;
  }

  return piiRedactObject(message, config);
}
