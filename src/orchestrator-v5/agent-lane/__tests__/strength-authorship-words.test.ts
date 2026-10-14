/**
 * "How strongly" is said from who sized each committed link (audit MAG-2). Rows bind the served edge shapes.
 */
import { describe, expect, it } from 'vitest';

import { howStronglyWords } from '../strength-authorship-words.js';
import { linkSizing } from '../../../cee/magnitude/link-sizing.js';

// Served 201724Z step 07 edge fac_ai_add_on_price → mrr: the flat default, no magnitude.
// Science 393023 LICENCE ruling 3, re-derived: the abbreviated {source:cee_hypothesis} fixture was unmarked,
// not the served default. Bind its actual ±0.5/0.125 + defaulted carrier so placeholder words mean one class.
const DEFAULT = { from: 'fac_ai_add_on_price', to: 'mrr', strength: { mean: 0.5, std: 0.125 },
  defaulted: true, provenance: { source: 'cee_hypothesis' } };
const ESTIMATE = { provenance: { source: 'cee_hypothesis', magnitude: 'olumi_estimate' } };
const PLACEHOLDER = { provenance: { source: 'cee_hypothesis', magnitude: 'olumi_placeholder' } };
const USERS = { provenance: { source: 'user_specified' } };

describe('howStronglyWords', () => {
  it('RED (served): a flat default is a placeholder, never "Olumi\'s estimate"', () => {
    expect(howStronglyWords([DEFAULT])).toBe('how strongly is not known yet: Olumi used a placeholder strength, not an estimate.');
    expect(howStronglyWords([PLACEHOLDER])).toMatch(/placeholder/);
  });
  it('an Olumi-sized estimate is said as Olumi\'s estimate', () => {
    expect(howStronglyWords([ESTIMATE, ESTIMATE])).toBe('how strongly is Olumi\'s estimate.');
  });
  it('a size the user gave is theirs', () => {
    expect(howStronglyWords([USERS])).toBe('how strongly is as you stated it.');
  });
  it('mixed links say both, never one for all', () => {
    expect(howStronglyWords([ESTIMATE, DEFAULT])).toMatch(/partly Olumi's estimate and partly a placeholder/);
  });

  // Science 393023 LICENCE ruling 3, re-derived: an arbitrary 0.6 without a sizing tag or projection carrier
  // is unmarked: placeholder words → no record of who set its strength; no unsized or estimate claim.
  it('R7 RED: an unmarked link is never called a placeholder', () => {
    const unmarked = { from: 'price', to: 'revenue', strength: { mean: 0.6, std: 0.2 },
      provenance: { source: 'cee_hypothesis' } };
    expect(linkSizing(unmarked)).toBe('unmarked');
    expect(howStronglyWords([unmarked])).toBe('who set its strength is not recorded.');
    expect(howStronglyWords([unmarked])).not.toMatch(/placeholder|estimate|not known yet/);
    expect(howStronglyWords([]), 'no links provide no sizing record').toBe('who set its strength is not recorded.');
  });

  // Science 393023 LICENCE ruling 3, re-derived: Price→Revenue user_specified + mean_projected (0.5/0.125),
  // nobody supplied a mean: "as you stated it" → placeholder words, regardless of the user drawing the link.
  it('R7 RED: a user-drawn projected Price→Revenue mean never earns user wording', () => {
    const projected = { from: 'price', to: 'revenue', strength: { mean: 0.5, std: 0.125 },
      provenance: { source: 'user_specified', mean_projected: true } };
    expect(linkSizing(projected)).toBe('placeholder');
    expect(howStronglyWords([projected])).toBe('how strongly is not known yet: Olumi used a placeholder strength, not an estimate.');
    const userSized = { ...projected, provenance: { source: 'user_specified' } };
    expect(linkSizing(userSized)).toBe('user');
    expect(howStronglyWords([userSized]), 'CONTROL: a real user-sized 0.5 is still theirs').toBe('how strongly is as you stated it.');
  });

  // Science 393023 LICENCE ruling 3, re-derived: a projected mean beside olumi_estimate contradicts a sized record,
  // so "Olumi's estimate" → placeholder; clearing the carrier restores the genuine-estimate control.
  it('R7 RED: a projected estimate tag fails closed in the committed-link receipt', () => {
    const projected = { from: 'price', to: 'revenue', strength: { mean: 0.5, std: 0.125 },
      provenance: { source: 'cee_hypothesis', magnitude: 'olumi_estimate', mean_projected: true } };
    expect(linkSizing(projected)).toBe('placeholder');
    expect(howStronglyWords([projected])).toContain('not an estimate');
    expect(howStronglyWords([{ ...projected, provenance: { source: 'cee_hypothesis', magnitude: 'olumi_estimate' } }]))
      .toBe('how strongly is Olumi\'s estimate.');
  });
});
