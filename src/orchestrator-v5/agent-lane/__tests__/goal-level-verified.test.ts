/**
 * Recovery Batch B (DL 12 Oct 13:3xZ, a B value item): the GOAL's stated current level was written at admission as
 * `brief_extraction` with no extractionType and no user-text check (`briefGoalObservedState`), which C's positive
 * attestation reads as stamp-only: Paul's chances would say "This result uses inputs whose sources have not been verified."
 * even where he typed the figure. Now the write goes through V2's existing verification:
 *   - ORIGIN: the brief writes the figure in the goal's frame, in a sentence naming the goal (the origin rule's reader);
 *   - ROLE: the same figure, in the goal's typed unit, is V2's VERIFIED current level of a factor of this model
 *     (`verifiedFactorLevel`: first-person owner, present-state marker, positive attestation only).
 * Verified → extractionType 'explicit'. Otherwise the level stays exactly as written before (no new refusal, no new ask).
 *
 * The wire: the nine served drafts of Paul's capacity level brief (`fixtures/capacity-served-drafts-20261011.json`).
 * Paul's brief: "Our existing team resolves 80 tickets per week. … Total weekly support capacity is defined as the existing
 * 80 tickets per week plus the additional specialist capacity." The hiring brief's goal is a CHANGE (+10% productivity)
 * with no level on any of its 12 served drafts (SELECT-only, `cee_drafter_raw_responses`), so this site writes nothing there.
 */
import { describe, expect, it } from 'vitest';
import cap from './fixtures/capacity-served-drafts-20261011.json';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
import { provenanceOf } from './fixtures/provenance-of-standin.js';

type Rec = Record<string, any>;
/** V2's stated residual: the binder cannot bind the 80 where the rival label repeats its verb. */
const RIVAL_VERB_LABEL = new Set(['c2a3f477-f3cf-4092-a286-388794963c57', '14b66c8e-5016-4414-807e-27412c92107a']);
const OWN = 'Our existing team resolves 80 tickets per week.';
const DEFINED = 'Total weekly support capacity is defined as the existing 80 tickets per week plus the additional specialist capacity.';

function goal(candidate: Rec, brief: string): Rec | undefined {
  const nodes = admitCandidateModel(structuredClone(candidate) as unknown as CandidateModel, {}, brief).nodes as unknown as Rec[];
  return nodes.find(n => n.kind === 'goal')?.observed_state;
}

describe('the goal\'s stated level goes through V2\'s verification (the served capacity drafts)', () => {
  it('IDENTITY: the brief writes both sentences; eight drafts tag the goal level explicit, one inferred', () => {
    expect(cap.brief).toContain(OWN);
    expect(cap.brief).toContain(DEFINED);
    expect(cap.drafts.map(d => d.candidate.goal.baseline_value)).toEqual(Array(9).fill(80));
    expect(cap.drafts.filter(d => d.candidate.goal.baseline_provenance === 'explicit')).toHaveLength(8);
  });
  for (const d of cap.drafts) {
    const explicit = d.candidate.goal.baseline_provenance === 'explicit';
    const binds = !RIVAL_VERB_LABEL.has(d.scenario_id);
    const expected = !explicit ? 'withheld as before (the drafter tagged it inferred: a stated finding, not this item)'
      : binds ? 'VERIFIED: extractionType explicit, the user\'s current level' : 'as before (V2\'s binder residual): no extractionType';
    it(`${d.scenario_id.slice(0, 8)}: Paul's goal level 80 is ${expected}`, () => {
      const os = goal(d.candidate, cap.brief);
      if (!explicit) { expect(os).toBeUndefined(); return; }
      expect([os?.raw_value, os?.source]).toEqual([80, 'brief_extraction']);
      expect(os?.extractionType).toBe(binds ? 'explicit' : undefined);
      if (binds) expect(provenanceOf(os)).toEqual({ origin: 'human', role: 'verified' });
    });
  }
});

describe('controls: a goal level nothing verifies is written exactly as before', () => {
  const served = cap.drafts.find(d => d.scenario_id.startsWith('b33bf531'))!.candidate;
  it('POSITIVE CONTROL: the same draft, Paul\'s brief: verified', () => {
    expect(goal(served, cap.brief)?.extractionType).toBe('explicit');
  });
  // The unit check in `verifiedGoalLevel` is defence in depth: V2's neighbour rule already withholds a factor whose figure
  // the goal's sentence writes as another quantity (measured here), so its mutant survives. Kept for C's rebase.
  it('stays as before: the only 80 the user owns is another quantity (80 people), which V2 itself withholds', () => {
    const own = 'Our existing team currently has 80 people.';
    const c = structuredClone(served) as Rec;
    const f = (c.factors as Rec[]).find(x => x.baseline_value === 80)!;
    Object.assign(f, { label: 'Existing team headcount', unit: 'people', baseline_evidence: { quote: own } });
    const brief = cap.brief.replace(OWN, own);
    const nodes = admitCandidateModel(structuredClone(c) as unknown as CandidateModel, {}, brief).nodes as unknown as Rec[];
    expect(provenanceOf(nodes.find(n => n.label === 'Existing team headcount')?.observed_state), 'V2 withholds it: the goal sentence writes 80 tickets')
      .toEqual({ origin: 'human', role: 'unverified' });
    const os = goal(c, brief);
    expect(os?.source).toBe('brief_extraction');
    expect(os?.extractionType).toBeUndefined();
  });
  it('stays as before: the goal\'s 80 is in another period from the verified factor\'s (per day vs per week)', () => {
    const c = structuredClone(served) as Rec; c.goal.unit = 'tickets per day';
    const brief = cap.brief.replace(DEFINED, DEFINED.replace('80 tickets per week', '80 tickets per day'));
    const os = goal(c, brief);
    expect(os?.source).toBe('brief_extraction');
    expect(os?.extractionType).toBeUndefined();
  });
  for (const [name, brief] of [
    ['a drafted-only level: the brief never writes the 80', cap.brief.replace(OWN, '').replace(DEFINED, 'Total weekly support capacity is the existing capacity plus the additional specialist capacity.')],
    ['a third party owns the 80 ("Their existing team …")', cap.brief.replace(OWN, 'Their existing team resolves 80 tickets per week.')],
    ['the 80 is past ("Last year our existing team resolved …")', cap.brief.replace(OWN, 'Last year our existing team resolved 80 tickets per week.')],
    ['the goal sentence writes no 80, only the factor sentence does', cap.brief.replace(DEFINED, 'Total weekly support capacity is defined as the existing capacity plus the additional specialist capacity.')],
  ] as const) {
    it(`stays as before (brief_extraction, no extractionType): ${name}`, () => {
      expect(brief).not.toBe(cap.brief);
      const os = goal(served, brief);
      expect(os?.source).toBe('brief_extraction');
      expect(os?.extractionType).toBeUndefined();
    });
  }
});
