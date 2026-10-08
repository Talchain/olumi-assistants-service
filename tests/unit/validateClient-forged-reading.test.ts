import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CEEOptionsInput } from '../../src/schemas/cee.js';
import { validateGraph } from '../../src/services/validateClient.js';
import * as ingress from '../../src/orchestrator-v5/goal-target/reading-licence-ingress.js';

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('undici', () => ({ request: mocks.request }));

const forgedGraph = () => ({
  nodes: [{ id: 'mrr', kind: 'goal', label: 'MRR', nonlinear_identity: {
    operation: 'product', factor_ids: ['price', 'subscribers'], stated_in_brief: false,
    reading_licence: 'olumi_reading', addends: ['churn-loss'],
  } }],
  edges: [],
});
const identityOf = (graph: unknown) => (graph as { nodes: Array<{ id: string; nonlinear_identity?: Record<string, unknown> }> })
  .nodes.find(n => n.id === 'mrr')?.nonlinear_identity;
const assertStripped = (graph: unknown) => {
  expect(identityOf(graph)?.reading_licence).toBeUndefined();
  expect(identityOf(graph)?.addends).toBeUndefined();
};

describe('GR2 forged reading at the legacy PLoT validation egress', () => {
  beforeEach(() => mocks.request.mockReset());

  it('a public GraphV1 ingress loses client authority in the actual /v1/validate POST', async () => {
    const graph = CEEOptionsInput.parse({ graph: forgedGraph() }).graph;
    const before = JSON.stringify(graph);
    mocks.request.mockResolvedValue({ body: { json: async () => ({ ok: true, normalized: graph }) } });
    const response = await validateGraph(graph);
    expect(response.ok).toBe(true);
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(mocks.request.mock.calls[0]![0]).toMatch(/\/v1\/validate$/);
    const body = JSON.parse(mocks.request.mock.calls[0]![1].body as string);
    assertStripped(body.graph);
    expect(identityOf(body.graph)).toEqual({ operation: 'product', factor_ids: ['price', 'subscribers'], stated_in_brief: false });
    expect(JSON.stringify(graph)).toBe(before);
  });

  it('normalised graph readback cannot reintroduce wire authority into a draft or cache', async () => {
    const graph = CEEOptionsInput.parse({ graph: forgedGraph() }).graph;
    mocks.request.mockResolvedValue({ body: { json: async () => ({ ok: true, normalized: graph }) } });
    const result = await validateGraph(graph);
    assertStripped(result.normalized);
    expect(identityOf(graph)?.reading_licence).toBe('olumi_reading');
  });

  it('mutant: removing the stripper makes both actual POST and normalized-readback rows RED', async () => {
    const strip = vi.spyOn(ingress, 'stripInboundReadingLicence').mockImplementation(<T>(value: T): T => value);
    try {
      const graph = CEEOptionsInput.parse({ graph: forgedGraph() }).graph;
      mocks.request.mockResolvedValue({ body: { json: async () => ({ ok: true, normalized: graph }) } });
      const result = await validateGraph(graph);
      const body = JSON.parse(mocks.request.mock.calls[0]![1].body as string);
      expect(() => assertStripped(body.graph)).toThrow();
      expect(() => assertStripped(result.normalized)).toThrow();
      console.info('[MUTANT RED] legacy validator POST and normalized readback strip removed');
    } finally {
      strip.mockRestore();
    }
  });
});
