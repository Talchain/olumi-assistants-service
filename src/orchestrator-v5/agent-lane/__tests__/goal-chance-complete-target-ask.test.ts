/** W5 DL round 2: never ask for only a subset of what the goal chance needs. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  GOAL_CHANCE_WITHHELD_NOTE,
  PLACEHOLDER_PATH_NOTE,
  TARGET_ONLY_NOTE,
  goalChanceLineOwed,
  goalChanceSayFromThisTurn,
  goalChanceWithheldForAgent,
} from '../goal-chance-withheld.js';
import { targetLevelOnlyQuestion, targetNotTestableWarning, targetTestabilityOf } from '../../admission/target-testability.js';
import { guidedSizingActions, guidedSizingForRun } from '../guided-sizing.js';
import { linkEffectEndUnits } from '../../system-events/link-effect-edit.js';

interface Warning {
  code: string;
  message: string;
  say?: string;
  node_ids?: string[];
  option_ids?: string[];
  links?: { from: string; to: string }[];
  acceptable_links?: { from: string; to: string }[];
  level_only_say?: string;
  withheld_claims?: string[];
  win_shares_withheld?: boolean;
}
interface CapturedRun {
  analysis_result: { type: string; enrichment: { inference_warnings: Warning[] } };
  graph?: unknown;
}
const fixture = (file: string): CapturedRun => {
  const captured = JSON.parse(readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf8')) as CapturedRun;
  // Older captures predate this warning's acceptable_links carrier. Preserve the capture and project its list into
  // today's typed carrier in these composition-only rows; the current producer/ONE-LIST rows use served draw-2 below.
  for (const warning of captured.analysis_result.enrichment.inference_warnings) {
    if (warning.code === 'GOAL_FIGURES_PLACEHOLDER_PATH' && warning.acceptable_links === undefined) warning.acceptable_links = warning.links;
  }
  return captured;
};
const OPENING = 'This run doesn’t yet show each option’s chance of meeting your goal.';
const PLACEHOLDER = 'GOAL_FIGURES_PLACEHOLDER_PATH';
const TARGET = 'GOAL_FIGURES_TARGET_NOT_TESTABLE';
// DL r14 changes the invitation only when placeholders are the complete cause set.
const GUIDED_TWO_HEADER = "The chance isn't shown yet: the model doesn't yet say how strongly ‘Monthly churn’ affects ‘Paying Pro subscribers’ or how strongly ‘Pro plan price’ affects ‘MRR lost to price sensitivity’, so any figure would be a guess.";
const GUIDED_TWO = "The chance isn't shown yet: the model doesn't yet say how strongly ‘Monthly churn’ affects ‘Paying Pro subscribers’ or how strongly ‘Pro plan price’ affects ‘MRR lost to price sensitivity’, so any figure would be a guess. Give a rough strength for each to see the chance.";
const rows = [
  { name: 'Run 1: two placeholder links, five target links', captured: fixture('served-item3-run1-placeholder-target.json'), placeholderCount: 2, more: 'and 2 more.',
    header: "The chance isn't shown yet: the model doesn't yet say how strongly ‘Online booking rollout disruption’ affects ‘Monthly booked appointments’ or how strongly ‘Online booking availability’ affects ‘Online booking rollout disruption’, so any figure would be a guess.",
    guided: "The chance isn't shown yet: the model doesn't yet say how strongly ‘Online booking rollout disruption’ affects ‘Monthly booked appointments’ or how strongly ‘Online booking availability’ affects ‘Online booking rollout disruption’, so any figure would be a guess. Give a rough strength for each to see the chance." },
  { name: 'Run 2: one placeholder link, four target links', captured: fixture('served-item3-run2-placeholder-target.json'), placeholderCount: 1, more: 'and 1 more.',
    header: "The chance isn't shown yet: the model doesn't yet say how strongly ‘Online booking rollout disruption’ affects ‘Monthly booked appointments’, so any figure would be a guess.",
    guided: "The chance isn't shown yet: the model doesn't yet say how strongly ‘Online booking rollout disruption’ affects ‘Monthly booked appointments’, so any figure would be a guess. Give a rough strength for it to see the chance." },
];

describe.each(rows)('W5 witnessed $name', ({ captured, placeholderCount, more, header, guided }) => {
  const block = captured.analysis_result;
  const warnings = block.enrichment.inference_warnings;
  const placeholder = warnings.find((w) => w.code === PLACEHOLDER)!;
  const target = warnings.find((w) => w.code === TARGET)!;
  // The unknown legacy cause set keeps its separate recorded target requirement byte-for-byte.
  const complete = `${target.say!} ${header}`;

  it('PRECONDITION: the captured wire carries both warnings with distinct claim and option scopes', () => {
    expect(warnings.map((w) => w.code)).toEqual(['FACTOR_EVPPI_NOT_COMPUTED', PLACEHOLDER, TARGET]);
    expect(placeholder.links).toHaveLength(placeholderCount);
    expect(placeholder.win_shares_withheld).toBe(true);
    expect(placeholder.option_ids).toEqual(['online_booking_system']);
    expect(target.withheld_claims).toEqual(['goal_probability', 'joint_probability', 'outcome', 'downside']);
    expect(target.option_ids).toEqual(['second_receptionist', 'extended_evening_hours', 'continue_current_operations']);
    expect(target.say).toContain(more);
  });

  it('R13 RED: a legacy mixed Run keeps the complete target requirement, beyond its placeholder subset', () => {
    const chance = goalChanceWithheldForAgent(block)!;
    expect(chance.say).toBe(complete);
    expect(chance.say).toContain('from Receptionist headcount to Monthly booked appointments');
    expect(chance.say).toContain('from Online booking availability to Monthly booked appointments');
    expect(chance.say).toContain('from Additional evening opening hours to Monthly booked appointments');
    expect(chance.say).toContain(more);
    expect(chance.say).not.toContain('Give a rough strength');
    // The target-only warning kept shares, but the mixed run did not. Keep the mixed licence and scope.
    expect(chance.note).toBe(GOAL_CHANCE_WITHHELD_NOTE);
    expect(chance.option_ids).toBeUndefined();
    expect(chance.node_ids).toEqual(placeholder.node_ids);
  });

  it('placeholder alone: r14 names one or two pairs with the invitation, keeping note and scope', () => {
    expect(goalChanceWithheldForAgent({ enrichment: { inference_warnings: [placeholder] } })).toEqual({
      withheld: true, say: guided, node_ids: placeholder.node_ids,
      note: PLACEHOLDER_PATH_NOTE, option_ids: placeholder.option_ids,
    });
  });

  it('CONTROL: target alone keeps its own words and target-only licence', () => {
    expect(goalChanceWithheldForAgent({ enrichment: { inference_warnings: [target] } })).toEqual({
      withheld: true, say: target.say, node_ids: target.node_ids, note: TARGET_ONLY_NOTE,
    });
  });

  it('RED at base: warning order and the stored top-level holder keep the complete ask', () => {
    expect(goalChanceWithheldForAgent({ enrichment: { inference_warnings: [...warnings].reverse() } })?.say).toBe(complete);
    expect(goalChanceWithheldForAgent({ inference_warnings: warnings })?.say).toBe(complete);
    expect(goalChanceWithheldForAgent({ ...block, inference_warnings: warnings })?.say).toBe(complete);
  });

  it('RED at base: speaking only the placeholder subset still owes the target requirement', () => {
    const run = { ran: true, goal_chance: goalChanceWithheldForAgent(block) };
    expect(goalChanceLineOwed([run], placeholder.message)).toBe(complete);
    expect(goalChanceLineOwed([run], `${OPENING} ${placeholder.message}`)).toBe(complete);
  });

  it('RED at base: the complete requirement is owed once, including a build first-pass holder', () => {
    const run = { ran: true, goal_chance: goalChanceWithheldForAgent(block) };
    expect(goalChanceLineOwed([run], complete)).toBeNull();
    expect(goalChanceLineOwed([run], target.say!)).toBe(complete);
    expect(goalChanceSayFromThisTurn([{ first_analysis: run }])).toBe(complete);
    expect(goalChanceSayFromThisTurn([run, { ran: true }])).toBeNull();
  });

  it('RED at base: older warning words without say still disclose the complete requirement via message', () => {
    const { say: _say, ...withoutSay } = target;
    const older = warnings.map((w) => w.code === TARGET ? withoutSay : w);
    expect(goalChanceWithheldForAgent({ enrichment: { inference_warnings: older } })?.say)
      .toBe(`${target.message.replace(/^Not shown\.\s*/, '')} ${header}`);
  });
});

it('independent identity reasons remain beside the complete target ask, under the mixed licence', () => {
  const identityRun = fixture('served-416-draw6-b501eda4.json');
  const identity = identityRun.analysis_result.enrichment.inference_warnings.find((w) => w.code === 'GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED')!;
  const warnings = rows[0]!.captured.analysis_result.enrichment.inference_warnings;
  const chance = goalChanceWithheldForAgent({ enrichment: { inference_warnings: [...warnings, identity] } })!;
  const target = warnings.find(w => w.code === TARGET)!;
  expect(chance.say).toBe(`${identity.message.replace(/^Not shown\.\s*/, '')} ${target.say!} ${rows[0]!.header}`);
  expect(chance.say).not.toContain('Give a rough strength');
  expect(chance.note).toBe(GOAL_CHANCE_WITHHELD_NOTE);
  expect(chance.node_ids).toEqual([...new Set(warnings.concat(identity).flatMap((w) => w.node_ids ?? []))]);
});

describe('R2 DL composition: draw-2 level ask before the ONE guided list', () => {
  const draw2 = fixture('guided-sizing-draw2.json');
  const warnings = draw2.analysis_result.enrichment.inference_warnings.filter(w => [PLACEHOLDER, TARGET].includes(w.code));
  const target = warnings.find(w => w.code === TARGET)!;
  const LEVEL_ONLY = "What's today's level of MRR?";
  const COMPLETE = `${LEVEL_ONLY} ${GUIDED_TWO_HEADER}`;

  it('R13 RED: a stored missing-level ask is retained without a sizing promise or a repeated list clause', () => {
    expect(warnings.map(w => w.code)).toEqual([PLACEHOLDER, TARGET]);
    expect(target.say).toContain(LEVEL_ONLY);
    expect(target.say).toContain('a size for the links from');
    const chance = goalChanceWithheldForAgent({ enrichment: { inference_warnings: warnings } }, draw2.graph)!;
    expect(chance.say).toBe(COMPLETE);
    expect(chance.say).not.toContain('a size for the links from');
    expect(chance.say).not.toContain('Give a rough strength');
    expect(goalChanceLineOwed([{ ran: true, goal_chance: chance }], GUIDED_TWO)).toBe(COMPLETE);
  });

  it('R2 RED: current target producer carries level_only_say from its existing parts, minus its link clause', () => {
    // r9 class (ii) setup repair: the confirmed draw-2 graph already holds both operand levels.
    // Remove one level only in this missing-level scenario; preserve both exact wording assertions.
    const graph = structuredClone(draw2.graph) as { nodes: { id: string; observed_state?: unknown }[] };
    graph.nodes.find(n => n.id === 'paying_pro_subscribers')!.observed_state = null;
    const warning = targetNotTestableWarning(graph, targetTestabilityOf(graph), [], TARGET) as Warning;
    expect(warning.level_only_say).toBe(LEVEL_ONLY);
    const chance = goalChanceWithheldForAgent({ enrichment: { inference_warnings: [warnings[0], warning] } }, graph)!;
    expect(chance.say).toContain(LEVEL_ONLY);
    expect(chance.say).toContain("I need today's level");
    expect(chance.say).toContain(GUIDED_TWO_HEADER);
    expect(chance.say).not.toContain('Give a rough strength');
  });

  it('r9 CONTROL: the original confirmed draw-2 product derives its level and asks only for its unsized links', () => {
    const warning = targetNotTestableWarning(draw2.graph, targetTestabilityOf(draw2.graph), [], TARGET) as Warning;
    expect(warning.level_only_say).toBeUndefined();
    expect(goalChanceWithheldForAgent({ enrichment: { inference_warnings: [warnings[0], warning] } }, draw2.graph)?.say).toBe(GUIDED_TWO);
  });

  it('R2 producer: target-derived scale keeps the existing unit-qualified level-only question verbatim', () => {
    expect(targetLevelOnlyQuestion(draw2.graph, { kind: 'not_testable', goal_id: 'mrr',
      failures: [{ precondition: 'P4', case: 'd', code: 'threshold_off_scale' }] }))
      .toBe("What's today's level of MRR, in £/month?");
  });

  it('R2 CONTROL: derived level/no TARGET_NOT_TESTABLE → only guided words, with no level ask', () => {
    const placeholder = warnings.filter(w => w.code === PLACEHOLDER);
    const chance = goalChanceWithheldForAgent({ enrichment: { inference_warnings: placeholder } }, draw2.graph)!;
    expect(chance.say).toBe(GUIDED_TWO);
    expect(chance.say).not.toContain("What's today's level");
  });
});

describe('R13 exact cause-set contrast beside two placeholder presses', () => {
  type Graph = { nodes: Record<string, any>[]; edges: Record<string, any>[] };
  const draw2 = fixture('guided-sizing-draw2.json');
  const placeholder = draw2.analysis_result.enrichment.inference_warnings.find(w => w.code === PLACEHOLDER)!;
  const current = (graph: Graph): { enrichment: { inference_warnings: Warning[] } } => {
    const target = targetNotTestableWarning(graph, targetTestabilityOf(graph), [], TARGET) as Warning | null;
    return { enrichment: { inference_warnings: [placeholder, ...(target === null ? [] : [{ ...target,
      withheld_claims: ['goal_probability', 'outcome', 'win_share'] }])] } };
  };
  const clone = (): Graph => structuredClone(draw2.graph) as Graph;

  it('R13 CONTROL: exactly the two placeholder links retain the guided promise', () => {
    const graph = clone(); const run = current(graph);
    const verdict = targetTestabilityOf(graph);
    expect(verdict).toMatchObject({ kind: 'not_testable', failures: [{ code: 'goal_path_placeholder' }] });
    expect(guidedSizingForRun(run, graph)?.total).toBe(2);
    expect(goalChanceWithheldForAgent(run, graph)?.say).toBe(GUIDED_TWO);
  });

  it('R13 RED: comparator plus placeholders keeps the capability gap and makes no sizing promise', () => {
    const graph = clone(); const goal = graph.nodes.find(n => n.id === 'mrr')!;
    goal.goal_direction = '<'; delete goal.goal_threshold;
    const run = current(graph);
    expect(targetTestabilityOf(graph)).toMatchObject({ kind: 'not_testable', failures: [
      { code: 'comparator_unscorable' }, { code: 'goal_path_placeholder' },
    ] });
    expect(guidedSizingForRun(run, graph)?.total).toBe(2);
    const chance = goalChanceWithheldForAgent(run, graph)!;
    expect(chance.say).toContain("can't yet test a '< £20,000 / month' target");
    expect(chance.say).toContain(GUIDED_TWO_HEADER);
    expect(chance.say).not.toContain('Give a rough strength');
  });

  it('R13 RED: identity_unconfirmed plus placeholders keeps the other links and makes no sizing promise', () => {
    const graph = clone(); const goal = graph.nodes.find(n => n.id === 'mrr')!;
    goal.nonlinear_identity.stated_in_brief = false;
    goal.observed_state = { baseline: 0.49, value: 0.49, raw_value: 12250, unit: '£/month' };
    const run = current(graph);
    expect(targetTestabilityOf(graph)).toMatchObject({ kind: 'not_testable', failures: [{ code: 'identity_unconfirmed' }] });
    expect(guidedSizingForRun(run, graph)?.total).toBe(2);
    const chance = goalChanceWithheldForAgent(run, graph)!;
    expect(chance.say).toContain('from Pro plan price to MRR');
    expect(chance.say).toContain('from Paying Pro subscribers to MRR');
    expect(chance.say).toContain(GUIDED_TWO_HEADER);
    expect(chance.say).not.toContain('Give a rough strength');
  });

  it('R13 RED: a refused Olumi conversion remains a separate cause beside the two placeholders', () => {
    const graph = clone(); const edge = graph.edges.find(e => e.from === 'pro_plan_price' && e.to === 'monthly_churn')!;
    delete edge.provenance.natural_effect;
    const run = current(graph); const draft = guidedSizingForRun(run, graph)!;
    expect(draft.total).toBe(2);
    expect(draft.links.some(l => l.nonconverting === true && l.from === 'pro_plan_price' && l.to === 'monthly_churn')).toBe(true);
    const chance = goalChanceWithheldForAgent(run, graph)!;
    expect(chance.say).toContain("Olumi has it as a band, which can't be turned into your goal's units.");
    expect(chance.say).toContain(GUIDED_TWO_HEADER);
    expect(chance.say).not.toContain('Roughly how much');
    expect(chance.say).not.toContain('a size for the links from');
    expect(chance.say).not.toContain('Give a rough strength');
  });
});

describe('R13 residual causes retain their words without a guided promise', () => {
  const RAW_HEADER = "The chance isn't shown yet: the model doesn't yet say how strongly ‘Price’ affects ‘Churn’ or how strongly ‘Churn’ affects ‘Goal’, so any figure would be a guess.";
  const RAW_GUIDED = "The chance isn't shown yet: the model doesn't yet say how strongly ‘Price’ affects ‘Churn’ or how strongly ‘Churn’ affects ‘Goal’, so any figure would be a guess. Give a rough strength for each to see the chance.";
  const rawPlaceholder: Warning = { code: PLACEHOLDER, message: `Not shown. ${RAW_GUIDED}`,
    acceptable_links: [{ from: 'price', to: 'churn' }, { from: 'churn', to: 'goal' }] };
  const cut = { code: 'GOAL_FIGURES_USER_EFFECT_CLAMPED', node_ids: ['paying_subscribers', 'mrr'],
    message: "Not shown. Your size for how ‘Paying subscribers’ moves ‘MRR’ is bigger than this model's scale can hold, so the run couldn't use it at full size, and the figures that depend on it would be wrong." };
  const identical = { code: 'GOAL_FIGURES_OPTIONS_IDENTICAL', option_ids: ['carry_on', 'hire_two'],
    message: 'Not shown. On your current model, Hire Two comes out the same as Carry On, so the comparison is held back. What would make them differ?' };

  it.each([cut, identical])('R13 residual RED: a graph-less raw generated placeholder sentence never promises beside $code', other => {
    const chance = goalChanceWithheldForAgent({ enrichment: { inference_warnings: [rawPlaceholder, other] } })!;
    expect(chance.say).toContain(other.message.replace(/^Not shown\.\s*/, ''));
    expect(chance.say).not.toContain('Give a rough strength');
    expect(chance.say).toContain(RAW_HEADER);
  });

  it('R14 residual CONTROL: graph-less exact placeholder cause retains the named-pair invitation', () => {
    expect(goalChanceWithheldForAgent({ enrichment: { inference_warnings: [rawPlaceholder] } })?.say).toBe(RAW_GUIDED);
  });

  it('R13 residual RED: N=0 bands exhausted by identity_unconfirmed stay suppressed while its reason remains', () => {
    const links = [{ from: 'price', to: 'goal' }, { from: 'subscribers', to: 'goal' }];
    const graph = { nodes: [
      { id: 'option', kind: 'option', label: 'Raise price', interventions: { price: 0.6, subscribers: 0.5 } },
      { id: 'price', kind: 'factor', label: 'Price', observed_state: { value: 0.5, raw_value: 5, unit: '£/subscriber/month' } },
      { id: 'subscribers', kind: 'factor', label: 'Subscribers', observed_state: { value: 0.5, raw_value: 100, unit: 'subscribers' } },
      { id: 'goal', kind: 'goal', label: 'MRR', observed_state: { value: 0.4, baseline: 0.4, raw_value: 500, unit: '£/month' },
        goal_threshold: 0.8, goal_threshold_raw: 1000, goal_threshold_unit: '£/month', goal_direction: '>=',
        nonlinear_identity: { operation: 'product', factor_ids: ['price', 'subscribers'], stated_in_brief: false } },
    ], edges: [
      { from: 'option', to: 'price' }, { from: 'option', to: 'subscribers' },
      ...links.map((l, index) => ({ ...l, id: `band-${index}`, strength: { mean: 0.5, std: 0.125 },
        provenance: { magnitude: 'olumi_estimate' } })),
    ] };
    const verdict = targetTestabilityOf(graph);
    expect(verdict).toMatchObject({ kind: 'not_testable', failures: [{ code: 'identity_unconfirmed', links }] });
    const target = targetNotTestableWarning(graph, verdict, ['option'], TARGET) as Warning;
    expect(target.option_ids).toEqual(['option']);
    const run = { enrichment: { inference_warnings: [{ ...target,
      withheld_claims: ['goal_probability', 'outcome'] }] } };
    const draft = guidedSizingForRun(run, graph);
    expect(draft?.total).toBe(0);
    expect(draft?.links).toHaveLength(2);
    expect(guidedSizingActions(draft, graph)).toEqual([]);
    const chance = goalChanceWithheldForAgent(run, graph)!;
    expect(chance.say).toContain(target.say!);
    expect(chance.say).not.toContain('Give a rough strength');
  });

  it('R13 residual RED: an unoffered band keeps its own endpoints beside two offered placeholder questions', () => {
    const placeholders = [{ from: 'price', to: 'far' }, { from: 'price', to: 'near' }];
    const graph = { nodes: [
      { id: 'option', kind: 'option', label: 'Raise price', interventions: { price: 0.6 } },
      { id: 'price', kind: 'factor', label: 'Price', scale_frame: 10, observed_state: { value: 0.5, raw_value: 5, unit: '£/month' } },
      ...['far', 'near'].map(id => ({ id, kind: 'factor', label: id, scale_frame: 10,
        observed_state: { value: 0.5, raw_value: 5, unit: '£/month' } })),
      { id: 'mediator', kind: 'factor', label: 'Unsized mediator' },
      { id: 'goal', kind: 'goal', label: 'Revenue', scale_frame: 100, goal_threshold: 0.8,
        goal_threshold_raw: 80, goal_threshold_unit: '£/month', goal_direction: '>=',
        observed_state: { value: 0.4, baseline: 0.4, raw_value: 40, unit: '£/month' } },
    ], edges: [
      { from: 'option', to: 'price' },
      ...placeholders.map((l, index) => ({ ...l, id: `placeholder-${index}`, strength: { mean: 0.5, std: 0.125 },
        provenance: { magnitude: 'olumi_placeholder' } })),
      { id: 'unoffered-band', from: 'price', to: 'mediator', strength: { mean: 0.2, std: 0.1 },
        provenance: { magnitude: 'olumi_estimate' } },
      ...['far', 'near', 'mediator'].map(from => ({ from, to: 'goal', strength: { mean: 0.2 },
        provenance: { source: 'user_specified', natural_effect: { amount: 2, amount_unit: '£/month' } } })),
    ] };
    const ends = linkEffectEndUnits(graph, 'price', 'mediator')!;
    expect(ends.target.own).toEqual([]);
    expect(ends.target.adopted).toBeUndefined();
    const verdict = targetTestabilityOf(graph);
    const target = targetNotTestableWarning(graph, verdict, ['option'], TARGET) as Warning;
    expect(target.say).toContain('from Price to Unsized mediator');
    const run = { enrichment: { inference_warnings: [
      { code: PLACEHOLDER, acceptable_links: placeholders, option_ids: ['option'], message: `Not shown. ${GUIDED_TWO}` },
      { ...target, withheld_claims: ['goal_probability', 'outcome'] },
    ] } };
    const draft = guidedSizingForRun(run, graph)!;
    expect(draft.total).toBe(2);
    expect(draft.links).toHaveLength(3);
    expect(guidedSizingActions(draft, graph).map(a => a.id)).toEqual([
      'agent-size-link:price:far', 'agent-size-link:price:near',
    ]);
    const chance = goalChanceWithheldForAgent(run, graph)!;
    expect(chance.say).toContain('from Price to Unsized mediator');
    expect(chance.say).toContain('Roughly how much does Unsized mediator change when Price changes?');
    expect(chance.say).toContain("The chance isn't shown yet: the model doesn't yet say how strongly ‘Price’ affects ‘far’ or how strongly ‘Price’ affects ‘near’, so any figure would be a guess.");
    expect(chance.say).not.toContain('Give a rough strength');
  });
});
