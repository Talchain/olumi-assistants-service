/** Shared offline Z1b assertions: captured graph, real tools, schema/CAS-enforcing in-memory persistence. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readPercentUnit, readUnitParts } from '../../same-unit.js';
import { admitStatedGoalChange, isChangeOwnPercent, type CandidateModel } from '../../admit-model.js';
import { levelUnitForChangeGoal } from '../../goal-current-level.js';
import { briefGoalLevel } from '../../unplaced-goal-level.js';
import { createAgentCapabilities, type InternalDispatch } from '../../runtime/agent-capabilities.js';
import { dispatchTool, type ToolResult } from '../../runtime/agent-tools.js';
import { ProposalStore } from '../../proposal.js';
import { GraphStateIngressSchema } from '../../../boundary/request-extensions.js';
import { GraphV3 } from '../../../../schemas/cee-v3.js';
import { USER_EDIT_SOURCE } from '../../../../orchestrator/canonicalise-value-ops.js';
import { currentLevelAskOnAnswer, currentLevelAnswerFirstCall, CURRENT_LEVEL_TOOL } from '../../current-level-answer.js';
import { currentLevelAskForAnswerRow } from '../../current-level-ask-carry.js';
import { placeholderAskWords } from '../../goal-certainty.js';

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
export const CAPTURE = JSON.parse(readFileSync(new URL('./founder-percent-change-unit-20261006.json', import.meta.url), 'utf8')) as Capture;
export const STORED = CAPTURE.draft_read.j.graph;
export const SCENARIO = CAPTURE.draft_read.j.scenario_id;
export const GOAL = 'productivity';
export const UNIT = 'small-update equivalents per sprint';
export const REPAIR = CAPTURE.turns[2]!;
export const ARGS = { goal_label: GOAL, value: 16, unit: UNIT, user_stated: true };
export const Z1_UNITS = ['%', '% change', '% change from today', 'percent', 'per cent', 'percentage', 'pct'];
export const Z1_ALIAS_UNITS = ['percent change', 'per cent change', 'percentage change', 'pct change'];
export const clone = <T>(x: T): T => structuredClone(x);
export const goalOf = (graph: Graph): Node => graph.nodes.find(n => n.id === GOAL)!;
export const graphWithUnit = (unit: string): Graph => {
  const graph = clone(STORED);
  goalOf(graph).goal_threshold_unit = unit;
  return graph;
};
export const candidateGoal = (unit: string): CandidateModel['goal'] => ({
  metric: GOAL, operator: '>=', value: 10, unit, frame: 'change_rel', target_stated: true,
  provenance: 'explicit', horizon_months: 3, baseline_known: false, baseline_value: null,
});

/** Real Agent dispatch/proposal/apply; fake persistence preserves the captured read shape and enforces CAS/schema. */
export function setup(initial = STORED, userText = REPAIR.request.request_body.message) {
  let graph = clone(initial);
  let revision = 0;
  const hash = (): string => revision === 0 ? CAPTURE.draft_read.j.graph_hash : `z1b-revision-${revision}`;
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

// Independent examples, not the production predicate's constants. Exercise every family word and reference pairing.
const CHANGE_WORDS = ['change', 'increase', 'decrease', 'rise', 'fall', 'growth', 'gain', 'drop', 'decline',
  'reduction', 'improvement', 'uplift', 'up', 'down', 'more', 'less', 'higher', 'lower'];
const REFERENCES = ['today', 'now', 'current', 'currently', 'baseline', 'the baseline', 'current level', 'present',
  'start', 'starting point', 'before', 'last second', 'last minute', 'last hour', 'last day', 'last week',
  'last fortnight', 'last month', 'last quarter', 'last year', 'last years', 'last qtr', 'last hr', 'last mins', 'last'];
const CONNECTORS = ['from', 'vs', 'versus', 'over', 'compared to', 'relative to'];
export const NEW_UNITS = [...new Set([
  ...['%', 'percent', 'per cent', 'percentage', 'pct'].flatMap(head => CHANGE_WORDS.map(word => `${head} ${word}`)),
  ...CONNECTORS.flatMap(connector => REFERENCES.map(level => `% change ${connector} ${level}`)),
  ...CONNECTORS.map(connector => `% ${connector} today`),
  '% increase higher from baseline', '  PER  CENT decrease relative to CURRENT LEVEL  ', '% reduction-from-baseline',
])].filter(unit => !Z1_UNITS.includes(unit) && !Z1_ALIAS_UNITS.includes(unit));
export const REFUSED_UNITS = [
  '% of customers', '% of revenue', 'per cent of staff', '% of today', '% share', '% base',
  'conversion %', '% on-time probability', '% NRR', '% change in revenue', '% increase in productivity',
  '% per month', '%/month', '% growth per month', '% growth/month',
  'pp', 'percentage points', 'percent points', '% points', 'percentile', 'percentiles', '% percentile',
  '% from', '% compared to', '% relative to', '% change from last revenue',
  '% change from baseline revenue', '% change from the current level', '% change today', '% change vs baseline per month',
  '% change from today vs baseline', '% increase and decrease', '% change from today increase',
];
export const HELD_KINDS = ['natural size', 'user size', 'definition', 'limit', 'level'] as const;

export function checkReading(unit: string): void {
  assert.equal(readUnitParts(unit)?.kind, 'percent');
  assert.equal(readPercentUnit(unit)?.kind, 'percent');
  assert.equal(isChangeOwnPercent({ metric: GOAL, frame: 'change_rel', unit }), true);
}

export async function checkRepairAndApproval(unit: string): Promise<void> {
  const initial = graphWithUnit(unit);
  const s = setup(initial);
  const result = await s.call(CURRENT_LEVEL_TOOL, ARGS) as Prepared;
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.mutated, false);
  assert.equal(result.refusal, undefined);
  assert.deepEqual(result.current_level, { value: 16, unit: UNIT });
  assert.ok(result.public_label?.includes(`16 ${UNIT} (your target: up at least 10% from today)`));
  assert.ok(result.public_label?.includes(`and measure "productivity" in ${UNIT} (Olumi’s reading`));
  assert.ok(result.note?.includes(`typed in ${unit}`));
  assert.deepEqual(s.proposals.get(String(result.proposal_id))?.operations.map(op => op.path), [GOAL]);
  assert.equal(s.registers.length, 0);
  assert.deepEqual(s.graph(), initial);
  const applied = await s.call('authorise_change', { proposal_id: result.proposal_id });
  assert.equal(applied.ok, true, JSON.stringify(applied));
  assert.equal(applied.mutated, true);
  assert.equal(applied.applied, true);
  assert.equal(s.registers.length, 1);
  assert.equal(s.registers[0]!.expected_graph_hash, CAPTURE.draft_read.j.graph_hash);
  const cold = JSON.parse(JSON.stringify(s.graph())) as Graph;
  const goal = goalOf(cold);
  assert.equal(goal.goal_threshold_frame, 'change_rel');
  assert.equal(goal.goal_threshold_raw, 0.1);
  assert.equal(goal.goal_threshold, 0.1);
  assert.equal(goal.goal_threshold_unit, UNIT);
  assert.equal(goal.goal_threshold_cap, 22);
  assert.equal(goal.goal_threshold_cap_provenance, 'target_derived_headroom');
  assert.equal(goal.goal_direction, '>=');
  assert.deepEqual(goal.observed_state, { raw_value: 16, value: 16 / 22, baseline: 16 / 22,
    cap: 22, unit: UNIT, source: USER_EDIT_SOURCE });
  assert.deepEqual(goal.unit_reading, { unit: UNIT, source: 'olumi_reading',
    source_quote: 'We fit 16 small-update equivalents per sprint' });
  const others = (g: Graph) => ({ nodes: g.nodes.filter(n => n.id !== GOAL), edges: g.edges, constraints: g.goal_constraints });
  assert.deepEqual(others(cold), others(initial));
  assert.equal(GraphStateIngressSchema.safeParse(cold).success, true);
  assert.equal(GraphV3.safeParse(cold).success, true);
  const ask = placeholderAskWords(cold, cold.edges.filter(e => e.to === GOAL))?.message ?? '';
  assert.equal(ask.includes('today’s level'), false);
  assert.equal(ask.includes('in %'), false);
}

export function checkConstruction(unit: string): void {
  const result = admitStatedGoalChange(candidateGoal(unit), 10, () => false);
  assert.deepEqual(result.node, { goal_threshold_frame: 'change_rel', goal_threshold_raw: 0.1 });
  assert.ok(result.withheld?.includes('current level was not stated'));
}

const moneyCandidate = (unit: string, metric = 'Monthly spend'): CandidateModel => ({
  goal: { ...candidateGoal(unit), metric, value: -20 }, options: [], factors: [], constraints: [], risks: [], outcomes: [], links: [],
});
const MONEY_BRIEF = 'Monthly spend is £45k; we want to cut monthly spend by 20%.';
export function checkBriefFallback(unit: string): void {
  const result = briefGoalLevel(moneyCandidate(unit), MONEY_BRIEF);
  assert.equal(result?.kind, 'adopt');
  if (result?.kind !== 'adopt') return;
  assert.equal(result.value, 45000);
  assert.equal(result.unit, 'GBP per month');
}

export async function checkAskChain(unit: string): Promise<void> {
  const graph = graphWithUnit(unit);
  const emittedAtIso = '2026-10-06T22:16:00.000Z';
  const ask = currentLevelAskOnAnswer({ graph, analysisResult: CAPTURE.level_ask.analysis_result,
    sentText: CAPTURE.level_ask.sent_text, scenarioId: SCENARIO, userId: null, emittedAtIso,
    prior: null, answered: false, message: '', awaitingApproval: false });
  assert.equal(ask?.action.kind, 'elicit_goal_current_level');
  assert.equal(ask?.action.goal_unit, undefined);
  const surviving = currentLevelAskForAnswerRow({ prior: clone(ask), next: null, answered: false,
    graph, graphHash: CAPTURE.draft_read.j.graph_hash, nowMs: Date.parse(emittedAtIso) + 1000, typedByUser: true });
  assert.notEqual(surviving, null);
  assert.equal(surviving?.action.goal_unit, undefined);
  const state = await setup(graph).call('get_canonical_state');
  const answer = REPAIR.request.request_body.message.replace(/^We fit /, '').replace(/\.$/, '');
  assert.equal(currentLevelAnswerFirstCall(state, surviving, answer, false), CURRENT_LEVEL_TOOL);
  // A changed named measure invalidates the earlier unqualified ask.
  const changed = graphWithUnit('% change in revenue');
  assert.equal(currentLevelAskForAnswerRow({ prior: clone(ask), next: null, answered: false,
    graph: changed, graphHash: CAPTURE.draft_read.j.graph_hash, nowMs: Date.parse(emittedAtIso) + 1000, typedByUser: true }), null);
  const changedState = await setup(changed).call('get_canonical_state');
  assert.equal(currentLevelAnswerFirstCall(changedState, surviving, answer, false), undefined);
}

export function checkFrameAndMetricGuards(unit: string): void {
  for (const frame of ['level', 'change_abs'] as const) {
    assert.equal(isChangeOwnPercent({ metric: GOAL, frame, unit }), false);
    const graph = graphWithUnit(unit);
    goalOf(graph).goal_threshold_frame = frame;
    assert.deepEqual(levelUnitForChangeGoal(UNIT, goalOf(graph), graph), { ok: true });
    assert.equal(briefGoalLevel({ ...moneyCandidate(unit), goal: { ...moneyCandidate(unit).goal, frame } }, MONEY_BRIEF)?.kind === 'adopt', false);
  }
  for (const metric of ['churn rate', 'conversion rate', 'Margin', 'coverage', 'Revenue %']) {
    assert.equal(isChangeOwnPercent({ metric, frame: 'change_rel', unit }), false);
    assert.equal(briefGoalLevel(moneyCandidate(unit, metric), MONEY_BRIEF)?.kind, 'refused');
    const graph = graphWithUnit(unit);
    goalOf(graph).label = metric;
    assert.deepEqual(levelUnitForChangeGoal(UNIT, goalOf(graph), graph), { ok: true });
  }
}

export async function checkRefused(unit: string): Promise<void> {
  assert.equal(isChangeOwnPercent({ metric: GOAL, frame: 'change_rel', unit }), false);
  const graph = graphWithUnit(unit);
  assert.deepEqual(levelUnitForChangeGoal(UNIT, goalOf(graph), graph), { ok: true });
  const s = setup(graph);
  const result = await s.call(CURRENT_LEVEL_TOOL, ARGS);
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(s.registers.length, 0);
  assert.deepEqual(s.graph(), graph);
  const constructed = admitStatedGoalChange(candidateGoal(unit), 10, () => false);
  assert.equal(constructed.node.goal_threshold_unit, unit);
  assert.equal(briefGoalLevel(moneyCandidate(unit), MONEY_BRIEF)?.kind, 'refused');
  const ask = currentLevelAskOnAnswer({ graph, analysisResult: CAPTURE.level_ask.analysis_result,
    sentText: CAPTURE.level_ask.sent_text, scenarioId: SCENARIO, userId: null, emittedAtIso: '2026-10-06T22:16:00.000Z',
    prior: null, answered: false, message: '', awaitingApproval: false });
  assert.equal(ask?.action.goal_unit, unit);
}

function addHeld(graph: Graph, kind: typeof HELD_KINDS[number], unit: string): void {
  if (kind === 'limit') graph.goal_constraints.push({ node_id: GOAL, value: 5, unit });
  else if (kind === 'level') goalOf(graph).observed_state = { raw_value: 8, unit };
  else {
    const edge = graph.edges.find(e => e.to === GOAL)!;
    edge.provenance = kind === 'natural size'
      ? { magnitude: 'olumi_estimate', natural_effect: { amount: 5, amount_unit: unit } }
      : kind === 'user size' ? { magnitude: 'user_stated' } : { definitional: true };
  }
}

export async function checkHeldGuard(unit: string, kind: typeof HELD_KINDS[number]): Promise<void> {
  const graph = graphWithUnit(unit);
  addHeld(graph, kind, unit);
  const s = setup(graph);
  const result = await s.call(CURRENT_LEVEL_TOOL, ARGS);
  assert.equal(result.ok, false);
  assert.equal(result.refusal, 'unit_in_use');
  assert.equal(s.registers.length, 0);
  assert.deepEqual(s.graph(), graph);
}

export async function checkApplyGuard(unit: string): Promise<void> {
  const s = setup(graphWithUnit(unit));
  const prepared = await s.call(CURRENT_LEVEL_TOOL, ARGS) as Prepared;
  assert.equal(prepared.ok, true);
  addHeld(s.graph(), 'natural size', unit); // Same hash: apply must catch the semantic change independently.
  const result = await s.call('authorise_change', { proposal_id: prepared.proposal_id });
  assert.equal(result.ok, false);
  assert.equal(result.refusal, 'not_applied');
  assert.equal(s.registers.length, 0);
}
