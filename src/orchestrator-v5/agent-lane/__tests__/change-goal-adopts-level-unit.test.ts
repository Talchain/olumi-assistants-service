/**
 * ⭐ A1 — A GOAL HELD ONLY AS A PERCENTAGE CHANGE TAKES THE UNIT TODAY'S LEVEL IS STATED IN (DL 0df0e1 founder trace Q1;
 * AIE review on #87 6016108422 (2)).
 *
 * Served, Paul's scenario 58bd5e71 (6 Oct 2026): the brief's "increase productivity by at least 10%" was stored as
 * productivity `change_rel` +0.1 in "%" with no cap and no level. Paul taught a sprint measure ("We can fit 4 large,
 * 8 medium, 16 small, roughly"; Olumi proposed small = 1, medium = 2, large = 4; he said "Yes"). At 10:11Z the level door
 * refused `unit_mismatch` ("it currently measures productivity in %, not sprint units. Nothing was prepared"), and at
 * 10:12Z the Agent said "I can't change the goal's unit with the available controls". All four Runs asked for "%".
 *
 * FIXTURE: the 58bd5e71 graph exactly as stored at 11:28:27Z (scenarios.graph, read-only SELECT; md5 of its jsonb text
 * a1c4426c766c8986908296ada482a6b8 equals the fixture's jsonb-canonical md5). THE PATH: the Agent's real `dispatchTool` →
 * `createAgentCapabilities` (held in the real `ProposalStore`) → `authorise_change` → `/graph/register` (a fake store
 * enforcing the route's CAS and contract gate) → a cold re-read through the contract and the run path's schema.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { dispatchTool, type ToolResult } from '../runtime/agent-tools.js';
import { ProposalStore } from '../proposal.js';
import { USER_EDIT_SOURCE } from '../../../orchestrator/canonicalise-value-ops.js';
import { GraphStateIngressSchema } from '../../boundary/request-extensions.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { targetTestabilityOf } from '../../admission/target-testability.js';
import { placeholderAskWords } from '../goal-certainty.js';

const TOOL = 'propose_goal_current_level';
const GOAL = 'productivity';
const SCENARIO = '58bd5e71-71da-4659-b54f-28d2a1ca0a01';
/** Paul's typed messages, verbatim (v5_conversation_turns 09:39:49Z, 09:49:57Z, 09:57:52Z, 10:11:24Z): `user_text` joins them. */
const SAID = [
  "Should I hire a Tech lead or two developers to increase productivity by at least 10%, while maintaining code quality? We have an urgent launch date in the next three months. We currently have six mid-weight developers, so we're lacking leadership. Our budget is £200,000, but we'd like to spend less.",
  'We treat our development sprints, which are every 2 weeks, as the opportunity to deliver a bunch of updates, which we simply size as small, medium, and large. We can fit 4 large, 8 medium, 16 small, roughly.',
  'The latter.',
  'Yes, how do they affect this decision?',
].join('\n');
const UNIT = 'small-update equivalents per sprint';
/** What the Agent passes for "16 small" in the measure Olumi proposed at 09:57Z. */
const ARGS = { goal_label: GOAL, value: 16, unit: UNIT, user_stated: true };
const QUOTE = 'We can fit 4 large, 8 medium, 16 small, roughly';

type Node = { id: string; kind: string; label: string; observed_state?: Record<string, unknown> } & Record<string, unknown>;
type Edge = { from: string; to: string; provenance?: Record<string, unknown> } & Record<string, unknown>;
type Graph = { nodes: Node[]; edges: Edge[]; goal_constraints?: Record<string, unknown>[] } & Record<string, unknown>;
const STORED = (JSON.parse(readFileSync(new URL('./fixtures/founder-58bd5e71-stored-graph-20261006.json', import.meta.url), 'utf8')) as { graph: Graph }).graph;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const goalOf = (g: Graph): Node => g.nodes.find((n) => n.id === GOAL)!;
const intoGoal = (g: Graph) => g.edges.filter((e) => e.to === GOAL).map((e) => ({ from: e.from, to: e.to }));

function setup(initial: Graph = STORED, said = SAID) {
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
  const ctx = { scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'req-a1', user_text: said };
  const call = (name: string, args: Record<string, unknown>): Promise<ToolResult> => dispatchTool(name, JSON.stringify(args), ctx, caps);
  return { call, registers, graph: () => graph, edit: (f: (g: Graph) => void) => { f(graph); rev += 1; } };
}

type Prepared = ToolResult & { proposal_id?: string; public_label?: string; note?: string };

/** The card Paul would see, word for word. */
const CARD = 'Record today\'s level of "productivity" as your figure: 16 small-update equivalents per sprint (your target: up at least 10% '
  + 'from today), and measure "productivity" in small-update equivalents per sprint (Olumi’s reading of your figures in “We can '
  + 'fit 4 large, 8 medium, 16 small, roughly”; until now "productivity" held only your change, with no unit of its own)';

describe('PRECONDITION — the stored 58bd5e71 goal, read off its bytes', () => {
  it('productivity: change_rel +0.1 in "%", no cap, no level; every link into it is Olumi\'s placeholder', () => {
    const g = goalOf(STORED);
    expect(g).toMatchObject({ kind: 'goal', goal_threshold_frame: 'change_rel', goal_threshold_raw: 0.1, goal_threshold_unit: '%', goal_direction: '>=' });
    expect(Object.keys(g)).not.toContain('goal_threshold_cap');
    expect(Object.keys(g)).not.toContain('observed_state');
    const into = STORED.edges.filter((e) => e.to === GOAL);
    expect(into.length).toBe(7);
    expect(into.every((e) => e.defaulted === true && e.provenance?.magnitude === undefined && e.provenance?.natural_effect === undefined)).toBe(true);
    expect((STORED.goal_constraints ?? []).filter((r) => r.node_id === GOAL)).toEqual([]);
  });

  it('PRECONDITION: today the next Run asks for productivity "in %"', () => {
    expect(placeholderAskWords(STORED, intoGoal(STORED))?.message).toContain('What is it, in %?');
  });
});

describe('A1 R1 — through the real door: "16 small" + "Yes" → productivity measured in sprint units, level 16', () => {
  it('RED (served 10:11Z refused, nothing prepared; base code: unit_unrecognised "… in %"): the card is prepared, held, and says the unit is Olumi\'s reading', async () => {
    const s = setup();
    const r = await s.call(TOOL, ARGS) as Prepared;
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.refusal).toBeUndefined();
    expect(r.mutated).toBe(false);
    expect(r.public_label).toBe(CARD);
    expect(String(r.note)).toContain('that this unit is Olumi’s reading of the user’s figures (never their own words or weights)');
    expect(s.registers).toEqual([]);
  });

  it('approve → ONE commit: unit + cap (construction\'s rule) + level + Olumi\'s unit reading; the +10% target is kept exactly', async () => {
    const s = setup();
    const r = await s.call(TOOL, ARGS) as Prepared;
    const applied = await s.call('authorise_change', { proposal_id: r.proposal_id }) as ToolResult;
    expect(applied.ok, JSON.stringify(applied)).toBe(true);
    expect(applied.applied).toBe(true);
    expect(s.registers).toHaveLength(1);
    expect(s.registers[0]!.expected_graph_hash).toBe('h0');
    const g = goalOf(s.graph());
    // 16 today, +10% → 17.6; the one cap rule frames the larger with 25% headroom: 22.
    expect(g).toMatchObject({
      goal_threshold_frame: 'change_rel', goal_threshold_raw: 0.1, goal_threshold: 0.1, goal_direction: '>=',
      goal_threshold_unit: UNIT, goal_threshold_cap: 22, goal_threshold_cap_provenance: 'target_derived_headroom',
    });
    expect(g.observed_state).toStrictEqual({ value: 16 / 22, baseline: 16 / 22, unit: UNIT, source: USER_EDIT_SOURCE, raw_value: 16, cap: 22 });
    // S/M/L weights are Olumi's: the unit is Olumi's reading, quoted from Paul's own sentence — never `user_stated`.
    expect(g.unit_reading).toStrictEqual({ unit: UNIT, source: 'olumi_reading', source_quote: QUOTE });
    // Nothing else moved: every other node and every link is byte-identical.
    const others = (x: Graph) => JSON.stringify({ n: x.nodes.filter((n) => n.id !== GOAL), e: x.edges, c: x.goal_constraints });
    expect(others(s.graph())).toBe(others(STORED));
  });

  it('cold reload → rerun: the contract and the run path\'s schema keep the unit, frame, level and reading; the Run asks no "%"', async () => {
    const s = setup();
    const r = await s.call(TOOL, ARGS) as Prepared;
    await s.call('authorise_change', { proposal_id: r.proposal_id });
    const cold = clone(s.graph());
    const ingress = GraphStateIngressSchema.safeParse(cold);
    expect(ingress.success).toBe(true);
    const run = GraphV3.safeParse(cold);
    expect(run.success, JSON.stringify(run.success ? '' : run.error.issues.slice(0, 3))).toBe(true);
    const runGoal = (run.success ? run.data.nodes : []).find((n) => n.id === GOAL) as Record<string, unknown>;
    expect(runGoal).toMatchObject({ goal_threshold_unit: UNIT, goal_threshold_cap: 22, goal_threshold: 0.1, goal_threshold_raw: 0.1,
      goal_threshold_frame: 'change_rel', unit_reading: { unit: UNIT, source: 'olumi_reading', source_quote: QUOTE } });
    expect(runGoal.observed_state).toMatchObject({ baseline: 16 / 22, raw_value: 16, cap: 22, unit: UNIT });
    // The next Run: today's level is there (no P1 `missing_goal_baseline`) and nothing it asks is in "%".
    const verdict = targetTestabilityOf(cold) as { failures?: { code: string }[] };
    expect((verdict.failures ?? []).map((f) => f.code)).not.toContain('missing_goal_baseline');
    const asks = placeholderAskWords(cold, intoGoal(cold))?.message ?? '';
    expect(asks).not.toContain('today’s level of');
    expect(asks).not.toMatch(/%|percent/i);
  });

  it('the same door on a post-A2 build (the goal stored with NO unit) adopts the same unit and frame', async () => {
    const g0 = clone(STORED);
    delete goalOf(g0).goal_threshold_unit;
    const s = setup(g0);
    const r = await s.call(TOOL, ARGS) as Prepared;
    expect(r.ok, JSON.stringify(r)).toBe(true);
    await s.call('authorise_change', { proposal_id: r.proposal_id });
    expect(goalOf(s.graph())).toMatchObject({ goal_threshold_unit: UNIT, goal_threshold_cap: 22, unit_reading: { source: 'olumi_reading' } });
  });
});

describe('A1 CONTROLS — valid percentage goals are preserved', () => {
  // The same goal on a LEVEL frame: its "%" is the level's own unit, so the R1 card and "16 units" are both refused.
  const levelFrame = (extra: Record<string, unknown> = {}): Graph => {
    const g0 = clone(STORED);
    Object.assign(goalOf(g0), { goal_threshold_frame: 'level', ...extra });
    if (!('goal_threshold_raw' in extra)) delete goalOf(g0).goal_threshold_raw;
    return g0;
  };
  it.each([
    ['R1\'s own card (16 small-update equivalents per sprint)', ARGS],
    ['"16 units"', { ...ARGS, unit: 'units' }],
  ])('CONTROL: a LEVEL-frame percent goal (no target yet) still refuses %s, nothing prepared', async (_, args) => {
    const s = setup(levelFrame(), `${SAID}\nWe ship 16 units a sprint.`);
    const r = await s.call(TOOL, args) as ToolResult;
    expect(r).toMatchObject({ ok: false, refusal: 'unit_unrecognised' });
    expect(s.registers).toEqual([]);
  });

  it('CONTROL: a LEVEL-frame "%" goal with a target (20%, cap 100) still refuses "16 units"', async () => {
    const s = setup(levelFrame({ goal_threshold_raw: 20, goal_threshold_cap: 100, goal_threshold: 0.2 }), `${SAID}\nWe ship 16 units a sprint.`);
    const r = await s.call(TOOL, { ...ARGS, unit: 'units' }) as ToolResult;
    expect(r).toMatchObject({ ok: false, refusal: 'unit_unrecognised' });
    expect(s.registers).toEqual([]);
  });

  it('CONTROL: a relative change of a % METRIC ("cut churn rate by 10%") keeps "%" — "40 customers" is refused', async () => {
    const g0 = clone(STORED);
    Object.assign(goalOf(g0), { label: 'churn rate', goal_threshold_raw: -0.1, goal_direction: '<=' });
    const s = setup(g0, `${SAID}\nWe lose 40 customers a month.`);
    const r = await s.call(TOOL, { ...ARGS, goal_label: 'churn rate', value: 40, unit: 'customers per month' }) as ToolResult;
    expect(r).toMatchObject({ ok: false, refusal: 'unit_mismatch' });
    expect(s.registers).toEqual([]);
  });
});

describe('A1 TWINS — never a silent rescale: anything held in the old unit refuses the card, typed', () => {
  it('TWIN: a %-change goal with a USER-SIZED link into it is refused (unit_in_use), nothing prepared', async () => {
    const g0 = clone(STORED);
    const e = g0.edges.find((x) => x.to === GOAL && x.from === 'tech_lead_hires')!;
    e.provenance = { source: 'user_specified', magnitude: 'user_stated',
      natural_effect: { amount: 5, amount_unit: '%', per_source_change: 1, per_source_change_unit: 'hires', strength_mean: 0.5, strength_mean_frame: 'edge_strength' } };
    delete e.defaulted;
    const s = setup(g0);
    const r = await s.call(TOOL, ARGS) as ToolResult & { detail?: string };
    expect(r).toMatchObject({ ok: false, refusal: 'unit_in_use' });
    expect(String(r.detail)).toContain('a link into it sized against its change in %');
    expect(s.registers).toEqual([]);
  });

  it('TWIN: a USER-SIZED link into the goal with no natural size recorded is refused too (unit_in_use)', async () => {
    const g0 = clone(STORED);
    const e = g0.edges.find((x) => x.to === GOAL && x.from === 'developer_hires')!;
    e.provenance = { source: 'user_specified', magnitude: 'user_stated' };
    delete e.defaulted;
    const s = setup(g0);
    const r = await s.call(TOOL, ARGS) as ToolResult;
    expect(r).toMatchObject({ ok: false, refusal: 'unit_in_use' });
    expect(s.registers).toEqual([]);
  });

  it('TWIN: a link into the goal holding a natural size in % (Olumi\'s estimate) is refused too — its % would be re-read', async () => {
    const g0 = clone(STORED);
    const e = g0.edges.find((x) => x.to === GOAL && x.from === 'tech_lead_hires')!;
    e.provenance = { source: 'cee_hypothesis', magnitude: 'olumi_estimate',
      natural_effect: { amount: 5, amount_unit: '%', per_source_change: 1, per_source_change_unit: 'hires', strength_mean: 0.5, strength_mean_frame: 'edge_strength' } };
    const s = setup(g0);
    const r = await s.call(TOOL, ARGS) as ToolResult;
    expect(r).toMatchObject({ ok: false, refusal: 'unit_in_use' });
    expect(s.registers).toEqual([]);
  });

  it('TWIN: a limit row on the goal in "%" is refused (unit_in_use)', async () => {
    const g0 = clone(STORED);
    g0.goal_constraints = [...(g0.goal_constraints ?? []), { constraint_id: 'gc-prod', node_id: GOAL, operator: '>=', value: 5, unit: '%', value_frame: 'change_rel', label: 'productivity', provenance: 'explicit' }];
    const s = setup(g0);
    const r = await s.call(TOOL, ARGS) as ToolResult;
    expect(r).toMatchObject({ ok: false, refusal: 'unit_in_use' });
    expect(s.registers).toEqual([]);
  });

  it('CONTROL: a limit row lands on the goal after the card → superseded on the revision, nothing written', async () => {
    const s = setup();
    const r = await s.call(TOOL, ARGS) as Prepared;
    expect(r.ok).toBe(true);
    s.edit((g) => { g.goal_constraints = [...(g.goal_constraints ?? []), { constraint_id: 'gc-prod', node_id: GOAL, operator: '>=', value: 5, unit: '%', label: 'productivity', provenance: 'explicit' }]; });
    const applied = await s.call('authorise_change', { proposal_id: r.proposal_id }) as ToolResult;
    expect(applied).toMatchObject({ ok: false, refusal: 'superseded' });
    expect(s.registers).toEqual([]);
  });

  it('TWIN at apply: a user size lands on a link into the goal where the revision does not see it → the adoption is re-derived and refused, nothing written', async () => {
    const s = setup();
    const r = await s.call(TOOL, ARGS) as Prepared;
    expect(r.ok).toBe(true);
    // Mutated in place: the store's revision does not move, so only the apply-time re-derivation can see it.
    const e = s.graph().edges.find((x) => x.to === GOAL && x.from === 'developer_hires')!;
    e.provenance = { source: 'user_specified', magnitude: 'user_stated' };
    const applied = await s.call('authorise_change', { proposal_id: r.proposal_id }) as ToolResult & { detail?: string };
    expect(applied).toMatchObject({ ok: false, refusal: 'not_applied' });
    expect(String(applied.detail)).toContain('was prepared in no longer fits the goal');
    expect(s.registers).toEqual([]);
  });

  it('CONTROL: a level of 0 gives no range to read it on — refused, nothing framed or written', async () => {
    const s = setup(STORED, `${SAID}\nRight now we ship 0 small updates.`);
    const r = await s.call(TOOL, { ...ARGS, value: 0 }) as ToolResult;
    expect(r).toMatchObject({ ok: false, refusal: 'no_target' });
    expect(s.registers).toEqual([]);
  });
});
