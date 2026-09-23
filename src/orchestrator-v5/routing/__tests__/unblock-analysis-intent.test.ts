/**
 * "WHAT IS STOPPING MY ANALYSIS" IS AN ADMISSION QUESTION, NOT AN EDIT.
 *
 * ── PROVENANCE OF EVERY STRING BELOW, STATED ───────────────────────────────
 * HARVESTED — real messages pulled from `public.v5_conversation_turns` on
 *   23 Sep 2026 by four queries: analysis-blocked language; error-message
 *   pastes; messages that landed on `set_factor_value`/`adjust_edge_strength`/
 *   `add_option`/`edit_graph`; messages that landed on `explain_results`/
 *   `what_would_flip`/`explain_from_structure`.
 * ADVERSARIAL — supplied by an independent reviewer of this module, not by its
 *   author. These exist because the harvested corpus could not reach the limb
 *   that was broken: 13 of 13 edit negatives are rejected at the ANALYSIS
 *   limb, so ZERO of them ever exercised the IMPEDIMENT limb. A contrast
 *   control that cannot reach the code under test is vacuous, and this suite
 *   said it was a control.
 *
 * ⛔ The review found two defects the harvested corpus alone could never show:
 *   (1) `authorises_repair` fired on messages explicitly REFUSING the licence;
 *   (2) the bare nouns `issue|problem|error` claimed 12 of 15 adversarial
 *       edit/result phrasings. Both are pinned below.
 */
import { describe, expect, it } from 'vitest';
import { detectUnblockAnalysisIntent } from '../unblock-analysis-intent.js';

/** HARVESTED — genuinely asks what blocks admission. */
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
  // Error-message pastes — these are what give `not ready` / `needs
  // configuration` / `no effect values` / `ready to analyse` real coverage.
  'I keep getting this error message when I try to run the analysis. Please can you help fix it Address before analysis 1 Options need configuration: European Market Expansion Decision Some options don’t have clear effects on the model’s factors.',
  "I'm getting the error message below. I need your help to fix it. Not ready for analysis yet 4 options have no effect values yet. Tell Olumi what they change and the analysis can run",
  'When I try to run analysis after you’ve added the new option, I’m getting this error message. Please can you fix it? V3 analysis not ready: 1 option(s) blocked: opt_fractional_assistant',
  'Please fill in the missing effect values for every option so the model is ready to analyse, then tell me it is ready.',
  'What do the 6 parts that are not ready for analysis need?',
  'What does the retail and hospitality option need before you can run the analysis?',
]);

/** ADVERSARIAL — natural phrasings a real user could plausibly send. */
const ADVERSARIAL_UNBLOCK: readonly string[] = Object.freeze([
  'What is preventing the analysis from running?',
  'What is holding up the analysis?',
  "I'm stuck — the analysis won't run.",
  'The run analysis button is greyed out. Why?',
  'Run analysis is disabled. What do I need to do?',
  'Get the model ready to analyse.',
]);

/** HARVESTED — landed on EDIT handlers. */
const HARVESTED_EDITS: readonly string[] = Object.freeze([
  'change Sales Cycle Length to 14',
  'change Sales Cycle Length to 12 months',
  'Set it to £120,000.',
  'Set Pro Plan Monthly Price to 64.',
  'set Product-Market Fit Investment to 0.8',
  'Set that value in my model.',
  'Set German Price Level to 40%.',
  'Extend the scale for Sales Headcount Investment and use the new value.',
  'Set Customer Churn Rate to 0.6',
  'German Price Level.',
]);

/** HARVESTED — landed on RESULT-explaining handlers. */
const HARVESTED_QUESTIONS: readonly string[] = Object.freeze([
  'Which option should we go with?',
  'What does this depend on?',
  'What could change the outcome of this analysis?',
  'Walk me through what the analysis found.',
  'Explain the results',
  'Please explain the analysis result in plain language.',
  'What evidence would be most valuable to gather next?',
  'How does the brand refresh campaign affect quarterly profit?',
]);

/**
 * ADVERSARIAL — the exact shapes the removed bare nouns claimed. Each names
 * trouble somewhere while asking nothing about admission.
 */
const ADVERSARIAL_MUST_NOT_MATCH: readonly string[] = Object.freeze([
  'Walk me through the analysis and the issue tree.',
  'Explain the analysis result and any problem areas it highlights.',
  'What does the analysis say about execution risk? Fix the labels while you are there.',
  'Run the analysis again and tell me the margin of error.',
]);

describe('detectUnblockAnalysisIntent', () => {
  it('claims every HARVESTED unblock request', () => {
    expect(HARVESTED_UNBLOCK.filter((m) => !detectUnblockAnalysisIntent(m).matched)).toEqual([]);
  });

  it('claims every ADVERSARIAL natural phrasing (recall the corpus could not test)', () => {
    expect(ADVERSARIAL_UNBLOCK.filter((m) => !detectUnblockAnalysisIntent(m).matched)).toEqual([]);
  });

  it('CONTRAST CONTROL: claims no HARVESTED edit message', () => {
    expect(HARVESTED_EDITS.filter((m) => detectUnblockAnalysisIntent(m).matched)).toEqual([]);
  });

  it('CONTRAST CONTROL: claims no HARVESTED result question', () => {
    expect(HARVESTED_QUESTIONS.filter((m) => detectUnblockAnalysisIntent(m).matched)).toEqual([]);
  });

  it('CONTROL THAT REACHES THE IMPEDIMENT LIMB: trouble-nouns alone are not admission', () => {
    // ⚠ The harvested edit negatives all stop at the ANALYSIS limb, so they
    // never tested this. These carry an analysis reference AND a trouble noun.
    expect(ADVERSARIAL_MUST_NOT_MATCH.filter((m) => detectUnblockAnalysisIntent(m).matched)).toEqual([]);
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
    for (const m of ["What's missing from my model?", "What's missing from this model?"]) {
      expect(detectUnblockAnalysisIntent(m).matched).toBe(false);
    }
  });

  describe('repair authorisation fails closed', () => {
    it('HARVESTED authorisations are recognised', () => {
      for (const m of [
        HARVESTED_UNBLOCK[1],
        'Please set any missing option effect values yourself using sensible estimates from my brief, then tell me the model is ready to analyse.',
        'Please set any missing option effect values yourself using your best judgement from the brief, and tell me what you chose and why. Then the model should be ready to analyse.',
        'You choose the cleanest structure so each option can be compared properly - restructure whatever is needed, apply it, and get the model ready to analyse. Go ahead.',
      ]) {
        const r = detectUnblockAnalysisIntent(m);
        expect(r).toEqual({ matched: true, authorises_repair: true });
      }
    });

    it('⛔ ADVERSARIAL: a message REFUSING the licence never authorises it', () => {
      for (const m of [
        "What's blocking the analysis? Don't make any assumptions.",
        'Tell me what is stopping the analysis. Never use estimates.',
        'What is blocking analysis? Ask me before you add any assumptions.',
        'Why can’t the analysis run? Fix it without guessing any numbers.',
      ]) {
        const r = detectUnblockAnalysisIntent(m);
        expect(r.matched).toBe(true);
        expect((r as { authorises_repair: boolean }).authorises_repair).toBe(false);
      }
    });

    it('asking HOW to fix it does NOT authorise estimates', () => {
      expect(detectUnblockAnalysisIntent('How do I fix this so the analysis can run?')).toEqual({
        matched: true,
        authorises_repair: false,
      });
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

/**
 * ADVERSARIAL ROUND 2 — supplied by a second independent reviewer after the
 * first round of fixes. Both classes below were measured wrong at that head:
 * generic trouble-words claimed 15 of 15 fresh strings, and 6 of 8 fresh
 * refusals still authorised repair.
 */
describe('generic trouble-words are bound to the analysis clause', () => {
  it('trouble in a DIFFERENT sentence is not an admission request', () => {
    for (const m of [
      'Explain the analysis. The export button is disabled.',
      'Walk me through the analysis; our CI is failing.',
      "Summarise the analysis. I'm stuck on the pricing question.",
      'What does the analysis say about capacity? The vendor portal is unavailable.',
    ]) {
      expect(detectUnblockAnalysisIntent(m).matched).toBe(false);
    }
  });

  it('CONTROL: trouble in the SAME clause as the analysis IS claimed', () => {
    for (const m of [
      'Run analysis is disabled. What do I need to do?',
      'The run analysis button is greyed out. Why?',
    ]) {
      expect(detectUnblockAnalysisIntent(m).matched).toBe(true);
    }
  });
});

describe('the prohibition guard fails closed on deferral, not just negation', () => {
  it('⛔ a message deferring to the user never authorises repair', () => {
    for (const m of [
      'Check with me first, then put good assumptions in.',
      'Confirm with me before you use any estimates.',
      'Run it past me before making assumptions about what is blocking analysis.',
      "What's blocking the analysis? No guessing.",
      'Let me know first before you choose any estimates for the blocked analysis.',
      "What is stopping analysis? Don't make any assumptions.",
    ]) {
      const r = detectUnblockAnalysisIntent(m);
      if (!r.matched) continue; // some are refused earlier; that is also safe
      expect((r as { authorises_repair: boolean }).authorises_repair).toBe(false);
    }
  });

  it('CONTROL: an unconditional authorisation still authorises', () => {
    const r = detectUnblockAnalysisIntent(
      'What is blocking the analysis? Put good assumptions in and make those updates.',
    );
    expect(r).toEqual({ matched: true, authorises_repair: true });
  });
});
