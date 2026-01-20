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
    // Olumi-specific auth headers
    'x-olumi-assist-key',
    'x-admin-key',
    'x-hmac-signature',
    'x-share-token',
    // HMAC auth headers (timing attack vectors if exposed)
    'x-olumi-signature',
    'x-olumi-nonce',
    'x-olumi-timestamp',
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

/** Keys that contain row/raw CSV data to be stripped */
const CSV_DATA_KEYS = new Set(['rows', 'data', 'values', 'raw_data']);

/** Safe statistical field keys to preserve */
const SAFE_STAT_KEYS = new Set([
  'count', 'mean', 'median', 'p50', 'p90', 'p95', 'p99', 'min', 'max', 'std', 'variance'
]);

/** Sensitive header keys (lowercase) - must align with logger-config.ts */
const SENSITIVE_HEADER_KEYS = new Set([
  'authorization', 'x-api-key', 'api-key', 'x-auth-token', 'cookie', 'set-cookie',
  // Olumi-specific auth headers
  'x-olumi-assist-key', 'x-admin-key', 'x-hmac-signature', 'x-share-token',
  // HMAC auth headers (timing attack vectors if exposed)
  'x-olumi-signature', 'x-olumi-nonce', 'x-olumi-timestamp',
]);

/**
 * Deep clone and redact object for safe logging (single-pass optimized)
 *
 * Removes in ONE recursive pass:
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

  // Single-pass recursive clone and redact
  function redactRecursive(value: unknown, parentKey?: string): unknown {
    if (value === null || value === undefined) {
      return value;
    }

    // Handle arrays
    if (Array.isArray(value)) {
      // Special case: attachments array
      if (parentKey === 'attachments') {
        return value.map((att: unknown) => {
          if (typeof att !== 'object' || att === null) return att;
          const redactedAtt: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(att)) {
            if (UNSAFE_KEYS.has(k)) continue;
            if ((k === 'content' || k === 'data') && typeof v === 'string') {
              safeSetProperty(redactedAtt, k, `${REDACTED_MARKER}:${fastHash(v, 8)}`);
            } else {
              safeSetProperty(redactedAtt, k, redactRecursive(v, k));
            }
          }
          return redactedAtt;
        });
      }
      return value.map((item) => redactRecursive(item));
    }

    // Handle objects
    if (typeof value === 'object') {
      const result: Record<string, unknown> = {};

      for (const [key, val] of Object.entries(value)) {
        // Skip unsafe keys
        if (UNSAFE_KEYS.has(key)) continue;

        // Skip CSV row data entirely
        if (CSV_DATA_KEYS.has(key)) continue;

        // Handle attachment_payloads
        if (key === 'attachment_payloads' && typeof val === 'object' && val !== null) {
          const redactedPayloads: Record<string, string> = {};
          for (const [pKey, pVal] of Object.entries(val)) {
            if (UNSAFE_KEYS.has(pKey)) continue;
            safeSetProperty(redactedPayloads, pKey, typeof pVal === 'string'
              ? `${REDACTED_MARKER}:${fastHash(pVal, 8)}`
              : REDACTED_MARKER);
          }
          safeSetProperty(result, key, redactedPayloads);
          continue;
        }

        // Handle headers - filter sensitive ones
        if (key === 'headers' && typeof val === 'object' && val !== null) {
          const redactedHeaders: Record<string, unknown> = {};
          for (const [hKey, hVal] of Object.entries(val)) {
            if (UNSAFE_KEYS.has(hKey)) continue;
            if (SENSITIVE_HEADER_KEYS.has(hKey.toLowerCase())) continue;
            safeSetProperty(redactedHeaders, hKey, hVal);
          }
          safeSetProperty(result, key, redactedHeaders);
          continue;
        }

        // Truncate quotes
        if (key === 'quote' && typeof val === 'string') {
          safeSetProperty(result, key, truncateString(val, MAX_QUOTE_LENGTH));
          continue;
        }

        // Safe stat keys - keep as-is
        if (SAFE_STAT_KEYS.has(key)) {
          safeSetProperty(result, key, val);
          continue;
        }

        // Recurse for other values
        safeSetProperty(result, key, redactRecursive(val, key));
      }

      return result;
    }

    // Primitives pass through
    return value;
  }

  try {
    // Clone via JSON to break references and handle circular refs
    const cloned = JSON.parse(JSON.stringify(obj));
    const redacted = redactRecursive(cloned);

    // Add redaction flag for audit trail
    if (typeof redacted === 'object' && redacted !== null && !Array.isArray(redacted)) {
      (redacted as Record<string, unknown>).redacted = true;
    }

    return redacted;
  } catch {
    // If serialization fails, return safe placeholder
    return { error: 'unserializable_object', redacted: true };
  }
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
