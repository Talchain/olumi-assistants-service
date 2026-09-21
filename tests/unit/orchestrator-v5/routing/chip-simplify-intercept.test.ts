import { describe, it, expect } from 'vitest';
import {
  SIMPLIFY_CHANGE_CHIP_PROMPT,
  tryChipSimplifyIntercept,
} from '../../../../src/orchestrator-v5/routing/chip-simplify-intercept.js';

describe('tryChipSimplifyIntercept', () => {
  describe('exact-text match (the only leg shipped in PR1)', () => {
    it('matches the literal "Simplify the change" chip prompt', () => {
      const result = tryChipSimplifyIntercept(SIMPLIFY_CHANGE_CHIP_PROMPT);
      expect(result.matched).toBe(true);
      if (result.matched) expect(result.source).toBe('exact_text');
    });

    it('matches case-insensitively', () => {
      const result = tryChipSimplifyIntercept(
        'TRY A SIMPLER VERSION OF THIS CHANGE.',
      );
      expect(result.matched).toBe(true);
    });

    it('matches with surrounding whitespace', () => {
      const result = tryChipSimplifyIntercept(
        '   Try a simpler version of this change.   ',
      );
      expect(result.matched).toBe(true);
    });

    it('matches with collapsed internal whitespace', () => {
      const result = tryChipSimplifyIntercept(
        'Try  a   simpler version of  this change.',
      );
      expect(result.matched).toBe(true);
    });
  });

  describe('non-matches (must fall through to vague-edit / dispatch)', () => {
    const negatives = [
      '',
      '   ',
      'Try a simpler version', // truncated
      'Try a simpler version of this change!', // punctuation drift
      'Make this simpler',
      'Could you try something else?',
      'Set Pricing to 0.7',
      'Add a risk for coordination',
      'Change Hiring from £80,000 to £100,000',
    ];
    for (const msg of negatives) {
      it(`does not match "${msg.replace(/\s+/g, ' ').trim() || '<empty>'}"`, () => {
        const result = tryChipSimplifyIntercept(msg);
        expect(result.matched).toBe(false);
      });
    }
  });

  describe('safety', () => {
    it('handles non-string input gracefully', () => {
      // @ts-expect-error — intentionally passing wrong type for safety check.
      expect(tryChipSimplifyIntercept(null).matched).toBe(false);
      // @ts-expect-error — intentionally passing wrong type for safety check.
      expect(tryChipSimplifyIntercept(undefined).matched).toBe(false);
      // @ts-expect-error — intentionally passing wrong type for safety check.
      expect(tryChipSimplifyIntercept(123).matched).toBe(false);
    });
  });

  describe('future metadata leg (deferred — PR1 ships exact-text only)', () => {
    // TODO: ISSUE-197 — extend tryChipSimplifyIntercept once Action.source_chip_id schema lands.
    it.skip('matches when boundary `Action` carries chip-source metadata', () => {
      // Breadcrumb for the follow-up workstream. When the boundary
      // `Action` schema gains a chip-source metadata field
      // (e.g. `Action.source_chip_id` / `Action.metadata.intent`),
      // extend `tryChipSimplifyIntercept` to accept the second leg —
      // see the module's "Future work" doc-comment. Add the
      // metadata field path here, then unskip and pin the contract.
    });
  });
});
