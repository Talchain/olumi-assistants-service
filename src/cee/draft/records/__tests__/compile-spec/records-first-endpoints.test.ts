/**
 * FIX (d): STRUCTURE FROM THE USER'S TYPED RECORDS (records-first endpoints), through the REAL `buildModelFromRecords`.
 *
 * The live 4×5 on fix (a) (sealed d1) typed every stated cause's from/to quantity, but the quantities they name had NO
 * claim node, so `carrier` refused each one (`relationship_endpoint_missing`) while the model's own claims invented a
 * collapsed structure ("Net MRR Change", option values it computed itself). `distilledD1()` is an AUTHORED, distilled
 * copy of that record SHAPE over the sealed brief already in this repo (no held-out text): the same typed indices, the
 * same missing carriers, the same invented claims. Rows:
 *   R1  the declaring item's own stated node carries an endpoint quantity, so the stated causes are carried;
 *   R1b records-only (no invented claims, the price option typed as its own quantity): the goal path is sized;
 *   R2  the duplicate twin: a model claim on the same quantity stays the ONE carrier;
 *   R3  an option-declared endpoint is minted by the option-lever mint (one quantity, one node);
 *   R4  a refused cause mints nothing (no orphan); an undeclared quantity (no unit) is never minted.
 * The sealed ideal is pinned unchanged by vnext-rows, a16 and records-ports3 Science row 4 in the same gate run.
 */
import { describe, expect, it } from 'vitest';
import { BRIEF } from './sealed-fixture.js';
import { buildModelFromRecords } from '../../../../../orchestrator-v5/agent-lane/runtime/build-model-from-records.js';
import { projectDraftRecords } from '../../seam.js';
import { targetTestabilityOf } from '../../../../../orchestrator-v5/admission/target-testability.js';
import type { DraftRecordSet } from '../../grammar.js';

type Rec = Record<string, any>;

const GOAL = 'reach at least £150,000 monthly recurring revenue within 9 months';
const LOSS = 'Each lost customer removes £300 a month of monthly recurring revenue.';
const SUBSCRIPTION = 'Each starter subscriber adds £49 a month to monthly recurring revenue.';
const CHURN = 'Each 1% price rise loses about 2 customers, between 1 and 4.';

/** Authored, distilled sealed-d1 shape (typed indices as the drafter typed them; quotes are the sealed brief's). */
function distilledD1(): DraftRecordSet {
  return {
    stated_items: [
      /* 0 */ { kind: 'goal', source_quote: GOAL, value: 150000, value_literal: '£150,000', unit_literals: ['£', 'monthly recurring revenue'], quantity: 0, baseline_ref: 1, horizon_months: 9, horizon_ref: 2, direction_literal: 'at least', unit: '£/month', role: 'target', value_scale: 'raw_count', direction: 'floor' },
      /* 1 */ { kind: 'figure', source_quote: '£120,000 monthly recurring revenue', value: 120000, value_literal: '£120,000', unit_literals: ['£', 'monthly recurring revenue'], quantity: 0, unit: '£/month', role: 'baseline', value_scale: 'raw_count' },
      /* 2 */ { kind: 'figure', source_quote: 'within 9 months', value: 9, value_literal: '9', unit_literals: ['months'], quantity: 2, unit: 'months', role: 'context', value_scale: 'raw_count' },
      /* 3 */ { kind: 'figure', source_quote: '400 customers', value: 400, value_literal: '400', unit_literals: ['customers'], quantity: 3, unit: 'customers', role: 'baseline', value_scale: 'raw_count' },
      /* 4 */ { kind: 'option', source_quote: 'raise prices by 10%', is_baseline: false },
      /* 5 */ { kind: 'option', source_quote: 'launch a starter tier at £49 a month', is_baseline: false },
      /* 6 */ { kind: 'option', source_quote: 'keep pricing as it is', is_baseline: true },
      /* 7 */ { kind: 'cause', source_quote: CHURN, relationship: { from_quantity: 4, to_quantity: 3, amount: -2, amount_literal: '2 customers', per_source_change: 0.01, per_source_literal: '1%' } },
      /* 8 */ { kind: 'cause', source_quote: LOSS, relationship: { from_quantity: 3, to_quantity: 0, amount: -300, amount_literal: '£300', per_source_change: 1, per_source_literal: 'Each lost customer' } },
      /* 9 */ { kind: 'figure', source_quote: 'The starter tier would win about 150 new subscribers, between 80 and 250.', value: 150, value_literal: '150', unit_literals: ['subscribers'], quantity: 9, range: { low: 80, high: 250, low_literal: '80', high_literal: '250', meaning: 'likely_range' }, unit: 'subscribers', role: 'context', value_scale: 'raw_count' },
      /* 10 */ { kind: 'cause', source_quote: SUBSCRIPTION, relationship: { from_quantity: 9, to_quantity: 0, amount: 49, amount_literal: '£49', per_source_change: 1, per_source_literal: 'Each starter subscriber' } },
    ],
    claims: [
      /* 0 */ { claim_kind: 'factor', label: 'Net MRR Change', basis: [7, 8, 9, 10], change_of: 0, category: 'controllable', unit: '£/month' },
      /* 1 */ { claim_kind: 'outcome', label: 'MRR Target Progress', basis: [0, 1] },
      /* 2 */ { claim_kind: 'causal_link', label: 'Price increase produces estimated net MRR change', basis: [4, 7, 8], from_stated: 4, to_claim: 0, effect: 'positive', sets_to: 6000 },
      /* 3 */ { claim_kind: 'causal_link', label: 'Starter tier produces estimated MRR change', basis: [5, 9, 10], from_stated: 5, to_claim: 0, effect: 'positive', sets_to: 7350 },
      /* 4 */ { claim_kind: 'causal_link', label: 'Net MRR change improves target progress', basis: [0, 1], from_claim: 0, to_claim: 1, effect: 'positive' },
      /* 5 */ { claim_kind: 'causal_link', label: 'MRR target progress improves monthly recurring revenue goal', basis: [0, 1], from_claim: 1, to_stated: 0, effect: 'positive' },
    ],
  };
}

/** Records-only: no invented claims, and the price-rise option typed as its own quantity ('%', unit_interval 0.1). */
function recordsOnly(): DraftRecordSet {
  const r = distilledD1();
  r.claims = [];
  r.stated_items[4] = { kind: 'option', source_quote: 'raise prices by 10%', quantity: 4, value: 0.1, value_literal: '10%', unit: '%', value_scale: 'unit_interval', is_baseline: false };
  return r;
}

async function build(records: DraftRecordSet): Promise<{ result: Rec; body: Rec }> {
  let body: Rec | undefined;
  const result = await buildModelFromRecords('11111111-1111-4111-8111-111111111111', BRIEF,
    async (path, b) => { if (path.endsWith('/register')) { body = b as Rec; return { status: 200, json: { model_version: 1 } }; } return { status: 200, json: { graph: { nodes: [], edges: [] } } }; },
    async () => ({ text: JSON.stringify(records), status: 'completed' }));
  expect(result.ok).toBe(true);
  return { result: result as Rec, body: body! };
}
const nodeByLabel = (body: Rec, label: string): Rec | undefined => (body.graph.nodes as Rec[]).find((n) => n.label === label);
function project(records: DraftRecordSet) {
  const r = projectDraftRecords(records, BRIEF); expect(r.ok).toBe(true);
  if (!r.ok) throw new Error(r.detail); return r.projection;
}

describe('fix (d) R1: a stated cause\'s endpoint is carried by its declaring item\'s own stated node', () => {
  it('compile: the lost-customer cause is drawn from the declaring figure (its quote, unit, stated level, stated) with its natural effect', () => {
    const p = project(distilledD1());
    const customers = p.graph.nodes.filter((n) => n.quantity_ref === 3);
    expect(customers).toHaveLength(1);
    expect(customers[0]).toMatchObject({ kind: 'factor', label: '400 customers', provenance: { provenance_class: 'stated', source_quote: '400 customers' } });
    expect(customers[0]!.observed_state).toMatchObject({ raw_value: 400, baseline: 400 });
    const edge = p.graph.edges.find((e) => e.provenance?.source_quote === LOSS)!;
    expect(edge.from).toBe(customers[0]!.id);
    expect(edge.provenance?.natural_effect).toMatchObject({ amount: -300, amount_unit: '£/month', per_source_change: 1, per_source_change_unit: 'customers' });
    expect(p.stated_dispositions?.find((d) => d.stated_index === 8)).toMatchObject({ disposition: 'carried' });
    expect(p.dropped.filter((d) => d.stated_index === 8 && d.reason === 'relationship_endpoint_missing')).toEqual([]);
  });
  it('served build: the cause is no longer refused as endpoint_missing and the declaring figure is registered as the user\'s', async () => {
    const { result, body } = await build(distilledD1());
    expect((result.not_represented as Rec[]).filter((d) => d.stated_index === 8 && d.reason === 'relationship_endpoint_missing')).toEqual([]);
    expect(nodeByLabel(body, '400 customers')).toMatchObject({ kind: 'factor' });
  });
  it('a context figure is not a level: the starter-subscriber quantity is not minted, so no unsized link is drawn', () => {
    const p = project(distilledD1());
    expect(p.graph.edges.some((e) => e.provenance?.source_quote === SUBSCRIPTION)).toBe(false);
    expect(p.dropped).toContainEqual(expect.objectContaining({ stated_index: 10, reason: 'relationship_endpoint_missing' }));
  });
});

describe('fix (d) R1b: records-only, the user\'s typed path reaches the goal', () => {
  it('compile: option → price rise → customers → goal, every link sized from a stated cause', () => {
    const p = project(recordsOnly());
    const sized = p.graph.edges.filter((e) => e.provenance?.natural_effect !== undefined);
    expect(sized.map((e) => e.provenance!.source_quote).sort()).toEqual([CHURN, LOSS].sort());
    expect(p.stated_dispositions?.filter((d) => [7, 8].includes(d.stated_index)).map((d) => d.disposition)).toEqual(['carried', 'carried']);
  });
  // ⛔ STOP (reported): when the GOAL itself declares its quantity (sealed d1's shape: goal at stated_items[0], quantity 0),
  // the vans goal-quantity outcome carrier declines (`declaration.kind==="goal"`), the stated edge lands on the goal, and
  // the shared sweep's factor_goal_split replaces it with "<Factor> Impact" + a 0.5 placeholder (carrier_removed,
  // P5 goal_path_unsized). Fixing it needs the vans path or the sweep: neither is this lane's to change.
  it.fails('served build: the goal path is sized (blocked by the goal-declared-quantity sweep split)', async () => {
    const { body } = await build(recordsOnly());
    expect(targetTestabilityOf(body.graph)).toMatchObject({ kind: 'testable' });
  });
});

describe('fix (d) R2: the duplicate twin — a model claim on the same quantity stays the ONE carrier', () => {
  it('a factor claim typed on quantity 3 carries the cause; the declaring figure is not a second carrier', async () => {
    const records = distilledD1();
    records.claims.push({ claim_kind: 'factor', label: 'Customer count', quantity: 3, value: 400 });
    const p = project(records);
    const carriers = p.graph.nodes.filter((n) => n.quantity_ref === 3);
    expect(carriers.map((n) => n.label)).toEqual(['Customer count']);
    expect(p.graph.edges.find((e) => e.provenance?.source_quote === LOSS)?.from).toBe(carriers[0]!.id);
    const { body } = await build(records);
    expect(nodeByLabel(body, '400 customers')).toBeUndefined();
  });
});

describe('fix (d) R3: an option-declared endpoint is minted by the option-lever mint', () => {
  it('a valueless option typed with its unit declares the price-rise quantity: one stated factor, labelled by its quote', () => {
    const records = distilledD1();
    records.stated_items[4] = { kind: 'option', source_quote: 'raise prices by 10%', quantity: 4, unit: '%', unit_literals: ['%'], value_scale: 'unit_interval', is_baseline: false };
    const p = project(records);
    const minted = p.graph.nodes.filter((n) => n.quantity_ref === 4);
    expect(minted).toHaveLength(1);
    expect(minted[0]).toMatchObject({ kind: 'factor', label: 'raise prices by 10%', provenance: { provenance_class: 'stated', source_quote: 'raise prices by 10%' } });
    expect(p.graph.edges.some((e) => e.from === minted[0]!.id && e.to === p.graph.nodes.find((n) => n.quantity_ref === 3)?.id)).toBe(true);
    expect(p.dropped.filter((d) => d.stated_index === 7 && d.reason === 'relationship_endpoint_missing')).toEqual([]);
  });
});

describe('fix (d) R4: nothing is minted without the user\'s typed evidence', () => {
  it('an undeclared quantity (the price option carries no unit) stays endpoint_missing and mints no node', () => {
    const p = project(distilledD1());
    expect(p.graph.nodes.filter((n) => n.quantity_ref === 4)).toEqual([]);
    expect(p.dropped).toContainEqual(expect.objectContaining({ stated_index: 7, reason: 'relationship_endpoint_missing' }));
  });
  it('a refused cause (its amount literal not in its quote) mints no option-declared node, so nothing is orphaned', () => {
    const records = distilledD1();
    records.stated_items[4] = { kind: 'option', source_quote: 'raise prices by 10%', quantity: 4, unit: '%', unit_literals: ['%'], value_scale: 'unit_interval', is_baseline: false };
    records.stated_items[7]!.relationship!.amount_literal = '3 customers';
    const p = project(records);
    expect(p.dropped).toContainEqual(expect.objectContaining({ stated_index: 7, reason: 'literal_absent' }));
    expect(p.graph.nodes.filter((n) => n.quantity_ref === 4)).toEqual([]);
    expect(p.dropped.filter((d) => d.label === 'raise prices by 10%' && d.reason === 'unconnected_to_goal' && d.claim_kind !== 'option')).toEqual([]);
  });
});
