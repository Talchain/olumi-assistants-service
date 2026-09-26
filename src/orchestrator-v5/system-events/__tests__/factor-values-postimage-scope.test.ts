/**
 * ⛔ A COMPOUND APPROVAL'S VALUES MAY CHANGE ONLY THEIR OWN FACTORS (Canonical #70 5849037691). The values half of a
 * compound approval is applied in memory by the canonical value writer, then committed in the SAME append as the
 * levels; this guard is what stops that in-memory step from carrying anything else into the commit.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { factorValuesPostimageIsScoped } from '../option-intervention-edit.js';
import { applyFactorValueEdit } from '../factor-value-edit.js';

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

/**
 * ⭐ OLUMI'S OWN LINKS FOLLOW THE LEVEL, INSIDE THE SAME COMMIT (MG #70 5849417275; DL 5849430260). Since #2033 the
 * value writer re-sizes the Olumi-sized links on a factor whose level moves (`frameDefaultedLinks`). Served F1: churn
 * 5% re-sizes exactly the 2 links into churn to ±0.0125 — and the door refused that as out of scope, so the compound
 * starting point would have been `not_applied`. The guard now admits exactly the magnitude contract's own
 * re-derivation on the declared factors, and nothing else: never a user's link, never another size, never another link.
 */
describe('factorValuesPostimageIsScoped admits the magnitude contract\'s own re-sizing — and only that', () => {
  const SERVED = JSON.parse(readFileSync('tests/fixtures/magnitude/c-run1-served-graphs.json', 'utf-8')) as Record<string, { edges: Record<string, unknown>[] }>;
  const CHURN_UNIT = '% of Pro subscribers per month';
  const setChurn = async (graph: unknown, raw: number) => {
    const event = { kind: 'factor_value_edit' as const, target_id: 'monthly_churn', value: raw, unit: CHURN_UNIT };
    const res = await applyFactorValueEdit({
      payload: { kind: 'system_event', turn_id: 'probe-guard', scenario_id: '11111111-1111-4111-8111-111111111111', stage: 'frame', event } as never,
      event: event as never, requestId: 'req-guard', persistedGraph: structuredClone(graph), priorFacts: [],
    });
    expect(res.kind).toBe('mutated');
    return (res as { mutatedGraph: { edges: Record<string, unknown>[] } }).mutatedGraph;
  };
  const edgeOf = (g: { edges: Record<string, unknown>[] }, from: string, to: string) => g.edges.find(e => e.from === from && e.to === to)!;

  it('RED (MG\'s probe, served F1 step 01): churn 5% through the REAL value writer → the 2 re-sized links into churn are in scope', async () => {
    const before = structuredClone(SERVED.run1_step01!);
    const after = await setChurn(before, 5);
    expect((edgeOf(after, 'price_sensitivity', 'monthly_churn').strength as { mean: number }).mean, 'the writer did re-size (#2033)').toBe(0.0125);
    expect(factorValuesPostimageIsScoped(before, after, ['monthly_churn'])).toBe(true);
  });

  it('REFUSES a re-sized link that is not the contract\'s size, a changed USER link, and a changed link off the declared factors', async () => {
    const before = structuredClone(SERVED.run1_step01!);
    const after = await setChurn(before, 5);
    const wrongSize = structuredClone(after);
    (edgeOf(wrongSize, 'price_sensitivity', 'monthly_churn').strength as { mean: number }).mean = 0.3;
    expect(factorValuesPostimageIsScoped(before, wrongSize, ['monthly_churn'])).toBe(false);

    const userBefore = structuredClone(before);
    edgeOf(userBefore, 'price_sensitivity', 'monthly_churn').provenance = { source: 'user_specified' };
    const userAfter = await setChurn(userBefore, 5);
    expect(edgeOf(userAfter, 'price_sensitivity', 'monthly_churn').provenance, 'the writer leaves a user\'s link alone').toEqual({ source: 'user_specified' });
    const userChanged = structuredClone(userAfter);
    (edgeOf(userChanged, 'price_sensitivity', 'monthly_churn').strength as { mean: number }).mean = 0.0125;
    expect(factorValuesPostimageIsScoped(userBefore, userChanged, ['monthly_churn'])).toBe(false);

    const offFactor = structuredClone(after);
    const other = offFactor.edges.find(e => e.from !== 'monthly_churn' && e.to !== 'monthly_churn')!;
    (other.strength as { mean: number }).mean = 0.0125;
    expect(factorValuesPostimageIsScoped(before, offFactor, ['monthly_churn'])).toBe(false);
  });

  it('CONTROL: an unchanged level whose links were never sized — the writer leaves them, and that is in scope too', async () => {
    const before = structuredClone(SERVED.run1_step01!);
    const sized = await setChurn(before, 5);
    // The same links, back at today's default: the level holds 5% but its links were never sized (a pre-#2033 graph).
    const legacy = { ...structuredClone(sized), edges: structuredClone(before.edges) };
    const again = await setChurn(legacy, 5);
    expect(factorValuesPostimageIsScoped(legacy, again, ['monthly_churn'])).toBe(true);
  });
});
