/**
 * Unit tests for `pickLatestDecisionReview`.
 *
 * Single critical contract: the helper MUST return the
 * `decision_review` enrichment from the LATEST successful run_analysis
 * fact in `prior_facts` — using the same canonical selector
 * (`selectRunAnalysisFact`) that freshness/projection use. The
 * original PR #190 implementation reverse-walked prior_facts and
 * accidentally picked the OLDEST successful fact (because the loader
 * delivers prior_facts newest-first); Codex flagged this as a stale-
 * pre-edit-evidence leak after edit+rerun. These tests pin the fix.
 */

import { describe, expect, it } from 'vitest';
import type { HandlerFact } from '@talchain/schemas/orchestrator';

import { pickLatestDecisionReview } from '../pick-decision-review.js';

function runAnalysisFact(opts: {
  readonly id: string;
  readonly computed_at?: string;
  readonly decisionReview?: Record<string, unknown> | null;
  readonly noop?: boolean;
  readonly status?: string;
}): HandlerFact {
  const enrichment: Record<string, unknown> = {};
  if (opts.decisionReview !== undefined) {
    enrichment.decision_review = opts.decisionReview;
  }
  if (opts.status !== undefined) {
    enrichment.analysis_status = opts.status;
  }
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: opts.noop ?? false,
    result: {
      scenario_id: '00000000-0000-4000-8000-000000000001',
      leading_option_id: opts.id,
      summary: `Run ${opts.id}`,
      win_probabilities: { 'opt-a': 0.6, 'opt-b': 0.4 },
      ...(opts.computed_at !== undefined ? { computed_at: opts.computed_at } : {}),
      enrichment: Object.keys(enrichment).length > 0 ? enrichment : undefined,
    },
  };
}

const ENH_OLDER = {
  fac_a: { specific_action: 'Older — pull last quarter delivery data.' },
};
const ENH_NEWER = {
  fac_b: { specific_action: 'Newer — pull this quarter delivery data.' },
};

describe('pickLatestDecisionReview', () => {
  it('returns null for an empty array', () => {
    expect(pickLatestDecisionReview([])).toBeNull();
  });

  it('returns null when no run_analysis fact is present', () => {
    const otherFact = {
      fact_type: 'add_constraint',
      fact_version: 1,
      noop: false,
      result: { scenario_id: '00000000-0000-4000-8000-000000000001' },
    } as unknown as HandlerFact;
    expect(pickLatestDecisionReview([otherFact])).toBeNull();
  });

  it('returns null when run_analysis fact has no enrichment.decision_review', () => {
    const fact = runAnalysisFact({ id: 'r1', computed_at: '2026-05-21T10:00:00.000Z' });
    expect(pickLatestDecisionReview([fact])).toBeNull();
  });

  it('returns the decision_review record when present', () => {
    const fact = runAnalysisFact({
      id: 'r1',
      computed_at: '2026-05-21T10:00:00.000Z',
      decisionReview: { produced_at: '2026-05-21T10:00:01.000Z', evidence_enhancements: ENH_NEWER },
    });
    const got = pickLatestDecisionReview([fact]);
    expect(got).not.toBeNull();
    expect(got).toMatchObject({ evidence_enhancements: ENH_NEWER });
  });

  it('CODEX BLOCKER FIX — selects the LATEST run_analysis (by computed_at), NOT the oldest', () => {
    // Loader convention: prior_facts is newest-first (index 0 = newest).
    // The buggy reverse-walk picked index priorFacts.length-1 = OLDEST.
    // The canonical `selectRunAnalysisFact` (used by freshness +
    // projection) sorts by computed_at desc, so the newer fact wins.
    const newer = runAnalysisFact({
      id: 'r2',
      computed_at: '2026-05-21T11:00:00.000Z',
      decisionReview: {
        produced_at: '2026-05-21T11:00:01.000Z',
        evidence_enhancements: ENH_NEWER,
      },
    });
    const older = runAnalysisFact({
      id: 'r1',
      computed_at: '2026-05-21T10:00:00.000Z',
      decisionReview: {
        produced_at: '2026-05-21T10:00:01.000Z',
        evidence_enhancements: ENH_OLDER,
      },
    });
    // Newest-first ordering as the loader delivers it.
    const got = pickLatestDecisionReview([newer, older]);
    expect(got).not.toBeNull();
    expect(got).toMatchObject({ evidence_enhancements: ENH_NEWER });
  });

  it('picks the newest fact regardless of input array ordering', () => {
    // Defensive: even if some upstream change delivered the facts in
    // a different order, the selector's sort-by-computed_at-desc must
    // still pick the newest. Reverses the array from the test above
    // and re-asserts the same outcome.
    const newer = runAnalysisFact({
      id: 'r2',
      computed_at: '2026-05-21T11:00:00.000Z',
      decisionReview: { produced_at: 'x', evidence_enhancements: ENH_NEWER },
    });
    const older = runAnalysisFact({
      id: 'r1',
      computed_at: '2026-05-21T10:00:00.000Z',
      decisionReview: { produced_at: 'x', evidence_enhancements: ENH_OLDER },
    });
    const got = pickLatestDecisionReview([older, newer]);
    expect(got).not.toBeNull();
    expect(got).toMatchObject({ evidence_enhancements: ENH_NEWER });
  });

  it('skips noop run_analysis facts (status=noop is not successful)', () => {
    const noopNewer = runAnalysisFact({
      id: 'r2',
      computed_at: '2026-05-21T11:00:00.000Z',
      noop: true,
      decisionReview: { evidence_enhancements: ENH_NEWER },
    });
    const successOlder = runAnalysisFact({
      id: 'r1',
      computed_at: '2026-05-21T10:00:00.000Z',
      decisionReview: { evidence_enhancements: ENH_OLDER },
    });
    const got = pickLatestDecisionReview([noopNewer, successOlder]);
    expect(got).not.toBeNull();
    // Newer is ineligible (noop), so the older successful fact wins.
    expect(got).toMatchObject({ evidence_enhancements: ENH_OLDER });
  });

  it('skips run_analysis facts with non-success status', () => {
    const failedNewer = runAnalysisFact({
      id: 'r2',
      computed_at: '2026-05-21T11:00:00.000Z',
      status: 'partial',
      decisionReview: { evidence_enhancements: ENH_NEWER },
    });
    const successOlder = runAnalysisFact({
      id: 'r1',
      computed_at: '2026-05-21T10:00:00.000Z',
      decisionReview: { evidence_enhancements: ENH_OLDER },
    });
    const got = pickLatestDecisionReview([failedNewer, successOlder]);
    expect(got).not.toBeNull();
    expect(got).toMatchObject({ evidence_enhancements: ENH_OLDER });
  });

  it('returns null when decision_review is an array (defensive shape parsing)', () => {
    const fact = runAnalysisFact({
      id: 'r1',
      computed_at: '2026-05-21T10:00:00.000Z',
      // @ts-expect-error — intentional malformed payload
      decisionReview: ['not', 'an', 'object'],
    });
    expect(pickLatestDecisionReview([fact])).toBeNull();
  });

  it('returns null when decision_review is null', () => {
    const fact = runAnalysisFact({
      id: 'r1',
      computed_at: '2026-05-21T10:00:00.000Z',
      decisionReview: null,
    });
    expect(pickLatestDecisionReview([fact])).toBeNull();
  });
});
