/**
 * R10 — unit tests for findEditInternalsHit / EDIT_INTERNALS_PATTERNS.
 *
 * This predicate is the residual banned-pattern gate for the edit_graph no-op
 * clarification-preservation path. It is intentionally aggressive (a hit only
 * DECLINES preservation → safe deterministic fallback, never an erased
 * response), so the catch-all below pins one match per pattern family, and the
 * false-positive set proves a clean domain question (and ordinary prose
 * punctuation) is NOT tripped.
 */
import { describe, it, expect } from 'vitest';
import {
  EDIT_INTERNALS_PATTERNS,
  findEditInternalsHit,
} from '../forbidden-user-facing-phrases.js';

describe('findEditInternalsHit — catch-all (each banned family trips)', () => {
  const cases: Array<[string, string]> = [
    ['handler', 'The handler will process this.'],
    ['schema', 'That breaks the schema.'],
    ['validator', 'The validator rejected it.'],
    ['JSON', 'Return valid JSON only.'],
    ['operation (sing.)', 'Which operation did you mean?'],
    ['operations (pl.)', 'The operations list was empty.'],
    ['graph', 'Update the graph for me.'],
    ['node', 'Which node did you mean?'],
    ['nodes', 'Two nodes are affected.'],
    ['edge', 'Which edge to strengthen?'],
    ['edges', 'Both edges changed.'],
    ['path', 'The path was invalid.'],
    ['snake_case id', 'Did you mean fac_price?'],
    ['dotted internal path', 'See operations.path for the detail.'],
    ['ascii edge arrow', 'The fac_x->goal_revenue link.'],
  ];
  for (const [label, text] of cases) {
    it(`trips on ${label}`, () => {
      expect(findEditInternalsHit(text)).not.toBeNull();
    });
  }

  it('exposes a non-empty pattern set', () => {
    expect(EDIT_INTERNALS_PATTERNS.length).toBeGreaterThanOrEqual(8);
  });
});

describe('findEditInternalsHit — false-positive guard (clean prose is preserved)', () => {
  it('does NOT trip on a clean domain clarifying question', () => {
    // The exact question the brief requires to survive preservation.
    expect(
      findEditInternalsHit('Which price-related factor should this option affect?'),
    ).toBeNull();
  });

  it('does NOT trip on "e.g." / "i.e." abbreviations', () => {
    expect(findEditInternalsHit('Which factor — e.g. price or time?')).toBeNull();
    expect(findEditInternalsHit('Pick one, i.e. the bigger driver.')).toBeNull();
  });

  it('does NOT trip on ordinary sentence-boundary periods', () => {
    expect(findEditInternalsHit('Tell me the factor. Then the value.')).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(findEditInternalsHit('')).toBeNull();
  });
});
