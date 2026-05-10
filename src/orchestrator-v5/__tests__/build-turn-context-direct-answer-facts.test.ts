/**
 * V5 — `buildTurnContext` direct_answer fact-loading regression
 * (DL-7 PR B P0 fix).
 *
 * The original `buildTurnContext` filtered prior turns to those with
 * `turn_class === 'handler'` before mapping to row IDs for
 * `readFactsFor`. PR B's `edit_graph` dispatch deliberately emits
 * `EditGraphHandlerFact` while preserving `turn_class: 'direct_answer'`
 * (per War Room correction — the response-finaliser path stays
 * unchanged). The historical filter would silently exclude the new
 * fact's parent turn, making PR B's emission downstream-invisible:
 * persisted to the DB, but never loaded into `prior_facts` and so
 * never projected into `recent_changes` or quoted by the state-query
 * guard.
 *
 * The fix at `build-turn-context.ts:362` widens the filter to all
 * prior turns. The actual gate is the FK in `readFactsFor` (turns
 * with no associated `v5_handler_facts` rows return nothing).
 *
 * This regression test pins the fix:
 *  - Direct-answer turn with handler_facts → fact appears in
 *    prior_facts.
 *  - The mock session store's readFactsFor IS called with the
 *    direct-answer turn's row ID (proving the filter doesn't drop it).
 *  - Coexistence: a mix of handler-class and direct-answer-class
 *    turns all contribute their facts.
 */

import { describe, it, expect, vi } from 'vitest';
import type {
  HandlerFact,
  SessionTurn,
  V5ActionType,
} from '@talchain/schemas/orchestrator';

import { buildTurnContext } from '../build-turn-context.js';
import type { SessionStore, SessionTurnWrite } from '../session/store.js';
import type { InvalidationResult, InvalidationScope } from '../session/invalidation.js';
import type { PendingAction } from '../session/pending-action.js';
import { makeMessagePayload } from './fixtures.js';

const SCENARIO_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function makeDirectAnswerTurn(rowId: string, turnId: string): SessionTurn {
  return {
    id: rowId,
    scenario_id: SCENARIO_ID,
    user_id: null,
    turn_id: turnId,
    turn_class: 'direct_answer',
    handler_id: null,
    request_hash: 'sha256:test-direct',
    response_emitted: true,
    llm_calls_used: 1,
    duration_ms: 500,
    created_at: '2026-05-10T10:00:00.000Z',
  } as unknown as SessionTurn;
}

function makeHandlerTurn(rowId: string, turnId: string, handlerId: V5ActionType): SessionTurn {
  return {
    id: rowId,
    scenario_id: SCENARIO_ID,
    user_id: null,
    turn_id: turnId,
    turn_class: 'handler',
    handler_id: handlerId,
    request_hash: 'sha256:test-handler',
    response_emitted: true,
    llm_calls_used: 0,
    duration_ms: 100,
    created_at: '2026-05-10T09:59:00.000Z',
  } as unknown as SessionTurn;
}

function makeEditGraphFact(): HandlerFact {
  return {
    fact_type: 'edit_graph',
    fact_version: 1,
    noop: false,
    result: {
      edit_kind: 'parameter_update',
      status: 'applied',
      operations_count: 1,
      affected_entities: [{ kind: 'factor', label: 'Price' }],
      graph_hash_before: 'aaaaaaaaaaaaaaaa',
      graph_hash_after: 'bbbbbbbbbbbbbbbb',
      safe_summary: 'Renamed "Price" to "Price (revised)"',
      impact: 'low',
      rerun_recommended: false,
    },
  } as unknown as HandlerFact;
}

function makeRunAnalysisFact(): HandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: 'opt_a',
      summary: 'Option A leads.',
      win_probabilities: { opt_a: 0.7, opt_b: 0.3 },
      graph_hash_at_run: 'aaaaaaaaaaaaaaaa',
      computed_at: '2026-05-10T09:59:30.000Z',
    },
  } as unknown as HandlerFact;
}

function makeStoreCapturingReadFactsFor(opts: {
  priorTurns: readonly SessionTurn[];
  factsForRowIds: ReadonlyMap<string, readonly HandlerFact[]>;
}): SessionStore & {
  readFactsForCalls: Array<readonly string[]>;
  readFactsWithTurnForCalls: Array<readonly string[]>;
} {
  const readFactsForCalls: Array<readonly string[]> = [];
  const readFactsWithTurnForCalls: Array<readonly string[]> = [];
  return {
    readFactsForCalls,
    readFactsWithTurnForCalls,
    async append(_: SessionTurnWrite) { return { id: 'noop' }; },
    async readRecent() { return opts.priorTurns; },
    async readFactsFor(turnIds: readonly string[]) {
      readFactsForCalls.push([...turnIds]);
      const out: HandlerFact[] = [];
      for (const id of turnIds) {
        const facts = opts.factsForRowIds.get(id);
        if (facts) out.push(...facts);
      }
      return out;
    },
    async readFactsWithTurnFor(turnIds: readonly string[]) {
      readFactsWithTurnForCalls.push([...turnIds]);
      // Same logic but in HandlerFactWithTurn shape.
      const out = [];
      for (const id of turnIds) {
        const facts = opts.factsForRowIds.get(id) ?? [];
        for (const fact of facts) {
          out.push({
            fact,
            turn_id: id,
            fact_created_at: '2026-05-10T10:00:00.000Z',
          });
        }
      }
      return out;
    },
    async invalidateScoped(_s: string, scope: InvalidationScope): Promise<InvalidationResult> {
      return { scope, entries_invalidated: [] };
    },
    async invalidateAll(): Promise<InvalidationResult> {
      return { scope: { kind: 'structural' }, entries_invalidated: [] };
    },
    async ensureScenarioExists(_s: string, userId: string) {
      return { user_id: userId };
    },
    async storeDraftGraph() { /* noop */ },
    async loadGraph() { return null; },
    async loadGraphAndBriefText() { return { graph: null, briefText: null }; },
    async readMostRecentPendingActions(): Promise<readonly PendingAction[]> { return []; },
  } as SessionStore & { readFactsForCalls: Array<readonly string[]> };
}

const BASE_PAYLOAD = makeMessagePayload({
  turn_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  scenario_id: SCENARIO_ID,
  message: 'next turn',
});

describe('buildTurnContext — direct_answer fact loading (DL-7 PR B P0)', () => {
  it('FL1 direct_answer turn row id is passed to the fact-loader call (call-shape regression)', async () => {
    const directAnswerTurn = makeDirectAnswerTurn('row-direct-1', 'turn-direct-1');
    const factsByRowId = new Map<string, readonly HandlerFact[]>([
      ['row-direct-1', [makeEditGraphFact()]],
    ]);
    const store = makeStoreCapturingReadFactsFor({
      priorTurns: [directAnswerTurn],
      factsForRowIds: factsByRowId,
    });

    await buildTurnContext(BASE_PAYLOAD, 'req-fl1', { sessionStore: store });

    // Production prefers readFactsWithTurnFor when implemented and
    // only falls back to readFactsFor when the with-turn variant
    // returns empty. The pre-PR-B-loader-fix bug filtered the
    // direct-answer row id out BEFORE either call, so neither would
    // have received `row-direct-1`. Post-fix, the row id appears in
    // at least one of the two call lists — that's the regression
    // shape this test pins.
    const allCallArgs = [
      ...store.readFactsWithTurnForCalls,
      ...store.readFactsForCalls,
    ].flat();
    expect(allCallArgs).toContain('row-direct-1');
  });

  it('FL2 fact attached to direct_answer turn appears in prior_facts', async () => {
    const directAnswerTurn = makeDirectAnswerTurn('row-direct-2', 'turn-direct-2');
    const editFact = makeEditGraphFact();
    const factsByRowId = new Map<string, readonly HandlerFact[]>([
      ['row-direct-2', [editFact]],
    ]);
    const store = makeStoreCapturingReadFactsFor({
      priorTurns: [directAnswerTurn],
      factsForRowIds: factsByRowId,
    });

    const ctx = await buildTurnContext(BASE_PAYLOAD, 'req-fl2', { sessionStore: store });

    expect(ctx.prior_facts).toHaveLength(1);
    expect(ctx.prior_facts[0].fact_type).toBe('edit_graph');
    expect((ctx.prior_facts[0] as { result: { safe_summary: string } }).result.safe_summary).toBe(
      'Renamed "Price" to "Price (revised)"',
    );
  });

  it('FL3 prior_facts_with_turn pairs the edit_graph fact with its parent turn id', async () => {
    const directAnswerTurn = makeDirectAnswerTurn('row-direct-3', 'turn-direct-3');
    const factsByRowId = new Map<string, readonly HandlerFact[]>([
      ['row-direct-3', [makeEditGraphFact()]],
    ]);
    const store = makeStoreCapturingReadFactsFor({
      priorTurns: [directAnswerTurn],
      factsForRowIds: factsByRowId,
    });

    const ctx = await buildTurnContext(BASE_PAYLOAD, 'req-fl3', { sessionStore: store });

    expect(ctx.prior_facts_with_turn).toHaveLength(1);
    expect(ctx.prior_facts_with_turn[0].turn_id).toBe('row-direct-3');
    expect(ctx.prior_facts_with_turn[0].fact.fact_type).toBe('edit_graph');
  });

  it('FL4 mixed prior turns: edit_graph (direct_answer) + run_analysis (handler) both load', async () => {
    const handlerTurn = makeHandlerTurn('row-handler-1', 'turn-handler-1', 'run_analysis');
    const directAnswerTurn = makeDirectAnswerTurn('row-direct-4', 'turn-direct-4');
    const factsByRowId = new Map<string, readonly HandlerFact[]>([
      ['row-handler-1', [makeRunAnalysisFact()]],
      ['row-direct-4', [makeEditGraphFact()]],
    ]);
    const store = makeStoreCapturingReadFactsFor({
      // Newest-first per readRecent contract.
      priorTurns: [directAnswerTurn, handlerTurn],
      factsForRowIds: factsByRowId,
    });

    const ctx = await buildTurnContext(BASE_PAYLOAD, 'req-fl4', { sessionStore: store });

    expect(ctx.prior_facts).toHaveLength(2);
    const factTypes = ctx.prior_facts.map((f) => f.fact_type).sort();
    expect(factTypes).toEqual(['edit_graph', 'run_analysis']);
  });

  it('FL5 direct_answer turns without facts contribute nothing (FK gate works)', async () => {
    // A direct_answer turn that did NOT emit a fact (e.g. a
    // clarify-style answer or a rejected-edit commit). Its row ID is
    // passed to readFactsFor but the FK lookup returns nothing.
    const noFactTurn = makeDirectAnswerTurn('row-direct-5', 'turn-direct-5');
    const factTurn = makeDirectAnswerTurn('row-direct-6', 'turn-direct-6');
    const factsByRowId = new Map<string, readonly HandlerFact[]>([
      // row-direct-5 deliberately absent — no facts
      ['row-direct-6', [makeEditGraphFact()]],
    ]);
    const store = makeStoreCapturingReadFactsFor({
      priorTurns: [factTurn, noFactTurn],
      factsForRowIds: factsByRowId,
    });

    const ctx = await buildTurnContext(BASE_PAYLOAD, 'req-fl5', { sessionStore: store });

    expect(ctx.prior_facts).toHaveLength(1);
    expect(ctx.prior_facts[0].fact_type).toBe('edit_graph');
  });

  it('FL6 zero prior turns → empty prior_facts (no regression)', async () => {
    const store = makeStoreCapturingReadFactsFor({
      priorTurns: [],
      factsForRowIds: new Map(),
    });

    const ctx = await buildTurnContext(BASE_PAYLOAD, 'req-fl6', { sessionStore: store });

    expect(ctx.prior_facts).toHaveLength(0);
    expect(ctx.prior_facts_with_turn).toHaveLength(0);
  });
});
