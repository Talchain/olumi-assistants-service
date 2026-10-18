/**
 * ⭐ STEP 8 ROUTE A — THE GOAL'S LEVEL TODAY, HELD AS A PART OF OLUMI'S SUM, MOVES WITH THE GOAL (Codex PAIR2 B).
 *
 * Construction works a validated-definition goal out as "its level today + each option's change" (`goal-definition-sum.ts`). The
 * today part IS the goal's level today. Left at the old figure after the user corrects that level, ISL would refuse the sum
 * (`identity_inconsistent`). So the one goal-level writer (`propose_goal_current_level` → `authorise_change`) writes it with the
 * goal, says so on the card, and never names it among the nodes that "still hold" the earlier figure.
 *
 * THE PATH: the drafter stub → `buildModelFromBrief` → the stored graph → the Agent's real `dispatchTool` → the REAL
 * `/graph/register` route (Fastify inject) over a stateful store double → the real Run loader and handler (PLoT faked).
 */
import { injectAsCeeWriter } from '../../../../tests/utils/inject-as-cee-writer.js';
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
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import { ProposalStore } from '../proposal.js';
import { userWordsOf } from '../stated-by-user.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { createSetFactorValueHandler } from '../../tools/handlers/set-factor-value.js';
import { buildHandlerInvocation } from '../../tools/handlers/d1-shared/__tests__/fixtures.js';
import type { ProposalAction } from '../../routing/types.js';
import { prepareOptionInterventionEdit } from '../../system-events/option-intervention-edit.js';
import { appendCheckedGraphWrite, assertNoIntroducedGraphViolations, commitModelChange } from '../../persist-graph-write.js';
import { PersistedGraphInvariantError } from '../../persisted-graph-invariants.js';
import { bindWriteCaller } from '../../ownership/door-ownership.js';

const SCENARIO = '550e8400-e29b-41d4-a716-4466554408a8';
const OWNER = '0f8a1b2c-3d4e-4f50-9a6b-7c8d9e0f18a8';
const GOAL = 'widgets_per_hour';
const TODAY = 'widgets_per_hour_today';
const BRIEF = 'Today we make 40 widgets per hour. We need at least 60 widgets per hour. Option A adds exactly 30 widgets per hour; '
  + 'option B adds exactly 10 widgets per hour.';

type Rec = Record<string, any>;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const nodeOf = (g: Rec, id: string): Rec | undefined => (g.nodes as Rec[]).find((n) => n.id === id);

const candidate = (definitional: boolean) => ({
  goal: { metric: 'Widgets per hour', operator: '>=', target_stated: true, value: 60, unit: 'widgets/hour', horizon_months: null, provenance: 'explicit',
    frame: 'level', baseline_known: true, baseline_value: 40, baseline_provenance: 'explicit', scope: null },
  constraints: [],
  options: [
    { label: 'Option A', provenance: 'explicit', is_status_quo: null, interventions: [{ factor_label: 'Net change in widgets per hour', value: 30, value_kind: 'absolute', unit: 'widgets/hour', provenance: 'explicit' }] },
    { label: 'Option B', provenance: 'explicit', is_status_quo: null, interventions: [{ factor_label: 'Net change in widgets per hour', value: 10, value_kind: 'absolute', unit: 'widgets/hour', provenance: 'explicit' }] },
    { label: 'Carry on as now', provenance: 'ai_proposed', is_status_quo: true, interventions: [] },
  ],
  factors: [{ label: 'Net change in widgets per hour', role: 'controllable', baseline_known: true, baseline_value: 0, unit: 'widgets/hour', provenance: 'explicit', plausible_max: 50 }],
  risks: [], outcomes: [],
  links: [{ from: 'Net change in widgets per hour', to: 'Widgets per hour', direction: 'positive', provenance: 'explicit', effect_amount: 1, effect_per_source_change: 1,
    effect_provenance: 'explicit', definitional, basis: null, source_quote: null }],
  identities: [], unknowns: [], decision_question: null,
});

async function constructed(definitional: boolean): Promise<Rec> {
  let registered: unknown = null;
  const call = (async () => ({ text: JSON.stringify(candidate(definitional)) })) as unknown as CallStructuredModel;
  const d: InternalDispatch = async (path, b) => {
    if (path.endsWith('/graph/register')) { registered = clone((b as { graph: unknown }).graph); return { status: 200, json: { model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const out = await buildModelFromBrief(SCENARIO, BRIEF, d, call) as Rec;
  expect(out.ok, JSON.stringify(out).slice(0, 400)).toBe(true);
  return GraphV3.parse(registered) as Rec;
}

const apps: FastifyInstance[] = [];
async function harness(initial: Rec, said = 'We now make 50 widgets per hour.', stores: (g: Rec) => Rec = (g) => g) {
  const row = { graph: clone(initial) as unknown };
  const appends: unknown[] = [];
  storeRef.value = {
    append: vi.fn(async (write: { graph: unknown }) => { appends.push(clone(write.graph)); row.graph = stores(clone(write.graph) as Rec); return { id: `turn-${appends.length}` }; }),
    loadGraph: vi.fn(async () => clone(row.graph)),
    loadGraphAndBriefText: vi.fn(async () => ({ graph: clone(row.graph), briefText: null })),
    ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
    getScenarioOwner: vi.fn(async () => null),
    scenarioExists: vi.fn(async () => true),
    readCommittedTurn: vi.fn(async () => null),
    readMostRecentPendingActions: vi.fn(async () => []),
  };
  const app = Fastify();
  apps.push(app);
  await registerRoute(app);
  await app.ready();
  const dispatch: InternalDispatch = async (path, body) => {
    if (path === `/assist/v1/scenarios/${SCENARIO}/graph`) {
      const g = clone(row.graph) as Rec;
      return { status: 200, json: { graph: g, graph_hash: computeAnalysisAffectingGraphHash(g as never), graph_identity_hash: computeGraphIdentityHash(g as never) } };
    }
    if (path === `/assist/v1/scenarios/${SCENARIO}/graph/register`) {
      const res = await injectAsCeeWriter(app, { method: 'POST', url: path, payload: body as Record<string, unknown> });
      return { status: res.statusCode, json: res.json() as Record<string, unknown> };
    }
    return { status: 500, json: {} };
  };
  const caps = createAgentCapabilities(dispatch, new ProposalStore());
  const ctx = { scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'req-step8-edit', user_text: userWordsOf([BRIEF], said) };
  const call = (name: string, args: Record<string, unknown>): Promise<ToolResult> => dispatchTool(name, JSON.stringify(args), ctx, caps);
  const register = (graph: Rec) => {
    const g = clone(row.graph) as Rec;
    return dispatch(`/assist/v1/scenarios/${SCENARIO}/graph/register`, { graph,
      expected_graph_hash: computeAnalysisAffectingGraphHash(g as never), expected_graph_identity_hash: computeGraphIdentityHash(g as never) });
  };
  return { appends, call, register, stored: () => row.graph as Rec };
}

beforeEach(() => { resolveUserIdentity.mockResolvedValue({ mode: 'verified', userId: OWNER }); });
afterEach(async () => { while (apps.length > 0) await apps.pop()!.close(); });

type Proposed = ToolResult & { proposal_id?: string; public_label?: string };
const LEVEL = { goal_label: 'Widgets per hour', value: 50, unit: 'widgets/hour', goal_is: 'at_least', user_stated: true };

describe('STEP 8 Route A — a goal-level edit writes the sum\'s today part with the goal, as the card says', () => {
  it('RED: today 40 → 50: the today part is written with the goal (same figure, frame and stamp), and the card says it changes', async () => {
    const initial = await constructed(true);
    expect(nodeOf(initial, TODAY)?.observed_state?.raw_value, 'construction compiled the sum').toBe(40);
    const h = await harness(initial);
    const proposed = await h.call('propose_goal_current_level', LEVEL) as Proposed;
    expect(proposed.ok, JSON.stringify(proposed)).toBe(true);
    expect(proposed.public_label).toContain('"Widgets per hour today" changes with it: Olumi works out "Widgets per hour" as its level today plus each option\'s change');
    expect(proposed.public_label).not.toContain('still holds');
    const applied = await h.call('authorise_change', { proposal_id: proposed.proposal_id }) as Rec;
    expect(applied.applied, JSON.stringify(applied)).toBe(true);
    const goal = nodeOf(h.stored(), GOAL)!;
    expect(goal.observed_state.raw_value).toBe(50);
    expect(nodeOf(h.stored(), TODAY)!.observed_state).toStrictEqual(goal.observed_state);
    // The sum still reconciles exactly: today 50 = 50 + 0.
    expect(goal.nonlinear_identity).toMatchObject({ operation: 'sum', factor_ids: [TODAY, 'net_change_in_widgets_per_hour'] });
  });

  it('RED (Codex review of 04c63519): a today part another writer moved (40 → 50) is still written with the goal (→ 55), and read back', async () => {
    const initial = await constructed(true);
    const moved = clone(initial);
    const os = nodeOf(moved, TODAY)!.observed_state;
    nodeOf(moved, TODAY)!.observed_state = { ...os, raw_value: 50, value: 50 / os.cap, baseline: 50 / os.cap };
    const h = await harness(moved, 'We now make 55 widgets per hour.');
    const proposed = await h.call('propose_goal_current_level', { ...LEVEL, value: 55 }) as Proposed;
    expect(proposed.ok, JSON.stringify(proposed)).toBe(true);
    expect(proposed.public_label).toContain('"Widgets per hour today" changes with it');
    const applied = await h.call('authorise_change', { proposal_id: proposed.proposal_id }) as Rec;
    expect(applied.applied, JSON.stringify(applied)).toBe(true);
    const goal = nodeOf(h.stored(), GOAL)!;
    expect(goal.observed_state.raw_value).toBe(55);
    expect(nodeOf(h.stored(), TODAY)!.observed_state).toStrictEqual(goal.observed_state);
  });

  it('RED (Codex review of 04c63519, 3): a store that keeps the today part at its old figure is never reported as written', async () => {
    const initial = await constructed(true);
    const old = clone(nodeOf(initial, TODAY)!.observed_state);
    const h = await harness(initial, undefined, (g) => { nodeOf(g, TODAY)!.observed_state = clone(old); return g; });
    const proposed = await h.call('propose_goal_current_level', LEVEL) as Proposed;
    expect(proposed.ok, JSON.stringify(proposed)).toBe(true);
    const applied = await h.call('authorise_change', { proposal_id: proposed.proposal_id }) as Rec;
    expect(applied).toMatchObject({ applied: false, refusal: 'not_verified' });
  });

  it('RED (Codex review of 04c63519): any writer that leaves the today part at 41 through the persistence route stores the goal\'s 40', async () => {
    const initial = await constructed(true);
    const h = await harness(initial);
    const moved = clone(initial);
    const os = nodeOf(moved, TODAY)!.observed_state;
    nodeOf(moved, TODAY)!.observed_state = { ...os, raw_value: 41, value: 41 / os.cap, baseline: 41 / os.cap };
    const reg = await h.register(moved);
    expect(reg.status, JSON.stringify(reg.json).slice(0, 300)).toBe(200);
    expect(nodeOf(h.stored(), TODAY)!.observed_state).toStrictEqual(nodeOf(h.stored(), GOAL)!.observed_state);
    expect(nodeOf(h.stored(), TODAY)!.observed_state.raw_value).toBe(40);
  });

  it('RED (Codex review round 2): an option setting the today part (50 beside a goal of 40) is refused by the shared persistence check; nothing is written', async () => {
    const initial = await constructed(true);
    const h = await harness(initial);
    const set = clone(initial);
    const a = nodeOf(set, 'option_a')!;
    a.interventions = { ...a.interventions, [TODAY]: { ...nodeOf(set, TODAY)!.observed_state, raw_value: 50, value: 50 / nodeOf(set, TODAY)!.observed_state.cap } };
    const reg = await h.register(set);
    expect(reg.status).toBe(422);
    expect(JSON.stringify(reg.json)).toContain('GOAL_TODAY_PART_NOT_GOAL_LEVEL');
    expect(h.appends).toHaveLength(0);
    expect(nodeOf(h.stored(), 'option_a')!.interventions[TODAY]).toBeUndefined();
  });

  it('RED (DL-3 scope decision): the option-intervention writer never lets an option set the today part; its own part it may', async () => {
    const g = await constructed(true);
    const hash = computeAnalysisAffectingGraphHash(g as never) as string;
    const at = (factorId: string) => prepareOptionInterventionEdit({ persistedGraph: clone(g), optionId: 'option_a', factorId, modelValue: 0.5, expectedGraphHash: hash });
    expect(at(TODAY)).toEqual({ kind: 'refused', reason: 'goal_today_part_owned' });
    expect(at('net_change_in_widgets_per_hour').kind).not.toBe('refused');
  });

  it('CONTRAST: an ordinary sum part (not the part construction minted for the goal\'s level today) is never moved', async () => {
    const initial = await constructed(true);
    const ordinary = JSON.parse(JSON.stringify(initial).replaceAll(`"${TODAY}"`, '"line_a_output"')) as Rec;
    nodeOf(ordinary, 'line_a_output')!.label = 'Line A output';
    expect(nodeOf(ordinary, GOAL)!.nonlinear_identity.factor_ids).toContain('line_a_output');
    const h = await harness(ordinary);
    const proposed = await h.call('propose_goal_current_level', LEVEL) as Proposed;
    expect(proposed.ok, JSON.stringify(proposed)).toBe(true);
    expect(proposed.public_label).not.toContain('changes with it');
    const applied = await h.call('authorise_change', { proposal_id: proposed.proposal_id }) as Rec;
    expect(applied.applied, JSON.stringify(applied)).toBe(true);
    expect(nodeOf(h.stored(), GOAL)!.observed_state.raw_value).toBe(50);
    expect(nodeOf(h.stored(), 'line_a_output')!.observed_state.raw_value).toBe(40);
  });

  it('RED: the factor writer never sets the today part on its own — it says where to change it, and writes nothing', async () => {
    const g = await constructed(true);
    const at = (id: string) => createSetFactorValueHandler()(buildHandlerInvocation({ graph: clone(g), proposal: {
      handler_id: 'set_factor_value', entity: { id, kind: 'node', resolution_status: 'resolved', resolution_method: 'id_match' },
      parameters: [{ name: 'value', value: { value: 45, unit: 'widgets/hour' }, operator: 'set', source: 'user_explicit' }],
      cited_context_fields: [] } as ProposalAction }));
    await expect(at(TODAY)).rejects.toMatchObject({ cause_kind: 'precondition_unmet_at_execute', details: { d1_code: 'PRECONDITION_UNMET',
      target_id: TODAY, specific_issue: expect.stringContaining('Change the current level of "Widgets per hour" and this changes with it. Nothing was written.') } });
    // Contrast: the option-set part is not the goal's level today, so this guard never stops it.
    await expect(at('net_change_in_widgets_per_hour')).resolves.toBeDefined();
  });

  it('CONTRAST: with no sum (the drafter did not say definitional), the same edit writes the goal alone and names no today part', async () => {
    const initial = await constructed(false);
    expect(nodeOf(initial, TODAY)).toBeUndefined();
    const h = await harness(initial);
    const proposed = await h.call('propose_goal_current_level', LEVEL) as Proposed;
    expect(proposed.ok, JSON.stringify(proposed)).toBe(true);
    expect(proposed.public_label).not.toContain('changes with it');
    const applied = await h.call('authorise_change', { proposal_id: proposed.proposal_id }) as Rec;
    expect(applied.applied, JSON.stringify(applied)).toBe(true);
    expect(nodeOf(h.stored(), GOAL)!.observed_state.raw_value).toBe(50);
  });
});

/**
 * ⭐ ONE SHARED PERSISTENCE CHECK (Codex BLOCK @ff7e6b08: append, save and restore accepted today 41 beside a goal of 40 and an
 * option's override of 50). Every real caller of `persist-graph-write.ts` — the turn append, version save, version restore and
 * guest copy — reaches `assertNoIntroducedGraphViolations`, which refuses a compiled today part that is not its goal's level today,
 * that an option sets, or that a link leads into. Nothing is written in any of them.
 */
describe('STEP 8 Route A — the today part is enforced once, at the shared persistence check, on every caller', () => {
  const OWNER_ID = OWNER;
  const variants = async (): Promise<Array<[string, Rec]>> => {
    const g = await constructed(true);
    const at41 = clone(g);
    const os = nodeOf(at41, TODAY)!.observed_state;
    nodeOf(at41, TODAY)!.observed_state = { ...os, raw_value: 41, value: 41 / os.cap, baseline: 41 / os.cap };
    const set50 = clone(g);
    const a = nodeOf(set50, 'option_a')!;
    a.interventions = { ...a.interventions, [TODAY]: { ...os, raw_value: 50, value: 50 / os.cap } };
    return [['today 41 beside a goal of 40', at41], ['an option\'s override of 50', set50]];
  };
  const refusedFor = (e: unknown): boolean => e instanceof PersistedGraphInvariantError
    && e.violations.some((v) => v.code === 'GOAL_TODAY_PART_NOT_GOAL_LEVEL' && v.entity_ids.includes(TODAY));

  it('RED: the turn append refuses both, and appends nothing', async () => {
    for (const [why, graph] of await variants()) {
      const append = vi.fn();
      const err = await bindWriteCaller({ userId: OWNER_ID, verified: true }, () => appendCheckedGraphWrite({
        store: { append, getScenarioOwner: async () => OWNER_ID } as never, writesGraph: true, baseGraphForInvariants: null, source: 'step8_row',
        write: { scenario_id: SCENARIO, turn_id: 't-step8', turn_class: 'mutate', graph } as never,
      })).then(() => null, (e: unknown) => e);
      expect(refusedFor(err), `${why}: ${String(err)}`).toBe(true);
      expect(append).not.toHaveBeenCalled();
    }
  });

  it('RED: version save and restore refuse both, and call no writing RPC', async () => {
    for (const [why, graph] of await variants()) {
      const saveVersion = vi.fn(); const restoreVersionAtomic = vi.fn();
      const store = { getScenarioOwner: async () => OWNER_ID, saveVersion, restoreVersionAtomic } as never;
      const save = await bindWriteCaller({ userId: OWNER_ID, verified: true }, () => commitModelChange({ operation: 'SAVE_VERSION', store,
        write: { scenario_id: SCENARIO, graph } as never })).then(() => null, (e: unknown) => e);
      const restore = await bindWriteCaller({ userId: OWNER_ID, verified: true }, () => commitModelChange({ operation: 'RESTORE_VERSION', store,
        write: { scenario_id: SCENARIO, version_id: 'v-1', graph, current_graph: clone(graph) } as never, restoreHead: null })).then(() => null, (e: unknown) => e);
      expect(refusedFor(save), `save, ${why}`).toBe(true);
      expect(refusedFor(restore), `restore, ${why}`).toBe(true);
      expect(saveVersion).not.toHaveBeenCalled();
      expect(restoreVersionAtomic).not.toHaveBeenCalled();
    }
  });

  it('RED: a guest copy refuses both, and copies nothing', async () => {
    for (const [why, graph] of await variants()) {
      const copyGuestScenarioChecked = vi.fn();
      const out = await bindWriteCaller({ userId: OWNER_ID, verified: true }, () => commitModelChange({ operation: 'COPY_GUEST_SCENARIO',
        sourceScenarioId: SCENARIO, userId: OWNER_ID, store: { readGuestCopy: async () => null,
          readGuestSource: async () => ({ graph, user_id: null, revision: 1 }), copyGuestScenarioChecked } as never }));
      expect(out, why).toEqual({ kind: 'refused', reason: 'no_model' });
      expect(copyGuestScenarioChecked).not.toHaveBeenCalled();
    }
  });

  it('CONTRAST: the compiled graph as built (today part at the goal\'s level, no option on it) passes the same check', async () => {
    const g = await constructed(true);
    expect(() => assertNoIntroducedGraphViolations({ graph: g, writesGraph: true, identity: { scenario_id: SCENARIO }, baseGraphForInvariants: null })).not.toThrow();
  });
});
