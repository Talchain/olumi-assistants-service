import { describe, expect, it, vi } from 'vitest';
import { RunAnalysisHandlerFactSchema } from '@talchain/schemas/orchestrator';
import { readOptionResultSources } from '../../../orchestrator/context/option-result-source.js';
import rs3 from './fixtures/rs3-unlicensed-range-8e9132fc.json';
import capacity from './fixtures/capacity-247ae5b4-run.json';
import { projectCanonicalAnalysisView } from '../../../routes/canonical-analysis-view.js';
import { buildAnalysisResultBlock } from '../../compose.js';
import { runFactsOf } from '../../agent-lane/run-facts.js';
import { readRunEvidence, runEvidenceWireOf } from '../../agent-lane/run-evidence.js';
import { bindRunAnalysisOccurrence } from '../../types/handler-fact.js';
import { RUN_QUESTION_EVIDENCE_KEY } from '../../tools/handlers/run-input-snapshot.js';
import { goalChanceScopeOf, withGoalChanceReadback, withReadTimeHorizonGate } from '../goal-chance-licence.js';
import { runChanceHeadline } from '../../coaching/run-chance-headline.js';
import { goalChanceSideOf } from '../goal-chance-sides.js';
import { goalChanceRangeDisplayForAgent } from '../goal-chance-range-agent.js';
import { readScenarioAnalysis } from '../../../routes/scenario-graph-analysis-read.js';
import { analysisResultForAgent } from '../../agent-lane/decision-sensitivity.js';
import minimal from '../../../../tests/fixtures/plot/v2-run-golden-minimal.json';
import { createRunAnalysisHandler } from '../../tools/handlers/run-analysis.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../build-turn-context.js';
import { SupabaseSessionStore } from '../../session/supabase-store.js';
import { SessionLRUCache } from '../../session/cache.js';
import { STATIC_INPUTS_NOT_RECORDED } from '../static-run-evidence.js';
import { goalChanceWithheldForAgent, GOAL_CHANCE_WITHHELD_NOTE, PLACEHOLDER_PATH_NOTE } from '../../agent-lane/goal-chance-withheld.js';

const storedRead = vi.hoisted(() => vi.fn());
vi.mock('../../session/index.js', async original => ({
  ...await original<typeof import('../../session/index.js')>(),
  getSessionStore: () => ({ readScenarioRunAnalysisFactsFor: storedRead, readRecent: async () => [],
    readFactsFor: async () => [], readFactsWithTurnFor: async () => [], readAnalysisInvalidatedAt: async () => null }),
}));

function deniedRun() {
  const { type: _type, computed_against_hash: _hash, ...stored } = structuredClone(rs3.result);
  const fact = RunAnalysisHandlerFactSchema.parse({ fact_type: 'run_analysis', fact_version: 1, noop: false,
    result: { scenario_id: rs3.scenario_id, ...stored, ...rs3.run,
      input_snapshot: structuredClone(rs3.evidence.input_snapshot),
      enrichment: { ...structuredClone(rs3.result.enrichment),
        [RUN_QUESTION_EVIDENCE_KEY]: structuredClone(rs3.evidence.evaluated_question) } } });
  bindRunAnalysisOccurrence({ fact, ...rs3.evidence.occurrence });
  return fact;
}

const viewOf = (fact: ReturnType<typeof deniedRun>) => projectCanonicalAnalysisView({
  graph: rs3.graph, runFact: fact, analysisState: rs3.analysis_state as never,
  currentResult: buildAnalysisResultBlock(fact),
});

describe('B0: the selected Run’s negative permission precedes every chance display', () => {
  it.each([['RS3', rs3.result], ['capacity', capacity.result]] as const)(
    'without an attempted display, %s retains its own figures, uncertainty and coaching byte-for-byte', (_brief, captured) => {
      const clone = structuredClone(captured);
      const result = { ...clone, enrichment: { ...clone.enrichment, inference_warnings: clone.enrichment.inference_warnings
        .filter(warning => !['GOAL_CHANCE_LICENSED', 'GOAL_CHANCE_RANGE'].includes(warning.code)) } };
      expect(goalChanceScopeOf(result).can_show_goal_chance).toBe(false);
      const bytes = JSON.stringify(result);
      expect(withGoalChanceReadback(result)).toBe(result);
      expect(JSON.stringify(result)).toBe(bytes);
    });

  it('a genuine static-input loss keeps its exact cause even beside an existing horizon withhold', () => {
    const result = { ...structuredClone(capacity.result), run_id: capacity.evidence.run_id };
    result.enrichment.inference_warnings.push({ code: 'GOAL_FIGURES_HORIZON_NOT_TESTED', severity: 'warning',
      message: 'The recorded horizon was not evaluated.' } as never);
    const gated = withGoalChanceReadback(result);
    const causes = gated.enrichment.inference_warnings.filter(warning => warning.code.startsWith('GOAL_FIGURES_'));
    expect(causes.map(warning => warning.code)).toEqual(['GOAL_FIGURES_HORIZON_NOT_TESTED', 'GOAL_FIGURES_TARGET_NOT_TESTABLE']);
    expect(causes[1]).toMatchObject({ message: STATIC_INPUTS_NOT_RECORDED, say: STATIC_INPUTS_NOT_RECORDED,
      detail: { reason: 'EVALUATED_STATIC_INPUTS_NOT_RECORDED' } });
  });

  it('RS3 keeps the existing unsized-link next step unchanged after the selected-Run limitation', () => {
    const fact = deniedRun();
    const gated = withReadTimeHorizonGate(fact.result, rs3.graph, fact.result.enrichment);
    const nextStep = rs3.result.enrichment.inference_warnings.find(warning => warning.code === 'GOAL_FIGURES_PLACEHOLDER_PATH')?.message;
    expect(nextStep).toBe("This comparison turns on the links from ‘Scanner rollout disruption’ to ‘Orders picked per day’ and from ‘Faster scanner upgrade’ to ‘Scanner rollout disruption’, whose strengths aren't sized in the model yet. Set them to see how much they matter.");
    const coaching = goalChanceWithheldForAgent(gated, rs3.graph);
    expect(coaching?.say).toBe(`This Run’s recorded evidence does not support showing goal chances. ${nextStep}`);
    expect(coaching?.note).toBe(`${GOAL_CHANCE_WITHHELD_NOTE} ${PLACEHOLDER_PATH_NOTE}`);
  });

  it('RED: readable RS3’s missing licence withholds its valid range and gives every affected option the recorded reason', () => {
    const fact = deniedRun(), bytes = JSON.stringify(fact);
    expect(goalChanceScopeOf(fact.result)).toMatchObject({ can_show_goal_chance: false, reasons: ['goal_chance_not_licensed'] });
    const view = viewOf(fact);
    expect(view.question?.scope).toMatchObject({ can_show_goal_chance: false, reasons: ['goal_chance_not_licensed'] });
    expect(view.options.map(row => [row.option_id, row.cell.kind])).toEqual([
      ['carry_on_as_now', 'withheld'], ['add_evening_shift', 'withheld'], ['buy_faster_scanners', 'withheld'],
    ]);
    for (const row of view.options) {
      expect(row.cell).toMatchObject({ kind: 'withheld', reasons: expect.arrayContaining([
        expect.objectContaining({ code: 'GOAL_FIGURES_TARGET_NOT_TESTABLE' }),
      ]) });
      expect(JSON.stringify(row.cell)).not.toContain('between less than 1% and 7%');
    }
    expect(JSON.stringify(fact)).toBe(bytes);
  });

  it('the same bound packet, write-time readback and headline cannot narrate the denied chance or blame missing inputs', () => {
    const fact = deniedRun(), evidence = readRunEvidence(runEvidenceWireOf(fact));
    const facts = runFactsOf(buildAnalysisResultBlock(fact), rs3.graph, true, { runEvidence: evidence });
    expect(facts.question?.evidence.status).toBe('verified');
    expect(facts.question?.scope.reasons).toEqual(['goal_chance_not_licensed']);
    expect(facts.chances.goal_chance_range_display).toBeUndefined();
    expect(facts.chances.goal_chance_display).toBeUndefined();
    expect(facts.withheld).toContainEqual(expect.objectContaining({ reason: 'goal_chance_not_licensed' }));
    expect(JSON.stringify(facts)).not.toContain('EVALUATED_STATIC_INPUTS_NOT_RECORDED');
    const gated = withGoalChanceReadback(fact.result);
    expect(runChanceHeadline(gated, rs3.graph)).toBeNull();
    expect(JSON.stringify(gated)).not.toMatch(/"GOAL_CHANCE_RANGE"|"probability_of_goal"/);
    expect(readOptionResultSources(gated.enrichment ?? {}).flat().map(row => row.win_probability))
      .toEqual(readOptionResultSources(fact.result.enrichment ?? {}).flat().map(row => row.win_probability));
  });

  it('comparison and direct range displays read the same selected negative instead of a standalone range record', () => {
    const fact = deniedRun(), bytes = JSON.stringify(fact);
    expect(goalChanceSideOf(fact.result, 'buy_faster_scanners')).toEqual({ kind: 'withheld' });
    expect(goalChanceRangeDisplayForAgent(fact.result, rs3.graph)).toBeUndefined();
    expect(JSON.stringify(fact)).toBe(bytes);
  });

  it('a NEW RS3-shaped Run produces, stores and cold-reads no chance sentence when its selected licence denies it', async () => {
    const graph = structuredClone(rs3.graph);
    const snapshot = await loadScenarioSnapshotForRunAnalysis(rs3.scenario_id, 'b0-fresh-rs3', {
      loadGraphAndBriefText: vi.fn(async () => ({ graph, briefText: rs3.brief, revision: 2 })),
      readMostRecentPendingActions: vi.fn(async () => []),
    } as never);
    // Replay the readable finite output rows and captured range record, not an engine-maths oracle.
    const transport = vi.fn(async (_request: unknown) => ({ ...structuredClone(minimal),
      option_comparison: structuredClone(rs3.result.enrichment.option_comparison),
      inference_warnings: structuredClone(rs3.result.enrichment.inference_warnings)
        .filter(warning => warning.code === 'GOAL_CHANCE_RANGE'),
    }));
    const handler = createRunAnalysisHandler({ scenarioReader: async () => snapshot,
      plotClient: { run: transport, validatePatch: vi.fn() } as never });
    const outcome = await handler({ payload: { scenario_id: rs3.scenario_id, turn_id: 'b0-fresh-rs3' },
      requestId: 'b0-fresh-rs3', context: {}, signal: new AbortController().signal, orientationText: '' } as never);
    expect(transport).toHaveBeenCalledTimes(1);
    const produced = outcome.handler_facts.find(fact => fact.fact_type === 'run_analysis');
    if (produced?.fact_type !== 'run_analysis' || produced.noop) throw new Error('Expected a NEW stored Run');
    expect(goalChanceScopeOf(produced.result)).toMatchObject({ can_show_goal_chance: false,
      reasons: ['goal_chance_not_licensed'] });
    expect(produced.result.input_snapshot).toBeDefined();
    expect(produced.result.summary).not.toMatch(/\d[% ]+chance|between less than 1% and 7%/u);
    expect(JSON.stringify(produced.result)).not.toContain('GOAL_CHANCE_RANGE');
    let rows: Record<string, unknown>[] = [];
    const rpc = vi.fn(async (_fn: string, args: Record<string, unknown>) => {
      rows = JSON.parse(JSON.stringify(args.p_handler_facts)).map((row: Record<string, unknown>) => ({ ...row,
        id: 'b0-rs3-fact', v5_conversation_turn_id: 'b0-rs3-turn', created_at: '2026-10-18T07:00:00Z' }));
      return { data: 'b0-rs3-turn', error: null };
    });
    const chain = { select: () => chain, in: () => chain, order: () => chain, abortSignal: () => chain,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve) };
    const client = { rpc, from: vi.fn(() => chain) };
    const cache = () => new SessionLRUCache({ maxScenarios: 2, maxTurnsPerScenario: 4 });
    await new SupabaseSessionStore(client as never, cache(), { defaultReadLimit: 20 }).append({
      scenario_id: rs3.scenario_id, turn_id: 'b0-fresh-rs3', turn_class: 'handler', handler_id: 'run_analysis',
      request_hash: 'b0-fresh-rs3', response_emitted: true, llm_calls_used: 0, duration_ms: 1,
      handler_facts: [produced], run_evaluated_revisions: { [produced.result.run_id!]: 2 },
    });
    const [cold] = await new SupabaseSessionStore(client as never, cache(), { defaultReadLimit: 20 }).readFactsFor(['b0-rs3-turn']);
    if (cold?.fact_type !== 'run_analysis') throw new Error('Expected the cold Run fact');
    expect(cold.result.summary).toBe(produced.result.summary);
    expect(cold.result.run_id).toBe(produced.result.run_id);
    storedRead.mockResolvedValue({ facts: [{ fact: cold, fact_row_id: 'b0-rs3-fact',
      fact_created_at: cold.result.computed_at, evaluated_scenario_revision: 2 }], total_count: 1 });
    const read = await readScenarioAnalysis({ scenarioId: rs3.scenario_id, graph: graph as never,
      revision: 2, requestId: 'b0-rs3-cold-read' });
    expect(read.analysis_state?.run_state.kind).toBe('complete_current');
    expect(read.canonical_analysis_view?.question?.scope.can_show_goal_chance).toBe(false);
    const narrated = analysisResultForAgent(read.analysis_result, graph, true);
    expect(narrated).not.toHaveProperty('goal_chance_range_display');
    const block = buildAnalysisResultBlock(cold);
    expect(block.summary).toBe(produced.result.summary);
    expect(block.summary).not.toContain('between less than 1% and 7%');
  });


  it.each([
    'Revenue was £2m as of 2026-09-01. Our deadline is 2026-12-31.',
    'The hiring brief keeps two team leads at £90,000 each. Its target is 20% growth.',
  ])('cached non-chance amounts and dates remain exact: %s', summary => {
    const fact = deniedRun();
    fact.result.summary = summary;
    expect(buildAnalysisResultBlock(fact).summary).toBe(summary);
  });

  it('independent capacity: the selected Run’s positive static licence keeps its exact 40% finding and source bytes', () => {
    const result = { ...structuredClone(capacity.result), run_id: capacity.evidence.run_id,
      input_snapshot: structuredClone(capacity.evidence.input_snapshot) };
    const bytes = JSON.stringify(result);
    expect(goalChanceScopeOf(result)).toMatchObject({ status: 'supported_static', can_show_goal_chance: true });
    expect(withGoalChanceReadback(result)).toBe(result);
    const facts = runFactsOf(result, capacity.graph, true);
    expect(facts.chances.goal_chance_display?.add_one_specialist).toBe('about 40%');
    const summary = runChanceHeadline(result, capacity.graph)!;
    expect(summary).toContain('about 40%');
    const { type: _type, computed_against_hash: _hash, ...stored } = result;
    const fact = RunAnalysisHandlerFactSchema.parse({ fact_type: 'run_analysis', fact_version: 1, noop: false,
      result: { scenario_id: '11111111-1111-4111-8111-111111111111', ...stored, summary } });
    expect(buildAnalysisResultBlock(fact).summary).toBe(summary);
    expect(JSON.stringify(result)).toBe(bytes);
  });

  it('a foreign selected Run cannot lend its licence to RS3’s stored range', () => {
    const fact = deniedRun();
    const foreign = { runId: 'foreign-run', inputSnapshot: rs3.evidence.input_snapshot,
      evaluatedQuestion: rs3.evidence.evaluated_question, occurrence: rs3.evidence.occurrence };
    const facts = runFactsOf(fact.result, rs3.graph, true, { runEvidence: foreign });
    expect(facts.question?.scope.can_show_goal_chance).toBe(false);
    expect(facts.chances.goal_chance_range_display).toBeUndefined();
    expect(facts.chances.goal_chance_display).toBeUndefined();
    const refused = withGoalChanceReadback(fact.result, fact.result, foreign);
    expect(goalChanceWithheldForAgent(refused, rs3.graph)?.say).not.toContain('Set them to see how much they matter.');
  });
});
