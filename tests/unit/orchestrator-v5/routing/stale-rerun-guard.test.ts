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

  it('does not match when freshness is unknown', () => {
    const result = tryStaleRerunGuard({
      message: 'Walk me through the analysis.',
      freshness: 'unknown',
    });
    expect(result.matched).toBe(false);
    if (!result.matched) expect(result.reason).toBe('not_stale');
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

  // ── V5-WAVE-2 PR-C: freshness-status handling ─────────────────────────

  it('fresh + "Is this analysis still up to date?" → crisp still-current answer, no re-run chip', () => {
    const result = tryStaleRerunGuard({
      message: 'Is this analysis still up to date?',
      freshness: 'fresh',
    });
    expect(result.matched).toBe(true);
    if (result.matched) {
      expect(result.intent_class).toBe('rerun_question');
      expect(result.assistant_text).toContain('still current');
      expect(result.assistant_text).toMatch(/no need to re-run/i);
      // Fresh: nothing to do, so no run_analysis chip.
      expect(result.suggested_actions).toHaveLength(0);
    }
  });

  it('still-current copy carries no forbidden staleness phrasing or banned vocab', () => {
    const result = tryStaleRerunGuard({
      message: 'Are these results still up to date?',
      freshness: 'fresh',
    });
    expect(result.matched).toBe(true);
    if (result.matched) {
      const text = result.assistant_text;
      expect(text).not.toMatch(/\b(?:previous|prior)\s+analysis\b/i);
      expect(text).not.toMatch(/\bnothing\s+changed\b/i);
      expect(text).not.toMatch(/\bcached\s+result\b/i);
      expect(text).not.toMatch(/—/);
    }
  });

  it('fresh + non-rerun analytical intent (what_drove) is NOT intercepted (flows to advice gate)', () => {
    const result = tryStaleRerunGuard({
      message: 'Why is Option A leading?',
      freshness: 'fresh',
    });
    expect(result.matched).toBe(false);
    if (!result.matched) expect(result.reason).toBe('not_stale');
  });

  it('fresh freshness-status question with a mutation clause defers to the edit path', () => {
    const result = tryStaleRerunGuard({
      message: 'Set Pricing to 0.7 then is this analysis still up to date?',
      freshness: 'fresh',
    });
    expect(result.matched).toBe(false);
    if (!result.matched) expect(result.reason).toBe('mutation_signal');
  });

  it('stale + "Is this analysis still up to date?" → re-run nudge with chip', () => {
    const result = tryStaleRerunGuard({
      message: 'Is this analysis still up to date?',
      freshness: 'stale',
    });
    expect(result.matched).toBe(true);
    if (result.matched) {
      expect(result.intent_class).toBe('rerun_question');
      expect(result.assistant_text).toContain('graph has changed');
      expect(result.suggested_actions[0]?.action_type).toBe('run_analysis');
    }
  });

  it('stale path names the applied change when a recent-change summary is available', () => {
    const result = tryStaleRerunGuard({
      message: 'Is this analysis still up to date?',
      freshness: 'stale',
      recentChangeSummary: 'Cash Runway set to £180,000.',
    });
    expect(result.matched).toBe(true);
    if (result.matched) {
      expect(result.assistant_text).toContain('Cash Runway set to £180,000.');
      // The named change leads, before the existing re-run copy.
      expect(result.assistant_text.indexOf('Cash Runway')).toBeLessThan(
        result.assistant_text.indexOf('graph has changed'),
      );
      expect(result.suggested_actions[0]?.action_type).toBe('run_analysis');
    }
  });

  it('stale copy is byte-identical to the prior wording when no recent-change summary is present', () => {
    const withNull = tryStaleRerunGuard({
      message: 'Walk me through the analysis.',
      freshness: 'stale',
      recentChangeSummary: null,
    });
    const without = tryStaleRerunGuard({
      message: 'Walk me through the analysis.',
      freshness: 'stale',
    });
    expect(withNull.matched && without.matched).toBe(true);
    if (withNull.matched && without.matched) {
      expect(withNull.assistant_text).toBe(without.assistant_text);
      expect(withNull.assistant_text).toBe(
        'The graph has changed since the last analysis. '
          + 'Re-run analysis to refresh the insights and explore the updated decision.',
      );
    }
  });
});
