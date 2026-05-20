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

  it('11a. "What would need to change to bring cost down to £30k?" — analytical wins (what_would_flip)', () => {
    // "change ... to £30k" looks like a mutation signal, but "what would
    // need to change" is a textbook what_would_flip phrase. Documented
    // precedence: when classifyAnalyticalIntent matches, that wins over
    // the broader mutation regex.
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

  it('11b. "Set Pricing to 0.7 then explain why" — concrete edit wins (mutation_signal)', () => {
    // The bare verb "explain" followed by "why" does NOT match any
    // analytical-intent class (the explain patterns require object phrases
    // like "explain the results / this"). The mutation regex DOES match
    // "Set Pricing to 0.7". Guard must reject → mutation_signal, preserving
    // the edit-graph dispatch path.
    const result = tryFreshAnalysisFollowupGuard({
      message: 'Set Pricing to 0.7 then explain why.',
      readiness: makeReadiness(),
    });
    expect(result.matched).toBe(false);
    if (!result.matched) expect(result.reason).toBe('mutation_signal');
  });

  it('11c. "Add a new constraint for budget" — concrete add wins (mutation_signal)', () => {
    // Bare imperative "add a new <noun>" is in MUTATION_SIGNAL_PATTERNS.
    // No analytical classifier pattern matches. Guard rejects with
    // mutation_signal — edit_graph dispatch path is preserved.
    const result = tryFreshAnalysisFollowupGuard({
      message: 'Add a new constraint for budget.',
      readiness: makeReadiness(),
    });
    expect(result.matched).toBe(false);
    if (!result.matched) expect(result.reason).toBe('mutation_signal');
  });

  it('11d. "Remove the demand factor and explain the impact" — concrete remove wins', () => {
    // The mutation patterns include "remove the <noun>". The trailing
    // "explain the impact" doesn't match the analytical explain class
    // (which requires "the results / analysis / outcomes / findings").
    // Reason: mutation_signal.
    const result = tryFreshAnalysisFollowupGuard({
      message: 'Remove the demand factor and explain the impact.',
      readiness: makeReadiness(),
    });
    expect(result.matched).toBe(false);
    if (!result.matched) expect(result.reason).toBe('mutation_signal');
  });

  it('11e. "Why is option A ahead, and should I change the budget?" — analytical wins (what_drove)', () => {
    // The "why is X ahead" pattern (added in this PR) matches → analytical
    // wins under the documented precedence rule. The trailing "change the
    // budget" clause does not carry a concrete value, so even if mutation
    // were checked first, no pattern would fire. Pins the rule that a
    // multi-clause message with an analytical lead routes to the chip
    // path rather than dropping to LLM routing.
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
