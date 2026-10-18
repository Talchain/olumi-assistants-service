/**
 * ⭐ QUANTITY BINDING CONTRACT — naming and bound rows (outbox/QUANTITY-BINDING-CONTRACT-20261018.md; owner: lean core).
 * Row 12 (#3400 RES1, Claude review 142d9c03): label words inside ANOTHER item's held quoted words never name the item being corrected.
 * Row 10 (#3396 B2) is C5's (DL-3 ruling 18 Oct: build-model.ts drafter schema + T1 instruction region, #3413). Its admission owner hunk
 * (outbox/C5-QBC-ROW10-OWNER-HUNK.patch) was WITHDRAWN by the owner: see the row-10 GUARD. Synthetic words only.
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
    if (typeof card.proposal_id === 'string') await w.press(card.proposal_id, w.restoreCard(w.proposals.get(card.proposal_id)!, card as never));
    expect(card.ok, JSON.stringify(card).slice(0, 600)).not.toBe(true);
    expect(w.writes, 'nothing is written').toHaveLength(0);
    expect(JSON.stringify(w.graph().nodes[1].user_statements)).toBe(JSON.stringify(g.nodes[1].user_statements));
  });
});

/* ── Row 10's admission hunk (C5's OWED row, flipped): a declared limit is hard only where its own bound statement is unqualified ── */
const PRICE = 'Monthly price';
const LIMIT_40 = { metric: PRICE, operator: '<=', value: 40, unit: '£ per month', provenance: 'explicit', frame: 'level', role: 'limit' };
async function constructPrice(said: string, statement: Rec): Promise<{ graph: Rec | undefined; result: Rec }> {
  let graph: Rec | undefined;
  const draft = {
    goal: { kind: null, deliverable: null, metric: 'Monthly revenue', operator: '>=', target_stated: true, value: 50000, unit: '£', horizon_months: 12,
      provenance: 'explicit', frame: 'level', baseline_known: false, baseline_value: null, baseline_provenance: 'inferred', scope: null, quantity_frame: 'level',
      source_quote: 'We want monthly revenue of at least £50,000.', deadline_words: null },
    constraints: [LIMIT_40],
    options: [{ label: 'Carry on as now', provenance: 'ai_proposed', changes: [], interventions: [], added_capacity: null, is_status_quo: true },
      { label: 'Raise the price', provenance: 'explicit', changes: [PRICE], interventions: [], added_capacity: null, is_status_quo: null }],
    factors: [{ label: PRICE, role: 'controllable', baseline_known: true, baseline_value: 20, unit: '£ per month', provenance: 'explicit', plausible_max: 40 }],
    risks: [], identities: [], unknowns: [], unknown_concerns: [], decision_question: null, outcomes: [],
    links: [{ from: PRICE, to: 'Monthly revenue', direction: 'positive', provenance: 'inferred', effect_amount: null, effect_per_source_change: null,
      effect_provenance: null, definitional: null, basis: null, source_quote: null }],
    statements: [{ quote: said, speaker: 'user', subject: { kind: 'factor', label: PRICE, to_label: null, factor_label: null }, unit: '£ per month',
      field: 'level', form: 'upper_bound', value: 40, low: null, high: null, conditions: null, ...statement }],
  };
  const dispatch = (async (path: string, body: unknown) => {
    if (path.endsWith('/graph/register')) { graph = structuredClone((body as { graph: Rec }).graph); return { status: 200, json: { model_version: { version_number: 1 } } }; }
    if (path.endsWith('/versions')) return { status: 200, json: { versions: [] } };
    return { status: 200, json: { graph: graph ?? { nodes: [], edges: [] }, graph_hash: 'h' } };
  }) as unknown as InternalDispatch;
  const result = await buildModelFromBrief('qbc00000-0000-4000-8000-0000000000b0', `We want monthly revenue of at least £50,000. ${said} We could raise the price.`,
    dispatch, (async () => ({ text: JSON.stringify(draft), status: 'completed' })) as unknown as CallStructuredModel) as Rec;
  return { graph, result };
}

const hardPriceLimits = (g: Rec | undefined): Rec[] => {
  const price = ((g?.nodes ?? []) as Rec[]).find((n) => n.label === PRICE);
  return ((g?.goal_constraints ?? []) as Rec[]).filter((c) => c.node_id === price?.id && c.value === 40);
};
describe('row 10 admission: OWED (C5\'s owner hunk withdrawn; a drafter qualifier is not a hedge)', () => {
  // ⛔ WITHDRAWN 18 Oct (owner): "any qualifier on the bound statement makes the limit soft" dropped a recorded served draft's hard
  // limit. The drafter fills `qualifier` descriptively ("available" on "We have £1,000 available for one-off research"; "current" on
  // a level), so qualifier PRESENCE is not the user's hedge. Owed to the AI's own reading of the bound's hardness (drafter schema).
  it.fails('OWED: "likely at most £40", kept qualified by the AI yet declared as a limit, is never a hard limit', async () => {
    const { graph } = await constructPrice('Our monthly price is likely at most £40 per month.', { qualifier: 'likely' });
    expect(hardPriceLimits(graph)).toEqual([]);
  });
  it('GUARD (the withdrawn hunk\'s counter-example): a descriptive qualifier ("available") never removes the user\'s declared limit', async () => {
    const { graph } = await constructPrice('We have £40 available for the monthly price.', { qualifier: 'available' });
    expect(hardPriceLimits(graph)).toHaveLength(1);
  });
  it('CONTROL (the probe sees a limit): "cannot exceed £40", unqualified and declared, registers its hard limit of 40', async () => {
    const { graph } = await constructPrice('Our monthly price cannot exceed £40 per month.', { qualifier: null });
    expect(hardPriceLimits(graph)).toHaveLength(1);
  });
});
