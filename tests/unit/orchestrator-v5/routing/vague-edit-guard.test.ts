import { describe, it, expect } from 'vitest';
import {
  tryVagueEditGuard,
  type VagueEditGuardNode,
} from '../../../../src/orchestrator-v5/routing/vague-edit-guard.js';

const SAMPLE_GRAPH_NODES: readonly VagueEditGuardNode[] = Object.freeze([
  { id: 'f_hiring_cost', kind: 'factor', label: 'Hiring and Salary Cost' },
  { id: 'f_revenue', kind: 'factor', label: 'Revenue' },
  { id: 'opt_a', kind: 'option', label: 'Option A — Hire now' },
]);

describe('tryVagueEditGuard', () => {
  describe('intercepts (matched: true)', () => {
    const positives = [
      // Brief's explicit required examples (PR #194 review)
      'Make the model better',
      'Try something different',
      'Improve this',

      // Other vague edit shapes
      'Simplify the change', // legacy chip label variant
      'Change this',
      'Edit it to be cleaner',
      'Adjust this somehow',
      'Tweak this for me',
      'Update the thing', // verb + non-anchor object, no value
      'Polish this up',
      'Refine the wording',
    ];
    for (const msg of positives) {
      it(`intercepts "${msg}"`, () => {
        const result = tryVagueEditGuard(msg, SAMPLE_GRAPH_NODES);
        expect(result.matched).toBe(true);
      });
    }
  });

  describe('lets through concrete value edits (PR #192 deterministic path)', () => {
    const concrete = [
      'Set Hiring and Salary Cost to £100,000',
      'Change Hiring and Salary Cost from £80,000 to £100,000',
      'Increase Revenue by 30%',
      'Set Pricing to 0.7',
      'Lower the cost to £50k',
    ];
    for (const msg of concrete) {
      it(`does NOT intercept "${msg}"`, () => {
        const result = tryVagueEditGuard(msg, SAMPLE_GRAPH_NODES);
        expect(result.matched).toBe(false);
      });
    }
  });

  describe('lets through structural (add/remove) edits', () => {
    const structural = [
      'Add a risk for coordination overhead',
      'Add a new factor for FX exposure',
      'Remove the demand factor',
      'Insert another option',
      'Create a new constraint',
      'Delete the unused outcome',
    ];
    for (const msg of structural) {
      it(`does NOT intercept "${msg}"`, () => {
        const result = tryVagueEditGuard(msg, SAMPLE_GRAPH_NODES);
        expect(result.matched).toBe(false);
        if (!result.matched) {
          // Structural verbs (add / remove / insert / create /
          // delete / drop) are intentionally NOT in the vague-edit
          // verb list, so the new positive shape gate (PR #194
          // review correction) is the first check that fails. The
          // legacy `structural_keyword_present` reason is still
          // accepted for messages that DO carry a vague-edit shape
          // and ALSO a structural keyword.
          expect([
            'no_vague_edit_shape',
            'structural_keyword_present',
            'mutation_signal_present',
          ]).toContain(result.reason);
        }
      });
    }
  });

  describe('lets through analytical / hypothetical questions', () => {
    const questions = [
      'What could change the outcome?',
      'What if we lowered cost?',
      'Why does the model suggest Option A?',
      'How could we improve this analysis?',
      'Can you explain what changed?',
      'Would adjusting Revenue help?',
    ];
    for (const msg of questions) {
      it(`does NOT intercept "${msg}"`, () => {
        const result = tryVagueEditGuard(msg, SAMPLE_GRAPH_NODES);
        expect(result.matched).toBe(false);
      });
    }
  });

  describe('lets through messages anchored to a graph label', () => {
    // With the PR #194 review-2 phrase grammar, most label-anchored
    // edits fail the shape gate FIRST (their verb+object phrase
    // isn't in the table). The label-anchor check therefore only
    // fires on messages that DO match a vague-edit phrase AND
    // happen to also name a graph label — the test cases below
    // pin that backstop path explicitly.
    it('does NOT intercept when a shape-matching message also names a factor label', () => {
      // "change this Hiring and Salary Cost" → shape pattern hits
      // "change this", label check then fires on "Hiring and
      // Salary Cost".
      const result = tryVagueEditGuard(
        'change this Hiring and Salary Cost',
        SAMPLE_GRAPH_NODES,
      );
      expect(result.matched).toBe(false);
      if (!result.matched) expect(result.reason).toBe('graph_label_present');
    });

    it('does NOT intercept when a shape-matching message also names an option label', () => {
      // "improve this Option A — Hire now" → shape pattern hits
      // "improve this", label check fires on the canonical option
      // label.
      const result = tryVagueEditGuard(
        'improve this Option A — Hire now',
        SAMPLE_GRAPH_NODES,
      );
      expect(result.matched).toBe(false);
      if (!result.matched) expect(result.reason).toBe('graph_label_present');
    });

    it('label-less labels (the canonical label is NOT a substring of the message) → falls through to other checks', () => {
      // "Update the Hiring and Salary Cost a bit" has the label as
      // a substring but no vague-edit phrase shape — the shape
      // gate fires first.
      const result = tryVagueEditGuard(
        'Update the Hiring and Salary Cost a bit',
        SAMPLE_GRAPH_NODES,
      );
      expect(result.matched).toBe(false);
      if (!result.matched) expect(result.reason).toBe('no_vague_edit_shape');
    });
  });

  describe('numeric guard', () => {
    const numerics = [
      'Change it by £100',
      'Update the value by 30%',
      'Edit it to 0.7',
      'Adjust by 100k',
      'Modify by 1.5bn',
    ];
    for (const msg of numerics) {
      it(`does NOT intercept "${msg}"`, () => {
        const result = tryVagueEditGuard(msg, SAMPLE_GRAPH_NODES);
        expect(result.matched).toBe(false);
      });
    }
  });

  describe('positive shape gate rejects non-edit conversational messages', () => {
    // PR #194 review correction. The guard now runs BEFORE
    // EDIT_GRAPH_POSITIVE_REGEX narrows the candidate set, so it
    // MUST include its own positive shape check (table of complete
    // vague-edit phrases). Without that gate, the guard would
    // over-claim every non-edit non-question message.
    const conversational = [
      'Hello',
      'Goodbye',
      'Tell me a joke',
      'Thanks',
      'OK',
      'Got it',
      'Sounds good',
      'Sure',
      'Cool',
    ];
    for (const msg of conversational) {
      it(`does NOT intercept "${msg}"`, () => {
        const result = tryVagueEditGuard(msg, SAMPLE_GRAPH_NODES);
        expect(result.matched).toBe(false);
        if (!result.matched) {
          expect(result.reason).toBe('no_vague_edit_shape');
        }
      });
    }
  });

  describe('phrase-grammar narrowness — review-2 false-positive regression', () => {
    // PR #194 review-2 correction. The prior gate matched any
    // vague-edit verb OR any comparative modifier anywhere in the
    // message, producing false positives on benign follow-ups:
    //   "Sounds better", "Try again", "Try Option B", "Different", …
    // The phrase-based grammar fixes BOTH verb and object together
    // so `try` alone is not enough — it must be `try something
    // different` / `try a simpler version`. `better` alone is not
    // enough — it must be `make X better`.
    const reviewerFalsePositives = [
      'Sounds better',
      'That is better',
      'Try again',
      'Try running analysis again',
      'Try Option B',
      'Maybe different',
      'Different',
      'Better',
      'Something cleaner',
      'Make it work', // 'make it' present but no comparative
      'Make sense', // no edit shape at all
    ];
    for (const msg of reviewerFalsePositives) {
      it(`does NOT intercept "${msg}"`, () => {
        const result = tryVagueEditGuard(msg, SAMPLE_GRAPH_NODES);
        expect(result.matched).toBe(false);
        if (!result.matched) {
          expect(result.reason).toBe('no_vague_edit_shape');
        }
      });
    }
  });

  describe('safety / edge cases', () => {
    it('returns matched: false on empty message', () => {
      const result = tryVagueEditGuard('', SAMPLE_GRAPH_NODES);
      expect(result.matched).toBe(false);
      if (!result.matched) expect(result.reason).toBe('empty_message');
    });

    it('returns matched: false on whitespace-only message', () => {
      const result = tryVagueEditGuard('   ', SAMPLE_GRAPH_NODES);
      expect(result.matched).toBe(false);
    });

    it('still intercepts vague edits when no graph is available', () => {
      const result = tryVagueEditGuard('Edit this somehow', null);
      expect(result.matched).toBe(true);
    });

    it('skips labels shorter than 3 chars to avoid spurious anchor hits', () => {
      const result = tryVagueEditGuard('Edit this somehow', [
        { id: 'short', kind: 'factor', label: 'X' },
      ]);
      expect(result.matched).toBe(true);
    });
  });
});
