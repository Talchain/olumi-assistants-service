/**
 * OC-1 (#63 5805819378): an imported option level with no recorded origin could never be
 * revised — the level writer refuses an unattributed entry, by ruling. Registration now
 * states the origin as Olumi's (`cee_hypothesis`), and never rewrites a stated one.
 */
import { describe, expect, it } from 'vitest';
import { attributeUnsourcedLevelCells, UNSOURCED_LEVEL_SOURCE } from '../attribute-unsourced-levels.js';

const option = (interventions: unknown) => ({ id: 'opt_segment', kind: 'option', label: 'Segment', interventions });

describe('attributeUnsourcedLevelCells', () => {
  it('RED: the served CDP cells — an unattributed level is stated as Olumi\'s, everything else on it kept', () => {
    const g = { nodes: [option({
      fac_annual_cost: { value: 0.5, display_value: '£60k' },
      fac_segment: { value: 0.9, source: 'user_specified', target_match: { node_id: 'fac_segment', match_type: 'exact_id' } },
      fac_rudderstack: { value: 0, source: 'brief_extraction', display_value: 'Low (0)' },
    })], edges: [] };
    const out = attributeUnsourcedLevelCells(g);
    const iv = (out.nodes[0] as { interventions: Record<string, unknown> }).interventions;
    expect(iv['fac_annual_cost']).toEqual({ value: 0.5, display_value: '£60k', source: UNSOURCED_LEVEL_SOURCE });
    expect(iv['fac_segment'], 'a stated user origin is never touched').toEqual(g.nodes[0]!.interventions.fac_segment);
    expect(iv['fac_rudderstack'], 'a stated brief origin is never touched').toEqual(g.nodes[0]!.interventions.fac_rudderstack);
    expect(UNSOURCED_LEVEL_SOURCE, 'never the user\'s, never the brief\'s').toBe('cee_hypothesis');
  });

  it('a null origin is unknown too, and is stated as Olumi\'s', () => {
    const out = attributeUnsourcedLevelCells({ nodes: [option({ f: { value: 0.2, source: null } })] });
    expect((out.nodes[0] as { interventions: Record<string, { source: unknown }> }).interventions.f.source).toBe('cee_hypothesis');
  });

  it('CONTRAST: a PRESENT origin outside the enum is left for the writer to refuse — never relabelled', () => {
    const cell = { value: 0.4, source: 'some_other_source' };
    const out = attributeUnsourcedLevelCells({ nodes: [option({ f: cell })] });
    expect((out.nodes[0] as { interventions: Record<string, unknown> }).interventions.f).toEqual(cell);
  });

  it('CONTRAST: non-option nodes, bare-number cells and cells with no numeric value are untouched; a graph with nothing to do is returned as is', () => {
    const g = { nodes: [
      { id: 'fac', kind: 'factor', label: 'F', interventions: { x: { value: 1 } } },
      option({ a: 0.5, b: { display_value: 'no value' }, c: { value: Number.NaN } }),
    ] };
    expect(attributeUnsourcedLevelCells(g)).toBe(g);
  });
});
