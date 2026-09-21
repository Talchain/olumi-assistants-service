/**
 * Track S 0.13c-4 — persist-site intercept repair (wrapper unit tests).
 *
 * Proves the persist-site repair: removes duplicate observed-root intercepts that
 * non-draft paths could persist (set_factor_value / edit_graph / proposal-apply),
 * preserves all ambiguous/derived/zero cases + D1 graph shape, no-ops on
 * graph-absent writes, emits redacted telemetry only on repair, and is non-blocking.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

import { repairGraphForPersistence } from '../../../src/orchestrator-v5/repair-graph-for-persistence.js';
import { setTestSink, log } from '../../../src/utils/telemetry.js';

type AnyGraph = { nodes: Array<Record<string, unknown> & { id: string }>; edges: Array<Record<string, unknown>>; [k: string]: unknown };

const nodeById = (g: AnyGraph, id: string): Record<string, unknown> => {
  const n = g.nodes.find((x) => x.id === id);
  if (!n) throw new Error(`node ${id} missing`);
  return n;
};

afterEach(() => {
  vi.restoreAllMocks();
  setTestSink(null);
});

describe('repairGraphForPersistence (Track S 0.13c-4)', () => {
  it('B: removes a post-edit exact duplicate (ambiguous root whose value now equals its intercept) — set_factor_value', () => {
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    setTestSink((event, data) => events.push({ event, data }));
    const g: AnyGraph = {
      nodes: [
        { id: 'goal_1', kind: 'goal', label: 'G' },
        // a no-baseline/non-equal root that an edit turned into an exact duplicate:
        { id: 'fac_x', kind: 'factor', label: 'X', observed_state: { value: 0.5 }, intercept: 0.5 },
        // an unrelated non-equal root that must be preserved:
        { id: 'fac_keep', kind: 'factor', label: 'K', observed_state: { value: 0.9 }, intercept: 0.3 },
      ],
      edges: [],
    };
    const out = repairGraphForPersistence(g, { scenarioId: 'sc-1', turnId: 't-1', turnClass: 'decide', source: 'set_factor_value' });
    expect('intercept' in nodeById(out, 'fac_x')).toBe(false); // newly-created exact duplicate normalised
    expect(nodeById(out, 'fac_keep').intercept).toBe(0.3);     // unrelated non-equal preserved
    expect(nodeById(g, 'fac_x').intercept).toBe(0.5);          // INPUT graph not mutated (clone)
    expect(events.filter((e) => e.event === 'v5.graph_persist.intercept_repair')).toHaveLength(1);
  });

  it('C: removes a model-added factor node carrying intercept === observed_state.value (edit_graph add-node)', () => {
    const g: AnyGraph = {
      nodes: [{ id: 'fac_new', kind: 'factor', label: 'new', observed_state: { value: 0.2 }, intercept: 0.2 }],
      edges: [],
    };
    const out = repairGraphForPersistence(g, { source: 'edit_graph' });
    expect('intercept' in nodeById(out, 'fac_new')).toBe(false);
  });

  it('D: preserves explicit-zero, non-equal, no-baseline, derived, and constraint-derived (only the true root duplicate removed)', () => {
    const g: AnyGraph = {
      nodes: [
        { id: 'con_x', kind: 'constraint', label: 'c' },
        { id: 'fac_zero', kind: 'factor', label: 'z', observed_state: { value: 0.7 }, intercept: 0 },
        { id: 'fac_neq', kind: 'factor', label: 'n', observed_state: { value: 0.5 }, intercept: 0.3 },
        { id: 'fac_nobase', kind: 'factor', label: 'nb', intercept: 0.4 },
        { id: 'fac_root_dup', kind: 'factor', label: 'rd', observed_state: { value: 0.6 }, intercept: 0.6 },
        { id: 'fac_derived', kind: 'factor', label: 'd', observed_state: { value: 0.6 }, intercept: 0.6 },
        { id: 'fac_cd', kind: 'factor', label: 'cd', observed_state: { value: 0.4 }, intercept: 0.4 },
      ],
      edges: [
        { from: 'fac_root_dup', to: 'fac_derived', edge_type: 'directed' }, // makes fac_derived derived
        { from: 'con_x', to: 'fac_cd', edge_type: 'directed' },             // constraint source → fac_cd stays derived
      ],
    };
    const out = repairGraphForPersistence(g);
    expect(nodeById(out, 'fac_zero').intercept).toBe(0);
    expect(nodeById(out, 'fac_neq').intercept).toBe(0.3);
    expect(nodeById(out, 'fac_nobase').intercept).toBe(0.4);
    expect('intercept' in nodeById(out, 'fac_root_dup')).toBe(false); // the only removal
    expect(nodeById(out, 'fac_derived').intercept).toBe(0.6);
    expect(nodeById(out, 'fac_cd').intercept).toBe(0.4);
  });

  it('E: preserves D1 graph shape (goal_node_id, options[], sibling keys) while removing the duplicate', () => {
    const g: AnyGraph = {
      nodes: [{ id: 'fac_x', kind: 'factor', label: 'X', observed_state: { value: 0.5 }, intercept: 0.5 }],
      edges: [],
      goal_node_id: 'goal_1',
      options: [{ id: 'opt_a', label: 'A' }],
      analysis_ready: { ok: true },
      schema_version: '3.0',
      goal_constraints: [{ k: 1 }],
    };
    const out = repairGraphForPersistence(g) as AnyGraph;
    expect(out.goal_node_id).toBe('goal_1');
    expect(out.options).toEqual([{ id: 'opt_a', label: 'A' }]);
    expect(out.analysis_ready).toEqual({ ok: true });
    expect(out.schema_version).toBe('3.0');
    expect(out.goal_constraints).toEqual([{ k: 1 }]);
    expect('intercept' in nodeById(out, 'fac_x')).toBe(false);
  });

  it('F: telemetry emits only on repair, redacted (IDs/counts only — no values/magnitudes/graph content)', () => {
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    setTestSink((event, data) => events.push({ event, data }));
    // clean → no emit
    repairGraphForPersistence({ nodes: [{ id: 'f', kind: 'factor', observed_state: { value: 0.2 } }], edges: [] });
    expect(events.filter((e) => e.event === 'v5.graph_persist.intercept_repair')).toHaveLength(0);
    // dirty → one redacted emit
    repairGraphForPersistence(
      { nodes: [{ id: 'fac_x', kind: 'factor', observed_state: { value: 0.5 }, intercept: 0.5 }], edges: [] },
      { scenarioId: 'sc', turnId: 't', turnClass: 'decide', source: 'set_factor_value' },
    );
    const ev = events.filter((e) => e.event === 'v5.graph_persist.intercept_repair');
    expect(ev).toHaveLength(1);
    const d = ev[0]!.data;
    expect(d).toMatchObject({ scenario_id: 'sc', turn_id: 't', turn_class: 'decide', source: 'set_factor_value', corrected_count: 1, node_ids: ['fac_x'] });
    expect(Object.keys(d).sort()).toEqual(['corrected_count', 'node_ids', 'scenario_id', 'source', 'turn_class', 'turn_id'].sort());
    for (const k of ['before', 'after', 'value', 'observed_state', 'intercept', 'graph', 'nodes', 'magnitude']) {
      expect(d).not.toHaveProperty(k);
    }
  });

  it('no-op safe on graph-absent writes (undefined/null) — returns input, no emit', () => {
    const events: string[] = [];
    setTestSink((event) => events.push(event));
    expect(repairGraphForPersistence(undefined)).toBeUndefined();
    expect(repairGraphForPersistence(null)).toBeNull();
    expect(events.filter((e) => e === 'v5.graph_persist.intercept_repair')).toHaveLength(0);
  });

  it('returns the ORIGINAL reference unchanged when there is no duplicate (no clone churn)', () => {
    const g = { nodes: [{ id: 'f', kind: 'factor', observed_state: { value: 0.2 } }], edges: [] };
    expect(repairGraphForPersistence(g)).toBe(g);
  });

  it('non-blocking: a non-serialisable graph degrades to the unrepaired input (clone failure, redacted warn)', () => {
    const circular: Record<string, unknown> = { nodes: [], edges: [] };
    circular.self = circular;
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
    const events: string[] = [];
    setTestSink((event) => events.push(event));
    const out = repairGraphForPersistence(circular, { scenarioId: 'sc', turnId: 't' });
    setTestSink(null);

    expect(out).toBe(circular); // no repaired artifact exists → persist the original
    expect(events.filter((e) => e === 'v5.graph_persist.intercept_repair')).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(1);
    const p = warn.mock.calls[0]![0] as Record<string, unknown>;
    expect(p).toMatchObject({ event: 'v5.graph_persist.intercept_repair_failed', reason: 'clone_failed', error_name: 'TypeError', scenario_id: 'sc', turn_id: 't' });
    expect(Object.keys(p).sort()).toEqual(['error_name', 'event', 'reason', 'scenario_id', 'turn_id'].sort());
    expect(p).not.toHaveProperty('message');
    expect(p).not.toHaveProperty('err');
  });

  it('repair-step throw AFTER mutation does NOT discard the repair (returns the never-dirtier clone, not the dirty original)', () => {
    // The shared predicate deletes node.intercept BEFORE its redacted per-node log.info.
    // Force that internal log to throw (the only way the repair step can throw today) and
    // prove the wrapper still persists the repaired clone — structurally, not by luck.
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
    const info = vi.spyOn(log, 'info').mockImplementation(() => {
      throw new Error('logger boom');
    });
    const g: AnyGraph = {
      nodes: [{ id: 'fac_dup', kind: 'factor', label: 'D', observed_state: { value: 0.5 }, intercept: 0.5 }],
      edges: [],
    };
    const out = repairGraphForPersistence(g, { scenarioId: 'sc', turnId: 't', source: 'set_factor_value' });
    info.mockRestore();

    // the duplicate WAS stripped from the persisted graph despite the predicate throwing
    expect('intercept' in nodeById(out, 'fac_dup')).toBe(false);
    expect(out).not.toBe(g); // the clone, never the original reference
    expect(nodeById(g, 'fac_dup').intercept).toBe(0.5); // input untouched
    // redacted repair_failed fallback (no success emit — its bookkeeping threw)
    const rf = warn.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .filter((p) => p?.event === 'v5.graph_persist.intercept_repair_failed');
    expect(rf).toHaveLength(1);
    const p = rf[0]!;
    expect(p).toMatchObject({ event: 'v5.graph_persist.intercept_repair_failed', reason: 'repair_failed', error_name: 'Error', scenario_id: 'sc', turn_id: 't' });
    expect(Object.keys(p).sort()).toEqual(['error_name', 'event', 'reason', 'scenario_id', 'turn_id'].sort());
    expect(p).not.toHaveProperty('message');
    expect(p).not.toHaveProperty('err');
  });

  it('telemetry failure does NOT discard a successful repair (emit throws → graph still repaired, redacted fallback)', () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
    // A throwing test sink makes emit() throw (it invokes the sink before the guarded
    // Datadog section). The repair must survive — the dirty graph must NOT be persisted.
    setTestSink(() => {
      throw new Error('sink boom');
    });
    const g: AnyGraph = {
      nodes: [{ id: 'fac_dup', kind: 'factor', label: 'D', observed_state: { value: 0.5 }, intercept: 0.5 }],
      edges: [],
    };
    let out!: AnyGraph;
    try {
      out = repairGraphForPersistence(g, { scenarioId: 'sc', turnId: 't', source: 'set_factor_value' });
    } finally {
      setTestSink(null);
    }
    // repair preserved despite the telemetry failure
    expect('intercept' in nodeById(out, 'fac_dup')).toBe(false);
    // a REDACTED fallback diagnostic was logged
    const tf = warn.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .filter((p) => p?.event === 'v5.graph_persist.intercept_repair_telemetry_failed');
    expect(tf).toHaveLength(1);
    const p = tf[0]!;
    expect(p).toMatchObject({
      event: 'v5.graph_persist.intercept_repair_telemetry_failed',
      scenario_id: 'sc',
      turn_id: 't',
      reason: 'telemetry_emit_failed',
      error_name: 'Error',
    });
    expect(Object.keys(p).sort()).toEqual(['error_name', 'event', 'reason', 'scenario_id', 'turn_id'].sort());
    expect(p).not.toHaveProperty('message');
    expect(p).not.toHaveProperty('err');
  });
});
