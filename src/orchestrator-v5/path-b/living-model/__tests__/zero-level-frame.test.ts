/**
 * DL lease 22 Oct (served scenario eb481e4a, "Client delivery delay": 0 weeks, Olumi's estimate, range 0 to 8). A factor
 * whose every level is 0 had no frame (`capFor` returned undefined at top 0 unless '%' or unitless [0,1]), so its level was
 * held and its card read "Value not set yet". Its frame is now the stated range's top if positive, else 1. A level of 0
 * reads 0 on any frame and a link scales by the frame, so no figure moves.
 */
import { describe, expect, it } from 'vitest';
import type { LivingModelT } from '../../../../schemas/living-model.js';
import { mapLivingModel } from '../mapper.js';
import { KNOWN_ANSWER } from './fixtures.js';

type Rec = Record<string, any>;
const node = (g: { nodes: Record<string, unknown>[] }, id: string) => g.nodes.find((n) => n.id === id) as Rec;
const edge = (g: { edges: Record<string, unknown>[] }, from: string) => g.edges.find((e) => e.from === from && e.to === 'g') as Rec | undefined;

/** The known answer plus a factor no option sets: Olumi's estimate of `value` weeks, with the stated range, linked to the goal. */
function withDelay(value: number, low: number | null, high: number | null, unit: string | null = 'weeks'): LivingModelT {
  const m: LivingModelT = structuredClone(KNOWN_ANSWER);
  m.factors.push({ estimate_by: 'olumi', kind: 'factor', limit: null, id: 'delay', label: 'Client delivery delay', value, low, high, unit,
    defined_as: null, source: 'olumi', party: null, quote: null });
  m.links.push({ id: 'delay_g', from: 'delay', to: 'g', source: 'olumi', party: null, quote: null,
    effect: { estimate_by: 'olumi', form: 'normal', value: -5, sd: 2, low: null, high: null, unit: 'units', sign: '-' } });
  return m;
}

describe('a factor whose every level is 0 gets a frame, so its level is a fact, not "not set yet"', () => {
  it('the served shape (0 weeks, range 0 to 8, Olumi\'s estimate) reads 0 on the range\'s top, and its link reaches the engine', () => {
    const { graph, withheld } = mapLivingModel(withDelay(0, 0, 8));
    expect(node(graph, 'delay').observed_state).toMatchObject({ value: 0, raw_value: 0, cap: 8, unit: 'weeks', source: 'cee_inference' });
    expect(withheld.filter((w) => w.id === 'delay' || w.id === 'delay_g')).toEqual([]);
    // The link is sized from its own stated effect (−5 units per week), never Olumi's placeholder (Codex r1).
    expect(edge(graph, 'delay')!.provenance).toMatchObject({ magnitude: 'olumi_estimate',
      natural_effect: { amount: -5, amount_unit: 'units', per_source_change: 1, per_source_change_unit: 'weeks' } });
    // No spread is sent with the level, so served PLoT (b60fe4fb, translator-v3 priority 4b) holds a zero that no option moves
    // at exactly 0 and names it: the frame never becomes a spread (Codex r1 read the stale FALLBACK_STD = 0.5 of the frame).
    expect(node(graph, 'delay').observed_state).not.toHaveProperty('std');
  });

  it('with no stated range the frame is 1, and the level still reads 0', () => {
    const { graph, withheld } = mapLivingModel(withDelay(0, null, null));
    expect(node(graph, 'delay').observed_state).toMatchObject({ value: 0, raw_value: 0, cap: 1 });
    expect(withheld.filter((w) => w.id === 'delay')).toEqual([]);
  });

  it('the frame does not move a figure: on a doubled range the link doubles, so each raw week does the same', () => {
    const on8 = edge(mapLivingModel(withDelay(0, 0, 8)).graph, 'delay')!;
    const on16 = edge(mapLivingModel(withDelay(0, 0, 16)).graph, 'delay')!;
    expect(on16.strength.mean).toBeCloseTo(2 * on8.strength.mean, 10);
    expect(on16.strength.std).toBeCloseTo(2 * on8.strength.std, 10);
  });

  it('invariance: a factor with a level above 0 keeps its frame (headroom), whatever its range says', () => {
    const at4 = mapLivingModel(withDelay(4, 0, 8));
    expect(node(at4.graph, 'delay').observed_state).toMatchObject({ raw_value: 4, cap: 5 });
    expect(mapLivingModel(withDelay(4, 0, 64)).graph).toEqual(at4.graph);
    // The known answer's own unitless factor keeps its frame of 1.
    expect(node(mapLivingModel(KNOWN_ANSWER).graph, 'f').observed_state).toMatchObject({ raw_value: 0.5, cap: 1 });
  });

  it('control: an all-zero percentage keeps its frame of 100', () => {
    expect(node(mapLivingModel(withDelay(0, 0, 8, '%')).graph, 'delay').observed_state).toMatchObject({ value: 0, raw_value: 0, cap: 100 });
  });
});

/**
 * Hiring's shape (served 79c1e150-b, DL 22 Oct): Olumi's £0 "additional spend", raised only by the options' own links (Olumi's
 * estimates), with the person's own "Our budget is £200,000" on it. On the frame of 1 the budget was held (limit_not_in_slice).
 */
function withSpend(opts: { limit?: boolean; factorLink?: boolean; level?: number } = {}): LivingModelT {
  const m: LivingModelT = structuredClone(KNOWN_ANSWER);
  m.factors.push({ estimate_by: null, kind: 'factor', id: 'spend', label: 'Additional spend', value: opts.level ?? 0, low: 0, high: 0, unit: '£',
    defined_as: null, source: 'olumi', party: null, quote: null,
    limit: opts.limit === false ? null : { comparator: '<=', value: 200000, source: 'user', party: null, quote: 'Our budget is £200,000' } });
  const spend = (from: string, value: number, low: number, high: number) => ({ id: `${from}_spend`, from, to: 'spend', source: 'olumi' as const, party: null,
    quote: null, effect: { estimate_by: null, form: 'range' as const, value, low, high, sd: null, unit: '£', sign: '+' as const } });
  m.links.push(spend('push', 40000, 20000, 80000), spend('hold', 50000, 25000, 100000));
  if (opts.factorLink === true) m.links.push({ ...spend('f', 1000, 500, 2000), id: 'f_spend' });
  return m;
}
const into = (g: { edges: Record<string, unknown>[] }, from: string, to: string) => g.edges.find((e) => e.from === from && e.to === to) as Rec;

describe('DL 22 Oct: a factor at 0 that only the options move is framed by what they move it to, so the person\'s limit on it is evaluated', () => {
  it('hiring\'s shape: the budget is evaluated against £200,000 in natural £, and each option\'s spend keeps its own amount', () => {
    const { graph, withheld } = mapLivingModel(withSpend()) as { graph: Rec; withheld: { id: string }[] };
    // The largest of each option's total from its links' upper amounts (80,000; 100,000) and the limit (200,000), through capFor.
    expect(node(graph, 'spend').observed_state).toMatchObject({ value: 0, raw_value: 0, cap: 250000, unit: '£' });
    expect(withheld.filter((w) => w.id === 'spend')).toEqual([]);
    expect(graph.goal_constraints).toEqual([expect.objectContaining({ constraint_id: 'limit_spend', node_id: 'spend', operator: '<=', value: 200000,
      unit: '£', value_frame: 'level', provenance: 'explicit', source_quote: 'Our budget is £200,000' })]);
    for (const [option, amount] of [['push', 40000], ['hold', 50000]] as const) {
      const e = into(graph, `${option}__on`, 'spend');
      expect(e.strength.mean * 250000, `${option}'s spend in £`).toBeCloseTo(amount, 6);
    }
    // Without a limit the options' own reach frames it: the larger total (100,000) through capFor.
    expect(node(mapLivingModel(withSpend({ limit: false })).graph, 'spend').observed_state).toMatchObject({ cap: 125000 });
  });

  it('invariance: a factor at 0 that a factor also moves, or one with a level above 0, keeps its frame; the limit off it stays held', () => {
    const mixed = mapLivingModel(withSpend({ factorLink: true }));
    expect(node(mixed.graph, 'spend').observed_state).toMatchObject({ raw_value: 0, cap: 1 });
    expect(mixed.withheld).toContainEqual({ id: 'spend', reason: 'limit_not_in_slice' });
    const above = mapLivingModel(withSpend({ level: 1000, limit: false }));
    expect(node(above.graph, 'spend').observed_state).toMatchObject({ raw_value: 1000, cap: 1250 });
  });
});

