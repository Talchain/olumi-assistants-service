/**
 * ⭐ RT-18 boundary 1 (DL 0df0e1 ruling (a′); Science #87 6008791322): the level card keeps the user's own "of what".
 *
 * Served (red team 19, fresh dental guest d2821553 @ c175e908): "About 8% of appointments are no-shows today." was carded as
 * "8%" on a goal kept in "%", so "appointments" was lost. The red team's later answer "…0.05 percentage points of
 * appointments" then met "Is … a change in no-shows?", and their "Yes" restated the same figure and was refused again.
 *
 * THE RULE: on a goal kept in a bare %, the user's "N% of D" is kept as the goal's `unit_reading` {unit: "% of D",
 * source: user_stated, source_quote} — a READING: no value, level, target, unit or cap moves. The link-effect binder reads D
 * from it (`levelDenominatorOf`, the ONE function; U3 reads it too).
 *
 * THE PATH: the Agent's real `dispatchTool` → `createAgentCapabilities` → `authorise_change` → the REAL `/graph/register` route
 * (Fastify inject) over a stateful session store double, with the REAL analysis and identity hashes → reload from the store;
 * the PLoT boundary through the REAL run loader and the REAL `run_analysis` handler, PLoT faked.
 * FIXTURE: the served graph at the level step (`served-dental-fresh-before-level-c175e908.json`).
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
import { levelDenominatorOf, linkEffectTheUserStated, linkEffectFigureNotAChange, ownUnitsOf } from '../stated-by-user.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../build-turn-context.js';
import { createRunAnalysisHandler } from '../../tools/handlers/run-analysis.js';
import type { HandlerInvocation } from '../../tools/registry.js';
import type { PLoTClient } from '../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../orchestrator/types.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';
import { linkEffectEndUnits } from '../../system-events/link-effect-edit.js';
import { prepareLinkEffectUnitReadings } from '../../system-events/link-effect-unit-reading.js';
import { nodeUnitOf } from '../../../orchestrator/context/placeholder-parts.js';

type Node = { id: string; kind: string; label: string; observed_state?: Record<string, unknown>; unit_reading?: unknown } & Record<string, unknown>;
type Graph = { nodes: Node[]; edges: unknown[] } & Record<string, unknown>;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const SERVED = (JSON.parse(readFileSync(new URL('./fixtures/served-dental-fresh-before-level-c175e908.json', import.meta.url), 'utf8')) as { graph: Graph }).graph;
const SCENARIO = '550e8400-e29b-41d4-a716-4466554400d2';
const OWNER = '0f8a1b2c-3d4e-4f50-9a6b-7c8d9e0f1a2c';
const GOAL = 'no_shows';
const SAID = 'About 8% of appointments are no-shows today.';
const LEVEL = { goal_label: 'no-shows', value: 8, unit: '%', user_stated: true };
const A1 = 'Through fee-related patient dissatisfaction, each £1 rise in the missed-appointment fee raises no-shows by about 0.05 percentage points of appointments.';
const goalOf = (g: Graph): Node => g.nodes.find((n) => n.id === GOAL)!;

const apps: FastifyInstance[] = [];
async function harness(initial: Graph, userText: string) {
  const row = { graph: clone(initial) as unknown };
  const appends: unknown[] = [];
  const store = {
    append: vi.fn(async (write: { graph: unknown }) => { appends.push(clone(write.graph)); row.graph = clone(write.graph); return { id: `turn-${appends.length}` }; }),
    loadGraph: vi.fn(async () => clone(row.graph)),
    loadGraphAndBriefText: vi.fn(async () => ({ graph: clone(row.graph), briefText: null })),
    ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
    getScenarioOwner: vi.fn(async () => null),
    scenarioExists: vi.fn(async () => true),
    readCommittedTurn: vi.fn(async () => null),
    readMostRecentPendingActions: vi.fn(async () => []),
  };
  storeRef.value = store;
  const app = Fastify();
  apps.push(app);
  await registerRoute(app);
  await app.ready();
  const dispatch: InternalDispatch = async (path, body) => {
    if (path === `/assist/v1/scenarios/${SCENARIO}/graph`) {
      const g = clone(row.graph) as Graph;
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
  const ctx = { scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'req-level-unit', user_text: userText };
  const call = (name: string, args: Record<string, unknown>): Promise<ToolResult> => dispatchTool(name, JSON.stringify(args), ctx, caps);
  /** A RELOAD: the graph exactly as the store now returns it. */
  const reload = async (): Promise<Graph> => (await store.loadGraph()) as Graph;
  return { row, store, appends, call, proposals, reload };
}

beforeEach(() => { resolveUserIdentity.mockResolvedValue({ mode: 'verified', userId: OWNER }); });
afterEach(async () => { while (apps.length > 0) await apps.pop()!.close(); });

type Proposed = ToolResult & { proposal_id?: string; public_label?: string; refusal?: string; detail?: string };
async function proposeAndApprove(userText: string, initial: Graph = SERVED) {
  const h = await harness(initial, userText);
  const proposed = await h.call('propose_goal_current_level', LEVEL) as Proposed;
  expect(proposed.ok, JSON.stringify(proposed)).toBe(true);
  expect(h.appends, 'nothing is written before the user approves').toHaveLength(0);
  const op = h.proposals.get(String(proposed.proposal_id))!.operations[0]!;
  const applied = await h.call('authorise_change', { proposal_id: proposed.proposal_id }) as Proposed & { applied?: boolean };
  return { h, proposed, op, applied, stored: await h.reload() };
}

const READING = { unit: '% of appointments', source: 'user_stated', source_quote: SAID };

describe('the level card keeps the user\'s "of what" as the goal\'s reading, through the real commit door', () => {
  it('card: carries {unit: "% of appointments", user_stated, the sentence} and says it', async () => {
    const { proposed, op } = await proposeAndApprove(SAID);
    expect((op.value as { unit_reading?: unknown }).unit_reading).toStrictEqual(READING);
    expect(proposed.public_label).toContain('8%, read as % of appointments, as you wrote it');
  });

  it('approve → applied; RELOAD holds the reading, and the level, unit and cap exactly as before', async () => {
    const { applied, stored } = await proposeAndApprove(SAID);
    expect(applied.applied, JSON.stringify(applied)).toBe(true);
    expect(goalOf(stored).unit_reading).toStrictEqual(READING);
    const control = await proposeAndApprove('About 8% are no-shows today.');
    expect(control.applied.applied, JSON.stringify(control.applied)).toBe(true);
    expect(goalOf(control.stored)).not.toHaveProperty('unit_reading');
    // Nothing but the reading differs: the stored goal (level, unit "%", cap 100, threshold) is byte-identical.
    const { unit_reading: _r, ...rest } = goalOf(stored);
    expect(rest).toStrictEqual(goalOf(control.stored));
    expect(goalOf(stored).observed_state).toMatchObject({ unit: '%', cap: 100, raw_value: 8 });
    expect(computeAnalysisAffectingGraphHash(stored as never)).toBe(computeAnalysisAffectingGraphHash(control.stored as never));
  });

  it('the base after the figure, sentence-final ("No-shows are about 8% of appointments.") → the same reading', async () => {
    const said = 'No-shows are about 8% of appointments.';
    const { op } = await proposeAndApprove(said);
    expect((op.value as { unit_reading?: unknown }).unit_reading).toStrictEqual({ ...READING, source_quote: said });
  });

  it.each([
    ['no "of" in the user\'s words', 'About 8% are no-shows today.'],
    ['two bases for the same figure', 'About 8% of appointments and 8% of patients are no-shows.'],
    // Codex r1 (#2642): another figure's base is never borrowed, and D is never a predicate, a cut-off phrase or a count.
    ['the base belongs to another sentence\'s figure', 'No-shows are 8% today. 8% of patients are late.'],
    ['a predicate, not a base', 'About 8% of appointments become no-shows.'],
    ['a phrase with no demonstrated end', 'About 8% of appointments booked online this week are no-shows.'],
    ['a second, numbered base for the same figure', 'About 8% of appointments are no-shows, and 8% of our 200 patients are late.'],
    ['the sentence never names the goal', 'About 8% of appointments are missed.'],
    ['a time word inside the base', 'About 8% of appointments today are no-shows.'],
    ['a goal word inside the base', 'About 8% of no-show appointments are missed.'],
    // Codex r2 (#2642): the goal named elsewhere in the sentence is not the figure's owner; a tail may be a predicate.
    ['the goal named in another clause', 'No-shows are falling; 8% of patients are late.'],
    ['the goal named before, then a predicate', 'No-shows: 8% of patients miss appointments.'],
    ['the goal in the same clause but not the figure\'s owner', 'No-shows are falling and 8% of patients are late.'],
    ['the goal before, then more than one word of base', 'No-shows are about 8% of patients missing slots.'],
    ['a linking verb before, but not after the goal', 'Late patients are about 8% of appointments.'],
  ])('twin: %s → no reading carried or written', async (_n, said) => {
    const { op, applied, stored } = await proposeAndApprove(said);
    expect(op.value as Record<string, unknown>).not.toHaveProperty('unit_reading');
    expect(applied.applied, JSON.stringify(applied)).toBe(true);
    expect(goalOf(stored)).not.toHaveProperty('unit_reading');
  });

  it('race: a reading of the user\'s lands after the card (outside the analysis hash) → apply writes nothing', async () => {
    const h = await harness(SERVED, SAID);
    const proposed = await h.call('propose_goal_current_level', LEVEL) as Proposed;
    expect(proposed.ok, JSON.stringify(proposed)).toBe(true);
    const raced = await h.reload();
    goalOf(raced).unit_reading = { unit: '% of patients', source: 'user_stated', source_quote: 'About 9% of patients miss.' };
    expect(computeAnalysisAffectingGraphHash(raced as never)).toBe(computeAnalysisAffectingGraphHash(SERVED as never));
    h.row.graph = clone(raced);
    const applied = await h.call('authorise_change', { proposal_id: proposed.proposal_id }) as Proposed & { applied?: boolean; detail?: string };
    expect(applied.applied, JSON.stringify(applied)).not.toBe(true);
    expect(applied.detail).toContain('How "no-shows" is read changed after this was prepared');
    expect(h.appends).toHaveLength(0);
    expect(goalOf(await h.reload()).unit_reading).toStrictEqual(goalOf(raced).unit_reading);
  });

  it('a goal kept in "percentage points" (no level share) never takes a reading (Codex r1 P1: the link writer reads it)', async () => {
    const pp = clone(SERVED);
    goalOf(pp).goal_threshold_unit = 'percentage points';
    const h = await harness(pp, SAID);
    const r = await h.call('propose_goal_current_level', LEVEL) as Proposed;
    if (r.ok) expect(h.proposals.get(String(r.proposal_id))!.operations[0]!.value as Record<string, unknown>).not.toHaveProperty('unit_reading');
    else expect(r).not.toHaveProperty('proposal_id');
  });

  it('a goal kept in "%" off the 100 frame (target 5, cap 200) never takes a reading (Codex r2 P1: the link writer reads it)', async () => {
    const wide = clone(SERVED);
    Object.assign(goalOf(wide), { goal_threshold_raw: 5, goal_threshold_cap: 200, goal_threshold: 0.025, goal_threshold_frame: 'level' });
    const h = await harness(wide, SAID);
    const r = await h.call('propose_goal_current_level', LEVEL) as Proposed;
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(h.proposals.get(String(r.proposal_id))!.operations[0]!.value as Record<string, unknown>).not.toHaveProperty('unit_reading');
  });

  it('a different reading the user gave earlier is never replaced: unit_mismatch, nothing prepared', async () => {
    const held = clone(SERVED);
    goalOf(held).unit_reading = { unit: '% of patients', source: 'user_stated', source_quote: 'About 9% of patients miss.' };
    const h = await harness(held, SAID);
    const r = await h.call('propose_goal_current_level', LEVEL) as Proposed;
    expect(r.ok, JSON.stringify(r)).toBe(false);
    expect(r.refusal).toBe('unit_mismatch');
    expect(h.appends).toHaveLength(0);
  });
});

describe('the binder reads D from the reading (levelDenominatorOf, the ONE function)', () => {
  it('after the card: the red team\'s A1 binds on "Missed-appointment fee" → "no-shows"; before it, the ask is never a yes/no', async () => {
    const { stored } = await proposeAndApprove(SAID);
    const control = await proposeAndApprove('About 8% are no-shows today.');
    expect(levelDenominatorOf(goalOf(stored))).toEqual(['appointments']);
    expect(levelDenominatorOf(goalOf(control.stored))).toEqual([]);
    const effect = { amount: 0.05, amount_unit: 'percentage points', per_source_change: 1, per_source_change_unit: '£ per missed appointment' };
    const ends = { source: 'Missed-appointment fee', target: 'no-shows' };
    const scope = (g: Graph) => ({ quantities: g.nodes.filter((n) => n.kind !== 'option' && n.kind !== 'decision').map((n) => n.label),
      link_selected: false, target_units: ownUnitsOf(goalOf(g)) });
    expect(linkEffectTheUserStated(A1, effect, ends, scope(stored))).toBeNull();
    expect(linkEffectTheUserStated(A1, effect, ends, scope(control.stored))).toBe('figure_of_another_quantity');
    const ask = linkEffectFigureNotAChange(A1, effect, ends, ownUnitsOf(goalOf(control.stored)))?.question;
    expect(ask).toBe('What is that as a change in “no-shows”? 0.05 percentage points of appointments reads as a figure for appointments.');
  });
});

describe('the CLASS (DL condition 3): every other reader of the goal\'s unit reads the same with and without the reading', () => {
  it('for every link into the goal: linkEffectEndUnits, prepareLinkEffectUnitReadings and nodeUnitOf are byte-identical', async () => {
    const { stored } = await proposeAndApprove(SAID);
    const without = clone(stored);
    delete goalOf(without).unit_reading;
    const into = (stored.edges as { from: string; to: string }[]).filter((e) => e.to === GOAL);
    expect(into.length, 'the goal has links into it').toBeGreaterThan(0);
    const effect = { amount: 0.05, amount_unit: 'percentage points', per_source_change: 1, per_source_change_unit: '£' };
    for (const e of into) {
      expect(JSON.stringify(linkEffectEndUnits(stored, e.from, e.to))).toBe(JSON.stringify(linkEffectEndUnits(without, e.from, e.to)));
      expect(linkEffectEndUnits(stored, e.from, e.to), `${e.from} → ${e.to} is read`).not.toBeNull();
      for (const quote of [A1, 'A £1 rise raises no-shows by about 0.05%.']) {
        expect(JSON.stringify(prepareLinkEffectUnitReadings(stored, e.from, e.to, effect, quote)))
          .toBe(JSON.stringify(prepareLinkEffectUnitReadings(without, e.from, e.to, effect, quote)));
      }
    }
    expect(nodeUnitOf(stored.nodes)(GOAL)).toBe('%');
    expect(nodeUnitOf(without.nodes)(GOAL)).toBe('%');
  });
});

describe('levelDenominatorOf: the user\'s reading first, else the stored unit; never Olumi\'s (Science 6008791322 (2))', () => {
  it.each([
    ['the user\'s reading beats a stored denominator', { unit_reading: { unit: '% of appointments', source: 'user_stated', source_quote: 'q' }, observed_state: { unit: '% of bookings' } }, ['appointments']],
    ['an Olumi reading is never the user\'s', { unit_reading: { unit: '% of appointments', source: 'olumi_reading', source_quote: 'q' }, observed_state: { unit: '% of bookings' } }, ['bookings']],
    ['a bare % with no reading has none', { observed_state: { unit: '%' }, goal_threshold_unit: '%' }, []],
  ])('%s', (_n, node, want) => {
    expect(levelDenominatorOf(node)).toEqual(want);
  });
});

describe('PLoT BOUNDARY — the reading moves no number (Science 6008791322 (1); DL condition 1)', () => {
  async function plotRequest(graph: Graph): Promise<string> {
    const h = await harness(graph, '');
    const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO, 'req-load', h.store as never);
    const run = vi.fn(async (_request: unknown) => ({
      meta: { seed_used: 1, n_samples: 1, response_hash: 'sha256:s' }, results: [], response_hash: 'sha256:t', analysis_status: 'completed',
    }) as unknown as V2RunResponseEnvelope);
    const handler = createRunAnalysisHandler({ plotClient: { run, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient, scenarioReader: vi.fn(async () => snapshot) });
    await handler({
      context: {
        stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {}, messages: [],
        session_id: SCENARIO, request_id: 'req-run', budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 },
        prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null,
      },
      payload: makeMessagePayload({ turn_id: 't-run', scenario_id: SCENARIO, message: 'run analysis', turn_class: 'decide', stage: 'analyse' }),
      requestId: 'req-run', signal: new AbortController().signal, orientationText: '',
    } as unknown as HandlerInvocation);
    expect(run, 'PLoT was called exactly once').toHaveBeenCalledTimes(1);
    return JSON.stringify(run.mock.calls[0]![0]);
  }

  it('the approved graph WITH the reading sends PLoT the same request as without it, but for that one key PLoT never reads', async () => {
    const { stored } = await proposeAndApprove(SAID);
    const without = clone(stored);
    delete goalOf(without).unit_reading;
    const withReading = JSON.parse(await plotRequest(stored)) as { graph: Graph };
    // The ONE difference, bound by identity: the goal node passes its reading through. PLoT staging 4550e30f has no reader of
    // `unit_reading` (0 references repo-wide; contrast `observed_state`: 265 in src), so no figure it computes can move.
    expect(goalOf(withReading.graph).unit_reading).toStrictEqual(READING);
    delete goalOf(withReading.graph).unit_reading;
    expect(JSON.stringify(withReading)).toBe(await plotRequest(without));
  });

  it('CONTRAST: the same "% of appointments" written into the level\'s own unit DOES change what PLoT receives', async () => {
    const { stored } = await proposeAndApprove(SAID);
    const literal = clone(stored);
    delete goalOf(literal).unit_reading;
    goalOf(literal).observed_state = { ...goalOf(literal).observed_state, unit: '% of appointments' };
    expect(await plotRequest(literal)).not.toBe(await plotRequest(stored));
  });
});
