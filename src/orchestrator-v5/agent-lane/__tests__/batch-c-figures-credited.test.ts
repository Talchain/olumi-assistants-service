/**
 * Recovery Batch C — L1–L3 (DL 6115418262; meaning constraints PL 6115488243; SYS3 trace #94 6115410093): Paul's own
 * figures are credited to him, and Olumi's guesses never are. The corpus is the REAL drafter output for Paul's hiring
 * brief (`cee_drafter_raw_responses` 3ad9cc58, cee_build 50530b5f; brief sha256 b894519b…), never a fixture written to
 * fit the fix; the adverse rows are single-sentence variations of the same brief.
 *
 *   · L1 — "We currently have six mid-weight developers": a developer HEADCOUNT matches its own noun and quantity.
 *     FTE is not a headcount; "could have six" is not today's level; a supplier's six is not ours; a different factor
 *     citing the sentence gets nothing.
 *   · L2 — "two developers": the checked baseline plus the stated addition (6 + 2 = 8, `derived_total`) is kept over the
 *     drafter's unverified duplicate, in either order; two genuine conflicting user settings are said, never overwritten.
 *   · L3 — "I can't spend more than 25% of my time on this, and I'm not that experienced with marketing": a quote that
 *     merely CONTAINS 25 does not make Olumi's experience score of 25 the user's material.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { admitCandidateModel, oneLevelPerFactor, type CandidateModel } from '../admit-model.js';
import { verifiedFactorLevel } from '../verified-option-setting.js';
import { figureTheUserWroteFor } from '../stated-by-user.js';
import { prepareProvisionalCandidate } from '../runtime/build-model.js';

type Rec = Record<string, any>;

const HIRING_BRIEF = 'Should I hire a Tech lead or two developers to increase productivity by at least 10%, while maintaining code quality? '
  + 'We have an urgent launch date in the next three months. We currently have six mid-weight developers, so we\'re lacking leadership. '
  + 'Our budget is £200,000, but we\'d like to spend less.';
const DEVS_SENTENCE = 'We currently have six mid-weight developers, so we\'re lacking leadership.';
const raw = (): CandidateModel => JSON.parse(readFileSync(new URL('./fixtures/hiring-drafter-raw-3ad9cc58.json', import.meta.url), 'utf8'));
const devsOf = (m: CandidateModel): Rec => (m.factors as unknown as Rec[]).find((f) => f.label === 'Mid-weight developers')!;
// The brief readers injected exactly as production injects them (build-model.ts `admitForBuild`): a figure the brief writes
// about a quantity, strict and scoped against every other quantity (`figureTheUserWroteFor`).
const admitted = (m: CandidateModel, brief = HIRING_BRIEF): Rec =>
  admitCandidateModel(prepareProvisionalCandidate(m, brief).candidate, {}, brief, undefined, undefined, undefined,
    (value, unit, scope) => figureTheUserWroteFor(value, unit, brief, { target: scope.target, others: scope.others, strict: true })) as unknown as Rec;
const nodeOf = (g: Rec, label: string): Rec => (g.nodes as Rec[]).find((n) => n.label === label)!;
const cellOf = (g: Rec, option: string, factor: string): Rec => nodeOf(g, option).interventions?.[nodeOf(g, factor).id];

describe('L1 — a developer headcount the user wrote is the user\'s (real drafter output)', () => {
  it('RED: "We currently have six mid-weight developers" verifies the headcount factor\'s level 6', () => {
    const m = raw();
    expect(devsOf(m)).toMatchObject({ unit: 'headcount', baseline_value: 6 });
    expect(verifiedFactorLevel(m, devsOf(m) as never, HIRING_BRIEF)).toBe(true);
  });

  it('RED: admitted and stored as the user\'s figure — brief_extraction, raw 6, no "not confirmed" flag', () => {
    const os = nodeOf(admitted(raw()), 'Mid-weight developers').observed_state;
    expect(os).toMatchObject({ source: 'brief_extraction', raw_value: 6 });
    expect(os.user_material_unverified).toBeUndefined();
    expect(os.extractionType).not.toBe('inferred');
  });

  it('CONTRAST: the same sentence with the unit written as the noun ("developers") verified before and still does', () => {
    const m = raw(); devsOf(m).unit = 'developers';
    expect(verifiedFactorLevel(m, devsOf(m) as never, HIRING_BRIEF)).toBe(true);
  });

  it('ADVERSE: FTE is not a headcount (no workload basis is stated) — not verified', () => {
    const m = raw(); devsOf(m).unit = 'FTE';
    expect(verifiedFactorLevel(m, devsOf(m) as never, HIRING_BRIEF)).toBe(false);
  });

  it('ADVERSE: "could have six" is not today\'s level — not verified', () => {
    const sentence = 'We could have six mid-weight developers, so we\'re lacking leadership.';
    const m = raw(); devsOf(m).baseline_evidence = { quote: sentence };
    expect(verifiedFactorLevel(m, devsOf(m) as never, HIRING_BRIEF.replace(DEVS_SENTENCE, sentence))).toBe(false);
  });

  it('ADVERSE: a supplier\'s six belong to the supplier — not verified', () => {
    const sentence = 'Our supplier has six mid-weight developers, so we\'re lacking leadership.';
    const m = raw(); devsOf(m).baseline_evidence = { quote: sentence };
    expect(verifiedFactorLevel(m, devsOf(m) as never, HIRING_BRIEF.replace(DEVS_SENTENCE, sentence))).toBe(false);
  });

  it('ADVERSE: a different factor citing the same sentence ("Tech leads", headcount, 6) gets nothing', () => {
    const m = raw();
    const leads = (m.factors as unknown as Rec[]).find((f) => f.label === 'Tech leads')!;
    Object.assign(leads, { baseline_known: true, baseline_value: 6, provenance: 'explicit', baseline_evidence: { quote: DEVS_SENTENCE } });
    expect(verifiedFactorLevel(m, leads as never, HIRING_BRIEF)).toBe(false);
  });

  it('ADVERSE: the same 6 under a different quantity ("Developer salary", GBP) gets nothing', () => {
    const m = raw(); Object.assign(devsOf(m), { label: 'Developer salary', unit: 'GBP' });
    expect(verifiedFactorLevel(m, devsOf(m) as never, HIRING_BRIEF)).toBe(false);
  });
});

describe('L2 — no last-wins: the checked baseline plus the stated addition is kept over an unverified duplicate', () => {
  const twoOf = (m: CandidateModel): Rec => (m.options as unknown as Rec[]).find((o) => o.label === 'Hire two developers')!;

  it('RED: "Hire two developers" is 6 + 2 = 8, the user\'s derived total, as drafted (duplicate last)', () => {
    const cell = cellOf(admitted(raw()), 'Hire two developers', 'Mid-weight developers');
    expect(cell).toMatchObject({ raw_value: 8, source: 'brief_extraction', value_confidence: 'medium' });
  });

  it('the same with the entries reversed (duplicate first)', () => {
    const m = raw(); twoOf(m).interventions.reverse();
    const cell = cellOf(admitted(m), 'Hire two developers', 'Mid-weight developers');
    expect(cell).toMatchObject({ raw_value: 8, source: 'brief_extraction', value_confidence: 'medium' });
  });

  it('ADVERSE: "+1 Tech lead" over Olumi\'s assumed 0 stays Olumi\'s; the £110k/£140k costs stay Olumi\'s', () => {
    const g = admitted(raw());
    expect(cellOf(g, 'Hire a Tech lead', 'Tech leads')).toMatchObject({ raw_value: 1, source: 'cee_hypothesis' });
    expect(cellOf(g, 'Hire a Tech lead', 'First-year hiring cost')).toMatchObject({ source: 'cee_hypothesis' });
    expect(cellOf(g, 'Hire two developers', 'First-year hiring cost')).toMatchObject({ source: 'cee_hypothesis' });
  });

  it('RED (adverse): a drafted total that is NOT baseline + addition never becomes the level — the derived 8 is kept, either order', () => {
    const nine = (reversed: boolean): Rec => {
      const m = raw();
      const two = twoOf(m);
      two.interventions = two.interventions.map((iv: Rec) => (iv.value === 8 ? { ...iv, value: 9 } : iv));
      if (reversed) two.interventions.reverse();
      return cellOf(admitted(m), 'Hire two developers', 'Mid-weight developers');
    };
    expect(nine(false)).toMatchObject({ raw_value: 8, source: 'brief_extraction' });
    expect(nine(true)).toMatchObject({ raw_value: 8, source: 'brief_extraction' });
  });

  // Batch C: independent check r1 item 2 — a drafter's `explicit` label is not a user figure; only a figure BOUND to the brief
  // (its quote, quantity and role) is. The brief says six plus two, so 8 is the user's derived total; 8/9 totals with no
  // evidence are NOT the user's, so they never make a "conflict" and are never credited.
  it('RED (r1 item 2): unsupported 8 and 9 "explicit" totals beside the brief\'s six plus two — the user\'s derived 8 is kept, 9 is never credited, no conflict', () => {
    const m = raw();
    const two = twoOf(m);
    two.interventions = [
      ...two.interventions.filter((iv: Rec) => !(iv.factor_label === 'Mid-weight developers' && iv.value_kind === 'absolute')),
      { factor_label: 'Mid-weight developers', value: 8, value_kind: 'absolute', unit: 'headcount', provenance: 'explicit', stated_evidence: null },
      { factor_label: 'Mid-weight developers', value: 9, value_kind: 'absolute', unit: 'headcount', provenance: 'explicit', stated_evidence: null },
    ];
    const g = admitted(m);
    expect(cellOf(g, 'Hire two developers', 'Mid-weight developers')).toMatchObject({ raw_value: 8, source: 'brief_extraction', value_confidence: 'medium' });
    expect(((g.loss ?? []) as Rec[]).map((l) => String(l.reason)).join(' ')).not.toContain('to both');
  });

  it('RED (r1 item 2): 8 and 9 "explicit" totals with no evidence and no stated addition are NOT user figures — the level kept is Olumi\'s', () => {
    const m = raw();
    const two = twoOf(m);
    two.interventions = [
      { factor_label: 'Mid-weight developers', value: 8, value_kind: 'absolute', unit: 'headcount', provenance: 'explicit', stated_evidence: null },
      { factor_label: 'Mid-weight developers', value: 9, value_kind: 'absolute', unit: 'headcount', provenance: 'explicit', stated_evidence: null },
      ...two.interventions.filter((iv: Rec) => iv.factor_label !== 'Mid-weight developers'),
    ];
    const g = admitted(m);
    expect(cellOf(g, 'Hire two developers', 'Mid-weight developers')).toMatchObject({ source: 'cee_hypothesis' });
    expect(((g.loss ?? []) as Rec[]).map((l) => String(l.reason)).join(' ')).not.toContain('to both');
  });

  it('two genuine (brief-bound) user settings that disagree are said, never silently overwritten — no level is set', () => {
    const iv = (value: number) => ({ factor_label: 'Mid-weight developers', value, value_kind: 'absolute', unit: 'headcount', provenance: 'explicit', stated_evidence: null });
    const option = { label: 'Hire two developers', provenance: 'explicit', interventions: [iv(8), iv(9)] } as unknown as CandidateModel['options'][number];
    const loss: Rec[] = [];
    const kept = oneLevelPerFactor(option, loss as never, new Map([['Mid-weight developers', 'mid_weight_developers']]), () => true);
    expect(kept.size).toBe(0);
    expect(loss.map((l) => l.reason)).toEqual(['“Hire two developers” sets “Mid-weight developers” to both 8 and 9 headcount, so no level was set: say which one you mean.']);
  });
});

describe('L3 — a quote that merely contains the figure does not make Olumi\'s guess the user\'s material', () => {
  const MARKETING_BRIEF = 'Should I hire a marketing manager, or use an AI tool to plan the campaign for the next product feature launch, '
    + 'and use the money I\'d save to spend more on advertising? Our budget for the year is £100,000. '
    + 'I can\'t spend more than 25% of my time on this, and I\'m not that experienced with marketing.';
  const QUOTE = 'I can\'t spend more than 25% of my time on this, and I\'m not that experienced with marketing.';
  const marketing = (): CandidateModel => ({
    goal: { metric: 'New customers', operator: '>=', target_stated: false, value: null, unit: 'customers', horizon_months: null,
      provenance: 'ai_proposed', frame: 'level', baseline_known: false, baseline_value: null, baseline_provenance: 'ai_proposed', scope: null },
    constraints: [
      { metric: 'Annual marketing budget', operator: '<=', value: 100000, unit: 'GBP', provenance: 'explicit', frame: 'level' },
      { metric: 'Founder time on marketing', operator: '<=', value: 25, unit: '% of time', provenance: 'explicit', frame: 'level' },
    ],
    options: [
      { label: 'Hire a marketing manager', provenance: 'explicit', interventions: [] },
      { label: 'Use an AI planning tool', provenance: 'explicit', interventions: [] },
    ],
    factors: [
      { label: 'Marketing experience score', role: 'observable', baseline_known: false, baseline_evidence: { quote: QUOTE },
        baseline_value: 25, unit: 'score out of 100', provenance: 'ai_proposed', plausible_max: 100 },
      { label: 'Founder time on marketing', role: 'controllable', baseline_known: false, baseline_evidence: null,
        baseline_value: 10, unit: '% of time', provenance: 'ai_proposed', plausible_max: 100 },
      { label: 'Annual marketing budget', role: 'controllable', baseline_known: false, baseline_evidence: null,
        baseline_value: 0, unit: 'GBP', provenance: 'ai_proposed', plausible_max: 200000 },
    ],
    risks: [], outcomes: [], links: [], identities: [], unknowns: [], decision_question: null,
  } as unknown as CandidateModel);

  it('RED: "Marketing experience score" 25 stays OLUMI\'s estimate — no unverified-user flag from a 25% time limit', () => {
    const os = nodeOf(admitted(marketing(), MARKETING_BRIEF), 'Marketing experience score').observed_state;
    expect(os?.source).toBe('cee_inference');
    expect(os?.user_material_unverified).toBeUndefined();
  });

  it('CONTROL: the 25% stays on the founder-time limit as the user\'s explicit limit', () => {
    const rows = (admitted(marketing(), MARKETING_BRIEF).goal_constraints ?? []) as Rec[];
    expect(rows.find((r) => r.value === 25)).toMatchObject({ operator: '<=', value: 25, provenance: 'explicit' });
  });

  it('POSITIVE CONTROL: L1\'s quote is still the user\'s material', () => {
    const os = nodeOf(admitted(raw()), 'Mid-weight developers').observed_state;
    expect(os.source).toBe('brief_extraction');
  });
});
