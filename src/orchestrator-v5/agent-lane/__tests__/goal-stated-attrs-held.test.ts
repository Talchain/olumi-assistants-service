/**
 * ⭐ G1 — THE GOAL'S STATED DIRECTION, DEADLINE AND TARGET SOURCE ARE HELD (Canonical's first slice of the slice-A
 * mechanism "goal-stated-attrs-not-held" ×9; PJ-A2 rows 6–9, 12, 13, 18, 28, 29 in `pj-a2-work-frame.red.test.ts`).
 *
 * Before: admission recorded the direction and the deadline only as ledger "losses" (GraphV3 had no home for them)
 * and never stamped whose target it was, so a cold read had none of the three. Now `NodeV3` declares
 * `goal_direction` / `goal_horizon_months`, construction holds each ONLY when the brief attests it
 * (`holdStatedGoalAttributes`), every writer keeps them, and no producer may set them.
 *
 * This file carries the rows the acceptance does not: the attestation contrasts, the ledger and question wording,
 * survival through the real writers, the two hashes for BOTH fields, the J2 producer screen, and the tolerant read.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../utils/telemetry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/telemetry.js')>();
  return { ...actual, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } };
});

import type { CandidateModel } from '../admit-model.js';
import { buildCandidateSchema, buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { holdStatedGoalAttributes } from '../stated-by-user.js';
import { GraphV3, NodeV3 } from '../../../schemas/cee-v3.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { computeGraphIdentityHash } from '../../context/graph-identity.js';
import { applyEdgeStrengthEdit } from '../../system-events/edge-strength-edit.js';
import { applyFactorValueEdit } from '../../system-events/factor-value-edit.js';
import { applyOptionInterventionEdit, factorValuesPostimageIsScoped } from '../../system-events/option-intervention-edit.js';
import { applyStructuralDelete } from '../../system-events/structural-delete.js';
import { mergeAppliedGraphForPersistence } from '../../handlers/edit-graph-dispatch.js';
import { refereeMutation } from '../../graph-management/referee.js';
import { PIPELINE_OWNED_FIELD } from '../../graph-management/reason-codes.js';
import { PIPELINE_OWNED_ROOTS, stripPipelineOwnedFromAddOperations } from '../../graph-management/field-safety.js';
import { buildReadyGraph, frameFor, hashOf, makeEnvelope } from '../../graph-management/__tests__/fixtures.js';

type Rec = Record<string, unknown>;
const SCENARIO = '61616161-6161-4616-8616-616161616161';

/** Paul's Pricing A brief (export olumi-debug-17d1cd3a-20260927), the one PJ-A2 row 6 reads. */
const BRIEF = 'Given our goal of reaching £100k MRR within 12 months [Currently 75k] while keeping monthly churn under 4%, '
  + 'should we increase the Pro plan price from £49 to £59 per month with the next Pro feature release?';

function candidate(goal: Partial<CandidateModel['goal']> = {}): CandidateModel {
  return {
    goal: {
      metric: 'MRR', operator: '>=', target_stated: true, value: 100000, unit: 'GBP', horizon_months: 12,
      provenance: 'explicit', baseline_known: true, baseline_value: 75000, baseline_provenance: 'explicit', scope: null,
      ...goal,
    },
    constraints: [],
    options: [
      { label: 'Increase the Pro plan price to £59', provenance: 'explicit', is_status_quo: false, changes: ['Pro plan price'],
        interventions: [{ factor_label: 'Pro plan price', value: 59, value_kind: 'absolute', unit: 'GBP', provenance: 'explicit' }] },
      { label: 'Keep the Pro plan price at £49', provenance: 'explicit', is_status_quo: true, changes: ['Pro plan price'],
        interventions: [{ factor_label: 'Pro plan price', value: 49, value_kind: 'absolute', unit: 'GBP', provenance: 'explicit' }] },
    ],
    factors: [{ label: 'Pro plan price', role: 'controllable', baseline_known: true, baseline_value: 49, unit: 'GBP', provenance: 'explicit', plausible_max: 100 }],
    risks: [], outcomes: [],
    links: [{ from: 'Pro plan price', to: 'MRR', direction: 'positive', provenance: 'inferred', effect_amount: null, effect_per_source_change: null, effect_provenance: null }],
    identities: [], unknowns: [],
  } as unknown as CandidateModel;
}

async function build(brief: string, c: CandidateModel): Promise<{ result: Rec; goal: Rec }> {
  let stored: string | undefined;
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) {
      stored = JSON.stringify(GraphV3.parse(projectGraphForPersistence((body as { graph: unknown }).graph)));
      return { status: 200, json: { registered: true, model_version: { version_number: 1 } } };
    }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: null } };
  };
  const call: CallStructuredModel = async () => ({ text: JSON.stringify(c) });
  const result = await buildModelFromBrief(SCENARIO, brief, dispatch, call) as Rec;
  expect(result.ok, JSON.stringify(result)).toBe(true);
  expect(stored, 'the build registered a graph').toBeDefined();
  const cold = GraphV3.parse(JSON.parse(stored!));
  const goals = cold.nodes.filter((n) => n.kind === 'goal');
  expect(goals).toHaveLength(1);
  return { result, goal: goals[0] as Rec };
}

const said = (r: Rec): string => ((r.not_represented ?? []) as string[]).join(' · ');
const questions = (r: Rec): string[] => (r.open_questions ?? []) as string[];

describe('construction holds what the brief states on the goal, and only that', () => {
  it('⭐ RED: the stated direction, deadline and target source are held on the registered goal', async () => {
    const { goal } = await build(BRIEF, candidate());
    expect(goal.goal_direction).toBe('>=');
    expect(goal.goal_horizon_months).toBe(12);
    expect(goal.threshold_source).toBe('brief_extraction');
    expect(goal.goal_threshold_raw, 'the held target is the one the source names').toBe(100000);
  });

  // DL #72 5862282849 (journey A `pj-20260928T023301Z`, CEE 79b69f8): this drafter held MRR in `£k/month` (target raw
  // 100, today 75, cap 125). The brief's "£100k" is 100,000, so the unscaled 100 never matched it: the goal lost its
  // `threshold_source` (and so its direction) on every turn. The £k unit's own letter scales it back to what was written.
  it('⭐ RED: a goal the drafter holds in £k/month keeps its brief source and direction (the unit\'s k is applied)', async () => {
    const { goal } = await build(BRIEF, candidate({ value: 100, unit: '£k/month', baseline_value: 75 }));
    expect(goal.goal_threshold_raw).toBe(100);
    expect(goal.goal_threshold_unit).toBe('£k/month');
    expect(goal.threshold_source).toBe('brief_extraction');
    expect(goal.goal_direction).toBe('>=');
  });

  it('CONTRAST: in £k/month, a target the brief does not write (£120k) still gets no source and no direction', async () => {
    const { goal } = await build(BRIEF, candidate({ value: 120, unit: '£k/month', baseline_value: 75 }));
    expect(goal.goal_threshold_raw).toBe(120);
    expect(Object.hasOwn(goal, 'threshold_source')).toBe(false);
    expect(Object.hasOwn(goal, 'goal_direction')).toBe(false);
  });

  it('⭐ what the goal holds is no longer said as a loss, and the deadline question says it is held', async () => {
    const { result } = await build(BRIEF, candidate());
    expect(said(result)).not.toMatch(/12-month horizon|nowhere to put it/);
    expect(said(result)).not.toMatch(/floor from a ceiling/);
    expect(questions(result)).toContain('Does "MRR" get there within 12 months? The model holds the deadline; no result answers that yet.');
    expect(questions(result).join(' ')).not.toMatch(/holds no deadline/);
  });

  it('a hyphenated "12-month" deadline is held too', async () => {
    const { goal } = await build(BRIEF.replace('within 12 months', 'on a 12-month horizon'), candidate());
    expect(goal.goal_horizon_months).toBe(12);
  });

  it('CONTRAST: a deadline the brief does not write is NOT held — the loss is said and the question says so', async () => {
    const { goal, result } = await build(BRIEF.replace(' within 12 months', ''), candidate());
    expect(Object.hasOwn(goal, 'goal_horizon_months')).toBe(false);
    expect(said(result)).toMatch(/12-month horizon/);
    expect(questions(result)).toContain('Does "MRR" get there within 12 months? The model holds no deadline yet, so no result answers that.');
    // The target is still the brief's, so its source and direction are still held.
    expect(goal.threshold_source).toBe('brief_extraction');
    expect(goal.goal_direction).toBe('>=');
  });

  it('⭐ CONTRAST: "12 subscribers" never grounds a 12-month deadline the drafter proposed (PJ-A2 row 25\'s class)', async () => {
    const brief = 'We have £75k MRR and aim for £100k MRR. We have 12 subscribers. Should we increase the Pro plan price from £49 to £59?';
    const { goal, result } = await build(brief, candidate());
    expect(Object.hasOwn(goal, 'goal_horizon_months')).toBe(false);
    expect(said(result)).toMatch(/12-month horizon/);
  });

  it('CONTRAST: a deadline written only in words is under-claimed (literal "N months" only), never guessed', async () => {
    const { goal } = await build(BRIEF.replace('within 12 months', 'within twelve months'), candidate());
    expect(Object.hasOwn(goal, 'goal_horizon_months')).toBe(false);
  });

  it('CONTRAST: a target the brief does not write gets no source and no direction; the direction loss is said', async () => {
    const { goal, result } = await build(BRIEF, candidate({ value: 120000 }));
    expect(goal.goal_threshold_raw).toBe(120000);
    expect(Object.hasOwn(goal, 'threshold_source')).toBe(false);
    expect(Object.hasOwn(goal, 'goal_direction')).toBe(false);
    expect(said(result)).toMatch(/floor from a ceiling/);
    // The deadline is independent of the target: still written, still held.
    expect(goal.goal_horizon_months).toBe(12);
  });

  it('CONTRAST: a goal the drafter did not mark explicit gets no source and no direction', async () => {
    const { goal } = await build(BRIEF, candidate({ provenance: 'inferred' }));
    expect(Object.hasOwn(goal, 'threshold_source')).toBe(false);
    expect(Object.hasOwn(goal, 'goal_direction')).toBe(false);
  });

  it('CONTRAST: a direction-only goal (no stated number) holds no target source and no direction', async () => {
    const { goal } = await build(BRIEF, candidate({ target_stated: false, value: null }));
    expect(Object.hasOwn(goal, 'goal_threshold_raw')).toBe(false);
    expect(Object.hasOwn(goal, 'threshold_source')).toBe(false);
    expect(Object.hasOwn(goal, 'goal_direction')).toBe(false);
  });

  it('the rule touches the goal node only, and a non-positive or fractional horizon is never held', () => {
    const nodes = [{ id: 'g', kind: 'goal', goal_threshold_raw: 100000 }, { id: 'f', kind: 'factor' }];
    const goal = { operator: '>=', horizon_months: 12, provenance: 'explicit', unit: 'GBP' };
    const { nodes: out } = holdStatedGoalAttributes(nodes, goal, BRIEF);
    expect(out[1]).toBe(nodes[1]);
    for (const months of [0, -12, 1.5]) {
      const r = holdStatedGoalAttributes(nodes, { ...goal, horizon_months: months }, `${BRIEF} ${months} months`);
      expect(r.held.horizon, String(months)).toBe(false);
    }
  });

  it("the stored comparator's values are the candidate contract's own (derived, not a second list)", () => {
    const schema = buildCandidateSchema() as { properties: { goal: { anyOf?: unknown[]; properties?: Rec } } };
    const goalSchema = (schema.properties.goal.properties
      ?? (schema.properties.goal.anyOf as { properties?: Rec }[]).find((p) => p.properties !== undefined)!.properties)!;
    const candidateOps = [...((goalSchema.operator as { enum: string[] }).enum)].sort();
    const stored = [...(NodeV3.shape.goal_direction.removeCatch().unwrap().options as string[])].sort();
    expect(stored).toEqual(candidateOps);
  });
});

/** The served pricing saved example as CEE stores it, with the goal carrying G1's three attributes. */
const SERVED = (JSON.parse(readFileSync(new URL('../../__tests__/fixtures/register-ui-null-stamp.served-319dde1.json', import.meta.url), 'utf8')) as { graph: Rec }).graph;
function storedWithHeldGoal(): Rec {
  const g = structuredClone(SERVED);
  for (const n of g.nodes as Rec[]) {
    if (n.kind === 'goal') Object.assign(n, { goal_direction: '>=', goal_horizon_months: 12, threshold_source: 'brief_extraction' });
  }
  return projectGraphForPersistence(g) as Rec;
}
const goalOf = (g: Rec): Rec => (g.nodes as Rec[]).find((n) => n.kind === 'goal')!;
const HELD = { goal_direction: '>=', goal_horizon_months: 12, threshold_source: 'brief_extraction' };
const heldOn = (g: Rec) => ({ goal_direction: goalOf(g).goal_direction, goal_horizon_months: goalOf(g).goal_horizon_months, threshold_source: goalOf(g).threshold_source });

describe('every writer keeps them (the served saved example, real writers)', () => {
  const STORED = storedWithHeldGoal();
  const TARGET = 'fac_adoption_friction';
  const LINK = { from: 'fac_adoption_friction', to: 'out_bottom_up_growth' } as const;

  it('PRECONDITION: the persisted form keeps them, and is a fixed point (the stored-bytes guards accept it)', () => {
    expect(heldOn(STORED)).toEqual(HELD);
    expect(projectGraphForPersistence(STORED)).toBe(STORED);
  });

  it('⭐ a value write keeps them, and its postimage is still scoped to the one factor it edited', async () => {
    const event = { kind: 'factor_value_edit', target_id: TARGET, value: 0.5 };
    const payload = { kind: 'system_event', turn_id: 'turn-value', scenario_id: 'scn-1', stage: 'analyse', event };
    const r = await applyFactorValueEdit({ payload, event, requestId: 'req-value', persistedGraph: structuredClone(STORED), priorFacts: [] } as never);
    expect(r.kind).toBe('mutated');
    const after = projectGraphForPersistence((r as { mutatedGraph: Rec }).mutatedGraph) as Rec;
    expect(heldOn(after)).toEqual(HELD);
    expect(factorValuesPostimageIsScoped(STORED, after, [TARGET])).toBe(true);
  });

  it('⭐ a link confirm keeps them', async () => {
    const stored = (STORED.edges as Rec[]).find((e) => e.from === LINK.from && e.to === LINK.to)!;
    const mean = (stored.strength as { mean: number }).mean;
    const event = { kind: 'edge_strength_edit', ...LINK, magnitude: Math.abs(mean), direction_intent: 'preserve',
      expected: { mean, effect_direction: stored.effect_direction }, intent: 'confirm_current' };
    const payload = { kind: 'system_event', turn_id: 'turn-confirm', scenario_id: 'scn-1', stage: 'analyse', event };
    const r = await applyEdgeStrengthEdit({ payload, event, requestId: 'req-confirm', persistedGraph: structuredClone(STORED) } as never);
    expect(r.kind, JSON.stringify((r as { reason?: unknown }).reason ?? null)).toBe('mutated');
    expect(heldOn(projectGraphForPersistence((r as { mutatedGraph: Rec }).mutatedGraph) as Rec)).toEqual(HELD);
  });

  it('⭐ an edit merge (rename of an unrelated node) keeps them', () => {
    const parsed = GraphV3.parse(structuredClone(STORED));
    const renamed = { ...parsed, nodes: parsed.nodes.map((n) => (n.id === TARGET ? { ...n, label: 'Adoption friction (renamed)' } : n)) };
    const merged = mergeAppliedGraphForPersistence({
      appliedGraph: renamed, persistedBase: STORED, ingressBase: STORED as never, requestId: 'req-edit', scenarioId: 'scn-1',
    });
    expect(heldOn(merged as Rec)).toEqual(HELD);
  });

  it('⭐ a structural delete of an unrelated factor keeps them', () => {
    const event = { kind: 'structural_delete', removed_node_ids: ['fac_enterprise_revenue_risk'], removed_edges: [],
      base_graph_hash: computeAnalysisAffectingGraphHash(STORED as never) };
    const payload = { kind: 'system_event', scenario_id: '11111111-2222-3333-4444-555555555555', turn_id: 'turn-delete', stage: 'frame', event };
    const r = applyStructuralDelete({ payload, event, requestId: 'req-delete', persistedGraph: structuredClone(STORED) } as never);
    expect(r.kind, JSON.stringify((r as { reason?: unknown }).reason ?? null)).toBe('mutated');
    expect(heldOn((r as { mutatedGraph: Rec }).mutatedGraph)).toEqual(HELD);
  });

  it('⭐ an option-level write keeps them', () => {
    const c = applyOptionInterventionEdit({ persistedGraph: STORED, optionId: 'opt_hybrid', factorId: 'fac_market_competition', modelValue: 0.3,
      expectedGraphHash: computeAnalysisAffectingGraphHash(STORED as never)!, scenarioId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      turnId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', requestId: 'req-level', freshness: 'none', hasExistingAnalysis: false } as never);
    expect(c.kind, JSON.stringify(c)).toBe('candidate');
    expect(heldOn((c as { graph: Rec }).graph)).toEqual(HELD);
  });
});

describe('the two hashes: out of the analysis hash, in the identity hash (both fields)', () => {
  const base = storedWithHeldGoal();
  const withGoal = (patch: Rec): Rec => GraphV3.parse(projectGraphForPersistence({
    ...base, nodes: (base.nodes as Rec[]).map((n) => (n.kind === 'goal' ? { ...n, ...patch } : n)),
  })) as Rec;

  for (const [field, changed] of [['goal_horizon_months', 6]] as const) {
    it(`a ${field}-only change keeps the analysis hash and moves the identity hash`, () => {
      const before = GraphV3.parse(base) as Rec;
      const after = withGoal({ [field]: changed });
      expect(goalOf(after)[field], 'premise: the change survived the persisted form').toBe(changed);
      expect(computeAnalysisAffectingGraphHash(after as never)).toBe(computeAnalysisAffectingGraphHash(before as never));
      expect(computeGraphIdentityHash(after as never)?.value).not.toBe(computeGraphIdentityHash(before as never)?.value);
    });
  }

  // REVERSED by schemas 0.61.0's projection v2 (DL 5871412823 / AIQ 5871459631), adopted by CEE with v3: the held
  // comparator decides the direction the run sends, so a goal_direction-only change is a new analysis revision.
  it('a goal_direction-only change moves BOTH the analysis hash and the identity hash', () => {
    const before = GraphV3.parse(base) as Rec;
    const after = withGoal({ goal_direction: '<=' });
    expect(goalOf(after).goal_direction, 'premise: the change survived the persisted form').toBe('<=');
    expect(computeAnalysisAffectingGraphHash(after as never)).not.toBe(computeAnalysisAffectingGraphHash(before as never));
    expect(computeGraphIdentityHash(after as never)?.value).not.toBe(computeGraphIdentityHash(before as never)?.value);
  });

  it('CONTROL: a target change moves the analysis hash (the probe can see a goal field)', () => {
    const before = GraphV3.parse(base) as Rec;
    expect(computeAnalysisAffectingGraphHash(withGoal({ goal_threshold_raw: 120 }) as never))
      .not.toBe(computeAnalysisAffectingGraphHash(before as never));
  });
});

describe('J2: no producer may set them', () => {
  const G = buildReadyGraph();
  const nodeUpdate = (field: string, to: unknown) => refereeMutation(
    makeEnvelope('update_node_field', { node_id: 'g-profit', field, from: null, to }, { base_graph_hash: hashOf(G) }),
    G,
    frameFor(G),
  );

  it('⭐ RED: a direct update_node_field write of either is refused PIPELINE_OWNED_FIELD', () => {
    for (const [field, to] of [['goal_direction', '<='], ['goal_horizon_months', 6]] as const) {
      expect(PIPELINE_OWNED_ROOTS.has(field), field).toBe(true);
      const v = nodeUpdate(field, to);
      expect(v.verdict, field).toBe('rejected');
      expect(v.blocker?.code, field).toBe(PIPELINE_OWNED_FIELD);
    }
  });

  it('⭐ RED: smuggled as a segment of a granted root, it is refused', () => {
    const v = nodeUpdate('goal_constraints.goal_direction', '<');
    expect(v.verdict).toBe('rejected');
    expect(v.blocker?.code).toBe(PIPELINE_OWNED_FIELD);
  });

  it('⭐ RED: carried on an add_node value, both are STRIPPED (the add lands without them)', () => {
    const ops = [{ op: 'add_node', path: 'g-new', value: { id: 'g-new', kind: 'goal', label: 'G', goal_direction: '>=', goal_horizon_months: 12 } }];
    const { operations, strippedKeyShapes } = stripPipelineOwnedFromAddOperations(ops);
    expect(operations[0]!.value).toStrictEqual({ id: 'g-new', kind: 'goal', label: 'G' });
    expect(strippedKeyShapes).toStrictEqual(['goal_direction', 'goal_horizon_months']);
  });

  it('CONTRAST: a granted node field on the same goal is still writable', () => {
    const v = nodeUpdate('description', 'A note');
    expect(v.blocker?.code).not.toBe(PIPELINE_OWNED_FIELD);
    expect(v.verdict).not.toBe('rejected');
  });
});

describe('a malformed stored value is absence (tolerant read), never a refused graph', () => {
  it.each([[12.5], [-1], [0], ['12'], [null]])('goal_horizon_months %j is dropped; the goal and its target stay', (bad) => {
    const g = storedWithHeldGoal();
    goalOf(g).goal_horizon_months = bad;
    const parsed = GraphV3.parse(projectGraphForPersistence(g)) as Rec;
    expect(goalOf(parsed).goal_horizon_months).toBeUndefined();
    expect(JSON.stringify(goalOf(parsed)), 'the stored bytes carry no horizon').not.toContain('goal_horizon_months');
    expect(goalOf(parsed).goal_direction).toBe('>=');
    expect(goalOf(parsed).goal_threshold_raw).toBe(110);
  });

  it.each([['at least'], ['=='], [null]])('goal_direction %j is dropped', (bad) => {
    const g = storedWithHeldGoal();
    goalOf(g).goal_direction = bad;
    const parsed = GraphV3.parse(projectGraphForPersistence(g)) as Rec;
    expect(goalOf(parsed).goal_direction).toBeUndefined();
    expect(JSON.stringify(goalOf(parsed)), 'the stored bytes carry no direction').not.toContain('goal_direction');
    expect(goalOf(parsed).goal_horizon_months).toBe(12);
  });
});
