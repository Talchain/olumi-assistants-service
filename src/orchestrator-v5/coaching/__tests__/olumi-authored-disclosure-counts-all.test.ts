/**
 * A6 `olumi-authored-disclosure-undercounts` — "I supplied N of the values" must count EVERY value of Olumi's the
 * analysis computed on, not only factor baselines.
 *
 * SERVED (DL run pj-20260927T181846Z, A12 run 2, scenario 1ceb77d8, CEE 523e18d): the run said "I supplied 6 of the
 * values behind this". The graph it ran on (fixture below, scrubbed) also carried 4 option levels Olumi proposed
 * and 12 link strengths Olumi drafted.
 *
 * Hand-verified against the fixture (every id below was read off the graph, not derived by the code under test):
 *   baselines  6 — the six factors stamped `cee_inference`; `pro_plan_price` is `brief_extraction` (the user's).
 *   levels     4 — £54 (`raise_pro_to_54_at_release`) and three switch levels of 1, all `cee_hypothesis`;
 *                  £59 (`brief_extraction`) and bb667b99's £59 (`user_specified`) are the user's.
 *   strengths 12 — 13 causal links, 12 `cee_hypothesis`; `price_sensitivity→monthly_churn_rate` is `user_specified`.
 *                  The 13 structural links (9 of them `cee_hypothesis`) carry a fixed 1 / 0.01, not an estimate.
 *
 * NOT counted by this sentence: the engine's 0.0 for `risk_competitor_price_or_ai_feature_response` (no starting
 * value, `ROOT_NODE_DEFAULT_VALUE`). It lives only in PLoT's `inference_warnings`, a Tier-3 key a user-facing
 * producer may not read without claim-safety review — see the module header.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { OBSERVED_STATE_SOURCE_LITERALS } from '@talchain/schemas';
import { describe, expect, it } from 'vitest';

import { classifyValueSource } from '../../../cee/graph-readiness/obligation-provenance.js';
import {
  buildInferredValueDisclosure,
  deriveInferredValues,
  deriveOlumiAuthoredValues,
  INFERRED_VALUE_DISCLOSURE_RE_SRC,
  type OlumiAuthoredValue,
} from '../inferred-value-disclosure.js';

type Rec = Record<string, unknown>;
interface Fixture {
  readonly graph: { readonly nodes: Rec[]; readonly edges: Rec[] };
  readonly served_summary: string;
}

const FIXTURE_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures/served-a12-disclosure-undercount-523e18d.json',
);
const load = (): Fixture => JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as Fixture;

const byKind = (values: readonly OlumiAuthoredValue[]) => ({
  baselines: values.flatMap((v) => (v.kind === 'factor_baseline' ? [v.factor_id] : [])),
  levels: values.flatMap((v) => (v.kind === 'option_level' ? [`${v.option_id}×${v.factor_id}`] : [])),
  strengths: values.flatMap((v) => (v.kind === 'link_strength' ? [`${v.from}→${v.to}`] : [])),
});

const A12_BASELINES = [
  'pro_paying_subscribers_at_month_12',
  'monthly_churn_rate',
  'other_plan_mrr_at_month_12',
  'fac_trial_to_pro_conversion_improvement',
  'fac_at_risk_account_retention_intervention',
  'fac_existing_customer_grandfathering',
];
const A12_LEVELS = [
  'raise_pro_to_54_at_release×pro_plan_price',
  '4cbb5475×fac_trial_to_pro_conversion_improvement',
  'a9643e27×fac_at_risk_account_retention_intervention',
  'bb667b99×fac_existing_customer_grandfathering',
];
const A12_STRENGTHS = [
  'pro_plan_price→pro_mrr_at_month_12',
  'pro_paying_subscribers_at_month_12→pro_mrr_at_month_12',
  'monthly_churn_rate→pro_paying_subscribers_at_month_12',
  'pro_plan_price→monthly_churn_rate',
  'pro_plan_price→price_sensitivity',
  'pro_mrr_at_month_12→mrr',
  'other_plan_mrr_at_month_12→mrr',
  'fac_trial_to_pro_conversion_improvement→pro_paying_subscribers_at_month_12',
  'fac_at_risk_account_retention_intervention→monthly_churn_rate',
  'fac_existing_customer_grandfathering→mrr',
  'fac_existing_customer_grandfathering→monthly_churn_rate',
  'risk_competitor_price_or_ai_feature_response→mrr',
];

const sentence = (n: number): string =>
  ` I supplied ${n} of the values behind this, because your brief did not state them. They are mine rather than yours.` +
  ' Changing any of them changes what this model implies.';

describe('(a) the served A12 shape — every Olumi value is counted, bound by identity', () => {
  it('PRECONDITION — the fixture is the served run: the old baseline count reproduces the served "6"', () => {
    const f = load();
    expect(f.served_summary).toContain('I supplied 6 of the values behind this');
    expect(deriveInferredValues(f.graph).map((r) => r.factor_id)).toEqual(A12_BASELINES);
  });

  it('⭐ counts 6 baselines + 4 option levels + 12 link strengths = 22', () => {
    const f = load();
    const values = deriveOlumiAuthoredValues(f.graph);
    const got = byKind(values);
    expect(got.baselines).toEqual(A12_BASELINES);
    expect(got.levels).toEqual(A12_LEVELS);
    expect(got.strengths).toEqual(A12_STRENGTHS);
    expect(values.length).toBe(22);
  });

  it('⭐ the sentence says 22, in the unchanged copy and inside the published grammar', () => {
    const f = load();
    const s = buildInferredValueDisclosure(deriveOlumiAuthoredValues(f.graph));
    expect(s).toBe(sentence(22));
    expect(new RegExp(`^(?:${INFERRED_VALUE_DISCLOSURE_RE_SRC})$`).test(s)).toBe(true);
  });

  it('CONTRAST — structural wiring is never a strength: 9 structural links are cee_hypothesis, none is counted', () => {
    const f = load();
    const kind = new Map(f.graph.nodes.map((n) => [n.id, n.kind]));
    const structural = f.graph.edges.filter((e) => {
      const k = `${String(kind.get(e.from))}→${String(kind.get(e.to))}`;
      return k === 'decision→option' || k === 'option→factor';
    });
    const olumiStructural = structural.filter((e) => (e.provenance as Rec).source === 'cee_hypothesis');
    expect(olumiStructural.length).toBe(9);
    const counted = byKind(deriveOlumiAuthoredValues(f.graph)).strengths;
    for (const e of structural) expect(counted).not.toContain(`${String(e.from)}→${String(e.to)}`);
  });
});

describe('(b) CONTRAST — a level the user stated or confirmed is not counted', () => {
  it('the two user levels on the served graph (£59 brief, £59 user_specified) are absent', () => {
    const f = load();
    const levels = byKind(deriveOlumiAuthoredValues(f.graph)).levels;
    expect(levels).not.toContain('raise_pro_to_59_at_release×pro_plan_price');
    expect(levels).not.toContain('bb667b99×pro_plan_price');
  });

  for (const source of ['user_specified', 'brief_extraction', 'user_confirmed']) {
    it(`the £54 level restamped '${source}' drops out: 3 levels, 21 in all`, () => {
      const f = load();
      const option = f.graph.nodes.find((n) => n.id === 'raise_pro_to_54_at_release');
      const entry = (option?.interventions as Record<string, Rec>).pro_plan_price;
      entry.source = source;
      const values = deriveOlumiAuthoredValues(f.graph);
      expect(byKind(values).levels).toEqual(A12_LEVELS.filter((l) => !l.startsWith('raise_pro_to_54')));
      expect(buildInferredValueDisclosure(values)).toBe(sentence(21));
    });
  }
});

describe('(c) CONTRAST — a link the user set or confirmed (#2096 / #2120) is not Olumi\'s strength', () => {
  it('the served user_specified link (exists_defaulted: true) is absent', () => {
    const f = load();
    const edge = f.graph.edges.find((e) => e.from === 'price_sensitivity' && e.to === 'monthly_churn_rate');
    expect((edge?.provenance as Rec).source).toBe('user_specified');
    expect(edge?.exists_defaulted).toBe(true);
    expect(byKind(deriveOlumiAuthoredValues(f.graph)).strengths).not.toContain(
      'price_sensitivity→monthly_churn_rate',
    );
  });

  it('confirming an Olumi link with the writer\'s own shape takes it out: 11 strengths, 21 in all', () => {
    const f = load();
    const edge = f.graph.edges.find((e) => e.from === 'pro_plan_price' && e.to === 'monthly_churn_rate');
    if (edge === undefined) throw new Error('fixture lost pro_plan_price→monthly_churn_rate');
    // `adjust-edge-strength.ts`: source → user_specified, `defaulted` ended, the per-field halves kept.
    edge.provenance = { source: 'user_specified' };
    delete edge.defaulted;
    edge.exists_defaulted = true;
    edge.std_defaulted = true;
    const values = deriveOlumiAuthoredValues(f.graph);
    expect(byKind(values).strengths).toEqual(A12_STRENGTHS.filter((s) => s !== 'pro_plan_price→monthly_churn_rate'));
    expect(buildInferredValueDisclosure(values)).toBe(sentence(21));
  });

  it('a stale `defaulted: true` beside the user\'s stamp does not make the strength Olumi\'s', () => {
    const f = load();
    const edge = f.graph.edges.find((e) => e.from === 'price_sensitivity' && e.to === 'monthly_churn_rate');
    if (edge === undefined) throw new Error('fixture lost price_sensitivity→monthly_churn_rate');
    edge.defaulted = true;
    expect(byKind(deriveOlumiAuthoredValues(f.graph)).strengths).toEqual(A12_STRENGTHS);
  });

  it('CONTROL — an unstamped link is claimed only when CEE marked it defaulted', () => {
    const graph = {
      nodes: [{ id: 'a', kind: 'factor' }, { id: 'b', kind: 'factor' }, { id: 'c', kind: 'factor' }],
      edges: [
        { from: 'a', to: 'b', strength: { mean: 0.5, std: 0.125 }, defaulted: true },
        { from: 'b', to: 'c', strength: { mean: 0.5, std: 0.125 } },
      ],
    };
    expect(byKind(deriveOlumiAuthoredValues(graph)).strengths).toEqual(['a→b']);
  });
});

describe('(d) a model with no Olumi values says nothing; one value keeps the existing singular copy', () => {
  const userOnly = (withOlumiLink: boolean) => ({
    nodes: [
      { id: 'd', kind: 'decision' },
      { id: 'o', kind: 'option', interventions: { f: { value: 0.3, source: 'user_specified' } } },
      { id: 'f', kind: 'factor', observed_state: { value: 0.2, source: 'brief_extraction' } },
      { id: 'g', kind: 'goal' },
    ],
    edges: [
      { from: 'd', to: 'o', strength: { mean: 1, std: 0.01 }, provenance: { source: 'cee_hypothesis' } },
      { from: 'o', to: 'f', strength: { mean: 1, std: 0.01 }, provenance: { source: 'cee_hypothesis' } },
      {
        from: 'f', to: 'g', strength: { mean: 0.4, std: 0.1 },
        provenance: { source: withOlumiLink ? 'cee_hypothesis' : 'user_specified' },
      },
    ],
  });

  it('every value the user\'s → nothing counted, and silence', () => {
    const values = deriveOlumiAuthoredValues(userOnly(false));
    expect(values).toEqual([]);
    expect(buildInferredValueDisclosure(values)).toBe('');
  });

  it('CONTRAST — one Olumi link → the existing singular sentence', () => {
    expect(buildInferredValueDisclosure(deriveOlumiAuthoredValues(userOnly(true)))).toBe(
      ' I supplied the value behind this, because your brief did not state it. It is mine rather than yours.' +
        ' Changing it changes what this model implies.',
    );
  });
});

describe('(e) the unchanged baseline predicate agrees with the ONE classifier over the contract vocabulary', () => {
  it('a factor baseline is counted exactly when classifyValueSource says Olumi drafted or repaired it', () => {
    const olumi = new Set(['ai_drafted', 'system_repaired']);
    const agree = OBSERVED_STATE_SOURCE_LITERALS.map((source) => {
      const counted = deriveInferredValues({ nodes: [{ id: 'x', kind: 'factor', observed_state: { value: 0.5, source } }] }).length === 1;
      return { source, counted, olumi: olumi.has(classifyValueSource(source)) };
    });
    expect(agree.length).toBeGreaterThan(10);
    expect(agree.filter((r) => r.counted).length).toBe(3);
    for (const r of agree) expect(r.counted, r.source).toBe(r.olumi);
  });
});
