/**
 * "WHAT IS STOPPING MY ANALYSIS" IS AN ADMISSION QUESTION, NOT AN EDIT.
 *
 * ⛔ THE CORPUS BELOW IS NOT THIS AUTHOR'S. Every string was harvested from
 * `public.v5_conversation_turns` on 23 Sep 2026 — messages real users actually
 * sent — by three separate queries: messages referencing analysis being
 * blocked; messages that landed on `set_factor_value` / `adjust_edge_strength` /
 * `add_option` / `edit_graph`; and messages that landed on `explain_results` /
 * `what_would_flip` / `explain_from_structure`. A predicate over natural
 * language tuned on its author's own inventions is a guard agreeing with
 * itself (trap: "a self-authored fixture is not evidence about the wire").
 *
 * The two negative sets matter more than the positive one. An over-matching
 * detector would hijack ordinary edits and result questions, which is a worse
 * defect than the one being fixed.
 */
import { describe, expect, it } from 'vitest';
import { detectUnblockAnalysisIntent } from '../unblock-analysis-intent.js';

/** Harvested, real, and each one genuinely asks what blocks admission. */
const HARVESTED_UNBLOCK: readonly string[] = Object.freeze([
  'Can you help me fix the issues that are stopping me from running analysis?',
  "Check it and just help me fix what's stopping me from running the analysis. Just put good assumptions in and make those updates immediately.",
  'Help me resolve the model issue that is blocking analysis.',
  'How do I fix this so the analysis can run?',
  'How many options are in this model, and what is blocking the analysis?',
  "I'm asking you to help fix the issue that is stopping me from running analysis after you added the new option.",
  "Now I can't run the analysis. Something's wrong with the model. Can you explain what the problem is and help me fix it?",
  "The analysis says it can't run. What exactly is missing, and what should I change to fix it?",
  'What did your previous analysis show? If no analysis has been run, say so and tell me exactly what is blocking it.',
  'What exactly is blocking analysis? Name every option and factor that still needs a value. Answer directly first, without coaching me.',
  'What is blocking the analysis?',
  "What's blocking the analysis?",
  'What’s blocking the analysis?',
  "Why can't the analysis run?",
  "Why can't we run the analysis?",
]);

/** Harvested real messages that landed on EDIT handlers. */
const HARVESTED_EDITS: readonly string[] = Object.freeze([
  'change Sales Cycle Length to 14',
  'change Sales Cycle Length to 12 months',
  'Set it to £120,000.',
  'Set Pro Plan Monthly Price to 64.',
  'Set the Pro Plan Monthly Price to £69 per month.',
  'set Product-Market Fit Investment to 0.8',
  'Set that value in my model.',
  'Set German Price Level to 40%.',
  'Set AI Feature Complexity to 8',
  'Extend the scale for Sales Headcount Investment and use the new value.',
  'Set the Local Senior Hire Programme factor to 1.0.',
  'Set Customer Churn Rate to 0.6',
  'German Price Level.',
]);

/** Harvested real messages that landed on RESULT-explaining handlers. */
const HARVESTED_QUESTIONS: readonly string[] = Object.freeze([
  'Which option should we go with?',
  'What does this depend on?',
  'What could change the outcome of this analysis?',
  'Walk me through what the analysis found.',
  'Walk me through what the first pass found.',
  'Explain the results',
  'Please explain the analysis result in plain language.',
  'What evidence would be most valuable to gather next?',
  'What does the first pass show, and what is still unconfirmed?',
  'How does the brand refresh campaign affect quarterly profit?',
]);

describe('detectUnblockAnalysisIntent', () => {
  it('claims every harvested unblock request', () => {
    const missed = HARVESTED_UNBLOCK.filter((m) => !detectUnblockAnalysisIntent(m).matched);
    expect(missed).toEqual([]);
  });

  it('CONTRAST CONTROL: claims NO harvested edit message', () => {
    const wrong = HARVESTED_EDITS.filter((m) => detectUnblockAnalysisIntent(m).matched);
    expect(wrong).toEqual([]);
  });

  it('CONTRAST CONTROL: claims NO harvested result question', () => {
    // "What could change the outcome of this analysis?" references analysis but
    // names no impediment — the conjunction is what keeps it out.
    const wrong = HARVESTED_QUESTIONS.filter((m) => detectUnblockAnalysisIntent(m).matched);
    expect(wrong).toEqual([]);
  });

  it('the conjunction is load-bearing in BOTH directions', () => {
    expect(detectUnblockAnalysisIntent('Walk me through what the analysis found.')).toEqual({
      matched: false,
      reason: 'no_impediment_signal',
    });
    expect(detectUnblockAnalysisIntent('Something is blocking me.')).toEqual({
      matched: false,
      reason: 'no_analysis_reference',
    });
  });

  it('DELIBERATE EXCLUSION: "What’s missing from my model?" is not claimed', () => {
    // Three real harvested messages take this shape. They name no analysis and
    // are a structural-review request; claiming them would be a new misroute,
    // so the conjunction leaves them alone. Recorded so the omission reads as a
    // decision rather than an oversight.
    for (const m of [
      "What's missing from my model?",
      "What's missing from this model?",
      "What's missing from this decision model? Review the graph for structural gaps.",
    ]) {
      expect(detectUnblockAnalysisIntent(m).matched).toBe(false);
    }
  });

  describe('repair authorisation is narrow', () => {
    it("Paul's message authorises estimates", () => {
      const r = detectUnblockAnalysisIntent(HARVESTED_UNBLOCK[1]);
      expect(r).toEqual({ matched: true, authorises_repair: true });
    });

    it('asking HOW to fix it does NOT authorise estimates', () => {
      // Real harvested message. It asks how; it hands over no permission.
      const r = detectUnblockAnalysisIntent('How do I fix this so the analysis can run?');
      expect(r).toEqual({ matched: true, authorises_repair: false });
    });

    it('a plain "what is blocking" question authorises nothing', () => {
      expect(detectUnblockAnalysisIntent('What is blocking the analysis?')).toEqual({
        matched: true,
        authorises_repair: false,
      });
    });
  });

  it('non-strings and blanks are refused by their own reason', () => {
    expect(detectUnblockAnalysisIntent(undefined).matched).toBe(false);
    expect(detectUnblockAnalysisIntent('   ')).toEqual({ matched: false, reason: 'empty_message' });
  });
});
