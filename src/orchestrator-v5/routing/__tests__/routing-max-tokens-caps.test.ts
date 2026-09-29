import { describe, it, expect } from 'vitest';
import {
  V5_ROUTING_MAX_OUTPUT_TOKENS,
  V5_ROUTING_MAX_OUTPUT_TOKENS_RETRY,
} from '../route-with-tool-use.js';

/**
 * Pins the routing output-budget caps. Raised for Claude Sonnet 5, whose
 * +30% tokenizer and default-on adaptive thinking both consume this budget
 * (see the constant doc comments). The retry must always exceed the first
 * attempt, or the max_tokens retry escalation is a no-op.
 */
describe('routing max_tokens caps', () => {
  it('first attempt is raised for Sonnet 5 headroom', () => {
    expect(V5_ROUTING_MAX_OUTPUT_TOKENS).toBe(3072);
  });

  it('retry escalates well beyond the first attempt', () => {
    expect(V5_ROUTING_MAX_OUTPUT_TOKENS_RETRY).toBe(8192);
    expect(V5_ROUTING_MAX_OUTPUT_TOKENS_RETRY).toBeGreaterThan(
      V5_ROUTING_MAX_OUTPUT_TOKENS,
    );
  });
});
