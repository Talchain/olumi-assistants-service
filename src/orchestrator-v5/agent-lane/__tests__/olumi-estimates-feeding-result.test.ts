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

describe('RC4: narrator count egress guard', () => {
  it('MUTANT: narrator-invented N → RED; Nine is removed when count is not 9', () => {
    const sentence = "Nine underlying values are Olumi's assumptions.";
    expect(narratorCountGuard(sentence, census(1))).toEqual({ text: '', removed: [sentence] });
  });

  it('Nine underlying values is removed for Paul’s N=9 of one value and eight links too', () => {
    const sentence = "Nine underlying values are Olumi's assumptions.";
    expect(narratorCountGuard(`  ${sentence}  `, olumiEstimatesFeedingResult(paul()))).toEqual({ text: '', removed: [sentence] });
  });

  it('without a producer removes Six underlying values were supplied by Olumi, not you', () => {
    const sentence = 'Six underlying values were supplied by Olumi, not you.';
    expect(narratorCountGuard(sentence, null)).toEqual({ text: '', removed: [sentence] });
  });

  it('leaves Olumi estimated the price and every sentence without an attributed count untouched', () => {
    const text = 'Olumi estimated the price. You supplied 6 values. Several assumptions remain unresolved.';
    expect(narratorCountGuard(text, null)).toEqual({ text, removed: [] });
  });

  it.each([1, 2])('R16 K_WORDS: a narrated %i-relationship attribution still needs the producer', k => {
    const sentence = `Raise to £59: about 67% chance of meeting your goal, in this model, using Olumi's estimates for ${k} ${k === 1 ? 'relationship' : 'relationships'} (see Check estimates).`;
    expect(narratorCountGuard(sentence, null)).toEqual({ text: '', removed: [sentence] });
  });

  it.each([
    'values', 'figures', 'inputs', 'assumptions', 'estimates', 'numbers', 'links', 'relationships', 'sizes', 'strengths',
    'value', 'figure', 'input', 'assumption', 'estimate', 'number', 'link', 'relationship', 'size', 'strength', 'link sizes',
  ])('digits and %s work with Olumi before or after the count', noun => {
    for (const sentence of [`Olumi supplied 6 ${noun}.`, `6 ${noun} came from Olumi.`]) {
      expect(narratorCountGuard(sentence, census(9))).toEqual({ text: '', removed: [sentence] });
    }
  });

  it.each([
    'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
    'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
    'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety',
    'hundred', 'hundreds', 'dozen', 'dozens', 'twenty-one', 'thirty-five', 'ninety-nine',
  ])('number word %s is recognised in both directions', word => {
    const sentences = [`${word} underlying figures are Olumi’s estimates.`, `Olumi supplied ${word} assumptions.`];
    for (const sentence of sentences) expect(narratorCountGuard(sentence, null).removed).toEqual([sentence]);
  });

  it('digits above twenty, optional of the, wrapped sentences, and an unterminated last sentence', () => {
    for (const sentence of [
      'Olumi supplied 21 figures.', 'Olumi supplied 21 of the figures.',
      'Olumi supplied 21 of the underlying values.',
      'Nine underlying\nvalues are Olumi’s assumptions.', 'Olumi supplied 21 assumptions',
    ]) expect(narratorCountGuard(sentence, census(1))).toEqual({ text: '', removed: [sentence] });
  });

  it('removes every attributed count sentence, including matching counts, but keeps ordinary text', () => {
    const first = "Nine underlying values are Olumi's assumptions.";
    const second = 'Olumi supplied 8 figures!';
    const last = 'Four assumptions were supplied by Olumi';
    const matching = 'Olumi supplied 1 value.';
    const text = `Olumi estimated the price. ${first} Olumi supplied 1 value. ${second} ${last}`;
    expect(narratorCountGuard(text, census(1))).toEqual({
      text: 'Olumi estimated the price.', removed: [first, matching, second, last],
    });
  });

  it('a sentence containing both a correct count and an unsupported count is removed as a whole', () => {
    const sentence = 'Olumi supplied 9 values and 4 assumptions.';
    expect(narratorCountGuard(sentence, census(9))).toEqual({ text: '', removed: [sentence] });
  });

  it.each([
    'Olumi supplied thirty values.', "Twenty-one values were Olumi's estimates.",
    "Nine of Olumi's values feed this result.", 'Nine of Olumi’s values feed this result.',
    'Olumi supplied 99 link sizes.', 'Olumi supplied dozens of link strengths.',
    'Olumi supplied nine of its own values.', 'Olumi supplied nine of their own values.',
    'Olumi supplied nine of these starting values.', 'Olumi supplied nine of those estimated values.',
  ])('expanded count attribution is removed: %s', sentence => {
    expect(narratorCountGuard(sentence, census(1))).toEqual({ text: '', removed: [sentence] });
  });

  it.each([', and', ';', ':', '—', 'and', 'but', 'while', 'whereas'])('scopes unrelated user counts across %s', separator => {
    for (const text of [
      `You supplied 6 values ${separator} Olumi estimated the price.`,
      `Olumi estimated the price ${separator} you supplied six values.`,
    ]) expect(narratorCountGuard(text, olumiEstimatesFeedingResult(paul()))).toEqual({ text, removed: [] });
  });

  it('keeps the exact buddy unrelated-count sentence byte-for-byte', () => {
    const text = 'You supplied 6 values, and Olumi estimated the price.';
    expect(narratorCountGuard(text, olumiEstimatesFeedingResult(paul()))).toEqual({ text, removed: [] });
  });

  it.each([
    'You supplied six values and Olumi suggests the price.',
    'You supplied six values and Olumi’s estimate was useful.',
    'You wrote six values while Olumi estimated the price.',
    'Olumi likes the price and you wrote six values.',
    'Olumi and you supplied six values.',
  ])('explicit subjects distinguish clauses from coordinated subjects: %s', text => {
    const out = narratorCountGuard(text, null);
    if (text.startsWith('Olumi and')) expect(out).toEqual({ text: '', removed: [text] });
    else expect(out).toEqual({ text, removed: [] });
  });

  it.each([
    'Six underlying values were supplied by Olumi, not you.',
    'You supplied 6 values, and Olumi supplied thirty links.',
    'Olumi supplied values and 6 link sizes.',
    'Olumi-generated six values feed this result.',
  ])('one attributed clause removes the entire sentence: %s', sentence => {
    expect(narratorCountGuard(sentence, census(6))).toEqual({ text: '', removed: [sentence] });
  });

  it('splits coordinated clauses beginning with count+noun+predicate', () => {
    const text = "Olumi estimated the price and six values were yours.";
    expect(narratorCountGuard(text, null)).toEqual({ text, removed: [] });
  });

  it('limits filler skipping to three tokens', () => {
    const text = 'Olumi supplied nine of the underlying estimated values.';
    expect(narratorCountGuard(text, null)).toEqual({ text, removed: [] });
  });

  it('buddy r2: grouped, decimal and emphasised figures are still counts of Olumi\'s figures, so they are removed', () => {
    for (const text of ['Olumi supplied 9.0 values.', 'Olumi supplied 1,000 values.', 'Olumi supplied **9** values.', 'Olumi supplied _nine_ values.']) {
      expect(narratorCountGuard(text, null).removed, text).toEqual([text])
    }
  });

  it('a kept sentence keeps its original bytes (emphasis and separators untouched)', () => {
    const text = 'Olumi estimated **£1,000** for the price.';
    expect(narratorCountGuard(text, null)).toEqual({ text, removed: [] });
  });

  it('20,000-char whitespace input runs in less than 50 ms', () => {
    const text = ' '.repeat(20_000);
    const start = performance.now();
    const out = narratorCountGuard(text, null);
    const elapsed = performance.now() - start;
    process.stdout.write(`20,000-char whitespace timing: ${elapsed.toFixed(3)} ms\n`);
    expect(out).toEqual({ text, removed: [] });
    if (timingGated) { expect(elapsed).toBeLessThan(50); }
  });

  it('20,000-char repeated Olumi nine of the input runs in less than 50 ms', () => {
    const text = 'Olumi nine of the '.repeat(Math.ceil(20_000 / 'Olumi nine of the '.length)).slice(0, 20_000);
    const start = performance.now();
    const out = narratorCountGuard(text, null);
    const elapsed = performance.now() - start;
    process.stdout.write(`20,000-char repeated Olumi nine of the timing: ${elapsed.toFixed(3)} ms\n`);
    expect(out).toEqual({ text, removed: [] });
    if (timingGated) { expect(elapsed).toBeLessThan(50); }
  });
});
