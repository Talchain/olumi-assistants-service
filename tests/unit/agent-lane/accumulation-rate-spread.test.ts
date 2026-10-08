import { describe, expect, it } from 'vitest';
import { withAccumulationRateSpread } from '../../../src/orchestrator-v5/agent-lane/accumulation-rate-spread.js';

type Node = {
  id: string;
  observed_state?: { value?: number; source?: string };
  nonlinear_identity?: { operation: string; factor_ids: string[]; horizon_months?: number; rate_scale?: number; stated_in_brief: boolean; rate_sigma_log?: number[] };
};

function b1(churnSource = 'user_override', inflowSource = 'user_override') {
  const nodes: Node[] = [
    { id: 'S0', observed_state: { value: 250, source: 'user_override' } },
    { id: 'churn', observed_state: { value: 3, source: churnSource } },
    { id: 'inflow', observed_state: { value: 25, source: inflowSource } },
    { id: 'subs_m12', nonlinear_identity: { operation: 'accumulation', factor_ids: ['S0', 'churn', 'inflow'], horizon_months: 12, rate_scale: 0.01, stated_in_brief: true } },
  ];
  return { nodes, edges: [] };
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

const carrierOf = (graph: ReturnType<typeof b1>) => graph.nodes.find((node) => node.id === 'subs_m12')!.nonlinear_identity!;

describe('Run-only accumulation rate spread (B1-ACC)', () => {
  it('all three user_override levels carry user spread in churn/inflow order', () => {
    expect(carrierOf(withAccumulationRateSpread(b1())).rate_sigma_log).toEqual([0.136, 0.136]);
  });

  it('Olumi churn and user inflow carry different spreads', () => {
    expect(carrierOf(withAccumulationRateSpread(b1('cee_inference'))).rate_sigma_log).toEqual([0.246, 0.136]);
  });

  it('keeps positional order when inflow is Olumi’s', () => {
    expect(carrierOf(withAccumulationRateSpread(b1('user_override', 'cee_inference'))).rate_sigma_log).toEqual([0.136, 0.246]);
  });

  it('copies the carrier from a deeply frozen graph and leaves every input byte unchanged', () => {
    const graph = deepFreeze(b1());
    const before = structuredClone(graph);
    const wire = withAccumulationRateSpread(graph);
    expect(carrierOf(wire).rate_sigma_log).toEqual([0.136, 0.136]);
    expect(wire).not.toBe(graph);
    expect(graph).toEqual(before);
    expect(carrierOf(graph).rate_sigma_log).toBeUndefined();
    expect(wire.nodes.find((node) => node.id === 'S0')).toBe(graph.nodes.find((node) => node.id === 'S0'));
    expect(wire.edges).toBe(graph.edges);
  });

  it('returns the same reference for a graph with only a product identity', () => {
    const graph = b1();
    graph.nodes.find((node) => node.id === 'subs_m12')!.nonlinear_identity = {
      operation: 'product', factor_ids: ['S0', 'inflow'], stated_in_brief: true,
    };
    expect(withAccumulationRateSpread(graph)).toBe(graph);
  });

  it('recomputes from current authorship when the user confirms churn after drafting', () => {
    const graph = b1('cee_inference');
    const priorWire = withAccumulationRateSpread(graph);
    expect(carrierOf(priorWire).rate_sigma_log).toEqual([0.246, 0.136]);
    graph.nodes.find((node) => node.id === 'churn')!.observed_state!.source = 'user_confirmed';
    expect(carrierOf(withAccumulationRateSpread(graph)).rate_sigma_log).toEqual([0.136, 0.136]);
    expect(carrierOf(withAccumulationRateSpread(priorWire)).rate_sigma_log).toEqual([0.136, 0.136]);
    expect(carrierOf(graph).rate_sigma_log).toBeUndefined();
  });

  it.each(['churn', 'inflow'])('leaves the carrier untouched when %s is missing', (id) => {
    const graph = b1();
    graph.nodes = graph.nodes.filter((node) => node.id !== id);
    expect(withAccumulationRateSpread(graph)).toBe(graph);
    expect(carrierOf(graph).rate_sigma_log).toBeUndefined();
  });

  it.each([undefined, NaN, Infinity, -Infinity])('leaves the carrier untouched for a nonfinite rate value %s', (value) => {
    const graph = b1();
    graph.nodes.find((node) => node.id === 'churn')!.observed_state!.value = value;
    expect(withAccumulationRateSpread(graph)).toBe(graph);
    expect(carrierOf(graph).rate_sigma_log).toBeUndefined();
  });

  it('returns the same reference when the wire already carries the current spread', () => {
    const wire = withAccumulationRateSpread(b1());
    expect(withAccumulationRateSpread(wire)).toBe(wire);
  });
});
