/**
 * Track 3 — add_option node↔options[] divergence fixtures (Slice 3).
 *
 * These 8 representation cases PROVE WHY add_option is held (the authority per path
 * differs: analysis reads node-derived options, context prefers top-level
 * options[]). Passing them does NOT un-hold add_option — un-holding requires a
 * later node↔options[] consistency workstream, explicitly OUT OF SCOPE for this
 * core (Paul #3). Every case resolves to held or stale; NEVER would_apply.
 */
import { describe, it, expect } from 'vitest';
import { refereeMutation } from '../referee.js';
import {
  ADD_OPTION_APPLY_UNWIRED,
  OPTION_TOP_LEVEL_OPTIONS_DIVERGENCE,
  GRAPH_OPTIONS_MALFORMED,
  BASE_HASH_DIVERGED,
} from '../reason-codes.js';
import { buildReadyGraph, buildReadyGraphWithTopLevelOptions, frameFor, hashOf, makeEnvelope } from './fixtures.js';

const addOption = (id = 'o-c') =>
  makeEnvelope('add_option', {
    option: { id, label: 'Plan C', parent_decision_id: 'd-choice', edges: [{ to_factor_id: 'f-spend' }] },
  });

// Representation cases (all mutating, hash-matching, fresh frame).
const CASES: Array<{ name: string; graph: Record<string, unknown>; code: string }> = [
  {
    name: 'nodes-only (option nodes, NO top-level options[])',
    graph: buildReadyGraph() as unknown as Record<string, unknown>,
    code: ADD_OPTION_APPLY_UNWIRED,
  },
  {
    name: 'options-present (option nodes + canonical top-level options[])',
    graph: buildReadyGraphWithTopLevelOptions() as unknown as Record<string, unknown>,
    code: OPTION_TOP_LEVEL_OPTIONS_DIVERGENCE,
  },
  {
    name: 'mixed (top-level options[] with an extra id not present as a node)',
    graph: { ...buildReadyGraph(), options: [{ id: 'o-a', label: 'A', status: 'ready', interventions: {} }, { id: 'o-z', label: 'Z', status: 'ready', interventions: {} }] },
    code: OPTION_TOP_LEVEL_OPTIONS_DIVERGENCE,
  },
  {
    name: 'empty options[] (array present but empty → context sees 0, analysis sees nodes)',
    graph: { ...buildReadyGraph(), options: [] },
    code: OPTION_TOP_LEVEL_OPTIONS_DIVERGENCE,
  },
  {
    name: 'malformed non-array options (context retains the corrupt value)',
    graph: { ...buildReadyGraph(), options: 'oops' },
    code: GRAPH_OPTIONS_MALFORMED,
  },
  {
    name: 'option-node present but top-level options[] STALE (missing o-b)',
    graph: { ...buildReadyGraph(), options: [{ id: 'o-a', label: 'A', status: 'ready', interventions: {} }] },
    code: OPTION_TOP_LEVEL_OPTIONS_DIVERGENCE,
  },
  {
    name: 'top-level options[] present but option-NODE missing (o-z has no node)',
    graph: { ...buildReadyGraph(), options: [{ id: 'o-a', label: 'A', status: 'ready', interventions: {} }, { id: 'o-b', label: 'B', status: 'ready', interventions: {} }, { id: 'o-z', label: 'Z', status: 'ready', interventions: {} }] },
    code: OPTION_TOP_LEVEL_OPTIONS_DIVERGENCE,
  },
];

describe('add_option divergence fixtures — each proves the held rationale', () => {
  for (const c of CASES) {
    it(`${c.name} → held ${c.code}`, () => {
      const raw = { ...addOption('o-c'), base_graph_hash: hashOf(c.graph) };
      const v = refereeMutation(raw, c.graph, frameFor(c.graph));
      expect(v.verdict).toBe('held');
      expect(v.blocker?.code).toBe(c.code);
    });
  }

  it('8th case — stale apply attempt for the add_option surface → stale (BASE_HASH_DIVERGED)', () => {
    const graph = buildReadyGraph();
    const raw = { ...addOption('o-c'), base_graph_hash: 'a-hash-from-an-older-graph' };
    const v = refereeMutation(raw, graph, frameFor(graph));
    expect(v.verdict).toBe('stale');
    expect(v.blocker?.code).toBe(BASE_HASH_DIVERGED);
  });

  it('Paul #3 — passing the divergence fixtures does NOT un-hold add_option (never would_apply/applied)', () => {
    for (const c of CASES) {
      const raw = { ...addOption('o-c'), base_graph_hash: hashOf(c.graph) };
      const v = refereeMutation(raw, c.graph, frameFor(c.graph));
      expect(v.verdict).not.toBe('would_apply');
      expect(['held', 'stale', 'rejected', 'clarify_required']).toContain(v.verdict);
    }
  });
});
