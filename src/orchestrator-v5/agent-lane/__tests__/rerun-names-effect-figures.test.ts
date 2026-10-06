/**
 * ⭐ SD-1 cut 6 (schemas 0.78, lease #87 6008093205): S7 says the user's OWN FIGURES for a link resized inside its band.
 *
 * Served #2629 (the cut-5 interim) names rehearsal10's link, "You changed how much Existing-customer price rise changes
 * Customers lost from price rise; it is still strong.", with no figure: the Run's snapshot recorded the engine mean,
 * band and sizing, never the size the user stated (natural effect 2 → 3 on that pair). 0.78 records the edge's own
 * `natural_effect` and the differ states an `effect` row; S7 says it with the served natural-size display.
 *
 * Outcome metric (named before the fix): on rehearsal10's pair, S7's code line carries both figures, keeps the author
 * rule, and still never credits a cause (coverage stays partial until Science rules on `effect` and coverage).
 * The unit strings are illustrative (the rehearsal's own units are not in this fixture); the rows bind by identity.
 */
import { describe, expect, it } from 'vitest';
import { RunDeltaSchema } from '@talchain/schemas/boundary';
import type { HandlerFact, RunInputSnapshot } from '@talchain/schemas/orchestrator';

import { buildRunDelta, withinBandLinkMovesForRunPair } from '../../coaching/build-run-delta.js';
import { diffRunInputs } from '../../coaching/run-input-changes.js';
import { RERUN_FALLBACK_LINES, RERUN_NO_CHANGE_LINES, rerunExplanationPlan } from '../rerun-explanation.js';

const FROM = 'existing_customer_price_rise';
const TO = 'customers_lost_from_price_rise';
const LABELS: Record<string, string> = { [FROM]: 'Existing-customer price rise', [TO]: 'Customers lost from price rise' };
const labelOf = (id: string) => LABELS[id];
const NAMED_USER = 'You changed how much Existing-customer price rise changes Customers lost from price rise; it is still strong.';
const FIGURES_USER = 'You changed how much Existing-customer price rise changes Customers lost from price rise from 2 customers per 1 percentage point to 3 customers per 1 percentage point; it is still strong.';
const FIGURES_OLUMI = 'Olumi’s estimate for how much Existing-customer price rise changes Customers lost from price rise changed from 2 customers per 1 percentage point to 3 customers per 1 percentage point; it is still strong.';

type Link = RunInputSnapshot['links'][number];
type Size = NonNullable<Link['natural_effect']>;
const size = (amount: number, over: Partial<Size> = {}): Size =>
  ({ amount, amount_unit: 'customers', per_source_change: 1, per_source_change_unit: 'percentage point', ...over });
const BRIEF_DIGEST = 'b'.repeat(64);
const EDIT_DIGEST = 'e'.repeat(64);
const link = (over: Partial<Link>): Link => ({ from: FROM, to: TO, mean: 0.4, std: 0.2, band: 'strong', sizing: 'user', authorship_digest: BRIEF_DIGEST, ...over });
const snap = (l: Link, residual: string): RunInputSnapshot => ({
  snapshot_version: 1,
  sent_digest: 'a'.repeat(64),
  residual_digest: residual,
  goal: { node_id: 'goal_mrr', label: 'MRR', target_raw: 150000, unit: '£/month', operator: '>=' },
  options: [
    { option_id: 'opt-a', label: 'Raise price', settings: [] },
    { option_id: 'opt-b', label: 'Hold', is_baseline: true, settings: [] },
  ],
  options_not_sent: [],
  factors: [],
  constraints: [],
  links: [l],
});
const fact = (runId: string, at: string, hash: string, snapshot: RunInputSnapshot): HandlerFact => ({
  fact_type: 'run_analysis',
  noop: false,
  result: {
    enrichment: {
      analysis_status: 'completed',
      results: [
        { option_id: 'opt-a', option_label: 'Raise price', win_probability: 0.45 },
        { option_id: 'opt-b', option_label: 'Hold', win_probability: 0.55 },
      ],
      meta: { seed_used: '7', n_samples: 10_000 },
      _meta: { builds: { plot: 'p1', isl: 'i1' } },
    },
    computed_at: at,
    graph_hash_at_run: hash,
    constraint_verdict: { may_name_leading_option: true, constraint_verdict_state: 'evaluated_feasible' },
    run_id: runId,
    input_snapshot: snapshot,
  },
} as unknown as HandlerFact);
const receipt = (beforeMean: number, afterMean: number): HandlerFact => ({
  fact_type: 'adjust_edge_strength',
  fact_version: 1,
  noop: false,
  result: { target_id: `${FROM}→${TO}`, status: 'applied', before: { from: FROM, to: TO, strength: { mean: beforeMean, std: 0.2 } },
    after: { from: FROM, to: TO, strength: { mean: afterMean, std: 0.3 } } },
} as unknown as HandlerFact);
const T1 = '2026-10-06T01:10:30.878Z';
const T2 = '2026-10-06T01:13:09.266Z';
const timed = (f: HandlerFact) => ({ fact: f, created_at: '2026-10-06T01:12:00.000Z' });
const PRIOR_RUN = '3f7b2f1af0062d70a6940a7f4c4c53bc32fe744e602b8548220cf34a1aec8fc8';
const CURRENT_RUN = '5731955b7bb4b30cf97b1dbcf369724d45a7e4fa9aa08b86870f8341ca81ab98';

/** rehearsal10's pair, each Run now also recording the link's current point size. */
const pairFacts = (prior: Partial<Link>, current: Partial<Link>) => [
  fact(CURRENT_RUN, T2, 'h-2', snap(link({ mean: 0.6, std: 0.3, authorship_digest: EDIT_DIGEST, ...current }), 'd'.repeat(64))),
  receipt(0.4, 0.6),
  fact(PRIOR_RUN, T1, 'h-1', snap(link(prior), 'c'.repeat(64))),
];
const s7 = (facts: HandlerFact[]) => {
  const built = buildRunDelta({ priorFacts: facts, mayNameLeadingOption: true });
  expect(built.kind).toBe('ok');
  const delta = (built as { delta: Record<string, unknown> }).delta;
  const moves = withinBandLinkMovesForRunPair(facts, delta, [timed(receipt(0.4, 0.6))]);
  const plan = rerunExplanationPlan(delta, labelOf, ['Raise price', 'Hold'], true, Object.values(LABELS), moves)!;
  return { delta, plan };
};
const effectRows = (delta: Record<string, unknown>) =>
  (delta.input_changes as Array<Record<string, unknown>>).filter((r) => r.field === 'effect');

describe('the producer → S7 chain: a link resized inside its band, with its figures', () => {
  it('⭐ RED: the real buildRunDelta states an effect row (the contract parses it), and S7 says both figures', () => {
    const { delta, plan } = s7(pairFacts({ natural_effect: size(2) }, { natural_effect: size(3) }));
    expect(effectRows(delta)).toEqual([{
      entity_kind: 'link', entity_id: `${FROM}->${TO}`, link: { from: FROM, to: TO }, field: 'effect',
      before: { raw: 2, unit: 'customers', per: { amount: 1, unit: 'percentage point' } },
      after: { raw: 3, unit: 'customers', per: { amount: 1, unit: 'percentage point' } },
      change: 'changed',
    }]);
    expect(RunDeltaSchema.safeParse(delta).success).toBe(true);
    expect(plan.codeLine).toContain(FIGURES_USER);
    expect(plan.codeLine).not.toContain(NAMED_USER);
  });

  it('coverage stays partial: the line says Olumi can’t confirm nothing else differed — never a cause', () => {
    const { delta, plan } = s7(pairFacts({ natural_effect: size(2) }, { natural_effect: size(3) }));
    expect(delta.input_coverage).toBe('partial');
    expect(plan.codeLine).toContain(RERUN_FALLBACK_LINES.unverified);
    expect(plan.inputs.attribution_case).not.toBe('C1_attributable');
  });

  it('the author rule is unchanged: Olumi’s sizing on both Runs → Olumi’s estimate, with its figures', () => {
    const { plan } = s7(pairFacts(
      { sizing: 'olumi_estimate', natural_effect: size(2) },
      { sizing: 'olumi_estimate', natural_effect: size(3), authorship_digest: BRIEF_DIGEST },
    ));
    expect(plan.codeLine).toContain(FIGURES_OLUMI);
  });
});

describe('c6\'s condition: {band} is the canvas pill\'s word; an untyped author is never inferred', () => {
  it.each([
    ['slight', 'slight'],
    ['moderate', 'moderate'],
    ['strong', 'strong'],
    ['very_strong', 'very strong'],
  ] as const)('band %s reads "%s" (lowercase, mid-sentence)', (literal, word) => {
    const { plan } = s7(pairFacts({ band: literal, natural_effect: size(2) }, { band: literal, natural_effect: size(3) }));
    expect(plan.codeLine).toContain(`; it is still ${word}.`);
  });

  it('sizing recorded as unmarked on both Runs → the unknown-author line, with its figures', () => {
    const { plan } = s7(pairFacts(
      { sizing: 'unmarked', natural_effect: size(2) },
      { sizing: 'unmarked', natural_effect: size(3), authorship_digest: BRIEF_DIGEST },
    ));
    expect(plan.codeLine).toContain('How much Existing-customer price rise changes Customers lost from price rise changed from 2 customers per 1 percentage point to 3 customers per 1 percentage point; it is still strong.');
    expect(plan.codeLine).not.toMatch(/You changed|Olumi’s estimate/);
  });
});

describe('no pair → no figures: the served line, exactly', () => {
  it.each([
    ['CONTROL: neither Run recorded a size (a pre-0.78 Run)', {}, {}],
    ['a size on the prior Run only', { natural_effect: size(2) }, {}],
    ['a size on the current Run only', {}, { natural_effect: size(3) }],
    ['per a different source change', { natural_effect: size(2) }, { natural_effect: size(30, { per_source_change: 10 }) }],
    ['per a source change in a different unit', { natural_effect: size(2) }, { natural_effect: size(3, { per_source_change_unit: 'percent' }) }],
  ])('%s', (_name, prior, current) => {
    const { delta, plan } = s7(pairFacts(prior as Partial<Link>, current as Partial<Link>));
    expect(effectRows(delta)).toEqual([]);
    expect(plan.codeLine).toContain(NAMED_USER);
    expect(plan.codeLine).not.toContain(' from 2 ');
  });

  it('the same size on both Runs is no row', () => {
    expect(diffRunInputs(
      snap(link({ natural_effect: size(2) }), 'c'.repeat(64)),
      snap(link({ mean: 0.6, natural_effect: size(2) }), 'd'.repeat(64)),
    ).rows.filter((r) => r.field === 'effect')).toEqual([]);
  });
});

describe('an effect row is said once, or counted as unsaid — never silently dropped', () => {
  const effectRow = { entity_kind: 'link', entity_id: `${FROM}->${TO}`, link: { from: FROM, to: TO }, field: 'effect',
    before: { raw: 2, unit: 'customers', per: { amount: 1, unit: 'percentage point' } },
    after: { raw: 3, unit: 'customers', per: { amount: 1, unit: 'percentage point' } }, change: 'changed' };
  const delta = (rows: unknown[]) => ({
    attribution_case: 'C1_attributable',
    pair_provenance: { seed_equal: true, hash_equal: false, builds_equal: 'equal', n_equal: true },
    leader: { changed: false, noise_verdict: 'not_noise_qualified' },
    win_probabilities: [], flip_thresholds: [],
    endpoints: { prior: { run_id: PRIOR_RUN, computed_at: T1 }, current: { run_id: CURRENT_RUN, computed_at: T2 } },
    input_coverage: 'partial',
    input_changes: rows,
  });

  it('beside a band row on the same link: the band sentence says the link, and nothing is counted unsaid', () => {
    const strength = { ...effectRow, field: 'strength', before: { raw: 'moderate' }, after: { raw: 'strong' } };
    // The band move is the user's own write in this pair (cut 6 truth floor: its receipt licenses "You changed").
    const plan = rerunExplanationPlan(delta([strength, effectRow]), labelOf, ['Raise price', 'Hold'], true, Object.values(LABELS), [],
      new Set([`${FROM}->${TO}`]))!;
    expect(plan.codeLine).toContain('Existing-customer price rise');
    expect(plan.codeLine).toContain(RERUN_FALLBACK_LINES.unverified);
    expect(plan.codeLine).not.toContain(RERUN_FALLBACK_LINES.other);
  });

  it('TWIN (cut 6 truth floor): the same band + effect rows with NO user write in the pair → both unsaid, "can’t say what changed"', () => {
    const strength = { ...effectRow, field: 'strength', before: { raw: 'moderate' }, after: { raw: 'strong' } };
    const plan = rerunExplanationPlan(delta([strength, effectRow]), labelOf, ['Raise price', 'Hold'], true, Object.values(LABELS), [])!;
    expect(plan.codeLine).toBe(RERUN_NO_CHANGE_LINES.unknown);
  });

  it('alone, with no within-band move naming its link: unsaid, so "can’t say what changed" — never "nothing changed"', () => {
    const plan = rerunExplanationPlan(delta([effectRow]), labelOf, ['Raise price', 'Hold'], true, Object.values(LABELS), [])!;
    expect(plan.codeLine).toBe(RERUN_NO_CHANGE_LINES.unknown);
    expect(plan.codeLine).not.toContain(RERUN_NO_CHANGE_LINES.nothing);
  });

  it('beside a named change on another input: the unsaid effect row makes it "other things also differed"', () => {
    const value = { entity_kind: 'factor_value', entity_id: 'fac_price', field: 'value', label_before: 'Price', label_after: 'Price',
      before: { raw: 59, unit: 'GBP' }, after: { raw: 60, unit: 'GBP' }, change: 'changed' };
    const plan = rerunExplanationPlan(delta([value, effectRow]), labelOf, ['Raise price', 'Hold'], true, Object.values(LABELS), [])!;
    expect(plan.codeLine).toContain('You changed Price: 59 GBP → 60 GBP.');
    expect(plan.codeLine).toContain(RERUN_FALLBACK_LINES.other);
    expect(plan.codeLine).not.toContain(RERUN_FALLBACK_LINES.unverified);
  });
});
