/**
 * P0 L-22 — route-level tests for `structural_delete`, the DURABLE removal.
 *
 * THE DEFECT, in the founder's words: *"Every time I try to re-run the analysis,
 * it fails because it keeps adding the option that I deleted back."*
 *
 * ROOT CAUSE (verified at the bytes): `SYSTEM_EVENT_HANDLING` mapped every
 * structural edit notification to `'ack_and_commit'` — a turn row is committed
 * and NO GRAPH IS WRITTEN. The next turn calls `loadPersistedGraphStrict`, the
 * option is still there, and `mergeAppliedGraph` re-adds it. Correctly, in fact:
 * absent-locally means "just added, save debounced", and no delete record ever
 * existed for it to consult.
 *
 * ⭐ THE RED-FIRST SIGNATURE. At pristine (`structural_delete: 'ack_and_commit'`)
 * the first test below FAILS on `expect(committedGraph()).toBeDefined()` — no
 * graph reaches the store at all — and the CONTRAST CONTROL immediately after it
 * PASSES on the same tree, proving the harness can see a persisted write when one
 * happens. Without that pair a failing test proves only that something is broken
 * somewhere.
 *
 * TWINS (CLAUDE.md trap 22b — a fix that closes a gap must not open its inverse):
 *   - a valid delete persists AND survives a reload   ↔ a diverged base hash is REFUSED
 *   - a node removal cascades its incident edges       ↔ unrelated edges SURVIVE
 *   - a removal of an absent id is refused             ↔ a present id is applied
 *   - `direct_graph_edit` stays a no-write ack         (a client-side ADD must not
 *                                                       become a server mutation)
 *   - both arrays empty is refused by the contract     (a delete that removes nothing)
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { computeAnalysisAffectingGraphHash } from '../../../src/orchestrator-v5/context/graph-hash.js';

// ── the persisted model ────────────────────────────────────────────────────
// Two options so a delete leaves the model analysable, plus an edge on each so
// the cascade has something to take and something it must NOT take.
function buildPersistedGraph() {
  return {
    goal_node_id: 'g-revenue',
    schema_version: 'cee-v3',
    nodes: [
      { id: 'g-revenue', kind: 'goal', label: 'Revenue' },
      {
        id: 'f-budget',
        kind: 'factor',
        label: 'Marketing budget',
        observed_state: { value: 0.4, raw_value: 40000, unit: '£', cap: 100000 },
      },
      { id: 'o-launch', kind: 'option', label: 'Launch now' },
      { id: 'o-wait', kind: 'option', label: 'Wait a quarter' },
    ],
    edges: [
      {
        from: 'f-budget',
        to: 'g-revenue',
        strength: { mean: 0.4, std: 0.1 },
        exists_probability: 0.9,
        effect_direction: 'positive',
      },
      // incident to o-launch — the cascade MUST take this one
      {
        from: 'o-launch',
        to: 'g-revenue',
        strength: { mean: 0.5, std: 0.1 },
        exists_probability: 0.9,
        effect_direction: 'positive',
      },
      // incident to o-wait — the cascade MUST NOT take this one
      {
        from: 'o-wait',
        to: 'g-revenue',
        strength: { mean: 0.3, std: 0.1 },
        exists_probability: 0.9,
        effect_direction: 'positive',
      },
    ],
  };
}

const appendMock = vi.fn();
let persisted: unknown = buildPersistedGraph();

/**
 * WRITE-THROUGH store mock. `append` promotes a graph-bearing write into
 * `persisted`, so a SECOND request reads what the FIRST one committed. That is
 * what makes the "survives a reload" twin a real measurement of durability
 * rather than a restatement of the first assertion.
 */
function installWriteThroughAppend() {
  appendMock.mockImplementation(async (write: { graph?: unknown }) => {
    if (write.graph !== undefined && write.graph !== null) persisted = write.graph;
    return { id: 'mock-row-id' };
  });
}

vi.mock('../../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: appendMock,
    readRecent: async () => [],
    readFactsFor: async () => [],
    // The writer reads the newest pending set integrity-STRICTLY before any
    // append, so the carry-forward lifecycle stays canonical. A healthy empty
    // read is the normal case here.
    readMostRecentPendingActions: async () => [],
    loadGraph: async () => persisted,
    loadGraphAndBriefText: async () => ({ graph: persisted, briefText: null }),
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    ensureScenarioExists: async (_id: string, userId: string) => ({ user_id: userId }),
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

// The ORIENT step is the only thing that reaches the LLM. Asserting it was never
// called proves the delete stayed on the deterministic path.
const llmChatMock = vi.fn();
vi.mock('../../../src/adapters/llm/router.js', () => ({
  getAdapter: () => ({ name: 'test', model: 'test-model', chat: llmChatMock, chatWithTools: llmChatMock }),
  getAdapterWithResolution: () => ({
    adapter: { name: 'test', model: 'test-model', chat: llmChatMock, chatWithTools: llmChatMock },
    resolution: {
      task: 'narrate',
      resolved_model: 'test-model',
      resolution_source: 'task_default' as const,
    },
  }),
  getMaxTokensFromConfig: () => undefined,
}));

vi.mock('../../../src/config/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../src/config/index.js')>();
  return {
    ...original,
    config: new Proxy(original.config as object, {
      get(target, prop) {
        if (prop === 'features') {
          return new Proxy(Reflect.get(target, prop) as object, {
            get(featTarget, featProp) {
              if (featProp === 'pipelineV4Enabled') return false;
              return Reflect.get(featTarget, featProp);
            },
          });
        }
        return Reflect.get(target, prop);
      },
    }),
  };
});

const { ceeOrchestratorRouteV2 } = await import('../../../src/orchestrator/route-v2.js');

const SCENARIO_ID = '33333333-3333-4333-8333-333333333333';
const TURN_ID_BASE = '44444444-4444-4444-8444-4444444444';

/**
 * The analysis-affecting hash of the CURRENT persisted graph — what a live client
 * holds, and the only hash CEE ever puts on the wire.
 *
 * The non-null assertion is a real GUARD, not a cast to silence the compiler:
 * `computeAnalysisAffectingGraphHash` returns `string | null`, and a null here
 * would send `base_graph_hash: "null"`-ish garbage into the stale gate and make
 * every CAS test below pass for the wrong reason. Failing loudly on null keeps
 * the fixture honest.
 */
function currentBaseHash(): string {
  const hash = computeAnalysisAffectingGraphHash(persisted as never);
  if (hash === null) {
    throw new Error(
      'fixture graph produced no analysis-affecting hash — the base_graph_hash tests would be vacuous',
    );
  }
  return hash;
}

function payloadFor(event: Record<string, unknown>, suffix: string) {
  return {
    kind: 'system_event',
    // Padded to two HEX chars: the last UUID group must be 12 hex digits, and a
    // non-hex suffix makes the whole payload fail boundary validation with 422
    // (measured — it looked like a contract refusal of the event itself).
    turn_id: `${TURN_ID_BASE}${suffix.padStart(2, '0')}`,
    scenario_id: SCENARIO_ID,
    stage: 'analyse',
    event,
  };
}

/** The graph the commit actually handed the store, or undefined if none. */
function committedGraph(): Record<string, unknown> | undefined {
  const arg = appendMock.mock.calls.at(-1)?.[0] as { graph?: Record<string, unknown> } | undefined;
  return arg?.graph;
}

function nodeIds(graph: Record<string, unknown> | undefined): string[] {
  return ((graph?.nodes ?? []) as Array<{ id: string }>).map((n) => n.id);
}

function edgePairs(graph: Record<string, unknown> | undefined): string[] {
  return ((graph?.edges ?? []) as Array<{ from: string; to: string }>).map(
    (e) => `${e.from}->${e.to}`,
  );
}

async function post(event: Record<string, unknown>, suffix: string) {
  return await app.inject({
    method: 'POST',
    url: '/orchestrate/v2/turn',
    payload: payloadFor(event, suffix),
  });
}

let app: FastifyInstance;

describe('POST /orchestrate/v2/turn — structural_delete (a deleted option stays deleted)', () => {
  beforeAll(async () => {
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    appendMock.mockClear();
    llmChatMock.mockClear();
    persisted = buildPersistedGraph();
    installWriteThroughAppend();
  });

  // ══ 1. THE RED-FIRST SIGNATURE ═══════════════════════════════════════════
  // At pristine this test fails on `expect(committedGraph()).toBeDefined()`.

  it('RED-FIRST: a remove-bearing structural_delete WRITES the persisted graph and the option is GONE', async () => {
    const base = currentBaseHash();
    const res = await post(
      {
        kind: 'structural_delete',
        removed_node_ids: ['o-launch'],
        removed_edges: [],
        base_graph_hash: base,
      },
      '0',
    );

    expect(res.statusCode).toBe(200);
    expect(llmChatMock).not.toHaveBeenCalled();

    // THE ASSERTION THE DEFECT FAILS: a graph reaches the store at all.
    const graph = committedGraph();
    expect(graph).toBeDefined();

    // …and the option the user deleted is absent from the bytes that landed.
    expect(nodeIds(graph)).not.toContain('o-launch');
    // Bound by IDENTITY, not by a count another node could satisfy.
    expect(nodeIds(graph)).toContain('o-wait');
    expect(nodeIds(graph)).toContain('g-revenue');

    // Canonical top-level state SURVIVES. `applyPatchOperations` returns only
    // {nodes, edges}; losing `goal_node_id` would silently un-analysable the
    // scenario on the very turn the user edited it.
    expect(graph?.goal_node_id).toBe('g-revenue');
    expect(graph?.schema_version).toBe('cee-v3');
  });

  it('CONTRAST CONTROL: factor_value_edit DOES write the persisted graph (the harness can see a write)', async () => {
    const res = await post(
      { kind: 'factor_value_edit', target_id: 'f-budget', value: 0.5, raw_value: 50000, unit: '£' },
      '1',
    );

    expect(res.statusCode).toBe(200);
    const graph = committedGraph();
    expect(graph).toBeDefined();
    const obs = ((graph?.nodes ?? []) as Array<{ id: string; observed_state?: { raw_value?: number } }>)
      .find((n) => n.id === 'f-budget')?.observed_state;
    expect(obs?.raw_value).toBe(50000);
  });

  // ══ 2. DURABILITY — it survives a reload ═════════════════════════════════

  it('TWIN (persists): the deletion SURVIVES a reload — a second turn reads a graph without the option', async () => {
    await post(
      {
        kind: 'structural_delete',
        removed_node_ids: ['o-launch'],
        removed_edges: [],
        base_graph_hash: currentBaseHash(),
      },
      '2',
    );

    // The store now holds the post-delete graph. This is the founder's exact
    // symptom, measured: the NEXT turn must not see the option again.
    expect(nodeIds(persisted as Record<string, unknown>)).not.toContain('o-launch');

    appendMock.mockClear();
    const second = await post(
      { kind: 'factor_value_edit', target_id: 'f-budget', value: 0.6, raw_value: 60000, unit: '£' },
      '3',
    );
    expect(second.statusCode).toBe(200);
    // The second turn's own committed graph — read back from the persisted base
    // — still has no `o-launch`. The delete is durable, not turn-local.
    expect(nodeIds(committedGraph())).not.toContain('o-launch');
  });

  // ══ 3. CASCADE — no dangling edges, and no over-reach ════════════════════

  it('cascades incident edges (no dangling references) and leaves UNRELATED edges intact', async () => {
    await post(
      {
        kind: 'structural_delete',
        removed_node_ids: ['o-launch'],
        removed_edges: [],
        base_graph_hash: currentBaseHash(),
      },
      '4',
    );

    const pairs = edgePairs(committedGraph());
    // the cascade took the incident edge…
    expect(pairs).not.toContain('o-launch->g-revenue');
    // …and NOTHING else. The opposite-direction twin of the cascade rule.
    expect(pairs).toContain('o-wait->g-revenue');
    expect(pairs).toContain('f-budget->g-revenue');

    // Referential integrity: every surviving edge's endpoints still exist.
    const ids = new Set(nodeIds(committedGraph()));
    for (const e of (committedGraph()?.edges ?? []) as Array<{ from: string; to: string }>) {
      expect(ids.has(e.from)).toBe(true);
      expect(ids.has(e.to)).toBe(true);
    }
  });

  it('PRUNES the deleted option from the TOP-LEVEL options[] array, not just from nodes[]', async () => {
    // ⭐ THIS IS THE P0 WEARING A DIFFERENT FIELD NAME, and it was found by a
    // surviving mutant rather than by reading the code. GraphV3 carries options
    // in TWO places — option-kind entries in `nodes[]` and a top-level
    // `options[]` array — and live CEE readers PREFER `options[]` (the
    // ContextPack projection among them). A merge that only replaces
    // nodes/edges leaves the deleted option listed in `options[]`, so the
    // canonical option surface still has it and the resurrection continues.
    persisted = {
      ...buildPersistedGraph(),
      options: [
        { id: 'o-launch', label: 'Launch now' },
        { id: 'o-wait', label: 'Wait a quarter' },
      ],
    };

    const res = await post(
      {
        kind: 'structural_delete',
        removed_node_ids: ['o-launch'],
        removed_edges: [],
        base_graph_hash: currentBaseHash(),
      },
      'f',
    );
    expect(res.statusCode).toBe(200);

    const graph = committedGraph();
    expect(nodeIds(graph)).not.toContain('o-launch');
    const optionIds = ((graph?.options ?? []) as Array<{ id: string }>).map((o) => o.id);
    // Bound by identity: the deleted option is gone…
    expect(optionIds).not.toContain('o-launch');
    // …and the OTHER option's entry is preserved byte-for-byte (the
    // opposite-direction twin — a prune that took both would be a worse defect
    // than the one being fixed).
    expect(optionIds).toContain('o-wait');
  });

  it('an edges-only delete removes exactly the named edge and no node', async () => {
    await post(
      {
        kind: 'structural_delete',
        removed_node_ids: [],
        removed_edges: [{ from: 'o-wait', to: 'g-revenue' }],
        base_graph_hash: currentBaseHash(),
      },
      '5',
    );

    const graph = committedGraph();
    expect(graph).toBeDefined();
    expect(edgePairs(graph)).not.toContain('o-wait->g-revenue');
    expect(nodeIds(graph)).toContain('o-wait');
    expect(nodeIds(graph)).toContain('o-launch');
  });

  it('a node removal and its own incident edge in ONE event is not a double-removal failure', async () => {
    // The client legitimately enumerates both. `applyRemoveNode` cascades the
    // edge first, so the following `remove_edge` would throw EDGE_NOT_FOUND
    // without the cascade elision. This must be a clean apply, not a refusal.
    const res = await post(
      {
        kind: 'structural_delete',
        removed_node_ids: ['o-launch'],
        removed_edges: [{ from: 'o-launch', to: 'g-revenue' }],
        base_graph_hash: currentBaseHash(),
      },
      '6',
    );

    expect(res.statusCode).toBe(200);
    expect(committedGraph()).toBeDefined();
    expect(nodeIds(committedGraph())).not.toContain('o-launch');
    expect(edgePairs(committedGraph())).not.toContain('o-launch->g-revenue');
  });

  // ══ 4. THE STALE GATE — the opposite-direction twin ══════════════════════

  it('TWIN (refuses): a DIVERGED base_graph_hash is REFUSED — never silently applied', async () => {
    const res = await post(
      {
        kind: 'structural_delete',
        removed_node_ids: ['o-launch'],
        removed_edges: [],
        base_graph_hash: 'deadbeefdeadbeef',
      },
      '7',
    );

    // 409 + the estate's recovery envelope, NOT a 200 that pretends.
    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('GRAPH_DIVERGED');
    expect(body.details?.failure_type).toBe('GRAPH_DIVERGED');
    expect(body.details?.conflict_category).toBe('BASE_HASH_DIVERGED');
    expect(body.details?.recovery_action).toBe('refresh_and_reconfirm');
    expect(body.details?.retryable).toBe(false);
    // The server tells the client WHICH graph it actually holds, so a refresh
    // is a bounded action rather than a guess.
    expect(body.details?.expected_base_graph_hash).toBe(
      computeAnalysisAffectingGraphHash(buildPersistedGraph() as never),
    );

    // NOTHING LANDED — not the graph, and not a turn row either.
    expect(appendMock).not.toHaveBeenCalled();
    expect(nodeIds(persisted as Record<string, unknown>)).toContain('o-launch');
  });

  // ══ 5. TRUTHFUL ACKNOWLEDGEMENT (P5 / P8) ════════════════════════════════

  it('the acknowledgement is TRUTHFUL — it names what was removed, and is never a silent 200', async () => {
    const res = await post(
      {
        kind: 'structural_delete',
        removed_node_ids: ['o-launch'],
        removed_edges: [],
        base_graph_hash: currentBaseHash(),
      },
      '8',
    );
    const body = JSON.parse(res.body);

    // The defect being closed here is its own trust failure: HTTP 200 with an
    // EMPTY assistant_text — the product accepting a deletion it did not
    // perform and saying nothing.
    expect(body.assistant_text).toBeTruthy();
    expect(body.assistant_text.length).toBeGreaterThan(0);
    // Grounded in the label of the node that was ACTUALLY removed (P5: the
    // claim cites the persisted read it came from).
    expect(body.assistant_text).toContain('Launch now');

    // The authoritative receipt the UI binds to: `draft_graph` is the UI's ONLY
    // inline-graph ingestion path (applied-graph-emit.ts). It must describe the
    // POST-delete graph, or the canvas re-renders the option.
    expect(body.draft_graph).toBeDefined();
    expect(
      (body.draft_graph.nodes as Array<{ id: string }>).map((n) => n.id),
    ).not.toContain('o-launch');
    expect(body.draft_graph.node_count).toBe(3);

    // …and the advertised hash is the hash of what LANDED.
    expect(body.graph_hash).toBe(computeAnalysisAffectingGraphHash(committedGraph() as never));
  });

  // ══ 6. HONEST REFUSALS ═══════════════════════════════════════════════════

  it('REFUSES a node id that is not in the persisted graph — no write, no false success', async () => {
    const res = await post(
      {
        kind: 'structural_delete',
        removed_node_ids: ['o-does-not-exist'],
        removed_edges: [],
        base_graph_hash: currentBaseHash(),
      },
      '9',
    );

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(committedGraph()).toBeUndefined();
    expect(body.assistant_text).toMatch(/haven't changed|couldn't find/i);
    expect(nodeIds(persisted as Record<string, unknown>)).toContain('o-launch');
  });

  it('REFUSES an edge that is not in the persisted graph — no write', async () => {
    const res = await post(
      {
        kind: 'structural_delete',
        removed_node_ids: [],
        removed_edges: [{ from: 'o-wait', to: 'f-budget' }],
        base_graph_hash: currentBaseHash(),
      },
      'a',
    );

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(committedGraph()).toBeUndefined();
    // Not vacuous: the refusal must SAY it changed nothing. At pristine the
    // no-write assertion passes for the wrong reason (nothing ever writes), so
    // this line is what discriminates a real refusal from a silent 200.
    expect(body.assistant_text).toMatch(/haven't removed anything/i);
    expect(edgePairs(persisted as Record<string, unknown>)).toContain('o-wait->g-revenue');
  });

  it('REFUSES a DUPLICATED edge rather than removing whichever one sorts first', async () => {
    // ⭐ ADDED BECAUSE A MUTANT SURVIVED. Neutering the edge resolver looked
    // harmless: for an ABSENT edge the applier throws `EDGE_NOT_FOUND` one seam
    // later and the refusal is the same, so the mutant was genuinely equivalent
    // on that class — my corpus simply had no other class.
    //
    // On a DUPLICATE it is not equivalent at all. `applyRemoveEdge` is
    // `findIndex` + `splice`, so without the resolver it removes whichever
    // duplicate sorts first — exactly the "mutate whichever sorted first, a
    // defect by construction" hazard the contract cites and `edge_strength_edit`
    // refuses. A corpus that omits a class the contract admits cannot certify
    // the code over that class.
    const dup = buildPersistedGraph();
    dup.edges.push({
      from: 'o-wait',
      to: 'g-revenue',
      strength: { mean: 0.31, std: 0.1 },
      exists_probability: 0.9,
      effect_direction: 'positive',
    });
    persisted = dup;

    const res = await post(
      {
        kind: 'structural_delete',
        removed_node_ids: [],
        removed_edges: [{ from: 'o-wait', to: 'g-revenue' }],
        base_graph_hash: currentBaseHash(),
      },
      '10',
    );

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    // Refused, with NOTHING written — never an arbitrary pick.
    expect(committedGraph()).toBeUndefined();
    expect(body.assistant_text).toMatch(/couldn't match every connection/i);
    // Both duplicates survive: the model is unchanged, not half-repaired.
    expect(
      edgePairs(persisted as Record<string, unknown>).filter((p) => p === 'o-wait->g-revenue')
        .length,
    ).toBe(2);
  });

  it('the CONTRACT refuses a no-op delete (both arrays empty) at the boundary — 422, never a turn', async () => {
    const res = await post(
      {
        kind: 'structural_delete',
        removed_node_ids: [],
        removed_edges: [],
        base_graph_hash: currentBaseHash(),
      },
      'b',
    );

    expect(res.statusCode).toBe(422);
    expect(appendMock).not.toHaveBeenCalled();
  });

  // ══ 7. THE NOTIFICATION KIND IS UNTOUCHED ════════════════════════════════

  it('TWIN (no over-reach): direct_graph_edit STILL writes no graph — a client-side ADD is not a server mutation', async () => {
    const res = await post(
      { kind: 'direct_graph_edit', target_id: 'o-launch', operation: 'add_node' },
      'c',
    );

    expect(res.statusCode).toBe(200);
    // Byte-identical prior behaviour: committed as a turn, NO graph write.
    expect(appendMock).toHaveBeenCalledTimes(1);
    expect(committedGraph()).toBeUndefined();
    // And it deleted nothing.
    expect(nodeIds(persisted as Record<string, unknown>)).toContain('o-launch');
  });

  // ══ 8. READINESS — reported, not decided (see the lane's return) ══════════

  it('re-derives readiness from the COMMITTED bytes, and deleting the LAST option is reported honestly', async () => {
    // Remove both options: the model has no analysable option left.
    const res = await post(
      {
        kind: 'structural_delete',
        removed_node_ids: ['o-launch', 'o-wait'],
        removed_edges: [],
        base_graph_hash: currentBaseHash(),
      },
      'd',
    );

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    const graph = committedGraph();
    expect(nodeIds(graph)).not.toContain('o-launch');
    expect(nodeIds(graph)).not.toContain('o-wait');

    // Readiness is stamped, and it describes the graph that LANDED (both
    // options gone) — never the pre-mutation graph.
    // Readiness is stamped and DESCRIBES THE COMMITTED BYTES, not the
    // pre-mutation graph. This lane REPORTS the transition; it does not decide
    // it — the readiness-authority consolidation owns the policy.
    expect(body.analysis_ready).toBeDefined();
    expect(body.analysis_ready.status).not.toBe('ready');

    const issues = (body.analysis_ready.readiness_issues as Array<{ code: string }>).map(
      (i) => i.code,
    );
    // DISCRIMINATING, not incidental: this code is ABSENT from the pre-delete
    // graph's own assessment (2 options) and PRESENT here (0 options). So the
    // verdict provably re-derived from the post-delete bytes rather than being
    // carried over.
    expect(issues).toContain('FEWER_THAN_TWO_OPTIONS');
    // P6 — the delete REMOVES obligations rather than manufacturing them: the
    // per-option "choose the missing effect value" asks for the deleted options
    // are gone, not re-asked against nodes that no longer exist.
    expect(issues).not.toContain('OPTION_NEEDS_MAPPING');
  });

  it('the pre-delete graph does NOT carry FEWER_THAN_TWO_OPTIONS (the readiness assertion above discriminates)', async () => {
    // The positive control for the assertion above. Without this, "contains
    // FEWER_THAN_TWO_OPTIONS" could be true of every graph in the fixture and
    // the readiness test would be agreeing with itself.
    const res = await post(
      {
        kind: 'structural_delete',
        removed_node_ids: [],
        removed_edges: [{ from: 'f-budget', to: 'g-revenue' }],
        base_graph_hash: currentBaseHash(),
      },
      'e',
    );
    const body = JSON.parse(res.body);
    const issues = (body.analysis_ready.readiness_issues as Array<{ code: string }>).map(
      (i) => i.code,
    );
    // Both options still present ⇒ the code the previous test asserts is absent.
    expect(issues).not.toContain('FEWER_THAN_TWO_OPTIONS');
    expect(issues).toContain('OPTION_NEEDS_MAPPING');
  });
});
