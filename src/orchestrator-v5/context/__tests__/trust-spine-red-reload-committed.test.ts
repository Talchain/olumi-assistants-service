/**
 * TRUST-SPINE — board item #4: reload → visible == committed == analysed.
 *
 * ⚠ RETIRED `it.fails` (17 Jul) — under-mocked the assembler.
 * The original RED gate here called `assembleContextPack({ …, priorFacts, graph
 * omitted, canonicalState omitted })` and asserted `pack.analysis_state` is
 * non-null. That call hits the assembler's DELIBERATELY-null compacted-graph
 * fallback (`context-pack-assembler.ts:698` — `rawGraph === null → return null`),
 * a locked-in design of the ContextPack.analysis_state FIELD (see the sibling
 * `context-pack-analysis-state.test.ts:104` which asserts exactly this null is
 * correct). So the gate observed a null the assembler is BUILT to emit, not a
 * live "committed row never read" — an under-mock, not a live defect.
 *
 * The real "reload = committed = analysed" property is enforced ONE layer up, at
 * the turn-executor: `turn-executor.ts:1283-1350` derives the current graph hash
 * from `context.persistedGraph` (the committed row) — never the ingress graph —
 * and `deriveAnalysisFreshness` compares the analysed hash against it. The
 * correct regression guard therefore lives at that seam, driven through the real
 * `runTurnExecutor`:
 *
 *     src/orchestrator-v5/__tests__/turn-executor-reload-committed-authority.test.ts
 *
 * See acceptance-evidence/trust-spine-scoreboard-2026-07-17/RED-DIAGNOSIS-4-and-7.md
 * for the full diagnosis (gate #4 = false-red on the scoreboard; the acceptance
 * floor "freshness compares the committed row" is already met live).
 *
 * What survives here: the assembler-level POSITIVE CONTROL below. It is still a
 * meaningful, non-vacuous check that the assembler CAN surface a non-null,
 * 'fresh' analysis_state when it IS given the ingress graph + a matching prior
 * fact — i.e. the null is the compacted-path fallback, not a blanket inability.
 */
import { describe, it, expect } from 'vitest';
import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

import { makeMessagePayload } from '../../__tests__/fixtures.js';
import { assembleContextPack, type GraphWithOptions } from '../context-pack-assembler.js';
import { computeAnalysisAffectingGraphHash } from '../graph-hash.js';

const PAYLOAD = makeMessagePayload();

/** The graph the analysis actually ran against — i.e. the COMMITTED scenario row. */
const COMMITTED_GRAPH: GraphWithOptions = {
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Goal' },
    { id: 'a', kind: 'option', label: 'A' },
    { id: 'b', kind: 'option', label: 'B' },
    { id: 'f', kind: 'factor', label: 'F', observed_state: { value: 100 } },
  ],
  edges: [{ from: 'f', to: 'goal' }],
};

const COMMITTED_HASH = computeAnalysisAffectingGraphHash(
  COMMITTED_GRAPH as unknown as Parameters<typeof computeAnalysisAffectingGraphHash>[0],
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

describe('TRUST-SPINE T4 — reload visible==committed==analysed (board #4)', () => {
  // POSITIVE CONTROL (GREEN today): when the ingress graph IS present and matches
  // the analysed hash, the assembler derives a usable 'fresh' analysis_state.
  // Proves the assembler's null on the graph-omitted path is the compacted
  // fallback, not a blanket inability — and anchors the reload property's
  // authoritative guard at the turn-executor seam (file referenced in the
  // docblock above).
  it('positive control: committed analysis + matching ingress graph → fresh analysis_state present', () => {
    const pack = assembleContextPack({
      payload: PAYLOAD,
      priorTurns: [],
      priorFacts: [runAnalysisFact(COMMITTED_HASH)],
      graph: COMMITTED_GRAPH,
    });
    expect(pack.analysis_state).not.toBeNull();
    expect(pack.analysis_state!.freshness).toBe('fresh');
  });

  // The reload / no-ingress-graph direction that the retired `it.fails` tried to
  // pin is now guarded at the turn-executor seam (committed-row authority), where
  // it is a live property rather than an assembler-fixture artefact:
  //   src/orchestrator-v5/__tests__/turn-executor-reload-committed-authority.test.ts
});
