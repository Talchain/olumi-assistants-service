/**
 * TRUST-SPINE RED — T4 / board item #4: reload → visible == committed == analysed.
 *
 * Acceptance floor (Paul-approved plan agile-finding-harp.md §3 item 4):
 *   "assert visible==committed==analysed after reload; make freshness compare the
 *    committed row, not ingress-vs-ingress."
 *
 * DEFECT (plan §1 Defect #3, agent a1ccaca full verdict): the freshness verdict
 * compares two hashes BOTH derived from the current turn's UI-supplied
 * `graph_state` INGRESS — never the committed DB row. There is no committed-row
 * input on ANY freshness function (`deriveAnalysisFreshness`,
 * `selectCanonicalAnalysisState`, `deriveContextPackAnalysisState`). So on a
 * reload turn that carries NO ingress graph_state, the system cannot confirm the
 * committed analysis — it omits `analysis_state` entirely rather than reading the
 * committed row.
 *
 * GROUNDING: the sibling test `context-pack-analysis-state.test.ts` locks this
 * defect in as "correct" today:
 *     it('priorFacts present but NO raw graph (compacted path) → analysis_state
 *        null (no false stale)', () => { ... expect(pack.analysis_state).toBeNull() })
 * Board #4's fix MUST overturn that assertion: after a no-edit reload the committed
 * analysis is still valid and must surface as fresh. This RED test is the inverse.
 *
 * it.fails semantics: the body asserts the HONEST-FUTURE behaviour, which THROWS on
 * today's estate (analysis_state is null) — so `it.fails` reports GREEN while the
 * defect stands. When board #4 lands, the body passes, `it.fails` fails loudly, and
 * the fixer converts it to `it()`.
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
  // POSITIVE CONTROL (regular it — GREEN today): when the ingress graph IS present
  // and matches the analysed hash, the machinery derives a usable 'fresh' verdict.
  // Proves this test can SEE a present, non-null analysis_state — so the RED
  // assertion below (analysis_state absent) is NOT vacuous.
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

  // TRUST-SPINE RED: flips to it() when board-item 4 lands.
  // Reload turn carries NO ingress graph_state; the committed row is unchanged and
  // its analysis is still valid. Honest future: freshness derives from the
  // COMMITTED row → analysis_state present and 'fresh'. TODAY: analysis_state is
  // null (the committed row is never read), so `.not.toBeNull()` throws → RED body.
  it.fails(
    'a reload turn with NO ingress graph_state surfaces the committed analysis as fresh',
    () => {
      const pack = assembleContextPack({
        payload: PAYLOAD,
        priorTurns: [],
        priorFacts: [runAnalysisFact(COMMITTED_HASH)],
        // graph omitted — the reload / no-ingress-graph_state case. Today the
        // assembler returns analysis_state: null (see the sibling test that
        // asserts toBeNull). The committed row is authoritative and must be read.
      });
      expect(pack.analysis_state).not.toBeNull();
      expect(pack.analysis_state!.freshness).toBe('fresh');
      expect(pack.analysis_state!.usable_for_followup_context).toBe(true);
    },
  );
});
