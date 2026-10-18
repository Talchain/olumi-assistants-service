/**
 * ⭐ QUANTITY BINDING CONTRACT — naming and bound rows (outbox/QUANTITY-BINDING-CONTRACT-20261018.md; owner: lean core).
 * Row 12 (#3400 RES1, Claude review 142d9c03): label words inside ANOTHER item's held quoted words never name the item being corrected.
 * Row 10 (#3396 B2, BUDDY-A 7b53b991): a verified quote is not authority for every figure inside it; a qualified end is never a hard
 * bound. #3396 is parked (its SCALE_TOP is not adopted), so row 10 guards the construction path at staging. Synthetic words only.
 */
import { describe, expect, it } from 'vitest';
import { correctionWorld, type Rec } from './corrections-stage2-world.js';
import { userStatementRecord } from '../../statement-door/statements.js';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';

type Subj = { kind: 'factor'; id: string; field: 'relation' };
const subj = (id: string): Subj => ({ kind: 'factor', id, field: 'relation' });
const rec = (s: Subj, quote: string) => userStatementRecord(s,
  [{ speaker: 'user', quote, source: quote, form: 'describes', reading: 'olumi', subject: { quantity: 'reported_account', node_id: s.id } }],
  '2026-08-01T00:00:00Z', { recorded_by: 'construction' });

describe('row 12 (#3400 RES1): an item is named only by words outside another item\'s held quoted words', () => {
  it('RED: quoting Staff costs\' words that contain "Training and onboarding" never lets a card retire Training\'s own words', async () => {
    const train = subj('train'), staff = subj('staff');
    const trainWords = 'New starters need three weeks before they work alone.';
    const staffWords = 'Training and onboarding doubled our overtime bill.';
    const g: Rec = { nodes: [{ id: 'goal', kind: 'goal', label: 'Reliable handling' },
      { id: 'train', kind: 'factor', label: 'Training and onboarding', user_statements: [rec(train, trainWords)] },
      { id: 'staff', kind: 'factor', label: 'Staff costs', user_statements: [rec(staff, staffWords)] }], edges: [] };
    const said = `Withdraw “${staffWords}” — that was wrong.`;
    const w = await correctionWorld(g, said);
    const card = await w.offer('propose_statement', { correction: { quote: said, edits: [{ subject: train,
      retirement: { quote: trainWords, scope: 'whole', disposition: 'retracted' }, retained: [], reading_words: 'the earlier account is withdrawn' }] } }) as Rec;
    if (typeof card.proposal_id === 'string') await w.press(card.proposal_id, w.restoreCard(w.proposals.get(card.proposal_id)!, card));
    expect(card.ok, JSON.stringify(card).slice(0, 600)).not.toBe(true);
    expect(w.writes, 'nothing is written').toHaveLength(0);
    expect(JSON.stringify(w.graph().nodes[1].user_statements)).toBe(JSON.stringify(g.nodes[1].user_statements));
  });
});

/* ── Row 10: a bound is never taken from another quantity's figure, nor from a qualified end ── */
const PRICE = 'Monthly price';
async function constructPrice(said: string, statement: Rec, constraints: Rec[] = []): Promise<Rec | undefined> {
  let graph: Rec | undefined;
  const draft = {
    goal: { kind: null, deliverable: null, metric: 'Monthly revenue', operator: '>=', target_stated: true, value: 50000, unit: '£', horizon_months: 12,
      provenance: 'explicit', frame: 'level', baseline_known: false, baseline_value: null, baseline_provenance: 'inferred', scope: null, quantity_frame: 'level',
      source_quote: 'We want monthly revenue of at least £50,000.', deadline_words: null },
    constraints,
    options: [{ label: 'Carry on as now', provenance: 'ai_proposed', changes: [], interventions: [], added_capacity: null, is_status_quo: true },
      { label: 'Raise the price', provenance: 'explicit', changes: [PRICE], interventions: [], added_capacity: null, is_status_quo: null }],
    factors: [{ label: PRICE, role: 'controllable', baseline_known: true, baseline_value: 20, unit: '£ per month', provenance: 'explicit', plausible_max: 40 }],
    risks: [], identities: [], unknowns: [], unknown_concerns: [], decision_question: null,
    outcomes: [{ label: 'Supplier quality', provenance: 'inferred', unit: 'score out of 40', plausible_max: 40 }],
    links: [{ from: PRICE, to: 'Monthly revenue', direction: 'positive', provenance: 'inferred', effect_amount: null, effect_per_source_change: null,
      effect_provenance: null, definitional: null, basis: null, source_quote: null }],
    statements: [{ quote: said, speaker: 'user', subject: { kind: 'factor', label: PRICE, to_label: null, factor_label: null }, unit: '£ per month',
      qualifier: null, conditions: null, low: null, high: null, ...statement }],
  };
  const dispatch = (async (path: string, body: unknown) => {
    if (path.endsWith('/graph/register')) { graph = structuredClone((body as { graph: Rec }).graph); return { status: 200, json: { model_version: { version_number: 1 } } }; }
    if (path.endsWith('/versions')) return { status: 200, json: { versions: [] } };
    return { status: 200, json: { graph: graph ?? { nodes: [], edges: [] }, graph_hash: 'h' } };
  }) as unknown as InternalDispatch;
  const brief = `We want monthly revenue of at least £50,000. ${said} We could raise the price.`;
  await buildModelFromBrief('qbc00000-0000-4000-8000-0000000000a0', brief, dispatch, (async () => ({ text: JSON.stringify(draft), status: 'completed' })) as unknown as CallStructuredModel);
  return graph;
}
const hardPriceLimits = (g: Rec | undefined): Rec[] => ((g?.goal_constraints ?? []) as Rec[])
  .filter((c) => c.node_id === ((g?.nodes ?? []) as Rec[]).find((n) => n.label === PRICE)?.id && c.value === 40);
describe('row 10 (#3396 B2): a figure becomes a bound only as its own quantity\'s, unqualified', () => {
  it('GUARD: "price is £20 … supplier quality is scored out of 40" never gives £40 to the price as a limit', async () => {
    const said = 'Our monthly price is £20 per month and supplier quality is scored out of 40.';
    const g = await constructPrice(said, { field: 'level', form: 'point', value: 20 });
    expect(g, 'PRECONDITION: the model registers').toBeDefined();
    expect(hardPriceLimits(g)).toEqual([]);
  });
  it('CONTROL (the probe sees a limit): "cannot exceed £40", declared as the price\'s limit, registers its hard limit of 40', async () => {
    const said = 'Our monthly price cannot exceed £40 per month.';
    const g = await constructPrice(said, { field: 'level', form: 'upper_bound', value: 40 },
      [{ metric: PRICE, operator: '<=', value: 40, unit: '£ per month', provenance: 'explicit', frame: 'level', role: 'limit' }]);
    expect(hardPriceLimits(g), JSON.stringify(g?.goal_constraints)).toHaveLength(1);
  });
  it('GUARD: "likely at most £40" is never recorded as a hard limit on the price', async () => {
    const said = 'Our monthly price is likely at most £40 per month.';
    const g = await constructPrice(said, { field: 'level', form: 'upper_bound', value: 40, qualifier: 'likely' });
    expect(g, 'PRECONDITION: the model registers').toBeDefined();
    expect(hardPriceLimits(g)).toEqual([]);
  });
});
