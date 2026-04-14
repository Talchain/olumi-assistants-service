/**
 * Pin the exact user-facing strings for NODE_LIMIT_EXCEEDED and
 * EDGE_LIMIT_EXCEEDED (Fix 2A). The previous copy leaked the internal
 * `${MAX_NODES}-node limit` / `${MAX_EDGES}-edge limit` pattern, which the
 * user flagged as internal jargon. These assertions ensure any future
 * regression produces an immediate test failure.
 */

import { describe, it, expect } from "vitest";
import { VIOLATION_MESSAGES } from "../../../src/orchestrator/graph-structure-validator.js";

describe('VIOLATION_MESSAGES — user-facing language (Fix 2A)', () => {
  it('NODE_LIMIT_EXCEEDED uses plain user-facing language with no jargon', () => {
    expect(VIOLATION_MESSAGES.NODE_LIMIT_EXCEEDED).toBe(
      'The model has reached its maximum size. Try simplifying before adding more.',
    );
    expect(VIOLATION_MESSAGES.NODE_LIMIT_EXCEEDED).not.toMatch(/\d+-node limit/);
    expect(VIOLATION_MESSAGES.NODE_LIMIT_EXCEEDED).not.toContain('MAX_NODES');
  });

  it('EDGE_LIMIT_EXCEEDED uses plain user-facing language with no jargon', () => {
    expect(VIOLATION_MESSAGES.EDGE_LIMIT_EXCEEDED).toBe(
      'Adding this would make the model too complex to analyse reliably. Try simplifying first.',
    );
    expect(VIOLATION_MESSAGES.EDGE_LIMIT_EXCEEDED).not.toMatch(/\d+-edge limit/);
    expect(VIOLATION_MESSAGES.EDGE_LIMIT_EXCEEDED).not.toContain('MAX_EDGES');
  });
});
