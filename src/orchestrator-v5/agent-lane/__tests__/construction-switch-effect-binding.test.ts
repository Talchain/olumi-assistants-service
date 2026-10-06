/**
 * ⭐ A SWITCH'S STATED EFFECT IS BOUND WITH ITS QUOTE (Science d5 #87 6008844683). "The starter tier would win about 150
 * new subscribers, between 80 and 250": one switch turned on, so no per-source figure is written, and Fi never bound it.
 * Served T1b (Acceptance drafts 2, 3, 5 on CEE 231affbe): ‘Starter tier launched’ → ‘Starter subscribers’ (150 per switch)
 * reached the user's column only through the `sizeWritten` door, with no quote. Bound by edge endpoints and the stored quote.
 */
import { describe, it, expect } from 'vitest';
import { Ajv } from 'ajv';
import { buildCandidateSchema, buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';

const T1B = 'We are a B2B software company with £120,000 monthly recurring revenue from 400 customers paying £300 a month. '
  + 'Decision: raise prices by 10%, launch a starter tier at £49 a month, or keep pricing as it is. Goal: reach at least '
  + '£126,000 monthly recurring revenue within 9 months. Facts: each 1% price rise adds £1,200 a month to monthly recurring '
  + 'revenue before churn. Each 1% price rise loses about 2 customers, between 1 and 4. Each lost customer removes £300 a '
  + 'month of monthly recurring revenue. The starter tier would win about 150 new subscribers, between 80 and 250. Each '
  + 'starter subscriber adds £49 a month to monthly recurring revenue. Each starter subscriber costs about £6 a month in '
  + 'support. Keeping pricing as it is adds nothing.';
const WIN = 'The starter tier would win about 150 new subscribers, between 80 and 250.';
const strict = new Ajv({ strict: false }).compile(buildCandidateSchema());

type Dir = 'positive' | 'negative';
const sized = (from: string, to: string, direction: Dir, amount: number | null, per: number | null, provenance = 'explicit') =>
  ({ from, to, direction, provenance, effect_amount: amount, effect_per_source_change: per, effect_provenance: amount === null ? null : provenance });
const set = (factor_label: string, value: number, unit: string, provenance = 'explicit') => ({ factor_label, value, value_kind: 'absolute', unit, provenance });

/** Served draft 7's shape: Launch turns on ‘Starter tier launched’, which wins ‘Starter subscribers’. */
function draft7(over: { option?: string; switchLabel?: string; switchMax?: number; switchUnit?: string } = {}): Record<string, unknown> {
  const sw = over.switchLabel ?? 'Starter tier launched';
  return {
    goal: { metric: 'monthly recurring revenue', operator: '>=', target_stated: true, frame: 'level', value: 126000, unit: 'GBP per month', horizon_months: 9,
      provenance: 'explicit', baseline_known: true, baseline_value: 120000, baseline_provenance: 'explicit', scope: null },
    constraints: [],
    options: [
      { label: over.option ?? 'Launch starter tier', provenance: 'explicit', is_status_quo: null, changes: [], interventions: [set(sw, 1, over.switchUnit ?? '', 'ai_proposed')] },
      { label: 'Keep pricing as it is', provenance: 'explicit', is_status_quo: true, changes: [], interventions: [] },
    ],
    factors: [
      { label: sw, role: 'controllable', baseline_known: true, baseline_value: 0, unit: over.switchUnit ?? '', provenance: 'ai_proposed', plausible_max: over.switchMax ?? 1 },
    ],
    risks: [],
    outcomes: [{ label: 'Starter subscribers', provenance: 'inferred', unit: 'subscribers', plausible_max: 1000 }],
    links: [
      sized(sw, 'Starter subscribers', 'positive', 150, 1),
      sized('Starter subscribers', 'monthly recurring revenue', 'positive', 49, 1),
    ],
    identities: [],
    unknowns: [],
    decision_question: null,
  };
}

type Edge = Record<string, any>;
async function build(wire: Record<string, unknown>, brief = T1B): Promise<(from: string, to: string) => Edge> {
  expect(strict(wire), JSON.stringify(strict.errors)).toBe(true);
  let registered: { nodes: Edge[]; edges: Edge[] } | null = null;
  const call = (async () => ({ text: JSON.stringify(wire) })) as unknown as CallStructuredModel;
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) {
      registered = structuredClone((body as { graph: { nodes: Edge[]; edges: Edge[] } }).graph);
      return { status: 200, json: { model_version: { version_number: 1 } } };
    }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const out = await buildModelFromBrief('b63d8672-0000-4000-8000-0000000b63d8', brief, dispatch, call) as { ok: boolean };
  expect(out.ok, JSON.stringify(out)).toBe(true);
  const g = registered!;
  const idOf = (l: string) => g.nodes.find((n) => n.label === l)!.id;
  return (from, to) => g.edges.find((e) => e.from === idOf(from) && e.to === idOf(to))!;
}

describe('a switch\'s stated effect is bound with its quote', () => {
  it('RED (served T1b): "would win about 150 new subscribers" is the user\'s size WITH its quote', async () => {
    const edge = await build(draft7());
    expect(edge('Starter tier launched', 'Starter subscribers').provenance).toMatchObject({ magnitude: 'user_stated', source_quote: WIN });
  });

  it('RED: the switch is named by its SETTING option when its own label is all switch words ("Launched" set by "Launch starter tier")', async () => {
    const edge = await build(draft7({ switchLabel: 'Tier launched' }));
    expect(edge('Tier launched', 'Starter subscribers').provenance).toMatchObject({ source_quote: WIN });
  });

  it('CONTROL (Science mutant: source not named): a sentence that never names the switch or its option binds nothing', async () => {
    const brief = T1B.replace(WIN, 'About 150 new starter subscribers would come, between 80 and 250.');
    const edge = await build(draft7(), brief);
    expect(edge('Starter tier launched', 'Starter subscribers').provenance.source_quote).toBeUndefined();
  });

  it('CONTROL (Science mutant: continuous as a switch): a CONTINUOUS source is never bound per an unwritten switch', async () => {
    const edge = await build(draft7({ switchLabel: 'Starter tier marketing spend', switchMax: 10000, switchUnit: 'GBP per month' }));
    expect(edge('Starter tier marketing spend', 'Starter subscribers').provenance.source_quote).toBeUndefined();
  });
});
