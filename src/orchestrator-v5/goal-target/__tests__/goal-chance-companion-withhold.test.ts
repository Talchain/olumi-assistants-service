/**
 * ⛔ G4/G5 PHASE 2, CEE P2a (DL 0df0e1, design-g4g6 Q3): THE GOAL CHANCE'S PRECISION AND DRIVERS GO WHEREVER IT GOES.
 *
 * ISL (isl-4d, ruled) adds two blocks beside each option's `probability_of_goal`: `probability_of_goal_precision`
 * (Wilson interval; `n_met / n_informative` IS the figure) and `probability_of_goal_drivers` (tercile conditionals of it).
 * CEE withholds the figure by deleting it BY NAME at four sites, so without this the blocks would survive beside a
 * withheld figure. One row per site: a row carrying the figure plus both blocks comes out with NEITHER block (on base it
 * keeps both). CONTROL: a licensed figure keeps both blocks on the wire. The Agent never reads either block (its own row).
 *
 * The class (design-g4g6 Q3, re-derived at 89a85ca9 by `rg` for delete/destructure of `probability_of_goal` in non-test
 * `src`; contrast `delete …downside` = 1 site):
 *   1. `constraint-feasibility.ts` `withholdOptionGoalFigures`   (placeholder path, product unread, target not testable,
 *                                                                  identical arms, an unusable figure)
 *   2. `goal-chance-gate.ts` `stripGoalChancesWithNoTarget`      (no stated target)
 *   3. `goal-probability-transport.ts` `projectGoalProbabilitiesForTransport` (an unearned exact 0 / 1)
 *   4. `decision-sensitivity.ts` `optionRowsForAgent`            (the Agent's view: ALWAYS stripped)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { withholdOptionGoalFigures } from '../../../orchestrator/context/constraint-feasibility.js';
import { GOAL_CHANCE_COMPANION_KEYS, GOAL_FIGURES_PLACEHOLDER_PATH } from '../../../orchestrator/context/option-result-source.js';
import { withholdUnusableGoalChances } from '../goal-chance-gate.js';
import { projectGoalProbabilitiesForTransport } from '../../compose/goal-probability-transport.js';
import { analysisResultForAgent } from '../../agent-lane/decision-sensitivity.js';

type Json = Record<string, any>;
const RT10B = JSON.parse(readFileSync(new URL('../../tools/handlers/__tests__/fixtures/bprime-rt10b.json', import.meta.url), 'utf8')) as {
  graph_without_target: Json; graph_with_target: Json;
};
const GOAL = 'monthly_cancellations';

/** The ruled ISL shape (isl-4d §1–2 with the DL's R1–R4), hand-written: ISL and PLoT do not emit it yet. */
const precision = (n: number, met: number): Json => ({
  basis: 'simulation_precision', method: 'wilson_score', confidence_level: 0.95,
  n_informative: n, n_met: met, interval_lower: 0.39, interval_upper: 0.45,
});
const drivers = (): Json => ({
  method: 'tercile_conditional_v1', min_group_n: 30, n_candidates: 4, n_compared: 3, n_dropped: 1,
  dropped_by_reason: { no_variance: 1 },
  drivers: [{
    quantity_id: 'price->churn', from: 'price', to: 'churn', kind: 'link_strength',
    p_goal_if_low: 0.55, p_goal_if_high: 0.3, n_low: 333, n_high: 333, spread: 0.25,
    status: 'resolved', spread_noise_floor: 0.08, correlated: false, low_upper_value: 0.2, high_lower_value: 0.6,
  }],
});
const row = (id: string, p: number, extra: Json = {}): Json => ({
  option_id: id, id, probability_of_goal: p, win_probability: 0.5, outcome: { mean: 0.5, p10: 0.4, p90: 0.6 },
  probability_of_goal_precision: precision(1000, Math.round(p * 1000)), probability_of_goal_drivers: drivers(), ...extra,
});
/** The ruled names, written out (the spec), so a row binds to them and not to the constant under test. */
const COMPANIONS = ['probability_of_goal_precision', 'probability_of_goal_drivers'] as const;
const hasNeither = (r: Json): void => {
  for (const k of COMPANIONS) expect(r, k).not.toHaveProperty(k);
};
const hasBoth = (r: Json): void => {
  expect(r.probability_of_goal_precision).toEqual(expect.objectContaining({ method: 'wilson_score', n_informative: 1000 }));
  expect(r.probability_of_goal_drivers).toEqual(expect.objectContaining({ method: 'tercile_conditional_v1' }));
};
const byId = (rows: Json[], id: string): Json => rows.find((r) => r.option_id === id)!;

describe('P2a — the goal chance\'s companions go wherever the figure goes', () => {
  it('the constant names exactly the two ruled blocks', () => {
    expect([...GOAL_CHANCE_COMPANION_KEYS]).toEqual([...COMPANIONS]);
  });

  it.each([
    ['option_comparison', (rows: Json[]): Json => ({ option_comparison: rows }), (e: Json): Json[] => e.option_comparison],
    ['results[]', (rows: Json[]): Json => ({ results: rows }), (e: Json): Json[] => e.results],
    ['results.options', (rows: Json[]): Json => ({ results: { options: rows } }), (e: Json): Json[] => e.results.options],
    ['decision_brief.options', (rows: Json[]): Json => ({ decision_brief: { options: rows } }), (e: Json): Json[] => e.decision_brief.options],
  ] as const)('SITE 1 withholdOptionGoalFigures (%s): the withheld option loses PoG AND both blocks; CONTROL the other keeps all three', (_c, wrap, read) => {
    const out = withholdOptionGoalFigures(wrap([row('a', 0.42), row('b', 0.3)]), new Set(['a']),
      { code: GOAL_FIGURES_PLACEHOLDER_PATH, severity: 'warning', option_ids: ['a'] }) as Json;
    const a = byId(read(out), 'a');
    expect(a).not.toHaveProperty('probability_of_goal');
    hasNeither(a);
    const b = byId(read(out), 'b');
    expect(b.probability_of_goal).toBe(0.3);
    hasBoth(b);
  });

  it('SITE 2 no stated target: every option loses PoG AND both blocks', () => {
    const env = { option_comparison: [row('a', 0.42), row('b', 0.3)], inference_warnings: [] };
    const out = withholdUnusableGoalChances(env, RT10B.graph_without_target, GOAL) as Json;
    for (const id of ['a', 'b']) {
      expect(byId(out.option_comparison, id)).not.toHaveProperty('probability_of_goal');
      hasNeither(byId(out.option_comparison, id));
    }
  });

  it('SITE 2 via the unusable-figure path (1.2 → withholdOptionGoalFigures): that option loses both blocks; the valid one keeps them', () => {
    const env = { option_comparison: [row('a', 1.2), row('b', 0.3)], inference_warnings: [] };
    const out = withholdUnusableGoalChances(env, RT10B.graph_with_target, GOAL) as Json;
    hasNeither(byId(out.option_comparison, 'a'));
    hasBoth(byId(out.option_comparison, 'b'));
  });

  it('CONTROL (licensed figure on the wire): a stated target and a valid chance return the SAME envelope, both blocks kept', () => {
    const env = { option_comparison: [row('a', 0.42), row('b', 0.3)], inference_warnings: [] };
    const out = withholdUnusableGoalChances(env, RT10B.graph_with_target, GOAL) as Json;
    expect(out).toBe(env);
    for (const id of ['a', 'b']) hasBoth(byId(out.option_comparison, id));
  });

  it.each([
    ['option_comparison', (rows: Json[]): Json => ({ option_comparison: rows }), (e: Json): Json[] => e.option_comparison],
    ['results.option_results', (rows: Json[]): Json => ({ results: { option_results: rows } }), (e: Json): Json[] => e.results.option_results],
    ['decision_brief.options', (rows: Json[]): Json => ({ decision_brief: { options: rows } }), (e: Json): Json[] => e.decision_brief.options],
  ] as const)('SITE 3 transport (%s): an UNEARNED exact 1 loses PoG AND both blocks (n_met = n reveals it); CONTROL 0.42 keeps all three', (_c, wrap, read) => {
    const out = projectGoalProbabilitiesForTransport(wrap([row('a', 1), row('b', 0.42)]), undefined) as Json;
    const a = byId(read(out), 'a');
    expect(a).not.toHaveProperty('probability_of_goal');
    hasNeither(a);
    const b = byId(read(out), 'b');
    expect(b.probability_of_goal).toBe(0.42);
    hasBoth(b);
  });

  it('SITE 4 Agent view, run NOT withheld: the Agent keeps the figure but NEVER either block (it reads the licence record only)', () => {
    const block = { type: 'analysis_result', enrichment: { option_comparison: [row('a', 0.42)], results: { options: [row('a', 0.42)] } } };
    const out = analysisResultForAgent(block) as Json;
    const a = out.enrichment.option_comparison[0];
    expect(a.probability_of_goal).toBe(0.42);
    hasNeither(a);
    hasNeither(out.enrichment.results.options[0]);
    // The user-facing block is untouched (this is the Agent's view only).
    hasBoth(block.enrichment.option_comparison[0]);
  });

  it('SITE 4 Agent view, run withheld: neither the figure nor either block', () => {
    const block = { type: 'analysis_result', enrichment: {
      option_comparison: [row('a', 0.42)],
      inference_warnings: [{ code: GOAL_FIGURES_PLACEHOLDER_PATH, severity: 'warning', option_ids: ['a'] }],
    } };
    const a = (analysisResultForAgent(block) as Json).enrichment.option_comparison[0];
    expect(a).not.toHaveProperty('probability_of_goal');
    hasNeither(a);
  });
});
