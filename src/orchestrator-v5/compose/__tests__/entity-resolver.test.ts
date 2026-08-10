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

// ============================================================================
// PROSE ORDER (ROADMAP 2.1023). `resolveProseEntityRefs` used to return refs in
// GRAPH LOOKUP order — the order the producer happened to emit its nodes in,
// which is invisible to the reader. Two consumers read `[0]` as "the entity
// this card is about": the card's own pills, and ui_directive row 7, which
// MOVES THE VIEWPORT. Measured on the 14 committed captures at
// olumi-docs/PHASE0-EVIDENCE-2026-07-28/mutation-witness-2026-08-10:
// 12 of 21 multi-ref coaching cards listed their entities in an order that
// CONTRADICTS their own sentence — the dominant shape being
// "The link from <factor> to <goal> assumes…" rendered as [goal, factor].
//
// The fix is a pure REORDERING: same set, ordered by FIRST MENTION in the prose,
// ties broken by longer label first. It cannot add or drop a ref.
// ============================================================================
describe('1.135 prose entity refs — ORDER BY FIRST MENTION', () => {
  // `fac_team` is deliberately listed BEFORE `fac_margin` so lookup order and
  // prose order DISAGREE. Under the old behaviour this fixture returns
  // [Team ramp time, Gross margin floor] — the incidental mention first.
  const ORDER_NODES = [
    { id: 'goal_g', label: 'Launch success', kind: 'goal' },
    { id: 'fac_team', label: 'Team ramp time', kind: 'factor' },
    { id: 'fac_margin', label: 'Gross margin floor', kind: 'factor' },
  ];
  const orderLookup = lookupOf(ORDER_NODES);
  const orderIndex = buildLabelIndex(orderLookup);
  const idsFor = (prose: string) =>
    resolveProseEntityRefs(orderLookup, orderIndex, prose).map((r) => r.id);

  // ── The discriminating pair (trap 19). Neither case alone proves the order
  // tracks the PROSE: a mutant that simply reverses lookup order passes the
  // first and FAILS the second. Both must hold, on the SAME graph, and they
  // must fail on DIFFERENT assertions.
  it('leads with the entity the sentence leads with (subject before the aside)', () => {
    expect(
      idsFor(
        'Your Gross margin floor is doing most of the work here, though Team ramp time matters a little too.',
      ),
    ).toEqual(['fac_margin', 'fac_team']);
  });

  it('DISCRIMINATOR: the SAME graph with the mentions reversed yields the reversed order', () => {
    // Precondition pinned in-test: this is the same lookup as above, so a
    // difference in the result can only come from the prose.
    expect(orderLookup.get('fac_team')).toEqual({
      id: 'fac_team',
      label: 'Team ramp time',
      kind: 'factor',
    });
    expect(
      idsFor(
        'Your Team ramp time is doing most of the work here, though Gross margin floor matters a little too.',
      ),
    ).toEqual(['fac_team', 'fac_margin']);
  });

  it('is a pure reordering — the SET of resolved refs is unchanged', () => {
    // Guards against the reorder silently becoming a suppression.
    const a = idsFor(
      'Your Gross margin floor is doing most of the work here, though Team ramp time matters a little too.',
    );
    const b = idsFor(
      'Your Team ramp time is doing most of the work here, though Gross margin floor matters a little too.',
    );
    expect([...a].sort()).toEqual(['fac_margin', 'fac_team']);
    expect([...a].sort()).toEqual([...b].sort());
  });

  it('the measured live shape: "The link from <factor> to <goal>" leads with the factor', () => {
    // Taken from reanalyse/s3 in the committed capture set, which shipped
    // [goal, factor] — the reader sees the factor named first.
    const nodes = [
      { id: 'goal_prod', label: 'Achieve Higher Sales Productivity Within Budget', kind: 'goal' },
      { id: 'fac_sales', label: 'Sales Team Productivity', kind: 'factor' },
    ];
    const lk = lookupOf(nodes);
    const refs = resolveProseEntityRefs(
      lk,
      buildLabelIndex(lk),
      'The link from Sales Team Productivity to Achieve Higher Sales Productivity Within Budget assumes productivity gains will hold.',
    );
    expect(refs.map((r) => r.id)).toEqual(['fac_sales', 'goal_prod']);
  });

  // ── Tie-break: longer label first. This is what makes the CTO case correct
  // WITHOUT a separate longest-match rule — a shorter label contained in a
  // longer one either starts later (offset decides) or starts at the same
  // offset (this tie-break decides).
  it('prefers the LONGER label when a bare token also matches inside it (CTO)', () => {
    const nodes = [
      { id: 'fac_cto', label: 'CTO', kind: 'factor' },
      { id: 'opt_cto_equity', label: 'Equity Offered to CTO', kind: 'option' },
    ];
    const lk = lookupOf(nodes);
    const refs = resolveProseEntityRefs(
      lk,
      buildLabelIndex(lk),
      'Revisit the Equity Offered to CTO before deciding.',
    );
    expect(refs[0]).toEqual({
      id: 'opt_cto_equity',
      label: 'Equity Offered to CTO',
      kind: 'option',
    });
  });

  it('prefers the LONGER label on a same-offset tie (prefix containment)', () => {
    // "Onboarding" and "Onboarding friction" both start at offset 0 of the
    // match, so only the tie-break can decide.
    const nodes = [
      { id: 'fac_onb', label: 'Onboarding', kind: 'factor' },
      { id: 'fac_onb_fric', label: 'Onboarding friction', kind: 'factor' },
    ];
    const lk = lookupOf(nodes);
    const refs = resolveProseEntityRefs(
      lk,
      buildLabelIndex(lk),
      'Onboarding friction is the thing to watch.',
    );
    expect(refs[0]!.id).toBe('fac_onb_fric');
  });
});
