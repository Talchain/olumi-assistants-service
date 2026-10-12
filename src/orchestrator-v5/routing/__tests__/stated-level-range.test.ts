/**
 * ⭐ RECOVERY BATCH B (SYS3 TRACE L6): a level the user stated as a RANGE is stored as a range, beside the figure they
 * chose — never a midpoint presented as theirs. Paul, 11 Oct: "currently they spend between 20% and 30% of their time on
 * non-development tasks", then "Let's go with 25%."
 *
 * The stored shape is the existing schemas 0.66 `InterventionRangeSchema` ({low, high, meaning, source, source_quote}),
 * on `observed_state.range`, in the figure's own (raw) units. These rows pin the hold member's rule (what the add-factor
 * door may carry into the apply) and that CEE's own graph schema keeps the field through a save and a reload.
 */
import { describe, expect, it } from 'vitest';

import { isUserTodayObservedState, readUserTodayMember, stampNewUserTodayLevels, USER_TODAY_SOURCE, withoutStatedLevelRanges } from '../add-factor-transaction.js';
import { framedObservedState, defaultFrameFor } from '../../agent-lane/admit-model.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';

type Rec = Record<string, any>;
const SENTENCE = "If we think of our development team's monthly capacity, currently they spend between 20% and 30% of their time on non-development tasks (e.g., meetings, admin, and other distractions that are not writing code).";
const POINT_25 = { ...framedObservedState({ baseline_value: 25, unit: '%', provenance: 'explicit', plausible_max: defaultFrameFor(25) }), source: USER_TODAY_SOURCE } as Rec;
const RANGE = { low: 20, high: 30, meaning: 'min_max', source: USER_TODAY_SOURCE, source_quote: SENTENCE };

describe('the add-factor hold carries a stated range only beside the user\'s own figure, inside it', () => {
  it('RED: Paul\'s 25 % with his 20–30 % range is a door level', () => {
    expect(isUserTodayObservedState({ ...POINT_25, range: RANGE })).toBe(true);
    expect(readUserTodayMember([{ factor_id: 'fac_non_development_time', observed_state: { ...POINT_25, range: RANGE } }])).toHaveLength(1);
  });

  it.each([
    ['a figure outside its range', { ...POINT_25, range: { ...RANGE, low: 26 } }],
    ['a range that is not the user\'s', { ...POINT_25, range: { ...RANGE, source: 'cee_inference' } }],
    ['an empty or inverted range', { ...POINT_25, range: { ...RANGE, low: 30, high: 20 } }],
    ['a range with a member the schema does not know', { ...POINT_25, range: { ...RANGE, midpoint: 25 } }],
    ['a range with no quote of the user\'s words', { ...POINT_25, range: { low: 20, high: 30, meaning: 'min_max', source: USER_TODAY_SOURCE } }],
    ['a range claiming a likelihood the user did not state', { ...POINT_25, range: { ...RANGE, meaning: 'likely_range' } }],
    ['a range beside a figure that is not the user\'s', { ...POINT_25, source: 'cee_inference', range: RANGE }],
  ])('refused: %s', (_what, os) => { expect(isUserTodayObservedState(os)).toBe(false); });

  it('CONTROL: the user\'s figure alone is a door level, as before', () => {
    expect(isUserTodayObservedState(POINT_25)).toBe(true);
  });

  it('the confirm writes the range on the node exactly as held, and CEE\'s graph schema keeps it through a save and a reload', () => {
    const ops = [{ op: 'add_node', path: 'fac_non_development_time', value: { id: 'fac_non_development_time', kind: 'factor', label: 'Non-development time', category: 'external' } }] as never[];
    const stamped = stampNewUserTodayLevels(ops, [{ factor_id: 'fac_non_development_time', observed_state: { ...POINT_25, range: RANGE } }]);
    expect(stamped.ok).toBe(true);
    const node = stamped.ok ? (stamped.operations[0] as Rec).value : undefined;
    expect(node.observed_state.range).toEqual(RANGE);
    const graph = { nodes: [{ id: 'goal_productivity', kind: 'goal', label: 'productivity' }, node], edges: [{ from: node.id, to: 'goal_productivity', strength: { mean: -0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'negative' }] };
    const reloaded = GraphV3.parse(JSON.parse(JSON.stringify(graph))) as Rec;
    expect(reloaded.nodes[1].observed_state.range).toEqual(RANGE);
  });
});

describe('the analysis wire copy carries no stated range (it changes no compute)', () => {
  it('withoutStatedLevelRanges removes `observed_state.range` only, and returns the same graph when there is none', () => {
    const withRange: Rec = { nodes: [{ id: 'f', kind: 'factor', observed_state: { ...POINT_25, range: RANGE } }, { id: 'g', kind: 'goal' }], edges: [] };
    const out = withoutStatedLevelRanges(withRange) as Rec;
    expect(out.nodes[0].observed_state).toEqual(POINT_25);
    expect(withRange.nodes[0].observed_state.range, 'the stored graph is never touched').toEqual(RANGE);
    const none: Rec = { nodes: [{ id: 'f', kind: 'factor', observed_state: POINT_25 }], edges: [] };
    expect(withoutStatedLevelRanges(none)).toBe(none);
  });
});
