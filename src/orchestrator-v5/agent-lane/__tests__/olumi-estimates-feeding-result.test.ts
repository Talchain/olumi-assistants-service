import { timingGated } from '../../../../tests/helpers/scaling-ratio.js';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import draw2 from './fixtures/guided-sizing-draw2.json';
import paulGraph from './fixtures/goal-reach-paul-graph-632b92b9.json';
import { endsOfGraph, validatedDefinition, validatedDefinitionForGraph } from '../../goal-target/held-user-links.js';
import {
  narratorCountGuard, olumiEstimatesFeedingResult, sayOlumiEstimates,
} from '../olumi-estimates-feeding-result.js';
import {
  assembleGuidanceSignals, type GoalPathFactor, type GoalPathLink,
} from '../turn-context/guidance-signals.js';

const factor = (id: string, authorship: GoalPathFactor['value_authorship'] = 'olumi_estimate', distance = 1): GoalPathFactor => ({
  factor_id: id, label: id === 'price' ? 'Pro plan price' : id, value_authorship: authorship,
  goal_distance: distance, value_hash: '0123456789ab',
});
const link = (id: string, sizing: GoalPathLink['link_sizing'] = 'olumi_estimate', distance = 0): GoalPathLink => ({
  link_id: id, from_label: id.split('->')[0]!, to_label: 'MRR', link_sizing: sizing,
  option_ids: ['raise-price'], goal_distance: distance, value_hash: '0123456789ab',
});
const paul = () => ({
  goalPathFactors: [factor('price', 'olumi_estimate', 2), factor('subscribers', 'olumi_accepted')],
  goalPathLinks: [
    ...Array.from({ length: 8 }, (_, i) => link(`driver-${i}->mrr`)),
    link('unpriced-1->mrr', 'placeholder'), link('unpriced-2->mrr', 'placeholder'),
  ],
});
const census = (count: number) => olumiEstimatesFeedingResult({
  goalPathFactors: Array.from({ length: count }, (_, i) => factor(`f-${i}`)), goalPathLinks: [],
});

describe('RC4 round 6: stored definitions are arithmetic, not estimated sizes', () => {
  it.each([
    { name: 'draw-2', graph: draw2.graph, id: 'mrr_lost_to_price_sensitivity->mrr', unit: '£/month' },
    { name: 'Paul', graph: paulGraph, id: 'pro_plan_price->monthly_churn_rate', unit: undefined },
    { name: 'Paul', graph: paulGraph, id: 'monthly_churn_rate->mrr_lost_to_price_driven_churn', unit: undefined },
    { name: 'Paul', graph: paulGraph, id: 'mrr_lost_to_price_driven_churn->mrr', unit: '£/month' },
  ])('$name $id: validatedDefinition returns $unit', ({ graph, id, unit }) => {
    const edge = graph.edges.find(e => `${e.from}->${e.to}` === id);
    expect(edge, `captured link ${id}`).toBeDefined();
    expect(validatedDefinition(edge, endsOfGraph(graph)(edge))).toBe(unit);
    const signals = assembleGuidanceSignals({ request: 'run_result', offeredSpecific: [], graph,
      analysisState: undefined, analysisResult: undefined, leaderLicensed: false });
    const pathLink = signals['model.goal_path_links'].find(l => l.link_id === id);
    expect(pathLink, `captured goal-path link ${id}`).toBeDefined();
    expect(pathLink!.link_sizing).toBe('olumi_estimate');
    const e = olumiEstimatesFeedingResult({ validatedDefinitionForLink: validatedDefinitionForGraph(graph), goalPathFactors: [], goalPathLinks: [pathLink!] });
    expect(e.links.map(l => l.id)).toEqual(unit === undefined ? [id] : []);
    expect(e.count).toBe(unit === undefined ? 1 : 0);
  });

  it.each([
    { name: 'draw-2', graph: draw2.graph, before: 2, ids: ['pro_plan_price->monthly_churn'] },
    { name: 'Paul', graph: paulGraph, before: 3,
      ids: ['pro_plan_price->monthly_churn_rate', 'monthly_churn_rate->mrr_lost_to_price_driven_churn'] },
  ])('$name: k $before → estimated sizes only', ({ graph, before, ids }) => {
    const signals = assembleGuidanceSignals({ request: 'run_result', offeredSpecific: [], graph,
      analysisState: undefined, analysisResult: undefined, leaderLicensed: false });
    const input = { validatedDefinitionForLink: validatedDefinitionForGraph(graph), goalPathFactors: signals['model.goal_path_factors'], goalPathLinks: signals['model.goal_path_links'] };
    expect(input.goalPathLinks.filter(l => l.link_sizing === 'olumi_estimate')).toHaveLength(before);
    expect(olumiEstimatesFeedingResult(input).links.map(l => l.id)).toEqual(ids);
  });

  it('MUTANT: a definitional link counted → RED', () => {
    const graph = draw2.graph;
    const id = 'mrr_lost_to_price_sensitivity->mrr';
    const edge = graph.edges.find(e => `${e.from}->${e.to}` === id)!;
    expect(validatedDefinition(edge, endsOfGraph(graph)(edge))).toBe('£/month');
    const e = olumiEstimatesFeedingResult({ validatedDefinitionForLink: validatedDefinitionForGraph(graph), goalPathFactors: [], goalPathLinks: [link(id)] });
    expect(e.links).toEqual([]);
    expect(e.count).toBe(0);
  });
});

describe('RC4: the one census of Olumi estimates feeding this result', () => {
  it("Paul's shape: 1 value + 8 link sizes = 9, with accepted and placeholder figures separate", () => {
    const e = olumiEstimatesFeedingResult(paul());
    expect(e.count).toBe(9);
    expect(e.values.map(item => item.id)).toEqual(['price']);
    expect(e.links.map(item => item.id)).toEqual(Array.from({ length: 8 }, (_, i) => `driver-${i}->mrr`));
    expect(e.accepted).toBe(1);
    expect(e.placeholderLinks).toBe(2);
    expect(e.ordered).toBe(false);
    expect(e.top.map(item => item.id)).toEqual(['driver-0->mrr', 'driver-1->mrr', 'driver-2->mrr']);
    expect(sayOlumiEstimates(e)).toEqual([
      'Olumi supplied 9 of the figures behind this result: 1 value and 8 link sizes.',
      '9 in total; here are 3.',
      'For example:',
      'driver-0 → MRR (link size)', 'driver-1 → MRR (link size)', 'driver-2 → MRR (link size)',
      "1 you accepted from Olumi's suggestions.",
      '2 links have no size yet.',
    ]);
  });

  it('MUTANT: a placeholder counted → RED (the wrong rule would produce 11)', () => {
    const input = paul();
    const wrongCount = input.goalPathFactors.filter(f => f.value_authorship === 'olumi_estimate').length
      + input.goalPathLinks.filter(l => l.link_sizing === 'olumi_estimate' || l.link_sizing === 'placeholder').length;
    expect(wrongCount).toBe(11);
    expect(olumiEstimatesFeedingResult(input).count).toBe(9);
  });

  it('MUTANT: an accepted value counted → RED (the wrong rule would produce 10)', () => {
    const input = paul();
    const wrongCount = input.goalPathFactors.filter(f => f.value_authorship === 'olumi_estimate' || f.value_authorship === 'olumi_accepted').length
      + input.goalPathLinks.filter(l => l.link_sizing === 'olumi_estimate').length;
    expect(wrongCount).toBe(10);
    const e = olumiEstimatesFeedingResult(input);
    expect(e.count).toBe(9);
    expect(e.top.map(item => item.id)).not.toContain('subscribers');
  });

  it('MUTANT: an off-path figure counted → RED (whole-model scope would produce 4 instead of 2)', () => {
    const graph = {
      nodes: [
        { id: 'goal', kind: 'goal', label: 'MRR' },
        { id: 'on-path', kind: 'factor', observed_state: { value: 49, extractionType: 'inferred' } },
        { id: 'off-path', kind: 'factor', observed_state: { value: 100, extractionType: 'inferred' } },
        { id: 'off-end', kind: 'factor', observed_state: { value: 1, extractionType: 'explicit' } },
        { id: 'option', kind: 'option', interventions: { 'on-path': 50, 'off-path': 200 } },
      ],
      edges: [
        { from: 'on-path', to: 'goal', provenance: { magnitude: 'olumi_estimate' } },
        { from: 'off-path', to: 'off-end', provenance: { magnitude: 'olumi_estimate' } },
      ],
    };
    const signals = assembleGuidanceSignals({
      request: 'run_result', offeredSpecific: [], graph, analysisState: undefined,
      analysisResult: undefined, leaderLicensed: false,
    });
    const e = olumiEstimatesFeedingResult({
      goalPathFactors: signals['model.goal_path_factors'], goalPathLinks: signals['model.goal_path_links'],
    });
    expect(e.count).toBe(2);
    expect(e.values.map(item => item.id)).toEqual(['on-path']);
    expect(e.links.map(item => item.id)).toEqual(['on-path->goal']);
    const wrongCount = graph.nodes.filter(n => n.observed_state?.extractionType === 'inferred').length
      + graph.edges.filter(edge => edge.provenance.magnitude === 'olumi_estimate').length;
    expect(wrongCount).toBe(4);
  });

  it('user price £49 + supplied Olumi option price £59 + user-sized link counts the distinct setting', () => {
    const graph = {
      nodes: [
        { id: 'goal', kind: 'goal', label: 'MRR' },
        { id: 'price', kind: 'factor', label: 'Pro plan price', observed_state: { value: 49, extractionType: 'explicit' } },
        { id: 'raise-price', kind: 'option', label: 'Raise price', interventions: { price: 59 } },
      ],
      edges: [{ from: 'price', to: 'goal', provenance: { magnitude: 'user_stated' } }],
    };
    const signals = assembleGuidanceSignals({
      request: 'run_result', offeredSpecific: [], graph, analysisState: undefined,
      analysisResult: undefined, leaderLicensed: false,
    });
    const projected = {
      goalPathFactors: signals['model.goal_path_factors'], goalPathLinks: signals['model.goal_path_links'],
    };
    expect(projected.goalPathFactors[0]?.value_authorship).toBe('yours');
    expect(projected.goalPathLinks[0]?.link_sizing).toBe('user');
    expect(olumiEstimatesFeedingResult(projected).count).toBe(0);
    const e = olumiEstimatesFeedingResult({
      ...projected,
      optionSettings: [{ id: 'raise-price:price', label: 'Raise price: £59', authorship: 'olumi_estimate', goal_distance: 1 }],
    });
    expect(e.values).toEqual([{ kind: 'value', id: 'raise-price:price', label: 'Raise price: £59', goal_distance: 1 }]);
    expect(e.count).toBe(1);
  });

  it('option settings count estimates once, separate accepted, and exclude other authorship', () => {
    const setting = { id: 'option:price', label: 'Option price', authorship: 'olumi_estimate' };
    const e = olumiEstimatesFeedingResult({
      goalPathFactors: [factor('price')], goalPathLinks: [],
      optionSettings: [setting, setting, { ...setting, id: 'accepted', authorship: 'olumi_accepted' },
        ...['user', 'placeholder', 'unknown'].map(authorship => ({ ...setting, id: authorship, authorship }))],
    });
    expect(e.count).toBe(2);
    expect(e.values.map(item => item.id)).toEqual(['price', 'option:price']);
    expect(e.values[1]?.goal_distance).toBe(99);
    expect(e.accepted).toBe(1);
    expect(e.placeholderLinks).toBe(0);
  });

  it('accepted links join accepted values; user/unknown/unmarked figures stay outside N', () => {
    const e = olumiEstimatesFeedingResult({
      goalPathFactors: [factor('estimate'), factor('accepted', 'olumi_accepted'), factor('yours', 'yours'), factor('unknown', 'unknown')],
      goalPathLinks: [link('accepted->mrr', 'olumi_accepted'), link('user->mrr', 'user'), link('unmarked->mrr', 'unmarked')],
    });
    expect(e.count).toBe(1);
    expect(e.accepted).toBe(2);
    expect(e.links).toEqual([]);
    expect(sayOlumiEstimates(e)).toContain("2 you accepted from Olumi's suggestions.");
  });

  it('repeated path IDs count once and never repeat a top item', () => {
    const f = factor('price');
    const l = link('price->mrr');
    const e = olumiEstimatesFeedingResult({ goalPathFactors: [f, f], goalPathLinks: [l, l], driverIds: ['price', 'price'] });
    expect(e.count).toBe(2);
    expect(e.top.map(item => item.id)).toEqual(['price', 'price->mrr']);
  });
});

describe('RC4: licensed top-three order and exact shared words', () => {
  it('the 3 that matter most only with matching measured driverIds, including a link ID', () => {
    const e = olumiEstimatesFeedingResult({ ...paul(), driverIds: ['price', 'driver-7->mrr', 'driver-0->mrr'] });
    expect(e.top.map(item => item.id)).toEqual(['price', 'driver-7->mrr', 'driver-0->mrr']);
    expect(e.ordered).toBe(true);
    expect(sayOlumiEstimates(e)).toContain('The 3 that matter most:');
    expect(sayOlumiEstimates(e)).not.toContain('For example:');
  });

  it.each([{ driverIds: ['price'] }, { driverIds: ['price', 'driver-7->mrr'] }])('partial measured order $driverIds leaves top three as examples', ({ driverIds }) => {
    const e = olumiEstimatesFeedingResult({ ...paul(), driverIds });
    expect(e.top).toHaveLength(3);
    expect(e.top[0]?.id).toBe('price');
    expect(e.ordered).toBe(false);
    expect(sayOlumiEstimates(e)).toContain('For example:');
    expect(sayOlumiEstimates(e)).not.toContain('The 3 that matter most:');
  });

  it('a measured order covering fewer than three total figures is still complete', () => {
    const e = olumiEstimatesFeedingResult({ goalPathFactors: [factor('price')], goalPathLinks: [], driverIds: ['price'] });
    expect(e.ordered).toBe(true);
    expect(sayOlumiEstimates(e)).toContain('The one that matters most:');
  });

  it.each([undefined, [], ['not-on-this-goal-path']])('for example when driverIds supplies no top item (%j)', driverIds => {
    const e = olumiEstimatesFeedingResult({ ...paul(), driverIds });
    expect(e.ordered).toBe(false);
    expect(sayOlumiEstimates(e)).toContain('For example:');
    expect(sayOlumiEstimates(e)).not.toContain('The 3 that matter most:');
  });

  it('nearest-to-goal then ID order spans both kinds, without mutating the signal arrays', () => {
    const input = {
      goalPathFactors: [factor('z-near', 'olumi_estimate', 1), factor('a-far', 'olumi_estimate', 5)],
      goalPathLinks: [link('b->mrr', 'olumi_estimate', 1), link('a->mrr', 'olumi_estimate', 1)],
    };
    const before = structuredClone(input);
    expect(olumiEstimatesFeedingResult(input).top.map(item => item.id)).toEqual(['a->mrr', 'b->mrr', 'z-near']);
    expect(input).toEqual(before);
  });

  it.each([
    [1, 'Olumi supplied 1 of the figures behind this result: 1 value.'],
    [2, 'Olumi supplied 2 of the figures behind this result: 2 values.'],
    [3, 'Olumi supplied 3 of the figures behind this result: 3 values.'],
  ])('value-only census %i drops the zero kind and has no cap line', (count, words) => {
    const lines = sayOlumiEstimates(census(count));
    expect(lines[0]).toBe(words);
    expect(lines.some(line => line.includes('in total; here are'))).toBe(false);
  });

  it.each([
    [1, 'Olumi supplied 1 of the figures behind this result: 1 link size.'],
    [2, 'Olumi supplied 2 of the figures behind this result: 2 link sizes.'],
  ])('link-only census %i drops the zero kind with singular/plural words', (count, words) => {
    const e = olumiEstimatesFeedingResult({ goalPathFactors: [], goalPathLinks: Array.from({ length: count }, (_, i) => link(`f-${i}->mrr`)) });
    expect(sayOlumiEstimates(e)[0]).toBe(words);
  });

  it('UNVERIFIED AIQ zero-count words retain separate accepted and placeholder disclosures', () => {
    const e = olumiEstimatesFeedingResult({
      goalPathFactors: [factor('accepted', 'olumi_accepted')],
      goalPathLinks: [link('empty-1->mrr', 'placeholder'), link('empty-2->mrr', 'placeholder')],
    });
    expect(e.count).toBe(0);
    expect(e.accepted).toBe(1);
    expect(e.placeholderLinks).toBe(2);
    expect(sayOlumiEstimates(e)).toEqual([
      "None of the figures behind this result are Olumi's estimates.",
      "1 you accepted from Olumi's suggestions.",
      '2 links have no size yet.',
    ]);
  });

  it('zero estimates with no accepted figures or placeholders has only the None line', () => {
    expect(sayOlumiEstimates(census(0))).toEqual(["None of the figures behind this result are Olumi's estimates."]);
  });
});

// TL 20:48 replaces the blanket narrator-count ban: this boundary proves a contradiction, not a wording violation.
describe('the one record-grounded narrator count check', () => {
  it.each([
    'Olumi supplied 1 value.', 'Olumi supplied 8 links.', 'Olumi supplied 9 figures.',
    'I supplied 1 value.', 'I estimated 8 links.', 'Olumi’s estimates: 9, see Check estimates.',
  ])('keeps a matching recorded count and its exact bytes: %s', text => {
    const wrapped = `  ${text}  `;
    expect(narratorCountGuard(wrapped, olumiEstimatesFeedingResult(paul()), 'olumi')).toEqual({ text: wrapped, removed: [] });
  });

  it.each([
    'Olumi supplied 9 underlying values.', 'Olumi supplied 99 links.', 'Olumi supplied 6 figures.',
    'I supplied 4 of the values behind this.', 'I supplied 99 links.', 'I estimated 3 of the links.',
    'Olumi’s estimates: 99, see Check estimates.', 'Olumi supplied 9.5 values.',
  ])('removes only a proved count/kind contradiction: %s', sentence => {
    expect(narratorCountGuard(sentence, olumiEstimatesFeedingResult(paul()), 'olumi')).toEqual({ text: '', removed: [sentence] });
  });

  it.each([
    "Nine underlying values are Olumi's assumptions.", "Twenty-one values were Olumi's estimates.",
    "Nine of Olumi's values feed this result.", "Olumi's estimates feed 99 links.", "Olumi's estimates fed 99 links.",
    "I've supplied 99 links.", 'Olumi has provided 99 links.',
    '- Olumi supplied 99 links.', '- **Olumi supplied 99 links.**', '• I supplied 99 links.',
    '1. Olumi supplied 99 links.', '1) _Olumi supplied 99 links._',
    'The analysis ran, but the links remain unsized, and 16 underlying values are Olumi’s assumptions, not yours.',
  ])('the ruled possessive, inflected and list forms still require recorded agreement: %s', sentence => {
    expect(narratorCountGuard(sentence, olumiEstimatesFeedingResult(paul()), 'olumi')).toEqual({ text: '', removed: [sentence] });
  });

  it.each([
    'supply', 'supplies', 'supplying', 'supplied', 'estimate', 'estimates', 'estimating', 'estimated',
    'provide', 'provides', 'providing', 'provided', 'give', 'gives', 'giving', 'gave', 'given', 'feed', 'feeds', 'feeding', 'fed',
  ])('the five closed predicate families compare counts, never tense: %s', verb => {
    const falseClaim = `Olumi ${verb} 99 links.`;
    expect(narratorCountGuard(falseClaim, { links: 8 })).toEqual({ text: '', removed: [falseClaim] });
    const matching = `Olumi ${verb} 8 links.`;
    expect(narratorCountGuard(matching, { links: 8 })).toEqual({ text: matching, removed: [] });
  });

  it.each([
    '- Olumi supplied 8 links.', '- **Olumi supplied 8 links.**', '• I supplied 8 links.',
    '1. Olumi supplied 8 links.', '1) _Olumi supplied 8 links._',
    "One underlying value is Olumi's assumption.", "Olumi's estimates feed 8 links.", "I've supplied 8 links.",
  ])('format and possessive ownership cannot erase a matching count: %s', text => {
    expect(narratorCountGuard(text, olumiEstimatesFeedingResult(paul()), 'olumi')).toEqual({ text, removed: [] });
  });

  it('a multiline list removes the contradicted item and keeps the matching item', () => {
    const text = 'The figures are provisional.\n- Olumi supplied 99 links.\n- Olumi supplied 8 links.';
    expect(narratorCountGuard(text, { links: 8 })).toEqual({
      text: 'The figures are provisional.\n- Olumi supplied 8 links.', removed: ['- Olumi supplied 99 links.'],
    });
  });

  it('an equal total cannot license the wrong kind: one value plus eight links is not nine values', () => {
    const sentence = 'Olumi supplied nine underlying values.';
    expect(narratorCountGuard(sentence, olumiEstimatesFeedingResult(paul()))).toEqual({ text: '', removed: [sentence] });
    expect(narratorCountGuard('Olumi supplied nine figures.', olumiEstimatesFeedingResult(paul())).removed).toEqual([]);
  });

  it.each([
    'values', 'figures', 'inputs', 'assumptions', 'estimates', 'numbers', 'links', 'relationships', 'sizes', 'strengths',
    'value', 'figure', 'input', 'assumption', 'estimate', 'number', 'link', 'relationship', 'size', 'strength', 'link sizes',
  ])('retains the count-kind negative at an evidenced zero: %s', noun => {
    for (const sentence of [`Olumi supplied 6 ${noun}.`, `6 ${noun} were supplied by Olumi.`]) {
      expect(narratorCountGuard(sentence, census(0))).toEqual({ text: '', removed: [sentence] });
    }
  });

  it.each([
    'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
    'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
    'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety',
    'twenty-one', 'thirty-five', 'ninety-nine', '9.0', '1,000', '**9**', '_nine_',
  ])('a known count still contradicts recorded zero: %s', word => {
    const sentence = `Olumi supplied ${word} assumptions.`;
    expect(narratorCountGuard(sentence, census(0))).toEqual({ text: '', removed: [sentence] });
  });

  it('grouping and decimal notation retain the numeric value, rather than manufacturing 90 from 9.0', () => {
    for (const text of ['Olumi supplied 9.0 values.', 'Olumi supplied **9** values.']) {
      expect(narratorCountGuard(text, census(9))).toEqual({ text, removed: [] });
    }
  });

  it.each([
    'I supplied 99 links.', 'Olumi supplied 6 values.', "Olumi's estimates: 99, see Check estimates.",
  ])('missing evidence never becomes a contradiction: %s', text => {
    expect(narratorCountGuard(text, null, 'olumi')).toEqual({ text, removed: [] });
  });

  it.each([
    'Shall I save the £50,000 assumption for Hire PA?', 'I have set the £45,000 figure for Hire PA.',
    "Olumi's £50,000 assumption for Hire PA is a starting value.", 'Olumi supplied £50,000 as a starting value.',
    'I need 2 values for this worksheet.', 'Can I check your two assumptions?', 'I supplied 99 links?', 'Olumi used 3 figures you gave.',
    'Olumi assumed 3 hours per week for onboarding.', 'Olumi estimated a 2.5% churn rate.', 'Olumi set 12 months as the horizon.',
    'Paul said I supplied 99 links.', 'Paul said Olumi supplies 99 links.', 'Paul said, “Olumi supplied 99 links.”', '“I supplied 99 links.”', 'I did not supply 4 values.', 'I have not supplied 4 values.', 'Olumi does not supply 99 links.', "I've not supplied 99 links.",
    'Olumi supplied dozens of values.', 'Olumi supplied hundreds of values.', 'Olumi supplied nine of the underlying estimated values.',
    'You supplied 6 values.', 'You supplied 6 values and Olumi estimated the price.',
    'Olumi estimated the price and six values were yours.',
  ])('non-claims, requests, quantities, reported/negated or unknown claims keep their bytes: %s', text => {
    expect(narratorCountGuard(text, census(1), 'olumi')).toEqual({ text, removed: [] });
  });

  it.each([
    'Paul said, I supplied 99 links.',
    'You wrote: I supplied 6 values.',
    'When you give 3 values, Olumi estimates 2 links.',
  ])('a reported, echoed or conditional count is not a performed claim about this Run: %s', text => {
    expect(narratorCountGuard(text, census(1), 'olumi')).toEqual({ text, removed: [] });
  });

  it.each([
    'I supplied 99 links.', 'I supplied 6 values.', 'Olumi estimates 2 links.',
  ])('the corresponding asserted current-Run claim is still removed: %s', sentence => {
    expect(narratorCountGuard(sentence, census(1), 'olumi')).toEqual({ text: '', removed: [sentence] });
  });

  it.each([';', '—', '\n', ',', ':'])(
    'a second asserted current count still contradicts its record across %s', separator => {
      const text = `Olumi supplied 1 value${separator} Olumi supplied 99 links.`;
      expect(narratorCountGuard(text, census(1), 'olumi')).toEqual({ text: '', removed: [text] });
    },
  );

  it.each([',', ':'])('a known user count does not turn a later Olumi assertion into a reported lead: %s', separator => {
    const text = `You supplied 6 values${separator} I supplied 99 links.`;
    expect(narratorCountGuard(text, census(1), 'olumi')).toEqual({ text: '', removed: [text] });
  });

  it.each([
    'Paul said, I supplied 99 links.', 'You wrote: I supplied 6 values.',
    'When you give 3 values, Olumi estimates 2 links.',
  ])('a matching current clause does not assert a later reported or conditional clause: %s', reported => {
    const text = `Olumi supplied 1 value; ${reported}`;
    expect(narratorCountGuard(text, census(1), 'olumi')).toEqual({ text, removed: [] });
  });

  it('the canonical matching census label still lets a later false performed claim be checked', () => {
    const text = "Olumi's estimates: 1, I supplied 99 links.";
    expect(narratorCountGuard(text, census(1), 'olumi')).toEqual({ text: '', removed: [text] });
  });

  it.each([
    'Paul said, I supplied 99 links and Olumi supplied 6 values.',
    'You wrote: I supplied 6 values and Olumi supplied 99 links.',
    'When you give 3 values, Olumi estimates 2 links and I supplied 99 links.',
  ])('coordination cannot promote a reported or conditional count to a current assertion: %s', text => {
    expect(narratorCountGuard(text, census(1), 'olumi')).toEqual({ text, removed: [] });
  });

  it('an independent false current claim is still checked after a reported clause', () => {
    const text = 'Paul said, I supplied 8 links; I supplied 99 links.';
    expect(narratorCountGuard(text, census(1), 'olumi')).toEqual({ text: '', removed: [text] });
  });

  it('conditional reasoning survives beside a separate false performed claim', () => {
    const hypothetical = 'When you give 3 values, Olumi estimates 2 links.';
    const falseCurrent = 'I supplied 99 links.';
    expect(narratorCountGuard(`${hypothetical} ${falseCurrent}`, census(1), 'olumi')).toEqual({
      text: hypothetical, removed: [falseCurrent],
    });
  });

  it('correct and contradicted clauses do not erase an unrelated kept sentence', () => {
    const falseClaim = 'Olumi supplied 8 links!';
    const text = `Olumi estimated the price. Olumi supplied 1 value. ${falseClaim}`;
    expect(narratorCountGuard(text, census(1))).toEqual({
      text: 'Olumi estimated the price. Olumi supplied 1 value.', removed: [falseClaim],
    });
  });

  it('a later contradictory coordinated clause is still checked against its own count kind', () => {
    const sentence = 'Olumi supplied 1 value and 4 links.';
    expect(narratorCountGuard(sentence, census(1))).toEqual({ text: '', removed: [sentence] });
    const independent = 'You supplied 6 values and Olumi supplied 30 links.';
    expect(narratorCountGuard(independent, census(1))).toEqual({ text: '', removed: [independent] });
  });

  it.each([' '.repeat(20_000), 'Olumi nine of the '.repeat(1250)])('bounded scan retains unknown long text', text => {
    const start = performance.now();
    expect(narratorCountGuard(text, census(1))).toEqual({ text, removed: [] });
    if (timingGated) expect(performance.now() - start).toBeLessThan(50);
  });
});
