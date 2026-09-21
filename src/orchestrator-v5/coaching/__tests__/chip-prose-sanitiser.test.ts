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

import { describe, expect, it } from 'vitest';

import { sanitiseChipProse } from '../chip-prose-sanitiser.js';
import { SUPPRESSED_PROSE_FALLBACK } from '../../compose/sanitise-enrichment.js';

describe('sanitiseChipProse', () => {
  it('returns clean prose unchanged', () => {
    const input = 'Reconsider how the cost factor is modelled.';
    const result = sanitiseChipProse(input);
    expect(result.suppressed).toBe(false);
    expect(result.text).toBe(input);
    expect(result.reason).toBeNull();
  });

  it('suppresses empty and whitespace-only inputs', () => {
    expect(sanitiseChipProse('').suppressed).toBe(true);
    expect(sanitiseChipProse(undefined).suppressed).toBe(true);
    expect(sanitiseChipProse(null).suppressed).toBe(true);
    expect(sanitiseChipProse('   ').suppressed).toBe(true);
  });

  it('suppresses entity-id leaks (factor / option / outcome / risk / etc.)', () => {
    // Either suppression reason is acceptable — HARD_BAN_PATTERNS may
    // catch some of these (e.g. "Node '...'") before the entity-id
    // detector runs. The important contract is that the input is
    // suppressed, not which specific code path caught it.
    for (const dirty of [
      "Node 'fac_hiring_cost' needs review",
      'Compare opt_a vs opt_b on cost.',
      'Targeting goal_revenue is risky.',
      'risk_attrition has no inbound edges.',
      'out_growth is the highest leverage point.',
    ]) {
      const result = sanitiseChipProse(dirty);
      expect(result.suppressed, `dirty input: ${dirty}`).toBe(true);
      expect(['hard_ban', 'entity_id_leak']).toContain(result.reason);
    }
  });

  it('an entity-id leak with no hard-ban tokens is caught by the entity-id detector specifically', () => {
    // Construct a string that DOESN'T trip HARD_BAN_PATTERNS but DOES
    // trip the entity-id detector — verifies the detector path is
    // reachable and the reason tag is set correctly when it fires.
    const result = sanitiseChipProse('Increase fac_revenue by ten percent.');
    expect(result.suppressed).toBe(true);
    expect(result.reason).toBe('entity_id_leak');
  });

  it('suppresses inputs that already carry the canonical SUPPRESSED_PROSE_FALLBACK marker', () => {
    // The parent enrichment sanitiser replaces unsafe prose with this
    // canonical marker. A card that arrives at the wrapper still
    // carrying it means upstream already rejected the original — we
    // must not surface either the marker text or the original.
    const result = sanitiseChipProse(SUPPRESSED_PROSE_FALLBACK);
    expect(result.suppressed).toBe(true);
    expect(result.reason).toBe('suppressed_marker');
  });

  it('suppresses inputs that EMBED the canonical marker as a substring', () => {
    const result = sanitiseChipProse(`Earlier: ${SUPPRESSED_PROSE_FALLBACK} Continue?`);
    expect(result.suppressed).toBe(true);
    expect(result.reason).toBe('suppressed_marker');
  });

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
