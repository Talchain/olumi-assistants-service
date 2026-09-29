/**
 * ⭐ "KEEP £49 OR RAISE TO £59" RUNS — the held status quo is counted as the comparator the run submits.
 *
 * A held status quo keeps no copy of its starting values (#1902), so its stored interventions map is empty BY
 * CONTRACT. The admission floor (`comparisonSurvivesDedup`) dropped every empty map, so Paul's own question could
 * never run unless the drafter invented a third, distinct option (MG 5842710702, executed on this fixture). The run
 * path already HOLDS that status quo at the factors' current observed values (`gateAnalysableOptions`) and PLoT
 * compares it; the floor now fingerprints exactly that submitted set (Delivery Lead 5842717741).
 *
 * FIXTURE: the served approved model of (F) run f-20260926T020217Z, turn 02 (CEE ef99a97), verbatim.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolveRunAdmission, NO_COMPARISON_NEXT_STEP } from '../analysis-ready-core.js';
import { gateAnalysableOptions } from '../analysable-option-gate.js';
import { assessCanonicalAnalysisReadiness } from '../../../../orchestrator/tools/analysis-ready-helper.js';

type Node = { id: string; kind: string; label?: string; is_baseline?: boolean; interventions?: Record<string, unknown>; observed_state?: Record<string, unknown> };
type G = { nodes: Node[]; edges: { from: string; to: string }[] };
const served = JSON.parse(readFileSync(new URL('./fixtures/served-f-20260926T020217Z-02-approved-graph.json', import.meta.url), 'utf8')) as G;
const copy = (): G => JSON.parse(JSON.stringify(served)) as G;
const without = (g: G, id: string): G => ({
  ...g,
  nodes: g.nodes.filter((n) => n.id !== id),
  edges: g.edges.filter((e) => e.from !== id && e.to !== id),
});
/** The set the run would submit, from the run's own gate over the same wire options. */
const submittedBy = (g: G) => gateAnalysableOptions({
  options: (assessCanonicalAnalysisReadiness(g).analysisReady?.options ?? []) as ReadonlyArray<Record<string, unknown>>,
  graph: g, rawPersistedGraph: g, scaleNetEnabled: true,
});

describe('the admission floor counts the held status quo the run submits', () => {
  it('RED: keep current pricing vs £59 (MG\'s executed model, the duplicate removed) → the run is admitted', () => {
    const g = without(copy(), 'test_59_with_ai_release');
    const held = submittedBy(g).held;
    expect(held.map((h) => h.option_id), 'the run holds the status quo (else this row is vacuous)').toEqual(['keep_current_pricing']);
    const a = resolveRunAdmission(g);
    expect(a.willProceed).toBe(true);
    expect(a.blockedNextStep).toBeNull();
  });

  it('RED: the served model as it stood (two identical £59 options beside the status quo) → admitted: the status quo is a real comparator', () => {
    expect(resolveRunAdmission(copy()).willProceed).toBe(true);
  });

  it('CONTRAST: the same two identical £59 options with NO status quo → still refused by the floor alone, with its own next step', () => {
    const g = without(copy(), 'keep_current_pricing');
    const a = resolveRunAdmission(g);
    expect(a.strict.safeToAnalyse, 'strict readiness passes: the refusal is the comparison floor alone').toBe(true);
    expect(a.willProceed).toBe(false);
    expect(a.blockedNextStep).toBe(NO_COMPARISON_NEXT_STEP);
  });

  it('CONTRAST: the status quo\'s lever has NO current value → nothing is held, it stays uncounted, and the run is refused — never invented', () => {
    const g = without(copy(), 'test_59_with_ai_release');
    const price = g.nodes.find((n) => n.id === 'pro_plan_price')!;
    delete price.observed_state;
    const gate = submittedBy(g);
    expect(gate.held, 'no value, no hold').toEqual([]);
    expect(gate.excluded.map((x) => x.option_id)).toContain('keep_current_pricing');
    const a = resolveRunAdmission(g);
    expect(a.willProceed).toBe(false);
  });

  it('CONTRAST: no status quo at all, one option → still refused, with a next step — nothing is invented to compare against', () => {
    const g = without(without(copy(), 'test_59_with_ai_release'), 'keep_current_pricing');
    const a = resolveRunAdmission(g);
    expect(a.willProceed).toBe(false);
    expect(a.blockedNextStep).toEqual(expect.any(String));
  });

  it('CONTRAST: the status quo\'s lever unknown → the refusal is the comparison floor\'s own next step', () => {
    const g = without(copy(), 'test_59_with_ai_release');
    delete g.nodes.find((n) => n.id === 'pro_plan_price')!.observed_state;
    const a = resolveRunAdmission(g);
    if (a.strict.safeToAnalyse) expect(a.blockedNextStep).toBe(NO_COMPARISON_NEXT_STEP);
    else expect(a.blockedNextStep).toEqual(expect.any(String));
  });

  it('CONTRAST: a status quo the user GAVE levels identical to the only option is not held — still identical, still refused', () => {
    const g = without(copy(), 'test_59_with_ai_release');
    const other = g.nodes.find((n) => n.id === '59_with_ai_release')!;
    g.nodes.find((n) => n.id === 'keep_current_pricing')!.interventions = JSON.parse(JSON.stringify(other.interventions)) as Record<string, unknown>;
    expect(resolveRunAdmission(g).willProceed).toBe(false);
  });
});
