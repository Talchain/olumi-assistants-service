/**
 * ⭐ DRIFT PIN: the edge fields `computeAnalysisAffectingGraphHash` counts ARE the published analysis-affecting edge
 * vocabulary (`CANONICAL_GRAPH_HASH_NESTED_PROJECTION.edge`, `@talchain/schemas/boundary`) — no more, no fewer.
 *
 * WHY (W4, X4; #70 5858906092): the UI's reload-currency proof now compares an edge ONLY on that published vocabulary
 * (UI `serverGraphHydration.ts` `analysisAffectingEdge`), so that a metadata key CEE adds (CEE #2096's
 * `exists_defaulted`) can no longer decline every reload. `projectEdge` here is hand-coded and imports nothing from the
 * manifest; if CEE started hashing an edge field the manifest does not name, the UI would stop comparing a field the
 * hash counts and claim "current" wrongly (fail OPEN). This pins both directions against CEE's own edge schema.
 */
import { describe, it, expect } from 'vitest';
import { CANONICAL_GRAPH_HASH_NESTED_PROJECTION } from '@talchain/schemas/boundary';

import { computeAnalysisAffectingGraphHash } from '../graph-hash.js';
import { EdgeV3 } from '../../../schemas/cee-v3.js';

const MANIFEST = CANONICAL_GRAPH_HASH_NESTED_PROJECTION.edge;
const edge = (): Record<string, any> => ({
  from: 'fac_a', to: 'out_b', edge_type: 'directed', exists_probability: 0.8, effect_direction: 'positive',
  strength: { mean: 0.5, std: 0.1 },
});
const graph = (e: Record<string, any>) => ({
  nodes: [
    { id: 'fac_a', kind: 'factor', label: 'A', observed_state: { value: 0.5 } },
    { id: 'out_b', kind: 'outcome', label: 'B' },
  ],
  edges: [e],
});
const hashOf = (e: Record<string, any>) => computeAnalysisAffectingGraphHash(graph(e) as never);
const BASE = hashOf(edge());
const DIFFERENT: Record<string, unknown> = {
  edge_type: 'bidirected', exists_probability: 0.3, effect_direction: 'negative',
};

describe('graph-hash edge projection == the published analysis-affecting edge vocabulary', () => {
  it('precondition: the base graph hashes', () => {
    expect(typeof BASE).toBe('string');
    expect(BASE!.length).toBeGreaterThan(0);
  });

  it.each(MANIFEST.fields.filter((k) => k !== 'from' && k !== 'to'))('manifest field `%s` moves the hash', (k) => {
    expect(DIFFERENT[k], `a different value for ${k}`).toBeDefined();
    expect(hashOf({ ...edge(), [k]: DIFFERENT[k] })).not.toBe(BASE);
  });

  it.each(MANIFEST.strength_fields)('manifest strength field `%s` moves the hash', (k) => {
    const e = edge();
    e.strength = { ...e.strength, [k]: e.strength[k] + 0.2 };
    expect(hashOf(e)).not.toBe(BASE);
  });

  // schemas 0.62.0 (projection v3; AIQ 5881815357): who sized the link is an analysis input — the placeholder-parts
  // predicate reads it — so `provenance` is hashed on EXACTLY its published sub-vocabulary.
  it.each(MANIFEST.provenance_fields)('manifest provenance field `%s` moves the hash', (k) => {
    expect(hashOf({ ...edge(), provenance: { [k]: 'probe' } })).not.toBe(BASE);
  });

  it.each(MANIFEST.provenance_natural_effect_fields)('manifest provenance.natural_effect field `%s` moves the hash', (k) => {
    expect(hashOf({ ...edge(), provenance: { natural_effect: { [k]: 'probe' } } })).not.toBe(BASE);
  });

  it('a provenance member the manifest lacks leaves the hash unchanged (reasoning; natural_effect.amount)', () => {
    expect(hashOf({ ...edge(), provenance: { reasoning: 'why' } })).toBe(BASE);
    expect(hashOf({ ...edge(), provenance: { natural_effect: { amount: 500 } } })).toBe(BASE);
  });

  it('EVERY other key of CEE\'s own edge schema leaves the hash unchanged (a hashed field the manifest lacks = the UI fails open)', () => {
    const others = Object.keys(EdgeV3.shape).filter(
      (k) => !(MANIFEST.fields as readonly string[]).includes(k) && k !== 'strength' && k !== 'provenance',
    );
    expect(others, 'contrast: CEE writes metadata keys beyond the manifest, e.g. exists_defaulted').toContain('exists_defaulted');
    for (const k of others) {
      expect(hashOf({ ...edge(), [k]: true }), k).toBe(BASE);
    }
  });

  it('a strength sub-key the manifest lacks leaves the hash unchanged', () => {
    const e = edge();
    e.strength = { ...e.strength, band: 'strong' };
    expect(hashOf(e)).toBe(BASE);
  });
});
