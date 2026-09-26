/**
 * ⛔ A COMPOUND APPROVAL'S VALUES MAY CHANGE ONLY THEIR OWN FACTORS (Canonical #70 5849037691). The values half of a
 * compound approval is applied in memory by the canonical value writer, then committed in the SAME append as the
 * levels; this guard is what stops that in-memory step from carrying anything else into the commit.
 */
import { describe, it, expect } from 'vitest';
import { factorValuesPostimageIsScoped } from '../option-intervention-edit.js';

const base = () => ({
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Revenue' },
    { id: 'price', kind: 'factor', label: 'Price', observed_state: { value: 0.5, raw_value: 50, cap: 100 } },
    { id: 'churn', kind: 'factor', label: 'Churn', observed_state: { value: 0.05 } },
    { id: 'opt', kind: 'option', label: 'Raise', interventions: { price: { value: 0.6, source: 'user_specified', target_match: { node_id: 'price', match_type: 'exact_id', confidence: 'high' } } } },
  ],
  edges: [{ from: 'price', to: 'goal', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' }],
});
const withNode = (g: ReturnType<typeof base>, id: string, patch: Record<string, unknown>) =>
  ({ ...g, nodes: g.nodes.map(n => (n.id === id ? { ...n, ...patch } : n)) });

describe('factorValuesPostimageIsScoped', () => {
  it('ACCEPTS the value writer\'s own members on a declared factor: observed_state, display_value, provenance', () => {
    const after = withNode(base(), 'price', { observed_state: { value: 0.6, raw_value: 60, cap: 100 }, display_value: '60', provenance: 'user_set' });
    expect(factorValuesPostimageIsScoped(base(), after, ['price'])).toBe(true);
  });

  it('REFUSES a change to a factor that was NOT declared', () => {
    const after = withNode(withNode(base(), 'price', { observed_state: { value: 0.6 } }), 'churn', { observed_state: { value: 0.07 } });
    expect(factorValuesPostimageIsScoped(base(), after, ['price'])).toBe(false);
  });

  it('REFUSES any other member of the declared factor (its label) and any edge or option change', () => {
    expect(factorValuesPostimageIsScoped(base(), withNode(base(), 'price', { label: 'Renamed' }), ['price'])).toBe(false);
    const edge = { ...base(), edges: [{ ...base().edges[0]!, exists_probability: 0.5 }] };
    expect(factorValuesPostimageIsScoped(base(), edge, ['price'])).toBe(false);
    expect(factorValuesPostimageIsScoped(base(), withNode(base(), 'opt', { interventions: {} }), ['price'])).toBe(false);
  });

  it('REFUSES a declared id that is not exactly one factor, and an empty or duplicated declaration', () => {
    expect(factorValuesPostimageIsScoped(base(), base(), ['opt'])).toBe(false);
    expect(factorValuesPostimageIsScoped(base(), base(), ['missing'])).toBe(false);
    expect(factorValuesPostimageIsScoped(base(), base(), [])).toBe(false);
    expect(factorValuesPostimageIsScoped(base(), base(), ['price', 'price'])).toBe(false);
  });
});
