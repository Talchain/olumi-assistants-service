import { describe, expect, it } from 'vitest';
import type { LivingModelT } from '../../../../schemas/living-model.js';
import { mapLivingModel } from '../mapper.js';
import { KNOWN_ANSWER } from './fixtures.js';

/**
 * Two links between the same two items (Track Q2-06 on 7b0af1a9: discount → retained revenue +0.5 and −0.5) made the engine
 * refuse every Run. The mapper never sends a pair twice: both links stay in the living model, withheld by name, and the chance
 * that rests on them is withheld; a single link between the same items is unchanged.
 */
describe('parallel links between the same two items', () => {
  const second = { ...KNOWN_ANSWER.links[0]!, id: 'f_g_loss', quote: 'it also costs us 20 units', effect: { ...KNOWN_ANSWER.links[0]!.effect, value: 20, sd: 5, sign: '-' as const } };
  const parallel: LivingModelT = { ...KNOWN_ANSWER, links: [...KNOWN_ANSWER.links, second] };

  it('sends no pair twice, withholds both links by name and the chance resting on them', () => {
    const { graph, withheld } = mapLivingModel(parallel);
    const pairs = graph.edges.map((e) => `${String(e['from'])}>${String(e['to'])}`);
    expect(new Set(pairs).size).toBe(pairs.length);
    expect(graph.edges.some((e) => e['from'] === 'f' && e['to'] === 'g')).toBe(false);
    expect(withheld).toEqual(expect.arrayContaining([{ id: 'f_g', reason: 'link_parallel_same_pair' }, { id: 'f_g_loss', reason: 'link_parallel_same_pair' },
      { id: 'g', reason: 'chance_rests_on_withheld' }]));
  });

  it('CONTRAST: one link between the same items is sent as before, with nothing withheld for it', () => {
    const { graph, withheld } = mapLivingModel(KNOWN_ANSWER);
    expect(graph.edges.filter((e) => e['from'] === 'f' && e['to'] === 'g')).toHaveLength(1);
    expect(withheld.some((w) => w.reason === 'link_parallel_same_pair' || w.reason === 'chance_rests_on_withheld')).toBe(false);
  });
});
