/**
 * ⛔ "CAN'T RUN YET" MUST SAY WHY — even when no user demand explains the refusal.
 *
 * Served (F) f-20260926T020217Z on CEE ef99a97 (Paul's brief): after the starting point was approved ("Saved 3 of 3
 * option levels"), two options set IDENTICAL levels (price 0.295, AI availability 1). Strict readiness passes and the
 * run's comparison floor refuses, so the ONE admission verdict says `may_run: false` with no demand. The readiness
 * view read demands only, so the Agent was handed "can't run" with no reason.
 *
 * The reason is the REFUSAL'S OWN words — the run path's `blockedNextStep`, carried as the verdict's `blocker_reason`
 * (Canonical 5842490587) — never a second check such as the critiques, which leave out the baseline and use a
 * different tolerance (review 5842389608: its cases (a) and (b) refused with no reason at all).
 *
 * FIXTURE: that run's own served `draft_graph`, verbatim.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { readinessViewOf, readinessSentence } from '../readiness-view.js';
import { resolveRunAdmission } from '../../tools/handlers/analysis-ready-core.js';
import { toCanonicalAssessableGraph } from '../../../cee/graph-readiness/canonical-readiness.js';

type Iv = Record<string, { value: number; source?: string }>;
type G = { nodes: { id: string; kind: string; interventions?: Iv | null }[]; edges: { from: string; to: string }[] };
const served = JSON.parse(readFileSync(new URL('./fixtures/served-identical-options-ef99a97.json', import.meta.url), 'utf8')) as G;
const paulGraph = JSON.parse(readFileSync(new URL('./fixtures/paul-cbd15f83-stored-graph.json', import.meta.url), 'utf8')) as unknown;
const CODE_LIKE = /\b[A-Z]+(?:_[A-Z]+){2,}\b/;
const copy = (): G => JSON.parse(JSON.stringify(served)) as G;
/** The run path's own reason for refusing this graph — the identity every row binds to. */
const runPathReason = (g: unknown): string | null => resolveRunAdmission(toCanonicalAssessableGraph(g)).blockedNextStep;

/** (a) the test option removed: the baseline plus ONE option that sets levels. */
const oneOption = (): G => {
  const g = copy();
  g.nodes = g.nodes.filter((n) => n.id !== 'test_59_with_ai_release');
  g.edges = g.edges.filter((e) => e.from !== 'test_59_with_ai_release' && e.to !== 'test_59_with_ai_release');
  return g;
};
/** (b) as (a), but the baseline sets the same levels as the only other option. */
const baselineMatches = (): G => {
  const g = oneOption();
  const other = g.nodes.find((n) => n.id === '59_with_ai_release')!;
  g.nodes.find((n) => n.id === 'keep_current_pricing')!.interventions = JSON.parse(JSON.stringify(other.interventions)) as Iv;
  return g;
};

describe('the readiness view gives the refusal\'s own reason when no demand explains it', () => {
  for (const [name, graph] of [
    ['served: two options set identical levels', () => served],
    ['(a) the baseline and one option that sets levels', oneOption],
    ['(b) the baseline sets the same levels as the only option', baselineMatches],
  ] as const) {
    it(`RED: ${name} → may_run false, and the reason IS the run path's own next step`, () => {
      const g = graph();
      const expected = runPathReason(g);
      expect(expected, 'the run path refuses this graph (else the row is vacuous)').toEqual(expect.any(String));
      const view = readinessViewOf(g);
      expect(view.may_run).toBe(false);
      expect(view.needs_from_user, 'no demand: the reason is not the user\'s task list').toEqual([]);
      expect(view.reason).toBe(expected);
      expect(readinessSentence(view)).toBe(`The analysis can't run yet. ${expected!}`);
      expect(JSON.stringify(view)).not.toMatch(CODE_LIKE);
    });
  }

  it('the critique is NOT the reason — the identical-options warning never reaches the Agent as why', () => {
    expect(JSON.stringify(readinessViewOf(served))).not.toMatch(/identical intervention/i);
  });

  it('CONTRAST: give one option a different level → the run is admitted and there is no reason', () => {
    const g = copy();
    const opt = g.nodes.find((n) => n.id === 'test_59_with_ai_release')!;
    opt.interventions = { ...opt.interventions!, pro_plan_price: { ...opt.interventions!['pro_plan_price']!, value: 0.27 } };
    expect(runPathReason(g)).toBeNull();
    const view = readinessViewOf(g);
    expect(view.may_run).toBe(true);
    expect(view).not.toHaveProperty('reason');
  });

  it('CONTRAST: a demand is present (Paul\'s unlinked option) → the demand speaks, and there is no separate reason', () => {
    const view = readinessViewOf(paulGraph);
    expect(view.may_run).toBe(false);
    expect(JSON.stringify(view.needs_from_user)).toMatch(/not connected from the decision/i);
    expect(view).not.toHaveProperty('reason');
  });

  it('a reason that already says the model can\'t be analysed is not said twice', () => {
    const reason = "This model can't be analysed yet. The values involved are Olumi's own suggestions, not yours — ask Olumi to work them through, or set them yourself.";
    expect(readinessSentence({ checked: true, may_run: false, needs_from_user: [], olumi_can_offer: [], will_run_without: [], reason }))
      .toBe("The analysis can't run yet. The values involved are Olumi's own suggestions, not yours — ask Olumi to work them through, or set them yourself.");
  });
});
