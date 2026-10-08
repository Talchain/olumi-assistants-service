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
  GOAL_FIGURES_SHARE_APPROXIMATION, GOAL_FIGURES_USER_EFFECT_CLAMPED, GOAL_FIGURES_WITHHELD_CODES, GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED,
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
import { withShareByDateChanceGate } from '../../../goal-target/goal-chance-range.js';
import { readFileSync } from 'node:fs';
import { targetTestabilityOf } from '../../../admission/target-testability.js';
import { isOlumiSideThreshold, thresholdReasonOf, THRESHOLD_REASONS } from '../../../compose/claim-safety-cage.js';

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
  // Identical arms need a control that changes/adopts the actual option levels.
  GOAL_FIGURES_OPTIONS_IDENTICAL,
  // Invalid engine probability has no corrective bar control; Run is outside this bar.
  GOAL_FIGURES_PROBABILITY_UNUSABLE,
  // A dated chance-of-event goal still needs its scientific event-model recovery.
  GOAL_FIGURES_CHANCE_AS_GOAL,
  // GOALS #2762 (S2b): a share-by-deadline chance outside its licence. Its recovery is GOALS' typed team-time ask
  // (chat → card) and "say what this option changes"; neither is a bar action yet.
  GOAL_FIGURES_SHARE_APPROXIMATION,
  // Build 1b: ask what the goal is made of; never confirm a contradictory reading.
  `${IDENTITY}:contradictory_current_level`,
  // GOAL-REACH 3b (Science §(g)): user-side threshold reasons whose control is not a bar action yet.
  // "Show what ‘{option}’ changes": PLoT's detail names no option, and no setting-removal writer exists (UNVERIFIED).
  'THRESHOLD:goal_pinned_by_intervention',
  // §(g) "a target stated as an amount": every goal door refuses a CHANGE-framed target (`goal_is_a_change`:
  // propose_goal_target, goal_target_edit, add-constraint), so Set target would be INERT here (Codex r1, #2816).
  'THRESHOLD:change_rel_base_zero',
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
  [GOAL_FIGURES_SHARE_APPROXIMATION]: { make: () => {
    // The real S2a gate: a share-by-deadline goal (definitional '% of …' threshold) with no supported forecast carrier.
    const graph = twoParentGraph(); const goal = goalOf(graph);
    goal.threshold_source = 'definitional'; goal.goal_threshold_unit = '% of the launch';
    return { graph, result: withShareByDateChanceGate(baselineResult(), graph, 'mrr') as Rec };
  }, resolves: [] },
  [GOAL_FIGURES_PRODUCT_NOT_READ]: { make: productNotRead, resolves: ['confirm_reading'] },
  // GOAL-REACH 3b: the user's current level (set_current_level → the persisted ask → the existing card).
  [GOAL_FIGURES_TARGET_NOT_TESTABLE]: { make: targetNotTestable, resolves: ['set_current_level'] },
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

/**
 * GOAL-REACH 3b: the same withhold → recovery contract for GOAL_THRESHOLD_NOT_CONVERTIBLE, per carried reason. The
 * warning is a CAPTURED PLoT #444 body's (fixtures/plot-threshold-444). Each reason has an enabled resolving offer, a
 * named KNOWN_GAPS entry, or is Olumi-side (Science carve-out): explain-only + the defect log, and NEVER a press of its own.
 */
const CAPTURED = (name: string): Rec[] => (JSON.parse(readFileSync(new URL(`../../__tests__/fixtures/plot-threshold-444/${name}.json`, import.meta.url), 'utf8')) as Rec)
  .inference_warnings;
function thresholdFixture(name: string, withWarning = true): Fixture {
  const graph = twoParentGraph();
  if (name.startsWith('change_rel')) Object.assign(goalOf(graph), { goal_threshold_raw: 0.15, goal_threshold_unit: '%', goal_threshold_frame: 'change_rel' });
  const result = baselineResult();
  for (const row of result.option_comparison) delete row.probability_of_goal;
  if (withWarning) result.inference_warnings = CAPTURED(name);
  return { graph, result };
}
const THRESHOLD_INVENTORY: Readonly<Record<string, readonly string[]>> = {
  missing_goal_baseline: ['set_current_level'],
  // §(g) primary "Link what drives {goal}" has no 0-LLM edge door yet; the secondary (current level) resolves it.
  root_goal__root_value_source: ['set_current_level'],
  root_goal__root_intercept: [],
  root_goal: [],
  goal_pinned_by_intervention: [],
  goal_values_outside_normalised_domain: [],
  non_finite_conversion_input: [],
  goal_node_missing: [],
  epsilon_breaks_status_quo_reference: [],
  auto_scaled_noise_breaks_status_quo_reference: [],
  change_rel_raw_range_missing: [],
  change_rel_base_zero: [],
  absent_reason: [],
};
const offerIds = (f: Fixture): string[] => { const b = actionBarOf(actionFactsOf(readOf(f))); return [...b.priority, ...b.standard, ...b.more].filter(o => o.enabled).map(o => o.action_id as string).sort(); };

describe('GOAL-REACH 3b — GOAL_THRESHOLD_NOT_CONVERTIBLE reason → recovery class guard', () => {
  it('the inventory covers every ISL reason, both root forms and PLoT\'s fallback', () => {
    const covered = new Set(Object.keys(THRESHOLD_INVENTORY).map(k => thresholdReasonOf({ inference_warnings: CAPTURED(k) })!.reason));
    expect([...covered].sort()).toEqual([...THRESHOLD_REASONS].sort());
  });

  it.each(Object.keys(THRESHOLD_INVENTORY))('%s: an enabled resolving offer, a named KNOWN_GAP, or Olumi-side with no press of its own', name => {
    const fixture = thresholdFixture(name);
    const carried = thresholdReasonOf(fixture.result)!;
    expect(carried, `${name}: the captured warning must fire`).not.toBeNull();
    const ids = offerIds(fixture);
    const resolving = THRESHOLD_INVENTORY[name]!.filter(id => ids.includes(id));
    if (isOlumiSideThreshold(carried)) {
      expect(THRESHOLD_INVENTORY[name], `${name}: an Olumi-side reason is never given a control`).toEqual([]);
      expect(ids, `${name}: FAKE CONTROL — the bar must not change because of an Olumi-side reason`).toEqual(offerIds(thresholdFixture(name, false)));
    } else {
      expect(resolving.length > 0 || KNOWN_GAPS.has(`THRESHOLD:${name}`), `${name}: no enabled resolving action and no KNOWN_GAPS entry`).toBe(true);
    }
  });

  it('change_rel_base_zero offers NO inert Set target (every goal door refuses a change target); the gap is named', () => {
    expect(offerIds(thresholdFixture('change_rel_base_zero')).filter(id => id === 'set_goal')).toEqual(offerIds(thresholdFixture('change_rel_base_zero', false)).filter(id => id === 'set_goal'));
    expect(KNOWN_GAPS.has('THRESHOLD:change_rel_base_zero')).toBe(true);
  });

  it('the Olumi-side defect is logged on the Run path by the one predicate (wiring row)', () => {
    const src = readFileSync(new URL('../../../tools/handlers/run-analysis.ts', import.meta.url), 'utf8');
    expect(src).toContain("if (thresholdReason !== null && isOlumiSideThreshold(thresholdReason)) {");
    expect(src).toContain("event: 'run_analysis.goal_threshold_olumi_side'");
  });
});

describe('GOAL-REACH 3b — Paul\'s served post-Yes Run (P44 draw 2, 53e2ddbd)', () => {
  const served = JSON.parse(readFileSync(new URL('../../__tests__/fixtures/goal-reach-served-run2-53e2ddbd.json', import.meta.url), 'utf8')) as Rec;
  it('the served Run withholds by TARGET_NOT_TESTABLE and its served bar had no current-level control (the gap, as witnessed)', () => {
    expect(served.analysis_result.enrichment.inference_warnings.map((w: Rec) => w.code)).toContain(GOAL_FIGURES_TARGET_NOT_TESTABLE);
    expect(served.served_action_ids).not.toContain('set_current_level');
  });
  const preconditionsOf = (graph: Rec): string[] => { const v = targetTestabilityOf(graph); return v.kind === 'not_testable' ? v.failures.map(f => f.precondition) : []; };
  const barOf = (graph: Rec) => { const bar = actionBarOf(actionFactsOf({ scenarioId: served.scenario_id, graph, graphHash: served.graph_hash,
    analysisState: served.analysis_state, analysisResult: served.analysis_result, analysisReady: served.analysis_ready }));
    return [...bar.priority, ...bar.standard, ...bar.more].filter(o => o.enabled && o.action_id === 'set_current_level'); };
  it('Science §(i) 1 RED: after the Yes, today\'s MRR is DERIVED (£49 × 250): no P1, so no current-level ask; P5 (3 unsized links) still withholds', () => {
    expect(targetTestabilityOf(served.graph).kind).toBe('not_testable');
    const pre = preconditionsOf(served.graph);
    expect(pre).not.toContain('P1');
    expect(pre).toContain('P5');
    expect(barOf(served.graph)).toEqual([]);
  });
  it('Science §(i) 1 MUTANT pair: the same served graph with the identity UNCONFIRMED, or a factor with no level → P1 stays and the ask is offered', () => {
    const unconfirmed = structuredClone(served.graph); goalOf(unconfirmed).nonlinear_identity.stated_in_brief = false;
    expect(preconditionsOf(unconfirmed)).toContain('P1');
    expect(barOf(unconfirmed)).toHaveLength(1);
    const levelless = structuredClone(served.graph); levelless.nodes.find((n: Rec) => n.id === 'paying_pro_subscribers').observed_state = null;
    expect(preconditionsOf(levelless)).toContain('P1');
    expect(barOf(levelless)).toHaveLength(1);
  });
  it('Codex r2 P1s: the derived level never applies to a relative-change target, nor when the factors\' units do not compose into the target\'s currency/period', () => {
    expect(preconditionsOf(served.graph)).not.toContain('P1'); // control: the served level goal (GBP/month) derives
    const relative = structuredClone(served.graph);
    Object.assign(goalOf(relative), { goal_threshold_frame: 'change_rel', goal_threshold_raw: 0.15, goal_threshold: 0.15 });
    expect(preconditionsOf(relative)).toContain('P1');
    const dollars = structuredClone(served.graph); goalOf(dollars).goal_threshold_unit = '$/month';
    expect(preconditionsOf(dollars)).toContain('P1');
  });
});
