import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { agentTurnRequestHash } from '../../../routes/agent-v1-turn.js';
import { randomUUID } from 'node:crypto';
import { SupabaseSessionStore } from '../../session/supabase-store.js';
import { SessionLRUCache } from '../../session/cache.js';
import { guidanceHistoryOf, guidanceOnAnswer, parseAnswerGuidance } from '../turn-context/guidance-history.js';
import { guidanceWireFor } from '../turn-context/guidance-wire.js';
import { widenTurnForReadback } from '../method-turn/widen-turn.js';
import { selectorSignalsOf } from '../turn-context/selector-signals.js';
import { selectorSignalsOf as methodSignalsOf } from '../method-turn/method-turn.js';
import { assembleGuidanceSignals } from '../turn-context/guidance-signals.js';
import { POLICY } from '../guidance/policy.js';
import type { SelectedRow } from '../guidance/types.js';

const scenario = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const old = { version: 1 as const, entries: { 'RC-WIDEN': { status: 'offered' as const, state_key_hash: '012345abcdef' } } };
const saved = { version: 1 as const, entries: { 'RC-WIDEN': { ...old.entries['RC-WIDEN'], variant_id: 'W4', slot: 1 } } };
const row = { id: 'answer-row', scenario_id: scenario, turn_id: randomUUID(), request_hash: agentTurnRequestHash(scenario, null, 'What next?'),
  assistant_message: 'Saved exact words.', user_message: 'What next?', llm_calls_used: 1, pending_actions: [], agent_guidance: saved };
const select = vi.fn();
// Each new store reads the persisted row; no cache or reconstructed transcript.
function fresh() {
  const chain: Record<string, unknown> = {};
  for (const name of ['select', 'eq', 'is', 'like', 'not', 'order', 'limit', 'abortSignal']) {
    chain[name] = (...args: unknown[]) => { if (name === 'select') select(...args); return chain; };
  }
  chain.then = (done: (value: unknown) => unknown) => Promise.resolve({ data: [structuredClone(row)], error: null }).then(done);
  return new SupabaseSessionStore({ from: () => chain, rpc: vi.fn() } as never,
    new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 20 }), { defaultReadLimit: 20 });
}
const replayStore = { ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async () => fresh().readCommittedTurn(scenario, row.turn_id)) };
vi.mock('../../session/index.js', () => ({ getSessionStore: () => replayStore }));
vi.mock('../../../orchestrator/user-identity.js', async importOriginal => ({
  ...await importOriginal<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));

const graph = { nodes: [
  { id: 'goal', kind: 'goal', label: 'Current goal' },
  { id: 'option', kind: 'option', label: 'Current option', interventions: { factor: { value: 8 } } },
  { id: 'factor', kind: 'factor', label: 'Current factor', observed_state: { value: 4 } },
], edges: [{ from: 'option', to: 'factor' }, { from: 'factor', to: 'goal', weight: 0.5 }] };
const readback = { graph, analysisReady: { status: 'ready' as const, may_run: true },
  analysisState: { run_state: { kind: 'complete_current', computed_at: '2026-10-10T10:00:00Z' } } };

describe('A6 durable variant and slot identity', () => {
  let app: FastifyInstance;
  const provider = vi.fn();
  beforeAll(async () => {
    vi.stubGlobal('fetch', provider);
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 120_000);
  afterAll(async () => {
    await app.close(); vi.unstubAllGlobals();
    delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW;
  });

  it('(a) same-turn replay returns saved words with zero provider calls', async () => {
    const response = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', scenario_id: scenario, turn_id: row.turn_id, message: 'What next?',
    } });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().assistant_text).toBe(row.assistant_message);
    expect(provider).not.toHaveBeenCalled();
  });

  it('(b) a NEW turn after reload consumes stored W4, with CURRENT model and Run', async () => {
    const history = await fresh().readGuidanceHistory(scenario);
    const currentChoice = widenTurnForReadback('agent-next-widen', readback);
    expect(currentChoice).toMatchObject({ kind: 'run', variant: 'W2' });
    const next = widenTurnForReadback('agent-next-widen', readback, history);
    expect(next).toMatchObject({ kind: 'run', variant: 'W4', raw: graph, current: [{ label: 'current option' }] });
    if (next?.kind !== 'run') throw new Error('method must run');
    expect(next.directive).toContain('Current goal');
    expect(next.directive).toContain('Current factor');
    expect(next.directive).not.toContain('Saved exact words');
    // Both signal adapters retain identity alongside the current Run signals.
    const signals = assembleGuidanceSignals({ request: 'method', explicitRequest: 'RC-WIDEN', offeredSpecific: [],
      ...readback, analysisResult: undefined, guidance: history, leaderLicensed: true });
    for (const adapt of [selectorSignalsOf, methodSignalsOf]) {
      expect(adapt(signals, null).guidance?.['RC-WIDEN']).toMatchObject({ variant_id: 'W4', slot: 1 });
      expect(adapt(signals, null)['run.kind']).toBe('complete_current');
    }
  });

  it('exact-turn reader selects and returns the same validated metadata', async () => {
    expect(await fresh().readCommittedTurn(scenario, row.turn_id)).toMatchObject({ agent_guidance: saved });
    expect(select).toHaveBeenCalledWith(expect.stringContaining('agent_guidance'));
  });

  it('(c) old entries without variant_id or slot remain valid', () => {
    expect(parseAnswerGuidance(old)).toEqual(old);
    expect(guidanceHistoryOf([old])).toEqual(old.entries);
    expect(guidanceOnAnswer(undefined, old.entries, { policy_id: 'RC-WIDEN' })).toEqual({
      version: 1, entries: { 'RC-WIDEN': { ...old.entries['RC-WIDEN'], status: 'pressed' } },
    });
  });

  it('(d) unknown keys remain unreadable', () => {
    expect(parseAnswerGuidance({ ...saved, entries: { 'RC-WIDEN': { ...saved.entries['RC-WIDEN'], unknown: 'private' } } })).toBeNull();
  });

  it('variant ids follow POLICY.rows per policy; slot is an integer 1..3', () => {
    for (const policy of POLICY.rows) {
      const key = policy.policy_id === 'RC-STRENGTHEN-ITEM' ? `${policy.policy_id}:012345abcdef` : policy.policy_id;
      const variants = 'variants' in policy.trigger_predicate ? policy.trigger_predicate.variants.map(v => v.id) : [];
      for (const variant_id of variants) for (const slot of [1, 2, 3]) {
        const envelope = { version: 1, entries: { [key]: { ...old.entries['RC-WIDEN'], variant_id, slot } } };
        expect(parseAnswerGuidance(envelope)).toEqual(envelope);
      }
      expect(parseAnswerGuidance({ version: 1, entries: { [key]: { ...old.entries['RC-WIDEN'], variant_id: 'bogus' } } })).toBeNull();
    }
    for (const slot of [0, 4, 1.5, '1', null]) {
      expect(parseAnswerGuidance({ version: 1, entries: { 'RC-WIDEN': { ...saved.entries['RC-WIDEN'], slot } } })).toBeNull();
    }
    expect(parseAnswerGuidance({ version: 1, entries: { 'RC-WIDEN': { ...old.entries['RC-WIDEN'], variant_id: 'S1' } } })).toBeNull();
  });

  it('offers record the SAME wire variant/slot; presses copy that stored identity without re-selection', () => {
    const selected: SelectedRow = { policy_id: 'RC-WIDEN', variant: 'W4', priority: 'P3', state_key_hash: '012345abcdef',
      primary_action: { label: 'Suggest options', action_kind: 'choose_1_of_3' }, copy: { title: 'x', why: 'y', question: 'z' } };
    const wire = guidanceWireFor({ slot1: selected, slot2: { ...selected, policy_id: 'RC-COACH-EDITS', variant: undefined }, suppressed: [] }, graph);
    expect(guidanceOnAnswer(wire, {})).toEqual({ version: 1, entries: {
      'RC-WIDEN': saved.entries['RC-WIDEN'], 'RC-COACH-EDITS': { ...old.entries['RC-WIDEN'], slot: 2 },
    } });
    expect(guidanceOnAnswer(undefined, guidanceHistoryOf([saved]), { policy_id: 'RC-WIDEN' })).toEqual({
      version: 1, entries: { 'RC-WIDEN': { ...saved.entries['RC-WIDEN'], status: 'pressed' } },
    });
  });
});
