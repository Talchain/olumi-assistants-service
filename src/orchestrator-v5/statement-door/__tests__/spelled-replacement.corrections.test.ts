/**
 * ⭐ A SPELLED CORRECTED FIGURE IS WRITTEN AS ITS DIGITS ARE (deployed first loss, CEE 7d052e5d: 7/7 live corrections wrote their
 * figures in words, and the host's figure search read digits only). The REPLACEMENT path (`verifiedReplacement`, statements.ts) asks
 * the same question as the correction card: is the corrected figure in the user's own words? `figureTheUserWrote` (stated-by-user.ts)
 * answers it once for both, and a figure written in words counts only WITH its unit word, never more broadly than the same digits.
 * Real path: `propose_statement` (correction with a replacement) → card → press → the real register route → read-back → cold reopen.
 * SYNTHETIC words (two shift factors); never a case text.
 */
import { describe, expect, it } from 'vitest';
import { correctionWorld, type Rec } from '../../agent-lane/__tests__/corrections-stage2-world.js';
import { claimRecordFor, userStatementFor, userStatementRecord } from '../statements.js';

const NIGHT_SAID = 'We staff 40 hours per week of night shifts.';
const DAY_SAID = 'Day shifts take 60 hours per week.';
const NIGHT = { kind: 'factor' as const, id: 'night_hours', field: 'level' as const };
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
const WRITTEN = 'If you approve, the current figure for “Night shift hours” will become 45 hours per week, your corrected figure, in the same change.';
const NOT_FOUND = (said: string) => `Olumi could not find your words stating only ${said} for “Night shift hours”, so it will not be written as the figure for “Night shift hours”.`;

/** One correction through the real door: the AI's reading supplies the replacement; the host decides whether it is the user's figure. */
async function replaced(message: string, reading: string, replacement: { value: number; unit: string; span: string }) {
  const w = await correctionWorld(shifts(), message);
  const card = await w.offer('propose_statement', { correction: { quote: message, edits: [{ subject: NIGHT,
    retirement: { quote: NIGHT_SAID, scope: 'whole', disposition: 'retracted' }, retained: [], reading_words: reading, replacement }] } }) as Rec;
  expect(card, JSON.stringify(card).slice(0, 500)).toMatchObject({ ok: true, mutated: false });
  const res = await w.press(card.proposal_id) as Rec;
  expect(res, JSON.stringify(res).slice(0, 500)).toMatchObject({ ok: true, applied: true });
  const cold = await w.cold();
  expect(cold.status).toBe(200);
  return { w, card, res, cold: cold.body.graph as Rec };
}
/** The postimage with the user's own words masked: everything the correction wrote except which spelling they used. */
const postimage = (g: Rec): Rec => {
  const record = structuredClone(claimRecordFor(g, NIGHT)!) as Rec;
  for (const st of [...record.statements, ...(record.history ?? [])]) {
    if (st.quote !== NIGHT_SAID) { st.quote = '<words>'; st.source = '<words>'; st.qualifier = '<reading in the user\'s spelling>'; }
  }
  delete record.recorded_at;
  return { night: nodeIn(g, 'night_hours').observed_state, day: nodeIn(g, 'day_hours'), record, edges: g.edges };
};

describe('REPLACEMENT: a corrected figure spelled in words is written exactly as its digit twin is', () => {
  const SPELLED = 'Correction: night shifts take forty-five hours per week, not forty.';
  const DIGITS = 'Correction: night shifts take 45 hours per week, not 40.';

  it('RED→GREEN: "forty-five hours per week" → the card writes it, the press writes it, reopen holds it; the same postimage as "45 hours per week"', async () => {
    const spelled = await replaced(SPELLED, 'night shifts take forty-five hours per week',
      { value: 45, unit: 'hours per week', span: 'night shifts take forty-five hours per week' });
    const digits = await replaced(DIGITS, 'night shifts take 45 hours per week', { value: 45, unit: 'hours per week', span: 'night shifts take 45 hours per week' });
    for (const r of [spelled, digits]) {
      expect(r.card.public_label).toContain(WRITTEN);
      expect(r.card.public_label).not.toContain('could not find');
      expect(r.res.follow_up).toContain('“Night shift hours” now has your corrected figure, 45 hours per week.');
      expect(nodeIn(r.w.graph(), 'night_hours').observed_state).toEqual({ value: 0.45, raw_value: 45, unit: 'hours per week', cap: 100, source: 'user_override' });
      expect(claimRecordFor(r.w.graph(), NIGHT)!.statements[0]).toMatchObject({ speaker: 'user', form: 'point', low: 45, high: 45, unit: 'hours per week' });
      expect(claimRecordFor(r.w.graph(), NIGHT)!.statements[0]).not.toHaveProperty('checks');
      expect(userStatementFor(r.w.graph(), NIGHT)?.statements.map((st) => st.low)).toEqual([45]);
      expect(r.w.registers).toHaveLength(1);
    }
    // Same card change line and the same written model; only the user's own spelling differs.
    expect(spelled.card.public_label.split('\n').filter((l: string) => l.includes('current figure')))
      .toEqual(digits.card.public_label.split('\n').filter((l: string) => l.includes('current figure')));
    expect(postimage(spelled.w.graph())).toEqual(postimage(digits.w.graph()));
    expect(postimage(spelled.cold)).toEqual(postimage(digits.cold));
    expect(postimage(spelled.cold)).toEqual(postimage(spelled.w.graph()));
  });

  it('ANOTHER QUANTITY: "forty-five nurses" is no figure of the hours level; 45 hours per week is never written, and the card says so', async () => {
    const FIX = 'Correction: forty-five nurses cover the night shifts, not forty.';
    const { w, card, cold } = await replaced(FIX, 'night shifts take 45 hours per week',
      { value: 45, unit: 'hours per week', span: 'forty-five nurses cover the night shifts' });
    expect(card.public_label).toContain(NOT_FOUND('45 hours per week'));
    expect(card.public_label).not.toContain(WRITTEN);
    for (const g of [w.graph(), cold]) {
      expect(nodeIn(g, 'night_hours').observed_state?.raw_value).not.toBe(45);
      expect(claimRecordFor(g, NIGHT)!.statements[0]).toMatchObject({ low: 45, checks: { figure_found: false, unit_found: false } });
      expect(userStatementFor(g, NIGHT)).toBeUndefined();
    }
  });

  it.each([
    ['ordinal', 'Correction: from the forty-fifth week night shifts change, not forty.', 'from the forty-fifth week night shifts change', 45],
    ['pronoun "one"', 'Correction: one of the night shifts was cut, not forty.', 'one of the night shifts was cut', 1],
    ['counts nothing (no word after it)', 'Correction: night shifts are now forty-five.', 'night shifts are now forty-five', 45],
  ])('NOT THE USER\'S FIGURE OF THE LEVEL (%s): never written as their corrected figure', async (_kind, FIX, span, value) => {
    const { w, card } = await replaced(FIX, 'night shifts change', { value, unit: 'hours per week', span });
    expect(card.public_label).toContain(NOT_FOUND(`${value} hours per week`));
    expect(nodeIn(w.graph(), 'night_hours').observed_state?.raw_value).not.toBe(value);
    expect(claimRecordFor(w.graph(), NIGHT)!.statements[0]).toMatchObject({ checks: { figure_found: false } });
  });
});
