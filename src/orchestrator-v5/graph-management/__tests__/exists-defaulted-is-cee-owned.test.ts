/**
 * A6e — `exists_defaulted` IS CEE'S TO WRITE, NEVER A PRODUCER'S (Canonical #70 5855416983, AIQ agreed).
 *
 * The flag says the link's EXISTENCE is still Olumi's default after the user adopted its strength. It is minted by
 * the one user link writer (`adjust-edge-strength.ts`) when that write ends the whole-edge `defaulted`. A model op
 * that could set or clear it would let a producer relabel whose existence claim this is — the same forgeable-
 * provenance class J2 closed for `threshold_source` (`threshold-source-j2.test.ts`), so it is refused the same way:
 * a member of `CEE_ANALYSIS_OWNED_ROOTS`, screened at every depth by R4.
 */
import { describe, expect, it } from 'vitest';

import { CEE_ANALYSIS_OWNED_ROOTS_FOR_TEST, PIPELINE_OWNED_ROOTS } from '../field-safety.js';
import { PIPELINE_OWNED_FIELD } from '../reason-codes.js';
import { refereeMutation } from '../referee.js';
import { buildReadyGraph, frameFor, hashOf, makeEnvelope } from './fixtures.js';

const G = buildReadyGraph();

function edgeUpdate(field: string, to: unknown) {
  return refereeMutation(
    makeEnvelope(
      'update_edge_field',
      { from_node: 'f-spend', to_node: 'g-profit', field, from: null, to },
      { base_graph_hash: hashOf(G) },
    ),
    G,
    frameFor(G),
  );
}

describe('a model op naming `exists_defaulted` is refused as a pipeline-owned field', () => {
  it('⭐ RED: it is a CEE-owned edge root', () => {
    expect(CEE_ANALYSIS_OWNED_ROOTS_FOR_TEST).toContain('exists_defaulted');
    expect(PIPELINE_OWNED_ROOTS.has('exists_defaulted')).toBe(true);
  });

  it('⭐ RED: a direct `update_edge_field` write of it is refused PIPELINE_OWNED_FIELD', () => {
    const v = edgeUpdate('exists_defaulted', false);
    expect(v.verdict).toBe('rejected');
    expect(v.blocker?.code).toBe(PIPELINE_OWNED_FIELD);
  });

  it('⭐ RED: smuggled inside an object payload of an allowed root, it is refused', () => {
    const v = edgeUpdate('strength', { mean: 0.5, std: 0.1, exists_defaulted: false });
    expect(v.verdict).toBe('rejected');
    expect(v.blocker?.code).toBe(PIPELINE_OWNED_FIELD);
  });

  it('CONTRAST: the existence probability itself stays a tunable edge field (the flag, not the value, is owned)', () => {
    const v = edgeUpdate('exists_probability', 0.7);
    expect(v.blocker?.code).not.toBe(PIPELINE_OWNED_FIELD);
    expect(v.verdict).not.toBe('rejected');
  });
});
