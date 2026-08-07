/**
 * Context Architecture v2 — S4 rolling summary: parser slot-completeness pins
 * (Codex r2 blocker 2 — silent slot erasure).
 *
 * The parser is the ONLY guard between the summariser model and the stored
 * summary. Before this pin it required FRAME alone, so a model response that
 * dropped CONSTRAINTS / RESOLVED / OPEN was ACCEPTED and assemble.ts rendered
 * the missing slots as "(none)" — silently erasing prior memory (the exact
 * class of constraint the layer exists to preserve). The contract is now:
 * EXACTLY ONE instance of ALL FOUR slots, or reject (and the maintainer keeps
 * the prior summary).
 */

import { describe, it, expect } from 'vitest';

import { parseSummaryOutput } from '../parse-summary.js';

const FULL = [
  'DECISION FRAME: Choosing an HQ.',
  'CONSTRAINTS & PREFERENCES: Keep Berlin. [t1]',
  'RESOLVED: (none)',
  'OPEN: (none)',
].join('\n');

describe('parseSummaryOutput — all-four-slots contract', () => {
  it('accepts a response carrying exactly one of each slot', () => {
    const result = parseSummaryOutput(FULL);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.slots.map((s) => s.slot)).toEqual(['FRAME', 'CONSTRAINTS', 'RESOLVED', 'OPEN']);
    }
  });

  it('REJECTS a response missing CONSTRAINTS (would erase prior constraints)', () => {
    const threeSlots = [
      'DECISION FRAME: Choosing an HQ.',
      'RESOLVED: (none)',
      'OPEN: (none)',
    ].join('\n');
    const result = parseSummaryOutput(threeSlots);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('missing_slot');
  });

  it('REJECTS a response missing RESOLVED', () => {
    const result = parseSummaryOutput(
      ['DECISION FRAME: X.', 'CONSTRAINTS & PREFERENCES: (none)', 'OPEN: (none)'].join('\n'),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('missing_slot');
  });

  it('REJECTS a response missing OPEN', () => {
    const result = parseSummaryOutput(
      ['DECISION FRAME: X.', 'CONSTRAINTS & PREFERENCES: (none)', 'RESOLVED: (none)'].join('\n'),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('missing_slot');
  });

  it('REJECTS a FRAME-only response', () => {
    const result = parseSummaryOutput('DECISION FRAME: Only a frame.');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('missing_slot');
  });

  it('still reports missing_frame when FRAME itself is absent', () => {
    const result = parseSummaryOutput(
      ['CONSTRAINTS & PREFERENCES: (none)', 'RESOLVED: (none)', 'OPEN: (none)'].join('\n'),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('missing_frame');
  });

  it('still rejects duplicate slots', () => {
    const result = parseSummaryOutput([FULL, 'OPEN: another open'].join('\n'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('duplicate_slot');
  });
});
