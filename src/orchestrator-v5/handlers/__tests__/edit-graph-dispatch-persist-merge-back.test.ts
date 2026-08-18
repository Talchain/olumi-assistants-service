/**
 * V5-PERSIST-FIX-01 (H1) — edit_graph persisted-graph merge-back.
 *
 * Defect under test (43/43 fleet corruption at investigation time):
 * the edit pipeline parses ingress through `GraphV3.safeParse`, which
 * strips top-level `goal_node_id` and `options[]` (undeclared on
 * GraphV3), then committed the stripped `appliedGraph` wholesale —
 * permanently destroying both fields on `scenarios.graph` at the first
 * applied edit.
 *
 * Fix under test: the committed graph is the applied nodes/edges merged
 * onto the PERSISTED `scenarios.graph` base (NOT the ingress echo — the
 * real DGAI echo cannot carry options[]/goal_node_id because the draft
 * wire block omits them, so an ingress-base merge would pass synthetic
 * tests while live edits still lose both fields).
 *
 * Fixtures are the CAPTURED EXP-01 graphs (policy: captured > invented
 * > trimmed): `rich-persisted-graph.json` is the draft-persisted shape
 * (hash-verified against the live run_analysis anchor) and
 * `echo-graph-state.json` is the captured DGAI-shaped echo. The
 * decisive case strips the harness-re-attached `goal_node_id` from the
 * echo so the ingress matches what the real draft wire block carries:
 * `{nodes, edges}` only.
 */

import { readFileSync } from 'node:fs';

import { describe, it, expect, vi, beforeEach, type MockedFunction, afterEach } from 'vitest';
import { _resetConfigCache } from '../../../config/index.js';
import type { FastifyRequest } from 'fastify';
import type { EditGraphResult } from '../../../orchestrator/tools/edit-graph.js';

// ── module-level mocks (same pattern as edit-graph-dispatch.test.ts) ─────────

vi.mock('../../../orchestrator/tools/edit-graph.js', () => ({
  handleEditGraph: vi.fn(),
}));

vi.mock('../../commit.js', () => ({
  commitDirectAnswer: vi.fn(),
  computeRequestHash: vi.fn().mockReturnValue('sha256:testhash'),
}));

vi.mock('../../../adapters/llm/router.js', () => ({
  getAdapter: vi.fn().mockReturnValue({}),
}));

// The merge base comes from the STRICT persisted read
// (`loadPersistedGraphStrict`), which distinguishes a genuinely-empty
// scenarios.graph (returns null) from a degraded read (throws).
// buildTurnContext is still called for prior_facts / pending actions but
// no longer drives the base. Mock the module so each test controls both.
vi.mock('../../build-turn-context.js', () => ({
  buildTurnContext: vi.fn(),
  loadMostRecentPendingActions: vi.fn().mockResolvedValue([]),
  loadPersistedGraphStrict: vi.fn(),
  // ROADMAP 1.33: dispatchEditGraph reads this for the conversation-slice
  // feed. Empty — this suite exercises persist/merge semantics, not
  // conversation history.
  loadRecentConversationTurns: vi.fn().mockResolvedValue([]),
}));

// ── imports after mocks ───────────────────────────────────────────────────────

import {
  dispatchEditGraph,
  mergeAppliedGraphForPersistence,
} from '../edit-graph-dispatch.js';
import { handleEditGraph } from '../../../orchestrator/tools/edit-graph.js';
import { commitDirectAnswer } from '../../commit.js';
import {
  buildTurnContext,
  loadMostRecentPendingActions,
  loadPersistedGraphStrict,
} from '../../build-turn-context.js';
import { GraphV3, type GraphV3T } from '../../../schemas/cee-v3.js';
import type { GraphStateIngress } from '../../boundary/request-extensions.js';

// ── captured fixtures ─────────────────────────────────────────────────────────

const RICH_PERSISTED_GRAPH = JSON.parse(
  readFileSync(
    new URL('../../__tests__/fixtures/exp01/rich-persisted-graph.json', import.meta.url),
    'utf8',
  ),
) as Record<string, unknown>;

const ECHO_GRAPH_STATE = JSON.parse(
  readFileSync(
    new URL('../../__tests__/fixtures/exp01/echo-graph-state.json', import.meta.url),
    'utf8',
  ),
) as Record<string, unknown>;

/**
 * Wire-faithful DGAI ingress: the captured echo minus the
 * harness-re-attached `goal_node_id`. The real draft wire block carries
 * only `{nodes, edges}` — this is a field REMOVAL from a capture, not
 * an invented shape.
 */
const { goal_node_id: _harnessGoal, ...WIRE_ECHO } = ECHO_GRAPH_STATE;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Applied graph the way production builds it: GraphV3-parse the ingress
 *  (which strips goal_node_id/options[]/node.data), then mutate. */
function buildAppliedGraphFromWireEcho(
  mutate: (graph: GraphV3T) => void,
): GraphV3T {
  const parsed = GraphV3.safeParse(clone(WIRE_ECHO));
  if (!parsed.success) throw new Error('fixture must GraphV3-parse');
  const applied = parsed.data;
  mutate(applied);
  return applied;
}

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TURN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const STUB_REQUEST = {} as FastifyRequest;

function makePayload() {
  return {
    kind: 'message' as const,
    scenario_id: SCENARIO_ID,
    turn_id: TURN_ID,
    stage: 'analyse' as const,
    message: 'Set the Local Senior Hire Programme factor to 1.0.',
    turn_class: 'frame' as const,
    source: 'composer' as const,
  };
}

function makeAppliedEditResult(appliedGraph: GraphV3T): EditGraphResult {
  return {
    blocks: [],
    assistantText: 'Updated Local Senior Hire Programme from 0 to 1.',
    latencyMs: 1200,
    appliedGraph: appliedGraph as unknown as EditGraphResult['appliedGraph'],
    wasRejected: false,
    operations: [
      { op: 'update_node', path: 'fac_local_hire', value: { observed_state: { value: 1 } } },
    ],
  } as EditGraphResult;
}

function installTurnContext(): void {
  // buildTurnContext no longer drives the merge base; it supplies
  // prior_facts / pending actions only. persistedGraph here is irrelevant
  // to persistence (kept null to prove the base comes from the strict read).
  (buildTurnContext as MockedFunction<typeof buildTurnContext>).mockResolvedValue({
    prior_facts: [],
    prior_turns: [],
    most_recent_pending_actions: [],
    persistedGraph: null,
  } as never);
}

/** Strict persisted read returns this graph (genuine value or null). */
function installPersistedBase(graph: unknown): void {
  (loadPersistedGraphStrict as MockedFunction<typeof loadPersistedGraphStrict>).mockResolvedValue(
    graph,
  );
}

/** Strict persisted read THROWS — simulates a degraded Supabase/session read. */
function installDegradedPersistedRead(): void {
  (loadPersistedGraphStrict as MockedFunction<typeof loadPersistedGraphStrict>).mockRejectedValue(
    new Error('SessionReadError: scenarios.graph read failed (degraded)'),
  );
}

function committedGraph(): Record<string, unknown> {
  const calls = (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mock.calls;
  expect(calls.length).toBe(1);
  return calls[0]![1].graph as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mockResolvedValue({
    response: {} as never,
    performed: true,
    persisted_row_id: 'row-1',
    graphPersisted: true,
  } as never);
  vi.mocked(loadMostRecentPendingActions).mockResolvedValue([]);
});

// ── schema-strip premise (acceptance 1: reproduce the defect mechanism) ──────

// ── ROADMAP 2.474 / A10 — the mode is now STATED, not inherited ──────────
// `CEE_GRAPH_MANAGEMENT_MODE`'s repo default moved 'off' → 'live' (the referee
// ships ON; a trust story hanging on a dashboard variable is one careless edit
// from being untrue). This file pins PERSISTENCE mechanics — the merge base,
// the projection, the advertised hash — on a turn that reaches the commit. It
// was authored under the implicit 'off' default, and that premise is exactly
// what it needs: 'off' is the mode in which the existing path proceeds
// byte-identically, so the seam under test is reached unchanged. Stating it
// here preserves the property this file was written to prove, and makes the
// dependency visible instead of inherited. Live-mode ROUTING is covered by its
// own files (edit-graph-dispatch-graph-management-modes.test.ts and the
// referee-gate suites), which is where a live regression would surface.
beforeEach(() => {
  vi.stubEnv('CEE_GRAPH_MANAGEMENT_MODE', 'off');
  _resetConfigCache();
});
afterEach(() => {
  vi.unstubAllEnvs();
  _resetConfigCache();
});

describe('defect premise — GraphV3 strips the server-authoritative fields', () => {
  it('GraphV3.safeParse(rich persisted graph) loses goal_node_id and options[]', () => {
    const parsed = GraphV3.safeParse(clone(RICH_PERSISTED_GRAPH));
    expect(parsed.success).toBe(true);
    const stripped = parsed.data as unknown as Record<string, unknown>;
    // The pre-fix commit persisted exactly this shape — both fields gone.
    expect(stripped.goal_node_id).toBeUndefined();
    expect(stripped.options).toBeUndefined();
    // Premise for the decisive case below: the rich fixture HAS both.
    expect(typeof RICH_PERSISTED_GRAPH.goal_node_id).toBe('string');
    expect(Array.isArray(RICH_PERSISTED_GRAPH.options)).toBe(true);
  });
});

// ── live-faithful decisive case (acceptance 2 + 3) ───────────────────────────

describe('dispatchEditGraph — persisted-base merge-back (decisive live-faithful case)', () => {
  it('applied edit on a DGAI-shaped echo (no goal_node_id/options[]) commits a graph that retains the persisted options[] byte-for-byte, goal_node_id, and the mutation', async () => {
    const persisted = clone(RICH_PERSISTED_GRAPH);
    installTurnContext();
    installPersistedBase(persisted);
    const applied = buildAppliedGraphFromWireEcho((g) => {
      const node = g.nodes.find((n) => n.id === 'fac_local_hire');
      expect(node).toBeDefined();
      (node as { observed_state?: Record<string, unknown> }).observed_state = {
        ...(node as { observed_state?: Record<string, unknown> }).observed_state,
        value: 1,
        raw_value: 1,
      };
    });
    (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(
      makeAppliedEditResult(applied),
    );

    const result = await dispatchEditGraph({
      payload: makePayload(),
      requestId: 'req-pmb-decisive',
      request: STUB_REQUEST,
      graphState: clone(WIRE_ECHO) as GraphStateIngress,
      analysisState: null,
    });

    expect(result.commitPerformed).toBe(true);
    const graph = committedGraph();

    // Server-authoritative top-level fields survive from the PERSISTED base.
    expect(graph.goal_node_id).toBe(RICH_PERSISTED_GRAPH.goal_node_id);
    expect(JSON.stringify(graph.options)).toBe(
      JSON.stringify(RICH_PERSISTED_GRAPH.options),
    );

    // The intended mutation is applied (appliedGraph wins on nodes/edges).
    // ⚠ VALUE, NOT REFERENCE. `toBe` here was pinning the ALIASING, which
    // `mergeAppliedGraphForPersistence` now forbids: it clones its result
    // because two of the three CAS-deriving call sites had no clone and a
    // prune over the result rewrote the caller's trusted base (see
    // `system-events/__tests__/persist-merge-helpers-own-their-clone.test.ts`).
    // The question — "did nodes/edges come from the APPLIED graph, not the
    // persisted base?" — is unchanged and is now asked by value plus the
    // explicit opposite, which `toBe` could never distinguish.
    expect(graph.nodes).toEqual(applied.nodes);
    expect(graph.nodes).not.toEqual(RICH_PERSISTED_GRAPH.nodes);
    expect(graph.edges).toEqual(applied.edges);
    const mutated = (graph.nodes as Array<Record<string, unknown>>).find(
      (n) => n.id === 'fac_local_hire',
    );
    expect((mutated?.observed_state as Record<string, unknown>).value).toBe(1);

    // Option-node top-level interventions survive (they live on the
    // applied nodes, which came from the captured echo's option nodes).
    const optionNodesWithInterventions = (
      graph.nodes as Array<Record<string, unknown>>
    ).filter((n) => n.kind === 'option' && n.interventions !== undefined);
    expect(optionNodesWithInterventions.length).toBeGreaterThan(0);

    // Revert-the-fix oracle: the pre-fix commit was the appliedGraph
    // object itself, which provably lacks both fields.
    expect(
      (applied as unknown as Record<string, unknown>).goal_node_id,
    ).toBeUndefined();
    expect((applied as unknown as Record<string, unknown>).options).toBeUndefined();
  });

  it('GENUINELY empty persisted graph (strict read returns null) → ingress-fallback base; commit still carries the applied mutation and whatever the echo had', async () => {
    installTurnContext();
    installPersistedBase(null); // strict read SUCCEEDED, scenario genuinely has no graph
    const applied = buildAppliedGraphFromWireEcho(() => undefined);
    (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(
      makeAppliedEditResult(applied),
    );

    await dispatchEditGraph({
      payload: makePayload(),
      requestId: 'req-pmb-fallback',
      request: STUB_REQUEST,
      graphState: clone(ECHO_GRAPH_STATE) as GraphStateIngress, // harness echo WITH goal
      analysisState: null,
    });

    const graph = committedGraph();
    // Base = raw ingress: the echo's goal_node_id survives. This is the
    // legitimate no-persisted-graph case — there is nothing to lose, and
    // the edit must still persist.
    expect(graph.goal_node_id).toBe(ECHO_GRAPH_STATE.goal_node_id);
    // Value, not reference — see the merge helper's return contract.
    expect(graph.nodes).toEqual(applied.nodes);
  });

  it('DEGRADED persisted read (strict read throws) → FAIL CLOSED: dispatch rejects and NO graph is committed (Codex P0 — never overwrite canonical state with the lossy echo)', async () => {
    installTurnContext();
    installDegradedPersistedRead(); // strict read THROWS — cannot prove the base
    const applied = buildAppliedGraphFromWireEcho(() => undefined);
    (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(
      makeAppliedEditResult(applied),
    );

    await expect(
      dispatchEditGraph({
        payload: makePayload(),
        requestId: 'req-pmb-degraded',
        request: STUB_REQUEST,
        graphState: clone(WIRE_ECHO) as GraphStateIngress, // lossy DGAI echo
        analysisState: null,
      }),
    ).rejects.toThrow(/persisted merge base unavailable|degraded/i);

    // The whole point: a degraded read must NOT commit the lossy echo over
    // a (possibly rich) persisted graph. Route-v2 maps this throw to a
    // retryable edit_graph_pipeline_threw 500.
    expect(
      (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mock.calls.length,
    ).toBe(0);
  });

  it('persisted read OK but buildTurnContext later throws → base already resolved from the strict read; commit still carries the merged graph (base independent of buildTurnContext swallowing)', async () => {
    installPersistedBase(clone(RICH_PERSISTED_GRAPH)); // base proven good up front
    (buildTurnContext as MockedFunction<typeof buildTurnContext>).mockRejectedValue(
      new Error('context unavailable'),
    );
    const applied = buildAppliedGraphFromWireEcho(() => undefined);
    (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(
      makeAppliedEditResult(applied),
    );

    await dispatchEditGraph({
      payload: makePayload(),
      requestId: 'req-pmb-ctx-fail',
      request: STUB_REQUEST,
      graphState: clone(WIRE_ECHO) as GraphStateIngress,
      analysisState: null,
    });

    const graph = committedGraph();
    expect(graph.goal_node_id).toBe(RICH_PERSISTED_GRAPH.goal_node_id);
    expect(JSON.stringify(graph.options)).toBe(
      JSON.stringify(RICH_PERSISTED_GRAPH.options),
    );
    // Value, not reference — see the merge helper's return contract.
    // ⚠ AND WHAT THIS HALF DOES *NOT* PROVE, stated rather than implied: this
    // case's applied graph is `buildAppliedGraphFromWireEcho(() => undefined)`,
    // i.e. UNMUTATED, and `WIRE_ECHO.nodes` is value-identical to
    // `RICH_PERSISTED_GRAPH.nodes` (they differ only in the top-level fields
    // asserted above). So no value assertion can tell the two sources apart
    // here, and this line is a shape check, not a provenance discriminator —
    // the `toBe` it replaces WAS one, purely because the merge aliased its
    // input, which is the defect that had to go. The provenance claim is
    // discriminated by the two cases whose applied graph carries a real
    // mutation (the decisive live-faithful case above, and the options-drop
    // case below); this one is not asked to carry it.
    expect(graph.nodes).toEqual(applied.nodes);
  });

  it('no-op / rejected edit commits NO graph (shape cannot be corrupted by a non-mutation; no strict read needed)', async () => {
    installTurnContext();
    installPersistedBase(clone(RICH_PERSISTED_GRAPH));
    (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue({
      blocks: [],
      assistantText: 'The proposed edit was rejected.',
      latencyMs: 800,
      appliedGraph: null,
      wasRejected: true,
    } as EditGraphResult);

    await dispatchEditGraph({
      payload: makePayload(),
      requestId: 'req-pmb-noop',
      request: STUB_REQUEST,
      graphState: clone(WIRE_ECHO) as GraphStateIngress,
      analysisState: null,
    });

    const calls = (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mock.calls;
    expect(calls.length).toBe(1);
    expect(calls[0]![1].graph).toBeUndefined();
  });
});

// ── merge-unit semantics (acceptance 4 — option precedence) ──────────────────

describe('mergeAppliedGraphForPersistence — option precedence and base rules', () => {
  const REQ = { requestId: 'req-merge-unit', scenarioId: SCENARIO_ID };

  it('persisted base wins for goal_node_id, options[], and unknown top-level fields; applied wins for nodes/edges', () => {
    const persisted = clone(RICH_PERSISTED_GRAPH);
    // ⭐ THE APPLIED GRAPH MUST DIFFER FROM THE BASE, or "applied wins" is not
    // a measurement. It used to be `() => undefined` — an UNMUTATED echo, whose
    // `nodes` are value-identical to the persisted base's — and the "applied
    // wins" half was carried entirely by a `toBe` reference check that only
    // held because the merge ALIASED its input. That aliasing is now forbidden
    // (the helper clones; see its return contract), so the discrimination has
    // to come from the fixture instead of from a defect.
    const applied = buildAppliedGraphFromWireEcho((g) => {
      const target = g.nodes.find((n) => n.id === 'fac_local_hire');
      if (target === undefined) throw new Error('fixture must contain fac_local_hire');
      (target as { observed_state?: { value?: number } }).observed_state = { value: 1 };
    });
    expect(applied.nodes).not.toEqual(persisted.nodes);
    const merged = mergeAppliedGraphForPersistence({
      appliedGraph: applied,
      persistedBase: persisted,
      ingressBase: clone(WIRE_ECHO) as GraphStateIngress,
      ...REQ,
    });
    expect(merged.goal_node_id).toBe(persisted.goal_node_id);
    expect(JSON.stringify(merged.options)).toBe(JSON.stringify(persisted.options));
    // ⚠ VALUE, NOT REFERENCE. `toBe` here was pinning the ALIASING, which
    // `mergeAppliedGraphForPersistence` now forbids: it clones its result
    // because two of the three CAS-deriving call sites had no clone and a
    // prune over the result rewrote the caller's trusted base (see
    // `system-events/__tests__/persist-merge-helpers-own-their-clone.test.ts`).
    // The question — "did nodes/edges come from the APPLIED graph, not the
    // persisted base?" — is unchanged and is now asked by value plus the
    // explicit opposite, which `toBe` could never distinguish.
    expect(merged.nodes).toEqual(applied.nodes);
    expect(merged.nodes).not.toEqual(persisted.nodes);
    expect(merged.edges).toEqual(applied.edges);
    // …and the clone contract itself, asserted rather than assumed.
    expect(merged.nodes).not.toBe(applied.nodes);
  });

  it('drops exactly the options[] entry whose option NODE this edit removed; untouched options survive byte-for-byte (no resurrection, no over-drop)', () => {
    const persisted = clone(RICH_PERSISTED_GRAPH);
    const options = persisted.options as Array<{ id: string }>;
    expect(options.length).toBeGreaterThan(1);
    const removedOptionId = options[0]!.id;

    // The edit removes that option node.
    const applied = buildAppliedGraphFromWireEcho((g) => {
      const idx = g.nodes.findIndex((n) => n.id === removedOptionId);
      expect(idx).toBeGreaterThanOrEqual(0);
      (g.nodes as Array<unknown>).splice(idx, 1);
    });

    const merged = mergeAppliedGraphForPersistence({
      appliedGraph: applied,
      persistedBase: persisted,
      ingressBase: clone(WIRE_ECHO) as GraphStateIngress,
      ...REQ,
    });

    const mergedOptions = merged.options as Array<{ id: string }>;
    expect(mergedOptions.map((o) => o.id)).not.toContain(removedOptionId);
    expect(mergedOptions.length).toBe(options.length - 1);
    // Survivors are byte-identical to their persisted entries.
    expect(JSON.stringify(mergedOptions)).toBe(
      JSON.stringify(options.filter((o) => o.id !== removedOptionId)),
    );
  });

  it('options[] entries whose ids never matched a base node are preserved (fail-open to preservation)', () => {
    const persisted = clone(RICH_PERSISTED_GRAPH);
    (persisted.options as Array<unknown>).push({ id: 'opt_not_a_node', status: 'ready' });
    const applied = buildAppliedGraphFromWireEcho(() => undefined);
    const merged = mergeAppliedGraphForPersistence({
      appliedGraph: applied,
      persistedBase: persisted,
      ingressBase: clone(WIRE_ECHO) as GraphStateIngress,
      ...REQ,
    });
    expect(
      (merged.options as Array<{ id: string }>).map((o) => o.id),
    ).toContain('opt_not_a_node');
  });

  it('structurally unusable persisted base (not an object / missing arrays) falls back to the raw ingress base', () => {
    const applied = buildAppliedGraphFromWireEcho(() => undefined);
    for (const badBase of [null, undefined, 'corrupt', { nodes: 'x', edges: [] }]) {
      const merged = mergeAppliedGraphForPersistence({
        appliedGraph: applied,
        persistedBase: badBase,
        ingressBase: clone(ECHO_GRAPH_STATE) as GraphStateIngress,
        ...REQ,
      });
      expect(merged.goal_node_id).toBe(ECHO_GRAPH_STATE.goal_node_id);
      // Value, not reference — see the merge helper's return contract.
      expect(merged.nodes).toEqual(applied.nodes);
    }
  });

  it('top-level goal_constraints are NOT overlaid from the applied graph (no edit op writes them; D1 add_constraint owns the field)', () => {
    const persisted = clone(RICH_PERSISTED_GRAPH);
    (persisted as Record<string, unknown>).goal_constraints = [
      { constraint_id: 'c1', node_id: 'fac_local_hire', operator: '>=', value: 0.5 },
    ];
    // Echo (and therefore appliedGraph) carries a DIFFERENT, stale set.
    const echoWithStale = {
      ...clone(WIRE_ECHO),
      goal_constraints: [
        { constraint_id: 'stale', node_id: 'fac_local_hire', operator: '<=', value: 0.1 },
      ],
    };
    const parsed = GraphV3.safeParse(echoWithStale);
    expect(parsed.success).toBe(true);
    const merged = mergeAppliedGraphForPersistence({
      appliedGraph: parsed.data!,
      persistedBase: persisted,
      ingressBase: echoWithStale as GraphStateIngress,
      ...REQ,
    });
    expect(
      (merged.goal_constraints as Array<{ constraint_id: string }>)[0]!.constraint_id,
    ).toBe('c1');
  });
});
