/**
 * Lane C3 / decision ③ — node↔options[] reconcile is WIRED at the commit
 * persist chokepoint (`commitDirectAnswer` → `store.append`).
 *
 * These are the INTEGRATION pins the adversarial reviewer required: the module's
 * own unit tests (`reconcile-top-level-options.test.ts`) prove the FUNCTION
 * repairs a divergent graph, but they cannot see whether it is actually CALLED
 * from the persist path. A partial guard-revert inside the module survives its
 * fail-open catch (only a full-module revert reds the unit tests), so the wiring
 * itself needs a pin that discriminates the CALL SITE. Here we drive the real
 * `commitDirectAnswer` and assert on the graph that reaches `store.append`, so
 * deleting the `reconcileTopLevelOptionsFromNodes(...)` call in commit.ts turns
 * (a) and (c) RED while (b) and the "commit does not invent graph fields"
 * invariant (turn-executor-d1-mutation-commit-graph.test.ts) stay GREEN.
 *
 * MUTATION-CHECK (recorded in the lane report): revert the wiring call →
 *   (a) options-add             → RED  (new option never mirrored)
 *   (c) intervention fidelity   → RED  (configured option never mirrored)
 *   (b) never-invent            → GREEN (absent options[] stays absent)
 *   invariant (D1-SHAPE)        → GREEN (echo carries no options[])
 */
import { describe, it, expect, vi } from 'vitest';

import { commitDirectAnswer } from '../commit.js';
import { composeDirectAnswerResponse } from '../compose.js';
import { createNoopSessionStore } from '../session/__tests__/fixtures.js';
import type { SessionStore, SessionTurnWrite } from '../session/store.js';

const META = {
  scenario_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  turn_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
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
  const noop = createNoopSessionStore({ appendId: 'row-opt' });
  const spy = vi.spyOn(noop, 'append').mockImplementation(async (write) => {
    appendCalls.push(write);
    return { id: 'row-opt' };
  });
  void spy;
  return { store: noop, appendCalls };
}

const composed = () =>
  composeDirectAnswerResponse({
    answerKind: 'functional',
    assistant_text: 'ok',
    stage: 'analyse',
  });

type OptionEntry = {
  id: string;
  label?: string;
  status?: string;
  interventions?: Record<string, unknown>;
  is_baseline?: boolean;
};
type PersistedGraph = { nodes: unknown[]; edges?: unknown[]; options?: OptionEntry[] };

describe('commitDirectAnswer — options[] reconcile wiring (decision ③, update-if-present)', () => {
  it('(a) option-add on a graph WITH options[]: the new option-node is mirrored into options[]', async () => {
    // options[] carries only the baseline; opt_outsource is added as an
    // option-NODE (the live add path) but is missing from top-level options[].
    const graph = {
      nodes: [
        { id: 'dec', kind: 'decision', label: 'Decision' },
        {
          id: 'opt_status_quo',
          kind: 'option',
          label: 'Status quo',
          is_baseline: true,
          interventions: {},
        },
        {
          id: 'opt_outsource',
          kind: 'option',
          label: 'Outsource',
          interventions: {
            fac_cost: { value: 0.6, source: 'user_specified' },
          },
        },
      ],
      edges: [],
      goal_node_id: 'dec',
      options: [
        {
          id: 'opt_status_quo',
          label: 'Status quo',
          status: 'needs_encoding',
          interventions: {},
          is_baseline: true,
        },
      ],
    };

    const { store, appendCalls } = makeSpyStore();
    await commitDirectAnswer(composed(), { ...META, graph }, store);

    const persisted = appendCalls[0]!.graph as PersistedGraph;
    // options[] GAINED the added option.
    expect(persisted.options).toHaveLength(2);
    expect(persisted.options!.map((o) => o.id).sort()).toEqual([
      'opt_outsource',
      'opt_status_quo',
    ]);
    // The pre-existing entry is preserved byte-for-byte (append-only, never modified).
    expect(persisted.options!.find((o) => o.id === 'opt_status_quo')).toEqual({
      id: 'opt_status_quo',
      label: 'Status quo',
      status: 'needs_encoding',
      interventions: {},
      is_baseline: true,
    });
    // The mirrored entry is derived faithfully from the node.
    const mirrored = persisted.options!.find((o) => o.id === 'opt_outsource')!;
    expect(mirrored.label).toBe('Outsource');
    expect(mirrored.interventions).toEqual({
      fac_cost: { value: 0.6, source: 'user_specified' },
    });
    // The caller's input object is not mutated (reconcile clones on repair).
    expect(graph.options).toHaveLength(1);
  });

  it('(b) never-invent: a graph WITHOUT options[] commits with the field STILL absent', async () => {
    // Option-nodes are present, but there is no top-level options[] ARRAY. The
    // ruling forbids growing one on this commit (the "commit does not invent
    // graph fields" invariant). The graph still commits.
    const graph = {
      nodes: [
        { id: 'dec', kind: 'decision' },
        {
          id: 'opt_a',
          kind: 'option',
          label: 'A',
          interventions: { fac_x: { value: 0.3, source: 'user_specified' } },
        },
      ],
      edges: [],
    };

    const { store, appendCalls } = makeSpyStore();
    await commitDirectAnswer(composed(), { ...META, graph }, store);

    const persisted = appendCalls[0]!.graph as PersistedGraph;
    expect(persisted.options).toBeUndefined();
    // The commit still landed the graph (nodes preserved).
    expect(persisted.nodes).toHaveLength(2);
  });

  it('(c) intervention fidelity: a configured option-node missing from a present options[] is mirrored with its interventions + derived ready status', async () => {
    // opt_a is already reflected; opt_configured carries a numeric intervention
    // on the node but is absent from options[]. The mirror must reconcile it with
    // the exact interventions bundle AND the analysis-safe derived status.
    const graph = {
      nodes: [
        { id: 'opt_a', kind: 'option', label: 'A', interventions: {} },
        {
          id: 'opt_configured',
          kind: 'option',
          label: 'Configured',
          interventions: {
            fac_speed: { value: 0.9, source: 'user_specified' },
            fac_cost: 0.4,
          },
        },
      ],
      edges: [],
      options: [
        { id: 'opt_a', label: 'A', status: 'needs_encoding', interventions: {} },
      ],
    };

    const { store, appendCalls } = makeSpyStore();
    await commitDirectAnswer(composed(), { ...META, graph }, store);

    const persisted = appendCalls[0]!.graph as PersistedGraph;
    const entry = persisted.options!.find((o) => o.id === 'opt_configured')!;
    expect(entry).toBeDefined();
    // The interventions bundle is reconciled into options[] verbatim…
    expect(entry.interventions).toEqual({
      fac_speed: { value: 0.9, source: 'user_specified' },
      fac_cost: 0.4,
    });
    // …and a configured option (>=1 numeric effect value) mirrors as `ready`.
    expect(entry.status).toBe('ready');
    // The already-present entry is untouched.
    expect(persisted.options!.find((o) => o.id === 'opt_a')).toEqual({
      id: 'opt_a',
      label: 'A',
      status: 'needs_encoding',
      interventions: {},
    });
  });

  it('no-op fidelity: an already-consistent options[] passes through byte-identical', async () => {
    // Positive-control companion to (b): the wiring must not perturb a graph
    // whose option-nodes are all already mirrored.
    const graph = {
      nodes: [
        { id: 'opt_a', kind: 'option', label: 'A', interventions: {} },
        { id: 'opt_b', kind: 'option', label: 'B', interventions: {} },
      ],
      edges: [],
      options: [
        { id: 'opt_a', label: 'A', status: 'needs_encoding', interventions: {} },
        { id: 'opt_b', label: 'B', status: 'needs_encoding', interventions: {} },
      ],
    };
    const before = JSON.stringify(graph.options);

    const { store, appendCalls } = makeSpyStore();
    await commitDirectAnswer(composed(), { ...META, graph }, store);

    const persisted = appendCalls[0]!.graph as PersistedGraph;
    expect(JSON.stringify(persisted.options)).toBe(before);
  });
});
