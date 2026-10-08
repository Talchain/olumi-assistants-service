/**
 * ⭐ S-C MODEL WIDENING, target risks — the door's pure rows (DL 0fd71f 7 Oct; lane WIDEN; RC `method_turns.RC-WIDEN`).
 *
 * Fixtures are Paul's SERVED prod model (scenario 6582edbc, CEE 7e3f8fb2), reconstructed from the run facts' input
 * snapshots (`fixtures/s-c-widen/*.json`, provenance inside). The risk names in the candidate rows are the ones Olumi
 * served as prose on turns #2 and #12 (forensics D-11): "Recruitment delay", "Wrong bottleneck", "Coordination drag",
 * "Quality trade-off"; "Overlapping costs", "Handover debt", "Offer fallout", "Work cannot be split".
 */
import { describe, expect, it, vi } from 'vitest';
import { scalingRatio } from '../../../../../tests/helpers/scaling-ratio.js';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { assembleGuidanceSignals } from '../../turn-context/guidance-signals.js';
import * as riskTransaction from '../../../routing/add-risk-transaction.js';
import {
  CANVAS_OPTIONS_PRESS_ID, CANVAS_RISKS_PRESS_ID, isWidenAddPressId, modelGapOf, riskAddPressFor, riskGate, riskHeldReply, risksTurnForReadback, risksTurnFromSignals,
  settleRisksTurn, STATED_BUDGET, SUGGEST_RISKS_CHIP, widenAddCallOf, widenTargetOf, WIDEN_PRESS_ID, type RunRisksWidenTurn,
  risksFallbackReply,
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
  { label: 'Coordination drag', category: 'people', mechanism: 'drives', hits_id: 'hire_two_developers', through_id: 'developer_hires', through_direction: 'positive',
    affects_id: 'feature_delivery_capacity', direction: 'negative', relies_on: 'new developers joining without slowing the team', watch_for: 'senior time spent on onboarding' },
  { label: 'Quality trade-off', category: 'cost', mechanism: 'drives', hits_id: 'hire_a_tech_lead', through_id: 'tech_lead_hires', through_direction: 'positive',
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
      { label: 'Overlapping costs', category: 'cost', mechanism: 'drives', hits_id: 'c3d38027', through_id: 'fac_freelance_resource_brought_in', through_direction: 'positive',
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
    const shared = { label: 'Team attrition', category: 'external', mechanism: 'drives', hits_id: 'existing_engineering_team_size', through_id: 'existing_engineering_team_size',
      through_direction: 'negative', affects_id: 'feature_delivery_capacity', direction: 'negative', relies_on: 'the current team staying intact', watch_for: 'a resignation before launch' };
    const settled = settleRisksTurn(turnOn(fixture('v1')), appendix([shared, TURN2[0]]));
    expect(settled.gate.kept.map((r) => [r.label, r.shared])).toEqual([['Recruitment delay', false], ['Team attrition', true]]);
    expect(settled.reply.split('\n')[3]).toBe('- Every option relies on the current team staying intact. Risk: ‘Team attrition’ (outside events), through ‘Existing Engineering Team Size’; it affects every option alike. Watch for: a resignation before launch.');
  });
  it('RG-11: only a driver gets a parent factor; every hit option still really changes the identity-checked through factor', () => {
    const t = turnOn(fixture('v1'));
    for (const r of riskGate(t, TURN2).kept) {
      const call = widenAddCallOf(r.press.id, r.press.message, { graph: fixture('v1') });
      expect(call?.args.caused_by, r.label).toEqual(r.category === 'timing' || r.category === 'dependency'
        ? [] : [{ factor_label: r.through.label, direction: r.through.direction }]);
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
      '- ‘Recruitment delay’: ‘Hire Two Developers’ relies on filling both developer roles quickly. This model can\'t yet apply that risk to that option alone, so the Run leaves it out, and that option\'s chance doesn\'t include it yet.',
      '- ‘Wrong bottleneck’: ‘Hire a Tech Lead’ relies on a Tech Lead removing the main delivery blocker. This model can\'t yet apply that risk to that option alone, so the Run leaves it out, and that option\'s chance doesn\'t include it yet.',
      '- ‘Hire Two Developers’ relies on new developers joining without slowing the team. Risk: ‘Coordination drag’ (people), through ‘Developer Hires’. Watch for: senior time spent on onboarding.',
      'Possible risks, not established facts. Nothing is added until you choose one and approve the change.',
      'What is the deadline for "meet our next feature-launch deadline"? A date or a time from now is fine, for example "6 months"; I\'ll propose it as your deadline.',
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
  it('AP-1: the timing press round-trips to ONE propose_new_risk call with a server-only option stamp and no links', () => {
    const r = first();
    expect(r.press.message).toBe('Add the risk ‘Recruitment delay’ to ‘Hire Two Developers’: that option relies on this not happening. The Run leaves it out until it can apply to that option alone.');
    expect(widenAddCallOf(r.press.id, r.press.message, { graph: v1 })).toEqual({ tool: 'propose_new_risk',
      relies_on: { option_id: 'hire_two_developers', option_label: 'Hire Two Developers' }, args: {
      label: 'Recruitment delay', rationale: 'Olumi suggested this risk (assumption-based planning); the user chose to add it.',
      affects: [],
      caused_by: [],
      whole_request: true,
    } });
  });
  it('AP-2: an edited message, another press\'s id, or an unbounded message is not this press', () => {
    const r = first();
    expect(widenAddCallOf(r.press.id, r.press.message.replace('Recruitment delay', 'Something else'), { graph: v1 })).toBeNull();
    expect(widenAddCallOf('agent-widen-add:0000000000000000', r.press.message, { graph: v1 })).toBeNull();
    expect(widenAddCallOf(r.press.id, `${r.press.message}${' '.repeat(700)}`, { graph: v1 })).toBeNull();
  });
  it('AP-3 (Codex r1 P1): a stale press is refused — its factor renamed and a NEW node given the old name; or the option no longer changes it', () => {
    // This guard concerns a driver label; a precondition's press intentionally does not name its through factor.
    const r = riskGate(turnOn(v1), [TURN2[2]]).kept[0]!;
    const nodes = v1.nodes as Record<string, unknown>[];
    const renamed = { ...v1, nodes: [...nodes.map((n) => (n.id === 'developer_hires' ? { ...n, label: 'Renamed developer count' } : n)),
      { id: 'fac_other', kind: 'factor', label: 'Developer Hires' }] };
    expect(widenAddCallOf(r.press.id, r.press.message, { graph: renamed })).toBeNull();
    const unchanged = { ...v1, nodes: nodes.map((n) => (n.id === 'hire_two_developers'
      ? { ...n, interventions: { ...(n.interventions as Record<string, unknown>), developer_hires: { value: 0, raw_value: 0, unit: 'hires' } } } : n)) };
    expect(widenAddCallOf(r.press.id, r.press.message, { graph: unchanged })).toBeNull();
    // Only the id binding catches this one: what it HURTS was renamed and a new outcome took the old name.
    const outcome = { ...v1, nodes: [...nodes.map((n) => (n.id === 'feature_delivery_capacity' ? { ...n, label: 'Renamed capacity' } : n)),
      { id: 'oc_other', kind: 'outcome', label: 'Feature Delivery Capacity' }],
      edges: [...(v1.edges as Record<string, unknown>[]), { from: 'oc_other', to: 'meet_our_next_feature_launch_deadline', strength: { mean: 0.5, std: 0.1 } }] };
    expect(widenAddCallOf(r.press.id, r.press.message, { graph: outcome })).toBeNull();
    expect(widenAddCallOf(r.press.id, r.press.message, { graph: v1 }), 'CONTROL: the model as offered').not.toBeNull();
  });
  it('AP-4: a shared risk\'s press names no option and is refused once an option starts changing its factor', () => {
    const shared = { label: 'Team attrition', category: 'external', mechanism: 'drives', hits_id: 'existing_engineering_team_size', through_id: 'existing_engineering_team_size',
      through_direction: 'negative', affects_id: 'feature_delivery_capacity', direction: 'negative', relies_on: 'the current team staying intact', watch_for: 'a resignation before launch' };
    const r = riskGate(turnOn(v1), [shared]).kept[0]!;
    expect(r.press.message).toBe('Add the risk ‘Team attrition’ for every option: driven by less ‘Existing Engineering Team Size’, it would lower ‘Feature Delivery Capacity’.');
    expect(widenAddCallOf(r.press.id, r.press.message, { graph: v1 })?.args.caused_by).toEqual([{ factor_label: 'Existing Engineering Team Size', direction: 'negative' }]);
    const moved = { ...v1, nodes: (v1.nodes as Record<string, unknown>[]).map((n) => (n.id === 'hire_two_developers'
      ? { ...n, interventions: { ...(n.interventions as Record<string, unknown>), existing_engineering_team_size: { value: 0.3, raw_value: 9, unit: 'engineers' } } } : n)) };
    expect(widenAddCallOf(r.press.id, r.press.message, { graph: moved })).toBeNull();
  });
  it('AP-5 (Codex r2 P1): an option name with its own ’ still round-trips — the press is reconstructed, never parsed', () => {
    const g = { ...v1, nodes: (v1.nodes as Record<string, unknown>[]).map((n) => (n.id === 'hire_two_developers' ? { ...n, label: 'Don’t outsource hiring' } : n)) };
    const r = riskGate(turnOn(g), [TURN2[0]]).kept[0]!;
    expect(r.press.message).toBe('Add the risk ‘Recruitment delay’ to ‘Don’t outsource hiring’: that option relies on this not happening. The Run leaves it out until it can apply to that option alone.');
    expect(widenAddCallOf(r.press.id, r.press.message, { graph: g })?.args.label).toBe('Recruitment delay');
  });
  it('AP-6 (Codex r2 P2): Suggest and Add read ONE option scope — a risk shared because the only mover is out of the comparison still adds', () => {
    const rb = { graph: v1, optionParticipation: [{ option_id: 'hire_two_developers', state: 'excluded_olumi_proposed' }] };
    const turn = risksTurnForReadback(rb);
    if (turn.kind !== 'run_risks') throw new Error(turn.kind);
    const freeze = { label: 'Hiring freeze', category: 'external', mechanism: 'drives', hits_id: 'developer_hires', through_id: 'developer_hires', through_direction: 'negative',
      affects_id: 'feature_delivery_capacity', direction: 'negative', relies_on: 'hiring staying open', watch_for: 'a freeze announced' };
    const r = riskGate(turn, [freeze]).kept[0]!;
    expect(r.shared).toBe(true);
    expect(widenAddCallOf(r.press.id, r.press.message, rb)?.args.caused_by).toEqual([{ factor_label: 'Developer Hires', direction: 'negative' }]);
    expect(widenAddCallOf(r.press.id, r.press.message, { graph: v1 }), 'CONTROL: with the option back in scope it is no longer shared').toBeNull();
  });
  it('AP-7: EVERY offered Add round-trips on the model it was offered on (served turns #2 and #12, the shared twin)', () => {
    const shared = { label: 'Team attrition', category: 'external', mechanism: 'drives', hits_id: 'existing_engineering_team_size', through_id: 'existing_engineering_team_size',
      through_direction: 'negative', affects_id: 'feature_delivery_capacity', direction: 'negative', relies_on: 'the current team staying intact', watch_for: 'a resignation before launch' };
    const kept = riskGate(turnOn(v1), [...TURN2.slice(0, 2), shared]).kept;
    expect(kept).toHaveLength(3);
    for (const r of kept) expect(widenAddCallOf(r.press.id, r.press.message, { graph: v1 }), r.label).not.toBeNull();
  });
});

describe('S-C standing gap signal: typed, from model state, ONE question', () => {
  const S1_ASK = 'What is the deadline for "meet our next feature-launch deadline"? A date or a time from now is fine, for example "6 months"; I\'ll propose it as your deadline.';
  /** Paul's goal measured as a LEVEL (a quantity): the controls for the target ask. */
  const asLevel = (g: Record<string, unknown>, over: Record<string, unknown> = {}) => ({ ...g, nodes: (g.nodes as Record<string, unknown>[])
    .map((n) => (n.kind === 'goal' ? { ...n, goal_threshold_unit: 'features shipped', ...over } : n)) });
  /** Paul's chance goal holding its date (#2742's carrier, `goal_horizon.deadline`). */
  const chanceWithDate = (g: Record<string, unknown>) => ({ ...g, nodes: (g.nodes as Record<string, unknown>[])
    .map((n) => (n.kind === 'goal' ? { ...n, goal_horizon: { deadline: '2027-04-07' } } : n)) });
  it('GP-1 (PL/Codex 5443200599, joined with #2742 S1): Paul\'s CHANCE goal never gets a target ask — its one question is S1\'s deadline ask, byte for byte', () => {
    expect(modelGapOf(fixture('v1'))).toEqual({ kind: 'deadline_missing', goal_id: 'meet_our_next_feature_launch_deadline', question: S1_ASK });
    expect(JSON.stringify(modelGapOf(fixture('v1')))).not.toContain('What would count as meeting it');
    // Even with a stray target figure on it, a chance goal is asked for its date, never a target.
    const stray = { ...fixture('v1'), nodes: (fixture('v1').nodes as Record<string, unknown>[]).map((n) => (n.kind === 'goal' ? { ...n, goal_threshold_raw: 80 } : n)) };
    expect(modelGapOf(stray)?.kind).toBe('deadline_missing');
    // Holding its date, a chance goal is asked nothing more here (S1: "a chance goal that already holds its date is asked nothing more").
    expect(modelGapOf(chanceWithDate(fixture('v1')))).toBeNull();
  });
  it('GP-2 CONTROL (level/change goals keep the target ask): no target and no deadline → target-and-date; a stated target → nothing; a deadline row drops "by when"', () => {
    const g = fixture('v1');
    expect(modelGapOf(asLevel(g))).toEqual({ kind: 'goal_target_missing', goal_id: 'meet_our_next_feature_launch_deadline', deadline_known: false,
      question: 'One gap: ‘meet our next feature-launch deadline’ has no target or deadline yet. What would count as meeting it, and by when?' });
    expect(modelGapOf(asLevel(g, { goal_threshold_frame: 'change_rel' }))?.kind, 'a change goal is a quantity too').toBe('goal_target_missing');
    expect(modelGapOf(asLevel(g, { goal_threshold_raw: 80 }))).toBeNull();
    const withDeadline = { ...asLevel(g), goal_constraints: [{ node_id: 'meet_our_next_feature_launch_deadline', operator: '<=', value: 6, deadline_metadata: { months: 6 } }] };
    expect(modelGapOf(withDeadline)?.question).toBe('One gap: ‘meet our next feature-launch deadline’ has no target yet. What would count as meeting it?');
  });
  it('GP-3 (D-07, Paul\'s own words at 09:29:58Z): a stated budget with no limit in the model → the budget question; a limit row answers it', () => {
    const paul = 'Overlapping costs are a real risk, as we only have a budget for £200,000, with a £20,000 surplus that is held back for recruitment fees.';
    // Both goal kinds once their own gap is closed: a level goal with its target, Paul's chance goal with its date.
    for (const base of [asLevel(fixture('v1'), { goal_threshold_raw: 80 }), chanceWithDate(fixture('v1'))]) {
      expect(modelGapOf(base, paul)?.kind).toBe('budget_without_limit');
      expect(modelGapOf({ ...base, goal_constraints: [{ node_id: 'developer_hires', operator: '<=', value: 200000, unit: '£' }] }, paul), 'a money limit answers it').toBeNull();
      // Codex r1 P2: a hiring-count cap is not the budget.
      expect(modelGapOf({ ...base, goal_constraints: [{ node_id: 'developer_hires', operator: '<=', value: 2 }] }, 'Our budget is £200,000.')?.kind).toBe('budget_without_limit');
      // Codex r2 P2: an explicit non-money unit decides, whatever the label says.
      const reviewers = { ...base, nodes: (base.nodes as Record<string, unknown>[]).map((n) => (n.id === 'developer_hires' ? { ...n, label: 'Budget reviewers' } : n)),
        goal_constraints: [{ node_id: 'developer_hires', operator: '<=', value: 2, unit: 'people' }] };
      expect(modelGapOf(reviewers, 'Our budget is £200,000.')?.kind).toBe('budget_without_limit');
      expect(modelGapOf(base, 'We need to decide whether to hire a Tech lead or two developers.')).toBeNull();
      expect(modelGapOf(base, 'The budget is tight.')).toBeNull();
    }
    // A chance goal with no date: S1's question outranks the budget one (ONE question).
    expect(modelGapOf(fixture('v1'), paul)?.kind).toBe('deadline_missing');
  });
  it('GP-4: the budget phrase reads both orders and words for money; it never spans a sentence', () => {
    for (const yes of ['Our budget is $50k.', '£1.2m budget for the year', 'a budget of 200,000 pounds']) expect(STATED_BUDGET.test(yes), yes).toBe(true);
    for (const no of ['Our budget is fixed. We spent £5 on lunch.', 'It costs £40.']) expect(STATED_BUDGET.test(no), no).toBe(false);
  });
});

describe('S-C regex scaling (preamble: 5k→40k, 3 shapes, < 22×, min of 7 calibrated batches)', () => {
  const shapes: Record<string, (n: number) => string> = {
    spaces: (n) => ' '.repeat(n),
    budgetNoMoney: (n) => 'budget '.repeat(Math.ceil(n / 7)).slice(0, n),
    moneyNoBudget: (n) => '£1 '.repeat(Math.ceil(n / 3)).slice(0, n),
  };
  for (const [name, shape] of Object.entries(shapes)) {
    it(`RX-${name}: STATED_BUDGET scales linearly; an unbounded Add message is refused before any work`, () => {
      const small = shape(5_000); const big = shape(40_000);
      const m = scalingRatio(() => STATED_BUDGET.test(small), () => STATED_BUDGET.test(big));
      // 8× input, midpoint bar 22: linear ≈ 8×, quadratic ≈ 64×; slow-runner noise cannot cross it; see #2793.
      expect(m.ratio, `budget ${name} ${m.detail}`).toBeLessThan(22);
      // The Add press has no regex: it is reconstructed, and refused above 600 chars before any work.
      expect(widenAddCallOf('agent-widen-add:0000000000000000', `Add the risk ‘x’ to ‘o’: driven by more ‘${big}’, it would lower ‘y’.`, { graph: fixture('v1') })).toBeNull();
    });
  }
});

describe('EVENT-RISK RC3 (a′): a precondition stays on the model with zero links and is left out of the Run', () => {
  const graph = {
    nodes: [
      { id: 'keep_49', kind: 'option', label: 'Keep £49', is_baseline: true, interventions: { pro_plan_price: { value: 49 } } },
      { id: 'raise_59', kind: 'option', label: 'Raise Pro price to £59', interventions: { pro_plan_price: { value: 59 } } },
      { id: 'pro_plan_price', kind: 'factor', label: 'Pro plan price', observed_state: { value: 49, unit: '£' } },
      { id: 'mrr', kind: 'goal', label: 'MRR' },
    ],
    edges: [
      { from: 'keep_49', to: 'pro_plan_price', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive', origin: 'repair' },
      { from: 'pro_plan_price', to: 'mrr', strength: { mean: 0.5, std: 0.1 }, effect_direction: 'positive' },
    ],
  };
  const priceRisk = {
    label: 'Price-driven churn', category: 'cost', hits_id: 'raise_59', through_id: 'pro_plan_price', through_direction: 'positive',
    mechanism: 'drives', affects_id: 'mrr', direction: 'negative', relies_on: 'customers accepting the higher price', watch_for: 'cancellations after the price rise',
  };
  const pressSuggestion = {
    label: 'Price-driven churn',
    hits: { id: 'raise_59', label: 'Raise Pro price to £59', kind: 'option' as const },
    through: { id: 'pro_plan_price', label: 'Pro plan price', direction: 'positive' as const },
    affects: { id: 'mrr', label: 'MRR', direction: 'negative' as const },
  };

  it('rc3-validator-dependency: the validator overrides a model-supplied driver for a dependency', () => {
    const turn = turnOn(graph);
    expect(turn.options.map((o) => o.id)).toEqual(['raise_59']);
    const gate = riskGate(turn, [{ ...priceRisk, label: 'Payment provider fails', category: 'dependency',
      relies_on: 'the payment provider staying available', watch_for: 'payment requests failing' }]);
    expect(gate.dropped).toEqual([]);
    expect(gate.kept).toHaveLength(1);
    const r = gate.kept[0]!;
    expect(r).toMatchObject({ mechanism: 'relies_on' });
    expect(r.press.message).toBe('Add the risk ‘Payment provider fails’ to ‘Raise Pro price to £59’: that option relies on this not happening. The Run leaves it out until it can apply to that option alone.');
    expect(r.press.message).not.toContain('driven by');
    expect(widenAddCallOf(r.press.id, r.press.message, { graph })).toMatchObject({
      relies_on: { option_id: 'raise_59', option_label: 'Raise Pro price to £59' }, args: { caused_by: [], affects: [] },
    });
  });

  it('rc3-missing-mechanism: an otherwise grounded cost risk fails closed to a precondition', () => {
    const { mechanism: _mechanism, ...missing } = priceRisk;
    const gate = riskGate(turnOn(graph), [missing]);
    expect(gate.dropped).toEqual([]);
    expect(gate.kept).toHaveLength(1);
    const r = gate.kept[0]!;
    expect(r).toMatchObject({ mechanism: 'relies_on' });
    expect(r.press.message).not.toContain('driven by');
    expect(widenAddCallOf(r.press.id, r.press.message, { graph })?.args.caused_by).toEqual([]);
  });

  it.each(['unknown', null, true, 7, {}])('rc3-invalid-mechanism: %j fails closed without losing the grounded item', (mechanism) => {
    const gate = riskGate(turnOn(graph), [{ ...priceRisk, mechanism }]);
    expect(gate.dropped).toEqual([]);
    expect(gate.kept).toHaveLength(1);
    const r = gate.kept[0]!;
    expect(r).toMatchObject({ mechanism: 'relies_on' });
    expect(widenAddCallOf(r.press.id, r.press.message, { graph })?.args.caused_by).toEqual([]);
  });

  it('rc3-schema-stays-strict: normalizing an invalid mechanism cannot admit an unrelated unknown key', () => {
    expect(riskGate(turnOn(graph), [{ ...priceRisk, mechanism: 'unknown', extra_model_claim: 'unsupported' }]).dropped)
      .toEqual([{ index: 0, failed: ['RK-SCHEMA'] }]);
  });

  it('rc3-drives-control: a genuine cost driver keeps the factor attachment and byte-identical press wording', () => {
    const gate = riskGate(turnOn(graph), [priceRisk]);
    expect(gate.dropped).toEqual([]);
    expect(gate.kept).toHaveLength(1);
    const r = gate.kept[0]!;
    expect(r).toMatchObject({ mechanism: 'drives' });
    expect(r.press.message).toBe('Add the risk ‘Price-driven churn’ to ‘Raise Pro price to £59’: driven by more ‘Pro plan price’, it would lower ‘MRR’.');
    expect(widenAddCallOf(r.press.id, r.press.message, { graph })).toEqual({ tool: 'propose_new_risk', args: {
      label: 'Price-driven churn', rationale: 'Olumi suggested this risk (assumption-based planning); the user chose to add it.',
      affects: [{ target_label: 'MRR', direction: 'negative' }], caused_by: [{ factor_label: 'Pro plan price', direction: 'positive' }], whole_request: true,
    } });
    expect(settleRisksTurn(turnOn(graph), appendix([priceRisk])).reply.split('\n')[2])
      .toBe('- ‘Raise Pro price to £59’ relies on customers accepting the higher price. Risk: ‘Price-driven churn’ (cost), through ‘Pro plan price’. Watch for: cancellations after the price rise.');
    const call = widenAddCallOf(r.press.id, r.press.message, { graph })!;
    expect(riskHeldReply(call)).toBe('I’ve prepared this change: add the risk ‘Price-driven churn’, driven by more ‘Pro plan price’; it would lower ‘MRR’. How strongly is not known yet. Nothing is added until you approve it.');
  });

  it('rc3-press-id-binds-mechanism: a drives id cannot replay the relies_on message, or the reverse', () => {
    const drives = riskAddPressFor({ ...pressSuggestion, mechanism: 'drives' as const });
    const relies = riskAddPressFor({ ...pressSuggestion, mechanism: 'relies_on' as const });
    expect(drives.id).not.toBe(relies.id);
    expect(drives.message).not.toBe(relies.message);
    for (const [press, mechanism] of [[drives, 'drives'], [relies, 'relies_on']] as const) {
      const hash = createHash('sha256').update(JSON.stringify([press.message, 'raise_59', 'pro_plan_price', 'mrr', mechanism]), 'utf8').digest('hex').slice(0, 16);
      expect(press.id).toBe(`agent-widen-add:${hash}`);
    }
    expect(widenAddCallOf(drives.id, relies.message, { graph })).toBeNull();
    expect(widenAddCallOf(relies.id, drives.message, { graph })).toBeNull();
    expect(widenAddCallOf(drives.id, drives.message, { graph })?.args.caused_by).toEqual([{ factor_label: 'Pro plan price', direction: 'positive' }]);
    expect(widenAddCallOf(relies.id, relies.message, { graph })?.args.caused_by).toEqual([]);
  });

  it('rc3-relies-on-door-links: RK-DOOR validates a server-stamped risk with zero links (M2)', () => {
    const builder = vi.spyOn(riskTransaction, 'buildAddRiskTransaction');
    try {
      // Missing mechanism already passes the old schema, so this isolates RK-DOOR's links on the unmodified code.
      const { mechanism: _mechanism, ...missing } = priceRisk;
      expect(riskGate(turnOn(graph), [missing]).kept).toHaveLength(1);
      expect(builder).toHaveBeenCalledTimes(1);
      expect(builder).toHaveBeenCalledWith({ risk: { label: 'Price-driven churn' }, links: [] }, expect.anything(), { option_id: 'raise_59' });
    } finally {
      builder.mockRestore();
    }
  });

  it('rc3-relies-on-through-direction: an irrelevant through direction cannot change the press id or door call', () => {
    const positive = riskAddPressFor({ ...pressSuggestion, mechanism: 'relies_on' as const });
    const negative = riskAddPressFor({ ...pressSuggestion, mechanism: 'relies_on' as const,
      through: { ...pressSuggestion.through, direction: 'negative' as const } });
    expect(positive).toEqual(negative);
    expect(widenAddCallOf(positive.id, positive.message, { graph })?.args.caused_by).toEqual([]);
  });

  it('rc3-relies-on-factor-identity: replacing the through factor id refuses the old press even though its words are unchanged', () => {
    const candidate = { ...priceRisk, mechanism: 'relies_on' };
    const r = riskGate(turnOn(graph), [candidate]).kept[0]!;
    expect(r.press.message).not.toContain('Pro plan price');
    expect(widenAddCallOf(r.press.id, r.press.message, { graph })?.args.caused_by).toEqual([]);
    const replacementId = 'replacement_price';
    const renamedId = (id: string): string => id === 'pro_plan_price' ? replacementId : id;
    const rewired = {
      ...graph,
      nodes: graph.nodes.map((n) => ({
        ...n,
        id: renamedId(n.id),
        ...(n.interventions !== undefined ? { interventions: Object.fromEntries(Object.entries(n.interventions).map(([id, value]) => [renamedId(id), value])) } : {}),
      })),
      edges: graph.edges.map((e) => ({ ...e, from: renamedId(e.from), to: renamedId(e.to) })),
    };
    const fresh = riskGate(turnOn(rewired), [{ ...candidate, through_id: replacementId }]).kept[0]!;
    expect(fresh.press.message).toBe(r.press.message);
    expect(fresh.press.id).not.toBe(r.press.id);
    expect(widenAddCallOf(r.press.id, r.press.message, { graph: rewired })).toBeNull();
    expect(widenAddCallOf(fresh.press.id, fresh.press.message, { graph: rewired })?.args.caused_by).toEqual([]);
  });

  it('rc3-paul-known-answer-words: a timing dependency names the one option whose chance leaves it out (M1)', () => {
    const settled = settleRisksTurn(turnOn(graph), appendix([{ ...priceRisk, label: 'Feature release slips', category: 'timing',
      through_direction: 'negative', relies_on: 'the feature release', watch_for: 'release date moves' }]));
    expect(settled.gate.kept).toHaveLength(1);
    const r = settled.gate.kept[0]!;
    expect(r.mechanism).toBe('relies_on');
    expect(r.press.message).toBe('Add the risk ‘Feature release slips’ to ‘Raise Pro price to £59’: that option relies on this not happening. The Run leaves it out until it can apply to that option alone.');
    const call = widenAddCallOf(r.press.id, r.press.message, { graph });
    expect(call).toEqual({ tool: 'propose_new_risk', relies_on: { option_id: 'raise_59', option_label: 'Raise Pro price to £59' }, args: {
      label: 'Feature release slips', rationale: 'Olumi suggested this risk (assumption-based planning); the user chose to add it.',
      caused_by: [], affects: [], whole_request: true,
    } });
    expect(call?.args).not.toHaveProperty('relies_on');
    expect(settled.reply.split('\n')[2]).toBe('- ‘Feature release slips’: ‘Raise Pro price to £59’ relies on the feature release. This model can\'t yet apply that risk to that option alone, so the Run leaves it out, and that option\'s chance doesn\'t include it yet.');
    expect(settled.reply).not.toContain('through ‘Pro plan price’');
    expect(settled.reply).not.toContain('affects every option alike');
    expect(settled.reply).not.toContain('doesn\'t change the comparison');
  });

  it('hotfix-rk-schema: a precondition item WITHOUT through_direction (as the #2803 directive asks) is kept, not RK-SCHEMA (served ced778c4: 2/2 turns dropped every item)', () => {
    const { through_direction: _td, ...noDirection } = { ...priceRisk, label: 'Feature release slips', category: 'timing',
      mechanism: 'relies_on', through_direction: 'negative', relies_on: 'the feature release', watch_for: 'release date moves' };
    const settled = settleRisksTurn(turnOn(graph), appendix([noDirection]));
    expect(settled.gate.dropped).toEqual([]);
    expect(settled.gate.kept.map((r) => [r.label, r.mechanism])).toEqual([['Feature release slips', 'relies_on']]);
    expect(widenAddCallOf(settled.gate.kept[0]!.press.id, settled.gate.kept[0]!.press.message, { graph })?.args.caused_by).toEqual([]);
  });

  it('hotfix-drives-needs-direction: a "drives" item without a direction is a precondition, never an invented driver', () => {
    const { through_direction: _td, ...noDirection } = { ...priceRisk, label: 'Payment provider fails', category: 'cost',
      mechanism: 'drives', through_direction: 'positive', relies_on: 'the payment provider', watch_for: 'failed card payments' };
    const r = riskGate(turnOn(graph), [noDirection]).kept[0]!;
    expect(r.mechanism).toBe('relies_on');
    expect(r.press.message).not.toContain('driven by');
  });

  it('hotfix-shared-precondition-said: a refused shared precondition is SAID in the reply, never silence (DL 8 Oct)', () => {
    const shared = { label: 'Team attrition', category: 'external', hits_id: 'existing_engineering_team_size', through_id: 'existing_engineering_team_size',
      mechanism: 'relies_on', affects_id: 'feature_delivery_capacity', direction: 'positive',
      relies_on: 'the current team staying intact', watch_for: 'a resignation before launch' };
    const settled = settleRisksTurn(turnOn(fixture('v1')), appendix([shared]));
    expect(settled.offered).toBe(0);
    expect(settled.gate.shared_preconditions).toEqual([{ label: 'Team attrition', category: 'external', relies_on: 'the current team staying intact' }]);
    expect(settled.reply).toContain("- Every option relies on the current team staying intact. Risk: ‘Team attrition’ (outside events). This model can't yet hold a precondition that every option shares, so I haven't offered to add it.");
    expect(settled.reply).not.toBe(risksFallbackReply(turnOn(fixture('v1'))));
    expect(settled.actions.map((a) => a.id)).toEqual(['agent-talk-it-through']);
  });

  it('rc3-shared-precondition: a shared relies_on item is refused because it has no option identity to stamp', () => {
    const shared = { label: 'Team attrition', category: 'external', hits_id: 'existing_engineering_team_size', through_id: 'existing_engineering_team_size',
      through_direction: 'negative', mechanism: 'relies_on', affects_id: 'feature_delivery_capacity', direction: 'positive',
      relies_on: 'the current team staying intact', watch_for: 'a resignation before launch' };
    const settled = settleRisksTurn(turnOn(fixture('v1')), appendix([shared]));
    expect(settled.gate.kept).toEqual([]);
    expect(settled.gate.dropped).toEqual([{ index: 0, failed: ['RK-SHARED-PRECONDITION'] }]);
    expect(settled.offered).toBe(0);
    expect(settled.actions.map((a) => a.id)).toEqual(['agent-talk-it-through']);
    expect(riskGate(turnOn(fixture('v1')), [{ ...shared, through_direction: 'positive' }]).dropped)
      .toEqual([{ index: 0, failed: ['RK-SHARED-PRECONDITION'] }]);
    const minted = riskAddPressFor({ label: shared.label, mechanism: 'relies_on',
      hits: { id: shared.hits_id, label: 'Existing Engineering Team Size', kind: 'factor' },
      through: { id: shared.through_id, label: 'Existing Engineering Team Size', direction: 'negative' },
      affects: { id: shared.affects_id, label: 'Feature Delivery Capacity', direction: 'positive' } });
    expect(widenAddCallOf(minted.id, minted.message, { graph: fixture('v1') })).toBeNull();
  });

  it('rc3-held-reply-no-driver: a server-stamped risk says why the Run leaves it out, with zero links', () => {
    const call = { tool: 'propose_new_risk' as const, relies_on: { option_id: 'raise_59', option_label: 'Raise Pro price to £59' },
      args: { label: 'Feature release slips', rationale: 'The user chose to add this risk.', caused_by: [], affects: [], whole_request: true as const } };
    expect(() => riskHeldReply(call)).not.toThrow();
    const reply = riskHeldReply(call);
    expect(reply).toBe('I’ve prepared this change: add the risk ‘Feature release slips’ to ‘Raise Pro price to £59’. The Run leaves it out because this model can\'t yet apply that risk to that option alone, so that option\'s chance doesn\'t include it yet. Nothing is added until you approve it.');
    expect(reply).not.toContain('driven by');
    expect(reply).not.toContain('affects every option alike');
  });
});
