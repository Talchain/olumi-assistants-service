/**
 * `assertExplainLeaderStale` chip-label regression guard.
 *
 * Background: a reviewer (Gemini) flagged that the staleness chip
 * detector in `assertions.ts` used a literal `re-run` alternative
 * that missed two real spellings — `rerun` (one word) succeeded only
 * by accident, `re run` (space variant) failed silently. Real chip
 * labels and chip messages mix spellings:
 *   - the UI ships "Rerun analysis"
 *   - LLM coaching prose sometimes emits "re-run the analysis"
 *   - "Run analysis again" can paraphrase to "re run analysis"
 *
 * The pattern was widened to `re[- ]?run`, mirroring the text-side
 * detector. These tests pin the chip detector against all three
 * spellings plus the secondary verbs (`refresh`, `update`, `stale`)
 * that the runtime also uses for the same recovery affordance, AND
 * lock in the negative path so we still fail when no staleness
 * signal is present.
 */

import { describe, it, expect } from 'vitest';

import { assertExplainLeaderStale } from '../../../tools/v5-journey-replay/assertions.js';

// Substantive explain-leader prose used to keep the response above
// any future content-substance gate and to give the detector a real
// body to scan. The text deliberately contains no staleness marker
// of its own so that each fixture isolates the chip-detection path.
const NEUTRAL_EXPLAIN_TEXT =
  'Hire Two Senior Engineers Locally leads at 63% win probability. ' +
  'Effective Engineering Capacity is the top driver, with Speed to Full ' +
  'Productivity contributing a secondary positive influence. Incremental ' +
  'Staffing Cost works against the option with a moderate negative effect.';

function chipFixture(label: string, message: string) {
  return {
    status: 200 as const,
    body: {
      assistant_text: NEUTRAL_EXPLAIN_TEXT,
      suggested_actions: [
        { id: 'chip_recovery', label, message, action_type: 'run_analysis' },
      ],
    },
    elapsed_ms: 100,
  };
}

describe('assertExplainLeaderStale — chip-label staleness detection', () => {
  it.each([
    // The three rerun spellings — `re[- ]?run` must catch all of these.
    { label: 'Rerun analysis', message: 'Rerun analysis on the updated graph.' },
    { label: 'Re-run analysis', message: 'Re-run analysis on the updated graph.' },
    { label: 'Re run analysis', message: 'Re run analysis on the updated graph.' },
    // Secondary verbs the runtime also uses to surface the same recovery affordance.
    { label: 'Refresh analysis', message: 'Refresh analysis to pick up your latest edit.' },
    { label: 'Update analysis', message: 'Update analysis with the new graph state.' },
    { label: 'Stale analysis — rerun?', message: 'The analysis is stale; want to refresh?' },
    // Mixed case + chip-text-only (label is something else, message carries
    // the signal). Deliberately avoids "previous analysis" — that phrase is
    // now on the canonical FORBIDDEN_USER_FACING_PHRASES list (src/
    // orchestrator-v5/compose/forbidden-user-facing-phrases.ts) and would be
    // caught by coreAssertions()'s noForbiddenTerms() before ever reaching
    // the staleness-chip detector this fixture is meant to exercise.
    {
      label: 'Refresh',
      message: 'This analysis is now stale relative to the current graph.',
    },
  ])('passes when chip surfaces staleness: %j', ({ label, message }) => {
    const r = assertExplainLeaderStale(chipFixture(label, message));
    expect(r.ok).toBe(true);
    expect(r.evidence).toMatch(/staleness_chip=true/);
  });

  it('fails when no chip carries a staleness verb and the body text is neutral', () => {
    const r = assertExplainLeaderStale(
      chipFixture('Explore what would change this', 'Explore what would change the result.'),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failing_contract).toBe('explain_leader_stale_signal_missing');
      expect(r.evidence).toMatch(/staleness_text=false staleness_chip=false/);
    }
  });

  it('requires "analy" alongside the staleness verb (a chip about "update budget" is not enough)', () => {
    const r = assertExplainLeaderStale(
      chipFixture('Update budget', 'Update the budget factor to a new value.'),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failing_contract).toBe('explain_leader_stale_signal_missing');
    }
  });

  it('passes via text signal alone when the body mentions "re-run" (chip path bypassed)', () => {
    const r = assertExplainLeaderStale({
      status: 200,
      body: {
        assistant_text:
          `${NEUTRAL_EXPLAIN_TEXT} Since the graph has been edited since the analysis ran, ` +
          'please re-run analysis to pick up the latest factors.',
        suggested_actions: [],
      },
      elapsed_ms: 100,
    });
    expect(r.ok).toBe(true);
    expect(r.evidence).toMatch(/staleness_text=true/);
  });
});
