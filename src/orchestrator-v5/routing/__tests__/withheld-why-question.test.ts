/**
 * ROADMAP 2.104 — the withheld-why recogniser.
 *
 * WHAT THIS FILE IS FOR, beyond "the regexes work". Two things a pattern list
 * cannot prove about itself:
 *
 *   1. THE GAP IT WAS BUILT FOR IS REAL. The first describe block re-measures,
 *      at the production functions, that the withheld-why question shape had NO
 *      intent class before this module — the finding the whole change rests on.
 *      If a future PR teaches `classifyAnalyticalIntent` these phrasings, that
 *      block turns RED and forces a deliberate decision about which recogniser
 *      owns the shape, instead of two of them silently racing.
 *
 *   2. IT STAYS OFF ITS NEIGHBOURS. The negative set is not a grab-bag: every
 *      entry is a phrasing an EXISTING gate answers today, so a widening of
 *      these patterns that stole one of those turns fails here rather than in
 *      production.
 */
import { describe, it, expect } from 'vitest';

import { isWithheldWhyQuestion } from '../withheld-why-question.js';
import { classifyAnalyticalIntent, hasMutationSignal } from '../analytical-intent.js';
import { tryFreshAnalysisFollowupGuard } from '../fresh-analysis-followup-guard.js';
import type { ContextReadiness } from '../../context/readiness.js';

const FRESH_READINESS = {
  latest_analysis_freshness: 'fresh',
  has_run_analysis_fact: true,
} as unknown as ContextReadiness;

/**
 * The ROADMAP 2.104 row's own phrasing, the live journey's question, and the
 * ways a user says the same thing. Each is a shape the product must be able to
 * answer honestly on a withheld run.
 */
const WITHHELD_WHY_QUESTIONS: readonly string[] = [
  // The ROADMAP row's literal.
  'Why is there no option?',
  'Why is there no recommendation?',
  'Why is there no winner?',
  'Why is there no clear option?',
  'Why is there no preferred option?',
  'Why are there no recommendations?',
  "Why isn't there a leading option?",
  'Why was there no recommendation?',
  'Why no option?',
  'Why no recommendation?',
  'Why was no option put forward?',
  'Why is no option being put forward?',
  'Why is nothing recommended?',
  "Why can't you recommend one?",
  "Why can't the analysis put an option forward?",
  "Why won't you choose one?",
  'Why can you not suggest one?',
  'Why did you not pick an option?',
  "Why haven't you recommended anything?",
  "What's stopping a recommendation?",
];

/**
 * Phrasings an EXISTING gate owns. A widening that matched any of these would
 * take a turn away from a surface that answers it better — the failure mode
 * that makes a new recogniser a regression rather than a fix.
 */
const OWNED_BY_SOMETHING_ELSE: readonly string[] = [
  // post-analysis advice gate — explain_results_free_text / meaning
  'Explain the results',
  'What does this mean?',
  'What drove this result?',
  'Why is Option A ahead?',
  // what_would_flip
  'What would flip the result?',
  'What would need to change for another option to look better?',
  // advice / update_advice
  'What should I change?',
  'Which option should I pick?',
  'Recommend an option',
  // readiness — about a graph that cannot RUN, not a run that withheld
  'Why is the graph not ready?',
  "What's blocking the analysis?",
  'What is stopping the analysis from running?',
  'Why is this not ready to run?',
  // run comparison / what_changed
  'Why did the result change?',
  'Why did the option change?',
  // edits — mutation precedence is the caller's, but these must not match here
  'Set Pricing to 0.7',
  'Remove the demand factor',
  'Why did you not change the pricing factor?',
  // near-misses that are not this question
  'Why is there no data on cost?',
  'Why is there a delay?',
  'No option is fine, thanks',
];

describe('ROADMAP 2.104 — the gap this recogniser exists for, re-measured', () => {
  it('the withheld-why shape has NO analytical intent class, so no existing guard sees it', () => {
    // ⚠ THIS IS THE FINDING THE WHOLE CHANGE RESTS ON. The dispatch assumed the
    // question routed through the explain/coach path and got deflected there.
    // Measured at the base tip, it routes NOWHERE: `classifyAnalyticalIntent`
    // returns null, so the fresh-analysis follow-up catch-net rejects with
    // `no_analytical_signal` and control reaches the LLM router.
    const unclassified = WITHHELD_WHY_QUESTIONS.filter(
      (q) => classifyAnalyticalIntent(q) === null,
    );
    expect(unclassified).toEqual([...WITHHELD_WHY_QUESTIONS]);
  });

  it('and therefore the fresh-analysis catch-net declines every one of them', () => {
    for (const q of WITHHELD_WHY_QUESTIONS) {
      const outcome = tryFreshAnalysisFollowupGuard({ message: q, readiness: FRESH_READINESS });
      expect(outcome.matched, q).toBe(false);
      if (!outcome.matched) expect(outcome.reason, q).toBe('no_analytical_signal');
    }
  });

  it('the DEFLECTION is nonetheless real — an explain-class question on the same readiness recaps', () => {
    // The other half of the defect, pinned so the two are not conflated. This
    // guard is class-blind: it answers "what does this mean?" with a recap that
    // contains no account of a withhold, and on a withheld run it is where the
    // leader-needing advice classes fall through TO.
    const outcome = tryFreshAnalysisFollowupGuard({
      message: 'What does this mean?',
      readiness: FRESH_READINESS,
    });
    expect(outcome.matched).toBe(true);
    if (outcome.matched) {
      expect(outcome.assistant_text).toContain('recap');
      // It says nothing about why anything was withheld — which is the point.
      expect(outcome.assistant_text.toLowerCase()).not.toContain('condition');
      expect(outcome.assistant_text.toLowerCase()).not.toContain('put forward');
    }
  });
});

describe('isWithheldWhyQuestion', () => {
  it.each(WITHHELD_WHY_QUESTIONS)('recognises %j', (question) => {
    expect(isWithheldWhyQuestion(question)).toBe(true);
  });

  it.each(OWNED_BY_SOMETHING_ELSE)('leaves %j to the gate that owns it', (question) => {
    expect(isWithheldWhyQuestion(question)).toBe(false);
  });

  it('is insensitive to case, surrounding whitespace and a missing question mark', () => {
    expect(isWithheldWhyQuestion('  WHY IS THERE NO OPTION  ')).toBe(true);
    expect(isWithheldWhyQuestion('why is there no option')).toBe(true);
  });

  it('never throws on degenerate input', () => {
    expect(isWithheldWhyQuestion('')).toBe(false);
    expect(isWithheldWhyQuestion('   ')).toBe(false);
    expect(isWithheldWhyQuestion(null as unknown as string)).toBe(false);
    expect(isWithheldWhyQuestion(undefined as unknown as string)).toBe(false);
    expect(isWithheldWhyQuestion(42 as unknown as string)).toBe(false);
  });

  it('recognises the question inside a longer message', () => {
    expect(
      isWithheldWhyQuestion(
        'Thanks for running that. Why is there no option? I expected one by now.',
      ),
    ).toBe(true);
  });

  it('leaves the mutation gate to the caller — a why-question wrapping an edit still matches HERE', () => {
    // Precedence is enforced at the wiring site with the SHARED
    // `hasMutationSignal`, exactly as every sibling guard does it. This module
    // deliberately does not duplicate that decision, and this test pins the
    // division of labour so a future reader does not "fix" it in both places.
    const wrapped = 'Set Pricing to 0.7 — and why is there no option?';
    expect(isWithheldWhyQuestion(wrapped)).toBe(true);
    expect(hasMutationSignal(wrapped)).toBe(true);
  });
});
