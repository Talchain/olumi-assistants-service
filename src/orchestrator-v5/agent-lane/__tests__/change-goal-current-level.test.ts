/**
 * ⛔ A GOAL STATED AS A CHANGE ("cut costs by 20%") TAKES THE USER'S CORRECTION OF TODAY'S LEVEL (DL #75 5902318219 /
 * 5902321589; journey 2's first failing boundary on served CEE `1f9d769`, 3/3).
 *
 * Served: brief "Monthly spend is £45k; we want to cut costs by 20%", then "Actually our monthly cloud spend is £50k,
 * not £45k" → `propose_goal_current_level` → `refusal: goal_is_a_change` (`goal-current-level.ts`: the slice was
 * unbuilt). Spend stayed £45k, so nothing downstream could move. The relative target is the user's own and stays as
 * stated (−20%, now of £50k); the frame's `target_derived_headroom` cap is re-derived by its one rule (level × 1.25);
 * Olumi's reading of the brief's £45k (`goal_level_reading`) is dropped once the user has corrected it.
 *
 * FIXTURE: the served stored graph after the brief (DL r0, scenario 52ebd5af). THE PATH: the Agent's real `dispatchTool`
 * → `createAgentCapabilities` (held in the real `ProposalStore`) → `authorise_change` → `/graph/register` (a fake store
 * enforcing the route's CAS and contract gate) → a read. The goal is bound by id (`costs`).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { dispatchTool, type ToolResult } from '../runtime/agent-tools.js';
import { ProposalStore } from '../proposal.js';
import { USER_EDIT_SOURCE } from '../../../orchestrator/canonicalise-value-ops.js';
import { GraphStateIngressSchema } from '../../boundary/request-extensions.js';

const TOOL = 'propose_goal_current_level';
const GOAL = 'costs';
const SCENARIO = '550e8400-e29b-41d4-a716-44665544cc50';
const SAID = 'Actually our monthly cloud spend is £50k, not £45k';

type Node = { id: string; kind: string; label: string; observed_state?: Record<string, unknown> } & Record<string, unknown>;
type Graph = { nodes: Node[]; edges: unknown[] } & Record<string, unknown>;
const SERVED = (JSON.parse(readFileSync(new URL('./fixtures/served-cut-costs-1f9d769-graph.json', import.meta.url), 'utf8')) as { graph: Graph }).graph;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const goalOf = (g: Graph): Node => g.nodes.find((n) => n.id === GOAL)!;

function setup(initial: Graph = SERVED, said = SAID, between?: (g: Graph) => void) {
  let graph = clone(initial);
  let rev = 0;
  const hash = () => `h${rev}`;
  const registers: { graph: Graph; expected_graph_hash?: string }[] = [];
  const dispatch: InternalDispatch = async (path, body) => {
    if (path === `/assist/v1/scenarios/${SCENARIO}/graph`) {
      return { status: 200, json: { graph: clone(graph), graph_hash: hash(), graph_identity_hash: { value: `id-${hash()}` } } };
    }
    if (path === `/assist/v1/scenarios/${SCENARIO}/graph/register`) {
      const b = clone(body) as { graph: Graph; expected_graph_hash?: string };
      registers.push(b);
      if (!GraphStateIngressSchema.safeParse(b.graph).success) return { status: 400, json: { details: { code: 'GRAPH_CONTRACT_INVALID' } } };
      if (b.expected_graph_hash !== undefined && b.expected_graph_hash !== hash()) return { status: 409, json: { details: { code: 'GRAPH_STALE' } } };
      graph = b.graph;
      rev += 1;
      return { status: 200, json: { graph_hash: hash(), model_version: { version_number: rev + 1, version_id: `v${rev}`, mutation_id: `m${rev}` } } };
    }
    return { status: 500, json: {} };
  };
  const caps = createAgentCapabilities(dispatch, new ProposalStore());
  const ctx = { scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'req-cc', user_text: said };
  const call = (name: string, args: Record<string, unknown>): Promise<ToolResult> => dispatchTool(name, JSON.stringify(args), ctx, caps);
  return {
    call, registers, graph: () => graph,
    /** Land another writer's change between the proposal and its approval. */
    edit: (f: (g: Graph) => void) => { f(graph); rev += 1; },
    between,
  };
}

/** What the Agent passes for "Actually our monthly cloud spend is £50k, not £45k". */
const ARGS = { goal_label: 'costs', value: 50000, unit: '£/month', user_stated: true };

describe('PRECONDITION — the served goal, read off the stored bytes', () => {
  it('a −20% change from Olumi\'s reading of the brief\'s £45k, on a target-derived headroom cap of £56,250', () => {
    const g = goalOf(SERVED);
    expect(g).toMatchObject({ goal_threshold_frame: 'change_rel', goal_threshold_raw: -0.2, goal_threshold_cap: 56250,
      goal_threshold_cap_provenance: 'target_derived_headroom', goal_threshold_unit: '£/month' });
    expect(g.observed_state).toMatchObject({ raw_value: 45000, cap: 56250 });
    expect(g.goal_level_reading).toMatchObject({ level: 45000 });
  });
});

describe('the user\'s correction of today\'s level on a CHANGE goal is prepared, approved and written', () => {
  it('RED (served 3/3 refused goal_is_a_change): prepared and held, nothing written', async () => {
    const s = setup();
    const r = await s.call(TOOL, ARGS) as ToolResult & { proposal_id?: string; public_label?: string };
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.refusal).toBeUndefined();
    expect(r.mutated).toBe(false);
    expect(r.public_label).toContain('£50,000');
    expect(s.registers).toEqual([]);
  });

  it('RED: approved → today is the user\'s £50,000 on the re-derived cap £62,500; the −20% target stands; the reading is refreshed from the user\'s words', async () => {
    const s = setup();
    const r = await s.call(TOOL, ARGS) as ToolResult & { proposal_id?: string };
    const applied = await s.call('authorise_change', { proposal_id: r.proposal_id }) as ToolResult;
    expect(applied.ok, JSON.stringify(applied)).toBe(true);
    expect(applied.applied).toBe(true);
    expect(s.registers).toHaveLength(1);
    expect(s.registers[0]!.expected_graph_hash).toBe('h0');
    const g = goalOf(s.graph());
    expect(g.observed_state).toStrictEqual({ value: 0.8, baseline: 0.8, unit: '£/month', source: USER_EDIT_SOURCE, raw_value: 50000, cap: 62500 });
    expect(g).toMatchObject({ goal_threshold_frame: 'change_rel', goal_threshold_raw: -0.2, goal_threshold_cap: 62500,
      goal_threshold_cap_provenance: 'target_derived_headroom' });
    // AIQ 5902364862: the number is the user's; reading "their monthly cloud spend" as "costs" stays Olumi's, refreshed.
    expect(g.goal_level_reading).toStrictEqual({
      level: 50000, level_unit: '£/month', quote: SAID,
      lead: `Olumi reads your ‘£50k’ (‘${SAID}’) as today's level of ‘costs’`, bound: '<=',
    });
  });

  it('CONTROL (r1/r2 shape: the goal is the user\'s own words, no reading) → no reading is added; the level is the user\'s', async () => {
    const g0 = clone(SERVED);
    delete goalOf(g0).goal_level_reading;
    const s = setup(g0);
    const r = await s.call(TOOL, ARGS) as ToolResult & { proposal_id?: string };
    await s.call('authorise_change', { proposal_id: r.proposal_id });
    const g = goalOf(s.graph());
    expect(g).not.toHaveProperty('goal_level_reading');
    expect(g.observed_state).toMatchObject({ raw_value: 50000, source: USER_EDIT_SOURCE });
  });

  it('R3 row (1): a cap that is not target-derived is KEPT — £50,000 is read on it (50,000 ÷ 75,000), never silently re-framed', async () => {
    const g0 = clone(SERVED);
    Object.assign(goalOf(g0), { goal_threshold_cap: 75000, goal_threshold_cap_provenance: 'inherited' });
    const s = setup(g0);
    const r = await s.call(TOOL, ARGS) as ToolResult & { proposal_id?: string };
    await s.call('authorise_change', { proposal_id: r.proposal_id });
    const g = goalOf(s.graph());
    expect(g.observed_state).toMatchObject({ raw_value: 50000, cap: 75000, value: 50000 / 75000, baseline: 50000 / 75000 });
    expect(g.goal_threshold_cap).toBe(75000);
  });

  it('R3 row (2): a product goal whose parts cannot follow still gives £45,000 — the approval SAYS so, never scores silently', async () => {
    const g0 = clone(SERVED);
    g0.nodes.push(
      { id: 'workload', kind: 'factor', label: 'Workload', observed_state: { value: 0.5, raw_value: 450, cap: 900, source: 'brief_extraction' } } as Node,
      { id: 'unit_cost', kind: 'factor', label: 'Unit cost', observed_state: { value: 0.5, raw_value: 100, cap: 200, source: 'brief_extraction' } } as Node,
    );
    goalOf(g0).nonlinear_identity = { operation: 'product', factor_ids: ['workload', 'unit_cost'], stated_in_brief: false };
    const s = setup(g0);
    const r = await s.call(TOOL, ARGS) as ToolResult & { public_label?: string; note?: string };
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.public_label).toContain('"costs" is worked out as "Workload" × "Unit cost", and those figures still give £45,000');
    expect(String(r.note)).toContain('the Run cannot use your £50,000 / month until one of them changes');
  });

  // #2851 buddy r2 P1 (DL ruling 2): Olumi's part figures give no product arithmetic; the user's do (row above).
  // Re-derivation must FAIL to reach `productStillGives` (buddy's repro): £50,000 / £10 = 5,000 workload > its 900 cap.
  it('#2851: when Olumi\'s part cannot follow, the approval says no "those figures still give" arithmetic; CONTROL: the user\'s parts do', async () => {
    const run = async (source: string) => {
      const g0 = clone(SERVED);
      g0.nodes.push(
        { id: 'workload', kind: 'factor', label: 'Workload', observed_state: { value: 0.5, raw_value: 450, cap: 900, source } } as Node,
        { id: 'unit_cost', kind: 'factor', label: 'Unit cost', observed_state: { value: 0.05, raw_value: 10, cap: 200, source: 'brief_extraction' } } as Node,
      );
      goalOf(g0).nonlinear_identity = { operation: 'product', factor_ids: ['workload', 'unit_cost'], stated_in_brief: false };
      const r = await setup(g0).call(TOOL, ARGS) as ToolResult & { public_label?: string };
      return String(r.public_label);
    };
    expect(await run('cee_inference')).not.toMatch(/still give/);
    expect(await run('brief_extraction')).toMatch(/those figures still give £4,500/);
  });
  it('#2851: when Olumi\'s part CAN follow, the re-derived figure stays labelled as Olumi\'s estimate (legitimate, DL)', async () => {
    const g0 = clone(SERVED);
    g0.nodes.push(
      { id: 'workload', kind: 'factor', label: 'Workload', observed_state: { value: 0.5, raw_value: 450, cap: 900, source: 'cee_inference' } } as Node,
      { id: 'unit_cost', kind: 'factor', label: 'Unit cost', observed_state: { value: 0.5, raw_value: 100, cap: 200, source: 'brief_extraction' } } as Node,
    );
    goalOf(g0).nonlinear_identity = { operation: 'product', factor_ids: ['workload', 'unit_cost'], stated_in_brief: false };
    const s = setup(g0);
    const r = await s.call(TOOL, ARGS) as ToolResult & { public_label?: string; note?: string };
    expect(String(r.public_label)).not.toMatch(/still give/);
    expect(String(r.public_label)).toMatch(/it stays Olumi's estimate, not your figure/);
  });

  it('the frame holds the TARGET too: an increase goal (up 20%) is framed on its target, as construction does (60,000 × 1.25)', async () => {
    const g0 = clone(SERVED);
    Object.assign(goalOf(g0), { goal_threshold_raw: 0.2, goal_threshold: 0.2, goal_direction: '>=' });
    delete goalOf(g0).goal_level_reading;
    const s = setup(g0);
    const r = await s.call(TOOL, ARGS) as ToolResult & { proposal_id?: string };
    await s.call('authorise_change', { proposal_id: r.proposal_id });
    expect(goalOf(s.graph()).goal_threshold_cap).toBe(75000);
    expect(goalOf(s.graph()).observed_state).toMatchObject({ raw_value: 50000, cap: 75000 });
  });

  it('CONTROL: a figure the user did not type is never recorded as theirs', async () => {
    const s = setup(SERVED, 'Can you check the spend figure?');
    const r = await s.call(TOOL, ARGS) as ToolResult;
    expect(r).toMatchObject({ ok: false, refusal: 'figure_not_in_users_words' });
    expect(s.registers).toEqual([]);
  });

  it('CONTROL: the target changed after it was prepared → superseded, nothing written', async () => {
    const s = setup();
    const r = await s.call(TOOL, ARGS) as ToolResult & { proposal_id?: string };
    s.edit((g) => { goalOf(g).goal_threshold_raw = -0.3; });
    const applied = await s.call('authorise_change', { proposal_id: r.proposal_id }) as ToolResult;
    expect(applied).toMatchObject({ ok: false, refusal: 'superseded' });
    expect(s.registers).toEqual([]);
  });

  it('CONTROL: a cap that is not target-derived is kept; a level above it is refused by name, never re-framed', async () => {
    const g = clone(SERVED);
    Object.assign(goalOf(g), { goal_threshold_cap_provenance: 'inherited' });
    const s = setup(g, 'Actually our monthly cloud spend is £60k');
    const r = await s.call(TOOL, { ...ARGS, value: 60000 }) as ToolResult;
    expect(r).toMatchObject({ ok: false, refusal: 'level_above_frame' });
    expect(s.registers).toEqual([]);
  });
});
