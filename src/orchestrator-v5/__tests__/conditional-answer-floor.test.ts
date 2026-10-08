import { afterEach, describe, expect, it, vi } from 'vitest';
import { appendCheckedGraphWrite } from '../persist-graph-write.js';
import { createNoopSessionStore } from '../session/__tests__/fixtures.js';
import type { PendingAction } from '../session/pending-action.js';
import type { ConditionalAppendOptions, ConditionalSessionAppendOutcome, SessionAppendOutcome, SessionTurnWrite } from '../session/store.js';
import { log } from '../../utils/telemetry.js';

const SCENARIO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const held = (chip: string): PendingAction => ({ id: chip, scenario_id: SCENARIO, chip_id: chip,
  action: { kind: 'run_analysis' }, preconditions: {}, expires_at_turn_count: 12,
  emitted_at_iso: '2026-10-07T00:00:00Z', expires_at_iso: '2026-10-08T00:00:00Z' });
// The arrival was minted after the hold (S-D slice 2 orders held items oldest first within the row).
const hold = held('hold-a'), arrival: PendingAction = { ...held('hold-b'), emitted_at_iso: '2026-10-07T00:00:01Z' };
const scope: PendingAction = { ...held('scope'), action: { kind: 'reconcile_goal_scope', goal_id: 'g', goal_label: 'MRR',
  expected: 'scope', question: 'Which scope?', operands: [], derivations: [] } };
const answer = (pending: readonly PendingAction[]): SessionTurnWrite => ({ scenario_id: SCENARIO, turn_id: 'answer',
  turn_class: 'direct_answer', handler_id: null, request_hash: 'agent_turn:digest', response_emitted: true,
  llm_calls_used: 0, duration_ms: 1, handler_facts: [], assistantMessage: 'Here is your answer.', pending_actions: pending });
const clarification = (chip: string, second: number): PendingAction & {
  action: Extract<PendingAction['action'], { kind: 'elicit_link_effect_clarification' }>;
} => ({ ...held(chip),
  emitted_at_iso: `2026-10-06T00:00:0${second}Z`,
  expires_at_iso: '2099-10-08T00:00:00Z',
  action: { kind: 'elicit_link_effect_clarification', from_id: chip, to_id: 'churn', from_label: chip,
    to_label: 'Monthly churn', quote: 'Churn will rise by at least 1%.', question: 'Points or relative?',
    refusal: 'unit_mismatch', value_text: 'at least 1%' } });

// Stage the other request INSIDE append, after the floor's read. Compare row ids,
// never action counts: equal payloads on different rows still mean latest_moved.
function setup(initial: readonly PendingAction[], moves: readonly (readonly PendingAction[])[]) {
  let row = { id: 'row-0', pending: initial };
  let attempt = 0;
  const written: SessionTurnWrite[] = [];
  const calls: { write: SessionTurnWrite; options?: ConditionalAppendOptions }[] = [];
  async function appendAny(write: SessionTurnWrite, options?: ConditionalAppendOptions): Promise<ConditionalSessionAppendOutcome> {
    calls.push({ write, ...(options ? { options } : {}) });
    if (options) {
      const next = moves[attempt++];
      if (next !== undefined) row = { id: `row-${attempt}`, pending: next };
      if (options.expectedLatestRowId !== row.id) return { status: 'latest_moved' };
    }
    written.push(write);
    return { id: 'answer-row' };
  }
  const store = createNoopSessionStore();
  store.append = async (write: SessionTurnWrite): Promise<SessionAppendOutcome> => appendAny(write) as Promise<SessionAppendOutcome>;
  store.appendIfLatest = (write: SessionTurnWrite, options: ConditionalAppendOptions) => appendAny(write, options);
  store.readMostRecentPendingActions = vi.fn(async (_scenario, options) => {
    options?.onLatestRowId?.(row.id);
    return row.pending;
  });
  const run = (write: SessionTurnWrite) => appendCheckedGraphWrite({ store, write, writesGraph: false,
    heldProposals: { isHeld: p => p.chip_id.startsWith('hold-'), seenByThisRequest: new Set(initial.map(p => p.chip_id)) } });
  return { store, written, calls, run };
}

afterEach(() => vi.restoreAllMocks());

describe('S-D.1b conditional answer floor', () => {
  it('S-D slice 2 x S-D.1b: the held reconciliation callback runs on EVERY attempt and only the last attempt is written', async () => {
    const s = setup([hold], [[]]);
    const seen: string[][] = [];
    const run = (write: SessionTurnWrite) => appendCheckedGraphWrite({ store: s.store, write, writesGraph: false,
      heldProposals: { isHeld: p => p.chip_id.startsWith('hold-'), seenByThisRequest: new Set([hold.chip_id]),
        onReconciled: (w) => { seen.push((w.pending_actions ?? []).map(p => p.chip_id)); return { ...w, assistantMessage: `attempt ${seen.length}` }; } } });
    expect(await run(answer([hold]))).toEqual({ id: 'answer-row' });
    expect(seen, 'attempt 1 saw the hold; attempt 2 (after the decline landed) did not').toEqual([['hold-a'], []]);
    expect(s.written).toHaveLength(1);
    expect(s.written[0]?.assistantMessage).toBe('attempt 2');
  });

  it('Not now between read and append: retry never resurrects the declined hold', async () => {
    const s = setup([hold], [[]]);
    expect(await s.run(answer([hold]))).toEqual({ id: 'answer-row' });
    expect(s.calls.map(c => c.options?.expectedLatestRowId)).toEqual(['row-0', 'row-1']);
    expect(s.written).toHaveLength(1);
    expect(s.written[0]?.pending_actions).toEqual([]);
    expect(s.written[0]?.assistantMessage).toBe('Here is your answer.');
  });

  it('arrival between read and append: retry carries the exact newly minted hold and scope issue', async () => {
    const s = setup([hold], [[hold, arrival, scope]]);
    await s.run(answer([hold]));
    expect(s.calls.map(c => c.options?.expectedLatestRowId)).toEqual(['row-0', 'row-1']);
    expect(s.written[0]?.pending_actions).toEqual([scope, hold, arrival]);
    expect(s.written[0]?.pending_actions?.[2]).toBe(arrival);
  });

  it('RC2 F6 RED: a slow answer prepared without an ask preserves the fast request’s fresh clarification', async () => {
    const fresh = clarification('effect-fresh', 2);
    // The slow caller prepared its empty list before the fast request wrote this latest row.
    const s = setup([fresh], []);
    await appendCheckedGraphWrite({ store: s.store, write: answer([]), writesGraph: false,
      heldProposals: { isHeld: p => p.chip_id.startsWith('hold-'), seenByThisRequest: new Set() } });
    expect(s.written).toHaveLength(1);
    expect(s.written[0]?.pending_actions).toEqual([fresh]);
    expect(s.written[0]?.pending_actions?.[0]).toBe(fresh);
  });

  it('RC2 F6 RED: a clarification arriving after the slow read survives the CAS retry', async () => {
    const fresh = clarification('effect-fresh', 2);
    const s = setup([], [[fresh]]);
    await s.run(answer([]));
    expect(s.calls.map(c => c.options?.expectedLatestRowId)).toEqual(['row-0', 'row-1']);
    expect(s.written).toHaveLength(1);
    expect(s.written[0]?.pending_actions).toEqual([fresh]);
    expect(s.written[0]?.pending_actions?.[0]).toBe(fresh);
  });

  it('RC2 F6 RED: arriving clarifications stay below cards and name the oldest clarification’s capacity lapse', async () => {
    const old = clarification('effect-old', 0), fresh = clarification('effect-fresh', 2);
    const s = setup([old, hold, arrival], [[old, hold, arrival, fresh]]);
    const lapses: (readonly PendingAction[])[] = [];
    await appendCheckedGraphWrite({ store: s.store, write: answer([old, hold, arrival]), writesGraph: false,
      heldProposals: { isHeld: p => p.chip_id.startsWith('hold-'), seenByThisRequest: new Set([hold.chip_id, arrival.chip_id]),
        onReconciled: (w, _holds, clarifications: readonly PendingAction[]) => {
          lapses.push(clarifications); return w;
        } } });
    expect(s.written[0]?.pending_actions).toEqual([fresh, hold, arrival]);
    expect(lapses).toEqual([[], [old]]);
  });

  it('RC2 F6 CONTROL: this request’s consumed clarification is never re-added from its earlier row', async () => {
    const seen = clarification('effect-seen', 0);
    const s = setup([seen], []);
    await s.run(answer([]));
    expect(s.written[0]?.pending_actions).toEqual([]);
  });

  it.each([false, true])('RC2a r2 P1: another request’s consumed clarification is not resurrected (CAS retry: %s)', async retry => {
    const consumed = clarification('effect-consumed', 0);
    // The slow caller saw this question, but the other request consumed it before the final read or during append.
    const s = setup(retry ? [consumed] : [], retry ? [[]] : []);
    const reconciled: string[][] = [];
    await appendCheckedGraphWrite({ store: s.store, write: answer([consumed]), writesGraph: false,
      heldProposals: { isHeld: p => p.chip_id.startsWith('hold-'), seenByThisRequest: new Set([consumed.chip_id]),
        onReconciled: w => { reconciled.push((w.pending_actions ?? []).map(p => p.chip_id)); return w; } } });
    expect(s.calls.map(c => c.options?.expectedLatestRowId)).toEqual(retry ? ['row-0', 'row-1'] : ['row-0']);
    expect(reconciled).toEqual(retry ? [[consumed.chip_id], []] : [[]]);
    expect(s.written).toHaveLength(1);
    expect(s.written[0]?.pending_actions).toEqual([]);
  });

  it('RC2a r2 P1: final fallback read still drops a concurrently consumed clarification after three CAS moves', async () => {
    const consumed = clarification('effect-consumed', 0);
    const s = setup([consumed], [[consumed], [consumed], []]);
    await s.run(answer([consumed]));
    expect(s.calls.map(c => c.options?.expectedLatestRowId)).toEqual(['row-0', 'row-1', 'row-2', undefined]);
    expect(s.written).toHaveLength(1);
    expect(s.written[0]?.pending_actions).toEqual([]);
  });

  it('RC2a Run CONTROL: a question carried by the inner Run row remains present for the outer answer', async () => {
    const question = clarification('effect-run-carried', 0);
    // The real Run success commit threads priorPendingActions, carrying this same chip onto its own row.
    const innerRunCarrier: PendingAction = { ...question, expires_at_turn_count: question.expires_at_turn_count - 1 };
    const s = setup([innerRunCarrier], []);
    const write = answer([question]);
    await appendCheckedGraphWrite({ store: s.store, write, writesGraph: false,
      heldProposals: { isHeld: p => p.chip_id.startsWith('hold-'), seenByThisRequest: new Set([question.chip_id]) } });
    expect(s.written).toHaveLength(1);
    expect(s.written[0]).toBe(write);
    expect(s.written[0]?.pending_actions).toEqual([question]);
  });

  it.each([false, true])('RC2a r2 P2: an older same-link arrival never replaces this response’s newer words (CAS retry: %s)', async retry => {
    const newer = clarification('effect-newer', 2);
    const older: PendingAction = { ...clarification('effect-older', 0),
      action: { ...newer.action, quote: 'Churn will rise by 5%.', question: 'Older question', value_text: '5%' } };
    // This response minted newer words; it had never seen the old row the other request later wrote.
    const s = setup(retry ? [] : [older], retry ? [[older]] : []);
    await appendCheckedGraphWrite({ store: s.store, write: answer([newer]), writesGraph: false,
      heldProposals: { isHeld: p => p.chip_id.startsWith('hold-'), seenByThisRequest: new Set() } });
    expect(s.calls.map(c => c.options?.expectedLatestRowId)).toEqual(retry ? ['row-0', 'row-1'] : ['row-0']);
    expect(s.written).toHaveLength(1);
    expect(s.written[0]?.pending_actions).toEqual([newer]);
    expect(s.written[0]?.pending_actions?.[0]).toBe(newer);
  });

  it.each([false, true])('RC2a P1/P2: consuming a newer carried ask cannot restore an older same-link arrival (CAS retry: %s)', async retry => {
    const newer = clarification('effect-newer-seen', 2);
    const older: PendingAction = { ...clarification('effect-older-arriving', 0),
      action: { ...newer.action, quote: 'Churn will rise by 5%.', question: 'Older question', value_text: '5%' } };
    const s = setup(retry ? [newer] : [older], retry ? [[older]] : []);
    await appendCheckedGraphWrite({ store: s.store, write: answer([newer]), writesGraph: false,
      heldProposals: { isHeld: p => p.chip_id.startsWith('hold-'), seenByThisRequest: new Set([newer.chip_id]) } });
    expect(s.calls.map(c => c.options?.expectedLatestRowId)).toEqual(retry ? ['row-0', 'row-1'] : ['row-0']);
    expect(s.written).toHaveLength(1);
    // Presence pruning retires the consumed newer ask; temporal ordering rejects the stale arrival.
    expect(s.written[0]?.pending_actions).toEqual([]);
  });

  it('RC2a P2 CONTROL: a same-time distinct-statement arrival cannot replace the question this response prepared', async () => {
    const prepared = clarification('effect-prepared', 2);
    const sameTime: PendingAction = { ...clarification('effect-same-time', 2),
      action: { ...prepared.action, quote: 'Churn will rise by 5 points.', question: 'Other question' } };
    const s = setup([sameTime], []);
    await appendCheckedGraphWrite({ store: s.store, write: answer([prepared]), writesGraph: false,
      heldProposals: { isHeld: p => p.chip_id.startsWith('hold-'), seenByThisRequest: new Set() } });
    expect(s.written[0]?.pending_actions).toEqual([prepared]);
  });

  it('RC2a context-only CONTROL: refused reported wording survives an unknown graph read without assertion classification', async () => {
    const fresh: PendingAction = { ...clarification('effect-report', 2), action: {
      ...clarification('effect-report', 2).action,
      quote: 'A colleague says that Churn will rise by 5%.', value_text: '5%',
    } };
    const s = setup([], [[fresh]]);
    await s.run(answer([]));
    expect(s.written[0]?.pending_actions).toEqual([fresh]);
  });

  it('RC2 F6 CONTROL: an arriving question replaces only the same exact pair and preserves a shared-target question', async () => {
    const old = clarification('effect-old', 0), unrelated = clarification('effect-unrelated', 1);
    const fresh: PendingAction = { ...clarification('effect-fresh', 2),
      action: { ...old.action, question: 'What is your best single guess?' } };
    const s = setup([old, unrelated], [[old, unrelated, fresh]]);
    await s.run(answer([old, unrelated]));
    expect(s.written[0]?.pending_actions).toEqual([unrelated, fresh]);
  });

  it('RC2 F6 CONTROL: an expired clarification arriving during the slow answer is not carried', async () => {
    const expired: PendingAction = { ...clarification('effect-expired', 2), expires_at_iso: '2000-01-01T00:00:00Z' };
    const s = setup([], [[expired]]);
    await s.run(answer([]));
    expect(s.written[0]?.pending_actions).toEqual([]);
  });

  it('RC2 C3 RED: a held proposal arriving at append lapses the oldest clarification and reports it beside held lapses', async () => {
    const effects = [clarification('effect-old', 0), clarification('effect-middle', 1), clarification('effect-new', 2)];
    const s = setup(effects, [[...effects, arrival]]);
    const lapses: { holds: readonly PendingAction[]; clarifications: readonly PendingAction[] }[] = [];
    await appendCheckedGraphWrite({ store: s.store, write: answer([effects[2]!, effects[0]!, effects[1]!]), writesGraph: false,
      heldProposals: { isHeld: p => p.chip_id.startsWith('hold-'), seenByThisRequest: new Set(),
        onReconciled: (w, holds, clarifications: readonly PendingAction[]) => {
          lapses.push({ holds, clarifications: clarifications ?? [] });
          return w;
        } } });
    expect(s.written).toHaveLength(1);
    expect(s.written[0]?.pending_actions).toEqual([effects[1], effects[2], arrival]);
    expect(lapses).toEqual([{ holds: [], clarifications: [] }, { holds: [], clarifications: [effects[0]] }]);
    expect(s.written[0]?.assistantMessage).toBe('Here is your answer.'); // The route owes the named lapse on its next reply.
  });

  it('RC2 C3 CONTROL: a clarification cut on an obsolete retry is not reported as lapsed by the final append', async () => {
    const effects = [clarification('effect-old', 0), clarification('effect-middle', 1), clarification('effect-new', 2)];
    const s = setup(effects, [[...effects, arrival], effects]);
    const lapses: (readonly PendingAction[])[] = [];
    await appendCheckedGraphWrite({ store: s.store, write: answer(effects), writesGraph: false,
      heldProposals: { isHeld: p => p.chip_id.startsWith('hold-'), seenByThisRequest: new Set(),
        onReconciled: (w, _holds, clarifications: readonly PendingAction[]) => {
          lapses.push([...(clarifications ?? [])]);
          return w;
        } } });
    expect(s.calls).toHaveLength(3);
    expect(s.written[0]?.pending_actions).toEqual(effects);
    expect(lapses).toEqual([[], [effects[0]], []]);
  });

  it('CONTROL: stable row means one append with unchanged bytes and object identity', async () => {
    const s = setup([hold], []), write = answer([hold]);
    const bytes = JSON.stringify(write);
    await s.run(write);
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0]?.options).toEqual({ expectedLatestRowId: 'row-0' });
    expect(s.written[0]).toBe(write);
    expect(JSON.stringify(s.written[0])).toBe(bytes);
  });

  it('three moved rows: exactly three conditional attempts, then unconditional answer and warning', async () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => undefined);
    const s = setup([hold], [[hold], [hold], [hold]]);
    expect(await s.run(answer([hold]))).toEqual({ id: 'answer-row' });
    expect(s.calls.map(c => c.options?.expectedLatestRowId)).toEqual(['row-0', 'row-1', 'row-2', undefined]);
    expect(s.written).toHaveLength(1);
    expect(s.written[0]?.assistantMessage).toBe('Here is your answer.');
    expect(warn).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ event: 'v5.agent_answer.latest_moved_exhausted' }), expect.any(String));
  });

  it('retry reconciles from the original request, so a temporarily absent hold can return on a fresh row', async () => {
    const s = setup([hold], [[], [hold]]);
    await s.run(answer([hold]));
    expect(s.calls).toHaveLength(3);
    expect(s.written[0]?.pending_actions).toEqual([hold]);
  });

  it('retry discards scope issues merged from an obsolete row', async () => {
    const s = setup([hold, scope], [[hold]]);
    await s.run(answer([hold]));
    expect(s.written[0]?.pending_actions).toEqual([hold]);
  });

  it('CONTROL: callers without heldProposals retain the ordinary append', async () => {
    const s = setup([hold], []), write = answer([hold]);
    await appendCheckedGraphWrite({ store: s.store, write, writesGraph: false });
    expect(s.calls).toEqual([{ write }]);
  });
});
