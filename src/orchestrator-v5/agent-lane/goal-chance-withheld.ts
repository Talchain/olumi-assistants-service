/**
 * ⛔ THE AGENT NEVER STATES A CHANCE OF REACHING THE GOAL THAT THE RUN WITHHELD (MG's PLoT #416; AIQ 5884802000,
 * words 5885033487, ACK 5886183999; DL 5885276225: "Runtime consumes that decision in the reply").
 *
 * When a declared identity on the goal's own path was not evaluated, the run's goal figures come from the additive walk,
 * so PLoT withholds `probability_of_goal` on EVERY option and says why in ONE typed warning
 * (`GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED`, its `message` in AIQ's words, its `node_ids`). The model already receives
 * the run's `enrichment`, but nothing told it what to say: a missing figure is not a rule. This reads the typed code — never
 * the words — and hands the Agent `goal_chance` with the sentence to say and the rule to follow.
 *
 * AIQ 5886183999: the goal's per-option estimates come from the same wrong walk, so they are the same unsupported class.
 */

import { GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED } from '../../orchestrator/context/option-result-source.js';

export { GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED };

/** What the Agent is told when the run withheld the goal's chance. */
export interface GoalChanceWithheld {
  readonly withheld: true;
  readonly say: string;
  readonly node_ids: readonly string[];
  readonly note: string;
}

// AIQ 5887096626: the one register ("reaches the target in N% of model runs", 5885116642).
const OPENING = 'This run doesn’t show how often each option reaches the goal’s target.';
/** PLoT's words open "Not shown." — right beside a missing figure, not in a reply; the reason after it is kept verbatim. */
const UI_OPENING = /^Not shown\.\s*/;

export const GOAL_CHANCE_WITHHELD_NOTE =
  'This run withheld the chance of reaching the goal for EVERY option. Never state, estimate, rank or compare a chance, probability '
  + 'or percentage of reaching the goal for any option, never say an option is more or less likely to reach it, and never quote an '
  + 'option’s estimated value for the goal itself as a result: those come from the same calculation. Say `say` once, as written, '
  + 'when you describe the run. Other results of this run may be described as they are.';

const recordOf = (v: unknown): Record<string, unknown> | undefined =>
  (v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : undefined);

/**
 * `goal_chance` for a run's `analysis_result` block, or `undefined` when the run did not withhold it. The warning is read
 * where the run carries it (`enrichment.inference_warnings`) or where a kept, withheld run moved it (`inference_warnings`).
 * The typed code decides; a warning with no usable words is still withheld, with the opening alone (fail closed).
 */
export function goalChanceWithheldForAgent(result: unknown): GoalChanceWithheld | undefined {
  const block = recordOf(result);
  if (block === undefined) return undefined;
  const warnings = [recordOf(block.enrichment)?.inference_warnings, block.inference_warnings]
    .flatMap((w) => (Array.isArray(w) ? w : []))
    .map(recordOf)
    .filter((w): w is Record<string, unknown> => w !== undefined && w.code === GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED);
  if (warnings.length === 0) return undefined;
  const words = warnings.map((w) => (typeof w.message === 'string' ? w.message.trim() : '')).find((m) => m !== '');
  const reason = words === undefined ? '' : words.replace(UI_OPENING, '').trim();
  const nodeIds = [...new Set(warnings.flatMap((w) => (Array.isArray(w.node_ids) ? w.node_ids : [])).filter((id): id is string => typeof id === 'string'))];
  return { withheld: true, say: reason === '' ? OPENING : `${OPENING} ${reason}`, node_ids: nodeIds, note: GOAL_CHANCE_WITHHELD_NOTE };
}
