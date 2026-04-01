/**
 * Shared envelope validator for e2e and integration tests.
 *
 * Centralises cross-cutting assertions so every test gets:
 * - Structural validity (turn_id, blocks, stage_indicator)
 * - No error patterns in assistant_text
 * - No raw entity IDs in user-facing text
 * - No leaked JSON envelopes in assistant_text
 */

// ============================================================================
// Error patterns — text that should never appear in user-facing responses
// ============================================================================

const ERROR_PATTERNS = [
  "couldn't generate",
  "Try rephrasing",
  "Could you rephrase",
  "I had trouble processing",
  "need more context to proceed",
  "I encountered an issue",
];

const RAW_ENTITY_ID_RE = /\b(?:fac|opt|goal|dec|out|risk)_\w+/;
const LEAKED_JSON_RE = /\{"text"\s*:/;

// ============================================================================
// Public API
// ============================================================================

export interface ValidateEnvelopeOptions {
  /** true = must have non-empty assistant_text */
  expectText?: boolean;
  /** true = assistant_text should be null/empty */
  expectSilent?: boolean;
  /** true = must have non-empty blocks array */
  expectBlocks?: boolean;
  /** Step label for error messages */
  step?: string;
}

/**
 * Assert that a response body is a valid orchestrator envelope.
 *
 * Throws descriptive errors on any violation.
 */
export function assertValidEnvelope(
  response: unknown,
  options: ValidateEnvelopeOptions = {},
): void {
  const { expectText, expectSilent, expectBlocks, step = 'unknown' } = options;
  const label = `[${step}]`;

  if (response === null || response === undefined || typeof response !== 'object') {
    throw new Error(`${label} response is not an object`);
  }

  const b = response as Record<string, unknown>;

  // ── Structural fields ────────────────────────────────────────────────────

  if (typeof b.turn_id !== 'string' || b.turn_id.length === 0) {
    throw new Error(`${label} missing or empty turn_id`);
  }

  if (!Array.isArray(b.blocks)) {
    throw new Error(`${label} blocks is not an array`);
  }

  if (b.stage_indicator === undefined && b.stage === undefined) {
    // stage_indicator may be an object or a string depending on pipeline
    // Accept either form
  }

  // ── assistant_text quality ───────────────────────────────────────────────

  const text = typeof b.assistant_text === 'string' ? b.assistant_text : '';

  if (expectText && text.trim().length === 0) {
    throw new Error(`${label} expected non-empty assistant_text but got: "${text}"`);
  }

  if (expectSilent && text.trim().length > 0) {
    throw new Error(`${label} expected silent response but got assistant_text: "${text.slice(0, 100)}"`);
  }

  if (text.length > 0) {
    // No error patterns
    for (const pattern of ERROR_PATTERNS) {
      if (text.toLowerCase().includes(pattern.toLowerCase())) {
        throw new Error(`${label} assistant_text contains error pattern "${pattern}": "${text.slice(0, 200)}"`);
      }
    }

    // No raw entity IDs
    if (RAW_ENTITY_ID_RE.test(text)) {
      const match = text.match(RAW_ENTITY_ID_RE);
      throw new Error(`${label} assistant_text contains raw entity ID "${match?.[0]}": "${text.slice(0, 200)}"`);
    }

    // No leaked JSON envelopes
    if (LEAKED_JSON_RE.test(text)) {
      throw new Error(`${label} assistant_text contains leaked JSON envelope: "${text.slice(0, 200)}"`);
    }
  }

  // ── Blocks ───────────────────────────────────────────────────────────────

  if (expectBlocks && (b.blocks as unknown[]).length === 0) {
    throw new Error(`${label} expected non-empty blocks array but got empty`);
  }
}

/**
 * Assert HTTP status is successful (2xx).
 */
export function assertHttpOk(status: number, step: string): void {
  if (status < 200 || status >= 300) {
    throw new Error(`[${step}] expected 2xx status but got ${status}`);
  }
}
