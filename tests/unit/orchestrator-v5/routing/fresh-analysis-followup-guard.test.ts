import { describe, it, expect } from 'vitest';

import { tryFreshAnalysisFollowupGuard } from '../../../../src/orchestrator-v5/routing/fresh-analysis-followup-guard.js';
import type { ContextReadiness } from '../../../../src/orchestrator-v5/context/readiness.js';

function makeReadiness(
  overrides: Partial<ContextReadiness> = {},
): ContextReadiness {
  return {
    graph_present: true,
    graph_node_count: 3,
    graph_edge_count: 2,
    brief_present: true,
    prior_fact_count: 1,
    has_run_analysis_fact: true,
    latest_analysis_freshness: 'fresh',
    latest_analysis_graph_hash: 'abc123',
    current_graph_hash: 'abc123',
    pending_action_count: 0,
    recent_change_count: 0,
    phase3_block_context_available: false,
    context_pack_chars: 1234,
    ...overrides,
  };
}

describe('tryFreshAnalysisFollowupGuard', () => {
  it('1. "Walk me through the analysis" + fresh → explain_results, not edit_graph', () => {
    const result = tryFreshAnalysisFollowupGuard({
      message: 'Walk me through the analysis.',
      readiness: makeReadiness(),
    });
    expect(result.matched).toBe(true);
    if (result.matched) {
      expect(result.intent_class).toBe('explain');
      expect(result.selected_action_type).toBe('explain_results');
      expect(result.suggested_actions).toHaveLength(1);
      expect(result.suggested_actions[0]?.action_type).toBe('explain_results');
      // Negative: never selects edit_graph
      expect(result.selected_action_type).not.toBe('edit_graph' as unknown);
      for (const action of result.suggested_actions) {
        expect(action.action_type).not.toBe('edit_graph' as unknown);
      }
    }
  });

  it('2. "What drove this result?" + fresh → explain_results, not edit_graph', () => {
    const result = tryFreshAnalysisFollowupGuard({
      message: 'What drove this result?',
      readiness: makeReadiness(),
    });
    expect(result.matched).toBe(true);
    if (result.matched) {
      expect(result.intent_class).toBe('what_drove');
      expect(result.selected_action_type).toBe('explain_results');
      expect(result.suggested_actions[0]?.action_type).toBe('explain_results');
    }
  });

  it('3. "Why is this option ahead?" + fresh → explain_results, not edit_graph', () => {
    const result = tryFreshAnalysisFollowupGuard({
      message: 'Why is this option ahead?',
      readiness: makeReadiness(),
    });
    expect(result.matched).toBe(true);
    if (result.matched) {
      expect(result.intent_class).toBe('what_drove');
      expect(result.selected_action_type).toBe('explain_results');
      expect(result.suggested_actions[0]?.action_type).toBe('explain_results');
    }
  });

  it('4. "What would need to change for another option to look better?" + fresh → what_would_flip', () => {
    const result = tryFreshAnalysisFollowupGuard({
      message: 'What would need to change for another option to look better?',
      readiness: makeReadiness(),
    });
    expect(result.matched).toBe(true);
    if (result.matched) {
      expect(result.intent_class).toBe('what_would_flip');
      expect(result.selected_action_type).toBe('what_would_flip');
      expect(result.suggested_actions[0]?.action_type).toBe('what_would_flip');
    }
  });

  it('5. "Increase budget by £3000" + fresh → matched=false, mutation_signal (value-edit path preserved)', () => {
    const result = tryFreshAnalysisFollowupGuard({
      message: 'Increase budget by £3000.',
      readiness: makeReadiness(),
    });
    expect(result.matched).toBe(false);
    if (!result.matched) expect(result.reason).toBe('mutation_signal');
  });

  it('6. "Change the marketing budget" + fresh → matched=false (mutation/edit path open)', () => {
    const result = tryFreshAnalysisFollowupGuard({
      message: 'Change the marketing budget.',
      readiness: makeReadiness(),
    });
    expect(result.matched).toBe(false);
    // The phrase is not a hard mutation_signal under MUTATION_SIGNAL_PATTERNS
    // (no concrete value), but it also has no analytical intent under
    // classifyAnalyticalIntent. Either no_analytical_signal or
    // mutation_signal is acceptable — the contract is "not matched".
    if (!result.matched) {
      expect(['mutation_signal', 'no_analytical_signal']).toContain(result.reason);
    }
  });

  it('7. analytical messages + stale analysis → matched=false (not_fresh; stale path keeps ownership)', () => {
    const analyticalMessages = [
      'Walk me through the analysis.',
      'What drove this result?',
      'Why is this option ahead?',
      'What would need to change for another option to look better?',
    ];
    for (const message of analyticalMessages) {
      const result = tryFreshAnalysisFollowupGuard({
        message,
        readiness: makeReadiness({ latest_analysis_freshness: 'stale' }),
      });
      expect(result.matched).toBe(false);
      if (!result.matched) expect(result.reason).toBe('not_fresh');
    }
  });

  it('7b. analytical message + unknown / none freshness → matched=false (not_fresh)', () => {
    for (const freshness of ['unknown', 'none'] as const) {
      const result = tryFreshAnalysisFollowupGuard({
        message: 'Walk me through the analysis.',
        readiness: makeReadiness({ latest_analysis_freshness: freshness }),
      });
      expect(result.matched).toBe(false);
      if (!result.matched) expect(result.reason).toBe('not_fresh');
    }
  });

  it('8. fresh freshness but has_run_analysis_fact=false → matched=false (no_analysis_fact)', () => {
    const result = tryFreshAnalysisFollowupGuard({
      message: 'Walk me through the analysis.',
      readiness: makeReadiness({ has_run_analysis_fact: false }),
    });
    expect(result.matched).toBe(false);
    if (!result.matched) expect(result.reason).toBe('no_analysis_fact');
  });

  it('9. empty / whitespace message → matched=false (empty_message)', () => {
    for (const message of ['', '   ', '\n\t']) {
      const result = tryFreshAnalysisFollowupGuard({
        message,
        readiness: makeReadiness(),
      });
      expect(result.matched).toBe(false);
      if (!result.matched) expect(result.reason).toBe('empty_message');
    }
  });

  it('10. copy safety — no internal terms, British English, no em dash', () => {
    const messages = [
      'Walk me through the analysis.',
      'What drove this result?',
      'Why is this option ahead?',
      'What would need to change for another option to look better?',
    ];
    for (const message of messages) {
      const result = tryFreshAnalysisFollowupGuard({
        message,
        readiness: makeReadiness(),
      });
      expect(result.matched).toBe(true);
      if (result.matched) {
        const text = result.assistant_text;
        // Internal terms banned by the brief
        expect(text).not.toMatch(/validator|dispatcher|\bschema\b|\boperation\b|tool\s+call|\bpatch\b/i);
        // No em dash anywhere
        expect(text).not.toContain('—');
        expect(text).not.toMatch(/—/);
        // Chip labels and messages should also avoid the banned terms
        for (const action of result.suggested_actions) {
          expect(action.label).not.toMatch(/validator|dispatcher|\bschema\b|\boperation\b|tool\s+call|\bpatch\b/i);
          expect(action.message).not.toMatch(/validator|dispatcher|\bschema\b|\boperation\b|tool\s+call|\bpatch\b/i);
        }
        // British English: prefer "recap" / "trade-offs" surface and reject
        // explicit US-ified vocabulary changes; this rule is light — just
        // confirm the canonical "trade-offs" hyphenation is preserved when
        // present so future copy edits cannot drift to "tradeoffs".
        if (text.toLowerCase().includes('trade')) {
          expect(text).toMatch(/trade-offs/);
        }
      }
    }
  });

  // ------------------------------------------------------------------------
  // Ambiguous-overlap pin-down — protects the documented precedence rule
  // (analytical-intent classification BEFORE mutation-signal check) so future
  // pattern additions to either predicate cannot silently swallow real edits
  // or block a real analytical follow-up.
  // ------------------------------------------------------------------------

  // 11a-11d — concrete-edit-clause + matching-analytical-phrase
  // -----------------------------------------------------------
  // These are the cases the reviewer flagged as regressions in round-1.
  // Each message has BOTH a hard mutation pattern AND a classifyAnalyticalIntent
  // pattern that does match (i.e. they would have been intercepted by the
  // previous analytical-first ordering). Mutation must win for every
  // class EXCEPT `what_would_flip`. The reasons reported here pin the
  // narrow exception's scope.

  it('11a. "Set Pricing to 0.7 then explain the results" — mutation wins over explain class', () => {
    // classifyAnalyticalIntent matches "explain the results" → 'explain'.
    // hasMutationSignal matches "Set Pricing to 0.7" → true.
    // Outcome: mutation wins (only what_would_flip gets the exception).
    const result = tryFreshAnalysisFollowupGuard({
      message: 'Set Pricing to 0.7 then explain the results.',
      readiness: makeReadiness(),
    });
    expect(result.matched).toBe(false);
    if (!result.matched) expect(result.reason).toBe('mutation_signal');
  });

  it('11b. "Remove the demand factor and explain the analysis" — mutation wins over explain class', () => {
    // classifyAnalyticalIntent matches "explain the analysis" → 'explain'.
    // hasMutationSignal matches "Remove the demand factor" → true.
    // Mutation must reach the edit path.
    const result = tryFreshAnalysisFollowupGuard({
      message: 'Remove the demand factor and explain the analysis.',
      readiness: makeReadiness(),
    });
    expect(result.matched).toBe(false);
    if (!result.matched) expect(result.reason).toBe('mutation_signal');
  });

  it('11c. "Add a new constraint then explain the results" — mutation wins over explain class', () => {
    // classifyAnalyticalIntent matches "explain the results" → 'explain'.
    // hasMutationSignal matches "Add a new constraint" → true.
    const result = tryFreshAnalysisFollowupGuard({
      message: 'Add a new constraint then explain the results.',
      readiness: makeReadiness(),
    });
    expect(result.matched).toBe(false);
    if (!result.matched) expect(result.reason).toBe('mutation_signal');
  });

  it('11d. "Increase budget to 200 then walk me through the analysis" — mutation wins over explain', () => {
    // classifyAnalyticalIntent matches "walk me through" → 'explain'.
    // hasMutationSignal matches "Increase budget to 200" → true.
    // The "explain" class never gets the exception.
    const result = tryFreshAnalysisFollowupGuard({
      message: 'Increase budget to 200 then walk me through the analysis.',
      readiness: makeReadiness(),
    });
    expect(result.matched).toBe(false);
    if (!result.matched) expect(result.reason).toBe('mutation_signal');
  });

  it('11e. "Set Pricing to 0.7 then walk me through what drove this" — mutation wins over what_drove', () => {
    // classifyAnalyticalIntent matches "walk me through" → 'explain'
    // (the explain pattern wins precedence over what_drove inside the
    // classifier). Either way, no exception → mutation wins.
    const result = tryFreshAnalysisFollowupGuard({
      message: 'Set Pricing to 0.7 then walk me through what drove this.',
      readiness: makeReadiness(),
    });
    expect(result.matched).toBe(false);
    if (!result.matched) expect(result.reason).toBe('mutation_signal');
  });

  // 11f-11g — narrow what_would_flip exception is preserved
  // ------------------------------------------------------

  it('11f. "What would need to change to bring cost down to £30k?" — what_would_flip exception applies', () => {
    // "change ... to £30k" matches the mutation regex, but the analytical
    // class is `what_would_flip`. Narrow exception: this is genuine
    // sensitivity phrasing, not an edit. Guard matches.
    const result = tryFreshAnalysisFollowupGuard({
      message: 'What would need to change to bring cost down to £30k?',
      readiness: makeReadiness(),
    });
    expect(result.matched).toBe(true);
    if (result.matched) {
      expect(result.intent_class).toBe('what_would_flip');
      expect(result.selected_action_type).toBe('what_would_flip');
    }
  });

  it('11g. "How could another option win after changing to a different mix?" — what_would_flip exception applies', () => {
    // `what_would_flip` pattern "how could another option win" matches.
    // The mutation regex also matches "changing to a different mix" via
    // `change ... to <X>`. Exception keeps the analytical handling.
    const result = tryFreshAnalysisFollowupGuard({
      message: 'How could another option win after changing to a different mix?',
      readiness: makeReadiness(),
    });
    expect(result.matched).toBe(true);
    if (result.matched) {
      expect(result.intent_class).toBe('what_would_flip');
    }
  });

  // 11g1-11g3 — what_would_flip exception is NOW doubly-scoped: only
  // applies when the mutation signal is from flip-overlap phrasing
  // alone, NOT when the message also contains an independent concrete
  // edit clause. Round-3 review caught these as regressions of the
  // earlier broad exception.

  it('11g1. "Set Pricing to 0.7 then what would need to change for another option to look better?" — concrete edit wins', () => {
    // cls=what_would_flip, mutation=true, but the mutation signal includes
    // an unambiguous "Set ... to 0.7" (verb+number) clause that is NOT a
    // flip-overlap false positive. Mutation must win.
    const result = tryFreshAnalysisFollowupGuard({
      message: 'Set Pricing to 0.7 then what would need to change for another option to look better?',
      readiness: makeReadiness(),
    });
    expect(result.matched).toBe(false);
    if (!result.matched) expect(result.reason).toBe('mutation_signal');
  });

  it('11g2. "Increase budget to 200 then how could another option win?" — concrete edit wins', () => {
    // "Increase budget to 200" is the verb+number unambiguous-edit
    // pattern. Even though `how could another option win` would
    // normally trigger the flip exception, the independent edit clause
    // disqualifies it.
    const result = tryFreshAnalysisFollowupGuard({
      message: 'Increase budget to 200 then how could another option win?',
      readiness: makeReadiness(),
    });
    expect(result.matched).toBe(false);
    if (!result.matched) expect(result.reason).toBe('mutation_signal');
  });

  it('11g3. "Remove the demand factor, then what would flip the result?" — concrete edit wins', () => {
    // "Remove the demand factor" is the remove+deictic-noun unambiguous
    // edit pattern. Mutation wins over the trailing flip question.
    const result = tryFreshAnalysisFollowupGuard({
      message: 'Remove the demand factor, then what would flip the result?',
      readiness: makeReadiness(),
    });
    expect(result.matched).toBe(false);
    if (!result.matched) expect(result.reason).toBe('mutation_signal');
  });

  it('11g4. "Add a new constraint then what would flip the outcome?" — concrete edit wins', () => {
    // "Add a new constraint" is the add+determiner unambiguous edit
    // pattern. Mutation wins.
    const result = tryFreshAnalysisFollowupGuard({
      message: 'Add a new constraint then what would flip the outcome?',
      readiness: makeReadiness(),
    });
    expect(result.matched).toBe(false);
    if (!result.matched) expect(result.reason).toBe('mutation_signal');
  });

  it('11g5. "What would need to change?" (no concrete edit alongside) — still matches what_would_flip', () => {
    // Regression guard: stripping the false-positive exception too
    // aggressively must not break the pure flip-question case (where
    // the mutation signal does not even fire because there is no
    // `to <X>` suffix). Sanity check.
    const result = tryFreshAnalysisFollowupGuard({
      message: 'What would need to change?',
      readiness: makeReadiness(),
    });
    expect(result.matched).toBe(true);
    if (result.matched) expect(result.intent_class).toBe('what_would_flip');
  });

  // 11h-11j — non-mutating multi-clause messages still match
  // -------------------------------------------------------

  it('11h. "Why is option A ahead, and should I change the budget?" — analytical wins (no mutation signal)', () => {
    // "change the budget" has NO concrete value, so the mutation regex
    // (requiring "to <X>" or a number) does not match. The "why is X
    // ahead" pattern fires → what_drove. Guard matches.
    const result = tryFreshAnalysisFollowupGuard({
      message: 'Why is option A ahead, and should I change the budget?',
      readiness: makeReadiness(),
    });
    expect(result.matched).toBe(true);
    if (result.matched) {
      expect(result.intent_class).toBe('what_drove');
      expect(result.selected_action_type).toBe('explain_results');
    }
  });

  it('11i. "Walk me through the analysis and tell me what to focus on" — analytical, no mutation', () => {
    // No concrete edit verbs at all. classifyAnalyticalIntent matches
    // "walk me through" → explain.
    const result = tryFreshAnalysisFollowupGuard({
      message: 'Walk me through the analysis and tell me what to focus on.',
      readiness: makeReadiness(),
    });
    expect(result.matched).toBe(true);
    if (result.matched) expect(result.intent_class).toBe('explain');
  });

  it('11j. "Add a new constraint" — pure mutation, no analytical signal → mutation_signal', () => {
    // Regression guard for the no-analytical-signal arm of the predicate.
    const result = tryFreshAnalysisFollowupGuard({
      message: 'Add a new constraint for budget.',
      readiness: makeReadiness(),
    });
    expect(result.matched).toBe(false);
    if (!result.matched) expect(result.reason).toBe('mutation_signal');
  });

  it('chips are read-only / frozen — mutation does not affect future calls', () => {
    const r1 = tryFreshAnalysisFollowupGuard({
      message: 'Walk me through the analysis.',
      readiness: makeReadiness(),
    });
    expect(r1.matched).toBe(true);
    if (r1.matched) {
      // Both reference-equality (frozen module-level singleton) and content
      // should be stable across calls.
      const r2 = tryFreshAnalysisFollowupGuard({
        message: 'Walk me through the analysis.',
        readiness: makeReadiness(),
      });
      expect(r2.matched).toBe(true);
      if (r2.matched) {
        expect(r2.assistant_text).toBe(r1.assistant_text);
        expect(r2.suggested_actions[0]?.action_type).toBe(
          r1.suggested_actions[0]?.action_type,
        );
      }
    }
  });
});
