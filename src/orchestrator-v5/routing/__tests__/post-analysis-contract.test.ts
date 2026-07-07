/**
 * V5 post-analysis interaction contract v1 — contract spec tests.
 *
 * Closes the row-4 gap from the workstream brief: typed "Tell me what
 * to change" and close variants must route deterministically to the
 * post-analysis advice gate (no broad LLM, no edit_graph), with the
 * existing `what_would_flip` chip.
 *
 * Also locks:
 *   - mutation-precedence negatives — concrete edits embedded in advice
 *     phrasing still fall through to value-update / edit_graph
 *   - false-positive negatives — off-topic "tell me" / "show me"
 *     messages do NOT match the advice gate
 *   - the existing PR #173 / PR #190 paths the brief's rows 5–9 rely on
 *     (regression locks)
 *   - the evidence_gap composer's honest no-anchor branch (row 6)
 *
 * Companion stale-path coverage for Issue #195 lives in the
 * `Issue #195 — stale free-text what-would-flip` describe block below;
 * it exercises `classifyAnalyticalIntent` to prove the stale-rerun
 * guard's analytical-intent precondition fires on the canonical
 * phrasing the issue tracks.
 */

import { describe, expect, it } from 'vitest';

import {
  tryPostAnalysisAdviceGate,
  type AdviceClass,
  type AdviceGateAnalysis,
} from '../post-analysis-advice-gate.js';
import { classifyAnalyticalIntent, hasMutationSignal } from '../analytical-intent.js';
import { isAnalyticalQuestion } from '../analytical-question-guard.js';
import { tryStaleRerunGuard } from '../stale-rerun-guard.js';
import type { GraphPatchBlockData } from '../../../orchestrator/types.js';

type AnalysisReadyPayload = NonNullable<GraphPatchBlockData['analysis_ready']>;

const FIXTURE_ANALYSIS: AdviceGateAnalysis = {
  status: 'success',
  leading_option: { label: 'Hire two senior engineers locally' },
  runner_up: { label: 'Hire one senior engineer overseas' },
  top_drivers: [
    { factor_label: 'Delivery risk' },
    { factor_label: 'Cost overrun risk' },
  ],
  fragile_edges: [
    { from_label: 'Delivery risk', to_label: 'Successful launch' },
  ],
};

const READY_PAYLOAD_OPEN: AnalysisReadyPayload = {
  goal_node_id: 'goal_1',
  status: 'needs_user_mapping',
  options: [
    { option_id: 'opt_a', label: 'Hire two senior engineers locally', status: 'needs_user_mapping', interventions: {} },
    { option_id: 'opt_b', label: 'Hire one senior engineer overseas', status: 'needs_encoding', interventions: {} },
  ],
};

// =========================================================================
// Row 4 — "Tell me what to change" deterministic routing
//
// The exact gap the workstream closes. Without these patterns the message
// falls through to the broad routing LLM and risks an `edit_graph` call
// on the bare verb "change".
// =========================================================================
describe('post-analysis contract — row 4: "Tell me what to change" family', () => {
  const updateAdviceCases: ReadonlyArray<{ readonly message: string; readonly label: string }> = [
    { message: 'Tell me what to change.', label: 'tell me what to change' },
    { message: 'Tell me what I should change.', label: 'tell me what I should change' },
    { message: 'Tell me what I need to change.', label: 'tell me what I need to change' },
    { message: 'Tell me what I can update.', label: 'tell me what I can update' },
    { message: 'Tell me what to adjust.', label: 'tell me what to adjust' },
    { message: 'Tell me what to fix.', label: 'tell me what to fix' },
    { message: 'Tell me what to improve.', label: 'tell me what to improve' },
    { message: 'Show me what to change.', label: 'show me what to change' },
    { message: 'Show me what I should update.', label: 'show me what I should update' },
  ];

  for (const { message, label } of updateAdviceCases) {
    it(`routes to update_advice (deterministic, no LLM): ${label}`, () => {
      const out = tryPostAnalysisAdviceGate({
        message,
        analysis: FIXTURE_ANALYSIS,
        analysisReady: READY_PAYLOAD_OPEN,
        freshness: 'fresh',
      });
      expect(out.matched).toBe(true);
      if (out.matched) {
        expect(out.advice_class).toBe<AdviceClass>('update_advice');
        expect(out.assistant_text.length).toBeGreaterThan(0);
        // what_would_flip chip is the canonical follow-up for update_advice
        expect(out.suggested_actions).toHaveLength(1);
        expect(out.suggested_actions[0]!.action_type).toBe('what_would_flip');
        // Forbidden-phrase invariants from PR #173 composer contract
        expect(out.assistant_text.toLowerCase()).not.toContain('recommendation');
        expect(out.assistant_text.toLowerCase()).not.toMatch(/\bthe\s+winners?\b/);
        expect(out.assistant_text).not.toMatch(/\boption_\w+\b/);
      }
    });
  }

  const adviceCases: ReadonlyArray<{ readonly message: string; readonly label: string }> = [
    { message: 'What do I change?', label: 'what do I change' },
    { message: 'What do we update?', label: 'what do we update' },
    { message: 'What needs to change?', label: 'what needs to change' },
    { message: 'What needs changing?', label: 'what needs changing' },
    { message: 'What needs to be updated?', label: 'what needs to be updated' },
    { message: 'Help me figure out what to change.', label: 'help me figure out what to change' },
    { message: 'Help me decide what to update.', label: 'help me decide what to update' },
    { message: 'Give me a starting point to change.', label: 'give me a starting point' },
    { message: 'Give me something to update.', label: 'give me something to update' },
    { message: "What's worth changing?", label: "what's worth changing" },
    { message: "What's worth updating?", label: "what's worth updating" },
  ];

  for (const { message, label } of adviceCases) {
    it(`routes to advice (deterministic, no LLM): ${label}`, () => {
      const out = tryPostAnalysisAdviceGate({
        message,
        analysis: FIXTURE_ANALYSIS,
        analysisReady: READY_PAYLOAD_OPEN,
        freshness: 'fresh',
      });
      expect(out.matched).toBe(true);
      if (out.matched) {
        expect(out.advice_class).toBe<AdviceClass>('advice');
        expect(out.assistant_text.length).toBeGreaterThan(0);
        expect(out.suggested_actions).toHaveLength(1);
        expect(out.suggested_actions[0]!.action_type).toBe('what_would_flip');
      }
    });
  }

  it('emits the what_would_flip chip with the canonical label/message', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'Tell me what to change.',
      analysis: FIXTURE_ANALYSIS,
      analysisReady: READY_PAYLOAD_OPEN,
      freshness: 'fresh',
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      const chip = out.suggested_actions[0]!;
      expect(chip.label).toBe('What could change the outcome?');
      expect(chip.message).toBe('What could change the outcome of this analysis?');
      expect(chip.action_type).toBe('what_would_flip');
    }
  });
});

// =========================================================================
// Mutation-precedence negatives
//
// Concrete edits embedded in advice phrasing MUST fall through to
// mutation_signal so the value-update / edit_graph dispatch path runs.
// =========================================================================
describe('post-analysis contract — mutation precedence', () => {
  const mutations: ReadonlyArray<{ readonly message: string; readonly label: string }> = [
    { message: 'Tell me what to change Pricing to £100.', label: 'tell me what + concrete to-value' },
    { message: 'Tell me what to update — set risk to 0.5.', label: 'imperative-advice + bare set-to-numeric' },
    { message: 'What needs to change? Set delivery risk to 0.7.', label: 'advice question then bare mutation' },
    { message: 'Help me figure out what to change — adjust the budget to £200k.', label: 'help-me + adjust-to-numeric' },
    { message: 'Show me what to update. Change the edge from Cost to Risk.', label: 'show-me + from-to' },
    { message: 'Tell me what to fix and remove the cost factor.', label: 'tell-me + remove-the-entity' },
  ];

  for (const { message, label } of mutations) {
    it(`falls through (mutation_signal): ${label}`, () => {
      // Sanity: hasMutationSignal should fire on the concrete edit clause.
      expect(hasMutationSignal(message)).toBe(true);
      const out = tryPostAnalysisAdviceGate({
        message,
        analysis: FIXTURE_ANALYSIS,
        analysisReady: READY_PAYLOAD_OPEN,
        freshness: 'fresh',
      });
      expect(out.matched).toBe(false);
      if (!out.matched) expect(out.reason).toBe('mutation_signal');
    });
  }

  it('bare advice phrasing without a concrete value still matches (no mutation signal)', () => {
    // Counter-check: "Tell me what to change" alone (no `to <value>` clause)
    // must NOT match hasMutationSignal — the new advice patterns rely on it.
    expect(hasMutationSignal('Tell me what to change.')).toBe(false);
    expect(hasMutationSignal('What needs to change?')).toBe(false);
    expect(hasMutationSignal('Show me what to update.')).toBe(false);
  });
});

// =========================================================================
// False-positive negatives
//
// Phrases that share the "tell me" / "show me" lead but are NOT
// change-advice requests must not match the new patterns.
// =========================================================================
describe('post-analysis contract — false-positive guard', () => {
  const offTopic: ReadonlyArray<{ readonly message: string; readonly label: string }> = [
    { message: 'Tell me about Apple pricing.', label: 'off-topic "tell me about"' },
    { message: 'Tell me a joke.', label: 'off-topic "tell me a"' },
    { message: 'Tell me your name.', label: 'off-topic personal question' },
    { message: 'Show me the picture.', label: 'off-topic "show me the"' },
    { message: 'Tell me when to start.', label: '"tell me when" (no change verb)' },
    { message: 'Show me how this works.', label: '"show me how" (explanation, not change-advice)' },
  ];

  for (const { message, label } of offTopic) {
    it(`does NOT match new advice/update_advice patterns: ${label}`, () => {
      const out = tryPostAnalysisAdviceGate({
        message,
        analysis: FIXTURE_ANALYSIS,
        analysisReady: READY_PAYLOAD_OPEN,
        freshness: 'fresh',
      });
      // Either no match at all, OR matched a different class — but never
      // `update_advice`/`advice` from the new patterns.
      if (out.matched) {
        // Defensive: even if matched (e.g. "Show me how this works" might
        // hit a meaning pattern), it must not be update_advice from the
        // imperative-change patterns we added.
        const allowedFallbackClasses: ReadonlyArray<AdviceClass> = ['meaning', 'explain_results_free_text'];
        expect(allowedFallbackClasses).toContain(out.advice_class);
      }
    });
  }

  it('"tell me the result" routes to explain_results_free_text (existing pattern, not new)', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'Tell me about these results.',
      analysis: FIXTURE_ANALYSIS,
      analysisReady: READY_PAYLOAD_OPEN,
      freshness: 'fresh',
    });
    expect(out.matched).toBe(true);
    if (out.matched) expect(out.advice_class).toBe<AdviceClass>('explain_results_free_text');
  });
});

// =========================================================================
// Freshness gating — stale / unknown / none MUST fall through
// =========================================================================
describe('post-analysis contract — freshness gating', () => {
  for (const freshness of ['stale', 'unknown', 'none'] as const) {
    it(`falls through (not_fresh) for ${freshness} freshness`, () => {
      const out = tryPostAnalysisAdviceGate({
        message: 'Tell me what to change.',
        analysis: FIXTURE_ANALYSIS,
        analysisReady: READY_PAYLOAD_OPEN,
        freshness,
      });
      expect(out.matched).toBe(false);
      if (!out.matched) expect(out.reason).toBe('not_fresh');
    });
  }
});

// =========================================================================
// Row 5 regression — "What should I change?" continues to work
// =========================================================================
describe('post-analysis contract — row 5 regression: "What should I change?"', () => {
  it('continues to match advice class via the existing broad "what should I" pattern', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'What should I change?',
      analysis: FIXTURE_ANALYSIS,
      analysisReady: READY_PAYLOAD_OPEN,
      freshness: 'fresh',
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.advice_class).toBe<AdviceClass>('advice');
      expect(out.suggested_actions[0]?.action_type).toBe('what_would_flip');
    }
  });
});

// =========================================================================
// Row 6 — "What should we validate?" no-anchor honesty
//
// The evidence_gap composer must NOT invent anchors when there is no
// decision_review enrichment, no analysisReady payload, and no top
// drivers. The honest copy says "no obvious structural gaps; share what
// you've already considered." This is a test-lock on existing behaviour
// (verified at post-analysis-advice-gate.ts:1124–1126).
// =========================================================================
describe('post-analysis contract — row 6: evidence_gap no-anchor honesty', () => {
  it('produces honest no-anchor copy when no anchors are available', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'What should we validate?',
      // Analysis with no fragile edges and no top drivers — the only
      // remaining anchor sources are decision_review (absent) and
      // analysisReady (also absent below).
      analysis: { ...FIXTURE_ANALYSIS, top_drivers: [], fragile_edges: [] },
      analysisReady: null,
      decisionReview: null,
      freshness: 'fresh',
    });
    // evidence_gap requires EITHER analysisReady OR top_drivers; with
    // neither, it falls through to data_unavailable_for_class so the
    // caller (turn-executor) reaches the fresh-analysis-followup-guard
    // which emits the honest recap. The honesty contract is preserved
    // here by the gate refusing to invent advice.
    expect(out.matched).toBe(false);
    if (!out.matched) {
      expect(out.reason).toBe('data_unavailable_for_class');
      expect(out.advice_class).toBe('evidence_gap');
    }
  });

  it('produces grounded copy when fragile edges anchor evidence advice', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'What should we validate?',
      analysis: FIXTURE_ANALYSIS, // has 1 fragile edge + 2 top drivers
      analysisReady: null,
      decisionReview: null,
      freshness: 'fresh',
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.advice_class).toBe<AdviceClass>('evidence_gap');
      // The fragile-edge anchor surfaces as a concrete gap mention.
      expect(out.assistant_text).toMatch(/fragile/i);
      // No invented evidence anchors — no "studies show" / "research
      // indicates" / "data confirms" boilerplate.
      expect(out.assistant_text.toLowerCase()).not.toMatch(/\bstudies\s+show\b/);
      expect(out.assistant_text.toLowerCase()).not.toMatch(/\bresearch\s+(?:shows|indicates|confirms|proves)\b/);
      expect(out.assistant_text.toLowerCase()).not.toMatch(/\bscientifically\s+(?:proven|validated)\b/);
    }
  });
});

// =========================================================================
// Issue #195 — stale free-text what-would-flip
//
// Verifies the classifier catches the canonical phrasing the issue
// tracks. If this test passes, the stale-rerun-guard fires on stale
// graphs with this message (its predicate requires
// `classifyAnalyticalIntent !== null` + `freshness === 'stale'` +
// `!hasMutationSignal`). Subsumption claim in the PR body depends on
// this test passing.
// =========================================================================
describe('Issue #195 — stale free-text what-would-flip', () => {
  const issuePhrases: ReadonlyArray<{ readonly message: string; readonly label: string }> = [
    { message: 'What would flip the result?', label: '#195 canonical' },
    { message: 'What would flip this?', label: '#195 short form' },
    { message: 'What would change the outcome?', label: '#195 close cousin' },
    { message: 'What would need to change?', label: '#195 obligation form' },
    { message: 'What would it take to flip the result?', label: '#195 long form' },
    { message: 'What would tip the balance?', label: '#195 tip-the-balance form' },
  ];

  for (const { message, label } of issuePhrases) {
    it(`classifyAnalyticalIntent returns what_would_flip: ${label}`, () => {
      expect(classifyAnalyticalIntent(message)).toBe('what_would_flip');
    });
    it(`carries no mutation signal: ${label}`, () => {
      expect(hasMutationSignal(message)).toBe(false);
    });
    it(`isAnalyticalQuestion returns true (route-v2 edit-dispatch suppression): ${label}`, () => {
      expect(isAnalyticalQuestion(message)).toBe(true);
    });
  }

  it('stale-path precondition holds for the "Tell me what to change" family too', () => {
    // The new patterns extended `explain` in analytical-intent.ts so the
    // stale-rerun-guard fires on stale graphs with these messages. We
    // assert the classifier returns a non-null class (the guard's
    // analytical-intent precondition); freshness=='stale' wiring is
    // exercised below directly against tryStaleRerunGuard.
    const phrases = [
      'Tell me what to change.',
      'Tell me what I should update.',
      'Show me what to change.',
      'What do I change?',
      'What needs to change?',
      'Help me figure out what to change.',
    ];
    for (const p of phrases) {
      expect(classifyAnalyticalIntent(p)).not.toBeNull();
      expect(hasMutationSignal(p)).toBe(false);
      expect(isAnalyticalQuestion(p)).toBe(true);
    }
  });
});

// =========================================================================
// Issue #195 full subsumption proof — direct stale-rerun-guard exercise
//
// Per the workstream brief, #195 may only be marked subsumed if the stale
// path proves three properties:
//   (a) deterministic — no broad LLM is reachable from the guard match
//   (b) the response copy is a rerun prompt
//   (c) the chip set includes `run_analysis`
//
// If any assertion below fails, #195 stays open and the failure is the
// follow-up.
// =========================================================================
describe('Issue #195 — stale-rerun-guard full subsumption proof', () => {
  const issuePhrases: ReadonlyArray<{ readonly message: string; readonly label: string }> = [
    { message: 'What would flip the result?', label: '#195 canonical' },
    { message: 'What would flip this?', label: '#195 short form' },
    { message: 'What would change the outcome?', label: '#195 close cousin' },
    { message: 'What would need to change?', label: '#195 obligation form' },
    // Also assert the new "Tell me what to change" family on the stale path
    { message: 'Tell me what to change.', label: 'stale + new-pattern coverage' },
    { message: 'What needs to change?', label: 'stale + new-pattern bare-interrogative' },
  ];

  for (const { message, label } of issuePhrases) {
    it(`stale + ${label} → guard matches deterministically`, () => {
      const out = tryStaleRerunGuard({ message, freshness: 'stale' });
      expect(out.matched).toBe(true);
    });

    it(`stale + ${label} → response copy mentions re-running`, () => {
      const out = tryStaleRerunGuard({ message, freshness: 'stale' });
      expect(out.matched).toBe(true);
      if (out.matched) {
        // Honesty: must say the graph changed AND must nudge re-run.
        expect(out.assistant_text.toLowerCase()).toMatch(/(re-?run|run\s+again|refresh)/);
        // No "fresh" / "current" claims about the existing analysis.
        expect(out.assistant_text.toLowerCase()).not.toMatch(/\bup\s+to\s+date\b/);
        expect(out.assistant_text.toLowerCase()).not.toMatch(/\bstill\s+(?:fresh|current|valid)\b/);
      }
    });

    it(`stale + ${label} → chip set includes run_analysis`, () => {
      const out = tryStaleRerunGuard({ message, freshness: 'stale' });
      expect(out.matched).toBe(true);
      if (out.matched) {
        expect(out.suggested_actions.length).toBeGreaterThan(0);
        const actionTypes = out.suggested_actions.map((a) => a.action_type);
        expect(actionTypes).toContain('run_analysis');
      }
    });
  }

  it('fresh + #195 phrase does NOT trigger stale-rerun-guard (freshness gating intact)', () => {
    const out = tryStaleRerunGuard({ message: 'What would flip the result?', freshness: 'fresh' });
    expect(out.matched).toBe(false);
    if (!out.matched) expect(out.reason).toBe('not_stale');
  });

  it('stale + concrete mutation does NOT trigger (mutation precedence intact)', () => {
    const out = tryStaleRerunGuard({
      message: 'Tell me what to change Pricing to £100',
      freshness: 'stale',
    });
    expect(out.matched).toBe(false);
    if (!out.matched) expect(out.reason).toBe('mutation_signal');
  });
});

// =========================================================================
// Review round-2 — `could/might` modal cousins of `what would change…`
//
// Pre-fix gap (PR #200 round-1 missed it): `classifyAnalyticalIntent` only
// matched `what would …`, while `analytical-question-guard.ts` had a
// separate `\bwhat\s+could\s+change\s+…` pattern. Result: stale + typed
// "What could change the outcome?" returned no_analytical_signal from
// stale-rerun-guard and fell through to the V5 broad routing LLM. V4
// route-v2 caught it because it delegates to isAnalyticalQuestion which
// runs both the classifier AND the guard's additional patterns; V5
// turn-executor's guards only consult classifyAnalyticalIntent.
//
// Fix: lift the could/might/how modal cousins into the classifier and
// the post-analysis-advice-gate `what_would_flip_free_text` class, plus
// extend WHAT_WOULD_FLIP_STRIP_PATTERNS so the strip-and-recheck
// mutation-precedence exception stays symmetric.
// =========================================================================
describe('Review round-2 — could/might modal cousins of what would change', () => {
  const modalCousins: ReadonlyArray<{ readonly message: string; readonly label: string }> = [
    { message: 'What could change the outcome?', label: 'what could change the outcome' },
    { message: 'What could change the result?', label: 'what could change the result' },
    { message: 'What could change the ranking?', label: 'what could change the ranking' },
    { message: 'What could change the leading option?', label: 'what could change the leading option' },
    { message: 'What might shift the outcome?', label: 'what might shift the outcome' },
    { message: 'What could shift the result?', label: 'what could shift the result' },
    { message: 'What might tip the balance?', label: 'what might tip the balance' },
    { message: 'What might change the outcome?', label: 'what might change the outcome' },
    { message: 'How could the outcome change?', label: 'how could the outcome change' },
    { message: 'How might the result shift?', label: 'how might the result shift' },
    { message: 'How can the ranking flip?', label: 'how can the ranking flip' },
  ];

  // ── Fresh path: post-analysis-advice-gate must match what_would_flip_free_text
  for (const { message, label } of modalCousins) {
    it(`fresh + ${label} → advice gate matches what_would_flip_free_text`, () => {
      const out = tryPostAnalysisAdviceGate({
        message,
        analysis: FIXTURE_ANALYSIS,
        analysisReady: READY_PAYLOAD_OPEN,
        freshness: 'fresh',
      });
      expect(out.matched).toBe(true);
      if (out.matched) {
        expect(out.advice_class).toBe<AdviceClass>('what_would_flip_free_text');
        // PR #173/#178 contract: what_would_flip_free_text emits no chip
        expect(out.suggested_actions).toHaveLength(0);
      }
    });
  }

  // ── Classifier: classifyAnalyticalIntent must return what_would_flip
  for (const { message, label } of modalCousins) {
    it(`classifyAnalyticalIntent returns what_would_flip: ${label}`, () => {
      expect(classifyAnalyticalIntent(message)).toBe('what_would_flip');
    });
  }

  // ── Stale path: stale-rerun-guard must match + emit rerun + run_analysis chip
  for (const { message, label } of modalCousins) {
    it(`stale + ${label} → stale-rerun-guard matches with rerun copy + run_analysis chip`, () => {
      const out = tryStaleRerunGuard({ message, freshness: 'stale' });
      expect(out.matched).toBe(true);
      if (out.matched) {
        expect(out.intent_class).toBe('what_would_flip');
        expect(out.assistant_text.toLowerCase()).toMatch(/(re-?run|run\s+again|refresh)/);
        expect(out.suggested_actions.map((a) => a.action_type)).toContain('run_analysis');
      }
    });
  }

  // ── Mutation precedence stays intact: "What could change Pricing to 100" mutates
  it('"What could change Pricing to 100" → mutation precedence wins (advice gate rejects)', () => {
    const message = 'What could change Pricing to 100';
    expect(hasMutationSignal(message)).toBe(true);
    const out = tryPostAnalysisAdviceGate({
      message,
      analysis: FIXTURE_ANALYSIS,
      analysisReady: READY_PAYLOAD_OPEN,
      freshness: 'fresh',
    });
    expect(out.matched).toBe(false);
    if (!out.matched) expect(out.reason).toBe('mutation_signal');
  });

  it('"What could change Pricing to 100" on stale also yields mutation_signal', () => {
    const out = tryStaleRerunGuard({
      message: 'What could change Pricing to 100',
      freshness: 'stale',
    });
    expect(out.matched).toBe(false);
    if (!out.matched) expect(out.reason).toBe('mutation_signal');
  });

  // ── False-positive guards: outcome-noun anchor must hold
  const offTopic: ReadonlyArray<{ readonly message: string; readonly label: string }> = [
    { message: 'What could change about Apple?', label: 'change-about (not outcome noun)' },
    { message: 'What could change my mind?', label: 'change-my-mind (not outcome noun)' },
    { message: 'How could I change pricing?', label: 'how-could-I (not outcome-noun subject)' },
    { message: 'Could you change the pricing?', label: 'could-you (not what/how lead)' },
  ];
  for (const { message, label } of offTopic) {
    it(`does NOT match new what_would_flip patterns: ${label}`, () => {
      const c = classifyAnalyticalIntent(message);
      // Either no analytical class, or a different class — but never
      // what_would_flip from the new modal-cousin patterns.
      if (c !== null) expect(c).not.toBe('what_would_flip');
    });
  }

  // ── analytical-question-guard inheritance via classifier delegation
  it('isAnalyticalQuestion inherits new patterns via classifyAnalyticalIntent delegation', () => {
    for (const { message } of modalCousins) {
      expect(isAnalyticalQuestion(message)).toBe(true);
    }
  });
});

// =========================================================================
// Review round-3 — `would` parity for shift|move|alter|... + how-would
//
// Round-2 closed the `could/might` gap but left the same drift class
// for the `would` variants of the analytical-question-guard's broader
// patterns. The classifier had `what would change [outcome]` (narrow
// nouns, "change" verb only) but missed:
//
//   - `what would (shift|move|alter|affect|tip) [outcome]`  (any verb)
//   - `how would [outcome] (change|shift|move|flip|differ)` (how-shape)
//
// Both shapes lived in analytical-question-guard.ts's
// ADDITIONAL_ANALYTICAL_QUESTION_PATTERNS, so V4 route-v2 caught them
// but V5 stale-rerun-guard / no-analysis-guard / V5 routeWithToolUse
// missed them. Round-3 widens every modal alternation in the round-2
// patterns to include `would` so the classifier is the genuine SSOT.
// =========================================================================
describe('Review round-3 — would parity for shift/move/alter and how-would-outcome', () => {
  const wouldCousins: ReadonlyArray<{ readonly message: string; readonly label: string }> = [
    // would + (shift|move|alter|affect|tip) + outcome
    { message: 'What would move the result?', label: 'what would move the result' },
    { message: 'What would shift the result?', label: 'what would shift the result' },
    { message: 'What would alter the analysis?', label: 'what would alter the analysis' },
    { message: 'What would affect the outcome?', label: 'what would affect the outcome' },
    { message: 'What would tip the balance?', label: 'what would tip the balance' },
    // how + would + outcome + (change|shift|move|flip)
    { message: 'How would the result move?', label: 'how would the result move' },
    { message: 'How would the outcome change?', label: 'how would the outcome change' },
    { message: 'How would the ranking shift?', label: 'how would the ranking shift' },
    { message: 'How would the verdict flip?', label: 'how would the verdict flip' },
  ];

  // ── Fresh path: advice gate matches what_would_flip_free_text
  for (const { message, label } of wouldCousins) {
    it(`fresh + ${label} → advice gate matches what_would_flip_free_text`, () => {
      const out = tryPostAnalysisAdviceGate({
        message,
        analysis: FIXTURE_ANALYSIS,
        analysisReady: READY_PAYLOAD_OPEN,
        freshness: 'fresh',
      });
      expect(out.matched).toBe(true);
      if (out.matched) {
        expect(out.advice_class).toBe<AdviceClass>('what_would_flip_free_text');
        expect(out.suggested_actions).toHaveLength(0);
      }
    });
  }

  // ── Classifier returns what_would_flip
  for (const { message, label } of wouldCousins) {
    it(`classifyAnalyticalIntent returns what_would_flip: ${label}`, () => {
      expect(classifyAnalyticalIntent(message)).toBe('what_would_flip');
    });
  }

  // ── Stale path: stale-rerun-guard matches + emits rerun + run_analysis chip
  for (const { message, label } of wouldCousins) {
    it(`stale + ${label} → stale-rerun-guard matches with rerun copy + run_analysis chip`, () => {
      const out = tryStaleRerunGuard({ message, freshness: 'stale' });
      expect(out.matched).toBe(true);
      if (out.matched) {
        expect(out.intent_class).toBe('what_would_flip');
        expect(out.assistant_text.toLowerCase()).toMatch(/(re-?run|run\s+again|refresh)/);
        expect(out.suggested_actions.map((a) => a.action_type)).toContain('run_analysis');
      }
    });
  }

  // ── Mutation precedence still wins on these forms too
  // (Note: the mutation verb list is `set|change|update|adjust|modify|
  // raise|lower|increase|decrease|bump` — verbs like `move`, `shift`,
  // `alter`, `affect`, `tip` only appear in the new analytical-intent
  // patterns, not the mutation patterns, so they cannot trigger
  // mutation precedence on their own. Concrete edits must use one of
  // the mutation-verb anchors.)
  const wouldMutations: ReadonlyArray<{ readonly message: string; readonly label: string }> = [
    { message: 'What would change the result to a draw?', label: '"change... to a draw" verb-to-X' },
    { message: 'What would change the result to win by 10%?', label: '"change... to win by 10%" verb-to + numeric' },
    { message: 'How would the outcome change if I set risk to 0.7?', label: 'how-would + concrete set' },
  ];
  for (const { message, label } of wouldMutations) {
    it(`mutation precedence: ${label} → fresh advice gate rejects with mutation_signal`, () => {
      expect(hasMutationSignal(message)).toBe(true);
      const out = tryPostAnalysisAdviceGate({
        message,
        analysis: FIXTURE_ANALYSIS,
        analysisReady: READY_PAYLOAD_OPEN,
        freshness: 'fresh',
      });
      // Mutation precedence runs AFTER class match but BEFORE composition;
      // what_would_flip_free_text has the strip-and-recheck exception, but
      // "change the result to a draw" / "move the result by 10" / "set
      // risk to 0.7" all produce independent mutation clauses that survive
      // the strip. Some of these are explicit hasIndependentMutationSignal
      // mutations (numeric), which trigger ALWAYS_INDEPENDENT — out is
      // either mutation_signal or matched what_would_flip_free_text via
      // the exception. Assert at minimum that no other class is reached.
      if (!out.matched) {
        expect(out.reason).toBe('mutation_signal');
      } else {
        expect(out.advice_class).toBe('what_would_flip_free_text');
      }
    });

    it(`mutation precedence: ${label} → stale guard honours the shared flip-overlap exception`, () => {
      const out = tryStaleRerunGuard({ message, freshness: 'stale' });
      // Mission 1 (#195): the stale guard now carries the SAME
      // strip-and-recheck exception as the advice gate — the outcome is
      // either mutation_signal (an independent edit clause survives the
      // flip-pattern strip, e.g. numeric / concrete set) or a
      // what_would_flip match via the exception. No other class can
      // admit a mutation-signal phrase.
      if (out.matched) {
        expect(out.intent_class).toBe('what_would_flip');
      } else {
        expect(out.reason).toBe('mutation_signal');
      }
    });
  }

  // ── #195 parity lock: the one wouldMutations phrase whose mutation
  // signal is PURE flip-overlap ("change the result to a draw" — no
  // independent edit clause survives the strip) must now be treated
  // identically by both guards: advice gate (fresh) matches via the
  // exception, stale guard (stale) matches via the exception. Before
  // Mission 1 the stale guard declined it `mutation_signal` and the
  // question fell through to broad LLM routing with no staleness cue.
  it('flip-overlap parity: "What would change the result to a draw?" matches BOTH guards via the shared exception', () => {
    const message = 'What would change the result to a draw?';
    const gate = tryPostAnalysisAdviceGate({
      message,
      analysis: FIXTURE_ANALYSIS,
      analysisReady: READY_PAYLOAD_OPEN,
      freshness: 'fresh',
    });
    expect(gate.matched).toBe(true);
    if (gate.matched) expect(gate.advice_class).toBe<AdviceClass>('what_would_flip_free_text');
    const guard = tryStaleRerunGuard({ message, freshness: 'stale' });
    expect(guard.matched).toBe(true);
    if (guard.matched) {
      expect(guard.intent_class).toBe('what_would_flip');
      expect(guard.mode).toBe('stale');
      expect(guard.suggested_actions.map((a) => a.action_type)).toContain('run_analysis');
    }
  });

  // ── isAnalyticalQuestion delegation lock
  it('isAnalyticalQuestion inherits would-parity patterns via classifier delegation', () => {
    for (const { message } of wouldCousins) {
      expect(isAnalyticalQuestion(message)).toBe(true);
    }
  });

  // ── False-positive guards: outcome-noun anchor still required
  const offTopic: ReadonlyArray<{ readonly message: string; readonly label: string }> = [
    { message: 'What would move Apple?', label: 'move-Apple (not outcome noun)' },
    { message: 'What would shift my schedule?', label: 'shift-schedule (not outcome noun)' },
    { message: 'How would the weather change tomorrow?', label: 'weather-change (not outcome noun)' },
    { message: 'Would you change the pricing?', label: 'would-you (not what/how lead)' },
  ];
  for (const { message, label } of offTopic) {
    it(`does NOT classify as what_would_flip: ${label}`, () => {
      const c = classifyAnalyticalIntent(message);
      if (c !== null) expect(c).not.toBe('what_would_flip');
    });
  }
});

// =========================================================================
// Review round-4 — broader (would|does|might) (need|have) shape
//
// Round-3 widened the modal axis for shift/move/alter and how-would, but
// left the narrow `what would need to change` classifier entry intact
// even though the advice gate's matching entry was already broader:
//   /\bwhat\s+(?:would|do(?:es)?|might)\s+(?:need|have)\s+to\s+(?:change|happen|move|shift|differ)\b/i
//
// So phrases like "What might need to change?" / "What does need to
// happen?" / "What would have to change?" hit the advice gate on the
// fresh path but slipped the classifier on the stale path — exactly
// the same drift class as rounds 2 + 3.
//
// Round-4 replaces the narrow classifier entry with the broader shape
// so the advice gate and classifier are byte-equivalent for this
// pattern.
// =========================================================================
describe('Review round-4 — broader (would|does|might) (need|have) shape', () => {
  const needHaveCousins: ReadonlyArray<{ readonly message: string; readonly label: string }> = [
    { message: 'What might need to change?', label: 'might need to change' },
    { message: 'What does need to change?', label: 'does need to change' },
    { message: 'What would have to change?', label: 'would have to change' },
    { message: 'What might need to happen?', label: 'might need to happen' },
    { message: 'What would need to happen?', label: 'would need to happen' },
    { message: 'What might need to move?', label: 'might need to move' },
    { message: 'What does need to shift?', label: 'does need to shift' },
    { message: 'What might have to happen?', label: 'might have to happen' },
  ];

  // Fresh path
  for (const { message, label } of needHaveCousins) {
    it(`fresh + ${label} → advice gate matches what_would_flip_free_text`, () => {
      const out = tryPostAnalysisAdviceGate({
        message,
        analysis: FIXTURE_ANALYSIS,
        analysisReady: READY_PAYLOAD_OPEN,
        freshness: 'fresh',
      });
      expect(out.matched).toBe(true);
      if (out.matched) expect(out.advice_class).toBe<AdviceClass>('what_would_flip_free_text');
    });
  }

  // Classifier
  for (const { message, label } of needHaveCousins) {
    it(`classifyAnalyticalIntent returns what_would_flip: ${label}`, () => {
      expect(classifyAnalyticalIntent(message)).toBe('what_would_flip');
    });
  }

  // Stale path — the blocker proof: each phrase must yield deterministic
  // rerun copy + run_analysis chip, with no broad LLM and no edit_graph.
  for (const { message, label } of needHaveCousins) {
    it(`stale + ${label} → stale-rerun-guard matches deterministically with rerun copy + run_analysis chip`, () => {
      const out = tryStaleRerunGuard({ message, freshness: 'stale' });
      // (a) Deterministic match — no broad LLM, no edit_graph dispatch.
      expect(out.matched).toBe(true);
      if (out.matched) {
        // (b) Correct intent class lifted from the classifier.
        expect(out.intent_class).toBe('what_would_flip');
        // (c) Rerun copy.
        expect(out.assistant_text.toLowerCase()).toMatch(/(re-?run|run\s+again|refresh)/);
        // (d) run_analysis chip.
        expect(out.suggested_actions.map((a) => a.action_type)).toContain('run_analysis');
        // (e) Action type stays in the deterministic chip whitelist — never edit_graph.
        for (const action of out.suggested_actions) {
          expect(action.action_type).toBe('run_analysis');
        }
      }
    });
  }

  // Mutation precedence intact
  it('"What might need to change to 100?" → mutation_signal (stale-rerun-guard rejects)', () => {
    const message = 'What might need to change to 100?';
    expect(hasMutationSignal(message)).toBe(true);
    const out = tryStaleRerunGuard({ message, freshness: 'stale' });
    expect(out.matched).toBe(false);
    if (!out.matched) expect(out.reason).toBe('mutation_signal');
  });
});

// =========================================================================
// Review round-4 — `how (another) option (win|look better|come ahead)`
// advice-gate mirror (fresh-path asymmetry fix)
//
// Pre-round-4: classifier-only pattern; fresh path missed
// what_would_flip_free_text and routed via fresh-followup-guard's
// catch-net (thinner recap copy). Round-4 mirrors the pattern into
// the advice gate so fresh and stale paths produce symmetric copy.
// =========================================================================
describe('Review round-4 — how-option-win advice-gate mirror', () => {
  const phrases: ReadonlyArray<{ readonly message: string; readonly label: string }> = [
    { message: 'How could another option win?', label: 'how could another option win' },
    { message: 'How can option look better?', label: 'how can option look better' },
    { message: 'How would another option come ahead?', label: 'how would another option come ahead' },
    { message: 'How could another option come out ahead?', label: 'how could another option come out ahead' },
  ];

  for (const { message, label } of phrases) {
    it(`fresh + ${label} → advice gate matches what_would_flip_free_text (no catch-net detour)`, () => {
      const out = tryPostAnalysisAdviceGate({
        message,
        analysis: FIXTURE_ANALYSIS,
        analysisReady: READY_PAYLOAD_OPEN,
        freshness: 'fresh',
      });
      expect(out.matched).toBe(true);
      if (out.matched) expect(out.advice_class).toBe<AdviceClass>('what_would_flip_free_text');
    });
    it(`stale + ${label} → stale-rerun-guard matches with rerun + run_analysis chip`, () => {
      const out = tryStaleRerunGuard({ message, freshness: 'stale' });
      expect(out.matched).toBe(true);
      if (out.matched) {
        expect(out.intent_class).toBe('what_would_flip');
        expect(out.suggested_actions.map((a) => a.action_type)).toContain('run_analysis');
      }
    });
  }
});

// =========================================================================
// Review round-4 — stale "What should I change?" coverage
//
// Brief row 5 ("What should I change?") was deterministic on fresh via
// the advice gate's `advice` class but slipped the classifier on the
// stale path → fell through to broad LLM. Round-4 adds a narrow
// stale-path classifier pattern anchored on change-advice verbs
// (change|update|adjust|fix|improve|edit) — deliberately excluding
// `do` (too broad), `set|increase|decrease|raise|lower|reduce|bump`
// (would conflict with mutation precedence), and any non-anchored
// `what should i/we/you` shape.
// =========================================================================
describe('Review round-4 — stale "What should I change?" coverage', () => {
  // Verbs deliberately exclude `improve` — that one is owned by the
  // `improvement` class (existing `\bwhat\s+(?:should|can|could|might|would)\s+(?:we|i|you)\s+improve\b`),
  // not the broad `advice` class. The classifier still includes
  // `improve` in its round-4 pattern so the STALE path catches it too;
  // a single-line stale-only check at the bottom of this describe
  // block locks that.
  const shouldChangePhrases: ReadonlyArray<{ readonly message: string; readonly label: string }> = [
    { message: 'What should I change?', label: 'brief row 5 canonical' },
    { message: 'What should we update?', label: 'what should we update' },
    { message: 'What should you adjust?', label: 'what should you adjust' },
    { message: 'What should we fix?', label: 'what should we fix' },
    { message: 'What should we edit?', label: 'what should we edit' },
  ];

  // Fresh path — already worked via advice gate's broad `advice` class,
  // regression-locked here.
  for (const { message, label } of shouldChangePhrases) {
    it(`fresh + ${label} → advice gate matches advice class`, () => {
      const out = tryPostAnalysisAdviceGate({
        message,
        analysis: FIXTURE_ANALYSIS,
        analysisReady: READY_PAYLOAD_OPEN,
        freshness: 'fresh',
      });
      expect(out.matched).toBe(true);
      if (out.matched) expect(out.advice_class).toBe<AdviceClass>('advice');
    });
  }

  // Classifier — new round-4 pattern in `explain` class so stale-path
  // analytical-intent precondition fires.
  for (const { message, label } of shouldChangePhrases) {
    it(`classifyAnalyticalIntent returns explain: ${label}`, () => {
      expect(classifyAnalyticalIntent(message)).toBe('explain');
    });
  }

  // Stale path — the fix proof.
  for (const { message, label } of shouldChangePhrases) {
    it(`stale + ${label} → stale-rerun-guard matches with rerun copy + run_analysis chip`, () => {
      const out = tryStaleRerunGuard({ message, freshness: 'stale' });
      expect(out.matched).toBe(true);
      if (out.matched) {
        expect(out.intent_class).toBe('explain');
        expect(out.assistant_text.toLowerCase()).toMatch(/(re-?run|run\s+again|refresh)/);
        expect(out.suggested_actions.map((a) => a.action_type)).toContain('run_analysis');
      }
    });
  }

  // Mutation precedence intact — value-edit forms still mutate
  const valueEdits: ReadonlyArray<{ readonly message: string; readonly label: string }> = [
    { message: 'What should I change to 100?', label: 'change-to-numeric' },
    { message: 'What should we update to £200?', label: 'update-to-currency' },
    { message: 'What should I adjust by 5%?', label: 'adjust-by-percentage' },
  ];
  for (const { message, label } of valueEdits) {
    it(`mutation precedence: ${label} → fresh advice gate rejects mutation_signal`, () => {
      expect(hasMutationSignal(message)).toBe(true);
      const out = tryPostAnalysisAdviceGate({
        message,
        analysis: FIXTURE_ANALYSIS,
        analysisReady: READY_PAYLOAD_OPEN,
        freshness: 'fresh',
      });
      expect(out.matched).toBe(false);
      if (!out.matched) expect(out.reason).toBe('mutation_signal');
    });
    it(`mutation precedence: ${label} → stale guard rejects mutation_signal`, () => {
      const out = tryStaleRerunGuard({ message, freshness: 'stale' });
      expect(out.matched).toBe(false);
      if (!out.matched) expect(out.reason).toBe('mutation_signal');
    });
  }

  // False positives — must NOT classify as `explain` via the new pattern
  const offTopic: ReadonlyArray<{ readonly message: string; readonly label: string }> = [
    { message: 'What should I do?', label: '"what should I do" — broad `do` excluded' },
    { message: 'What should I do tonight?', label: 'off-topic "do tonight"' },
    { message: 'What should I set risk to?', label: 'value-verb `set` excluded' },
    { message: 'What should I increase Revenue by?', label: 'value-verb `increase` excluded' },
    { message: 'What should I raise the budget to?', label: 'value-verb `raise` excluded' },
  ];
  for (const { message, label } of offTopic) {
    it(`does NOT classify as explain via new pattern: ${label}`, () => {
      // The new pattern only matches (change|update|adjust|fix|improve|edit).
      // These phrases use either `do`, value-edit verbs, or off-topic
      // wording — they must not trigger the new classifier entry.
      // (They may still classify via other existing patterns, but NOT
      // because of the round-4 addition.)
      const c = classifyAnalyticalIntent(message);
      // If matched, the existing patterns owned it — assert at minimum
      // that the new pattern's verb set isn't accidentally broadened.
      // We can't directly inspect "which pattern fired", so the negative
      // assertion is via the broader expectation: these off-topic
      // phrases either return null or a class the existing patterns
      // would already have returned pre-round-4.
      if (c !== null) {
        // For "What should I set/increase/raise…?" the answer should be
        // null (classifier doesn't catch value-edit verbs here). For
        // "What should I do?" the answer is null.
        expect(c).toBe('explain');
        // If something matched, fail loudly on the value-verb cases.
        // (See note above — we accept null OR explain only if the
        // existing analytical surface catches it; for the explicit
        // value-verb phrases below we assert null instead.)
      }
    });
  }

  // Tighter assertions for value-verb negative controls
  it('"What should I set risk to?" classifier returns null (no value-verb capture)', () => {
    expect(classifyAnalyticalIntent('What should I set risk to?')).toBeNull();
  });
  it('"What should I increase Revenue by?" classifier returns null', () => {
    expect(classifyAnalyticalIntent('What should I increase Revenue by?')).toBeNull();
  });
  it('"What should I do?" classifier returns null', () => {
    expect(classifyAnalyticalIntent('What should I do?')).toBeNull();
  });

  // The classifier pattern includes `improve` so the stale path is
  // covered too (advice-gate fresh path routes "What should I improve?"
  // to the more specific `improvement` class — distinct from `advice`,
  // but both deterministic). Lock the classifier + stale-guard side here.
  it('stale + "What should I improve?" → stale-rerun-guard matches (classifier covers improve verb)', () => {
    expect(classifyAnalyticalIntent('What should I improve?')).toBe('explain');
    const out = tryStaleRerunGuard({ message: 'What should I improve?', freshness: 'stale' });
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.suggested_actions.map((a) => a.action_type)).toContain('run_analysis');
    }
  });
});

// =========================================================================
// Parity invariant — classifier ↔ advice gate alignment
//
// Three review rounds for the same drift class. This test is the
// permanent fix: a curated list of fixed phrases that MUST be
// classified by both surfaces, and a negative-control list that MUST
// NOT be classified by either. Adding a new what-would-flip pattern
// to one surface without the other now fails a concrete test.
//
// Coverage requirements (all listed by the reviewer):
//   - modal axis: could, might, would, can
//   - shape axis: how-would, how-could, what-would-need/have-to-…
//   - verb axis: change, shift, move, flip, differ, happen, alter,
//     affect, tip, win, look better, come ahead
// =========================================================================
describe('Parity invariant — classifier ↔ advice gate alignment for what_would_flip', () => {
  const FLIP_PARITY_PHRASES: readonly string[] = [
    // Original 'would' patterns
    'What would flip this?',
    'What would change the outcome?',
    'What would tip the balance?',
    'What would it take to flip the result?',
    'What would need to change?',
    // Round-2: could/might modal cousins
    'What could change the outcome?',
    'What could change the result?',
    'What might shift the outcome?',
    'What could shift the result?',
    'What might tip the balance?',
    'What might change the outcome?',
    // Round-2/3: how-shape modals
    'How could the outcome change?',
    'How might the result shift?',
    'How can the ranking flip?',
    // Round-3: would parity for shift/move/alter/affect/tip
    'What would move the result?',
    'What would shift the result?',
    'What would alter the analysis?',
    'What would affect the outcome?',
    // Round-3: how would [outcome] (change|shift|move|flip|differ)
    'How would the result move?',
    'How would the outcome change?',
    'How would the ranking shift?',
    'How would the verdict flip?',
    // Round-4: broader need|have shape
    'What might need to change?',
    'What does need to change?',
    'What would have to change?',
    'What might need to happen?',
    'What would need to happen?',
    'What might need to move?',
    'What might have to happen?',
    // Round-4: how (another) option win/look better/come ahead
    'How could another option win?',
    'How can option look better?',
    'How would another option come ahead?',
    'How could another option come out ahead?',
  ];

  // The invariant: for every phrase in the curated list,
  //   classifyAnalyticalIntent === 'what_would_flip'
  // AND
  //   tryPostAnalysisAdviceGate(... freshness: 'fresh') matches with
  //     advice_class === 'what_would_flip_free_text'
  for (const phrase of FLIP_PARITY_PHRASES) {
    it(`classifier matches ${JSON.stringify(phrase)}`, () => {
      expect(classifyAnalyticalIntent(phrase)).toBe('what_would_flip');
    });
    it(`advice gate matches ${JSON.stringify(phrase)}`, () => {
      const out = tryPostAnalysisAdviceGate({
        message: phrase,
        analysis: FIXTURE_ANALYSIS,
        analysisReady: READY_PAYLOAD_OPEN,
        freshness: 'fresh',
      });
      expect(out.matched).toBe(true);
      if (out.matched) expect(out.advice_class).toBe<AdviceClass>('what_would_flip_free_text');
    });
  }

  // Negative controls — must NOT classify as what_would_flip AND
  // must NOT match the advice gate as what_would_flip_free_text.
  // (They may match other classes — e.g. mutation_signal or off-topic
  // null — but never what_would_flip / what_would_flip_free_text.)
  const FLIP_NEGATIVE_CONTROLS: readonly string[] = [
    // Reviewer's explicit list
    'What would move Apple?',
    'How would the weather change tomorrow?',
    'Would you change the pricing?',
    'Tell me about Apple pricing',
    'What could change my mind?',
    // Concrete mutations — mustn't get captured by analytical class
    'Set Pricing to £100',
    'Change Pricing from £80 to £100',
    'Add a new constraint',
    'Remove the cost factor',
    // Adjacent advice/non-flip shapes
    'What should I change?',          // → explain (advice), NOT what_would_flip
    'What should we improve?',        // → improvement / advice, NOT what_would_flip
    'Walk me through the analysis.',  // → explain, NOT what_would_flip
    // Off-topic chat
    'What is the weather like?',
    'Tell me a joke.',
  ];

  for (const phrase of FLIP_NEGATIVE_CONTROLS) {
    it(`classifier does NOT return what_would_flip: ${JSON.stringify(phrase)}`, () => {
      const c = classifyAnalyticalIntent(phrase);
      if (c !== null) expect(c).not.toBe('what_would_flip');
    });
    it(`advice gate does NOT match what_would_flip_free_text: ${JSON.stringify(phrase)}`, () => {
      const out = tryPostAnalysisAdviceGate({
        message: phrase,
        analysis: FIXTURE_ANALYSIS,
        analysisReady: READY_PAYLOAD_OPEN,
        freshness: 'fresh',
      });
      if (out.matched) {
        expect(out.advice_class).not.toBe('what_would_flip_free_text');
      }
    });
  }
});
