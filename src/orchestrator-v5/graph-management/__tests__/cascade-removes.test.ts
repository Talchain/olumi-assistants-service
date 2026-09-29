/**
 * Cascade-redundant remove_edge elision (P0, 2026-08-16).
 *
 * The helper guards TWO OPPOSITE HARMS and therefore needs a twin in each
 * direction (CLAUDE.md trap 22b): eliding too little re-opens the P0 (a
 * confirmed deletion is refused); eliding too much turns a genuinely
 * un-appliable batch into a silent partial apply. Every case below names
 * which side it pins.
 */

import { describe, expect, it } from 'vitest';

import { elideCascadeRedundantRemoveEdges } from '../cascade-removes.js';
import { confirmationSatisfies, executeGmHeldResume } from '../../handlers/gm-held-execute.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { PatchOperationsArraySchema } from '../../../orchestrator/patch-validation.js';

function armEdge(from: string, to: string) {
  return {
    from,
    to,
    strength: { mean: 0.5, std: 0.1 },
    exists_probability: 0.9,
    effect_direction: 'positive' as const,
  };
}

/** Note: there is deliberately NO `opt-a`→`fac-2` edge — the phantom target. */
const ARM_GRAPH = {
  nodes: [
    { id: 'opt-a', kind: 'option', label: 'Option A' },
    { id: 'opt-e', kind: 'option', label: 'Option E' },
    { id: 'goal-g', kind: 'goal', label: 'Goal' },
    { id: 'fac-1', kind: 'factor', label: 'Factor One' },
    { id: 'fac-2', kind: 'factor', label: 'Factor Two' },
  ],
  edges: [
    armEdge('opt-a', 'fac-1'),
    armEdge('opt-e', 'fac-1'),
    armEdge('fac-1', 'goal-g'),
    armEdge('fac-2', 'goal-g'),
  ],
};

const remove_node = (path: string) => ({ op: 'remove_node', path });
const remove_edge = (path: string) => ({ op: 'remove_edge', path });
const add_node = (path: string) => ({ op: 'add_node', path, value: { kind: 'option' } });
const add_edge = (path: string) => ({ op: 'add_edge', path, value: {} });
const update_node = (path: string) => ({ op: 'update_node', path, value: { label: 'x' } });

const paths = (ops: ReadonlyArray<{ op: string; path: string }>) =>
  ops.map((o) => `${o.op}:${o.path}`);

describe('elideCascadeRedundantRemoveEdges — elides exactly the cascade artefacts', () => {
  it('elides remove_edge ops the PRECEDING remove_node already cascaded (the P0 batch)', () => {
    const result = elideCascadeRedundantRemoveEdges([
      remove_node('opt-e'),
      remove_edge('opt-e::fac-1'),
      remove_edge('opt-e::fac-2'),
    ]);

    expect(paths(result.operations)).toEqual(['remove_node:opt-e']);
    expect(result.elidedEdgePaths).toEqual(['opt-e::fac-1', 'opt-e::fac-2']);
  });

  it('elides an incident edge in EITHER direction (the removed node as `to`)', () => {
    const result = elideCascadeRedundantRemoveEdges([
      remove_node('fac-1'),
      remove_edge('opt-a::fac-1'),
    ]);

    expect(paths(result.operations)).toEqual(['remove_node:fac-1']);
    expect(result.elidedEdgePaths).toEqual(['opt-a::fac-1']);
  });

  it('accepts the v2 `->` edge-path spelling as well as the canonical `::`', () => {
    const result = elideCascadeRedundantRemoveEdges([
      remove_node('opt-e'),
      remove_edge('opt-e->fac-1'),
    ]);

    expect(result.elidedEdgePaths).toEqual(['opt-e->fac-1']);
  });
});

describe('elideCascadeRedundantRemoveEdges — leaves everything else VERBATIM', () => {
  it('does NOT elide an edge removal that PRECEDES the node removal (already the working order)', () => {
    const input = [
      remove_edge('opt-e::fac-1'),
      remove_edge('opt-e::fac-2'),
      remove_node('opt-e'),
    ];
    const result = elideCascadeRedundantRemoveEdges(input);

    expect(paths(result.operations)).toEqual(paths(input));
    expect(result.elidedEdgePaths).toEqual([]);
  });

  it('does NOT elide an edge removal unrelated to any removed node (the b2 class)', () => {
    const input = [remove_node('opt-e'), remove_edge('opt-a::fac-2')];
    const result = elideCascadeRedundantRemoveEdges(input);

    // The un-appliable op survives so the applier can still refuse the batch.
    expect(paths(result.operations)).toEqual(paths(input));
    expect(result.elidedEdgePaths).toEqual([]);
  });

  it('does NOT elide after the node is RE-ADDED in the same batch', () => {
    const input = [
      remove_node('opt-e'),
      add_node('opt-e'),
      add_edge('opt-e::fac-1'),
      remove_edge('opt-e::fac-1'),
    ];
    const result = elideCascadeRedundantRemoveEdges(input);

    expect(paths(result.operations)).toEqual(paths(input));
    expect(result.elidedEdgePaths).toEqual([]);
  });

  it('does NOT elide a malformed edge path — the applier must judge it', () => {
    const input = [remove_node('opt-e'), remove_edge('opt-e-no-separator')];
    const result = elideCascadeRedundantRemoveEdges(input);

    expect(paths(result.operations)).toEqual(paths(input));
    expect(result.elidedEdgePaths).toEqual([]);
  });

  it('passes a batch with no remove_node through byte-identically', () => {
    const input = [update_node('fac-1'), remove_edge('opt-a::fac-1'), add_edge('opt-b::fac-2')];
    const result = elideCascadeRedundantRemoveEdges(input);

    expect(result.operations).toEqual(input);
    expect(result.elidedEdgePaths).toEqual([]);
  });

  it('preserves the order and identity of every surviving op', () => {
    const input = [
      update_node('fac-1'),
      remove_node('opt-e'),
      remove_edge('opt-e::fac-1'),
      remove_node('opt-d'),
      add_edge('opt-a::fac-2'),
    ];
    const result = elideCascadeRedundantRemoveEdges(input);

    expect(paths(result.operations)).toEqual([
      'update_node:fac-1',
      'remove_node:opt-e',
      'remove_node:opt-d',
      'add_edge:opt-a::fac-2',
    ]);
  });
});

/**
 * The confirm path's contract, pinned per verdict. This is the seam the P0 was
 * misdiagnosed at: the resume re-emits held telemetry, so the logs read as a
 * re-block while a governing `held` is in fact ACCEPTED by design. Pinning
 * every verdict explicitly means neither half can drift silently, and a new
 * verdict cannot be absorbed into the wrong bucket.
 */
describe('confirmationSatisfies — a matched confirmation answers its own change set, nothing more', () => {
  it('ACCEPTS a governing held: the confirmation-class postures are what a yes answers', () => {
    expect(confirmationSatisfies('held')).toBe(true);
  });

  it('ACCEPTS proceed: nothing blocked it', () => {
    expect(confirmationSatisfies('proceed')).toBe(true);
  });

  it('DECLINES stale: the graph moved, so the confirmation was for a base that is gone', () => {
    expect(confirmationSatisfies('stale')).toBe(false);
  });

  it('DECLINES rejected: a yes can never override an integrity or field-safety failure', () => {
    expect(confirmationSatisfies('rejected')).toBe(false);
  });

  it('DECLINES clarify_required: there is no mutation to confirm', () => {
    expect(confirmationSatisfies('clarify_required')).toBe(false);
  });

  it('fails closed on an unclassified verdict rather than defaulting to accept', () => {
    expect(confirmationSatisfies('some_future_verdict' as never)).toBe(false);
  });
});

/**
 * ARM DISCRIMINATION — which RUNG does each batch terminate at?
 *
 * The route-level suite can only observe "nothing persisted", which both the
 * referee arm and the applier arm produce. That makes it unable to tell them
 * apart, so the apply-level claims are pinned HERE, where
 * `GmHeldExecuteOutcome` names the rung explicitly.
 *
 * These also pin the elision's LOAD-BEARING UPSTREAM COUPLING (see the
 * cascade-removes.ts header): the elision is sound only because referee R3
 * rejects phantom edges before the applier ever sees them.
 */
describe('executeGmHeldResume — each batch terminates at the rung it should', () => {
  const hash = computeAnalysisAffectingGraphHash(ARM_GRAPH as never) ?? 'h';

  function resume(rawOps: unknown[]) {
    const parsed = PatchOperationsArraySchema.safeParse(rawOps);
    expect(parsed.success).toBe(true);
    return executeGmHeldResume({
      operations: parsed.data!,
      currentGraph: ARM_GRAPH,
      currentGraphHash: hash,
      freshness: 'none',
      hasExistingAnalysis: false,
      scenarioId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      turnId: 'turn-arm',
      requestId: 'req-arm',
    });
  }

  it('the P0 batch (node removal first) reaches the applier and EXECUTES', () => {
    const outcome = resume([
      { op: 'remove_node', path: 'opt-e' },
      { op: 'remove_edge', path: 'opt-e::fac-1' },
    ]);
    expect(outcome.status).toBe('executed');
  });

  it('a PHANTOM edge terminates at the REFEREE as rejected, never reaching the applier', () => {
    // 'opt-a::fac-2' names an edge that has never existed. R3 must reject it,
    // so the elision can never be handed an op whose absence is not a cascade
    // artefact. Bound to the referee's own verdict, not to "nothing happened".
    const outcome = resume([{ op: 'remove_edge', path: 'opt-a::fac-2' }]);
    expect(outcome.status).toBe('referee_blocked');
    expect(outcome.status === 'referee_blocked' && outcome.governing).toBe('rejected');
  });

  it('a genuine APPLY-level failure that is NOT a cascade artefact still declines at the applier', () => {
    // Two removals of the SAME node: the referee passes both (its batch view
    // deliberately does not subtract removes), so this reaches the applier and
    // the second throws NODE_NOT_FOUND. It is a remove_NODE, so the elision
    // never touches it — this is the case that proves the fix did not swallow
    // apply errors wholesale.
    const outcome = resume([
      { op: 'remove_node', path: 'opt-e' },
      { op: 'remove_node', path: 'opt-e' },
    ]);
    expect(outcome.status).toBe('apply_failed');
    expect(outcome.status === 'apply_failed' && outcome.reason).toBe('apply_error');
  });
});

describe('elideCascadeRedundantRemoveEdges — totality', () => {
  it('never throws on hostile op shapes and keeps them for the applier', () => {
    const hostile = [
      remove_node('opt-e'),
      { op: 'remove_edge', path: null as unknown as string },
      { op: 'remove_edge' } as unknown as { op: string; path: string },
      { op: 'wat', path: 'x' },
    ];

    const result = elideCascadeRedundantRemoveEdges(hostile);
    expect(result.operations).toHaveLength(4);
    expect(result.elidedEdgePaths).toEqual([]);
  });

  it('an empty batch is an empty batch', () => {
    const result = elideCascadeRedundantRemoveEdges([]);
    expect(result.operations).toEqual([]);
    expect(result.elidedEdgePaths).toEqual([]);
  });
});
