/**
 * "How strongly" is said from who sized each committed link (audit MAG-2). Rows bind the served edge shapes.
 */
import { describe, expect, it } from 'vitest';

import { howStronglyWords } from '../strength-authorship-words.js';

// Served 201724Z step 07 edge fac_ai_add_on_price → mrr: the flat default, no magnitude.
const DEFAULT = { provenance: { source: 'cee_hypothesis' } };
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
});
