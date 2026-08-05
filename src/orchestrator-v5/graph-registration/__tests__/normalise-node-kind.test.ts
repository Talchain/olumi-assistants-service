/**
 * ROADMAP 2.467c — the `kind`/`type` node-field pair.
 *
 * FIXTURE PROVENANCE, stated because it changes what these tests are worth.
 * `fixtures/walk-import-modified.wire.json` is DERIVED MECHANICALLY from the
 * file a real browser actually imported during the 5 Aug P0 witness walk
 * (`PHASE0-EVIDENCE-2026-07-28/walk-p0-witness-raw/import-modified.json` — 14
 * nodes, 32 edges, the `ZZZ IMPORTED OPTION` sentinel on `opt_alpha`), projected
 * to CEE's wire spelling by the same rules the UI's live canvas→CEE mapper
 * uses. Its ids, kinds, labels and edge endpoints are the producer's, not mine.
 * The DIVERGENT variant is the only hand-made input here, and it is hand-made
 * on purpose: no captured file diverges, because the UI's own snapshot
 * normaliser writes both spellings to the same value — the divergence this
 * module refuses arrives from a hand-edited or third-party file, which is
 * exactly why it must be refused rather than assumed impossible.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  normaliseGraphNodeKindField,
  type NodeKindNormalisationOk,
  type NodeKindNormalisationRefused,
} from '../normalise-node-kind.js';



type WireNode = { id: string; kind?: unknown; type?: unknown; label?: string };

// Read the fixture via fs rather than a `with { type: 'json' }` import
// attribute: the full tsconfig (module=Node16, the typecheck-drift ratchet's
// config) rejects import attributes with TS2823, and this file must stay OUT
// of the frozen error baseline. Copied from the precedent this repo already
// wrote down at `orchestrator-v5/tools/handlers/__tests__/run-analysis-brief-to-plot.test.ts`.
const WALK_IMPORT_WIRE = JSON.parse(
  readFileSync(new URL('./fixtures/walk-import-modified.wire.json', import.meta.url), 'utf8'),
) as { nodes: WireNode[]; edges: Array<Record<string, unknown>> };

function nodesOf(graph: unknown): WireNode[] {
  return (graph as { nodes: WireNode[] }).nodes;
}

function okOf(result: ReturnType<typeof normaliseGraphNodeKindField>): NodeKindNormalisationOk {
  if (!result.ok) throw new Error(`expected ok, got refusal: ${result.reason}`);
  return result;
}

function refusalOf(
  result: ReturnType<typeof normaliseGraphNodeKindField>,
): NodeKindNormalisationRefused {
  if (result.ok) throw new Error('expected a refusal, got ok');
  return result;
}

/** The captured graph, with `type` re-attached alongside `kind` at the SAME value. */
function withAgreeingTypeField(): unknown {
  return {
    ...WALK_IMPORT_WIRE,
    nodes: nodesOf(WALK_IMPORT_WIRE).map((n) => ({ ...n, type: n.kind })),
  };
}

/** The captured graph, with `type` re-attached DISAGREEING on exactly one node. */
function withDivergentTypeField(divergentNodeId: string, wrongKind: string): unknown {
  return {
    ...WALK_IMPORT_WIRE,
    nodes: nodesOf(WALK_IMPORT_WIRE).map((n) => ({
      ...n,
      type: n.id === divergentNodeId ? wrongKind : n.kind,
    })),
  };
}

describe('normaliseGraphNodeKindField — the captured import file', () => {
  it('POSITIVE CONTROL: the captured file really does carry the sentinel and 14 kind-bearing nodes', () => {
    // Trap 13: every absence assertion below ("no `type` survives") is worthless
    // unless the fixture could have carried one. This pins what the fixture IS.
    const nodes = nodesOf(WALK_IMPORT_WIRE);
    expect(nodes).toHaveLength(14);
    expect(nodes.every((n) => typeof n.kind === 'string' && n.kind.length > 0)).toBe(true);
    const sentinel = nodes.find((n) => n.id === 'opt_alpha');
    expect(sentinel?.label).toBe('ZZZ IMPORTED OPTION');
    expect(sentinel?.kind).toBe('option');
  });

  it('passes a kind-only graph through UNCHANGED, by reference', () => {
    const result = okOf(normaliseGraphNodeKindField(WALK_IMPORT_WIRE));
    expect(result.changedNodeCount).toBe(0);
    // Same reference — a caller that normalises twice cannot tell.
    expect(result.graph).toBe(WALK_IMPORT_WIRE);
  });

  it('DROPS a redundant agreeing `type` from every node, leaving exactly one spelling', () => {
    const input = withAgreeingTypeField();
    // Positive control on the input itself: it really does carry `type`.
    expect(nodesOf(input).every((n) => typeof n.type === 'string')).toBe(true);

    const result = okOf(normaliseGraphNodeKindField(input));
    expect(result.changedNodeCount).toBe(14);
    const out = nodesOf(result.graph);
    expect(out.every((n) => !('type' in n))).toBe(true);
    // Bound by IDENTITY, not by a value predicate another node could satisfy:
    // this asserts about opt_alpha specifically.
    const sentinel = out.find((n) => n.id === 'opt_alpha');
    expect(sentinel?.kind).toBe('option');
    expect(sentinel?.label).toBe('ZZZ IMPORTED OPTION');
  });

  it('FOLDS a type-only node into `kind` and drops `type`', () => {
    const input = {
      ...WALK_IMPORT_WIRE,
      nodes: nodesOf(WALK_IMPORT_WIRE).map(({ kind, ...rest }) => ({ ...rest, type: kind })),
    };
    expect(nodesOf(input).every((n) => !('kind' in n))).toBe(true);

    const result = okOf(normaliseGraphNodeKindField(input));
    expect(result.changedNodeCount).toBe(14);
    const out = nodesOf(result.graph);
    expect(out.every((n) => !('type' in n))).toBe(true);
    expect(out.find((n) => n.id === 'opt_alpha')?.kind).toBe('option');
    expect(out.find((n) => n.id === 'goal_turnout')?.kind).toBe('goal');
  });

  it('REFUSES a divergent-field file and names the offending node BY ID', () => {
    const input = withDivergentTypeField('opt_alpha', 'factor');
    const refusal = refusalOf(normaliseGraphNodeKindField(input));
    expect(refusal.reason).toBe('divergent_node_kind');
    expect(refusal.nodeIds).toEqual(['opt_alpha']);
  });

  it('DISCRIMINATING PAIR: diverging a DIFFERENT node names THAT node, not opt_alpha', () => {
    // Half two of the pair (trap 19's technique): the refusal is bound to the
    // node that actually diverged, not to "some node somewhere".
    const refusal = refusalOf(
      normaliseGraphNodeKindField(withDivergentTypeField('goal_turnout', 'risk')),
    );
    expect(refusal.nodeIds).toEqual(['goal_turnout']);
    expect(refusal.nodeIds).not.toContain('opt_alpha');
  });

  it('reports EVERY divergent node, capped at 10', () => {
    const input = {
      ...WALK_IMPORT_WIRE,
      nodes: nodesOf(WALK_IMPORT_WIRE).map((n) => ({ ...n, type: 'factor' })),
    };
    const refusal = refusalOf(normaliseGraphNodeKindField(input));
    // 13 of the 14 diverge (the four `factor` nodes agree), capped at 10.
    expect(refusal.nodeIds).toHaveLength(10);
    expect(refusal.nodeIds).toContain('opt_alpha');
  });

  it('REFUSES a node with neither spelling, with a DISTINCT reason', () => {
    const input = {
      ...WALK_IMPORT_WIRE,
      nodes: nodesOf(WALK_IMPORT_WIRE).map((n) =>
        n.id === 'fac_weather' ? { id: n.id, label: n.label } : n,
      ),
    };
    const refusal = refusalOf(normaliseGraphNodeKindField(input));
    expect(refusal.reason).toBe('missing_node_kind');
    expect(refusal.nodeIds).toEqual(['fac_weather']);
  });

  it('reports DIVERGENCE ahead of ABSENCE when a graph has both', () => {
    const input = {
      ...WALK_IMPORT_WIRE,
      nodes: nodesOf(WALK_IMPORT_WIRE).map((n) => {
        if (n.id === 'opt_alpha') return { ...n, type: 'factor' };
        if (n.id === 'fac_weather') return { id: n.id, label: n.label };
        return n;
      }),
    };
    const refusal = refusalOf(normaliseGraphNodeKindField(input));
    expect(refusal.reason).toBe('divergent_node_kind');
  });
});

describe('normaliseGraphNodeKindField — shapes it must not judge', () => {
  it.each([
    ['null', null],
    ['a string', 'not a graph'],
    ['an array', [1, 2, 3]],
    ['an object with no nodes array', { edges: [] }],
    ['an object whose nodes is not an array', { nodes: 'nope' }],
  ])('returns %s unchanged rather than becoming a second validator', (_label, input) => {
    const result = okOf(normaliseGraphNodeKindField(input));
    expect(result.graph).toBe(input);
    expect(result.changedNodeCount).toBe(0);
  });

  it('leaves a non-object node entry alone (the schema parse refuses it, not this)', () => {
    const input = { nodes: [null, 'x', { id: 'a', kind: 'goal' }] };
    const result = okOf(normaliseGraphNodeKindField(input));
    expect(result.changedNodeCount).toBe(0);
    expect(result.graph).toBe(input);
  });

  it('treats a whitespace-only spelling as ABSENT, not as a value', () => {
    const input = { nodes: [{ id: 'a', kind: '   ', type: 'goal' }] };
    const result = okOf(normaliseGraphNodeKindField(input));
    expect(nodesOf(result.graph)[0]).toEqual({ id: 'a', kind: 'goal' });
  });

  it('trims a padded spelling so the stored value is canonical', () => {
    const input = { nodes: [{ id: 'a', type: ' goal ' }] };
    const result = okOf(normaliseGraphNodeKindField(input));
    expect(nodesOf(result.graph)[0]).toEqual({ id: 'a', kind: 'goal' });
  });

  it('never mutates its input', () => {
    const input = withAgreeingTypeField();
    const before = JSON.stringify(input);
    normaliseGraphNodeKindField(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('preserves every non-kind field on a rewritten node', () => {
    const input = {
      nodes: [{ id: 'a', type: 'goal', label: 'L', observed_state: { value: 3 }, extra: true }],
    };
    const result = okOf(normaliseGraphNodeKindField(input));
    expect(nodesOf(result.graph)[0]).toEqual({
      id: 'a',
      kind: 'goal',
      label: 'L',
      observed_state: { value: 3 },
      extra: true,
    });
  });

  it('falls back to a positional label when a divergent node has no id', () => {
    const input = { nodes: [{ kind: 'goal', type: 'risk' }] };
    const refusal = refusalOf(normaliseGraphNodeKindField(input));
    expect(refusal.nodeIds).toEqual(['#0']);
  });
});
