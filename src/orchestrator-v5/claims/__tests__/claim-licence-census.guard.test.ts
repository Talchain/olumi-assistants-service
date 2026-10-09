import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import ts from 'typescript';
import * as winnerReader from '../../coaching/decision-review-enricher.js';
import * as chanceLicenceReader from '../../goal-target/goal-chance-licence.js';
import * as rangeRecordReader from '../../goal-target/goal-chance-range-record.js';
import * as headlineReader from '../../coaching/analysis-result-headline.js';
import { createRunAnalysisHandler } from '../../tools/handlers/run-analysis.js';
import type { HandlerInvocation } from '../../tools/registry.js';
import type { PLoTClient } from '../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../orchestrator/types.js';
import { discoverClaimOwners, claimLicenceRatchetFailures } from '../../../../scripts/ci/claim-licence-discovery.js';
import { CLASS_MARKERS, type ClaimLicenceEntry } from '../claim-licence-registry.js';
import { goalChanceDriverDisplayForAgent, goalChanceRangeDisplayForAgent } from '../../goal-target/goal-chance-range-agent.js';
import { goalChanceScreenLinesForAgent } from '../../agent-lane/goal-chance-screen-lines.js';
import { untestedHorizonLineForCells, withUntestedHorizonWarning } from '../../agent-lane/decision-input-ask.js';
import { buildAnalysisResultHeadline } from '../../coaching/analysis-result-headline.js';
import { tippingPointOf, decisionSensitivityOf, analysisResultForAgent } from '../../agent-lane/decision-sensitivity.js';
import { tippingPointCoachingFor } from '../../agent-lane/tipping-point-coaching.js';
import { buildWinnerNamingReplacement } from '../../compose/winner-naming-egress-guard.js';
import { DOMINANT_DRIVER_MEASURED_TAIL, hasMeasuredFlipThresholdFor } from '../../compose/lens-selector.js';
import { deliveredRecordWithThresholdLicence } from '../../../routes/delivered-record-licence.js';

import { assembleContextPack } from '../../context/context-pack-assembler.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';
import { selectLens } from '../../compose/lens-selector.js';
import { buildReviewCardBlocks, buildGraphNodeLookup } from '../../compose/phase3-blocks.js';
import { flipThresholdFallbackBody } from '../../compose/flip-threshold-card-row.js';
import { formatAnalysisForContext, tippingRiskPhrase } from '../../format/format-analysis-for-context.js';
import { tryPostAnalysisAdviceGate } from '../../routing/post-analysis-advice-gate.js';
import { composeWhatWouldFlipFallback, composeWithheldSensitivityBody, ATTESTED_NO_FLIP_SENTENCE, ATTESTED_NO_FLIP_SENTENCE_LEADER_FREE } from '../../tools/handlers/explanation-fallback.js';
import { composeOptionTargetedFlipAnswer } from '../../tools/handlers/whatif/compose-option-targeted-flip.js';
import { filterFlipSummaryEntries } from '../../compose/flip-proposal.js';
import { pickLatestFlipSummary } from '../../coaching/pick-flip-summary.js';
import { readTopLevelFlipRows } from '../../context/flip-threshold-rows.js';
import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';
// CI data (scripts/ci), not src: see the note at the end of claim-licence-registry.ts.
const CLAIM_LICENCE_REGISTRY = JSON.parse(readFileSync(new URL('../../../../scripts/ci/claim-licence-registry.json', import.meta.url), 'utf8')) as readonly ClaimLicenceEntry[];

type Json = Record<string, unknown>;
const root = resolve(import.meta.dirname, '../../../..');
const object = (value: unknown): Json => value as Json;
const clone = <T>(value: T): T => structuredClone(value);
const fixture = (name: string): Json => JSON.parse(readFileSync(resolve(root,
  'src/orchestrator-v5/agent-lane/__tests__/fixtures', name), 'utf8')) as Json;
// Served capture provenance remains in the existing fixture and its screen-line test; no synthetic Run is called served.
const pointCapture = fixture('waveB5-t1b-3fce64f-run1-turn003.json');
const rangeCapture = fixture('waveB4-unseen1-01a2b27-run1-turn003.json');
const block = (capture: Json): Json => (capture.blocks as Json[]).find(b => b.type === 'analysis_result')!;
const warnings = (result: Json): Json[] => object(result.enrichment).inference_warnings as Json[];
const withoutRecord = (result: Json, code: string): Json => {
  const copy = clone(result);
  object(copy.enrichment).inference_warnings = warnings(copy).filter(w => w.code !== code);
  return copy;
};
const headline = (enrichment: Json, subjectId = 'opt_a'): string => buildAnalysisResultHeadline({
  enrichment, leading_option_id: subjectId, status_kind: 'ok',
}) ?? '';
// Author fixture, same shape and values as analysis-result-headline.test.ts's single-option / no-flip controls.
const leader = { results: [{ option_id: 'opt_a', option_label: 'Option A', win_probability: 0.62 }] };
const plainLeaderLabel = 'Expand regional capability '.repeat(6).trim();
const noFlip = { ...leader, robustness: { is_robust: false }, flip_thresholds: [
  { factor_id: 'fac_a', current_value: 0.5, flip_value: null, flip_reason: 'structurally_invariant' },
] };
// Author fixture from untested-horizon-line.test.ts; final cell kind, never a bare licence presence, owns chance wording.
const horizonGraph = { nodes: [{ id: 'goal', kind: 'goal', label: 'Revenue', goal_threshold_raw: 20000,
  goal_threshold_unit: '£/month', goal_horizon_months: 12 }], edges: [] };
// Author mutations of served carriers remain author controls, not additional served evidence.
const pointX = 'raise_prices_10', pointY = 'launch_49_starter_tier';
const rangeX = 'fourth_shop_in_clifton', rangeY = 'wholesale_to_offices';
const licenceOf = (r: Json, code = 'GOAL_CHANCE_LICENSED'): Json => warnings(r).find(w => w.code === code)!;
const nodeLabel = (graph: unknown, id: unknown): string =>
  ((object(graph).nodes as Json[]).find(n => n.id === id)!.label as string);
const screen = (r: Json, graph: unknown) => goalChanceScreenLinesForAgent(r, graph, true);
const assertChanceMismatch = (): void => {
  const r = block(pointCapture), graph = pointCapture.draft_graph;
  const lines = screen(r, graph);
  expect(lines.find(l => l.option_id === pointX)?.chance).toContain('about 47% chance of meeting your goal');
  expect(lines.find(l => l.option_id === pointY)?.chance, 'MISMATCH: X percent cannot license Y').toContain('about 34% chance of meeting your goal');
  const onlyX = clone(r);
  delete object(licenceOf(onlyX).pct_by_option)[pointY];
  const own = screen(onlyX, graph);
  expect(own.find(l => l.option_id === pointX)?.chance).toContain('about 47%');
  expect(own.find(l => l.option_id === pointY), 'MISMATCH: usable X but no Y point material').toBeUndefined();
  assertRangeMismatch(); // both chance owners also emit range sentences
};
const assertRangeMismatch = (): void => {
  const r = block(rangeCapture), graph = rangeCapture.draft_graph;
  const display = goalChanceRangeDisplayForAgent(r, graph)!;
  expect(display[rangeX]?.range).toBe('between about 4% and 55%');
  expect(display[rangeY]?.range, 'MISMATCH: X range cannot license Y').toBe('between less than 1% and 5%');
  expect(screen(r, graph).find(l => l.option_id === rangeY)?.chance).toContain('between less than 1% and 5%');
  const onlyX = clone(r), record = licenceOf(onlyX, 'GOAL_CHANCE_RANGE');
  record.option_ids = [rangeX];
  record.range_by_option = { [rangeX]: object(record.range_by_option)[rangeX] };
  expect(goalChanceRangeDisplayForAgent(onlyX, graph)?.[rangeX]?.range).toBe('between about 4% and 55%');
  expect(goalChanceRangeDisplayForAgent(onlyX, graph)?.[rangeY], 'MISMATCH: graph Y cannot borrow range X').toBeUndefined();
  expect(screen(onlyX, graph).find(l => l.option_id === rangeY)).toBeUndefined();
};
const assertDriverMismatch = (): void => {
  const r = block(pointCapture), graph = pointCapture.draft_graph;
  const drivers = object(licenceOf(r).driver_by_option);
  const xLabel = nodeLabel(graph, object(drivers[pointX]).from);
  const yLabel = nodeLabel(graph, object(drivers[pointY]).from);
  expect(xLabel).not.toBe(yLabel);
  const display = goalChanceDriverDisplayForAgent(r, graph);
  expect(display[pointX]).toContain(`‘${xLabel}’`);
  expect(display[pointY], 'MISMATCH: X driver cannot license Y').toContain(`‘${yLabel}’`);
  expect(display[pointY]).not.toContain(`‘${xLabel}’`);
  expect(screen(r, graph).find(l => l.option_id === pointY)?.depends).toBe(display[pointY]);
  const onlyX = clone(r);
  delete object(licenceOf(onlyX).driver_by_option)[pointY];
  expect(goalChanceDriverDisplayForAgent(onlyX, graph)[pointX]).toContain(`‘${xLabel}’`);
  expect(goalChanceDriverDisplayForAgent(onlyX, graph)[pointY], 'MISMATCH: own point Y with driver material only for X').toBeUndefined();
  expect(screen(onlyX, graph).find(l => l.option_id === pointY)?.depends).toBe('');
};
const assertSoleGoalMismatch = (): void => {
  const goal = { id: 'goal', kind: 'goal', label: 'Revenue' };
  const decoy = { ...horizonGraph.nodes[0], id: 'decoy', kind: 'factor' };
  // Same held horizon/target fields on another node, placed FIRST to catch first-value selection.
  const graph = { nodes: [decoy, goal], edges: [] };
  expect(untestedHorizonLineForCells(graph, []), 'MISMATCH: non-goal horizon must not license sole goal').toBeNull();
  expect(JSON.stringify(withUntestedHorizonWarning({ inference_warnings: [] }, graph, []))).not.toContain('within 12 months');
  const own = { nodes: [decoy, { ...goal, goal_horizon_months: 9 }], edges: [] };
  expect(untestedHorizonLineForCells(own, [])).toContain('within 9 months');
  expect(untestedHorizonLineForCells(own, [])).not.toContain('within 12 months');
  const warning = JSON.stringify(withUntestedHorizonWarning({ inference_warnings: [] }, own, []));
  expect(warning).toContain('within 9 months');
  expect(warning).not.toContain('within 12 months');
};
const assertSensitivityMismatch = (): void => {
  const e = {
    factor_evppi: [
      { factor_id: 'fac_a', status: 'resolved', evppi: 0.04, spread_source: 'user' },
      { factor_id: 'fac_b', status: 'resolved', evppi: 0.02, spread_source: 'template' },
    ],
    factor_sensitivity: [
      { factor_id: 'fac_b', factor_label: 'Other assumption' },
      { factor_id: 'fac_a', factor_label: 'Own assumption' },
    ],
  };
  expect(decisionSensitivityOf(e)).toMatchObject({ status: 'measured', most_sensitive: { factor_id: 'fac_a', range: 'yours' } });
  expect(decisionSensitivityOf(e), 'MISMATCH: B assumed spread cannot license A assumed-range claim').not.toHaveProperty('say');
  const own = clone(e);
  own.factor_evppi[0]!.spread_source = 'template';
  const matched = decisionSensitivityOf(own);
  expect(matched).toHaveProperty('say', expect.stringContaining('Olumi assumed for Own assumption'));
  expect(matched).toHaveProperty('say', expect.not.stringContaining('Other assumption'));
};
const storedClaim = (enrichment: Json, subject = 'opt_a'): string => {
  const input = winnerReader.buildInvokeInputForTests('Census author brief', enrichment, subject);
  return input === null ? '' : buildWinnerNamingReplacement(input.winner, 'census');
};
const assertStoredWinnerMismatch = (): void => {
  const other = { option_id: 'opt_b', option_label: 'Option B', win_probability: 0.62 };
  for (const wrap of leaderCarriers) {
    expect(storedClaim(wrap([other])), 'MISMATCH: stored egress for A cannot borrow B').toBe('');
    expect(storedClaim(wrap([{ ...other, option_id: 'opt_a', option_label: 'Option A' }])))
      .toContain('Option A was supported by 62%');
  }
};
// Actual current-response handler, with old/other-Run material present in BOTH prior-fact carriers.
const currentRunHeadline = async (current: Json): Promise<{ text: string; enrichment: Json }> => {
  const scenarioId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const graph = { nodes: [{ id: 'g', kind: 'goal', label: 'Goal' }], edges: [] };
  const historical = { fact_type: 'run_analysis', fact_version: 1, noop: false, result: {
    scenario_id: scenarioId, leading_option_id: 'opt_a', summary: 'Old run', enrichment: noFlip,
    graph_hash_at_run: 'old-graph', computed_at: '2026-10-01T00:00:00.000Z',
  } };
  const invocation = {
    context: { stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {},
      messages: [{ role: 'user', content: 'run analysis' }], session_id: scenarioId, request_id: 'r3-current-run',
      budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 }, prior_turns: [], prior_facts: [historical],
      scenarioBriefText: null, persistedGraph: null },
    priorFacts: [historical],
    payload: { turn_id: 'r3', scenario_id: scenarioId, message: 'run analysis', turn_class: 'decide', stage: 'analyse' },
    requestId: 'r3-current-run', signal: new AbortController().signal, orientationText: '',
  } as unknown as HandlerInvocation;
  const handler = createRunAnalysisHandler({
    plotClient: { run: async () => ({ analysis_status: 'computed', ...clone(current) } as unknown as V2RunResponseEnvelope),
      validatePatch: async () => ({}) } as unknown as PLoTClient,
    scenarioReader: async () => ({ graph, rawPersistedGraph: graph, goal_node_id: 'g', options: [
      { id: 'opt_a', option_id: 'opt_a', label: 'Option A', interventions: { fac_price: 1.2 } },
      { id: 'opt_b', option_id: 'opt_b', label: 'Option B', interventions: { fac_price: 0.9 } },
    ] }),
  });
  const outcome = await handler(invocation);
  const fact = outcome.handler_facts[0]!;
  if (fact.fact_type !== 'run_analysis') throw new Error('Expected current run_analysis fact');
  expect(fact.result.summary).toBe(outcome.assistant_text); // same source as reply
  return { text: outcome.assistant_text, enrichment: object(fact.result.enrichment) };
};
const assertOtherRunMismatch = async (): Promise<void> => {
  const selected = await currentRunHeadline(leader);
  expect(selected.text, 'MISMATCH: stale/other Run no-flip cannot license selected current Run').not.toContain('no single factor we tested');
  expect(selected.text).not.toContain('not yet robust');
  const otherSubject = await currentRunHeadline({ results: [
    { option_id: 'opt_b', option_label: 'Option B', win_probability: 0.62 },
  ] });
  expect(storedClaim(otherSubject.enrichment), 'MISMATCH: old A result cannot supply current A winner').toBe('');
};
// #2890: the DOMINANT_DRIVER measured tail. Real witness flip rows; the only measured pair is fac_leeds_site.
const DD_FLIP = JSON.parse(readFileSync(resolve(root,
  'tests/fixtures/cross-service/witness-2265-runA.flip-threshold-winner.json'), 'utf8')) as { flip_thresholds: unknown[] };
const DD_MEASURED = 'fac_leeds_site';
const DD_OTHER = 'monthly_new_pro_subscribers';
const ddEnrichment = (status = 'available'): Record<string, unknown> =>
  ({ flip_thresholds: structuredClone(DD_FLIP.flip_thresholds), flip_thresholds_status: status });
const ddSaved = (factorId: string) => ({ phase3_blocks: [{ type: 'coaching', target_refs: [{ kind: 'factor', id: factorId, label: 'L' }],
  body: `L is doing most of the work in this result. ${DOMINANT_DRIVER_MEASURED_TAIL}` }] }) as unknown as Parameters<typeof deliveredRecordWithThresholdLicence>[0];
const ddReloadBody = (factorId: string, enrichment: Record<string, unknown>): string =>
  (deliveredRecordWithThresholdLicence(ddSaved(factorId), enrichment).phase3_blocks[0] as { body: string }).body;
const assertDominantDriverTailMismatch = () => {
  expect(hasMeasuredFlipThresholdFor(ddEnrichment(), DD_OTHER), 'MISMATCH: a Leeds pair cannot license a subscribers tail').toBe(false);
  expect(ddReloadBody(DD_OTHER, ddEnrichment()), 'MISMATCH on reload: tail stripped').not.toContain(DOMINANT_DRIVER_MEASURED_TAIL);
};
const FL_SERVED = JSON.parse(readFileSync(resolve(root, 'tests/fixtures/cross-service/b5-per-limit/0e19bb82.served-turn.json'), 'utf8')) as Json;
// Author controls transplant witnessed Leeds rows; all doors consume the selected carrier.
const flFact = (enrichment: Json, at = '2026-10-09T00:00:00.000Z'): RunAnalysisHandlerFact => ({
  fact_type: 'run_analysis', fact_version: 1, noop: false, result: { scenario_id: 'census-flip',
    leading_option_id: 'opt_leeds', summary: 'Analysis complete.', computed_at: at, graph_hash_at_run: 'fl-current',
    enrichment: { ...enrichment, graph: { nodes: [
      { id: DD_MEASURED, kind: 'factor', label: 'Leeds Site Activation' },
      { id: DD_OTHER, kind: 'factor', label: 'Monthly subscribers' },
      { id: 'opt_leeds', kind: 'option', label: 'Leeds' },
      { id: 'opt_bristol', kind: 'option', label: 'Bristol' },
      { id: 'opt_status_quo', kind: 'option', label: 'Status Quo' },
    ], edges: [] } },
  },
}) as unknown as RunAnalysisHandlerFact;
const flSummary = (e: Json) => {
  const summary = pickLatestFlipSummary([flFact(e)]);
  if (summary !== null) {
    expect(summary).not.toHaveProperty('selectedRunEnrichment');
    expect(filterFlipSummaryEntries(summary, new Set())).not.toHaveProperty('selectedRunEnrichment');
  }
  return summary;
};
const flProjection = { status: 'complete', leading_option: { label: 'Leeds', probability: 0.7 },
  runner_up: null, margin_pp: null, robustness_band: null,
  top_drivers: [{ factor_label: 'Leeds Site Activation', sensitivity_value: 0.5 }] };
const flNoFlip = object(object(JSON.parse(readFileSync(resolve(root,
  'tests/fixtures/cross-service/witness-2267-attested-no-flip.json'), 'utf8'))).runs).f as Json;
const flNoWords = (words: unknown) => expect(JSON.stringify(words) ?? '').not.toMatch(/could change if|moves from|moves far enough|threshold signal|analysis found (?:a )?single-factor tipping point|no single factor on its own reached|no single-factor tipping point at all|reached a tipping point|has a tipping point|would lead instead|could flip|would flip|before the most-supported option changes/);
const flLens = (e: Json, id: string, category: string) => selectLens(flFact({ ...e,
  factor_sensitivity: [{ factor_id: id, factor_label: 'Subject', influence_score: 0.5, influence_rank: 1, flip_risk_category: category },
    { factor_id: 'other-equal', influence_score: 0.5, influence_rank: 2 }],
}))?.body ?? null;
const flCards = (e: Json, id: string) => {
  const f = flFact({ ...e, decision_review: { flip_thresholds: [{ factor_id: id,
    factor_label: id === DD_MEASURED ? 'Leeds Site Activation' : 'Monthly subscribers',
    narrative: 'If the factor moves far enough, the most-supported option would change.' }] } });
  return buildReviewCardBlocks(f, buildGraphNodeLookup(f), { created_at: '2026-10-09T00:00:00.000Z', graph_hash_at_generation: 'fl-current' })
    .filter(b => b.card_kind === 'flip_threshold');
};
const flFormat = (e: Json, id: string) => {
  const row = readTopLevelFlipRows(ddEnrichment()).find(r => r.factor_id === DD_MEASURED)!;
  return formatAnalysisForContext({ status: 'complete', leading_option: null, runner_up: null, margin_pp: null,
    robustness_band: null, top_drivers: [], fragile_edges: [], flip_thresholds: [{ factor_id: id,
      factor_label: 'Subject', current_value: row.current_value, flip_value: row.flip_value, unit: row.unit,
      no_flip_within_bounds: false }] }, { analysisFreshness: 'fresh', selectedRunEnrichment: e });
};
const flPack = (enrichment: Json, freshness = 'fresh') => assembleContextPack({
  payload: makeMessagePayload(), priorTurns: [], priorFacts: [flFact(ddEnrichment())],
  selectedRunEnrichment: enrichment,
  analysis: { analysis_status: 'complete', winner: { option_id: 'opt_leeds', option_label: 'Leeds', win_probability: 0.7 },
    options: [], top_drivers: [], robustness_level: 'moderate', fragile_edge_count: 0, margin: 0.4, margin_pp: 40,
    flip_thresholds: [{ factor_id: DD_MEASURED, factor_label: 'Leeds', current_value: 50, flip_value: 77, unit: null }] },
  coachingContext: { freshness, analysis_present: true, readiness_status: null, rerun_required: freshness !== 'fresh',
    usable_for_prose: true, usable_for_chips: freshness === 'fresh', blocked: false, actionable_blocker_count: 0 },
} as Parameters<typeof assembleContextPack>[0]).display_analysis;
const flAdvice = (e: Json, id: string) => {
  const result = tryPostAnalysisAdviceGate({ message: 'What would flip this?', freshness: 'fresh',
    analysis: { status: 'success', leading_option: { label: 'Leeds' }, top_drivers: [{ factor_label: 'Subject' }] },
    decisionReview: { flip_thresholds: [{ factor_id: id, factor_label: 'Subject' }] }, selectedRunEnrichment: e, flipClaimPosture: 'attested_no_flip' });
  expect(result.matched).toBe(true);
  return result.matched ? result.assistant_text : '';
};
const flFallback = (e: Json) => {
  const summary = flSummary(e);
  const controlled = summary?.entries.find(entry => entry.factor_id !== DD_MEASURED)?.factor_id;
  return composeWhatWouldFlipFallback(flProjection, e, null, summary == null ? summary
    : filterFlipSummaryEntries(summary, new Set(controlled == null ? [] : [controlled])));
};
const flTarget = (e: Json, target = 'opt_bristol', permission = true) => composeOptionTargetedFlipAnswer({ selectedRunEnrichment: e,
  target: { id: target, label: 'Target' }, flipSummary: flSummary(e), leadingOptionId: 'opt_leeds', mayNameLeadingOption: permission,
});
const flTipRead = (e: Json) => ({ graphHash: FL_SERVED.graph_hash as string, analysisResult: { type: 'analysis_result',
  computed_against_hash: FL_SERVED.graph_hash, enrichment: e }, analysisState: { run_state: { kind: 'complete_current', computed_at: '2026-10-09T00:00:00.000Z' } } });
const flOtherRun = () => {
  const selected = flFact({}, '2026-10-09T01:00:00.000Z');
  expect(pickLatestFlipSummary([flFact(ddEnrichment()), selected]), 'MISMATCH: other Run cannot fill selected Run').toBeNull();
  flNoWords(composeWhatWouldFlipFallback(flProjection, {}, null, pickLatestFlipSummary([flFact(ddEnrichment()), selected])));
};
const flBehaviourRows: Record<string, () => void> = {
  'flip_threshold.factor.tip': () => {
    expect(tippingPointOf(FL_SERVED.enrichment, 'pro_plan_price')).toHaveProperty('say', expect.stringContaining('could change if'));
    expect(tippingPointOf({}, DD_MEASURED)).not.toHaveProperty('say');
    expect(tippingPointOf({ ...object(FL_SERVED.enrichment), flip_thresholds_status: 'unavailable' }, 'pro_plan_price')).not.toHaveProperty('say');
    flNoWords(object(analysisResultForAgent(flTipRead(object(FL_SERVED.enrichment)).analysisResult, undefined, false)).tipping_point);
  },
  'flip_threshold.factor.coaching': () => {
    expect(tippingPointCoachingFor('cee-sci-hero-contract', flTipRead(object(FL_SERVED.enrichment)), {}, 'pro_plan_price').reply).toContain('could change if');
    flNoWords(tippingPointCoachingFor('cee-sci-hero-contract', flTipRead({}), {}, 'pro_plan_price').reply);
    flNoWords(tippingPointCoachingFor('cee-sci-hero-contract', flTipRead({ ...object(FL_SERVED.enrichment), flip_thresholds_status: 'unavailable' }), {}, 'pro_plan_price').reply);
  },
  'flip_threshold.factor.card_fallback': () => {
    expect(flipThresholdFallbackBody('Leeds', '50%', '77%', ddEnrichment(), DD_MEASURED)).toContain('moves from');
    expect(flipThresholdFallbackBody('Leeds', '50%', '77%', {}, DD_MEASURED)).toBeNull();
  },
  'flip_threshold.factor.isolated': () => {
    expect(flLens(ddEnrichment(), DD_MEASURED, 'isolated')).toContain('could flip');
    flNoWords(flLens({}, DD_MEASURED, 'isolated'));
  },
  'flip_threshold.factor.correlated': () => {
    expect(flLens(ddEnrichment(), DD_MEASURED, 'correlated')).toContain('could change');
    flNoWords(flLens({}, DD_MEASURED, 'correlated'));
  },
  'flip_threshold.factor.cards': () => {
    expect(flCards(ddEnrichment(), DD_MEASURED)).toHaveLength(1);
    expect(flCards({}, DD_MEASURED)).toEqual([]);
  },
  'flip_threshold.factor.format': () => {
    expect(flFormat(ddEnrichment(), DD_MEASURED)?.tipping_points).toHaveLength(1);
    expect(flPack(ddEnrichment())?.tipping_points).toHaveLength(1);
    expect(flPack({})?.tipping_points).toBeUndefined();
    expect(flPack(ddEnrichment(), 'stale')?.tipping_points).toEqual([{ label: 'Leeds', risk: 'only a large increase would flip the result' }]);
    expect(flFormat({}, DD_MEASURED)?.tipping_points).toBeUndefined();
    expect(tippingRiskPhrase(50, 77, false, ddEnrichment(), DD_MEASURED)).toContain('flip');
    expect(tippingRiskPhrase(50, 77, false, {}, DD_MEASURED)).toBeNull();
    const own = readTopLevelFlipRows(flNoFlip)[0]!.factor_id;
    expect(tippingRiskPhrase(null, null, true, flNoFlip, own)).toContain('no flip point');
    expect(tippingRiskPhrase(null, null, true, {}, own)).toBeNull();
    const raw = { status: 'complete', leading_option: null, runner_up: null, margin_pp: null, robustness_band: null, top_drivers: [], fragile_edges: [],
      flip_thresholds: [{ factor_id: DD_MEASURED, factor_label: 'Leeds', current_value: 50, flip_value: 77, unit: null, no_flip_within_bounds: false }] };
    expect(formatAnalysisForContext(raw, { analysisFreshness: 'stale', selectedRunEnrichment: ddEnrichment() })?.tipping_points).toEqual([{ label: 'Leeds', risk: 'only a large increase would flip the result' }]);
  },
  'flip_threshold.factor.advice': () => {
    expect(flAdvice(ddEnrichment(), DD_MEASURED)).toContain('threshold signal');
    expect(flAdvice(flNoFlip, DD_OTHER)).toContain(ATTESTED_NO_FLIP_SENTENCE);
    flNoWords(flAdvice({}, DD_MEASURED));
  },
  'flip_threshold.run.attested': () => {
    expect(flFallback(flNoFlip)).toContain(ATTESTED_NO_FLIP_SENTENCE);
    expect(flFallback({})).not.toContain(ATTESTED_NO_FLIP_SENTENCE);
    expect(flFallback({ ...flNoFlip, flip_thresholds_status: 'unavailable' })).not.toContain(ATTESTED_NO_FLIP_SENTENCE);
    expect(composeWithheldSensitivityBody(flProjection, flSummary(flNoFlip), flNoFlip)).toContain(ATTESTED_NO_FLIP_SENTENCE_LEADER_FREE);
    expect(composeWithheldSensitivityBody(flProjection, flSummary({ ...flNoFlip, flip_thresholds_status: 'unavailable' }), { ...flNoFlip, flip_thresholds_status: 'unavailable' })).not.toContain(ATTESTED_NO_FLIP_SENTENCE_LEADER_FREE);
  },
  'flip_threshold.factor.fallback': () => {
    expect(flFallback(ddEnrichment())).toContain('has a tipping point');
    expect(composeWithheldSensitivityBody(flProjection, flSummary(ddEnrichment()), ddEnrichment())).toContain('found a single-factor tipping point');
    flNoWords(flFallback({}));
    expect(composeWhatWouldFlipFallback({ ...flProjection, robustness_band: 'fragile' }, {}, null, null)).not.toContain('could change the most-supported option');
  },
  'flip_threshold.run.refusal': () => {
    expect(flTarget(flNoFlip)?.text).toContain('no single-factor tipping point at all');
    const noProof = { ...flNoFlip, flip_thresholds_status: 'unavailable' };
    expect(flTarget(noProof)?.text).not.toContain('no single-factor tipping point at all');
    // Available measurements with no target winner license a tested-set refusal.
    expect(flTarget(ddEnrichment(), 'other-option')?.text).toContain('none of the single-factor');
    expect(flTarget({ ...ddEnrichment(), flip_thresholds_status: 'unavailable' }, 'other-option')?.text).toContain('did not isolate');
  },
  'flip_threshold.factor.generic': () => {
    expect(flTarget(ddEnrichment(), 'other-option', false)?.text).toContain('reached a tipping point');
    expect(flTarget({ ...ddEnrichment(), flip_thresholds_status: 'unavailable' }, 'other-option', false)?.text).not.toContain('reached a tipping point');
    expect(flTarget(ddEnrichment())?.kind).toBe('addressed');
    expect(flTarget({ ...flNoFlip, flip_thresholds_status: 'unavailable' }, 'other-option', false)?.text).not.toContain('no single-factor tipping point at all');
  },
};
const flMismatchRows: Record<string, () => void> = {
  'flip_threshold.factor.tip': () => flNoWords(tippingPointOf(FL_SERVED.enrichment, DD_MEASURED)),
  'flip_threshold.factor.coaching': () => {
    flNoWords(tippingPointCoachingFor('cee-sci-hero-contract', flTipRead(object(FL_SERVED.enrichment)), {}, DD_MEASURED).reply);
    const other = { ...flTipRead(object(FL_SERVED.enrichment)), analysisState: { run_state: { kind: 'complete_stale', computed_at: '2026-10-09T00:00:00.000Z' } } };
    flNoWords(tippingPointCoachingFor('cee-sci-hero-contract', other, {}, 'pro_plan_price').reply);
  },
  'flip_threshold.factor.card_fallback': () => expect(flipThresholdFallbackBody('Subscribers', '50', '77', ddEnrichment(), DD_OTHER)).toBeNull(),
  'flip_threshold.factor.isolated': () => flNoWords(flLens(ddEnrichment(), DD_OTHER, 'isolated')),
  'flip_threshold.factor.correlated': () => flNoWords(flLens(ddEnrichment(), DD_OTHER, 'correlated')),
  'flip_threshold.factor.cards': () => expect(flCards(ddEnrichment(), DD_OTHER)).toEqual([]),
  'flip_threshold.factor.format': () => {
    expect(flFormat(ddEnrichment(), DD_OTHER)?.tipping_points).toBeUndefined();
    expect(tippingRiskPhrase(50, 77, false, ddEnrichment(), DD_OTHER)).toBeNull();
    expect(tippingRiskPhrase(null, null, true, flNoFlip, DD_MEASURED)).toBeNull();
  },
  'flip_threshold.factor.advice': () => flNoWords(flAdvice(ddEnrichment(), DD_OTHER)),
  'flip_threshold.run.attested': () => { expect(flFallback(ddEnrichment())).not.toContain(ATTESTED_NO_FLIP_SENTENCE); flOtherRun(); },
  'flip_threshold.factor.fallback': () => {
    const summary = flSummary(ddEnrichment())!;
    const transplanted = { ...summary, entries: summary.entries.map(e => ({ ...e, factor_id: DD_OTHER } )) };
    flNoWords(composeWhatWouldFlipFallback(flProjection, ddEnrichment(), null, transplanted));
    flNoWords(composeWithheldSensitivityBody(flProjection, transplanted, ddEnrichment()));
    const wrongTarget = { ...summary, entries: summary.entries.map(e => ({ ...e, alternative_winner_id: 'other-option', alternative_winner_label: 'Other' })) };
    expect(composeWhatWouldFlipFallback(flProjection, ddEnrichment(), null, wrongTarget)).not.toContain('Other would lead instead');
    flOtherRun();
  },
  'flip_threshold.run.refusal': () => { expect(flTarget(ddEnrichment())?.text).not.toContain('no single-factor tipping point at all'); flOtherRun(); },
  'flip_threshold.factor.generic': () => {
    const summary = flSummary(ddEnrichment())!;
    const input = { target: { id: 'opt_bristol', label: 'Target' }, leadingOptionId: 'opt_leeds', mayNameLeadingOption: true };
    const wrongFactor = { ...summary, entries: summary.entries.map(e => ({ ...e, factor_id: DD_OTHER })) };
    flNoWords(composeOptionTargetedFlipAnswer({ selectedRunEnrichment: ddEnrichment(), ...input, flipSummary: wrongFactor })?.text);
    const wrongTarget = { ...summary, entries: summary.entries.map(e => ({ ...e, alternative_winner_id: 'other-option' })) };
    flNoWords(composeOptionTargetedFlipAnswer({ selectedRunEnrichment: ddEnrichment(), ...input, target: { id: 'other-option', label: 'Other' }, flipSummary: wrongTarget })?.text);
    flNoWords(composeOptionTargetedFlipAnswer({ selectedRunEnrichment: ddEnrichment(), ...input, mayNameLeadingOption: false, flipSummary: wrongFactor })?.text);
  },
};
const rowTests: Record<string, () => void | Promise<void>> = {
  ...flBehaviourRows,
  'flip_threshold.dominant_driver.subject': () => {
    expect(hasMeasuredFlipThresholdFor(ddEnrichment(), DD_MEASURED), 'MATCH: the measured subject').toBe(true);
    expect(ddReloadBody(DD_MEASURED, ddEnrichment()), 'MATCH on reload: kept').toContain(DOMINANT_DRIVER_MEASURED_TAIL);
    expect(hasMeasuredFlipThresholdFor(ddEnrichment('unavailable'), DD_MEASURED), 'absent: unavailable').toBe(false);
    expect(hasMeasuredFlipThresholdFor({}, DD_MEASURED), 'absent: no rows').toBe(false);
    expect(hasMeasuredFlipThresholdFor(ddEnrichment(), null), 'absent: no typed subject').toBe(false);
    expect(ddReloadBody(DD_MEASURED, {}), 'absent on reload: tail stripped').not.toContain(DOMINANT_DRIVER_MEASURED_TAIL);
  },
  'flip_threshold.record': () => {
    const served = JSON.parse(readFileSync(resolve(root,
      'tests/fixtures/cross-service/b5-per-limit/0e19bb82.served-turn.json'), 'utf8')) as Json;
    const measured = tippingPointOf(served.enrichment, undefined);
    expect(measured.status).toBe('found');
    if (measured.status !== 'found') throw new Error('Served crossing required');
    expect(measured.say).toContain('rises above 55.76 GBP/month');
    expect(tippingPointOf({}, undefined)).not.toHaveProperty('say');
    const result = { type: 'analysis_result', computed_against_hash: served.graph_hash, enrichment: served.enrichment };
    const current = { graphHash: served.graph_hash as string, analysisResult: result,
      analysisState: { run_state: { kind: 'complete_current', computed_at: '2026-10-03T00:00:00.000Z' } } };
    expect(tippingPointCoachingFor('cee-sci-hero-contract', current, undefined, undefined).reply).toBe(measured.say);
    const stale = { ...current, analysisState: { run_state: { kind: 'complete_stale', computed_at: '2026-10-03T00:00:00.000Z' } } };
    expect(tippingPointCoachingFor('cee-sci-hero-contract', stale, undefined, undefined).reply).not.toContain('55.76');
    const absent = { ...current, analysisResult: { ...result, enrichment: {} } };
    expect(tippingPointCoachingFor('cee-sci-hero-contract', absent, undefined, undefined).reply).not.toContain('could change if');
  },
  'sensitivity.record': () => {
    // Existing served PIN2 fixture, with explicit author mutation to a resolved/template row as in
    // decision-sensitivity-says-whose-range.test.ts. This is not a claim that the original Run resolved it.
    const served = fixture('served-levelless-pin2-turn3-result.json');
    const enrichment = clone(object(object(served.analysis_result).enrichment));
    const original = enrichment.factor_evppi as Json[];
    const withSource = (source: string, status: string): Json => ({ ...enrichment,
      factor_evppi: original.map((row, i) => i === 0 ? { ...row, status, evppi: 0.04, spread_source: source } : row) });
    expect(decisionSensitivityOf(withSource('template', 'below_resolution'))).not.toHaveProperty('say');
    expect(decisionSensitivityOf(withSource('user', 'resolved'))).not.toHaveProperty('say');
    const trueResult = decisionSensitivityOf(withSource('template', 'resolved'));
    expect(trueResult.status).toBe('measured');
    if (trueResult.status !== 'measured') throw new Error('Resolved fixture required');
    expect(trueResult.say).toContain('Within the range Olumi assumed');
    expect(trueResult.say).toContain('could change how the options compare');
  },
  'chance.record': () => {
    const result = block(pointCapture);
    const words = (r: Json) => goalChanceScreenLinesForAgent(r, pointCapture.draft_graph, true).map(l => l.chance).join(' ');
    expect(words(withoutRecord(result, 'GOAL_CHANCE_LICENSED'))).not.toContain('chance of meeting your goal');
    expect(words(result)).toContain('about 47% chance of meeting your goal');
    expect(goalChanceScreenLinesForAgent(result, pointCapture.draft_graph, false)).toEqual([]);
    // A malformed/duplicate carrier must not revert to raw probability fields.
    const bad = clone(result);
    warnings(bad).push(clone(warnings(bad).find(w => w.code === 'GOAL_CHANCE_LICENSED')!));
    expect(words(bad)).not.toContain('chance of meeting your goal');
  },
  'range.record': () => {
    const result = block(rangeCapture);
    const words = (r: Json) => JSON.stringify(goalChanceRangeDisplayForAgent(r, rangeCapture.draft_graph) ?? {});
    expect(words(withoutRecord(result, 'GOAL_CHANCE_RANGE'))).not.toContain('between');
    expect(words(result)).toContain('between about 4% and 55%');
    const bad = clone(result);
    warnings(bad).push(clone(warnings(bad).find(w => w.code === 'GOAL_CHANCE_RANGE')!));
    expect(words(bad)).not.toContain('between');
  },
  'driver.record': () => {
    const result = block(pointCapture);
    const words = (r: Json) => Object.values(goalChanceDriverDisplayForAgent(r, pointCapture.draft_graph)).join(' ');
    const absent = clone(result);
    delete warnings(absent).find(w => w.code === 'GOAL_CHANCE_LICENSED')!.driver_by_option;
    expect(words(absent)).not.toContain('rests most on');
    expect(words(result)).toContain('It rests most on');
    const bad = clone(result);
    const licence = warnings(bad).find(w => w.code === 'GOAL_CHANCE_LICENSED')!;
    for (const driver of Object.values(object(licence.driver_by_option))) object(driver).kind = 'not_a_driver';
    expect(words(bad)).not.toContain('rests most on');
  },
  'horizon.cells': () => {
    expect(untestedHorizonLineForCells({ nodes: [], edges: [] }, [])).toBeNull();
    expect(untestedHorizonLineForCells(horizonGraph, [])).toContain('within 12 months');
    expect(untestedHorizonLineForCells(horizonGraph, [{ kind: 'figure', display: 'about 40%' }]))
      .toContain("This chance uses the model's numbers");
    expect(untestedHorizonLineForCells(horizonGraph, [{ kind: 'none' }])).not.toContain('This chance');
    const tested = { ...horizonGraph, goal_constraints: [{ node_id: 'time', unit: 'months', label: 'Delivery time' }] };
    expect(untestedHorizonLineForCells(tested, [])).toBeNull();
  },
  'horizon.warning': () => {
    expect(JSON.stringify(withUntestedHorizonWarning({ inference_warnings: [] }, { nodes: [] }, [])))
      .not.toContain('within');
    expect(JSON.stringify(withUntestedHorizonWarning({ inference_warnings: [] }, horizonGraph, [])))
      .toContain('within 12 months');
  },
  'robustness.no_flip': async () => {
    expect(headline({ ...noFlip, robustness: {} })).not.toContain('not yet robust');
    expect(headline(noFlip)).toContain('not yet robust — no single factor we tested would change the order');
    expect(headline({ ...noFlip, flip_thresholds: [] })).not.toContain('no single factor we tested');
    expect((await currentRunHeadline(noFlip)).text).toContain('not yet robust — no single factor we tested would change the order');
  },
  'leader.headline': () => {
    expect(headline({})).not.toContain('supported by');
    expect(headline(leader)).toContain('supported by 62% of runs of this model');
    // MISMATCH: fully usable producer material exists, but only for option B.
    // Run the same whole renderer assertion used by the mutant below.
    assertLeaderMismatch();
    // Legacy id aliases and every declared carrier still match the subject.
    for (const wrap of leaderCarriers) {
      expect(headline(wrap([{ option_id: 'opt_a', option_label: 'Option A', win_probability: 0.62 }])))
        .toContain('Option A was supported by 62%');
      expect(headline(wrap([{ option_id: 'opt_b', option_label: 'Option B', win_probability: 0.62 }])))
        .toBe('');
      expect(headline(wrap([{ id: 'opt_a', label: 'Option A', win_probability: 0.62 }])))
        .toContain('Option A was supported by 62%');
    }
    // A current carrier for B must not license A through an unrelated label/probability.
    expect(headline({ option_comparison: [{ option_id: 'opt_b', option_label: 'Option B', win_probability: 0.62 }],
      decision_brief: { options: [{ option_id: 'opt_b', option_label: 'Option B', win_probability: 0.9 }] } })).toBe('');
    expect(headline({ results: [{ option_id: 'opt_a', option_label: 'Option A', win_probability: NaN }] }))
      .not.toContain('supported by');
  },
  'leader.plain': () => {
    // A single-option length shed exercises RUN_SHARE_PLAIN itself, with no driver/caution claims.
    const rows = [{ option_id: 'opt_a', option_label: plainLeaderLabel, win_probability: 0.62 }];
    const expected = `${plainLeaderLabel} was supported by the most runs of this model.`;
    expect(headline({})).toBe('');
    expect(headline({ results: rows })).toBe(expected);
    expect(headline({ results: [{ ...rows[0], win_probability: NaN }] })).toBe('');
    for (const wrap of leaderCarriers) {
      expect(headline(wrap(rows))).toBe(expected);
      // Same label and valid value; only the producer subject id changes.
      expect(headline(wrap([{ ...rows[0]!, option_id: 'opt_b' }]))).toBe('');
      expect(headline(wrap([{ id: 'opt_a', label: plainLeaderLabel, win_probability: 0.62 }]))).toBe(expected);
    }
    assertPlainLeaderMismatch();
  },
  'leader.stored': () => {
    const stored = { label: 'Option A', win_probability: 0.62 };
    expect(buildWinnerNamingReplacement({ ...stored, recommendation_suppressed: true }, 'census'))
      .not.toContain('supported by');
    expect(buildWinnerNamingReplacement(stored, 'census')).toContain('supported by 62% of runs of this model');
  },
};

// Author controls; no served or live claim is made for these tiny envelopes.
const leaderCarriers: ((rows: Json[]) => Json)[] = [
  rows => ({ option_comparison: rows }), rows => ({ results: rows }),
  rows => ({ decision_brief: { options: rows } }),
  rows => ({ results: { option_comparison: rows } }), rows => ({ results: { options: rows } }),
  rows => ({ results: { option_results: rows } }),
];
const assertLeaderMismatch = (): void => {
  expect(headline({ results: [{ option_id: 'opt_b', option_label: 'Option B', win_probability: 0.62 }] }),
    "MISMATCH: B's licence must emit no claim for requested subject A").toBe('');
};

const assertPlainLeaderMismatch = (): void => {
  expect(headline({ results: [
    { option_id: 'opt_b', option_label: plainLeaderLabel, win_probability: 0.62 },
  ] }), 'MISMATCH: the plain-share claim for A needs its own result').toBe('');
};
const subjectMismatchRows: Record<string, () => void | Promise<void>> = {
  ...flMismatchRows,
  'leader.headline': assertLeaderMismatch, 'leader.plain': assertPlainLeaderMismatch,
  'leader.stored': assertStoredWinnerMismatch,
  'chance.record': assertChanceMismatch, 'range.record': assertRangeMismatch, 'driver.record': assertDriverMismatch,
  'horizon.cells': assertSoleGoalMismatch, 'horizon.warning': assertSoleGoalMismatch,
  'sensitivity.record': assertSensitivityMismatch, 'robustness.no_flip': assertOtherRunMismatch,
  'flip_threshold.dominant_driver.subject': assertDominantDriverTailMismatch,
};

describe('claim licence discovery and zero-target ratchet', () => {
  it('every discovered owner is explicitly reviewed, including exact-literal escapes', () => {
    const discovered = discoverClaimOwners(root);
    expect(discovered.length).toBeGreaterThan(0);
    const registry = new Map(CLAIM_LICENCE_REGISTRY.map(e => [e.owner, e]));
    expect(registry.size).toBe(CLAIM_LICENCE_REGISTRY.length);
    for (const found of discovered) {
      const entry = registry.get(found.owner);
      const hash = createHash('sha256').update(JSON.stringify(found.literals)).digest('hex');
      expect(entry, `Unreviewed marker-bearing owner: ${found.owner}\n${found.literals.join('\n')}\n`
        + 'If none of these literals reaches a user as a science claim, add to scripts/ci/claim-licence-registry.json:\n'
        + JSON.stringify({ id: found.owner.replace(/^src\/orchestrator-v5\//, '').replace(/\.ts#/, '#'), owner: found.owner, surface: 'chat',
          class: 'not_a_claim', licence: null, reason: '<why this is not an emitted science sentence>', reviewedLiteralHash: hash, reviewedLiterals: found.literals,
          subject: 'run_wide', binding: { subjectField: null, run: 'selected_current' }, readerSubjectParameter: null })
        + '\nOtherwise register it as a science claim with a licence or a declared gap (S3 owner: a1).').toBeDefined();
      if (entry?.class === 'not_a_claim') {
        expect(entry.reason.trim().length).toBeGreaterThan(10);
        const before = entry.reviewedLiterals ?? [];
        expect(hash, `Re-review not_a_claim literals: ${found.owner}\n`
          + `  added:   ${JSON.stringify(found.literals.filter(l => !before.includes(l)))}\n`
          + `  removed: ${JSON.stringify(before.filter(l => !found.literals.includes(l)))}\n`
          + 'If no added literal reaches a user as a science claim, re-review in one step:\n'
          + `  npx tsx scripts/ci/claim-licence-rehash.ts '${found.owner}'\n`
          + 'Otherwise register the owner as a claim (licence or declared gap). Moved/removed owners: npx tsx scripts/ci/claim-licence-rehash.ts --prune').toBe(entry.reviewedLiteralHash);
        expect(entry.reviewedLiterals, `reviewedLiterals must match the hash: ${found.owner}`).toEqual(found.literals);
      }
    }
    // Stale catalogue owners cannot silently claim coverage of moved or removed code.
    expect([...registry.keys()].sort()).toEqual(discovered.map(e => e.owner).sort());
    expect(new Set(CLAIM_LICENCE_REGISTRY.map(e => e.id)).size).toBe(CLAIM_LICENCE_REGISTRY.length);
  }, 30_000);

  it('no new unlicensed id, no licensed/deleted id left in the baseline', () => {
    const { unlicensedClaims: baseline } = JSON.parse(readFileSync(resolve(root, 'scripts/ci/claim-licence-baseline.json'), 'utf8')) as { unlicensedClaims: string[] };
    const failures = claimLicenceRatchetFailures(CLAIM_LICENCE_REGISTRY, baseline);
    expect(new Set(baseline).size).toBe(baseline.length);
    expect(failures.newUnlicensed, 'New unlicensed science claims').toEqual([]);
    expect(failures.staleBaseline, 'Ratchet down: remove now-licensed/deleted baseline ids').toEqual([]);
    for (const entry of CLAIM_LICENCE_REGISTRY) {
      if (entry.class !== 'not_a_claim' && entry.licence === null) expect(entry.producer).toBeDefined();
    }
  });

  it('module specifiers never move a review hash; a new marker sentence in the same file still does (DL 87114)', () => {
    const directory = mkdtempSync(join(tmpdir(), 'claim-licence-imports-'));
    try {
      mkdirSync(resolve(directory, 'src/orchestrator-v5'), { recursive: true });
      mkdirSync(resolve(directory, 'src/routes'), { recursive: true });
      writeFileSync(resolve(directory, 'src/routes/agent-v1-turn.ts'), '');
      const file = resolve(directory, 'src/orchestrator-v5/probe.ts');
      const base = ["import { a } from './robustness-honesty.js';", "export const KEY = 'fragile_edges';"];
      const literalsOf = () => discoverClaimOwners(directory).map(e => [e.owner.replace('src/orchestrator-v5/probe.ts#', ''), e.literals]);
      writeFileSync(file, base.join('\n'));
      const before = literalsOf();
      expect(before).toEqual([['KEY', ['fragile_edges']]]);
      writeFileSync(file, [...base, "export { b } from './sensitivity-card.js';", "import type { C } from './flip-the-thing.js';",
        "const lazy = () => import('./robust-loader.js');", "type T = import('./fragile-types.js').T;", "const r = require('./within-range.js');"].join('\n'));
      expect(literalsOf(), 'import/export/import()/import type/require paths are not copy').toEqual(before);
      writeFileSync(file, [...base, "export const NOTE = 'This result is robust to every change.';"].join('\n'));
      expect(literalsOf(), 'a real new marker sentence is still discovered').toEqual([['KEY', ['fragile_edges']], ['NOTE', ['This result is robust to every change.']]]);
      writeFileSync(file, [...base, "export const M = 'robust';".replace('export const M = ', 'void '), "console.log('the result is fragile here');"].join('\n'));
      expect(literalsOf(), 'a module-level sentence moves the <module> literals').toEqual([['KEY', ['fragile_edges']], ['<module>', ['robust', 'the result is fragile here']]]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('discovers new owners and template fragments, but never comments or dynamic user text', () => {
    const directory = mkdtempSync(join(tmpdir(), 'claim-licence-discovery-'));
    try {
      mkdirSync(resolve(directory, 'src/orchestrator-v5'), { recursive: true });
      mkdirSync(resolve(directory, 'src/routes'), { recursive: true });
      writeFileSync(resolve(directory, 'src/routes/agent-v1-turn.ts'), '');
      writeFileSync(resolve(directory, 'src/orchestrator-v5/probe.ts'), [
        '// "robust" is only a comment',
        'export function futureOwner(userText: string) { return `Result: ${userText} rests most on the link.`; }',
        'export const BODY_BY_RATIONALE = { FUTURE: "A sensitivity check shows how far it can move." };',
        'export function userEcho(userText: string) { return userText; }',
      ].join('\n'));
      const discovered = discoverClaimOwners(directory);
      expect(discovered.map(e => e.owner).sort()).toEqual([
        'src/orchestrator-v5/probe.ts#BODY_BY_RATIONALE.FUTURE',
        'src/orchestrator-v5/probe.ts#futureOwner',
      ]);
      expect(discovered.every(found => !CLAIM_LICENCE_REGISTRY.some(e => e.owner === found.owner))).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('ratchet controls reject a new null and a baseline id whose licence was supplied', () => {
    const open = CLAIM_LICENCE_REGISTRY.find(e => e.class !== 'not_a_claim' && e.licence === null)!;
    const newEntry = { ...open, id: 'future-science-owner' };
    expect(claimLicenceRatchetFailures([newEntry], []).newUnlicensed).toEqual(['future-science-owner']);
    if (open.class === 'not_a_claim') throw new Error('Expected a science entry');
    expect(claimLicenceRatchetFailures([{ ...open, licence: 'realReader' }], [open.id]).staleBaseline).toEqual([open.id]);
    expect(claimLicenceRatchetFailures([], [open.id]).staleBaseline).toEqual([open.id]);
  });

  it('RULE 1 declares behavioural binding without requiring a subject argument', () => {
    for (const entry of CLAIM_LICENCE_REGISTRY) {
      expect(['factor', 'option', 'link', 'goal', 'run_wide']).toContain(entry.subject);
      expect(entry.binding.run).toBe('selected_current');
      expect(entry.binding).toHaveProperty('subjectField');
      expect(entry).toHaveProperty('readerSubjectParameter');
      if (entry.licence !== null) {
        expect(entry.binding.subjectField?.trim().length, entry.id).toBeGreaterThan(0);
        // An explicit parameter is optional: keyed output, sole_goal and selected_run are valid bindings.
        expect(entry.evidenceRow && subjectMismatchRows[entry.evidenceRow], entry.id).toBeTypeOf('function');
      }
    }
    const dropped = CLAIM_LICENCE_REGISTRY.filter(e => e.class !== 'not_a_claim'
      && e.reason === 'licence not bound to subject');
    expect(dropped.map(e => e.id).sort()).toEqual([]);
    for (const entry of dropped) {
      expect(entry.licence, entry.id).toBeNull();
      expect(entry.readerSubjectParameter, entry.id).toBeNull();
    }
    // #2890 landed: the measured tail is licensed by the subject + Run predicate; the qualitative driver body stays a declared gap.
    const tail = CLAIM_LICENCE_REGISTRY.find(e => e.id === 'compose/lens-selector#DOMINANT_DRIVER_MEASURED_TAIL');
    expect(tail?.licence).toContain('hasMeasuredFlipThresholdFor');
    expect(CLAIM_LICENCE_REGISTRY.find(e => e.id === 'compose/lens-selector#DOMINANT_DRIVER_QUALITATIVE_BODY')?.licence).toBeNull();
  });

  it('the licensed headline reads the current run_analysis response, not a stored Run', () => {
    // Run scope is by construction at this emitting door, not a boolean asserted by a leaf formatter.
    // Walk the real caller AST so changing it to a historical/projection source invalidates the licence.
    const source = ts.createSourceFile('run-analysis.ts', readFileSync(resolve(root,
      'src/orchestrator-v5/tools/handlers/run-analysis.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
    const initializers = new Map<string, ts.Expression>();
    const responseWrites: string[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer)
        initializers.set(node.name.text, node.initializer);
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
        && ts.isIdentifier(node.left) && node.left.text === 'response') responseWrites.push(node.right.getText(source));
      ts.forEachChild(node, visit);
    };
    visit(source);
    const input = initializers.get('headlineInput');
    expect(input && ts.isObjectLiteralExpression(input)).toBe(true);
    if (!input || !ts.isObjectLiteralExpression(input)) throw new Error('Missing headline input');
    const enrichment = input.properties.find(p => ts.isPropertyAssignment(p) && p.name.getText(source) === 'enrichment');
    if (!enrichment || !ts.isPropertyAssignment(enrichment)) throw new Error('Missing current response binding');
    const expression = ts.isAsExpression(enrichment.initializer) ? enrichment.initializer.expression : enrichment.initializer;
    expect(expression.getText(source)).toBe('response');
    expect(responseWrites[0]).toMatch(/^await deps\.plotClient\.run\(plotPayload, invocation\.requestId,/);
    expect(responseWrites.some(value => /analysisResult|analysisProjection|history|priorFact/.test(value))).toBe(false);
    const headlineCall = initializers.get('headline')?.getText(source);
    expect(headlineCall).toContain('buildAnalysisResultHeadline(headlineInput)');
  });

  it('dropping the licensed reader subject match makes the SAME MISMATCH row RED', () => {
    assertLeaderMismatch();
    const original = winnerReader.selectWinner;
    const mutant = vi.spyOn(winnerReader, 'selectWinner').mockImplementation((results, _leadingOptionId) =>
      original(results, null)); // Mutant: drop only the subject match, keep value validation.
    try {
      expect(headline(leader)).toContain('supported by 62%'); // matched positive survives
      expect(() => assertLeaderMismatch()).toThrow(); // the exact mismatch assertion is RED
      expect(() => assertPlainLeaderMismatch()).toThrow();
      expect(mutant).toHaveBeenCalledWith(expect.any(Array), 'opt_a');
    } finally {
      mutant.mockRestore();
    }
    assertLeaderMismatch(); // restoration is witnessed, no mutation leaks to another row
    assertPlainLeaderMismatch();
  });

  it('crossing point keys makes the SAME chance MISMATCH row RED', () => {
    assertChanceMismatch();
    const original = chanceLicenceReader.goalChanceDisplayFromLicence;
    const mutant = vi.spyOn(chanceLicenceReader, 'goalChanceDisplayFromLicence').mockImplementation(licence => {
      const own = original(licence);
      if (own === undefined) return own;
      const first = Object.values(own)[0]!;
      return Object.fromEntries(Object.keys(own).map(key => [key, first]));
    });
    try {
      expect(screen(block(pointCapture), pointCapture.draft_graph).find(l => l.option_id === pointX)?.chance).toContain('about 47%');
      expect(() => assertChanceMismatch()).toThrow();
    }
    finally { mutant.mockRestore(); }
    assertChanceMismatch();
  });

  it('crossing range keys makes the SAME range and chance MISMATCH rows RED', () => {
    assertRangeMismatch();
    const original = rangeRecordReader.goalChanceRangeRecordOf;
    const mutant = vi.spyOn(rangeRecordReader, 'goalChanceRangeRecordOf').mockImplementation(value => {
      const own = original(value);
      if (own === undefined) return own;
      const first = own.range_by_option[own.option_ids[0]!]!;
      return { ...own, range_by_option: Object.fromEntries(own.option_ids.map(key => [key, first])) };
    });
    try {
      expect(goalChanceRangeDisplayForAgent(block(rangeCapture), rangeCapture.draft_graph)?.[rangeX]?.range)
        .toBe('between about 4% and 55%'); // own MATCH survives; only the crossed Y assertion goes RED
      expect(() => assertRangeMismatch()).toThrow();
      expect(() => assertChanceMismatch()).toThrow();
    } finally { mutant.mockRestore(); }
    assertRangeMismatch();
    assertChanceMismatch();
  });

  it('crossing driver keys makes the SAME driver MISMATCH row RED', () => {
    assertDriverMismatch();
    const original = chanceLicenceReader.agentLicenceRecordOf;
    const mutant = vi.spyOn(chanceLicenceReader, 'agentLicenceRecordOf').mockImplementation(result => {
      const own = original(result);
      if (own === undefined || own.driver_by_option === undefined) return own;
      const drivers = object(own.driver_by_option), first = Object.values(drivers)[0]!;
      return { ...own, driver_by_option: Object.fromEntries(Object.keys(drivers).map(key => [key, first])) };
    });
    try {
      const r = block(pointCapture), driverX = object(object(licenceOf(r).driver_by_option)[pointX]);
      expect(goalChanceDriverDisplayForAgent(r, pointCapture.draft_graph)[pointX])
        .toContain(`‘${nodeLabel(pointCapture.draft_graph, driverX.from)}’`);
      expect(() => assertDriverMismatch()).toThrow();
    }
    finally { mutant.mockRestore(); }
    assertDriverMismatch();
  });

  it('dropping stored winner selection makes the SAME stored MISMATCH row RED', () => {
    assertStoredWinnerMismatch();
    const original = winnerReader.buildInvokeInputForTests;
    const mutant = vi.spyOn(winnerReader, 'buildInvokeInputForTests').mockImplementation((brief, enrichment) =>
      original(brief, enrichment, null)); // Keep value checks; erase only the requested subject at the selector seam.
    try {
      expect(storedClaim(leader)).toContain('Option A was supported by 62%');
      expect(() => assertStoredWinnerMismatch()).toThrow();
    } finally { mutant.mockRestore(); }
    assertStoredWinnerMismatch();
  });

  it('reading other-Run posture makes the SAME Run MISMATCH row RED', async () => {
    await assertOtherRunMismatch();
    const original = headlineReader.buildAnalysisResultHeadline;
    const mutant = vi.spyOn(headlineReader, 'buildAnalysisResultHeadline').mockImplementation(input =>
      original({ ...input, enrichment: noFlip })); // Mutant: read old Run enrichment while keeping current reply input.
    try { await expect(assertOtherRunMismatch()).rejects.toThrow(); }
    finally { mutant.mockRestore(); }
    await assertOtherRunMismatch();
  });

  it('stored winner egress reads the same selected fact as the review', () => {
    const source = ts.createSourceFile('decision-review-enricher.ts', readFileSync(resolve(root,
      'src/orchestrator-v5/coaching/decision-review-enricher.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
    const selectedEnrichment: string[] = [], builds: string[] = [], egress: string[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'enrichment' && node.initializer)
        selectedEnrichment.push(node.initializer.getText(source));
      if (ts.isCallExpression(node) && node.expression.getText(source) === 'buildInvokeInput')
        builds.push(node.arguments[1]!.getText(source));
      if (ts.isCallExpression(node) && node.expression.getText(source) === 'applyWinnerNamingEgressGuard')
        egress.push(node.arguments[1]!.getText(source));
      ts.forEachChild(node, visit);
    };
    visit(source);
    expect(selectedEnrichment).toEqual(['fact.result.enrichment']);
    expect(builds[0]).toBe('enrichment');
    expect(egress).toEqual(['invokeInput.winner']);
  });

  it('every licensed owner has an executable evidence row; every licensed class is covered', () => {
    const licensed = CLAIM_LICENCE_REGISTRY.filter(e => e.class !== 'not_a_claim' && e.licence !== null);
    expect(licensed.length).toBeGreaterThan(0);
    for (const entry of licensed) {
      if (entry.class === 'not_a_claim') continue;
      expect(entry.evidenceRow && rowTests[entry.evidenceRow], entry.owner).toBeTypeOf('function');
      expect(entry.evidenceRow && subjectMismatchRows[entry.evidenceRow], `Missing MISMATCH: ${entry.owner}`).toBeTypeOf('function');
      expect(Object.hasOwn(CLASS_MARKERS, entry.class)).toBe(true);
    }

  });
});

// Group by science class: absence, matched positive and MISMATCH for every licensed entry.
for (const claimClass of Object.keys(CLASS_MARKERS)) {
  const licensed = CLAIM_LICENCE_REGISTRY.filter(e => e.class === claimClass && e.licence !== null);
  if (licensed.length === 0) continue;
  describe(`producer licence: ${claimClass}`, () => {
    for (const entry of licensed) {
      if (entry.class === 'not_a_claim') continue;
      it(`${entry.id} [${entry.evidenceRow}: absent / MATCH / MISMATCH]`, async () => {
        await rowTests[entry.evidenceRow!]!();
        await subjectMismatchRows[entry.evidenceRow!]!();
      });
    }
  });
}

// Preserve r1's value/currentness controls; passing these alone cannot license an unbound subject.
describe('r1 value controls retained for global selectors still null under RULE 1', () => {
  for (const [row, run] of Object.entries(rowTests)) {
    if (!Object.hasOwn(subjectMismatchRows, row)) it(row, run);
  }
});
