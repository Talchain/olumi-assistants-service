/**
 * Lane C3 / decision ③ — node↔options[] reconcile at the persist chokepoint.
 *
 * Pins (debit b): an option added as an option-NODE but missing from top-level
 * options[] is MIRRORED into options[] additively; an already-consistent graph
 * is a byte-identical no-op; existing entries are never modified/removed; a
 * malformed options field is left untouched.
 *
 * POSITIVE CONTROL: the "no-op on consistent graphs" claim is only meaningful
 * because the SAME function DOES change a divergent graph — the first test
 * proves the pass can SEE and repair a presence, so a later no-op is a real
 * no-op, not a dead function.
 *
 * MUTATION-CHECK (revert → RED): remove the `options.push(...)` in
 * `reconcileTopLevelOptionsFromNodes` and the "mirrored" assertions fail (the
 * divergence persists).
 */
import { describe, expect, it } from 'vitest';

import { reconcileTopLevelOptionsFromNodes } from '../reconcile-top-level-options.js';

function divergentGraph() {
  return {
    nodes: [
      { id: 'dec', kind: 'decision', label: 'D' },
      { id: 'opt_a', kind: 'option', label: 'A' },
      // opt_b is a node but NOT in options[] — the live divergence.
      {
        id: 'opt_b',
        kind: 'option',
        label: 'Outsource',
        interventions: {
          fac_x: { value: 0.55, source: 'user_specified', target_match: { node_id: 'fac_x', match_type: 'exact_id', confidence: 'high' } },
        },
      },
    ],
    options: [{ id: 'opt_a', label: 'A', status: 'ready', interventions: {} }],
  };
}

describe('reconcileTopLevelOptionsFromNodes — the mirror (debit b)', () => {
  it('POSITIVE CONTROL: mirrors an option-node missing from options[] (additive, non-mutating)', () => {
    const graph = divergentGraph();
    const out = reconcileTopLevelOptionsFromNodes(graph) as typeof graph;

    // A repaired clone (not the same reference), the original untouched.
    expect(out).not.toBe(graph);
    expect(graph.options).toHaveLength(1);

    expect(out.options).toHaveLength(2);
    const ids = out.options.map((o) => o.id).sort();
    expect(ids).toEqual(['opt_a', 'opt_b']);

    // The existing entry is preserved byte-for-byte.
    expect(out.options.find((o) => o.id === 'opt_a')).toEqual({
      id: 'opt_a',
      label: 'A',
      status: 'ready',
      interventions: {},
    });

    // The mirrored entry is derived faithfully from the node, and a configured
    // option (>=1 numeric value) is `ready`.
    const mirrored = out.options.find((o) => o.id === 'opt_b') as Record<string, unknown>;
    expect(mirrored.label).toBe('Outsource');
    expect(mirrored.status).toBe('ready');
    expect(mirrored.interventions).toEqual({
      fac_x: { value: 0.55, source: 'user_specified', target_match: { node_id: 'fac_x', match_type: 'exact_id', confidence: 'high' } },
    });
  });

  it('an UNCONFIGURED option-node (no numeric values) mirrors as needs_encoding', () => {
    const graph = {
      nodes: [
        { id: 'dec', kind: 'decision', label: 'D' },
        { id: 'opt_bare', kind: 'option', label: 'Bare', interventions: {} },
      ],
      options: [],
    };
    const out = reconcileTopLevelOptionsFromNodes(graph) as typeof graph;
    expect(out.options).toHaveLength(1);
    expect(out.options[0]).toMatchObject({ id: 'opt_bare', status: 'needs_encoding' });
  });

  it('preserves is_baseline when mirroring the status-quo option', () => {
    const graph = {
      nodes: [{ id: 'opt_sq', kind: 'option', label: 'Status quo', is_baseline: true, interventions: {} }],
      options: [],
    };
    const out = reconcileTopLevelOptionsFromNodes(graph) as typeof graph;
    expect(out.options[0]).toMatchObject({ id: 'opt_sq', is_baseline: true });
  });

  it('NO-OP on an already-consistent graph — returns the ORIGINAL reference', () => {
    const graph = {
      nodes: [
        { id: 'opt_a', kind: 'option', label: 'A', interventions: {} },
        { id: 'opt_b', kind: 'option', label: 'B', interventions: {} },
      ],
      options: [
        { id: 'opt_a', label: 'A', status: 'needs_encoding', interventions: {} },
        { id: 'opt_b', label: 'B', status: 'needs_encoding', interventions: {} },
      ],
    };
    const out = reconcileTopLevelOptionsFromNodes(graph);
    expect(out).toBe(graph); // byte-identical no-op
  });

  it('never REMOVES an options[] entry whose node was already gone (deletion is a different owner)', () => {
    const graph = {
      nodes: [{ id: 'opt_a', kind: 'option', label: 'A', interventions: {} }],
      // opt_stale has no node — deletion is mergeAppliedGraphForPersistence's job.
      options: [
        { id: 'opt_a', label: 'A', status: 'needs_encoding', interventions: {} },
        { id: 'opt_stale', label: 'Gone', status: 'ready', interventions: {} },
      ],
    };
    const out = reconcileTopLevelOptionsFromNodes(graph);
    // opt_a already present, opt_stale left alone → nothing to mirror → no-op.
    expect(out).toBe(graph);
  });

  it('NEVER INVENTS the field: an ABSENT options[] is left absent (decision ③ update-if-present)', () => {
    // An option-node with no top-level options[] array — the ruling says do NOT
    // grow one on this commit (that would violate the "no field invention" commit
    // invariant). No-op, original reference.
    const graph = { nodes: [{ id: 'opt_a', kind: 'option', label: 'A', interventions: {} }] };
    const out = reconcileTopLevelOptionsFromNodes(graph) as typeof graph & { options?: unknown };
    expect(out).toBe(graph);
    expect((out as { options?: unknown }).options).toBeUndefined();
  });

  it('leaves a malformed (non-array) options field untouched', () => {
    const graph = { nodes: [{ id: 'opt_a', kind: 'option', label: 'A' }], options: 'oops' };
    const out = reconcileTopLevelOptionsFromNodes(graph);
    expect(out).toBe(graph);
  });

  it('no-op / total on absent or hostile input', () => {
    expect(reconcileTopLevelOptionsFromNodes(null)).toBeNull();
    expect(reconcileTopLevelOptionsFromNodes(undefined)).toBeUndefined();
    expect(() => reconcileTopLevelOptionsFromNodes(42 as unknown)).not.toThrow();
    expect(() => reconcileTopLevelOptionsFromNodes({ nodes: 'x' } as unknown)).not.toThrow();
  });
});

/**
 * THE PROPAGATION GAP (superseding half of decision ③'s implementation).
 *
 * Decision ③ RULED "write-both NARROWLY — update-if-present at option-mutating
 * commits only, NEVER invent the field". The implementation delivered only the
 * APPEND half: an option-node already carrying an `options[]` entry was skipped
 * entirely, so a user's intervention write — which lands on the option NODE
 * (`encode-option-interventions.ts` → `node.interventions[fac]`) — never reached
 * the top-level `options[]` array that `projectSemanticAnalysisReadyFromGraph`
 * reads (`analysis-ready-helper.ts`, where `topLevelById.get(id)` WINS over the
 * node in BOTH branches). The value was never lost; it was never PROPAGATED.
 *
 * RED-FIRST: at pristine, `refreshes a STALE existing entry...` fails —
 * `out.options[0].interventions.fac_x` is `undefined` (the stale `{}` survives)
 * while the node carries the user's 0.55.
 *
 * PRECEDENCE, PINNED PER FIELD (not globally): for `interventions` ONLY, and
 * only PER FACTOR KEY, and only where the node's entry carries a usable numeric
 * value, the NODE is authoritative — that is the surface the user's write lands
 * on. Everything else about an existing entry is still untouched.
 */
describe('reconcileTopLevelOptionsFromNodes — propagation into EXISTING entries', () => {
  function staleEntryGraph() {
    return {
      nodes: [
        { id: 'dec', kind: 'decision', label: 'D' },
        {
          id: 'opt_a',
          kind: 'option',
          label: 'A',
          interventions: {
            fac_x: { value: 0.55, source: 'user_specified' },
          },
        },
        {
          id: 'opt_b',
          kind: 'option',
          label: 'B',
          interventions: {
            fac_x: { value: 0.11, source: 'user_specified' },
          },
        },
      ],
      options: [
        { id: 'opt_a', label: 'A', status: 'needs_encoding', interventions: {} },
        { id: 'opt_b', label: 'B', status: 'needs_encoding', interventions: {} },
      ],
    };
  }

  it("refreshes a STALE existing entry from its own node's interventions (the propagation gap)", () => {
    const graph = staleEntryGraph();
    const out = reconcileTopLevelOptionsFromNodes(graph) as typeof graph;

    // BIND BY IDENTITY: the (option_id, factor_id) pair, never a value predicate
    // another entry could satisfy — opt_b also carries a fac_x.
    const entryA = out.options.find((o) => o.id === 'opt_a');
    expect(entryA).toBeDefined();
    expect((entryA!.interventions as Record<string, { value: number }>).fac_x?.value).toBe(0.55);
  });

  it('DISCRIMINATING PAIR: each option gets its OWN value — never the other option\'s', () => {
    const graph = staleEntryGraph();
    const out = reconcileTopLevelOptionsFromNodes(graph) as typeof graph;

    const entryA = out.options.find((o) => o.id === 'opt_a');
    const entryB = out.options.find((o) => o.id === 'opt_b');
    const valA = (entryA!.interventions as Record<string, { value: number }>).fac_x?.value;
    const valB = (entryB!.interventions as Record<string, { value: number }>).fac_x?.value;

    // The whole point: a write must NEVER bind to the wrong option.
    expect(valA).toBe(0.55);
    expect(valB).toBe(0.11);
    expect(valA).not.toBe(valB);
  });

  it('THE INVERSION ASSERT: the option entry gains the value AND the node is not moved', () => {
    const graph = staleEntryGraph();
    const out = reconcileTopLevelOptionsFromNodes(graph) as typeof graph;

    const entryA = out.options.find((o) => o.id === 'opt_a');
    const nodeA = out.nodes.find((n) => n.id === 'opt_a') as {
      interventions: Record<string, { value: number }>;
    };
    // Both halves — the defect was an entity-level misresolution in which the
    // wrong entity moved. Assert the intended one moved and the node still
    // carries exactly what the user wrote.
    expect((entryA!.interventions as Record<string, { value: number }>).fac_x.value).toBe(0.55);
    expect(nodeA.interventions.fac_x.value).toBe(0.55);
  });

  it('NEVER DELETES: a factor present only in the existing entry is preserved', () => {
    const graph = {
      nodes: [
        {
          id: 'opt_a',
          kind: 'option',
          label: 'A',
          // The containment sweep in `normaliseOptionInterventionContract`
          // PASS 1 can legitimately empty a node bundle WITHOUT recovering the
          // value. A blanket "node wins" would destroy fac_keep here.
          interventions: { fac_new: { value: 7, source: 'user_specified' } },
        },
      ],
      options: [
        {
          id: 'opt_a',
          label: 'A',
          status: 'ready',
          interventions: { fac_keep: { value: 3, source: 'user_specified' } },
        },
      ],
    };
    const out = reconcileTopLevelOptionsFromNodes(graph) as typeof graph;
    const entry = out.options.find((o) => o.id === 'opt_a')!;
    const ivs = entry.interventions as Record<string, { value: number }>;
    expect(ivs.fac_keep.value).toBe(3); // preserved — union, not replacement
    expect(ivs.fac_new.value).toBe(7); // propagated
  });

  it('NEVER DEGRADES: a non-numeric node entry does not clobber a numeric existing value', () => {
    const graph = {
      nodes: [
        {
          id: 'opt_a',
          kind: 'option',
          label: 'A',
          interventions: { fac_x: { source: 'user_specified' } }, // no usable value
        },
      ],
      options: [
        {
          id: 'opt_a',
          label: 'A',
          status: 'ready',
          interventions: { fac_x: { value: 42, source: 'user_specified' } },
        },
      ],
    };
    const out = reconcileTopLevelOptionsFromNodes(graph) as typeof graph;
    const ivs = out.options.find((o) => o.id === 'opt_a')!.interventions as Record<
      string,
      { value: number }
    >;
    expect(ivs.fac_x.value).toBe(42);
  });

  it('promotes status needs_encoding → ready once a real value has propagated', () => {
    const graph = staleEntryGraph();
    const out = reconcileTopLevelOptionsFromNodes(graph) as typeof graph;
    expect(out.options.find((o) => o.id === 'opt_a')!.status).toBe('ready');
  });

  it('BYTE-IDENTICAL NO-OP survives: an already-propagated graph returns the ORIGINAL reference', () => {
    const graph = {
      nodes: [
        {
          id: 'opt_a',
          kind: 'option',
          label: 'A',
          interventions: { fac_x: { value: 0.55, source: 'user_specified' } },
        },
      ],
      options: [
        {
          id: 'opt_a',
          label: 'A',
          status: 'ready',
          // Same content, DIFFERENT key order — must not read as stale.
          interventions: { fac_x: { source: 'user_specified', value: 0.55 } },
        },
      ],
    };
    expect(reconcileTopLevelOptionsFromNodes(graph)).toBe(graph);
  });

  it('KNOWN-DROPPED SET member (1), asserted EXACTLY: an intervention the user REMOVED from the node is not un-mirrored', () => {
    // Honest gap, pinned so the suite REDs if the set grows OR shrinks. A key
    // deleted from the node bundle is indistinguishable here from a key the
    // PASS-1 containment sweep emptied, and destroying a real value is the
    // strictly worse error. Removal stays owned by whoever can tell them apart.
    const graph = {
      nodes: [{ id: 'opt_a', kind: 'option', label: 'A', interventions: {} }],
      options: [
        {
          id: 'opt_a',
          label: 'A',
          status: 'ready',
          interventions: { fac_removed: { value: 9, source: 'user_specified' } },
        },
      ],
    };
    const out = reconcileTopLevelOptionsFromNodes(graph) as typeof graph;
    const ivs = out.options.find((o) => o.id === 'opt_a')!.interventions as Record<string, unknown>;
    expect(Object.keys(ivs)).toEqual(['fac_removed']);
  });

  it('KNOWN-DROPPED SET member (2), asserted EXACTLY: a raw carrier for an UNENCODED factor is preserved', () => {
    // ⚠ The docstring previously named member (1) ALONE while claiming the set
    // was exact — a FALSE COMPLETENESS CLAIM. Member (2) is pinned here so the
    // pair is genuinely exact. A raw carrier whose factor the node has NOT
    // encoded is a real outstanding question, not staleness: clearing it would
    // silently drop a blocker the user still needs to answer.
    const graph = {
      nodes: [
        {
          id: 'opt_a',
          kind: 'option',
          label: 'A',
          // fac_encoded is answered; fac_open is NOT.
          interventions: { fac_encoded: { value: 0.4, source: 'user_specified' } },
        },
      ],
      options: [
        {
          id: 'opt_a',
          label: 'A',
          status: 'needs_encoding',
          interventions: {},
          raw_interventions: { fac_encoded: 'HubSpot', fac_open: 'Enterprise' },
        },
      ],
    };
    const out = reconcileTopLevelOptionsFromNodes(graph) as typeof graph;
    const entry = out.options.find((o) => o.id === 'opt_a')!;
    const raw = entry.raw_interventions as Record<string, unknown>;
    // EXACTLY the unencoded one survives — encoded cleared, open preserved.
    expect(Object.keys(raw)).toEqual(['fac_open']);
    // And the status is NOT promoted while a genuine raw carrier remains —
    // that would be the over-optimistic `ready` this module forbids, and
    // `graph-hash.ts:293` stops hashing raw_interventions once status is ready.
    expect(entry.status).toBe('needs_encoding');
  });

  it('still NEVER INVENTS the array while propagating (decision ③ half that stands)', () => {
    const graph = {
      nodes: [
        {
          id: 'opt_a',
          kind: 'option',
          label: 'A',
          interventions: { fac_x: { value: 1, source: 'user_specified' } },
        },
      ],
    };
    const out = reconcileTopLevelOptionsFromNodes(graph) as typeof graph & { options?: unknown };
    expect(out).toBe(graph);
    expect(out.options).toBeUndefined();
  });
});
