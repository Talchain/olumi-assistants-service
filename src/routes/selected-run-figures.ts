import type { AnalysisStateV1, OlumiResponse } from '@talchain/schemas/boundary';
import { compareAnalysisRunFactIdentity } from '../orchestrator-v5/context/analysis-interpretation-identity.js';
import { readStoredGoalCertainty } from '../orchestrator-v5/tools/handlers/run-goal-certainty.js';

type ResultBlock = OlumiResponse['blocks'][number];
type Rec = Record<string, unknown>;
const rec = (value: unknown): Rec | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Rec : null;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** Only measures attested by the selected result and its stored certainty row. */
export interface SelectedRunFigure {
  readonly option_id: string;
  readonly value: number;
  /** The result's unit comes from the selected model goal; the condition's operand is never a unit. */
  readonly measure: 'mean' | 'projected_if_held';
  readonly run_hash: string;
  readonly computed_at: string;
  readonly condition?: { readonly kind: 'if_held'; readonly operand_id: string };
}

export interface SelectedRunFiguresInput {
  readonly scenarioId: string;
  readonly runState: AnalysisStateV1['run_state'] | null;
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
 * The two MRR figures in a Run are different measures, not conflicting answers:
 * `outcome.mean` is a simulated mean; `break_even.projected_if_held` is a
 * conditional projection. This pure read labels only existing producer facts.
 * It never recalculates a result, recovers a suppressed block, or converts a
 * stored probability into a user-facing claim. The selected model's goal unit
 * must accompany any eventual display; the subscriber break-even is not a
 * unit for these monthly MRR values.
 */
export function projectSelectedRunFigures(input: SelectedRunFiguresInput): SelectedRunFigure[] {
  const block = rec(input.currentResult);
  const enrichment = rec(block?.enrichment);
  const compared = enrichment?.option_comparison;
  if (input.runState?.kind !== 'complete_current' || block?.type !== 'analysis_result'
    || input.selectedFact === null || !Array.isArray(compared)) return [];

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
  const figures: SelectedRunFigure[] = [];
  for (const raw of compared) {
    const option = rec(raw);
    if (option === null || typeof option.option_id !== 'string' || option.option_id.length === 0) continue;
    const option_id = option.option_id;
    const mean = rec(option?.outcome)?.mean;
    if (finite(mean)) figures.push({ option_id, value: mean, measure: 'mean', run_hash, computed_at });

    const certainty = certaintyByOption.get(option_id);
    const breakEven = rec(certainty?.break_even);
    // The stored `say` and operand establish what the conditional value means.
    // A missing or mismatched decision cannot license it; the raw P(goal)=1
    // never becomes a probability figure when `earned` is false.
    if (certainty?.earned !== false || certainty.probability_of_goal !== option.probability_of_goal
      || breakEven?.kind !== 'product' || !finite(breakEven.projected_if_held)
      || typeof breakEven.operand_id !== 'string' || breakEven.operand_id.length === 0
      || typeof certainty.say !== 'string' || certainty.say.trim() === '') continue;
    figures.push({
      option_id, value: breakEven.projected_if_held, measure: 'projected_if_held', run_hash, computed_at,
      condition: { kind: 'if_held', operand_id: breakEven.operand_id },
    });
  }
  return figures;
}
