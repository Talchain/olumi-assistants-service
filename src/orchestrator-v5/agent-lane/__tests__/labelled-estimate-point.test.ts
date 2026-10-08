import { describe, expect, it, vi } from 'vitest';
import { goalChanceScreenLinesForAgent, withScreenLinesOwed } from '../goal-chance-screen-lines.js';
import { narratorCountGuard, olumiEstimatesFeedingResult } from '../olumi-estimates-feeding-result.js';
import { assembleGuidanceSignals } from '../turn-context/guidance-signals.js';
import * as rc4 from '../olumi-estimates-feeding-result.js';

type Json = Record<string, any>;
const graph = (): Json => ({ nodes: [
  { id: 'mrr', kind: 'goal', label: 'MRR', goal_direction: '>=', goal_threshold_raw: 20000, goal_threshold_unit: '£/month' },
  { id: 'price', kind: 'factor', label: 'Pro plan price', observed_state: { value: 49, extractionType: 'inferred' } },
  { id: 'accepted', kind: 'factor', label: 'Accepted input' },
  { id: 'placeholder', kind: 'factor', label: 'Unsized input' },
  { id: 'off', kind: 'factor', label: 'Off-path input' },
  { id: 'off-end', kind: 'factor', label: 'Off-path end' },
  { id: 'raise', kind: 'option', label: 'Raise to £59', interventions: { price: 59, accepted: 1, placeholder: 1, off: 1 } },
  { id: 'hold', kind: 'option', label: 'Keep £49', interventions: { price: 49 } },
], edges: [
  { from: 'price', to: 'mrr', provenance: { magnitude: 'olumi_estimate' }, strength: { mean: 0.7, std: 0.1 } },
  { from: 'accepted', to: 'mrr', provenance: { magnitude: 'olumi_estimate', reviewed_by_user: { intent: 'confirm' } } },
  { from: 'placeholder', to: 'mrr', provenance: { magnitude: 'olumi_placeholder' } },
  { from: 'off', to: 'off-end', provenance: { magnitude: 'olumi_estimate' } },
] });
const result = (): Json => ({ type: 'analysis_result', enrichment: { inference_warnings: [{
  code: 'GOAL_CHANCE_LICENSED', severity: 'info', message: 'Each option’s chance of meeting your goal is licensed on this Run.',
  form: 'each', option_ids: ['raise', 'hold'], pct_by_option: { raise: 67, hold: 43 },
  target: { comparator: 'at_least', value: 20000, unit: '£/month' },
}] } });
const estimatesOf = (g: Json) => {
  const signals = assembleGuidanceSignals({ request: 'run_result', graph: g, offeredSpecific: [],
    analysisState: undefined, analysisResult: result(), leaderLicensed: false });
  return olumiEstimatesFeedingResult({ goalPathFactors: signals['model.goal_path_factors'], goalPathLinks: signals['model.goal_path_links'] });
};
const wanted = (label: string, pct: number, k = 1): string => `‘${label}’: about ${pct}% chance of meeting your goal, in this model, using Olumi's estimates for ${k} ${k === 1 ? 'link' : 'links'} (see Check estimates).`;

describe('GP round 4: a point shown with goal-path estimates carries the RC4 label', () => {
  it('singular, same existing option prefix and licensed order: 1 link, not values, accepted, placeholders or off-path estimates', () => {
    const g = graph(), e = estimatesOf(g);
    expect(e.links.map(l => l.id)).toEqual(['price->mrr']);
    expect(e.count).toBe(2); // The total includes a value: using it for k is the wrong meaning.
    expect(e.accepted).toBe(1); expect(e.placeholderLinks).toBe(1);
    expect(goalChanceScreenLinesForAgent(result(), g, true).map(l => l.chance)).toEqual([
      wanted('Raise to £59', 67), wanted('Keep £49', 43),
    ]);
  });
  it('plural: two on-path unaccepted Olumi estimates use "for 2 links"', () => {
    const g = graph(); g.edges[1].provenance = { magnitude: 'olumi_estimate' };
    expect(goalChanceScreenLinesForAgent(result(), g, true)[0]!.chance).toBe(wanted('Raise to £59', 67, 2));
  });
  it('a specialised deadline point keeps its existing chance words and also carries the RC4 link label', () => {
    const g = graph(), r = result();
    Object.assign(r.enrichment.inference_warnings[0].target,
      { unit: '% of the feature launch', value: 100, by_date: '2027-04-07' });
    expect(goalChanceScreenLinesForAgent(r, g, true)[0]!.chance).toBe(
      "‘Raise to £59’: about 67% chance of launching by 7 April 2027, in this model, using Olumi's estimates for 1 link (see Check estimates).");
  });
  it.each(['highest', 'highest_all_likely_to_miss', 'all_likely_to_miss', 'similar'])(
    '%s licence: every licensed generic point carries the label without changing form or percentages', form => {
      const r = result(), licence = r.enrichment.inference_warnings[0];
      licence.form = form;
      if (form.startsWith('highest')) { licence.leader_option_id = 'raise'; licence.next_option_id = 'hold'; }
      if (form === 'similar') licence.similar_option_ids = ['raise', 'hold'];
      const pct = form.includes('likely_to_miss') ? { raise: 27, hold: 3 }
        : form === 'similar' ? { raise: 67, hold: 65 } : { raise: 67, hold: 43 };
      licence.pct_by_option = pct;
      const before = structuredClone(r);
      expect(goalChanceScreenLinesForAgent(r, graph(), true).map(l => l.chance)).toEqual([
        wanted('Raise to £59', pct.raise), wanted('Keep £49', pct.hold),
      ]);
      expect(r).toEqual(before);
      const g = graph(); g.edges[0].provenance = { magnitude: 'user_stated' };
      expect(goalChanceScreenLinesForAgent(r, g, true)).toEqual([]);
    },
  );
  it('control: k=0 is byte-identical and a non-current Run owes no figures', () => {
    const g = graph(); g.edges[0].provenance = { magnitude: 'user_stated' };
    expect(goalChanceScreenLinesForAgent(result(), g, true)[0]!.chance)
      .toBe('‘Raise to £59’: about 67% chance of meeting your goal, in this model.');
    expect(goalChanceScreenLinesForAgent(result(), graph(), false)).toEqual([]);
  });
  it('a retained-excluded path does not feed this Run and contributes no estimate to k', () => {
    const g = graph(); g.nodes.find((n: Json) => n.id === 'accepted').analysis_participation = 'retained_excluded';
    g.edges[1].provenance = { magnitude: 'olumi_estimate' };
    expect(goalChanceScreenLinesForAgent(result(), g, true)[0]!.chance).toBe(wanted('Raise to £59', 67));
  });
  it('the narrator cannot discharge the labelled sentence by repeating the option and an unlabelled figure', () => {
    const lines = goalChanceScreenLinesForAgent(result(), graph(), true);
    const out = withScreenLinesOwed('Raise to £59: about 67% chance of meeting your goal, in this model.', lines);
    expect(out.text).toContain(wanted('Raise to £59', 67));
    expect(out.text).toContain(wanted('Keep £49', 43));
  });
  it('RC4 producer, not a second count: the sentence reads exactly the producer’s link-size result', () => {
    const census = olumiEstimatesFeedingResult;
    const spy = vi.spyOn(rc4, 'olumiEstimatesFeedingResult').mockImplementationOnce(input => ({
      ...census(input), links: Array.from({ length: 7 }, (_, n) => ({
        kind: 'link' as const, id: `producer-${n}`, label: `Producer ${n}`, goal_distance: 0,
      })),
    }));
    try {
      expect(goalChanceScreenLinesForAgent(result(), graph(), true)[0]!.chance).toBe(wanted('Raise to £59', 67, 7));
      expect(spy).toHaveBeenCalledOnce();
    } finally { spy.mockRestore(); }
  });
  it('the existing RC4 guard removes even a correct narrator k, then deterministic assembly supplies the one labelled point', () => {
    const narration = "Olumi's estimates feed 99 links. Raise to £59: about 67% chance of meeting your goal, in this model, using Olumi's estimates for 1 link (see Check estimates).";
    const guarded = narratorCountGuard(narration, estimatesOf(graph()));
    expect(guarded.removed).toHaveLength(2);
    const out = withScreenLinesOwed(narration, goalChanceScreenLinesForAgent(result(), graph(), true));
    expect(out.text).not.toContain('99 links');
    expect(out.text.split(wanted('Raise to £59', 67))).toHaveLength(2);
  });
});
