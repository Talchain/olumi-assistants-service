/**
 * ⭐ GATE → LABEL, corrections (outbox/GATE-TO-LABEL-DESIGN.md; Codex co-design §1; DL-3 amendments). A well-formed correction is a
 * labelled card, whatever the host could not establish; only a missing or changed item refuses, and the written record must be the
 * shown one. An approved retraction withdraws the size that rested on the words in the SAME commit, and the receipt says so.
 * Real path: `propose_statement` (correction) → card → press → the real register route → read-back → cold reopen. SYNTHETIC words.
 */
import { describe, expect, it } from 'vitest';
import { correctionWorld, type Rec } from '../../agent-lane/__tests__/corrections-stage2-world.js';
import { applyStatementCorrection, claimRecordFor, userStatementFor, userStatementRecord } from '../statements.js';
import { saidByOf } from '../../agent-lane/user-statements.js';
import { linkSizing } from '../../../cee/provenance/provenance-of.js';

const SAID = 'Each extra tutor hour per pupil lifts the exam pass rate by about 3 points.';
const LINK = { kind: 'link' as const, id: 'tutor_hours', to_id: 'pass_rate', field: 'effect' as const };
const start = (): Rec => ({ nodes: [
  { id: 'goal', kind: 'goal', label: 'Exam results goal' },
  { id: 'tutor_hours', kind: 'factor', label: 'Tutor hours per pupil', observed_state: { value: 0.2, raw_value: 2, unit: 'hours a week' },
    user_statements: [userStatementRecord(LINK, [{ speaker: 'user', quote: SAID, source: SAID, form: 'point', low: 3, high: 3, unit: 'points',
      reading: 'olumi', subject: { quantity: 'effect', node_id: 'tutor_hours' } }], '2026-10-10T09:00:00.000Z', { recorded_by: 'construction' })] },
  { id: 'pass_rate', kind: 'factor', label: 'Exam pass rate', observed_state: { value: 0.62, raw_value: 62, unit: '%' } },
], edges: [
  { from: 'tutor_hours', to: 'pass_rate', strength: { mean: 0.45, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive',
    provenance: { source: 'user_specified', magnitude: 'user_stated', source_quote: SAID } },
  { from: 'pass_rate', to: 'goal', strength: { mean: 0.8, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
] });
const correction = (quote: string) => ({ correction: { quote, edits: [{ subject: LINK,
  retirement: { quote: SAID, scope: 'whole', disposition: 'retracted' }, retained: [], reading_words: 'the stated tutoring effect is withdrawn' }] } });
const LITERAL = `Please withdraw what I said: “${SAID}” I was wrong about that.`;
const PARAPHRASE = 'Scrap my earlier claim about tutoring boosting pass rates, it was only a guess.';
const edgeOf = (g: Rec): Rec => g.edges.find((e: Rec) => e.from === 'tutor_hours' && e.to === 'pass_rate');

async function retracted(message: string) {
  const w = await correctionWorld(start(), message);
  const card = await w.offer('propose_statement', correction(message)) as Rec;
  expect(card, JSON.stringify(card).slice(0, 600)).toMatchObject({ ok: true, mutated: false });
  const before = JSON.stringify(w.graph());
  const res = await w.press(card.proposal_id) as Rec;
  return { w, card, res, before };
}

describe('R4 + L1: an approved retraction withdraws the size that rested on the words, in one commit; a paraphrase lands the same', () => {
  it.each([['literal', LITERAL], ['paraphrase', PARAPHRASE]])('%s: card → press → claim withdrawn, link unsized, said, receipted', async (_kind, message) => {
    const { w, card, res } = await retracted(message);
    // The card shows the dependent action before the press.
    expect(card.public_label).toContain('The size of the link “Tutor hours per pupil → Exam pass rate” rests on the withdrawn words, so it is withdrawn too');
    expect(res, JSON.stringify(res).slice(0, 600)).toMatchObject({ ok: true, mutated: true, applied: true });
    expect(res.follow_up).toContain('The link “Tutor hours per pupil → Exam pass rate” is now unsized');
    expect(res.acknowledgement).toMatchObject({ operation_id: expect.any(String), graph_identity_hash: expect.any(String) });
    // ONE commit: the statement and the size moved together.
    expect(w.registers).toHaveLength(1);
    const edge = edgeOf(w.graph());
    expect(linkSizing(edge)).toBe('placeholder');
    expect(edge.provenance).not.toHaveProperty('source_quote');
    expect(edge.strength.mean).not.toBe(0.45);
    const record = claimRecordFor(w.graph(), LINK)!;
    expect(record.history?.map((st) => [st.quote, st.status, st.low])).toEqual([[SAID, 'withdrawn', 3]]);
    expect(record.statements.some((st) => st.quote === SAID)).toBe(false);
  });

  it('L1 label: retired words the record does not hold → a card that SAYS so (Olumi\'s reading), never a refusal; the closing line names the withdrawn size', async () => {
    const message = 'Drop the bit about extra tutoring lifting results by three points; I had it wrong.';
    const w = await correctionWorld(start(), message);
    const card = await w.offer('propose_statement', { correction: { quote: message, edits: [{ subject: LINK,
      retirement: { quote: 'tutoring lifting results by three points', scope: 'whole', disposition: 'retracted' }, retained: [],
      reading_words: 'the stated tutoring effect is withdrawn' }] } }) as Rec;
    expect(card, JSON.stringify(card).slice(0, 400)).toMatchObject({ ok: true, mutated: false });
    expect(card.public_label).toContain('Olumi could not find “tutoring lifting results by three points” in the recorded source; what is withdrawn or kept here is Olumi’s reading.');
    expect(card.public_label).toContain('the link sizes withdrawn with them, as shown');
    expect(card.public_label).not.toContain('Unknowns, figures, link strengths');
  });

  it('literal and paraphrase leave the same model (edge and history), only the correction\'s own words differ', async () => {
    const a = await retracted(LITERAL), b = await retracted(PARAPHRASE);
    expect(edgeOf(a.w.graph())).toEqual(edgeOf(b.w.graph()));
    expect(claimRecordFor(a.w.graph(), LINK)!.history).toEqual(claimRecordFor(b.w.graph(), LINK)!.history);
  });

  it('COLD REOPEN: a fresh process reads the same attribution, history and unsized link', async () => {
    const { w } = await retracted(LITERAL);
    const live = { edge: edgeOf(w.graph()), record: claimRecordFor(w.graph(), LINK) };
    const cold = await w.cold();
    expect(cold.status).toBe(200);
    const g = cold.body.graph as Rec;
    expect(edgeOf(g)).toEqual(live.edge);
    expect(claimRecordFor(g, LINK)).toEqual(live.record);
    expect(saidByOf(claimRecordFor(g, LINK)!.statements[0]!)).toBe('user');
  });
});

describe('negatives: stale and tampered writes still refuse; nothing is written', () => {
  it('N1 STALE: the link changed after the card → nothing written (superseded)', async () => {
    const w = await correctionWorld(start(), LITERAL);
    const card = await w.offer('propose_statement', correction(LITERAL)) as Rec;
    w.change((g) => { edgeOf(g).strength = { mean: 0.9, std: 0.1 }; });
    const before = JSON.stringify(w.graph());
    const res = await w.press(card.proposal_id) as Rec;
    expect(res).toMatchObject({ ok: false, mutated: false, refusal: 'superseded' });
    expect(w.registers).toHaveLength(0);
    expect(JSON.stringify(w.graph())).toBe(before);
  });

  it('N2 TAMPER: an approved payload that differs from the shown card (its dependent dropped) is invalid; nothing written', async () => {
    const w = await correctionWorld(start(), LITERAL);
    const card = await w.offer('propose_statement', correction(LITERAL)) as Rec;
    const shown = (w.proposals.get(card.proposal_id)!.operations[0]!.value as Rec).correction as Rec;
    const { dependent: _d, ...edit } = shown.edits[0];
    expect(applyStatementCorrection(w.graph(), { ...shown, edits: [edit] })).toEqual({ refused: 'invalid_statement' });
    expect(applyStatementCorrection(w.graph(), shown).candidate).toBeDefined();
  });

  it('N3: the correction\'s withdrawn claim and an unverified source never read as "you said"', async () => {
    const { w } = await retracted(LITERAL);
    expect(userStatementFor(w.graph(), LINK)?.statements.some((st) => st.quote === SAID) ?? false).toBe(false);
  });
});
