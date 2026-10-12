/**
 * Row5, option settings (DL 12 Oct: "D6's range on OPTION settings → YES, extend Row5 (stated_by kept, label, never
 * withhold)"; T5 meaning loss, `recovery/t5-meaning/DIAGNOSIS.md` §2 and §3). A third party's range for a quantity was
 * lost whenever the figure it brackets sat on an OPTION's setting rather than the factor's level:
 *  - D6 C r1: "Specialist capacity contribution" is 0 today; "Add one specialist" sets 20 and "Trial specialist" 10,
 *    inside the supplier's "10–30 features per week";
 *  - D3 C r1: "Price-increase customer churn" is 0 today; "Raise price to £22" sets 15%, inside the interviews' "10–20%".
 * The range now rides beside the setting it contains, quoted and attributed (`attributed_range`), and the Agent sees it
 * as the third party's, unverified. It is display only: never the engine's `range`, and dropped from the analysis wire,
 * so no Run, limit or chance changes and nothing is withheld.
 *
 * The corpus is the AIE's T5 raw drafts (`fixtures/row5-range-drafts-t5.json`, sha-checked), through admission as
 * production wires it.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import t5 from './fixtures/row5-range-drafts-t5.json';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
import { goalLevelTheUserWrote } from '../stated-by-user.js';
import { projectOptionLevels } from '../runtime/agent-capabilities.js';
import { withoutAttributedSettingRanges, wireInterventionRangePlan } from '../../intervention-range.js';

type Rec = Record<string, any>;
const draft = (c: string, arm: string, run: string) => t5.drafts.find((d) => d.case.startsWith(c) && d.arm === arm && d.sample.includes(`-${run}-`))!;
const briefOf = (c: string): string => Object.entries(t5.briefs as Record<string, string>).find(([k]) => k.startsWith(c))![1];
const SUPPLIER = 'A supplier says a specialist can contribute 10–30 features per week; I have not verified that claim.';
const INTERVIEWS = 'Customer interviews suggest that raising the price could cause 10–20% churn, but that evidence is weak.';
function admitted(c: string, arm: string, run: string, edit: (m: Rec) => void = () => {}, brief = briefOf(c)): Rec[] {
  const m = structuredClone(JSON.parse(draft(c, arm, run).raw_text)) as Rec;
  edit(m);
  return admitCandidateModel(m as CandidateModel, {}, brief, goalLevelTheUserWrote(m as CandidateModel, brief)).nodes as unknown as Rec[];
}
const byLabel = (nodes: Rec[], label: string): Rec => nodes.find((n) => n.label === label)!;
const cellOf = (nodes: Rec[], option: string, factor: string): Rec => byLabel(nodes, option).interventions[byLabel(nodes, factor).id];

describe('IDENTITY: the T5 drafts, byte for byte; each setting sits inside the brief\'s third-party range', () => {
  it('D6 C r1 and D3 C r1: sha-checked; the factor is 0 today; the options set it inside the quoted range', () => {
    for (const [c, s] of [['D6', SUPPLIER], ['D3', INTERVIEWS]] as const) {
      const d = draft(c, 'C', 'r1');
      expect(createHash('sha256').update(d.raw_text).digest('hex')).toBe(d.raw_sha256);
      expect(briefOf(c)).toContain(s);
    }
    const d6 = JSON.parse(draft('D6', 'C', 'r1').raw_text) as Rec;
    expect(d6.factors.find((f: Rec) => f.label === 'Specialist capacity contribution').baseline_value).toBe(0);
    expect(d6.options.flatMap((o: Rec) => o.interventions.filter((i: Rec) => i.factor_label === 'Specialist capacity contribution').map((i: Rec) => i.value))).toEqual([20, 10]);
    const d3 = JSON.parse(draft('D3', 'C', 'r1').raw_text) as Rec;
    expect(d3.options.find((o: Rec) => o.label === 'Raise price to £22').interventions.find((i: Rec) => i.factor_label === 'Price-increase customer churn').value).toBe(15);
  });
});

describe('the range rides beside the setting it contains, quoted and attributed; never the engine\'s range', () => {
  it('D6 C r1: both settings (20 and 10) carry the supplier\'s 10–30, with the supplier\'s sentence', () => {
    const nodes = admitted('D6', 'C', 'r1');
    for (const option of ['Add one specialist', 'Trial specialist']) {
      const cell = cellOf(nodes, option, 'Specialist capacity contribution');
      expect(cell.attributed_range, option).toEqual({ low: 10, high: 30, meaning: 'min_max', source: 'brief_extraction', source_quote: SUPPLIER });
      expect(cell, `${option}: not the engine's range`).not.toHaveProperty('range');
    }
  });
  it('D3 C r1: "Raise price to £22"\'s 15% carries the interviews\' 10–20%, with their sentence; its other settings carry none', () => {
    const nodes = admitted('D3', 'C', 'r1');
    expect(cellOf(nodes, 'Raise price to £22', 'Price-increase customer churn').attributed_range)
      .toEqual({ low: 10, high: 20, meaning: 'min_max', source: 'brief_extraction', source_quote: INTERVIEWS });
    expect(cellOf(nodes, 'Raise price to £22', 'Monthly price per customer')).not.toHaveProperty('attributed_range');
    expect(cellOf(nodes, 'Raise price to £22', 'One-off research spend')).not.toHaveProperty('attributed_range');
  });
  it('CONTRAST (design: "10–20% attrition"): words after the figure that do not name the factor are another quantity; none', () => {
    const nodes = admitted('D3', 'C', 'r1', () => {}, briefOf('D3').replace('10–20% churn', '10–20% attrition'));
    expect(cellOf(nodes, 'Raise price to £22', 'Price-increase customer churn')).not.toHaveProperty('attributed_range');
  });
  it('CONTRAST (design: another option sets "Monthly customer churn" to 12): two factors inside one quote; it rides beside neither', () => {
    const nodes = admitted('D3', 'C', 'r1', (m) => {
      m.options.find((o: Rec) => o.label === 'Improve onboarding').interventions.push({ ...m.options.find((o: Rec) => o.label === 'Raise price to £22')
        .interventions.find((i: Rec) => i.factor_label === 'Price-increase customer churn'), factor_label: 'Monthly customer churn', value: 12 });
    });
    expect(cellOf(nodes, 'Improve onboarding', 'Monthly customer churn').raw_value).toBe(12);
    expect(cellOf(nodes, 'Raise price to £22', 'Price-increase customer churn')).not.toHaveProperty('attributed_range');
    expect(cellOf(nodes, 'Improve onboarding', 'Monthly customer churn')).not.toHaveProperty('attributed_range');
  });
  it('label, never withhold: each setting keeps the drafted figure exactly', () => {
    const nodes = admitted('D6', 'C', 'r1');
    expect([cellOf(nodes, 'Add one specialist', 'Specialist capacity contribution').raw_value,
      cellOf(nodes, 'Trial specialist', 'Specialist capacity contribution').raw_value]).toEqual([20, 10]);
  });
  it('CONTRAST: a setting outside the range (design: 40) carries none', () => {
    const nodes = admitted('D6', 'C', 'r1', (m) => {
      m.options.find((o: Rec) => o.label === 'Add one specialist').interventions[0].value = 40;
    });
    expect(cellOf(nodes, 'Add one specialist', 'Specialist capacity contribution')).not.toHaveProperty('attributed_range');
    expect(cellOf(nodes, 'Trial specialist', 'Specialist capacity contribution').attributed_range.low).toBe(10);
  });
  it('CONTRAST: a brief with no third party\'s range (the supplier sentence removed) carries none', () => {
    const nodes = admitted('D6', 'C', 'r1', () => {}, briefOf('D6').replace(`${SUPPLIER} `, ''));
    expect(cellOf(nodes, 'Add one specialist', 'Specialist capacity contribution')).not.toHaveProperty('attributed_range');
  });
});

describe('the Agent sees it as the third party\'s, unverified', () => {
  it('D6 C r1: the option\'s level carries stated_range, stated_by third_party_unverified, with the supplier\'s words', () => {
    const nodes = admitted('D6', 'C', 'r1');
    const factors = new Map(nodes.map((n) => [n.id, n] as const));
    const levels = projectOptionLevels(byLabel(nodes, 'Add one specialist') as never, factors as never);
    expect(levels.find((l) => l.factor === 'Specialist capacity contribution')).toMatchObject({ level: 20,
      stated_range: { low: 10, high: 30, stated_by: 'third_party_unverified', quote: SUPPLIER } });
  });
  it('CONTRAST: a setting later moved outside the range (design: the stored cell edited to 40) is shown without it', () => {
    const nodes = admitted('D6', 'C', 'r1');
    const option = structuredClone(byLabel(nodes, 'Add one specialist'));
    const id = byLabel(nodes, 'Specialist capacity contribution').id;
    const cell = option.interventions[id];
    option.interventions[id] = { ...cell, value: cell.value * 2, raw_value: 40 };
    const levels = projectOptionLevels(option as never, new Map(nodes.map((n) => [n.id, n] as const)) as never);
    expect(levels.find((l) => l.factor === 'Specialist capacity contribution')).not.toHaveProperty('stated_range');
  });
});

describe('display only: the analysis wire never carries it', () => {
  it('the wire copy drops attributed_range and nothing else; a graph with none is the same reference', () => {
    const nodes = admitted('D6', 'C', 'r1');
    const graph = { nodes, edges: [] };
    const wire = withoutAttributedSettingRanges(graph) as Rec;
    const strip = (g: Rec): string => JSON.stringify(g, (k, v) => (k === 'attributed_range' ? undefined : v));
    expect(JSON.stringify(wire)).not.toContain('attributed_range');
    expect(JSON.stringify(wire)).toBe(strip(graph));
    expect(JSON.stringify(graph)).toContain('attributed_range');
    const none = { nodes: [{ id: 'x', kind: 'option', interventions: { f: { value: 1 } } }], edges: [] };
    expect(withoutAttributedSettingRanges(none)).toBe(none);
  });
  it('no intervention_ranges entry: the engine\'s range plan reads `range` only', () => {
    const nodes = admitted('D6', 'C', 'r1');
    const option = byLabel(nodes, 'Add one specialist');
    const id = byLabel(nodes, 'Specialist capacity contribution').id;
    const plan = wireInterventionRangePlan(option.interventions, { [id]: option.interventions[id].raw_value });
    expect(plan).toEqual({ ranges: undefined, notForwarded: [] });
  });
});
