/**
 * C1: ONE root-cause next step (Paul's funding test, 14 Oct; `recovery/codex/PAUL-MANUAL-TESTS-20261014-ANALYSIS.md`
 * §3–4, §7). The goal "Development speed" held no target, so PLoT had no threshold and no option could have a chance
 * of meeting it. Yet the final screen named other "first" asks:
 * - cells led with the horizon line;
 * - six link-sizing chips were offered (a press only re-asks);
 * - admission said "nothing is required of you" while the angel option was left out, not filled.
 *
 * ⭐ THE CORPUS IS NOT THE AUTHOR'S. Every input is Run 3's served `cee_response`, copied field for field
 * (`tests/fixtures/c1/served-funding-run3-20261014.json`, `_source`), and each row first asserts what was served.
 * The contrast changes ONE thing: the goal states a target.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { projectCanonicalAnalysisCells } from '../../../routes/canonical-analysis-view.js';
import { guidedSizingForRun } from '../guided-sizing.js';
import { buildCanonicalAnalysisReadyFromGraph } from '../../../orchestrator/tools/analysis-ready-helper.js';

type Rec = Record<string, any>;
const FX = JSON.parse(readFileSync('tests/fixtures/c1/served-funding-run3-20261014.json', 'utf8')) as Rec;
const GOAL = 'development_speed';
const TARGET_ASK = 'One gap: ‘Development speed’ has no target yet. What would count as meeting it?';
const withTarget = (graph: Rec): Rec => ({ ...graph, nodes: (graph.nodes as Rec[]).map((n) => n.id === GOAL
  ? { ...n, goal_threshold_raw: 2, goal_direction: '>=' } : n) });

describe('C1: with no goal target, the missing target is the one next step', () => {
  it('precondition: the served graph holds no target, and the standing gap said so', () => {
    const goal = (FX.graph.nodes as Rec[]).find((n) => n.id === GOAL)!;
    expect(goal.goal_threshold_raw).toBeUndefined();
    expect(FX.served.model_gap).toEqual({ kind: 'goal_target_missing', goal_id: GOAL, deadline_known: true, question: TARGET_ASK });
  });

  it('(c) every withheld cell leads with the missing target, ahead of the horizon and placeholder reasons', () => {
    // Served: the horizon line led all three cells.
    expect((FX.served.cells as Rec[]).map((c) => [c.option_id, c.cell.face, c.cell.why, c.cell.reasons[0].code])).toEqual([
      ['lean_1_3m_raise', 'Not shown yet: needs month-by-month changes', "Your goal is for month 6, and this model only has today's numbers.", 'GOAL_FIGURES_HORIZON_NOT_TESTED'],
      ['moderate_1_8m_raise', 'Not shown yet: needs month-by-month changes', "Your goal is for month 6, and this model only has today's numbers.", 'GOAL_FIGURES_PLACEHOLDER_PATH'],
      ['larger_2_5m_raise', 'Not shown yet: needs month-by-month changes', "Your goal is for month 6, and this model only has today's numbers.", 'GOAL_FIGURES_PLACEHOLDER_PATH'],
    ]);
    const cells = projectCanonicalAnalysisCells(FX.result, FX.graph);
    expect(cells.map((c) => c.option_id)).toEqual(['lean_1_3m_raise', 'moderate_1_8m_raise', 'larger_2_5m_raise']);
    for (const { option_id, cell } of cells) {
      const served = (FX.served.cells as Rec[]).find((c) => c.option_id === option_id)!.cell;
      expect(cell).toEqual({ kind: 'withheld', face: 'Not shown yet: needs a target', why: TARGET_ASK,
        reasons: [{ code: 'goal_target_missing', message: TARGET_ASK }, ...served.reasons] });
    }
    // Contrast: the same Run once the goal states a target keeps the served cells byte for byte.
    expect(projectCanonicalAnalysisCells(FX.result, withTarget(FX.graph))).toEqual(FX.served.cells);
  });

  it('(d) no sizing is offered without a target: no guided sizing, so no link-size chips', () => {
    // Served: guided sizing and six link-size chips, three of them not even into the goal.
    expect(FX.served.guided_sizing).toBeTruthy();
    expect((FX.served.suggested_action_ids as string[]).filter((id) => id.startsWith('agent-size-link:'))).toHaveLength(6);
    expect(guidedSizingForRun(FX.result, FX.graph)).toBeUndefined();
    expect(guidedSizingForRun(FX.result, FX.graph, true)).toBeUndefined();
    // Contrast: with a target, the same Run's placeholder links are offered for sizing again.
    const sized = guidedSizingForRun(FX.result, withTarget(FX.graph));
    expect(sized?.links.map((l) => `${l.from}→${l.to}`)).toEqual(expect.arrayContaining([
      'team_size→development_speed', 'runway→development_speed', 'hiring_and_onboarding_pace→development_speed']));
  });

  it('(f) an option left out (its gaps waived, not filled) is named as what is required, never "nothing is required"', () => {
    const served = (FX.served.analysis_admission_reasons as Rec[]).find((r) => r.field === 'missing_important_inputs');
    expect(served?.message).toBe('Olumi filled in the gaps here itself; you can review them, and nothing is required of you.');
    const admission = (buildCanonicalAnalysisReadyFromGraph(FX.graph) as Rec).analysis_admission;
    expect((admission.missing_important_inputs as Rec[]).map((m) => [m.option_id, m.factor_id, m.obligation, m.waived_by_exclusion])).toEqual([
      ['7a69895b', 'team_size', 'offered', true], ['7a69895b', 'hiring_and_onboarding_pace', 'offered', true]]);
    expect((admission.reasons as Rec[]).find((r) => r.field === 'missing_important_inputs')).toEqual({
      field: 'missing_important_inputs', code: 'MODEL_HAS_BLOCKERS',
      message: '‘Securing angel investment to speed up bringing on initial development resource’ is left out until you set what it changes.' });
    expect(JSON.stringify(admission)).not.toContain('nothing is required of you');
  });
});
