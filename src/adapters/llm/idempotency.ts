import { randomUUID } from "node:crypto";

/**
 * Generate an idempotency key for LLM API requests
 * V04: Shared utility across all adapters (Anthropic, OpenAI, etc.)
 *
 * Idempotency keys allow providers to deduplicate requests and ensure
 * that retries of the same logical request don't create duplicate side effects.
 *
 * @returns A UUID v4 string suitable for use as an idempotency key
 */
export function makeIdempotencyKey(): string {
  return randomUUID();
}
