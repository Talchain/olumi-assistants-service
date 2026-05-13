/**
 * Unit tests for the post-analysis advice gate. Pure-function tests,
 * no I/O.
 *
 * Mirrors the user's worked acceptance cases: advice questions short-
 * circuit; concrete mutation messages fall through to normal routing.
 */

import { describe, expect, it } from 'vitest';

import {
  tryPostAnalysisAdviceGate,
  type AdviceGateAnalysis,
} from '../post-analysis-advice-gate.js';

const FIXTURE_ANALYSIS: AdviceGateAnalysis = {
  status: 'success',
  leading_option: { label: 'Hire two senior engineers locally' },
  top_drivers: [
    { factor_label: 'Delivery risk' },
    { factor_label: 'Cost overrun risk' },
  ],
};

describe('tryPostAnalysisAdviceGate — positive (advice) cases', () => {
  const positives: ReadonlyArray<readonly [string, string]> = [
    ['How should we improve this decision?', 'how should we improve'],
    ['What should we update based on this?', 'what should we update (no concrete target)'],
    ['What factor should we look at next?', 'what factor (advice noun)'],
    ['What would you recommend?', 'what would you recommend'],
    ['What do you suggest as the next step?', 'what do you suggest'],
    ['How can we improve the outcome?', 'how can we improve'],
    ['Where should we focus?', 'where should we focus'],
    ['Any suggestions on what to examine next?', 'any suggestions'],
    ['What is the next step?', 'what is the next step'],
    ['Can you suggest something based on this?', 'can you suggest'],
    ['How do you recommend we update the decision based on this?', 'canonical c952 misroute case'],
  ];

  for (const [message, label] of positives) {
    it(`matches: ${label}`, () => {
      const out = tryPostAnalysisAdviceGate({ message, analysis: FIXTURE_ANALYSIS });
      expect(out.matched).toBe(true);
      if (out.matched) {
        expect(out.assistant_text).toContain('Hire two senior engineers locally');
        expect(out.assistant_text).toContain('Delivery risk');
        expect(out.assistant_text.toLowerCase()).not.toContain('recommendation');
      }
    });
  }
});

describe('tryPostAnalysisAdviceGate — mutation-signal cases (do not match)', () => {
  const mutations: ReadonlyArray<readonly [string, string]> = [
    ['Set delivery risk to 0.7', 'set + to + numeric'],
    ['Set delivery risk to high', 'set + to + non-numeric'],
    ['Change delivery risk to 0.5', 'change + to + numeric'],
    ['Adjust the edge from A to B', 'adjust + from-to'],
    ['Remove the cost factor', 'remove the + entity'],
    ['Delete the delivery risk factor', 'delete the + entity'],
    ['Add a new option for staffing', 'add a new + entity'],
    ['Insert a new constraint on budget', 'insert a new + entity'],
    ['Change the edge from Cost to Risk', 'change + from-to'],
    ['Raise the budget to 100k', 'raise + to + numeric'],
    ['Lower delivery risk by 0.2', 'lower + numeric'],
    ['Set X to Y', 'set + to + token'],
  ];

  for (const [message, label] of mutations) {
    it(`falls through (mutation_signal): ${label}`, () => {
      const out = tryPostAnalysisAdviceGate({ message, analysis: FIXTURE_ANALYSIS });
      expect(out.matched).toBe(false);
      if (!out.matched) {
        expect(out.reason).toBe('mutation_signal');
      }
    });
  }
});

describe('tryPostAnalysisAdviceGate — pre-condition failures', () => {
  it('falls through when analysis is null', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'What should we do next?',
      analysis: null,
    });
    expect(out.matched).toBe(false);
    if (!out.matched) expect(out.reason).toBe('no_analysis');
  });

  it('falls through when leading_option is absent', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'What should we do next?',
      analysis: { ...FIXTURE_ANALYSIS, leading_option: null },
    });
    expect(out.matched).toBe(false);
    if (!out.matched) expect(out.reason).toBe('no_leading_option');
  });

  it('falls through when message is empty', () => {
    const out = tryPostAnalysisAdviceGate({
      message: '   ',
      analysis: FIXTURE_ANALYSIS,
    });
    expect(out.matched).toBe(false);
    if (!out.matched) expect(out.reason).toBe('empty_message');
  });

  it('falls through when message is unrelated chit-chat', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'Thanks, that helps.',
      analysis: FIXTURE_ANALYSIS,
    });
    expect(out.matched).toBe(false);
    if (!out.matched) expect(out.reason).toBe('no_advice_signal');
  });
});

describe('tryPostAnalysisAdviceGate — composer copy contract', () => {
  it('uses the brief-required two-sentence template when a top driver exists', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'What should we examine next?',
      analysis: FIXTURE_ANALYSIS,
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.assistant_text).toBe(
        'Based on the analysis, Hire two senior engineers locally is currently ahead. ' +
          'The biggest thing to examine next is Delivery risk, because it could change the result.',
      );
    }
  });

  it('falls back to an open prompt when no top driver is available', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'What should we do next?',
      analysis: { ...FIXTURE_ANALYSIS, top_drivers: [] },
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.assistant_text).toBe(
        "Based on the analysis, Hire two senior engineers locally is currently ahead. " +
          "Let me know which factor you'd like to look at next.",
      );
      expect(out.top_driver_label).toBeNull();
    }
  });

  it('never emits "recommendation", raw IDs, or decimals', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'How do you recommend we update the decision based on this?',
      analysis: FIXTURE_ANALYSIS,
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.assistant_text.toLowerCase()).not.toContain('recommendation');
      expect(out.assistant_text.toLowerCase()).not.toContain('recommended');
      expect(out.assistant_text).not.toMatch(/\boption_\w+\b/);
      expect(out.assistant_text).not.toMatch(/\d+\.\d+/);
    }
  });
});
