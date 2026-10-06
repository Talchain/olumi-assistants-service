/**
 * ⛔ A DIRECT BIND DRAWN THE OTHER WAY FROM THE USER'S SENTENCE IS NEVER THEIRS (DL #2644; MC hold + (A) pilot, ablated).
 *
 * Served draft 7 (Acceptance G1 g1-fa9f, CEE 231affbe) bound "Each 1% price rise loses about 2 customers, between 1 and 4"
 * WITH the user's quote as −2 into ‘Customers lost from price rise’: under the user's name, a price rise LOWERED the
 * customers lost. ISL then read Raise at 82% (sign corrected: 45.7%, Science's ≈46). The six other served drafts that carry
 * the link drew it +2. Bound by edge endpoints through the register door, re-read through `EdgeV3`.
 */
import { describe, it, expect } from 'vitest';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { EdgeV3 } from '../../../schemas/cee-v3.js';

const LOSES = 'Each 1% price rise loses about 2 customers, between 1 and 4.';
const T1B = 'We are a B2B software company with £120,000 monthly recurring revenue from 400 customers paying £300 a month. '
  + 'Decision: raise prices by 10%, launch a starter tier at £49 a month, or keep pricing as it is. Goal: reach at least '
  + '£126,000 monthly recurring revenue within 9 months. Facts: each 1% price rise adds £1,200 a month to monthly recurring '
  + `revenue before churn. ${LOSES} Each lost customer removes £300 a `
  + 'month of monthly recurring revenue. The starter tier would win about 150 new subscribers, between 80 and 250. Each '
  + 'starter subscriber adds £49 a month to monthly recurring revenue. Each starter subscriber costs about £6 a month in '
  + 'support. Keeping pricing as it is adds nothing.';

const sized = (from: string, to: string, direction: string, amount: number | null, per: number | null, provenance = 'explicit') =>
  ({ from, to, direction, provenance, effect_amount: amount, effect_per_source_change: per, effect_provenance: amount === null ? null : provenance });

/** The served link, by its served labels and drawn size: the price lever → the customers lost, then into the goal. */
function draft(source: string, target: string, amount: number): Record<string, unknown> {
  return {
    goal: { metric: 'monthly recurring revenue', operator: '>=', target_stated: true, frame: 'level', value: 126000, unit: 'GBP per month', horizon_months: 9,
      provenance: 'explicit', baseline_known: true, baseline_value: 120000, baseline_provenance: 'explicit', scope: null },
    constraints: [],
    options: [
      { label: 'Raise prices by 10%', provenance: 'explicit', is_status_quo: null, changes: [],
        interventions: [{ factor_label: source, value: 10, value_kind: 'absolute', unit: '%', provenance: 'explicit' }] },
      { label: 'Keep pricing as it is', provenance: 'explicit', is_status_quo: true, changes: [], interventions: [] },
    ],
    factors: [{ label: source, role: 'controllable', baseline_known: true, baseline_value: 0, unit: '%', provenance: 'ai_proposed', plausible_max: 100 }],
    risks: [],
    outcomes: [{ label: target, provenance: 'inferred', unit: 'customers', plausible_max: 1000 }],
    links: [
      sized(source, 'monthly recurring revenue', 'positive', 1200, 1),
      sized(source, target, amount < 0 ? 'negative' : 'positive', amount, 1),
      sized(target, 'monthly recurring revenue', 'negative', -300, 1),
    ],
    identities: [], unknowns: [], decision_question: null,
  };
}

type Rec = Record<string, any>;
async function build(wire: Record<string, unknown>): Promise<{ edge: (from: string, to: string) => Rec; said: string[] }> {
  let g: Rec | null = null;
  const call = (async () => ({ text: JSON.stringify(wire) })) as unknown as CallStructuredModel;
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) {
      g = structuredClone((body as { graph: Rec }).graph);
      return { status: 200, json: { model_version: { version_number: 1 } } };
    }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const out = await buildModelFromBrief('956e3c12-0000-4000-8000-0000000956e3', T1B, dispatch, call) as Rec;
  expect(out.ok, JSON.stringify(out)).toBe(true);
  const idOf = (l: string): string => (g!.nodes as Rec[]).find((n) => n.label === l)!.id;
  return {
    edge: (from, to) => EdgeV3.parse((g!.edges as Rec[]).find((e) => e.from === idOf(from) && e.to === idOf(to))!) as Rec,
    said: [...(out.not_represented ?? []), ...(out.open_questions ?? [])],
  };
}

// The six served drafts that drew "loses about 2 customers" the way it runs (g1-fa9f drafts 8–13, as served).
const SERVED_RIGHT_WAY: [string, string, string][] = [
  ['draft 8', 'Price rise from current price', 'Customers lost from price rise'],
  ['draft 9', 'Price rise', 'Customers lost from price rise'],
  ['draft 10', 'Price increase', 'Customers lost to price rise'],
  ['draft 11', 'Price increase', 'Existing customers lost'],
  ['draft 12', 'Existing-tier price rise', 'Price-induced customer losses'],
  ['draft 13', 'Price increase', 'Price-rise customer losses'],
];

describe('a direct bind is the user\'s only when it runs the way their sentence says', () => {
  it.each(SERVED_RIGHT_WAY)('CONTROL (served %s): ‘%s’ → ‘%s’ drawn +2 is the user\'s, with the quote and its range', async (_d, source, target) => {
    const { edge } = await build(draft(source, target, 2));
    const p = edge(source, target).provenance;
    expect(p).toMatchObject({ magnitude: 'user_stated', source_quote: LOSES });
    expect(p.natural_effect).toMatchObject({ amount: 2, stated_range: { low: 1, high: 4, end: 'centre' } });
  });

  it('RED (served draft 7): drawn −2 into ‘Customers lost from price rise’ is NOT the user\'s, carries no quote or range, and is said', async () => {
    const { edge, said } = await build(draft('Price rise', 'Customers lost from price rise', -2));
    const p = edge('Price rise', 'Customers lost from price rise').provenance;
    expect(p.magnitude).not.toBe('user_stated');
    expect(p.source_quote).toBeUndefined();
    expect(p.natural_effect?.stated_range).toBeUndefined();
    expect(said).toContain(`“${LOSES}” is not recorded as your figure for ‘Price rise’ → ‘Customers lost from price rise’: that link `
      + 'is drawn to run the other way from what you wrote. Check which way it runs.');
  });
});
