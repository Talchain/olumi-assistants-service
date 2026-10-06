/**
 * ⭐ S7 "EXPLAIN THE CHANGE" ON THE TYPED PATH: the leader-free rerun record (D4 lease #87 6005636960; DL decision YES with
 * conditions; Science d5 6005682972).
 *
 * Served at 5d767fa3 (red team s7-d4, pd red-team/github-87 @2885be4b): withheld Run → link set → permitted Run, then the
 * TYPED "What changed since the last run, and why?" answered "Nothing changed since the latest saved run". The Explain chip
 * said it right from `rerunExplanationPlan`. These rows pin the record that carries that same plan to the typed loop:
 *   · IDENTITY PINS (DL condition 1): per field, the record holds no leader id, no option share and no win_probabilities;
 *   · TWIN (DL condition 2): a delta the model is shown as licensed → no record, so that context is byte-unchanged;
 *   · the record's rule never frames the next link as a value-of-information choice (d5 (c): none was computed).
 */
import { describe, expect, it } from 'vitest';
import { NO_MATCHED_FIGURES_RULE, rerunExplanationPlan, rerunRecordForModel, TYPED_RERUN_RECORD_RULE, RERUN_FALLBACK_LINES, RERUN_NO_CHANGE_LINES } from '../rerun-explanation.js';

const NODES = [
  { id: 'current_plan_mrr', kind: 'factor', label: 'Current-plan monthly recurring revenue' },
  { id: 'mrr', kind: 'goal', label: 'monthly recurring revenue' },
  { id: 'opt_starter', kind: 'option', label: 'Launch starter tier' },
  { id: 'opt_price', kind: 'option', label: 'Raise prices' },
  { id: 'opt_keep', kind: 'option', label: 'Keep current plan' },
];
const LEADER_IDS = ['opt_starter', 'opt_price', 'opt_keep'];

/** The served S7 pair (s7-d4): the earlier Run held its figures back; one link's strength moved; a strength edit moves the
 * seed, so the pair is C2 (d5 6005682972 (2)). The wire also carries a leader, shares and endpoints, which must never leak. */
const SERVED_PAIR = {
  attribution_case: 'C2_unpaired',
  input_coverage: 'complete',
  input_changes: [{
    entity_kind: 'link', entity_id: 'current_plan_mrr->mrr', link: { from: 'current_plan_mrr', to: 'mrr' }, field: 'strength',
    before: { raw: 'slight' }, after: { raw: 'moderate' }, change: 'changed',
  }],
  win_probabilities: [{ option_id: 'opt_starter', prior: 0.41, current: 0.79 }],
  win_probabilities_unavailable: 'prior_withheld',
  leader: { changed: true, prior_leading_option_id: 'opt_price', current_leading_option_id: 'opt_starter', noise_verdict: 'signal' },
  endpoints: { prior: { run_id: 'run-1', computed_at: '2026-10-05T23:30:00.000Z' }, current: { run_id: 'run-2', computed_at: '2026-10-05T23:31:00.000Z' } },
  pair_provenance: { seed_equal: false, hash_equal: false, builds_equal: 'equal', n_equal: true },
};
const SAID = 'You changed how much Current-plan monthly recurring revenue changes monthly recurring revenue: slight → moderate.';

describe('the typed loop\'s rerun record: Olumi\'s own line, leader-free', () => {
  it('RED (served s7-d4): a withheld → permitted pair gets the Explain chip\'s own code line, so "nothing changed" has a record to contradict', () => {
    const record = rerunRecordForModel(SERVED_PAIR, false, NODES)!;
    expect(record.code_line).toBe(`${SAID} ${RERUN_NO_CHANGE_LINES.unwithheld} ${RERUN_FALLBACK_LINES.C2}`);
    expect(record.prior_withheld).toBe(true);
    expect(record.attribution_case).toBe('C2_unpaired');
    expect(record.use).toBe(TYPED_RERUN_RECORD_RULE);
    // The same plan as the chip, not a second wording.
    const optionLabels = NODES.filter((n) => n.kind === 'option').map((n) => n.label);
    expect(record.code_line).toBe(rerunExplanationPlan(SERVED_PAIR, (id) => NODES.find((n) => n.id === id)?.label, optionLabels, false,
      NODES.map((n) => n.label))!.codeLine);
  });

  it('IDENTITY PINS (DL condition 1): exactly four fields; no leader id, no share, no win probability in any of them', () => {
    const record = rerunRecordForModel(SERVED_PAIR, false, NODES)!;
    expect(Object.keys(record).sort()).toEqual(['attribution_case', 'code_line', 'prior_withheld', 'use']);
    for (const [field, value] of Object.entries(record)) {
      const said = JSON.stringify(value);
      for (const id of LEADER_IDS) expect(said, `${field} carries option id ${id}`).not.toContain(id);
      expect(said, `${field} names a leader`).not.toMatch(/leader|leading_option/i);
      expect(said, `${field} carries a win probability`).not.toMatch(/win_probabilit/i);
      // A share is THIS pair's win share (41% / 79%), not any percentage: a user's input in % is a change, not a share.
      expect(said, `${field} carries a win share`).not.toMatch(/(?<![\d.])(?:41|79)\s?%|0\.41|0\.79/);
    }
  });

  it('CONTROL: the wire pair the record was built from DOES carry the leader and shares, so the pins above read a populated source', () => {
    const wire = JSON.stringify(SERVED_PAIR);
    expect(wire).toContain('opt_starter');
    expect(wire).toContain('win_probabilities');
    expect(wire).toContain('0.79');
  });

  it('TWIN (DL condition 2): a delta the model is shown as licensed → no record, so that context is byte-unchanged', () => {
    expect(rerunRecordForModel(SERVED_PAIR, true, NODES)).toBeUndefined();
  });

  it('a first Run (no wire delta) → no record', () => {
    expect(rerunRecordForModel(undefined, false, NODES)).toBeUndefined();
  });

  it('a display alias counts as an option label for the plan\'s checks, never as a change', () => {
    const record = rerunRecordForModel(SERVED_PAIR, false, NODES, ['Starter tier (new)'])!;
    expect(record.code_line).toBe(`${SAID} ${RERUN_NO_CHANGE_LINES.unwithheld} ${RERUN_FALLBACK_LINES.C2}`);
  });
});

describe('leader-free is CHECKED against the pair\'s own leader and shares (Codex buddy r1 P1 on d70025a9; r2 P1/P2 on b521a584)', () => {
  // Each case carries EXACTLY ONE forbidden interpolation, so each collector path is pinned on its own (buddy r2 P2).
  // The pair below separates the paths: a leader-block-only id, a win-row-only id, and one share (0.795).
  const PAIR = { ...SERVED_PAIR,
    leader: { changed: true, prior_leading_option_id: 'opt_leader_only', current_leading_option_id: 'opt_leader_only', noise_verdict: 'signal' },
    win_probabilities: [{ option_id: 'opt_row_only', prior: 0.2, current: 0.795 }] };
  const factor = (before: unknown, after: unknown, label = 'Conversion') => ({ entity_kind: 'factor_value', entity_id: 'conv', field: 'value',
    label_before: label, label_after: label, before, after, change: 'changed' });
  const link = (fromLabel: string) => [{ id: 'from_node', kind: 'factor', label: fromLabel }, { id: 'to_node', kind: 'factor', label: 'Revenue' }];
  const linkRow = { entity_kind: 'link', entity_id: 'from_node->to_node', link: { from: 'from_node', to: 'to_node' }, field: 'strength',
    before: { raw: 'slight' }, after: { raw: 'moderate' }, change: 'changed' };
  const lineOf = (row: Record<string, unknown>, nodes = NODES) => rerunRecordForModel({ ...PAIR, input_changes: [row] }, false, nodes)!.code_line;
  it.each<[string, Record<string, unknown>, typeof NODES | undefined]>([
    ['a leader-block-only id as a factor label', factor({ raw: 1 }, { raw: 2 }, 'opt_leader_only'), undefined],
    ['a win-row-only id as a factor label', factor({ raw: 1 }, { raw: 2 }, 'opt_row_only'), undefined],
    ['a leader id as a LINK ENDPOINT label', linkRow, link('opt_leader_only')],
    ['the share as "79.5 %"', factor({ raw: 3, unit: '%' }, { raw: 79.5, unit: '%' }), undefined],
    ['the share rounded, "80 %"', factor({ raw: 3, unit: '%' }, { raw: 80, unit: '%' }), undefined],
    ['the share as "79.5 per cent"', factor({ raw: 3, unit: 'per cent' }, { raw: 79.5, unit: 'per cent' }), undefined],
    ['the share as "79.5 percent"', factor({ raw: 3, unit: 'percent' }, { raw: 79.5, unit: 'percent' }), undefined],
    ['the share as a bare fraction "0.795"', factor({ raw: 3 }, { raw: 0.795 }), undefined],
    ['the share in a UNIT', factor({ raw: 3, unit: 'x (0.795)' }, { raw: 5, unit: 'x (0.795)' }), undefined],
    ['the share with doubled space, "79.5 per  cent" (buddy r3)', factor({ raw: 3, unit: 'per  cent' }, { raw: 79.5, unit: 'per  cent' }), undefined],
    ['the share with a no-break space, "79.5\u00a0%"', factor({ raw: 3, unit: '\u00a0%' }, { raw: 79.5, unit: '\u00a0%' }), undefined],
    ['the share at long precision, "0.7950000" (buddy r3)', factor({ raw: 3 }, { raw: '0.7950000' }), undefined],
  ])('RED: %s → the neutral line', (_n, row, nodes) => {
    expect(lineOf(row, nodes ?? NODES)).toBe(RERUN_NO_CHANGE_LINES.unknown);
  });
  it('CONTROL: the same shapes with NO forbidden content are named (the check is not blanket)', () => {
    expect(lineOf(factor({ raw: 3, unit: '%' }, { raw: 5, unit: '%' }, 'Monthly churn'))).toContain('You changed Monthly churn: 3 % → 5 %.');
    expect(lineOf(factor({ raw: 0 }, { raw: 1 }, 'Headcount'))).toContain('You changed Headcount: 0 → 1.');
    expect(lineOf(linkRow, link('Price'))).toContain('You changed how much Price changes Revenue: slight → moderate.');
  });
});

describe('the chip\'s movement guard travels with the record (Codex buddy r1 on d70025a9, P2)', () => {
  it('RED: no option has figures in both Runs (empty win_probabilities, not prior-withheld) → the rule forbids any movement', () => {
    const record = rerunRecordForModel({ ...SERVED_PAIR, attribution_case: 'C1_attributable', win_probabilities: [], win_probabilities_unavailable: undefined }, false, NODES)!;
    expect(record.prior_withheld).toBe(false);
    expect(record.use).toBe(`${TYPED_RERUN_RECORD_RULE}${NO_MATCHED_FIGURES_RULE}`);
    expect(NO_MATCHED_FIGURES_RULE).toContain('never say anything rose, fell or moved');
  });
  it('CONTROL: matched figures in both Runs → the plain rule', () => {
    const record = rerunRecordForModel({ ...SERVED_PAIR, win_probabilities_unavailable: undefined }, false, NODES)!;
    expect(record.use).toBe(TYPED_RERUN_RECORD_RULE);
  });
});

describe('several changes are credited together, never one of them (DL follow-up on #2616)', () => {
  const link = (from: string, to: string) => ({ entity_kind: 'link', entity_id: `${from}->${to}`, link: { from, to }, field: 'strength',
    before: { raw: 'slight' }, after: { raw: 'moderate' }, change: 'changed' });
  const NODES2 = [...NODES, { id: 'price', kind: 'factor', label: 'Price' }, { id: 'churn', kind: 'factor', label: 'Churn' }];
  it('RED: a prior-withheld C1 pair with TWO named changes → the record says C2_unpaired (the model may not single one out)', () => {
    const record = rerunRecordForModel({ ...SERVED_PAIR, attribution_case: 'C1_attributable',
      input_changes: [link('current_plan_mrr', 'mrr'), link('price', 'churn')] }, false, NODES2)!;
    expect(record.prior_withheld).toBe(true);
    expect(record.attribution_case).toBe('C2_unpaired');
    // The code line still credits them TOGETHER, as the chip says it.
    expect(record.code_line).toContain(RERUN_FALLBACK_LINES.unwithheld);
  });
  it('CONTROL: the same pair with ONE change keeps C1_attributable', () => {
    const record = rerunRecordForModel({ ...SERVED_PAIR, attribution_case: 'C1_attributable', input_changes: [link('current_plan_mrr', 'mrr')] }, false, NODES2)!;
    expect(record.attribution_case).toBe('C1_attributable');
  });
});

describe('the record\'s rule: how the typed answer uses it', () => {
  it('reads "since the last run" as the latest Run against the one before, and never lets "nothing changed" stand beside a named change', () => {
    expect(TYPED_RERUN_RECORD_RULE).toContain('“Since the last run” means the latest Run against the one before it');
    expect(TYPED_RERUN_RECORD_RULE).toContain('Never say nothing changed when code_line names a change.');
    expect(TYPED_RERUN_RECORD_RULE).toContain('first say code_line exactly');
    expect(TYPED_RERUN_RECORD_RULE).toContain('If prior_withheld is true, never say anything rose, fell or moved.');
    expect(TYPED_RERUN_RECORD_RULE).toContain('Unless attribution_case is C1_attributable, never say which change caused the difference.');
  });

  it('names EVERY remaining link by necessity, ranking none, never as a value-of-information choice (d5 (c))', () => {
    expect(TYPED_RERUN_RECORD_RULE).toContain('name every link in unsized_goal_path_links as what the comparison still needs, ranking none');
    expect(TYPED_RERUN_RECORD_RULE).not.toMatch(/\bVOI\b|value of information|most valuable|most useful|highest.value/i);
  });

  it('carries no recommend stem and no contest word', () => {
    expect(TYPED_RERUN_RECORD_RULE).not.toMatch(/recommend|\bbest\b|\bwinner\b|\bleads\b|\bahead\b/i);
  });
});
