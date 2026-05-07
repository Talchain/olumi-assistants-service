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

  describe('post-mutation complaint patterns (V5 WS1 / G6 proof 4)', () => {
    // Brief Step 4 fixture: at least 10 phrasings catalogued + paraphrases.
    // Worked example: scenario 425c8c71-ff9d-485d-ac59-cbaa811fe09d
    // (manual test 2026-05-07) where "I'm not seeing that update on the
    // factor" routed to V4 edit_graph and failed STRUCTURAL_VALIDATION_FAILED.
    // Acceptance threshold: zero false negatives in the fixture set when
    // a successful mutation exists.
    const postMutationPhrasings = [
      // 1–7: catalogued in Docs/v5/v5-contract-completion-map.md Row 12
      "I'm not seeing that update",
      "I'm not seeing that update on the factor",
      'did that apply?',
      'where did the update go?',
      "the value didn't change",
      'is that reflected?',
      'what changed?',
      // 8–10: brief Step 4 examples
      'did my change apply?',
      'why can\'t I see the change?',
      'what update did you make?',
      // 11–13: paraphrases (≥3 required by E6)
      "the change isn't showing",
      'is the update applied yet?',
      'that didn\'t seem to work',
    ];

    for (const message of postMutationPhrasings) {
      it(`routes ${JSON.stringify(message)} to deterministic recovery when a mutation exists`, () => {
        const outcome = tryStateQueryGuard({
          message,
          contextPack: ctxWith([ADD_CONSTRAINT_50K]),
        });
        expect(outcome.matched).toBe(true);
        if (outcome.matched) {
          expect(outcome.dispatch).toBe('with_recent_change');
        }
      });
    }

    it('zero false negatives across the full fixture (≥10 entries)', () => {
      const failed: string[] = [];
      for (const message of postMutationPhrasings) {
        const outcome = tryStateQueryGuard({
          message,
          contextPack: ctxWith([ADD_CONSTRAINT_50K]),
        });
        if (!outcome.matched) failed.push(message);
      }
      expect(failed).toEqual([]);
      expect(postMutationPhrasings.length).toBeGreaterThanOrEqual(10);
    });

    it('post-mutation-only patterns do NOT fire when recent_changes is empty', () => {
      // "I'm not seeing that update" is post-mutation-only; with no
      // recent change, fall through to the LLM rather than asserting
      // nothing happened.
      const outcome = tryStateQueryGuard({
        message: "I'm not seeing that update",
        contextPack: ctxWith([]),
      });
      expect(outcome.matched).toBe(false);
    });

    it('legacy state-query patterns still fire on empty recent_changes (no_recent_changes dispatch)', () => {
      // Regression guard: post-mutation gating must NOT regress existing
      // named-follow-up behaviour. "what changed?" with no recent change
      // still returns the honest "haven't applied" copy.
      const outcome = tryStateQueryGuard({
        message: 'what changed?',
        contextPack: ctxWith([]),
      });
      expect(outcome.matched).toBe(true);
      if (outcome.matched) {
        expect(outcome.dispatch).toBe('no_recent_changes');
      }
    });

    it('negative control — "add a constraint about cost being below 50000" reaches normal routing', () => {
      // Brief Step 4 explicit negative control. After a recent mutation,
      // a NEW edit request (not a complaint) must still go to normal
      // routing so the user can layer further changes.
      const outcome = tryStateQueryGuard({
        message: 'add a constraint about cost being below 50000',
        contextPack: ctxWith([ADD_CONSTRAINT_50K]),
      });
      expect(outcome.matched).toBe(false);
    });

    // P1 review fix (round 2) — universal compound-edit bail-out covers
    // BOTH the legacy STATE_QUERY_PATTERNS and the new
    // POST_MUTATION_COMPLAINT_PATTERNS. All guard patterns match
    // substrings, so "what changed? add a constraint below 50000" or
    // "did you add it? add another option" would otherwise be swallowed.
    // The guard claims standalone complaint / readback turns only.
    describe('legacy compound-edit bail-out (FRESH_EDIT_BAIL_OUT_PATTERNS, universal)', () => {
      const legacyCompoundMessages = [
        'what changed? add a constraint below 50000',
        'what update did you make? add another option',
        'did you add it? add another option',
        'where did it go? change confidence to 0.9',
        "I can't see it. add a factor for capacity",
        'show me what you added; add another constraint',
        'what just changed? set churn to 0.05',
        'did you change it? update budget to 100000',
      ];

      for (const message of legacyCompoundMessages) {
        it(`falls through to normal routing for legacy compound: ${JSON.stringify(message)}`, () => {
          const outcome = tryStateQueryGuard({
            message,
            contextPack: ctxWith([ADD_CONSTRAINT_50K]),
          });
          expect(outcome.matched).toBe(false);
        });
      }

      it('legacy compound bail-out also fires when recent_changes is empty', () => {
        // Same risk applies to no_recent_changes branch — a compound
        // message must reach normal routing regardless of mutation
        // history so the LLM can disambiguate.
        const outcome = tryStateQueryGuard({
          message: 'what changed? add a constraint below 50000',
          contextPack: ctxWith([]),
        });
        expect(outcome.matched).toBe(false);
      });

      it('standalone "what changed?" still matches (no fresh-edit signal in message)', () => {
        // Regression guard: the bail-out must NOT fire on standalone
        // legacy phrases that happen to mention "change" or "update".
        const outcome = tryStateQueryGuard({
          message: 'what changed?',
          contextPack: ctxWith([ADD_CONSTRAINT_50K]),
        });
        expect(outcome.matched).toBe(true);
      });

      it('standalone "what update did you make?" still matches', () => {
        const outcome = tryStateQueryGuard({
          message: 'what update did you make?',
          contextPack: ctxWith([ADD_CONSTRAINT_50K]),
        });
        expect(outcome.matched).toBe(true);
      });

      it('standalone "did you add it?" still matches (pronoun, not article)', () => {
        const outcome = tryStateQueryGuard({
          message: 'did you add it?',
          contextPack: ctxWith([ADD_CONSTRAINT_50K]),
        });
        expect(outcome.matched).toBe(true);
      });
    });

    // P1 review fix (round 1) — false-positive controls for compound
    // messages on the post-mutation pattern set specifically. Legacy
    // pattern compound coverage is in the block above.
    describe('post-mutation compound-edit bail-out', () => {
      const compoundMessages = [
        'did that apply? add a constraint below 50000',
        'did my change apply? add another option',
        "I'm not seeing that update. add a factor for capacity",
        "the value didn't change. update churn to 5%",
        'is that reflected? change confidence to 0.9',
        "the change isn't showing. set churn to 0.05",
        // Sentence-boundary variations (semicolon, comma).
        "did that apply; add a new constraint",
        "is that reflected, please change confidence to 0.9",
      ];

      for (const message of compoundMessages) {
        it(`falls through to normal routing for compound: ${JSON.stringify(message)}`, () => {
          const outcome = tryStateQueryGuard({
            message,
            contextPack: ctxWith([ADD_CONSTRAINT_50K]),
          });
          expect(outcome.matched).toBe(false);
        });
      }

      // Pronoun cases must NOT be swallowed by the bail-out (they're
      // legitimate state-query phrases owned by the legacy patterns).
      it('"did you add it?" still matches via the legacy pattern (pronoun is not an article)', () => {
        const outcome = tryStateQueryGuard({
          message: 'did you add it?',
          contextPack: ctxWith([ADD_CONSTRAINT_50K]),
        });
        expect(outcome.matched).toBe(true);
      });

      it('"did you change it?" still matches via the legacy pattern (no "to <value>" tail)', () => {
        const outcome = tryStateQueryGuard({
          message: 'did you change it?',
          contextPack: ctxWith([ADD_CONSTRAINT_50K]),
        });
        expect(outcome.matched).toBe(true);
      });

      it('"what update did you make?" still matches via the legacy pattern', () => {
        const outcome = tryStateQueryGuard({
          message: 'what update did you make?',
          contextPack: ctxWith([ADD_CONSTRAINT_50K]),
        });
        expect(outcome.matched).toBe(true);
      });
    });

    // P1 review fix — extended no-recent-change fallthrough coverage.
    // Already have one test with "I'm not seeing that update" + empty
    // recent_changes; cover at least two more phrases.
    describe('no-recent-change fallthrough for post-mutation phrases', () => {
      const postMutationOnlyPhrases = [
        'did that apply?',
        'is that reflected?',
        "the value didn't change",
        "the change isn't showing",
      ];

      for (const message of postMutationOnlyPhrases) {
        it(`${JSON.stringify(message)} falls through to LLM when recent_changes is empty`, () => {
          const outcome = tryStateQueryGuard({
            message,
            contextPack: ctxWith([]),
          });
          expect(outcome.matched).toBe(false);
        });
      }
    });

    // Negative control — legitimate constraint phrasing after a recent
    // mutation must still reach normal routing rather than being read
    // as a state-complaint.
    it('negative control — "below 50000 should be the cap" after a recent mutation reaches normal routing', () => {
      const outcome = tryStateQueryGuard({
        message: 'below 50000 should be the cap',
        contextPack: ctxWith([ADD_CONSTRAINT_50K]),
      });
      expect(outcome.matched).toBe(false);
    });

    // Gemini Code Assist review — natural-language coverage gaps.
    // Compound bail-out must fire for article-less and multi-word
    // edit imperatives.
    describe('natural-language coverage — compound bail-out', () => {
      const compoundNaturalMessages = [
        // article-less imperatives
        'what changed? add constraint below 50000',
        "I'm not seeing that update. add risk for capacity",
        // multi-word noun phrases between verb and `to`
        'what changed? set the budget to 100k',
        'what changed? set total cost to 50k',
        'what changed? set the total cost to 50k',
        'did that apply? change customer satisfaction to high',
        'is that reflected? update the marketing budget to 200000',
      ];

      for (const message of compoundNaturalMessages) {
        it(`falls through to normal routing for natural-language compound: ${JSON.stringify(message)}`, () => {
          const outcome = tryStateQueryGuard({
            message,
            contextPack: ctxWith([ADD_CONSTRAINT_50K]),
          });
          expect(outcome.matched).toBe(false);
        });
      }

      // Lookbehind preservation — multi-word value-update tails inside
      // a `did you ...` interrogative must NOT trigger the bail-out.
      // "did you set the budget to 100k?" is a state-query about a
      // prior set, not a fresh imperative.
      it('"did you set the budget to 100k?" — multi-word interrogative is preserved by the lookbehind', () => {
        // No legacy STATE_QUERY_PATTERN matches `did you set` so the
        // outcome is matched=false (falls through to LLM) either way.
        // The point of this test is to prove the bail-out does NOT
        // fire on the imperative-shaped tail of a `did you ...`
        // interrogative — i.e. the lookbehind keeps doing its job
        // for multi-word noun phrases too.
        const outcome = tryStateQueryGuard({
          message: 'did you set the budget to 100k?',
          contextPack: ctxWith([ADD_CONSTRAINT_50K]),
        });
        expect(outcome.matched).toBe(false);
      });
    });

    // Gemini Code Assist review — multi-word labels are common in
    // this app ("Total cost", "Customer churn"). Post-mutation
    // patterns must catch them.
    describe('natural-language coverage — multi-word labels in complaints', () => {
      const multiWordComplaints = [
        // `did the X apply` with multi-word X
        'did the total cost apply?',
        'did the customer churn apply?',
        // `the X didn't change/update/apply` with multi-word X
        "the total cost didn't change",
        "the customer churn didn't apply",
        'the marketing budget did not update',
        // `is the X reflected` with multi-word X
        'is the total cost reflected?',
        'is the customer churn reflected?',
        // `the X isn't showing` with multi-word X
        "the customer churn isn't showing",
        'the total cost is not showing',
        // `is the X applied` with multi-word X
        'is the customer churn applied yet?',
        'is the total cost applied?',
      ];

      for (const message of multiWordComplaints) {
        it(`matches multi-word label complaint: ${JSON.stringify(message)}`, () => {
          const outcome = tryStateQueryGuard({
            message,
            contextPack: ctxWith([ADD_CONSTRAINT_50K]),
          });
          expect(outcome.matched).toBe(true);
        });
      }
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
