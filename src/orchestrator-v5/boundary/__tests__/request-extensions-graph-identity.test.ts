/**
 * W2E-2 review round 3 — INGRESS MUST NOT FORK GRAPH IDENTITY.
 *
 * The round-2 fix repaired sigma <= 0 *at ingress* (request-extensions.ts).
 * That un-bricked the turn but created a worse, SILENT defect: the repair
 * rewrites `strength.std`, which is part of the analysis-affecting hash
 * projection (context/graph-hash.ts projectEdge — `strength.std` is copied
 * into the projection), so the repaired WIRE graph hashes DIFFERENTLY from
 * the UNREPAIRED PERSISTED graph.
 *
 * Every hash token is minted off the unrepaired persisted graph — ingress
 * repair is wired at exactly ONE of the GraphStateIngressSchema parse sites
 * (request-extensions.ts), while the mint sites parse the raw persisted graph
 * directly and never repair:
 *   - turn-executor.ts:1094, :1265
 *   - build-turn-context.ts:547
 *   - tools/handlers/run-analysis.ts:418
 *   - handlers/chip-click-dispatch.ts:793, :1334
 *   - context/graph-cas-conflict.ts:149
 *   - orchestrator/route-v2.ts:1934
 *
 * Consequence on a std=0 scenario: a pending proposal is minted with
 * `preconditions.graph_hash = H(unrepaired)`, then on the confirm turn
 * route-v2.ts:1086 compares it against `H(repaired request graph)`. They
 * differ → `clarify_hash_mismatch` → the proposal is SILENTLY dropped and the
 * user is told "I don't have a pending suggested update to apply."
 *
 * This is the SAME regression class the codebase already paid for once:
 * run-analysis.ts:400 documents "false-stale on every explain turn (live
 * regression observed at staging build abc7d29)" and settles the invariant —
 * the one representation every side agrees on is "the raw persisted graph as
 * stored in scenarios.graph BEFORE any parse". Ingress repair re-breaks it.
 *
 * DOCTRINE (round-3 ruling): ingress preserves graph identity EXACTLY. The
 * sigma floor moves to the compute boundary (PLoTClient.run), which is where
 * the value is actually consumed and where a guard already exists that is
 * explicitly documented as "must not perturb freshness".
 */
import { describe, it, expect } from 'vitest';

import { parseRequestExtensions } from '../request-extensions.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { assertIngressGraphNumericBounds } from '../../../validators/numeric-bounds.js';

const REQUEST_ID = 'test-req-identity';

/**
 * A REAL persisted-canvas shape. DecisionGuideAI's own writer produces this:
 * useConversation.ts (buildRequest) floors outbound std with
 * `Math.max(0, strengthStdValue)` — a floor of ZERO, not >0. So std=0 is not
 * rare legacy state; the live UI emits it continuously.
 */
function persistedCanvasWithZeroStd() {
  return {
    graph_state: {
      nodes: [
        { id: 'fac_1', kind: 'factor', label: 'SensitiveLabelA' },
        { id: 'goal_1', kind: 'goal', label: 'SensitiveLabelB' },
      ],
      edges: [
        {
          from: 'fac_1',
          to: 'goal_1',
          strength: { mean: 0.5, std: 0 },
          exists_probability: 0.8,
          edge_type: 'directed',
        },
      ],
    },
  };
}

describe('parseRequestExtensions — graph identity is preserved at ingress', () => {
  it('does not brick a persisted canvas carrying strength.std = 0', () => {
    const result = parseRequestExtensions(persistedCanvasWithZeroStd(), REQUEST_ID);
    expect(result.ok).toBe(true);
  });

  it('hash of the ingress-parsed graph EQUALS hash of the raw persisted graph', () => {
    // This is the load-bearing assertion. Hash tokens are minted off the raw
    // persisted graph; the wire graph must agree or every token desyncs.
    const body = persistedCanvasWithZeroStd();
    const rawHash = computeAnalysisAffectingGraphHash(body.graph_state);

    const result = parseRequestExtensions(persistedCanvasWithZeroStd(), REQUEST_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const wireHash = computeAnalysisAffectingGraphHash(result.value.graphState);
    expect(wireHash).toBe(rawHash);
  });

  it('passes strength.std = 0 through UNCHANGED (no silent identity fork)', () => {
    const result = parseRequestExtensions(persistedCanvasWithZeroStd(), REQUEST_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const edge = (result.value.graphState as { edges: Array<Record<string, any>> }).edges[0];
    expect(edge.strength.std).toBe(0);
    expect(edge.strength.mean).toBe(0.5);
    expect(edge.exists_probability).toBe(0.8);
  });

  it('passes node observed_state.std = 0 through UNCHANGED', () => {
    const body = {
      graph_state: {
        nodes: [
          {
            id: 'fac_1',
            kind: 'factor',
            label: 'SensitiveLabelA',
            observed_state: { value: 0.5, std: 0 },
          },
        ],
        edges: [],
      },
    };
    const rawHash = computeAnalysisAffectingGraphHash(body.graph_state);
    const result = parseRequestExtensions(body, REQUEST_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const node = (result.value.graphState as { nodes: Array<Record<string, any>> }).nodes[0];
    expect(node.observed_state.std).toBe(0);
    expect(computeAnalysisAffectingGraphHash(result.value.graphState)).toBe(rawHash);
  });

  it('round-trips the graph value-for-value through ingress', () => {
    // NB: not a reference check. `GraphStateIngressSchema.safeParse` is a zod
    // `.passthrough()` parse, which always returns a NEW object — that clone is
    // zod's, not the bounds gate's, and it is value-preserving. What must hold
    // is that no VALUE is rewritten on the way through.
    const body = persistedCanvasWithZeroStd();
    const before = JSON.parse(JSON.stringify(body.graph_state));
    const result = parseRequestExtensions(body, REQUEST_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.graphState).toEqual(before);
    // And the caller's own object is not mutated in place either.
    expect(body.graph_state).toEqual(before);
  });

  it('the bounds gate itself hands the graph straight back BY REFERENCE', () => {
    // The gate is the component under test for identity: it must not clone,
    // rewrite, or otherwise touch the graph — reference equality proves it.
    const graph = persistedCanvasWithZeroStd().graph_state;
    const result = assertIngressGraphNumericBounds(graph);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.graph).toBe(graph);
  });

  // ── The split is unchanged: no-safe-reading classes still hard-reject ──────

  it('still REJECTS a probability outside [0,1] (cannot infer 1.0 vs 0.14)', () => {
    const body = persistedCanvasWithZeroStd();
    body.graph_state.edges[0].exists_probability = 1.4;
    expect(parseRequestExtensions(body, REQUEST_ID).ok).toBe(false);
  });

  it('still REJECTS ±Infinity (meaningless — must never reach computation)', () => {
    const body = persistedCanvasWithZeroStd();
    body.graph_state.edges[0].strength.mean = Number.POSITIVE_INFINITY;
    expect(parseRequestExtensions(body, REQUEST_ID).ok).toBe(false);
  });

  it('still REJECTS NaN', () => {
    const body = persistedCanvasWithZeroStd();
    body.graph_state.edges[0].strength.mean = Number.NaN;
    expect(parseRequestExtensions(body, REQUEST_ID).ok).toBe(false);
  });
});
