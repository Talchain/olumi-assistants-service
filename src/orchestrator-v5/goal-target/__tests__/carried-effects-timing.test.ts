/**
 * The automatic Run's timing reading (DL 12:57Z 14 Oct): carried from the Run current when the turn began, only while the
 * change left its subject (the options and the goal) exactly as it was. On the served hiring model (post3009 read 01).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { carriedEffectsTiming, recordedEffectsTimingOf } from '../carried-effects-timing.js';
import { GOAL_CHANCE_LICENSED, PERIOD_END_EFFECTS_UNSTATED } from '../goal-chance-licence.js';
import { GOAL_FIGURES_TARGET_NOT_TESTABLE } from '../../../orchestrator/context/option-result-source.js';

type Rec = Record<string, any>;
const GRAPH = (JSON.parse(readFileSync('tests/fixtures/held-card/served-hiring-post3009-read01-20261014.json', 'utf8')) as { graph: Rec }).graph;
const clone = (): Rec => structuredClone(GRAPH);
const licensed = (reading: unknown, origin: unknown = 'olumi'): Rec => ({ type: 'analysis_result', enrichment: { inference_warnings: [{
  code: GOAL_CHANCE_LICENSED, form: 'each', option_ids: ['hire_a_tech_lead', 'hire_two_developers'],
  effects_timing: reading, effects_timing_origin: origin }] } });
const withheld = (reading: unknown): Rec => ({ type: 'analysis_result', enrichment: { inference_warnings: [{
  code: GOAL_FIGURES_TARGET_NOT_TESTABLE, option_ids: ['hire_a_tech_lead', 'hire_two_developers'],
  detail: { reason: PERIOD_END_EFFECTS_UNSTATED, effects_timing: reading, effects_timing_origin: reading === null ? null : 'olumi' } }] } });
/** An unrelated change: a link between two factors gets a strength (no option, no goal). */
const linkEdited = (): Rec => {
  const g = clone();
  const edge = g.edges.find((e: Rec) => !g.nodes.some((n: Rec) => n.id === e.from && (n.kind === 'option' || n.kind === 'goal')));
  edge.strength = { mean: 0.42, std: 0.1 };
  return g;
};

describe('the automatic Run carries the AI’s timing reading only while its subject stands', () => {
  it('fixture control: the unrelated edit really changed the model', () => {
    expect(JSON.stringify(linkEdited())).not.toBe(JSON.stringify(GRAPH));
  });

  it.each(['in_place_by_period', 'not_stated', 'later_or_partial'] as const)('the licence’s reading %s is carried over an unrelated edit', (reading) => {
    expect(carriedEffectsTiming({ graph: clone(), analysis_result: licensed(reading) }, linkEdited())).toBe(reading);
  });

  it('the period-end withhold’s recorded reading is carried too', () => {
    expect(carriedEffectsTiming({ graph: clone(), analysis_result: withheld('later_or_partial') }, linkEdited())).toBe('later_or_partial');
  });

  it('NEGATIVE: an option changed (its setting) → none', () => {
    const saved = linkEdited();
    saved.nodes.find((n: Rec) => n.id === 'hire_two_developers').interventions.mid_weight_developers = { unit: 'people', value: 0.3, raw_value: 3 };
    expect(carriedEffectsTiming({ graph: clone(), analysis_result: licensed('in_place_by_period') }, saved)).toBeNull();
  });

  it('NEGATIVE: a link from an option changed → none', () => {
    const saved = clone();
    const fromOption = saved.edges.find((e: Rec) => e.from === 'hire_a_tech_lead');
    fromOption.strength = { mean: 0.9, std: 0.05 };
    expect(carriedEffectsTiming({ graph: clone(), analysis_result: licensed('in_place_by_period') }, saved)).toBeNull();
  });

  it('NEGATIVE: an option added → none', () => {
    const saved = clone();
    saved.nodes.push({ id: 'contract_a_team', kind: 'option', label: 'Contract a team' });
    expect(carriedEffectsTiming({ graph: clone(), analysis_result: licensed('in_place_by_period') }, saved)).toBeNull();
  });

  it('NEGATIVE: the goal’s period changed → none', () => {
    const saved = clone();
    const goal = saved.nodes.find((n: Rec) => n.kind === 'goal');
    goal.goal_target_basis = { ...goal.goal_target_basis, period_months: 6 };
    expect(carriedEffectsTiming({ graph: clone(), analysis_result: licensed('in_place_by_period') }, saved)).toBeNull();
  });

  it('NEGATIVE: no reading recorded, a null reading, an unknown origin, or two readings that disagree → none', () => {
    const saved = linkEdited();
    expect(carriedEffectsTiming(undefined, saved)).toBeNull();
    expect(carriedEffectsTiming({ graph: clone(), analysis_result: undefined }, saved)).toBeNull();
    expect(carriedEffectsTiming({ graph: clone(), analysis_result: withheld(null) }, saved)).toBeNull();
    expect(carriedEffectsTiming({ graph: clone(), analysis_result: licensed('in_place_by_period', 'user') }, saved)).toBeNull();
    expect(carriedEffectsTiming({ graph: clone(), analysis_result: licensed('soon') }, saved)).toBeNull();
    const both = licensed('in_place_by_period');
    both.enrichment.inference_warnings.push(withheld('later_or_partial').enrichment.inference_warnings[0]);
    expect(recordedEffectsTimingOf(both)).toBeUndefined();
    expect(carriedEffectsTiming({ graph: clone(), analysis_result: both }, saved)).toBeNull();
  });
});
