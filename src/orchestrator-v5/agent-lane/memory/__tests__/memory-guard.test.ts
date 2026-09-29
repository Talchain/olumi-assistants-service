/**
 * EXPERIMENT (exp/mem0-context-spike-20260929): the deterministic guard between recalled words and the Agent.
 * Canonical state wins; anything the guard cannot order safely is dropped (fail closed).
 */
import { describe, expect, it } from 'vitest';
import { guardMemories, type RecalledMemory } from '../memory-guard.js';

const SCENARIO = 'scn-a';
const USER = 'olumi-poc-paul';
const REV_NOW = 'rev-now';
const REV_OLD = 'rev-old';

/** A canonical state in `getCanonicalState`'s shape: £50 price, 5% churn, a moderate price→churn link, a stale run. */
const state = {
  ok: true,
  graph_revision: REV_NOW,
  entities: [
    { id: 'f_price', label: 'Monthly price', kind: 'factor', value: 50, raw_value: 50, display_value: '£50', unit: 'GBP' },
    { id: 'f_churn', label: 'Monthly churn', kind: 'factor', value: 0.05, display_value: '5%' },
    { id: 'o_mrr', label: 'MRR', kind: 'outcome', value: null },
  ],
  links: [{ from: 'f_price', to: 'f_churn', band: 'moderate' }],
  analysis: { earlier_analysis: 'complete_stale', run_state: { kind: 'complete_stale', computed_at: '2026-09-29T10:00:00Z', cause: 'graph_changed' } },
};

const mem = (over: Partial<RecalledMemory> & { memory_id: string; user_words: string }): RecalledMemory => ({
  scenario_id: SCENARIO, user_id: USER, said_at: '2026-09-29T11:00:00Z', graph_revision_at_time: REV_NOW, verbatim: true, ...over,
});
const run = (ms: RecalledMemory[], s: unknown = state) => guardMemories(ms, { scenarioId: SCENARIO, userId: USER, state: s });

describe('memory guard — canonical state stays authoritative', () => {
  it('keeps a clean qualitative answer, and says when it agrees with the model', () => {
    const r = run([mem({ memory_id: 'm1', user_words: 'It is a moderate effect.', answered_question: 'How strongly does price affect churn?' })]);
    expect(r.kept.map((k) => k.memory_id)).toEqual(['m1']);
    expect(r.kept[0]).toMatchObject({ authoritative: false, source: 'mem0', scope: 'scenario', agrees_with_model_state: true });
    expect(r.suppressed).toEqual([]);
  });

  it('D: a remembered £49 against canonical £50, revision MOVED → suppressed; £49 never reaches the Agent', () => {
    const r = run([mem({ memory_id: 'm49', user_words: 'Set the monthly price to £49', graph_revision_at_time: REV_OLD })]);
    expect(r.kept).toEqual([]);
    expect(r.discrepancies).toEqual([]);
    expect(r.suppressed).toEqual([{ memory_id: 'm49', reason: 'figure_conflict_revision_moved' }]);
  });

  it('D′: the same £49, revision UNCHANGED (never absorbed) → an unreconciled question, with £50 as what the model holds', () => {
    const r = run([mem({ memory_id: 'm49', user_words: 'Our monthly price is really £49' })]);
    expect(r.kept).toEqual([]);
    expect(r.discrepancies).toEqual([expect.objectContaining({ memory_id: 'm49', about: 'Monthly price', user_said: '£49', model_holds: '£50' })]);
    expect(r.discrepancies[0]!.status).toMatch(/never assume either/);
  });

  it('a figure that matches the model (5% as 0.05) is kept as agreeing', () => {
    const r = run([mem({ memory_id: 'm5', user_words: 'Monthly churn is about 5%' })]);
    expect(r.kept[0]).toMatchObject({ memory_id: 'm5', agrees_with_model_state: true });
  });

  it('a mismatched figure that names no one entity is dropped (cannot attribute → fail closed)', () => {
    const r = run([mem({ memory_id: 'mx', user_words: 'Budget is £12,000' })]);
    expect(r.suppressed).toEqual([{ memory_id: 'mx', reason: 'figure_unattributable' }]);
  });

  it('E: a remembered analysis claim while the run is complete_stale → suppressed', () => {
    const r = run([mem({ memory_id: 'ma', user_words: 'The analysis shows the premium option wins' })]);
    expect(r.suppressed).toEqual([{ memory_id: 'ma', reason: 'analysis_claim_not_current' }]);
  });

  it('E′: even with a current run, an analysis claim said BEFORE the run was computed is suppressed', () => {
    const current = { ...state, analysis: { earlier_analysis: 'complete_current', run_state: { kind: 'complete_current', computed_at: '2026-09-29T12:00:00Z' } } };
    const r = run([mem({ memory_id: 'ma', user_words: 'The results show option B leads' })], current);
    expect(r.suppressed[0]!.reason).toBe('analysis_claim_not_current');
  });

  it('F: a remembered approval never survives — an earlier yes does not carry to a new change', () => {
    const r = run([
      mem({ memory_id: 'ok1', user_words: 'Yes, apply it' }),
      mem({ memory_id: 'ok2', user_words: 'I approve the churn change' }),
      mem({ memory_id: 'ok3', user_words: 'go ahead and save it' }),
    ]);
    expect(r.kept).toEqual([]);
    expect(r.suppressed.map((s) => s.reason)).toEqual(['approval_not_transferable', 'approval_not_transferable', 'approval_not_transferable']);
  });

  it('C: a hit from another scenario or another subject is dropped, whatever the vendor returned', () => {
    const r = run([
      mem({ memory_id: 'other-scn', user_words: 'Our warehouse lease ends in March', scenario_id: 'scn-b' }),
      mem({ memory_id: 'other-user', user_words: 'Our warehouse lease ends in March', user_id: 'someone-else' }),
      mem({ memory_id: 'no-scope', user_words: 'Our warehouse lease ends in March', scenario_id: undefined }),
    ]);
    expect(r.kept).toEqual([]);
    expect(r.suppressed.every((s) => s.reason === 'scope_mismatch')).toBe(true);
  });

  it('band: "strong" against a canonical moderate link — revision moved → suppressed; unchanged → unreconciled', () => {
    const q = 'How strongly does the monthly price affect churn?';
    const moved = run([mem({ memory_id: 'b1', user_words: 'strong', answered_question: q, graph_revision_at_time: REV_OLD })]);
    expect(moved.suppressed).toEqual([{ memory_id: 'b1', reason: 'band_conflict_revision_moved' }]);
    const same = run([mem({ memory_id: 'b1', user_words: 'strong', answered_question: q })]);
    expect(same.discrepancies[0]).toMatchObject({ user_said: 'strong', model_holds: 'moderate' });
  });

  it('B: two statements about the same link — only the newest survives (the correction dominates)', () => {
    const q = 'How strongly does price affect churn?';
    const r = run([
      mem({ memory_id: 'old', user_words: 'strong', answered_question: q, said_at: '2026-09-29T10:30:00Z' }),
      mem({ memory_id: 'new', user_words: 'Actually it is moderate', answered_question: q, said_at: '2026-09-29T10:45:00Z' }),
    ]);
    expect(r.kept.map((k) => k.memory_id)).toEqual(['new']);
    expect(r.suppressed).toEqual([{ memory_id: 'old', reason: 'superseded_by_newer' }]);
  });

  it('a question quoting a figure the model does not hold is dropped; the user\u2019s correction travels alone', () => {
    const r = run([mem({ memory_id: 'c', user_words: 'Sorry, I misread it. Monthly churn is 5%.', answered_question: 'Shall I set monthly churn to 9%?' })]);
    expect(r.kept[0]).toMatchObject({ memory_id: 'c', agrees_with_model_state: true });
    expect(r.kept[0]!.answered_question).toBeUndefined();
  });

  it('a vendor paraphrase (infer=true) that merges a correction with the stale figure never raises a discrepancy', () => {
    const r = run([mem({ memory_id: 'p', user_words: 'User initially thought monthly churn was 9% before correcting it to 5%', verbatim: false })]);
    expect(r.discrepancies).toEqual([]);
    expect(r.suppressed).toEqual([{ memory_id: 'p', reason: 'paraphrase_conflict_unverifiable' }]);
  });

  it('malformed or absent state never throws; figures it cannot verify are dropped', () => {
    const r = run([mem({ memory_id: 'm', user_words: 'Monthly price is £49' }), mem({ memory_id: 'q', user_words: 'We sell to SMEs mostly' })], null);
    expect(r.kept.map((k) => k.memory_id)).toEqual(['q']);
    expect(r.suppressed).toEqual([{ memory_id: 'm', reason: 'figure_unattributable' }]);
  });
});
