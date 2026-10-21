import { describe, expect, it } from 'vitest';
import type { LivingModelT } from '../../../../schemas/living-model.js';
import { LivingModel } from '../../../../schemas/living-model.js';
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

  it('R1 round 2: a "user" current level the AI asserts is theirs only while it is the saved one, unchanged', () => {
    const savedLevel: LivingModelT = structuredClone(KNOWN_ANSWER);
    savedLevel.aims[0]!.target = { ...savedLevel.aims[0]!.target!, current: 75, current_source: 'user' };
    expect(applyKernel(structuredClone(savedLevel), [], savedLevel).model.aims[0]!.target!.current_source).toBe('user');
    const changed: LivingModelT = structuredClone(savedLevel);
    changed.aims[0]!.target!.current = 80;
    expect(applyKernel(changed, [], savedLevel).model.aims[0]!.target!.current_source).toBeNull();
  });
});


describe('per-figure authorship in the kernel (estimate_by, 21 Oct, buddy SIMPLER)', () => {
  const words = ['f is at 0.5', 'we need at least 100 units; today we are at 70', 'push f to 1', 'or we hold',
    'each +1 in f adds 50 units on average, with a standard deviation of 10'];
  // As production reads them: the saved model through `livingViewOf` and the AI's through the strict tool schema (defaults applied).
  const parsed = (m: unknown): LivingModelT => LivingModel.parse(m);
  it('never replaces a figure the source gave: an Olumi "estimate" over the saved figure keeps the saved one', () => {
    const next: LivingModelT = parsed(structuredClone(KNOWN_ANSWER));
    next.factors[0] = { ...next.factors[0]!, value: 0.9, low: 0.8, high: 1, estimate_by: 'olumi' };
    const out = applyKernel(next, words, parsed(structuredClone(KNOWN_ANSWER))).model.factors[0]!;
    expect(out).toMatchObject({ value: 0.5, low: null, high: null, estimate_by: null, source: 'user' });
  });
  it("adding ONLY an estimate to a saved item of the person's (no quote: made on the canvas) keeps it theirs; a figure claimed as theirs does not", () => {
    const saved: LivingModelT = parsed(structuredClone(KNOWN_ANSWER));
    saved.factors[0] = { ...saved.factors[0]!, value: null, quote: null, source: 'user' };
    const withEstimate: LivingModelT = structuredClone(saved);
    withEstimate.factors[0] = { ...withEstimate.factors[0]!, value: 0.5, low: 0.3, high: 0.7, unit: null, estimate_by: 'olumi' };
    expect(applyKernel(withEstimate, words, saved).model.factors[0]).toMatchObject({ source: 'user', value: 0.5, estimate_by: 'olumi' });
    const claimed: LivingModelT = structuredClone(saved);
    claimed.factors[0] = { ...claimed.factors[0]!, value: 0.5, estimate_by: null };
    expect(applyKernel(claimed, words, saved).model.factors[0]!.source, 'an AI figure is never credited to the person').toBe('unverified');
  });
});
