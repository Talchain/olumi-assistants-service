/**
 * ROADMAP 1.192 leg κ(b) — `computed_against_hash` on AnalysisResultBlock.
 *
 * The single block assembler (`buildAnalysisResultBlock`, compose.ts) maps the
 * run_analysis fact's `graph_hash_at_run` onto the 0.22-shipped
 * `computed_against_hash` wire field — the graph identity the analysis was
 * computed against. Fail-closed: a legacy fact with no `graph_hash_at_run`
 * OMITS the field (never fabricated).
 *
 * Trap-13 discipline: the POSITIVE control (a fact WITH a hash emits it) runs
 * BEFORE the absence assertion (a legacy fact omits it), so the omission
 * assertion is proven able to SEE a presence.
 *
 * Driven through the exported `composeToolCallResponse` (the fresh prior-fact
 * lifecycle branch that emits the analysis_result summary block).
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

import { composeToolCallResponse } from '../compose.js';
import type { FreshnessDerivation } from '../context/freshness.js';
import { log } from '../../utils/telemetry.js';

const SCENARIO_ID = '11111111-1111-4111-8111-111111111111';
const SOURCE_GRAPH_HASH = 'gh_source_abc123';

function makeRunAnalysisFact(graphHashAtRun: string | undefined): RunAnalysisHandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: 'opt_a',
      summary: 'Ran analysis.',
      win_probabilities: { opt_a: 0.7, opt_b: 0.3 },
      // A legacy (pre-0.10.0) fact simply has no graph_hash_at_run key.
      ...(graphHashAtRun !== undefined ? { graph_hash_at_run: graphHashAtRun } : {}),
      computed_at: '2026-05-17T00:00:00.000Z',
      enrichment: { analysis_status: 'completed' },
    },
  } as unknown as RunAnalysisHandlerFact;
}

function freshDerivation(sourceHash: string | null): FreshnessDerivation {
  return {
    freshness: 'fresh',
    reason: 'graph_hash_match',
    selected_fact_index: 0,
    graph_hash_at_run: sourceHash,
    current_graph_hash: sourceHash,
    computed_at: '2026-05-17T00:00:00.000Z',
  };
}

function analysisResultBlock(fact: RunAnalysisHandlerFact) {
  // Drive the CURRENT-TURN path (buildBlocksFromFacts): a current-turn
  // run_analysis fact unconditionally emits the analysis_result summary block,
  // regardless of freshness — so a legacy (hashless) fact still yields a block
  // whose `computed_against_hash` we can assert is absent.
  const response = composeToolCallResponse({
    answerKind: 'functional',
    orientation: '',
    confirmation: 'Explained.',
    coaching: null,
    stage: 'decide',
    handlerFacts: [fact],
    lifecycle: {
      priorFacts: [],
      freshness: freshDerivation(null),
      requestId: 'req-cah',
      scenarioId: SCENARIO_ID,
    },
  });
  return response.blocks.find((b) => b.type === 'analysis_result') as
    | { type: 'analysis_result'; computed_against_hash?: string }
    | undefined;
}

describe('leg κ(b) — computed_against_hash on AnalysisResultBlock', () => {
  beforeEach(() => {
    vi.spyOn(log, 'warn').mockImplementation(() => log);
    vi.spyOn(log, 'info').mockImplementation(() => log);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('POSITIVE CONTROL: a fact WITH graph_hash_at_run emits computed_against_hash == that hash', () => {
    const block = analysisResultBlock(makeRunAnalysisFact(SOURCE_GRAPH_HASH));
    expect(block).toBeDefined();
    expect(block!.computed_against_hash).toBe(SOURCE_GRAPH_HASH);
  });

  it('LEGACY (fail-closed): a fact WITHOUT graph_hash_at_run OMITS computed_against_hash (never fabricated)', () => {
    // The block still emits (the analysis ran); only the identity assertion is
    // absent — an honest "identity unknown", not a fabricated hash.
    const block = analysisResultBlock(makeRunAnalysisFact(undefined));
    expect(block).toBeDefined();
    expect(block!.computed_against_hash).toBeUndefined();
  });
});
