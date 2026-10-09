/**
 * S3 / AIE #87: coaching eligibility does not license a measured flip threshold.
 * Captured enrichment and served/reloaded block bytes: P45 B1 month-12 D2 run2.
 * Fixture provenance records source selectors and SHA256; no host path is read.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';
import { RunDeliveredRecordSchema, type RunDeliveredRecord } from '@talchain/schemas/boundary';
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
const LEEDS_GROUNDED = 'Leeds Site Activation is doing most of the work in this result.';
const SUBSCRIBERS_ID = 'monthly_new_pro_subscribers';
const LEEDS_ID = 'fac_leeds_site';
const THRESHOLD = 'A sensitivity check shows how far it can move before the most-supported option changes.';
const NO_FLIP_TAIL = 'The analysis swept its tested range without the ranking changing, so a sensitivity check here tells you how much of the margin it carries rather than whether the order would hold.';
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
// NEGATIVE transplant: the only measured pair is Leeds, but the selected
// dominant subject remains subscribers. Neither this nor the matched contrast
// below is a new live capture.
const realThresholdEnrichment = (): Enrichment => ({
  ...structuredClone(capture.analysis_result.enrichment),
  flip_thresholds: structuredClone(realFlip.flip_thresholds),
  flip_thresholds_status: 'available',
});

// Constructed POSITIVE: retain the real Leeds pair byte-for-byte and make Leeds
// itself the dominant driver by replacing the captured top factor's identity
// and label. Influence scores/ranks and all other captured signals stay intact.
const matchedThresholdEnrichment = (): Enrichment => ({
  ...realThresholdEnrichment(),
  factor_sensitivity: capture.analysis_result.enrichment.factor_sensitivity.map((row) =>
    row.factor_id === SUBSCRIBERS_ID
      ? { ...structuredClone(row), factor_id: LEEDS_ID, factor_label: 'Leeds Site Activation' }
      : structuredClone(row)),
});

const controls = [
  { name: 'unavailable capture', enrichment: () => structuredClone(capture.analysis_result.enrichment),
    subject: SUBSCRIBERS_ID, rationale: 'DOMINANT_DRIVER', generic: QUALITATIVE, body: GROUNDED },
  { name: 'Leeds transplant NEGATIVE', enrichment: realThresholdEnrichment,
    subject: SUBSCRIBERS_ID, rationale: 'DOMINANT_DRIVER', generic: QUALITATIVE, body: GROUNDED },
  { name: 'Leeds dominant POSITIVE', enrichment: matchedThresholdEnrichment,
    subject: LEEDS_ID, rationale: 'DOMINANT_DRIVER', generic: `${QUALITATIVE} ${THRESHOLD}`,
    body: `${LEEDS_GROUNDED} ${THRESHOLD}` },
  { name: 'matched pair but unavailable', enrichment: () => ({ ...matchedThresholdEnrichment(), flip_thresholds_status: 'unavailable' }),
    subject: LEEDS_ID, rationale: 'DOMINANT_DRIVER', generic: QUALITATIVE, body: LEEDS_GROUNDED },
  { name: 'available without rows', enrichment: () => ({ ...capture.analysis_result.enrichment, flip_thresholds_status: 'available' }),
    subject: SUBSCRIBERS_ID, rationale: 'DOMINANT_DRIVER', generic: QUALITATIVE, body: GROUNDED },
  { name: 'unusable matching row', enrichment: () => ({ ...capture.analysis_result.enrichment,
    flip_thresholds_status: 'available', flip_thresholds: [{ factor_id: SUBSCRIBERS_ID, current_value: 25, flip_value: null }] }),
    subject: SUBSCRIBERS_ID, rationale: 'DOMINANT_DRIVER', generic: QUALITATIVE, body: GROUNDED },
  { name: 'attested no flip', enrichment: () => ({ ...capture.analysis_result.enrichment,
    flip_thresholds_status: 'available', flip_thresholds: [{ factor_id: SUBSCRIBERS_ID,
      current_value: 25, flip_value: null, flip_reason: 'no_effect_within_bounds' }] }),
    subject: SUBSCRIBERS_ID, rationale: 'DOMINANT_DRIVER_NO_FLIP', generic: `${QUALITATIVE} ${NO_FLIP_TAIL}`,
    body: `${GROUNDED} ${NO_FLIP_TAIL}` },
];

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

  it('row 2: Leeds transplant NEGATIVE keeps subscribers qualitative', () => {
    const enrichment = realThresholdEnrichment();
    expect(readTopLevelFlipRows(enrichment).filter((row) => row.kind === 'flip_pair').map((row) => row.factor_id)).toEqual([LEEDS_ID]);
    const fact = makeFact(enrichment);
    expect(selectLens(fact)?.subjectRef?.id).toBe(SUBSCRIBERS_ID);
    expect(selectLens(fact)?.body).toBe(QUALITATIVE);
    expect(buildLensSuggestionCoachingBlock(fact, CTX, null)?.body).toBe(GROUNDED);
  });

  it('row 3: identity-matched Leeds POSITIVE keeps both sentences byte-identical', () => {
    const enrichment = matchedThresholdEnrichment();
    expect(enrichment.flip_thresholds).toEqual(realFlip.flip_thresholds);
    expect(readTopLevelFlipRows(enrichment).filter((row) => row.kind === 'flip_pair').map((row) => row.factor_id)).toEqual([LEEDS_ID]);
    const fact = makeFact(enrichment);
    expect(selectLens(fact)?.subjectRef?.id).toBe(LEEDS_ID);
    expect(selectLens(fact)?.body).toBe(`${QUALITATIVE} ${THRESHOLD}`);
    expect(buildLensSuggestionCoachingBlock(fact, CTX, null)?.body).toBe(`${LEEDS_GROUNDED} ${THRESHOLD}`);
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

  it.each(controls)('$name: composer and saved-Run reader use the selected Run evidence', async (control) => {
    const fact = makeFact(control.enrichment());
    const before = JSON.stringify(fact.result);
    expect.soft(selectLens(fact)).toMatchObject({
      rationaleCode: control.rationale, subjectRef: { id: control.subject }, body: control.generic,
    });
    const block = buildLensSuggestionCoachingBlock(fact, CTX, null)!;
    expect.soft(block.body).toBe(control.body);
    // A different persisted Run carries a MATCHED measured pair for the very
    // subject selected here. It must not license this Run's coaching/reload.
    const otherRun = makeFact({
      ...control.enrichment(), flip_thresholds_status: 'available',
      flip_thresholds: realFlip.flip_thresholds.filter((row) => row.factor_id === LEEDS_ID)
        .map((row) => ({ ...row, factor_id: control.subject })),
    });
    otherRun.result.run_id = 'other-measured-run';
    otherRun.result.computed_at = '2026-10-08T19:48:25.836Z';
    const record = RunDeliveredRecordSchema.parse({
      record_version: 1,
      run_id: capture.run_metadata.run_id,
      graph_hash: capture.run_metadata.graph_hash_at_run,
      phase3_blocks: [block],
    });
    const saved = JSON.parse(JSON.stringify(record)) as RunDeliveredRecord;
    store.readScenarioRunAnalysisFactsFor.mockResolvedValue({
      facts: [
        { fact, fact_row_id: 's3-row', fact_created_at: fact.result.computed_at },
        { fact: otherRun, fact_row_id: 'other-row', fact_created_at: otherRun.result.computed_at },
      ], total_count: 2,
    });
    store.readNewestRunDeliveryFor.mockClear();
    store.readNewestRunDeliveryFor.mockImplementation(async (_scenarioId, runId) => runId === record.run_id ? ({
      fact_type: 'run_delivery', fact_version: 1, noop: false,
      result: { run_id: record.run_id, record: saved },
    }) : null);
    const read = await readScenarioAnalysis({
      scenarioId: capture.run_metadata.scenario_id,
      graph: capture.canonical_graph,
      requestId: 's3-dominant-driver-reload',
    });
    expect(read.current_read.run_state, JSON.stringify(read.analysis_state)).toMatchObject({ kind: 'complete_current' });
    expect(store.readNewestRunDeliveryFor.mock.calls).toEqual([[capture.run_metadata.scenario_id, record.run_id]]);
    expect(read.current_read.delivered_record).toBeDefined();
    const reloaded = read.current_read.delivered_record!.phase3_blocks;
    expect(JSON.stringify(reloaded)).toBe(JSON.stringify(saved.phase3_blocks));
    const reloadedBlock = reloaded[0];
    if (reloadedBlock.type !== 'coaching') throw new Error('Expected the saved coaching block');
    expect(reloadedBlock.body).toBe(block.body);
    expect(reloadedBlock.body).toBe(control.body);
    if (control.name === 'Leeds dominant POSITIVE') {
      expect(block.target_refs).toEqual([
        { kind: 'factor', id: LEEDS_ID, label: 'Leeds Site Activation' },
      ]);
      expect(saved.phase3_blocks[0].target_refs[0].id).toBe(control.subject);
      expect(reloadedBlock.target_refs[0].id).toBe(control.subject);
      expect(block.body).toContain(THRESHOLD);
      expect(reloadedBlock.body).toContain(THRESHOLD);
    } else if (control.rationale === 'DOMINANT_DRIVER') {
      expect(block.body).not.toContain(THRESHOLD);
      expect(reloadedBlock.body).not.toContain(THRESHOLD);
    }
    if (read.analysis_result?.type !== 'analysis_result') throw new Error('Expected the selected Run analysis result');
    expect(read.analysis_result.enrichment?.flip_thresholds).toEqual(fact.result.enrichment?.flip_thresholds);
    expect(goalChanceDriverDisplayForAgent(read.analysis_result, capture.canonical_graph))
      .toEqual(goalChanceDriverDisplayForAgent(fact.result, capture.canonical_graph));
    expect(JSON.stringify(fact.result)).toBe(before);
  });
});

describe('legacy saved DOMINANT_DRIVER reload licence', () => {
  async function reloadSaved(enrichment: Enrichment, block: unknown) {
    const fact = makeFact(enrichment);
    const otherRun = makeFact(matchedThresholdEnrichment());
    otherRun.result.run_id = 'other-measured-run';
    otherRun.result.computed_at = '2026-10-08T19:48:25.836Z';
    const record = RunDeliveredRecordSchema.parse({
      record_version: 1,
      run_id: capture.run_metadata.run_id,
      graph_hash: capture.run_metadata.graph_hash_at_run,
      phase3_blocks: [block, { ...capture.dominant_driver_block,
        block_id: '605d7d86-5426-5d33-9f07-30950bf92fa8', body: 'Keep the reasoning visible.' }],
    });
    const before = JSON.stringify({ record, fact });
    store.readScenarioRunAnalysisFactsFor.mockResolvedValue({
      facts: [
        { fact, fact_row_id: 'saved-row', fact_created_at: fact.result.computed_at },
        { fact: otherRun, fact_row_id: 'other-row', fact_created_at: otherRun.result.computed_at },
      ], total_count: 2,
    });
    store.readNewestRunDeliveryFor.mockClear();
    store.readNewestRunDeliveryFor.mockResolvedValue({
      fact_type: 'run_delivery', fact_version: 1, noop: false,
      result: { run_id: record.run_id, record },
    });
    const read = await readScenarioAnalysis({
      scenarioId: capture.run_metadata.scenario_id, graph: capture.canonical_graph,
      requestId: 'r3-legacy-dominant-driver-reload',
    });
    expect(read.current_read.run_state).toMatchObject({ kind: 'complete_current' });
    expect(store.readNewestRunDeliveryFor.mock.calls).toEqual([[capture.run_metadata.scenario_id, record.run_id]]);
    expect(read.current_read.delivered_record).toBeDefined();
    expect(JSON.stringify({ record, fact })).toBe(before);
    return { saved: record, reloaded: read.current_read.delivered_record! };
  }

  function expectOnlyTailDropped(saved: RunDeliveredRecord, reloaded: RunDeliveredRecord, body: string) {
    expect(JSON.stringify(reloaded)).toBe(JSON.stringify({
      ...saved, phase3_blocks: [{ ...saved.phase3_blocks[0], body }, saved.phase3_blocks[1]],
    }));
  }

  it('reload row 1: captured reload.analysis.txt:167 old false tail is removed', async () => {
    const source = capture.provenance.analysis_text_captures.find((row) => row.source_file.endsWith('/reload.analysis.txt'))!;
    expect(source.line).toBe(167);
    expect(source.body).toBe(capture.dominant_driver_block.body);
    expect(capture.dominant_driver_block.target_refs).toEqual([]);
    const { saved, reloaded } = await reloadSaved(capture.analysis_result.enrichment, capture.dominant_driver_block);
    expectOnlyTailDropped(saved, reloaded, GROUNDED);
  });

  it('reload row 2: composer persists matched Leeds subject and reload is unchanged', async () => {
    const enrichment = matchedThresholdEnrichment();
    const block = buildLensSuggestionCoachingBlock(makeFact(enrichment), CTX, null)!;
    expect(block.target_refs[0]).toEqual({ kind: 'factor', id: LEEDS_ID, label: 'Leeds Site Activation' });
    const { saved, reloaded } = await reloadSaved(enrichment, block);
    expect(JSON.stringify(reloaded)).toBe(JSON.stringify(saved));
    expect(reloaded.phase3_blocks[0]).toMatchObject({ body: `${LEEDS_GROUNDED} ${THRESHOLD}` });
  });

  it('reload row 2b: a LICENSED but ungrounded block drops the tail on the turn too, so turn === reload (no typed subject, no tail)', async () => {
    const enrichment = matchedThresholdEnrichment();
    enrichment.factor_sensitivity = (enrichment.factor_sensitivity as Array<Record<string, unknown>>).map((row: Record<string, unknown>) =>
      row.factor_id === LEEDS_ID ? { ...row, influence_rank: undefined } : row);
    const fact = makeFact(enrichment);
    expect(selectLens(fact)?.subjectRef?.id, 'still the Leeds subject').toBe(LEEDS_ID);
    expect(selectLens(fact)?.body, 'the selection is still licensed').toBe(`${QUALITATIVE} ${THRESHOLD}`);
    const block = buildLensSuggestionCoachingBlock(fact, CTX, null)!;
    expect(block.target_refs, 'grounding refused (no influence_rank, as the refusal row above) → no typed subject').toEqual([]);
    expect(block.body.endsWith(THRESHOLD), 'no tail without its persisted subject').toBe(false);
    // Saved under the Run's own (valid, licensed) enrichment: the stored rank gap only refuses grounding at compose time.
    const { saved, reloaded } = await reloadSaved(matchedThresholdEnrichment(), block);
    expect(JSON.stringify(reloaded)).toBe(JSON.stringify(saved));
  });

  it.each([
    { name: 'typed subject does not match the measured pair', refs: [{ kind: 'factor', id: SUBSCRIBERS_ID, label: 'Monthly new Pro subscribers' }], enrichment: matchedThresholdEnrichment },
    { name: 'matched typed subject but selected Run is unavailable', refs: [{ kind: 'factor', id: LEEDS_ID, label: 'Leeds Site Activation' }], enrichment: () => ({ ...matchedThresholdEnrichment(), flip_thresholds_status: 'unavailable' }) },
    { name: 'matched typed subject but only another Run measured it', refs: [{ kind: 'factor', id: LEEDS_ID, label: 'Leeds Site Activation' }], enrichment: () => ({ ...matchedThresholdEnrichment(), flip_thresholds: [] }) },
    { name: 'matching words with no typed subject', refs: [], enrichment: matchedThresholdEnrichment },
    { name: 'non-factor typed ref', refs: [{ kind: 'option', id: LEEDS_ID, label: 'Leeds Site Activation' }], enrichment: matchedThresholdEnrichment },
    { name: 'ambiguous typed factor refs', refs: [{ kind: 'factor', id: LEEDS_ID, label: 'Leeds Site Activation' }, { kind: 'factor', id: SUBSCRIBERS_ID, label: 'Monthly new Pro subscribers' }], enrichment: matchedThresholdEnrichment },
  ])('$name drops only the tail', async (control) => {
    const { saved, reloaded } = await reloadSaved(control.enrichment(), {
      ...capture.dominant_driver_block, body: `${LEEDS_GROUNDED} ${THRESHOLD}`, target_refs: control.refs,
    });
    expectOnlyTailDropped(saved, reloaded, LEEDS_GROUNDED);
  });
});
