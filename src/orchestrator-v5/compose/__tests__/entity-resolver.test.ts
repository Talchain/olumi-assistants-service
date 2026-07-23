/**
 * Wave-4 δ1 — the ONE shared entity→node-id resolver (ROADMAP 1.202 + 1.135).
 *
 * Totality tests for the reverse (label → id) path, DERIVED from the forward
 * `GraphNodeLookup`. The forward id→ref path (used by the 1.202 directive
 * emitter) is unchanged and its own suite (`ui-directive-emit`, `graph-lookup-
 * fallback`) still covers it — this suite locks the fail-closed reverse rules:
 *   - duplicate normalised label  → AMBIGUOUS → unlinked (the required ruling);
 *   - bare-generic single word    → unlinked (over-match rail);
 *   - too-short / 1–2 char label  → unlinked;
 *   - distinctive multi-word      → linked;
 *   - miss (not in snapshot)      → unlinked.
 *
 * Ambiguity mutation-witness: reverting `buildLabelIndex` to last-writer-wins
 * (instead of the AMBIGUOUS sentinel) turns the duplicate-label assertions RED.
 */
import { describe, expect, it } from 'vitest';

import {
  buildGraphNodeLookup,
  buildLabelIndex,
  resolveLabelToId,
  resolveProseEntityRefs,
  AMBIGUOUS_LABEL,
  type GraphNodeLookup,
} from '../phase3-blocks.js';
import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

// A run_analysis fact whose enrichment carries a graph — the forward lookup
// source. (In production the enrichment has no graph key and the persisted
// snapshot is the fallback; the reverse index is agnostic to which source built
// the forward map, so an enrichment graph is the simplest fixture here.)
function factWithGraph(nodes: ReadonlyArray<Record<string, unknown>>): RunAnalysisHandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: 'scen-resolver',
      leading_option_id: null,
      summary: 'x',
      graph_hash_at_run: 'gh_resolver_0001',
      enrichment: { graph: { nodes, edges: [] } },
    },
  } as unknown as RunAnalysisHandlerFact;
}

const DISTINCT_NODES = [
  { id: 'goal_launch', label: 'Launch success', kind: 'goal' },
  { id: 'fac_ttm', label: 'Time-to-market', kind: 'factor' },
  { id: 'fac_cost', label: 'Cost', kind: 'factor' }, // bare generic single word
  { id: 'fac_ai', label: 'AI', kind: 'factor' }, // too short (2 chars)
  { id: 'opt_k8s', label: 'Kubernetes migration', kind: 'option' },
  { id: 'opt_cto_equity', label: 'Equity Offered to CTO', kind: 'option' },
];

function lookupOf(nodes: ReadonlyArray<Record<string, unknown>>): GraphNodeLookup {
  return buildGraphNodeLookup(factWithGraph(nodes));
}

describe('δ1 buildLabelIndex — reverse index derived from the forward lookup', () => {
  it('maps each distinct normalised label to its single node id', () => {
    const index = buildLabelIndex(lookupOf(DISTINCT_NODES));
    expect(index.get('launch success')).toBe('goal_launch');
    expect(index.get('time to market')).toBe('fac_ttm'); // punctuation normalised
    expect(index.get('kubernetes migration')).toBe('opt_k8s');
  });

  it('flips a DUPLICATE normalised label to AMBIGUOUS (fail-closed ruling)', () => {
    // Two nodes whose labels normalise to the same key ("price" ≡ "Price").
    const index = buildLabelIndex(
      lookupOf([
        { id: 'fac_price_a', label: 'Price', kind: 'factor' },
        { id: 'fac_price_b', label: 'price', kind: 'factor' },
        { id: 'fac_unique', label: 'Delivery risk', kind: 'factor' },
      ]),
    );
    expect(index.get('price')).toBe(AMBIGUOUS_LABEL);
    expect(index.get('delivery risk')).toBe('fac_unique');
  });
});

describe('δ1 resolveLabelToId — single candidate label → id, fail-closed', () => {
  const index = buildLabelIndex(lookupOf(DISTINCT_NODES));

  it('resolves a distinctive multi-word label', () => {
    expect(resolveLabelToId(index, 'Time to market')).toBe('fac_ttm');
    expect(resolveLabelToId(index, 'Kubernetes migration')).toBe('opt_k8s');
  });

  it('returns null for a bare generic single word ("Cost")', () => {
    expect(resolveLabelToId(index, 'Cost')).toBeNull();
  });

  it('returns null for a too-short label ("AI")', () => {
    expect(resolveLabelToId(index, 'AI')).toBeNull();
  });

  it('returns null for a miss (label not in snapshot)', () => {
    expect(resolveLabelToId(index, 'Nonexistent factor')).toBeNull();
  });

  it('returns null for an AMBIGUOUS (duplicate) label', () => {
    const ambigIndex = buildLabelIndex(
      lookupOf([
        { id: 'fac_price_a', label: 'Selling price', kind: 'factor' },
        { id: 'fac_price_b', label: 'selling price', kind: 'factor' },
      ]),
    );
    expect(resolveLabelToId(ambigIndex, 'Selling price')).toBeNull();
  });
});

describe('δ1 resolveProseEntityRefs — 1.135 clickable-copy link resolution', () => {
  const lookup = lookupOf(DISTINCT_NODES);
  const index = buildLabelIndex(lookup);

  it('links a distinctive node named as a bounded whole phrase in prose', () => {
    const refs = resolveProseEntityRefs(
      lookup,
      index,
      'The Kubernetes migration option carries the most delivery risk.',
    );
    expect(refs).toEqual([{ id: 'opt_k8s', label: 'Kubernetes migration', kind: 'option' }]);
  });

  it('does NOT over-link a bare shared token (CTO inside "Equity Offered to CTO")', () => {
    // "CTO" appears, but only as a substring of the whole label; and the whole
    // label is not present, so no link — the over-match lesson holds.
    const refs = resolveProseEntityRefs(lookup, index, 'We should ask the CTO about scope.');
    expect(refs.map((r) => r.id)).not.toContain('opt_cto_equity');
  });

  it('links the whole option label when the prose names it in full', () => {
    const refs = resolveProseEntityRefs(lookup, index, 'Revisit the Equity Offered to CTO before deciding.');
    expect(refs.map((r) => r.id)).toContain('opt_cto_equity');
  });

  it('does NOT link a bare generic single word ("cost")', () => {
    const refs = resolveProseEntityRefs(lookup, index, 'The implementation cost estimates are uncertain.');
    expect(refs.map((r) => r.id)).not.toContain('fac_cost');
  });

  it('does NOT link either node when the named label is AMBIGUOUS (duplicate)', () => {
    const dupNodes = [
      { id: 'fac_price_a', label: 'Selling price', kind: 'factor' },
      { id: 'fac_price_b', label: 'selling price', kind: 'factor' },
    ];
    const dupLookup = lookupOf(dupNodes);
    const dupIndex = buildLabelIndex(dupLookup);
    const refs = resolveProseEntityRefs(dupLookup, dupIndex, 'The selling price is the key driver.');
    expect(refs).toHaveLength(0);
  });

  it('dedupes: a label named twice yields a single ref', () => {
    const refs = resolveProseEntityRefs(
      lookup,
      index,
      'Time-to-market matters; a slow Time to market sinks the launch.',
    );
    expect(refs.filter((r) => r.id === 'fac_ttm')).toHaveLength(1);
  });

  it('returns [] for empty prose', () => {
    expect(resolveProseEntityRefs(lookup, index, '')).toEqual([]);
  });
});

describe('δ1 forward path is unchanged (id → ref still resolves)', () => {
  it('buildGraphNodeLookup still resolves id → {id,label,kind}', () => {
    const lookup = lookupOf(DISTINCT_NODES);
    expect(lookup.get('opt_k8s')).toEqual({
      id: 'opt_k8s',
      label: 'Kubernetes migration',
      kind: 'option',
    });
  });
});
