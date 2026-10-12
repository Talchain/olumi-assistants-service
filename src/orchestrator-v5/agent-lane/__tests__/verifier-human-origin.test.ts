/**
 * Recovery Batch B, S4 W (DL GO 12 Oct; AIE 0825 §2: "do not reattribute a literal human number to an AI estimate simply
 * because role verification failed").
 *
 * Paul's capacity brief (J1 LEVEL_BRIEF, served run 2026-10-12T020148Z) says "Each additional specialist resolves about 20
 * tickets per week, between 10 and 30." If the drafter tags that 20 as an estimate (`inferred` / `ai_proposed`), admission
 * stored it as OLUMI's estimate. C's L3 binding (`factorLevelSpans`) cannot bind a per-specialist rate, and the quote then
 * counted for nothing. Now a quote located once in the brief that writes the literal figure in the factor's own typed
 * frame keeps human origin, role unverified. The denominator may be left implicit (0825 §3).
 *
 * The DL's controls must never gain a VERIFIED current level: target, past, conditional, third party, wrong quantity,
 * period. Their texts are the AIE's own 0825 illustrations, not the builder's.
 */
import { describe, expect, it } from 'vitest';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
import { provenanceOf } from './fixtures/provenance-of-standin.js';

/** DGAI e2e/core/journey/J1-whole-poc.journey.spec.ts LEVEL_BRIEF @40c7b914, verbatim. */
const CAPACITY = 'We are comparing two staffing options, labelled exactly "Keep current staffing" and "Add one specialist". Use the exact goal label "Weekly support capacity". Our existing team resolves 80 tickets per week. Keep current staffing adds no specialist. Add one specialist adds one specialist. Each additional specialist resolves about 20 tickets per week, between 10 and 30. Total weekly support capacity is defined as the existing 80 tickets per week plus the additional specialist capacity. Goal: weekly support capacity of at least 100 tickets per week. This target is an absolute level, with no deadline.';
const PAUL = 'Each additional specialist resolves about 20 tickets per week, between 10 and 30.';
const RATE = { label: 'Tickets per specialist per week', unit: 'tickets per week per specialist', plausible_max: 50 };
const TEAM = { label: 'Existing team capacity', unit: 'tickets per week', plausible_max: 300 };

type Tag = 'explicit' | 'inferred' | 'ai_proposed';
function stored(brief: string, f: { label: string; unit: string; plausible_max: number }, value: number, quote: string, tag: Tag) {
  const model = {
    goal: { metric: 'Weekly support capacity', operator: '>=', target_stated: true, frame: 'level', value: 100, unit: 'tickets per week',
      horizon_months: null, provenance: 'explicit', baseline_known: false, baseline_value: null, baseline_provenance: null, scope: null },
    constraints: [], risks: [], outcomes: [], unknowns: [], links: [], options: [],
    factors: [{ ...f, role: 'observable', baseline_known: tag === 'explicit', baseline_value: value, provenance: tag, baseline_evidence: { quote } }],
  } as unknown as CandidateModel;
  const node = admitCandidateModel(model, {}, brief).nodes.find(n => n.kind === 'factor') as { observed_state?: Record<string, unknown> };
  return { ...provenanceOf(node.observed_state), raw: node.observed_state?.raw_value };
}

describe('W: Paul\'s literal "about 20" keeps human origin whatever the drafter\'s tag', () => {
  it('POSITIVE CONTROL (first): tagged explicit, it is the user\'s claim, role unverified, raw 20', () => {
    expect(stored(CAPACITY, RATE, 20, PAUL, 'explicit')).toEqual({ origin: 'human', role: 'unverified', raw: 20 });
  });
  for (const tag of ['inferred', 'ai_proposed'] as const) {
    it(`RED at 230d904: tagged ${tag}, it is still the user's (origin human, role unverified), never Olumi's estimate`, () => {
      expect(stored(CAPACITY, RATE, 20, PAUL, tag)).toEqual({ origin: 'human', role: 'unverified', raw: 20 });
    });
  }
});

describe('W controls: a figure the user did not write for this frame stays Olumi\'s when the drafter calls it an estimate', () => {
  const variant = (sentence: string) => CAPACITY.replace(PAUL, sentence);
  it('a value the quote never writes (35)', () => {
    expect(stored(CAPACITY, RATE, 35, PAUL, 'inferred').origin).toBe('ai');
  });
  it('another noun: "about 20 calls per week" for a tickets factor', () => {
    const s = 'Each additional specialist handles about 20 calls per week, between 10 and 30.';
    expect(stored(variant(s), RATE, 20, s, 'inferred').origin).toBe('ai');
  });
  it('another period: "about 20 tickets per day" for a per-week factor (0825 V2-period: no calendar conversion)', () => {
    const s = 'Each additional specialist resolves about 20 tickets per day, between 10 and 30.';
    expect(stored(variant(s), RATE, 20, s, 'inferred').origin).toBe('ai');
  });
  it('another written denominator: "per week per team" for a per-specialist factor', () => {
    const s = 'Each additional specialist resolves about 20 tickets per week per team, between 10 and 30.';
    expect(stored(variant(s), RATE, 20, s, 'inferred').origin).toBe('ai');
  });
  it('a quote that is not a sentence of the brief, where the brief writes no such figure', () => {
    const s = 'Each additional specialist resolves some tickets per week.';
    expect(stored(variant(s), RATE, 20, 'Specialists resolve about 20 tickets per week.', 'inferred').origin).toBe('ai');
  });
  it('S4 V2 origin (DL ruling (b)): a quote that is not a sentence of the brief, where the BRIEF writes "about 20 tickets per week" in the frame: the user\'s', () => {
    expect(stored(CAPACITY, RATE, 20, 'Specialists resolve about 20 tickets per week.', 'inferred')).toEqual({ origin: 'human', role: 'unverified', raw: 20 });
  });
});

describe('the DL\'s controls never gain a VERIFIED current level (AIE 0825 illustrations, verbatim)', () => {
  const controls: [string, string][] = [
    ['target (V2-goal)', 'Our target is to resolve 80 tickets per week.'],
    ['past (V2-historical)', 'Last year our team resolved 80 tickets per week.'],
    ['conditional (V2-hypothetical)', 'If our team resolved 80 tickets per week, the backlog would shrink.'],
    ['third party (V2-third-party)', 'The supplier says “our team resolves 80 tickets per week”.'],
    ['wrong quantity (V2-other-quantity)', 'Our competitor resolves 80 tickets per week.'],
    ['period (V2-period)', 'Our existing team resolves 80 tickets per day.'],
  ];
  for (const [name, sentence] of controls) for (const tag of ['explicit', 'inferred'] as const) {
    it(`${name}, tagged ${tag}: never a verified current level`, () => {
      const got = stored(`We are deciding on support staffing. ${sentence}`, TEAM, 80, sentence, tag);
      expect(got.role).not.toBe('verified');
    });
  }
});
