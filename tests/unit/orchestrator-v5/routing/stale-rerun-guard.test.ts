import { describe, it, expect } from 'vitest';
import { tryStaleRerunGuard } from '../../../../src/orchestrator-v5/routing/stale-rerun-guard.js';

describe('tryStaleRerunGuard', () => {
  it('matches analytical intent when freshness is stale', () => {
    const result = tryStaleRerunGuard({
      message: 'Walk me through the analysis.',
      freshness: 'stale',
    });
    expect(result.matched).toBe(true);
    if (result.matched) {
      expect(result.intent_class).toBe('explain');
      expect(result.assistant_text).toContain('graph has changed');
      expect(result.assistant_text).toContain('Re-run analysis');
      expect(result.suggested_actions).toHaveLength(1);
      expect(result.suggested_actions[0]?.action_type).toBe('run_analysis');
    }
  });

  it('matches what_would_flip when stale', () => {
    const result = tryStaleRerunGuard({
      message: 'What would flip this?',
      freshness: 'stale',
    });
    expect(result.matched).toBe(true);
    if (result.matched) {
      expect(result.intent_class).toBe('what_would_flip');
    }
  });

  // Grounded-fresh-analysis workstream broadened `classifyAnalyticalIntent`
  // to include "leading". This guard-level test pins that the stale-rerun
  // guard now owns "Why is Option A leading?" on stale analyses — proving
  // the integration (not just the classifier) routes the phrase to the
  // re-run nudge instead of falling through to the LLM router.
  it('matches what_drove for "Why is Option A leading?" when stale', () => {
    const result = tryStaleRerunGuard({
      message: 'Why is Option A leading?',
      freshness: 'stale',
    });
    expect(result.matched).toBe(true);
    if (result.matched) {
      expect(result.intent_class).toBe('what_drove');
      expect(result.assistant_text).toContain('graph has changed');
      expect(result.suggested_actions).toHaveLength(1);
      expect(result.suggested_actions[0]?.action_type).toBe('run_analysis');
    }
  });

  it('does not match when freshness is fresh', () => {
    const result = tryStaleRerunGuard({
      message: 'Walk me through the analysis.',
      freshness: 'fresh',
    });
    expect(result.matched).toBe(false);
    if (!result.matched) expect(result.reason).toBe('not_stale');
  });

  // Mission 1 (context authority): `unknown` freshness now MATCHES with
  // authority-parity copy. Before this pass an unknown-freshness
  // analytical question fell through every deterministic guard to broad
  // LLM routing, which received no freshness token and could present
  // stale results as current. Deliberate pin flip — the old behaviour
  // ("does not match when freshness is unknown" → not_stale) was the gap.
  it('matches when freshness is unknown, with unconfirmed copy that never asserts the model changed', () => {
    const result = tryStaleRerunGuard({
      message: 'Walk me through the analysis.',
      freshness: 'unknown',
    });
    expect(result.matched).toBe(true);
    if (result.matched) {
      expect(result.mode).toBe('unconfirmed');
      // Authority parity: currency unconfirmable ≠ known change. The
      // copy must not claim the graph/model changed.
      expect(result.assistant_text).not.toMatch(/has changed/i);
      expect(result.assistant_text).toMatch(/can['’]t confirm/i);
      expect(result.assistant_text).toMatch(/may be out of date/i);
      expect(result.assistant_text).toMatch(/Re-run analysis/);
      expect(result.suggested_actions).toHaveLength(1);
      expect(result.suggested_actions[0]?.id).toBe('chip_action_rerun_analysis');
      expect(result.suggested_actions[0]?.action_type).toBe('run_analysis');
    }
  });

  it('stale match carries mode "stale" and keeps the known-change copy', () => {
    const result = tryStaleRerunGuard({
      message: 'Walk me through the analysis.',
      freshness: 'stale',
    });
    expect(result.matched).toBe(true);
    if (result.matched) {
      expect(result.mode).toBe('stale');
      expect(result.assistant_text).toContain('graph has changed');
    }
  });

  it('does not match when freshness is none', () => {
    const result = tryStaleRerunGuard({
      message: 'Walk me through the analysis.',
      freshness: 'none',
    });
    expect(result.matched).toBe(false);
  });

  it('does not match when message has a mutation signal even with stale analysis', () => {
    const result = tryStaleRerunGuard({
      message: 'Set Pricing to 0.7 and walk me through the result.',
      freshness: 'stale',
    });
    expect(result.matched).toBe(false);
    if (!result.matched) expect(result.reason).toBe('mutation_signal');
  });

  // Issue #195 — flip-overlap exception. The canonical what-would-flip
  // phrasing trips the broad mutation-signal patterns purely through
  // flip-pattern overlap ("change ... to look better"). The advice gate
  // and fresh-followup guard already carried the exception; this guard
  // declined `mutation_signal`, and the question then fell through the
  // advice gate (`not_fresh`) to broad LLM routing with no staleness cue.
  it('flip-overlap phrasing matches when stale: "What would need to change for another option to look better?"', () => {
    const result = tryStaleRerunGuard({
      message: 'What would need to change for another option to look better?',
      freshness: 'stale',
    });
    expect(result.matched).toBe(true);
    if (result.matched) {
      expect(result.intent_class).toBe('what_would_flip');
      expect(result.mode).toBe('stale');
      expect(result.suggested_actions[0]?.action_type).toBe('run_analysis');
    }
  });

  it('flip-overlap phrasing matches when unknown, with unconfirmed copy', () => {
    const result = tryStaleRerunGuard({
      message: 'What would have to change for the offshore option to win?',
      freshness: 'unknown',
    });
    expect(result.matched).toBe(true);
    if (result.matched) {
      expect(result.intent_class).toBe('what_would_flip');
      expect(result.mode).toBe('unconfirmed');
      expect(result.assistant_text).not.toMatch(/has changed/i);
    }
  });

  it('a genuine edit clause alongside flip phrasing keeps mutation precedence', () => {
    const result = tryStaleRerunGuard({
      message: 'Set Pricing to 0.7 and what would flip this?',
      freshness: 'stale',
    });
    expect(result.matched).toBe(false);
    if (!result.matched) expect(result.reason).toBe('mutation_signal');
  });

  it('does not match when message has no analytical intent', () => {
    const result = tryStaleRerunGuard({
      message: 'Hi there.',
      freshness: 'stale',
    });
    expect(result.matched).toBe(false);
    if (!result.matched) expect(result.reason).toBe('no_analytical_signal');
  });

  it('does not match on empty message', () => {
    const result = tryStaleRerunGuard({
      message: '   ',
      freshness: 'stale',
    });
    expect(result.matched).toBe(false);
    if (!result.matched) expect(result.reason).toBe('empty_message');
  });

  it('produces copy with no internal terms or banned vocabulary', () => {
    const result = tryStaleRerunGuard({
      message: 'Walk me through the analysis.',
      freshness: 'stale',
    });
    expect(result.matched).toBe(true);
    if (result.matched) {
      const text = result.assistant_text;
      expect(text).not.toMatch(/validator/i);
      expect(text).not.toMatch(/dispatcher/i);
      expect(text).not.toMatch(/\bpatch\b/i);
      expect(text).not.toMatch(/\bschema\b/i);
      expect(text).not.toMatch(/\boperation\b/i);
      expect(text).not.toMatch(/tool\s+call/i);
      expect(text).not.toMatch(/\bwinner/i);
      expect(text).not.toMatch(/\brecommend/i);
      expect(text).not.toMatch(/—/);
    }
  });
});
