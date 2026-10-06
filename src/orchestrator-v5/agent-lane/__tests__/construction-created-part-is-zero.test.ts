/**
 * ⭐ A STATED PRODUCT'S PART AN OPTION CREATES IS 0 TODAY — OLUMI'S READING, SAID ONCE (Science d5 #87 6007736377 (i);
 * DL 6 Oct, P1).
 *
 * Served: Acceptance G1 draft 11 (scenario fa05dd14, CEE 231affbe, full wire). The T1b brief's "each starter subscriber
 * costs about £6 a month in support" was declared the user's product ‘Starter-tier support cost’ = ‘Starter subscribers’ ×
 * ‘Support cost per starter subscriber’. ‘Starter subscribers’ (an outcome the launch creates, so no control can give it a
 * level) had none. ISL refused every Run (`identity_operand_missing`), and the user was asked a level they could not save,
 * after every Run. Bound by node label, the persisted graph and the sentence's exact words.
 */
import { describe, it, expect } from 'vitest';
import { Ajv } from 'ajv';
import { buildCandidateSchema, buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';

const SCENARIO = 'fa05dd14-0000-4000-8000-0000000fa05d';
const BRIEF = 'We are a B2B software company with £120,000 monthly recurring revenue from 400 customers paying £300 a month. '
  + 'Decision: raise prices by 10%, launch a starter tier at £49 a month, or keep pricing as it is. Goal: reach at least '
  + '£126,000 monthly recurring revenue within 9 months. Facts: each 1% price rise adds £1,200 a month to monthly recurring '
  + 'revenue before churn. Each 1% price rise loses about 2 customers, between 1 and 4. Each lost customer removes £300 a '
  + 'month of monthly recurring revenue. The starter tier would win about 150 new subscribers, between 80 and 250. Each '
  + 'starter subscriber adds £49 a month to monthly recurring revenue. Each starter subscriber costs about £6 a month in '
  + 'support. Keeping pricing as it is adds nothing.';
const strict = new Ajv({ strict: false }).compile(buildCandidateSchema());

type Dir = 'positive' | 'negative';
const link = (from: string, to: string, direction: Dir) => ({ from, to, direction, provenance: 'inferred', effect_amount: null, effect_per_source_change: null, effect_provenance: null });
const set = (factor_label: string, value: number, unit: string, provenance = 'explicit') => ({ factor_label, value, value_kind: 'absolute', unit, provenance });

/** Draft 11's shape, as served. `launch` is the creating option's label; `part` is how the drafter typed the part. */
function draft11(over: { launch?: string; part?: 'outcome' | 'factor'; partLevel?: number | null; provenance?: 'explicit' | 'inferred'; onGoal?: boolean } = {}): Record<string, unknown> {
  const launch = over.launch ?? 'Launch starter tier';
  const partIsFactor = over.part === 'factor';
  const subscribers = { label: 'Starter subscribers', role: 'observable', baseline_known: over.partLevel != null, baseline_value: over.partLevel ?? null,
    unit: 'subscribers', provenance: over.partLevel != null ? 'explicit' : 'ai_proposed', plausible_max: 1000 };
  return {
    goal: { metric: 'monthly recurring revenue', operator: '>=', target_stated: true, frame: 'level', value: 126000, unit: 'GBP per month', horizon_months: 9,
      provenance: 'explicit', baseline_known: true, baseline_value: 120000, baseline_provenance: 'explicit', scope: null },
    constraints: [],
    options: [
      { label: 'Raise prices 10%', provenance: 'explicit', is_status_quo: null, changes: [], interventions: [set('Price increase', 10, '%')] },
      { label: launch, provenance: 'explicit', is_status_quo: null, changes: [], interventions: [set('Starter tier launched', 1, '', 'ai_proposed')] },
      { label: 'Keep pricing as it is', provenance: 'explicit', is_status_quo: true, changes: [], interventions: [] },
    ],
    factors: [
      { label: 'Price increase', role: 'controllable', baseline_known: true, baseline_value: 0, unit: '%', provenance: 'ai_proposed', plausible_max: 100 },
      { label: 'Starter tier launched', role: 'controllable', baseline_known: true, baseline_value: 0, unit: '', provenance: 'ai_proposed', plausible_max: 1 },
      { label: 'Support cost per starter subscriber', role: 'observable', baseline_known: true, baseline_value: 6, unit: 'GBP per subscriber per month', provenance: 'explicit', plausible_max: 50 },
      ...(partIsFactor ? [subscribers] : []),
    ],
    risks: [{ label: 'Support capacity strain', provenance: 'inferred' }],
    outcomes: [
      { label: 'Existing customers lost', provenance: 'inferred' },
      ...(partIsFactor ? [] : [{ label: 'Starter subscribers', provenance: 'explicit' }]),
      { label: 'Starter-tier support cost', provenance: 'explicit' },
    ],
    links: [
      link('Price increase', 'monthly recurring revenue', 'positive'),
      link('Price increase', 'Existing customers lost', 'positive'),
      link('Existing customers lost', 'monthly recurring revenue', 'negative'),
      link('Starter tier launched', 'Starter subscribers', 'positive'),
      link('Starter subscribers', 'monthly recurring revenue', 'positive'),
      link('Starter subscribers', 'Starter-tier support cost', 'positive'),
      link('Support cost per starter subscriber', 'Starter-tier support cost', 'positive'),
      link('Starter-tier support cost', 'Support capacity strain', 'positive'),
      link('Support capacity strain', 'monthly recurring revenue', 'negative'),
    ],
    identities: [over.onGoal === true
      // A product on a node WITH a level (the goal's £120,000): ISL's ratio needs every part above 0, so no 0 is written.
      ? { outcome: 'monthly recurring revenue', operation: 'product', factors: ['Starter subscribers', 'Support cost per starter subscriber'], provenance: 'explicit' }
      : { outcome: 'Starter-tier support cost', operation: 'product', factors: ['Starter subscribers', 'Support cost per starter subscriber'], provenance: over.provenance ?? 'explicit' }],
    unknowns: [],
    decision_question: null,
  };
}

type Node = Record<string, any>;
async function build(wire: Record<string, unknown>): Promise<{ node: (label: string) => Node; said: string[] }> {
  expect(strict(wire), JSON.stringify(strict.errors)).toBe(true);
  let registered: { nodes: Node[] } | null = null;
  const call = (async () => ({ text: JSON.stringify(wire) })) as unknown as CallStructuredModel;
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) {
      registered = structuredClone((body as { graph: { nodes: Node[] } }).graph);
      return { status: 200, json: { model_version: { version_number: 1 } } };
    }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const out = await buildModelFromBrief(SCENARIO, BRIEF, dispatch, call) as { ok: boolean; not_represented?: string[]; open_questions?: string[] };
  expect(out.ok, JSON.stringify(out)).toBe(true);
  const nodes = registered!.nodes;
  return { node: (label) => nodes.find((n) => n.label === label)!, said: [...(out.not_represented ?? []), ...(out.open_questions ?? [])] };
}

const SAID = '‘Starter subscribers’ is 0 today, since ‘Launch starter tier’ would start it.';
const once = (said: string[]): number => said.filter((s) => s.includes('is 0 today, since')).length;

describe('a stated product\'s part that an option creates is 0 today — Olumi\'s reading, said once', () => {
  it('RED (served draft 11): ‘Starter subscribers’ is held at 0 today as Olumi\'s, the product is kept, and it is said ONCE', async () => {
    const { node, said } = await build(draft11());
    expect(node('Starter-tier support cost').nonlinear_identity).toMatchObject({ operation: 'product', stated_in_brief: true });
    expect(node('Starter subscribers').kind).toBe('outcome');
    expect(node('Starter subscribers').observed_state).toMatchObject({ value: 0, source: 'cee_inference' });
    expect(said.filter((s) => s === SAID)).toEqual([SAID]);
    expect(once(said)).toBe(1);
  });

  it('CONTROL (Science mutant): an option that only TARGETS it ("Offer a starter discount") creates nothing — no 0, nothing said', async () => {
    const { node, said } = await build(draft11({ launch: 'Offer a starter discount' }));
    expect(node('Starter subscribers').observed_state).toBeUndefined();
    expect(once(said)).toBe(0);
  });

  it('CONTROL (the user\'s level wins): a level the brief gives the part is kept as theirs — never replaced by the reading', async () => {
    const { node, said } = await build(draft11({ part: 'factor', partLevel: 20 }));
    // Whose figure it is stays the pipeline's call (a 20 the brief never wrote is Olumi's); the level itself is never replaced.
    expect(node('Starter subscribers').observed_state).toMatchObject({ raw_value: 20 });
    expect(node('Starter subscribers').observed_state.value).not.toBe(0);
    expect(once(said)).toBe(0);
  });

  it('RED: the same part drafted as a FACTOR with no level is held at 0 the same way (a control can correct it)', async () => {
    const { node, said } = await build(draft11({ part: 'factor' }));
    expect(node('Starter subscribers').observed_state).toMatchObject({ value: 0, source: 'cee_inference' });
    expect(said.filter((s) => s === SAID)).toEqual([SAID]);
  });

  it('CONTROL: a product on a node that HAS a level (the goal) gets no 0 on its part — it is left to the ask', async () => {
    const { node, said } = await build(draft11({ onGoal: true }));
    expect(node('monthly recurring revenue').nonlinear_identity).toMatchObject({ operation: 'product' });
    expect(node('Starter subscribers').observed_state).toBeUndefined();
    expect(once(said)).toBe(0);
  });

  it('RED (served witness draw 6, #416): Olumi\'s own (inferred) product over the same part — held at 0 the same way', async () => {
    const { node, said } = await build(draft11({ provenance: 'inferred' }));
    expect(node('Starter-tier support cost').nonlinear_identity).toMatchObject({ operation: 'product', stated_in_brief: false });
    expect(node('Starter subscribers').observed_state).toMatchObject({ value: 0, source: 'cee_inference' });
    expect(said.filter((s) => s === SAID)).toEqual([SAID]);
  });
});
