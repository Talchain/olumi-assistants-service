/**
 * ⭐ S9 — A GOAL CHANCE SHOWN IN BOTH RUNS REACHES THE AI AS A TYPED CHANGE (DL 06:39Z, blocking class: wrong claim). Capacity
 * e2e R2e (packet `R2e-automatic-50836bd2`, CEE c1e944a4): run_delta recorded "Add one specialist" between about 30% and 36% →
 * between about 54% and 59%, but the interpret request said "No option has figures in both Runs, so never say anything rose,
 * fell or moved", because only win shares were counted; every answer (both arms) denied the recorded change. Now each option
 * whose chance both Runs showed travels typed (prior and current display, both Run ids) on the interpret instruction and on the
 * typed rerun record, and "no figures in both Runs" holds only when there are neither shares nor such chances.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createAgentCapabilities } from '../runtime/agent-capabilities.js';
import { dispatchTool } from '../runtime/agent-tools.js';
import { ProposalStore } from '../proposal.js';
import {
  GOAL_CHANCE_CHANGES_LEAD, NO_MATCHED_FIGURES_RULE, composeRerunExplanation, goalChanceChangesOf, rerunExplanationPlan, rerunRecordForModel,
} from '../rerun-explanation.js';

type Rec = Record<string, any>;
const ctx = { scenario_id: '11111111-1111-1111-1111-111111111111', authenticated_user_id: 'user-a', request_id: 'req-1' };
const R2E = (JSON.parse(readFileSync('tests/fixtures/s9-range-delta/R2e-automatic-50836bd2.json', 'utf8')) as Rec).canonical_state as Rec;
const READ_C = (JSON.parse(readFileSync('tests/fixtures/s9-range-delta/capacity-c1e944a4-read10-C.json', 'utf8')) as Rec).body as Rec;
const MARKETING = JSON.parse(readFileSync('tests/fixtures/reply-face-p2/marketing-7f5659fd-reopen.json', 'utf8')) as Rec;
const NO_FIGURES = 'No option has figures in both Runs';
const ADD = 'add_one_specialist';

const labelsOf = (read: Rec) => (id: string): string | undefined => read.graph.nodes.find((n: Rec) => n.id === id)?.label;
const optionLabels = (read: Rec): string[] => read.graph.nodes.filter((n: Rec) => n.kind === 'option').map((n: Rec) => n.label);
const planOf = (read: Rec, delta: Rec = read.current_read.run_delta) => rerunExplanationPlan(delta, labelsOf(read), optionLabels(read), false,
  read.graph.nodes.map((n: Rec) => n.label));

describe('S9: goal chances shown in both Runs reach the AI typed, never "no figures in both Runs"', () => {
  it('capacity R2e (served): the interpret instruction carries 30–36% → 54–59% with both Run ids, and never denies it', () => {
    const delta = R2E.current_read.run_delta;
    expect(delta.win_probabilities).toEqual([]);
    const plan = planOf(R2E)!;
    expect(plan.goalChanceChanges).toEqual([{ option_id: ADD, option_label: 'Add one specialist',
      prior: 'between about 30% and 36%', current: 'between about 54% and 59%',
      prior_run_id: delta.endpoints.prior.run_id, current_run_id: delta.endpoints.current.run_id }]);
    // By identity with the screen: the current end IS the card's display for this Run.
    const card = R2E.canonical_analysis_view.options.find((o: Rec) => o.option_id === ADD).cell.display;
    expect(plan.goalChanceChanges[0]!.current).toBe(card);
    expect(plan.instruction).toContain(`${GOAL_CHANCE_CHANGES_LEAD} ‘Add one specialist’: between about 30% and 36% → between about 54% and 59%.`);
    expect(plan.instruction).not.toContain(NO_FIGURES);
    expect(plan.inputs.no_matched_figures).toBe(false);
    // The typed record (the Agent loop) carries the same rows, and its rule no longer says no option has figures in both.
    const record = rerunRecordForModel(delta, false, R2E.graph.nodes)!;
    expect(record.goal_chance_changes).toEqual(plan.goalChanceChanges);
    expect(record.use).not.toContain(NO_MATCHED_FIGURES_RULE.trim());
  });

  it('capacity R2e: the AI’s sentence saying that change passes the reply’s own checker beside the code line (kept, not dropped)', () => {
    const plan = planOf(R2E)!;
    const said = 'Its chance of meeting your goal moved from between about 30% and 36% to between about 54% and 59% in this model.';
    const c = composeRerunExplanation(said, plan);
    expect(c.failed).toEqual([]);
    expect(c.text).toContain(said);
  });

  it('capacity R2e through the REAL get_canonical_state: the AI’s rerun_record carries the typed change', async () => {
    const caps = createAgentCapabilities((async () => ({ status: 200, json: structuredClone(R2E) })) as never, new ProposalStore());
    const r = (await dispatchTool('get_canonical_state', '{}', ctx, caps)) as Rec;
    expect(r.ok).toBe(true);
    const changes = r.rerun_record?.goal_chance_changes ?? r.goal_chance_changes;
    expect(changes).toEqual([expect.objectContaining({ option_id: ADD, prior: 'between about 30% and 36%', current: 'between about 54% and 59%' })]);
    expect(JSON.stringify(r)).not.toContain(NO_FIGURES);
  });

  it('capacity, the next Run pair (served read 10, C): 54–59% → 66–70%', () => {
    const plan = planOf(READ_C)!;
    expect(plan.goalChanceChanges.map((c) => [c.prior, c.current])).toEqual([['between about 54% and 59%', 'between about 66% and 70%']]);
    expect(plan.instruction).not.toContain(NO_FIGURES);
  });

  it('point → point control (R2e’s pair as points): about 45% → about 50%', () => {
    const delta = structuredClone(R2E.current_read.run_delta);
    const row = delta.goal_chances.find((g: Rec) => g.option_id === ADD);
    row.prior = { kind: 'point', pct: 45, rounding: 'nearest_5' }; row.current = { kind: 'point', pct: 50, rounding: 'nearest_5' };
    const plan = planOf(R2E, delta)!;
    expect(plan.goalChanceChanges.map((c) => [c.prior, c.current])).toEqual([['about 45%', 'about 50%']]);
    expect(plan.instruction).toContain('‘Add one specialist’: about 45% → about 50%.');
  });

  it('marketing 7f5659fd (a second brief, its own labels and Runs): point → range, and its edge words', () => {
    const delta = structuredClone(MARKETING.current_read?.run_delta ?? MARKETING.run_delta);
    expect(delta.goal_chances.length).toBeGreaterThan(0);
    const id = delta.goal_chances[0].option_id;
    delta.goal_chances[0].prior = { kind: 'point', pct: 0, rounding: 'whole' };
    delta.goal_chances[0].current = { kind: 'range', low_pct: 35, high_pct: 100, low_rounding: 'whole', high_rounding: 'whole' };
    const changes = goalChanceChangesOf(delta, labelsOf(MARKETING));
    expect(changes).toEqual([expect.objectContaining({ option_id: id, option_label: labelsOf(MARKETING)(id), prior: 'less than 1%',
      current: 'between about 35% and more than 99%' })]);
  });

  it('AIE exact lead (PL 07:50Z): the interpret instruction introduces the pairs in the AIE’s words', () => {
    expect(planOf(R2E)!.instruction).toContain('Recorded goal-chance displays for options with figures in both Runs (earlier Run → later Run): ‘Add one specialist’: between about 30% and 36% → between about 54% and 59%.');
  });

  // ⭐ PL 07:50Z: `prior_withheld` is the earlier Run's WIN SHARES. With goal chances recorded in both Runs, the plan, the typed
  // record and the checker ban only share movement; the chance moved as recorded. Without such chances, the full ban stands.
  describe('prior-withheld shares beside goal chances recorded in both Runs', () => {
    const withheldShares = (): Rec => ({ ...structuredClone(R2E.current_read.run_delta), win_probabilities: undefined,
      win_probabilities_unavailable: 'prior_withheld' });
    const MOVED = 'Its chance of meeting your goal moved from between about 30% and 36% to between about 54% and 59% in this model.';

    it('the chance may be said to move; the record keeps prior_withheld true (the shares were withheld) and says so once', () => {
      const plan = planOf(R2E, withheldShares())!;
      expect(plan.inputs.prior_withheld).toBe(true);
      expect(plan.inputs.goal_chances_in_both).toBe(true);
      expect(plan.instruction).not.toContain('never say anything rose, fell, moved or changed in value');
      expect(plan.instruction).toContain('never say a share rose, fell or moved; say a goal chance moved only as recorded above.');
      const c = composeRerunExplanation(MOVED, plan);
      expect(c.failed).toEqual([]);
      expect(c.text).toContain(MOVED);
      const record = rerunRecordForModel(withheldShares(), false, R2E.graph.nodes)!;
      expect(record.prior_withheld).toBe(true);
      expect(record.goal_chance_changes).toEqual(plan.goalChanceChanges);
      expect(record.use).toContain('except a chance listed in goal_chance_changes, as recorded there.');
    });

    it('CONTRASTS: a share said to move fails; with no chance in both Runs the full ban stands for the same sentence', () => {
      const plan = planOf(R2E, withheldShares())!;
      for (const bad of ['Its share of runs rose to 40%.', 'Its chance of coming out on top rose.', 'Add one specialist moved ahead of the others.']) {
        expect(composeRerunExplanation(bad, plan).text, bad).not.toContain(bad);
      }
      const none = withheldShares();
      none.goal_chances.find((g: Rec) => g.option_id === ADD).prior = { kind: 'withheld' };
      const bare = planOf(R2E, none)!;
      expect(bare.inputs.prior_withheld).toBe(true);
      expect(bare.inputs.goal_chances_in_both).toBeUndefined();
      expect(bare.instruction).toContain('never say anything rose, fell, moved or changed in value');
      expect(composeRerunExplanation(MOVED, bare).text).not.toContain(MOVED);
    });
  });

  it('CONTRAST: withheld on either side (served marketing: withheld → withheld) is no figure in both Runs, so the guard stays', () => {
    const delta = MARKETING.current_read?.run_delta ?? MARKETING.run_delta;
    expect(goalChanceChangesOf(delta, labelsOf(MARKETING))).toEqual([]);
    const oneSide = structuredClone(R2E.current_read.run_delta);
    oneSide.goal_chances.find((g: Rec) => g.option_id === ADD).prior = { kind: 'withheld' };
    const plan = planOf(R2E, oneSide)!;
    expect(plan.goalChanceChanges).toEqual([]);
    expect(plan.instruction).toContain(NO_FIGURES);
    expect(plan.instruction).not.toContain(GOAL_CHANCE_CHANGES_LEAD);
  });
});
