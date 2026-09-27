/**
 * Un-analysed factors are not drivers (AIQ #70 5854893356; DL GO 5854902243). Paul's own export `90b8f080` ranked a
 * factor the engine never analysed ("Existing customers grandfathered": no value, a constant 0.0 at ISL, ranked on two
 * placeholder edges) as Driver 1, and banded the decision lever at elasticity 0 as "strong". Fixtures are the served
 * enrichments verbatim (`fixtures/served-paul-driver-ranking-20260927.json`); every row is bound by factor id.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { RunAnalysisHandlerFactSchema, type RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';
import { buildAnalysisResultBlock } from '../../compose.js';
import { projectUnanalysedDriversForTransport } from '../unanalysed-driver-projection.js';

type Rec = Record<string, unknown>;
const SERVED = JSON.parse(readFileSync(new URL('./fixtures/served-paul-driver-ranking-20260927.json', import.meta.url), 'utf8')) as {
  B_90b8f080: Rec; A_17d1cd3a: Rec;
};
const B = () => structuredClone(SERVED.B_90b8f080);
const A = () => structuredClone(SERVED.A_17d1cd3a);
const DEFAULTED = 'fac_existing_customers_grandfathered';
const DEFAULTED_LABEL = 'Existing customers grandfathered';

function fact(enrichment: Rec, mayName: boolean): RunAnalysisHandlerFact {
  return RunAnalysisHandlerFactSchema.parse({
    fact_type: 'run_analysis', fact_version: 1, noop: false,
    result: {
      scenario_id: '77777777-7777-4777-8777-777777777777', graph_hash_at_run: 'e6aceffe33a51baf',
      computed_at: '2026-09-27T09:41:00.000Z', leading_option_id: 'increase_price_to_59', summary: 'Ran analysis.',
      constraint_verdict: mayName
        ? { may_name_leading_option: true, constraint_verdict_state: 'evaluated_feasible' }
        : { may_name_leading_option: false, constraint_verdict_state: 'not_applicable' },
      enrichment,
    },
  });
}
const served = (enrichment: Rec, mayName: boolean): Rec =>
  (buildAnalysisResultBlock(fact(enrichment, mayName)) as unknown as { enrichment: Rec }).enrichment;
const rows = (e: Rec) => e.factor_sensitivity as Rec[];
const row = (e: Rec, id: string) => rows(e).find((r) => r.factor_id === id);
const brief = (e: Rec) => e.decision_brief as Rec;

describe('a factor the engine never analysed is not a driver (Paul, 90b8f080)', () => {
  it('SERVED premise: the defaulted root is Driver 1 "biggest", named by the engine\'s own warning; price is "strong" at 0', () => {
    const b = B();
    expect(row(b, DEFAULTED)).toMatchObject({ importance_rank: 1, driver_label: 'biggest' });
    expect((b.inference_warnings as Rec[]).some((w) => w.code === 'ROOT_NODE_DEFAULT_VALUE'
      && w.field === `nodes[${DEFAULTED}].observed_state.value`)).toBe(true);
    expect(row(b, 'pro_plan_price')).toMatchObject({ elasticity: 0, zero_reason: 'intervention_override', driver_label: 'strong' });
  });

  for (const mayName of [false, true]) {
    const branch = mayName ? 'permitted' : 'withheld (Paul\'s own branch)';
    it(`RED (${branch}): no ranked row, top driver, key assumption or what-would-change for the defaulted root`, () => {
      const e = served(B(), mayName);
      expect(row(e, DEFAULTED)).toBeUndefined();
      const b = brief(e);
      if (Array.isArray(b.top_drivers)) expect((b.top_drivers as Rec[]).map((d) => d.factor_label)).not.toContain(DEFAULTED_LABEL);
      if (Array.isArray(b.key_assumptions)) expect(b.key_assumptions).not.toContain(DEFAULTED_LABEL);
      if (Array.isArray(b.what_would_change)) expect(b.what_would_change).not.toContain(DEFAULTED_LABEL);
    });

    it(`RED (${branch}): every lever keeps its row and influence, but carries no driver band`, () => {
      const e = served(B(), mayName);
      for (const id of ['pro_plan_price', 'monthly_churn', 'monthly_new_pro_subscribers']) {
        expect(row(e, id), id).toMatchObject({ zero_reason: 'intervention_override', elasticity: 0 });
        expect(row(e, id), id).not.toHaveProperty('driver_label');
      }
      expect(row(e, 'pro_plan_price')!.influence_score).toBe(1);
    });
  }

  it('RED: the remaining ranks close up (no gap a surface would explain with the wrong reason)', () => {
    const e = projectUnanalysedDriversForTransport(B()) as Rec;
    expect(row(e, 'other_mrr_growth')).toMatchObject({ importance_rank: 1, influence_rank: 2, driver_label: 'strong' });
    expect(row(e, 'pro_paying_subscribers')).toMatchObject({ importance_rank: 2, influence_rank: 3 });
    expect(row(e, 'pro_plan_price')).toMatchObject({ importance_rank: 3, influence_rank: 1 });
    expect(rows(e).map((r) => r.importance_rank)).toEqual([1, 2, 3, 4, 5]);
  });

  it('KEEP: the default is still disclosed (defaulted_assumptions and the engine warning ship unchanged)', () => {
    const before = B();
    const e = projectUnanalysedDriversForTransport(B()) as Rec;
    expect(brief(e).defaulted_assumptions).toEqual(brief(before).defaulted_assumptions);
    expect(e.inference_warnings).toEqual(before.inference_warnings);
    expect(e.option_comparison).toEqual(before.option_comparison);
  });

  it('CONTRAST: a valued factor on defaulted edges keeps its row (a fix keyed on edge `defaulted` would drop it)', () => {
    const e = projectUnanalysedDriversForTransport(B()) as Rec;
    expect(row(e, 'other_mrr_growth')!.elasticity).toBe(row(B(), 'other_mrr_growth')!.elasticity);
    expect(row(e, 'pro_paying_subscribers')!.elasticity).toBe(row(B(), 'pro_paying_subscribers')!.elasticity);
  });

  it('CONTRAST (A, no default-root warning): every row and the brief survive; only the lever loses its band', () => {
    const a = A();
    const e = projectUnanalysedDriversForTransport(A()) as Rec;
    expect(rows(e).map((r) => r.factor_id)).toEqual(rows(a).map((r) => r.factor_id));
    expect(row(e, 'other_mrr_growth')).toEqual(row(a, 'other_mrr_growth'));
    expect(brief(e)).toEqual(brief(a));
    expect(row(e, 'pro_plan_price')).not.toHaveProperty('driver_label');
  });

  it('MUTANT: a defaulted factor that an option SETS (a lever) is never dropped', () => {
    const b = B();
    Object.assign(row(b, DEFAULTED)!, { zero_reason: 'intervention_override', elasticity: 0 });
    const e = projectUnanalysedDriversForTransport(b) as Rec;
    expect(row(e, DEFAULTED)).toBeDefined();
    expect((brief(e).top_drivers as Rec[]).map((d) => d.factor_label)).toContain(DEFAULTED_LABEL);
  });

  it('IDENTITY: a label two rows share is never removed from a label-keyed list', () => {
    const b = B();
    row(b, 'other_mrr_growth')!.factor_label = DEFAULTED_LABEL;
    const e = projectUnanalysedDriversForTransport(b) as Rec;
    expect(row(e, DEFAULTED)).toBeUndefined();
    expect(row(e, 'other_mrr_growth')).toBeDefined();
    expect((brief(e).top_drivers as Rec[]).map((d) => d.factor_label)).toContain(DEFAULTED_LABEL);
  });

  it('NO-OP: nothing to project returns the same object', () => {
    const e = { factor_sensitivity: [{ factor_id: 'x', driver_label: 'strong', importance_rank: 1 }] };
    expect(projectUnanalysedDriversForTransport(e)).toBe(e);
    expect(projectUnanalysedDriversForTransport(null)).toBeNull();
  });
});
