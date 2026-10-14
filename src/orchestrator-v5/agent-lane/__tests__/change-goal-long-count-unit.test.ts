/**
 * W2 round 3: the shared reading contract remains 40 characters. The model-facing schema must declare it.
 * Captures contain NO tool arguments: refusal rows reconstruct the narrated 44-character strings over the
 * verbatim captured graph and composer history. The 35-character unit is copied from the user's C1b message.
 * Only the schema row is RED at base; the refusal and approval rows preserve existing product truth.
 * Registration is a CAS/ingress-checking store double, as in change-goal-adopts-level-unit.test.ts.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { AGENT_TOOLS, toolsFor, dispatchTool, type ToolResult } from '../runtime/agent-tools.js';
import { ProposalStore } from '../proposal.js';
import { levelUnitForChangeGoal } from '../goal-current-level.js';
import { GraphStateIngressSchema } from '../../boundary/request-extensions.js';
import { GraphV3, NodeV3 } from '../../../schemas/cee-v3.js';
import { USER_EDIT_SOURCE } from '../../../orchestrator/canonicalise-value-ops.js';

type Node = { id: string; kind: string; label: string } & Record<string, unknown>;
type Graph = { nodes: Node[]; edges: Record<string, unknown>[] } & Record<string, unknown>;
type Draw = { scenario_id: string; user_messages: string[]; graph: Graph };
const DRAWS = (JSON.parse(readFileSync(new URL('./fixtures/founder-evening-level-units-20261006.json', import.meta.url), 'utf8')) as { draws: Draw[] }).draws;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const goalOf = (g: Graph): Node => g.nodes.find(n => n.id === 'productivity')!;
const QUOTE = 'We can fit 4 large, 8 medium, 16 small, roughly';
const TOOL = 'propose_goal_current_level';

function setup(draw: Draw, said = draw.user_messages.join('\n')) {
  let graph = clone(draw.graph);
  let rev = 0;
  const registers: { graph: Graph; expected_graph_hash?: string }[] = [];
  const dispatch: InternalDispatch = async (path, body) => {
    if (path === `/assist/v1/scenarios/${draw.scenario_id}/graph`) {
      return { status: 200, json: { graph: clone(graph), graph_hash: `h${rev}`, graph_identity_hash: { value: `id-h${rev}` } } };
    }
    if (path === `/assist/v1/scenarios/${draw.scenario_id}/graph/register`) {
      const b = clone(body) as { graph: Graph; expected_graph_hash?: string };
      registers.push(b);
      if (!GraphStateIngressSchema.safeParse(b.graph).success) return { status: 400, json: { details: { code: 'GRAPH_CONTRACT_INVALID' } } };
      if (b.expected_graph_hash !== `h${rev}`) return { status: 409, json: { details: { code: 'GRAPH_STALE' } } };
      graph = b.graph;
      rev += 1;
      return { status: 200, json: { graph_hash: `h${rev}`, model_version: { version_number: rev + 1, version_id: `v${rev}`, mutation_id: `m${rev}` } } };
    }
    return { status: 500, json: {} };
  };
  const caps = createAgentCapabilities(dispatch, new ProposalStore());
  const ctx = { scenario_id: draw.scenario_id, authenticated_user_id: null, request_id: 'req-w2-long-count', user_text: said };
  const call = (name: string, args: Record<string, unknown>): Promise<ToolResult> => dispatchTool(name, JSON.stringify(args), ctx, caps);
  return { call, registers, graph: () => graph };
}

const SHORT_UNIT = 'small-update equivalents per sprint';
const ACCEPTED = [{ name: 'CONTROL C1b witnessed 35-character unit', draw: DRAWS[1]!, value: 16, unit: SHORT_UNIT }];

describe('W2 — generate units within the shared 40-character reading contract', () => {
  it('RED: the model-facing unit schema declares maxLength 40 and gives a short example', () => {
    const tool = AGENT_TOOLS.find(t => t.name === TOOL)!;
    const unit = (tool.parameters as { properties: { unit: { type: string; maxLength?: number; description: string } } }).properties.unit;
    expect(unit).toMatchObject({ type: 'string', maxLength: 40 });
    expect(unit.description).toContain('at most 40 characters');
    expect(unit.description).toContain(`"${SHORT_UNIT}"`);
    expect(SHORT_UNIT).toHaveLength(35);
    // The declared bound reaches the same tool in each mode that exposes the level writer.
    expect(toolsFor('full').find(t => t.name === TOOL)).toBe(tool);
    expect(toolsFor('preview').some(t => t.name === TOOL)).toBe(false);
  });

  it.each(ACCEPTED)('$name → held approval, then verbatim olumi_reading survives cold run parsing', async ({ draw, value, unit }) => {
    const s = setup(draw);
    expect(goalOf(s.graph())).toMatchObject({ goal_threshold_frame: 'change_rel', goal_threshold_raw: 0.1 });
    expect(goalOf(s.graph())).not.toHaveProperty('goal_threshold_cap');
    expect(goalOf(s.graph())).not.toHaveProperty('observed_state');
    const r = await s.call(TOOL, { goal_label: 'productivity', value, unit, user_stated: true }) as ToolResult & { proposal_id?: string; public_label?: string; note?: string };
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.mutated).toBe(false);
    expect(r.public_label).toContain(`as your figure: ${value} ${unit}`);
    expect(r.public_label).toContain(`measure "productivity" in ${unit} (Olumi’s reading of your figures in “${QUOTE}”`);
    expect(r.note).toContain('never their own words or weights');
    expect(s.registers).toEqual([]);
    const applied = await s.call('authorise_change', { proposal_id: r.proposal_id });
    expect(applied, JSON.stringify(applied)).toMatchObject({ ok: true, applied: true });
    expect(s.registers).toHaveLength(1);
    expect(s.registers[0]!.expected_graph_hash).toBe('h0');
    const goal = goalOf(s.graph());
    expect(goal).toMatchObject({ goal_threshold_unit: unit, goal_threshold_raw: 0.1, goal_threshold_frame: 'change_rel',
      unit_reading: { unit, source: 'olumi_reading', source_quote: QUOTE },
      observed_state: { raw_value: value, unit, source: USER_EDIT_SOURCE } });
    // One cap, from the existing construction rule: today's level × 1.1 × 1.25 headroom.
    expect(goal.goal_threshold_cap).toBeCloseTo(value * 1.1 * 1.25);
    const parsed = GraphV3.parse(clone(s.graph()));
    const coldGoal = parsed.nodes.find(n => n.id === 'productivity')!;
    expect(coldGoal.unit_reading).toStrictEqual({ unit, source: 'olumi_reading', source_quote: QUOTE });
    expect(coldGoal.observed_state).toMatchObject({ raw_value: value, unit });
    expect(s.graph().nodes.filter(n => n.id !== 'productivity')).toEqual(draw.graph.nodes.filter(n => n.id !== 'productivity'));
    expect(s.graph().edges).toEqual(draw.graph.edges);
  });

  it.each([
    { name: 'R4', draw: DRAWS[0]!, value: 4, unit: 'large-update equivalents per two-week sprint' },
    { name: 'C1b', draw: DRAWS[1]!, value: 16, unit: 'small-update equivalents per two-week sprint' },
  ])('CONTROL $name: narrated 44-character unit still refuses and asks for a short name', async ({ draw, value, unit }) => {
    expect(unit).toHaveLength(44);
    const s = setup(draw);
    const before = clone(s.graph());
    const r = await s.call(TOOL, { goal_label: 'productivity', value, unit, user_stated: true });
    expect(r).toMatchObject({ ok: false, refusal: 'unit_unrecognised' });
    expect(r.detail).toContain('Ask the user for a short name for the unit of "productivity".');
    expect(s.registers).toEqual([]);
    expect(s.graph()).toEqual(before);
    expect(NodeV3.shape.unit_reading.parse({ unit, source: 'olumi_reading', source_quote: QUOTE })).toBeUndefined();
  });

  it('CONTROL: an absent user figure is still refused with a short inferred unit', async () => {
    const s = setup(DRAWS[1]!, 'We have no capacity figure yet.');
    const r = await s.call(TOOL, { goal_label: 'productivity', value: 16, unit: SHORT_UNIT, user_stated: true });
    expect(r).toMatchObject({ ok: false, refusal: 'figure_not_in_users_words' });
    expect(s.registers).toEqual([]);
  });

  it('CONTROL: % on this change goal still does not adopt a unit and refuses the unsupported percentage level', async () => {
    const s = setup(DRAWS[0]!, 'Productivity today is 16%.');
    expect(levelUnitForChangeGoal('%', goalOf(s.graph()), s.graph())).toStrictEqual({ ok: true });
    const r = await s.call(TOOL, { goal_label: 'productivity', value: 16, unit: '%', user_stated: true });
    expect(r).toMatchObject({ ok: false, refusal: 'no_target' });
    expect(s.registers).toEqual([]);
  });
});
