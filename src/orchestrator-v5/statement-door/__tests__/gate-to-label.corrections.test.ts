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
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';

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
    expect(card.public_label).toContain('the figures withdrawn with them, as shown');
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

describe('R09 (converged plan): a correction never changes the note while leaving the old figure live', () => {
  const COUNT = 'I counted three late deliveries by the night crew last week.';
  const LEVEL = { kind: 'factor' as const, id: 'late_deliveries', field: 'level' as const };
  const levelGraph = (): Rec => ({ nodes: [
    { id: 'goal', kind: 'goal', label: 'On-time deliveries goal' },
    { id: 'late_deliveries', kind: 'factor', label: 'Late deliveries by the night crew',
      observed_state: { value: 0.3, raw_value: 3, unit: 'late deliveries per week', cap: 10, source: 'brief_extraction' },
      user_statements: [userStatementRecord(LEVEL, [{ speaker: 'user', quote: COUNT, source: COUNT, form: 'point', low: 3, high: 3,
        unit: 'late deliveries per week', reading: 'olumi', subject: { quantity: 'level', node_id: 'late_deliveries' } }], '2026-10-10T09:00:00.000Z', { recorded_by: 'construction' })] },
  ], edges: [{ from: 'late_deliveries', to: 'goal', strength: { mean: -0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'negative' }] });
  const FIX = 'That count was for the whole month, not one week: three late deliveries over the month, and not all by the night crew.';
  const retract = { correction: { quote: FIX, edits: [{ subject: LEVEL, retirement: { quote: COUNT, scope: 'whole', disposition: 'retracted' },
    retained: [], reading_words: 'three late deliveries over a month, by more than one crew' }] } };

  it('card → press → the note is corrected AND the per-week figure is withdrawn in the same commit; said on the card and the receipt', async () => {
    const w = await correctionWorld(levelGraph(), FIX);
    const card = await w.offer('propose_statement', retract) as Rec;
    expect(card, JSON.stringify(card).slice(0, 400)).toMatchObject({ ok: true, mutated: false });
    expect(card.public_label).toContain('The current figure for “Late deliveries by the night crew” is the withdrawn one, so it is withdrawn too');
    const res = await w.press(card.proposal_id) as Rec;
    expect(res, JSON.stringify(res).slice(0, 400)).toMatchObject({ ok: true, applied: true });
    expect(res.follow_up).toContain('“Late deliveries by the night crew” now has no current figure');
    expect(w.registers).toHaveLength(1);
    const node = w.graph().nodes.find((n: Rec) => n.id === 'late_deliveries');
    expect(node).not.toHaveProperty('observed_state');
    expect(claimRecordFor(w.graph(), LEVEL)!.history?.map((st) => [st.low, st.status])).toEqual([[3, 'withdrawn']]);
    const cold = await w.cold();
    expect(cold.body.graph.nodes.find((n: Rec) => n.id === 'late_deliveries')).not.toHaveProperty('observed_state');
  });

  // ⭐ DL-3 amendment 4 row 2 (Codex co-design §1 L4): a SAME-SCALAR period correction ("three … last week" → "three over the month")
  // must stale the Run made on the old meaning. The analysis revision is the Run's freshness basis (`deriveAnalysisFreshness`,
  // `analysis_graph_hash_interim`), so the corrected commit must move it, and the cold read must hold the moved revision.
  it('PERIOD STALENESS: per week → over the month, same figure → the analysis revision moves, so the old Run reads stale', async () => {
    const before = computeAnalysisAffectingGraphHash(levelGraph() as never);
    expect(before).not.toBeNull();
    const w = await correctionWorld(levelGraph(), FIX);
    const card = await w.offer('propose_statement', retract) as Rec;
    expect(await w.press(card.proposal_id)).toMatchObject({ ok: true, applied: true });
    const after = computeAnalysisAffectingGraphHash(w.graph() as never);
    expect(after).not.toBeNull();
    expect(after).not.toBe(before);
    const cold = await w.cold();
    expect(computeAnalysisAffectingGraphHash(cold.body.graph as never)).toBe(after);
  });

  it('CONTRAST: a correction that keeps the figure\'s own statement keeps the figure', async () => {
    const message = 'Keep the count, but it was not only the night crew.';
    const w = await correctionWorld(levelGraph(), message);
    const card = await w.offer('propose_statement', { correction: { quote: message, edits: [{ subject: LEVEL,
      retirement: { quote: 'by the night crew', scope: 'part', disposition: 'retracted' }, retained: ['I counted three late deliveries'],
      reading_words: 'three late deliveries, crew unknown' }] } }) as Rec;
    expect(card, JSON.stringify(card).slice(0, 400)).toMatchObject({ ok: true });
    expect(card.public_label).not.toContain('is the withdrawn one');
    expect(await w.press(card.proposal_id)).toMatchObject({ ok: true, applied: true });
    expect(w.graph().nodes.find((n: Rec) => n.id === 'late_deliveries').observed_state).toMatchObject({ raw_value: 3 });
  });
});

