import { describe,expect,it } from 'vitest';


import type { GraphStateIngress } from '../../boundary/request-extensions.js';
import {
compactGraphForContextPack,
compactSelectedGraphForContextPack,
} from '../compact-graph-for-contextpack.js';
import type { ContextGraphSelection } from '../context-graph-snapshot.js';

















describe('canonical baseline-option continuity', () => {


  it('leaves structural-fallback baseline transport byte-equivalent to the prior path', () => {
    const outcome = compactGraphForContextPack(
      {
        nodes: [
          {
            id: 'opt_current',
            kind: 'option',
            label: 'Current arrangement',
            is_baseline: false,
            data: { is_baseline: true },
          },
          { id: 'goal_growth', kind: 'goal', label: 'Sustainable growth' },
        ],
        // Missing strict GraphV3 edge fields deliberately selects the legacy
        // structural fallback. That path must not acquire the strict-parser
        // recovery introduced by this change.
        edges: [{ from: 'opt_current', to: 'goal_growth' }],
      } as GraphStateIngress,
      { requestId: 'req-baseline-structural-fallback' },
    );
    expect(outcome.kind).toBe('compacted');
    if (outcome.kind !== 'compacted') throw new Error('expected compacted graph');
    expect(outcome.via).toBe('structural_fallback');
    expect(outcome.compact.nodes.find((node) => node.id === 'opt_current')).not.toHaveProperty(
      'is_baseline',
    );
  });

  // The pin above calls the inner compactor directly. Post-#1147 the production
  // ContextPack entrypoint is the selector-aware wrapper, which owns the freeze
  // and attestation, so a change that re-derives or bypasses the inner fallback
  // at that boundary would leave the pin above green. Fixture carries a literal
  // top-level `is_baseline: true` on an option node so the strip genuinely fires
  // rather than passing vacuously.
  it('keeps the production ContextPack entrypoint baseline-neutral on the structural fallback', () => {
    const graph = {
      nodes: [
        {
          id: 'opt_current',
          kind: 'option',
          label: 'Current arrangement',
          is_baseline: true,
        },
        { id: 'goal_growth', kind: 'goal', label: 'Sustainable growth' },
      ],
      // Missing strict GraphV3 edge fields deliberately selects the legacy
      // structural fallback through the wrapper as well.
      edges: [{ from: 'opt_current', to: 'goal_growth' }],
    } as unknown as GraphStateIngress;

    const selection: ContextGraphSelection = {
      status: 'canonical',
      graph,
      reason: 'persisted_valid',
    };

    const outcome = compactSelectedGraphForContextPack(selection, {
      requestId: 'req-baseline-structural-fallback-entrypoint',
    });

    expect(outcome.kind).toBe('compacted');
    if (outcome.kind !== 'compacted') throw new Error('expected compacted graph');
    expect(outcome.via).toBe('structural_fallback');
    expect(outcome.compact.nodes.find((node) => node.id === 'opt_current')).not.toHaveProperty(
      'is_baseline',
    );
  });

  it('pins the exact pre-feature structural-fallback bytes for every marker source', () => {
    const outcome = compactGraphForContextPack(
      {
        nodes: [
          {
            id: 'dup',
            kind: 'option',
            label: 'First',
            is_baseline: false,
            data: { is_baseline: true },
          },
          {
            id: 'dup',
            kind: 'option',
            label: 'Second',
            is_baseline: true,
            data: { is_baseline: false },
          },
          {
            id: 'factor',
            kind: 'factor',
            label: 'Factor',
            data: { is_baseline: true },
          },
        ],
        // Deliberately malformed for strict GraphV3: fallback authority must
        // not change even with duplicate IDs and conflicting marker sources.
        edges: [{ from: 'dup', to: 'factor' }],
        options: [
          {
            id: 'dup',
            label: 'Raw winner',
            is_baseline: true,
            rank: 1,
          },
        ],
      } as GraphStateIngress,
      { requestId: 'req-baseline-fallback-exact-bytes' },
    );

    expect(outcome).toEqual({
      kind: 'compacted',
      compact: {
        nodes: [
          {
            id: 'dup',
            kind: 'option',
            label: 'First',
            source: 'system',
            provenance: 'ai_inferred',
            // Structural reachability is emitted on every option node,
            // empty set included. Declared here so this exhaustive `toEqual`
            // keeps its second job: failing loud on ANY unexpected field.
            reaches: ['factor'],
          },
          {
            id: 'dup',
            kind: 'option',
            label: 'Second',
            source: 'system',
            provenance: 'ai_inferred',
            reaches: ['factor'],
          },
          {
            id: 'factor',
            kind: 'factor',
            label: 'Factor',
            source: 'system',
            provenance: 'ai_inferred',
          },
        ],
        edges: [
          {
            from: 'dup',
            to: 'factor',
            strength: 0,
            exists: 1,
            provenance: 'ai_inferred',
          },
        ],
        _node_count: 3,
        _edge_count: 1,
      },
      via: 'structural_fallback',
    });
  });



  it('fails weak when the raw and parsed positions no longer identify the same node', () => {
    const first = [
      {
        id: 'opt_marked',
        kind: 'option',
        label: 'Marked option',
        is_baseline: false,
        data: { is_baseline: true },
      },
      { id: 'opt_other', kind: 'option', label: 'Other option' },
    ];
    const reversed = [...first].reverse();
    let reads = 0;
    const graph = {
      get nodes() {
        reads += 1;
        return reads === 1 ? first : reversed;
      },
      edges: [],
    } as unknown as GraphStateIngress;
    const outcome = compactGraphForContextPack(graph, {
      requestId: 'req-baseline-position-mismatch',
    });
    expect(outcome.kind).toBe('compacted');
    if (outcome.kind !== 'compacted') throw new Error('expected compacted graph');
    expect(outcome.via).toBe('strict_parse');
    expect(outcome.compact.nodes.every((node) => node.is_baseline !== true)).toBe(true);
  });












});
