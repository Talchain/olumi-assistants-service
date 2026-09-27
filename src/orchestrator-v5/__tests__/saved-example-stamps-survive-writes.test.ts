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
import { normaliseAbsenceOnly, projectGraphForPersistence } from '../persisted-graph-projection.js';
import { applyEdgeStrengthEdit } from '../system-events/edge-strength-edit.js';
import { applyFactorValueEdit } from '../system-events/factor-value-edit.js';
import { applyOptionInterventionEdit, factorValuesPostimageIsScoped, optionInterventionPostimageIsScoped } from '../system-events/option-intervention-edit.js';
import { applyStructuralDelete } from '../system-events/structural-delete.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
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

  /**
   * ⭐ `interventionKeys` IS AN INDEX OF THE OPTION'S CELLS, NOT A STAMP (#2084 review). Kept as an inert stamp, a
   * delete left it naming the deleted factor on 4/4 options, and the UI's reload proof, which reads it, declined the Run.
   */
  const options = (g: Rec) => nodes(g).filter((n) => n.kind === 'option');
  const indexOf = (o: Rec) => [...(o.interventionKeys as string[])].sort();
  const cellsOf = (o: Rec) => Object.keys((o.interventions ?? {}) as Rec).sort();

  it("⭐ a delete moves each option's index with its cells: none names the deleted factor", () => {
    const GONE = 'fac_enterprise_revenue_risk';
    expect(options(STORED).filter((o) => indexOf(o).includes(GONE)).length, 'not vacuous: the stored index names it').toBeGreaterThan(0);
    const event = { kind: 'structural_delete', removed_node_ids: [GONE], removed_edges: [],
      base_graph_hash: computeAnalysisAffectingGraphHash(STORED as never) };
    const payload = { kind: 'system_event', scenario_id: '11111111-2222-3333-4444-555555555555', turn_id: 'turn-delete', stage: 'frame', event };
    const r = applyStructuralDelete({ payload, event, requestId: 'req-delete', persistedGraph: structuredClone(STORED) } as never);
    expect(r.kind, JSON.stringify((r as { reason?: unknown }).reason ?? null)).toBe('mutated');
    const after = (r as { mutatedGraph: Rec }).mutatedGraph;
    expect(options(after).length).toBe(options(STORED).length);
    for (const o of options(after)) expect(indexOf(o), String(o.id)).toEqual(cellsOf(o));
  });

  it('⭐ a level that adds a cell commits (the scope guard admits the index moving with it), and the index names the new cell', () => {
    const g = projectGraphForPersistence({ ...GraphV3.parse({
      nodes: [
        { id: 'goal', kind: 'goal', label: 'Revenue' },
        { id: 'decision', kind: 'decision', label: 'Pricing' },
        { id: 'option', kind: 'option', label: 'Cohort test', starterId: 'pricing-model', interventionKeys: ['churn'],
          interventions: { churn: { value: 0.2, source: 'user_specified', target_match: { node_id: 'churn', match_type: 'exact_id', confidence: 'high' } } } },
        { id: 'price', kind: 'factor', label: 'Price', category: 'controllable', observed_state: { value: 0.25 } },
        { id: 'churn', kind: 'factor', label: 'Churn', observed_state: { value: 0.1 } },
      ],
      edges: [['decision', 'option', 1], ['option', 'churn', 1], ['price', 'goal', 0.5], ['churn', 'goal', -0.5]].map(([from, to, mean]) => ({
        from, to, strength: { mean, std: 0.1 }, exists_probability: 1, effect_direction: (mean as number) < 0 ? 'negative' : 'positive',
      })),
    }), options: [] as unknown[] }) as Rec;
    expect(node(g, 'option').interventionKeys, 'premise: the index survives the parse and projection').toEqual(['churn']);
    const c = applyOptionInterventionEdit({ persistedGraph: g, optionId: 'option', factorId: 'price', modelValue: 0.27,
      expectedGraphHash: computeAnalysisAffectingGraphHash(g as never)!, scenarioId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      turnId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', requestId: 'req-level', freshness: 'none', hasExistingAnalysis: false } as never);
    expect(c.kind, JSON.stringify(c)).toBe('candidate');
    const after = (c as { graph: Rec }).graph;
    expect(indexOf(node(after, 'option'))).toEqual(['churn', 'price']);
    expect(node(after, 'option').starterId).toBe('pricing-model');
    // CONTRAST: the guard admits the index only as its cells' re-derivation, never a rewrite the level did not imply.
    const target = { optionId: 'option', factorId: 'price', modelValue: 0.27 };
    const link = { from: 'option', to: 'price' };
    expect(optionInterventionPostimageIsScoped(g, after, target, link)).toBe(true);
    const tampered = structuredClone(after);
    node(tampered, 'option').interventionKeys = ['churn', 'price', 'invented'];
    expect(optionInterventionPostimageIsScoped(g, tampered, target, link)).toBe(false);
  });

  it('a repeated key is a stale index, never "in step": it is re-derived, and the guard refuses it', () => {
    const g = structuredClone(STORED);
    const opt = options(g)[0]!;
    const cells = cellsOf(opt);
    expect(cells.length, 'not vacuous: the option has two or more cells').toBeGreaterThan(1);
    opt.interventionKeys = cells.map(() => cells[0]!);
    expect(indexOf(node(projectGraphForPersistence(g) as Rec, opt.id as string))).toEqual(cells);
  });

  /**
   * ⚠ LEGACY BYTES (#2084 re-review, major): before this PR, staging's own option-level writer added a cell and KEPT the
   * index, so saved examples are already stored with a stale one (served pricing: 3 keys against 4 cells). The only drift
   * is the derived index, so every write must still commit on them, exactly as it does on staging.
   */
  const legacy = () => {
    const g = structuredClone(STORED);
    const stale = options(g).find((o) => o.id !== 'opt_hybrid' && cellsOf(o).length > 1)!;
    stale.interventionKeys = cellsOf(stale).slice(0, -1);
    return { g, staleId: stale.id as string };
  };

  it('⭐ LEGACY: an option-level write commits on a graph stored with a stale index, and the commit brings every index into step', () => {
    const { g, staleId } = legacy();
    expect(projectGraphForPersistence(g), 'premise: the stored bytes are not the persisted form').not.toEqual(g);
    const c = applyOptionInterventionEdit({ persistedGraph: g, optionId: 'opt_hybrid', factorId: 'fac_market_competition', modelValue: 0.3,
      expectedGraphHash: computeAnalysisAffectingGraphHash(g as never)!, scenarioId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      turnId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', requestId: 'req-legacy', freshness: 'none', hasExistingAnalysis: false } as never);
    expect(c.kind, JSON.stringify(c)).toBe('candidate');
    const after = (c as { graph: Rec }).graph;
    for (const o of options(after)) expect(indexOf(o), String(o.id)).toEqual(cellsOf(o));
    expect(indexOf(node(after, staleId))).toEqual(cellsOf(node(after, staleId)));
  });

  it('⭐ LEGACY: a value write and a link confirm on it are admitted by their stored-bytes guards', async () => {
    const { g } = legacy();
    const event = { kind: 'factor_value_edit', target_id: TARGET, value: 0.5 };
    const payload = { kind: 'system_event', turn_id: 'turn-value', scenario_id: 'scn-1', stage: 'analyse', event };
    const r = await applyFactorValueEdit({ payload, event, requestId: 'req-value', persistedGraph: structuredClone(g), priorFacts: [] } as never);
    expect(r.kind).toBe('mutated');
    const after = projectGraphForPersistence((r as { mutatedGraph: Rec }).mutatedGraph) as Rec;
    expect(factorValuesPostimageIsScoped(g, after, [TARGET])).toBe(true);
    const stored = edgeOf(g, LINK.from, LINK.to);
    const mean = (stored.strength as { mean: number }).mean;
    const confirm = { kind: 'edge_strength_edit', ...LINK, magnitude: Math.abs(mean), direction_intent: 'preserve',
      expected: { mean, effect_direction: stored.effect_direction }, intent: 'confirm_current' };
    const c = await applyEdgeStrengthEdit({ payload: { ...payload, turn_id: 'turn-confirm', event: confirm }, event: confirm,
      requestId: 'req-confirm', persistedGraph: structuredClone(g) } as never);
    expect(c.kind, JSON.stringify((c as { reason?: unknown }).reason ?? null)).toBe('mutated');
  });

  const levelOn = (g: Rec, requestId: string) => applyOptionInterventionEdit({ persistedGraph: g, optionId: 'opt_hybrid',
    factorId: 'fac_market_competition', modelValue: 0.3, expectedGraphHash: computeAnalysisAffectingGraphHash(g as never)!,
    scenarioId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', turnId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', requestId,
    freshness: 'none', hasExistingAnalysis: false } as never);

  it("⭐ LEGACY NULLS (Runtime 5855308269, B1): a stored null the schema reads as absence does not refuse writes, as at base", () => {
    const g = structuredClone(STORED);
    nodes(g).find((n) => n.kind === 'goal')!.threshold_source = null;
    nodes(g)[0]!.starterId = null;
    expect(projectGraphForPersistence(g), 'premise: the nulls are drift from the persisted form').not.toEqual(g);
    const c = levelOn(g, 'req-legacy-null');
    expect(c.kind, JSON.stringify(c)).toBe('candidate');
    const after = (c as { graph: Rec }).graph;
    expect(Object.hasOwn(nodes(after).find((n) => n.kind === 'goal')!, 'threshold_source')).toBe(false);
  });

  it('CONTRAST: a base that needs a REAL repair (an option\'s data.interventions awaiting promotion) still refuses', () => {
    const { g } = legacy();
    const other = options(g).find((o) => o.id !== 'opt_hybrid')!;
    const factor = nodes(g).find((n) => n.kind === 'factor' && !Object.hasOwn((other.interventions ?? {}) as Rec, n.id as string))!;
    other.data = { interventions: { [factor.id as string]: 0.4 } };
    expect(projectGraphForPersistence(g), 'premise: the projection repairs this base').not.toEqual(normaliseAbsenceOnly(g));
    expect(levelOn(g, 'req-real-repair')).toEqual({ kind: 'refused', reason: 'unrelated_canonical_repair_required' });
  });

  it('a malformed (non-array) index is dropped as absence, never rebuilt: CEE does not mint UI state', () => {
    const g = structuredClone(STORED);
    const opt = options(g)[0]!;
    opt.interventionKeys = 'x';
    expect(Object.hasOwn(node(projectGraphForPersistence(g) as Rec, opt.id as string), 'interventionKeys')).toBe(false);
  });

  it('a graph whose index is in step is a fixed point of the persisted form (the stored-bytes guards accept it)', () => {
    expect(projectGraphForPersistence(STORED)).toBe(STORED);
    for (const o of options(STORED)) expect(indexOf(o), String(o.id)).toEqual(cellsOf(o));
  });

  it('a null stamp or index is absence: the persisted form drops it, so a re-parse matches the stored bytes', () => {
    const withNull = structuredClone(STORED);
    const [first] = nodes(withNull);
    const opt = options(withNull)[0]!;
    first!.starterId = null;
    opt.interventionKeys = null;
    const p = projectGraphForPersistence(withNull) as Rec;
    expect(Object.hasOwn(node(p, first!.id as string), 'starterId')).toBe(false);
    expect(Object.hasOwn(node(p, opt.id as string), 'interventionKeys')).toBe(false);
    expect(projectGraphForPersistence(p)).toBe(p);
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
