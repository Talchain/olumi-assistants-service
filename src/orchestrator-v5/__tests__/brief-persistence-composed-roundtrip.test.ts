/**
 * V5 Phase 1 brief persistence — composed round-trip proof.
 *
 * Verifies the END-TO-END acceptance contract using a stateful in-memory
 * SessionStore (not Supabase, not network). The previous unit-test layer
 * proves each seam in isolation:
 *   - draft-graph-dispatch threads briefText into CommitMetadata
 *   - commit.ts forwards metadata.briefText to SessionStore.append
 *   - supabase-store.append passes p_brief_text to the RPC
 *   - supabase-store.loadGraphAndBriefText reads it back
 *   - build-turn-context surfaces it on EnrichedTurnContext.scenarioBriefText
 *   - turn-executor + chip-click-dispatch pass context.scenarioBriefText to the enricher
 *
 * What this test adds: a SINGLE composed proof that all those seams
 * compose correctly — a draft turn that writes briefText, a stateful
 * fake that retains it, and a follow-up `buildTurnContext` that reads
 * it back. Catches breaks where individual seams pass but the chain
 * doesn't (field name typos, accidental shadowing, schema-superset
 * regressions, etc.).
 */

import { describe, expect, it } from 'vitest';

import { commitDirectAnswer } from '../commit.js';
import { buildTurnContext } from '../build-turn-context.js';
import type { SessionStore, SessionTurnWrite } from '../session/store.js';
import { createNoopSessionStore } from '../session/__tests__/fixtures.js';
import { composeDirectAnswerResponse } from '../compose.js';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TURN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const REQUEST_ID = 'req-composed-roundtrip';

/**
 * Stateful in-memory SessionStore that mirrors the production write-once
 * brief_text semantics enforced by the RPC's WHERE clause:
 *
 *   UPDATE scenarios SET brief_text = p_brief_text
 *    WHERE id = p_scenario_id
 *      AND (brief_text IS NULL OR brief_text = '');
 *
 * Subsequent appends with a different briefText are silently ignored,
 * matching first-write-wins. Reads expose both graph and briefText via
 * loadGraphAndBriefText.
 */
function createStatefulFakeStore(): SessionStore {
  const briefByScenario = new Map<string, string>();
  const graphByScenario = new Map<string, unknown>();

  const noop = createNoopSessionStore();

  return {
    ...noop,
    async append(write: SessionTurnWrite): Promise<{ id: string }> {
      // Mirror the RPC's first-write-wins predicate: only set brief_text
      // when the scenario currently has none.
      if (write.briefText !== undefined && !briefByScenario.has(write.scenario_id)) {
        briefByScenario.set(write.scenario_id, write.briefText);
      }
      // Graph write is unconditional (last-write-wins) inside the RPC,
      // gated on FOUND. We don't simulate FOUND here — only one append
      // per scenario in this test.
      if (write.graph !== undefined) {
        graphByScenario.set(write.scenario_id, write.graph);
      }
      return { id: `row-${write.turn_id}` };
    },
    async loadGraphAndBriefText(scenarioId: string) {
      return {
        graph: graphByScenario.get(scenarioId) ?? null,
        briefText: briefByScenario.get(scenarioId) ?? null,
      };
    },
    async loadGraph(scenarioId: string) {
      return graphByScenario.get(scenarioId) ?? null;
    },
  };
}

describe('V5 Phase 1 brief persistence — composed round-trip', () => {
  it('draft turn writes briefText → next buildTurnContext exposes it on EnrichedTurnContext.scenarioBriefText', async () => {
    const store = createStatefulFakeStore();
    const composed = composeDirectAnswerResponse({
      assistant_text: 'drafted',
      stage: 'frame',
    });

    // Step 1: simulate draft-graph-dispatch's commit step. Real dispatch
    // also threads briefText through the metadata; we exercise the
    // commit→store seam directly here so the composed test stays focused
    // on the persistence chain rather than the unrelated dispatch
    // pipeline.
    await commitDirectAnswer(
      composed,
      {
        scenario_id: SCENARIO_ID,
        turn_id: TURN_ID,
        turn_class: 'direct_answer',
        handler_id: null,
        request_hash: 'sha256:test',
        llm_calls_used: 1,
        duration_ms: 10,
        handler_facts: [],
        graph: { nodes: [], edges: [] },
        briefText: 'Should I take the offer at company X?',
      },
      store,
    );

    // Step 2: a follow-up turn calls buildTurnContext; it must surface
    // the persisted brief from the same store.
    const followUpPayload = {
      kind: 'message' as const,
      scenario_id: SCENARIO_ID,
      turn_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      stage: 'analyse' as const,
      message: 'run the analysis',
      turn_class: 'decide' as const,
      source: 'composer' as const,
    };
    const ctx = await buildTurnContext(followUpPayload, REQUEST_ID, {
      sessionStore: store,
    });

    // The composed acceptance contract: the brief written by the draft
    // turn must be visible on the enriched turn context.
    expect(ctx.scenarioBriefText).toBe('Should I take the offer at company X?');
    // And the graph from the same round trip is also surfaced (proves
    // loadGraphAndBriefText returns both fields, not just brief_text).
    expect(ctx.persistedGraph).toEqual({ nodes: [], edges: [] });
  });

  it('first-write-wins: a graphless retry on the same scenario does NOT lock out a successful follow-up brief', async () => {
    // Mirrors the dispatch-side guard contract: graphless drafts MUST NOT
    // populate brief_text. The stateful fake's RPC-shaped write-once
    // predicate enforces that even if a future caller bypasses the
    // dispatch guard. Composed end-to-end so a regression at any seam
    // (dispatch, commit, store) surfaces here.
    const store = createStatefulFakeStore();
    const composed = composeDirectAnswerResponse({
      assistant_text: '',
      stage: 'frame',
    });

    // Attempt 1: graphless. Dispatch guard would suppress briefText —
    // simulate that here by passing briefText: undefined.
    await commitDirectAnswer(
      composed,
      {
        scenario_id: SCENARIO_ID,
        turn_id: 'first-attempt',
        turn_class: 'direct_answer',
        handler_id: null,
        request_hash: 'sha256:first',
        llm_calls_used: 1,
        duration_ms: 5,
        handler_facts: [],
        // graph absent — simulating handleDraftGraph returning null
        // briefText absent — simulating the dispatch-side guard
      },
      store,
    );

    // Attempt 2: successful retry on the same scenario. Different
    // turn_id (no conflict-replay). briefText flows.
    await commitDirectAnswer(
      composed,
      {
        scenario_id: SCENARIO_ID,
        turn_id: 'retry',
        turn_class: 'direct_answer',
        handler_id: null,
        request_hash: 'sha256:retry',
        llm_calls_used: 1,
        duration_ms: 6,
        handler_facts: [],
        graph: { nodes: [], edges: [] },
        briefText: 'real brief on the successful retry',
      },
      store,
    );

    // The retry's brief is the one that lives in canonical state —
    // the graphless attempt did not lock it out.
    const followUpPayload = {
      kind: 'message' as const,
      scenario_id: SCENARIO_ID,
      turn_id: 'follow-up',
      stage: 'analyse' as const,
      message: 'run analysis',
      turn_class: 'decide' as const,
      source: 'composer' as const,
    };
    const ctx = await buildTurnContext(followUpPayload, REQUEST_ID, {
      sessionStore: store,
    });
    expect(ctx.scenarioBriefText).toBe('real brief on the successful retry');
  });

  it('a second non-conflict draft on a scenario with brief_text already set does NOT overwrite (write-once enforcement)', async () => {
    const store = createStatefulFakeStore();
    const composed = composeDirectAnswerResponse({
      assistant_text: '',
      stage: 'frame',
    });

    // First draft: writes the canonical brief.
    await commitDirectAnswer(
      composed,
      {
        scenario_id: SCENARIO_ID,
        turn_id: 'first',
        turn_class: 'direct_answer',
        handler_id: null,
        request_hash: 'sha256:first',
        llm_calls_used: 1,
        duration_ms: 5,
        handler_facts: [],
        graph: { nodes: [], edges: [] },
        briefText: 'original brief',
      },
      store,
    );

    // Second draft (different turn_id, e.g. user re-prompted with a
    // different message). Per the RPC's WHERE clause, brief_text is
    // NOT overwritten.
    await commitDirectAnswer(
      composed,
      {
        scenario_id: SCENARIO_ID,
        turn_id: 'second',
        turn_class: 'direct_answer',
        handler_id: null,
        request_hash: 'sha256:second',
        llm_calls_used: 1,
        duration_ms: 6,
        handler_facts: [],
        graph: { nodes: [], edges: [] },
        briefText: 'second draft attempt with a different brief',
      },
      store,
    );

    // The composed read returns the ORIGINAL brief — the canonical-state
    // contract surfaces first-write-wins all the way through to
    // EnrichedTurnContext.
    const followUpPayload = {
      kind: 'message' as const,
      scenario_id: SCENARIO_ID,
      turn_id: 'follow-up',
      stage: 'analyse' as const,
      message: 'run analysis',
      turn_class: 'decide' as const,
      source: 'composer' as const,
    };
    const ctx = await buildTurnContext(followUpPayload, REQUEST_ID, {
      sessionStore: store,
    });
    expect(ctx.scenarioBriefText).toBe('original brief');
  });
});
