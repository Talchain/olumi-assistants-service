/**
 * GOAL-REACH build 1 row 7: a goal-chance withhold must retain a resolving action.
 * Inventory: the canonical GOAL_FIGURES_WITHHELD_CODES authority, plus its deliberately
 * separate no-stated-target code. RunDeltaDisclosureReason is a comparison-binding
 * taxonomy; its run_identity_unconfirmed is not the goal-definition identity lock.
 * PLoT-owned reasons are replayed at CEE's boundary; no second PLoT producer is invented.
 */
import { describe, expect, it } from 'vitest';
import paulStored from '../../__tests__/fixtures/goal-reach-paul-graph-632b92b9.json';
import {
  GOAL_FIGURES_CHANCE_AS_GOAL, GOAL_FIGURES_OPTIONS_IDENTICAL, GOAL_FIGURES_PLACEHOLDER_PATH,
  GOAL_FIGURES_PROBABILITY_UNUSABLE, GOAL_FIGURES_PRODUCT_NOT_READ, GOAL_FIGURES_TARGET_NOT_TESTABLE,
  GOAL_FIGURES_USER_EFFECT_CLAMPED, GOAL_FIGURES_WITHHELD_CODES, GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED,
  readOptionResultSources,
} from '../../../../orchestrator/context/option-result-source.js';
import { withholdOptionGoalFigures } from '../../../../orchestrator/context/constraint-feasibility.js';
import { computeAnalysisAffectingGraphHash } from '../../../context/graph-hash.js';
import { GOAL_FIGURES_NO_STATED_TARGET, withholdUnusableGoalChances } from '../../../goal-target/goal-chance-gate.js';
import { withholdGoalFiguresForChanceGoal, withholdGoalFiguresForUntestableTarget } from '../../../tools/handlers/run-analysis.js';
import { detectIdenticalArms } from '../../../tools/handlers/identical-arms.js';
import { goalChanceWithheldForAgent } from '../../goal-chance-withheld.js';
import { placeholderGoalPaths, placeholderGoalWarning } from '../../goal-certainty.js';
import { unreadGoalProduct, unreadGoalProductWarning } from '../../unread-goal-product.js';
import { proposeProductIdentity } from '../../identity-proposal.js';
import { actionFactsOf, type ActionRead } from '../state.js';
import { actionBarOf } from '../rank.js';

type Rec = Record<string, any>;
type Graph = { nodes: Rec[]; edges: Rec[]; [key: string]: unknown };
type Fixture = { graph: Graph; result: Rec };
const SCENARIO = '632b92b9-82df-4a46-933f-3a64e49004bd';
const AT = '2026-10-08T00:36:10.000Z';
const OPTS = ['keep_49_pro_price', 'raise_pro_price_to_59'];
const IDENTITY = GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED;

/**
 * Explicitly unresolved bar controls. Each entry names the missing recovery, never
 * treats Review/What changes as resolving an unrelated cause, and cannot exempt the
 * coherent identity row. Remove an entry when its actual bar recovery is delivered.
 */
export const KNOWN_GAPS = new Set<string>([
  // PLoT's scale-cut reason needs a rescale/correct-size door on the bar.
  GOAL_FIGURES_USER_EFFECT_CLAMPED,
  // No current goal level: the existing conversational ask is not a bar action yet.
  GOAL_FIGURES_TARGET_NOT_TESTABLE,
  // Identical arms need a control that changes/adopts the actual option levels.
  GOAL_FIGURES_OPTIONS_IDENTICAL,
  // Invalid engine probability has no corrective bar control; Run is outside this bar.
  GOAL_FIGURES_PROBABILITY_UNUSABLE,
  // A dated chance-of-event goal still needs its scientific event-model recovery.
  GOAL_FIGURES_CHANCE_AS_GOAL,
  // Build 1b: ask what the goal is made of; never confirm a contradictory reading.
  `${IDENTITY}:contradictory_current_level`,
]);

const paul = (): Graph => structuredClone(paulStored) as Graph;
const goalOf = (g: Graph): Rec => g.nodes.find(n => n.kind === 'goal')!;
const baselineResult = (): Rec => ({
  option_comparison: OPTS.map((option_id, i) => ({ option_id, probability_of_goal: 0.35 + i * 0.2, win_probability: 0.4 + i * 0.2 })),
  inference_warnings: [],
});
const warning = (code: string): Rec => ({
  code, severity: 'warning', node_ids: ['mrr'], option_ids: OPTS,
  message: "Not shown. Olumi reads ‘MRR’ as ‘Pro plan price’ × ‘Pro paying subscribers’, but that hasn't been confirmed.",
});
function boundaryWithhold(graph: Graph, code: string, extra: Rec = {}): Fixture {
  return { graph, result: withholdOptionGoalFigures(baselineResult(), new Set(OPTS), { ...warning(code), ...extra }) };
}

function twoParentGraph(): Graph {
  const g = paul();
  const keep = new Set(['mrr', 'pro_plan_price', 'pro_paying_subscribers', ...OPTS]);
  g.nodes = g.nodes.filter(n => keep.has(n.id));
  g.edges = g.edges.filter(e => keep.has(e.from) && keep.has(e.to));
  delete g.goal_constraints;
  const count = g.nodes.find(n => n.id === 'pro_paying_subscribers')!;
  count.observed_state = { unit: 'subscribers', value: 0.15, raw_value: 300, source: 'user_override' };
  count.scale_frame = 2000;
  delete count.display_value;
  return g;
}

function productNotRead(): Fixture {
  const graph = twoParentGraph();
  const goal = goalOf(graph);
  delete goal.nonlinear_identity;
  goal.observed_state = { unit: '£/month', raw_value: 14700, value: 0.588, cap: 25000, source: 'brief_extraction' };
  const reading = unreadGoalProduct(graph);
  expect(reading, GOAL_FIGURES_PRODUCT_NOT_READ + ': producer fixture must actually detect the unread product').not.toBeNull();
  return {
    graph,
    result: withholdOptionGoalFigures(baselineResult(), new Set(OPTS), unreadGoalProductWarning(reading!, OPTS, GOAL_FIGURES_PRODUCT_NOT_READ)),
  };
}

function placeholderPath(): Fixture {
  const graph = twoParentGraph();
  delete goalOf(graph).nonlinear_identity;
  goalOf(graph).observed_state = { unit: '£/month', raw_value: 12000, value: 0.48, cap: 25000, source: 'brief_extraction' };
  const edge = graph.edges.find(e => e.from === 'pro_plan_price' && e.to === 'mrr')!;
  edge.provenance = { source: 'cee_hypothesis', magnitude: 'olumi_placeholder' };
  const paths = placeholderGoalPaths(graph, OPTS);
  expect(paths.length, GOAL_FIGURES_PLACEHOLDER_PATH + ': producer fixture must fire').toBeGreaterThan(0);
  return { graph, result: withholdOptionGoalFigures(baselineResult(), new Set(paths.map(p => p.option_id)), placeholderGoalWarning(graph, paths, GOAL_FIGURES_PLACEHOLDER_PATH)) };
}

function targetNotTestable(): Fixture {
  const graph = twoParentGraph();
  delete goalOf(graph).nonlinear_identity;
  return { graph, result: withholdGoalFiguresForUntestableTarget(baselineResult(), graph) };
}

function identicalOptions(): Fixture {
  const graph = twoParentGraph();
  const result = baselineResult();
  const outcome = { p10: 10, p50: 20, p90: 30, mean: 20, std: 5, n_valid_samples: 1000 };
  result.option_comparison = result.option_comparison.map((r: Rec) => ({ ...r, status: 'computed', outcome }));
  const groups = detectIdenticalArms(result, graph.nodes.filter(n => OPTS.includes(n.id)));
  expect(groups.length, GOAL_FIGURES_OPTIONS_IDENTICAL + ': result detector must fire').toBeGreaterThan(0);
  return { graph, result: withholdOptionGoalFigures(result, new Set(groups.flatMap(g => g.option_ids)), { ...warning(GOAL_FIGURES_OPTIONS_IDENTICAL), message: 'Not shown. These options come out identical in this model.' }, { keepOutcome: true }) };
}

function noTarget(): Fixture {
  const graph = twoParentGraph();
  const goal = goalOf(graph);
  for (const k of ['goal_threshold', 'goal_threshold_raw', 'goal_threshold_cap', 'goal_threshold_unit']) delete goal[k];
  return { graph, result: withholdUnusableGoalChances(baselineResult(), graph, goal.id) };
}

function chanceAsGoal(): Fixture {
  const graph = twoParentGraph();
  const goal = goalOf(graph);
  goal.label = 'Chance of winning the contract';
  goal.goal_threshold_unit = '% chance of winning the contract';
  goal.goal_horizon = { deadline: '2027-10-08' };
  return { graph, result: withholdGoalFiguresForChanceGoal(baselineResult(), graph) };
}

const INVENTORY: Readonly<Record<string, { make: () => Fixture; resolves: readonly string[] }>> = {
  [IDENTITY]: { make: () => boundaryWithhold(paul(), IDENTITY), resolves: ['confirm_reading'] },
  // PLoT #422 boundary replay: served reason pinned by goal-chance-clamp-reason.test.ts.
  [GOAL_FIGURES_USER_EFFECT_CLAMPED]: { make: () => boundaryWithhold(twoParentGraph(), GOAL_FIGURES_USER_EFFECT_CLAMPED, {
    message: "Not shown. Your size for how ‘Pro paying subscribers’ moves ‘MRR’ is bigger than this model's scale can hold, so the run couldn't use it at full size, and the figures that depend on it would be wrong.",
  }), resolves: [] },
  [GOAL_FIGURES_PLACEHOLDER_PATH]: { make: placeholderPath, resolves: ['strengthen'] },
  [GOAL_FIGURES_PRODUCT_NOT_READ]: { make: productNotRead, resolves: ['confirm_reading'] },
  [GOAL_FIGURES_TARGET_NOT_TESTABLE]: { make: targetNotTestable, resolves: [] },
  [GOAL_FIGURES_OPTIONS_IDENTICAL]: { make: identicalOptions, resolves: [] },
  [GOAL_FIGURES_PROBABILITY_UNUSABLE]: { make: () => {
    const graph = twoParentGraph(); const result = baselineResult();
    result.option_comparison[0].probability_of_goal = 1.5;
    return { graph, result: withholdUnusableGoalChances(result, graph, 'mrr') };
  }, resolves: [] },
  [GOAL_FIGURES_CHANCE_AS_GOAL]: { make: chanceAsGoal, resolves: [] },
  [GOAL_FIGURES_NO_STATED_TARGET]: { make: noTarget, resolves: ['set_goal'] },
};

function readOf({ graph, result }: Fixture): ActionRead {
  const graphHash = computeAnalysisAffectingGraphHash(graph as never)!;
  return {
    scenarioId: SCENARIO, graph, graphHash,
    analysisReady: { status: 'ready', may_run: true },
    analysisState: { run_state: { kind: 'complete_current', computed_at: AT }, usable_for_chips: true, leader_claim: { permitted: false, withheld_reason: 'goal_figures_withheld' } },
    analysisResult: { type: 'analysis_result', computed_against_hash: graphHash, enrichment: result },
  };
}

describe('GOAL-REACH row 7 — withhold → recovery class guard', () => {
  it('row 7 inventory is complete against the canonical code set, including the separate no-target code', () => {
    expect(Object.keys(INVENTORY).sort()).toEqual([...GOAL_FIGURES_WITHHELD_CODES, GOAL_FIGURES_NO_STATED_TARGET].sort());
    expect(KNOWN_GAPS.has(IDENTITY), 'the coherent identity recovery cannot be hidden by build 1b').toBe(false);
    expect(KNOWN_GAPS.has(GOAL_FIGURES_PRODUCT_NOT_READ)).toBe(false);
  });

  it.each(Object.keys(INVENTORY))('row 7 %s has an enabled resolving offer or an explicit KNOWN_GAPS entry', code => {
    const row = INVENTORY[code]!;
    const fixture = row.make();
    expect(fixture.result.inference_warnings?.some((w: Rec) => w.code === code), `${code}: real producer/boundary fixture must fire`).toBe(true);
    if (GOAL_FIGURES_WITHHELD_CODES.has(code)) {
      expect(goalChanceWithheldForAgent({ enrichment: fixture.result }, fixture.graph)?.withheld, `${code}: CEE must read the actual withhold`).toBe(true);
    }
    const rawRows = readOptionResultSources(fixture.result).flat();
    expect(rawRows.some(r => typeof r.probability_of_goal !== 'number'), `${code}: fixture must lose at least one goal chance`).toBe(true);
    const bar = actionBarOf(actionFactsOf(readOf(fixture)));
    const resolving = [...bar.priority, ...bar.standard, ...bar.more].filter(o => o.enabled && row.resolves.includes(o.action_id));
    expect(resolving.length > 0 || KNOWN_GAPS.has(code), `${code}: no enabled resolving action; add its real control or document the missing one in KNOWN_GAPS`).toBe(true);
  });

  it('row 7 build 1b contradictory-current identity gap is explicit and never offered as confirmation', () => {
    const graph = twoParentGraph();
    goalOf(graph).observed_state = { unit: '£/month', raw_value: 30000, value: 1.2, source: 'brief_extraction' };
    const fixture = boundaryWithhold(graph, IDENTITY);
    expect(proposeProductIdentity(graph), 'Science §(e): £14,700 is not current MRR £30,000').toBeNull();
    const bar = actionBarOf(actionFactsOf(readOf(fixture)));
    expect([...bar.priority, ...bar.standard, ...bar.more].some(o => o.enabled && o.action_id === 'confirm_reading')).toBe(false);
    expect(KNOWN_GAPS.has(`${IDENTITY}:contradictory_current_level`)).toBe(true);
  });
});
