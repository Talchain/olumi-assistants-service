/**
 * ONE predicate for "Olumi proposed this option" (DL 5887534233; Canonical 5887875048): the Run filter, the analysis hash
 * and MG's marker all decide with `isOlumiProposedOption`. It reads the ONE typed field and fails towards "the user's".
 */
import { describe, it, expect } from 'vitest';
import { isOlumiProposedOption, OLUMI_PROPOSED_BY } from '../olumi-proposed-option.js';

describe('isOlumiProposedOption', () => {
  it('true exactly for MG\'s typed mark', () => {
    expect(OLUMI_PROPOSED_BY).toBe('olumi');
    expect(isOlumiProposedOption({ id: 'opt_phased', kind: 'option', proposed_by: 'olumi' })).toBe(true);
  });

  it('everything else is the user\'s option — never a guess from provenance, origin or words', () => {
    for (const node of [
      { id: 'o', kind: 'option' },
      { id: 'o', kind: 'option', proposed_by: 'user' },
      { id: 'o', kind: 'option', proposed_by: 'Olumi' },
      { id: 'o', kind: 'option', proposed_by: true },
      { id: 'o', kind: 'option', provenance: 'ai_proposed' }, // the drafter's tag alone is not the mark (MG's backstop decides)
      { id: 'o', kind: 'option', origin: 'ai_proposed' },
      { id: 'o', kind: 'option', label: 'Olumi suggests a phased migration' },
      null, undefined, 'olumi', ['olumi'], 42,
    ]) {
      expect(isOlumiProposedOption(node), JSON.stringify(node)).toBe(false);
    }
  });
});
