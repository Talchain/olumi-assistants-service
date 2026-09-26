/**
 * THE READINESS VERDICT NEVER REFUSES SILENTLY — `/graph-readiness`, the UI's
 * panel and the Agent's view all read `assessRouteAdmission`.
 *
 * The run path fixed this for itself (`resolveRunAdmission().blockedNextStep` =
 * `strict.nextStep ?? NO_COMPARISON_NEXT_STEP`; tests/unit/analysis-refusal-
 * carries-a-reason.test.ts), and that file names this verdict as "a SECOND
 * silent surface … deliberately untouched here": `blocker_reason` was emitted
 * only inside `!safeToAnalyse`. A graph refused by the SECOND admission term
 * alone (strict readiness passes; the comparison floor refuses — nothing to
 * compare) read `may_run: false` with no `blocker_reason` and no issues.
 *
 * Served (26 Sep, CEE `ef99a97`, Delivery Lead run f-20260926T020217Z): Paul's
 * brief drafted two options differing only in rollout; once their levels were
 * filled they were identical, and every surface said "can't run yet" and nothing
 * else. The fixture is that served `draft_graph`, not authored.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { assessRouteAdmission } from '../canonical-readiness.js';
import { resolveRunAdmission } from '../../../orchestrator-v5/tools/handlers/analysis-ready-core.js';

// The exact sentence, as a LITERAL — importing the constant would let a rewrite
// of it carry the test along.
const NEXT_STEP = 'Name at least two different options you are weighing, then run analysis.';

const SERVED = JSON.parse(
  readFileSync(new URL('./fixtures/served-identical-options-ef99a97.json', import.meta.url), 'utf8'),
) as unknown;

const edge = (from: string, to: string) => ({
  from, to, strength: { mean: 0.6, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' as const,
});
const factor = (id: string, label: string, category = 'controllable') => ({
  id, kind: 'factor', label, category, data: { value: 0.5, extractionType: 'explicit' },
});
const BASE = { version: '1', default_seed: 42 };

/** Zero alternatives with an OBSERVABLE factor — the run path's own silent cell. */
const zeroAlternatives = {
  ...BASE,
  nodes: [
    { id: 'goal_1', kind: 'goal', label: 'Understand why retention is slipping' },
    { id: 'out_1', kind: 'outcome', label: 'Retention' },
    factor('fac_a', 'Onboarding quality', 'observable'),
  ],
  edges: [edge('fac_a', 'out_1'), edge('out_1', 'goal_1')],
};

/** Two alternatives but no goal — refused by STRICT readiness, with its own reason. */
const twoAlternativesNoGoal = {
  ...BASE,
  nodes: [
    { id: 'dec_1', kind: 'decision', label: 'What to do' },
    { id: 'opt_1', kind: 'option', label: 'A' },
    { id: 'opt_2', kind: 'option', label: 'B' },
    factor('fac_a', 'Load'),
  ],
  edges: [edge('dec_1', 'opt_1'), edge('dec_1', 'opt_2'), edge('opt_1', 'fac_a')],
};

/** Two alternatives, configured and distinct — must PROCEED. */
const twoAlternativesConfigured = {
  ...BASE,
  nodes: [
    { id: 'goal_1', kind: 'goal', label: 'Grow revenue' },
    { id: 'dec_1', kind: 'decision', label: 'Which path' },
    { id: 'opt_1', kind: 'option', label: 'Raise price', data: { interventions: { fac_a: 0.8 } }, is_baseline: false },
    { id: 'opt_2', kind: 'option', label: 'Keep as is', data: { interventions: { fac_a: 0.2 } }, is_baseline: true },
    factor('fac_a', 'Price level'),
    { id: 'out_1', kind: 'outcome', label: 'Revenue' },
  ],
  edges: [edge('dec_1', 'opt_1'), edge('dec_1', 'opt_2'), edge('opt_1', 'fac_a'), edge('opt_2', 'fac_a'), edge('fac_a', 'out_1'), edge('out_1', 'goal_1')],
};

describe('the readiness verdict never refuses silently', () => {
  it('PRECONDITION: the served graph is refused by the SECOND term alone (strict passes, no issues)', () => {
    const run = resolveRunAdmission(SERVED);
    expect(run.willProceed).toBe(false);
    expect(run.assessment.safeToAnalyse).toBe(true);
    expect(assessRouteAdmission(SERVED).readiness_issues).toEqual([]);
  });

  it('⭐ SERVED: identical options → may_run false AND the refusal\'s own next step as blocker_reason', () => {
    const v = assessRouteAdmission(SERVED);
    expect(v.may_run).toBe(false);
    expect(v.blocker_reason).toBe(NEXT_STEP);
    // Bound by identity to the run path's refusal — not a second derivation.
    expect(v.blocker_reason).toBe(resolveRunAdmission(SERVED).blockedNextStep);
  });

  it('the run path\'s own silent cell (zero alternatives, observable factor) reads the same next step', () => {
    const v = assessRouteAdmission(zeroAlternatives);
    expect(v.may_run).toBe(false);
    expect(v.blocker_reason).toBe(resolveRunAdmission(zeroAlternatives).blockedNextStep);
    expect(v.blocker_reason).toBeTruthy();
  });

  it('CONTRAST: a STRICT refusal keeps its own specific headline — the fill is for an ABSENT reason only', () => {
    const v = assessRouteAdmission(twoAlternativesNoGoal);
    expect(v.may_run).toBe(false);
    expect(v.can_run_analysis).toBe(false);
    expect(v.blocker_reason).toBeTruthy();
    expect(v.blocker_reason).not.toBe(NEXT_STEP);
  });

  it('CONTROL: a model that may run carries no blocker_reason', () => {
    const v = assessRouteAdmission(twoAlternativesConfigured);
    expect(v.may_run).toBe(true);
    expect(v.blocker_reason).toBeUndefined();
  });

  it.each([
    ['served identical options', SERVED],
    ['zero alternatives', zeroAlternatives],
    ['two alternatives, no goal', twoAlternativesNoGoal],
    ['two alternatives, configured', twoAlternativesConfigured],
  ])('PROPERTY: %s — may_run false implies a non-empty blocker_reason', (_label, graph) => {
    const v = assessRouteAdmission(graph);
    if (v.may_run !== false) return;
    expect(typeof v.blocker_reason === 'string' && v.blocker_reason.trim().length > 0).toBe(true);
  });
});
