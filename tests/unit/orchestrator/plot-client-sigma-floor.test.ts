/**
 * W2E-2 review round 3 — SIGMA IS FLOORED AT THE COMPUTE BOUNDARY.
 *
 * Constraint (3) of the round-3 ruling: no meaningless (NaN/±Infinity) or
 * un-interpretable value may reach computation. `strength.std <= 0` violates
 * the vendored @talchain/schemas contract (`z.number().positive()`), but it
 * has an unambiguous safe reading — "no uncertainty stated" — and the live UI
 * writer emits it continuously (`Math.max(0, strengthStdValue)` floors at
 * ZERO). So it must be REPAIRED rather than rejected, and repaired at the
 * point of CONSUMPTION rather than at the door — repairing at ingress forks
 * graph identity and desyncs every hash token (see
 * boundary/__tests__/request-extensions-graph-identity.test.ts).
 *
 * `PLoTClient.run` is the true compute boundary: it is the single choke point
 * that BOTH live PLoT dispatches funnel through —
 *   - src/orchestrator-v5/tools/handlers/run-analysis.ts:466 (V5)
 *   - src/orchestrator/tools/run-analysis.ts:229 (deterministic/chip path)
 * — and it is already the established outbound-enforcement seam
 * (`validateRunPayload`, "H.5: Outbound structural validation").
 *
 * The floor must not mutate the caller's graph: `graph_hash_at_run` is
 * computed from `snapshot.rawPersistedGraph` (run-analysis.ts:418) and any
 * perturbation there reproduces the false-stale regression of staging build
 * abc7d29.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

import { _floorRunPayloadSigma } from '../../../src/orchestrator/plot-client.js';
import { setTestSink, TelemetryEvents } from '../../../src/utils/telemetry.js';

afterEach(() => {
  setTestSink(null);
  vi.restoreAllMocks();
});

function runPayloadWithZeroStd() {
  return {
    graph: {
      nodes: [
        { id: 'fac_1', kind: 'factor', label: 'SensitiveLabelA' },
        { id: 'goal_1', kind: 'goal', label: 'SensitiveLabelB' },
      ],
      edges: [
        {
          from: 'fac_1',
          to: 'goal_1',
          strength: { mean: 0.5, std: 0 },
          exists_probability: 0.8,
        },
      ],
    },
    options: [{ id: 'opt_1', option_id: 'opt_1', interventions: { fac_1: 1 } }],
    goal_node_id: 'goal_1',
  };
}

describe('PLoTClient run payload — sigma floor at the compute boundary', () => {
  it('floors edge strength.std = 0 to a positive value before PLoT sees it', () => {
    const payload = runPayloadWithZeroStd();
    const out = _floorRunPayloadSigma(payload, 'req-1');
    const edge = (out.graph as { edges: Array<Record<string, any>> }).edges[0];
    expect(edge.strength.std).toBeGreaterThan(0);
  });

  it('floors a negative edge strength.std', () => {
    const payload = runPayloadWithZeroStd();
    payload.graph.edges[0].strength.std = -0.2;
    const out = _floorRunPayloadSigma(payload, 'req-1');
    const edge = (out.graph as { edges: Array<Record<string, any>> }).edges[0];
    expect(edge.strength.std).toBeGreaterThan(0);
  });

  it('floors node observed_state.std <= 0', () => {
    const payload = {
      ...runPayloadWithZeroStd(),
      graph: {
        nodes: [{ id: 'fac_1', kind: 'factor', observed_state: { value: 0.5, std: 0 } }],
        edges: [],
      },
    };
    const out = _floorRunPayloadSigma(payload, 'req-1');
    const node = (out.graph as { nodes: Array<Record<string, any>> }).nodes[0];
    expect(node.observed_state.std).toBeGreaterThan(0);
    expect(node.observed_state.value).toBe(0.5);
  });

  it('leaves every other numeric value untouched', () => {
    const out = _floorRunPayloadSigma(runPayloadWithZeroStd(), 'req-1');
    const edge = (out.graph as { edges: Array<Record<string, any>> }).edges[0];
    expect(edge.strength.mean).toBe(0.5);
    expect(edge.exists_probability).toBe(0.8);
    expect(out.goal_node_id).toBe('goal_1');
    expect(out.options).toEqual([{ id: 'opt_1', option_id: 'opt_1', interventions: { fac_1: 1 } }]);
  });

  it('does NOT mutate the caller graph — rawPersistedGraph/freshness stay intact', () => {
    const payload = runPayloadWithZeroStd();
    _floorRunPayloadSigma(payload, 'req-1');
    expect(payload.graph.edges[0].strength.std).toBe(0);
  });

  it('a clean payload round-trips BY REFERENCE (zero cost, byte-identical)', () => {
    const payload = runPayloadWithZeroStd();
    payload.graph.edges[0].strength.std = 0.3;
    const out = _floorRunPayloadSigma(payload, 'req-1');
    expect(out).toBe(payload);
  });

  it('emits telemetry naming the field path, carrying no PII', () => {
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    setTestSink((event, data) => events.push({ event, data }));

    _floorRunPayloadSigma(runPayloadWithZeroStd(), 'req-1');

    const floors = events.filter((e) => e.event === TelemetryEvents.ComputeSigmaFloor);
    expect(floors.length).toBe(1);
    expect(floors[0].data.path).toBe('edges.0.strength.std');
    expect(floors[0].data.request_id).toBe('req-1');
    expect(JSON.stringify(floors[0])).not.toContain('SensitiveLabel');
  });
});
