/**
 * Lane 32 (ROADMAP 1.34) — intra-batch referee sequencing.
 *
 * Live defect (REPRODUCED 2026-07-07, scenario 2cd44277-3c53-4d15-8bb4-3f222eef96a1,
 * turn 106157e0-fe20-4903-9b9b-95b93625005a; spec of record:
 * acceptance-evidence/gm-mm/02-intra-batch-entity-not-found-repro.md):
 * `refereeMutationBatch` judged every envelope against the PRE-edit frame graph,
 * so the commonest structural edit — "add a factor and wire it in" (1 add_node +
 * 5 add_edge referencing the new node) — had all 5 edges rejected
 * ENTITY_NOT_FOUND and the governing verdict became `rejected`, while CEE's own
 * edit pipeline validated and applied the identical batch
 * (outcome:"success", operations_count:6). Live mode would wholesale-block it.
 *
 * Acceptance (per the spec):
 *  - the 6-op live-repro batch yields held STRUCTURAL_APPLY_HELD on ALL 6
 *    envelopes, zero ENTITY_NOT_FOUND, base_hash_match true throughout;
 *  - a batch referencing a genuinely absent node still rejects
 *    ENTITY_NOT_FOUND (negative control);
 *  - single-envelope batches keep byte-identical verdict semantics (pin).
 */
import { describe, expect, it, vi } from 'vitest';

import { refereeMutation, refereeMutationBatch } from '../referee.js';
import {
  ENTITY_NOT_FOUND,
  ENTITY_ID_COLLISION,
  ENGINE_CLAIM_IN_TEXT,
  SCHEMA_INVALID,
  STRUCTURAL_APPLY_HELD,
  TUNABLE_APPLY_HELD,
} from '../reason-codes.js';
import { buildReadyGraph, frameFor, hashOf, makeEnvelope } from './fixtures.js';
import { evaluateEditGraphMutations } from '../../handlers/edit-graph-referee-gate.js';
import * as telemetry from '../../../utils/telemetry.js';

const G = buildReadyGraph();
const H = hashOf(G);

/** The factor added intra-batch (live id shape: fac_client_referral_rate). */
const NEW_FACTOR_ID = 'fac_client_referral_rate';

const addNode = (id: string, label = 'Client Referral Rate') =>
  makeEnvelope('add_node', { node: { id, kind: 'factor', label } }, { base_graph_hash: H });
const addEdge = (from: string, to: string) =>
  makeEnvelope('add_edge', { edge: { from, to } }, { base_graph_hash: H });

/**
 * THE live-repro batch shape: add_node + 5 add_edge, every edge referencing
 * the node that exists only intra-batch (new factor → outcome, and each
 * option/factor wired to the new factor).
 */
function liveReproBatch(): unknown[] {
  return [
    addNode(NEW_FACTOR_ID),
    addEdge(NEW_FACTOR_ID, 'g-profit'),
    addEdge('o-a', NEW_FACTOR_ID),
    addEdge('o-b', NEW_FACTOR_ID),
    addEdge('f-spend', NEW_FACTOR_ID),
    addEdge('f-reach', NEW_FACTOR_ID),
  ];
}

describe('intra-batch sequencing — the live-repro acceptance (spec 02, §"Expected shape of the fix")', () => {
  it('add-factor-with-links batch (1 add_node + 5 add_edge) → held STRUCTURAL_APPLY_HELD on ALL 6, zero ENTITY_NOT_FOUND', () => {
    const vs = refereeMutationBatch(liveReproBatch(), G, frameFor(G));
    expect(vs).toHaveLength(6);
    expect(vs.map((v) => v.verdict)).toEqual(Array(6).fill('held'));
    expect(vs.map((v) => v.blocker?.code)).toEqual(Array(6).fill(STRUCTURAL_APPLY_HELD));
    expect(vs.some((v) => v.blocker?.code === ENTITY_NOT_FOUND)).toBe(false);
  });

  it('base_hash_match stays true on every envelope — sequencing advances the graph VIEW, never the frame (anti-rederivation)', () => {
    const vs = refereeMutationBatch(liveReproBatch(), G, frameFor(G));
    expect(vs.every((v) => v.base_hash_match)).toBe(true);
  });

  it('gate-level: the live-repro op batch governs held (not rejected) — live mode would hold-for-confirm, not wholesale-block', () => {
    const emitSpy = vi.spyOn(telemetry, 'emit').mockImplementation(() => {});
    try {
      const decision = evaluateEditGraphMutations({
        mode: 'live',
        operations: [
          { op: 'add_node', path: NEW_FACTOR_ID, value: { id: NEW_FACTOR_ID, kind: 'factor', label: 'Client Referral Rate' } },
          { op: 'add_edge', path: `${NEW_FACTOR_ID}::g-profit`, value: { from: NEW_FACTOR_ID, to: 'g-profit' } },
          { op: 'add_edge', path: `o-a::${NEW_FACTOR_ID}`, value: { from: 'o-a', to: NEW_FACTOR_ID } },
          { op: 'add_edge', path: `o-b::${NEW_FACTOR_ID}`, value: { from: 'o-b', to: NEW_FACTOR_ID } },
          { op: 'add_edge', path: `f-spend::${NEW_FACTOR_ID}`, value: { from: 'f-spend', to: NEW_FACTOR_ID } },
          { op: 'add_edge', path: `f-reach::${NEW_FACTOR_ID}`, value: { from: 'f-reach', to: NEW_FACTOR_ID } },
        ],
        currentGraph: G,
        currentGraphHash: H,
        baseGraphHash: H,
        freshness: 'fresh',
        scenarioId: 'scn-lane32',
        turnId: 'turn-lane32',
        requestId: 'req-lane32',
      });
      expect(decision.governing).toBe('held');
      expect(decision.verdictCounts.rejected ?? 0).toBe(0);
      expect(decision.verdictCounts.held).toBe(6);
    } finally {
      emitSpy.mockRestore();
    }
  });
});

describe('negative controls — genuinely absent references STILL reject ENTITY_NOT_FOUND', () => {
  it('an edge to a node absent from BOTH the graph and the batch → rejected ENTITY_NOT_FOUND', () => {
    const vs = refereeMutationBatch(
      [addNode('fac_x', 'Factor X'), addEdge('fac_x', 'no-such-node')],
      G,
      frameFor(G),
    );
    expect(vs[0]!.verdict).toBe('held');
    expect(vs[1]!.verdict).toBe('rejected');
    expect(vs[1]!.blocker?.code).toBe(ENTITY_NOT_FOUND);
  });

  it('order-faithful: an edge BEFORE the add_node that introduces its endpoint → rejected ENTITY_NOT_FOUND (matches pipeline apply order)', () => {
    const vs = refereeMutationBatch(
      [addEdge('o-a', 'fac_x'), addNode('fac_x', 'Factor X')],
      G,
      frameFor(G),
    );
    expect(vs[0]!.verdict).toBe('rejected');
    expect(vs[0]!.blocker?.code).toBe(ENTITY_NOT_FOUND);
    expect(vs[1]!.verdict).toBe('held');
  });

  it('entities from a REJECTED envelope never materialise: engine-claim add_node → its dependent edge still rejects ENTITY_NOT_FOUND', () => {
    const vs = refereeMutationBatch(
      [addNode('fac_evpi', 'EVPI of switching'), addEdge('o-a', 'fac_evpi')],
      G,
      frameFor(G),
    );
    expect(vs[0]!.verdict).toBe('rejected');
    expect(vs[0]!.blocker?.code).toBe(ENGINE_CLAIM_IN_TEXT);
    expect(vs[1]!.verdict).toBe('rejected');
    expect(vs[1]!.blocker?.code).toBe(ENTITY_NOT_FOUND);
  });

  it('a second add_node with the SAME intra-batch id → rejected ENTITY_ID_COLLISION (the sequenced view is authoritative)', () => {
    const vs = refereeMutationBatch(
      [addNode('fac_x', 'Factor X'), addNode('fac_x', 'Factor X duplicate')],
      G,
      frameFor(G),
    );
    expect(vs[0]!.verdict).toBe('held');
    expect(vs[1]!.verdict).toBe('rejected');
    expect(vs[1]!.blocker?.code).toBe(ENTITY_ID_COLLISION);
  });
});

describe('other kinds see prior intra-batch entities', () => {
  it('update_node_field on an intra-batch-added node → held TUNABLE_APPLY_HELD (not ENTITY_NOT_FOUND)', () => {
    const vs = refereeMutationBatch(
      [
        addNode('fac_x', 'Factor X'),
        makeEnvelope(
          'update_node_field',
          { node_id: 'fac_x', field: 'description', from: undefined, to: 'Added this turn' },
          { base_graph_hash: H },
        ),
      ],
      G,
      frameFor(G),
    );
    expect(vs[1]!.verdict).toBe('held');
    expect(vs[1]!.blocker?.code).toBe(TUNABLE_APPLY_HELD);
  });

  it('add_option targeting an intra-batch-added factor → held (linkage integrity passes), not ENTITY_NOT_FOUND', () => {
    const vs = refereeMutationBatch(
      [
        addNode('fac_x', 'Factor X'),
        makeEnvelope(
          'add_option',
          { option: { id: 'o-c', label: 'Plan C', parent_decision_id: 'd-choice', edges: [{ to_factor_id: 'fac_x' }] } },
          { base_graph_hash: H },
        ),
      ],
      G,
      frameFor(G),
    );
    expect(vs[1]!.verdict).toBe('held');
    expect(vs[1]!.blocker?.code).not.toBe(ENTITY_NOT_FOUND);
  });

  it('rename of an intra-batch-added node resolves against the sequenced view (SAFE: the defining add_node is held, so the batch can never govern proceed)', () => {
    const vs = refereeMutationBatch(
      [
        addNode('fac_x', 'Factor X'),
        makeEnvelope('rename_node', { node_id: 'fac_x', to_label: 'Factor X renamed' }, { base_graph_hash: H }),
      ],
      G,
      frameFor(G),
    );
    expect(vs[0]!.verdict).toBe('held');
    // The rename is judged against the view containing fac_x — NOT ENTITY_NOT_FOUND.
    expect(vs[1]!.blocker?.code).not.toBe(ENTITY_NOT_FOUND);
    expect(vs[1]!.verdict).not.toBe('rejected');
  });
});

describe('pins — semantics preserved outside the sequencing seam', () => {
  it('single-envelope batch is byte-identical to refereeMutation (rejected case)', () => {
    const raw = makeEnvelope(
      'add_edge',
      { edge: { from: 'f-spend', to: 'no-such-node' } },
      { base_graph_hash: H, candidate_id: '11111111-1111-4111-8111-111111111111' },
    );
    expect(refereeMutationBatch([raw], G, frameFor(G))).toEqual([refereeMutation(raw, G, frameFor(G))]);
  });

  it('single-envelope batch is byte-identical to refereeMutation (held case)', () => {
    const raw = makeEnvelope(
      'add_edge',
      { edge: { from: 'f-spend', to: 'g-profit' } },
      { base_graph_hash: H, candidate_id: '22222222-2222-4222-8222-222222222222' },
    );
    expect(refereeMutationBatch([raw], G, frameFor(G))).toEqual([refereeMutation(raw, G, frameFor(G))]);
  });

  it('TOTALITY: a throwing slot mid-batch is classified AND later envelopes still see earlier entities', () => {
    const arr: unknown[] = [addNode('fac_x', 'Factor X'), undefined, addEdge('o-a', 'fac_x')];
    Object.defineProperty(arr, '1', {
      get() {
        throw new Error('boom');
      },
      enumerable: true,
      configurable: true,
    });
    let vs: ReturnType<typeof refereeMutationBatch> | undefined;
    expect(() => {
      vs = refereeMutationBatch(arr, G, frameFor(G));
    }).not.toThrow();
    expect(vs).toHaveLength(3);
    expect(vs![0]!.verdict).toBe('held');
    expect(vs![1]!.verdict).toBe('rejected');
    expect(vs![1]!.blocker?.code).toBe(SCHEMA_INVALID);
    expect(vs![2]!.verdict).toBe('held');
    expect(vs![2]!.blocker?.code).toBe(STRUCTURAL_APPLY_HELD);
  });
});
