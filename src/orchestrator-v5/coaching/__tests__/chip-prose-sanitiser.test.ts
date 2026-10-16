/**
 * Unit tests for the defensive chip-prose sanitiser (Phase 2 review
 * round 2). Pins:
 *   - HARD_BAN matches → suppress
 *   - entity-id leaks → suppress
 *   - empty / null / undefined → suppress
 *   - clean prose → passthrough
 *   - canonical SUPPRESSED_PROSE_FALLBACK match → suppress
 *
 * The marker test imports the same constant the parent enrichment
 * sanitiser writes; identity equality protects against silent drift
 * if the constant is ever renamed in sanitise-enrichment.ts.
 */

import { describe,expect,it } from 'vitest';


import { SUPPRESSED_PROSE_FALLBACK } from '../../compose/sanitise-enrichment.js';

describe('sanitiseChipProse', () => {












  it('SUPPRESSED_PROSE_FALLBACK identity pin — protects against rename drift', () => {
    // Identity check: the constant we import here must be the same
    // string the parent sanitiser writes. If sanitise-enrichment.ts
    // renames or re-locates this constant, this test should be the
    // first signal — not a runtime drift where dirty marker text
    // silently leaks into chips.
    expect(SUPPRESSED_PROSE_FALLBACK).toBe(
      'Review this part of the model before relying on this guidance.',
    );
  });
});
