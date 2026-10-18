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
    expect(card.public_label).toContain('If you approve, the size of the relationship “Tutor hours per pupil → Exam pass rate” will become unavailable because this correction removes the source it rests on.');
    // Codex BLOCK P2: no change line is unconditional before approval.
    expect(card.public_label).not.toContain('so it is withdrawn too: the link becomes unsized');
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
    expect(card.public_label).toContain('If you approve, this card will save only the changes listed above. Your original source remains in the history, and Olumi’s interpretation stays separate from it.');
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

/**
 * ⭐ RETAIN / REPLACE / RETRACT (release replay 166a5280: R07 BLOCKING wrong-item write; 5/10 numeric corrections withdrew the old figure
 * without writing the user's new one). A factor's level follows ONLY the correction's explicit meaning: the user's corrected figure is
 * written in the same commit; a withdrawn figure with nothing given is withdrawn; anything else leaves the level exactly as it is.
 * SYNTHETIC words (two shift factors); never the replay's case text.
 */
describe('RETAIN / REPLACE / RETRACT: a factor\'s level follows only what the correction states', () => {
  const NIGHT_SAID = 'We staff 40 hours per week of night shifts.';
  const DAY_SAID = 'Day shifts take 60 hours per week.';
  const NIGHT = { kind: 'factor' as const, id: 'night_hours', field: 'level' as const };
  const DAY = { kind: 'factor' as const, id: 'day_hours', field: 'level' as const };
  const claim = (id: string, quote: string, figure: number): Rec => userStatementRecord({ kind: 'factor', id, field: 'level' }, [{ speaker: 'user', quote, source: quote,
    form: 'point', low: figure, high: figure, unit: 'hours per week', reading: 'olumi', subject: { quantity: 'level', node_id: id } }], '2026-10-10T09:00:00.000Z', { recorded_by: 'construction' });
  const shifts = (): Rec => ({ nodes: [
    { id: 'goal', kind: 'goal', label: 'Ward cover goal' },
    { id: 'night_hours', kind: 'factor', label: 'Night shift hours', observed_state: { value: 0.4, raw_value: 40, unit: 'hours per week', cap: 100, source: 'brief_extraction' },
      user_statements: [claim('night_hours', NIGHT_SAID, 40)] },
    { id: 'day_hours', kind: 'factor', label: 'Day shift hours', observed_state: { value: 0.6, raw_value: 60, unit: 'hours per week', cap: 100, source: 'brief_extraction' },
      user_statements: [claim('day_hours', DAY_SAID, 60)] },
  ], edges: [
    { from: 'night_hours', to: 'goal', strength: { mean: 0.4, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'day_hours', to: 'goal', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
  ] });
  const nodeIn = (g: Rec, id: string): Rec => g.nodes.find((n: Rec) => n.id === id);
  const edit = (subject: Rec, retired: string, disposition: 'historical' | 'retracted', reading: string, replacement?: Rec): Rec => ({ subject,
    retirement: { quote: retired, scope: 'whole', disposition }, retained: [], reading_words: reading, ...(replacement === undefined ? {} : { replacement }) });

  it('REPLACE (RED: withdraw-only): the corrected figure the user gives is written in the same commit, said on the card and receipt, and survives reopen', async () => {
    const FIX = 'Correction: night shifts take 45 hours per week, not 40.';
    const before = shifts();
    const w = await correctionWorld(shifts(), FIX);
    const card = await w.offer('propose_statement', { correction: { quote: FIX, edits: [edit(NIGHT, NIGHT_SAID, 'retracted',
      'night shifts take 45 hours per week', { value: 45, unit: 'hours per week', span: 'night shifts take 45 hours per week' })] } }) as Rec;
    expect(card, JSON.stringify(card).slice(0, 500)).toMatchObject({ ok: true, mutated: false });
    expect(card.public_label).toContain('If you approve, “Night shift hours” will no longer use 40 hours per week, because this correction removes the source it rests on. It will use 45 hours per week, your corrected figure, instead. The earlier source remains in the history.');
    expect(card.public_label).not.toContain('It will have no current figure until one is given.');
    const res = await w.press(card.proposal_id) as Rec;
    expect(res, JSON.stringify(res).slice(0, 500)).toMatchObject({ ok: true, applied: true });
    expect(res.follow_up).toContain('“Night shift hours” now has your corrected figure, 45 hours per week.');
    expect(w.registers).toHaveLength(1);
    expect(nodeIn(w.graph(), 'night_hours').observed_state).toEqual({ value: 0.45, raw_value: 45, unit: 'hours per week', cap: 100, source: 'user_override' });
    expect(claimRecordFor(w.graph(), NIGHT)!.statements[0]).toMatchObject({ speaker: 'user', form: 'point', low: 45, high: 45, unit: 'hours per week' });
    expect(claimRecordFor(w.graph(), NIGHT)!.statements[0]).not.toHaveProperty('checks');
    expect(userStatementFor(w.graph(), NIGHT)?.statements.map((st) => st.low)).toEqual([45]);
    expect(computeAnalysisAffectingGraphHash(w.graph() as never)).not.toBe(computeAnalysisAffectingGraphHash(before as never));
    // Only the stated item moved.
    expect(nodeIn(w.graph(), 'day_hours')).toEqual(nodeIn(before, 'day_hours'));
    const cold = await w.cold();
    expect(nodeIn(cold.body.graph, 'night_hours').observed_state).toMatchObject({ raw_value: 45, unit: 'hours per week', source: 'user_override' });
  });

  it('KEEP X UNTOUCHED (RED: R07 shape): one item replaced, another the correction keeps as earlier context, its figure byte-identical', async () => {
    const FIX = 'Night shifts take 45 hours per week, not 40; keep the day shifts at 60 hours.';
    const before = shifts();
    const w = await correctionWorld(shifts(), FIX);
    const card = await w.offer('propose_statement', { correction: { quote: FIX, edits: [
      edit(NIGHT, NIGHT_SAID, 'historical', 'night shifts take 45 hours per week', { value: 45, unit: 'hours per week', span: 'Night shifts take 45 hours per week' }),
      // "Keep X" is an EXPLICIT keep (`retained`): the day figure's own words kept, only the note about it retired (Codex P1-4 contract).
      { subject: DAY, retirement: { quote: 'keep the day shifts at 60 hours', scope: 'part', disposition: 'historical' }, retained: [DAY_SAID], reading_words: 'keep the day shifts at 60 hours' }] } }) as Rec;
    expect(card, JSON.stringify(card).slice(0, 500)).toMatchObject({ ok: true, mutated: false });
    expect(card.public_label).toContain('60 hours per week stays as stated for “Day shift hours”.');
    expect(card.public_label).not.toContain('“Day shift hours” will no longer use');
    expect(await w.press(card.proposal_id)).toMatchObject({ ok: true, applied: true });
    expect(nodeIn(w.graph(), 'day_hours').observed_state).toEqual(nodeIn(before, 'day_hours').observed_state);
    expect(nodeIn(w.graph(), 'night_hours').observed_state).toMatchObject({ raw_value: 45 });
    const cold = await w.cold();
    expect(nodeIn(cold.body.graph, 'day_hours').observed_state).toEqual(nodeIn(before, 'day_hours').observed_state);
  });

  it('NEGATIVE: a corrected figure NOT in the user\'s words is never written; a withdrawn figure goes, and the card says why', async () => {
    const FIX = 'Correction: night shifts take 45 hours per week, not 40.';
    const w = await correctionWorld(shifts(), FIX);
    const card = await w.offer('propose_statement', { correction: { quote: FIX, edits: [edit(NIGHT, NIGHT_SAID, 'retracted',
      'night shifts take 50 hours per week', { value: 50, unit: 'hours per week', span: 'night shifts take 45 hours per week' })] } }) as Rec;
    expect(card.public_label).toContain('I could not confirm that 50 hours per week describes “Night shift hours” in this source, so this card will not save it there. If you approve, “Night shift hours” will no longer use 40 hours per week, because this correction removes the source it rests on. It will have no current figure until one is given.');
    expect(await w.press(card.proposal_id)).toMatchObject({ ok: true, applied: true });
    expect(nodeIn(w.graph(), 'night_hours')).not.toHaveProperty('observed_state');
    expect(claimRecordFor(w.graph(), NIGHT)!.statements[0]).toMatchObject({ low: 50, checks: { words_found: true, figure_found: false, unit_found: false } });
    expect(userStatementFor(w.graph(), NIGHT)).toBeUndefined();
  });

  it('INCOMPLETE: a corrected figure in ANOTHER period is kept on the claim, never written over the weekly figure; called incomplete', async () => {
    const FIX = 'Night shifts take 180 hours per month, not 40 a week.';
    const w = await correctionWorld(shifts(), FIX);
    const card = await w.offer('propose_statement', { correction: { quote: FIX, edits: [edit(NIGHT, NIGHT_SAID, 'historical',
      'night shifts take 180 hours per month', { value: 180, unit: 'hours per month', span: 'Night shifts take 180 hours per month' })] } }) as Rec;
    expect(card.public_label).toContain('Your corrected figure, 180 hours per month, stays with your words, but the model measures “Night shift hours” in hours per week, '
      + 'so this correction is incomplete: it will have no current figure until one is given in hours per week.');
    const res = await w.press(card.proposal_id) as Rec;
    expect(res).toMatchObject({ ok: true, applied: true });
    expect(res.follow_up).toContain('this correction is incomplete');
    expect(res.follow_up).not.toContain('now has your corrected figure');
    expect(nodeIn(w.graph(), 'night_hours')).not.toHaveProperty('observed_state');
    expect(claimRecordFor(w.graph(), NIGHT)!.statements[0]).toMatchObject({ speaker: 'user', form: 'point', low: 180, unit: 'hours per month' });
  });

  // ⭐ Buddy-A §1 proof: the SAME correction sentence with a different quantity or period gets a different, exact operation.
  it.each([
    [45, 'hours per week', 'written'], [52, 'hours per week', 'written'], [180, 'hours per month', 'incomplete'], [8, 'hours per day', 'incomplete'],
  ] as const)('SAME SENTENCE: “night shifts take %s %s, not 40” → %s', async (figure, unit, outcome) => {
    const FIX = `Correction: night shifts take ${figure} ${unit}, not 40.`;
    const w = await correctionWorld(shifts(), FIX);
    const card = await w.offer('propose_statement', { correction: { quote: FIX, edits: [edit(NIGHT, NIGHT_SAID, 'historical',
      `night shifts take ${figure} ${unit}`, { value: figure, unit, span: `night shifts take ${figure} ${unit}` })] } }) as Rec;
    expect(card, JSON.stringify(card).slice(0, 500)).toMatchObject({ ok: true, mutated: false });
    const res = await w.press(card.proposal_id) as Rec;
    expect(res).toMatchObject({ ok: true, applied: true });
    const night = nodeIn((await w.cold()).body.graph, 'night_hours');
    if (outcome === 'written') {
      expect(card.public_label).toContain(`It will use ${figure} ${unit}, your corrected figure, instead.`);
      expect(night.observed_state).toMatchObject({ raw_value: figure, unit: 'hours per week', source: 'user_override' });
    } else {
      expect(card.public_label).toContain('so this correction is incomplete');
      expect(res.follow_up).toContain('this correction is incomplete');
      expect(night).not.toHaveProperty('observed_state');
    }
    expect(claimRecordFor(w.graph(), NIGHT)!.statements[0]).toMatchObject({ form: 'point', low: figure, unit });
  });

  it('UNCHANGED PARTY ESTIMATE: the user\'s correction replaces their own figure; another party\'s estimate on the same item stays current, byte-identical', async () => {
    const PARTY_SAID = 'The ward manager reckons nights need 50 hours per week.';
    const party = { said_by: 'party', party: 'the ward manager', relayed_by: 'user', quote: PARTY_SAID, source: PARTY_SAID, form: 'point', low: 50, high: 50,
      unit: 'hours per week', reading: 'olumi', subject: { quantity: 'level', node_id: 'night_hours' } };
    const graph = shifts();
    graph.nodes[1].user_statements[0].statements.push(party);
    const FIX = 'Correction: night shifts take 45 hours per week, not 40.';
    const w = await correctionWorld(graph, FIX);
    expect(claimRecordFor(w.graph(), NIGHT)!.statements).toContainEqual(party);
    const card = await w.offer('propose_statement', { correction: { quote: FIX, edits: [edit(NIGHT, NIGHT_SAID, 'retracted',
      'night shifts take 45 hours per week', { value: 45, unit: 'hours per week', span: 'night shifts take 45 hours per week' })] } }) as Rec;
    expect(card, JSON.stringify(card).slice(0, 500)).toMatchObject({ ok: true, mutated: false });
    expect(await w.press(card.proposal_id)).toMatchObject({ ok: true, applied: true });
    for (const g of [w.graph(), w.writes[0]!.graph, (await w.cold()).body.graph]) {
      const record = claimRecordFor(g, NIGHT)!;
      expect(record.statements).toContainEqual(party);
      expect(record.statements.filter((st) => saidByOf(st) === 'user').map((st) => st.low)).toEqual([45]);
      expect(record.history?.map((st) => [st.quote, st.status])).toEqual([[NIGHT_SAID, 'withdrawn']]);
      expect(nodeIn(g, 'night_hours').observed_state).toMatchObject({ raw_value: 45 });
    }
  });

  // ⭐ Buddy-A §1: retract withdraws only the level that IS the withdrawn claim's figure: same figure AND period, never the number alone.
  it.each([['hours per week', 'withdrawn'], ['hours per month', 'kept']] as const)('RETRACT IDENTITY: withdrawing “night shifts were 40 %s” → the weekly level is %s', async (unit, outcome) => {
    const SAID = `Night shifts were 40 ${unit}.`;
    const g = shifts();
    g.nodes[1].user_statements = [userStatementRecord(NIGHT, [{ speaker: 'user', quote: SAID, source: SAID, form: 'point', low: 40, high: 40, unit,
      reading: 'olumi', subject: { quantity: 'level', node_id: 'night_hours' } }], '2026-10-10T09:00:00.000Z', { recorded_by: 'construction' })];
    const before = structuredClone(g);
    const FIX = 'Withdraw what I said about the night shift hours; I do not know them.';
    const w = await correctionWorld(g, FIX);
    const card = await w.offer('propose_statement', { correction: { quote: FIX, edits: [edit(NIGHT, SAID, 'retracted', 'the night shift figure is withdrawn')] } }) as Rec;
    expect(card, JSON.stringify(card).slice(0, 500)).toMatchObject({ ok: true, mutated: false });
    expect(await w.press(card.proposal_id)).toMatchObject({ ok: true, applied: true });
    const night = nodeIn((await w.cold()).body.graph, 'night_hours');
    if (outcome === 'withdrawn') {
      expect(card.public_label).toContain('If you approve, “Night shift hours” will no longer use 40 hours per week, because this correction removes the source it rests on. It will have no current figure until one is given.');
      expect(night).not.toHaveProperty('observed_state');
    } else {
      expect(card.public_label).toContain('40 hours per week stays as stated for “Night shift hours”.');
      expect(night.observed_state).toEqual(nodeIn(before, 'night_hours').observed_state);
    }
    expect(claimRecordFor(w.graph(), NIGHT)!.history?.map((st) => [st.low, st.unit, st.status])).toEqual([[40, unit, 'withdrawn']]);
  });

  describe('DEPENDENT CURRENTNESS: Olumi\'s figure worked out from a corrected level by definition goes with it, in the same commit', () => {
    const definitional = (from: string): Rec => ({ from, to: 'total_hours', strength: { mean: 0.5, std: 0.01 }, exists_probability: 1, effect_direction: 'positive',
      provenance: { source: 'cee_hypothesis', magnitude: 'olumi_estimate', definitional: true, basis: 'Total hours are night hours plus day hours.' } });
    const withTotal = (totalSource: Rec = { source: 'cee_inference', extractionType: 'inferred' }): Rec => {
      const g = shifts();
      g.nodes.push({ id: 'total_hours', kind: 'factor', label: 'Total shift hours', observed_state: { value: 0.5, raw_value: 100, unit: 'hours per week', cap: 200, ...totalSource } },
        { id: 'overtime', kind: 'factor', label: 'Overtime hours', observed_state: { value: 0.05, raw_value: 5, unit: 'hours per week', cap: 100, source: 'cee_inference', extractionType: 'inferred' } });
      g.edges.push(definitional('night_hours'), definitional('day_hours'),
        { from: 'night_hours', to: 'overtime', strength: { mean: 0.3, std: 0.1 }, exists_probability: 0.8, effect_direction: 'positive', provenance: { source: 'cee_hypothesis' } });
      return g;
    };
    // AIE 19:00 (1eae2474): conditional on approval; withdrawn because its derivation used the corrected input, never "proved false".
    const LINE = 'If you approve, the calculation for “Total shift hours” will become unavailable because its inputs have changed. This does not establish that the earlier result was false; its source remains in the history.';

    it.each([['replace', 'retracted', { value: 45, unit: 'hours per week', span: 'night shifts take 45 hours per week' }], ['retract', 'retracted', undefined]] as const)(
      '%s: displayed → approved → persisted → cold readback; an ordinary Olumi child and the other item untouched; no zero invented', async (_kind, disposition, replacement) => {
        const FIX = replacement === undefined ? 'Scrap the night shift figure, I do not know it.' : 'Correction: night shifts take 45 hours per week, not 40.';
        const before = withTotal();
        const w = await correctionWorld(withTotal(), FIX);
        const card = await w.offer('propose_statement', { correction: { quote: FIX, edits: [edit(NIGHT, NIGHT_SAID, disposition,
          'the night shift figure is corrected', replacement)] } }) as Rec;
        expect(card, JSON.stringify(card).slice(0, 500)).toMatchObject({ ok: true, mutated: false });
        expect(card.public_label).toContain(LINE);
        expect(w.writes).toHaveLength(0);
        const res = await w.press(card.proposal_id) as Rec;
        expect(res, JSON.stringify(res).slice(0, 500)).toMatchObject({ ok: true, applied: true });
        expect(res.follow_up).toContain('The calculation for “Total shift hours” is now unavailable because its inputs have changed.');
        expect(w.writes).toHaveLength(1);
        for (const g of [w.writes[0]!.graph, (await w.cold()).body.graph]) {
          expect(nodeIn(g, 'total_hours')).not.toHaveProperty('observed_state');
          expect(nodeIn(g, 'overtime')).toEqual(nodeIn(before, 'overtime'));
          expect(nodeIn(g, 'day_hours')).toEqual(nodeIn(before, 'day_hours'));
          if (replacement === undefined) expect(nodeIn(g, 'night_hours')).not.toHaveProperty('observed_state');
          else expect(nodeIn(g, 'night_hours').observed_state).toMatchObject({ raw_value: 45 });
          // Retract never invents a figure: no level reads zero, and the withdrawn claim is history.
          expect(g.nodes.filter((n: Rec) => n.observed_state?.raw_value === 0 || n.observed_state?.value === 0)).toEqual([]);
          expect(claimRecordFor(g, NIGHT)!.history?.map((st) => [st.low, st.status])).toEqual([[40, 'withdrawn']]);
        }
      });

    it('CONTRAST: keeping the level keeps Olumi\'s figure worked out from it; a definitional figure the user gave is never withdrawn', async () => {
      const keep = await correctionWorld(withTotal(), 'Keep the night shifts at 40 hours per week.');
      const kept = await keep.offer('propose_statement', { correction: { quote: 'Keep the night shifts at 40 hours per week.', edits: [{ subject: NIGHT,
        retirement: { quote: 'the night shift note', scope: 'part', disposition: 'historical' }, retained: [NIGHT_SAID], reading_words: 'keep 40' }] } }) as Rec;
      expect(kept.public_label).not.toContain(LINE);
      expect(await keep.press(kept.proposal_id)).toMatchObject({ ok: true, applied: true });
      expect(nodeIn(keep.graph(), 'total_hours').observed_state).toMatchObject({ raw_value: 100 });
      const FIX = 'Correction: night shifts take 45 hours per week, not 40.';
      const theirs = withTotal({ source: 'brief_extraction', extractionType: 'explicit' });
      const w = await correctionWorld(theirs, FIX);
      const card = await w.offer('propose_statement', { correction: { quote: FIX, edits: [edit(NIGHT, NIGHT_SAID, 'retracted',
        'night shifts take 45 hours per week', { value: 45, unit: 'hours per week', span: 'night shifts take 45 hours per week' })] } }) as Rec;
      expect(card.public_label).not.toContain('Total shift hours');
      expect(await w.press(card.proposal_id)).toMatchObject({ ok: true, applied: true });
      expect(nodeIn(w.graph(), 'total_hours')).toEqual(nodeIn(theirs, 'total_hours'));
    });

    it('SAME CORRECTION: an edit that only retires words about Olumi\'s figure never keeps it live; one that gives a figure decides it', async () => {
      const FIX = 'Scrap the night shift figure, I do not know it; the total was only ever your guess.';
      const TOTAL = { kind: 'factor' as const, id: 'total_hours', field: 'level' as const };
      const w = await correctionWorld(withTotal(), FIX);
      const card = await w.offer('propose_statement', { correction: { quote: FIX, edits: [edit(NIGHT, NIGHT_SAID, 'retracted', 'the night shift figure is withdrawn'),
        edit(TOTAL, 'the total was only ever your guess', 'historical', 'the total is Olumi\'s guess')] } }) as Rec;
      expect(card, JSON.stringify(card).slice(0, 500)).toMatchObject({ ok: true, mutated: false });
      expect(card.public_label).toContain(LINE);
      expect(card.public_label).not.toContain('The current figure for “Total shift hours”, 100 hours per week, stays as it is.');
      expect(await w.press(card.proposal_id)).toMatchObject({ ok: true, applied: true });
      expect(nodeIn((await w.cold()).body.graph, 'total_hours')).not.toHaveProperty('observed_state');
      const FIX2 = 'Scrap the night shift figure, I do not know it; total shift hours are 100 hours per week.';
      const w2 = await correctionWorld(withTotal(), FIX2);
      const card2 = await w2.offer('propose_statement', { correction: { quote: FIX2, edits: [edit(NIGHT, NIGHT_SAID, 'retracted', 'the night shift figure is withdrawn'),
        edit(TOTAL, 'total shift hours', 'historical', 'total shift hours are 100 hours per week', { value: 100, unit: 'hours per week', span: 'total shift hours are 100 hours per week' })] } }) as Rec;
      expect(card2, JSON.stringify(card2).slice(0, 500)).toMatchObject({ ok: true, mutated: false });
      expect(card2.public_label).not.toContain(LINE);
      expect(await w2.press(card2.proposal_id)).toMatchObject({ ok: true, applied: true });
      expect(nodeIn((await w2.cold()).body.graph, 'total_hours').observed_state).toMatchObject({ raw_value: 100, source: 'user_override' });
    });

    // ⭐ Buddy-A 18:54Z: an exemption comes only from an actual write or a kept figure, never from a replacement the host rejects.
    it('REJECTED FIGURE: night 45 written, day kept as context, a total of 999 not in the words → Olumi\'s old total still goes', async () => {
      const FIX = 'Correction: night shifts take 45 hours per week, not 40; day shifts stay at 60.';
      const TOTAL = { kind: 'factor' as const, id: 'total_hours', field: 'level' as const };
      const before = withTotal();
      const w = await correctionWorld(withTotal(), FIX);
      const card = await w.offer('propose_statement', { correction: { quote: FIX, edits: [
        edit(NIGHT, NIGHT_SAID, 'historical', 'night shifts take 45 hours per week', { value: 45, unit: 'hours per week', span: 'night shifts take 45 hours per week' }),
        { subject: DAY, retirement: { quote: 'day shifts stay at 60', scope: 'part', disposition: 'historical' }, retained: [DAY_SAID], reading_words: 'day shifts stay at 60' },
        edit(TOTAL, 'total', 'historical', 'total shift hours are 999 hours per week', { value: 999, unit: 'hours per week' })] } }) as Rec;
      expect(card, JSON.stringify(card).slice(0, 500)).toMatchObject({ ok: true, mutated: false });
      expect(card.public_label).toContain('I could not confirm that 999 hours per week describes “Total shift hours” in this source, so this card will not save it there.');
      expect(card.public_label).toContain(LINE);
      expect(card.public_label).not.toContain('The current figure for “Total shift hours”, 100 hours per week, stays as it is.');
      expect(await w.press(card.proposal_id)).toMatchObject({ ok: true, applied: true });
      for (const g of [w.writes[0]!.graph, (await w.cold()).body.graph]) {
        expect(nodeIn(g, 'total_hours')).not.toHaveProperty('observed_state');
        expect(nodeIn(g, 'night_hours').observed_state).toMatchObject({ raw_value: 45, source: 'user_override' });
        expect(nodeIn(g, 'day_hours').observed_state).toEqual(nodeIn(before, 'day_hours').observed_state);
      }
    });

    it('CONTRAST: a total the user explicitly keeps (a kept figure of theirs) is not withdrawn as a dependent', async () => {
      const KEPT = 'We run 100 hours per week in total.';
      const TOTAL = { kind: 'factor' as const, id: 'total_hours', field: 'level' as const };
      const g = withTotal();
      nodeIn(g, 'total_hours').user_statements = [userStatementRecord(TOTAL, [{ speaker: 'user', quote: KEPT, source: KEPT, form: 'point', low: 100, high: 100,
        unit: 'hours per week', reading: 'olumi', subject: { quantity: 'level', node_id: 'total_hours' } }], '2026-10-10T09:00:00.000Z', { recorded_by: 'construction' })];
      const FIX = 'Correction: night shifts take 45 hours per week, not 40; keep the 100 hours per week in total.';
      const w = await correctionWorld(g, FIX);
      const card = await w.offer('propose_statement', { correction: { quote: FIX, edits: [
        edit(NIGHT, NIGHT_SAID, 'historical', 'night shifts take 45 hours per week', { value: 45, unit: 'hours per week', span: 'night shifts take 45 hours per week' }),
        { subject: TOTAL, retirement: { quote: 'not 40', scope: 'part', disposition: 'historical' }, retained: [KEPT], reading_words: 'keep the total' }] } }) as Rec;
      expect(card, JSON.stringify(card).slice(0, 500)).toMatchObject({ ok: true, mutated: false });
      expect(card.public_label).not.toContain(LINE);
      expect(await w.press(card.proposal_id)).toMatchObject({ ok: true, applied: true });
      expect(nodeIn((await w.cold()).body.graph, 'total_hours').observed_state).toMatchObject({ raw_value: 100 });
    });

    // ⭐ Buddy-A 19:08Z: kept qualitative words beside an UNKEPT figure, or kept words the record does not hold, decide no level.
    it.each([['qualitative words of the figure\'s own statement', 'mostly on nights'], ['words the record does not hold', 'the total we agreed']] as const)(
      'KEPT TEXT IS NOT A KEPT FIGURE (%s): Olumi\'s old total still goes', async (_kind, span) => {
        const SAID = 'We run 100 hours per week in total, mostly on nights.';
        const TOTAL = { kind: 'factor' as const, id: 'total_hours', field: 'level' as const };
        const g = withTotal();
        nodeIn(g, 'total_hours').user_statements = [userStatementRecord(TOTAL, [{ speaker: 'user', quote: SAID, source: SAID, form: 'point', low: 100, high: 100,
          unit: 'hours per week', reading: 'olumi', subject: { quantity: 'level', node_id: 'total_hours' } }], '2026-10-10T09:00:00.000Z', { recorded_by: 'construction' })];
        const FIX = `Correction: night shifts take 45 hours per week, not 40; keep ${span}.`;
        const w = await correctionWorld(g, FIX);
        const card = await w.offer('propose_statement', { correction: { quote: FIX, edits: [
          edit(NIGHT, NIGHT_SAID, 'historical', 'night shifts take 45 hours per week', { value: 45, unit: 'hours per week', span: 'night shifts take 45 hours per week' }),
          { subject: TOTAL, retirement: { quote: 'not 40', scope: 'part', disposition: 'historical' }, retained: [span], reading_words: 'keep the wording' }] } }) as Rec;
        expect(card, JSON.stringify(card).slice(0, 500)).toMatchObject({ ok: true, mutated: false });
        expect(card.public_label).toContain(LINE);
        expect(await w.press(card.proposal_id)).toMatchObject({ ok: true, applied: true });
        expect(nodeIn((await w.cold()).body.graph, 'total_hours')).not.toHaveProperty('observed_state');
      });

    // ⭐ Buddy-A 19:29Z: a kept figure exempts only when it IS the operative level (same figure, unit AND period), never 100/month for 100/week.
    it('KEPT FIGURE OF ANOTHER PERIOD: keeping "100 hours per month" never exempts Olumi\'s weekly 100 worked out from night', async () => {
      const KEPT = 'We ran 100 hours per month in total.';
      const TOTAL = { kind: 'factor' as const, id: 'total_hours', field: 'level' as const };
      const g = withTotal();
      nodeIn(g, 'total_hours').user_statements = [userStatementRecord(TOTAL, [{ speaker: 'user', quote: KEPT, source: KEPT, form: 'point', low: 100, high: 100,
        unit: 'hours per month', reading: 'olumi', subject: { quantity: 'level', node_id: 'total_hours' } }], '2026-10-10T09:00:00.000Z', { recorded_by: 'construction' })];
      const FIX = 'Correction: night shifts take 45 hours per week, not 40; keep the 100 hours per month in total.';
      const w = await correctionWorld(g, FIX);
      const card = await w.offer('propose_statement', { correction: { quote: FIX, edits: [
        edit(NIGHT, NIGHT_SAID, 'historical', 'night shifts take 45 hours per week', { value: 45, unit: 'hours per week', span: 'night shifts take 45 hours per week' }),
        { subject: TOTAL, retirement: { quote: 'not 40', scope: 'part', disposition: 'historical' }, retained: [KEPT], reading_words: 'keep the monthly total' }] } }) as Rec;
      expect(card, JSON.stringify(card).slice(0, 500)).toMatchObject({ ok: true, mutated: false });
      expect(card.public_label).toContain(LINE);
      expect(await w.press(card.proposal_id)).toMatchObject({ ok: true, applied: true });
      expect(nodeIn((await w.cold()).body.graph, 'total_hours')).not.toHaveProperty('observed_state');
      expect(claimRecordFor(w.graph(), TOTAL)!.statements).toContainEqual(expect.objectContaining({ quote: KEPT, low: 100, unit: 'hours per month' }));
    });

    it('STALE: Olumi\'s worked-out figure changed after the card → nothing written (node_changed)', async () => {
      const FIX = 'Correction: night shifts take 45 hours per week, not 40.';
      const w = await correctionWorld(withTotal(), FIX);
      const card = await w.offer('propose_statement', { correction: { quote: FIX, edits: [edit(NIGHT, NIGHT_SAID, 'retracted',
        'night shifts take 45 hours per week', { value: 45, unit: 'hours per week', span: 'night shifts take 45 hours per week' })] } }) as Rec;
      nodeIn(w.graph(), 'total_hours').observed_state.raw_value = 99;
      expect(await w.press(card.proposal_id)).toMatchObject({ ok: false });
      expect(w.writes).toHaveLength(0);
    });
  });

  describe('RETAIN BY IDENTITY (Buddy-A trap): one earlier statement holds both kept and withdrawn words', () => {
    const BUNDLED = 'We staff 40 hours per week of night shifts, two of them already covered by agency staff.';
    const bundled = (): Rec => {
      const g = shifts();
      g.nodes[1].user_statements = [userStatementRecord(NIGHT, [{ speaker: 'user', quote: BUNDLED, source: BUNDLED, form: 'point', low: 40, high: 40,
        unit: 'hours per week', conditions: 'two of them already covered by agency staff', reading: 'olumi', subject: { quantity: 'level', node_id: 'night_hours' } }],
      '2026-10-10T09:00:00.000Z', { recorded_by: 'construction' })];
      return g;
    };
    const part = (retired: string, kept: string): Rec => ({ subject: NIGHT, retirement: { quote: retired, scope: 'part', disposition: 'retracted' },
      retained: [kept], reading_words: 'the corrected night shift account' });

    it('KEEP THE FIGURE, WITHDRAW THE CONDITION: the figure, unit and source stay current and the level is untouched; the wrong condition is not copied', async () => {
      const FIX = 'None of the night hours are covered by agency staff; keep the 40 hours per week.';
      const before = bundled();
      const w = await correctionWorld(bundled(), FIX);
      const card = await w.offer('propose_statement', { correction: { quote: FIX, edits: [part('two of them already covered by agency staff',
        'We staff 40 hours per week of night shifts')] } }) as Rec;
      expect(card, JSON.stringify(card).slice(0, 500)).toMatchObject({ ok: true, mutated: false });
      expect(await w.press(card.proposal_id)).toMatchObject({ ok: true, applied: true });
      for (const g of [w.graph(), (await w.cold()).body.graph]) {
        const record = claimRecordFor(g, NIGHT)!;
        const kept = record.statements.find((st) => st.quote === BUNDLED)!;
        expect(kept).toMatchObject({ form: 'point', low: 40, high: 40, unit: 'hours per week', speaker: 'user' });
        expect(kept).not.toHaveProperty('conditions');
        expect(record.statements.some((st) => st.conditions !== undefined)).toBe(false);
        // Nothing lost: the whole earlier claim, condition included, is history.
        expect(record.history).toContainEqual(expect.objectContaining({ quote: BUNDLED, conditions: 'two of them already covered by agency staff', status: 'superseded' }));
        expect(nodeIn(g, 'night_hours').observed_state).toEqual(nodeIn(before, 'night_hours').observed_state);
      }
    });

    it('WITHDRAW THE FIGURE, KEEP THE REST: the kept words never keep the withdrawn figure live, and no zero is invented', async () => {
      const FIX = 'Forget the 40 hours, I do not know the weekly figure; the agency part stands.';
      const w = await correctionWorld(bundled(), FIX);
      const card = await w.offer('propose_statement', { correction: { quote: FIX, edits: [part('We staff 40 hours per week',
        'two of them already covered by agency staff')] } }) as Rec;
      expect(card, JSON.stringify(card).slice(0, 500)).toMatchObject({ ok: true, mutated: false });
      expect(card.public_label).toContain('If you approve, “Night shift hours” will no longer use 40 hours per week, because this correction removes the source it rests on. It will have no current figure until one is given.');
      expect(await w.press(card.proposal_id)).toMatchObject({ ok: true, applied: true });
      for (const g of [w.graph(), (await w.cold()).body.graph]) {
        const record = claimRecordFor(g, NIGHT)!;
        expect(record.statements.some((st) => st.low === 40 || st.high === 40)).toBe(false);
        expect(record.statements.find((st) => st.quote === BUNDLED)).toMatchObject({ form: 'describes' });
        expect(nodeIn(g, 'night_hours')).not.toHaveProperty('observed_state');
      }
    });
  });
});

describe('a correction source from an EARLIER message', () => {
  // A correction is what the user says NOW: words held only in an earlier message are never its human source. They are labelled
  // Olumi's proposed reading with the source unverified (the claim door's verifier and the correction's fallback agree on this).
  it('is labelled "source unverified", never "Recorded words — you"', async () => {
    const earlier = 'Tutoring barely moves the pass rate, honestly.';
    const now = 'Please use what I said before about tutoring.';
    const w = await correctionWorld(start(), now);
    Object.assign(w.ctx, { user_text: `${earlier}\n${now}`, verified_user_messages: [earlier, now] });
    const card = await w.offer('propose_statement', correction(earlier)) as Rec;
    expect(card, JSON.stringify(card).slice(0, 600)).toMatchObject({ ok: true, mutated: false });
    expect(card.public_label).toContain(`Olumi’s proposed reading — source unverified: “${earlier}”.`);
    expect(card.public_label).not.toContain('Recorded words — you');
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
    expect(card.public_label).toContain('If you approve, “Late deliveries by the night crew” will no longer use 3 late deliveries per week, because this correction removes the source it rests on. It will have no current figure until one is given.');
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
    expect(card.public_label).not.toContain('will no longer use');
    expect(card.public_label).toContain('3 late deliveries per week stays as stated for “Late deliveries by the night crew”.');
    expect(await w.press(card.proposal_id)).toMatchObject({ ok: true, applied: true });
    expect(w.graph().nodes.find((n: Rec) => n.id === 'late_deliveries').observed_state).toMatchObject({ raw_value: 3 });
  });
});


/**
 * ⭐ LABEL, NOT GATE (verifier R1, outbox/PROMPT-INT-VERDICT-3730912b.md: 9/9 R1 corrections refused `unrelated_correction` on staging
 * when the words named the period differently from the item's label). The AI's chosen item, with its verbatim quote, is accepted:
 * where Olumi's item reader cannot tie the words to the label, the card SAYS the item is Olumi's reading. Never refused for label
 * words. SYNTHETIC words.
 */
describe('LABEL, NOT GATE: a correction naming the period differently from the item\'s label binds to the AI\'s chosen item', () => {
  const ITEM = { kind: 'factor' as const, id: 'late_handovers', field: 'level' as const };
  const SAID = 'We log 6 late handovers per ward week.';
  const graph = (): Rec => ({ nodes: [
    { id: 'goal', kind: 'goal', label: 'Safe handovers goal' },
    { id: 'late_handovers', kind: 'factor', label: 'Late handovers per ward week',
      observed_state: { value: 0.3, raw_value: 6, unit: 'late handovers per week', cap: 20, source: 'brief_extraction' },
      user_statements: [userStatementRecord(ITEM, [{ speaker: 'user', quote: SAID, source: SAID, form: 'point', low: 6, high: 6, unit: 'late handovers per week',
        reading: 'olumi', subject: { quantity: 'level', node_id: 'late_handovers' } }], '2026-10-10T09:00:00.000Z', { recorded_by: 'construction' })] },
  ], edges: [{ from: 'late_handovers', to: 'goal', strength: { mean: -0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'negative' }] });
  const FIX = 'That six was over the last month, not each week.';

  it('card → press → cold read: accepted on the AI\'s item and labelled as Olumi\'s reading; the per-week figure is withdrawn; never `unrelated_correction`', async () => {
    const w = await correctionWorld(graph(), FIX);
    const card = await w.offer('propose_statement', { correction: { quote: FIX, edits: [{ subject: ITEM,
      retirement: { quote: SAID, scope: 'whole', disposition: 'retracted' }, retained: [], reading_words: 'six late handovers over a month' }] } }) as Rec;
    expect(card, JSON.stringify(card).slice(0, 600)).toMatchObject({ ok: true, mutated: false });
    expect(JSON.stringify(card)).not.toContain('unrelated_correction');
    expect(card.public_label).toContain('Olumi’s reading: these words concern “Late handovers per ward week”.');
    expect(card.public_label).toContain('If you approve, “Late handovers per ward week” will no longer use 6 late handovers per week, because this correction removes the source it rests on. It will have no current figure until one is given.');
    const res = await w.press(card.proposal_id) as Rec;
    expect(res, JSON.stringify(res).slice(0, 600)).toMatchObject({ ok: true, applied: true });
    for (const g of [w.writes[0]!.graph, (await w.cold()).body.graph]) {
      const record = claimRecordFor(g, ITEM)!;
      expect(record.statements[0]).toMatchObject({ quote: FIX, subject: { node_id: 'late_handovers' } });
      expect(record.history?.map((st) => [st.low, st.status])).toEqual([[6, 'withdrawn']]);
      expect(g.nodes.find((n: Rec) => n.id === 'late_handovers')).not.toHaveProperty('observed_state');
    }
  });
});

/**
 * ⭐ RE-SCOPE (Codex BLOCK @94b330bd; PL 20:28Z; outbox/GATE-TO-LABEL-DESIGN.md § RE-SCOPE). Each row is RED on 94b330bd. Real path:
 * card → press → register → persisted write → cold read. SYNTHETIC words (adapted from the reviewer's own probes).
 */
describe('RE-SCOPE: one correction authority binds each figure to its quantity and closes every dependent', () => {
  const NIGHT = { kind: 'factor' as const, id: 'night', field: 'level' as const };
  const OLD = 'Night shifts take 40 hours per week.';
  const DAY_OLD = 'Day shifts take 60 hours per week.';
  const level = (id: string, label: string, raw: number, extra: Rec = { source: 'cee_inference', extractionType: 'inferred' }): Rec =>
    ({ id, kind: 'factor', label, observed_state: { value: raw / 200, raw_value: raw, unit: 'hours per week', cap: 200, ...extra } });
  const def = (from: string, to: string): Rec => ({ from, to, strength: { mean: 0.5, std: 0.01 }, exists_probability: 1, effect_direction: 'positive',
    provenance: { source: 'cee_hypothesis', magnitude: 'olumi_estimate', definitional: true } });
  const claimOf = (id: string, quote: string, figure: number): Rec => userStatementRecord({ kind: 'factor', id, field: 'level' }, [{ speaker: 'user', quote, source: quote,
    form: 'point', low: figure, high: figure, unit: 'hours per week', reading: 'olumi', subject: { quantity: 'level', node_id: id } }], '2026-10-10T09:00:00.000Z', { recorded_by: 'construction' });
  const graph = (): Rec => {
    const night = level('night', 'Night shift hours', 40, { source: 'brief_extraction', extractionType: 'explicit' });
    night.user_statements = [claimOf('night', OLD, 40)];
    const day = level('day', 'Day shift hours', 60, { source: 'brief_extraction', extractionType: 'explicit' });
    day.user_statements = [claimOf('day', DAY_OLD, 60)];
    return { nodes: [{ id: 'goal', kind: 'goal', label: 'Coverage goal' }, night, day, level('total', 'Total shift hours', 100), level('remainder', 'Remaining cover hours', 80)],
      edges: [def('night', 'total'), def('total', 'remainder'), { from: 'remainder', to: 'goal', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
        { from: 'day', to: 'goal', strength: { mean: 0.4, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' }] };
  };
  const nodeOf = (g: Rec, id: string): Rec => g.nodes.find((n: Rec) => n.id === id);
  async function run(g: Rec, words: string, edits: Rec[]) {
    const w = await correctionWorld(g, words);
    const card = await w.offer('propose_statement', { correction: { quote: words, edits } }) as Rec;
    expect(card, JSON.stringify(card).slice(0, 600)).toMatchObject({ ok: true, mutated: false });
    const frozen = (w.proposals.get(card.proposal_id)!.operations[0]!.value as Rec).correction as Rec;
    const pressed = await w.press(card.proposal_id) as Rec;
    expect(pressed, JSON.stringify(pressed).slice(0, 600)).toMatchObject({ ok: true, applied: true });
    expect(w.writes).toHaveLength(1);
    const cold = (await w.cold()).body.graph;
    expect(cold.nodes).toEqual(w.writes[0]!.graph.nodes);
    return { card, pressed, g: cold, frozen };
  }
  const nightEdit = (disposition: 'historical' | 'retracted', replacement?: Rec, retained: string[] = []): Rec => ({ subject: NIGHT,
    retirement: { quote: OLD, scope: 'whole', disposition }, retained, reading_words: 'correct the night shift account', ...(replacement === undefined ? {} : { replacement }) });

  it.each([
    ['a span stating another item\'s figure', { value: 70, unit: 'hours per week', span: 'day shifts take 70 hours per week' }],
    ['a span holding two figures', { value: 70, unit: 'hours per week', span: 'night shifts take 45 hours per week, not 40; day shifts take 70 hours per week' }],
    ['no span at all', { value: 70, unit: 'hours per week' }],
  ] as const)('P1-1 ANOTHER QUANTITY (%s): 70 is never written as the night figure', async (_kind, replacement) => {
    const words = 'Correction: night shifts take 45 hours per week, not 40; day shifts take 70 hours per week.';
    const r = await run(graph(), words, [nightEdit('retracted', replacement)]);
    expect(nodeOf(r.g, 'night').observed_state?.raw_value).not.toBe(70);
    expect(String(r.card.public_label)).not.toContain('will become 70 hours per week, your corrected figure');
    expect(claimRecordFor(r.g, NIGHT)!.statements.some((st) => st.low === 70 && saidByOf(st) === 'user' && st.checks === undefined)).toBe(false);
  });

  it('P1-1 CONTRAST: the night figure stated in its own span is written, with that span as the claim\'s quote', async () => {
    const words = 'Correction: night shifts take 45 hours per week, not 40; day shifts take 70 hours per week.';
    const span = 'night shifts take 45 hours per week';
    const r = await run(graph(), words, [nightEdit('retracted', { value: 45, unit: 'hours per week', span })]);
    expect(nodeOf(r.g, 'night').observed_state).toMatchObject({ raw_value: 45, source: 'user_override' });
    expect(claimRecordFor(r.g, NIGHT)!.statements[0]).toMatchObject({ quote: span, form: 'point', low: 45, high: 45, unit: 'hours per week' });
    expect(nodeOf(r.g, 'day').observed_state).toEqual(nodeOf(graph(), 'day').observed_state);
  });

  it('P1-2 TRANSITIVE: night → total → remainder; both Olumi figures go, and the card names both', async () => {
    const words = 'Correction: night shifts take 45 hours per week, not 40.';
    const r = await run(graph(), words, [nightEdit('retracted', { value: 45, unit: 'hours per week', span: 'night shifts take 45 hours per week' })]);
    expect(nodeOf(r.g, 'night').observed_state.raw_value).toBe(45);
    expect(nodeOf(r.g, 'total')).not.toHaveProperty('observed_state');
    expect(nodeOf(r.g, 'remainder')).not.toHaveProperty('observed_state');
    for (const label of ['Total shift hours', 'Remaining cover hours']) {
      expect(r.card.public_label).toContain(`If you approve, the calculation for “${label}” will become unavailable because its inputs have changed.`);
      expect(r.pressed.follow_up).toContain(`The calculation for “${label}” is now unavailable because its inputs have changed.`);
    }
  });

  it('P1-3 ACCEPTED: an accepted Olumi figure worked out from the corrected input goes too (no explicit keep or write of its own)', async () => {
    const g = graph(); nodeOf(g, 'total').observed_state.source = 'user_confirmed';
    const r = await run(g, 'Correction: night shifts take 45 hours per week, not 40.',
      [nightEdit('retracted', { value: 45, unit: 'hours per week', span: 'night shifts take 45 hours per week' })]);
    expect(nodeOf(r.g, 'total')).not.toHaveProperty('observed_state');
    expect(nodeOf(r.g, 'remainder')).not.toHaveProperty('observed_state');
  });

  it('P1-4 HISTORICAL BASIS: moving the old figure to earlier context with nothing kept takes it and its dependents out of current analysis', async () => {
    const r = await run(graph(), 'The 40 night hours were last month; I do not know the current weekly hours.', [nightEdit('historical')]);
    // The card SAYS it before approval (DL-3 decision 1): earlier context for words stating that figure alone withdraws it.
    expect(r.card.public_label).toContain('If you approve, “Night shift hours” will no longer use 40 hours per week, because this correction removes the source it rests on.');
    expect(nodeOf(r.g, 'night')).not.toHaveProperty('observed_state');
    expect(nodeOf(r.g, 'total')).not.toHaveProperty('observed_state');
    expect(nodeOf(r.g, 'remainder')).not.toHaveProperty('observed_state');
    expect(claimRecordFor(r.g, NIGHT)!.history?.map((st) => [st.low, st.status])).toEqual([[40, 'superseded']]);
    // Unaffected human observations stay.
    expect(nodeOf(r.g, 'day')).toEqual(nodeOf(graph(), 'day'));
  });

  it('P1-4 CONTRAST: the same historical edit that explicitly KEEPS the figure leaves it and its dependents current', async () => {
    const r = await run(graph(), 'Keep the 40 hours per week; the rest of that note was last month.', [{ subject: NIGHT,
      retirement: { quote: 'the rest of that note', scope: 'part', disposition: 'historical' }, retained: [OLD], reading_words: 'keep 40 hours per week' }]);
    expect(nodeOf(r.g, 'night').observed_state).toEqual(nodeOf(graph(), 'night').observed_state);
    expect(nodeOf(r.g, 'total').observed_state).toEqual(nodeOf(graph(), 'total').observed_state);
  });

  it.each([
    ['replace', 'Correction: night shifts take 45 hours per week, not 40.', (): Rec[] => [nightEdit('retracted', { value: 45, unit: 'hours per week', span: 'night shifts take 45 hours per week' })]],
    ['retract', 'Scrap the night shift figure, I do not know it.', (): Rec[] => [nightEdit('retracted')]],
    ['historical', 'The 40 night hours were last month.', (): Rec[] => [nightEdit('historical')]],
  ] as const)('COMPLETE POSTIMAGE (%s): every item whose figure the press changes is named on the card, and nothing else changes', async (_kind, words, edits) => {
    const before = graph();
    const r = await run(graph(), words, edits());
    const changed = before.nodes.filter((n: Rec) => !isDeepStrictEqualJson(n.observed_state, nodeOf(r.g, n.id)?.observed_state)).map((n: Rec) => String(n.label));
    expect(changed.length).toBeGreaterThan(0);
    for (const label of changed) expect(r.card.public_label, label).toContain(`“${label}”`);
    // Buddy-A 20:42 §4: by IDENTITY, not label: the ids whose figure changed are exactly the ids the frozen card's actions name.
    const named = (r.frozen.edits as Rec[]).flatMap((e) => (e.dependent?.action === 'level_replaced' || e.dependent?.action === 'level_unavailable'
      ? [e.subject.id, ...(e.dependent.defined ?? []).map((d: Rec) => d.id)] : []));
    expect(new Set(named)).toEqual(new Set(before.nodes.filter((n: Rec) => !isDeepStrictEqualJson(n.observed_state, nodeOf(r.g, n.id)?.observed_state)).map((n: Rec) => n.id)));
    expect(r.g.edges).toEqual(before.edges);
  });
  /**
   * ⭐ ROUND 2 (Codex @6e0fbc04 findings 1–3; Buddy-A 20:42 §1–§3; DL-3 strict fail-safe defaults). Each row is RED on 6e0fbc04.
   */
  const UNIT = 'hours per week';
  const TWO = 'Correction: night shifts take 45 hours per week, not 40; day shifts take 70 hours per week.';
  const withoutDay = (g: Rec): Rec => ({ ...g, nodes: g.nodes.filter((n: Rec) => n.id !== 'day'), edges: g.edges.filter((x: Rec) => x.from !== 'day') });
  it.each([
    ['a span cropped from another item’s clause', TWO, '70 hours per week', 70, true,
      'The source gives 70 hours per week for “Day shift hours”, so this card will not use it for “Night shift hours”.'],
    ['another item the model does not hold', TWO, 'day shifts take 70 hours per week', 70, false,
      'I could not confirm that 70 hours per week describes “Night shift hours” in this source, so this card will not save it there.'],
    // Codex round 2's own graph: no other label shares "shift", so "day shifts" reads as the night item's words; the line then gives
    // the night item two figures, a contradiction, never permission.
    ['an absent subject whose head word is this item’s', TWO, 'day shifts take 70 hours per week', 70, 'relabelled',
      'I could not confirm that 70 hours per week describes “Night shift hours” in this source, so this card will not save it there.'],
    ['another item named, the line’s only figure', 'Correction: day shifts take 70 hours per week.', 'day shifts take 70 hours per week', 70, true,
      'The source gives 70 hours per week for “Day shift hours”, so this card will not use it for “Night shift hours”.'],
    ['an unnamed figure among several', 'Correction: 45 hours per week, and 12 hours per week of agency cover.', '45 hours per week', 45, true,
      'I could not confirm that 45 hours per week describes “Night shift hours” in this source, so this card will not save it there.'],
    // 8b builder → DL-3 (R3, in-subject wrong-author path): a figure inside ANOTHER speaker's quotation is that speaker's, never the
    // user's replacement; the claim verifier's own speech reading of the whole line decides (no new matcher).
    ['another speaker’s quoted words (digits, typographic marks)', 'Correction: our matron said “night shifts take 45 hours per week”, not 40.',
      'night shifts take 45 hours per week', 45, true, 'I could not confirm that 45 hours per week describes “Night shift hours” in this source, so this card will not save it there.'],
    ['another speaker’s quoted words (digits, straight marks)', 'Correction: our matron said "night shifts take 45 hours per week", not 40.',
      'night shifts take 45 hours per week', 45, true, 'I could not confirm that 45 hours per week describes “Night shift hours” in this source, so this card will not save it there.'],
    ['another speaker’s quoted words (a count in words)', 'Correction: our matron said “night shifts take forty-five hours per week”, not 40.',
      'night shifts take forty-five hours per week', 45, true, 'I could not confirm that 45 hours per week describes “Night shift hours” in this source, so this card will not save it there.'],
    ['a denied figure', 'Night shifts do not take 45 hours per week.', 'Night shifts do not take 45 hours per week', 45, true,
      'I could not confirm that 45 hours per week describes “Night shift hours” in this source, so this card will not save it there.'],
    ['a bound, not a point', 'Night shifts take at least 45 hours per week.', 'Night shifts take at least 45 hours per week', 45, true,
      'I could not confirm that 45 hours per week describes “Night shift hours” in this source, so this card will not save it there.'],
  ] as const)('SPAN READ IN ITS WHOLE SOURCE (%s): never written; the card says why, before approval', async (_kind, words, span, value, day, line) => {
    const relabelled = (g: Rec): Rec => { nodeOf(g, 'total').label = 'Combined cover'; nodeOf(g, 'remainder').label = 'Spare cover'; return g; };
    const r = await run(day === true ? graph() : day === false ? withoutDay(graph()) : relabelled(withoutDay(graph())), words, [nightEdit('retracted', { value, unit: UNIT, span })]);
    expect(nodeOf(r.g, 'night')).not.toHaveProperty('observed_state');
    expect(r.card.public_label).toContain(line);
    expect(claimRecordFor(r.g, NIGHT)!.statements[0]).toMatchObject({ low: value, checks: { figure_found: false } });
  });

  it.each(['Correction: it is 45 hours per week, not 40.', 'Correction: 45 hours per week.'])('LABELLED READING CONTROL (DL-3 21:26Z): an elliptical answer naming no item, the only figure in its line, is written as Olumi’s reading, labelled (“%s”)', async (words) => {
    const r = await run(graph(), words, [nightEdit('retracted', { value: 45, unit: UNIT, span: '45 hours per week' })]);
    expect(nodeOf(r.g, 'night').observed_state).toMatchObject({ raw_value: 45, source: 'user_override' });
    expect(r.card.public_label).toContain('Olumi’s reading: these words concern “Night shift hours”.');
    expect(claimRecordFor(r.g, NIGHT)!.statements[0]).toMatchObject({ quote: '45 hours per week', checks: { subject_bound: false } });
  });

  it.each([
    ['a node with no figure', (g: Rec): void => { delete nodeOf(g, 'total').observed_state; }],
    ['a structural definition', (g: Rec): void => { Object.assign(nodeOf(g, 'total').observed_state, { value: 0, raw_value: 0, extra_share_by_date: {} }); }],
  ] as const)('CLOSURE THROUGH %s: the Olumi figure downstream becomes unavailable; the intermediate stays exactly as it was', async (_kind, shape) => {
    const g = graph(); shape(g);
    const r = await run(g, 'Correction: night shifts take 45 hours per week, not 40.', [nightEdit('retracted', { value: 45, unit: UNIT, span: 'night shifts take 45 hours per week' })]);
    expect(nodeOf(r.g, 'remainder')).not.toHaveProperty('observed_state');
    expect(nodeOf(r.g, 'total')).toEqual(nodeOf(g, 'total'));
    expect(r.card.public_label).toContain('If you approve, the calculation for “Remaining cover hours” will become unavailable because its inputs have changed.');
  });

  it('CLOSURE CONTROL: a figure a person gave is an independent value; it and what rests on it stay', async () => {
    const g = graph(); Object.assign(nodeOf(g, 'total').observed_state, { source: 'brief_extraction', extractionType: 'explicit' });
    const r = await run(g, 'Correction: night shifts take 45 hours per week, not 40.', [nightEdit('retracted', { value: 45, unit: UNIT, span: 'night shifts take 45 hours per week' })]);
    expect(nodeOf(r.g, 'total')).toEqual(nodeOf(g, 'total'));
    expect(nodeOf(r.g, 'remainder')).toEqual(nodeOf(g, 'remainder'));
  });

  it('SAME FIGURE AGAIN: a written replacement equal to the old figure still makes the calculations from it unavailable (no raw-equality skip)', async () => {
    const r = await run(graph(), 'Correction: night shifts take 40 hours per week; the old note was wrong.',
      [nightEdit('retracted', { value: 40, unit: UNIT, span: 'night shifts take 40 hours per week' })]);
    expect(nodeOf(r.g, 'night').observed_state).toMatchObject({ raw_value: 40, source: 'user_override' });
    expect(nodeOf(r.g, 'total')).not.toHaveProperty('observed_state');
    expect(nodeOf(r.g, 'remainder')).not.toHaveProperty('observed_state');
  });

  it('ONE LINE PER CALCULATION: two corrected inputs of one calculation name it once on the card', async () => {
    const g = graph(); g.edges.push(def('day', 'total'));
    const r = await run(g, 'Correction: night shifts take 45 hours per week; day shifts take 70 hours per week.', [
      nightEdit('retracted', { value: 45, unit: UNIT, span: 'night shifts take 45 hours per week' }),
      { subject: { ...NIGHT, id: 'day' }, retirement: { quote: DAY_OLD, scope: 'whole', disposition: 'retracted' }, retained: [], reading_words: 'correct the day shift account',
        replacement: { value: 70, unit: UNIT, span: 'day shifts take 70 hours per week' } }]);
    expect(nodeOf(r.g, 'day').observed_state.raw_value).toBe(70);
    expect(String(r.card.public_label).split('“Total shift hours”').length - 1).toBe(1);
    expect(nodeOf(r.g, 'total')).not.toHaveProperty('observed_state');
  });

  describe('DEFAULT KEEP (DL-3 decision 1): a figure the user gave stays unless the correction says so of THAT figure', () => {
    const BUNDLE = 'Available time is 60 hours per week; 2 hours of it are already used.';
    const AVAIL = { kind: 'factor' as const, id: 'avail', field: 'level' as const }, USED = { ...AVAIL, id: 'used' };
    const bundled = (): Rec => {
      const avail = level('avail', 'Available time', 60, { source: 'brief_extraction', extractionType: 'explicit' });
      avail.user_statements = [claimOf('avail', BUNDLE, 60)];
      const used = level('used', 'Used time', 2);
      used.user_statements = [claimOf('used', BUNDLE, 2)];
      return { nodes: [{ id: 'goal', kind: 'goal', label: 'Coverage goal' }, avail, used, level('remain', 'Remaining time', 58)],
        edges: [def('avail', 'remain'), def('used', 'remain'), { from: 'remain', to: 'goal', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' }] };
    };
    const earlier = (subject: Rec, reading: string): Rec => ({ subject, retirement: { quote: BUNDLE, scope: 'whole', disposition: 'historical' }, retained: [], reading_words: reading });

    it('R07 SHAPE, ORIGINAL ARGUMENTS: a sentence stating two figures moved to earlier context keeps the user’s 60; Olumi’s 2 and 58 go; the card says so', async () => {
      const r = await run(bundled(), 'The 2 used hours were last week, not this week; the 60 hours stay as this week’s available time.',
        [earlier(AVAIL, 'keep 60 hours as available time'), earlier(USED, 'the 2 hours were last week')]);
      expect(nodeOf(r.g, 'avail')).toMatchObject({ observed_state: nodeOf(bundled(), 'avail').observed_state });
      expect(r.card.public_label).toContain('60 hours per week stays as stated for “Available time”. If it no longer holds, say so.');
      expect(nodeOf(r.g, 'used')).not.toHaveProperty('observed_state');
      expect(nodeOf(r.g, 'remain')).not.toHaveProperty('observed_state');
      expect(r.card.public_label).toContain('If you approve, “Used time” will no longer use 2 hours per week, because this correction removes the source it rests on.');
    });

    it('DESCRIBES ONLY: earlier context for words stating no figure keeps the user’s figure, and says so', async () => {
      const g = graph(); nodeOf(g, 'night').user_statements = [claimOf('night', 'Night shifts take 40 hours per week, as the rota says.', 40)];
      const r = await run(g, 'The rota part was last month.', [{ subject: NIGHT, retirement: { quote: 'as the rota says', scope: 'whole', disposition: 'historical' },
        retained: [], reading_words: 'the rota reference is earlier context' }]);
      expect(nodeOf(r.g, 'night').observed_state).toEqual(nodeOf(g, 'night').observed_state);
      expect(r.card.public_label).toContain('40 hours per week stays as stated for “Night shift hours”. If it no longer holds, say so.');
      expect(nodeOf(r.g, 'total').observed_state).toEqual(nodeOf(g, 'total').observed_state);
    });

    it('NOT A BLANKET EXEMPTION: a retraction of the same bundled sentence withdraws the user’s 60 (explicit), and Olumi’s figure is never kept by default', async () => {
      const r = await run(bundled(), 'Scrap that whole sentence about available and used time.',
        [{ ...earlier(AVAIL, 'withdrawn'), retirement: { quote: BUNDLE, scope: 'whole', disposition: 'retracted' } }]);
      expect(nodeOf(r.g, 'avail')).not.toHaveProperty('observed_state');
      expect(nodeOf(r.g, 'remain')).not.toHaveProperty('observed_state');
    });
  });

  // ⭐ R07 FIRST LOSS (real-AI replay on 94b330bd: `propose_statement` refused `node_changed` at the offer). The AI attached a legacy
  // dependency expectation to an item that holds no such carrier. That is a label (words Olumi could not find), never a stale refusal.
  it('R07 SHAPE: a legacy expectation on a carrier the item does not hold is labelled, not refused; the rest of the correction lands', async () => {
    const words = 'Correction: night shifts take 45 hours per week, not 40.';
    const r = await run(graph(), words, [{ ...nightEdit('retracted', { value: 45, unit: 'hours per week', span: 'night shifts take 45 hours per week' }),
      legacy: { field: 'dependency', expected: '58', replacement: null } }]);
    expect(r.card.public_label).toContain('Olumi could not find “58” in the recorded source');
    expect(nodeOf(r.g, 'night').observed_state).toMatchObject({ raw_value: 45, source: 'user_override' });
    expect(nodeOf(r.g, 'night')).not.toHaveProperty('draft_widening');
  });

  it('R07 CONTRAST: a legacy carrier the item DOES hold with other words is still stale (node_changed), nothing written', async () => {
    const g = graph(); nodeOf(g, 'night').draft_widening = { relies_on: 'the rota spreadsheet' };
    const words = 'Correction: night shifts take 45 hours per week, not 40.';
    const w = await correctionWorld(g, words);
    const card = await w.offer('propose_statement', { correction: { quote: words, edits: [{ ...nightEdit('retracted'),
      legacy: { field: 'dependency', expected: 'the staffing plan', replacement: null } }] } }) as Rec;
    expect(card).toMatchObject({ ok: false, refusal: 'node_changed' });
    expect(w.writes).toHaveLength(0);
  });
});

const isDeepStrictEqualJson = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
