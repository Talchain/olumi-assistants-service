import { describe, expect, it } from 'vitest';
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
import { goalChanceScopeOf, withGoalChanceReadback } from '../goal-chance-licence.js';
import { runChanceHeadline } from '../../coaching/run-chance-headline.js';
import { goalChanceSideOf } from '../goal-chance-sides.js';
import { goalChanceRangeDisplayForAgent } from '../goal-chance-range-agent.js';

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

  it('independent capacity: the selected Run’s positive static licence keeps its exact 40% finding and source bytes', () => {
    const result = { ...structuredClone(capacity.result), run_id: capacity.evidence.run_id,
      input_snapshot: structuredClone(capacity.evidence.input_snapshot) };
    const bytes = JSON.stringify(result);
    expect(goalChanceScopeOf(result)).toMatchObject({ status: 'supported_static', can_show_goal_chance: true });
    expect(withGoalChanceReadback(result)).toBe(result);
    const facts = runFactsOf(result, capacity.graph, true);
    expect(facts.chances.goal_chance_display?.add_one_specialist).toBe('about 40%');
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
  });
});
