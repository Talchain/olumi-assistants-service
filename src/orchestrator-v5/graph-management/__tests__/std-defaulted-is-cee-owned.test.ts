/**
 * A6f — `std_defaulted` IS CEE'S TO WRITE, NEVER A PRODUCER'S (AIQ N1 on CEE #2096, comment 5856128077).
 *
 * The flag says a link's SPREAD (`strength.std`) is still Olumi's after the user wrote an exact figure. It is minted
 * by the one user link writer (`adjust-edge-strength.ts`). A model op that could set or clear it would let a producer
 * relabel whose uncertainty claim this is — the J2 forgeable-provenance class (`threshold-source-j2.test.ts`), handled
 * exactly as its sibling `exists_defaulted` (`exists-defaulted-is-cee-owned.test.ts`): a member of
 * `CEE_ANALYSIS_OWNED_ROOTS`, refused on update at every depth and stripped from an add.
 */
import { describe, expect, it } from 'vitest';

import {
  CEE_ANALYSIS_OWNED_ROOTS_FOR_TEST,
  PIPELINE_OWNED_ROOTS,
  STRIPPABLE_OWNED_ROOTS_FOR_TEST,
  stripPipelineOwnedFromAddOperations,
} from '../field-safety.js';
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

describe('(d) J2: a model op naming `std_defaulted` never reaches the graph', () => {
  it('⭐ RED: it is a CEE-owned edge root (and strippable — a stamp, not data)', () => {
    expect(CEE_ANALYSIS_OWNED_ROOTS_FOR_TEST).toContain('std_defaulted');
    expect(PIPELINE_OWNED_ROOTS.has('std_defaulted')).toBe(true);
    expect(STRIPPABLE_OWNED_ROOTS_FOR_TEST).toContain('std_defaulted');
  });

  it('⭐ RED: a direct `update_edge_field` write of it is refused PIPELINE_OWNED_FIELD', () => {
    const v = edgeUpdate('std_defaulted', false);
    expect(v.verdict).toBe('rejected');
    expect(v.blocker?.code).toBe(PIPELINE_OWNED_FIELD);
  });

  it('⭐ RED: smuggled inside the `strength` payload, it is refused', () => {
    const v = edgeUpdate('strength', { mean: 0.5, std: 0.1, std_defaulted: false });
    expect(v.verdict).toBe('rejected');
    expect(v.blocker?.code).toBe(PIPELINE_OWNED_FIELD);
  });

  it('⭐ RED: carried on an `add_node` value, it is STRIPPED (the add lands without it)', () => {
    const ops = [{ op: 'add_node', path: 'n-new', value: { id: 'n-new', kind: 'factor', label: 'L', meta: { std_defaulted: true } } }];
    const { operations, strippedKeyShapes } = stripPipelineOwnedFromAddOperations(ops);
    expect(operations[0]!.value).toStrictEqual({ id: 'n-new', kind: 'factor', label: 'L', meta: {} });
    // The model-authored `meta` segment is masked; the owned segment is named (the redaction contract).
    expect(strippedKeyShapes).toStrictEqual(['*/std_defaulted']);
  });

  it('CONTRAST: `strength.std` itself stays a tunable edge field (the flag, not the value, is owned)', () => {
    const v = edgeUpdate('strength', { mean: 0.5, std: 0.1 });
    expect(v.blocker?.code).not.toBe(PIPELINE_OWNED_FIELD);
    expect(v.verdict).not.toBe('rejected');
  });
});
