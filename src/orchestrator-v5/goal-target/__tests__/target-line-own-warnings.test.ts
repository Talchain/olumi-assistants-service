/**
 * ⭐ S9 — EACH TARGET'S LINE SAYS ONLY ITS OWN REASON (marketing widen5 bcdf70eb, judge items 2/5; DL 07:57Z). The customer
 * target's line said "Not shown. Your target can be read more than one way. Does “conversion rate” mean…", a question about the
 * CONVERSION RATE target (its warning names node_ids ["conversion_rate"]), while the customer count's own reason was its
 * unsized contributing links. The open-question withhold (`withholdForOpenTargetQuestion`) and the untestable-target withhold
 * now bind to the goal's own stated target row(s) (`constraint_ids`), as the missing-current-level withhold already does, so
 * the several-targets licence puts each reason on its own target only.
 *
 * Corpus: the served Run (turn 08) of that capture, verbatim (`tests/fixtures/marketing-widen5/run-08.json`, `_source`), with
 * each option's `probability_of_goal` restored (the served transport had stripped them) so the producers run as the Run did.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ownTargetRowIds, wireGoalConstraints, withholdGoalFiguresForMissingCurrentLevel, withholdGoalFiguresForUntestableTarget } from '../../tools/handlers/run-analysis.js';
import { withholdForOpenTargetQuestion } from '../goal-chance-gate.js';
import { withGoalChanceLicence } from '../goal-chance-licence.js';

type Rec = Record<string, any>;
const F = JSON.parse(readFileSync('tests/fixtures/marketing-widen5/run-08.json', 'utf8')) as Rec;
const CONVERSION = '‘Conversion rate’ being above 15% over the first three months after launch';
const CUSTOMERS = '‘New customers in first 3 months’ being at least 20 customers over the first three months after launch';
const READING = 'Not shown. Your target can be read more than one way. Does “conversion rate” mean conversion from advertising clicks, leads, trials, or another launch-stage population?';
const PARTS = 'The contributing quantities have links whose sizes are not yet specified. This calculation needs supported contributions in this quantity’s units, or a supported forecast for the quantity.';
const served = (code: string): Rec => (F.enrichment.inference_warnings as Rec[]).find((w) => w.code === code)!;

function licensed(bind: boolean): { reading: Rec; licence: Rec } {
  const drop = new Set(['GOAL_FIGURES_TARGET_NOT_TESTABLE', 'GOAL_FIGURES_MISSING_CURRENT_LEVEL', 'GOAL_CHANCE_LICENSED']);
  const pre = structuredClone({ ...F.enrichment, inference_warnings: (F.enrichment.inference_warnings as Rec[]).filter((w) => !drop.has(w.code)) });
  pre.option_comparison.forEach((r: Rec, i: number) => { r.probability_of_goal = [0.31, 0.27, 0.12][i]; });
  const stored = F.graph.goal_constraints;
  let env = withholdGoalFiguresForMissingCurrentLevel(pre, F.graph, stored) as Rec;
  env = withholdForOpenTargetQuestion(env, F.graph, 'conversion_rate', bind ? ownTargetRowIds(stored, 'conversion_rate') : []) as Rec;
  const enrichment = withGoalChanceLicence(env, F.graph, 'conversion_rate', () => false, undefined, F.graph, {
    storedConstraints: stored, sentConstraints: wireGoalConstraints(stored), perLimit: F.limit_verdicts.per_limit }) as Rec;
  const find = (code: string): Rec => (enrichment.inference_warnings as Rec[]).find((w) => w.code === code)!;
  return { reading: find('GOAL_FIGURES_TARGET_NOT_TESTABLE'), licence: find('GOAL_CHANCE_LICENSED') };
}
const notesFor = (licence: Rec, clause: string): string[] => (licence.targets.notes as string[]).filter((n) => n.startsWith(`${clause}: `));

describe('S9: each target’s line uses only the warnings bound to its own target', () => {
  it('PRECONDITION (fidelity): unbound, the reconstruction gives the served warning and the served misbound customer line', () => {
    const { reading, licence } = licensed(false);
    expect(reading.message).toBe(served('GOAL_FIGURES_TARGET_NOT_TESTABLE').message);
    expect(reading.message).toBe(READING);
    expect(reading).not.toHaveProperty('constraint_ids');
    expect(notesFor(licence, CUSTOMERS)).toEqual(notesFor(served('GOAL_CHANCE_LICENSED'), CUSTOMERS));
    expect(notesFor(licence, CUSTOMERS)).toContain(`${CUSTOMERS}: ${READING}`);
  });

  it('RED: bound to conversion rate’s own target row, the customer target keeps only its own reason; conversion keeps the question', () => {
    const { reading, licence } = licensed(true);
    const row = (F.graph.goal_constraints as Rec[]).find((r) => r.role === 'goal_target' && r.node_id === 'conversion_rate')!;
    expect(reading.constraint_ids).toEqual([row.constraint_id]);
    expect(notesFor(licence, CUSTOMERS)).toEqual([`${CUSTOMERS}: ${PARTS}`]);
    expect(notesFor(licence, CONVERSION).join(' ')).toContain(READING);
    // Every option's chance against conversion rate stays withheld: binding scopes the LINE, never releases the withhold.
    expect(licence.pct_by_option).toEqual({});
    expect(reading.option_ids).toEqual(['hire_marketing_manager', 'ai_planning_and_advertising', 'continue_without_new_support']);
  });

  it('the untestable-target withhold binds the same way: bound, the customer line keeps only its own reason; unbound, it is misbound', () => {
    for (const bind of [false, true]) {
      const drop = new Set(['GOAL_FIGURES_TARGET_NOT_TESTABLE', 'GOAL_FIGURES_MISSING_CURRENT_LEVEL', 'GOAL_CHANCE_LICENSED']);
      const pre = structuredClone({ ...F.enrichment, inference_warnings: (F.enrichment.inference_warnings as Rec[]).filter((w) => !drop.has(w.code)) });
      pre.option_comparison.forEach((r: Rec, i: number) => { r.probability_of_goal = [0.31, 0.27, 0.12][i]; });
      const stored = bind ? F.graph.goal_constraints : undefined;
      const env = withholdGoalFiguresForMissingCurrentLevel(withholdGoalFiguresForUntestableTarget(pre, F.graph, 'conversion_rate', stored), F.graph, stored);
      const w = ((env as Rec).inference_warnings as Rec[]).find((x) => x.code === 'GOAL_FIGURES_TARGET_NOT_TESTABLE')!;
      expect(w, 'the untestable-target withhold fires on this Run').toBeDefined();
      const enrichment = withGoalChanceLicence(env, F.graph, 'conversion_rate', () => false, undefined, F.graph, {
        storedConstraints: F.graph.goal_constraints, sentConstraints: wireGoalConstraints(F.graph.goal_constraints), perLimit: F.limit_verdicts.per_limit }) as Rec;
      const licence = (enrichment.inference_warnings as Rec[]).find((x) => x.code === 'GOAL_CHANCE_LICENSED')!;
      if (bind) {
        expect(w.constraint_ids).toEqual(['agent-lane:conversion_rate:>=']);
        expect(notesFor(licence, CUSTOMERS)).toEqual([`${CUSTOMERS}: ${PARTS}`]);
      } else {
        expect(w).not.toHaveProperty('constraint_ids');
        expect(notesFor(licence, CUSTOMERS).some((n) => n.includes(w.message))).toBe(true);
      }
    }
  });

  it('ownTargetRowIds binds by identity: the goal’s own target row only, never a limit row or another target', () => {
    expect(ownTargetRowIds(F.graph.goal_constraints, 'conversion_rate')).toEqual(['agent-lane:conversion_rate:>=']);
    expect(ownTargetRowIds(F.graph.goal_constraints, 'new_customers_in_first_3_months')).toEqual(['agent-lane:new_customers_in_first_3_months:>=']);
    expect(ownTargetRowIds(F.graph.goal_constraints, 'annual_campaign_spend')).toEqual([]);
    expect(ownTargetRowIds(undefined, 'conversion_rate')).toEqual([]);
  });

  it('CONTRAST (one target): bound to its own row, the question still withholds that goal’s chance and is its reason', () => {
    const graph = structuredClone(F.graph);
    graph.goal_constraints = (graph.goal_constraints as Rec[]).filter((r) => r.node_id !== 'new_customers_in_first_3_months');
    const pre = structuredClone(F.enrichment);
    pre.inference_warnings = (pre.inference_warnings as Rec[]).filter((w) => w.code !== 'GOAL_FIGURES_TARGET_NOT_TESTABLE' && w.code !== 'GOAL_CHANCE_LICENSED');
    pre.option_comparison.forEach((r: Rec) => { r.probability_of_goal = 0.3; });
    const env = withholdForOpenTargetQuestion(pre, graph, 'conversion_rate', ownTargetRowIds(graph.goal_constraints, 'conversion_rate')) as Rec;
    expect(env.option_comparison.every((r: Rec) => !('probability_of_goal' in r))).toBe(true);
    expect((env.inference_warnings as Rec[]).find((w) => w.code === 'GOAL_FIGURES_TARGET_NOT_TESTABLE')!.message).toBe(READING);
  });
});
