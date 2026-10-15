import { injectAsCeeWriter } from '../../../tests/utils/inject-as-cee-writer.js';
import { withScenarioRevision } from '../../../tests/utils/revision-store-double.js';
/**
 * ⭐ E5 — THE REAL REGISTER ROUTE STORES PAUL'S HIRING TIMES AS APPROVED.
 *
 * The hiring-times card says "set" only when the read-back holds every planned start (`hiringTimesHeld`). This spec is that
 * check's positive control on the AUTHORITATIVE path: Paul's model (admission → deadline → team time, as served), his
 * approved starts written by `withHiringTimes`, registered through the REAL `/graph/register` route over a stateful store
 * double with both CAS hashes:
 *   - the stored graph holds every start, figure, the second developer's own part and its link strength; a start given as
 *     one figure keeps std 0 at rest (identity-preserving ingress; floored only for compute);
 *   - CONTRAST: the route's own persistence projection made to drop one part's figures → still acknowledged, and the
 *     check refuses it.
 */
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config/index.js')>();
  return { ...actual, config: { ...actual.config, auth: { ...actual.config.auth, requireUserJwt: false } } };
});
const { storeRef, dropFigures } = vi.hoisted(() => ({ storeRef: { value: null as object | null }, dropFigures: { value: false } }));
vi.mock('../../orchestrator-v5/session/index.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getSessionStore: () => withScenarioRevision(storeRef.value!) };
});
const { resolveUserIdentity } = vi.hoisted(() => ({ resolveUserIdentity: vi.fn() }));
vi.mock('../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity };
});
// The CONTRAST only: the route's own projection drops the second developer's figures before it hashes and stores.
vi.mock('../../orchestrator-v5/persisted-graph-projection.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown> & { projectGraphForPersistence: (g: unknown, o: unknown) => unknown }>();
  return { ...actual, projectGraphForPersistence: (g: unknown, o: unknown) => {
    const out = actual.projectGraphForPersistence(g, o) as { nodes?: Record<string, any>[] };
    if (dropFigures.value) for (const n of out.nodes ?? []) if (n.id === 'event_capacity_2_start_2') delete n.observed_state.extra_share_by_date.figures;
    return out;
  } };
});

import registerRoute from '../assist.v1.scenario-graph-register.js';
import { GraphV3 } from '../../schemas/cee-v3.js';
import { projectGraphForPersistence } from '../../orchestrator-v5/persisted-graph-projection.js';
import { assignEntityRefs } from '../../orchestrator-v5/graph/entity-refs.js';
import { admitCandidateModel, type CandidateModel } from '../../orchestrator-v5/agent-lane/admit-model.js';
import { computeAnalysisAffectingGraphHash } from '../../orchestrator-v5/context/graph-hash.js';
import { computeGraphIdentityHash } from '../../orchestrator-v5/context/graph-identity.js';
import { withEventShareDate } from '../../orchestrator-v5/goal-target/event-by-date-model.js';
import { applyTeamShareEdit } from '../../orchestrator-v5/goal-target/team-share-write.js';
import { shareByDateGoalOf } from '../../orchestrator-v5/goal-target/goal-kind.js';
import { sharePartsForOption } from '../../orchestrator-v5/goal-target/share-by-date-run.js';
import { capacityPartsOf, hiringTimesHeld, olumiEstimateOf, planStarts, withHiringTimes, type ApprovedHiringTimes, type PlannedOption }
  from '../../orchestrator-v5/goal-target/hiring-times.js';

type Rec = Record<string, any>;
const SCENARIO = '4184e877-203c-462d-b5aa-0000000000e5';
const BRIEF = 'We need to decide whether to hire a Tech lead or two developers to boost productivity and meet our next feature-launch deadline.';
const DATE = '2027-04-12', REF = '2026-10-12', UNIT = '% of next feature launch';
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const plainGraph = (g: unknown): Rec => assignEntityRefs(projectGraphForPersistence(GraphV3.parse(g)), { nodes: [], edges: [] }).graph as Rec;
function paulsModel(): Rec {
  const c = { goal: { kind: 'event_by_date', deliverable: 'next feature launch', metric: 'next feature launch', operator: '>=', unit: UNIT,
    value: null, target_stated: false, frame: 'level', baseline_known: false, baseline_value: null, horizon_months: null, provenance: 'inferred' },
  options: [
    { label: 'Hire a Tech lead', provenance: 'explicit', added_capacity: { monthly_share_pct: 12, lead_months_low: 2, lead_months_high: 4 } },
    { label: 'Hire two developers', provenance: 'explicit', added_capacity: { monthly_share_pct: 20, lead_months_low: 2, lead_months_high: 4 } },
    { label: 'Carry on as now', provenance: 'ai_proposed', is_status_quo: true, added_capacity: null },
  ], factors: [], risks: [], outcomes: [], links: [], constraints: [], identities: [] } as unknown as CandidateModel;
  const a = admitCandidateModel(c, {}, BRIEF);
  const dated = plainGraph(withEventShareDate(plainGraph({ nodes: a.nodes, edges: a.edges }), DATE, REF));
  const written = applyTeamShareEdit(dated, { goal_id: 'event_goal', team_id: 'event_team', low_months: 6, high_months: 10,
    deadline: DATE, reference_date: REF } as never, computeAnalysisAffectingGraphHash(dated as never)!);
  if (written.kind !== 'mutated') throw new Error('team time not written');
  return plainGraph(written.mutatedGraph);
}
function plan(g: Rec, id: string, quotes: string[]): PlannedOption {
  const held = capacityPartsOf(g, id, 'event_goal'), estimate = olumiEstimateOf(held)!, p = planStarts(quotes, estimate, held.length);
  if (!('parts' in p)) throw new Error(JSON.stringify(p));
  return { option_id: id, label: g.nodes.find((n: Rec) => n.id === id).label, part_ids: held.map(n => n.id),
    expected: held.map(n => n.observed_state.extra_share_by_date), olumi_estimate: estimate, parts: p.parts, quotes };
}

async function register() {
  resolveUserIdentity.mockResolvedValue({ mode: 'off' });
  const before = paulsModel();
  const approval: ApprovedHiringTimes = { goal_id: 'event_goal', deadline: DATE, reference_date: REF, options: [
    plan(before, 'event_option_1', ['at least 3 months']), plan(before, 'event_option_2', ['within 2 months', 'another a month or so later'])] };
  const row = { graph: clone(before) as unknown };
  storeRef.value = {
    append: vi.fn(async (write: { graph: unknown }) => { row.graph = clone(write.graph); return { id: 'turn-1' }; }),
    loadGraph: vi.fn(async () => clone(row.graph)),
    loadGraphAndBriefText: vi.fn(async () => ({ graph: clone(row.graph), briefText: BRIEF })),
    ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
    getScenarioOwner: vi.fn(async () => null),
    scenarioExists: vi.fn(async () => true),
    readCommittedTurn: vi.fn(async () => null),
    readMostRecentPendingActions: vi.fn(async () => []),
  };
  const app = Fastify();
  await registerRoute(app);
  await app.ready();
  const r = await injectAsCeeWriter(app, { method: 'POST', url: `/assist/v1/scenarios/${SCENARIO}/graph/register`, payload: {
    graph: clone(withHiringTimes(before, approval)), expected_graph_hash: computeAnalysisAffectingGraphHash(before as never),
    expected_graph_identity_hash: computeGraphIdentityHash(before as never)?.value, operation_id: '0b6a8c1e-5e5e-4e5e-8e5e-00000000e5e5' } });
  await app.close();
  return { r, stored: row.graph as Rec, approval };
}

describe('the real register route stores the approved hiring times (E5)', () => {
  afterEach(() => { dropFigures.value = false; });

  it('acknowledged = stored; every start, figure and part is held; the share goal is still recognised', async () => {
    const { r, stored, approval } = await register();
    expect(r.statusCode, r.body.slice(0, 300)).toBe(200);
    expect((r.json() as { graph_identity_hash: { value: string } }).graph_identity_hash.value).toBe(computeGraphIdentityHash(stored as never)?.value);
    expect(hiringTimesHeld(stored, approval)).toBe(true);
    const second = stored.edges.find((e: Rec) => e.from === 'event_capacity_2_start_2' && e.to === 'event_goal').strength;
    expect(second.mean).toBeCloseTo(0.1 * (6 - 3), 12);
    expect(second.std).toBe(0);
    expect(shareByDateGoalOf(stored)?.team_part_id).toBe('event_team');
    expect(sharePartsForOption(stored, 'event_option_2')?.furtherExtras).toHaveLength(1);
  });

  it('CONTRAST: the route drops one part\'s figures before it acknowledges → acknowledged and stored agree, and the check refuses it', async () => {
    dropFigures.value = true;
    const { r, stored, approval } = await register();
    expect(r.statusCode, r.body.slice(0, 300)).toBe(200);
    expect(stored.nodes.find((n: Rec) => n.id === 'event_capacity_2_start_2').observed_state.extra_share_by_date.figures).toBeUndefined();
    expect(hiringTimesHeld(stored, approval)).toBe(false);
  });
});
