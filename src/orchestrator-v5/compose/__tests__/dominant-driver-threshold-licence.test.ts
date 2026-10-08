/**
 * S3 / AIE #87: coaching eligibility does not license a measured flip threshold.
 * Captured enrichment and served/reloaded block bytes: P45 B1 month-12 D2 run2.
 * Fixture provenance records source selectors and SHA256; no host path is read.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';
import capture from './fixtures/dominant-driver-run2.json';
import { selectLens } from '../lens-selector.js';
import { buildLensSuggestionCoachingBlock, type BlockBuildCtx } from '../phase3-blocks.js';
import { readTopLevelFlipRows } from '../../context/flip-threshold-rows.js';
import { goalChanceDriverAvailabilityForAgent } from '../../goal-target/goal-chance-licence.js';
import { goalChanceDriverDisplayForAgent, goalChanceDriversForAgent } from '../../goal-target/goal-chance-range-agent.js';
import { readScenarioAnalysis } from '../../../routes/scenario-graph-analysis-read.js';

const store = vi.hoisted(() => ({
  readRecent: vi.fn().mockResolvedValue([]),
  readFactsFor: vi.fn().mockResolvedValue([]),
  readFactsWithTurnFor: vi.fn().mockResolvedValue([]),
  readScenarioRunAnalysisFactsFor: vi.fn(),
  readAnalysisInvalidatedAt: vi.fn().mockResolvedValue(null),
  readMostRecentPendingActions: vi.fn().mockResolvedValue([]),
  readNewestRunDeliveryFor: vi.fn(),
}));
vi.mock('../../session/index.js', async (original) => ({
  ...(await original<typeof import('../../session/index.js')>()),
  getSessionStore: () => store,
}));

const QUALITATIVE = 'One factor is doing most of the work in this result.';
const GROUNDED = 'Monthly new Pro subscribers is doing most of the work in this result.';
const THRESHOLD = 'A sensitivity check shows how far it can move before the most-supported option changes.';
const CTX: BlockBuildCtx = {
  created_at: capture.run_metadata.computed_at,
  graph_hash_at_generation: capture.analysis_result.computed_against_hash,
};
type Enrichment = Record<string, unknown>;

function makeFact(enrichment: Enrichment = structuredClone(capture.analysis_result.enrichment)): RunAnalysisHandlerFact {
  // The capture is a public analysis_result block. Only the handler envelope is
  // constructed; its enrichment is copied intact, not re-created from summaries.
  return {
    fact_type: 'run_analysis', fact_version: 1, noop: false,
    result: {
      summary: capture.analysis_result.summary,
      leading_option_id: capture.analysis_result.leading_option_id,
      win_probabilities: capture.analysis_result.win_probabilities,
      ...capture.run_metadata,
      // The public capture has no handler constraint_verdict. This constructed
      // envelope reflects its captured analysis_state.leader_claim permission.
      constraint_verdict: { may_name_leading_option: true, constraint_verdict_state: 'evaluated_feasible' },
      enrichment,
    },
  } as unknown as RunAnalysisHandlerFact;
}

const realFlip = JSON.parse(readFileSync(new URL(
  '../../../../tests/fixtures/cross-service/witness-2265-runA.flip-threshold-winner.json', import.meta.url,
), 'utf8')) as { flip_thresholds: Record<string, unknown>[] };
// Constructed contrast: keep the captured enrichment, replace only the flip
// rows with real measured rows from the existing flip-posture positive control,
// and explicitly mark the probe available. This is not a new live capture.
const realThresholdEnrichment = (): Enrichment => ({
  ...structuredClone(capture.analysis_result.enrichment),
  flip_thresholds: structuredClone(realFlip.flip_thresholds),
  flip_thresholds_status: 'available',
});

describe('DOMINANT_DRIVER measured-threshold licence', () => {
  it('pins the captured unavailable evidence, served/reloaded text, and source digest', () => {
    expect(capture.provenance.source_sha256).toBe('252517107bd7fd940c3fd05401357f171e6f4b9e9daa948a913919e435071bc5');
    expect(capture.analysis_result.enrichment.flip_thresholds).toEqual([]);
    expect(capture.analysis_result.enrichment.flip_thresholds_status).toBe('unavailable');
    expect(capture.analysis_result.enrichment.inference_warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'FACTOR_FLIPS_UNAVAILABLE' }),
    ]));
    expect(capture.analysis_result.enrichment.p_win_sensitivity).toHaveLength(4);
    expect(capture.analysis_result.enrichment.p_win_sensitivity.every((r) => r.status === 'below_resolution')).toBe(true);
    expect(capture.dominant_driver_block.body).toBe(`${GROUNDED} ${THRESHOLD}`);
    for (const text of capture.provenance.analysis_text_captures) {
      expect(text.body).toBe(capture.dominant_driver_block.body);
    }
  });

  it('row 1: keeps qualitative coaching and the separately licensed goal-chance driver', () => {
    const fact = makeFact();
    const before = JSON.stringify(fact.result);
    const selection = selectLens(fact)!;
    expect(selection.rationaleCode).toBe('DOMINANT_DRIVER');
    expect(selection.body).toBe(QUALITATIVE);
    const block = buildLensSuggestionCoachingBlock(fact, CTX, null)!;
    expect(block.body).toBe(GROUNDED);
    expect(block.body).not.toContain(THRESHOLD);
    expect(goalChanceDriverAvailabilityForAgent(fact.result)?.options).toContainEqual({
      option_id: 'raise_price_to_59', status: 'available',
    });
    const licence = capture.analysis_result.enrichment.inference_warnings.find((w) => w.code === 'GOAL_CHANCE_LICENSED')!;
    expect(goalChanceDriversForAgent(fact.result, {})).toContainEqual({
      option_id: 'raise_price_to_59', driver: licence.driver_by_option!.raise_price_to_59,
    });
    expect(goalChanceDriverDisplayForAgent(fact.result, capture.canonical_graph).raise_price_to_59).toBe(
      'It rests most on Olumi’s own estimate of how strongly ‘Pro price’ affects ‘Monthly Pro churn’: if that effect is stronger than Olumi assumed, the chance falls. Is that estimate right?',
    );
    expect(JSON.stringify(fact.result)).toBe(before);
  });

  it('row 2: real available threshold keeps both original sentences byte-identical', () => {
    const enrichment = realThresholdEnrichment();
    expect(readTopLevelFlipRows(enrichment).some((row) => row.kind === 'flip_pair')).toBe(true);
    const fact = makeFact(enrichment);
    expect(selectLens(fact)?.body).toBe(`${QUALITATIVE} ${THRESHOLD}`);
    expect(buildLensSuggestionCoachingBlock(fact, CTX, null)?.body).toBe(capture.dominant_driver_block.body);
  });

  it('nonempty measured rows with unavailable status still do not license the clause', () => {
    const fact = makeFact({ ...realThresholdEnrichment(), flip_thresholds_status: 'unavailable' });
    expect(selectLens(fact)?.body).toBe(QUALITATIVE);
    expect(buildLensSuggestionCoachingBlock(fact, CTX, null)?.body).toBe(GROUNDED);
  });

  it('available status without a measured pair still does not license the clause', () => {
    const fact = makeFact({ ...capture.analysis_result.enrichment, flip_thresholds_status: 'available' });
    expect(selectLens(fact)?.body).toBe(QUALITATIVE);
    expect(buildLensSuggestionCoachingBlock(fact, CTX, null)?.body).toBe(GROUNDED);
  });

  it('nonempty unusable rows are not real thresholds', () => {
    const fact = makeFact({
      ...capture.analysis_result.enrichment,
      flip_thresholds_status: 'available',
      flip_thresholds: [{ factor_id: 'monthly_new_pro_subscribers', current_value: 25, flip_value: null }],
    });
    expect(selectLens(fact)?.body).toBe(QUALITATIVE);
    expect(buildLensSuggestionCoachingBlock(fact, CTX, null)?.body).toBe(GROUNDED);
  });

  it('grounding refusal retains the licensed qualitative body', () => {
    const enrichment = structuredClone(capture.analysis_result.enrichment);
    const fact = makeFact({
      ...enrichment,
      factor_sensitivity: enrichment.factor_sensitivity.map((row, index) =>
        index === 0 ? { ...row, influence_rank: undefined } : row),
    });
    expect(buildLensSuggestionCoachingBlock(fact, CTX, null)?.body).toBe(QUALITATIVE);
  });

  it('row 3: the actual saved-Run reader reloads the corrected block verbatim', async () => {
    const fact = makeFact();
    const block = buildLensSuggestionCoachingBlock(fact, CTX, null)!;
    const record = {
      record_version: 1,
      run_id: capture.run_metadata.run_id,
      graph_hash: capture.run_metadata.graph_hash_at_run,
      phase3_blocks: [block],
    };
    store.readScenarioRunAnalysisFactsFor.mockResolvedValue({
      facts: [{ fact, fact_row_id: 's3-row', fact_created_at: fact.result.computed_at }], total_count: 1,
    });
    store.readNewestRunDeliveryFor.mockResolvedValue({
      fact_type: 'run_delivery', fact_version: 1, noop: false,
      result: { run_id: record.run_id, record: JSON.parse(JSON.stringify(record)) },
    });
    const read = await readScenarioAnalysis({
      scenarioId: capture.run_metadata.scenario_id,
      graph: capture.canonical_graph,
      requestId: 's3-dominant-driver-reload',
    });
    expect(read.current_read.run_state, JSON.stringify(read.analysis_state)).toMatchObject({ kind: 'complete_current' });
    expect(store.readNewestRunDeliveryFor).toHaveBeenCalledWith(capture.run_metadata.scenario_id, record.run_id);
    expect(read.current_read.delivered_record).toBeDefined();
    const reloaded = read.current_read.delivered_record!.phase3_blocks;
    expect(JSON.stringify(reloaded)).toBe(JSON.stringify([block]));
    expect(reloaded[0]).toMatchObject({ body: GROUNDED });
    expect(goalChanceDriverDisplayForAgent(read.analysis_result, capture.canonical_graph))
      .toEqual(goalChanceDriverDisplayForAgent(fact.result, capture.canonical_graph));
  });
});
