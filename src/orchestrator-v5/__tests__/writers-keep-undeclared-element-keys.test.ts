/**
 * ⭐ A WRITER THAT REBUILDS FROM A STRICT PARSE KEEPS WHAT IT DOES NOT OWN
 * (writer audit 2026-09-27, #70 5854387709).
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
import { withUndeclaredElementKeysFrom } from '../tools/handlers/d1-shared/undeclared-element-keys.js';

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

describe('writers keep the per-node / per-edge keys they do not own', () => {
  it('PRECONDITION: the stored saved example stamps every node, and the stamp is undeclared', () => {
    expect(nodes(STORED).length).toBeGreaterThan(10);
    expect(nodes(STORED).every((n) => n.starterId === 'pricing-model')).toBe(true);
    expect('starterId' in GraphV3.shape.nodes.element.shape).toBe(false);
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

  it('the edit merge keeps undeclared keys, while the writer still owns the declared ones', () => {
    const parsed = GraphV3.parse(structuredClone(STORED));
    const renamed = { ...parsed, nodes: parsed.nodes.map((n) => (n.id === TARGET ? { ...n, label: 'Adoption friction (renamed)' } : n)) };
    const merged = mergeAppliedGraphForPersistence({
      appliedGraph: renamed, persistedBase: STORED, ingressBase: STORED as never, requestId: 'req-edit', scenarioId: 'scn-1',
    });
    expect(node(merged, TARGET).label).toBe('Adoption friction (renamed)');
    expect(nodes(merged).every((n) => n.starterId === 'pricing-model')).toBe(true);
  });

  it('CONTRAST: a removed node is not resurrected, and a declared key the writer dropped stays dropped', () => {
    const storedNode = { id: 'a', kind: 'factor', label: 'A', provenance: 'user_stated', starterId: 'x' };
    const out = withUndeclaredElementKeysFrom(
      { nodes: [storedNode, { id: 'gone', kind: 'factor', label: 'Gone', starterId: 'x' }], edges: [] },
      [{ id: 'a', kind: 'factor', label: 'A' }],
      [],
    );
    expect(out.nodes).toEqual([{ id: 'a', kind: 'factor', label: 'A', starterId: 'x' }]);
  });
});
