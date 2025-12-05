/**
 * PII Guard - Enhanced Privacy Protection
 *
 * Configurable PII detection and redaction with strict/standard modes
 * Protects: emails, phones, API keys, tokens, IPs, URLs, names, addresses
 */

import { config } from "../config/index.js";

export type RedactionMode = "strict" | "standard" | "off";

export interface PIIGuardConfig {
  mode: RedactionMode;
  preserveDomains?: string[]; // Domains to preserve in strict mode (e.g., ["example.com"])
  redactKeys?: boolean; // Redact object keys (default: false to preserve schema)
}

export interface PIIMatch {
  type: string;
  original: string;
  redacted: string;
  start: number;
  end: number;
}

/**
 * PII patterns by category
 */
const PII_PATTERNS = {
  // Emails (high confidence)
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,

  // Phone numbers (international)
  phone_us: /\b(\+1\s?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g,
  phone_uk: /\b(\+44\s?7\d{3}|\(?07\d{3}\)?)\s?\d{3}\s?\d{3}\b/g,
  phone_intl: /\b\+\d{1,3}\s?\(?\d{1,4}\)?[\s.-]?\d{1,4}[\s.-]?\d{1,9}\b/g,

  // API keys and secrets
  api_key: /\b(sk|pk|api|key|token|secret)_\w{10,}\b/gi,
  bearer_token: /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  jwt: /\beyJ[A-Za-z0-9\-_=]+\.[A-Za-z0-9\-_=]+\.?[A-Za-z0-9\-_.+/=]*/g,

  // Long hex tokens (32+ chars)
  hex_token: /\b[a-fA-F0-9]{32,}\b/g,

  // IPv4 addresses
  ipv4: /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g,

  // URLs with authentication
  url_with_auth: /https?:\/\/[^:]+:[^@]+@[^\s]+/g,

  // Credit card numbers (basic pattern)
  credit_card: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,

  // Social Security Numbers (US)
  ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
};

/**
 * Strict mode: Additional aggressive patterns
 */
const STRICT_PATTERNS = {
  // URLs (all)
  url: /https?:\/\/[^\s]+/g,

  // File paths (potential leakage)
  file_path: /\b[A-Za-z]:\\[\w/.-]+|\b\/[\w/. -]+\b/g,

  // Potential names (conservative: 3+ chars per word, avoid common technical terms)
  // Matches "John Smith", "Alice Johnson" but not "Decision Graph", "API Key", etc.
  potential_name: /\b(?!(?:API|URL|HTTP|JSON|XML|HTML|CSS|SQL|REST|SOAP|TCP|UDP|IP|DNS)\b)[A-Z][a-z]{2,}\s+(?!(?:Graph|Service|Manager|Controller|Handler|Router|Client|Server|Provider|Factory|Builder|Adapter|Proxy|Wrapper)\b)[A-Z][a-z]{2,}\b/g,
};

/**
 * Redact PII from text based on mode
 */
export function redactPII(text: string, config: PIIGuardConfig = { mode: "standard" }): string {
  if (config.mode === "off") {
    return text;
  }

  let redacted = text;

  // Apply standard patterns (order matters - URLs with auth before emails)
  redacted = redacted.replace(PII_PATTERNS.url_with_auth, "[URL_WITH_AUTH]");
  redacted = redacted.replace(PII_PATTERNS.bearer_token, "Bearer [TOKEN]");
  redacted = redacted.replace(PII_PATTERNS.jwt, "[JWT]");
  redacted = redacted.replace(PII_PATTERNS.hex_token, "[TOKEN]");
  redacted = redacted.replace(PII_PATTERNS.api_key, "[KEY]");
  redacted = redacted.replace(PII_PATTERNS.email, "[EMAIL]");
  redacted = redacted.replace(PII_PATTERNS.credit_card, "[CARD]");
  redacted = redacted.replace(PII_PATTERNS.ssn, "[SSN]");
  redacted = redacted.replace(PII_PATTERNS.phone_uk, "[PHONE]");
  redacted = redacted.replace(PII_PATTERNS.phone_intl, "[PHONE]");
  redacted = redacted.replace(PII_PATTERNS.phone_us, "[PHONE]");

  // Strict mode: additional redactions
  if (config.mode === "strict") {
    redacted = redacted.replace(PII_PATTERNS.ipv4, "[IP]");
    redacted = redacted.replace(STRICT_PATTERNS.url, "[URL]");
    redacted = redacted.replace(STRICT_PATTERNS.file_path, "[PATH]");
    redacted = redacted.replace(STRICT_PATTERNS.potential_name, "[NAME]");
  }

  return redacted;
}

/**
 * Redact PII from object (deep)
 */
export function redactObject<T>(obj: T, config: PIIGuardConfig = { mode: "standard" }): T {
  if (config.mode === "off") {
    return obj;
  }

  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === "string") {
    return redactPII(obj, config) as T;
  }

  if (typeof obj === "number" || typeof obj === "boolean") {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => redactObject(item, config)) as T;
  }

  if (typeof obj === "object") {
    const redacted: any = {};
    for (const [key, value] of Object.entries(obj)) {
      // Only redact keys if explicitly enabled (default: false to preserve schema)
      const redactedKey = config.redactKeys ? redactPII(key, config) : key;
      redacted[redactedKey] = redactObject(value, config);
    }
    return redacted as T;
  }

  return obj;
}

/**
 * Detect PII without redacting (for analysis)
 */
export function detectPII(text: string, config: PIIGuardConfig = { mode: "standard" }): PIIMatch[] {
  const matches: PIIMatch[] = [];

  if (config.mode === "off") {
    return matches;
  }

  // Helper to add matches
  const addMatches = (pattern: RegExp, type: string, replacement: string) => {
    const regex = new RegExp(pattern, pattern.flags);
    let match;
    while ((match = regex.exec(text)) !== null) {
      matches.push({
        type,
        original: match[0],
        redacted: replacement,
        start: match.index,
        end: match.index + match[0].length,
      });
    }
  };

  // Standard detections (order matters - more specific patterns first)
  addMatches(PII_PATTERNS.url_with_auth, "url_with_auth", "[URL_WITH_AUTH]");
  addMatches(PII_PATTERNS.bearer_token, "bearer_token", "Bearer [TOKEN]");
  addMatches(PII_PATTERNS.email, "email", "[EMAIL]");
  addMatches(PII_PATTERNS.phone_us, "phone", "[PHONE]");
  addMatches(PII_PATTERNS.phone_uk, "phone", "[PHONE]");
  addMatches(PII_PATTERNS.api_key, "api_key", "[KEY]");
  addMatches(PII_PATTERNS.jwt, "jwt", "[JWT]");
  addMatches(PII_PATTERNS.hex_token, "token", "[TOKEN]");
  addMatches(PII_PATTERNS.credit_card, "credit_card", "[CARD]");
  addMatches(PII_PATTERNS.ssn, "ssn", "[SSN]");

  // Strict mode detections
  if (config.mode === "strict") {
    addMatches(PII_PATTERNS.ipv4, "ip", "[IP]");
    addMatches(STRICT_PATTERNS.url, "url", "[URL]");
  }

  return matches;
}

/**
 * Get redaction mode from centralized config
 */
export function getRedactionMode(): RedactionMode {
  return config.pii.redactionMode;
}

/**
 * Create default guard config from environment
 */
export function getDefaultGuardConfig(): PIIGuardConfig {
  return {
    mode: getRedactionMode(),
  };
}
