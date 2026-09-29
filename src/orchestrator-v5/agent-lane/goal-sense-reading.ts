/**
 * ⛔ OLUMI'S READING OF THE GOAL'S SENSE, TYPED ON THE GOAL NODE (R3-B #72 5893233864; DL release blocker 5893260041;
 * AIQ ruling 5893340150; MG contract 5893383773).
 *
 * Served on "Monthly spend is £45k; we want to cut costs by 20%…": the target was typed `change_rel` −0.2, but the "20%"
 * beside "costs" was given to another node whose label says "cost", so no comparator was held and the run MAXIMISED
 * spend ("Stay on AWS" crowned, 100% "reaches the target"). For a reduction target the typed sign IS the direction
 * (R1 S4-core: "the sign is the comparator's and the verb's"), so construction writes that reading here and
 * `resolveGoalDirection` sends `minimise` from it.
 *
 * Written only when ALL hold, else the nodes come back as the very same array:
 *  · exactly one goal node, its target typed as a change (`change_rel` | `change_abs`) with a NEGATIVE sign;
 *  · the DRAFTER'S own comparator is a ceiling (`<=` | `<`). AIQ's floor guard: "keep MRR from falling more than 10%" is
 *    also −0.10 but a floor (`>=`), and minimising it would crown the option that loses the most. The drafter's
 *    comparator is readable only here, at construction, so the guard lives here;
 *  · no user comparator is held (`goal_direction`): the user's own speaks first (`stated_comparator`).
 * It is OLUMI'S reading, never stamped the user's: its `words` say so (AIQ condition (a)), keyed to the threshold read.
 */
import { sayFigure } from './say-figure.js';

export interface GoalSenseReading {
  readonly sense: 'minimise';
  readonly basis: 'typed_change_sign';
  readonly threshold: number;
  readonly words: string;
}

type GoalNode = {
  readonly kind?: unknown;
  readonly label?: unknown;
  readonly goal_threshold_frame?: unknown;
  readonly goal_threshold_raw?: unknown;
  readonly goal_threshold_unit?: unknown;
  readonly goal_direction?: unknown;
};

/** The change as the user said it ("20%", "£5,000"): the magnitude of the typed figure in its written unit. */
function changeAsSaid(frame: 'change_rel' | 'change_abs', raw: number, unit: unknown): string {
  return frame === 'change_rel'
    ? `${sayFigure(Math.round(Math.abs(raw) * 100 * 1e6) / 1e6, '')}%`
    : sayFigure(Math.abs(raw), typeof unit === 'string' ? unit : '');
}

export function withGoalSenseReading<N extends GoalNode>(
  nodes: readonly N[],
  goal: { readonly operator?: unknown } | null | undefined,
): readonly N[] {
  const goals = nodes.filter((n) => n.kind === 'goal');
  if (goals.length !== 1 || goal === null || goal === undefined) return nodes;
  const node = goals[0]!;
  const frame = node.goal_threshold_frame;
  const raw = node.goal_threshold_raw;
  if ((frame !== 'change_rel' && frame !== 'change_abs') || typeof raw !== 'number' || !Number.isFinite(raw) || raw >= 0) return nodes;
  if (goal.operator !== '<=' && goal.operator !== '<') return nodes;
  if (node.goal_direction !== undefined) return nodes;
  const label = typeof node.label === 'string' && node.label.trim() !== '' ? node.label.trim() : 'the goal';
  const reading: GoalSenseReading = {
    sense: 'minimise',
    basis: 'typed_change_sign',
    threshold: raw,
    words: `Olumi reads ‘${label}’ as a target to bring it DOWN by ${goal.operator === '<' ? 'more than' : 'at least'} `
      + `${changeAsSaid(frame, raw, node.goal_threshold_unit)} from today.`,
  };
  return nodes.map((n) => (n === node ? { ...n, goal_sense_reading: reading } : n));
}
