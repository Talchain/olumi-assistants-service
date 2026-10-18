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
      'night shifts take 45 hours per week', { value: 45, unit: 'hours per week' })] } }) as Rec;
    expect(card, JSON.stringify(card).slice(0, 500)).toMatchObject({ ok: true, mutated: false });
    expect(card.public_label).toContain('The current figure for “Night shift hours” becomes 45 hours per week, your corrected figure, in the same change.');
    expect(card.public_label).not.toContain('is the withdrawn one');
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
      edit(NIGHT, NIGHT_SAID, 'historical', 'night shifts take 45 hours per week', { value: 45, unit: 'hours per week' }),
      edit(DAY, DAY_SAID, 'historical', 'keep the day shifts at 60 hours')] } }) as Rec;
    expect(card, JSON.stringify(card).slice(0, 500)).toMatchObject({ ok: true, mutated: false });
    expect(card.public_label).toContain('The current figure for “Day shift hours” stays as it is.');
    expect(card.public_label).not.toContain('The current figure for “Day shift hours” is the withdrawn one');
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
      'night shifts take 50 hours per week', { value: 50, unit: 'hours per week' })] } }) as Rec;
    expect(card.public_label).toContain('Olumi could not find 50 hours per week in your correction’s own words, so it is not written as the figure for “Night shift hours”.');
    expect(card.public_label).toContain('The current figure for “Night shift hours” is the withdrawn one, so it is withdrawn too');
    expect(await w.press(card.proposal_id)).toMatchObject({ ok: true, applied: true });
    expect(nodeIn(w.graph(), 'night_hours')).not.toHaveProperty('observed_state');
    expect(claimRecordFor(w.graph(), NIGHT)!.statements[0]).toMatchObject({ low: 50, checks: { words_found: true, figure_found: false, unit_found: false } });
    expect(userStatementFor(w.graph(), NIGHT)).toBeUndefined();
  });

  it('INCOMPLETE: a corrected figure in ANOTHER period is kept on the claim, never written over the weekly figure; called incomplete', async () => {
    const FIX = 'Night shifts take 180 hours per month, not 40 a week.';
    const w = await correctionWorld(shifts(), FIX);
    const card = await w.offer('propose_statement', { correction: { quote: FIX, edits: [edit(NIGHT, NIGHT_SAID, 'historical',
      'night shifts take 180 hours per month', { value: 180, unit: 'hours per month' })] } }) as Rec;
    expect(card.public_label).toContain('Your corrected figure for “Night shift hours”, 180 hours per month, is kept with your words, but the model measures “Night shift hours” '
      + 'in hours per week, so this correction is incomplete: the figure it used is withdrawn, and the analysis cannot use a figure for it until one is given in hours per week.');
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
      `night shifts take ${figure} ${unit}`, { value: figure, unit })] } }) as Rec;
    expect(card, JSON.stringify(card).slice(0, 500)).toMatchObject({ ok: true, mutated: false });
    const res = await w.press(card.proposal_id) as Rec;
    expect(res).toMatchObject({ ok: true, applied: true });
    const night = nodeIn((await w.cold()).body.graph, 'night_hours');
    if (outcome === 'written') {
      expect(card.public_label).toContain(`becomes ${figure} ${unit}, your corrected figure`);
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
      'night shifts take 45 hours per week', { value: 45, unit: 'hours per week' })] } }) as Rec;
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
      expect(card.public_label).toContain('The current figure for “Night shift hours” is the withdrawn one, so it is withdrawn too');
      expect(night).not.toHaveProperty('observed_state');
    } else {
      expect(card.public_label).toContain('The current figure for “Night shift hours” stays as it is.');
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
    const LINE = 'Olumi’s figure for “Total shift hours” was worked out from the figure for “Night shift hours”, so it no longer holds and is withdrawn too';

    it.each([['replace', 'retracted', { value: 45, unit: 'hours per week' }], ['retract', 'retracted', undefined]] as const)(
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
        expect(res.follow_up).toContain('“Total shift hours” now has no current figure: Olumi’s figure for it was worked out from the figure you corrected.');
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
      const kept = await keep.offer('propose_statement', { correction: { quote: 'Keep the night shifts at 40 hours per week.', edits: [edit(NIGHT, NIGHT_SAID, 'historical', 'keep 40')] } }) as Rec;
      expect(kept.public_label).not.toContain(LINE);
      expect(await keep.press(kept.proposal_id)).toMatchObject({ ok: true, applied: true });
      expect(nodeIn(keep.graph(), 'total_hours').observed_state).toMatchObject({ raw_value: 100 });
      const FIX = 'Correction: night shifts take 45 hours per week, not 40.';
      const theirs = withTotal({ source: 'brief_extraction', extractionType: 'explicit' });
      const w = await correctionWorld(theirs, FIX);
      const card = await w.offer('propose_statement', { correction: { quote: FIX, edits: [edit(NIGHT, NIGHT_SAID, 'retracted',
        'night shifts take 45 hours per week', { value: 45, unit: 'hours per week' })] } }) as Rec;
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
      expect(card.public_label).not.toContain('The current figure for “Total shift hours” stays as it is.');
      expect(await w.press(card.proposal_id)).toMatchObject({ ok: true, applied: true });
      expect(nodeIn((await w.cold()).body.graph, 'total_hours')).not.toHaveProperty('observed_state');
      const FIX2 = 'Scrap the night shift figure, I do not know it; total shift hours are 100 hours per week.';
      const w2 = await correctionWorld(withTotal(), FIX2);
      const card2 = await w2.offer('propose_statement', { correction: { quote: FIX2, edits: [edit(NIGHT, NIGHT_SAID, 'retracted', 'the night shift figure is withdrawn'),
        edit(TOTAL, 'total shift hours', 'historical', 'total shift hours are 100 hours per week', { value: 100, unit: 'hours per week' })] } }) as Rec;
      expect(card2, JSON.stringify(card2).slice(0, 500)).toMatchObject({ ok: true, mutated: false });
      expect(card2.public_label).not.toContain(LINE);
      expect(await w2.press(card2.proposal_id)).toMatchObject({ ok: true, applied: true });
      expect(nodeIn((await w2.cold()).body.graph, 'total_hours').observed_state).toMatchObject({ raw_value: 100, source: 'user_override' });
    });

    it('STALE: Olumi\'s worked-out figure changed after the card → nothing written (node_changed)', async () => {
      const FIX = 'Correction: night shifts take 45 hours per week, not 40.';
      const w = await correctionWorld(withTotal(), FIX);
      const card = await w.offer('propose_statement', { correction: { quote: FIX, edits: [edit(NIGHT, NIGHT_SAID, 'retracted',
        'night shifts take 45 hours per week', { value: 45, unit: 'hours per week' })] } }) as Rec;
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
      expect(card.public_label).toContain('The current figure for “Night shift hours” is the withdrawn one, so it is withdrawn too');
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

