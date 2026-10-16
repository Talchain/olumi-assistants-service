import { describe, expect, it } from 'vitest';
import {
  isUnverifiedProvenance, observedValueAuthorship, settingAuthorshipOf,
  settingDisplayOf, settingProvenanceOf, valueAuthorshipOf, valueProvenanceOf,
} from '../provenance-of.js';

// Synthetic briefs only. These are desired-behaviour rows: the positive rows
// remain RED until the authority receives the option/evidence context needed
// to distinguish a dedicated definition from an independently evidenced state.
function activationScenario(optionLabel: string, factorLabel: string) {
  const factor = {
    id: 'switch', kind: 'factor', label: factorLabel, category: 'controllable',
    observed_state: { value: 0, unit: '0/1', source: 'cee_inference',
      extractionType: 'inferred', user_material_unverified: true },
  };
  const cell = { value: 1, source: 'cee_hypothesis', user_material_unverified: true };
  const option = { id: 'option', kind: 'option', label: optionLabel, interventions: { switch: cell } };
  return { factor, cell, option, graph: { nodes: [factor, option],
    edges: [{ from: 'option', to: 'switch' }], evidence: [] } };
}

describe('C4: an option activation definition has no author claim', () => {
  it.each([
    ['hotel', 'Run a corporate package', 'Corporate package active'],
    ['software', 'Release a self-service portal', 'Self-service portal active'],
  ])('%s synthetic brief: the own on cell and off-today baseline are structural', (_brief, option, factor) => {
    const row = activationScenario(option, factor);
    expect(row.graph.nodes.filter(n => n.kind === 'option')).toHaveLength(1);
    expect(row.graph.evidence).toEqual([]);
    const on = settingProvenanceOf(row.cell, row.factor);
    const off = valueProvenanceOf(row.factor.observed_state);
    expect.soft(on.structural).toBe(true);
    expect.soft(off.structural).toBe(true);
    expect.soft(isUnverifiedProvenance(on)).toBe(false);
    expect.soft(isUnverifiedProvenance(off)).toBe(false);
    expect.soft(settingAuthorshipOf(row.cell, row.factor)).toBe('structural');
  });

  it('NEGATIVE b: an exogenous binary reading stays Olumi’s, with its display label', () => {
    const observed = { value: 0, unit: '0/1', source: 'cee_inference', extractionType: 'inferred' };
    const factor = { id: 'competitor', kind: 'factor', label: 'Competitor hotel open', category: 'external',
      observed_state: observed, evidence: [{ quote: 'The competitor hotel opens in March.' }] };
    expect(valueProvenanceOf(observed)).toMatchObject({ origin: 'ai', structural: false });
    expect(valueAuthorshipOf(observed)).toBe('olumi_estimate');
    expect(observedValueAuthorship(observed)).toEqual({ source: 'assumption', provenance: 'ai_inferred' });
    // Also protect a cell on the same exogenous state: binary is never a licence
    // to discard the reading's provenance, even when an option refers to it.
    const cell = { value: 0, source: 'cee_hypothesis' };
    expect(settingProvenanceOf(cell, factor)).toMatchObject({ origin: 'ai', structural: false });
    expect(settingDisplayOf(cell, factor)).toBe('ai_inferred');
    expect(settingAuthorshipOf(cell, factor)).toBe('olumi_estimate');
  });

  it('NEGATIVE c: Hire 2 developers keeps the exact human authorship path', () => {
    const factor = { id: 'developers', kind: 'factor', label: 'Developers hired', category: 'controllable',
      observed_state: { value: 0, unit: 'developers', source: 'user_specified' } };
    const cell = { value: 2, source: 'brief_extraction', extractionType: 'explicit' };
    expect(settingProvenanceOf(cell, factor)).toEqual({ origin: 'human', accepted: false, structural: false,
      ratified: false, repaired: false, placeholder: false, role: 'verified' });
    expect(settingAuthorshipOf(cell, factor)).toBe('user');
    expect(settingDisplayOf(cell, factor)).toBe('from_brief');
  });

  it('NEGATIVE d: a binary factor set by two options is never a dedicated switch', () => {
    const row = activationScenario('Run a corporate package', 'Corporate package active');
    const other = { ...row.option, id: 'other', label: 'Run a conference package' };
    const shared = { ...row.graph, nodes: [...row.graph.nodes, other] };
    expect(shared.nodes.filter(n => n.kind === 'option')).toHaveLength(2);
    expect(settingProvenanceOf(row.cell, row.factor)).toMatchObject({ origin: 'unknown', structural: false });
    expect(isUnverifiedProvenance(settingProvenanceOf(row.cell, row.factor))).toBe(true);
    // The current reader's inputs are identical in the dedicated/shared cases.
    // This is the missing context boundary, not permission to infer exclusivity.
    expect(other.interventions.switch).toEqual(row.cell);
  });

  it('NEGATIVE: a nearby binary definition cannot lend authorship to unrelated evidence', () => {
    const row = activationScenario('Release a self-service portal', 'Self-service portal active');
    const other = { id: 'service', kind: 'factor', label: 'Existing service available', category: 'external',
      observed_state: { value: 0, unit: '0/1', source: 'cee_inference', extractionType: 'inferred' },
      evidence: [{ quote: 'The existing service is unavailable today; a portal is another option.' }] };
    const graph = { ...row.graph, nodes: [...row.graph.nodes, other] };
    expect(graph.nodes).toHaveLength(3);
    expect(valueProvenanceOf(other.observed_state)).toMatchObject({ origin: 'ai', structural: false });
    expect(valueAuthorshipOf(other.observed_state)).toBe('olumi_estimate');
    expect(settingProvenanceOf({ value: 0, source: 'cee_hypothesis' }, other))
      .toMatchObject({ origin: 'ai', structural: false });
  });
});
