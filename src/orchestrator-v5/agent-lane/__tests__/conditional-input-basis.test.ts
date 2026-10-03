import { describe, expect, it } from 'vitest';
import { analysedOptionIds, conditionalInputBasis } from '../conditional-input-basis.js';

const observed = (source?: string, review?: string) => ({ value: 0.3, raw_value: 300, ...(source ? { source } : {}), ...(review ? { reviewed_by_user: { intent: review } } : {}) });
const factor = (id: string, state = observed('cee_inference')) => ({ id, kind: 'factor', label: id === 'subscribers' ? 'Subscribers' : id, observed_state: state });
const option = (id: string, override = false) => ({ id, kind: 'option', interventions: override ? { subscribers: { value: 0.4, source: 'brief_extraction' } } : {} });
const admission = (ids: unknown = ['subscribers']) => ({ semantic_signals: { material_parameters_awaiting_user_node_ids: ids } });
const graph = (state = observed('cee_inference'), options = [option('a'), option('b')]) => ({ nodes: [factor('subscribers', state), ...options], edges: [] });
const say = (g: unknown = graph(), a: unknown = admission(), ids = ['a', 'b']) => conditionalInputBasis({ graph: g, admission: a, analysedOptionIds: ids });

describe('B3-8: named factor baselines, with bounded coverage', () => {
  it('RED: names verified Olumi inputs and states the census coverage', () => {
    expect(say()).toContain('Olumi’s estimates for "Subscribers"');
    expect(say()).toContain('factor starting values on the comparison’s paths');
    expect(say()).toContain('Other model assumptions may also affect the result.');
  });
  it.each(['brief_extraction', 'explicit', 'user', 'user_edited', 'user_assumption'])('CONTROL: %s is not attributed to Olumi', (source) => {
    expect(say(graph(observed(source)))).toBeNull();
  });
  it.each(['cee_inference', 'inferred', 'cee_repair', 'user_confirmed'])('RED: %s remains Olumi-authored', (source) => {
    expect(say(graph(observed(source)))).toContain('Olumi’s estimates');
  });
  it('RED: accepted Olumi estimate is distinct from the user’s bare assumption and pairing review', () => {
    expect(say(graph(observed('user_assumption', 'confirm')))).toContain('Olumi’s estimates');
    expect(say(graph(observed('user_assumption', 'confirm_pairing')))).toBeNull();
  });
  it('RED: an unattributed existing number has source unrecorded', () => {
    expect(say(graph(observed()))).toContain('"Subscribers": source unrecorded');
    expect(say(graph(observed()))).not.toContain('not yet set');
    expect(say(graph(observed()))).not.toContain('Olumi’s estimates');
  });
  it.each([undefined, {}, admission(null), admission(['subscribers', 3]), admission(['missing'])])('RED: unavailable/malformed/unresolved data stays distinct (%j)', (a) => {
    // Pass undefined directly rather than invoking the default parameter.
    expect(conditionalInputBasis({ graph: graph(), admission: a, analysedOptionIds: ['a', 'b'] })).toContain('sources of this comparison’s factor starting values are unavailable');
  });
  it('CONTROL: a known-empty census makes no all-user claim, even with estimated roots and links outside it', () => {
    const g = graph();
    g.nodes.push(factor('exogenous_root'));
    const withEdges = { ...g, edges: [{ from: 'exogenous_root', to: 'subscribers', provenance: { source: 'cee_inference' } }] };
    expect(say(withEdges, admission([]))).toBeNull();
  });
  it('CONTROL: an unused baseline is omitted only if every actually analysed option replaces it', () => {
    expect(say(graph(observed('cee_inference'), [option('a', true), option('b', true), option('excluded')]))).toBeNull();
    expect(say(graph(observed('cee_inference'), [option('a', true), option('b'), option('excluded', true)]))).toContain('Subscribers');
  });
  it('RED: missing analysed options cannot establish baseline use', () => {
    expect(say(graph(), admission(), ['a', 'missing'])).toContain('unavailable');
    expect(say(graph(), admission(), [])).toContain('unavailable');
  });
  it('RED: numeric and mixed absolute intervention carriers have the same unused-baseline meaning', () => {
    const g = graph() as { nodes: Record<string, unknown>[]; edges: unknown[] };
    g.nodes[1]!.interventions = { subscribers: 0.4 };
    g.nodes[2]!.interventions = { subscribers: { value: 0.5 } };
    expect(say(g)).toBeNull();
  });
  it('RED: the selected result source supplies the compared set, not a thin current shadow', () => {
    const result = { enrichment: { option_comparison: [{ option_id: 'a' }, { option_id: 'b' }],
      results: [{ option_id: 'a', win_probability: 0.5 }, { option_id: 'b', win_probability: 0.3 }, { option_id: 'c', win_probability: 0.2 }] } };
    expect(analysedOptionIds(result)).toEqual(['a', 'b', 'c']);
    expect(analysedOptionIds({ enrichment: { option_comparison: [{ option_id: 'a' }] } })).toEqual([]);
    expect(analysedOptionIds({ enrichment: { option_comparison: [{ option_id: 'a', win_probability: 0.7 }, { option_id: 'a', win_probability: 0.3 }] } })).toEqual([]);
    expect(analysedOptionIds({ enrichment: { option_comparison: [{ win_probability: 0.7 }] } })).toEqual([]);
    expect(analysedOptionIds({ enrichment: { option_comparison: [{ option_id: 'a', win_probability: 0.7 }, { option_id: 'b', win_probability: 0.3 }, { option_id: 'excluded', win_probability: 0.9, status: 'error' }] } })).toEqual(['a', 'b']);
  });
  it('CONTROL: no input is mutated', () => {
    const g = graph(); const a = admission(); const before = JSON.stringify([g, a]);
    say(g, a);
    expect(JSON.stringify([g, a])).toBe(before);
  });
  it('RED: partial computations retain used baselines; failed computations do not join the comparison', () => {
    const g = graph(observed('cee_inference'), [option('a', true), option('b', true), option('c')]);
    const rows = [{ option_id: 'a', win_probability: 0.5, status: 'computed' }, { option_id: 'b', win_probability: 0.3, status: 'computed' },
      { option_id: 'c', win_probability: 0.2, status: 'partial', outcome: { mean: 1 } }];
    expect(say(g, admission(), [...analysedOptionIds({ enrichment: { option_comparison: rows } })])).toContain('Subscribers');
    for (const status of ['failed', 'error', 'skipped']) {
      const ids = analysedOptionIds({ enrichment: { option_comparison: [...rows.slice(0, 2), { ...rows[2], status }] } });
      expect(say(g, admission(), [...ids])).toBeNull();
    }
  });
});
