/**
 * ⛔ THE GOAL'S CURRENT LEVEL FROM CHAT, THROUGH THE REAL REGISTER ROUTE — a figure is recorded in the goal's
 * own unit or not at all, and never onto a target that moved after it was prepared.
 *
 * WHY (independent verify of row 14 at 68602637, DEFECT_FOUND): the chat path swapped the user's unit for the
 * goal's own. `{12000, 'USD'}` was labelled and stored as "12000 GBP MRR" with the user's stamp; `{12, '£k'}` was
 * stored as raw 12, baseline 0.00048 — 1000x too small, so P(MRR ≥ 20000) ≈ 0. `unitPhraseFamily` reads USD, $,
 * EUR and "GBP MRR" all as `currency` (no conflict), and '£k', 'subscribers' and '' as unrecognised (fail open).
 * An approval also landed after the goal moved to the delta frame or to another unit, because neither field is in
 * the analysis hash the proposal is bound to.
 *
 * THE PATH (the verifier's own harness): the Agent's real `dispatchTool` → `createAgentCapabilities` (real
 * `ProposalStore`) → `authorise_change` → the REAL `/graph/register` route (Fastify inject) over a stateful session
 * store double, with the REAL analysis and identity hashes → for the PLoT-boundary rows, the REAL run loader
 * (`loadScenarioSnapshotForRunAnalysis`) and the REAL `run_analysis` handler, PLoT faked.
 *
 * FIXTURE: Paul's stored graph `cbd15f83`. Goal `mrr`: target 20000 "GBP MRR", cap 25000, frame `level`, no
 * `observed_state`. Every assertion names the goal by id and binds the stamp by its literal source.
 */
import Fastify, { type FastifyInstance } from 'fastify';
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
import { canonicaliseLimitUnit } from '../admit-constraint.js';
import { USER_EDIT_SOURCE } from '../../../orchestrator/canonicalise-value-ops.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../build-turn-context.js';
import { AnalysisNotReadyError } from '../../tools/handlers/analysis-ready-core.js';
import { createRunAnalysisHandler } from '../../tools/handlers/run-analysis.js';
import type { HandlerInvocation } from '../../tools/registry.js';
import type { PLoTClient } from '../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../orchestrator/types.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';
import { PAUL_CBD15F83_UNLINKED_OPTION, paulCbd15f83Runnable, paulCbd15f83Stored } from './fixtures/paul-cbd15f83-runnable.js';

const TOOL = 'propose_goal_current_level';
const GOAL = 'mrr';
const CAP = 25000;
const SCENARIO = '550e8400-e29b-41d4-a716-4466554400c9';
const OWNER = '0f8a1b2c-3d4e-4f50-9a6b-7c8d9e0f1a2b';
const ctx = { scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'req-goal-real-route' };

type Node = { id: string; kind: string; label: string; observed_state?: Record<string, unknown> } & Record<string, unknown>;
type Graph = { nodes: Node[]; edges: unknown[]; goal_constraints?: unknown[] } & Record<string, unknown>;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const goalOf = (g: Graph): Node => g.nodes.find((n) => n.id === GOAL)!;

/** What the Agent passes for "Our current MRR is £12,000." after a brief that asked to reach £20k MRR. */
const T2 = { goal_label: 'MRR', value: 12000, unit: 'GBP', goal_is: 'at_least', user_stated: true };

/** A session store double that the REAL register route writes and the read below reads: one stored row. */
function world(initial: Graph) {
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
  };
  storeRef.value = store;
  return { row, appends, store };
}

const apps: FastifyInstance[] = [];
async function harness(initial: Graph) {
  const w = world(initial);
  const app = Fastify();
  apps.push(app);
  await registerRoute(app);
  await app.ready();
  const dispatch: InternalDispatch = async (path, body) => {
    if (path === `/assist/v1/scenarios/${SCENARIO}/graph`) {
      const g = clone(w.row.graph) as Graph;
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
  const call = (name: string, args: Record<string, unknown>): Promise<ToolResult> => dispatchTool(name, JSON.stringify(args), ctx, caps);
  const stored = (): Graph => w.row.graph as Graph;
  return { ...w, call, proposals, stored };
}

beforeEach(() => { resolveUserIdentity.mockResolvedValue({ mode: 'verified', userId: OWNER }); });
afterEach(async () => { while (apps.length > 0) await apps.pop()!.close(); });

type Proposed = ToolResult & { proposal_id?: string; public_label?: string; refusal?: string; detail?: string };

/** Propose, then approve; returns both results and what the register route stored. */
async function proposeAndApprove(args: Record<string, unknown>, initial: Graph = paulCbd15f83Stored()) {
  const h = await harness(initial);
  const proposed = await h.call(TOOL, args) as Proposed;
  expect(proposed.ok, JSON.stringify(proposed)).toBe(true);
  expect(h.appends, 'nothing is written before the user approves').toHaveLength(0);
  const applied = await h.call('authorise_change', { proposal_id: proposed.proposal_id });
  return { h, proposed, applied };
}

/** Refused with a plain reason: nothing proposed, nothing registered, the stored goal unchanged. */
async function refusedAndInert(args: Record<string, unknown>) {
  const initial = paulCbd15f83Stored();
  const h = await harness(initial);
  const r = await h.call(TOOL, args) as Proposed;
  expect(r.ok, JSON.stringify(r)).toBe(false);
  expect(r.mutated).toBe(false);
  expect(r).not.toHaveProperty('proposal_id');
  expect(h.proposals.outstanding(SCENARIO, null)).toEqual([]);
  expect(h.appends).toHaveLength(0);
  expect(goalOf(h.stored())).toStrictEqual(goalOf(initial));
  return r;
}

/** The #1840 shape on the goal's own cap, stamped as the user's chat figure. */
const levelOf = (raw: number, extra: Record<string, unknown> = {}) => ({
  value: raw / CAP, baseline: raw / CAP, unit: 'GBP MRR', source: USER_EDIT_SOURCE, raw_value: raw, cap: CAP, ...extra,
});

describe('BLOCKING — a figure in another currency is refused, never relabelled as the goal\'s own', () => {
  it.each([
    ['USD', 'USD'],
    ['$', '$'],
    ['EUR', 'EUR'],
    ['USD MRR', 'USD MRR'],
  ])('RED: 12000 %s on a GBP MRR goal → unit_mismatch naming both units; nothing prepared', async (unit, named) => {
    const r = await refusedAndInert({ ...T2, unit });
    expect(r.refusal).toBe('unit_mismatch');
    expect(r.detail).toContain(named);
    expect(r.detail).toContain('GBP MRR');
    // The plain reason says WHY: another currency, and no rate is applied.
    expect(r.detail).toContain('is not in the currency of "MRR"');
    expect(r.detail).toContain('No exchange rate is ever applied');
  });

  it.each([
    ['GBP ARR', 'GBP ARR'],
    ['GBP per year', 'GBP per year'],
    ['GBP/month', 'GBP/month'],
  ])('RED: 12000 %s — the goal\'s currency, another measure or period — → unit_mismatch; nothing prepared', async (unit, named) => {
    const r = await refusedAndInert({ ...T2, unit });
    expect(r.refusal).toBe('unit_mismatch');
    expect(r.detail).toContain(named);
    expect(r.detail).toContain('GBP MRR');
  });

  it.each([['£'], ['GBP'], ['GBP MRR'], ['£ MRR'], ['gbp mrr']])('CONTRAST: 12000 %s — the goal\'s own unit — is recorded as raw 12000', async (unit) => {
    const { h, applied } = await proposeAndApprove({ ...T2, unit });
    expect(applied.applied, JSON.stringify(applied)).toBe(true);
    expect(goalOf(h.stored()).observed_state).toStrictEqual(levelOf(12000));
  });
});

describe('BLOCKING — a magnitude suffix on the goal\'s currency is scaled exactly as a limit\'s is, and stamped', () => {
  it('RED: 12 £k → recorded as raw 12000 (baseline 0.48), with the M-rung\'s own normalisation stamp', async () => {
    const { h, proposed, applied } = await proposeAndApprove({ ...T2, value: 12, unit: '£k' });
    expect(applied.applied, JSON.stringify(applied)).toBe(true);
    const mRung = canonicaliseLimitUnit(12, '£k', { unit: 'GBP' });
    expect(mRung.value).toBe(12000);
    expect(mRung.provenance_unit_normalised).toStrictEqual({ rule: 'agent_lane_limit_magnitude_v1', original_value: 12, original_unit: '£k' });
    expect(goalOf(h.stored()).observed_state).toStrictEqual(levelOf(12000, { provenance_unit_normalised: mRung.provenance_unit_normalised }));
    // The approval shows the figure as the user gave it AND what it is recorded as — never a silent rescale.
    expect(proposed.public_label).toBe('Record the current level of "MRR" as your figure: 12 £k, which is 12000 GBP MRR (target 20000 GBP MRR)');
  });

  it('RED: 0.012 £m → raw 12000 (the M-rung\'s other suffix)', async () => {
    const { h, applied } = await proposeAndApprove({ ...T2, value: 0.012, unit: '£m' });
    expect(applied.applied, JSON.stringify(applied)).toBe(true);
    expect(goalOf(h.stored()).observed_state).toMatchObject({ raw_value: 12000, baseline: 12000 / CAP });
  });

  it('RED: a suffix the M-rung does not scale (£bn) is refused, never stored as the bare figure', async () => {
    const r = await refusedAndInert({ ...T2, value: 0.000012, unit: '£bn' });
    expect(r.refusal).toBe('unit_unrecognised');
    expect(r.detail).toContain('£bn');
    expect(r.detail).toContain('GBP MRR');
  });

  it('RED: a magnitude suffix on ANOTHER currency ($k) is refused', async () => {
    const r = await refusedAndInert({ ...T2, value: 12, unit: '$k' });
    expect(r.refusal).toBe('unit_unrecognised');
    expect(r.detail).toContain('$k');
    expect(r.detail).toContain('GBP MRR');
  });

  it('a scaled figure, then a new one given in full → the new record carries no rescale stamp from the old one', async () => {
    const { h, applied } = await proposeAndApprove({ ...T2, value: 12, unit: '£k' });
    expect(applied.applied, JSON.stringify(applied)).toBe(true);
    expect(goalOf(h.stored()).observed_state).toHaveProperty('provenance_unit_normalised');
    const revised = await h.call(TOOL, { ...T2, value: 13000 }) as Proposed;
    expect(revised.ok, JSON.stringify(revised)).toBe(true);
    expect(revised.public_label).toBe('Record the current level of "MRR" as your figure: 12000 GBP MRR → 13000 GBP (target 20000 GBP MRR)');
    const again = await h.call('authorise_change', { proposal_id: revised.proposal_id });
    expect(again.applied, JSON.stringify(again)).toBe(true);
    expect(goalOf(h.stored()).observed_state).toStrictEqual(levelOf(13000));
  });

  it('CONTROL: the figure as a string ("£12k") is not a number the tool reads — refused, nothing prepared', async () => {
    const r = await refusedAndInert({ ...T2, value: '£12k', unit: 'GBP' });
    expect(r.refusal).toBe('unparsable_value');
  });
});

describe('FAIL CLOSED — the headline goal-fit number is never fed by an unclassified or unstated unit', () => {
  it('RED: 240 subscribers (a unit no classifier reads) on a GBP MRR goal → refused, asking for the goal\'s own unit', async () => {
    const r = await refusedAndInert({ ...T2, value: 240, unit: 'subscribers' });
    expect(r.refusal).toBe('unit_unrecognised');
    expect(r.detail).toContain('subscribers');
    expect(r.detail).toContain('GBP MRR');
  });

  it.each([[''], [undefined]])('RED: 12 with unit %j → refused, asking for the figure in the goal\'s own unit', async (unit) => {
    const r = await refusedAndInert({ ...T2, value: 12, unit });
    expect(r.refusal).toBe('unit_unstated');
    expect(r.detail).toContain('GBP MRR');
  });

  it('CONTRAST (already refused at base): 240 users — a recognised count — is unit_mismatch', async () => {
    const r = await refusedAndInert({ ...T2, value: 240, unit: 'users' });
    expect(r.refusal).toBe('unit_mismatch');
  });
});

describe('the approval label shows the figure as the user stated it — never relabelled in the goal\'s unit', () => {
  it('RED: 12000 GBP is shown as "12000 GBP", with the target in the goal\'s own unit', async () => {
    const h = await harness(paulCbd15f83Stored());
    const r = await h.call(TOOL, T2) as Proposed;
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.public_label).toBe('Record the current level of "MRR" as your figure: 12000 GBP (target 20000 GBP MRR)');
  });

  it('RED: 12000 £ is shown with the £ the user gave', async () => {
    const h = await harness(paulCbd15f83Stored());
    const r = await h.call(TOOL, { ...T2, unit: '£' }) as Proposed;
    expect(r.public_label).toBe('Record the current level of "MRR" as your figure: 12000 £ (target 20000 GBP MRR)');
  });
});

describe('RE-VALIDATED AT APPLY TIME — the goal\'s target must be the one the proposal was prepared against', () => {
  /** Propose on the stored model, let another writer change the goal WITHOUT moving the analysis hash, then approve. */
  async function raceOn(change: (goal: Node) => void) {
    const h = await harness(paulCbd15f83Stored());
    const proposed = await h.call(TOOL, T2) as Proposed;
    expect(proposed.ok, JSON.stringify(proposed)).toBe(true);
    const moved = clone(h.stored());
    change(goalOf(moved));
    const hashBefore = computeAnalysisAffectingGraphHash(h.stored() as never);
    h.row.graph = moved;
    const hashSame = hashBefore === computeAnalysisAffectingGraphHash(h.stored() as never);
    const r = await h.call('authorise_change', { proposal_id: proposed.proposal_id });
    return { h, r, hashSame };
  }

  it('RED: the goal moved to the delta frame after the proposal → superseded, nothing written', async () => {
    const { h, r, hashSame } = await raceOn((g) => { g.goal_threshold_frame = 'delta'; });
    expect(hashSame, 'PREMISE: the frame is outside the analysis hash, so the store\'s base check passes').toBe(true);
    expect(r.applied, JSON.stringify(r)).not.toBe(true);
    expect(r.refusal).toBe('superseded');
    expect(h.appends).toHaveLength(0);
    expect(goalOf(h.stored())).not.toHaveProperty('observed_state');
  });

  it('RED: the goal\'s unit changed (GBP MRR → USD MRR) after the proposal → superseded, nothing written', async () => {
    const { h, r, hashSame } = await raceOn((g) => { g.goal_threshold_unit = 'USD MRR'; });
    expect(hashSame, 'PREMISE: the unit is outside the analysis hash').toBe(true);
    expect(r.applied, JSON.stringify(r)).not.toBe(true);
    expect(r.refusal).toBe('superseded');
    expect(h.appends).toHaveLength(0);
    expect(goalOf(h.stored())).not.toHaveProperty('observed_state');
  });

  it('CONTRAST: an unrelated change to the goal (its provenance label) → still applied', async () => {
    const { h, r, hashSame } = await raceOn((g) => { g.provenance = 'user_edited_label'; });
    expect(hashSame).toBe(true);
    expect(r.applied, JSON.stringify(r)).toBe(true);
    expect(h.appends).toHaveLength(1);
    expect(goalOf(h.stored()).observed_state).toStrictEqual(levelOf(12000));
  });

  it('CONTRAST: the goal unchanged → applied, one registration', async () => {
    const { h, applied } = await proposeAndApprove(T2);
    expect(applied.applied, JSON.stringify(applied)).toBe(true);
    expect(h.appends).toHaveLength(1);
  });

  it('CONTRAST (hashed, already refused at base): a new target → superseded', async () => {
    const { h, r, hashSame } = await raceOn((g) => { g.goal_threshold_raw = 30000; g.goal_threshold_cap = 37500; });
    expect(hashSame).toBe(false);
    expect(r.refusal).toBe('superseded');
    expect(h.appends).toHaveLength(0);
  });
});

describe('PLoT BOUNDARY — through the REAL run loader and the REAL run_analysis handler (PLoT faked)', () => {
  async function plotRequestAfterLoad(h: Awaited<ReturnType<typeof harness>>) {
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
    return run.mock.calls[0]![0] as { graph: Graph; goal_node_id: unknown };
  }

  it('CONTRAST: the stored bytes themselves are refused by the real loader — the chat-added option has no decision edge', async () => {
    const h = await harness(paulCbd15f83Stored());
    const err = await loadScenarioSnapshotForRunAnalysis(SCENARIO, 'req-load', h.store as never).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(AnalysisNotReadyError);
    const said = JSON.stringify((err as AnalysisNotReadyError).verdict);
    expect(said).toContain('OPTION_NOT_LINKED_TO_DECISION');
    expect(said).toContain(PAUL_CBD15F83_UNLINKED_OPTION);
  });

  it('T2 on the runnable variant: approve → the real loader → PLoT receives the goal with the recorded level; nothing else moved', async () => {
    const initial = paulCbd15f83Runnable();
    const { h, applied } = await proposeAndApprove(T2, initial);
    expect(applied.applied, JSON.stringify(applied)).toBe(true);
    const after = h.stored();
    expect(after.nodes.filter((n) => n.id !== GOAL)).toStrictEqual(initial.nodes.filter((n) => n.id !== GOAL));
    expect(after.goal_constraints).toStrictEqual(initial.goal_constraints);
    const req = await plotRequestAfterLoad(h);
    expect(req.goal_node_id).toBe(GOAL);
    const goal = req.graph.nodes.find((n) => n.id === GOAL)!;
    expect(goal.goal_threshold_frame).toBe('level');
    expect(goal.goal_threshold_raw).toBe(20000);
    expect(goal.observed_state).toStrictEqual(levelOf(12000));
  });

  it('RED: 12 £k on the runnable variant → PLoT receives raw 12000, baseline 0.48, and the normalisation stamp', async () => {
    const { h, applied } = await proposeAndApprove({ ...T2, value: 12, unit: '£k' }, paulCbd15f83Runnable());
    expect(applied.applied, JSON.stringify(applied)).toBe(true);
    const req = await plotRequestAfterLoad(h);
    const goal = req.graph.nodes.find((n) => n.id === GOAL)!;
    expect(goal.observed_state).toStrictEqual(levelOf(12000, { provenance_unit_normalised: { rule: 'agent_lane_limit_magnitude_v1', original_value: 12, original_unit: '£k' } }));
  });
});
