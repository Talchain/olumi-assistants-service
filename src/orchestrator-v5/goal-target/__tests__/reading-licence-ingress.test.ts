import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../../config/index.js', async original => {
  const source = await original<typeof import('../../../config/index.js')>();
  return { ...source, config: new Proxy(source.config, { get(target, key) {
    return key === 'plot' ? { baseUrl: 'http://plot.test', authToken: 'local-test' } : Reflect.get(target, key);
  } }) };
});
import { GraphStateIngressSchema, parseRequestExtensions } from '../../boundary/request-extensions.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { applyAndValidateMutation } from '../../tools/handlers/d1-shared/apply-graph-mutation.js';
import { applyPatchOperations } from '../../../orchestrator/patch-applier.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { DraftGraphInput } from '../../../schemas/assist.js';
import { createPLoTClient } from '../../../orchestrator/plot-client.js';

const FORGED = {
  operation: 'product' as const,
  factor_ids: ['price', 'subscribers'],
  stated_in_brief: false,
  reading_licence: 'olumi_reading',
  addends: ['churn-loss'],
};

function graph() {
  return {
    nodes: [
      { id: 'price', kind: 'factor' as const, label: 'Pro plan price' },
      { id: 'subscribers', kind: 'factor' as const, label: 'Pro paying subscribers' },
      { id: 'mrr', kind: 'goal' as const, label: 'MRR', nonlinear_identity: structuredClone(FORGED) },
    ],
    edges: [],
    goal_node_id: 'mrr',
  };
}

function goalIdentity(value: unknown): Record<string, unknown> | undefined {
  const nodes = (value as { nodes: Array<Record<string, unknown>> }).nodes;
  return nodes.find(n => n.id === 'mrr')?.nonlinear_identity as Record<string, unknown> | undefined;
}

function assertCannotReachPlot(value: unknown) {
  const identity = goalIdentity(value);
  expect(identity?.reading_licence).toBeUndefined();
  expect(identity?.addends).toBeUndefined();
}

describe('GR2 DL condition 2 — client stamps have no authority at graph ingress', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('graph register/import: the permissive shared ingress removes forged wire-only fields', () => {
    const raw = graph();
    const ingress = GraphStateIngressSchema.parse(raw);
    assertCannotReachPlot(ingress);
    expect(goalIdentity(ingress)).toEqual({ operation: 'product', factor_ids: ['price', 'subscribers'], stated_in_brief: false });
    expect(goalIdentity(raw)).toEqual(FORGED);
  });

  it.each(['reading_licence', 'addends'] as const)('graph ingress strips client %s even when the other wire-only field is absent', key => {
    const raw = graph();
    const identity = goalIdentity(raw)!;
    delete identity[key === 'reading_licence' ? 'addends' : 'reading_licence'];
    const ingress = GraphStateIngressSchema.parse(raw);
    assertCannotReachPlot(ingress);
    expect(goalIdentity(ingress)).toEqual({ operation: 'product', factor_ids: ['price', 'subscribers'], stated_in_brief: false });
  });

  it('permissive legacy data and options mirrors cannot preserve a client stamp', () => {
    const raw = {
      ...graph(),
      nodes: [{ id: 'mrr', kind: 'goal', label: 'MRR', data: { nonlinear_identity: structuredClone(FORGED) } }],
      options: [{ id: 'raise', label: 'Raise', data: { nonlinear_identity: structuredClone(FORGED) } }],
    };
    const ingress = GraphStateIngressSchema.parse(raw);
    const clean = { operation: 'product', factor_ids: ['price', 'subscribers'], stated_in_brief: false };
    expect((ingress.nodes[0].data as { nonlinear_identity: unknown }).nonlinear_identity).toEqual(clean);
    expect(((ingress.options![0] as { data: { nonlinear_identity: unknown } }).data).nonlinear_identity).toEqual(clean);
    expect(raw.nodes[0].data.nonlinear_identity).toEqual(FORGED);
  });

  it('turn graph_state: the real request-extension reader removes the client licence', () => {
    const result = parseRequestExtensions({ graph_state: graph() }, 'gr2-forged-turn');
    expect(result.ok).toBe(true);
    if (result.ok) assertCannotReachPlot(result.value.graphState);
  });

  it('version restore/import: parsed graph and persisted postimage both strip the stamp', () => {
    const imported = GraphStateIngressSchema.parse(graph());
    assertCannotReachPlot(imported);
    assertCannotReachPlot(projectGraphForPersistence(imported, { source: 'version_restore' }));
  });

  it('draft previous_graph: the public draft input strips a forged refinement seed', () => {
    const input = DraftGraphInput.parse({ brief: 'Should we raise the Pro plan price next year?', previous_graph: graph() });
    assertCannotReachPlot(input.previous_graph);
  });

  it('draft/persistence: a generated graph cannot persist the outbound authority', () => {
    const raw = graph();
    const stored = projectGraphForPersistence(raw, { source: 'draft_graph' });
    assertCannotReachPlot(stored);
    expect(goalIdentity(raw)).toEqual(FORGED);
  });

  it.each(['update_node', 'add_node'] as const)('graph patch %s: injected identity loses wire authority before a candidate is consumed', op => {
    const base = graph();
    delete (base.nodes[2] as { nonlinear_identity?: unknown }).nonlinear_identity;
    if (op === 'add_node') base.nodes = base.nodes.filter(n => n.id !== 'mrr');
    const patched = applyPatchOperations(GraphV3.parse(base), [{
      op, path: 'mrr', value: { kind: 'goal', label: 'MRR', nonlinear_identity: structuredClone(FORGED) },
    }]);
    assertCannotReachPlot(patched);
    assertCannotReachPlot(projectGraphForPersistence(patched, { source: 'edit_graph' }));
  });

  it('graph apply/D1: canonical NodeV3 strips a forged identity during both parses', () => {
    const applied = applyAndValidateMutation(graph(), clone => {
      (clone.nodes.find(n => n.id === 'mrr') as unknown as Record<string, unknown>).nonlinear_identity = structuredClone(FORGED);
      return { before: null, after: null };
    });
    assertCannotReachPlot(applied.mutatedGraph);
  });

  it('graph apply/D1 options mirror: persistence strips the passthrough mirror too', () => {
    const raw = { ...graph(), options: [{ id: 'raise', label: 'Raise', nonlinear_identity: structuredClone(FORGED) }] };
    const applied = applyAndValidateMutation(raw, () => ({ before: null, after: null }));
    const stored = projectGraphForPersistence(applied.mutatedGraph, { source: 'd1_apply' });
    const option = (stored.options as Array<Record<string, unknown>>)[0];
    expect((option.nonlinear_identity as Record<string, unknown> | undefined)?.reading_licence).toBeUndefined();
    expect((option.nonlinear_identity as Record<string, unknown> | undefined)?.addends).toBeUndefined();
  });

  it('copy/stored load: strict NodeV3 drops both forged keys even in pre-existing stored bytes', () => {
    const copiedStoredBytes = graph();
    const parsed = GraphV3.parse(copiedStoredBytes);
    assertCannotReachPlot(parsed);
    expect(goalIdentity(parsed)).toBeUndefined();
    expect(goalIdentity(copiedStoredBytes)).toEqual(FORGED);
  });

  it('graph patch validation: actual PLoT fetch strips forged graph and operation values', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 501 }));
    vi.stubGlobal('fetch', fetch);
    const raw = { graph: graph(), operations: [{ op: 'update_node', path: 'mrr', value: { nonlinear_identity: structuredClone(FORGED) } }] };
    await createPLoTClient()!.validatePatch(raw, 'gr2-forged-patch', { retryPolicy: 'no_retry' });
    expect(fetch).toHaveBeenCalledTimes(1);
    const wire = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    assertCannotReachPlot(wire.graph);
    expect(wire.operations[0].value.nonlinear_identity.reading_licence).toBeUndefined();
    expect(wire.operations[0].value.nonlinear_identity.addends).toBeUndefined();
    expect(goalIdentity(raw.graph)).toEqual(FORGED);
  });
});
