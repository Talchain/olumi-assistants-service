/**
 * Served 500 on 8 Oct (CEE 1c834a0c, request 27dfd9e5): an Olumi draft-time widened risk (#2854) is a precondition
 * member with `draft_widening.hits` and NO `relies_on`, and `leftOutLines` read `relies_on.option_id` blind on the
 * build turn's writing path. The fixture is the served B1 graph exactly as the witness read it back.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { decisionInputLines, type DecisionInputAskContext } from '../decision-input-ask.js';
import { chanceShownFor, type OptionChanceCell } from '../chance-shown.js';
import { preconditionRiskIds } from '../../../graph/inert-risk.js';

type Rec = Record<string, any>;
const SERVED = JSON.parse(readFileSync(new URL('./fixtures/served-b1-widened-20261008.json', import.meta.url), 'utf8')) as Rec;
const ctx: DecisionInputAskContext = { restingText: '', questionsToggle: false, recentReplies: [], awaitingApproval: false, builtOrRan: true };
const limits = (g: Rec): string[] => (g.goal_constraints ?? []).map((c: Rec) => c.node_id).filter((x: unknown) => typeof x === 'string');
const CHANCE_CLAUSE = ", and that option's chance doesn't include it yet.";
const riskLine = (risk: Rec, option: Rec, besideChance: boolean): string =>
  `‘${risk.label}’: ‘${option.label}’ relies on this not happening. This model can't yet apply that risk to that option alone, `
    + 'so the Run leaves it out' + (besideChance ? CHANCE_CLAUSE : '.');

describe('a widened risk on the served writing path', () => {
  it('the served B1 graph: its 3 widened risks are precondition members and decisionInputLines names each against the option it hits', () => {
    const widened = SERVED.nodes.filter((n: Rec) => n.draft_widening?.provenance === 'ai_suggested_widen');
    expect(widened.map((n: Rec) => n.id)).toEqual(['feature_release_slips', 'value_message_misses_buyers', 'test_delays_pricing_decision']);
    const members = preconditionRiskIds(SERVED.nodes, SERVED.edges, limits(SERVED));
    for (const n of widened) expect(members.has(n.id), n.id).toBe(true);
    expect(widened.every((n: Rec) => n.relies_on === undefined)).toBe(true);
    const lines = decisionInputLines(SERVED, ctx);
    for (const n of widened) {
      const option = SERVED.nodes.find((o: Rec) => o.id === n.draft_widening.hits.id);
      expect(option?.kind, n.id).toBe('option');
      expect(lines.some((l) => l.includes(n.label) && l.includes(option.label)), `${n.label} named against ${option.label}`).toBe(true);
    }
  });

  it('CONTRAST: a relies_on-stamped precondition risk keeps its line; a widened risk whose hit names no option falls to the generic left-out line, never a throw', () => {
    const stamped = structuredClone(SERVED);
    const r = stamped.nodes.find((n: Rec) => n.id === 'feature_release_slips');
    const optionId = r.draft_widening.hits.id;
    delete r.draft_widening; r.relies_on = { option_id: optionId };
    const option = stamped.nodes.find((o: Rec) => o.id === optionId);
    expect(decisionInputLines(stamped, ctx).some((l) => l.includes(r.label) && l.includes(option.label))).toBe(true);
    const dangling = structuredClone(SERVED);
    dangling.nodes.find((n: Rec) => n.id === 'value_message_misses_buyers').draft_widening.hits.id = 'no_such_option';
    expect(() => decisionInputLines(dangling, ctx)).not.toThrow();
  });

  it('no-Run B1 widened draft keeps every relies-on disclosure without a chance clause', () => {
    const lines = decisionInputLines(SERVED, ctx);
    expect(lines.join('\n')).not.toContain(CHANCE_CLAUSE);
    for (const risk of SERVED.nodes.filter((n: Rec) => n.draft_widening?.provenance === 'ai_suggested_widen')) {
      const option = SERVED.nodes.find((n: Rec) => n.id === risk.draft_widening.hits.id);
      expect(lines).toContain(riskLine(risk, option, false));
    }
    expect(chanceShownFor([])).toBe(false);
  });

  it.each(['figure', 'range'] as const)('a shown %s licenses the clause only for the option it belongs to', (kind) => {
    const risk = SERVED.nodes.find((n: Rec) => n.id === 'feature_release_slips');
    const option = SERVED.nodes.find((n: Rec) => n.id === risk.draft_widening.hits.id);
    const cell: OptionChanceCell = kind === 'figure' ? { kind, display: '67%', option_id: option.id }
      : { kind, display: 'about 40% to about 70%', option_id: option.id,
        detail: { range: 'about 40% to about 70%', depends_on: { kind: 'link_strength', from_label: 'Features delivered',
          to_label: 'Paid conversion', among: 'unsized_links' } } };
    const cells = [cell];
    expect(chanceShownFor(cells)).toBe(true);
    expect(chanceShownFor(cells, option.id)).toBe(true);
    expect(decisionInputLines(SERVED, { ...ctx, chanceCells: cells })).toContain(riskLine(risk, option, true));
    const otherRisk = SERVED.nodes.find((n: Rec) => n.id === 'test_delays_pricing_decision');
    const otherOption = SERVED.nodes.find((n: Rec) => n.id === otherRisk.draft_widening.hits.id);
    expect(decisionInputLines(SERVED, { ...ctx, chanceCells: cells })).toContain(riskLine(otherRisk, otherOption, false));
  });

  it('another option has a shown figure while the risk option is withheld: keeps its relies-on words and drops its chance clause', () => {
    const risk = SERVED.nodes.find((n: Rec) => n.id === 'feature_release_slips');
    const option = SERVED.nodes.find((n: Rec) => n.id === risk.draft_widening.hits.id);
    const cells: readonly OptionChanceCell[] = [
      { kind: 'figure', display: '67%', option_id: 'keep_pro_at_49' },
      { kind: 'withheld', option_id: option.id, reasons: [], face: 'Chance not shown yet', why: 'Not shown.' },
    ];
    expect(chanceShownFor(cells)).toBe(true);
    expect(chanceShownFor(cells, option.id)).toBe(false);
    const lines = decisionInputLines(SERVED, { ...ctx, chanceCells: cells });
    expect(lines).toContain(riskLine(risk, option, false));
    expect(lines.join('\n')).not.toContain(CHANCE_CLAUSE);
  });

  it('none and withheld cells never license chance wording, and an unidentified shown cell cannot license one option', () => {
    const cells: readonly OptionChanceCell[] = [
      { kind: 'none', option_id: 'keep_pro_at_49' },
      { kind: 'withheld', option_id: '59_pro_with_release', reasons: [], face: 'Chance not shown yet', why: 'Not shown.' },
    ];
    expect(chanceShownFor(cells)).toBe(false);
    expect(chanceShownFor(cells, '59_pro_with_release')).toBe(false);
    expect(chanceShownFor([{ kind: 'figure', display: '67%' }], '59_pro_with_release')).toBe(false);
  });
});
