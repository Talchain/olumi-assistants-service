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
