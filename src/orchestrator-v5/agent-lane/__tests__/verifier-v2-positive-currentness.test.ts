/**
 * Recovery Batch B, S4 V2 (AIE 0825 §2–§3; #94 6122028727): positive ownership and currentness on the drafter's REAL
 * output for Paul's capacity brief, and (origin commit, DL ruling (b)) human origin for a figure the brief writes when the
 * drafter cites nothing: b33bf531 tagged Paul's 20 `ai_proposed` with no quote.
 *
 * `fixtures/capacity-served-drafts-20261011.json` holds the nine served drafts of the capacity level brief (staging
 * 11–12 Oct, builds 50530b5f / c87608e4 / c85817f2), read SELECT-only from `cee_drafter_raw_responses` with each raw text's
 * server-side sha256. Before V2, Paul's 80 ("Our existing team resolves 80 tickets per week.") was verified on 0 of 9:
 * "resolves" is not one of `ownsFactorLevel`'s finite STATE_VERBS, and the brief restates the 80 ("…defined as the existing
 * 80 tickets per week…"). On b33bf531 the drafter tagged Paul's 20 `ai_proposed` with no quote, so it was stored as
 * Olumi's estimate.
 *
 * Every figure is admitted through the real `admitCandidateModel`. The stored `observed_state` is read through the
 * provenanceOf stand-in ({origin, role}, DL-adopted R). The contrasts below are design controls for each new mechanism;
 * the served drafts are the evidence about the wire.
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
import { provenanceOf, type Provenance } from './fixtures/provenance-of-standin.js';

type Rec = Record<string, any>;
const fx = JSON.parse(readFileSync(new URL('./fixtures/capacity-served-drafts-20261011.json', import.meta.url), 'utf8')) as {
  brief: string; drafts: { scenario_id: string; cee_build: string; raw_sha256: string; candidate: Rec }[] };
const BRIEF = fx.brief;
const BRIEF_SHA256 = 'c5f2dacf88474c22ba4f84d82d1a5e5eb6904485cda15d7946490fd33bccef4f';
/** The binder cannot bind the 80 where the draft's rival label repeats its verb ("Tickets resolved per specialist…"). */
const RIVAL_VERB_LABEL = new Set(['c2a3f477-f3cf-4092-a286-388794963c57', '14b66c8e-5016-4414-807e-27412c92107a']);
/** The draft that tagged Paul's 20 `ai_proposed` and cited nothing (DL ruling (b), origin commit). */
const UNCITED_AI_TAGGED = 'b33bf531-af92-4a2f-9b67-fa32ee8a8f9a';

function stored(model: Rec, brief: string, value: number): Provenance {
  const factor = (model.factors as Rec[]).find(f => f.baseline_value === value)!;
  const nodes = admitCandidateModel(structuredClone(model) as unknown as CandidateModel, {}, brief).nodes as unknown as Rec[];
  const node = nodes.find(n => n.kind === 'factor' && n.label === factor.label);
  expect(node, `admitted factor "${factor.label}"`).toBeDefined();
  return provenanceOf(node!.observed_state);
}
const VERIFIED = { origin: 'human', role: 'verified' };
const UNVERIFIED = { origin: 'human', role: 'unverified' };

describe('the served capacity drafts (the wire)', () => {
  it('IDENTITY: nine drafts of Paul\'s brief, byte for byte as served', () => {
    expect(createHash('sha256').update(BRIEF).digest('hex')).toBe(BRIEF_SHA256);
    expect(fx.drafts).toHaveLength(9);
    for (const d of fx.drafts) {
      expect(d.raw_sha256).toHaveLength(64);
      const f80 = (d.candidate.factors as Rec[]).filter(f => f.baseline_value === 80);
      expect(f80.map(f => f.baseline_evidence?.quote), d.scenario_id).toEqual(['Our existing team resolves 80 tickets per week.']);
    }
  });

  for (const d of fx.drafts) {
    const binds = !RIVAL_VERB_LABEL.has(d.scenario_id);
    it(`${d.scenario_id.slice(0, 8)} (${d.cee_build.slice(0, 8)}): Paul's 80 is ${binds ? 'the user\'s VERIFIED current level' : 'the user\'s, role unverified (stated residual: the binder)'}`, () => {
      expect(stored(d.candidate, BRIEF, 80)).toEqual(binds ? VERIFIED : UNVERIFIED);
    });
    it(`${d.scenario_id.slice(0, 8)}: Paul's 20 is the user's, role unverified (an estimated contribution per additional specialist), never Olumi's`, () => {
      expect(stored(d.candidate, BRIEF, 20)).toEqual(UNVERIFIED);
    });
  }
});

const served = fx.drafts.find(d => d.scenario_id.startsWith('cd3d9c25'))!.candidate;
describe('in Paul\'s brief, the 80 stays withheld when a neighbour really qualifies it', () => {
  it('POSITIVE CONTROL: the served brief verifies it', () => {
    expect(stored(served, BRIEF, 80)).toEqual(VERIFIED);
  });
  for (const [name, from, to] of [
    ['the restatement carries no present-state marker', 'the existing 80 tickets per week', 'the planned 80 tickets per week'],
    ['the restatement is in another period', 'the existing 80 tickets per week', 'the existing 80 tickets per month'],
    ['the "restatement" names another quantity (typed-level-span RUN8)', 'the existing 80 tickets per week', 'the existing 80 escalation tickets per week'],
    ['the next sentence\'s "no" quantifies the credited quantity itself', 'Keep current staffing adds no specialist.', 'Keep current staffing adds no tickets.'],
  ] as const) {
    it(`withheld: ${name}`, () => {
      expect(BRIEF).toContain(from);
      expect(stored(served, BRIEF.replace(from, to), 80)).toEqual(UNVERIFIED);
    });
  }
});

function alone(sentence: string, label: string, unit: string, value: number): Rec {
  return {
    goal: { metric: 'Overall outcome', value: null, unit: null, operator: '>=', horizon_months: null, provenance: 'explicit' },
    constraints: [], options: [], outcomes: [], risks: [], links: [],
    factors: [{ label, baseline_value: value, unit, baseline_known: true, provenance: 'explicit', role: 'observable',
      plausible_max: value * 10, baseline_evidence: { quote: sentence } }],
  };
}
const level = (sentence: string, label = 'Existing team capacity', unit = 'tickets per week', value = 80): Provenance =>
  stored(alone(sentence, label, unit, value), sentence, value);

describe('positive ownership and currentness: who, current, and nothing that governs it otherwise', () => {
  it('POSITIVE: first-person owner, the shared present-state marker "existing", one predicate word', () => {
    expect(level('Our existing team resolves 80 tickets per week.')).toEqual(VERIFIED);
  });
  it('POSITIVE: "right now" after the figure; the unit noun "claims" is the quantity, not an attribution (corpus X02)', () => {
    expect(level('The dashboard calls it "throughput": we\'re processing 1,400 claims per week right now.',
      'Claims processed per week', 'claims per week', 1400)).toEqual(VERIFIED);
  });
  for (const [name, sentence] of [
    ['no present-state marker', 'Our team resolves 80 tickets per week.'],
    ['no first-person owner (whose team?)', 'The existing team resolves 80 tickets per week.'],
    ['a desire lead governs it (the shared occurrence reader)', 'Our existing team needs 80 tickets per week.'],
    ['a target verb governs it', 'We\'re currently targeting 80 tickets per week.'],
    ['past', 'Our existing team was resolving 80 tickets per week.'],
    ['past, read by the shared occurrence reader alone', 'Our existing team was at 80 tickets per week.'],
    ['a regular past predicate', 'Our existing team resolved 80 tickets per week.'],
    ['conditional', 'Our existing team resolves 80 tickets per week if nobody leaves.'],
    ['conditional, read by the shared occurrence reader alone', 'Our existing team resolves 80 tickets per week, assuming nobody leaves.'],
    ['a third party owns it', 'Their existing team resolves 80 tickets per week.'],
    ['a fronted frame, not the owner, opens the clause', 'In the imagined setup, our existing team resolves 80 tickets per week.'],
    ['two open words before the figure', 'Our existing team rarely resolves 80 tickets per week.'],
    ['a rival entity in the subject (b5-signed-share\'s rule)', 'Our pub team is at 80 tickets per week.'],
    ['another period', 'Our existing team resolves 80 tickets per month.'],
    ['another quantity', 'Our existing team resolves 80 calls per week.'],
  ] as const) {
    it(`withheld, the user's unverified claim: ${name}`, () => {
      expect(level(sentence)).toEqual(UNVERIFIED);
    });
  }
  it('withheld: an attribution verb that happens to spell the unit noun still attributes', () => {
    expect(level('The insurer claims: we\'re processing 1,400 claims per week right now.',
      'Claims processed per week', 'claims per week', 1400)).toEqual(UNVERIFIED);
  });
});

describe('origin commit (DL ruling (b)): a literal figure the brief writes in the factor\'s frame is never Olumi\'s', () => {
  it('b33bf531, BOUND BY NODE ID: Paul\'s uncited ai_proposed 20 is the user\'s, role unverified', () => {
    const d = fx.drafts.find(x => x.scenario_id === UNCITED_AI_TAGGED)!;
    const drafted = (d.candidate.factors as Rec[]).find(f => f.label === 'Specialist capacity')!;
    expect([drafted.provenance, drafted.baseline_known, drafted.baseline_evidence], 'as served').toEqual(['ai_proposed', false, null]);
    const nodes = admitCandidateModel(structuredClone(d.candidate) as unknown as CandidateModel, {}, BRIEF).nodes as unknown as Rec[];
    const node = nodes.find(n => n.id === 'specialist_capacity');
    expect(node?.label).toBe('Specialist capacity');
    expect(node?.observed_state?.raw_value).toBe(20);
    expect(provenanceOf(node?.observed_state)).toEqual(UNVERIFIED);
  });
  const uncited = (sentence: string, label = 'Specialist capacity', unit = 'tickets per week per specialist', value = 20): Rec => ({
    ...alone(sentence, label, unit, value),
    factors: [{ label, baseline_value: value, unit, baseline_known: false, provenance: 'ai_proposed', role: 'observable',
      plausible_max: 50, baseline_evidence: null }],
  });
  it('POSITIVE: Paul\'s sentence, drafted as b33bf531 drafted it', () => {
    const s = 'Each additional specialist resolves about 20 tickets per week, between 10 and 30.';
    expect(stored(uncited(s), s, 20)).toEqual(UNVERIFIED);
  });
  for (const [name, sentence, label, unit] of [
    ['the brief writes another period', 'Each additional specialist resolves about 20 tickets per month, between 10 and 30.', undefined, undefined],
    ['the sentence names nothing of the factor', 'Each new hire resolves about 20 tickets per week, between 10 and 30.', undefined, undefined],
    ['the figure is a bound', 'Each additional specialist must handle at least 20 tickets per week.', undefined, undefined],
    ['the same number is another quantity ("20 staff" for a % factor)', 'We have 20 staff.', 'Staff utilisation', '%'],
  ] as const) {
    it(`stays Olumi's estimate: ${name}`, () => {
      expect(stored(uncited(sentence, label, unit), sentence, 20)).toEqual({ origin: 'ai', role: null });
    });
  }
});
