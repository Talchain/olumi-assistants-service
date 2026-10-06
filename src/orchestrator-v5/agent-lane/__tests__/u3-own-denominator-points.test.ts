/**
 * ⭐ U3a (Science d5 #87 6008156781; Integrator lease #87 6010017958; DL: U3a first, relative keeps asking until U3b earns
 * its carrier). On the dental "% of appointments" goal (the level card keeps the user's "of what": c0 #2642):
 *  (1) "X% of appointments" (the level's OWN denominator, `levelDenominatorOf`) is POINTS: no question; the card says
 *      points and the REAL door stores the points reading. A bare % still asks; "of no-shows" / "of today's rate" (a
 *      RELATIVE reading) still asks, honestly, until U3b.
 *  (2) The example never prints a new level equal to today's ("i.e. 8%" for 0.05% of 8%): up to 4 places, and the
 *      change itself is said.
 * THE PATH: c0's level card through the REAL `/graph/register` route (its harness), then the link effect through the REAL
 * proposer → card → Approve → `executeOptionInterventionBatch` → stored → reload.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../config/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../config/index.js')>();
  return { ...actual, config: { ...actual.config, auth: { ...actual.config.auth, requireUserJwt: false } } };
});
const { storeRef } = vi.hoisted(() => ({ storeRef: { value: null as unknown } }));
vi.mock('../../session/index.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getSessionStore: () => storeRef.value };
});
const { resolveUserIdentity } = vi.hoisted(() => ({ resolveUserIdentity: vi.fn() }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity };
});

import registerRoute from '../../../routes/assist.v1.scenario-graph-register.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { computeGraphIdentityHash } from '../../context/graph-identity.js';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { dispatchTool, type ToolResult } from '../runtime/agent-tools.js';
import { ProposalStore } from '../proposal.js';
import { levelDenominatorOf } from '../stated-by-user.js';
import { prepareLinkEffectUnitReadings } from '../../system-events/link-effect-unit-reading.js';
import { approvalChipsFor } from '../approval-chips.js';
import { executeOptionInterventionBatch } from '../../system-events/option-intervention-edit.js';
import type { CommitOptionLevelsInput, CommitOptionLevelsResult } from '../../system-events/dispatch.js';
import { createMockSessionStore, makeSessionTurnRow } from '../../../../tests/utils/mock-session-store.js';
import type { SessionTurnWrite } from '../../session/store.js';

type Rec = Record<string, any>;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const SERVED = (JSON.parse(readFileSync(new URL('./fixtures/served-dental-fresh-before-level-c175e908.json', import.meta.url), 'utf8')) as { graph: Rec }).graph;
const SCENARIO = '550e8400-e29b-41d4-a716-4466554400d2';
const OWNER = '0f8a1b2c-3d4e-4f50-9a6b-7c8d9e0f1a2c';
const GOAL = 'no_shows';
const SOURCE = 'rescheduling_convenience';
const LEVEL_SAID = 'About 8% of appointments are no-shows today.';
const goalOf = (g: Rec): Rec => g.nodes.find((n: Rec) => n.id === GOAL);
const linkOf = (g: Rec): Rec => g.edges.find((e: Rec) => e.from === SOURCE && e.to === GOAL);

const apps: FastifyInstance[] = [];
beforeEach(() => { resolveUserIdentity.mockResolvedValue({ mode: 'verified', userId: OWNER }); });
afterEach(async () => { while (apps.length > 0) await apps.pop()!.close(); });

/** c0's level card (#2642) through the REAL register route: the goal keeps "% of appointments" and the user's 8%. */
async function levelled(levelSaid = LEVEL_SAID): Promise<Rec> {
  const row = { graph: clone(SERVED) as unknown };
  const store = {
    append: vi.fn(async (write: { graph: unknown }) => { row.graph = clone(write.graph); return { id: 'turn-1' }; }),
    loadGraph: vi.fn(async () => clone(row.graph)),
    loadGraphAndBriefText: vi.fn(async () => ({ graph: clone(row.graph), briefText: null })),
    ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
    getScenarioOwner: vi.fn(async () => null),
    scenarioExists: vi.fn(async () => true),
    readCommittedTurn: vi.fn(async () => null),
    readMostRecentPendingActions: vi.fn(async () => []),
  };
  storeRef.value = store;
  const app = Fastify(); apps.push(app);
  await registerRoute(app); await app.ready();
  const dispatch: InternalDispatch = async (path, body) => {
    if (path === `/assist/v1/scenarios/${SCENARIO}/graph`) {
      const g = clone(row.graph) as Rec;
      return { status: 200, json: { graph: g, graph_hash: computeAnalysisAffectingGraphHash(g as never), graph_identity_hash: computeGraphIdentityHash(g as never) } };
    }
    if (path === `/assist/v1/scenarios/${SCENARIO}/graph/register`) {
      const res = await app.inject({ method: 'POST', url: path, payload: body as Record<string, unknown> });
      return { status: res.statusCode, json: res.json() as Record<string, unknown> };
    }
    return { status: 500, json: {} };
  };
  const proposals = new ProposalStore();
  const caps = createAgentCapabilities(dispatch, proposals);
  const ctx = { scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'req-u3-level', user_text: levelSaid };
  const call = (name: string, args: Record<string, unknown>): Promise<ToolResult> => dispatchTool(name, JSON.stringify(args), ctx, caps);
  const proposed = await call('propose_goal_current_level', { goal_label: 'no-shows', value: 8, unit: '%', user_stated: true }) as Rec;
  expect(proposed.ok, JSON.stringify(proposed)).toBe(true);
  const applied = await call('authorise_change', { proposal_id: proposed.proposal_id }) as Rec;
  expect(applied, JSON.stringify(applied)).toMatchObject({ ok: true, applied: true });
  return clone(row.graph) as Rec;
}

/** The link proposer, card, Approve and the REAL commit door over a serialised session store (the S5t world). */
function world(initial: Rec) {
  let graphJson = JSON.stringify(initial);
  const graph = () => JSON.parse(graphJson) as Rec;
  const proposals = new ProposalStore();
  const rows: { id: string; write: SessionTurnWrite }[] = [];
  const store = createMockSessionStore({
    loadGraph: async () => graph(),
    loadGraphAndBriefText: async () => ({ graph: graph(), briefText: null }),
    readExistingScenario: async () => ({ userId: null, graph: graph(), briefText: null, analysisInvalidatedAt: null }),
    readMostRecentPendingActions: async () => [],
    readAnalysisInvalidatedAt: async () => null,
    getScenarioOwner: async () => null,
    append: async (write) => {
      const stored = JSON.parse(JSON.stringify(write)) as SessionTurnWrite;
      const id = `u3-row-${rows.length + 1}`;
      rows.push({ id, write: stored });
      if (stored.graph !== undefined) graphJson = JSON.stringify(stored.graph);
      return { id };
    },
    readRecent: async () => rows.map(({ id, write }) => makeSessionTurnRow({ id, scenario_id: write.scenario_id,
      turn_id: write.turn_id, turn_class: write.turn_class, handler_id: write.handler_id,
      request_hash: write.request_hash, response_emitted: write.response_emitted,
      llm_calls_used: write.llm_calls_used, duration_ms: write.duration_ms })),
    readFactsWithTurnFor: async (ids) => rows.filter((row) => ids.includes(row.id)).flatMap(({ id, write }) =>
      write.handler_facts.map((fact) => ({ turn_id: id, fact_created_at: '2026-10-06T00:00:00.000Z', fact }))),
  });
  const commits: CommitOptionLevelsInput[] = [];
  const commitOptionLevels = async (input: CommitOptionLevelsInput): Promise<CommitOptionLevelsResult> => {
    commits.push(input);
    const out = await executeOptionInterventionBatch({ scenarioId: input.scenario_id, turnId: input.turn_id,
      requestId: 'u3-real-commit', requestHash: `u3:${input.turn_id}`, stage: 'frame',
      freshness: 'fresh', hasExistingAnalysis: false, expectedGraphHash: input.base_graph_hash, targets: [],
      ...(input.link_effect !== undefined ? { linkEffect: input.link_effect } : {}),
      ...(input.link_effects !== undefined ? { linkEffects: input.link_effects } : {}),
    }, store);
    if (out.kind === 'refused') return { status: 'refused', reason: out.reason };
    if (out.kind !== 'committed') throw new Error(`Real commit did not verify: ${JSON.stringify(out)}`);
    return { status: 'committed', graph_hash: out.analysisGraphHash, receipt: null, already_applied: false, committed_levels: [], links_resized: [] };
  };
  const dispatch: InternalDispatch = async (path) => {
    if (!path.endsWith('/graph')) throw new Error(`Unexpected dispatch: ${path}`);
    const read = graph();
    return { status: 200, json: { graph: read, graph_hash: computeAnalysisAffectingGraphHash(read as never) } };
  };
  return { caps: createAgentCapabilities(dispatch, proposals, undefined, 'full', undefined, { commitOptionLevels }), proposals, commits, graph };
}
const ctxSaying = (user_text: string) => ({ scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'u3', user_text });
const sentence = (tail: string) => `Each 10-point rise in rescheduling convenience lowers no-shows by about ${tail}`;
const args = (said: string, amount: number, amount_unit = '%') => ({ from_label: 'Rescheduling convenience', to_label: 'no-shows',
  amount: -amount, amount_unit, per_source_change: 10, per_source_change_unit: 'score out of 100', quote: said });

describe('U3a: "X% of {the level\'s own denominator}" is points; every other % reading still asks', () => {
  it('PRECONDITION: after the level card the goal holds the user\'s 8% and the denominator "appointments"', async () => {
    const g = await levelled();
    expect(levelDenominatorOf(goalOf(g))).toEqual(['appointments']);
    expect(goalOf(g).unit_reading).toMatchObject({ unit: '% of appointments', source: 'user_stated' });
  });

  it('RED + REAL DOOR: "0.5% of appointments" → no question; the card says points; Approve → door → reload stores points', async () => {
    const said = sentence('0.5% of appointments.');
    const w = world(await levelled());
    const r = await w.caps.proposeLinkEffect!(ctxSaying(said), args(said, 0.5)) as Rec;
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true, mutated: false });
    const card = approvalChipsFor([{ name: 'propose_link_effect', ok: true, mutated: false, proposal_id: String(r.proposal_id) }],
      (id) => ({ proposal: w.proposals.get(id), result: r as never }))[0]!;
    expect(card.detail).toContain('0.5 percentage points');
    const out = await w.caps.authoriseChange({ ...ctxSaying(card.message), typed_approval_of: String(r.proposal_id),
      typed_approval_words: card.message }, { proposal_id: String(r.proposal_id) }) as Rec;
    expect(out, JSON.stringify(out)).toMatchObject({ ok: true, applied: true });
    expect(w.commits).toHaveLength(1);
    const stored = linkOf(w.graph());
    expect(stored.provenance).toMatchObject({ magnitude: 'user_stated', source_quote: said });
    expect(stored.provenance.natural_effect).toMatchObject({ amount: -0.5, amount_unit: 'percentage points' });
  });

  it('determiners drop: "0.5% of all appointments" and "of our appointments" are the same points reading', async () => {
    for (const tail of ['0.5% of all appointments.', '0.5% of our appointments.']) {
      const said = sentence(tail);
      const w = world(await levelled());
      const r = await w.caps.proposeLinkEffect!(ctxSaying(said), args(said, 0.5)) as Rec;
      expect(r, `${tail} ${JSON.stringify(r)}`).toMatchObject({ ok: true, mutated: false });
      expect((w.proposals.get(String(r.proposal_id))!.operations[0]!.value as Rec).effect).toMatchObject({ amount_unit: 'percentage points' });
    }
  });

  it.each([
    ['a bare %', '0.5%.'],
    ['RELATIVE "of no-shows" (U3b: still asked, honestly)', '0.5% of no-shows.'],
    ['RELATIVE "of today\'s rate" (U3b: still asked)', '0.5% of today\'s rate.'],
    ['a superset ("appointments booked online")', '0.5% of appointments booked online.'],
    ['a phrase that runs on ("appointments 2 days out")', '0.5% of appointments 2 days out.'],
  ] as const)('CONTROL %s → a question, nothing prepared or written', async (_name, tail) => {
    // The binder (`figure_of_another_quantity`) or the unit door (`unit_mismatch`) asks first; either way one question and
    // nothing prepared. The door's own reading of these phrases is pinned on the door itself below.
    const said = sentence(tail);
    const w = world(await levelled());
    const r = await w.caps.proposeLinkEffect!(ctxSaying(said), args(said, 0.5)) as Rec;
    expect(r, JSON.stringify(r)).toMatchObject({ ok: false, mutated: false });
    expect(typeof r.question).toBe('string');
    expect(w.proposals.get(String(r.proposal_id))).toBeUndefined();
    expect(w.commits).toEqual([]);
  });

  it.each([
    ['the own denominator', '0.5% of appointments.', 'points'],
    ['"all" dropped', '0.5% of all appointments.', 'points'],
    ['a superset', '0.5% of appointments booked online.', 'ask'],
    ['a phrase that runs on', '0.5% of appointments 2 days out.', 'ask'],
    ['relative "of no-shows"', '0.5% of no-shows.', 'ask'],
    ['a bare %', '0.5%.', 'ask'],
  ] as const)('THE DOOR ITSELF (prepareLinkEffectUnitReadings): %s → %s', async (_name, tail, want) => {
    const g = await levelled();
    const said = sentence(tail);
    const effect = { amount: -0.5, amount_unit: '%', per_source_change: 10, per_source_change_unit: 'score out of 100' };
    const out = prepareLinkEffectUnitReadings(g, SOURCE, GOAL, effect, said);
    if (want === 'points') { expect(out.points_at_zero).toEqual([GOAL]); expect(out.ask).toBeUndefined(); }
    else { expect(out.points_at_zero).toBeUndefined(); expect(out.ask).toMatch(/^Is that a 0\.5-point fall in “no-shows”/); }
  });

  it('the bare-% question states the share as a change and never prints today\'s level as the new one', async () => {
    const said = sentence('0.5%.');
    const w = world(await levelled());
    const r = await w.caps.proposeLinkEffect!(ctxSaying(said), args(said, 0.5)) as Rec;
    expect(r.question).toBe('Is that a 0.5-point fall in “no-shows” (8% → 7.5%), or 0.5% of today’s 8% (a 0.04-point fall: 8% → 7.96%)?');
  });

  it('EXAMPLE (d5 (2)): 0.05% of today\'s 8% is "a 0.004-point rise: 8% → 8.004%", never "i.e. 8%"', async () => {
    const said = 'Each 10-point fall in rescheduling convenience raises no-shows by about 0.05%.';
    const w = world(await levelled());
    const r = await w.caps.proposeLinkEffect!(ctxSaying(said), { ...args(said, -0.05), per_source_change: -10 }) as Rec;
    expect(r.question).toBe('Is that a 0.05-point rise in “no-shows” (8% → 8.05%), or 0.05% of today’s 8% (a 0.004-point rise: 8% → 8.004%)?');
  });

  it('EXAMPLE: when even 4 places print today\'s level, only the change is said', async () => {
    const said = 'Each 10-point fall in rescheduling convenience raises no-shows by about 0.0001%.';
    const w = world(await levelled());
    const r = await w.caps.proposeLinkEffect!(ctxSaying(said), { ...args(said, -0.0001), per_source_change: -10 }) as Rec;
    expect(r.question).toBe('Is that a 0.0001-point rise in “no-shows” (8% → 8.0001%), or 0.0001% of today’s 8% (a 0.000008-point rise)?');
  });
});
