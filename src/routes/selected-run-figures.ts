import type { AnalysisStateV1, OlumiResponse } from '@talchain/schemas/boundary';
import { compareAnalysisRunFactIdentity } from '../orchestrator-v5/context/analysis-interpretation-identity.js';
import { readStoredGoalCertainty } from '../orchestrator-v5/tools/handlers/run-goal-certainty.js';

type ResultBlock = OlumiResponse['blocks'][number];
type Rec = Record<string, unknown>;
const rec = (value: unknown): Rec | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Rec : null;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** Only conditional projections attested by the selected Run's stored certainty row. */
export interface SelectedRunFigure {
  readonly option_id: string;
  readonly goal_node_id: string;
  readonly value: number;
  /** The goal's observed unit is in the canonical Run hash; the condition's operand is never a unit. */
  readonly unit: string;
  readonly goal_frame: 'level';
  readonly measure: 'projected_if_held';
  readonly run_hash: string;
  readonly computed_at: string;
  readonly condition: { readonly kind: 'if_held'; readonly operand_id: string };
  /** Permissions for THIS option and THIS measure, not a licence to extrapolate from it. */
  readonly claim_permissions: {
    readonly may_present_value: true;
    readonly may_name_as_leader: boolean;
    readonly may_present_without_if_held: false;
    readonly may_claim_goal_certainty: false;
  };
  /** The producer's exact conditional wording. Never reconstructed from the number. */
  readonly attested_copy: string;
}

export interface SelectedGoalFigureContext {
  readonly goal_node_id: string;
  readonly unit: string;
  readonly goal_frame: 'level';
}

/**
 * Read the selected goal from the graph the canonical currentness verdict used.
 * `observed_state.unit` is in the Run hash. `goal_threshold_unit` is not, so
 * both must agree before the latter may label a Run figure. An edit to only
 * the threshold unit then withholds the figure; an edit to both units stales
 * the Run via the hashed observed unit. Change/delta frames need their own
 * result semantics and remain outside this level-figure slice.
 */
export function readSelectedGoalFigureContext(graph: unknown, goalNodeId: unknown): SelectedGoalFigureContext | null {
  if (typeof goalNodeId !== 'string' || goalNodeId.length === 0) return null;
  const nodes = rec(graph)?.nodes;
  if (!Array.isArray(nodes)) return null;
  const matches = nodes.filter((node) => rec(node)?.id === goalNodeId && rec(node)?.kind === 'goal');
  if (matches.length !== 1) return null;
  const goal = rec(matches[0])!;
  const observedUnit = rec(goal.observed_state)?.unit;
  const thresholdUnit = goal.goal_threshold_unit;
  if (goal.goal_threshold_frame !== 'level' || typeof observedUnit !== 'string' || observedUnit.trim() === ''
    || typeof thresholdUnit !== 'string' || thresholdUnit.trim() === '' || thresholdUnit !== observedUnit) return null;
  return { goal_node_id: goalNodeId, unit: observedUnit, goal_frame: 'level' };
}

export interface SelectedRunFiguresInput {
  readonly scenarioId: string;
  readonly runState: AnalysisStateV1['run_state'] | null;
  /** Read from the same current graph as `runState`, and only when its unit is hash-bound. */
  readonly selectedGoal: SelectedGoalFigureContext | null;
  readonly leaderClaimPermitted: boolean;
  /** The claim-gated block that `readScenarioAnalysis` actually delivered. */
  readonly currentResult: ResultBlock | null;
  /** The SAME selected fact's stored metadata and goal-certainty decision. */
  readonly selectedFact: {
    readonly graph_hash_at_run?: unknown;
    readonly computed_at?: unknown;
    readonly goal_certainty?: unknown;
  } | null;
}

/**
 * `break_even.projected_if_held` is a conditional projection with stored
 * wording. `outcome.mean` has no typed scale/unit proof in today's producer
 * contract: it may be a normalized score even when the goal's unit is currency.
 * No mean is therefore emitted, regardless of magnitude or goal metadata.
 * This pure read labels only existing attested conditional producer facts.
 * It never recalculates a result, recovers a suppressed block, or converts a
 * stored probability into a user-facing claim. The selected goal's hash-bound
 * unit and level frame accompany each value; the subscriber break-even is not
 * a unit for these monthly MRR values.
 */
export function projectSelectedRunFigures(input: SelectedRunFiguresInput): SelectedRunFigure[] {
  const block = rec(input.currentResult);
  const enrichment = rec(block?.enrichment);
  const compared = enrichment?.option_comparison;
  if (input.runState?.kind !== 'complete_current' || block?.type !== 'analysis_result'
    || input.selectedFact === null || input.selectedGoal === null || !Array.isArray(compared)) return [];

  // A graph hash alone does not identify a Run: two executions of the same
  // graph can have different computed_at. Reuse the estate's exact tuple gate.
  const binding = compareAnalysisRunFactIdentity(
    { scenario_id: input.scenarioId,
      graph_hash_at_run: input.selectedFact.graph_hash_at_run,
      computed_at: input.selectedFact.computed_at },
    { scenario_id: input.scenarioId,
      graph_hash_at_run: block.computed_against_hash,
      computed_at: input.runState.computed_at },
  );
  if (binding.status !== 'match') return [];
  const { graph_hash_at_run: run_hash, computed_at } = binding.identity;

  const decisions = readStoredGoalCertainty(input.selectedFact.goal_certainty);
  const certaintyByOption = new Map((decisions ?? []).map((decision) => [decision.option_id, decision] as const));
  const duplicatedOptions = new Set((decisions ?? []).filter((decision, index, all) =>
    all.findIndex((other) => other.option_id === decision.option_id) !== index).map((decision) => decision.option_id));
  const figures: SelectedRunFigure[] = [];
  for (const raw of compared) {
    const option = rec(raw);
    if (option === null || option.status !== 'computed'
      || typeof option.option_id !== 'string' || option.option_id.length === 0) continue;
    const option_id = option.option_id;
    const common = {
      option_id, goal_node_id: input.selectedGoal.goal_node_id, unit: input.selectedGoal.unit,
      goal_frame: input.selectedGoal.goal_frame, run_hash, computed_at,
    };
    const may_name_as_leader = input.leaderClaimPermitted && block.leading_option_id === option_id;
    const certainty = certaintyByOption.get(option_id);
    const breakEven = rec(certainty?.break_even);
    const chances = [option.probability_of_goal, option.goal_probability, option.goalProbability]
      .filter((value) => value !== undefined);
    // The stored `say` and operand establish what the conditional value means.
    // Public transport removes an unearned exact chance. Its absence does not
    // erase this same Run's stored conditional attestation; a present contrary
    // chance or an ambiguous decision still cannot license the figure.
    if (certainty?.earned !== false || duplicatedOptions.has(option_id)
      || chances.some((value) => value !== certainty.probability_of_goal)
      || breakEven?.kind !== 'product' || !finite(breakEven.projected_if_held)
      || typeof breakEven.operand_id !== 'string' || breakEven.operand_id.length === 0
      || typeof certainty.say !== 'string' || certainty.say.trim() === '') continue;
    figures.push({
      ...common, value: breakEven.projected_if_held, measure: 'projected_if_held',
      condition: { kind: 'if_held', operand_id: breakEven.operand_id },
      claim_permissions: {
        may_present_value: true, may_name_as_leader, may_present_without_if_held: false,
        may_claim_goal_certainty: false,
      },
      attested_copy: certainty.say,
    });
  }
  return figures;
}
