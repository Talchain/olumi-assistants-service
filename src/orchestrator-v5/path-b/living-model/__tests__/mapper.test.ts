import { describe, expect, it } from 'vitest';
import { GraphV3 } from '../../../../schemas/cee-v3.js';
import { LivingModel, type LivingModelT } from '../../../../schemas/living-model.js';
import { mapLivingModel } from '../mapper.js';
import { KNOWN_ANSWER } from './fixtures.js';

const node = (g: { nodes: Record<string, unknown>[] }, id: string) => g.nodes.find((n) => n.id === id) as Record<string, any>;
/** Standard normal CDF (Abramowitz–Stegun 7.1.26), enough for a 1e-4 check. */
function phi(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

describe('thin core mapper: living model → GraphV3', () => {
  it('the known-answer control maps to push ≈ Φ(−1) = 0.1587 and hold = 0 on the engine\'s own scale', () => {
    expect(LivingModel.safeParse(KNOWN_ANSWER).success).toBe(true);
    const { graph, withheld } = mapLivingModel(KNOWN_ANSWER);
    expect(withheld).toEqual([]);
    const goal = node(graph, 'g');
    expect(goal).toMatchObject({ kind: 'goal', goal_direction: '>=', goal_threshold_raw: 100, goal_threshold_cap: 125, goal_threshold: 0.8, goal_threshold_frame: 'level' });
    expect(goal.observed_state).toMatchObject({ value: 0.56, baseline: 0.56, raw_value: 70, cap: 125, source: 'brief_extraction' });
    expect(node(graph, 'f').observed_state).toMatchObject({ value: 0.5, raw_value: 0.5, cap: 1 });
    expect(node(graph, 'hold')).toMatchObject({ is_baseline: true, interventions: { f: { value: 0.5, raw_value: 0.5 } } });
    expect(node(graph, 'push').interventions.f).toMatchObject({ value: 1, raw_value: 1 });
    const link = graph.edges.find((e) => e.from === 'f' && e.to === 'g') as Record<string, any>;
    expect(link.strength.mean).toBeCloseTo(0.4, 10);
    expect(link.strength.std).toBeCloseTo(0.08, 4);
    expect(link.provenance).toEqual({ source: 'brief_extraction', magnitude: 'user_stated' });
    // A linear Gaussian reading of the mapped graph reproduces the control's answers.
    const meetChance = (fTo: number) => {
      const mean = goal.observed_state.baseline + (fTo - 0.5) * link.strength.mean;
      const sd = Math.abs(fTo - 0.5) * link.strength.std;
      return sd === 0 ? (mean >= goal.goal_threshold ? 1 : 0) : 1 - phi((goal.goal_threshold - mean) / sd);
    };
    expect(meetChance(node(graph, 'push').interventions.f.value)).toBeCloseTo(0.1587, 3);
    expect(meetChance(node(graph, 'hold').interventions.f.value)).toBe(0);
  });

  it('the stored graph keeps the living model through a GraphV3 re-parse (never stripped)', () => {
    const { graph } = mapLivingModel(KNOWN_ANSWER);
    const parsed = GraphV3.safeParse({ ...graph, living_model: KNOWN_ANSWER });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.living_model).toEqual(KNOWN_ANSWER);
    // Contrast: a key the schema does not declare is stripped, so the declaration is what keeps it.
    const stray = GraphV3.safeParse({ ...graph, not_declared: { a: 1 } });
    expect(stray.success && 'not_declared' in stray.data).toBe(false);
  });

  it('unknown is never 0: an unstated level, a change target and an unsized link are withheld or placeholder, each with its reason', () => {
    const model: LivingModelT = structuredClone(KNOWN_ANSWER);
    model.factors[0]!.value = null;
    model.links[0]!.effect = { form: 'direction_only', value: null, low: null, high: null, unit: null, sign: '+' };
    const { graph, withheld } = mapLivingModel(model);
    expect(withheld).toContainEqual({ id: 'f', reason: 'factor_level_unknown' });
    expect(node(graph, 'f').observed_state).toBeUndefined();
    const link = graph.edges.find((e) => e.from === 'f' && e.to === 'g') as Record<string, any>;
    expect(link.provenance.magnitude).toBe('olumi_placeholder');

    const change: LivingModelT = structuredClone(KNOWN_ANSWER);
    change.aims[0]!.target!.comparator = 'increase';
    expect(mapLivingModel(change).withheld).toContainEqual({ id: 'g', reason: 'change_target_not_in_slice' });
  });

  it('attribution is a label: an unverified figure gets no stamp, Olumi\'s gets its own, a user\'s is the brief\'s', () => {
    const model: LivingModelT = structuredClone(KNOWN_ANSWER);
    model.factors[0]!.source = 'unverified';
    model.links[0]!.source = 'olumi';
    const { graph } = mapLivingModel(model);
    expect(node(graph, 'f').observed_state.source).toBeUndefined();
    const link = graph.edges.find((e) => e.from === 'f' && e.to === 'g') as Record<string, any>;
    expect(link.provenance).toEqual({ source: 'cee_hypothesis', magnitude: 'olumi_estimate' });
    expect(link.exists_probability).toBe(0.8);
  });
});
