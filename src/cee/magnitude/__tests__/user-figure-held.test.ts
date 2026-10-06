/**
 * ⭐ F1 — the one predicate and the one set of words every door uses (`user-figure-held.ts`; #87 6006627551; d5
 * 6006667946). Exact strings, so a reworded refusal or receipt is a deliberate, reviewed change.
 */
import { describe, expect, it } from 'vitest';
import {
  replaceFigureTheUserWrote,
  userFigureHeld,
  userFigureHeldRefusalText,
  userFigureMovedRefusal,
  userFigureReplacedReceipt,
} from '../user-figure-held.js';

const NATURAL = { amount: 49, amount_unit: 'GBP/month', per_source_change: 1, per_source_change_unit: 'subscriber', strength_mean: 0.62, strength_mean_frame: 'edge_strength' };
const edge = (provenance: Record<string, unknown>, mean = 0.62, direction = 'positive') =>
  ({ from: 'a', to: 'b', strength: { mean, std: 0.1 }, effect_direction: direction, provenance });

describe('userFigureHeld — the user’s own figure, as words they recognise', () => {
  it('their sentence first', () => {
    expect(userFigureHeld(edge({ source: 'brief_extraction', magnitude: 'user_stated', natural_effect: NATURAL, source_quote: ' Each new subscriber adds about £49 a month ' })))
      .toEqual({ quote: 'Each new subscriber adds about £49 a month' });
  });
  it('else the range they wrote', () => {
    expect(userFigureHeld(edge({ source: 'brief_extraction', magnitude: 'user_stated', natural_effect: { ...NATURAL, stated_range: { low: 40, high: 60, text: '£40-60 a month', end: 'low' } } })))
      .toEqual({ quote: '£40-60 a month' });
  });
  it('else the stored figure, in the display grouped-link-sizing already serves', () => {
    expect(userFigureHeld(edge({ source: 'user_specified', magnitude: 'user_stated', natural_effect: NATURAL })))
      .toEqual({ quote: '49 GBP/month per 1 subscriber' });
  });
  it.each([
    ['Olumi’s estimate', { source: 'cee_hypothesis', magnitude: 'olumi_estimate', natural_effect: NATURAL }],
    ['a placeholder', { source: 'cee_hypothesis', magnitude: 'olumi_placeholder' }],
    ['a band the user picked (no figure)', { source: 'user_specified' }],
    ['a user_stated size that no longer carries its figure', { source: 'brief_extraction', magnitude: 'user_stated' }],
  ])('none on %s', (_n, provenance) => {
    expect(userFigureHeld(edge(provenance))).toBeNull();
  });
  it('none on a non-object', () => {
    expect(userFigureHeld(undefined)).toBeNull();
    expect(userFigureHeld({ provenance: 'x' })).toBeNull();
  });
});

describe('the words', () => {
  const held = { quote: 'Each lost customer removes £300 a month' };
  it('refusal (DL spec)', () => {
    expect(userFigureHeldRefusalText(held, 'slight')).toBe(
      'This link holds your figure: ‘Each lost customer removes £300 a month’. Change the figure, or say ‘replace my figure with slight’.');
  });
  it('receipt (d5 6006667946)', () => {
    expect(userFigureReplacedReceipt(held, 'moderate')).toBe('Replaced your figure (‘Each lost customer removes £300 a month’) with ‘moderate’.');
  });
});

describe('replaceFigureTheUserWrote — only the user’s own, un-negated ask', () => {
  it.each([
    'replace my figure with slight',
    'For that link, Replace my own figure with moderate.',
    'please replace the figure with strong',
  ])('asks: %s', (t) => expect(replaceFigureTheUserWrote(t)).toBe(true));
  it.each([
    'Make the link weak.',
    'I don’t want to replace my figure. Make it weak.',
    'do not replace my figure',
    'never replace the figure',
    'my figure is fine, replace nothing',
    undefined,
  ])('does not ask: %s', (t) => expect(replaceFigureTheUserWrote(t)).toBe(false));
});

describe('userFigureMovedRefusal — the generic merges’ before/after check', () => {
  const held = edge({ source: 'brief_extraction', magnitude: 'user_stated', natural_effect: NATURAL, source_quote: 'Q' });
  it('a moved mean refuses, in the band of the new strength', () => {
    expect(userFigureMovedRefusal(held, { ...held, strength: { mean: 0.3, std: 0.1 } }))
      .toBe('This link holds your figure: ‘Q’. Change the figure, or say ‘replace my figure with moderate’.');
  });
  it('a flipped direction refuses', () => {
    expect(userFigureMovedRefusal(held, { ...held, effect_direction: 'negative' })).not.toBeNull();
  });
  it('CONTROL: the strength unchanged → null', () => {
    expect(userFigureMovedRefusal(held, { ...held, exists_probability: 0.8 })).toBeNull();
  });
  it('TWIN: no figure of the user’s → null, whatever moved', () => {
    const olumi = edge({ source: 'cee_hypothesis', magnitude: 'olumi_estimate', natural_effect: NATURAL });
    expect(userFigureMovedRefusal(olumi, { ...olumi, strength: { mean: 0.3, std: 0.1 } })).toBeNull();
  });
});
