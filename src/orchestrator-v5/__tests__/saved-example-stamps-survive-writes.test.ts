/**
 * ⭐ A SAVED EXAMPLE'S STAMPS SURVIVE EVERY WRITE, SO ITS WRITES ARE NOT REFUSED
 * (writer audit 2026-09-27, #70 5854387709). Fixed by DECLARATION (cee-v3.ts `NodeV3`), the
 * doctrine `goal-target-stamp-survives-mutation.test.ts` pins — never by a passthrough.
 *
 * Served bytes: the pricing saved example as the UI registered it (`319dde1`), which
 * stores `starterId` / `starterTitle` on every node. `NodeV3` does not declare them,
 * so the first D1 value or link write after the register stripped them from EVERY
 * node, and the equality guards that compare a write with the stored bytes then
 * REFUSED legitimate writes: the Agent's approved value (`value_scope_mismatch`) and
 * the inspector's link confirm (`confirmation_would_change_non_provenance_state`).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/telemetry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/telemetry.js')>();
  return { ...actual, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } };
});

import { GraphV3 } from '../../schemas/cee-v3.js';
import { projectGraphForPersistence } from '../persisted-graph-projection.js';
import { applyEdgeStrengthEdit } from '../system-events/edge-strength-edit.js';
import { applyFactorValueEdit } from '../system-events/factor-value-edit.js';
import { factorValuesPostimageIsScoped } from '../system-events/option-intervention-edit.js';
import { mergeAppliedGraphForPersistence } from '../handlers/edit-graph-dispatch.js';
import { applyAndValidateMutation } from '../tools/handlers/d1-shared/apply-graph-mutation.js';
import { refereeMutation } from '../graph-management/referee.js';
import { PIPELINE_OWNED_FIELD } from '../graph-management/reason-codes.js';
import { buildReadyGraph, frameFor, hashOf, makeEnvelope } from '../graph-management/__tests__/fixtures.js';

type Rec = Record<string, unknown>;
const SERVED = (
  JSON.parse(
    readFileSync(new URL('./fixtures/register-ui-null-stamp.served-319dde1.json', import.meta.url), 'utf8'),
  ) as { graph: Rec }
).graph;
/** What CEE stores for that register: the persistence projection of the served body. */
const STORED = projectGraphForPersistence(SERVED) as Rec;
const nodes = (g: Rec) => g.nodes as Rec[];
const node = (g: Rec, id: string) => nodes(g).find((n) => n.id === id)!;
const edgeOf = (g: Rec, from: string, to: string) =>
  (g.edges as Rec[]).find((e) => e.from === from && e.to === to)!;
const TARGET = 'fac_adoption_friction';
const LINK = { from: 'fac_adoption_friction', to: 'out_bottom_up_growth' } as const;

describe("a saved example's stamps survive every write", () => {
  it('PRECONDITION: the stored saved example stamps every node', () => {
    expect(nodes(STORED).length).toBeGreaterThan(10);
    expect(nodes(STORED).every((n) => n.starterId === 'pricing-model')).toBe(true);
    expect(nodes(STORED).filter((n) => Array.isArray(n.interventionKeys)).length).toBeGreaterThan(0);
  });

  it("⭐ a value write keeps every node's stamp, and its postimage is scoped to the one factor it edited", async () => {
    const event = { kind: 'factor_value_edit', target_id: TARGET, value: 0.5 };
    const payload = { kind: 'system_event', turn_id: 'turn-value', scenario_id: 'scn-1', stage: 'analyse', event };
    const r = await applyFactorValueEdit({
      payload, event, requestId: 'req-value', persistedGraph: structuredClone(STORED), priorFacts: [],
    } as never);
    expect(r.kind).toBe('mutated');
    const after = projectGraphForPersistence((r as { mutatedGraph: Rec }).mutatedGraph) as Rec;
    expect(nodes(after).filter((n) => n.starterId !== 'pricing-model').map((n) => n.id)).toEqual([]);
    // The guard the Agent's approved value runs (`value_scope_mismatch` when false).
    expect(factorValuesPostimageIsScoped(STORED, after, [TARGET])).toBe(true);
  });

  it('⭐ a link confirm on the saved example is committed, not refused', async () => {
    const stored = edgeOf(STORED, LINK.from, LINK.to);
    const mean = (stored.strength as { mean: number }).mean;
    const event = {
      kind: 'edge_strength_edit', ...LINK, magnitude: Math.abs(mean), direction_intent: 'preserve',
      expected: { mean, effect_direction: stored.effect_direction }, intent: 'confirm_current',
    };
    const payload = { kind: 'system_event', turn_id: 'turn-confirm', scenario_id: 'scn-1', stage: 'analyse', event };
    const r = await applyEdgeStrengthEdit({ payload, event, requestId: 'req-confirm', persistedGraph: structuredClone(STORED) } as never);
    expect(r.kind, JSON.stringify((r as { reason?: unknown }).reason ?? null)).toBe('mutated');
  });

  it('the edit merge keeps the stamps, while the writer still owns the fields it edits', () => {
    const parsed = GraphV3.parse(structuredClone(STORED));
    const renamed = { ...parsed, nodes: parsed.nodes.map((n) => (n.id === TARGET ? { ...n, label: 'Adoption friction (renamed)' } : n)) };
    const merged = mergeAppliedGraphForPersistence({
      appliedGraph: renamed, persistedBase: STORED, ingressBase: STORED as never, requestId: 'req-edit', scenarioId: 'scn-1',
    });
    expect(node(merged, TARGET).label).toBe('Adoption friction (renamed)');
    expect(nodes(merged).every((n) => n.starterId === 'pricing-model')).toBe(true);
  });

  it('CONTRAST (the doctrine): a key NodeV3 does not declare is still stripped by a write', () => {
    const withJunk = structuredClone(STORED);
    nodes(withJunk)[0]!.not_a_declared_field = 'x';
    const { mutatedGraph } = applyAndValidateMutation(withJunk, (clone) => ({ before: null, after: clone.nodes.length }));
    expect(node(mutatedGraph as Rec, nodes(withJunk)[0]!.id as string).not_a_declared_field).toBeUndefined();
    expect(node(mutatedGraph as Rec, nodes(withJunk)[0]!.id as string).starterId).toBe('pricing-model');
  });
  it('no producer may SET a stamp: a model write naming one is refused as pipeline-owned (the J2 rule)', () => {
    const G = buildReadyGraph();
    for (const field of ['starterId', 'starterTitle', 'interventionKeys']) {
      const v = refereeMutation(
        makeEnvelope('update_node_field', { node_id: 'f-spend', field, from: null, to: 'x' }, { base_graph_hash: hashOf(G) }),
        G,
        frameFor(G),
      );
      expect(v.verdict, field).toBe('rejected');
      expect(v.blocker?.code, field).toBe(PIPELINE_OWNED_FIELD);
    }
  });
});
