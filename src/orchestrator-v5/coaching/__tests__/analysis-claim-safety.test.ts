/**
 * Minimal claim-safety guards for the V5 context-reliability lane.
 *
 * Scope (NOT the full Brief 5 cage): prove that the context/coaching
 * consumers of OPTIONAL analysis fields
 *   (a) keep missing fields MISSING (null / [] / 'unknown'), never coerced to a
 *       fabricated zero or a fabricated "present" value, and
 *   (b) never REHYDRATE unavailable confidence / robustness / EVPI / E-value /
 *       sensitivity fields from internal carriers (`_meta`, downstream_calls)
 *       into the projection prose consumes.
 *
 * The two `?? 0` sites the audit surfaced
 *   (analysis-result-headline.ts switch_probability, decision-review-enricher
 *    win_probability) run at run_analysis time (fresh by construction) and use
 * the 0 only as a ranking/projection sentinel, never as a surfaced claim — so
 * they get regression COVERAGE here, not a code change.
 */
import { describe, expect, it } from 'vitest';
import { buildAnalysisResultHeadline } from '../analysis-result-headline.js';

// Deletion 10 (22 Oct 2026): the two describes that pinned the prior-facts
// summary builder (`buildAnalysisFromPriorFacts`: missing fields stay missing,
// no rehydration from `_meta`) were deleted with it — nothing read its summary.

describe('claim-safety — the `?? 0` audit sites do not fabricate a surfaced claim', () => {
  it('headline: a fragile edge missing switch_probability does not crash or fabricate a "0" claim', () => {
    // The `?? 0` at analysis-result-headline.ts is a RANKING sentinel for
    // picking the most-fragile edge label; it must never surface as a "0%" claim.
    const fact = {
      enrichment: {
        option_comparison: [
          { option_id: 'opt_a', option_label: 'Plan A', win_probability: 0.7 },
          { option_id: 'opt_b', option_label: 'Plan B', win_probability: 0.3 },
        ],
        robustness: {
          robustness_level: 'low',
          // fragile edge WITHOUT switch_probability — exercises the `?? 0` site.
          fragile_edges: [{ edge_id: 'e1', from_label: 'Cost', to_label: 'Goal' }],
        },
      },
      leading_option_id: 'opt_a',
      status_kind: 'ok' as const,
    };
    const headline = buildAnalysisResultHeadline(fact);
    // Either a safe string or null — never a throw.
    expect(headline === null || typeof headline === 'string').toBe(true);
    if (typeof headline === 'string') {
      // No fabricated zero-probability claim leaked into user-facing prose.
      //
      // ⚠ BOUND BY IDENTITY, NOT BY SUBSTRING. This assertion read
      // `not.toContain('0%')` until the headline began stating the leader's own
      // win probability — at which point a perfectly honest "70%" failed it,
      // because "0%" is a substring of "70%". The assertion had always been a
      // value predicate another string could satisfy (CLAUDE.md trap 19); it
      // simply had no counter-example until now. Anchored on the word boundary
      // so it catches the fabricated zero it was written for and nothing else.
      expect(headline).not.toMatch(/(?<!\d)0%/);
      expect(headline).not.toMatch(/\b0(\.0+)?\s*%/);
    }
  });
});
