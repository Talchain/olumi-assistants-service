/**
 * The advice gate must never claim a REASONING REQUEST.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * `CLASS_PATTERNS`' `meaning` class owns
 * `/\bhelp\s+me\s+(?:interpret|understand|make\s+sense\s+of|read)\b/i` — the
 * single most common English phrasing of a request for help THINKING. On any
 * turn with a fresh analysis in state the gate claimed it, and the turn-executor
 * committed with `llm_calls_used: 0` (`turn-executor.ts:8008,8068`). The user
 * asking *"help me understand what's causing this"* about their own problem got
 * `composeMeaning`'s *"Based on this model, the analysis currently favours 'X'
 * (62%)"* — a status report on the model, with a probability, and zero model
 * calls.
 *
 * ── THE DISCRIMINATION, AND WHY IT IS BOUNDED ───────────────────────────────
 * Three cases, not two (the one-predicate-two-harms shape CEE #888 paid four
 * oscillating rounds for — see CLAUDE.md trap 22b/22f):
 *
 *   (a) object is an ANALYSIS REFERENT  → the gate keeps it (grounded copy).
 *   (b) object is a BARE DEMONSTRATIVE  → AMBIGUOUS. Behaviour UNCHANGED —
 *       the gate keeps it. Declining here would be a guess, and a guess in
 *       this direction silently degrades every legitimate "help me understand
 *       this" on a post-analysis turn.
 *   (c) object opens with a WH-WORD and the message carries NO analysis
 *       referent → a question about the WORLD → the gate must decline.
 *
 * Both parameters are CLOSED SETS drawn from the gate's OWN existing
 * vocabulary, never from this author's head (trap 22): the analysis nouns are
 * the ones its sibling patterns already enumerate, and the leader-position
 * words are lifted verbatim from the `explain_results_free_text` pattern at
 * `post-analysis-advice-gate.ts:584`.
 *
 * ── WHAT THIS SPEC PINS ─────────────────────────────────────────────────────
 * Every case below carries its OPPOSITE-DIRECTION TWIN in the same run
 * (trap 22b): a decline is only trustworthy beside a claim that still fires on
 * the same machinery. The KNOWN-NOT-CLAIMED block pins case (b) explicitly, so
 * the suite REDs if that set grows OR shrinks (trap 22f's honest-gap rule).
 */

import { describe, expect, it } from 'vitest';

import {
  tryPostAnalysisAdviceGate,
  type AdviceGateAnalysis,
} from '../post-analysis-advice-gate.js';

const FRESH_ANALYSIS: AdviceGateAnalysis = {
  status: 'success',
  leading_option: { label: 'Rebuild onboarding' },
  runner_up: { label: 'Rebuild pricing' },
  top_drivers: [{ factor_label: 'Time to first value' }],
  fragile_edges: [{ from_label: 'Time to first value', to_label: 'Retention' }],
};

function gate(message: string) {
  return tryPostAnalysisAdviceGate({
    message,
    analysis: FRESH_ANALYSIS,
    freshness: 'fresh',
  });
}

// =========================================================================
// (c) REASONING REQUESTS — the gate must decline, so the turn reaches the
//     model. Each row is paired with its analysis-referring twin below.
// =========================================================================

const REASONING_REQUESTS: readonly string[] = [
  // The acceptance case, verbatim.
  "Help me understand what's causing this",
  'Help me understand why retention is slipping',
  'Help me understand what we should be worried about',
  'Help me interpret what is going on with churn',
  'Help me make sense of why the team disagrees',
  'Help us understand what is driving customers away',
  'How should I think about what is happening here',
  'How do we understand why this keeps recurring',
  'Walk me through what happened with our churn',
  'Walk me through why the three explanations conflict',
];

describe('advice gate — reasoning requests are never claimed', () => {
  it.each(REASONING_REQUESTS)('declines %j', (message) => {
    const result = gate(message);
    expect(result.matched).toBe(false);
    // Bound by IDENTITY (trap 19): it must decline for THIS reason, not
    // incidentally via `no_advice_signal` or `mutation_signal`. A different
    // reason would mean the guard never ran and some other rule happened to
    // agree today.
    expect(result.matched === false && result.reason).toBe('reasoning_request');
  });
});

// =========================================================================
// (a) OPPOSITE-DIRECTION TWINS — same openers, analysis referent present.
//     The gate MUST still claim these. Without this block the change above
//     is indistinguishable from simply deleting the `meaning` class.
// =========================================================================

const ANALYSIS_REQUESTS: readonly string[] = [
  'Help me understand these results',
  'Help me understand the analysis',
  'Help me interpret the numbers',
  'Help me make sense of the outcome',
  'Help me understand what these results mean',
  'Walk me through the results',
  'Walk me through the findings',
  'How should I read the analysis',
  // Leader-position vocabulary, lifted from the gate's own pattern at :584 —
  // a wh-word, no analysis NOUN, and still unambiguously about the analysis.
  'Help me understand why Rebuild onboarding is ahead',
  'Help me understand what is driving the ranking',
];

describe('advice gate — analysis questions are still claimed', () => {
  it.each(ANALYSIS_REQUESTS)('still claims %j', (message) => {
    const result = gate(message);
    expect(result.matched).toBe(true);
  });
});

// =========================================================================
// (b) KNOWN-NOT-CLAIMED — the ambiguous bare-demonstrative set, pinned
//     EXACTLY (trap 22f). These are deliberately left with the gate: on a
//     post-analysis turn "help me understand this" is dominantly about the
//     analysis, and declining would be a guess. If a later round decides to
//     move any of them, this block must be edited deliberately — it cannot
//     drift silently in either direction.
// =========================================================================

const AMBIGUOUS_LEFT_WITH_THE_GATE: readonly string[] = [
  'Help me understand this',
  'Help me interpret that',
  'How should I read this',
  'Walk me through this',
];

describe('advice gate — ambiguous bare demonstratives keep today’s behaviour', () => {
  it.each(AMBIGUOUS_LEFT_WITH_THE_GATE)('still claims %j', (message) => {
    expect(gate(message).matched).toBe(true);
  });

  it('the ambiguous set is exactly these four — grows or shrinks ⇒ RED', () => {
    expect(AMBIGUOUS_LEFT_WITH_THE_GATE).toHaveLength(4);
  });
});

// =========================================================================
// PRECEDENCE — the guard must not eat turns that belong to other routes.
// =========================================================================

describe('advice gate — reasoning-request guard precedence', () => {
  it('an explicit run request is untouched by the guard', () => {
    // The opposite direction that decides the change: removing an unrequested
    // run must never remove the requested one. "run the analysis" carries no
    // reasoning opener, so the guard cannot see it at all.
    const result = gate('run the analysis');
    expect(result.matched === false && result.reason).not.toBe('reasoning_request');
  });

  it('a concrete edit still takes mutation precedence over the guard', () => {
    // Mutation precedence is the gate's strongest existing rule; a new
    // decline class must not be able to outrank it and strand an edit.
    const result = gate('Help me understand what is causing this — set churn to 0.4');
    expect(result.matched).toBe(false);
    expect(result.matched === false && result.reason).toBe('mutation_signal');
  });

  it('no analysis in state still reports no_analysis, not reasoning_request', () => {
    // `no_analysis` is the more informative reason and must stay primary.
    const result = tryPostAnalysisAdviceGate({
      message: "Help me understand what's causing this",
      analysis: null,
      freshness: 'none',
    });
    expect(result.matched === false && result.reason).toBe('no_analysis');
  });
});
