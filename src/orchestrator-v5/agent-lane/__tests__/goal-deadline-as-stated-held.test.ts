/**
 * ⭐ PJ-E-A2 part 2 (MG #72 5867208469 T2; Canonical owns the shape, 5867397963) — THE DEADLINE AS THE BRIEF STATES IT.
 *
 * "by Q3" is no month count (that would need a year and a fiscal calendar: inventing), so journey E's deadline had no home
 * on the model and the first open question could not say it is held. `NodeV3.goal_deadline_as_stated` holds the brief's
 * own words, verbatim, at most 60 characters. Exactly the G1 contract (`goal-stated-attrs-held.test.ts`): written only by
 * construction (MG fills it), kept by every writer, OUT of the analysis hash, IN the identity hash, CEE-owned (no producer
 * may set it), and a malformed stored value is absence, never a refused graph.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../utils/telemetry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/telemetry.js')>();
  return { ...actual, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } };
});

import { GraphV3, NodeV3 } from '../../../schemas/cee-v3.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { computeGraphIdentityHash } from '../../context/graph-identity.js';
import { applyEdgeStrengthEdit } from '../../system-events/edge-strength-edit.js';
import { applyFactorValueEdit } from '../../system-events/factor-value-edit.js';
import { applyOptionInterventionEdit } from '../../system-events/option-intervention-edit.js';
import { applyStructuralDelete } from '../../system-events/structural-delete.js';
import { mergeAppliedGraphForPersistence } from '../../handlers/edit-graph-dispatch.js';
import { refereeMutation } from '../../graph-management/referee.js';
import { PIPELINE_OWNED_FIELD } from '../../graph-management/reason-codes.js';
import { PIPELINE_OWNED_ROOTS, stripPipelineOwnedFromAddOperations } from '../../graph-management/field-safety.js';
import { buildReadyGraph, frameFor, hashOf, makeEnvelope } from '../../graph-management/__tests__/fixtures.js';

type Rec = Record<string, unknown>;

const SERVED = (JSON.parse(readFileSync(new URL('../../__tests__/fixtures/register-ui-null-stamp.served-319dde1.json', import.meta.url), 'utf8')) as { graph: Rec }).graph;
const DEADLINE = 'by Q3';
function storedWithDeadline(): Rec {
  const g = structuredClone(SERVED);
  for (const n of g.nodes as Rec[]) if (n.kind === 'goal') Object.assign(n, { goal_deadline_as_stated: DEADLINE, goal_direction: '>=' });
  return projectGraphForPersistence(g) as Rec;
}
const goalOf = (g: Rec): Rec => (g.nodes as Rec[]).find((n) => n.kind === 'goal')!;

describe('the schema holds the deadline verbatim (at most 60 characters)', () => {
  it('⭐ RED: a parsed goal keeps "by Q3" exactly as written', () => {
    expect(goalOf(GraphV3.parse(storedWithDeadline()) as Rec).goal_deadline_as_stated).toBe(DEADLINE);
    expect(NodeV3.parse({ id: 'g', kind: 'goal', label: 'G', goal_deadline_as_stated: 'within the next 12 months' }).goal_deadline_as_stated)
      .toBe('within the next 12 months');
  });
});

describe('every writer keeps it (the served saved example, real writers)', () => {
  const STORED = storedWithDeadline();
  const TARGET = 'fac_adoption_friction';
  const LINK = { from: 'fac_adoption_friction', to: 'out_bottom_up_growth' } as const;

  it('PRECONDITION: the persisted form keeps it, and is a fixed point', () => {
    expect(goalOf(STORED).goal_deadline_as_stated).toBe(DEADLINE);
    expect(projectGraphForPersistence(STORED)).toBe(STORED);
  });

  it('⭐ a value write keeps it', async () => {
    const event = { kind: 'factor_value_edit', target_id: TARGET, value: 0.5 };
    const payload = { kind: 'system_event', turn_id: 'turn-value', scenario_id: 'scn-1', stage: 'analyse', event };
    const r = await applyFactorValueEdit({ payload, event, requestId: 'req-value', persistedGraph: structuredClone(STORED), priorFacts: [] } as never);
    expect(r.kind).toBe('mutated');
    expect(goalOf(projectGraphForPersistence((r as { mutatedGraph: Rec }).mutatedGraph) as Rec).goal_deadline_as_stated).toBe(DEADLINE);
  });

  it('⭐ a link confirm keeps it', async () => {
    const stored = (STORED.edges as Rec[]).find((e) => e.from === LINK.from && e.to === LINK.to)!;
    const mean = (stored.strength as { mean: number }).mean;
    const event = { kind: 'edge_strength_edit', ...LINK, magnitude: Math.abs(mean), direction_intent: 'preserve',
      expected: { mean, effect_direction: stored.effect_direction }, intent: 'confirm_current' };
    const payload = { kind: 'system_event', turn_id: 'turn-confirm', scenario_id: 'scn-1', stage: 'analyse', event };
    const r = await applyEdgeStrengthEdit({ payload, event, requestId: 'req-confirm', persistedGraph: structuredClone(STORED) } as never);
    expect(r.kind, JSON.stringify((r as { reason?: unknown }).reason ?? null)).toBe('mutated');
    expect(goalOf(projectGraphForPersistence((r as { mutatedGraph: Rec }).mutatedGraph) as Rec).goal_deadline_as_stated).toBe(DEADLINE);
  });

  it('⭐ an edit merge (rename of an unrelated node) keeps it', () => {
    const parsed = GraphV3.parse(structuredClone(STORED));
    const renamed = { ...parsed, nodes: parsed.nodes.map((n) => (n.id === TARGET ? { ...n, label: 'Adoption friction (renamed)' } : n)) };
    const merged = mergeAppliedGraphForPersistence({
      appliedGraph: renamed, persistedBase: STORED, ingressBase: STORED as never, requestId: 'req-edit', scenarioId: 'scn-1',
    });
    expect(goalOf(merged as Rec).goal_deadline_as_stated).toBe(DEADLINE);
  });

  it('⭐ a structural delete of an unrelated factor keeps it', () => {
    const event = { kind: 'structural_delete', removed_node_ids: ['fac_enterprise_revenue_risk'], removed_edges: [],
      base_graph_hash: computeAnalysisAffectingGraphHash(STORED as never) };
    const payload = { kind: 'system_event', scenario_id: '11111111-2222-3333-4444-555555555555', turn_id: 'turn-delete', stage: 'frame', event };
    const r = applyStructuralDelete({ payload, event, requestId: 'req-delete', persistedGraph: structuredClone(STORED) } as never);
    expect(r.kind, JSON.stringify((r as { reason?: unknown }).reason ?? null)).toBe('mutated');
    expect(goalOf((r as { mutatedGraph: Rec }).mutatedGraph).goal_deadline_as_stated).toBe(DEADLINE);
  });

  it('⭐ an option-level write keeps it', () => {
    const c = applyOptionInterventionEdit({ persistedGraph: STORED, optionId: 'opt_hybrid', factorId: 'fac_market_competition', modelValue: 0.3,
      expectedGraphHash: computeAnalysisAffectingGraphHash(STORED as never)!, scenarioId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      turnId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', requestId: 'req-level', freshness: 'none', hasExistingAnalysis: false } as never);
    expect(c.kind, JSON.stringify(c)).toBe('candidate');
    expect(goalOf((c as { graph: Rec }).graph).goal_deadline_as_stated).toBe(DEADLINE);
  });
});

describe('the two hashes: out of the analysis hash, in the identity hash', () => {
  it('a deadline-only change keeps the analysis hash and moves the identity hash', () => {
    const base = storedWithDeadline();
    const before = GraphV3.parse(base) as Rec;
    const after = GraphV3.parse(projectGraphForPersistence({
      ...base, nodes: (base.nodes as Rec[]).map((n) => (n.kind === 'goal' ? { ...n, goal_deadline_as_stated: 'by the end of Q4' } : n)),
    })) as Rec;
    expect(goalOf(after).goal_deadline_as_stated, 'premise: the change survived the persisted form').toBe('by the end of Q4');
    expect(computeAnalysisAffectingGraphHash(after as never)).toBe(computeAnalysisAffectingGraphHash(before as never));
    expect(computeGraphIdentityHash(after as never)?.value).not.toBe(computeGraphIdentityHash(before as never)?.value);
  });
});

describe('J2: no producer may set it', () => {
  const G = buildReadyGraph();
  const nodeUpdate = (field: string, to: unknown) => refereeMutation(
    makeEnvelope('update_node_field', { node_id: 'g-profit', field, from: null, to }, { base_graph_hash: hashOf(G) }),
    G,
    frameFor(G),
  );

  it('⭐ RED: a direct update_node_field write is refused PIPELINE_OWNED_FIELD', () => {
    expect(PIPELINE_OWNED_ROOTS.has('goal_deadline_as_stated')).toBe(true);
    const v = nodeUpdate('goal_deadline_as_stated', 'by Q1');
    expect(v.verdict).toBe('rejected');
    expect(v.blocker?.code).toBe(PIPELINE_OWNED_FIELD);
  });

  it('⭐ RED: carried on an add_node value, it is STRIPPED (the add lands without it)', () => {
    const ops = [{ op: 'add_node', path: 'g-new', value: { id: 'g-new', kind: 'goal', label: 'G', goal_deadline_as_stated: 'by Q3' } }];
    const { operations, strippedKeyShapes } = stripPipelineOwnedFromAddOperations(ops);
    expect(operations[0]!.value).toStrictEqual({ id: 'g-new', kind: 'goal', label: 'G' });
    expect(strippedKeyShapes).toStrictEqual(['goal_deadline_as_stated']);
  });
});

describe('a malformed stored value is absence (tolerant read), never a refused graph', () => {
  it.each([['x'.repeat(61)], [''], ['   '], [12], [null], [['by Q3']]])('goal_deadline_as_stated %j is dropped; the goal stays', (bad) => {
    const g = storedWithDeadline();
    goalOf(g).goal_deadline_as_stated = bad;
    const parsed = GraphV3.parse(projectGraphForPersistence(g)) as Rec;
    expect(goalOf(parsed).goal_deadline_as_stated).toBeUndefined();
    expect(goalOf(parsed).goal_direction).toBe('>=');
  });

  it('CONTROL: exactly 60 characters is held', () => {
    const g = storedWithDeadline();
    goalOf(g).goal_deadline_as_stated = 'y'.repeat(60);
    expect(goalOf(GraphV3.parse(projectGraphForPersistence(g)) as Rec).goal_deadline_as_stated).toBe('y'.repeat(60));
  });
});
