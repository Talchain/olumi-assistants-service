/**
 * End-to-end proof that a handler-emitted `mutated_graph` reaches commit.
 *
 * Without this test, the channel from HandlerOutcome → CommitMetadata.graph
 * → store.append({ graph }) is unobservable, and a regression that
 * silently committed `options.graphState` (the ingress, not the mutation)
 * would slip through. This guards the wiring added in turn-executor STEP 7.
 *
 * Also validates that the GraphV3 schema extension (goal_constraints) is
 * preserved through Zod parse, so the `add_constraint` handler has a
 * persistent surface in Commit 2.
 */

import { describe, expect, it } from 'vitest';

import type { HandlerFact } from '@talchain/schemas/orchestrator';

import { commitDirectAnswer } from '../../../../commit.js';
import type { SessionStore, SessionTurnWrite } from '../../../../session/store.js';
import type { OlumiResponse } from '@talchain/schemas/boundary';
import { GraphV3, type GraphV3T } from '../../../../../schemas/cee-v3.js';

import { buildD1Fixture } from './fixtures.js';

interface CapturingStore extends SessionStore {
  readonly captured: { writes: SessionTurnWrite[] };
}

function buildCapturingStore(): CapturingStore {
  const writes: SessionTurnWrite[] = [];
  return {
    captured: { writes },
    async append(write) {
      writes.push(write);
      return {
        id: 'fake-row-id',
        ...(write.graph != null
          ? { graph_write_disposition: 'accepted_insert' as const }
          : {}),
      };
    },
    async readRecent() {
      return [];
    },
    async readFactsFor() {
      return [];
    },
    async invalidateScoped() {
      return { caches_invalidated: 0, scoped_to: 'session' };
    },
    async invalidateAll() {
      return { caches_invalidated: 0, scoped_to: 'session' };
    },
    async storeDraftGraph() {
      return;
    },
    async loadGraph() {
      return null;
    },
    async loadGraphAndBriefText() {
      return { graph: null, briefText: null };
    },
    async ensureScenarioExists() {
      return { user_id: null };
    },
  };
}

const makeResponse = (): OlumiResponse => ({
  response_version: 2,
  assistant_text: 'Updated.',
  blocks: [],
  suggested_actions: [],
  insights: [],
  stage_indicator: 'frame',
});

describe('D1 mutation persistence end-to-end', () => {
  it('routes a handler-supplied mutated_graph through commit to store.append', async () => {
    const store = buildCapturingStore();
    const ingress = buildD1Fixture();
    const mutated: GraphV3T = JSON.parse(JSON.stringify(ingress));
    const churn = mutated.nodes.find((n) => n.id === 'f-churn');
    if (!churn?.observed_state) throw new Error('fixture broken');
    churn.observed_state = { ...churn.observed_state, value: 0.05, raw_value: 5 };

    await commitDirectAnswer(
      makeResponse(),
      {
        scenario_id: 'scn-1',
        turn_id: 'turn-1',
        turn_class: 'direct_answer',
        handler_id: 'set_factor_value',
        request_hash: 'sha256:test',
        llm_calls_used: 0,
        duration_ms: 12,
        handler_facts: [] as readonly HandlerFact[],
        graph: mutated, // simulating turn-executor's `graphForCommit`
        graphReceiptIntent: 'canonical_mutation',
      },
      store,
    );

    expect(store.captured.writes).toHaveLength(1);
    const persistedGraph = store.captured.writes[0].graph as GraphV3T;
    const persistedChurn = persistedGraph.nodes.find((n) => n.id === 'f-churn');
    expect(persistedChurn?.observed_state?.value).toBe(0.05);
    expect(persistedChurn?.observed_state?.raw_value).toBe(5);

    // Original ingress is untouched.
    const ingressChurn = ingress.nodes.find((n) => n.id === 'f-churn');
    expect(ingressChurn?.observed_state?.value).toBe(0.04);
  });

  it('GraphV3 schema preserves goal_constraints through round-trip', () => {
    const ingress = buildD1Fixture();
    const withConstraint = {
      ...ingress,
      goal_constraints: [
        {
          constraint_id: 'gc-1',
          node_id: 'f-churn',
          operator: '<=' as const,
          value: 5,
          unit: '%',
          label: 'Churn cap',
          provenance: 'explicit' as const,
        },
      ],
    };
    const parsed = GraphV3.parse(withConstraint);
    expect(parsed.goal_constraints).toBeDefined();
    expect(parsed.goal_constraints).toHaveLength(1);
    expect(parsed.goal_constraints?.[0]).toMatchObject({
      constraint_id: 'gc-1',
      operator: '<=',
      value: 5,
      unit: '%',
    });
  });
});
