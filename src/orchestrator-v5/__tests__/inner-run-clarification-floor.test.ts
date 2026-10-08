import { afterEach, describe, expect, it, vi } from 'vitest';
import { commitDirectAnswer } from '../commit.js';
import { composeDirectAnswerResponse } from '../compose.js';
import { appendCheckedGraphWrite } from '../persist-graph-write.js';
import { reviseLinkEffectClarification, type LinkEffectClarificationPending } from '../agent-lane/link-effect-clarification.js';
import { GM_HELD_HANDLER_ID } from '../handlers/edit-graph-referee-gate.js';
import { runAsAgentSubturn } from '../session/agent-subturn-context.js';
import { createNoopSessionStore } from '../session/__tests__/fixtures.js';
import type { PendingAction } from '../session/pending-action.js';
import type { ConditionalAppendOptions, ConditionalSessionAppendOutcome, SessionAppendOutcome, SessionTurnWrite } from '../session/store.js';

vi.mock('../rolling-summary/capture.js', () => ({ maintainRollingSummaryForCommit: vi.fn(async () => undefined) }));

const SCENARIO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const GRAPH_HASH = 'sha256:unchanged-graph';
const question: LinkEffectClarificationPending = {
  id: 'ask-a', scenario_id: SCENARIO, chip_id: 'agent-link-effect-clarification:ask-a',
  action: { kind: 'elicit_link_effect_clarification', from_id: 'price', to_id: 'margin', from_label: 'Café price',
    to_label: 'Gross margin', quote: 'Raising the café price by £1 will increase gross margin by at least 5%',
    question: 'Points or relative?', refusal: 'unit_mismatch', value_text: 'at least 5%' },
  preconditions: { target_entity_ids: ['price', 'margin'] }, expires_at_turn_count: 6,
  emitted_at_iso: '2026-10-08T10:00:00.000Z', expires_at_iso: '2099-10-09T10:00:00.000Z',
};

/** Card preparation consumes the ask on a new turn row without changing the graph's CAS hashes. */
function concurrentStore(initial: readonly PendingAction[], moves: readonly (readonly PendingAction[])[] = []) {
  let row = { id: 'row-0', pending: initial };
  let attempt = 0;
  const written: SessionTurnWrite[] = [];
  const calls: { write: SessionTurnWrite; options?: ConditionalAppendOptions }[] = [];
  async function append(write: SessionTurnWrite, options?: ConditionalAppendOptions): Promise<ConditionalSessionAppendOutcome> {
    calls.push({ write, ...(options ? { options } : {}) });
    if (options) {
      const next = moves[attempt++];
      if (next !== undefined) row = { id: `row-${attempt}`, pending: next };
      if (row.id !== options.expectedLatestRowId) return { status: 'latest_moved' };
    }
    written.push(write);
    row = { id: 'inner-run-row', pending: write.pending_actions ?? [] };
    return { id: row.id };
  }
  const store = createNoopSessionStore();
  store.append = write => append(write) as Promise<SessionAppendOutcome>;
  store.appendIfLatest = (write, options) => append(write, options);
  store.readMostRecentPendingActions = vi.fn(async (_scenario, options) => {
    options?.onLatestRowId?.(row.id);
    return row.pending;
  });
  return { store, written, calls };
}

const run = (store: ReturnType<typeof concurrentStore>['store'], prior: readonly PendingAction[], own: readonly PendingAction[] = []) =>
  runAsAgentSubturn(SCENARIO, () => commitDirectAnswer(
    composeDirectAnswerResponse({ answerKind: 'functional', assistant_text: 'Analysis completed.', stage: 'analyse' }),
    { scenario_id: SCENARIO, turn_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', turn_class: 'handler',
      handler_id: 'run_analysis', request_hash: 'sha256:slow-run', llm_calls_used: 0, duration_ms: 1, handler_facts: [],
      graph_hash: GRAPH_HASH, expectedGraphIdentityHash: GRAPH_HASH, expectedGraphAnalysisHash: GRAPH_HASH,
      priorPendingActions: prior, pending_actions: own }, store));

afterEach(() => vi.restoreAllMocks());

describe('RC2a r3 P1: inner Run commits reconcile live clarifications at the persistence floor', () => {
  it.each([false, true])('RED reviewer row: slow Run snapshots A; card preparation consumes A without graph CAS movement (after floor read: %s)', async retry => {
    const s = concurrentStore(retry ? [question] : [], retry ? [[]] : []);
    await run(s.store, [question]);
    expect(s.written).toHaveLength(1);
    expect(s.written[0]?.expectedGraphIdentityHash).toBe(GRAPH_HASH);
    expect(s.written[0]?.expectedGraphAnalysisHash).toBe(GRAPH_HASH);
    expect(s.written[0]?.pending_actions, 'inner Run cannot restore the ask that the other request consumed').toEqual([]);
    expect(s.calls.map(c => c.options?.expectedLatestRowId)).toEqual(retry ? ['row-0', 'row-1'] : ['row-0']);
    expect(s.written[0]?.assistantMessage).toBeUndefined();

    const innerWriteCount = s.written.length;
    await appendCheckedGraphWrite({ store: s.store, writesGraph: false,
      write: { scenario_id: SCENARIO, turn_id: 'outer-answer', turn_class: 'direct_answer', handler_id: null,
        request_hash: 'sha256:outer-answer', response_emitted: true, llm_calls_used: 0, duration_ms: 1,
        handler_facts: [], pending_actions: [question] },
      heldProposals: { isHeld: () => false, seenByThisRequest: new Set([question.chip_id]) } });
    expect(s.written[innerWriteCount]?.pending_actions, 'the outer answer cannot inherit a resurrected inner carrier').toEqual([]);
  });

  it('CONTROL: an unchanged latest ask survives the inner Run with the existing lifetime decrement', async () => {
    const s = concurrentStore([question]);
    await run(s.store, [question]);
    expect(s.written[0]?.pending_actions).toEqual([{ ...question, expires_at_turn_count: question.expires_at_turn_count - 1 }]);
  });

  it('CONTROL: a clarification minted by this commit is retained even though the latest row has never seen it', async () => {
    const s = concurrentStore([]);
    await run(s.store, [], [question]);
    expect(s.written[0]?.pending_actions).toHaveLength(1);
    expect(s.written[0]?.pending_actions?.[0]?.chip_id).toBe(question.chip_id);
  });

  it.each([false, true])('P2 reviewer supplemental: fast points revision survives a slow answer carrying original A (after floor read: %s)', async retry => {
    const fast = reviseLinkEffectClarification(question, { ...question.action, resolved_reading: 'points',
      question: 'What is your best single guess, and the lowest and highest it could plausibly be?',
      floor: { value: 5, unit: 'percentage points', reading: 'points', words: 'at least 5%',
        per_source_change: 1, per_source_change_unit: 'GBP', reading_answer: 'points' } }, question.emitted_at_iso);
    const s = concurrentStore(retry ? [question] : [fast], retry ? [[fast]] : []);
    await appendCheckedGraphWrite({ store: s.store, writesGraph: false,
      write: { scenario_id: SCENARIO, turn_id: 'slow-answer', turn_class: 'direct_answer', handler_id: null,
        request_hash: 'sha256:slow-answer', response_emitted: true, llm_calls_used: 0, duration_ms: 1,
        handler_facts: [], pending_actions: [question] },
      heldProposals: { isHeld: () => false, seenByThisRequest: new Set([question.chip_id]) } });
    expect(s.written[0]?.pending_actions).toEqual([fast]);
    expect(s.written[0]?.pending_actions?.[0]).toBe(fast);
    expect(s.calls.map(c => c.options?.expectedLatestRowId)).toEqual(retry ? ['row-0', 'row-1'] : ['row-0']);
  });

  it('P2 inner Run CONTROL: the newest same-link revision survives the slow Run carrier', async () => {
    const fast = reviseLinkEffectClarification(question, { ...question.action, resolved_reading: 'points',
      question: 'Give a current guess and range.' }, question.emitted_at_iso);
    const s = concurrentStore([fast]);
    await run(s.store, [question]);
    expect(s.written[0]?.pending_actions).toEqual([fast]);
  });

  it('RC2a audit RED cap: a clarification arriving at an inner commit cannot displace its prepared held cards', async () => {
    const holds: PendingAction[] = ['1', '2', '3'].map(digit => {
      const chip = `gmh_${digit.padStart(12, '0')}`;
      return { ...question, id: chip, chip_id: chip, action: { kind: 'apply_proposed_change', proposal_ref: chip,
        inline_patch: { handler_id: GM_HELD_HANDLER_ID, operations: [], operations_count: 0 },
        public_label: 'Approve the change', public_message: 'Yes, apply the change.' },
      preconditions: { graph_hash: GRAPH_HASH } };
    });
    const s = concurrentStore([question]);
    await run(s.store, [], holds);
    expect(s.written[0]?.pending_actions, 'clarification-only reconciliation preserves held-card priority').toEqual(holds);
  });

  it.each([false, true])('RC2a audit RED tie: latest durable same-source revision wins a same-ms sibling (after floor read: %s)', async retry => {
    const emitted = '2026-10-08T10:00:00.001Z';
    // Independent updates from the same original can receive the same emitted_at despite distinct revision ids.
    const slow: LinkEffectClarificationPending = { ...question, id: 'slow-revision',
      chip_id: 'agent-link-effect-clarification:slow-revision', emitted_at_iso: emitted,
      action: { ...question.action, question: 'Do you mean points or relative?' } };
    const fast: LinkEffectClarificationPending = { ...question, id: 'fast-revision',
      chip_id: 'agent-link-effect-clarification:fast-revision', emitted_at_iso: emitted,
      action: { ...question.action, resolved_reading: 'points', question: 'Give a current guess and range.' } };
    const s = concurrentStore(retry ? [question] : [fast], retry ? [[fast]] : []);
    await appendCheckedGraphWrite({ store: s.store, writesGraph: false,
      write: { scenario_id: SCENARIO, turn_id: 'slow-sibling-answer', turn_class: 'direct_answer', handler_id: null,
        request_hash: 'sha256:slow-sibling-answer', response_emitted: true, llm_calls_used: 0, duration_ms: 1,
        handler_facts: [], pending_actions: [slow] },
      heldProposals: { isHeld: () => false, seenByThisRequest: new Set([question.chip_id]) } });
    expect(s.written[0]?.pending_actions, 'the canonical durable reading cannot be overwritten by an equal-time sibling').toEqual([fast]);
    expect(s.calls.map(c => c.options?.expectedLatestRowId)).toEqual(retry ? ['row-0', 'row-1'] : ['row-0']);
  });
});
