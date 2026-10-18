/**
 * ⭐ QUANTITY BINDING CONTRACT — naming and bound rows (outbox/QUANTITY-BINDING-CONTRACT-20261018.md; owner: lean core).
 * Row 12 (#3400 RES1, Claude review 142d9c03): label words inside ANOTHER item's held quoted words never name the item being corrected.
 * Row 10 (#3396 B2) is C5's (DL-3 ruling 18 Oct: build-model.ts drafter schema + T1 instruction region). Synthetic words only.
 */
import { describe, expect, it } from 'vitest';
import { correctionWorld, type Rec } from './corrections-stage2-world.js';
import { userStatementRecord } from '../../statement-door/statements.js';

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
