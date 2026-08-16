/**
 * GRAPH-EDIT-TRANSACTION step 1 — the terminal invariant check + the §3.2
 * hash-ordering closure, pinned at the persist chokepoint.
 *
 * Two things are proven here, both against the REAL `commitDirectAnswer` and
 * the graph that actually reaches `store.append`:
 *
 *  (A) POSITIVE CONTROL (trap #13). Every invariant is shown FIRING on a
 *      deliberately-corrupted graph before any claim is made that it passes on
 *      healthy traffic. An assertion that has never fired is indistinguishable
 *      from one that cannot fire, so each code gets a construct-and-observe
 *      test, plus a paired clean graph proving the same check says `ok`.
 *
 *  (B) §3.2 — the advertised hash must describe the PERSISTED bytes. The three
 *      commit-site passes mutate `intercept`, node `interventions` and
 *      `options[]`, all of which `computeAnalysisAffectingGraphHash` projects.
 *      The discriminating test threads a prior pending pinned to the hash of
 *      the PERSISTED form while the caller advertises the hash of the
 *      UNPROJECTED form (exactly what the edit dispatch did): before the fix
 *      the carry-forward hash-invalidates a pending that is in fact still
 *      valid; after it, the pending survives.
 *
 * MUTATION-CHECK (throwaway worktree, recorded in the lane report): reverting
 * the invariant-check call site reds (A2); reverting the hash recompute reds
 * (B1) and (B2).
 */
import { describe, it, expect, vi } from 'vitest';

import { commitDirectAnswer } from '../commit.js';
import { composeDirectAnswerResponse } from '../compose.js';
import { createNoopSessionStore } from '../session/__tests__/fixtures.js';
import type { SessionStore, SessionTurnWrite } from '../session/store.js';
import type { PendingAction } from '../session/pending-action.js';
import {
  checkPersistedGraphInvariants,
  PersistedGraphInvariantError,
} from '../persisted-graph-invariants.js';
import { projectGraphForPersistence } from '../persisted-graph-projection.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import type { GraphStateIngress } from '../boundary/request-extensions.js';

const META = {
  scenario_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  turn_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  turn_class: 'handler' as const,
  handler_id: null,
  request_hash: 'sha256:test',
  llm_calls_used: 1,
  duration_ms: 42,
  handler_facts: [],
};

function makeSpyStore(): {
  readonly store: SessionStore;
  readonly appendCalls: Array<SessionTurnWrite>;
} {
  const appendCalls: Array<SessionTurnWrite> = [];
  const noop = createNoopSessionStore({ appendId: 'row-inv' });
  vi.spyOn(noop, 'append').mockImplementation(async (write) => {
    appendCalls.push(write);
    return {
      id: 'row-inv',
      ...(write.graph != null
        ? { graph_write_disposition: 'accepted_insert' as const }
        : {}),
    };
  });
  return { store: noop, appendCalls };
}

const composed = () =>
  composeDirectAnswerResponse({
    answerKind: 'functional',
    assistant_text: 'ok',
    stage: 'analyse',
  });

const hash = (g: unknown) =>
  computeAnalysisAffectingGraphHash(g as GraphStateIngress | null | undefined);

/** A structurally sound graph — the paired clean control for every violation. */
function healthyGraph() {
  return {
    nodes: [
      { id: 'goal', kind: 'goal', label: 'Goal' },
      { id: 'fac_a', kind: 'factor', label: 'A' },
    ],
    edges: [{ from: 'fac_a', to: 'goal', edge_type: 'causal' }],
    goal_node_id: 'goal',
  };
}

// ── (A) POSITIVE CONTROL — every invariant is proven to SEE a violation ─────

describe('checkPersistedGraphInvariants — positive control (each code fires)', () => {
  it('control: the healthy graph reports ok with NO violations', () => {
    const report = checkPersistedGraphInvariants(healthyGraph());
    expect(report.status).toBe('ok');
    expect(report.violations).toEqual([]);
    // …and the hash is recomputed, not left null, so the `ok` is not vacuous.
    expect(report.analysisGraphHash).toEqual(expect.any(String));
  });

  it('EDGE_ENDPOINT_MISSING fires on an edge naming a node that does not exist', () => {
    const g = healthyGraph();
    g.edges.push({ from: 'ghost_factor', to: 'goal', edge_type: 'causal' });
    const report = checkPersistedGraphInvariants(g, { baseGraph: healthyGraph() });
    expect(report.status).toBe('violated');
    expect(report.violations.map((v) => v.code)).toContain('EDGE_ENDPOINT_MISSING');
    expect(report.violations[0]!.entity_ids).toEqual(['ghost_factor']);
  });

  it('DUPLICATE_NODE_ID fires on two nodes sharing an id', () => {
    const g = healthyGraph();
    g.nodes.push({ id: 'fac_a', kind: 'factor', label: 'A duplicate' });
    const report = checkPersistedGraphInvariants(g, { baseGraph: healthyGraph() });
    expect(report.status).toBe('violated');
    expect(report.violations.map((v) => v.code)).toContain('DUPLICATE_NODE_ID');
  });

  it('GOAL_NODE_ID_UNRESOLVED is OBSERVED, not enforced (fires, but does not refuse)', () => {
    // Demoted on evidence: `goal_node_id` is optional on the persisted graph,
    // the authoritative goal oracle is `readiness.goal_node_id`, and three
    // existing commit specs persist graphs that violate it. The check must
    // still SEE it — an unfireable observation is worth nothing — but it must
    // not fail closed on a shape the estate demonstrably produces.
    const g = { ...healthyGraph(), goal_node_id: 'goal_that_was_deleted' };
    const report = checkPersistedGraphInvariants(g, { baseGraph: healthyGraph() });
    expect(report.observations.map((v) => v.code)).toContain('GOAL_NODE_ID_UNRESOLVED');
    expect(report.observations[0]!.entity_ids).toEqual(['goal_that_was_deleted']);
    // …and it is NOT fatal.
    expect(report.status).toBe('ok');
    expect(report.violations).toEqual([]);
  });

  it('an observation does NOT refuse the commit (the demotion is real, not cosmetic)', async () => {
    const g = { ...healthyGraph(), goal_node_id: 'goal_that_was_deleted' };
    const { store, appendCalls } = makeSpyStore();
    const result = await commitDirectAnswer(composed(), { ...META, graph: g }, store);
    expect(result.performed).toBe(true);
    expect(appendCalls).toHaveLength(1);
  });

  it('DUPLICATE_OPTION_ID fires on two options[] entries sharing an id', () => {
    const g = {
      ...healthyGraph(),
      options: [
        { id: 'opt_a', status: 'ready', interventions: {} },
        { id: 'opt_a', status: 'needs_encoding', interventions: {} },
      ],
    };
    const report = checkPersistedGraphInvariants(g, { baseGraph: healthyGraph() });
    expect(report.status).toBe('violated');
    expect(report.violations.map((v) => v.code)).toContain('DUPLICATE_OPTION_ID');
  });

  it('OPTION_NODE_MISSING_FROM_OPTIONS is OBSERVED, not enforced', () => {
    const g = {
      ...healthyGraph(),
      nodes: [
        ...healthyGraph().nodes,
        { id: 'opt_new', kind: 'option', label: 'New', interventions: {} },
      ],
      options: [] as unknown[],
    };
    const report = checkPersistedGraphInvariants(g, { baseGraph: healthyGraph() });
    // It must still SEE it — `reconcileTopLevelOptionsFromNodes` is fail-open,
    // so this is the only place the gap surfaces…
    expect(report.observations.map((v) => v.code)).toContain(
      'OPTION_NODE_MISSING_FROM_OPTIONS',
    );
    // …but refusing would turn a documented soft degradation into a whole-turn
    // STATE_COMMIT_FAILED.
    expect(report.status).toBe('ok');
  });

  it('does NOT fire OPTION_NODE_MISSING_FROM_OPTIONS when options[] is ABSENT (never-invent)', () => {
    // decision ③ is update-if-present: an absent options[] is left alone by the
    // reconcile pass, so the invariant must not demand a field commit may not invent.
    const g = {
      ...healthyGraph(),
      nodes: [
        ...healthyGraph().nodes,
        { id: 'opt_new', kind: 'option', label: 'New', interventions: {} },
      ],
    };
    const report = checkPersistedGraphInvariants(g, { baseGraph: healthyGraph() });
    expect(report.status).toBe('ok');
    expect(report.observations).toEqual([]);
  });

  it('reports `unshaped` (not a pass) for a graph with no nodes/edges arrays', () => {
    expect(checkPersistedGraphInvariants({ foo: 'bar' }).status).toBe('unshaped');
    expect(checkPersistedGraphInvariants(null).status).toBe('unshaped');
  });

  it('never mutates its input', () => {
    const g = healthyGraph();
    const before = JSON.stringify(g);
    checkPersistedGraphInvariants(g, { baseGraph: healthyGraph() });
    expect(JSON.stringify(g)).toBe(before);
  });
});

// ── (A2) the check is WIRED at the chokepoint, fail-closed ON THE DELTA ────

/** A graph carrying a dangling edge endpoint — pure referential corruption. */
function corruptGraph() {
  const g = healthyGraph();
  g.edges.push({ from: 'ghost_factor', to: 'goal', edge_type: 'causal' });
  return g;
}

describe('commitDirectAnswer — the terminal check is wired and fails CLOSED on the delta', () => {
  it('A2: a violation THIS TURN INTRODUCED is REFUSED and NOTHING is appended', async () => {
    const { store, appendCalls } = makeSpyStore();
    await expect(
      commitDirectAnswer(
        composed(),
        { ...META, graph: corruptGraph(), baseGraphForInvariants: healthyGraph() },
        store,
      ),
    ).rejects.toBeInstanceOf(PersistedGraphInvariantError);

    // Fail-CLOSED: the write never happened. A silent repair would have
    // appended a graph; a soft warning would have appended the corrupt one.
    expect(appendCalls).toHaveLength(0);
  });

  it('A2b: the refusal NAMES the violation (honest refusal, not a generic failure)', async () => {
    const { store } = makeSpyStore();
    await expect(
      commitDirectAnswer(
        composed(),
        { ...META, graph: corruptGraph(), baseGraphForInvariants: healthyGraph() },
        store,
      ),
    ).rejects.toThrow(/EDGE_ENDPOINT_MISSING.*ghost_factor/s);
  });

  it('A2c: a healthy graph still commits (the check does not refuse real traffic)', async () => {
    const { store, appendCalls } = makeSpyStore();
    const result = await commitDirectAnswer(
      composed(),
      { ...META, graph: healthyGraph(), baseGraphForInvariants: healthyGraph() },
      store,
    );
    expect(result.performed).toBe(true);
    expect(appendCalls).toHaveLength(1);
  });

  it('A2d: a graph-free commit is unaffected (no graph, no check, no refusal)', async () => {
    const { store, appendCalls } = makeSpyStore();
    const result = await commitDirectAnswer(composed(), { ...META }, store);
    expect(result.performed).toBe(true);
    expect(appendCalls).toHaveLength(1);
    expect(appendCalls[0]!.graph).toBeUndefined();
  });

  // ── THE DELTA PROPERTY — this is what stops the gate bricking scenarios ──

  it('A3: an INHERITED violation is ABSORBED — a legacy graph stays editable', async () => {
    // The scenario already carried the dangling edge. The user makes an
    // unrelated edit. An ABSOLUTE gate would refuse this turn — and every
    // future turn — leaving the scenario permanently uneditable
    // (`edit-graph.ts:2750-2755`). The delta gate must let it through.
    const base = corruptGraph();
    const edited = corruptGraph();
    edited.nodes.push({ id: 'fac_new', kind: 'factor', label: 'Newly added' });

    const { store, appendCalls } = makeSpyStore();
    const result = await commitDirectAnswer(
      composed(),
      { ...META, graph: edited, baseGraphForInvariants: base },
      store,
    );

    expect(result.performed).toBe(true);
    expect(appendCalls).toHaveLength(1);
    // …and the inherited corruption is REPORTED, not silently tolerated.
    const report = checkPersistedGraphInvariants(edited, { baseGraph: base });
    expect(report.status).toBe('ok');
    expect(report.inheritedViolations.map((v) => v.code)).toEqual([
      'EDGE_ENDPOINT_MISSING',
    ]);
  });

  it('A3b: a SECOND instance of an already-present code is still caught (count-based, not code-based)', async () => {
    // The discriminator for A3: absorption must be by COUNT, mirroring
    // `edit-graph.ts:2587-2595`. Absorbing the whole code would let a turn add
    // unlimited new corruption behind one inherited instance.
    const base = corruptGraph(); // 1 dangling endpoint
    const edited = corruptGraph();
    edited.edges.push({ from: 'second_ghost', to: 'goal', edge_type: 'causal' });

    const report = checkPersistedGraphInvariants(edited, { baseGraph: base });
    expect(report.status).toBe('violated');
    expect(report.violations[0]!.code).toBe('EDGE_ENDPOINT_MISSING');

    const { store, appendCalls } = makeSpyStore();
    await expect(
      commitDirectAnswer(
        composed(),
        { ...META, graph: edited, baseGraphForInvariants: base },
        store,
      ),
    ).rejects.toBeInstanceOf(PersistedGraphInvariantError);
    expect(appendCalls).toHaveLength(0);
  });

  it('A3c: with NO baseline the check is OBSERVE-ONLY — it can never brick a lane it cannot reason about', async () => {
    // Lanes that thread no base (system events, chip clicks, clarify, several
    // route-v2 sites) have an unknown trip rate. Without a baseline there is no
    // way to tell introduced from inherited, so refusing would be a guess.
    const { store, appendCalls } = makeSpyStore();
    const result = await commitDirectAnswer(
      composed(),
      { ...META, graph: corruptGraph() },
      store,
    );
    expect(result.performed).toBe(true);
    expect(appendCalls).toHaveLength(1);

    const report = checkPersistedGraphInvariants(corruptGraph());
    expect(report.status).toBe('ok');
    expect(report.violations).toEqual([]);
    expect(report.inheritedViolations.map((v) => v.code)).toEqual([
      'EDGE_ENDPOINT_MISSING',
    ]);
  });
});

// ── (B) §3.2 — the advertised hash describes the PERSISTED bytes ────────────

/** A graph carrying a duplicate observed-root intercept — `repairGraphForPersistence` strips it. */
function graphWithDuplicateIntercept() {
  return {
    nodes: [
      { id: 'goal', kind: 'goal', label: 'Goal' },
      {
        id: 'fac_a',
        kind: 'factor',
        label: 'A',
        intercept: 42,
        observed_state: { value: 42 },
      },
    ],
    edges: [{ from: 'fac_a', to: 'goal', edge_type: 'causal' }],
    goal_node_id: 'goal',
  };
}

function pendingPinnedTo(graphHash: string): PendingAction {
  return {
    id: 'pa-hash-pin',
    scenario_id: META.scenario_id,
    chip_id: 'prop_hash_pin',
    action: {
      kind: 'apply_proposed_change',
      proposal_ref: 'prop_hash_pin',
      inline_patch: {
        handler_id: 'set_factor_value',
        params: { value: 20 },
        target_entity_ids: ['fac_a'],
      },
      public_label: 'Apply the change',
      public_message: 'Apply the change.',
    },
    preconditions: { graph_hash: graphHash },
    expires_at_turn_count: 3,
    expires_at_iso: '2099-12-31T23:59:59.000Z',
    emitted_at_iso: '2026-07-25T11:59:00.000Z',
  } as PendingAction;
}

describe('commitDirectAnswer — §3.2: decisions are made against the hash of what we STORE', () => {
  it('premise: the persist projection MOVES the analysis hash (the defect is real)', () => {
    const g = graphWithDuplicateIntercept();
    const projected = projectGraphForPersistence(g, {});
    expect(hash(projected)).not.toBe(hash(g));
  });

  it('B1: the pending re-pin uses the PERSISTED hash — a still-valid hold is not falsely invalidated', async () => {
    const g = graphWithDuplicateIntercept();
    const persistedHash = hash(projectGraphForPersistence(g, {}))!;
    const unprojectedHash = hash(g)!;
    expect(persistedHash).not.toBe(unprojectedHash);

    const { store, appendCalls } = makeSpyStore();
    const result = await commitDirectAnswer(
      composed(),
      {
        ...META,
        graph: g,
        // Exactly what the edit dispatch advertised: the hash of the
        // pre-projection graph. The commit must NOT trust it over the bytes.
        graph_hash: unprojectedHash,
        priorPendingActions: [pendingPinnedTo(persistedHash)],
      },
      store,
    );

    // The hold is pinned to the graph we actually stored, so it is STILL VALID.
    expect(result.pendingLifecycle.hashInvalidatedCount).toBe(0);
    expect(result.pendingLifecycle.survivedCount).toBe(1);
    expect(appendCalls[0]!.pending_actions).toHaveLength(1);
  });

  it('B1b: control — a pending pinned to a GENUINELY different graph IS still invalidated', async () => {
    // The discriminator: B1 must not pass by disabling hash invalidation.
    const g = graphWithDuplicateIntercept();
    const { store } = makeSpyStore();
    const result = await commitDirectAnswer(
      composed(),
      {
        ...META,
        graph: g,
        priorPendingActions: [pendingPinnedTo('hash_of_some_other_graph')],
      },
      store,
    );
    expect(result.pendingLifecycle.hashInvalidatedCount).toBe(1);
    expect(result.pendingLifecycle.survivedCount).toBe(0);
  });

  it('B2: CommitResult carries the hash of the bytes that were APPENDED', async () => {
    const g = graphWithDuplicateIntercept();
    const { store, appendCalls } = makeSpyStore();
    const result = await commitDirectAnswer(
      composed(),
      { ...META, graph: g, graph_hash: hash(g)! },
      store,
    );

    const appended = appendCalls[0]!.graph;
    // The returned hash is the hash of what was stored — the value a caller
    // must advertise. Derived by recomputation, never by trusting the input.
    expect(result.persistedAnalysisGraphHash).toBe(hash(appended));
    // …and it is NOT the stale pre-projection hash the caller supplied.
    expect(result.persistedAnalysisGraphHash).not.toBe(hash(g));
  });

  it('B3: the appended graph IS the projected form (nothing mutates after the check)', async () => {
    const g = graphWithDuplicateIntercept();
    const { store, appendCalls } = makeSpyStore();
    await commitDirectAnswer(composed(), { ...META, graph: g }, store);

    const appended = appendCalls[0]!.graph;
    // Re-projecting the persisted bytes is a fixed point: the graph we stored
    // is already in persisted form, so no later pass can move its hash.
    expect(hash(projectGraphForPersistence(appended, {}))).toBe(hash(appended));
    expect(
      (appended as { nodes: Array<{ id: string; intercept?: number }> }).nodes.find(
        (n) => n.id === 'fac_a',
      )!.intercept,
    ).toBeUndefined();
  });
});
