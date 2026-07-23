/**
 * ROADMAP 1.192 leg 2 — ADOPT-ON-FIRST-TOUCH.
 *
 * The invisibility (byte-verified at turn-executor.ts graphForCommit IIFE):
 * a first-touch turn carrying request `graph_state` with NO server model was
 * reasoned over once and then EVAPORATED — `graphForCommit` derived ONLY from
 * `handlerOutcome.mutated_graph`, so a non-mutating first-touch turn persisted
 * NO graph. The next turn had no server model, CEE was model-blind, and
 * analysis ran against an empty row. This is guest-template invisibility.
 *
 * The fix adopts the ingress `graph_state` at the single commit chokepoint via
 * a fail-closed 6-row decision table, routing the adopted graph through the W2
 * pipeline (repair → options[]-reconcile [decision ③] → CAS-stamp). Adopt is
 * server-authoritative: it can NEVER overwrite an existing server model
 * (rows E/F never adopt).
 *
 * RED-first: rows A/B and the options[]-free-ride assert the ADOPT — they go
 * RED with the adopt branch reverted (mutation-checked in a throwaway
 * worktree). Row E asserts the SAFETY (never clobber a server model) — it goes
 * RED if the `hasServerModel` guard is removed.
 *
 * Harness mirrors turn-executor-non-mutating-commit-graph.test.ts (the sibling
 * H2 suite): a stateful session-store mock whose `append` REPLACES the
 * persisted graph only when the write carries a non-nullish `graph`.
 */

import { readFileSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MessageTurnPayload } from '@talchain/schemas/boundary';

import { setTestSink } from '../../utils/telemetry.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
} from '../../adapters/llm/types.js';

// ---------------------------------------------------------------------------
// Stateful session-store mock (p_graph semantics: null leaves graph untouched).
// ---------------------------------------------------------------------------

interface AppendWrite {
  graph?: unknown;
  handler_id?: unknown;
  turn_class?: unknown;
}

const appendCalls: AppendWrite[] = [];
let currentPersistedGraph: unknown = null;
let failNextAppend = false;

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: AppendWrite) => {
      if (failNextAppend) {
        failNextAppend = false;
        // Mirror supabase-store's StateCommitFailedError surface (the turn's
        // STEP 7 catch maps it to a typed failure envelope; nothing persists).
        throw new Error('append_turn_atomic RPC failed (injected): commit rolled back');
      }
      appendCalls.push(write);
      if (write.graph !== undefined && write.graph !== null) {
        currentPersistedGraph = write.graph;
      }
      return { id: 'mock-row-id' };
    },
    readRecent: async () => [],
    readFactsFor: async () => [],
    readMostRecentPendingActions: async () => [],
    invalidateScoped: async () => ({
      scope: { kind: 'structural' as const },
      entries_invalidated: [],
    }),
    invalidateAll: async () => ({
      scope: { kind: 'structural' as const },
      entries_invalidated: [],
    }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => currentPersistedGraph,
    loadGraphAndBriefText: async () => ({
      graph: currentPersistedGraph,
      briefText: null,
    }),
    ensureScenarioExists: async () => ({ user_id: null }),
  }),
  resetSessionStoreForTests: () => undefined,
}));

const { runTurnExecutor } = await import('../turn-executor.js');

// ---------------------------------------------------------------------------
// Fixtures — the captured EXP-01 shapes. ECHO is a valid DGAI-shaped
// graph_state: 16 nodes (4 option-KIND), 27 edges, goal_node_id, NO top-level
// options[]. RICH is the draft-persisted shape WITH options[] (used as the
// "server model exists" state for the row E safety pins).
// ---------------------------------------------------------------------------

const ECHO_GRAPH_STATE = JSON.parse(
  readFileSync(new URL('./fixtures/exp01/echo-graph-state.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;

const RICH_PERSISTED_GRAPH = JSON.parse(
  readFileSync(new URL('./fixtures/exp01/rich-persisted-graph.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const SCENARIO_ID = '49769b89-37c7-4c98-a278-4e389fa1cfc1';
const OPTION_NODE_IDS = ['opt_hire_local', 'opt_offshore', 'opt_status_quo', 'opt_tiered_pricing'];

function payload(message: string, turnId: string): MessageTurnPayload {
  return {
    kind: 'message',
    source: 'composer',
    turn_id: turnId,
    scenario_id: SCENARIO_ID,
    message,
    turn_class: 'frame',
    stage: 'analyse',
  };
}

function mkTextResult(text: string): ChatWithToolsResult {
  return {
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 10, output_tokens: 20 } as unknown as ChatWithToolsResult['usage'],
    model: 'claude-sonnet-4-6',
    latencyMs: 50,
  };
}

function textRoutingAdapter(text: string) {
  return {
    chatWithTools: vi
      .fn<(a: ChatWithToolsArgs, o: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(async () => mkTextResult(text)),
  };
}

function throwingRoutingAdapter() {
  return {
    chatWithTools: vi
      .fn<(a: ChatWithToolsArgs, o: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(async () => {
        throw new Error('routing adapter must NOT be called on this deterministic path');
      }),
  };
}

beforeEach(() => {
  setTestSink(() => undefined);
  appendCalls.length = 0;
  currentPersistedGraph = null;
  failNextAppend = false;
});

afterEach(() => {
  setTestSink(null);
});

// ---------------------------------------------------------------------------
// Row A — ADOPT (the core case). RED-first: pre-fix `graph` is undefined.
// ---------------------------------------------------------------------------

describe('row A — first-touch adopt (no server model + incoming + no mutation)', () => {
  it('persists the request graph_state at commit (the invisibility CLOSED)', async () => {
    currentPersistedGraph = null; // first touch: no server model

    await runTurnExecutor(
      payload('what do you think of my decision?', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01'),
      'req-adopt-A',
      {
        routingAdapter: textRoutingAdapter('Here is what I see in your model.'),
        graphState: clone(ECHO_GRAPH_STATE) as never,
      },
    );

    // The commit carried the adopted graph (pre-fix: undefined → RED).
    expect(appendCalls).toHaveLength(1);
    expect(appendCalls[0]!.graph).toBeDefined();
    const committed = appendCalls[0]!.graph as { nodes: unknown[]; edges: unknown[] };
    expect(committed.nodes).toHaveLength((ECHO_GRAPH_STATE.nodes as unknown[]).length);
    expect(committed.edges).toHaveLength((ECHO_GRAPH_STATE.edges as unknown[]).length);

    // The persisted row now holds the adopted graph — the next turn has a model.
    expect(computeAnalysisAffectingGraphHash(currentPersistedGraph as never)).not.toBeNull();
  });

  it('options[] free-ride: the adopt routes through decision ③ — a PARTIAL top-level options[] on the incoming graph is COMPLETED from the option-KIND nodes (which W1 never runs)', async () => {
    // ⚠ CORRECTION to the brief's §2.1/§7 claim (verified at the bytes):
    // reconcileTopLevelOptionsFromNodes is UPDATE-IF-PRESENT — it does NOT
    // invent an ABSENT options[] (reconcile-top-level-options.ts:
    // `if (!Array.isArray(options)) return []`). It only COMPLETES a present-
    // but-partial options[]. So the free-ride is proven with a partial array:
    // the incoming template carries 3 of its 4 option-KIND nodes in options[];
    // adopt-via-commit appends the 4th.
    currentPersistedGraph = null;
    const partial = clone(ECHO_GRAPH_STATE) as Record<string, unknown>;
    partial.options = OPTION_NODE_IDS.slice(0, 3).map((id) => ({ id })); // 3 of 4

    await runTurnExecutor(
      payload('any thoughts?', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02'),
      'req-adopt-A-opts',
      {
        routingAdapter: textRoutingAdapter('A few.'),
        graphState: partial as never,
      },
    );

    const committed = appendCalls[0]!.graph as { options?: Array<{ id: string }> };
    expect(Array.isArray(committed.options)).toBe(true);
    const ids = (committed.options ?? []).map((o) => o.id).sort();
    // The 4th option (opt_tiered_pricing) was appended by decision ③ on adopt.
    expect(ids).toEqual([...OPTION_NODE_IDS].sort());
  });

  it('honest no-op: an incoming template with NO top-level options[] persists faithfully but options[] is NOT invented (option nodes stay in nodes[]; options derived downstream at run_analysis)', async () => {
    currentPersistedGraph = null;
    expect(ECHO_GRAPH_STATE.options).toBeUndefined();

    await runTurnExecutor(
      payload('thoughts?', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02b'),
      'req-adopt-A-noopts',
      {
        routingAdapter: textRoutingAdapter('A few.'),
        graphState: clone(ECHO_GRAPH_STATE) as never,
      },
    );

    const committed = appendCalls[0]!.graph as {
      options?: unknown;
      nodes: Array<{ id: string; kind?: string }>;
    };
    // options[] NOT invented (update-if-present no-op)…
    expect(Array.isArray(committed.options)).toBe(false);
    // …but the 4 option-KIND nodes ARE persisted in nodes[] (analysis derives
    // options from node kinds), so the graph is not model-blind.
    const optionNodeIds = committed.nodes.filter((n) => n.kind === 'option').map((n) => n.id).sort();
    expect(optionNodeIds).toEqual([...OPTION_NODE_IDS].sort());
  });

  it('numeric floor is NOT applied at adopt (identity-preserving): a std=0 edge persists verbatim so the hash stays stable', async () => {
    currentPersistedGraph = null;
    const withZeroStd = clone(ECHO_GRAPH_STATE) as {
      edges: Array<{ strength?: { mean?: number; std?: number } }>;
    };
    // Set one edge's std to exactly 0 (ingress passes std<=0 through unrepaired;
    // it is floored later at the compute-load seam, never at write).
    withZeroStd.edges[0]!.strength = { mean: 0.5, std: 0 };
    const expectedHash = computeAnalysisAffectingGraphHash(withZeroStd as never);

    await runTurnExecutor(
      payload('thoughts?', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa03'),
      'req-adopt-A-std0',
      {
        routingAdapter: textRoutingAdapter('Sure.'),
        graphState: clone(withZeroStd) as never,
      },
    );

    const committed = appendCalls[0]!.graph as {
      edges: Array<{ strength?: { std?: number } }>;
    };
    // std=0 survived verbatim (NOT floored to COMPUTE_SIGMA_FLOOR at write).
    expect(committed.edges[0]!.strength!.std).toBe(0);
    // The persisted hash equals the incoming hash — adopt forked no identity.
    expect(computeAnalysisAffectingGraphHash(currentPersistedGraph as never)).toBe(expectedHash);
  });

  it('adopt persists SILENTLY: a row-A adopt commits the graph but attaches NO draft_graph to the wire (no spurious apply-to-canvas receipt on a coaching turn)', async () => {
    currentPersistedGraph = null;

    const { response } = await runTurnExecutor(
      payload('what do you think?', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa0d'),
      'req-adopt-A-nodraft',
      {
        routingAdapter: textRoutingAdapter('Here is what I see.'),
        graphState: clone(ECHO_GRAPH_STATE) as never,
      },
    );

    // The graph was adopted (committed)…
    expect(appendCalls[0]!.graph).toBeDefined();
    // …but the response advertises NO draft_graph — the UI already holds this
    // graph and syncs identity via the κ handshake, not an apply receipt.
    expect('draft_graph' in response).toBe(false);
  });

  it('fail-closed: an adopt write failure does not half-land — nothing persists', async () => {
    currentPersistedGraph = null;
    failNextAppend = true;

    await runTurnExecutor(
      payload('thoughts?', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa04'),
      'req-adopt-A-fail',
      {
        routingAdapter: textRoutingAdapter('Sure.'),
        graphState: clone(ECHO_GRAPH_STATE) as never,
      },
    );

    // The append threw → the STEP 7 catch handled it; the mock never recorded a
    // successful write and the persisted graph stays null (no half-land).
    expect(appendCalls).toHaveLength(0);
    expect(currentPersistedGraph).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Row E — SAFETY: a server model exists → NEVER adopt client graph_state.
// This is the load-bearing "adopt can never overwrite durable state" property.
// Mutation-check: remove the `hasServerModel` guard and this goes RED.
// ---------------------------------------------------------------------------

describe('row E — server model exists (never clobber with client graph_state)', () => {
  it('a divergent incoming graph_state on a non-mutating turn does NOT overwrite the server model', async () => {
    currentPersistedGraph = clone(RICH_PERSISTED_GRAPH); // server model with >=1 node
    const pristine = JSON.stringify(currentPersistedGraph);

    await runTurnExecutor(
      payload('why does that option lead?', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa05'),
      'req-adopt-E',
      {
        routingAdapter: textRoutingAdapter('Because of its strongest driver.'),
        graphState: clone(ECHO_GRAPH_STATE) as never, // divergent from persisted
      },
    );

    // Persisted-wins: the commit carried NO graph; the server model is byte-intact.
    expect(appendCalls).toHaveLength(1);
    expect(appendCalls[0]!.graph).toBeUndefined();
    expect(JSON.stringify(currentPersistedGraph)).toBe(pristine);
  });
});

// ---------------------------------------------------------------------------
// Row C — nothing to adopt (no incoming): today's honest-empty behaviour.
// ---------------------------------------------------------------------------

describe('row C — no incoming, no mutation, no server model', () => {
  it('commits NO graph (does not fabricate one)', async () => {
    currentPersistedGraph = null;

    await runTurnExecutor(
      payload('hello', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa06'),
      'req-adopt-C',
      { routingAdapter: textRoutingAdapter('Hi — tell me about your decision.') },
      // NO graphState supplied → no incoming.
    );

    expect(appendCalls).toHaveLength(1);
    expect(appendCalls[0]!.graph).toBeUndefined();
    expect(currentPersistedGraph).toBeNull();
  });

  it('an EMPTY incoming ({nodes:[]}) is treated as no incoming — no adopt of an empty graph', async () => {
    currentPersistedGraph = null;

    await runTurnExecutor(
      payload('hello', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa07'),
      'req-adopt-C-empty',
      {
        routingAdapter: textRoutingAdapter('Hi.'),
        graphState: { nodes: [], edges: [] } as never,
      },
    );

    expect(appendCalls[0]!.graph).toBeUndefined();
    expect(currentPersistedGraph).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Row B — adopt-then-edit: first-touch + a mutating handler → the mutation
// merges onto the INCOMING graph (not the empty persisted read), so incoming's
// top-level fields (goal_node_id) survive.
// ---------------------------------------------------------------------------

describe('row B — first-touch + mutating handler (merge base = incoming)', () => {
  it('deterministic set_factor_value on a first-touch graph_state persists the mutation MERGED onto incoming (goal_node_id preserved)', async () => {
    currentPersistedGraph = null; // first touch

    await runTurnExecutor(
      payload(
        'Set the Local Senior Hire Indicator factor to 1.0.',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa08',
      ),
      'req-adopt-B',
      {
        routingAdapter: throwingRoutingAdapter(), // deterministic pre-route, no LLM
        graphState: clone(ECHO_GRAPH_STATE) as never,
      },
    );

    const write = appendCalls.at(-1)!;
    expect(write.handler_id).toBe('set_factor_value');
    expect(write.graph).toBeDefined();
    const committed = write.graph as {
      goal_node_id?: unknown;
      nodes: Array<{ id: string; observed_state?: { value?: number } }>;
    };
    // The mutation applied ON the adopted base…
    const mutated = committed.nodes.find((n) => n.id === 'fac_local_hire');
    expect(mutated?.observed_state?.value).toBe(1);
    // …and incoming's goal_node_id survived the merge (base = incoming, not empty).
    expect(committed.goal_node_id).toBe(ECHO_GRAPH_STATE.goal_node_id);
  });
});
