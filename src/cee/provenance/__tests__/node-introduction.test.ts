import { describe, expect, it } from 'vitest';
import { provenanceOf } from '../provenance-of.js';
import { NodeV3 } from '../../../schemas/cee-v3.js';

const receipt = {
  provenance: 'ai_suggested_widen', hits: { id: 'hire', label: 'Hire', kind: 'option' },
  through: { id: 'capacity', label: 'Capacity', direction: 'negative' },
  affects: { id: 'goal', label: 'Goal', direction: 'negative' },
  mechanism: 'relies_on', relies_on: 'Specialist availability', watch_for: 'Hiring delays',
};
const risk = { id: 'risk', kind: 'risk', label: 'Specialist availability risk',
  draft_widening: receipt, proposed_by: 'olumi', analysis_participation: 'retained_excluded' };

describe('positive structural introduction through the existing server receipt', () => {
  it('reads a persisted unadopted widening receipt without inventing a scalar', () => {
    const node = NodeV3.parse(risk);
    expect(provenanceOf({ node })).toEqual({ origin: 'ai', accepted: false, structural: true,
      ratified: false, repaired: false, placeholder: false, role: 'n/a', unadopted: true });
    expect(provenanceOf({ value: node.observed_state }).origin).toBe('unknown');
  });
  it('included risks are not known unadopted; inclusion alone is not a risk adoption receipt', () => {
    const p = provenanceOf({ node: NodeV3.parse({ ...risk, analysis_participation: 'included' }) });
    expect(p.origin).toBe('ai'); expect(p.accepted).toBe(false); expect(p.unadopted).toBeUndefined();
  });
  it('reads the existing option adoption writer participation on a positive introduction receipt', () => {
    const node = NodeV3.parse({ id: 'option', kind: 'option', label: 'Hire', proposed_by: 'olumi',
      draft_widening: { provenance: 'ai_suggested_widen' }, analysis_participation: 'included' });
    const p = provenanceOf({ node });
    expect(p.origin).toBe('ai'); expect(p.accepted).toBe(true); expect(p.unadopted).toBeUndefined();
  });
  it.each([
    { provenance: 'ai_inferred' }, { provenance: 'from_brief' }, { proposed_by: 'olumi' },
    { analysis_participation: 'retained_excluded' }, { draft_widening: { provenance: 'ai_suggested_widen' } },
    { draft_widening: { ...receipt, watch_for: '' } }, {},
  ])('keeps absent or incomplete structural evidence unknown: %j', fields => {
    const p = provenanceOf({ node: { id: 'risk', kind: 'risk', label: 'Specialist availability risk', ...fields } });
    expect(p.origin).toBe('unknown'); expect(p.unadopted).toBeUndefined();
  });
  it('receipt alone cannot establish non-adoption', () => {
    const p = provenanceOf({ node: { ...risk, analysis_participation: undefined } });
    expect(p.origin).toBe('ai'); expect(p.unadopted).toBeUndefined();
  });
});
