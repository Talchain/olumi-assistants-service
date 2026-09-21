import { describe, it, expect } from 'vitest';
import { tryNoAnalysisGuard } from '../../../../src/orchestrator-v5/routing/no-analysis-guard.js';
import type { ContextReadiness } from '../../../../src/orchestrator-v5/context/readiness.js';

function makeReadiness(
  overrides: Partial<ContextReadiness> = {},
): ContextReadiness {
  return {
    graph_present: true,
    graph_node_count: 3,
    graph_edge_count: 2,
    brief_present: true,
    prior_fact_count: 0,
    has_run_analysis_fact: false,
    latest_analysis_freshness: 'none',
    latest_analysis_graph_hash: null,
    current_graph_hash: 'abc123',
    pending_action_count: 0,
    recent_change_count: 0,
    phase3_block_context_available: false,
    context_pack_chars: 1234,
    ...overrides,
  };
}

describe('tryNoAnalysisGuard', () => {
  it('matches analytical intent when no run_analysis fact exists and graph is ready', () => {
    const result = tryNoAnalysisGuard({
      message: 'Walk me through the analysis.',
      readiness: makeReadiness(),
    });
    expect(result.matched).toBe(true);
    if (result.matched) {
      expect(result.intent_class).toBe('explain');
      expect(result.graph_ready).toBe(true);
      expect(result.assistant_text).toContain('Run analysis first');
      expect(result.suggested_actions).toHaveLength(1);
      expect(result.suggested_actions[0]?.action_type).toBe('run_analysis');
    }
  });

  it('matches what_drove when no fact exists', () => {
    const result = tryNoAnalysisGuard({
      message: 'What drove this result?',
      readiness: makeReadiness(),
    });
    expect(result.matched).toBe(true);
    if (result.matched) {
      expect(result.intent_class).toBe('what_drove');
    }
  });

  // Grounded-fresh-analysis workstream broadened `classifyAnalyticalIntent`
  // to include "leading". This guard-level test pins that the no-analysis
  // guard now owns "Why is Option A leading?" — proving the integration
  // (not just the classifier) routes the phrase to the "run analysis
  // first" nudge instead of falling through to the LLM router.
  it('matches what_drove for "Why is Option A leading?" when no fact exists', () => {
    const result = tryNoAnalysisGuard({
      message: 'Why is Option A leading?',
      readiness: makeReadiness(),
    });
    expect(result.matched).toBe(true);
    if (result.matched) {
      expect(result.intent_class).toBe('what_drove');
      expect(result.graph_ready).toBe(true);
      expect(result.assistant_text).toContain('Run analysis first');
      expect(result.suggested_actions).toHaveLength(1);
      expect(result.suggested_actions[0]?.action_type).toBe('run_analysis');
    }
  });

  it('uses graph-not-ready copy when nodes/edges are absent', () => {
    const result = tryNoAnalysisGuard({
      message: 'Walk me through the analysis.',
      readiness: makeReadiness({
        graph_present: false,
        graph_node_count: 0,
        graph_edge_count: 0,
      }),
    });
    expect(result.matched).toBe(true);
    if (result.matched) {
      expect(result.graph_ready).toBe(false);
      expect(result.assistant_text).toContain('Once the model is ready');
      expect(result.suggested_actions).toHaveLength(0);
    }
  });

  it('uses graph-not-ready copy when edges are absent even if nodes exist', () => {
    const result = tryNoAnalysisGuard({
      message: 'What drove this?',
      readiness: makeReadiness({
        graph_node_count: 3,
        graph_edge_count: 0,
      }),
    });
    expect(result.matched).toBe(true);
    if (result.matched) expect(result.graph_ready).toBe(false);
  });

  it('does not match when a run_analysis fact already exists', () => {
    const result = tryNoAnalysisGuard({
      message: 'Walk me through the analysis.',
      readiness: makeReadiness({
        has_run_analysis_fact: true,
        latest_analysis_freshness: 'fresh',
      }),
    });
    expect(result.matched).toBe(false);
    if (!result.matched) expect(result.reason).toBe('analysis_present');
  });

  it('does not match when freshness is anything other than none', () => {
    for (const freshness of ['fresh', 'stale', 'unknown'] as const) {
      const result = tryNoAnalysisGuard({
        message: 'Walk me through the analysis.',
        readiness: makeReadiness({ latest_analysis_freshness: freshness }),
      });
      expect(result.matched).toBe(false);
    }
  });

  it('does not match when the message is edit-like with a mutation signal', () => {
    const result = tryNoAnalysisGuard({
      message: 'Set Pricing to 0.7.',
      readiness: makeReadiness(),
    });
    expect(result.matched).toBe(false);
    if (!result.matched) expect(result.reason).toBe('mutation_signal');
  });

  it('does not match when the message has no analytical intent', () => {
    const result = tryNoAnalysisGuard({
      message: 'Hello there.',
      readiness: makeReadiness(),
    });
    expect(result.matched).toBe(false);
    if (!result.matched) expect(result.reason).toBe('no_analytical_signal');
  });

  it('produces copy with no internal terms or banned vocabulary', () => {
    const result = tryNoAnalysisGuard({
      message: 'Walk me through the analysis.',
      readiness: makeReadiness(),
    });
    expect(result.matched).toBe(true);
    if (result.matched) {
      const text = result.assistant_text;
      expect(text).not.toMatch(/validator|dispatcher|\bpatch\b|\bschema\b|tool\s+call/i);
      expect(text).not.toMatch(/\bwinner|\brecommend/i);
      expect(text).not.toMatch(/—/);
    }
  });
});
