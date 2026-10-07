/**
 * ⭐ S-C MODEL WIDENING, target risks — the door's pure rows (DL 0fd71f 7 Oct; lane WIDEN; RC `method_turns.RC-WIDEN`).
 *
 * Fixtures are Paul's SERVED prod model (scenario 6582edbc, CEE 7e3f8fb2), reconstructed from the run facts' input
 * snapshots (`fixtures/s-c-widen/*.json`, provenance inside). The risk names in the candidate rows are the ones Olumi
 * served as prose on turns #2 and #12 (forensics D-11): "Recruitment delay", "Wrong bottleneck", "Coordination drag",
 * "Quality trade-off"; "Overlapping costs", "Handover debt", "Offer fallout", "Work cannot be split".
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { assembleGuidanceSignals } from '../../turn-context/guidance-signals.js';
import {
  CANVAS_OPTIONS_PRESS_ID, CANVAS_RISKS_PRESS_ID, isWidenAddPressId, modelGapOf, riskGate, risksTurnFromSignals,
  settleRisksTurn, STATED_BUDGET, SUGGEST_RISKS_CHIP, widenAddCallOf, WIDEN_ADD_MESSAGE, widenTargetOf, WIDEN_PRESS_ID, type RunRisksWidenTurn,
} from '../widen-turn.js';

const fixture = (v: 'v1' | 'v2'): Record<string, unknown> =>
  JSON.parse(readFileSync(new URL(`./fixtures/s-c-widen/paul-6582edbc-${v}.json`, import.meta.url), 'utf8')) as Record<string, unknown>;
const signals = (graph: unknown) => assembleGuidanceSignals({
  request: 'method', explicitRequest: 'RC-WIDEN', offeredSpecific: [], graph, analysisState: undefined, analysisResult: undefined,
  optionParticipation: undefined, leaderLicensed: false,
});
const turnOn = (graph: unknown, words = ''): RunRisksWidenTurn => {
  const t = risksTurnFromSignals(signals(graph), graph, words);
  if (t.kind !== 'run_risks') throw new Error(`expected a risks run, got ${t.kind}`);
  return t;
};
const PRE_MORTEM_RISK_REQUEST = 'Prepare one risk called "Onboarding drag": Onboarding takes longer. It would lower "Feature Delivery Capacity". Early warning: x Olumi hypothesis — for you to challenge. Show the proposed change for approval.';

/** Served turn #2's four prose risks, grounded by id on model v1. */
const TURN2 = [
  { label: 'Recruitment delay', category: 'timing', hits_id: 'hire_two_developers', through_id: 'developer_hires', through_direction: 'positive',
    affects_id: 'feature_delivery_capacity', direction: 'negative', relies_on: 'filling both developer roles quickly', watch_for: 'no accepted offer by week 4' },
  { label: 'Wrong bottleneck', category: 'dependency', hits_id: 'hire_a_tech_lead', through_id: 'tech_lead_hires', through_direction: 'positive',
    affects_id: 'meet_our_next_feature_launch_deadline', direction: 'negative', relies_on: 'a Tech Lead removing the main delivery blocker', watch_for: 'delays persist after the Tech Lead starts' },
  { label: 'Coordination drag', category: 'people', hits_id: 'hire_two_developers', through_id: 'developer_hires', through_direction: 'positive',
    affects_id: 'feature_delivery_capacity', direction: 'negative', relies_on: 'new developers joining without slowing the team', watch_for: 'senior time spent on onboarding' },
  { label: 'Quality trade-off', category: 'cost', hits_id: 'hire_a_tech_lead', through_id: 'tech_lead_hires', through_direction: 'positive',
    affects_id: 'meet_our_next_feature_launch_deadline', direction: 'negative', relies_on: 'keeping quality while hiring under time pressure', watch_for: 'rising defect counts before launch' },
];
const appendix = (items: unknown): string => `<risk_suggestions>${JSON.stringify(items)}</risk_suggestions>`;

describe('S-C press identity: ONE door, a target per press', () => {
  it('PI-1: the W6 pill (id + its exact message) and the canvas "+" Risk press open target risks', () => {
    expect(widenTargetOf(SUGGEST_RISKS_CHIP.id, SUGGEST_RISKS_CHIP.message)).toBe('risks');
    expect(widenTargetOf(SUGGEST_RISKS_CHIP.id, 'Suggest risks I haven’t considered.')).toBe('risks');
    expect(widenTargetOf(CANVAS_RISKS_PRESS_ID, 'What could go wrong, or unexpectedly well, that this model doesn’t have yet?')).toBe('risks');
  });
  it('PI-2 CONTROL: the pre-mortem worksheet "Add this as a risk" shares the id but NOT the message → never this door', () => {
    expect(widenTargetOf(SUGGEST_RISKS_CHIP.id, PRE_MORTEM_RISK_REQUEST)).toBeNull();
    expect(widenTargetOf(SUGGEST_RISKS_CHIP.id, undefined)).toBeNull();
  });
  it('PI-3: options presses (the pill AND the canvas "+" Option) open target options; ordinary chips open nothing', () => {
    expect(widenTargetOf(WIDEN_PRESS_ID, 'x')).toBe('options');
    expect(widenTargetOf(CANVAS_OPTIONS_PRESS_ID, 'What other options could answer this?')).toBe('options');
    expect(widenTargetOf('agent-next-pre-mortem', SUGGEST_RISKS_CHIP.message)).toBeNull();
    expect(widenTargetOf('ask:missing-factor', 'x')).toBeNull();
  });
});

describe('S-C risks gate: grounded, attached, distinct — by identity', () => {
  it('RG-1 (served turn #2 names): ≤3 kept, one per category, each ATTACHED to a factor an option really changes', () => {
    const gate = riskGate(turnOn(fixture('v1')), TURN2);
    expect(gate.kept.map((r) => [r.label, r.category, r.hits.id, r.through.id, r.affects.id])).toEqual([
      ['Recruitment delay', 'timing', 'hire_two_developers', 'developer_hires', 'feature_delivery_capacity'],
      ['Wrong bottleneck', 'dependency', 'hire_a_tech_lead', 'tech_lead_hires', 'meet_our_next_feature_launch_deadline'],
      ['Coordination drag', 'people', 'hire_two_developers', 'developer_hires', 'feature_delivery_capacity'],
    ]);
    expect(gate.dropped).toEqual([{ index: 3, failed: ['RK-COUNT'] }]);
  });
  it('RG-2 RK-THROUGH: an option whose level for that factor equals the status quo does NOT change it (Hire a Tech Lead sets Developer Hires 0 = today)', () => {
    const gate = riskGate(turnOn(fixture('v1')), [{ ...TURN2[0], hits_id: 'hire_a_tech_lead' }]);
    expect(gate.kept).toEqual([]);
    expect(gate.dropped).toEqual([{ index: 0, failed: ['RK-THROUGH'] }]);
  });
  it('RG-3 RK-HITS: the status quo is not an option a risk can hit; an unknown id neither', () => {
    expect(riskGate(turnOn(fixture('v1')), [{ ...TURN2[0], hits_id: 'carry_on_as_now' }]).dropped[0]!.failed).toEqual(['RK-HITS']);
    expect(riskGate(turnOn(fixture('v1')), [{ ...TURN2[0], hits_id: 'nope' }]).dropped[0]!.failed).toEqual(['RK-HITS']);
  });
  it('RG-4 RK-AFFECTS: a risk hurts the goal or an outcome, never a factor', () => {
    expect(riskGate(turnOn(fixture('v1')), [{ ...TURN2[0], affects_id: 'developer_hires' }]).dropped[0]!.failed).toEqual(['RK-AFFECTS']);
  });
  it('RG-5 RK-NO-DUP: an existing node name (any case) is not a new risk; nor is a second item with the same name', () => {
    expect(riskGate(turnOn(fixture('v1')), [{ ...TURN2[0], label: 'new-hire onboarding disruption' }]).dropped[0]!.failed).toContain('RK-NO-DUP');
    expect(riskGate(turnOn(fixture('v1')), [TURN2[0], { ...TURN2[1], label: 'Recruitment Delay' }]).dropped).toEqual([{ index: 1, failed: ['RK-NO-DUP'] }]);
  });
  it('RG-6 RK-DISTINCT: two items from the same class of cause are one item', () => {
    expect(riskGate(turnOn(fixture('v1')), [TURN2[0], { ...TURN2[1], category: 'timing' }]).dropped).toEqual([{ index: 1, failed: ['RK-DISTINCT'] }]);
  });
  it('RG-7 RK-WORDS: no invented figure (durations exempt in the signpost), no chance words, no question, word caps; the model\'s own words are masked', () => {
    const t = turnOn(fixture('v1'));
    for (const bad of [{ label: 'A 3-month hiring slip' }, { relies_on: 'hiring that is likely to be quick' }, { watch_for: 'is the offer late?' },
      { label: 'One two three four five six seven' }, { relies_on: 'paying £90,000 per developer' }, { watch_for: 'this option leads the pack' },
      { watch_for: 'one two three four five six seven eight nine' }, { label: 'Will hiring stall?' }]) {
      expect(riskGate(t, [{ ...TURN2[0], ...bad }]).dropped[0]?.failed, JSON.stringify(bad)).toContain('RK-WORDS');
    }
    // "Tech Lead" is the user's own word in the model; "week 4" is a duration in the signpost.
    expect(riskGate(t, [{ ...TURN2[0], relies_on: 'a Tech Lead freeing the existing team', watch_for: 'no offer by week 4' }]).kept).toHaveLength(1);
  });
  it('RG-8 RK-SCHEMA: an unknown category or a missing ref is dropped, never repaired', () => {
    expect(riskGate(turnOn(fixture('v1')), [{ ...TURN2[0], category: 'luck' }, { ...TURN2[0], through_id: undefined }]).dropped)
      .toEqual([{ index: 0, failed: ['RK-SCHEMA'] }, { index: 1, failed: ['RK-SCHEMA'] }]);
  });
  it('RG-9 (served turn #12 names, model v2): the freelance option is hit through ITS factor; a factor an option changes is not "shared"', () => {
    const t = turnOn(fixture('v2'));
    const gate = riskGate(t, [
      { label: 'Overlapping costs', category: 'cost', hits_id: 'c3d38027', through_id: 'fac_freelance_resource_brought_in', through_direction: 'positive',
        affects_id: 'meet_our_next_feature_launch_deadline', direction: 'negative', relies_on: 'paying freelance cover and salaries together', watch_for: 'both costs in the same month' },
      { label: 'Handover debt', category: 'people', hits_id: 'fac_freelance_resource_brought_in', through_id: 'fac_freelance_resource_brought_in', through_direction: 'positive',
        affects_id: 'feature_delivery_capacity', direction: 'negative', relies_on: 'freelance work being easy to hand over', watch_for: 'undocumented freelance changes' },
    ]);
    expect(gate.kept.map((r) => [r.label, r.hits.kind, r.hits.label, r.through.label, r.shared])).toEqual([
      ['Overlapping costs', 'option', 'Bring in a freelance resource if, within 2 months, we don\'t have our candidates identified', 'Freelance resource brought in', false],
    ]);
    expect(gate.dropped).toEqual([{ index: 1, failed: ['RK-HITS'] }]);
  });
  it('RG-10 (Science twin): a risk on a factor NO option changes is offered AFTER the option-specific ones and says it affects every option alike', () => {
    const shared = { label: 'Team attrition', category: 'external', hits_id: 'existing_engineering_team_size', through_id: 'existing_engineering_team_size',
      through_direction: 'negative', affects_id: 'feature_delivery_capacity', direction: 'negative', relies_on: 'the current team staying intact', watch_for: 'a resignation before launch' };
    const settled = settleRisksTurn(turnOn(fixture('v1')), appendix([shared, TURN2[0]]));
    expect(settled.gate.kept.map((r) => [r.label, r.shared])).toEqual([['Recruitment delay', false], ['Team attrition', true]]);
    expect(settled.reply.split('\n')[3]).toBe('- Every option relies on the current team staying intact. Risk: ‘Team attrition’ (outside events), through ‘Existing Engineering Team Size’; it affects every option alike. Watch for: a resignation before launch.');
  });
  it('RG-11 (Science: never inert): every kept risk has a parent factor the door will link, and the hit option really changes it', () => {
    const t = turnOn(fixture('v1'));
    for (const r of riskGate(t, TURN2).kept) {
      const call = widenAddCallOf(r.press.id, r.press.message, fixture('v1'));
      expect(call?.args.caused_by, r.label).toEqual([{ factor_label: r.through.label, direction: r.through.direction }]);
      expect(t.options.find((o) => o.id === r.hits.id)?.changes, r.label).toContain(r.through.id);
    }
  });
});

describe('S-C risks reply: the named method, what each hits, nothing added, ONE gap question', () => {
  it('RR-1 (served turn #2 → after): deterministic reply; one Add per item, then Something else; never "None has been added" prose', () => {
    const settled = settleRisksTurn(turnOn(fixture('v1')), `Sure!\n${appendix(TURN2)}`);
    expect(settled.reply.split('\n')).toEqual([
      'Three risks you haven’t mapped yet.',
      'I checked what each option relies on and how that could fail, across people, timing, cost, dependencies and outside events (assumption-based planning).',
      '- ‘Hire Two Developers’ relies on filling both developer roles quickly. Risk: ‘Recruitment delay’ (timing), through ‘Developer Hires’. Watch for: no accepted offer by week 4.',
      '- ‘Hire a Tech Lead’ relies on a Tech Lead removing the main delivery blocker. Risk: ‘Wrong bottleneck’ (dependency), through ‘Tech Lead Hires’. Watch for: delays persist after the Tech Lead starts.',
      '- ‘Hire Two Developers’ relies on new developers joining without slowing the team. Risk: ‘Coordination drag’ (people), through ‘Developer Hires’. Watch for: senior time spent on onboarding.',
      'Possible risks, not established facts. Nothing is added until you choose one and approve the change.',
      'One gap: ‘meet our next feature-launch deadline’ has no target or deadline yet. What would count as meeting it, and by when?',
    ]);
    expect(settled.reply.match(/\?/gu)).toHaveLength(1);
    expect(settled.actions.map((a) => a.label)).toEqual(['Add ‘Recruitment delay’', 'Add ‘Wrong bottleneck’', 'Add ‘Coordination drag’', 'Something else']);
    expect(settled.actions.slice(0, 3).every((a) => isWidenAddPressId(a.id))).toBe(true);
  });
  it('RR-2: no candidate passes → RC\'s deterministic fallback + Talk it through; nothing offered to add', () => {
    const settled = settleRisksTurn(turnOn(fixture('v1')), 'Here are four risks: Recruitment delay, Wrong bottleneck… None has been added.');
    expect(settled.reply).toBe('What else could stop ‘meet our next feature-launch deadline’ from working out? For example, something about people, timing, cost, a dependency, or something outside your control.');
    expect(settled.actions.map((a) => a.id)).toEqual(['agent-talk-it-through']);
  });
});

describe('S-C Add press: bound to its message AND the node ids; re-checked on the model as it is now', () => {
  const v1 = fixture('v1');
  const first = () => riskGate(turnOn(v1), TURN2).kept[0]!;
  it('AP-1: the press round-trips to ONE propose_new_risk call naming the risk, its driver and what it hurts', () => {
    const r = first();
    expect(r.press.message).toBe('Add the risk ‘Recruitment delay’ to ‘Hire Two Developers’: driven by more ‘Developer Hires’, it would lower ‘Feature Delivery Capacity’.');
    expect(widenAddCallOf(r.press.id, r.press.message, v1)).toEqual({ tool: 'propose_new_risk', args: {
      label: 'Recruitment delay', rationale: 'Olumi suggested this risk (assumption-based planning); the user chose to add it.',
      affects: [{ target_label: 'Feature Delivery Capacity', direction: 'negative' }],
      caused_by: [{ factor_label: 'Developer Hires', direction: 'positive' }],
    } });
  });
  it('AP-2: an edited message, another press\'s id, or an unbounded message is not this press', () => {
    const r = first();
    expect(widenAddCallOf(r.press.id, r.press.message.replace('Recruitment delay', 'Something else'), v1)).toBeNull();
    expect(widenAddCallOf('agent-widen-add:0000000000000000', r.press.message, v1)).toBeNull();
    expect(widenAddCallOf(r.press.id, `${r.press.message}${' '.repeat(700)}`, v1)).toBeNull();
  });
  it('AP-3 (Codex r1 P1): a stale press is refused — its factor renamed and a NEW node given the old name; or the option no longer changes it', () => {
    const r = first();
    const nodes = v1.nodes as Record<string, unknown>[];
    const renamed = { ...v1, nodes: [...nodes.map((n) => (n.id === 'developer_hires' ? { ...n, label: 'Renamed developer count' } : n)),
      { id: 'fac_other', kind: 'factor', label: 'Developer Hires' }] };
    expect(widenAddCallOf(r.press.id, r.press.message, renamed)).toBeNull();
    const unchanged = { ...v1, nodes: nodes.map((n) => (n.id === 'hire_two_developers'
      ? { ...n, interventions: { ...(n.interventions as Record<string, unknown>), developer_hires: { value: 0, raw_value: 0, unit: 'hires' } } } : n)) };
    expect(widenAddCallOf(r.press.id, r.press.message, unchanged)).toBeNull();
    // Only the id binding catches this one: what it HURTS was renamed and a new outcome took the old name.
    const outcome = { ...v1, nodes: [...nodes.map((n) => (n.id === 'feature_delivery_capacity' ? { ...n, label: 'Renamed capacity' } : n)),
      { id: 'oc_other', kind: 'outcome', label: 'Feature Delivery Capacity' }],
      edges: [...(v1.edges as Record<string, unknown>[]), { from: 'oc_other', to: 'meet_our_next_feature_launch_deadline', strength: { mean: 0.5, std: 0.1 } }] };
    expect(widenAddCallOf(r.press.id, r.press.message, outcome)).toBeNull();
    expect(widenAddCallOf(r.press.id, r.press.message, v1), 'CONTROL: the model as offered').not.toBeNull();
  });
  it('AP-4: a shared risk\'s press names no option and is refused once an option starts changing its factor', () => {
    const shared = { label: 'Team attrition', category: 'external', hits_id: 'existing_engineering_team_size', through_id: 'existing_engineering_team_size',
      through_direction: 'negative', affects_id: 'feature_delivery_capacity', direction: 'negative', relies_on: 'the current team staying intact', watch_for: 'a resignation before launch' };
    const r = riskGate(turnOn(v1), [shared]).kept[0]!;
    expect(r.press.message).toBe('Add the risk ‘Team attrition’ for every option: driven by less ‘Existing Engineering Team Size’, it would lower ‘Feature Delivery Capacity’.');
    expect(widenAddCallOf(r.press.id, r.press.message, v1)?.args.caused_by).toEqual([{ factor_label: 'Existing Engineering Team Size', direction: 'negative' }]);
    const moved = { ...v1, nodes: (v1.nodes as Record<string, unknown>[]).map((n) => (n.id === 'hire_two_developers'
      ? { ...n, interventions: { ...(n.interventions as Record<string, unknown>), existing_engineering_team_size: { value: 0.3, raw_value: 9, unit: 'engineers' } } } : n)) };
    expect(widenAddCallOf(r.press.id, r.press.message, moved)).toBeNull();
  });
});

describe('S-C standing gap signal: typed, from model state, ONE question', () => {
  it('GP-1 (D-01, Paul\'s goal): no target and no deadline → the target-and-date question', () => {
    expect(modelGapOf(fixture('v1'))).toEqual({ kind: 'goal_target_missing', goal_id: 'meet_our_next_feature_launch_deadline', deadline_known: false,
      question: 'One gap: ‘meet our next feature-launch deadline’ has no target or deadline yet. What would count as meeting it, and by when?' });
  });
  it('GP-2 CONTROL: a goal WITH a stated target asks nothing about it; a deadline row drops "by when"', () => {
    const g = fixture('v1');
    const withTarget = { ...g, nodes: (g.nodes as Record<string, unknown>[]).map((n) => (n.kind === 'goal' ? { ...n, goal_threshold_raw: 80 } : n)) };
    expect(modelGapOf(withTarget)).toBeNull();
    const withDeadline = { ...g, goal_constraints: [{ node_id: 'meet_our_next_feature_launch_deadline', operator: '<=', value: 6, deadline_metadata: { months: 6 } }] };
    expect(modelGapOf(withDeadline)?.question).toBe('One gap: ‘meet our next feature-launch deadline’ has no target yet. What would count as meeting it?');
  });
  it('GP-3 (D-07, Paul\'s own words at 09:29:58Z): a stated budget with no limit in the model → the budget question; a limit row answers it', () => {
    const g = fixture('v1');
    const withTarget = { ...g, nodes: (g.nodes as Record<string, unknown>[]).map((n) => (n.kind === 'goal' ? { ...n, goal_threshold_raw: 80 } : n)) };
    const paul = 'Overlapping costs are a real risk, as we only have a budget for £200,000, with a £20,000 surplus that is held back for recruitment fees.';
    expect(modelGapOf(withTarget, paul)?.kind).toBe('budget_without_limit');
    expect(modelGapOf({ ...withTarget, goal_constraints: [{ node_id: 'developer_hires', operator: '<=', value: 200000, unit: '£' }] }, paul), 'a money limit answers it').toBeNull();
    // Codex r1 P2: a hiring-count cap is not the budget.
    expect(modelGapOf({ ...withTarget, goal_constraints: [{ node_id: 'developer_hires', operator: '<=', value: 2 }] }, 'Our budget is £200,000.')?.kind).toBe('budget_without_limit');
    expect(modelGapOf(withTarget, 'We need to decide whether to hire a Tech lead or two developers.')).toBeNull();
    expect(modelGapOf(withTarget, 'The budget is tight.')).toBeNull();
  });
  it('GP-4: the budget phrase reads both orders and words for money; it never spans a sentence', () => {
    for (const yes of ['Our budget is $50k.', '£1.2m budget for the year', 'a budget of 200,000 pounds']) expect(STATED_BUDGET.test(yes), yes).toBe(true);
    for (const no of ['Our budget is fixed. We spent £5 on lunch.', 'It costs £40.']) expect(STATED_BUDGET.test(no), no).toBe(false);
  });
});

describe('S-C regex scaling (preamble: 5k→20k, 3 shapes, < 8×, min of 5)', () => {
  const time = (f: () => void): number => { let best = Infinity; for (let i = 0; i < 5; i++) { const t = performance.now(); f(); best = Math.min(best, performance.now() - t); } return best; };
  const shapes: Record<string, (n: number) => string> = {
    spaces: (n) => ' '.repeat(n),
    budgetNoMoney: (n) => 'budget '.repeat(Math.ceil(n / 7)).slice(0, n),
    moneyNoBudget: (n) => '£1 '.repeat(Math.ceil(n / 3)).slice(0, n),
  };
  for (const [name, shape] of Object.entries(shapes)) {
    it(`RX-${name}: STATED_BUDGET and the Add-message parse scale linearly`, () => {
      const small = shape(5_000); const big = shape(20_000);
      const r = (time(() => STATED_BUDGET.test(big)) + 0.05) / (time(() => STATED_BUDGET.test(small)) + 0.05);
      expect(r, `budget ${name}`).toBeLessThan(8);
      // The press never reaches the parse above 600 chars (`widenAddCallOf`); the regex itself is timed unguarded.
      const msg = (s: string) => `Add the risk ‘x’ to ‘o’: driven by more ‘${s}’, it would lower ‘y’.`;
      expect(widenAddCallOf('agent-widen-add:0000000000000000', msg(big), fixture('v1'))).toBeNull();
      const a = (time(() => WIDEN_ADD_MESSAGE.test(msg(big))) + 0.05) / (time(() => WIDEN_ADD_MESSAGE.test(msg(small))) + 0.05);
      expect(a, `add ${name}`).toBeLessThan(8);
    });
  }
});
