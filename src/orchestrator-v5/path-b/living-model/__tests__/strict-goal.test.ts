import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { GraphV3 } from '../../../../schemas/cee-v3.js';
import { LivingModel, type LivingModelT } from '../../../../schemas/living-model.js';
import { assessCanonicalAnalysisReadiness } from '../../../../orchestrator/tools/analysis-ready-helper.js';
import { projectCorePostimageForPersistence } from '../../../persisted-graph-projection.js';
import { readGoalRecord } from '../../../goal-target/goal-record.js';
import { goalTargetGapOf } from '../../../goal-target/goal-target-gap.js';
import { goalChanceLicenceOf } from '../../../goal-target/goal-chance-licence.js';
import { mapLivingModel } from '../mapper.js';
import { KNOWN_ANSWER, OPTION_EFFECTS } from './fixtures.js';

const stored = (m: LivingModelT) => JSON.parse(JSON.stringify(projectCorePostimageForPersistence(
  GraphV3.parse({ ...mapLivingModel(LivingModel.parse(m)).graph, living_model: m }))));
const model = (comparator: '>' | '<', unit: '%' | 'units'): LivingModelT => {
  const m = structuredClone(KNOWN_ANSWER);
  const aim = m.aims[0]!;
  aim.text = unit === '%' ? 'Conversion' : 'Production';
  aim.quote = `${aim.text} ${comparator === '>' ? 'over' : 'under'} 15${unit === '%' ? '%' : ' units'}; today ${comparator === '>' ? 10 : 20}`;
  Object.assign(aim.target!, { quantity: aim.text, comparator, value: 15, unit, current: comparator === '>' ? 10 : 20 });
  Object.assign(m.links[0]!.effect, { value: 5, sd: 1, unit, sign: comparator === '>' ? '+' : '-' });
  return m;
};

describe('strict stated goals survive the Living Model, graph, readiness and licence', () => {
  it.each(['>', '<'] as const)('the schema admits %s without coercing its value or unit', comparator => {
    const m = model(comparator, '%');
    expect(LivingModel.parse(m).aims[0]!.target).toEqual(m.aims[0]!.target);
  });

  it.each([['>', '%'], ['<', '%'], ['>', 'units'], ['<', 'units']] as const)('%s in %s: saved, scored and licensed as stated; inclusive readiness is unchanged', (comparator, unit) => {
    const m = model(comparator, unit);
    const graph = stored(m);
    expect(graph.living_model.aims).toEqual(m.aims);
    expect(graph.nodes.find((n: { id: string }) => n.id === 'g')).toMatchObject({
      goal_direction: comparator, goal_threshold_raw: 15, goal_threshold_unit: unit, source_quote: m.aims[0]!.quote,
    });
    expect(readGoalRecord(graph, 'g')?.target).toMatchObject({ raw: 15, comparator, unit });
    expect(mapLivingModel(m).withheld).toEqual([]);
    expect(goalTargetGapOf(graph)).toBeNull();
    const inclusive = structuredClone(m);
    inclusive.aims[0]!.target!.comparator = comparator === '>' ? '>=' : '<=';
    const readiness = assessCanonicalAnalysisReadiness(graph);
    expect(readiness.safeToAnalyse).toBe(true);
    expect(readiness.blockingIssues).toEqual(assessCanonicalAnalysisReadiness(stored(inclusive)).blockingIssues);
    const envelope = { option_comparison: [{ option_id: 'hold', probability_of_goal: 0.2 }, { option_id: 'push', probability_of_goal: 0.7 }] };
    expect(goalChanceLicenceOf(envelope, graph, 'g')?.target).toMatchObject({ comparator: comparator === '>' ? 'above' : 'below', value: 15, unit });
  });

  it.each(['>', '<'] as const)('a stated keep-within %s goal keeps strict words when today already clears the boundary', comparator => {
    const m = model(comparator, '%');
    m.aims[0]!.target!.current = comparator === '>' ? 20 : 10;
    m.aims[0]!.quote = `keep conversion ${comparator === '>' ? 'over' : 'under'} 15%`;
    const mapped = mapLivingModel(m);
    expect(mapped.withheld).toEqual([]);
    expect(mapped.assumed).toEqual([{ id: 'g', text: `Keep Conversion strictly ${comparator === '>' ? 'above' : 'below'} 15% (today ${comparator === '>' ? 20 : 10}%). The chance is for its level at the end of the period, not along the way.` }]);
    expect(readGoalRecord(stored(m), 'g')?.target?.comparator).toBe(comparator);
  });

  it('unrelated numbers and a party statement do not replace the AI-declared user goal', () => {
    const m = model('>', '%');
    m.views = [{ holder: 'Sam', position: 'Sam wants under 4% churn; last year conversion was 30%', quote: 'Sam wants under 4% churn; last year conversion was 30%' }];
    const graph = stored(m);
    expect(graph.living_model.aims[0]).toEqual(m.aims[0]);
    expect(readGoalRecord(graph, 'g')?.target).toMatchObject({ raw: 15, comparator: '>', unit: '%' });
    expect(graph.living_model.views).toEqual(m.views);
  });

  it.each([
    [KNOWN_ANSWER, '8af0e6c9bc0d138eb52f4b2c346dfdcfd0291daa4a47cfc09ce779fd1517f54a'],
    [OPTION_EFFECTS, '1f721e109150481fbc29d5b3178685b54fa9c88fb2a4153852f36e63bd6612ac'],
  ] as const)('inclusive fixture output is byte-identical to 15c72e9d', (m, hash) => {
    const bytes = JSON.stringify(mapLivingModel(m), (_k, v) => v instanceof Map ? [...v] : v);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(hash);
  });
});
