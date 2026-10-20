import { describe, expect, it } from 'vitest';
import type { LivingModelT } from '../../../../schemas/living-model.js';
import { applyKernel } from '../kernel.js';
import { KNOWN_ANSWER } from './fixtures.js';

describe('thin core kernel: a saved attribution is kept only for an unchanged item', () => {
  const saved: LivingModelT = structuredClone(KNOWN_ANSWER);
  saved.factors[0] = { ...saved.factors[0]!, value: 0.5, source: 'user', party: null, quote: null };

  it('R1 6b148af5: the person\'s canvas value, changed by the AI, is no longer theirs', () => {
    const proposed: LivingModelT = structuredClone(saved);
    proposed.factors[0]!.value = 0.7;
    const out = applyKernel(proposed, [], saved);
    expect(out.model.factors[0]).toMatchObject({ value: 0.7, source: 'unverified' });
    expect(out.relabelled).toContainEqual({ id: 'f', was: 'user' });
  });

  it('CONTROL: carried over unchanged, it keeps its label without any words in the window', () => {
    expect(applyKernel(structuredClone(saved), [], saved).model.factors[0]).toMatchObject({ value: 0.5, source: 'user' });
  });
});
