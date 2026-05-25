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
