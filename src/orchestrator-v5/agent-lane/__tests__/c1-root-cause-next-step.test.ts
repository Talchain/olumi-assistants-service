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
import { resolveRunAdmission } from '../../tools/handlers/analysis-ready-core.js';
import { goalTargetGapOf } from '../../goal-target/goal-target-gap.js';
import { decisionInputAsk } from '../decision-input-ask.js';

type Rec = Record<string, any>;
const FX = JSON.parse(readFileSync('tests/fixtures/c1/served-funding-run3-20261014.json', 'utf8')) as Rec;
const GOAL = 'development_speed';
const TARGET_ASK = 'One gap: ‘Development speed’ has no target yet. What would count as meeting it?';
const withGoal = (graph: Rec, fields: Rec): Rec => ({ ...graph, nodes: (graph.nodes as Rec[]).map((n) => n.id === GOAL ? { ...n, ...fields } : n) });
const withTarget = (graph: Rec): Rec => withGoal(graph, { goal_threshold_raw: 2, goal_direction: '>=' });
/** C1 r1 (Codex; AIE Q4): the served goal is Olumi's PROVISIONAL objective. The same goal as the brief states it changes ONE field. */
const stated = (graph: Rec = FX.graph): Rec => withGoal(graph, { provenance: 'from_brief' });
const ANGEL = '7a69895b';
const ANGEL_LABEL = 'Securing angel investment to speed up bringing on initial development resource';

describe('C1: with no goal target, the missing target is the one next step', () => {
  it('precondition: the served graph holds no target, and the standing gap said so; its goal is Olumi\'s provisional objective', () => {
    const goal = (FX.graph.nodes as Rec[]).find((n) => n.id === GOAL)!;
    expect(goal.goal_threshold_raw).toBeUndefined();
    expect(goal.goal_threshold).toBeUndefined();
    expect(goal.provenance).toBe('ai_inferred');
    expect(FX.served.model_gap).toEqual({ kind: 'goal_target_missing', goal_id: GOAL, deadline_known: true, question: TARGET_ASK });
  });

  it('(c) AMENDED r1 (AIE Q4): a PROVISIONAL objective is never asked for a target; the objective reader asks, and its cells keep their reasons', () => {
    // Was: the served cells led with the target ask. The goal is Olumi's inference, so its one question is the objective's.
    expect(goalTargetGapOf(FX.graph)).toBeNull();
    expect(projectCanonicalAnalysisCells(FX.result, FX.graph)).toEqual(FX.served.cells);
    expect(decisionInputAsk(FX.graph, { builtOrRan: true, awaitingApproval: false, restingText: '', questionsToggle: false } as never))
      .toBe('I used "Development speed" as a provisional objective. What should this model help you explore?');
  });

  it('(c) the same goal as the brief states it: every withheld cell leads with the missing target, ahead of horizon and placeholder reasons', () => {
    // Served: the horizon line led all three cells.
    expect((FX.served.cells as Rec[]).map((c) => [c.option_id, c.cell.face, c.cell.why, c.cell.reasons[0].code])).toEqual([
      ['lean_1_3m_raise', 'Not shown yet: needs month-by-month changes', "Your goal is for month 6, and this model only has today's numbers.", 'GOAL_FIGURES_HORIZON_NOT_TESTED'],
      ['moderate_1_8m_raise', 'Not shown yet: needs month-by-month changes', "Your goal is for month 6, and this model only has today's numbers.", 'GOAL_FIGURES_PLACEHOLDER_PATH'],
      ['larger_2_5m_raise', 'Not shown yet: needs month-by-month changes', "Your goal is for month 6, and this model only has today's numbers.", 'GOAL_FIGURES_PLACEHOLDER_PATH'],
    ]);
    const cells = projectCanonicalAnalysisCells(FX.result, stated());
    expect(cells.map((c) => c.option_id)).toEqual(['lean_1_3m_raise', 'moderate_1_8m_raise', 'larger_2_5m_raise']);
    for (const { option_id, cell } of cells) {
      const served = (FX.served.cells as Rec[]).find((c) => c.option_id === option_id)!.cell;
      expect(cell).toEqual({ kind: 'withheld', face: 'Not shown yet: needs a target', why: TARGET_ASK,
        reasons: [{ code: 'goal_target_missing', message: TARGET_ASK }, ...served.reasons] });
    }
    // Contrast: the same Run once the goal states a target keeps the served cells byte for byte.
    expect(projectCanonicalAnalysisCells(FX.result, withTarget(stated()))).toEqual(FX.served.cells);
  });

  it('(c) r1 (Codex): a legacy goal holding only its normalised threshold HAS a target (the Run sends it), licensed or not', () => {
    // The target ask's own predicate (`goalHasStatedTarget`): one rule for the ask, the standing gap and these cells.
    const legacy = withGoal(stated(), { goal_threshold: 0.7 });
    expect(goalTargetGapOf(legacy)).toBeNull();
    expect(projectCanonicalAnalysisCells(FX.result, legacy)).toEqual(FX.served.cells);
    const options = (FX.served.cells as Rec[]).map((c) => c.option_id);
    const licensed = { ...FX.result, enrichment: { ...FX.result.enrichment, inference_warnings: [...FX.result.enrichment.inference_warnings,
      { code: 'GOAL_CHANCE_LICENSED', severity: 'info', form: 'each', option_ids: options, withheld_option_ids: options }] } };
    expect(projectCanonicalAnalysisCells(licensed, legacy)).toEqual(projectCanonicalAnalysisCells(licensed, withTarget(stated())));
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
    expect(resolveRunAdmission(FX.graph).plan.excluded_option_ids).toEqual([ANGEL]);
  });

  it('(f) r1: "left out" is the Run\'s own plan; two options it leaves out are both named', () => {
    const graph = structuredClone(FX.graph) as Rec;
    const angel = (graph.nodes as Rec[]).find((n) => n.id === ANGEL)!;
    graph.nodes.push({ ...angel, id: 'other_angel', label: 'A different angel round' });
    graph.edges.push(...(graph.edges as Rec[]).filter((e) => e.from === ANGEL || e.to === ANGEL)
      .map((e) => ({ ...e, ...(e.from === ANGEL ? { from: 'other_angel' } : {}), ...(e.to === ANGEL ? { to: 'other_angel' } : {}) })));
    expect(resolveRunAdmission(graph).plan.excluded_option_ids).toEqual([ANGEL, 'other_angel']);
    const reason = ((buildCanonicalAnalysisReadyFromGraph(graph) as Rec).analysis_admission.reasons as Rec[]).find((r) => r.field === 'missing_important_inputs');
    expect(reason?.message).toBe(`‘${ANGEL_LABEL}’ and ‘A different angel round’ are left out until you set what they change.`);
  });

  it('(f) r1: a held status quo is waived AND compared, never "left out" (the Run\'s plan names what it leaves out)', () => {
    // The status quo ‘Lean £1.3m Raise’ now also points at a factor it gives no value: a waived gap, the option held.
    const graph = structuredClone(FX.graph) as Rec;
    const toTeam = (graph.edges as Rec[]).find((e) => e.from === ANGEL && e.to === 'team_size')!;
    graph.edges.push({ ...toTeam, from: 'lean_1_3m_raise' });
    const admission = (buildCanonicalAnalysisReadyFromGraph(graph) as Rec).analysis_admission;
    expect((admission.missing_important_inputs as Rec[]).map((m) => [m.option_id, m.factor_id, m.waived_by_exclusion]))
      .toEqual(expect.arrayContaining([['lean_1_3m_raise', 'team_size', true], [ANGEL, 'team_size', true]]));
    expect(resolveRunAdmission(graph).plan.excluded_option_ids).toEqual([ANGEL]);
    expect((admission.reasons as Rec[]).find((r) => r.field === 'missing_important_inputs')?.message)
      .toBe(`‘${ANGEL_LABEL}’ is left out until you set what it changes.`);
  });

  it('(f) r1 (Codex reproducer): an offered gap NOT waived is still open, never "nothing is required of you"', () => {
    const g = JSON.parse(readFileSync('src/cee/transforms/__tests__/fixtures/paul-mrr-grandfather-option.served-90b8f080.json', 'utf8')).graph as Rec;
    (g.nodes as Rec[]).find((n) => n.id === 'fac_existing_customers_grandfathered')!.observed_state = { value: 0 };
    const r = buildCanonicalAnalysisReadyFromGraph(g) as Rec;
    expect(r.status).toBe('needs_user_input');
    expect((r.analysis_admission.missing_important_inputs as Rec[]).map((m) => [m.option_id, m.obligation, m.waived_by_exclusion]))
      .toEqual([['146aa89d', 'offered', false]]);
    expect((r.analysis_admission.reasons as Rec[]).find((x) => x.field === 'missing_important_inputs')?.message)
      .toBe('One input is still open: give your value, or ask Olumi to estimate it.');
    expect(JSON.stringify(r.analysis_admission)).not.toContain('nothing is required of you');
  });
});
