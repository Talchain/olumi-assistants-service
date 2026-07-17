/**
 * TRUST-SPINE — T7 / board item #7: canonical context revision assertion.
 *
 * Acceptance floor (Paul-approved plan agile-finding-harp.md §3 item 7):
 *   "the context supplied to the coach identifies the same decision revision
 *    shown to the user. Test: e2e assertion revision-match."
 *
 * STATUS: this property HOLDS on today's estate, so per the task instruction
 * ("determine current truth first; if it already holds, this one lands GREEN as a
 * guard") this ships as a GREEN GUARD (`it()`, not `it.fails`). It pins the
 * revision-equality end-to-end so a future refactor cannot silently make the coach
 * context describe a different graph revision than the one the canonical/freshness
 * verdict identifies.
 *
 * WHY IT HOLDS: within a single turn the ContextPack's canonical `analysis_state`
 * hash (`current_graph_hash`) and the graph projected to the coach both derive from
 * the SAME `input.graph` via `computeAnalysisAffectingGraphHash` — one revision by
 * construction (graph-hash.ts:115; the topology-only identity hash graph-hash.ts:39
 * is deliberately kept OUT of the ContextPack). If someone re-pointed the freshness
 * hash at a divergent projection (e.g. the compacted graph) while the coach still
 * saw the raw graph, this guard fails.
 */
import { describe, it, expect } from 'vitest';
import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

import { makeMessagePayload } from '../../__tests__/fixtures.js';
import { assembleContextPack, type GraphWithOptions } from '../context-pack-assembler.js';
import { computeAnalysisAffectingGraphHash } from '../graph-hash.js';

const PAYLOAD = makeMessagePayload();

const GRAPH: GraphWithOptions = {
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Goal' },
    { id: 'a', kind: 'option', label: 'A' },
    { id: 'b', kind: 'option', label: 'B' },
    { id: 'f', kind: 'factor', label: 'F', observed_state: { value: 100 } },
  ],
  edges: [{ from: 'f', to: 'goal' }],
};

const GRAPH_HASH = computeAnalysisAffectingGraphHash(
  GRAPH as unknown as Parameters<typeof computeAnalysisAffectingGraphHash>[0],
)!;

function runAnalysisFact(graphHash: string): RunAnalysisHandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: 's',
      leading_option_id: 'a',
      summary: 'ran',
      enrichment: { analysis_status: 'computed' },
      graph_hash_at_run: graphHash,
      computed_at: '2026-05-01T00:00:00.000Z',
    },
  };
}

describe('TRUST-SPINE T7 — coach context identifies the turn canonical revision (board #7, GREEN guard)', () => {
  it('canonical analysis_state hash equals the hash of the graph shown to the coach (end-to-end revision match)', () => {
    const pack = assembleContextPack({
      payload: PAYLOAD,
      priorTurns: [],
      priorFacts: [runAnalysisFact(GRAPH_HASH)],
      graph: GRAPH,
    });

    // The canonical state must exist and be derived against a real revision.
    expect(pack.analysis_state).not.toBeNull();
    const state = pack.analysis_state!;

    // (1) The revision the canonical/freshness verdict is computed against is the
    //     SAME revision the coach is shown (the graph in the pack).
    expect(state.current_graph_hash).toBe(GRAPH_HASH);

    // (2) The pack projects that same graph to the coach — node identity matches
    //     the revision the hash was taken over.
    expect(pack.graph.counts.nodes).toBe(GRAPH.nodes.length);

    // (3) When fresh, the analysed revision equals the current (coach-visible)
    //     revision — visible == analysed, hash equality end-to-end.
    expect(state.freshness).toBe('fresh');
    expect(state.graph_hash_at_run).toBe(state.current_graph_hash);
  });
});
