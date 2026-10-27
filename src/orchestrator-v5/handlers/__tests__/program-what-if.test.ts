/**
 * HC5 (Paul D10: A): a what-if on a MODEL PROGRAM, on the same draws, nothing saved. The real handler (`runWhatIf`) on a real
 * saved program graph (the club), CEE's own engine end to end: no PLoT, no provider call, no write (only `loadSaved`).
 *
 * The club, by hand: carry on reaches 300 + 3 × (20 − 10) = 330, short of 340 in every draw (0%, exact); the promotion adds
 * Olumi's 3 to 7 a month (W10: median 5, sd 2 / 1.2816 = 1.5606), so it reaches 340 where the effect is at least 10/3:
 * Φ((5 − 3.333) / 1.5606) = Φ(1.068) ≈ 86%. Base joins at 24 instead of 20: carry on reaches 342 in every draw (100%, exact),
 * and the promotion needs an effect of at least −2/3, Φ(3.63) > 99.9%.
 */
import { describe, expect, it } from 'vitest';
import { runWhatIf, VARIATION_WORDS } from '../what-if-run.js';
import { programRevisionOf } from '../../model-program-turn/program-card.js';
import { seedOf } from '../../model-program-turn/evaluate.js';
import { livingModelOf, MODEL_PROGRAM } from '../../model-program-turn/program-store.js';
import { club, CLUB_BRIEF } from '../../model-program-turn/__tests__/bakery.fixture.js';

type Rec = Record<string, any>;
const SCENARIO = '7d7bbf8f-578c-4843-8636-7e3df07c1063';
const graph = (): Rec => ({ nodes: [], edges: [], living_model: livingModelOf({ model_program: MODEL_PROGRAM, canonical: club(), seed: seedOf(SCENARIO), person_words: [CLUB_BRIEF], runs: [] }) });
const payload = { kind: 'message', scenario_id: SCENARIO, turn_id: 't1', stage: 'analyse', turn_class: 'decide', source: 'composer', message: '' } as never;
const joins = (to: number) => ({ kind: 'factor_value_edit', target_id: 'base_joins', raw_value: to, value: to });

async function whatIf(stored: Rec, changes: Rec[], more: { crux?: boolean; baseGraphHash?: string } = {}) {
  let loads = 0;
  const result = await runWhatIf({ payload, requestId: 'r1', changes, crux: more.crux === true, ...(more.baseGraphHash !== undefined ? { baseGraphHash: more.baseGraphHash } : {}) },
    { loadSaved: async () => { loads++; return { graph: stored }; }, run: () => { throw new Error('a program what-if never runs the PLoT variant path'); } });
  return { result: result as Rec, loads };
}
const option = (r: Rec, id: string, variant: number | 'all' = 'all') => r.variants.find((v: Rec) => v.change_index === variant).options.find((o: Rec) => o.option_id === id);

describe('HC5: a what-if on a model program, on the same draws, nothing saved', () => {
  it('a card figure moves each option by its paired gap on the same draws, said beyond ordinary variation; the saved graph is untouched', async () => {
    const stored = graph(), before = structuredClone(stored);
    const { result, loads } = await whatIf(stored, [joins(24)]);
    expect(loads).toBe(1);
    expect(stored).toEqual(before);
    expect(result).toMatchObject({ kind: 'ran', persisted: false, changes_refused: [], changes_applied: [{ index: 0, target: { node_id: 'base_joins' } }] });
    expect(result.variants.map((v: Rec) => [v.change_index, v.paired])).toEqual([['all', true]]);
    const carry = option(result, 'carry_on'), promo = option(result, 'promotion');
    // Carry on: exact on both sides, so the gap is exact, 0 → 1.
    expect([carry.saved.display, carry.what_if.display]).toEqual(['0%', '100%']);
    expect(carry.paired_difference).toEqual({ difference: 1, precision_95: [1, 1] });
    expect(carry.variation).toBe('beyond_ordinary_variation');
    expect(carry.variation_words).toBe(VARIATION_WORDS.beyond_ordinary_variation);
    // The promotion: about 86% → more than 99%, a paired gap of about 14 points clear of 0. It rests on Olumi's estimated
    // effect, so its cells are provisional. So are carry on's: the simulator's dependency authority (`restsOn`) has the effect
    // upstream of it through the switched-off promotion, as the presenter's basis says.
    expect(promo.saved.display).toMatch(/^about 8[4-8]%$/);
    expect(promo.what_if.display).toBe('more than 99%');
    expect(promo.paired_difference.difference).toBeGreaterThan(0.12);
    expect(promo.paired_difference.difference).toBeLessThan(0.16);
    expect(promo.paired_difference.precision_95[0]).toBeGreaterThan(0);
    expect(promo.variation).toBe('beyond_ordinary_variation');
    expect([promo.saved.provisional, promo.what_if.provisional, carry.saved.provisional]).toEqual([true, true, true]);
  });

  it('the same figure as saved changes nothing: a zero gap, not judged; a gesture this model does not take, and a worked-out figure, are refused by name', async () => {
    const same = await whatIf(graph(), [joins(20)]);
    expect(option(same.result, 'promotion').paired_difference.difference).toBe(0);
    expect(option(same.result, 'promotion').variation).toBe('not_judged');
    expect(option(same.result, 'carry_on').paired_difference).toEqual({ difference: 0, precision_95: [0, 0] });
    expect(option(same.result, 'carry_on').variation).toBe('not_judged');
    const mixed = await whatIf(graph(), [{ kind: 'edge_strength_edit', from: 'promo_on', to: 'joins', value: 2 },
      { kind: 'factor_value_edit', target_id: 'members', raw_value: 400 }, joins(24)]);
    expect(mixed.result.changes_refused).toEqual([{ index: 0, reason: 'not_a_figure_on_this_model' },
      { index: 1, reason: expect.any(String), words: '"members" is worked out by its relation; change one of its inputs.' }]);
    expect(mixed.result.changes_applied).toEqual([{ index: 2, target: { node_id: 'base_joins' } }]);
    const none = await whatIf(graph(), [{ kind: 'edge_strength_edit', from: 'promo_on', to: 'joins', value: 2 }]);
    expect(none.result).toMatchObject({ kind: 'refused', reason: 'no_change_applied' });
  });

  it('a real gap on the shared draws that two independent Runs could also show is not called beyond ordinary variation (Codex r1)', async () => {
    // Joins 20 → 20.01: the promotion needs an effect of 3.323 instead of 3.333, a real gap of a few draws in 10,000 (about
    // 0.2 points), clear of 0 on the shared draws, yet well inside 2 × (sd A + sd B) ≈ 2 × 2 × √(0.86 × 0.14 / 10,000) = 1.4 points.
    const { result } = await whatIf(graph(), [joins(20.01)]);
    const promo = option(result, 'promotion');
    expect(promo.paired_difference.difference).toBeGreaterThan(0);
    expect(promo.paired_difference.difference).toBeLessThan(0.005);
    expect(promo.variation).toBe('not_judged');
    expect(promo.variation_words).toBe(VARIATION_WORDS.not_judged);
  });

  it('provisional: a deadline of Olumi\'s makes every cell provisional; the person\'s own, with every figure theirs, none (Codex r1)', async () => {
    const words = `${CLUB_BRIEF} The promotion brings 5 more joins a month.`;
    const theirs = (months: 'person' | 'olumi'): Rec => {
      const m = club();
      m.quantities = m.quantities.map((x) => x.id === 'promo_effect'
        ? { ...x, author: 'person', status: 'known', value: 5, low: null, high: null, range_kind: null, basis: null, quote: 'The promotion brings 5 more joins a month' }
        : x.id === 'months' && months === 'olumi' ? { ...x, author: 'olumi', status: 'estimated', quote: null, basis: 'A quarter is a usual horizon for a membership push.' } : x);
      return { nodes: [], edges: [], living_model: livingModelOf({ model_program: MODEL_PROGRAM, canonical: m, seed: seedOf(SCENARIO), person_words: [words], runs: [] }) };
    };
    const mine = (await whatIf(theirs('person'), [joins(24)])).result, olumis = (await whatIf(theirs('olumi'), [joins(24)])).result;
    const flags = (r: Rec) => ['carry_on', 'promotion'].flatMap((id) => [option(r, id).saved.provisional, option(r, id).what_if.provisional]);
    expect(mine.kind).toBe('ran');
    expect(flags(mine)).toEqual([false, false, false, false]);
    expect(flags(olumis)).toEqual([true, true, true, true]);
    // A limit left out of the Run (its bound unanswered) with a window of Olumi's is not behind any chance (Codex r2).
    const outside = (): Rec => {
      const g = theirs('person'), m = g.living_model.canonical;
      m.quantities = [...m.quantities.map((x: Rec) => (x.id === 'budget' ? { ...x, value: null, quote: null, status: 'asked', question: 'What can you spend?' } : x)),
        { ...m.quantities.find((x: Rec) => x.id === 'months'), id: 'cap_months', author: 'olumi', status: 'estimated', quote: null, basis: 'A quarter.' }];
      m.limits = m.limits.map((l: Rec) => ({ ...l, measure: { ...l.measure, window: { origin_event: null, origin_offset: null, start: 0, periods: 'cap_months' } } }));
      return g;
    };
    const left = (await whatIf(outside(), [joins(24)])).result;
    expect(left.kind).toBe('ran');
    expect(flags(left)).toEqual([false, false, false, false]);
  });

  it('crux: each change is also run alone against the same saved Run', async () => {
    const { result } = await whatIf(graph(), [joins(24), { kind: 'factor_value_edit', target_id: 'leavers', raw_value: 6 }], { crux: true });
    expect(result.variants.map((v: Rec) => v.change_index)).toEqual(['all', 0, 1]);
    // Leavers at 6 alone: carry on reaches 300 + 3 × 14 = 342, so it moves 0 → 1 alone too.
    expect(option(result, 'carry_on', 1).paired_difference).toEqual({ difference: 1, precision_95: [1, 1] });
  });

  it('built on a board that has since changed: stale_base; on the board as saved it runs', async () => {
    const stored = graph();
    expect((await whatIf(stored, [joins(24)], { baseGraphHash: 'not-this-board' })).result).toEqual({ kind: 'refused', reason: 'stale_base' });
    expect((await whatIf(stored, [joins(24)], { baseGraphHash: programRevisionOf(stored)! })).result.kind).toBe('ran');
  });
});
