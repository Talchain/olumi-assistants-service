/**
 * ⛔ SCIENCE C1 (AIE-signed table 6180618773; DL rulings 15 Oct 00:39Z / 00:40Z): a bare range is not a calibrated central
 * 90% Normal interval, and a range excluding zero does not prove the link exists. A Run recorded while a user's range held
 * (existence 1, spread width/3.29) is therefore STALE, and it says why truthfully: the user changed nothing, so never
 * "computed before this change". Its recorded hash still validates the Run as immutable history ('pre_c1'), and the re-run
 * sends the corrected input (the stored existence and spread at the stated size).
 *
 * BRIEF 1 (real wire): waveB9 t1b df15c8c turn 002's draft graph. The brief stated "Each 1% price rise loses about 2
 * customers, between 1 and 4." and the drafter kept that range on the link. BRIEF 2: the served c96fc4bb pricing graph,
 * its paying-subscribers → MRR link given a user range (the PLoT wire harness `held-user-links.test.ts` uses).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { staleOnlyByRangeReading, staleResultLine, staleBlockerOf } from '../write-outcome.js';
import { nextStepBlockerForAgent } from '../next-step-blocker.js';
import { deriveDecisionContextGraphHash } from '../../build-turn-context.js';
import { matchesHistoricalAnalysisIdentity } from '../../context/graph-identity.js';
import { computeAnalysisAffectingGraphHashSha256 } from '../../context/graph-hash.js';
import { canonicaliseForAnalysis } from '../../tools/handlers/analysis-ready-core.js';
import { endsOfGraph, heldLinkOf, withHeldUserLinks } from '../../goal-target/held-user-links.js';

type Rec = Record<string, any>;
const fixture = (rel: string): Rec => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8')) as Rec;
const B9 = fixture('./fixtures/waveB9-t1b-df15c8c-run1-turn002.json').draft_graph as Rec;
const B9_LINK = (g: Rec): Rec => g.edges.find((e: Rec) => e.from === 'price_rise_from_current_price' && e.to === 'customers_lost_from_price_rise');
const pricing = (): Rec => {
  const g = structuredClone(fixture('../../../../tests/fixtures/served/c96fc4bb-saved-graph.json').graph as Rec);
  const e = g.edges.find((x: Rec) => x.from === 'paying_subscribers' && x.to === 'mrr');
  e.strength = { mean: 0.3, std: 0.15 };
  e.exists_probability = 0.8;
  e.provenance = { source: 'user_specified', magnitude: 'user_stated', natural_effect: { amount: 20, amount_unit: 'subscribers',
    per_source_change: 1, per_source_change_unit: '£', strength_mean: 0.3, strength_mean_frame: 'edge_strength',
    stated_range: { low: 20, high: 40, text: '20 to 40', end: 'low' } } };
  return g;
};
const BRIEFS: ReadonlyArray<readonly [string, () => Rec, (g: Rec) => Rec]> = [
  ['brief 1 (waveB9: "between 1 and 4")', () => structuredClone(B9), B9_LINK],
  ['brief 2 (c96fc4bb pricing: "20 to 40")', pricing, (g) => g.edges.find((x: Rec) => x.from === 'paying_subscribers' && x.to === 'mrr')],
];

// The served approve turn's typed stale state (CEE e3b0844), reused as the stale read: complete_stale, graph_changed, rerun.
const STALE = fixture('./fixtures/served-approve-stale-e3b0844.json').analysis_state as Rec;
const RANGE_RERUN = 'The analysis on screen treated a range you gave as a calibrated 90% interval and the link as certain to exist. '
  + 'Olumi no longer assumes either from a range alone, so run it again to see the result without that assumption.';
const EDIT_RERUN = 'The analysis on screen was computed before this change; run it again to see the comparison with this change.';
const runAt = (hash: string | null): Rec => ({ type: 'analysis_result', computed_against_hash: hash });

describe.each(BRIEFS)('C1 on %s', (_name, graphOf, linkOf) => {
  it('PRECONDITION: the link is the user\'s and carries its own range off zero', () => {
    const e = linkOf(graphOf());
    expect(e.provenance.natural_effect.stated_range.low * e.provenance.natural_effect.stated_range.high).toBeGreaterThan(0);
  });

  it('a Run recorded under the range hold is STALE now (pre_c1 ≠ current) yet still validates as that Run\'s history', () => {
    const g = graphOf();
    const preC1 = deriveDecisionContextGraphHash(g, 'pre_c1');
    expect(preC1).not.toBeNull();
    expect(deriveDecisionContextGraphHash(g)).not.toBe(preC1);
    const recorded = computeAnalysisAffectingGraphHashSha256(canonicaliseForAnalysis(g) as never, 'pre_c1')!;
    expect(matchesHistoricalAnalysisIdentity(canonicaliseForAnalysis(g) as never, recorded)).toBe(true);
  });

  it('its stale reason reads TRUTHFULLY: the range reading, never "computed before this change"', () => {
    const g = graphOf();
    const old = runAt(deriveDecisionContextGraphHash(g, 'pre_c1'));
    expect(staleOnlyByRangeReading(g, old)).toBe(true);
    expect(staleResultLine(STALE, { may_run: true }, staleOnlyByRangeReading(g, old))).toBe(RANGE_RERUN);
    // The one next step the agent lane offers on this read says the same.
    expect(nextStepBlockerForAgent({ raw: g, analysis_state: STALE, analysis_ready: { may_run: true }, analysis_result: old }))
      .toEqual({ kind: 'stale', say: RANGE_RERUN });
  });

  it('CONTRAST: a Run stale because the USER edited the model (another size) keeps "computed before this change"', () => {
    const g = graphOf();
    const old = runAt(deriveDecisionContextGraphHash(g, 'pre_c1'));
    const edited = structuredClone(g);
    linkOf(edited).strength.mean = linkOf(edited).strength.mean * 2;
    expect(staleOnlyByRangeReading(edited, old)).toBe(false);
    expect(staleBlockerOf(STALE, { may_run: true }, staleOnlyByRangeReading(edited, old))).toEqual({ kind: 'stale', say: EDIT_RERUN });
  });

  it('the RE-RUN sends the corrected input (stored existence and spread at the stated size) and is current, so no stale line', () => {
    const g = graphOf();
    const sent = linkOf(withHeldUserLinks(g));
    const stored = linkOf(g);
    expect({ std: sent.strength.std, mean: sent.strength.mean }).toEqual({ std: stored.strength.std, mean: stored.strength.mean });
    // Existence: the stored value, unless rule R (route-once, existence only) holds the link; never the range.
    const hold = heldLinkOf(stored, endsOfGraph(g)(stored));
    expect(hold?.reason).not.toBe('user_range');
    expect(sent.exists_probability).toBe(hold === null ? stored.exists_probability : 1);
    expect(heldLinkOf(stored, endsOfGraph(g, 'pre_c1')(stored), 'pre_c1')?.reason, 'what the old Run sent').toBe('user_range');
    const rerun = runAt(deriveDecisionContextGraphHash(g));
    expect(staleOnlyByRangeReading(g, rerun)).toBe(false);
  });
});

describe('C1 stale line: the boundaries', () => {
  it('a run that may not run: the range sentence alone, no "run it again"', () => {
    expect(staleResultLine(STALE, { may_run: false }, true)).toBe(
      'The analysis on screen treated a range you gave as a calibrated 90% interval and the link as certain to exist. '
      + 'Olumi no longer assumes either from a range alone.');
  });
  it('no recorded hash, or no graph → never claimed (the ordinary line stands)', () => {
    expect(staleOnlyByRangeReading(structuredClone(B9), runAt(null))).toBe(false);
    expect(staleOnlyByRangeReading(structuredClone(B9), undefined)).toBe(false);
    expect(staleOnlyByRangeReading(null, runAt('0123456789abcdef'))).toBe(false);
  });
  it('a model with no ranged user link: pre_c1 = current, so a Run on it is never called range-stale', () => {
    const g = structuredClone(B9);
    delete B9_LINK(g).provenance.natural_effect.stated_range;
    const h = deriveDecisionContextGraphHash(g);
    expect(deriveDecisionContextGraphHash(g, 'pre_c1')).toBe(h);
    expect(staleOnlyByRangeReading(g, runAt(h))).toBe(false);
  });
});
