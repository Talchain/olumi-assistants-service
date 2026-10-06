/**
 * Z1: CEE bdf5716 refused the founder's level on a goal held in "% change from today".
 * The fixture copies the full canonical graph and the captured request envelopes; response captures have no tool
 * arguments, so the arguments below reconstruct the figure/unit in the assistant's narration. No synthetic graph
 * replaces the witnessed one. Controls alter only the unit, frame or a held figure being contrasted.
 * RED-at-base reasons and the discriminating mutant are recorded in SUMMARY.md; Vitest was not run locally.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readPercentUnit, readUnitParts } from '../same-unit.js';
import { admitStatedGoalChange, isBarePercent, isChangeOwnPercent, type CandidateModel } from '../admit-model.js';
import { levelUnitForChangeGoal } from '../goal-current-level.js';
import { briefGoalLevel } from '../unplaced-goal-level.js';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { dispatchTool, type ToolResult } from '../runtime/agent-tools.js';
import { ProposalStore } from '../proposal.js';
import { GraphStateIngressSchema } from '../../boundary/request-extensions.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { USER_EDIT_SOURCE } from '../../../orchestrator/canonicalise-value-ops.js';
import { currentLevelAskOnAnswer, currentLevelAnswerFirstCall, CURRENT_LEVEL_TOOL } from '../current-level-answer.js';
import { currentLevelAskForAnswerRow } from '../current-level-ask-carry.js';
import { placeholderAskWords } from '../goal-certainty.js';

type Rec = Record<string, unknown>;
type Node = Rec & { id: string; kind: string; label: string; observed_state?: Rec };
type Edge = Rec & { from: string; to: string; provenance?: Rec };
type Graph = Rec & { nodes: Node[]; edges: Edge[]; goal_constraints: Rec[] };
interface CapturedTurn {
  request: { cee_build: string; request_body: { scenario_id: string; turn_id: string; message: string } };
  response: { assistant_text: string; _agent: { tool_calls: Rec[] } };
}
interface Capture {
  draft_read: { build: string; s: number; j: Rec & {
    scenario_id: string; graph: Graph; graph_hash: string; brief_text: string;
  } };
  level_ask: { analysis_result: Rec; sent_text: string };
  turns: CapturedTurn[];
}
const CAPTURE = JSON.parse(readFileSync(new URL('./fixtures/founder-percent-change-unit-20261006.json', import.meta.url), 'utf8')) as Capture;
const STORED = CAPTURE.draft_read.j.graph;
const SCENARIO = CAPTURE.draft_read.j.scenario_id;
const GOAL = 'productivity';
const UNIT = 'small-update equivalents per sprint';
const SIZES = CAPTURE.turns[0]!;
const FORMER = CAPTURE.turns[1]!;
const REPAIR = CAPTURE.turns[2]!;
const ARGS = { goal_label: GOAL, value: 16, unit: UNIT, user_stated: true };
const PERCENT_UNITS = ['%', '% change', '% change from today', 'percent', 'per cent', 'percentage', 'pct'];
const clone = <T>(x: T): T => structuredClone(x);
const goalOf = (graph: Graph): Node => graph.nodes.find(n => n.id === GOAL)!;
const graphWithUnit = (unit: string): Graph => {
  const graph = clone(STORED);
  goalOf(graph).goal_threshold_unit = unit;
  return graph;
};
const candidateGoal = (unit: string): CandidateModel['goal'] => ({
  metric: GOAL, operator: '>=', value: 10, unit, frame: 'change_rel', target_stated: true,
  provenance: 'explicit', horizon_months: 3, baseline_known: false, baseline_value: null,
});

/** Real Agent dispatch/proposal/apply; fake persistence preserves the captured read shape and enforces CAS/schema. */
function setup(initial = STORED, userText = REPAIR.request.request_body.message) {
  let graph = clone(initial);
  let revision = 0;
  const hash = (): string => revision === 0 ? CAPTURE.draft_read.j.graph_hash : `z1-revision-${revision}`;
  const registers: { graph: Graph; expected_graph_hash?: string }[] = [];
  const dispatch: InternalDispatch = async (path, body) => {
    if (path === `/assist/v1/scenarios/${SCENARIO}/graph`) {
      return { status: CAPTURE.draft_read.s, json: { ...clone(CAPTURE.draft_read.j), graph: clone(graph), graph_hash: hash() } };
    }
    if (path === `/assist/v1/scenarios/${SCENARIO}/graph/register`) {
      const write = clone(body) as { graph: Graph; expected_graph_hash?: string };
      if (!GraphStateIngressSchema.safeParse(write.graph).success) return { status: 400, json: { details: { code: 'GRAPH_CONTRACT_INVALID' } } };
      if (write.expected_graph_hash !== hash()) return { status: 409, json: { details: { code: 'GRAPH_STALE' } } };
      registers.push(write);
      graph = write.graph;
      revision += 1;
      return { status: 200, json: { graph_hash: hash(), model_version: { version_number: revision + 1 } } };
    }
    return { status: 500, json: {} };
  };
  const proposals = new ProposalStore();
  const caps = createAgentCapabilities(dispatch, proposals);
  const ctx = { scenario_id: SCENARIO, authenticated_user_id: null, request_id: REPAIR.request.request_body.turn_id,
    user_text: userText };
  const call = (name: string, args: Rec = {}): Promise<ToolResult> => dispatchTool(name, JSON.stringify(args), ctx, caps);
  return { call, registers, proposals, graph: () => graph };
}
type Prepared = ToolResult & { proposal_id?: string; public_label?: string; note?: string };

describe('Z1 witnessed preconditions', () => {
  it('CEE bdf5716: full 12-node/20-edge graph, +10% change, no metric cap or level; both calls refused', () => {
    expect(CAPTURE.draft_read.build).toBe('bdf5716');
    expect(SCENARIO).toBe('ceed1e3f-9a81-460c-8908-4b7ce4256bcb');
    expect(STORED.nodes).toHaveLength(12);
    expect(STORED.edges).toHaveLength(20);
    expect(goalOf(STORED)).toMatchObject({ goal_threshold_frame: 'change_rel', goal_threshold_raw: 0.1,
      goal_threshold_unit: '% change from today', goal_direction: '>=', threshold_source: 'brief_extraction' });
    expect(goalOf(STORED)).not.toHaveProperty('goal_threshold_cap');
    expect(goalOf(STORED)).not.toHaveProperty('observed_state');
    const into = STORED.edges.filter(e => e.to === GOAL);
    expect(into).toHaveLength(4);
    expect(into.every(e => e.defaulted === true && e.provenance?.natural_effect === undefined)).toBe(true);
    expect(STORED.goal_constraints.filter(row => row.node_id === GOAL)).toEqual([]);
    expect(FORMER.request.request_body.message).toBe('The former.');
    expect(REPAIR.request.request_body.message).toBe('We fit 16 small-update equivalents per sprint.');
    for (const turn of [FORMER, REPAIR]) {
      expect(turn.request.cee_build).toBe('bdf5716');
      expect(turn.response._agent.tool_calls).toEqual([{ name: CURRENT_LEVEL_TOOL, ok: false, mutated: false, refusal: 'unit_unrecognised' }]);
    }
    expect(REPAIR.response.assistant_text).toContain('The available tools cannot make that unit correction');
  });
});

describe('one grammar distinguishes the change size from its metric and from points', () => {
  it.each(PERCENT_UNITS)('recognises %s through readUnitParts', unit => {
    expect(readUnitParts(unit)?.kind).toBe('percent');
    expect(readPercentUnit(unit)?.kind).toBe('percent');
    expect(isChangeOwnPercent({ metric: GOAL, frame: 'change_rel', unit })).toBe(true);
  });
  it('case/whitespace follow the existing reader; a change qualifier is not a bare percent', () => {
    expect(isChangeOwnPercent({ metric: GOAL, frame: 'change_rel', unit: '  PER  CENT change from TODAY  ' })).toBe(true);
    expect(isBarePercent('per cent')).toBe(true);
    expect(isBarePercent('% change from today')).toBe(false);
  });
  it.each(['percentage points', 'percent points', '% points', 'pp'])('keeps %s as points', unit => {
    expect(readUnitParts(unit)?.kind).toBe('points');
    expect(readPercentUnit(unit)).toBeNull();
    expect(isBarePercent(unit)).toBe(false);
    expect(isChangeOwnPercent({ metric: GOAL, frame: 'change_rel', unit })).toBe(false);
  });
  it.each(['GBP per month', 'updates per sprint', 'percentile', '% of appointments', '% NRR', '% change in revenue'])('does not discard a measure: %s', unit => {
    expect(isChangeOwnPercent({ metric: GOAL, frame: 'change_rel', unit })).toBe(false);
  });
  it.each(['GBP per month', 'updates per sprint', 'percentile'])('the shared reader does not recognise %s as percent', unit => {
    expect(readPercentUnit(unit)).toBeNull();
  });
  it.each(PERCENT_UNITS)('preserves percentage metrics and non-relative frames for %s', unit => {
    expect(isChangeOwnPercent({ metric: 'churn rate', frame: 'change_rel', unit })).toBe(false);
    expect(isChangeOwnPercent({ metric: GOAL, frame: 'level', unit })).toBe(false);
    expect(isChangeOwnPercent({ metric: GOAL, frame: 'change_abs', unit })).toBe(false);
  });
});

describe('captured founder graph → real current-level tool → held card → approval', () => {
  it('RED at base: the witnessed repair prepares a card without writing; the unit is a disclosed reading', async () => {
    const s = setup();
    const result = await s.call(CURRENT_LEVEL_TOOL, ARGS) as Prepared;
    expect(result).toMatchObject({ ok: true, mutated: false, current_level: { value: 16, unit: UNIT } });
    expect(result.refusal).toBeUndefined();
    expect(result.public_label).toContain(`16 ${UNIT} (your target: up at least 10% from today)`);
    expect(result.public_label).toContain(`and measure "productivity" in ${UNIT} (Olumi’s reading`);
    expect(result.note).toContain('typed in % change from today');
    expect(s.proposals.get(String(result.proposal_id))?.operations.map(op => op.path)).toEqual([GOAL]);
    expect(s.registers).toEqual([]);
    expect(s.graph()).toEqual(STORED);
  });
  it('RED at base: the original sizes + former answer prepare the narrated small-updates card', async () => {
    const said = [CAPTURE.draft_read.j.brief_text, SIZES.request.request_body.message, FORMER.request.request_body.message].join('\n');
    // The capture narrates "16 small updates per sprint"; it does not expose the original tool arguments.
    const result = await setup(STORED, said).call(CURRENT_LEVEL_TOOL, { ...ARGS, unit: 'small updates per sprint' }) as Prepared;
    expect(result).toMatchObject({ ok: true, mutated: false });
    expect(result.public_label).toContain('16 small updates per sprint');
    expect(result.public_label).toContain('Olumi’s reading of your figures in “We can fit 4 large, 8 medium, 16 small, roughly”');
  });
  it.each(PERCENT_UNITS)('unit spelling %s: approval writes one goal; +10%% and the rest of the graph survive cold read', async unit => {
    const initial = graphWithUnit(unit);
    const s = setup(initial);
    const result = await s.call(CURRENT_LEVEL_TOOL, ARGS) as Prepared;
    expect(result.ok, JSON.stringify(result)).toBe(true);
    const applied = await s.call('authorise_change', { proposal_id: result.proposal_id });
    expect(applied).toMatchObject({ ok: true, mutated: true, applied: true });
    expect(s.registers).toHaveLength(1);
    expect(s.registers[0]!.expected_graph_hash).toBe(CAPTURE.draft_read.j.graph_hash);
    const cold = clone(s.graph());
    expect(goalOf(cold)).toMatchObject({ goal_threshold_frame: 'change_rel', goal_threshold_raw: 0.1,
      goal_threshold: 0.1, goal_threshold_unit: UNIT, goal_threshold_cap: 22,
      goal_threshold_cap_provenance: 'target_derived_headroom', goal_direction: '>=' });
    expect(goalOf(cold).observed_state).toEqual({ raw_value: 16, value: 16 / 22, baseline: 16 / 22,
      cap: 22, unit: UNIT, source: USER_EDIT_SOURCE });
    expect(goalOf(cold).unit_reading).toEqual({ unit: UNIT, source: 'olumi_reading',
      source_quote: 'We fit 16 small-update equivalents per sprint' });
    const others = (graph: Graph) => ({ nodes: graph.nodes.filter(n => n.id !== GOAL),
      edges: graph.edges, constraints: graph.goal_constraints });
    expect(others(cold)).toEqual(others(initial));
    expect(GraphStateIngressSchema.safeParse(cold).success).toBe(true);
    expect(GraphV3.safeParse(cold).success).toBe(true);
    const asks = placeholderAskWords(cold, cold.edges.filter(e => e.to === GOAL))?.message ?? '';
    expect(asks).not.toContain('today’s level');
    expect(asks).not.toContain('in %');
  });
  it.each(['percentage points', 'GBP per month', 'updates per sprint'])('does not adopt over the existing measure %s', unit => {
    const graph = graphWithUnit(unit);
    expect(levelUnitForChangeGoal(UNIT, goalOf(graph), graph)).toEqual({ ok: true });
  });
  it('an absolute points goal refuses sprint output and keeps its points figure and unit', async () => {
    const graph = graphWithUnit('percentage points');
    Object.assign(goalOf(graph), { goal_threshold_frame: 'change_abs', goal_threshold_raw: 2, goal_threshold_cap: 100 });
    const s = setup(graph);
    const result = await s.call(CURRENT_LEVEL_TOOL, ARGS) as Prepared;
    expect(result).toMatchObject({ ok: false, refusal: 'unit_unrecognised' });
    expect(s.registers).toEqual([]);
    expect(goalOf(s.graph())).toMatchObject({ goal_threshold_frame: 'change_abs', goal_threshold_raw: 2,
      goal_threshold_unit: 'percentage points', goal_threshold_cap: 100 });
    expect(goalOf(s.graph())).not.toHaveProperty('observed_state');
    expect(goalOf(s.graph())).not.toHaveProperty('unit_reading');
  });
  it.each(['% change', '% change from today', 'per cent'])('a held estimated natural size in %s blocks adoption', async unit => {
    const graph = clone(STORED);
    const edge = graph.edges.find(e => e.to === GOAL)!;
    edge.provenance = { ...edge.provenance, magnitude: 'olumi_estimate', natural_effect: { amount: 5, amount_unit: unit } };
    const s = setup(graph);
    expect(await s.call(CURRENT_LEVEL_TOOL, ARGS)).toMatchObject({ ok: false, refusal: 'unit_in_use' });
    expect(s.registers).toEqual([]);
  });
  it.each(['limit', 'level'])('the witnessed unit spelling still refuses adoption over a held %s', async held => {
    const graph = clone(STORED);
    if (held === 'limit') graph.goal_constraints.push({ node_id: GOAL, value: 5, unit: '% change from today' });
    else goalOf(graph).observed_state = { raw_value: 8, unit: '% change from today' };
    const s = setup(graph);
    expect(await s.call(CURRENT_LEVEL_TOOL, ARGS)).toMatchObject({ ok: false, refusal: 'unit_in_use' });
    expect(s.registers).toEqual([]);
  });
  it('an existing cap prevents adoption even on the witnessed unit spelling', () => {
    const graph = clone(STORED);
    goalOf(graph).goal_threshold_cap = 100;
    expect(levelUnitForChangeGoal(UNIT, goalOf(graph), graph)).toEqual({ ok: true });
  });
  it('apply re-derives adoption if an estimated natural change size lands after the card', async () => {
    const s = setup();
    const result = await s.call(CURRENT_LEVEL_TOOL, ARGS) as Prepared;
    expect(result.ok).toBe(true);
    s.graph().edges.find(e => e.to === GOAL)!.provenance = { magnitude: 'olumi_estimate',
      natural_effect: { amount: 5, amount_unit: '% change from today' } };
    // Hold the revision constant: the semantic apply guard must independently catch the new size.
    expect(await s.call('authorise_change', { proposal_id: result.proposal_id })).toMatchObject({ ok: false, refusal: 'not_applied' });
    expect(s.registers).toEqual([]);
  });
});

describe('construction and current-level ask consumers use the same percent-change reading', () => {
  it.each(PERCENT_UNITS)('construction %s keeps the target and withholds its level with no metric unit', unit => {
    const result = admitStatedGoalChange(candidateGoal(unit), 10, () => false);
    expect(result.node).toEqual({ goal_threshold_frame: 'change_rel', goal_threshold_raw: 0.1 });
    expect(result.withheld).toContain('current level was not stated');
  });
  it.each(['percentage points', 'GBP per month', 'updates per sprint'])('construction keeps the metric unit %s', unit => {
    expect(admitStatedGoalChange(candidateGoal(unit), 10, () => false).node.goal_threshold_unit).toBe(unit);
  });
  it.each(PERCENT_UNITS)('brief money-level fallback recognises %s; points cannot supply that fallback', unit => {
    const candidate: CandidateModel = { goal: { ...candidateGoal(unit), metric: 'Monthly spend', value: -20 },
      options: [], factors: [], constraints: [], risks: [], outcomes: [], links: [] };
    const brief = 'Monthly spend is £45k; we want to cut monthly spend by 20%.';
    expect(briefGoalLevel(candidate, brief)).toMatchObject({ kind: 'adopt', value: 45000, unit: 'GBP per month' });
    expect(briefGoalLevel({ ...candidate, goal: { ...candidate.goal, unit: 'percentage points' } }, brief)).toMatchObject({ kind: 'refused' });
  });
  it('RED at base: the captured delivered ask arms and survives with no native percent unit; its answer reaches the tool', async () => {
    const emittedAtIso = '2026-10-06T22:16:00.000Z';
    const ask = currentLevelAskOnAnswer({ graph: STORED, analysisResult: CAPTURE.level_ask.analysis_result,
      sentText: CAPTURE.level_ask.sent_text, scenarioId: SCENARIO, userId: null, emittedAtIso,
      prior: null, answered: false, message: '', awaitingApproval: false });
    expect(ask?.action.kind).toBe('elicit_goal_current_level');
    expect(ask?.action).not.toHaveProperty('goal_unit');
    const surviving = currentLevelAskForAnswerRow({ prior: clone(ask), next: null, answered: false,
      graph: STORED, graphHash: CAPTURE.draft_read.j.graph_hash, nowMs: Date.parse(emittedAtIso) + 1000, typedByUser: true });
    expect(surviving?.action).not.toHaveProperty('goal_unit');
    expect(surviving).not.toBeNull();
    const state = await setup().call('get_canonical_state');
    // The stated figure span from the captured repair, answering the delivered ask without a new subject.
    const answer = REPAIR.request.request_body.message.replace(/^We fit /, '').replace(/\.$/, '');
    expect(currentLevelAnswerFirstCall(state, surviving, answer, false)).toBe(CURRENT_LEVEL_TOOL);
  });
});
