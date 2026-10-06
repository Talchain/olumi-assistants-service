/**
 * ⭐ A LEVEL CHANGE BINDS ONLY TO THE QUANTITY IT IS WRITTEN FOR (MC, DL bench DIAGNOSIS §2a, 6 Oct 2026). The matcher
 * reads "from 20% to about 30%" and "halve that" as a size (`stated-level-change.ts`); the binder credits it to a link
 * only when the words the level is written beside name the link's TARGET. Nodes are shaped as construction's binding
 * nodes are (`admit-model.ts` `bindingNodes`): a percentage level says its size in "percentage points"
 * (`naturalAmountUnitOf`), a yes/no source is a "switch" (`sourceUnitWords`).
 */
import { describe, it, expect } from 'vitest';
import { bindStatedLinkSizes, type StatedSizeBindingLink, type StatedSizeBindingNode } from '../stated-size-binding.js';

// The banked investor brief, verbatim (bench/bank acc__cut5-investor-stg3 and six other served drafts).
const INV = 'We are a B2B SaaS company with £2.4M quarterly revenue. Option A: build the AI reporting module — enterprise prospects '
  + 'tell us it would lift our enterprise win rate from 20% to about 30%. Option B: fix the integration-step bug — about 30% '
  + 'of trial users abandon at that step today, and fixing it should roughly halve that. Option C: carry on with the current '
  + 'roadmap. Goal: grow quarterly revenue to £2.8M.';
const INV_A = 'Option A: build the AI reporting module — enterprise prospects tell us it would lift our enterprise win rate from 20% to about 30%.';
const INV_B = 'Option B: fix the integration-step bug — about 30% of trial users abandon at that step today, and fixing it should roughly halve that.';

const sw = (id: string, label: string): StatedSizeBindingNode => ({ id, label, kind: 'factor', unit: 'binary', effect_unit: 'binary', change_unit: 'switch' });
const level = (id: string, label: string): StatedSizeBindingNode => ({ id, label, kind: 'factor', unit: '%', effect_unit: 'percentage points', change_unit: '%' });
const option = (id: string, label: string): StatedSizeBindingNode => ({ id, label, kind: 'option' });
const goal: StatedSizeBindingNode = { id: 'g', label: 'quarterly revenue', kind: 'goal', unit: '£/quarter', effect_unit: '£/quarter', change_unit: '£/quarter', goal_threshold_raw: 2800000, goal_threshold_unit: '£/quarter' };
const perSwitch = (from: string, to: string, amount: number): StatedSizeBindingLink => ({
  from, to, effect_direction: amount > 0 ? 'positive' : 'negative',
  natural_effect: { amount, amount_unit: 'percentage points', per_source_change: 1, per_source_change_unit: 'switch' },
});

/** acc__cut5-investor-stg3's own labels. */
const STG3: StatedSizeBindingNode[] = [
  goal, option('o1', 'Build AI reporting'), option('o2', 'Fix integration bug'), option('o3', 'Current roadmap'),
  sw('ai', 'AI reporting availability'), { id: 'ae', label: 'AI reporting delivery effort', kind: 'factor', unit: 'engineer-weeks/quarter' },
  level('w', 'Enterprise win rate'), sw('fx', 'Integration bug fixed'),
  { id: 'fe', label: 'Integration bug-fix effort', kind: 'factor', unit: 'engineer-weeks/quarter' },
  level('ab', 'Integration-step abandonment'),
  { id: 'r', label: 'Revenue lost to roadmap disruption', kind: 'risk', unit: '£/quarter', effect_unit: '£/quarter' },
];
const setters = new Map([['ai', ['Build AI reporting']], ['fx', ['Fix integration bug']]]);

describe('the real investor brief binds both stated level changes, each with its own sentence', () => {
  it('RED: +10 points into ‘Enterprise win rate’ is the user\'s, quoted; −15 points into ‘Integration-step abandonment’ is too', () => {
    const bound = bindStatedLinkSizes([perSwitch('ai', 'w', 10), perSwitch('fx', 'ab', -15)], STG3, INV, [], { settersOf: setters });
    expect(bound.get(0)).toBe(INV_A);
    expect(bound.get(1)).toBe(INV_B);
  });

  it('a level change carries no centre range: nothing is read around "30%" as a spread of the +10', () => {
    const centreRanges = new Map();
    const brief = INV.replace('about 30%.', 'about 30%, between 25% and 35%.');
    bindStatedLinkSizes([perSwitch('ai', 'w', 10)], STG3, brief, [], { settersOf: setters, centreRanges });
    expect(centreRanges.size).toBe(0);
  });
});

describe('must NOT bind: a level written for ANOTHER quantity is never the link\'s', () => {
  // One sentence, two graphs: the level change is written beside "enterprise win rate", never beside "trial abandonment".
  const BOTH = 'Option A: build the AI reporting module — it would lift our enterprise win rate from 20% to about 30% and cut trial abandonment.';
  const ai = sw('ai', 'AI reporting availability');

  it('CONTROL: in a graph whose target IS the win rate, the change binds', () => {
    const bound = bindStatedLinkSizes([perSwitch('ai', 'w', 10)], [goal, ai, level('w', 'Enterprise win rate')], BOTH);
    expect(bound.get(0)).toBe(BOTH);
  });

  it('a different quantity named in the sentence: the win rate\'s +10 is never ‘Trial abandonment’\'s', () => {
    const bound = bindStatedLinkSizes([perSwitch('ai', 't', 10)], [goal, ai, level('t', 'Trial abandonment')], BOTH);
    expect(bound.has(0)).toBe(false);
  });

  it('a shared word is not the name: "lift our trial conversion from 20% …" never sizes ‘Trial abandonment’', () => {
    const conv = 'Option A: build the AI reporting module — it would lift our trial conversion from 20% to about 30% and cut trial abandonment.';
    const bound = bindStatedLinkSizes([perSwitch('ai', 't', 10)], [goal, ai, level('t', 'Trial abandonment')], conv);
    expect(bound.has(0)).toBe(false);
  });

  it('"halve that" of a level stated for ANOTHER quantity (support tickets) is never ‘Integration-step abandonment’\'s', () => {
    const other = INV.replace(INV_B, 'Option B: fix the integration-step bug — about 30% of support tickets mention it, '
      + 'integration-step abandonment is high, and fixing it should roughly halve that.');
    const bound = bindStatedLinkSizes([perSwitch('fx', 'ab', -15)], STG3, other, [], { settersOf: setters });
    expect(bound.has(0)).toBe(false);
  });
});
