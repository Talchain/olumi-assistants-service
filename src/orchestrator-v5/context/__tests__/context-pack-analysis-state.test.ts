/**
 * M4 — ContextPack `analysis_state` projection.
 *
 * Proves the assembler attaches a redacted canonical analysis_state derived
 * from the SAME canonical selector the chips / route summary use, with these
 * honest boundaries:
 *   - `canonicalState` input (M5 seam) is authoritative when present;
 *   - else best-effort from priorFacts + a raw-graph freshness hash;
 *   - else (no raw graph — the production compacted path) `null`, never a
 *     misleadingly-stale verdict;
 *   - `priorFacts` omitted entirely → `null` + a visible diagnostic.
 * And that the resulting pack still validates against ContextPackSchema.
 */
import { describe, it, expect, vi } from 'vitest';
import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

import { makeMessagePayload } from '../../__tests__/fixtures.js';
import { log } from '../../../utils/telemetry.js';
import { assembleContextPack, type GraphWithOptions } from '../context-pack-assembler.js';
import { ContextPackSchema } from '../context-pack-schema.js';
import { computeAnalysisAffectingGraphHash } from '../graph-hash.js';
import { selectCanonicalAnalysisState } from '../canonical-analysis-state.js';

const PAYLOAD = makeMessagePayload();

const graph: GraphWithOptions = {
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Goal' },
    { id: 'a', kind: 'option', label: 'A' },
    { id: 'b', kind: 'option', label: 'B' },
    { id: 'f', kind: 'factor', label: 'F', observed_state: { value: 100 } },
  ],
  edges: [{ from: 'f', to: 'goal' }],
};
const editedGraph: GraphWithOptions = {
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Goal' },
    { id: 'a', kind: 'option', label: 'A' },
    { id: 'b', kind: 'option', label: 'B' },
    { id: 'f', kind: 'factor', label: 'F', observed_state: { value: 250 } },
  ],
  edges: [{ from: 'f', to: 'goal' }],
};

const hashOf = (g: GraphWithOptions): string =>
  computeAnalysisAffectingGraphHash(
    g as unknown as Parameters<typeof computeAnalysisAffectingGraphHash>[0],
  )!;
const HASH = hashOf(graph);

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

describe('ContextPack analysis_state — derivation', () => {
  it('priorFacts + matching graph → fresh, usable for chips', () => {
    const pack = assembleContextPack({
      payload: PAYLOAD,
      priorTurns: [],
      priorFacts: [runAnalysisFact(HASH)],
      graph,
    });
    expect(pack.analysis_state).not.toBeNull();
    expect(pack.analysis_state!.freshness).toBe('fresh');
    expect(pack.analysis_state!.usable_for_chips).toBe(true);
    expect(pack.analysis_state!.requires_rerun).toBe(false);
  });

  it('priorFacts + edited graph (hash mismatch) → stale, requires rerun, chips off', () => {
    const pack = assembleContextPack({
      payload: PAYLOAD,
      priorTurns: [],
      priorFacts: [runAnalysisFact(HASH)],
      graph: editedGraph,
    });
    expect(pack.analysis_state!.freshness).toBe('stale');
    expect(pack.analysis_state!.requires_rerun).toBe(true);
    expect(pack.analysis_state!.usable_for_chips).toBe(false);
  });

  it('no run_analysis fact + graph → freshness none, followup not usable', () => {
    const pack = assembleContextPack({
      payload: PAYLOAD,
      priorTurns: [],
      priorFacts: [],
      graph,
    });
    expect(pack.analysis_state!.freshness).toBe('none');
    expect(pack.analysis_state!.usable_for_followup_context).toBe(false);
  });

  it('priorFacts present but NO raw graph (compacted path) → analysis_state null (no false stale)', () => {
    const pack = assembleContextPack({
      payload: PAYLOAD,
      priorTurns: [],
      priorFacts: [runAnalysisFact(HASH)],
      // graph omitted — mirrors turn-executor passing `graph: undefined`
      // when a compactedGraph is used.
    });
    expect(pack.analysis_state).toBeNull();
  });

  it('priorFacts omitted entirely → analysis_state null + visible diagnostic', () => {
    const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => undefined);
    const pack = assembleContextPack({ payload: PAYLOAD, priorTurns: [], graph });
    expect(pack.analysis_state).toBeNull();
    const events = warnSpy.mock.calls.map((c) => (c[0] as { event?: string }).event);
    expect(events).toContain('context_pack.canonical_state_facts_absent');
    warnSpy.mockRestore();
  });
});

describe('ContextPack analysis_state — canonicalState input is authoritative (M5 seam)', () => {
  it('uses the threaded canonicalState verdict even when the graph alone would be fresh', () => {
    // Graph matches the fact (would be 'fresh' via the derivation path), but
    // a threaded canonicalState says 'stale' — the threaded verdict wins.
    const staleCanonical = selectCanonicalAnalysisState({
      priorFacts: [runAnalysisFact(HASH)],
      currentGraphHash: hashOf(editedGraph), // diverged → stale
      readiness: { status: 'ready' },
    });
    const pack = assembleContextPack({
      payload: PAYLOAD,
      priorTurns: [],
      priorFacts: [runAnalysisFact(HASH)],
      graph, // matches HASH → would be fresh on the derivation path
      canonicalState: staleCanonical,
    });
    expect(pack.analysis_state!.freshness).toBe('stale');
    expect(pack.analysis_state!.requires_rerun).toBe(true);
  });
});

describe('ContextPack — behaviour 9: AI-facing context populated together', () => {
  it('graph + analysis_state + recent_changes + recent_turns all present in one pack', () => {
    const priorTurn = {
      id: 'r1',
      scenario_id: 's',
      user_id: 'u',
      turn_id: 't-prev',
      turn_class: 'direct_answer',
      handler_id: null,
      request_hash: 'h',
      response_emitted: true,
      llm_calls_used: 1,
      created_at: '2026-04-30T00:00:00.000Z',
      user_message: 'what changed?',
      assistant_message: 'I adjusted a link in the model.',
    };
    // adjust_edge_strength is the simplest mutation fact that projects to a
    // recent_changes entry (no result fields required).
    const mutationFact = { fact_type: 'adjust_edge_strength', fact_version: 1, noop: false, result: {} };
    const pack = assembleContextPack({
      payload: PAYLOAD,
      priorTurns: [priorTurn as never],
      priorFacts: [runAnalysisFact(HASH), mutationFact as never],
      graph,
    });
    expect(pack.graph.counts.nodes).toBeGreaterThan(0);
    expect(pack.analysis_state).not.toBeNull();
    expect(pack.analysis_state!.freshness).toBe('fresh');
    expect(pack.conversation.recent_turns.length).toBeGreaterThanOrEqual(1);
    expect(pack.recent_changes.length).toBeGreaterThanOrEqual(1);
  });
});

describe('ContextPack analysis_state — schema', () => {
  it('the assembled pack (with analysis_state) validates against ContextPackSchema', () => {
    const pack = assembleContextPack({
      payload: PAYLOAD,
      priorTurns: [],
      priorFacts: [runAnalysisFact(HASH)],
      graph,
    });
    const parsed = ContextPackSchema.safeParse(pack);
    expect(parsed.success).toBe(true);
  });
});
