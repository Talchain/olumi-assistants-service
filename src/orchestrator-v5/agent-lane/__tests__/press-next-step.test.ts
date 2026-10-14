/**
 * ⭐ COACH (DL coaching-on-press; PL #94 6135017311): each withheld-Run blocker is typed by its own producer, from that
 * producer's facts. A missing input is asked only where the answer unlocks the next stage; "can't calculate yet" only where
 * no writer, card or input can unlock it; a card or control is its own step; a stale result says its own line while it can
 * be run again. Real inputs: the served s4b capture (unseen-1), the target verdict's own graphs, the admitted event model.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { targetBlockerOf, targetTestabilityOf, untestableTargetParts, type UntestableTargetParts } from '../../admission/target-testability.js';
import { jointBlockerOf, jointWithheldLine, olumiBaseTargetsOf, type GoalCondition, type JointWithholdReason } from '../../goal-target/goal-targets-joint.js';
import { chanceGoalDeadlineAsk } from '../../goal-target/goal-kind.js';
import { pairGoalCeiling } from '../../goal-target/goal-ceiling-pair.js';
import { chanceGoalBlockerOf, eventModelAsk, withEventShareDate } from '../../goal-target/event-by-date-model.js';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { assignEntityRefs } from '../../graph/entity-refs.js';
import { unreadGoalProductBlockerOf, type UnreadGoalProduct } from '../unread-goal-product.js';
import { staleBlockerOf, staleResultLine } from '../write-outcome.js';
import { oneNextStep, type PressBlocker } from '../press-next-step.js';
import { goalTargetMissingBlockerOf } from '../decision-input-ask.js';
import { modelGapOf } from '../method-turn/widen-turn.js';
import { nextStepBlockerForAgent } from '../next-step-blocker.js';

type Rec = Record<string, any>;
const read = (name: string): Rec => JSON.parse(readFileSync(new URL(`../../goal-target/__tests__/fixtures/s4b/${name}.json`, import.meta.url), 'utf8'));
const graph = read('unseen-1-read').j.graph;
const envelope = (read('unseen-1-run').blocks as Rec[]).find((b) => b.type === 'analysis_result')!.enrichment as Rec;
const verdict = targetTestabilityOf(graph, envelope.identity_evaluations);
if (verdict.kind !== 'not_testable') throw new Error('the capture must have target failures');

/** A LEVEL target stated strictly ("below"), on its row only: with or without today's level, in a unit with or without its own scale. */
const strictLevel = (label: string, unit: string, value: number, today?: number): Rec => ({ nodes: [{ id: 'g', kind: 'goal', label,
  goal_threshold_frame: 'level', goal_threshold_unit: unit,
  ...(today === undefined ? {} : { observed_state: { raw_value: today, cap: 1000, value: today / 1000, baseline: today / 1000, unit, source: 'brief_extraction' } }) },
{ id: 'o1', kind: 'option', label: 'A' }], edges: [],
goal_constraints: [{ node_id: 'g', value, value_frame: 'level', operator: '<=', operator_as_stated: '<', unit, constraint_id: 'c1' }] });
/** The approved target write's own effect on the goal, on a copy: the stated `<` held, then the real pair writer. */
const afterTargetWrite = (g: Rec): Rec => {
  const w = structuredClone(g);
  (w.nodes as Rec[])[0].goal_direction = '<';
  pairGoalCeiling(w, 'g');
  return w;
};
const failingCases = (g: Rec): string[] => { const v = targetTestabilityOf(g); return v.kind === 'not_testable' ? v.failures.map((f) => f.case) : []; };
/** "productivity down more than 5% from today", a CHANGE target, today's level held: (b) is its only failing case. */
const strictChange = (withToday: boolean): Rec => ({ nodes: [{ id: 'productivity', kind: 'goal', label: 'productivity', goal_threshold_frame: 'level',
  goal_threshold: 0, ...(withToday ? { observed_state: { baseline: 0.5 } } : {}) }], edges: [],
goal_constraints: [{ node_id: 'productivity', value: -0.05, value_frame: 'change_rel', operator: '<' }] });
const partsOf = (g: Rec): UntestableTargetParts => {
  const v = targetTestabilityOf(g);
  if (v.kind !== 'not_testable') throw new Error('expected a failing target');
  return untestableTargetParts(g, v)!;
};

describe('target: the failing cases type the ONE step', () => {
  it('served capture: the target\'s own question is the step, byte for byte', () => {
    const parts = untestableTargetParts(graph, verdict)!;
    expect(parts.question).not.toBeNull();
    expect(parts.untestableComparatorUnlock).toBeNull();
    expect(targetBlockerOf(parts)).toEqual({ kind: 'missing_input', ask: parts.question });
  });

  it('a strict LEVEL target is never "can\'t": the approved target write can hold it (the real pair writer\'s post-state)', () => {
    const g = strictLevel('Monthly cancellations', 'cancellations / month', 400, 520);
    const parts = partsOf(g);
    expect([parts.untestableComparator, parts.untestableComparatorUnlock]).toEqual(["'< 400 cancellations / month'", 'target_write']);
    expect(failingCases(g)).toContain('b');
    expect(failingCases(afterTargetWrite(g))).not.toContain('b');
    // No step is typed from it (whether the write ALONE unlocks it is the writer's to answer: Codex r3, two own rows).
    expect(targetBlockerOf(parts)).toBeNull();
  });

  it('a strict LEVEL target with a question: the question alone is the step, with no gap beside it', () => {
    for (const g of [strictLevel('Monthly cancellations', 'cancellations / month', 400), strictLevel('Churn', '%', 5)]) {
      const parts = partsOf(g);
      expect(parts.untestableComparatorUnlock).toBe('target_write');
      expect(targetBlockerOf(parts)).toEqual({ kind: 'missing_input', ask: `What's today's level of ${parts.name}?` });
    }
  });

  it('a strict CHANGE target: no writer holds it, so it is a capability gap, said and never asked', () => {
    const parts = partsOf(strictChange(true));
    expect([parts.question, parts.untestableComparatorUnlock]).toEqual([null, 'unbuilt']);
    const blocker = targetBlockerOf(parts);
    expect(blocker).toEqual({ kind: 'missing_implementation', what: "a chance for a 'down more than 5% from today' target on ‘productivity’" });
  });

  it('a strict CHANGE target beside a missing level: the ask keeps the gap beside it, so the answer is never promised to unlock it', () => {
    const parts = partsOf(strictChange(false));
    expect(parts.question).toBe("What's today's level of productivity?");
    expect(targetBlockerOf(parts)).toEqual({ kind: 'missing_input', ask: parts.question,
      also_unbuilt: "a chance for a 'down more than 5% from today' target on ‘productivity’" });
  });

  it('no question and no comparator: only an offered identity card owns the step; none is invented', () => {
    const parts: UntestableTargetParts = { ...untestableTargetParts(graph, verdict)!, question: null, untestableComparator: null };
    expect(targetBlockerOf(parts)).toBeNull();
    expect(targetBlockerOf(parts, true)).toEqual({ kind: 'confirm', by: 'identity_card' });
  });
});

describe('joint: the same reason the withheld line says types the step', () => {
  const conversion: GoalCondition = { constraint_id: 'c2', node_id: 'conversion_rate', role: 'target', operator: '>', value: 15, unit: '%',
    label: 'Conversion rate', clause: '‘Conversion rate’ being above 15%' };
  const customers: GoalCondition = { constraint_id: 'c1', node_id: 'new_customers', role: 'target', operator: '>=', value: 400, unit: 'customers',
    label: 'New customers', clause: '‘New customers’ being at least 400' };
  const kinds: Record<JointWithholdReason, PressBlocker['kind'] | null> = {
    target_not_supported: 'missing_implementation', strict_not_preserved: 'missing_implementation',
    olumi_base: 'missing_input', precision_missing: 'run_again', not_returned: 'run_again',
    // No typed cause: an input might or might not unlock it, so no step is invented (PL 6135017311).
    figure_not_preserved: null, condition_not_named: null, no_option: null,
    // #2992: a condition withheld or unscored has its own note saying why; the joint types no step of its own.
    condition_unscored: null, condition_withheld: null,
  };
  it.each(Object.entries(kinds))('%s → %s', (reason, kind) => {
    const blocker = jointBlockerOf(2, reason as JointWithholdReason, ['Churn'], [conversion]);
    if (kind === null) expect(blocker).toBeNull();
    else expect(blocker).toHaveProperty('kind', kind);
  });

  it('a change target that can\'t be combined is named as the gap, never asked', () => {
    const blocker = jointBlockerOf(2, 'target_not_supported', ['Revenue']);
    expect(blocker).toEqual({ kind: 'missing_implementation',
      what: 'the chance of meeting both targets together while ‘Revenue’ is stated as a change' });
    expect(jointWithheldLine(2, 'target_not_supported', ['Revenue'])).toContain('can’t yet be combined');
  });

  it('Olumi\'s assumed starting value is asked for THAT target, in its unit, from the joint\'s own predicate', () => {
    const g = { nodes: [{ id: 'goal', kind: 'goal', label: 'Growth' },
      { id: 'new_customers', kind: 'factor', label: 'New customers', observed_state: { value: 0.4, raw_value: 400, unit: 'customers', source: 'brief_extraction' } },
      { id: 'conversion_rate', kind: 'factor', label: 'Conversion rate', observed_state: { value: 0.1, raw_value: 10, unit: '%', source: 'cee_inference' } }] };
    const olumiBase = olumiBaseTargetsOf(g, [customers, conversion]);
    expect(olumiBase).toEqual([conversion]);
    expect(jointBlockerOf(2, 'olumi_base', [], olumiBase)).toEqual({ kind: 'missing_input', ask: "What's today's level of Conversion rate, in %?" });
    // The target is not identified: no generic ask is invented.
    expect(jointBlockerOf(2, 'olumi_base')).toBeNull();
  });

  it('a repeated Run is the line\'s own step', () => {
    for (const reason of ['precision_missing', 'not_returned'] as const) {
      expect(jointBlockerOf(2, reason)).toEqual({ kind: 'run_again', why: reason });
      expect(jointWithheldLine(2, reason)).toContain('Run the analysis again');
    }
  });
});

describe('chance goal, unread product and stale', () => {
  const chanceGoal = (deadline?: string): Rec => ({ nodes: [{ id: 'g', kind: 'goal', label: 'Ship the release', goal_threshold_unit: '%',
    observed_state: { unit: '% likely' }, ...(deadline === undefined ? {} : { goal_horizon: { deadline } }) }] });
  const unbuilt = 'a chance for ‘Ship the release’ until the model says what must be done by the deadline';
  it('a chance goal: the date is asked with the gap that survives it; with the date held, the gap alone', () => {
    expect(chanceGoalBlockerOf(chanceGoal())).toEqual({ kind: 'missing_input', ask: chanceGoalDeadlineAsk('Ship the release'), also_unbuilt: unbuilt });
    const held = chanceGoalBlockerOf(chanceGoal('2027-04-09'));
    expect(held).toEqual({ kind: 'missing_implementation', what: unbuilt });
    expect(chanceGoalBlockerOf({ nodes: [{ id: 'g', kind: 'goal', label: 'Revenue', goal_threshold_unit: '£' }] })).toBeNull();
  });

  it('an admitted event model: its own question chain (date, then the team\'s time) is the step, each answer unlocking the next', () => {
    const candidate: CandidateModel = {
      goal: { kind: 'event_by_date', deliverable: 'next feature launch', metric: 'Next feature launch', operator: '>=', unit: '% of next feature launch',
        value: null, target_stated: false, frame: 'level', baseline_known: false, baseline_value: null, horizon_months: null, provenance: 'inferred' },
      options: [
        { label: 'Hire a Tech lead', provenance: 'explicit', added_capacity: { monthly_share_pct: 12, lead_months_low: 2, lead_months_high: 4 } },
        { label: 'Carry on as now', provenance: 'ai_proposed', is_status_quo: true, added_capacity: null },
      ], factors: [], risks: [], outcomes: [], links: [], constraints: [], identities: [],
    } as CandidateModel;
    const plain = (g: unknown): Rec => assignEntityRefs(projectGraphForPersistence(GraphV3.parse(g)), { nodes: [], edges: [] }).graph as Rec;
    const admitted = admitCandidateModel(candidate, {}, 'Hire a tech lead to meet our next feature-launch deadline?', undefined, undefined,
      undefined, undefined, undefined, { event_by_date_prompted: true });
    const drafted = plain({ nodes: admitted.nodes, edges: admitted.edges });
    const dated = plain(withEventShareDate(drafted, '2027-04-12', '2026-10-12'));
    expect(chanceGoalBlockerOf(drafted)).toEqual({ kind: 'missing_input', ask: chanceGoalDeadlineAsk('next feature launch') });
    expect(chanceGoalBlockerOf(dated)).toEqual({ kind: 'missing_input', ask: eventModelAsk(dated) });
    expect(eventModelAsk(dated)).toBe('How long would next feature launch take with the team you have now?');
  });

  it('an unread product: the writable reading card is the step; another owner keeps it; "can\'t" only with no writer', () => {
    const p = { goal: { id: 'g', label: 'Monthly revenue', level: 50, unit: '£k', typed: true },
      rate: { id: 'r', label: 'Price', level: 50, unit: '£' }, count: { id: 'c', label: 'Customers', level: 1000, unit: 'customers' } } as UnreadGoalProduct;
    expect(unreadGoalProductBlockerOf(p, 'confirm_reading')).toEqual({ kind: 'confirm', by: 'confirm_reading' });
    expect(unreadGoalProductBlockerOf(p, 'owned_elsewhere')).toBeNull();
    expect(unreadGoalProductBlockerOf(p, 'no_writer')).toEqual({ kind: 'missing_implementation',
      what: 'how likely any option is to reach ‘Monthly revenue’ read as ‘Price’ × ‘Customers’' });
  });

  it('stale only from run_state, with the stale line\'s own words; an unbound current Run is not stale', () => {
    const stale = { run_state: { kind: 'complete_stale', cause: 'graph_changed' }, requires_rerun: true };
    expect(staleBlockerOf(stale, { may_run: true })).toEqual({ kind: 'stale', say: staleResultLine(stale, { may_run: true }) });
    expect(staleBlockerOf(stale, { may_run: true })).toHaveProperty('say', expect.stringContaining('run it again'));
    // A Run that may not run: the line has no step, so the blocker that holds the Run keeps it.
    expect(staleBlockerOf(stale, { may_run: false })).toBeNull();
    const ask: PressBlocker = { kind: 'missing_input', ask: 'What\'s today\'s level of churn?' };
    expect(oneNextStep([staleBlockerOf(stale, { may_run: false }), ask])).toBe(ask);
    expect(staleBlockerOf({ run_state: { kind: 'complete_current' } }, { may_run: true })).toBeNull();
  });
});

describe('ONE step when several stand', () => {
  const input: PressBlocker = { kind: 'missing_input', ask: 'What is today\'s level of churn?' };
  const unbuilt: PressBlocker = { kind: 'missing_implementation', what: 'x' };
  it('stale, then run again, then a card, then an input, then a missing implementation; nothing → none', () => {
    const stale: PressBlocker = { kind: 'stale', say: 's' };
    const again: PressBlocker = { kind: 'run_again', why: 'not_returned' };
    const card: PressBlocker = { kind: 'confirm', by: 'confirm_reading' };
    expect(oneNextStep([unbuilt, input, card, again, stale])).toBe(stale);
    expect(oneNextStep([unbuilt, input, card, again])).toBe(again);
    expect(oneNextStep([unbuilt, input, card])).toBe(card);
    expect(oneNextStep([unbuilt, null, input])).toBe(input);
    expect(oneNextStep([undefined, unbuilt])).toBe(unbuilt);
    expect(oneNextStep([null, undefined])).toBeNull();
  });
});

describe('goal_target_missing ranks FIRST (Paul\'s funding test, DL 00:21Z)', () => {
  const noTarget = (fields: Rec = {}): Rec => ({ nodes: [{ id: 'g', kind: 'goal', label: 'Monthly revenue', goal_threshold_unit: '£', ...fields },
    { id: 'o1', kind: 'option', label: 'A' }], edges: [] });
  it('a goal with no target: the served target ask is the step, typed by its cause', () => {
    const step = goalTargetMissingBlockerOf(noTarget());
    expect(step).toMatchObject({ kind: 'missing_input', cause: 'goal_target_missing' });
    // The ONE authority's words (`goalTargetGapOf`, C1): the same question the standing gap and the Run cells say.
    expect((step as { ask: string }).ask).toBe('One gap: ‘Monthly revenue’ has no target or deadline yet. What would count as meeting it, and by when?');
    // Olumi's own inferred goal is no exception (Run 3's "Development speed" was one); a chance goal's step is its date.
    expect(goalTargetMissingBlockerOf(noTarget({ provenance: 'ai_inferred' }))).toMatchObject({ cause: 'goal_target_missing' });
    expect(goalTargetMissingBlockerOf(noTarget({ goal_threshold_unit: '%', observed_state: { unit: '% likely' } }))).toBeNull();
  });
  it('it outranks every other step, a stale result included', () => {
    const missing: PressBlocker = { kind: 'missing_input', ask: 'What figure should "Monthly revenue" reach or stay under?', cause: 'goal_target_missing' };
    const stale: PressBlocker = { kind: 'stale', say: 's' };
    const again: PressBlocker = { kind: 'run_again', why: 'not_returned' };
    expect(oneNextStep([stale, again, { kind: 'missing_input', ask: 'x' }, missing])).toBe(missing);
  });
  it('agrees with the ONE "no target" authority (`modelGapOf`, moved verbatim to C1\'s `goalTargetGapOf`) on Paul\'s served Run 3', () => {
    // C1's fixture, byte for byte (tests/fixtures/c1, T1H): the goal "Development speed" held no target. Until C1 merges, this
    // row pins the two equal; then `goalTargetMissingBlockerOf` calls `goalTargetGapOf` (DL inbox 00:3xZ).
    const run3 = (JSON.parse(readFileSync('tests/fixtures/c1/served-funding-run3-20261014.json', 'utf8')) as Rec).graph as Rec;
    const withTarget = { ...run3, nodes: (run3.nodes as Rec[]).map((n) => n.id === 'development_speed'
      ? { ...n, goal_threshold_raw: 2, goal_direction: '>=' } : n) };
    expect(modelGapOf(run3)?.kind).toBe('goal_target_missing');
    expect(goalTargetMissingBlockerOf(run3)).toMatchObject({ kind: 'missing_input', cause: 'goal_target_missing' });
    // Contrast: ONE change, the goal states a target; neither says a target is missing.
    expect(modelGapOf(withTarget)?.kind).not.toBe('goal_target_missing');
    expect(goalTargetMissingBlockerOf(withTarget)).toBeNull();
  });
  it('the served capture (unseen-1, a stated target): the fact is the target\'s own question, not a target ask', () => {
    const step = nextStepBlockerForAgent({ raw: graph, analysis_state: { run_state: { kind: 'complete_current' } }, analysis_result: envelope });
    expect(step).toEqual(targetBlockerOf(untestableTargetParts(graph, verdict)!));
    expect(step).not.toHaveProperty('cause');
  });
});
