/**
 * Recovery Batch B, Row5 (DL 12 Oct): a range the user states for a figure they wrote survives construction onto its
 * node, as L6's carrier (`observed_state.range`, `isStatedLevelRange`): both ends in the ONE sentence that writes the
 * figure, the figure inside, in the figure's frame, authored by the user. It changes no compute: the analysis wire copy
 * drops it (`withoutStatedLevelRanges`, L6).
 *
 * The wire: the nine served drafts of Paul's capacity level brief ("Each additional specialist resolves about 20 tickets
 * per week, between 10 and 30."), whose range admission dropped on all nine, and the AIE's D6 drafts (S3 T5), where the
 * 10–30 is a SUPPLIER's claim the user has not verified: never stored as the user's range.
 * DL RULING (13:1xZ; AIE 0825, 0418): a third party's range is carried with its attribution, role unverified (a label,
 * never withheld), and a midpoint drawn from it is identified as Olumi's point from that range, never the user's figure.
 * BOUNDARY (not built): an option-conditional range (D6 C r1's interventions, D3's price-rise churn) would ride
 * `interventions[f].range`, which reaches PLoT and, for a rescaled value, withholds the affected outcomes: an added
 * withholding. Those drafts get no range here, and no intervention range is written.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import cap from './fixtures/capacity-served-drafts-20261011.json';
import t5 from './fixtures/row5-range-drafts-t5.json';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
import { isStatedLevelRange, levelRangePointBasis, USER_TODAY_SOURCE, withoutStatedLevelRanges } from '../../routing/add-factor-transaction.js';
import { provenanceOf } from './fixtures/provenance-of-standin.js';

type Rec = Record<string, any>;
const PAUL = 'Each additional specialist resolves about 20 tickets per week, between 10 and 30.';
const PAULS_RANGE = { low: 10, high: 30, meaning: 'min_max', source: USER_TODAY_SOURCE, source_quote: PAUL };

function admitted(candidate: Rec, brief: string): Rec[] {
  return admitCandidateModel(structuredClone(candidate) as unknown as CandidateModel, {}, brief).nodes as unknown as Rec[];
}
function nodeFor(candidate: Rec, brief: string, value: number): Rec {
  const label = (candidate.factors as Rec[]).find(f => f.baseline_value === value)!.label;
  const node = admitted(candidate, brief).find(n => n.kind === 'factor' && n.label === label);
  expect(node, `admitted "${label}"`).toBeDefined();
  return node!;
}

describe('Row5: the user\'s stated range survives construction onto its node (the served capacity drafts)', () => {
  it('IDENTITY: nine served drafts of Paul\'s brief, which writes the range once', () => {
    expect(cap.drafts).toHaveLength(9);
    expect(cap.brief).toContain(PAUL);
  });
  for (const d of cap.drafts) {
    it(`${d.scenario_id.slice(0, 8)}: Paul's 20 carries his 10–30, as written, beside his own figure`, () => {
      const os = nodeFor(d.candidate, cap.brief, 20).observed_state;
      expect(os.raw_value).toBe(20);
      expect(os.range).toEqual(PAULS_RANGE);
      expect(isStatedLevelRange(os.range, os)).toBe(true);
      expect(provenanceOf(os), 'the range changes no authorship or role').toEqual({ origin: 'human', role: 'unverified' });
      expect(levelRangePointBasis(os), 'the figure beside it is Paul\'s own').toBe('stated_figure');
    });
  }
  it('b33bf531, BOUND BY NODE ID: node specialist_capacity carries the range', () => {
    const d = cap.drafts.find(x => x.scenario_id.startsWith('b33bf531'))!;
    const node = admitted(d.candidate, cap.brief).find(n => n.id === 'specialist_capacity')!;
    expect([node.label, node.observed_state.raw_value, node.observed_state.range]).toEqual(['Specialist capacity', 20, PAULS_RANGE]);
  });
  it('POSITIVE CONTROL: Paul\'s 80 states no range and carries none', () => {
    for (const d of cap.drafts) expect(nodeFor(d.candidate, cap.brief, 80).observed_state.range, d.scenario_id).toBeUndefined();
  });
  it('the analysis request never carries it (L6 strip), and the stored node keeps it', () => {
    const d = cap.drafts[0]!;
    const nodes = admitted(d.candidate, cap.brief);
    expect(nodes.some(n => n.observed_state?.range !== undefined)).toBe(true);
    expect(JSON.stringify(withoutStatedLevelRanges({ nodes }))).not.toContain('source_quote');
  });
});

describe('Row5 controls: a range is stored only as the user wrote it, beside their own figure', () => {
  const served = cap.drafts.find(x => x.scenario_id.startsWith('cd3d9c25'))!;
  const variant = (sentence: string) => cap.brief.replace(PAUL, sentence);
  const rangeWith = (sentence: string, value = 20): unknown => {
    const c = structuredClone(served.candidate) as Rec;
    const f = (c.factors as Rec[]).find(x => x.baseline_value === 20)!;
    f.baseline_value = value; f.baseline_evidence = { quote: sentence };
    return nodeFor(c, variant(sentence), value).observed_state?.range;
  };
  it('POSITIVE CONTROL: the same harness keeps Paul\'s own sentence', () => {
    expect(rangeWith(PAUL)).toEqual(PAULS_RANGE);
  });
  for (const [name, sentence, value] of [
    ['the figure lies outside the stated range', 'Each additional specialist resolves about 35 tickets per week, between 10 and 30.', 35],
    ['the ends are in another period', 'Each additional specialist resolves about 20 tickets per week, between 10 and 30 tickets per day.', 20],
    ['only one end is written', 'Each additional specialist resolves about 20 tickets per week, at least 10.', 20],
    ['a third party\'s bare ends with no figure or unit to frame them', 'A supplier says each additional specialist resolves between 10 and 30.', 20],
  ] as const) {
    it(`none: ${name}`, () => {
      expect(rangeWith(sentence, value)).toBeUndefined();
    });
  }
});

describe('Row5 ruling: a third party\'s range is carried with its attribution, never as the user\'s', () => {
  it('a supplier\'s sentence in Paul\'s brief: the range is carried, attributed (brief_extraction), never the user\'s', () => {
    const s = 'A supplier says each additional specialist resolves about 20 tickets per week, between 10 and 30.';
    const c = structuredClone(cap.drafts.find(x => x.scenario_id.startsWith('cd3d9c25'))!.candidate) as Rec;
    const f = (c.factors as Rec[]).find(x => x.baseline_value === 20)!; f.baseline_evidence = { quote: s };
    const os = nodeFor(c, cap.brief.replace(PAUL, s), 20).observed_state;
    expect(os.range).toEqual({ low: 10, high: 30, meaning: 'min_max', source: 'brief_extraction', source_quote: s });
    expect(isStatedLevelRange(os.range, os)).toBe(false);
    expect(levelRangePointBasis(os), 'the supplier\'s written 20 is neither the user\'s own figure nor Olumi\'s midpoint').toBeUndefined();
  });
});

describe('Row5 on the AIE\'s D6 drafts (S3 T5): the supplier\'s unverified 10–30 rides the rate node, attributed', () => {
  const drafts = t5.drafts.filter(d => d.case.startsWith('D6'));
  it('IDENTITY: four D6 drafts, each byte for byte as returned', () => {
    expect(drafts).toHaveLength(4);
    for (const d of drafts) expect(createHash('sha256').update(d.raw_text).digest('hex')).toBe(d.raw_sha256);
    expect(t5.briefs['D6-capacity-reference-boundary']).toContain('A supplier says a specialist can contribute 10–30 features per week');
  });
  const SUPPLIER = 'A supplier says a specialist can contribute 10–30 features per week; I have not verified that claim.';
  const ATTRIBUTED = { low: 10, high: 30, meaning: 'min_max', source: 'brief_extraction', source_quote: SUPPLIER };
  /** The drafted rate node per sample, by its drafted label; C r1 drafted the contribution as 0 with option settings. */
  const RATE: Record<string, [string, number, 'midpoint' | undefined] | null> = {
    'D6-capacity-reference-boundary-r1-call1/A': ['Specialist output per week', 20, 'midpoint'],
    'D6-capacity-reference-boundary-r2-call1/A': ['Feature contribution per specialist', 20, 'midpoint'],
    'D6-capacity-reference-boundary-r2-call1/C': ['Specialist contribution per week', 10, undefined],
    'D6-capacity-reference-boundary-r1-call1/C': null,
  };
  for (const d of drafts) {
    const rate = RATE[`${d.sample}/${d.arm}`];
    it(`${d.arm} ${d.sample.slice(-8)}: ${rate === null ? 'BOUNDARY (option-conditional): no range anywhere, no intervention range' : `"${rate![0]}" carries the supplier's 10–30, attributed; the ${rate![1]} is Olumi's${rate![2] ? ' midpoint' : ''}`}`, () => {
      const candidate = JSON.parse(d.raw_text) as Rec;
      const nodes = admitted(candidate, t5.briefs['D6-capacity-reference-boundary']);
      expect(nodes.filter(n => n.observed_state?.range?.source === USER_TODAY_SOURCE), 'never the user\'s range').toEqual([]);
      expect(nodes.filter(n => Object.values((n.interventions ?? {}) as Rec).some((i: Rec) => i?.range !== undefined)), 'no intervention range (no added withholding)').toEqual([]);
      if (rate === null) {
        expect(nodes.filter(n => n.observed_state?.range !== undefined)).toEqual([]);
        return;
      }
      const [label, value, basis] = rate!;
      expect((candidate.factors as Rec[]).find(f => f.label === label)?.baseline_value, 'as drafted').toBe(value);
      const ranged = nodes.filter(n => n.observed_state?.range !== undefined);
      expect(ranged.map(n => n.label), 'only the rate node').toEqual([label]);
      const os = ranged[0]!.observed_state;
      expect([os.raw_value, os.range]).toEqual([value, ATTRIBUTED]);
      expect(provenanceOf(os), 'the drafted point stays Olumi\'s').toEqual({ origin: 'ai', role: null });
      expect(levelRangePointBasis(os)).toBe(basis);
    });
  }
});

describe('Row5 on the AIE\'s D3 drafts (S3 T5): no range is invented where no node holds it', () => {
  const drafts = t5.drafts.filter(d => d.case.startsWith('D3'));
  it('IDENTITY: four D3 drafts, byte for byte; the brief states 10–20% churn under a price rise, from interviews', () => {
    expect(drafts).toHaveLength(4);
    for (const d of drafts) expect(createHash('sha256').update(d.raw_text).digest('hex')).toBe(d.raw_sha256);
    expect(t5.briefs['D3-pricing-money-denominator']).toContain('Customer interviews suggest that raising the price could cause 10–20% churn');
  });
  for (const d of drafts) {
    it(`${d.arm} ${d.sample.slice(-8)}: BOUNDARY: no node or intervention carries a range (today's churn of 3% or 0 lies outside 10–20)`, () => {
      const nodes = admitted(JSON.parse(d.raw_text), t5.briefs['D3-pricing-money-denominator']);
      expect(nodes.filter(n => n.observed_state?.range !== undefined).map(n => n.label)).toEqual([]);
      expect(nodes.filter(n => Object.values((n.interventions ?? {}) as Rec).some((i: Rec) => i?.range !== undefined))).toEqual([]);
    });
  }
});
