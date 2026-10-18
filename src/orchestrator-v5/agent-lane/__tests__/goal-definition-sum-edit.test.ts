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
async function harness(initial: Rec) {
  const row = { graph: clone(initial) as unknown };
  const appends: unknown[] = [];
  storeRef.value = {
    append: vi.fn(async (write: { graph: unknown }) => { appends.push(clone(write.graph)); row.graph = clone(write.graph); return { id: `turn-${appends.length}` }; }),
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
  const ctx = { scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'req-step8-edit', user_text: userWordsOf([BRIEF], 'We now make 50 widgets per hour.') };
  const call = (name: string, args: Record<string, unknown>): Promise<ToolResult> => dispatchTool(name, JSON.stringify(args), ctx, caps);
  return { appends, call, stored: () => row.graph as Rec };
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

  it('CONTRAST: an ordinary sum part that merely equals the goal (not named as its level today) is never moved', async () => {
    const initial = await constructed(true);
    const renamed = clone(initial);
    nodeOf(renamed, TODAY)!.label = 'Line A output';
    const h = await harness(renamed);
    const proposed = await h.call('propose_goal_current_level', LEVEL) as Proposed;
    expect(proposed.ok, JSON.stringify(proposed)).toBe(true);
    expect(proposed.public_label).not.toContain('changes with it');
    const applied = await h.call('authorise_change', { proposal_id: proposed.proposal_id }) as Rec;
    expect(applied.applied, JSON.stringify(applied)).toBe(true);
    expect(nodeOf(h.stored(), GOAL)!.observed_state.raw_value).toBe(50);
    expect(nodeOf(h.stored(), TODAY)!.observed_state.raw_value).toBe(40);
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
