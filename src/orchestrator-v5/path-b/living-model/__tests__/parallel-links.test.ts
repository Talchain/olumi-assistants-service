import { describe, expect, it } from 'vitest';
import type { LivingModelT } from '../../../../schemas/living-model.js';
import { mapLivingModel } from '../mapper.js';
import { KNOWN_ANSWER } from './fixtures.js';

/**
 * Two links between the same two items (Q2-06 on 7b0af1a9: discount → retained revenue, +0.5 and −0.5): the engine refuses
 * the whole Run without naming them. The mapper names both, so the AI can say which two, and still sends both, so no
 * reduced model publishes outcomes the left-out effects would change (Codex r1 on #3640). One link per pair is unchanged.
 */
describe('parallel links between the same two items', () => {
  const second = { ...KNOWN_ANSWER.links[0]!, id: 'f_g_loss', quote: 'it also costs us 20 units', effect: { ...KNOWN_ANSWER.links[0]!.effect, value: 20, sd: 5, sign: '-' as const } };
  const parallel: LivingModelT = { ...KNOWN_ANSWER, links: [...KNOWN_ANSWER.links, second] };

  it('names both links, and drops neither from what is sent', () => {
    const { graph, withheld } = mapLivingModel(parallel);
    expect(graph.edges.filter((e) => e['from'] === 'f' && e['to'] === 'g').map((e) => e['id']).sort()).toEqual(['f_g', 'f_g_loss']);
    expect(withheld.filter((w) => w.reason === 'link_parallel_same_pair')).toEqual([{ id: 'f_g', reason: 'link_parallel_same_pair' }, { id: 'f_g_loss', reason: 'link_parallel_same_pair' }]);
  });

  it('CONTRAST: one link between the same items is sent as before, and nothing is named for it', () => {
    const { graph, withheld } = mapLivingModel(KNOWN_ANSWER);
    expect(graph.edges.filter((e) => e['from'] === 'f' && e['to'] === 'g')).toHaveLength(1);
    expect(withheld.some((w) => w.reason === 'link_parallel_same_pair')).toBe(false);
  });
});
