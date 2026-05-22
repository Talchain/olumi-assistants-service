import { describe, it, expect } from 'vitest';
import { isAnalyticalQuestion } from '../../../../src/orchestrator-v5/routing/analytical-question-guard.js';

describe('isAnalyticalQuestion', () => {
  describe('intercepts non-mutating analytical / hypothetical questions', () => {
    const positives = [
      // User's enumerated examples
      'What could change the outcome?',
      'What would change the outcome?',
      'What might shift the result?',
      'What would move the result?',
      'What would need to change for another option to win?',

      // Additional canonical variants from classifyAnalyticalIntent
      'What would flip this result?',
      'What would tip the balance?',
      'What would it take to change this?',
      'How could another option win?',
      'Walk me through the analysis',
      'Explain the result',
      "What's driving this?",
      'Is this analysis still valid?',
      'Do I need to rerun?',
      // Note: "How could option B come out ahead?" and "Why did
      // Option A win?" fall in a pre-existing classifyAnalyticalIntent
      // gap (`option B` doesn't immediately abut `come out ahead`;
      // `why did` only catches `this/that/the result/analysis/outcome`).
      // Those are NOT in scope for this PR — covered elsewhere on the
      // analytical surface or via Sonnet routing.

      // New variants this guard owns (not yet in classifyAnalyticalIntent)
      'What might change the outcome?',
      'What could shift the leading option?',
      'What might tip the ranking?',
      'What would alter the analysis?',
      'How could the outcome change?',
      'How might the ranking shift?',
      'How would the result move?',
    ];
    for (const msg of positives) {
      it(`intercepts "${msg}"`, () => {
        expect(isAnalyticalQuestion(msg)).toBe(true);
      });
    }
  });

  describe('lets through concrete edit instructions', () => {
    const concrete = [
      // User's enumerated negative examples
      'Change Hiring and Salary Cost to £100,000.',
      'Change Hiring and Salary Cost from £80,000 to £100,000.',
      'Set Technical Leadership Capacity to 1.',
      'Add a risk for coordination overhead.',

      // Additional concrete forms that must keep their existing route
      'Increase Revenue by 30%',
      'Lower the cost to £50k',
      'Remove the demand factor',
      'Insert a new option',
      'Update the model to include market dynamics',
      'Update existing team maturity to mid-weight developers',
      'Add team dynamics as a risk',
    ];
    for (const msg of concrete) {
      it(`does NOT intercept "${msg}"`, () => {
        expect(isAnalyticalQuestion(msg)).toBe(false);
      });
    }
  });

  describe('does not intercept vague edits with no outcome anchor', () => {
    // The vague-edit guard owns these; the analytical-question guard
    // must NOT also claim them. Otherwise the order of fall-through
    // would change and the user's clarification UX would shift from
    // "deterministic clarification" to "TurnExecutor advice".
    const vagueEdits = [
      'Simplify the change',
      'Edit it to be cleaner',
      'Adjust this somehow',
      'Tweak this for me',
      'Update the thing',
    ];
    for (const msg of vagueEdits) {
      it(`does NOT intercept "${msg}"`, () => {
        expect(isAnalyticalQuestion(msg)).toBe(false);
      });
    }
  });

  describe('does not intercept questions about specific factors (not outcome)', () => {
    // The narrow outcome-noun alternation in this guard's regexes
    // prevents over-claiming. A question about a user-named factor
    // is the LLM's domain; the guard must stay out of it.
    const specificFactorQuestions = [
      'What could change my Pricing assumption?',
      'What might affect my Hiring estimate?',
      'How could I tweak Revenue?',
    ];
    for (const msg of specificFactorQuestions) {
      it(`does NOT intercept "${msg}"`, () => {
        expect(isAnalyticalQuestion(msg)).toBe(false);
      });
    }
  });

  describe('safety / edge cases', () => {
    it('returns false on empty / whitespace / non-string input', () => {
      expect(isAnalyticalQuestion('')).toBe(false);
      expect(isAnalyticalQuestion('   ')).toBe(false);
      // @ts-expect-error — intentionally passing wrong type for safety check.
      expect(isAnalyticalQuestion(null)).toBe(false);
      // @ts-expect-error — intentionally passing wrong type for safety check.
      expect(isAnalyticalQuestion(undefined)).toBe(false);
      // @ts-expect-error — intentionally passing wrong type for safety check.
      expect(isAnalyticalQuestion(123)).toBe(false);
    });
  });
});
