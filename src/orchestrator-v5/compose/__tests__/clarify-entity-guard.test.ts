/**
 * Unit tests for the V5 clarify-entity bold guard (Area C — deterministic-copy
 * hardening). Pure-function tests, no I/O.
 *
 * Regression for the staging defect where clarify / edit-clarification copy
 * bolded a fragment of the user's question as if it were a graph entity. The
 * guard preserves bold only around real node / option / edge labels (exact
 * normalised match) and strips it otherwise, leaving neutral copy.
 */
import { describe, expect, it } from 'vitest';

import {
  neutraliseUnvalidatedBoldEntities,
  collectValidEntityLabels,
} from '../clarify-entity-guard.js';

describe('collectValidEntityLabels', () => {
  it('collects normalised labels from graph nodes plus supplementary labels', () => {
    const set = collectValidEntityLabels({
      graphNodes: [
        { id: 'fac_cost', kind: 'factor', label: 'Operating Cost' },
        { id: 'opt_a', kind: 'option', label: 'Hire Contractor' },
        { id: 'goal', kind: 'goal' /* no label key */ },
        'not-an-object',
        null,
      ],
      labels: ['Launch Timing', '   ', undefined, null],
    });
    expect(set.has('operating cost')).toBe(true);
    expect(set.has('hire contractor')).toBe(true);
    expect(set.has('launch timing')).toBe(true);
    expect(set.has('')).toBe(false);
    expect(set.size).toBe(3); // blanks / non-strings / label-less nodes ignored
  });

  it('returns an empty set when no sources are provided', () => {
    expect(collectValidEntityLabels({}).size).toBe(0);
  });
});

describe('neutraliseUnvalidatedBoldEntities', () => {
  const labels = new Set(['operating cost', 'hire contractor', 'overtime intensity']);

  it('REGRESSION: strips bold from a question fragment that is not a real label', () => {
    // The earlier failure: clarify copy bolded an interpolated question
    // fragment as if it were an entity label.
    const input = 'Did you mean to change **the budget for next quarter**?';
    const out = neutraliseUnvalidatedBoldEntities(input, labels);
    expect(out.text).toBe('Did you mean to change the budget for next quarter?');
    expect(out.stripped_count).toBe(1);
    expect(out.text).not.toContain('**');
  });

  it('preserves bold around a real node label (case / whitespace insensitive)', () => {
    const input = 'Which value should **Operating Cost** take?';
    const out = neutraliseUnvalidatedBoldEntities(input, labels);
    expect(out.text).toBe('Which value should **Operating Cost** take?');
    expect(out.stripped_count).toBe(0);
  });

  it('preserves a real label even when the bold uses different casing', () => {
    const out = neutraliseUnvalidatedBoldEntities('Try **HIRE CONTRACTOR** instead.', labels);
    expect(out.text).toBe('Try **HIRE CONTRACTOR** instead.');
    expect(out.stripped_count).toBe(0);
  });

  it('strips invalid bold while keeping valid bold in the same string', () => {
    const input = 'Set **Operating Cost** or did you mean **the timeline**?';
    const out = neutraliseUnvalidatedBoldEntities(input, labels);
    expect(out.text).toBe('Set **Operating Cost** or did you mean the timeline?');
    expect(out.stripped_count).toBe(1);
  });

  it('exact-match only — a fragment merely CONTAINING a label is stripped (no fuzzy/substring match)', () => {
    const out = neutraliseUnvalidatedBoldEntities('Change **Operating Cost per unit**?', labels);
    expect(out.text).toBe('Change Operating Cost per unit?');
    expect(out.stripped_count).toBe(1);
  });

  it('with an empty label set, strips ALL bold (safe neutral default)', () => {
    const out = neutraliseUnvalidatedBoldEntities('Did you mean **the budget**?', new Set());
    expect(out.text).toBe('Did you mean the budget?');
    expect(out.stripped_count).toBe(1);
  });

  it('does not touch other markdown — only ** spans', () => {
    const input = 'Use _italics_ and `code` and a list:\n- one\n- two';
    const out = neutraliseUnvalidatedBoldEntities(input, labels);
    expect(out.text).toBe(input);
    expect(out.stripped_count).toBe(0);
  });

  it('returns the input unchanged when it contains no bold markers', () => {
    expect(neutraliseUnvalidatedBoldEntities('plain text', labels)).toEqual({
      text: 'plain text',
      stripped_count: 0,
    });
  });
});
