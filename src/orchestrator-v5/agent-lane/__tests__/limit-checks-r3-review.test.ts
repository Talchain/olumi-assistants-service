import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { targetTestabilityOf } from '../../admission/target-testability.js';
import { verifyJ3, verifyIdentity, verifyCertaintyEdges, verifyTargetBytes, verifyNamedGraphs, verifyUserStampExclusions } from '../../../../tools/limit-check-replay/r3-cases.js';
import { verifyHandler } from '../../../../tools/limit-check-replay/handler-r3.js';

describe('L1 R3 independent-review regressions, with captured graph bytes', () => {
  it('P1: J3 user-confirmed 3 customers per 1% stays sized and its second limit stays scored', () => {
    expect(verifyJ3).not.toThrow();
  });
  it('P1 controls: user stamps on Olumi estimates and projected means remain withheld', () => {
    expect(verifyUserStampExclusions).not.toThrow();
  });
  it('P2-1: limits require THIS Run’s evaluation, even on a declared product', async () => {
    await expect(verifyIdentity()).resolves.toBeUndefined();
  });
  it('P2-1: real Run handler passes the response evaluations to both score and verdict folds', async () => {
    await expect(verifyHandler()).resolves.toBeUndefined();
  });
  it('P2-1 control: existing target-testability fixtures stay byte-identical', () => {
    // Science §(i) amendment (A): "case (c) stops blocking on a link whose size is an Olumi ESTIMATE with a natural
    // effect that converts into goal units." The replay pins only the three named goal-converting pairs removed by that rule.
    expect(verifyTargetBytes).not.toThrow();
  });
  it.each([
    ['paul', 'fundraising_overhead', 'investment_firm_outreach'],
    ['mrr', 'monthly_churn', 'pro_paying_subscribers'],
    ['mrr', 'pro_plan_monthly_price', 'monthly_churn'],
    ['n1', 'triage_automation_rate', 'median_first_response_time'],
  ])('amendment (A) CONTRAST: %s %s→%s still blocks as a placeholder or non-converting estimate', (key, from, to) => {
    const fixtures = JSON.parse(readFileSync(new URL('../../admission/__tests__/fixtures/target-testability-20260930.json', import.meta.url), 'utf8'));
    for (const kind of ['placeholder', 'non-converting estimate']) {
      const g = structuredClone(fixtures[key]);
      const e = g.edges.find((x: Record<string, any>) => x.from === from && x.to === to);
      if (kind === 'placeholder') { e.provenance.magnitude = 'olumi_placeholder'; e.strength.defaulted = true; }
      else delete e.provenance.natural_effect;
      const v = targetTestabilityOf(g);
      expect(v.kind === 'not_testable' && v.failures.find(f => f.case === 'c')?.links, kind).toContainEqual({ from, to });
    }
  });
  it('P2-2a: the real two-child mediator requires edges at the certainty sizedLinkTest call', () => {
    expect(verifyCertaintyEdges).not.toThrow();
  });
  it('reviewer’s three sentence-change captures stay checked without writing their bytes', () => {
    expect(verifyNamedGraphs).not.toThrow();
  });
  it('P2-2b: actual saved/Explain route passes analysis_identity_evaluated_node_ids into limit_checks at agent-v1-turn.ts:2635', () => {
    const result = execFileSync(process.execPath, ['--import', 'tsx', 'tools/limit-check-replay/route-r3.ts'], { encoding: 'utf8', timeout: 30_000 });
    expect(result).toContain('Explain route evaluated GREEN');
    expect(result).toContain('Explain route declaration-only GREEN');
    // The child imports the whole route under tsx: 1.6–2.4 s locally, over vitest's 5 s default on a CI runner (S4c #2729
    // Required 3/5, 7 Oct). Bounded by the child's own 30 s timeout instead.
  }, 35_000);
});
