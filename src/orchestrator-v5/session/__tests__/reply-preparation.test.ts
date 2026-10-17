import { describe, expect, it, vi } from 'vitest';
import { SupabaseSessionStore } from '../supabase-store.js';
import { SessionLRUCache } from '../cache.js';
import type { SessionTurnWrite } from '../store.js';
import type { PendingAction } from '../pending-action.js';
import { appendCheckedGraphWrite } from '../../persist-graph-write.js';
import { GUIDANCE_HISTORY_LIMIT, type AnswerGuidance } from '../../agent-lane/turn-context/guidance-history.js';

const scenario = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const event = (key: string): AnswerGuidance => ({ version: 1, entries: {
  [key]: { status: 'pressed', state_key_hash: 'aaaaaaaaaaaa' },
} });
const answer = (): SessionTurnWrite => ({ scenario_id: scenario, turn_id: 'answer', turn_class: 'direct_answer',
  handler_id: null, request_hash: 'agent_turn:answer', response_emitted: true, llm_calls_used: 0,
  duration_ms: 1, handler_facts: [], assistantMessage: 'unchecked' });
const hold: PendingAction = { id: 'hold', scenario_id: scenario, chip_id: 'hold', action: { kind: 'run_analysis' },
  preconditions: {}, emitted_at_iso: '2026-10-17T12:00:00Z', expires_at_iso: '2026-10-18T12:00:00Z', expires_at_turn_count: 20 };

function setup(count = 0) {
  let rows = Array.from({ length: count }, (_, i) => ({ scenario_id: scenario, turn_id: `seed-${i}`,
    request_hash: 'agent_turn:seed', agent_guidance: event(i === count - 1 ? 'RC-WIDEN' : 'RC-COACH-EDITS') }));
  let latest = 'row-0';
  let pending: readonly PendingAction[] = [hold];
  const written: Record<string, unknown>[] = [];
  let move = false;
  const rpc = vi.fn(async (_name: string, args: Record<string, unknown>) => {
    if (move) {
      move = false; latest = 'row-1'; pending = [];
      rows = [{ ...rows[0]!, agent_guidance: event('RC-COACH-EDITS') }];
      return { data: { status: 'latest_moved' }, error: null };
    }
    written.push(args);
    return { data: _name === 'append_turn_atomic_v2' ? 'answer-row' : { id: 'answer-row', replayed_prior_turn: false, prior_turn_conflict: false }, error: null };
  });
  const chain = {
    select: () => chain, eq: () => chain, is: () => chain, like: () => chain,
    not: () => chain, order: () => chain, limit: () => chain, abortSignal: () => chain,
    then: (resolve: (value: unknown) => void) => resolve({ data: rows, error: null }),
  };
  const store = new SupabaseSessionStore({ from: () => chain, rpc } as never,
    new SessionLRUCache({ maxScenarios: 2, maxTurnsPerScenario: 4 }), { defaultReadLimit: 20 });
  vi.spyOn(store, 'getScenarioOwner').mockResolvedValue(null);
  vi.spyOn(store, 'readMostRecentPendingActions').mockImplementation(async (_scenario, options) => {
    options?.onLatestRowId?.(latest); return pending;
  });
  return { store, written, rpc, contend: () => { move = true; },
    misScope: () => { rows = rows.map(row => ({ ...row, scenario_id: 'another-scenario' })); } };
}

describe('reply preparation inside the existing append attempt', () => {
  it('bounded guidance windows evict only when this answer records an event, for two distinct policy sources', async () => {
    for (const count of [GUIDANCE_HISTORY_LIMIT - 1, GUIDANCE_HISTORY_LIMIT, GUIDANCE_HISTORY_LIMIT + 1]) {
      for (const policy of ['RC-COACH-EDITS', 'RC-WIDEN']) for (const recordsEvent of [false, true]) {
        const s = setup(count);
        let checked = '';
        await s.store.append({ ...answer(), ...(recordsEvent ? { agent_guidance: event(policy) } : {}) }, {
          prepare: (write, { finalPending, prospectiveGuidance }) => {
            expect(finalPending).toEqual([]);
            const oldestSurvives = count < GUIDANCE_HISTORY_LIMIT || (!recordsEvent && count === GUIDANCE_HISTORY_LIMIT);
            expect(prospectiveGuidance?.['RC-WIDEN'] !== undefined).toBe(oldestSurvives || (recordsEvent && policy === 'RC-WIDEN'));
            checked = JSON.stringify(prospectiveGuidance);
            return { assistantMessage: checked, handler_facts: write.handler_facts };
          } });
        expect(s.written[0]?.p_assistant_message).toBe(checked);
      }
    }
  });

  it('CAS contention re-prepares from the new pending carrier and guidance; only those validated bytes commit', async () => {
    const s = setup(1); s.contend();
    const seen: string[] = [];
    const write: SessionTurnWrite = { ...answer(), pending_actions: [hold], agent_guidance: event('RC-COACH-EDITS') };
    await appendCheckedGraphWrite({ store: s.store, write, writesGraph: false,
      prepare: (candidate, { finalPending, prospectiveGuidance }) => {
        const text = JSON.stringify({ holds: finalPending.map(p => p.chip_id), widen: prospectiveGuidance?.['RC-WIDEN'] !== undefined });
        seen.push(text);
        return { assistantMessage: text, handler_facts: candidate.handler_facts };
      },
      heldProposals: { isHeld: p => p.chip_id === 'hold', seenByThisRequest: new Set(['hold']) } });
    expect(seen).toEqual(['{"holds":["hold"],"widen":true}', '{"holds":[],"widen":false}']);
    expect(s.rpc).toHaveBeenCalledTimes(2);
    expect(s.written).toHaveLength(1);
    expect(s.written[0]?.p_pending_actions).toEqual([]);
    expect(s.written[0]?.p_assistant_message).toBe(seen[1]);
  });

  it('another scenario’s guidance cannot supply this answer’s policy history', async () => {
    const s = setup(1); s.misScope();
    await s.store.append({ ...answer(), agent_guidance: event('RC-COACH-EDITS') }, {
      prepare: (write, { prospectiveGuidance }) => {
        expect(prospectiveGuidance).toBeNull();
        return { assistantMessage: 'History unknown.', handler_facts: write.handler_facts };
      } });
    expect(s.written[0]?.p_assistant_message).toBe('History unknown.');
  });

  it('a failed final check writes nothing; a non-answer cannot acquire the preparation path', async () => {
    const s = setup();
    const prepare = vi.fn(() => { throw new Error('invalid reply'); });
    await expect(s.store.append(answer(), { prepare })).rejects.toThrow('invalid reply');
    expect(s.rpc).not.toHaveBeenCalled();
    prepare.mockClear();
    await expect(s.store.append({ ...answer(), graph: { nodes: [], edges: [] } }, { prepare })).rejects.toThrow('Conditional append requires');
    expect(prepare).not.toHaveBeenCalled();
    expect(s.rpc).not.toHaveBeenCalled();
  });
});
