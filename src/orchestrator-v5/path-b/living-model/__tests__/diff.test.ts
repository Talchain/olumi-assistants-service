import { describe, expect, it } from 'vitest';
import type { LivingModelT } from '../../../../schemas/living-model.js';
import { diffLivingModels } from '../diff.js';
import { KNOWN_ANSWER } from './fixtures.js';

describe('thin core diff: exactly what a proposed model changes', () => {
  it('nothing changes → no items', () => {
    expect(diffLivingModels(KNOWN_ANSWER, structuredClone(KNOWN_ANSWER))).toEqual([]);
  });

  it('key order is not a change (a saved model is re-parsed in its schema\'s key order)', () => {
    const reordered = structuredClone(KNOWN_ANSWER);
    reordered.aims = reordered.aims.map(({ target, ...rest }) => ({ target, ...rest }));
    expect(diffLivingModels(KNOWN_ANSWER, reordered)).toEqual([]);
  });

  it('a corrected figure, a new factor, a removed option and a new view are each one item, matched by id or content', () => {
    const next: LivingModelT = structuredClone(KNOWN_ANSWER);
    next.factors[0]!.value = 0.6;
    next.factors.push({ id: 'h', label: 'h', value: null, low: null, high: null, unit: null, source: 'olumi', party: null, quote: null });
    next.options = next.options.filter((o) => o.id !== 'hold');
    next.views.push({ holder: 'Ana', position: 'supports push', quote: null });
    const changes = diffLivingModels(KNOWN_ANSWER, next);
    expect(changes.map((c) => [c.kind, c.id, c.change])).toEqual([
      ['option', 'hold', 'remove'], ['factor', 'f', 'change'], ['factor', 'h', 'add'], ['view', '1', 'add'],
    ]);
    expect(changes.find((c) => c.id === 'f')).toMatchObject({ before: { value: 0.5 }, after: { value: 0.6 } });
  });
});
