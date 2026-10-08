import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { commitDirectAnswer, type CommitMetadata } from '../commit.js';
import { composeDirectAnswerResponse } from '../compose.js';
import { appendCheckedGraphWrite } from '../persist-graph-write.js';
import { linkEffectClarificationOnRefusal, linkEffectClarificationsForAnswerRow, reviseLinkEffectClarification,
  type LinkEffectClarificationPending } from '../agent-lane/link-effect-clarification.js';
import { parsePendingAction, type PendingAction } from '../session/pending-action.js';
import { SessionLRUCache } from '../session/cache.js';
import { SupabaseSessionStore } from '../session/supabase-store.js';
import { runAsAgentSubturn } from '../session/agent-subturn-context.js';
import type { ConditionalAppendOptions, SessionTurnWrite } from '../session/store.js';
import { createNoopSessionStore } from '../session/__tests__/fixtures.js';

vi.mock('../rolling-summary/capture.js', () => ({ maintainRollingSummaryForCommit: vi.fn(async () => undefined) }));

const SCENARIO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const GRAPH = { nodes: [{ id: 'price', kind: 'factor', label: 'Café price' },
  { id: 'margin', kind: 'factor', label: 'Gross margin' }],
edges: [{ from: 'price', to: 'margin', provenance: { source: 'cee_hypothesis', magnitude: 'olumi_placeholder' } }] };
const QUOTE = 'Raising the café price by £1 will increase gross margin by at least 5%';
const arm = (): LinkEffectClarificationPending => linkEffectClarificationOnRefusal({
  action: { from_id: 'price', to_id: 'margin', from_label: 'Café price', to_label: 'Gross margin', quote: QUOTE,
    question: 'Points or relative?', refusal: 'unit_mismatch' },
  scenarioId: SCENARIO, graph: GRAPH, message: QUOTE, emittedAtIso: new Date().toISOString(),
})!;
// The fallback lets this reviewer repro reach the faulty consumption check before lineage exists.
const lineage = (ask: LinkEffectClarificationPending): string =>
  (ask.action as { lineage_id?: string }).lineage_id ?? ask.chip_id;
const answerWrite = (pending: readonly PendingAction[]): SessionTurnWrite => ({
  scenario_id: SCENARIO, turn_id: 'slow-answer', turn_class: 'direct_answer', handler_id: null,
  request_hash: 'agent_turn:slow-answer', response_emitted: true, llm_calls_used: 0, duration_ms: 1,
  handler_facts: [], pending_actions: pending,
});

function consumedStore(initial: readonly PendingAction[], consumeDuringAppend: boolean) {
  let pending = initial;
  let rowId = 'before-consumption';
  const written: SessionTurnWrite[] = [];
  const store = createNoopSessionStore();
  store.readMostRecentPendingActions = vi.fn(async (_scenario, options) => {
    options?.onLatestRowId?.(rowId);
    return pending;
  });
  store.append = vi.fn(async write => { written.push(write); return { id: 'written' }; });
  store.appendIfLatest = vi.fn(async (write: SessionTurnWrite, options: ConditionalAppendOptions) => {
    if (consumeDuringAppend && rowId === 'before-consumption') {
      rowId = 'consumed';
      pending = [];
    }
    if (options.expectedLatestRowId !== rowId) return { status: 'latest_moved' as const };
    written.push(write);
    return { id: 'written' };
  });
  return { store, written };
}

/** Only the transport is a fake: commit + reconciliation + the real production store methods run unchanged. */
function productionStore(pending: readonly PendingAction[]) {
  const rpc = vi.fn(async (_name: string, _args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }> =>
    ({ data: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', error: null }));
  const client = { rpc, from: vi.fn(() => {
    let columns = '';
    const query = {
      select: (value: string) => { columns = value; return query; },
      eq: () => query, not: () => query, order: () => query, abortSignal: () => query,
      limit: async () => ({ data: columns === 'id, pending_actions'
        ? [{ id: 'before-consumption', pending_actions: pending }] : [], error: null }),
      maybeSingle: async () => ({ data: null, error: null }),
    };
    return query;
  }) } as unknown as SupabaseClient;
  return { store: new SupabaseSessionStore(client, new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 10 }),
    { defaultReadLimit: 20 }), rpc };
}

afterEach(() => vi.restoreAllMocks());

describe('RC2a fix 2: clarification lineage and the production commit shape', () => {
  it('RED P1: lineage is minted at first arm and is stable through reading and question revisions', () => {
    const first = arm();
    const reading = reviseLinkEffectClarification(first, { ...first.action, resolved_reading: 'points' }, first.emitted_at_iso);
    const revised = reviseLinkEffectClarification(reading, { ...reading.action, question: 'Give a current guess and range.' }, reading.emitted_at_iso);
    const id = (first.action as { lineage_id?: string }).lineage_id;
    expect(id).toEqual(expect.any(String));
    expect(id).not.toBe('');
    expect(lineage(reading)).toBe(id);
    expect(lineage(revised)).toBe(id);
    expect(first.chip_id).not.toBe(reading.chip_id);
    expect(reading.chip_id).not.toBe(revised.chip_id);
    expect(parsePendingAction(JSON.parse(JSON.stringify(revised)))).toEqual(revised);
    expect(lineage(arm()), 'an independent statement starts a new lineage').not.toBe(id);
  });

  it('CONTROL: malformed supplied lineage is refused while legacy rows keep their original fallback identity', () => {
    const first = arm();
    for (const lineage_id of ['', ' ', 3, {}, 'x'.repeat(201)]) {
      expect(parsePendingAction({ ...first, action: { ...first.action, lineage_id } })).toBeNull();
    }
    const legacy = { ...first, action: { ...first.action, lineage_id: undefined } };
    expect(parsePendingAction(legacy)).toEqual(legacy);
    const revised = reviseLinkEffectClarification(legacy, { ...legacy.action, resolved_reading: 'points' }, first.emitted_at_iso);
    expect(lineage(revised)).toBe(legacy.chip_id);
    expect(revised.action.lineage_id).toBe(legacy.chip_id);
  });

  it('CONTROL: a selected preexisting lineage survives arming when it is absent from the route snapshot', () => {
    const selected = arm();
    const descendant = linkEffectClarificationOnRefusal({ action: { ...selected.action, question: 'Give a current guess and range.' },
      message: QUOTE, scenarioId: SCENARIO, graph: GRAPH, emittedAtIso: new Date().toISOString() })!;
    expect(lineage(descendant)).toBe(lineage(selected));
    expect(descendant.chip_id).not.toBe(selected.chip_id);
  });

  it.each([false, true])('RED P1 reviewer: slow points answer mints B after A was consumed; B never persists (CAS retry: %s)', async retry => {
    const a = arm();
    const b = reviseLinkEffectClarification(a, { ...a.action, resolved_reading: 'points', question: 'Give a current guess and range.' }, a.emitted_at_iso);
    const s = consumedStore(retry ? [a] : [], retry);
    await appendCheckedGraphWrite({ store: s.store, writesGraph: false, baseGraphForInvariants: GRAPH,
      write: answerWrite([b]), heldProposals: { isHeld: () => false, seenByThisRequest: new Set([lineage(a)]) } });
    expect(s.written).toHaveLength(1);
    expect(s.written[0]?.pending_actions, 'a new revision cannot escape consumption of its original clarification').toEqual([]);
  });

  it('RED P1: consuming lineage A drops descendant B while an independent same-link ask remains live', () => {
    const a = arm();
    const b = reviseLinkEffectClarification(a, { ...a.action, resolved_reading: 'points' }, a.emitted_at_iso);
    const input = { prior: [a], next: [b], consumedLinks: [], consumedLineages: [lineage(a)],
      graph: GRAPH, graphHash: undefined, nowMs: Date.now(), typedByUser: false };
    expect(linkEffectClarificationsForAnswerRow(input)).toEqual([]);
    const independent = arm();
    expect(linkEffectClarificationsForAnswerRow({ ...input, prior: [], next: [independent] })).toEqual([independent]);
  });

  it.each([false, true])('RED P1 reviewer: inner Run commits through the real Supabase store with an empty/current consumed seen set (prior ask: %s)', async hasAsk => {
    const a = arm();
    const b = reviseLinkEffectClarification(a, { ...a.action, resolved_reading: 'points' }, a.emitted_at_iso);
    const s = productionStore([]);
    await expect(runAsAgentSubturn(SCENARIO, () => commitDirectAnswer(
      composeDirectAnswerResponse({ answerKind: 'functional', assistant_text: 'Analysis completed.', stage: 'analyse' }),
      { scenario_id: SCENARIO, turn_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', turn_class: 'handler',
        handler_id: 'run_analysis', request_hash: 'sha256:inner-run', llm_calls_used: 0, duration_ms: 1,
        handler_facts: [], priorPendingActions: hasAsk ? [a] : [], pending_actions: hasAsk ? [b] : [] }, s.store))).resolves.toBeDefined();
    expect(s.rpc).toHaveBeenCalledTimes(1);
    const [rpcName, args] = s.rpc.mock.calls[0]! as unknown as [string, Record<string, unknown>];
    expect(rpcName).toBe('append_turn_atomic_v2');
    expect(args.p_pending_actions).toEqual([]);
    expect(args.p_assistant_message).toBeNull();
  });

  it.each(['draft_graph', 'edit_graph'] as const)('RED P1 reviewer: %s graph commits reach the production RPC rather than illegal conditional answer append', async handler => {
    const s = productionStore([]);
    await expect(commitDirectAnswer(
      composeDirectAnswerResponse({ answerKind: 'functional', assistant_text: 'The model is ready.', stage: 'frame' }),
      { scenario_id: SCENARIO, turn_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', turn_class: 'handler',
        // Real legacy internal graph-handler IDs intentionally exercise the RPC shape outside the shared handler enum.
        handler_id: handler as unknown as CommitMetadata['handler_id'], request_hash: `sha256:${handler}`, llm_calls_used: 0, duration_ms: 1,
        handler_facts: [], graph: GRAPH, baseGraphForInvariants: GRAPH, priorPendingActions: [] }, s.store)).resolves.toBeDefined();
    expect(s.rpc).toHaveBeenCalledTimes(1);
    const [rpcName, args] = s.rpc.mock.calls[0]! as unknown as [string, Record<string, unknown>];
    expect(rpcName).toBe('append_turn_atomic_v2');
    expect(args.p_graph).toEqual(expect.objectContaining({ nodes: expect.any(Array), edges: expect.any(Array) }));
  });
});
