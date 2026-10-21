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
