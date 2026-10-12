/**
 * Recovery Batch F (S12; DL brief 12 Oct; words pending AIE, #94 6129762547) — the joint-goal (AND) withholds are TRUTHFUL.
 *
 *  (a) every joint or per-target withhold carries the cause PLoT or CEE ESTABLISHED (PLoT's `joint_withheld`, CEE's per-row
 *      verdict, or a target whose quantity had no level today on the graph the Run sent), by code, with ONE next step that
 *      would change it — "run the analysis again" only where the Run itself is stale or mismatched;
 *  (b) no stated target is dropped silently: each is shown, or withheld with its own reason;
 *  (c) a target recorded as a success condition is never ALSO listed as an excluded extra condition.
 *
 * Assertions bind by IDENTITY (constraint ids, node ids, labels, reason codes, placeholder keys), never by prose: the words
 * are placeholders (`JOINT_WITHHOLD_WORDS`) until the AIE's drop in. The served base is run 4's marketing Run turn
 * (`fixtures/batch-f-run4-marketing-run-turn.json`: CEE a770ce49, scenario 35ecad67), plus constructed rows for each reason.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { goalChanceLicenceOf, withGoalChanceLicence } from '../goal-chance-licence.js';
import { goalChanceWithheldReasonsForAgent } from '../goal-chance-range-agent.js';
import {
  goalTargetsBlockOf, JOINT_WITHHOLD_WORDS, jointWithheldLine, readGoalTargetsBlock, TARGET_NO_LEVEL_TODAY,
  type GoalTargetsBlock, type JointWithholdReason,
} from '../goal-targets-joint.js';
import { wireGoalConstraints } from '../../tools/handlers/run-analysis.js';
import { goalChanceNotesForAgent } from '../../agent-lane/goal-chance-screen-lines.js';

type Rec = Record<string, unknown>;
const RUN4 = JSON.parse(readFileSync(new URL('./fixtures/batch-f-run4-marketing-run-turn.json', import.meta.url), 'utf8')) as {
  graph: { nodes: Rec[]; edges: Rec[]; goal_constraints: Rec[] };
  limit_verdicts: { per_limit: Rec[]; joint: Rec };
};
const RERUN_TEXT = /Run the analysis again/i;
const RERUN_KEY = '⟦AIE:next.rerun_analysis⟧';
const PRECISION = { n_informative: 10000, standard_error: 0.005 };

// ── Run 4, served: the two limits, their ids and labels, and CEE's per-limit causes (verbatim from the fixture) ─────────
const SPEND = 'agent-lane:annual_campaign_spend:<=';
const FOUNDER = 'agent-lane:founder_time_on_campaign:<=';
// ── Constructed (the revised draft's second target, DB row a5ada94b as cited in marketing-and/DIAGNOSIS.md): an OUTCOME the
//    model gives no level today, reached from the factors; and the goal given a stated level target and today's level.
const GOAL_ROW = 'agent-lane:campaign_effectiveness:>=';
const CUSTOMERS = 'agent-lane:new_customers_first_3_months:>=';
const BASIS = { quantity_frame: 'level', target_frame: 'level', target_raw: 60, reference: 'launch', period_months: 3,
  period_kind: 'over_period', effect_unit: 'score points and customers over the first three months after launch',
  effects_at_period_end: false, also_required: ['secure 20 new customers within the first 3 months'], source: 'olumi_reading' };

function revisedDraft(): Rec {
  const g = structuredClone(RUN4.graph) as { nodes: Rec[]; edges: Rec[]; goal_constraints: Rec[] };
  const goal = g.nodes.find((n) => n.id === 'campaign_effectiveness')!;
  Object.assign(goal, { goal_threshold_raw: 60, goal_threshold_cap: 100, goal_threshold: 0.6, goal_direction: '>=',
    observed_state: { value: 0.5, baseline: 0.5, raw_value: 50, cap: 100, unit: 'campaign effectiveness score (0–100)', source: 'user_stated' },
    goal_target_basis: BASIS });
  g.nodes.push({ id: 'new_customers_first_3_months', kind: 'outcome', label: 'New customers in first 3 months' });
  g.edges.push({ from: 'campaign_planning_quality', to: 'new_customers_first_3_months', strength: { mean: 0.5, std: 0.1 },
    provenance: { source: 'cee_hypothesis', magnitude: 'olumi_estimate' } });
  g.goal_constraints = [
    { constraint_id: GOAL_ROW, node_id: 'campaign_effectiveness', operator: '>=', operator_as_stated: '>', value: 60,
      unit: 'campaign effectiveness score (0–100)', value_frame: 'level', role: 'goal_target' },
    { constraint_id: CUSTOMERS, node_id: 'new_customers_first_3_months', operator: '>=', value: 20, unit: 'customers', value_frame: 'level', role: 'goal_target' },
    ...g.goal_constraints,
  ];
  return g;
}
/** CEE's per-row verdicts: run 4's two limits VERBATIM, plus the constructed target rows (the goal's scored; customers not). */
const verdicts = (): Rec[] => [
  { constraint_id: GOAL_ROW, state: 'scored' },
  { constraint_id: CUSTOMERS, state: 'unscored', reason: 'CONSTRAINT_NOT_CONVERTIBLE' },
  ...RUN4.limit_verdicts.per_limit,
];
/** PLoT B5: no joint while any sent condition is unscored; `joint_withheld` names them (run 4's two + the customers row). */
const plotRun = (over: Rec = {}): Rec => ({
  option_comparison: ['hire_marketing_manager', 'ai_tool_plus_advertising', 'continue_as_now'].map((id, i) => ({
    option_id: id, probability_of_goal: [0.42, 0.55, 0.3][i],
    constraint_probabilities: { [GOAL_ROW]: [0.42, 0.55, 0.3][i] }, constraint_probabilities_precision: { [GOAL_ROW]: PRECISION },
  })),
  joint_withheld: { reason: 'limit_unscored', constraint_ids: [CUSTOMERS, SPEND, FOUNDER] },
  ...over,
});
const licenceOn = (g: Rec, run: Rec = plotRun(), extra: Rec = { limitVerdicts: verdicts() }) => goalChanceLicenceOf(run, g, 'campaign_effectiveness',
  () => false, undefined, g, { storedConstraints: g.goal_constraints, sentConstraints: wireGoalConstraints(g.goal_constraints), sentRun: { graph: g }, ...extra });

describe('PRECONDITION: the fixture is run 4\'s served Run turn, and its limits are what the diagnosis cites', () => {
  it('both limits unscored with CEE\'s causes; CEE\'s joint withheld for limit_unscored naming both', () => {
    expect(RUN4.limit_verdicts.per_limit).toEqual([
      { constraint_id: SPEND, state: 'unscored', reason: 'parts_identity_unmodelled' },
      { constraint_id: FOUNDER, state: 'unscored', reason: 'limit_rests_on_olumi_guess' },
    ]);
    expect(RUN4.limit_verdicts.joint).toEqual({ state: 'withheld', withheld_reason: 'limit_unscored', constraint_ids: [SPEND, FOUNDER] });
    expect(RUN4.graph.goal_constraints.map((r) => [r.constraint_id, r.label])).toEqual([[SPEND, 'Annual campaign spend'], [FOUNDER, 'Founder time on campaign']]);
  });
});

describe('(a) W1 — run 4 with both targets recorded: the joint says the engine\'s own reason, never "run again"', () => {
  it('RED on a770ce49 ("isn\'t calculated yet. Run the analysis again"): withheld for limit_unscored, each condition by id with its cause', () => {
    const l = licenceOn(revisedDraft())!;
    expect(l).not.toBeNull();
    const joint = l.targets!.joint as Extract<GoalTargetsBlock['joint'], { status: 'withheld' }>;
    expect(joint.status).toBe('withheld');
    expect(joint.reason).toBe('limit_unscored');
    expect(joint.causes!.map((c) => [c.constraint_id, c.label, c.role, c.reason])).toEqual([
      [CUSTOMERS, 'New customers in first 3 months', 'target', TARGET_NO_LEVEL_TODAY],
      [SPEND, 'Annual campaign spend', 'limit', 'parts_identity_unmodelled'],
      [FOUNDER, 'Founder time on campaign', 'limit', 'limit_rests_on_olumi_guess'],
    ]);
    expect(joint.line).not.toMatch(RERUN_TEXT);
    expect(joint.line).not.toContain(RERUN_KEY);
    expect(joint.line.startsWith('⟦AIE:joint.limit_unscored⟧')).toBe(true);
  });

  it('ONE next step per cause, only where a writer would change it; the joint\'s is the first established one', () => {
    const joint = licenceOn(revisedDraft())!.targets!.joint as Rec;
    const causes = joint.causes as Rec[];
    // An outcome has no level writer (B3: a ruling, not code) and the engine cannot combine the spend's parts: nothing promised.
    expect(causes.map((c) => c.next_step)).toEqual([
      { code: 'none_established' },
      { code: 'none_established' },
      // B6 'point' arm, the same predicate the verdict used: each option sets founder time to Olumi's single figure.
      { code: 'give_option_levels', node_id: 'founder_time_on_campaign', label: 'Founder time on campaign' },
    ]);
    expect(joint.next_step).toEqual({ code: 'give_option_levels', node_id: 'founder_time_on_campaign', label: 'Founder time on campaign' });
    expect(joint.line).toContain('⟦AIE:next.give_option_levels⟧ quantity: ‘Founder time on campaign’');
  });

  it('NEGATIVE: PLoT names a condition CEE has no verdict for → PLoT\'s own reason, verbatim, and no step promised', () => {
    const joint = licenceOn(revisedDraft(), plotRun(), { limitVerdicts: [] })!.targets!.joint as Rec;
    expect((joint.causes as Rec[]).map((c) => [c.constraint_id, c.reason])).toEqual([
      [CUSTOMERS, TARGET_NO_LEVEL_TODAY], [SPEND, 'limit_unscored'], [FOUNDER, 'limit_unscored']]);
    expect(joint.next_step).toEqual({ code: 'none_established' });
  });

  it('NEGATIVE: no sent graph → a target\'s level today is not read, so its cause stays the engine\'s code (never guessed)', () => {
    const g = revisedDraft();
    const l = goalChanceLicenceOf(plotRun(), g, 'campaign_effectiveness', () => false, undefined, g,
      { storedConstraints: g.goal_constraints, sentConstraints: wireGoalConstraints(g.goal_constraints), limitVerdicts: verdicts() })!;
    expect(((l.targets!.joint as Rec).causes as Rec[])[0]).toMatchObject({ constraint_id: CUSTOMERS, reason: 'CONSTRAINT_NOT_CONVERTIBLE' });
  });

  it.each([
    ['carried as its baseline', { value: 0, baseline: 0, raw_value: 0, source: 'user_stated' }],
    ['held on the node, not carried (no baseline sent)', { value: 0.1, raw_value: 10, source: 'user_stated' }],
  ])('CONTROL: a customers quantity with a level today (%s) is never called "no level today": the engine\'s code stands', (_name, os) => {
    const g = revisedDraft();
    (g.nodes as Rec[]).find((n) => n.id === 'new_customers_first_3_months')!.observed_state = os;
    expect(((licenceOn(g)!.targets!.joint as Rec).causes as Rec[])[0]).toMatchObject({ constraint_id: CUSTOMERS, reason: 'CONSTRAINT_NOT_CONVERTIBLE' });
  });

  it('CONTROL (amendment 7 keeps its precedence): a target on OLUMI\'s level → olumi_base, and an outcome has no writer to promise', () => {
    const g = revisedDraft();
    (g.nodes as Rec[]).find((n) => n.id === 'new_customers_first_3_months')!.observed_state = { value: 0.1, raw_value: 10, source: 'cee_inference' };
    const t = licenceOn(g)!.targets!;
    expect(t.joint).toMatchObject({ status: 'withheld', reason: 'olumi_base', next_step: { code: 'none_established' } });
    expect(t.withheld_targets!.map((x) => [x.constraint_id, x.reason, x.next_step.code])).toEqual([[CUSTOMERS, 'olumi_base', 'none_established']]);
  });

  it('the stored record is read back whole (the reader accepts the new members) and says the same line to the Agent', () => {
    const g = revisedDraft();
    const env = withGoalChanceLicence(plotRun(), g, 'campaign_effectiveness', () => false, undefined, g,
      { storedConstraints: g.goal_constraints, sentConstraints: wireGoalConstraints(g.goal_constraints), sentRun: { graph: g }, limitVerdicts: verdicts() });
    const result = { type: 'analysis_result', enrichment: env };
    const notes = goalChanceNotesForAgent(result, g, true);
    expect(notes[0]!.startsWith('⟦AIE:joint.limit_unscored⟧')).toBe(true);
    expect(notes.some((n) => RERUN_TEXT.test(n))).toBe(false);
    // The option's own withheld reason is the joint's, by code.
    expect(goalChanceWithheldReasonsForAgent(result, 'hire_marketing_manager').map((r) => r.code)).toEqual(['goal_joint_not_shown']);
  });
});

describe('(b) W2 — no target is dropped silently: each stated target is shown, or withheld with its reason', () => {
  it('RED on a770ce49 (`return []`): the customers target, with no figure, has its own withheld line naming the quantity', () => {
    const l = licenceOn(revisedDraft())!;
    expect(l.targets!.per_target.map((t) => t.constraint_id)).toEqual([GOAL_ROW]);
    expect(l.targets!.withheld_targets!.map((t) => [t.constraint_id, t.node_id, t.label, t.reason, t.next_step.code])).toEqual([
      [CUSTOMERS, 'new_customers_first_3_months', 'New customers in first 3 months', TARGET_NO_LEVEL_TODAY, 'none_established'],
    ]);
    // Said where every reader already reads (the licence's notes), first among them.
    expect(l.notes![0]).toBe(l.targets!.withheld_targets![0]!.line);
    expect(l.notes![0]).toContain('‘New customers in first 3 months’');
    expect(l.notes![0]).toContain(`reason: ${TARGET_NO_LEVEL_TODAY}`);
  });

  it('every stated target id appears exactly once across per_target and withheld_targets, whatever the cause', () => {
    const variants: Array<[string, Rec, Rec[] | undefined]> = [
      ['run 4 as served', plotRun(), undefined],
      ['no joint figure, no reason', plotRun({ joint_withheld: undefined }), undefined],
      ['the goal target\'s figure missing too', plotRun({ option_comparison: (plotRun().option_comparison as Rec[]).map(({ constraint_probabilities: _c, ...r }) => r) }), undefined],
      ['old wire (strictness not sent)', plotRun(), (wireGoalConstraints(revisedDraft().goal_constraints) as Rec[]).map((r) => (r.constraint_id === GOAL_ROW ? { ...r, operator: '>=' } : r))],
    ];
    for (const [name, run, sent] of variants) {
      const g = revisedDraft();
      const l = goalChanceLicenceOf(run, g, 'campaign_effectiveness', () => false, undefined, g,
        { storedConstraints: g.goal_constraints, sentConstraints: sent ?? wireGoalConstraints(g.goal_constraints), sentRun: { graph: g }, limitVerdicts: verdicts() })!;
      const ids = [...l.targets!.per_target.map((t) => t.constraint_id), ...(l.targets!.withheld_targets ?? []).map((t) => t.constraint_id)];
      expect([name, ids.sort()]).toEqual([name, [CUSTOMERS, GOAL_ROW].sort()]);
    }
  });

  it('a FACTOR target with no level today → its own starting value is the next step (a writer exists)', () => {
    const g = revisedDraft();
    const nodes = g.nodes as Rec[];
    // Constructed: the target is the factor "Campaign planning quality", stripped of its level, reached from the factors.
    delete nodes.find((n) => n.id === 'campaign_planning_quality')!.observed_state;
    const row = { constraint_id: 'target:planning', node_id: 'campaign_planning_quality', operator: '>=', value: 70, unit: 'campaign planning quality score (0–100)', value_frame: 'level', role: 'goal_target' };
    g.goal_constraints = [...(g.goal_constraints as Rec[]), row];
    const run = plotRun({ joint_withheld: { reason: 'limit_unscored', constraint_ids: ['target:planning'] } });
    const l = licenceOn(g, run, { limitVerdicts: [...verdicts(), { constraint_id: 'target:planning', state: 'unscored', reason: 'CONSTRAINT_NOT_CONVERTIBLE' }] })!;
    expect(l.targets!.withheld_targets!.find((t) => t.constraint_id === 'target:planning')).toMatchObject({
      reason: TARGET_NO_LEVEL_TODAY, next_step: { code: 'give_starting_value', node_id: 'campaign_planning_quality', label: 'Campaign planning quality' } });
  });
});

describe('(c) W4 — a recorded target is never ALSO listed as an excluded extra condition', () => {
  it('RED on a770ce49 ("It does not include: secure 20 new customers …" beside the customers target): no exclusion is claimed', () => {
    const l = licenceOn(revisedDraft())!;
    expect((l.notes ?? []).some((n) => n.includes('It does not include'))).toBe(false);
    // The condition is still said, byte for byte (never dropped, never changed), claimed neither in nor out.
    expect(l.notes).toContain('⟦AIE:conditions.retained_unbound⟧ conditions: secure 20 new customers within the first 3 months');
  });

  it('CONTROL: with ONE target (no target row sent), a retained condition is still said as outside the chance (amendment 4)', () => {
    const g = revisedDraft();
    g.goal_constraints = (g.goal_constraints as Rec[]).filter((r) => r.role !== 'goal_target');
    const l = licenceOn(g, plotRun({ joint_withheld: undefined }))!;
    expect(l.targets).toBeUndefined();
    // Relative to the ONE target there is no other target it could restate: amendment 4's exclusion stands, byte for byte.
    expect((l.notes ?? []).find((n) => n.includes('It does not include'))).toContain('secure 20 new customers within the first 3 months');
    expect((l.notes ?? []).some((n) => n.includes('⟦AIE:conditions.retained_unbound⟧'))).toBe(false);
  });
});

// ── Constructed rows, one per reason, straight through the block ────────────────────────────────────────────────────────
const twoTargets = (): Rec => ({
  nodes: [
    { id: 'g', kind: 'goal', label: 'Conversion rate' },
    { id: 'c', kind: 'factor', label: 'New customers', observed_state: { value: 0.1, baseline: 0.1, raw_value: 10, source: 'user_stated' } },
    { id: 'p', kind: 'factor', label: 'Advertising spend', observed_state: { value: 0.1, raw_value: 20000, source: 'user_stated' } },
    { id: 't', kind: 'outcome', label: 'Annual spend' },
    { id: 'o1', kind: 'option', label: 'More ads', interventions: { p: { value: 0.4, raw_value: 80000, source: 'user_stated' } } },
    { id: 'o2', kind: 'option', label: 'Fewer ads', interventions: { p: { value: 0.05, raw_value: 10000, source: 'user_stated' } } },
  ],
  edges: [{ from: 'p', to: 't', strength: { mean: 0.5, std: 0.1 }, provenance: { source: 'cee_hypothesis', magnitude: 'olumi_placeholder' } }],
  goal_constraints: [
    { constraint_id: 'r:g', node_id: 'g', operator: '>=', value: 15, unit: '%', value_frame: 'level', role: 'goal_target' },
    { constraint_id: 'r:c', node_id: 'c', operator: '>=', value: 20, unit: 'customers', value_frame: 'level', role: 'goal_target' },
    { constraint_id: 'r:t', node_id: 't', operator: '<=', value: 100000, unit: 'GBP', value_frame: 'level' },
  ],
});
const records = (over: Rec = {}): Rec => ({ option_comparison: ['o1', 'o2'].map((id) => ({ option_id: id,
  constraint_probabilities: { 'r:g': 0.5, 'r:c': 0.6 }, constraint_probabilities_precision: { 'r:g': PRECISION, 'r:c': PRECISION }, ...over })) });
const blockOf = (env: Rec, g: Rec = twoTargets(), extra: Rec = {}, sent?: unknown): GoalTargetsBlock => goalTargetsBlockOf({
  envelope: env, graph: g, storedConstraints: g.goal_constraints, sentConstraints: sent ?? wireGoalConstraints(g.goal_constraints),
  optionIds: ['o1', 'o2'], sentGraph: g, ...extra })!;

describe('constructed rows — each reason, by code', () => {
  it('a LIMIT moved through an unsized link (parts_links_placeholder) → size that link, named by its two ends', () => {
    const joint = blockOf({ ...records(), joint_withheld: { reason: 'limit_unscored', constraint_ids: ['r:t'] } }, twoTargets(),
      { limitVerdicts: [{ constraint_id: 'r:t', state: 'unscored', reason: 'parts_links_placeholder' }] }).joint as Rec;
    expect(joint).toMatchObject({ reason: 'limit_unscored',
      next_step: { code: 'size_link', node_id: 't', label: 'Annual spend', from: { node_id: 'p', label: 'Advertising spend' } } });
    expect((joint.causes as Rec[]).map((c) => [c.constraint_id, c.reason])).toEqual([['r:t', 'parts_links_placeholder']]);
  });

  it('a figure without precision, no figure, and no option: each its own code, and none promises a step', () => {
    const p = blockOf(records({ probability_of_joint_goal: 0.3 })).joint as Rec;
    const n = blockOf(records()).joint as Rec;
    const none = goalTargetsBlockOf({ envelope: records(), graph: twoTargets(), storedConstraints: twoTargets().goal_constraints,
      sentConstraints: wireGoalConstraints(twoTargets().goal_constraints), optionIds: [] })!.joint as Rec;
    expect([p.reason, n.reason, none.reason]).toEqual(['precision_missing', 'not_returned', 'no_option']);
    for (const j of [p, n, none]) {
      expect(j.next_step).toEqual({ code: 'none_established' });
      expect(String(j.line)).not.toMatch(RERUN_TEXT);
      expect(String(j.line)).not.toContain(RERUN_KEY);
    }
  });

  it('NEGATIVE (a genuine stale Run): a stored target the Run never sent → the joint and that target say to run it again', () => {
    const g = twoTargets();
    const sent = (wireGoalConstraints(g.goal_constraints) as Rec[]).filter((r) => r.constraint_id !== 'r:c');
    const b = blockOf(records({ probability_of_joint_goal: 0.3, probability_of_joint_goal_precision: PRECISION }), g, {}, sent);
    expect(b.joint).toMatchObject({ status: 'withheld', reason: 'figure_not_preserved', next_step: { code: 'rerun_analysis' } });
    expect((b.joint as Rec).line).toContain(RERUN_KEY);
    expect(b.withheld_targets!.map((t) => [t.constraint_id, t.reason, t.next_step.code])).toEqual([['r:c', 'figure_not_preserved', 'rerun_analysis']]);
  });

  it('CONTROL: every condition scored, a joint figure with its precision → licensed exactly as before (no withheld member)', () => {
    const b = blockOf(records({ probability_of_joint_goal: 0.3, probability_of_joint_goal_precision: PRECISION }), twoTargets(),
      { limitVerdicts: [{ constraint_id: 'r:t', state: 'scored' }] });
    expect(b.joint).toMatchObject({ status: 'licensed', pct_by_option: { o1: 30, o2: 30 } });
    expect(b).not.toHaveProperty('withheld_targets');
  });
});

describe('the words: placeholders only, by key; "run again" only for a stale or mismatched Run', () => {
  const reasons: JointWithholdReason[] = ['not_returned', 'precision_missing', 'strict_not_preserved', 'condition_not_named', 'olumi_base',
    'no_option', 'target_not_supported', 'figure_not_preserved', 'limit_unscored'];
  it('no reason\'s line says "Run the analysis again"; the re-run placeholder rides only the two mismatched-Run reasons', () => {
    for (const r of reasons) {
      const rerun = r === 'strict_not_preserved' || r === 'figure_not_preserved';
      const line = jointWithheldLine(2, r, ['X'], [], rerun ? { next: { code: 'rerun_analysis' } } : {});
      expect([r, RERUN_TEXT.test(line)]).toEqual([r, false]);
      expect([r, line.includes(RERUN_KEY)]).toEqual([r, rerun]);
    }
  });
  it('every placeholder key used is ONE row of the table, each with a one-line meaning', () => {
    for (const [key, row] of Object.entries(JOINT_WITHHOLD_WORDS)) {
      expect([key, row.meaning.trim() !== '' && !/[\r\n]/.test(row.meaning)]).toEqual([key, true]);
    }
    const used = JSON.stringify(licenceOn(revisedDraft())).match(/⟦AIE:([a-z._]+)⟧/g) ?? [];
    expect(used.length).toBeGreaterThan(0);
    for (const u of used) expect(Object.keys(JOINT_WITHHOLD_WORDS)).toContain(u.slice('⟦AIE:'.length, -1));
  });
});

describe('the reader: a stored block speaks only when its new members are well formed', () => {
  const stored = () => structuredClone(licenceOn(revisedDraft())!.targets!) as unknown as Rec;
  const ids = ['hire_marketing_manager', 'ai_tool_plus_advertising', 'continue_as_now'];
  it('the block as stored reads back; a block stored before Batch F (no next step, no withheld targets) still reads', () => {
    expect(readGoalTargetsBlock(stored(), ids)).toBeDefined();
    const old = stored();
    delete old.withheld_targets;
    delete (old.joint as Rec).next_step;
    delete (old.joint as Rec).causes;
    expect(readGoalTargetsBlock(old, ids)).toBeDefined();
  });
  it('NEGATIVE: an unknown next-step code, or a withheld target with no line, makes the whole block speak for nothing', () => {
    const a = stored();
    ((a.joint as Rec).next_step as Rec).code = 'call_the_vendor';
    const b = stored();
    delete ((b.withheld_targets as Rec[])[0] as Rec).line;
    expect(readGoalTargetsBlock(a, ids)).toBeUndefined();
    expect(readGoalTargetsBlock(b, ids)).toBeUndefined();
  });
});

describe('the Agent\'s per-option line beside a LICENSED joint never says "run again" for an option the engine left out', () => {
  it('one option has no joint figure: its reason is the joint\'s, with no re-run promised', () => {
    const g = twoTargets();
    (g.nodes as Rec[])[0] = { ...(g.nodes as Rec[])[0], goal_threshold_frame: 'level', goal_threshold_raw: 15, goal_threshold_unit: '%',
      goal_threshold_cap: 100, goal_threshold: 0.15, goal_direction: '>=', observed_state: { value: 0.1, baseline: 0.1, raw_value: 10, source: 'user_stated' } };
    const run = { option_comparison: [
      { option_id: 'o1', probability_of_goal: 0.5, probability_of_joint_goal: 0.3, probability_of_joint_goal_precision: PRECISION,
        constraint_probabilities: { 'r:g': 0.5, 'r:c': 0.6, 'r:t': 0.9 } },
      { option_id: 'o2', probability_of_goal: 0.4, constraint_probabilities: { 'r:g': 0.4, 'r:c': 0.5, 'r:t': 0.9 } },
    ] };
    const env = withGoalChanceLicence(run, g, 'g', () => false, undefined, g,
      { storedConstraints: g.goal_constraints, sentConstraints: wireGoalConstraints(g.goal_constraints), sentRun: { graph: g } });
    const result = { type: 'analysis_result', enrichment: env };
    const reasons = goalChanceWithheldReasonsForAgent(result, 'o2');
    expect(reasons.map((r) => r.code)).toEqual(['goal_joint_not_shown']);
    expect(reasons[0]!.message).not.toMatch(RERUN_TEXT);
  });
});
