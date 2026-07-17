/**
 * W2E-2 review round 4 — THE SIGMA FLOOR MUST EXECUTE ON THE LIVE PATH.
 *
 * Round 3 placed `floorRunPayloadSigma` inside `PLoTClient.run`, but the live
 * V5 chain rejects a `strength.std <= 0` persisted graph BEFORE that code can
 * run: `loadScenarioSnapshotForRunAnalysis` → `GraphV3.safeParse`
 * (build-turn-context.ts, `EdgeStrengthV3.std: z.number().positive()`,
 * cee-v3.ts) throws → run-analysis wraps it as `scenario_read_failed,
 * retryable: true` — a deterministic failure dressed as transient infra — and
 * `PLoTClient.run` is never reached. The only other `plotClient.run` caller
 * (src/orchestrator/tools/run-analysis.ts) is reachable solely via the dead
 * V1 route (410) or the unregistered V4 deterministic pipeline. The round-3
 * floor was therefore dead code on every live path.
 *
 * Round 4 moves the floor to the ONE point the persisted graph actually
 * crosses into the compute projection: `loadScenarioSnapshotForRunAnalysis`,
 * BEFORE the `GraphV3.safeParse` that used to kill the turn. Wired live via
 * registry.ts (`DEFAULT_SCENARIO_READER` = this loader).
 *
 * Constraint order pinned here (review rounds 1–3 doctrine):
 *  (1) never brick a persisted scenario — std<=0 has the unambiguous safe
 *      reading "no uncertainty stated" (the live UI writer floors at ZERO via
 *      `Math.max(0, strengthStdValue)`, so persisted 0 is continuously
 *      produced) → REPAIRED for compute, run_analysis succeeds;
 *  (2) never silently fork graph identity — `strength.std` is inside the
 *      analysis-affecting hash projection (graph-hash.ts), and
 *      `graph_hash_at_run` is computed from `snapshot.rawPersistedGraph`
 *      (run-analysis.ts) → the floor must NEVER touch `rawPersistedGraph` or
 *      the caller's graph;
 *  (3) never let bad numerics reach computation — values with NO safe reading
 *      (exists_probability outside [0,1]) are refused HONESTLY: a typed
 *      AnalysisNotReadyError (non-retryable, actionable), not the
 *      retryable-forever `scenario_read_failed` lie.
 */
import { describe, it, expect, afterEach } from 'vitest';

import { loadScenarioSnapshotForRunAnalysis } from '../build-turn-context.js';
import { AnalysisNotReadyError } from '../tools/handlers/analysis-ready-core.js';
import { createNoopSessionStore } from '../session/__tests__/fixtures.js';
import { setTestSink, TelemetryEvents } from '../../utils/telemetry.js';
import { COMPUTE_SIGMA_FLOOR } from '../../cee/constants.js';
import type { GraphV3T } from '../../schemas/cee-v3.js';

afterEach(() => {
  setTestSink(null);
});

const SCENARIO_ID = 'scn-sigma-floor';

/**
 * Minimal analysis-ready graph. `stdForFactorEdge` / `existsProbability`
 * parameterise the two violation classes under test. Labels are deliberately
 * distinctive so the PII assertions have a positive control to look for.
 */
function persistedGraph(overrides?: {
  stdForFactorEdge?: number;
  existsProbability?: number;
}): Record<string, unknown> {
  const std = overrides?.stdForFactorEdge ?? 0.1;
  const existsProbability = overrides?.existsProbability ?? 1;
  return {
    nodes: [
      { id: 'goal_1', kind: 'goal', label: 'SensitiveGoalLabel' },
      { id: 'dec_1', kind: 'decision', label: 'SensitiveDecisionLabel' },
      { id: 'opt_a', kind: 'option', label: 'SensitiveOptionA', interventions: { fac_x: 1 } },
      { id: 'opt_b', kind: 'option', label: 'SensitiveOptionB', interventions: { fac_x: 0.5 } },
      {
        id: 'fac_x',
        kind: 'factor',
        label: 'SensitiveFactorLabel',
        category: 'controllable',
        observed_state: { value: 1, extractionType: 'explicit', factor_type: 'other' },
      },
    ],
    edges: [
      { from: 'dec_1', to: 'opt_a', strength: { mean: 1.0, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'dec_1', to: 'opt_b', strength: { mean: 1.0, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'opt_a', to: 'fac_x', strength: { mean: 1.0, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'opt_b', to: 'fac_x', strength: { mean: 0.5, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      {
        from: 'fac_x',
        to: 'goal_1',
        strength: { mean: 0.6, std },
        exists_probability: existsProbability,
        effect_direction: 'positive',
      },
    ],
  };
}

function edgeByFrom(graph: GraphV3T, from: string) {
  const edge = graph.edges.find((e) => e.from === from);
  expect(edge).toBeDefined();
  return edge!;
}

describe('loadScenarioSnapshotForRunAnalysis — persisted sigma floor (round 4)', () => {
  it('REPAIRS persisted strength.std = 0 for compute instead of failing the turn (constraint 1)', async () => {
    const graph = persistedGraph({ stdForFactorEdge: 0 });
    const store = createNoopSessionStore({ loadGraphResult: graph });

    // Round-3 head: this call THROWS ('Persisted graph failed GraphV3
    // validation…') and run_analysis reports retryable scenario_read_failed
    // forever. Round 4: the snapshot resolves and compute sees the floor.
    const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO_ID, 'req-floor-1', store);

    expect(edgeByFrom(snapshot.graph, 'fac_x').strength.std).toBe(COMPUTE_SIGMA_FLOOR);
    expect(snapshot.goal_node_id).toBe('goal_1');
  });

  it('never touches the hash input or the caller graph — identity is not forked (constraint 2)', async () => {
    const graph = persistedGraph({ stdForFactorEdge: 0 });
    const before = JSON.stringify(graph);
    const store = createNoopSessionStore({ loadGraphResult: graph });

    const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO_ID, 'req-floor-2', store);

    // graph_hash_at_run is computed from snapshot.rawPersistedGraph
    // (run-analysis.ts) — it must observe the UNREPAIRED value, byte-for-byte
    // the graph every other hash site (freshness) reads.
    const rawEdges = (snapshot.rawPersistedGraph as { edges: Array<Record<string, unknown>> }).edges;
    const rawFactorEdge = rawEdges.find((e) => e.from === 'fac_x')!;
    expect((rawFactorEdge.strength as { std: number }).std).toBe(0);
    // Copy-on-write: the persisted object itself is untouched.
    expect(JSON.stringify(graph)).toBe(before);
  });

  it('emits code-keyed sigma-floor telemetry — field path + floor, never a value or label', async () => {
    const events: Array<{ name: string; data: Record<string, unknown> }> = [];
    setTestSink((name, data) => events.push({ name, data }));

    const graph = persistedGraph({ stdForFactorEdge: 0 });
    const store = createNoopSessionStore({ loadGraphResult: graph });
    await loadScenarioSnapshotForRunAnalysis(SCENARIO_ID, 'req-floor-3', store);

    const floorEvents = events.filter((e) => e.name === TelemetryEvents.ComputeSigmaFloor);
    expect(floorEvents).toHaveLength(1);
    expect(floorEvents[0]!.data).toMatchObject({
      kind: 'sigma_non_positive',
      repaired_to: COMPUTE_SIGMA_FLOOR,
      request_id: 'req-floor-3',
    });
    // Positive control first: the serialised event DOES carry the field path…
    const serialised = JSON.stringify(floorEvents[0]);
    expect(serialised).toContain('strength.std');
    // …so the absence assertions below are proven able to see a presence.
    expect(serialised).not.toContain('Sensitive');
  });

  it('emits NO telemetry and floors nothing on a clean graph', async () => {
    const events: Array<{ name: string; data: Record<string, unknown> }> = [];
    setTestSink((name, data) => events.push({ name, data }));

    const graph = persistedGraph();
    const store = createNoopSessionStore({ loadGraphResult: graph });
    const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO_ID, 'req-floor-4', store);

    expect(edgeByFrom(snapshot.graph, 'fac_x').strength.std).toBe(0.1);
    expect(events.filter((e) => e.name === TelemetryEvents.ComputeSigmaFloor)).toHaveLength(0);
  });
});

describe('loadScenarioSnapshotForRunAnalysis — honest refusal for unrepairable persisted numerics (round 4)', () => {
  it('REFUSES persisted exists_probability outside [0,1] with a typed, non-retryable error (constraint 3)', async () => {
    const graph = persistedGraph({ existsProbability: 1.4 });
    const store = createNoopSessionStore({ loadGraphResult: graph });

    // Round-3 head: generic Error → run-analysis maps it to
    // scenario_read_failed retryable:true — a retry that can never succeed.
    // Round 4: AnalysisNotReadyError → run-analysis maps it to
    // analysis_not_ready (non-retryable, honest next step, review chip).
    const thrown = await loadScenarioSnapshotForRunAnalysis(SCENARIO_ID, 'req-refuse-1', store)
      .then(() => null)
      .catch((e: unknown) => e);

    expect(thrown).toBeInstanceOf(AnalysisNotReadyError);
    const verdict = (thrown as AnalysisNotReadyError).verdict;
    expect(verdict.status).toBe('unrecoverable');
    expect(verdict.reasonCodes).toContain('SCHEMA_INVALID');
    expect(verdict.reasonCategory).toBe('numeric_integrity');
    expect(verdict.userActionRequired).toBe(true);
    expect(typeof verdict.nextStep).toBe('string');

    // PII rule — positive control first: the error/verdict serialisation DOES
    // mention probability (so absence checks below can see a presence)…
    const serialised = JSON.stringify({
      message: (thrown as Error).message,
      verdict,
    });
    expect(serialised.toLowerCase()).toContain('probability');
    // …and never the offending value or any user label.
    expect(serialised).not.toContain('1.4');
    expect(serialised).not.toContain('Sensitive');
  });

  it('keeps NON-numeric malformed graphs on the existing scenario_read_failed path (scope pin)', async () => {
    // Structurally corrupt (nodes is not an array) — GraphV3 fails on shape,
    // not on a numeric bound. This must NOT be re-labelled analysis_not_ready:
    // the existing comment contract says a present-but-corrupt graph fails
    // into scenario_read_failed so we never tell a user who HAS a graph to
    // "draft a model first".
    const store = createNoopSessionStore({ loadGraphResult: { nodes: 'corrupt', edges: [] } });

    const thrown = await loadScenarioSnapshotForRunAnalysis(SCENARIO_ID, 'req-refuse-2', store)
      .then(() => null)
      .catch((e: unknown) => e);

    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).not.toBeInstanceOf(AnalysisNotReadyError);
    expect((thrown as Error).message).toContain('failed GraphV3 validation');
  });
});
