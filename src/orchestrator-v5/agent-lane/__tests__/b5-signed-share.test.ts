import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
import { verifiedFactorLevel } from '../verified-option-setting.js';
import { prepareProvisionalCandidate } from '../runtime/build-model.js';
import { findLinkEffectAmounts } from '../link-effect-figures.js';
import { statedTailParts } from '../same-unit.js';
import { valueAuthorshipOf } from '../turn-context/guidance-signals.js';
import { nodeProvenanceDisplay } from '../../../cee/transforms/provenance-display.js';
import { synthesiseDisplayValue } from '../../../cee/factor-extraction/display-value.js';
import { resolveExistingRawValue } from '../../tools/handlers/d1-shared/evaluate-factor-value-proposal.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { probeRows } from './fixtures/r5-verified-cases.js';
import { buildFactorScaleMap, resolveRawInterventionValue } from '../../tools/plot-intervention-scale.js';

const NET = 'Once new registrations are counted we work off a net 35 people a month.';
const GOAL = 'Our goal is to get the waiting list under 500 within nine months.';
function model(quote = NET, value = -35, unit = 'people/month'): CandidateModel {
  return {
    goal: { metric: 'Waiting list', value: 500, unit: 'people', operator: '<', target_stated: true,
      horizon_months: 9, provenance: 'explicit', frame: 'level', baseline_known: false,
      baseline_value: null, baseline_provenance: 'inferred', scope: null },
    factors: [{ label: 'Net waiting-list change per month', unit, baseline_value: value,
      baseline_known: true, provenance: 'explicit', role: 'observable', plausible_max: 500,
      baseline_evidence: { quote } }],
    options: [{ label: 'Keep current service', provenance: 'inferred', changes: [], interventions: [], is_status_quo: true }],
    links: [], constraints: [], outcomes: [], risks: [], decision_question: null,
  };
}
function readBack(m: CandidateModel, brief: string, label: string) {
  const repaired = prepareProvisionalCandidate(m, brief).candidate;
  const admitted = admitCandidateModel(repaired, {}, brief);
  const projected = projectGraphForPersistence(admitted);
  const wire = JSON.stringify(projected);
  const reloaded = GraphV3.parse(JSON.parse(wire));
  const n = reloaded.nodes.find(n => n.kind === 'factor' && n.label === label)!;
  const native = resolveExistingRawValue(n.observed_state ?? {});
  const canonical = resolveRawInterventionValue(n.observed_state, buildFactorScaleMap(reloaded.nodes).get(n.id));
  const display = { provenance: nodeProvenanceDisplay(n.observed_state?.extractionType, n.observed_state), display_value: synthesiseDisplayValue(n.observed_state ?? {}) };
  return { repaired, admitted, projected, reloaded, n, native, canonical, display };
}

describe('B5 signed current rate through the existing authority', () => {
  it('credits the original negative rate beside a differently framed stock goal', () => {
    const m = model(); const brief = `${NET} ${GOAL}`;
    expect(verifiedFactorLevel(m, m.factors[0]!, brief)).toBe(true);
    const { n, native, canonical, display } = readBack(m, brief, m.factors[0]!.label);
    expect(n.observed_state).toMatchObject({ value: -35, unit: 'people/month', source: 'brief_extraction', extractionType: 'explicit' });
    expect(n.observed_state?.raw_value).toBeUndefined();
    expect(n.observed_state?.cap).toBeUndefined();
    expect(native).toEqual({ kind: 'resolved', raw: -35 });
    expect(canonical).toMatchObject({ value: -35, inputValue: -35, inconsistent: false });
    expect(valueAuthorshipOf(n.observed_state)).toBe('yours');
    expect(nodeProvenanceDisplay(n.observed_state?.extractionType, n.observed_state)).toBe('from_brief');
    expect(display.display_value).toContain('-35');
  });
  it('credits the explicitly signed historical net report beside a different stock target', () => {
    const quote = 'Over the last year we have been losing a net 120 borrowers a month.';
    const m = model(quote, -120, 'borrowers/month');
    const goal = { ...m.goal, metric: 'Registered borrowers', value: 20000, unit: 'borrowers' };
    const full = { ...m, goal, factors: [{ ...m.factors[0]!, label: 'Net borrower change per month' }] };
    const brief = `${quote} The county wants at least 20,000 borrowers by the end of the next financial year, twelve months away.`;
    expect(verifiedFactorLevel(full, full.factors[0]!, brief)).toBe(true);
    const { n, native, canonical, display } = readBack(full, brief, full.factors[0]!.label);
    expect(native).toEqual({ kind: 'resolved', raw: -120 });
    expect(canonical).toMatchObject({ value: -120, inputValue: -120, inconsistent: false });
    expect(n.observed_state).toMatchObject({ value: -120, unit: 'borrowers/month', source: 'brief_extraction', extractionType: 'explicit' });
    expect(n.observed_state?.raw_value).toBeUndefined();
    expect(valueAuthorshipOf(n.observed_state)).toBe('yours');
    expect(nodeProvenanceDisplay(n.observed_state?.extractionType, n.observed_state)).toBe('from_brief');
    expect(display.display_value).toContain('-120');
  });
  const adverse = [
    ['third-party', 'Our competitor works off a net 35 people a month.', -35, 'people/month'],
    ['reported supplier', 'Our supplier claims we work off a net 35 people a month.', -35, 'people/month'],
    ['gain for negative', 'We have been gaining a net 35 people a month.', -35, 'people/month'],
    ['loss for positive', 'We have been losing a net 35 people a month.', 35, 'people/month'],
    ['target', 'Our target is to work off a net 35 people a month.', -35, 'people/month'],
    ['limit', 'We work off at most a net 35 people a month.', -35, 'people/month'],
    ['forecast', 'We forecast working off a net 35 people a month.', -35, 'people/month'],
    ['option delta', 'We can add roughly 35 people a month.', -35, 'people/month'],
    ['different period', 'We work off a net 35 people a year.', -35, 'people/month'],
    ['missing direction', 'We have a net 35 people a month.', -35, 'people/month'],
    ['word-unit ambiguity', 'We work off a net seventy people a month.', -35, 'people/month'],
  ] as const;
  for (const [name, quote, value, unit] of adverse) {
    it(`withholds ${name}`, () => {
      const m = model(quote, value, unit);
      expect(verifiedFactorLevel(m, m.factors[0]!, quote)).toBe(false);
      const { n } = readBack(m, quote, m.factors[0]!.label);
      expect(n.observed_state?.source).not.toBe('brief_extraction');
      expect(valueAuthorshipOf(n.observed_state)).not.toBe('yours');
      expect(nodeProvenanceDisplay(n.observed_state?.extractionType, n.observed_state)).not.toBe('from_brief');
    });
  }
  for (const tail of ['At most.', 'Our net waiting-list change is at most 35 people a month.',
    'Our target is to work off a net 35 people a month.', 'Olumi suggested that rate.',
    'We work off a net thirty-five people a month.', 'Actually, not that rate.']) {
    it(`withholds the same-claim qualifier or correction: ${tail}`, () => {
      const m = model(); expect(verifiedFactorLevel(m, m.factors[0]!, `${NET} ${tail}`)).toBe(false);
    });
  }
  it('does not use a differently named same-period rate goal to escape a bound', () => {
    const m = model(); const full = { ...m, goal: { ...m.goal, metric: 'Waiting list change', unit: 'people/month' } };
    expect(verifiedFactorLevel(full, full.factors[0]!, `${NET} Our goal is a waiting list change under 500 people a month.`)).toBe(false);
  });
  it('does not call an explicitly per-month bound a stock because the model declared stock units', () => {
    const m = model();
    expect(verifiedFactorLevel(m, m.factors[0]!, `${NET} Our goal is a waiting list change under 500 people a month.`)).toBe(false);
  });
  it('does not resolve an unknown written goal-bound unit through declared stock units', () => {
    const m = model();
    expect(verifiedFactorLevel(m, m.factors[0]!, `${NET} Our goal is a waiting list under 500 widgets.`)).toBe(false);
  });
  it('does not inherit ownership from a third-party preceding sentence', () => {
    const quote = 'Net waiting-list change is 35 people a month.';
    const m = model(quote, 35);
    expect(verifiedFactorLevel(m, m.factors[0]!, `Our supplier reports a waiting list. ${quote}`)).toBe(false);
  });
  it('does not credit an unquoted drafter claim', () => {
    const m = model(); const full = { ...m, factors: [{ ...m.factors[0]!, baseline_evidence: null }] };
    expect(verifiedFactorLevel(full, full.factors[0]!, `${NET} ${GOAL}`)).toBe(false);
    expect(readBack(full, `${NET} ${GOAL}`, full.factors[0]!.label).n.observed_state?.source).not.toBe('brief_extraction');
  });
});

// Same full candidate and receipt as the time-close shared setup; that spec runs in CI.
const CASH_QUOTE = 'Our monthly additions are £2,000 a month.';
const CASH_GOAL = 'Our goal is cash of £30,000 by 31 March 2027.';
function cashModel(): CandidateModel {
  return {
    goal: { metric: 'Cash', operator: '>=', target_stated: true, value: 30000, unit: 'GBP', frame: 'level', horizon_months: 9,
      provenance: 'explicit', baseline_known: false, baseline_value: null, baseline_provenance: undefined },
    factors: [
      { label: 'Current cash', role: 'external', baseline_known: true, baseline_value: 12000, unit: 'GBP', provenance: 'explicit', plausible_max: 50000, baseline_evidence: { quote: 'Our current cash is £12,000.' } },
      { label: 'Monthly additions', role: 'external', baseline_known: true, baseline_value: 2000, unit: 'GBP/month', provenance: 'explicit', plausible_max: 10000, baseline_evidence: { quote: 'Our monthly additions are £2,000 a month.' } },
      { label: 'Bonus', role: 'controllable', baseline_known: true, baseline_value: 0, unit: 'GBP', provenance: 'inferred', plausible_max: 10000 },
    ],
    options: [
      { label: 'Give bonus', provenance: 'explicit', interventions: [{ factor_label: 'Bonus', value: 1000, unit: 'GBP', provenance: 'explicit' }] },
      { label: 'No bonus', provenance: 'explicit', is_status_quo: true, interventions: [{ factor_label: 'Bonus', value: 0, unit: 'GBP', provenance: 'explicit' }] },
    ], links: [
      { from: 'Current cash', to: 'Cash', direction: 'positive', provenance: 'inferred' },
      { from: 'Monthly additions', to: 'Cash', direction: 'positive', provenance: 'inferred' },
      { from: 'Bonus', to: 'Cash', direction: 'positive', provenance: 'explicit', effect_amount: 1000, effect_per_source_change: 1000, effect_provenance: 'explicit' },
    ], constraints: [], risks: [], outcomes: [],
  };
}

describe('B5 currency rate beside an independently bound stock goal', () => {
  it('credits the time-close GBP/month receipt without changing the stock/date goal', () => {
    const m = cashModel();
    const brief = `Our current cash is £12,000. ${CASH_QUOTE} ${CASH_GOAL} Compare a bonus or no bonus.`;
    const factor = m.factors[1]!;
    expect(verifiedFactorLevel(m, factor, brief)).toBe(true);
    const direct = admitCandidateModel(m, {}, brief);
    expect(direct.nodes.find(n => n.id === 'monthly_additions')?.observed_state?.source).toBe('brief_extraction');
    expect(direct.nodes.find(n => n.id === 'current_cash')?.observed_state?.source).toBe('brief_extraction');
    const { n, native, canonical, display } = readBack(m, brief, factor.label);
    expect(n.observed_state).toMatchObject({ raw_value: 2000, unit: 'GBP/month', source: 'brief_extraction', extractionType: 'explicit' });
    expect(native).toEqual({ kind: 'resolved', raw: 2000 });
    expect(canonical).toMatchObject({ value: 2000, inconsistent: false });
    expect(valueAuthorshipOf(n.observed_state)).toBe('yours');
    expect(display.provenance).toBe('from_brief');
  });
  for (const [name, quote] of [
    ['third-party', 'Our competitor monthly additions are £2,000 a month.'],
    ['reported claim', 'Our supplier claims our monthly additions are £2,000 a month.'],
    ['target', 'Our monthly additions target is £2,000 a month.'],
    ['limit', 'Our monthly additions are at most £2,000 a month.'],
    ['forecast', 'Our monthly additions forecast is £2,000 a month.'],
    ['delta', 'We can add roughly £2,000 a month to monthly additions.'],
    ['wrong period', 'Our monthly additions are £2,000 a year.'],
    ['rival entity', 'Our bonus is £2,000 a month.'],
  ] as const) {
    it(`withholds currency ${name} beside the stock/date goal`, () => {
      const m = cashModel(); m.factors[1]!.baseline_evidence = { quote };
      const brief = `${quote} ${CASH_GOAL}`;
      expect(verifiedFactorLevel(m, m.factors[1]!, brief)).toBe(false);
      const { n } = readBack(m, brief, m.factors[1]!.label);
      expect(n.observed_state?.source).not.toBe('brief_extraction');
      expect(valueAuthorshipOf(n.observed_state)).not.toBe('yours');
    });
  }
  for (const tail of ['At most.', 'Actually, not those additions.',
    'Our monthly additions are at most £2,000 a month.', 'Olumi suggested those additions.',
    CASH_QUOTE, 'Our goal is cash of £30,000 a month by 31 March 2027.',
    'Our goal is reserves of £30,000 by 31 March 2027.',
    'Our goal is cash of $30,000 by 31 March 2027.',
    'Our goal is cash of 30,000 widgets by 31 March 2027.']) {
    it(`withholds the currency neighbour refusal: ${tail}`, () => {
      const m = cashModel();
      expect(verifiedFactorLevel(m, m.factors[1]!, `${CASH_QUOTE} ${tail}`)).toBe(false);
    });
  }
  it('keeps a same-period GBP/month goal as a qualifying neighbour', () => {
    const m = cashModel(); m.goal.unit = 'GBP/month'; m.goal.metric = 'Monthly additions';
    expect(verifiedFactorLevel(m, m.factors[1]!, `${CASH_QUOTE} Our goal is monthly additions of £30,000 a month by 31 March 2027.`)).toBe(false);
  });
  it('keeps an incompatible declared currency frame unresolved', () => {
    const m = cashModel(); m.goal.unit = 'USD';
    expect(verifiedFactorLevel(m, m.factors[1]!, `${CASH_QUOTE} ${CASH_GOAL}`)).toBe(false);
  });
  it('keeps a per-item denominator distinct from an unqualified stock goal', () => {
    const m = cashModel(), quote = 'Our monthly additions are £2,000 per subscriber a month.';
    m.factors[1]!.unit = 'GBP/subscriber/month'; m.factors[1]!.baseline_evidence = { quote };
    expect(verifiedFactorLevel(m, m.factors[1]!, `${quote} ${CASH_GOAL}`)).toBe(false);
  });
  it('withholds an unquoted currency claim beside the stock/date goal', () => {
    const m = cashModel(); m.factors[1]!.baseline_evidence = null;
    expect(verifiedFactorLevel(m, m.factors[1]!, `${CASH_QUOTE} ${CASH_GOAL}`)).toBe(false);
  });
});

const ACC_STOCK = 'We have 250 Pro subscribers paying £49 a month.';
const ACC_FLOW = 'We add about 20 new Pro subscribers a month and lose about 3% of them each month.';
function recordedACC(file: string): { brief: string; draft: CandidateModel } {
  const bank = JSON.parse(readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf8')) as
    Record<string, { brief: string; draft: CandidateModel }>;
  return structuredClone(bank.ACC!);
}

describe('B5 recorded ACC stock beside separately bound monthly inflow and MRR', () => {
  for (const file of ['accumulation-live2-head.json', 'accumulation-pilot-head.json']) {
    it(`credits only the recorded stock250 receipt in the full ${file} candidate`, () => {
      const { brief, draft } = recordedACC(file);
      const stock = draft.factors.find(f => f.label === 'Pro subscribers today')!;
      stock.baseline_evidence = { quote: ACC_STOCK };
      expect(verifiedFactorLevel(draft, stock, brief)).toBe(true);
      const { n, native, canonical, display, reloaded } = readBack(draft, brief, stock.label);
      expect(native).toEqual({ kind: 'resolved', raw: 250 });
      expect(canonical).toMatchObject({ value: 250, inconsistent: false });
      expect(n.observed_state).toMatchObject({ source: 'brief_extraction', extractionType: 'explicit' });
      expect(valueAuthorshipOf(n.observed_state)).toBe('yours');
      expect(display.provenance).toBe('from_brief');
      for (const value of [20, 3]) {
        const other = draft.factors.find(f => f.baseline_value === value)!;
        // A neighbour's distinct frame does not license its own ownership/base or invent a receipt.
        expect(verifiedFactorLevel(draft, { ...other, baseline_evidence: { quote: ACC_FLOW } }, brief)).toBe(false);
        const node = reloaded.nodes.find(n => n.label === other.label)!;
        expect(node.observed_state).toMatchObject({ source: 'cee_inference', user_material_unverified: true });
        expect(node.observed_state?.extractionType).not.toBe('explicit');
        expect(valueAuthorshipOf(node.observed_state)).toBe('unknown');
      }
    });
  }
  it('keeps the recorded current £12,250 with the existing required goal product', () => {
    const { brief, draft } = recordedACC('accumulation-pilot-head.json');
    draft.identities = [...(draft.identities ?? []), { outcome: 'MRR', operation: 'product',
      factors: ['Pro price', 'Pro subscribers at month 12'], provenance: 'inferred' }];
    const stock = draft.factors.find(f => f.label === 'Pro subscribers today')!;
    stock.baseline_evidence = { quote: ACC_STOCK };
    const { reloaded } = readBack(draft, brief, stock.label);
    expect(reloaded.nodes.find(n => n.kind === 'goal')!.observed_state?.raw_value).toBe(12250);
    expect(reloaded.nodes.find(n => n.label === stock.label)!.observed_state)
      .toMatchObject({ source: 'brief_extraction', extractionType: 'explicit' });
  });
  for (const [name, next] of [
    ['elliptical bound', 'At most.'],
    ['correction', 'Actually, not those subscribers.'],
    ['retraction', 'Ignore those subscribers.'],
    ['third-party flow', 'Our competitor says we add about 20 new Pro subscribers a month.'],
    ['reported flow', 'Our supplier claims we add about 20 new Pro subscribers a month.'],
    ['new subject', 'We add our supplier about 20 new Pro subscribers a month.'],
    ['target flow', 'We add a target of about 20 new Pro subscribers a month.'],
    ['limit flow', 'We add at most 20 new Pro subscribers a month.'],
    ['forecast flow', 'We forecast that we add about 20 new Pro subscribers a month.'],
    ['prospective option delta', 'We could add about 20 new Pro subscribers a month.'],
    ['no owned flow', 'They add about 20 new Pro subscribers a month.'],
    ['missing period', 'We add about 20 new Pro subscribers.'],
    ['wrong period', 'We add about 20 new Pro subscribers a year.'],
    ['wrong entity', 'We add about 20 new Starter subscribers a month.'],
    ['wrong unit', 'We add about 20 new Pro teams a month.'],
    ['later qualifier', 'We add about 20 new Pro subscribers a month, additional.'],
    ['duplicate stock amount', 'We add about 20 new Pro subscribers a month and have two hundred and fifty Pro subscribers.'],
  ] as const) {
    it(`keeps the ACC neighbour refusal: ${name}`, () => {
      const { draft } = recordedACC('accumulation-live2-head.json');
      const stock = draft.factors.find(f => f.label === 'Pro subscribers today')!;
      stock.baseline_evidence = { quote: ACC_STOCK };
      expect(verifiedFactorLevel(draft, stock, `${ACC_STOCK} ${next}`)).toBe(false);
    });
  }
  for (const [name, unit] of [['compatible stock', 'subscribers'], ['unknown', null],
    ['different period', 'subscribers/year'], ['different denominator', 'subscribers/team/month']] as const) {
    it(`does not detach the change with a ${name} declared frame`, () => {
      const { draft } = recordedACC('accumulation-live2-head.json');
      const stock = draft.factors.find(f => f.label === 'Pro subscribers today')!;
      stock.baseline_evidence = { quote: ACC_STOCK };
      draft.factors.find(f => f.baseline_value === 20)!.unit = unit;
      expect(verifiedFactorLevel(draft, stock, `${ACC_STOCK} ${ACC_FLOW}`)).toBe(false);
    });
  }
  it('does not detach an ambiguous independently bound flow', () => {
    const { brief, draft } = recordedACC('accumulation-live2-head.json');
    const flow = draft.factors.find(f => f.baseline_value === 20)!;
    draft.factors.push({ ...flow });
    const stock = draft.factors.find(f => f.label === 'Pro subscribers today')!;
    stock.baseline_evidence = { quote: ACC_STOCK };
    expect(verifiedFactorLevel(draft, stock, brief)).toBe(false);
  });
  it('does not turn an unquoted ACC stock into user credit', () => {
    const { brief, draft } = recordedACC('accumulation-live2-head.json');
    expect(verifiedFactorLevel(draft, draft.factors.find(f => f.label === 'Pro subscribers today')!, brief)).toBe(false);
  });
});

describe('B5 share precision through the existing typed authority', () => {
  function share(quote: string, value = 70): CandidateModel {
    const m = model(quote, value, '%');
    return { ...m, factors: [{ ...m.factors[0]!, label: 'Taproom sales share', plausible_max: 100 }] };
  }
  it('credits a fully named owned share in words without inventing a denominator', () => {
    const quote = 'Our taproom sales share is seventy per cent.';
    const m = share(quote);
    expect(verifiedFactorLevel(m, m.factors[0]!, quote)).toBe(true);
    const { n, native, display } = readBack(m, quote, m.factors[0]!.label);
    expect(native).toEqual({ kind: 'resolved', raw: 70 });
    expect(n.observed_state).toMatchObject({ value: 0.7, raw_value: 70, cap: 100, source: 'brief_extraction' });
    expect(valueAuthorshipOf(n.observed_state)).toBe('yours');
    expect(display).toEqual({ provenance: 'from_brief', display_value: '70%' });
  });
  for (const [name, quote] of [
    ['third party', 'Our competitor taproom sales share is seventy per cent.'],
    ['reported figure', 'Our supplier claims our taproom sales share is seventy per cent.'],
    ['no first-person owner', 'They have a taproom sales share of seventy per cent.'],
    ['target', 'Our taproom sales share target is seventy per cent.'],
    ['limit', 'Our taproom sales share is at most seventy per cent.'],
    ['forecast', 'Our taproom sales share forecast is seventy per cent.'],
    ['delta', 'We can add roughly seventy per cent to taproom sales share.'],
    ['rival entity', 'Our pub sales share is seventy per cent.'],
    ['word-unit ambiguity', 'Our taproom sales share is seventy litres a month.'],
    ['different period', 'Our taproom sales share is seventy per cent per month.'],
    ['idiom', 'Our taproom sales share is seventy kinds of awkward.'],
  ] as const) {
    it(`withholds share ${name}`, () => {
      const m = share(quote);
      expect(verifiedFactorLevel(m, m.factors[0]!, quote)).toBe(false);
      const { n, display } = readBack(m, quote, m.factors[0]!.label);
      expect(valueAuthorshipOf(n.observed_state)).not.toBe('yours');
      expect(display.provenance).not.toBe('from_brief');
    });
  }
  it('does not turn the unquoted remainder into a user-stated thirty per cent', () => {
    const quote = 'We brew 6,500 litres a month and sell about seventy per cent of it through our own taproom; the rest goes to local pubs.';
    const m = share(quote, 30); const full = { ...m, factors: [{ ...m.factors[0]!, label: 'Pub sales share' }] };
    expect(verifiedFactorLevel(full, full.factors[0]!, quote)).toBe(false);
    const { n } = readBack(full, quote, full.factors[0]!.label);
    expect(resolveExistingRawValue(n.observed_state ?? {})).toEqual({ kind: 'resolved', raw: 30 });
    expect(valueAuthorshipOf(n.observed_state)).toBe('unknown');
  });
  it('does not credit an unquoted share', () => {
    const quote = 'Our taproom sales share is seventy per cent.';
    const m = share(quote); const full = { ...m, factors: [{ ...m.factors[0]!, baseline_evidence: null }] };
    expect(verifiedFactorLevel(full, full.factors[0]!, quote)).toBe(false);
    expect(valueAuthorshipOf(readBack(full, quote, full.factors[0]!.label).n.observed_state)).toBe('unknown');
  });
});

// Immutable retained raw models are optional replay inputs, never generated by these tests.
// Ordinary CI has no immutable original raw replay input; portable guards above always run.
const replay = process.env.S7_B5_REPLAY;
describe.skipIf(replay === undefined)('B5 retained full-candidate bank replay', () => {
  for (const [id, labels] of [[1, ['Net first check-up waiting-list change per month']],
    [3, ['Taproom sales share', 'Pub sales share']], [4, ['Net borrower change per month']]] as const) {
    it(`R${id}: preserves raw, repaired, admitted, projected and reloaded claims`, async () => {
      const m = JSON.parse(readFileSync(`${replay}/R${id}-raw.json`, 'utf8')) as CandidateModel;
      const brief = readFileSync(`${replay}/R${id}-brief.txt`, 'utf8');
      const diag = process.env.S7_B5_DIAGNOSTICS === undefined ? undefined : await import(process.env.S7_B5_DIAGNOSTICS);
      for (const label of labels) {
        const f = m.factors.find(f => f.label === label)!;
        const { repaired, admitted, projected, reloaded, n, native, canonical, display } = readBack(m, brief, label);
        const quote = f.baseline_evidence!.quote;
        const spans = diag?.factorLevelSpans(m, f, quote) as { start: number; end: number }[] | undefined;
        process.stdout.write(JSON.stringify({ case: `R${id}`, label, raw_model: m, repaired_model: repaired, admitted_graph: admitted, projected_graph: projected, reloaded_graph: reloaded, raw: f, repaired: repaired.factors.find(f => f.label === label),
          verified: verifiedFactorLevel(m, f, brief), admitted: admitted.nodes.find(n => n.label === label),
          projected: (projected as typeof admitted).nodes.find(n => n.label === label), reloaded: n,
          native, canonical, authorship: valueAuthorshipOf(n.observed_state), display,
          diagnostics: spans === undefined ? undefined : { spans, amounts: findLinkEffectAmounts(quote).map(a => ({ ...a, frame: statedTailParts(quote, a) })),
            owns: spans.length === 1 && diag.ownsFactorLevel(quote.slice(0, spans[0]!.start), f), role: diag.currentLevelRole(quote) } }) + '\n');
        expect(native).toEqual({ kind: 'resolved', raw: f.baseline_value });
        expect(canonical).toMatchObject({ value: f.baseline_value, inconsistent: false });
        expect(reloaded.nodes.find(n => n.label === label)?.observed_state).toEqual(n.observed_state);
        if (id !== 3) {
          expect(n.observed_state?.source).toBe('brief_extraction');
          expect(valueAuthorshipOf(n.observed_state)).toBe('yours');
          expect(display.provenance).toBe('from_brief');
        }
      }
    });
  }
});

// Reuse the frozen assertions, including all 28 FALSE-CREDIT IDs; do not revise their evidence or expectations.
describe('existing r5 probe precision guards', () => {
  for (const row of probeRows) it(row.name, row.run);
});
