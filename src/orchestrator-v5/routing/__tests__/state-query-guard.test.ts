/**
 * Unit tests for the V5 deterministic state-query guard.
 *
 * Covers the named-follow-up phrase allowlist, the negative gate that
 * excludes edit verbs / quantities, and the two dispatch shapes
 * (`with_recent_change` and `no_recent_changes`).
 */
import { describe, expect, it } from 'vitest';

import type { ContextPack } from '../../context/context-pack-assembler.js';
import type { RecentMutation } from '../../context/recent-changes.js';
import { tryStateQueryGuard } from '../state-query-guard.js';

const ADD_CONSTRAINT_50K: RecentMutation = {
  action: 'constraint_added',
  summary: 'Added constraint: Total cost must be at most £50,000.',
  target_label: 'Total cost',
};

function ctxWith(recent: readonly RecentMutation[]): Pick<ContextPack, 'recent_changes'> {
  return { recent_changes: recent };
}

describe('tryStateQueryGuard', () => {
  describe('matches the named follow-up phrases', () => {
    const matchingMessages = [
      'What changed?',
      "What's changed?",
      'What has changed?',
      'What just changed?',
      'what update did you make?',
      'What updates did you make?',
      'What change did you make?',
      'What changes did you make?',
      'What did you change?',
      'What did you update?',
      'What did you add?',
      'did you change anything?',
      "Did you update it?",
      "Did you apply that?",
      "Did you add it?",
      "I can't see it",
      "I can't see this constraint",
      "I cannot see this",
      'where is it?',
      "where's it gone?",
      'where did it go?',
      'show me what you added',
      'show me what you changed',
      'show me what you updated',
    ];

    for (const message of matchingMessages) {
      it(`matches ${JSON.stringify(message)}`, () => {
        const outcome = tryStateQueryGuard({
          message,
          contextPack: ctxWith([ADD_CONSTRAINT_50K]),
        });
        expect(outcome.matched).toBe(true);
      });
    }
  });

  describe('does NOT match edit-style messages', () => {
    const nonMatchingMessages = [
      'Set churn to 5%',
      'Increase confidence to 0.8',
      'reduce churn',
      'remove the option',
      'lower the budget',
      // Pure confirmations belong to the short-confirm pre-route, not
      // the state-query guard.
      'yes',
      'ok',
      'do that',
      // Generic session-summary questions — must NOT trigger the
      // deterministic floor. They go to the LLM with the
      // `recent_changes` ContextPack projection grounding the answer.
      // Each contains a question prefix but NO change-word in the
      // change-word slot, so the narrowed pattern set excludes them.
      'What did you do?',
      'show me what you did',
      'what did you do today?',
      // "What's been happening" — generic, no change-word
      "what's been happening?",
      // "Tell me what you did" — same generic class as "show me what you did"
      'tell me what you did',
    ];

    for (const message of nonMatchingMessages) {
      it(`does not match ${JSON.stringify(message)}`, () => {
        const outcome = tryStateQueryGuard({
          message,
          contextPack: ctxWith([ADD_CONSTRAINT_50K]),
        });
        expect(outcome.matched).toBe(false);
      });
    }
  });

  describe('digit-bearing state queries (refined gate, P1-7)', () => {
    // Pre-fix: any digit triggered the negative gate, so these
    // legitimate state-queries fell through to the LLM. Post-fix the
    // digit guard is removed so the deterministic floor catches them.
    const matchingDigitQueries = [
      "did you change it to £50k?",
      "I can't see the £50k constraint",
      // "did you apply ..." matches the `did\s+you\s+(?:change|update|apply|add)` pattern
      // even with a digit phrase trailing; previously the digit guard blocked.
      "did you apply the 50,000 cap?",
    ];

    for (const message of matchingDigitQueries) {
      it(`matches digit-bearing state query ${JSON.stringify(message)}`, () => {
        const outcome = tryStateQueryGuard({
          message,
          contextPack: ctxWith([ADD_CONSTRAINT_50K]),
        });
        expect(outcome.matched).toBe(true);
      });
    }

    // Edit commands that include digits are still caught by the
    // imperative-verb part of the gate.
    const stillBlockedDigitEdits = [
      'Set churn to 5%',
      'Increase the budget to £100,000',
      'Lower it to 3%',
      'Reduce churn to 2.5%',
    ];

    for (const message of stillBlockedDigitEdits) {
      it(`does not match imperative-with-digit ${JSON.stringify(message)}`, () => {
        const outcome = tryStateQueryGuard({
          message,
          contextPack: ctxWith([ADD_CONSTRAINT_50K]),
        });
        expect(outcome.matched).toBe(false);
      });
    }
  });

  describe('with_recent_change dispatch', () => {
    it('grounds the answer in the most recent mutation summary verbatim', () => {
      const outcome = tryStateQueryGuard({
        message: 'What update did you make?',
        contextPack: ctxWith([ADD_CONSTRAINT_50K]),
      });
      if (!outcome.matched || outcome.dispatch !== 'with_recent_change') {
        throw new Error(`expected with_recent_change dispatch, got ${JSON.stringify(outcome)}`);
      }
      // The literal £50,000 reference is what the integration test
      // asserts on. If this format changes, update the integration
      // assertion in lockstep.
      expect(outcome.assistant_text).toContain('£50,000');
      expect(outcome.assistant_text).toContain('Total cost');
      expect(outcome.recent_change).toBe(ADD_CONSTRAINT_50K);
      expect(outcome.recent_change_count).toBe(1);
    });

    it('includes a tail mentioning earlier changes when more than one mutation exists', () => {
      const second: RecentMutation = {
        action: 'factor_value_updated',
        summary: 'Updated Confidence from 0.6 to 0.8.',
        target_label: 'Confidence',
      };
      const outcome = tryStateQueryGuard({
        message: 'what changed?',
        contextPack: ctxWith([ADD_CONSTRAINT_50K, second]),
      });
      if (!outcome.matched || outcome.dispatch !== 'with_recent_change') {
        throw new Error(`expected with_recent_change dispatch, got ${JSON.stringify(outcome)}`);
      }
      expect(outcome.assistant_text).toContain('£50,000');
      expect(outcome.assistant_text.toLowerCase()).toContain('earlier');
      expect(outcome.recent_change_count).toBe(2);
    });

    it('does not leak raw identifiers from the mutation', () => {
      // The summary is already sanitised by projectRecentChanges, but
      // we re-assert here to make the contract visible at the guard
      // boundary too.
      const outcome = tryStateQueryGuard({
        message: 'what did you change?',
        contextPack: ctxWith([ADD_CONSTRAINT_50K]),
      });
      if (!outcome.matched) throw new Error('expected matched=true');
      expect(outcome.assistant_text).not.toMatch(/gc-/i);
      expect(outcome.assistant_text).not.toMatch(/constraint_id/i);
      expect(outcome.assistant_text).not.toMatch(/node_id/i);
      expect(outcome.assistant_text).not.toMatch(/provenance/i);
    });
  });

  describe('no_recent_changes dispatch', () => {
    it('returns the curated "I haven\'t applied any changes" copy when recent_changes is empty', () => {
      const outcome = tryStateQueryGuard({
        message: 'what update did you make?',
        contextPack: ctxWith([]),
      });
      if (!outcome.matched) throw new Error('expected matched=true');
      expect(outcome.dispatch).toBe('no_recent_changes');
      expect(outcome.assistant_text.toLowerCase()).toContain("haven't applied");
      // Asserts the deterministic dispatch never returns the legacy
      // edit_graph denial copy. This is the regression guard against
      // the original misroute.
      expect(outcome.assistant_text).not.toMatch(/no changes were needed/i);
      expect(outcome.assistant_text).not.toMatch(/no update has been made/i);
    });
  });

  describe('boundary cases', () => {
    it('does not match an empty message', () => {
      const outcome = tryStateQueryGuard({
        message: '',
        contextPack: ctxWith([ADD_CONSTRAINT_50K]),
      });
      expect(outcome.matched).toBe(false);
    });

    it('matches when phrase has trailing punctuation', () => {
      const outcome = tryStateQueryGuard({
        message: 'what changed??!',
        contextPack: ctxWith([ADD_CONSTRAINT_50K]),
      });
      expect(outcome.matched).toBe(true);
    });

    it('is case-insensitive', () => {
      const outcome = tryStateQueryGuard({
        message: 'WHAT UPDATE DID YOU MAKE',
        contextPack: ctxWith([ADD_CONSTRAINT_50K]),
      });
      expect(outcome.matched).toBe(true);
    });
  });
});
