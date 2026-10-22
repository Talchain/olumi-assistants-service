/**
 * ⭐ STEP 8 (Codex R2 #3443 BLOCK; DL-3 class): ONE recorded-support projection. A Run whose conditions rest on a user's size with no
 * supported spread stores the PROJECTION as its result: every public surface (the turn's block and a reopen, one builder) and the
 * AI's view read it, so the withheld chances, shares and the pooled conditional rows that name a withheld condition reach neither.
 * The engine's evaluated result is kept whole in the saved Run (`RUN_EVALUATED_BEFORE_SUPPORT_KEY`), internal: never transported,
 * never read by the AI. The contrast is the same graph with each size's stated spread recorded by the actual chat writer.
 *
 * Graph: last-check-reproductions' checker joint (‘Quality’ ≥ 70% and ‘Reach’ > 50% while ‘Cost’ ≤ 80%), the user's own sizes on
 * Effort → Quality and Audience → Reach, each option setting Effort and Audience. Engine rows are synthetic, with distinctive
 * figures so any copy is visible.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadScenarioSnapshotForRunAnalysis } from '../../../build-turn-context.js';
import { createRunAnalysisHandler } from '../run-analysis.js';
import { buildAnalysisResultBlock } from '../../../compose.js';
import { RUN_EVALUATED_BEFORE_SUPPORT_KEY } from '../../../context/analysis-projection-policy.js';
import { analysisResultForAgent } from '../../../agent-lane/decision-sensitivity.js';
import { modelFacingToolResult } from '../../../agent-lane/licensed-run-view.js';
import { withStatedSd } from '../../../__tests__/support/supported-spread.support.js';

type Rec = Record<string, any>;
const clone = <T>(x: T): T => structuredClone(x);
const SID = 'acdca123-4567-4000-8000-1234567890ab';
const fixture = JSON.parse(readFileSync(new URL('../../../../../tests/fixtures/plot/v2-run-golden-minimal.json', import.meta.url), 'utf8')) as Rec;

function jointGraph(): Rec {
  const names: Record<string, string> = { g: 'Quality', other: 'Reach', limit: 'Cost', x: 'Effort', y: 'Audience' };
  const nodes: Rec[] = Object.entries(names).map(([id, label]) => ({ id, label, kind: id === 'g' ? 'goal' : 'factor',
    observed_state: { value: 0.2, baseline: 0.2, raw_value: 20, cap: 100, unit: '%', source: 'user_override' } }));
  Object.assign(nodes[0]!, { goal_threshold_frame: 'level', goal_threshold_raw: 70, goal_threshold_cap: 100, goal_threshold: 0.7,
    goal_threshold_unit: '%', goal_direction: '>=', goal_target_basis: { quantity_frame: 'level', target_frame: 'level', target_raw: 70,
      reference: 'today', period_months: 3, period_kind: 'at_end', effect_unit: 'percentage points at month three', effects_at_period_end: true,
      source: 'olumi_reading' } });
  // Each option sets Effort, Audience and Cost, so each target is reached only through the user's own size on its link.
  for (const id of ['a', 'b']) nodes.push({ id, kind: 'option', label: `Plan ${id}`, interventions: Object.fromEntries(['x', 'y', 'limit']
    .map((n) => [n, { value: id === 'a' ? 0.6 : 0.7, raw_value: id === 'a' ? 60 : 70, unit: '%', source: 'user_specified' }])) });
  nodes.push({ id: 'd', kind: 'decision', label: 'Which plan?' });
  const pairs = [['d', 'a'], ['d', 'b'], ['x', 'g'], ['y', 'other'], ...['a', 'b'].flatMap((o) => ['x', 'y', 'limit'].map((n) => [o, n]))];
  return { nodes, edges: pairs.map(([from, to]) => ({ from, to, strength: { mean: 0.3, std: 0.05 }, exists_probability: 1,
    effect_direction: 'positive', provenance: { source: 'user_specified', magnitude: 'user_stated', natural_effect: { amount: 0.3, amount_unit: '%',
      per_source_change: 1, per_source_change_unit: '%', strength_mean: 0.3, strength_mean_frame: 'edge_strength' } } })),
  goal_constraints: [
    { constraint_id: 'primary', node_id: 'g', operator: '>=', value: 70, unit: '%', value_frame: 'level', role: 'goal_target' },
    { constraint_id: 'secondary', node_id: 'other', operator: '>=', operator_as_stated: '>', value: 50, unit: '%', value_frame: 'level', role: 'goal_target' },
    { constraint_id: 'budget', node_id: 'limit', operator: '<=', value: 80, unit: '%', value_frame: 'level' },
  ] };
}

/** Distinctive engine figures: every one is findable in any copy. */
const POOLED = [
  { constraint_a_id: 'primary', constraint_b_id: 'secondary', conditional_probability: 0.6543, marginal_probability: 0.5432 },
  { constraint_a_id: 'secondary', constraint_b_id: 'budget', conditional_probability: 0.7654, marginal_probability: 0.6789 },
];
const precision = { n_informative: 10000, standard_error: 0.005 };
const engineBody = (req: Rec): Rec => ({ ...clone(fixture), conditional_probabilities: clone(POOLED),
  option_comparison: (req.options as Rec[]).map((o, i) => ({ option_id: o.id, win_probability: i === 0 ? 0.3141 : 0.6859,
    probability_of_goal: 0.4321 + i * 0.1, probability_of_goal_precision: precision, probability_of_joint_goal: 0.2109 + i * 0.1,
    probability_of_joint_goal_precision: precision,
    constraint_probabilities: { primary: 0.4321 + i * 0.1, secondary: 0.5123 + i * 0.1, budget: 0.8111 },
    constraint_probabilities_precision: { primary: precision, secondary: precision, budget: precision },
    outcome: { mean: 82, std: 4, p10: 77, p50: 82, p90: 90 } })) });

async function run(g: Rec): Promise<{ fact: Rec; block: Rec; ai: string }> {
  const bytes = JSON.stringify(g);
  const snapshot = await loadScenarioSnapshotForRunAnalysis(SID, 'support-projection', {
    loadGraphAndBriefText: async () => ({ graph: JSON.parse(bytes), briefText: null, revision: 3 }),
    readMostRecentPendingActions: async () => [],
  } as never);
  const handler = createRunAnalysisHandler({ scenarioReader: async () => snapshot, plotClient: {
    run: async (req: Rec) => engineBody(req), validatePatch: async () => {},
  } } as never);
  const outcome = await handler({ payload: { scenario_id: SID, turn_id: 'support' }, requestId: 'support', signal: new AbortController().signal,
    context: {}, orientationText: '' } as never) as Rec;
  const fact = outcome.handler_facts[0] as Rec;
  const block = buildAnalysisResultBlock(fact as never) as Rec;
  const ai = JSON.stringify(modelFacingToolResult('run_analysis', { result: analysisResultForAgent(block, g) }));
  return { fact, block, ai };
}

const ENGINE_FIGURES = ['0.6543', '0.5432', '0.7654', '0.6789', '0.4321', '0.5321', '0.5123', '0.6123', '0.3141', '0.6859'];
const rowsNaming = (carrier: unknown, id: string): Rec[] => (Array.isArray(carrier) ? carrier as Rec[] : [])
  .filter((r) => r.constraint_a_id === id || r.constraint_b_id === id);

describe('ONE recorded-support projection: public block, reopen and AI view read it; the saved Run keeps the evaluated result', () => {
  it('⭐ RED→GREEN: no supported spread → the withheld conditions, their pooled rows and the shares reach no public surface nor the AI', async () => {
    const { fact, block, ai } = await run(jointGraph());
    const stored = fact.result.enrichment as Rec;
    // The projection is the stored result: pooled rows naming a withheld condition (primary, secondary) are gone.
    expect(rowsNaming(stored.conditional_probabilities, 'primary')).toEqual([]);
    expect(rowsNaming(stored.conditional_probabilities, 'secondary')).toEqual([]);
    for (const row of stored.option_comparison as Rec[]) {
      expect(row.probability_of_goal, row.option_id).toBeUndefined();
      expect(row.win_probability, row.option_id).toBeUndefined();
      expect(row.constraint_probabilities?.primary, row.option_id).toBeUndefined();
      expect(row.constraint_probabilities?.secondary, row.option_id).toBeUndefined();
    }
    // The one block builder (turn and reopen) and the AI's view: no engine figure, and never the internal key.
    const wire = JSON.stringify(block);
    for (const figure of ENGINE_FIGURES) {
      expect(wire, `block: ${figure}`).not.toContain(figure);
      expect(ai, `AI: ${figure}`).not.toContain(figure);
    }
    expect(wire).not.toContain(RUN_EVALUATED_BEFORE_SUPPORT_KEY);
    expect(ai).not.toContain(RUN_EVALUATED_BEFORE_SUPPORT_KEY);
    // The saved Run keeps what the engine evaluated, whole: its pooled rows, chances and shares.
    const raw = stored[RUN_EVALUATED_BEFORE_SUPPORT_KEY] as Rec;
    expect(raw.conditional_probabilities).toEqual(POOLED);
    expect((raw.option_comparison as Rec[]).map((r) => [r.option_id, r.probability_of_goal, r.win_probability, r.constraint_probabilities.secondary]))
      .toEqual([['a', 0.4321, 0.3141, 0.5123], ['b', 0.5321, 0.6859, 0.6123]]);
  });

  it('CONTRAST: each size\'s stated spread recorded by the actual writer → the same Run keeps its pooled rows and chances, with no raw copy', async () => {
    const { fact, block } = await run(await withStatedSd(await withStatedSd(jointGraph(), SID, 'x', 'g'), SID, 'y', 'other'));
    const stored = fact.result.enrichment as Rec;
    expect(stored.conditional_probabilities).toEqual(POOLED);
    expect((stored.option_comparison as Rec[]).every((r) => typeof r.probability_of_goal === 'number')).toBe(true);
    expect(stored[RUN_EVALUATED_BEFORE_SUPPORT_KEY]).toBeUndefined();
    expect(JSON.stringify(block)).toContain('0.6543');
  });
});
