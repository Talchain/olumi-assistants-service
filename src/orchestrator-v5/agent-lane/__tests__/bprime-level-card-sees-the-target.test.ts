/**
 * RT-10 B′ R3 (Science #87 5999608477): ONE target reader — the today's-level approval too.
 *
 * The B′ tail asks "What's today's level of {goal}?". On the red team's rt10c dental graph (guest wire @350f382d,
 * `rt10c-run2` draft_graph, verbatim) the goal "No-shows" holds the user's "at most 5%" as its own `<=` row and no target
 * figure on the node. Measured through the real propose route: the approval told the Agent `"No-shows" has no target
 * yet: … the chance of reaching a target appears once they set one` — beside the target the user had set.
 *
 * `noTargetYet` still decides only the frame the level is read on (no figure on the node → its own frame: the measured
 * write was `cap: 100`, and the `<=` 5% row then keeps `value_frame: level` on the wire, Science R1(c) GREEN). Whether
 * the goal HAS a target is `statedGoalTargetOf`'s answer.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
import { userWordsOf } from '../stated-by-user.js';

type Graph = { nodes: Array<Record<string, unknown>>; edges: unknown[]; goal_constraints?: unknown[] } & Record<string, unknown>;
const GRAPH = JSON.parse(readFileSync(new URL('./fixtures/bprime-rt10c-graph.json', import.meta.url), 'utf8')) as Graph;
const SCENARIO = '550e8400-e29b-41d4-a716-4466554400c9';
const ctx = { scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'req-bprime-level', user_text: userWordsOf([], 'No-shows are 7% today.') };
const ARGS = { goal_label: 'No-shows', value: 7, unit: '%', goal_is: 'at_most', user_stated: true };
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

const apps: FastifyInstance[] = [];
async function propose(initial: Graph): Promise<ToolResult & { note?: string; refusal?: string }> {
  const row = { graph: clone(initial) as unknown };
  storeRef.value = {
    append: vi.fn(async (write: { graph: unknown }) => { row.graph = clone(write.graph); return { id: 'turn-1' }; }),
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
      const g = clone(row.graph) as Graph;
      return { status: 200, json: { graph: g, graph_hash: computeAnalysisAffectingGraphHash(g as never), graph_identity_hash: computeGraphIdentityHash(g as never) } };
    }
    const res = await app.inject({ method: 'POST', url: path, payload: body as Record<string, unknown> });
    return { status: res.statusCode, json: res.json() as Record<string, unknown> };
  };
  const caps = createAgentCapabilities(dispatch, new ProposalStore());
  return dispatchTool('propose_goal_current_level', JSON.stringify(ARGS), ctx, caps) as Promise<ToolResult & { note?: string; refusal?: string }>;
}

beforeEach(() => { resolveUserIdentity.mockResolvedValue({ mode: 'verified', userId: '0f8a1b2c-3d4e-4f50-9a6b-7c8d9e0f1a2b' }); });
afterEach(async () => { while (apps.length > 0) await apps.pop()!.close(); });

describe('B′ R3 — the today\'s-level approval reads the one target reader', () => {
  it('precondition: the served goal holds no target figure on the node; its target is its own "<=" 5% row', () => {
    const goal = GRAPH.nodes.find((n) => n.kind === 'goal')!;
    expect(goal.goal_threshold_raw ?? null).toBeNull();
    expect(goal.goal_threshold_cap ?? null).toBeNull();
    expect(GRAPH.goal_constraints).toEqual([expect.objectContaining({ node_id: goal.id, operator: '<=', value: 5, unit: '%', value_frame: 'level' })]);
  });

  it('with the user\'s "at most 5%" row, the approval never says the goal "has no target yet"', async () => {
    const result = await propose(GRAPH);
    expect(result.refusal).toBeUndefined();
    expect(result.note).toMatch(/recorded as THEIR current level of the goal/);
    expect(result.note).not.toMatch(/has no target yet/);
  });

  it('CONTRAST: the same goal with no target row still says so', async () => {
    const result = await propose({ ...clone(GRAPH), goal_constraints: [] });
    expect(result.refusal).toBeUndefined();
    expect(result.note).toMatch(/"No-shows" has no target yet/);
  });
});
