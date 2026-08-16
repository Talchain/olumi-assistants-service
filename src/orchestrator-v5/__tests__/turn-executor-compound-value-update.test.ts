/**
 * TurnExecutor × compound value-update (A1 multi-edit — build lane).
 *
 * Wire-level proof that "Set Factor A to 0.6 and Factor B to 0.8" applies BOTH
 * values in a single turn — the live defect (verified 19 Jul, scenario
 * c4c76247) applied one and narrated the second as deferred.
 *
 * Asserts:
 *   - no LLM call (deterministic pre-route + handler chaining, zero routing)
 *   - two graph_patch blocks, one per factor, both status 'applied'
 *   - the COMMITTED graph carries BOTH mutations (proves graph-in → graph-out
 *     chaining; if the parts ran independently off the ingress, the second
 *     would overwrite the first and only one mutation would survive)
 *   - the receipt names BOTH factors
 *   - GOLDEN PIN: the single-edit path stays a single graph_patch (byte-path
 *     unchanged when there is no second edit)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { MessageTurnPayload } from '@talchain/schemas/boundary';

import { makeMessagePayload } from './fixtures.js';

import { setTestSink } from '../../utils/telemetry.js';
import type { ChatWithToolsArgs, ChatWithToolsResult } from '../../adapters/llm/types.js';

const appendCalls: Array<unknown> = [];
vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: unknown) => {
      appendCalls.push(write);
      return {
        id: 'mock-row-id',
        ...((write as { graph?: unknown }).graph != null
          ? { graph_write_disposition: 'accepted_insert' as const }
          : {}),
      };
    },
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({
      scope: { kind: 'structural' as const },
      entries_invalidated: [],
    }),
    loadGraph: async () => null,
  }),
  resetSessionStoreForTests: () => {},
}));

const { runTurnExecutor } = await import('../turn-executor.js');

const SCENARIO_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const TURN_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

function payload(message: string): MessageTurnPayload {
  return makeMessagePayload({
    turn_id: TURN_ID,
    scenario_id: SCENARIO_ID,
    message,
    turn_class: 'decide',
    stage: 'analyse',
  });
}

function twoFactorGraph() {
  return {
    nodes: [
      { id: 'goal_1', kind: 'goal', label: 'Profit' },
      { id: 'fac_a', kind: 'factor', label: 'Factor A' },
      { id: 'fac_b', kind: 'factor', label: 'Factor B' },
    ],
    edges: [],
  };
}

function threeFactorGraph() {
  return {
    nodes: [
      { id: 'goal_1', kind: 'goal', label: 'Profit' },
      { id: 'fac_a', kind: 'factor', label: 'Factor A' },
      { id: 'fac_b', kind: 'factor', label: 'Factor B' },
      { id: 'fac_c', kind: 'factor', label: 'Factor C' },
    ],
    edges: [],
  };
}

function throwingRoutingAdapter() {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(async () => {
        throw new Error('routing adapter must NOT be called when pre-route matches');
      }),
  };
}

type PatchBlock = {
  type: string;
  operation?: string;
  target_id?: string;
  status?: string;
  after?: { value?: number; raw_value?: number };
};

type Event = { event: string; data: Record<string, unknown> };
let events: Event[] = [];

beforeEach(() => {
  appendCalls.length = 0;
  events = [];
  setTestSink((eventName, data) => events.push({ event: eventName, data }));
});

afterEach(() => {
  setTestSink(null);
});

describe('turn-executor × compound value-update', () => {
  it('"Set Factor A to 0.6 and Factor B to 0.8" → both applied, chained graph, no LLM call', async () => {
    const routingAdapter = throwingRoutingAdapter();
    const { response, telemetry, turn_outcome } = await runTurnExecutor(
      payload('Set Factor A to 0.6 and Factor B to 0.8'),
      'req-compound-both',
      { routingAdapter, graphState: twoFactorGraph() },
    );

    // Deterministic path: the routing adapter is never called.
    expect(routingAdapter.chatWithTools).not.toHaveBeenCalled();
    expect(telemetry?.llm_calls_used ?? 0).toBe(0);
    expect(telemetry?.turn_class).toBe('handler');
    expect(telemetry?.intent_class).toBe('execute');
    expect(telemetry?.failure_type).toBeNull();

    // Two graph_patch blocks — one per factor, both applied.
    const patches = response.blocks.filter((b) => b.type === 'graph_patch') as PatchBlock[];
    expect(patches).toHaveLength(2);
    const byId = new Map(patches.map((p) => [p.target_id, p]));
    expect(byId.get('fac_a')?.status).toBe('applied');
    expect(byId.get('fac_a')?.operation).toBe('set_factor_value');
    expect(byId.get('fac_a')?.after?.value).toBe(0.6);
    expect(byId.get('fac_b')?.status).toBe('applied');
    expect(byId.get('fac_b')?.operation).toBe('set_factor_value');
    expect(byId.get('fac_b')?.after?.value).toBe(0.8);

    // The receipt enumerates BOTH factors.
    expect(response.assistant_text).toContain('Factor A');
    expect(response.assistant_text).toContain('Factor B');

    // graph_mutated reflects a real mutation.
    expect(turn_outcome?.graph_mutated).toBe(true);

    // The COMMITTED graph carries BOTH mutations — proves the parts chain
    // (each part's mutated_graph feeds the next). If they ran independently
    // off the ingress graph, only the last would survive the commit.
    const commitWrite = appendCalls.find(
      (w) => (w as { graph?: { nodes?: unknown[] } }).graph !== undefined,
    ) as { graph?: { nodes?: Array<{ id: string; observed_state?: { value?: number } }> } } | undefined;
    expect(commitWrite?.graph?.nodes).toBeDefined();
    const nodes = commitWrite!.graph!.nodes!;
    const facA = nodes.find((n) => n.id === 'fac_a');
    const facB = nodes.find((n) => n.id === 'fac_b');
    expect(facA?.observed_state?.value).toBe(0.6);
    expect(facB?.observed_state?.value).toBe(0.8);
  });

  it('three-way compound → all three applied and committed (proves parts chain, not overwrite)', async () => {
    // A 3-way edit is the case a NON-chaining implementation cannot satisfy:
    // if each part ran off the same ingress graph, the final committed graph
    // would carry only the LAST part's mutation. Requiring ALL THREE values in
    // the committed graph pins the graph-in → graph-out threading.
    const routingAdapter = throwingRoutingAdapter();
    const { response } = await runTurnExecutor(
      payload('Set Factor A to 0.6 and Factor B to 0.8 and Factor C to 0.3'),
      'req-compound-three',
      { routingAdapter, graphState: threeFactorGraph() },
    );

    expect(routingAdapter.chatWithTools).not.toHaveBeenCalled();
    const patches = response.blocks.filter((b) => b.type === 'graph_patch') as PatchBlock[];
    expect(patches).toHaveLength(3);

    const commitWrite = appendCalls.find(
      (w) => (w as { graph?: { nodes?: unknown[] } }).graph !== undefined,
    ) as { graph?: { nodes?: Array<{ id: string; observed_state?: { value?: number } }> } } | undefined;
    const nodes = commitWrite?.graph?.nodes ?? [];
    expect(nodes.find((n) => n.id === 'fac_a')?.observed_state?.value).toBe(0.6);
    expect(nodes.find((n) => n.id === 'fac_b')?.observed_state?.value).toBe(0.8);
    expect(nodes.find((n) => n.id === 'fac_c')?.observed_state?.value).toBe(0.3);
    expect(response.assistant_text).toContain('Factor A');
    expect(response.assistant_text).toContain('Factor B');
    expect(response.assistant_text).toContain('Factor C');
  });

  it('GOLDEN PIN: single-edit "Set Factor A to 0.6" stays a single graph_patch (compound path untouched)', async () => {
    const routingAdapter = throwingRoutingAdapter();
    const { response, telemetry } = await runTurnExecutor(
      payload('Set Factor A to 0.6'),
      'req-compound-single-pin',
      { routingAdapter, graphState: twoFactorGraph() },
    );

    expect(routingAdapter.chatWithTools).not.toHaveBeenCalled();
    expect(telemetry?.llm_calls_used ?? 0).toBe(0);
    expect(telemetry?.turn_class).toBe('handler');

    const patches = response.blocks.filter((b) => b.type === 'graph_patch') as PatchBlock[];
    expect(patches).toHaveLength(1);
    expect(patches[0]!.target_id).toBe('fac_a');
    expect(patches[0]!.after?.value).toBe(0.6);

    // Only Factor A is committed-mutated; Factor B is untouched.
    const commitWrite = appendCalls.find(
      (w) => (w as { graph?: { nodes?: unknown[] } }).graph !== undefined,
    ) as { graph?: { nodes?: Array<{ id: string; observed_state?: { value?: number } }> } } | undefined;
    const nodes = commitWrite?.graph?.nodes ?? [];
    expect(nodes.find((n) => n.id === 'fac_a')?.observed_state?.value).toBe(0.6);
    expect(nodes.find((n) => n.id === 'fac_b')?.observed_state?.value).toBeUndefined();
  });
});
