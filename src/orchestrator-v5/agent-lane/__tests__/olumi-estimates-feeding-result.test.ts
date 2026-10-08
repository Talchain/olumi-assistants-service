import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
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

  it('an Olumi-filled option setting represented by a goal-path factor is counted', () => {
    const e = olumiEstimatesFeedingResult({ goalPathFactors: [factor('option-setting')], goalPathLinks: [] });
    expect(e.values.map(item => item.id)).toEqual(['option-setting']);
    expect(e.count).toBe(1);
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
    const e = olumiEstimatesFeedingResult({ ...paul(), driverIds: ['price', 'driver-7->mrr'] });
    expect(e.top.map(item => item.id)).toEqual(['price', 'driver-7->mrr', 'driver-0->mrr']);
    expect(e.ordered).toBe(true);
    expect(sayOlumiEstimates(e)).toContain('The 3 that matter most:');
    expect(sayOlumiEstimates(e)).not.toContain('For example:');
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

  it('UNVERIFIED AIQ zero-count words are a single line, including an accepted/placeholder-only model', () => {
    const e = olumiEstimatesFeedingResult({ goalPathFactors: [factor('accepted', 'olumi_accepted')], goalPathLinks: [link('empty->mrr', 'placeholder')] });
    expect(e.count).toBe(0);
    expect(e.accepted).toBe(1);
    expect(e.placeholderLinks).toBe(1);
    expect(sayOlumiEstimates(e)).toEqual(["None of the figures behind this result are Olumi's estimates."]);
  });
});

describe('RC4: narrator count egress guard', () => {
  it('MUTANT: narrator-invented N → RED; Nine is removed when count is not 9', () => {
    const sentence = "Nine underlying values are Olumi's assumptions.";
    expect(narratorCountGuard(sentence, census(1))).toEqual({ text: '', removed: [sentence] });
  });

  it('Nine is retained byte-for-byte when the producer count is 9', () => {
    const text = "  Nine underlying values are Olumi's assumptions.  ";
    expect(narratorCountGuard(text, census(9))).toEqual({ text, removed: [] });
  });

  it('without a producer removes Six underlying values were supplied by Olumi, not you', () => {
    const sentence = 'Six underlying values were supplied by Olumi, not you.';
    expect(narratorCountGuard(sentence, null)).toEqual({ text: '', removed: [sentence] });
  });

  it('leaves Olumi estimated the price and every sentence without an attributed count untouched', () => {
    const text = 'Olumi estimated the price. You supplied 6 values. Several assumptions remain unresolved.';
    expect(narratorCountGuard(text, null)).toEqual({ text, removed: [] });
  });

  it.each(['values', 'figures', 'inputs', 'assumptions', 'value', 'figure', 'input', 'assumption'])('digits and %s work with Olumi before or after the count', noun => {
    for (const sentence of [`Olumi supplied 6 ${noun}.`, `6 ${noun} came from Olumi.`]) {
      expect(narratorCountGuard(sentence, census(9))).toEqual({ text: '', removed: [sentence] });
    }
  });

  it.each([
    'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
    'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty',
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

  it('removes every mismatched sentence but retains a correct count and ordinary text', () => {
    const first = "Nine underlying values are Olumi's assumptions.";
    const second = 'Olumi supplied 8 figures!';
    const last = 'Four assumptions were supplied by Olumi';
    const text = `Olumi estimated the price. ${first} Olumi supplied 1 value. ${second} ${last}`;
    expect(narratorCountGuard(text, census(1))).toEqual({
      text: 'Olumi estimated the price. Olumi supplied 1 value.', removed: [first, second, last],
    });
  });

  it('a sentence containing both a correct count and an unsupported count is removed as a whole', () => {
    const sentence = 'Olumi supplied 9 values and 4 assumptions.';
    expect(narratorCountGuard(sentence, census(9))).toEqual({ text: '', removed: [sentence] });
  });

  it('compound/decimal/grouped fragments do not masquerade as a supported integer count', () => {
    for (const text of ['Twenty-one values were supplied by Olumi.', 'Olumi supplied 9.0 values.', 'Olumi supplied 1,000 values.']) {
      expect(narratorCountGuard(text, null)).toEqual({ text, removed: [] });
    }
  });

  it('20,000-char whitespace input runs in less than 50 ms', () => {
    const text = ' '.repeat(20_000);
    const start = performance.now();
    const out = narratorCountGuard(text, null);
    const elapsed = performance.now() - start;
    process.stdout.write(`20,000-char whitespace timing: ${elapsed.toFixed(3)} ms\n`);
    expect(out).toEqual({ text, removed: [] });
    expect(elapsed).toBeLessThan(50);
  });
});
