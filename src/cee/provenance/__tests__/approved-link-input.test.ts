import { describe, expect, it } from 'vitest';
import { approvedLinkInputFor, withApprovedLinkInput } from '../approved-link-input.js';
const value = { scenario: 's', turn: 't', from: 'f', to: 'g', previous: null,
  claim: { origin: 'ai' as const, basis: 'New estimate basis', source_quote: '', subject: { from: 'Price', to: 'MRR' } } };
describe('approved link input authority', () => {
  it('exists only inside its own approved write', async () => {
    expect(approvedLinkInputFor('s', 't', 'f', 'g')).toBeUndefined();
    await withApprovedLinkInput(value, async () => {
      expect(approvedLinkInputFor('s', 't', 'f', 'g')).toEqual(value);
      for (const args of [['other', 't', 'f', 'g'], ['s', 'other', 'f', 'g'], ['s', 't', 'other', 'g'], ['s', 't', 'f', 'other']]) {
        expect(approvedLinkInputFor(...args as [string, string, string, string])).toBeUndefined();
      }
    });
    expect(approvedLinkInputFor('s', 't', 'f', 'g')).toBeUndefined();
  });
  it('does not leak between concurrent writes or after an exception', async () => {
    await expect(withApprovedLinkInput(value, async () => { throw new Error('write failed'); })).rejects.toThrow('write failed');
    expect(approvedLinkInputFor('s', 't', 'f', 'g')).toBeUndefined();
    await Promise.all([value, { ...value, turn: 't2' }].map(input => withApprovedLinkInput(input, async () => {
      await Promise.resolve();
      expect(approvedLinkInputFor(input.scenario, input.turn, input.from, input.to)).toEqual(input);
      expect(approvedLinkInputFor('s', input.turn === 't' ? 't2' : 't', 'f', 'g')).toBeUndefined();
    })));
  });
});
