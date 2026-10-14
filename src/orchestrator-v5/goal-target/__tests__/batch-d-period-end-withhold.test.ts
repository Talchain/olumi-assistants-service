/**
 * ⭐ D3: RULING 12'S WITHHOLD IS SAID, NEVER AN INVISIBLE NULL (AIE #94 6128697025; DL 12 Oct, recovery Batch D).
 *
 * Served run 3 (2026-10-12T153555Z, hiring, CEE 3fdf0f38): the goal is ‘productivity’ up at least 10% from today at month
 * three, and its stated basis holds `effects_at_period_end: false`. The licence refuses every option (ruling 12 / amendment 2,
 * `goal-chance-licence.ts`), and the Run said nothing: ‘Hire two developers’ showed no figure and no reason (turn 19's
 * canonical view, cell `none`). The fixture is that served Run envelope and graph. The protected field is never written,
 * no chance is computed, and no next step is promised (sizing a link does not clear it).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { goalChanceLicenceOf, periodEndEffectsUnstatedOf, withholdForPeriodEndEffects } from '../goal-chance-licence.js';
import { projectCanonicalAnalysisCells } from '../../../routes/canonical-analysis-view.js';

type Rec = Record<string, unknown>;
const FX = JSON.parse(readFileSync('tests/fixtures/batch-d/served-hiring-run3-turn18-20261012T153555Z.json', 'utf8')) as {
  envelope: Rec; graph: Rec; served_canonical_options: { option_id: string; cell: Rec }[] };
const GOAL = 'productivity';
const HIRING = ['hire_a_tech_lead', 'hire_two_developers'];
const SQ = 'continue_as_now';
const SENTENCE = 'The chance of reaching your target for ‘productivity’ (up at least 10% from today) by month three isn’t shown: '
  + 'the model has not established how much of these effects would be in place by then.';
const cellsOf = (env: Rec, g: Rec = FX.graph): Record<string, Rec> => Object.fromEntries(
  projectCanonicalAnalysisCells({ type: 'analysis_result', enrichment: env } as never, g).map((c) => [c.option_id, c.cell as Rec]));
const withEffects = (atPeriodEnd: boolean): Rec => {
  const g = structuredClone(FX.graph);
  const goal = (g.nodes as Rec[]).find((n) => n.id === GOAL)!;
  goal.goal_target_basis = { ...(goal.goal_target_basis as Rec), effects_at_period_end: atPeriodEnd };
  return g;
};

describe('D3: the served run-3 hiring Run says why its chances are not shown (ruling 12)', () => {
  it('precondition: the served goal is a change at month three with effects NOT stated then, and the licence refuses it', () => {
    const goal = (FX.graph.nodes as Rec[]).find((n) => n.id === GOAL)!;
    expect(goal).toMatchObject({ goal_threshold_frame: 'change_abs', goal_threshold_raw: 10,
      goal_target_basis: { period_months: 3, reference: 'today', effects_at_period_end: false } });
    expect(goalChanceLicenceOf(FX.envelope, FX.graph, GOAL)).toBeNull();
  });

  it('RED → GREEN: no reason before (the served cells), the AIE\'s sentence after, for each hiring option', () => {
    // RED, as served: ‘Hire two developers’ carries no reason at all; ‘Hire a tech lead’ only the placeholder link's.
    const served = Object.fromEntries(FX.served_canonical_options.map((o) => [o.option_id, o.cell]));
    expect(served.hire_two_developers).toEqual({ kind: 'none' });
    expect(JSON.stringify(served)).not.toContain('isn’t shown: the model has not established');
    expect(cellsOf(FX.envelope).hire_two_developers).toEqual({ kind: 'none' });
    // GREEN.
    const before = JSON.stringify(FX.graph);
    const after = withholdForPeriodEndEffects(FX.envelope, FX.graph, GOAL);
    const warning = (after.inference_warnings as Rec[]).find((w) => (w.detail as Rec | undefined)?.reason === 'effects_at_period_end_unstated')!;
    expect(warning).toMatchObject({ code: 'GOAL_FIGURES_TARGET_NOT_TESTABLE', message: SENTENCE, option_ids: HIRING, node_ids: [GOAL] });
    const cells = cellsOf(after);
    for (const id of HIRING) {
      expect(cells[id], id).toMatchObject({ kind: 'withheld', face: 'Chance not shown yet' });
      // Said as written: the sentence says "isn’t shown" itself, so it is never prefixed "Not shown." (DL 12 Oct).
      expect(cells[id]!.why, id).toBe(SENTENCE);
    }
    // No promise that a size clears it: the placeholder's "Set it to see…" is not this option's reason any more.
    expect(String(cells.hire_a_tech_lead!.why)).not.toMatch(/Set it to see|sized in the model/);
    expect(SENTENCE).not.toMatch(/size|sizing|approv|strength|set it/i);
    // Carrying on as now changes nothing: it is not given this reason, and its cell is as served.
    expect(warning.option_ids).not.toContain(SQ);
    expect(cells[SQ]).toEqual(cellsOf(FX.envelope)[SQ]);
    // Nothing is computed and the protected field is never written.
    expect(goalChanceLicenceOf(after, FX.graph, GOAL)).toBeNull();
    expect(JSON.stringify(FX.graph)).toBe(before);
  });

  it('CONTRAST: the same goal with effects stated at month three is unchanged — the envelope itself, no reason added', () => {
    const g = withEffects(true);
    expect(periodEndEffectsUnstatedOf(g, GOAL)).toBeUndefined();
    expect(withholdForPeriodEndEffects(FX.envelope, g, GOAL)).toBe(FX.envelope);
  });

  it('CONTRAST: a level target, or a basis whose reading is still an open question, keeps its own path', () => {
    const level = withEffects(false);
    Object.assign((level.nodes as Rec[]).find((n) => n.id === GOAL)!, { goal_threshold_frame: 'level' });
    expect(withholdForPeriodEndEffects(FX.envelope, level, GOAL)).toBe(FX.envelope);
    const open = withEffects(false);
    const goal = (open.nodes as Rec[]).find((n) => n.id === GOAL)!;
    goal.goal_target_basis = { ...(goal.goal_target_basis as Rec), open_question: 'Is that 10% more than today, or 10 more points?' };
    expect(withholdForPeriodEndEffects(FX.envelope, open, GOAL)).toBe(FX.envelope);
  });
});
